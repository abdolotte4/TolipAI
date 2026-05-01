"""Digor Scraper Engine — FastAPI entrypoint.

Endpoints all return immediately with a job_id; long work runs as an asyncio
background task that persists progress + results to Postgres.

Run:
    uvicorn workers.main:app --host 0.0.0.0 --port ${PORT:-8765}
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from contextlib import asynccontextmanager
from pydantic import BaseModel, Field

from . import db, cash_buyers, distressed, skip_trace, ai_research
from . import http_client
from .config import settings
from .scrapers import county, propelio, propelio_v2, propwire

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("main")

# In-memory job index — persistent state lives in scraper_jobs table.
_jobs: Dict[str, Dict[str, Any]] = {}


# ─── Lifecycle ───────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_pool()
    await http_client.init_client()
    log.info("Engine ready on port %s (LLM=%s, proxies=%s)",
             os.getenv("PORT", str(settings.port)),
             settings.has_llm(), bool(settings.proxy_url()))
    yield
    await http_client.close_client()
    await db.close_pool()


app = FastAPI(
    title="Digor Scraper Engine",
    version="0.1.0",
    description="Advanced scraping + skip-trace + investor classification",
    lifespan=lifespan,
)


# ─── Request models ──────────────────────────────────────────────────────────

class CashBuyerRequest(BaseModel):
    lead_id: int = Field(..., description="ID of crm_leads row")
    max_buyers: int = 25
    campaign_id: Optional[int] = None


class DistressedRequest(BaseModel):
    zip: str = ""
    county_key: str = ""
    state: str = ""
    categories: List[str] = Field(default_factory=list,
        description="Subset of: county_clerk, public_trustee, probate_court, "
                    "tax_assessor, government_reo, auction_aggregator. "
                    "Empty = all categories.")
    source_keys: List[str] = Field(default_factory=list,
        description="Pin to specific sources by key (overrides categories).")
    campaign_id: Optional[int] = None


class SkipTraceRequest(BaseModel):
    name: str
    llc: Optional[str] = None
    address: Optional[str] = None
    state: Optional[str] = None


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _new_job(job_type: str, params: Dict[str, Any]) -> str:
    jid = uuid.uuid4().hex[:12]
    _jobs[jid] = {
        "id": jid, "type": job_type, "status": "queued", "progress": 0,
        "params": params, "result": None, "error": None,
    }
    return jid


async def _make_progress_cb(job_id: str):
    async def cb(pct: int, message: str = "") -> None:
        if job_id in _jobs:
            _jobs[job_id]["progress"] = pct
            _jobs[job_id]["message"] = message
        await db.update_job(job_id, progress=pct, status="running")
    return cb


def _set_status(job_id: str, status: str, **kwargs: Any) -> None:
    if job_id in _jobs:
        _jobs[job_id]["status"] = status
        for k, v in kwargs.items():
            _jobs[job_id][k] = v


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> Dict[str, Any]:
    """Deep health-check: probes DB, each LLM provider, and each scraper tier."""
    import time
    from .llm import _dead_providers, _rate_hits, _MAX_RATE_HITS
    from .http_client import _exhausted, _tier_dead, _scraperapi_keys, _scrapingbee_keys
    from .skip_trace import _dead_sources
    from openai import AsyncOpenAI

    async def _probe_llm(name: str, client_fn, model: str) -> Dict[str, Any]:
        if name in _dead_providers:
            return {"status": "dead", "reason": "circuit_breaker_open"}
        hits = _rate_hits.get(name, 0)
        if hits >= _MAX_RATE_HITS:
            return {"status": "rate_limited", "consecutive_hits": hits}
        client = client_fn()
        if client is None:
            return {"status": "unconfigured", "reason": "no_api_key"}
        t0 = time.monotonic()
        try:
            resp = await client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": "reply with the single word OK"}],
                max_tokens=5,
                temperature=0,
            )
            latency_ms = int((time.monotonic() - t0) * 1000)
            content = (resp.choices[0].message.content or "").strip()
            return {"status": "ok", "latency_ms": latency_ms, "response": content[:20]}
        except Exception as e:
            latency_ms = int((time.monotonic() - t0) * 1000)
            msg = str(e)
            return {
                "status": "error",
                "latency_ms": latency_ms,
                "error": msg[:120],
            }

    async def _probe_db() -> Dict[str, Any]:
        t0 = time.monotonic()
        try:
            pool = await db.init_pool()
            if pool is None:
                return {"status": "unconfigured", "reason": "no_DATABASE_URL"}
            async with pool.acquire() as c:
                await c.fetchval("SELECT 1")
            return {"status": "ok", "latency_ms": int((time.monotonic() - t0) * 1000)}
        except Exception as e:
            return {"status": "error", "error": str(e)[:120]}

    async def _probe_scraperapi() -> Dict[str, Any]:
        if "scraperapi" in _tier_dead:
            return {"status": "dead", "reason": "all_keys_exhausted"}
        active = len(_scraperapi_keys())
        total = len(settings.scraperapi_keys)
        if total == 0:
            return {"status": "unconfigured"}
        if active == 0:
            return {"status": "exhausted", "keys_total": total}
        return {"status": "ok", "keys_active": active, "keys_total": total}

    async def _probe_scrapingbee() -> Dict[str, Any]:
        if "scrapingbee" in _tier_dead:
            return {"status": "dead", "reason": "all_keys_exhausted"}
        active = len(_scrapingbee_keys())
        total = len(settings.scrapingbee_keys)
        if total == 0:
            return {"status": "unconfigured"}
        if active == 0:
            return {"status": "exhausted", "keys_total": total}
        return {"status": "ok", "keys_active": active, "keys_total": total}

    from .llm import _groq, _nvidia, _moonshot

    llm_groq, llm_nvidia, llm_moon, db_result, sapi, sbee = await asyncio.gather(
        _probe_llm("groq",     _groq,     settings.groq_model),
        _probe_llm("nvidia",   _nvidia,   settings.nvidia_model),
        _probe_llm("moonshot", _moonshot, settings.moonshot_model),
        _probe_db(),
        _probe_scraperapi(),
        _probe_scrapingbee(),
    )

    llm_ok = any(r["status"] == "ok" for r in (llm_groq, llm_nvidia, llm_moon))
    db_ok  = db_result.get("status") == "ok"
    overall = "ok" if (llm_ok and db_ok) else ("degraded" if (llm_ok or db_ok) else "down")

    return {
        "status": overall,
        "version": "0.1.0",
        "llm": {
            "groq":     llm_groq,
            "nvidia":   llm_nvidia,
            "moonshot": llm_moon,
            "any_ok":   llm_ok,
        },
        "database": db_result,
        "scrapers": {
            "scraperapi":  sapi,
            "scrapingbee": sbee,
            "residential_proxy": bool(settings.proxy_url()),
            "google_dorks_enabled": settings.enable_google_dorks,
        },
        "skip_trace": {
            "opencorporates_enabled": settings.enable_opencorporates,
            "propertyapi_enabled":    settings.enable_propertyapi,
            "dead_sources": sorted(_dead_sources),
        },
        "distressed_sources": {
            "total": len(distressed.list_sources()),
            "categories": len(distressed.list_categories()),
        },
    }


@app.get("/sources")
async def list_sources(state: Optional[str] = None) -> Dict[str, Any]:
    """All free public-record distressed sources, optionally filtered by state."""
    sources = distressed.list_sources(state=state)
    cats = distressed.list_categories()
    return {"categories": cats, "sources": sources, "count": len(sources)}


# ─── Comps (Propelio scrape) ────────────────────────────────────────────────

class CompsRequest(BaseModel):
    address: str
    radius_miles: float = 0.5
    max_results: int = 12


@app.post("/scrape/comps")
async def scrape_comps(req: CompsRequest) -> Dict[str, Any]:
    """Pull MLS-quality comps for an address.

    Tries authenticated Propelio first (richer data), falls back to the
    free public viewer if credentials aren't set or the auth flow fails.
    """
    if os.getenv("PROPELIO_EMAIL") and os.getenv("PROPELIO_PASSWORD"):
        try:
            return await propelio_v2.estimate_arv(req.address, radius_miles=req.radius_miles)
        except Exception as e:  # noqa: BLE001
            log.warning("propelio_v2 failed, falling back to public: %s", e)
    return await propelio.estimate_arv(req.address, radius_miles=req.radius_miles)


# ─── Propelio (authenticated) ───────────────────────────────────────────────


class PropelioCashBuyersRequest(BaseModel):
    address: str
    distance_miles: int = 10
    active_within: str = "ANY_TIME"  # ANY_TIME | LAST_6M | LAST_1Y | LAST_2Y
    min_properties: int = 3
    landlords: bool = True
    flippers: bool = True
    max_results: int = 500
    lead_id: Optional[int] = None
    campaign_id: Optional[int] = None
    persist: bool = True


@app.post("/scrape/propelio/cash-buyers")
async def scrape_propelio_cash_buyers(req: PropelioCashBuyersRequest) -> Dict[str, Any]:
    """Async: scrape Propelio's cash-buyer panel for an address."""
    job_id = _new_job("propelio_cash_buyers", req.model_dump())
    await db.create_job(job_id, "propelio_cash_buyers", req.model_dump(),
                        lead_id=req.lead_id, campaign_id=req.campaign_id)

    async def runner() -> None:
        try:
            cb = await _make_progress_cb(job_id)
            result = await propelio_v2.cash_buyers_for_address(
                req.address,
                distance_miles=req.distance_miles,
                active_within=req.active_within,
                min_properties=req.min_properties,
                landlords=req.landlords,
                flippers=req.flippers,
                max_results=req.max_results,
                progress_cb=cb,
            )
            buyers = result.get("buyers") or []

            if req.persist and req.lead_id:
                for b in buyers:
                    try:
                        await db.insert_cash_buyer(req.lead_id, job_id, b)
                    except Exception as e:  # noqa: BLE001
                        log.debug("persist buyer failed: %s", e)

            _set_status(job_id, "done", progress=100, result=result)
            await db.update_job(job_id, status="done", progress=100,
                                result_count=len(buyers), completed=True)
        except Exception as e:  # noqa: BLE001
            log.exception("propelio cash-buyers job %s failed", job_id)
            _set_status(job_id, "failed", error=str(e))
            await db.update_job(job_id, status="failed", error=str(e), completed=True)

    asyncio.create_task(runner())
    return {"job_id": job_id, "status": "queued", "address": req.address}


# ─── Propwire (authenticated) ───────────────────────────────────────────────


class PropwireQueryRequest(BaseModel):
    query: str  # address or full propwire URL


class PropwireCashBuyersRequest(BaseModel):
    query: str
    radius_miles: float = 1.0
    min_properties: int = 3
    max_results: int = 200
    lead_id: Optional[int] = None
    campaign_id: Optional[int] = None
    persist: bool = True


@app.post("/scrape/propwire/property")
async def scrape_propwire_property(req: PropwireQueryRequest) -> Dict[str, Any]:
    return await propwire.fetch_property(req.query)


@app.post("/scrape/propwire/comps")
async def scrape_propwire_comps(req: PropwireQueryRequest) -> Dict[str, Any]:
    rows = await propwire.fetch_comps(req.query)
    return {"query": req.query, "count": len(rows), "comps": rows}


@app.post("/scrape/propwire/history")
async def scrape_propwire_history(req: PropwireQueryRequest) -> Dict[str, Any]:
    return await propwire.fetch_history(req.query)


@app.post("/scrape/propwire/cash-buyers-nearby")
async def scrape_propwire_cash_buyers(req: PropwireCashBuyersRequest) -> Dict[str, Any]:
    job_id = _new_job("propwire_cash_buyers", req.model_dump())
    await db.create_job(job_id, "propwire_cash_buyers", req.model_dump(),
                        lead_id=req.lead_id, campaign_id=req.campaign_id)

    async def runner() -> None:
        try:
            cb = await _make_progress_cb(job_id)
            buyers = await propwire.fetch_cash_buyers_nearby(
                req.query,
                radius_miles=req.radius_miles,
                min_properties=req.min_properties,
                max_results=req.max_results,
                progress_cb=cb,
            )
            if req.persist and req.lead_id:
                for b in buyers:
                    try:
                        await db.insert_cash_buyer(req.lead_id, job_id, b)
                    except Exception as e:  # noqa: BLE001
                        log.debug("persist buyer failed: %s", e)

            _set_status(job_id, "done", progress=100,
                        result={"count": len(buyers), "buyers": buyers})
            await db.update_job(job_id, status="done", progress=100,
                                result_count=len(buyers), completed=True)
        except Exception as e:  # noqa: BLE001
            log.exception("propwire cash-buyers job %s failed", job_id)
            _set_status(job_id, "failed", error=str(e))
            await db.update_job(job_id, status="failed", error=str(e), completed=True)

    asyncio.create_task(runner())
    return {"job_id": job_id, "status": "queued", "query": req.query}


# ─── AI Research ────────────────────────────────────────────────────────────

class TrusteeDiscoveryRequest(BaseModel):
    state: str
    county: Optional[str] = ""
    max_results: int = 25


@app.post("/ai/trustees")
async def ai_trustees(req: TrusteeDiscoveryRequest) -> Dict[str, Any]:
    trustees = await ai_research.discover_trustees(
        state=req.state, county=req.county or "", max_results=req.max_results,
    )
    return {"state": req.state, "county": req.county, "trustees": trustees,
            "count": len(trustees)}


@app.get("/ai/hedge-fund-markets")
async def ai_hedge_fund_markets(max_results: int = 12) -> Dict[str, Any]:
    markets = await ai_research.hedge_fund_markets(max_results=max_results)
    return {"markets": markets, "count": len(markets)}


class ResearchRequest(BaseModel):
    query: str
    max_results: int = 10


@app.post("/ai/research")
async def ai_research_endpoint(req: ResearchRequest) -> Dict[str, Any]:
    return await ai_research.research(req.query, max_results=req.max_results)


@app.post("/scrape/cash-buyers")
async def scrape_cash_buyers(req: CashBuyerRequest) -> Dict[str, Any]:
    lead = await db.get_lead(req.lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail=f"Lead {req.lead_id} not found")

    job_id = _new_job("cash_buyers", req.model_dump())
    await db.create_job(job_id, "cash_buyers", req.model_dump(),
                        lead_id=req.lead_id, campaign_id=req.campaign_id)

    async def runner() -> None:
        try:
            cb = await _make_progress_cb(job_id)
            results = await cash_buyers.find_cash_buyers(
                lead, max_buyers=req.max_buyers, job_id=job_id, progress_cb=cb,
            )
            _set_status(job_id, "done", progress=100, result=results)
            await db.update_job(job_id, status="done", progress=100,
                                result_count=len(results), completed=True)
        except Exception as e:  # noqa: BLE001
            log.exception("cash_buyers job %s failed", job_id)
            _set_status(job_id, "failed", error=str(e))
            await db.update_job(job_id, status="failed", error=str(e), completed=True)

    asyncio.create_task(runner())
    return {"job_id": job_id, "status": "queued", "lead_id": req.lead_id}


@app.post("/scrape/distressed")
async def scrape_distressed(req: DistressedRequest) -> Dict[str, Any]:
    if not (req.zip or req.county_key or req.state):
        raise HTTPException(status_code=400, detail="Provide zip, county_key, or state")

    job_id = _new_job("distressed", req.model_dump())
    await db.create_job(job_id, "distressed", req.model_dump(), campaign_id=req.campaign_id)

    async def runner() -> None:
        try:
            cb = await _make_progress_cb(job_id)
            listings = await distressed.find_distressed(
                zip_code=req.zip, county_key=req.county_key, state=req.state,
                categories=req.categories, source_keys=req.source_keys,
                job_id=job_id, campaign_id=req.campaign_id,
                progress_cb=cb,
            )
            _set_status(job_id, "done", progress=100, result=listings)
            await db.update_job(job_id, status="done", progress=100,
                                result_count=len(listings), completed=True)
        except Exception as e:  # noqa: BLE001
            log.exception("distressed job %s failed", job_id)
            _set_status(job_id, "failed", error=str(e))
            await db.update_job(job_id, status="failed", error=str(e), completed=True)

    asyncio.create_task(runner())
    return {"job_id": job_id, "status": "queued"}


@app.post("/scrape/skip-trace")
async def scrape_skip_trace(req: SkipTraceRequest) -> Dict[str, Any]:
    """Synchronous — small + fast."""
    try:
        return await skip_trace.trace(
            req.name, llc=req.llc, address=req.address, state=req.state,
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/jobs/{job_id}")
async def get_job(job_id: str) -> Dict[str, Any]:
    # Prefer in-memory state (full results), fall back to DB
    if job_id in _jobs:
        return _jobs[job_id]
    row = await db.get_job(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return row


@app.get("/leads/{lead_id}/buyers")
async def list_buyers(lead_id: int, limit: int = 100) -> Dict[str, Any]:
    rows = await db.list_cash_buyers_for_lead(lead_id, limit=limit)
    return {"lead_id": lead_id, "count": len(rows), "buyers": rows}


@app.get("/distressed/{job_id}/listings")
async def list_distressed(job_id: str, limit: int = 500) -> Dict[str, Any]:
    rows = await db.list_distressed_for_job(job_id, limit=limit)
    return {"job_id": job_id, "count": len(rows), "listings": rows}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "workers.main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8765")),
        log_level=settings.log_level,
    )
