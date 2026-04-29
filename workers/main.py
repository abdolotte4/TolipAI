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

from . import db, cash_buyers, distressed, skip_trace
from .config import settings
from .scrapers import county

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
    log.info("Engine ready on port %s (LLM=%s, proxies=%s)",
             os.getenv("PORT", str(settings.port)),
             settings.has_llm(), bool(settings.proxy_url()))
    yield
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
    pool = await db.init_pool()
    return {
        "status": "ok",
        "version": "0.1.0",
        "db": bool(pool),
        "llm": settings.has_llm(),
        "scraperapi_keys": len(settings.scraperapi_keys),
        "scrapingbee_keys": len(settings.scrapingbee_keys),
        "residential_proxy": bool(settings.proxy_url()),
        "supported_counties": county.list_supported_counties(),
        "categories": distressed.list_categories(),
        "source_count": len(distressed.list_sources()),
    }


@app.get("/sources")
async def list_sources(state: Optional[str] = None) -> Dict[str, Any]:
    """All free public-record distressed sources, optionally filtered by state."""
    sources = distressed.list_sources(state=state)
    cats = distressed.list_categories()
    return {"categories": cats, "sources": sources, "count": len(sources)}


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
