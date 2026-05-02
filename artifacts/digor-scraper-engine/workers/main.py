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
import re
import uuid
from typing import Any, Dict, List, Optional


def _patch_ld_library_path() -> None:
    """Dynamically resolve Nix-store paths for Playwright system libs.

    On Railway (nixpacks / Ubuntu) the libs are already on the standard path —
    this is a no-op there.  On Replit (NixOS) the Nix store hashes change with
    every package bump, so we find them at runtime instead of hardcoding hashes.
    """
    nix = "/nix/store"
    if not os.path.isdir(nix):
        return
    needed = {
        "libX11.so.6":        r"libX11-1\.",
        "libXcomposite.so.1": r"libXcomposite-",
        "libXdamage.so.1":    r"libx?Xdamage-",
        "libXext.so.6":       r"libXext-",
        "libXfixes.so.3":     r"libXfixes-",
        "libXrandr.so.2":     r"libXrandr-|libxrandr-",
        "libxcb.so.1":        r"libxcb-1\.",
        "libgbm.so.1":        r"mesa-libgbm-|mesa-[0-9]",
        "libexpat.so.1":      r"expat-2\.",
        "libudev.so.1":       r"eudev-|libudev-zero-",
    }
    skip = {"-dev", "-man", "-doc", "-debug", "-spirv", "-opencl",
            "-osmesa", "-opengl", "-driversdev"}
    dirs: set[str] = set()
    try:
        entries = os.listdir(nix)
    except OSError:
        return
    for soname, pattern in needed.items():
        for entry in entries:
            if re.search(pattern, entry) and not entry.endswith(".drv") and not any(
                s in entry for s in skip
            ):
                lib_dir = f"{nix}/{entry}/lib"
                if os.path.isdir(lib_dir) and os.path.exists(f"{lib_dir}/{soname}"):
                    dirs.add(lib_dir)
                    break
    if dirs:
        extra = ":".join(sorted(dirs))
        existing = os.environ.get("LD_LIBRARY_PATH", "")
        os.environ["LD_LIBRARY_PATH"] = f"{extra}:{existing}" if existing else extra


_patch_ld_library_path()

from fastapi import FastAPI, HTTPException
from contextlib import asynccontextmanager
from pydantic import BaseModel, Field

from . import db, cash_buyers, distressed, skip_trace, ai_research
from . import http_client
from .config import settings
from .retry_queue import retry_queue, is_transient
from .scrapers import county, propelio, propelio_v2, propwire
from .scrapers import satellite_dfd

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

    # Register retry runners (see _run_* functions below).
    retry_queue.register("cash_buyers",          _run_cash_buyers)
    retry_queue.register("distressed",           _run_distressed)
    retry_queue.register("propelio_cash_buyers", _run_propelio_cash_buyers)
    retry_queue.register("propwire_cash_buyers", _run_propwire_cash_buyers)

    retry_queue.start(
        on_success=_on_retry_success,
        on_exhaust=_on_retry_exhausted,
    )

    log.info("Engine ready on port %s (LLM=%s, proxies=%s)",
             os.getenv("PORT", str(settings.port)),
             settings.has_llm(), bool(settings.proxy_url()))
    yield
    retry_queue.stop()
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
    lead_id: Optional[int] = Field(None, description="ID of crm_leads row (omit for ad-hoc / test calls)")
    address: Optional[str] = Field(None, description="Full address (used when lead_id is absent)")
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


# ─── Retry-queue standalone runners ─────────────────────────────────────────
# Each runner receives (job_id, params) and runs the full job logic again.
# They are called by the retry queue after the backoff period expires.

async def _run_cash_buyers(job_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    lead = await db.get_lead(params["lead_id"])
    if not lead:
        raise RuntimeError(f"Lead {params['lead_id']} not found — cannot retry")
    _jobs.setdefault(job_id, {"id": job_id, "type": "cash_buyers",
                               "status": "retrying", "progress": 0,
                               "params": params, "result": None, "error": None})
    _set_status(job_id, "retrying")
    await db.update_job(job_id, status="running", progress=0)
    cb = await _make_progress_cb(job_id)
    results = await cash_buyers.find_cash_buyers(
        lead, max_buyers=params.get("max_buyers", 25),
        job_id=job_id, progress_cb=cb,
    )
    _set_status(job_id, "done", progress=100, result=results)
    await db.update_job(job_id, status="done", progress=100,
                        result_count=len(results), completed=True)
    return {"count": len(results)}


async def _run_distressed(job_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    _jobs.setdefault(job_id, {"id": job_id, "type": "distressed",
                               "status": "retrying", "progress": 0,
                               "params": params, "result": None, "error": None})
    _set_status(job_id, "retrying")
    await db.update_job(job_id, status="running", progress=0)
    cb = await _make_progress_cb(job_id)
    listings = await distressed.find_distressed(
        zip_code=params.get("zip", ""),
        county_key=params.get("county_key", ""),
        state=params.get("state", ""),
        categories=params.get("categories"),
        source_keys=params.get("source_keys"),
        job_id=job_id,
        campaign_id=params.get("campaign_id"),
        progress_cb=cb,
    )
    _set_status(job_id, "done", progress=100, result=listings)
    await db.update_job(job_id, status="done", progress=100,
                        result_count=len(listings), completed=True)
    return {"count": len(listings)}


async def _run_propelio_cash_buyers(job_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    _jobs.setdefault(job_id, {"id": job_id, "type": "propelio_cash_buyers",
                               "status": "retrying", "progress": 0,
                               "params": params, "result": None, "error": None})
    _set_status(job_id, "retrying")
    await db.update_job(job_id, status="running", progress=0)
    cb = await _make_progress_cb(job_id)
    result = await propelio_v2.cash_buyers_for_address(
        params["address"],
        distance_miles=params.get("distance_miles", 10),
        active_within=params.get("active_within", "ANY_TIME"),
        min_properties=params.get("min_properties", 3),
        landlords=params.get("landlords", True),
        flippers=params.get("flippers", True),
        max_results=params.get("max_results", 500),
        progress_cb=cb,
    )
    buyers = result.get("buyers") or []
    if params.get("persist") and params.get("lead_id"):
        for b in buyers:
            try:
                await db.insert_cash_buyer(params["lead_id"], job_id, b)
            except Exception as e:
                log.debug("persist buyer failed on retry: %s", e)
    _set_status(job_id, "done", progress=100, result=result)
    await db.update_job(job_id, status="done", progress=100,
                        result_count=len(buyers), completed=True)
    return {"count": len(buyers)}


async def _run_propwire_cash_buyers(job_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    _jobs.setdefault(job_id, {"id": job_id, "type": "propwire_cash_buyers",
                               "status": "retrying", "progress": 0,
                               "params": params, "result": None, "error": None})
    _set_status(job_id, "retrying")
    await db.update_job(job_id, status="running", progress=0)
    cb = await _make_progress_cb(job_id)
    buyers = await propwire.fetch_cash_buyers_nearby(
        params["query"],
        radius_miles=params.get("radius_miles", 1.0),
        min_properties=params.get("min_properties", 3),
        max_results=params.get("max_results", 200),
        progress_cb=cb,
    )
    if params.get("persist") and params.get("lead_id"):
        for b in buyers:
            try:
                await db.insert_cash_buyer(params["lead_id"], job_id, b)
            except Exception as e:
                log.debug("persist buyer failed on retry: %s", e)
    result = {"count": len(buyers), "buyers": buyers}
    _set_status(job_id, "done", progress=100, result=result)
    await db.update_job(job_id, status="done", progress=100,
                        result_count=len(buyers), completed=True)
    return {"count": len(buyers)}


# ─── Retry-queue DB callbacks ────────────────────────────────────────────────

async def _on_retry_success(job_id: str, result: Any) -> None:
    """Called by the retry queue when a retry succeeds."""
    log.info("Job %s recovered via retry → result: %s", job_id, str(result)[:60])


async def _on_retry_exhausted(job_id: str, error: str) -> None:
    """Called when all retry attempts are exhausted — mark job as permanently failed."""
    log.error("Job %s permanently failed after %d retries: %s",
              job_id, 3, error[:120])
    _set_status(job_id, "failed", error=f"exhausted_retries: {error}")
    await db.update_job(job_id, status="failed",
                        error=f"exhausted_retries: {error[:200]}", completed=True)


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> Dict[str, Any]:
    """Deep health-check: probes DB, each LLM provider, and each scraper tier."""
    import time
    from .llm import _dead_providers, _rate_hits, _MAX_RATE_HITS
    from .skip_trace import _dead_sources

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
            resp = await asyncio.wait_for(
                client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": "reply with the single word OK"}],
                    max_tokens=5,
                    temperature=0,
                ),
                timeout=8.0,
            )
            latency_ms = int((time.monotonic() - t0) * 1000)
            content = (resp.choices[0].message.content or "").strip()
            return {"status": "ok", "latency_ms": latency_ms, "response": content[:20]}
        except asyncio.TimeoutError:
            latency_ms = int((time.monotonic() - t0) * 1000)
            return {"status": "timeout", "latency_ms": latency_ms, "error": "probe timed out (>8s)"}
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

    from .llm import _groq, _cerebras, _nvidia, _openrouter, _moonshot

    (llm_groq, llm_cerebras, llm_nvidia, llm_openrouter, llm_moon,
     db_result) = await asyncio.gather(
        _probe_llm("groq",       _groq,       settings.groq_model),
        _probe_llm("cerebras",   _cerebras,   settings.cerebras_model),
        _probe_llm("nvidia",     _nvidia,     settings.nvidia_model),
        _probe_llm("openrouter", _openrouter, settings.openrouter_model),
        _probe_llm("moonshot",   _moonshot,   settings.moonshot_model),
        _probe_db(),
    )
    sapi = {"status": "disabled", "reason": "permanently_removed_use_crawl4ai"}
    sbee = {"status": "disabled", "reason": "permanently_removed_use_crawl4ai"}

    llm_results = (llm_groq, llm_cerebras, llm_nvidia, llm_openrouter, llm_moon)
    llm_ok = any(r["status"] == "ok" for r in llm_results)
    db_ok  = db_result.get("status") == "ok"
    overall = "ok" if (llm_ok and db_ok) else ("degraded" if (llm_ok or db_ok) else "down")

    return {
        "status": overall,
        "version": "0.1.0",
        "llm": {
            "groq":       llm_groq,
            "cerebras":   llm_cerebras,
            "nvidia":     llm_nvidia,
            "openrouter": llm_openrouter,
            "moonshot":   llm_moon,
            "any_ok":     llm_ok,
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


@app.get("/health/keys")
async def health_keys() -> Dict[str, Any]:
    """Per-key status for all scraping providers — shows active vs exhausted keys."""
    return {
        "scraperapi": {
            "status": "disabled",
            "reason": "permanently_removed_use_crawl4ai",
            "keys_total": 0,
            "keys_active": 0,
        },
        "scrapingbee": {
            "status": "disabled",
            "reason": "permanently_removed_use_crawl4ai",
            "keys_total": 0,
            "keys_active": 0,
        },
        "llm": {
            "groq_configured": bool(settings.groq_api_key),
            "cerebras_configured": bool(settings.cerebras_api_key),
            "together_configured": bool(settings.together_api_key),
            "nvidia_configured": bool(settings.nvidia_api_key),
            "openrouter_configured": bool(settings.openrouter_api_key),
            "moonshot_configured": bool(settings.moonshot_api_key),
        },
        "proxy": {
            "brightdata_configured": bool(settings.proxy_host and settings.proxy_user and settings.proxy_pass),
            "proxy_host": settings.proxy_host or None,
        },
        "attom": {
            "keys_total": len(settings.attom_keys) + len(settings.property_api_keys),
            "attom_keys": len(settings.attom_keys),
            "property_api_keys": len(settings.property_api_keys),
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
            err = str(e)
            if is_transient(e) and retry_queue.enqueue(job_id, "propelio_cash_buyers",
                                                        req.model_dump(), last_error=err):
                log.warning("propelio_cash_buyers job %s failed (transient) — queued for retry: %s", job_id, err[:80])
                _set_status(job_id, "retry_pending", error=err)
                await db.update_job(job_id, status="retry_pending", error=err)
            else:
                log.exception("propelio cash-buyers job %s failed (fatal)", job_id)
                _set_status(job_id, "failed", error=err)
                await db.update_job(job_id, status="failed", error=err, completed=True)

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


@app.post("/scrape/propwire/tax")
async def scrape_propwire_tax(req: PropwireQueryRequest) -> Dict[str, Any]:
    """Scrape tax assessment + tax history from the Propwire Property tab."""
    return await propwire.fetch_tax(req.query)


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
            err = str(e)
            if is_transient(e) and retry_queue.enqueue(job_id, "propwire_cash_buyers",
                                                        req.model_dump(), last_error=err):
                log.warning("propwire_cash_buyers job %s failed (transient) — queued for retry: %s", job_id, err[:80])
                _set_status(job_id, "retry_pending", error=err)
                await db.update_job(job_id, status="retry_pending", error=err)
            else:
                log.exception("propwire cash-buyers job %s failed (fatal)", job_id)
                _set_status(job_id, "failed", error=err)
                await db.update_job(job_id, status="failed", error=err, completed=True)

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
    if req.lead_id is not None:
        lead = await db.get_lead(req.lead_id)
        if not lead:
            raise HTTPException(status_code=404, detail=f"Lead {req.lead_id} not found")
    else:
        if not req.address:
            raise HTTPException(status_code=422, detail="Provide either lead_id or address")
        lead = {"id": None, "address": req.address, "city": "", "state": "", "zip": "",
                "beds": None, "baths": None, "sqft": None, "year_built": None,
                "owner_name": None, "owner_llc": None}

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
            err = str(e)
            if is_transient(e) and retry_queue.enqueue(job_id, "cash_buyers",
                                                        req.model_dump(), last_error=err):
                log.warning("cash_buyers job %s failed (transient) — queued for retry: %s", job_id, err[:80])
                _set_status(job_id, "retry_pending", error=err)
                await db.update_job(job_id, status="retry_pending", error=err)
            else:
                log.exception("cash_buyers job %s failed (fatal)", job_id)
                _set_status(job_id, "failed", error=err)
                await db.update_job(job_id, status="failed", error=err, completed=True)

    asyncio.create_task(runner())
    return {"job_id": job_id, "status": "queued", "lead_id": req.lead_id}


# ─── Satellite Drive-For-Dollars ─────────────────────────────────────────────

class SatelliteDFDRequest(BaseModel):
    zip: str = ""
    city: str = ""
    state: str = ""
    min_score: int = Field(30, ge=0, le=100,
        description="Minimum distress score 0-100 to include in results")
    max_results: int = Field(50, ge=1, le=200)
    use_ai_scoring: bool = True


@app.post("/ai/satellite-dfd")
async def satellite_dfd_scan(req: SatelliteDFDRequest) -> Dict[str, Any]:
    """SkyDrive-style AI distress scan for an area.

    Returns properties ranked by distress score (0-100) with coordinates,
    reasoning, and optional satellite imagery URL (when GOOGLE_MAPS_API_KEY set).
    """
    if not (req.zip or (req.city and req.state)):
        raise HTTPException(status_code=400, detail="Provide zip or city+state")
    try:
        return await satellite_dfd.scan_area(
            zip_code=req.zip,
            city=req.city,
            state=req.state,
            min_score=req.min_score,
            max_results=req.max_results,
            use_ai_scoring=req.use_ai_scoring,
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))


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
            err = str(e)
            if is_transient(e) and retry_queue.enqueue(job_id, "distressed",
                                                        req.model_dump(), last_error=err):
                log.warning("distressed job %s failed (transient) — queued for retry: %s", job_id, err[:80])
                _set_status(job_id, "retry_pending", error=err)
                await db.update_job(job_id, status="retry_pending", error=err)
            else:
                log.exception("distressed job %s failed (fatal)", job_id)
                _set_status(job_id, "failed", error=err)
                await db.update_job(job_id, status="failed", error=err, completed=True)

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


@app.get("/jobs/retries")
async def list_retries_early() -> Dict[str, Any]:
    """Return the current in-memory retry queue (survives only while the process is up)."""
    pending = retry_queue.pending()
    return {
        "queue_size": retry_queue.size(),
        "poll_interval_seconds": 30,
        "max_attempts": 3,
        "backoff_seconds": [60, 300, 900],
        "pending": pending,
    }


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


@app.post("/jobs/{job_id}/retry")
async def manual_retry(job_id: str) -> Dict[str, Any]:
    """Force-enqueue a job for immediate retry regardless of its current status.

    Useful after fixing a config issue (e.g. adding a new API key) when you
    want to retry a permanently-failed job without waiting for the backoff.
    """
    row = _jobs.get(job_id) or await db.get_job(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    job_type = row.get("type") or row.get("job_type")
    params   = row.get("params") or {}
    if isinstance(params, str):
        import json as _json
        try:
            params = _json.loads(params)
        except Exception:
            params = {}
    if job_type not in ("cash_buyers", "distressed",
                        "propelio_cash_buyers", "propwire_cash_buyers"):
        raise HTTPException(status_code=400,
                            detail=f"Manual retry not supported for job_type={job_type}")
    retry_queue.enqueue(job_id, job_type, params, attempt=0,
                        last_error="manual_retry_requested")
    _set_status(job_id, "retry_pending")
    await db.update_job(job_id, status="retry_pending",
                        error="manual_retry_requested")
    return {"job_id": job_id, "status": "retry_pending",
            "message": "Job re-queued — will execute within 30 seconds"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "workers.main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8765")),
        log_level=settings.log_level,
    )
