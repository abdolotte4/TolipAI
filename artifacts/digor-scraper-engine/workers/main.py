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
from . import osint_skip_trace
from .scrapers import homeharvest_scraper
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

# ─── Structured Metrics ──────────────────────────────────────────────────────
METRICS = {
    "cash_buyers_success": 0,
    "cash_buyers_failed": 0,
    "cash_buyers_timeout": 0,
    "distressed_success": 0,
    "distressed_failed": 0,
    "distressed_timeout": 0,
    "foreclosure_success": 0,
    "foreclosure_failed": 0,
    "foreclosure_timeout": 0,
}

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

    log.info(
        "Engine ready on port %s (LLM=%s, proxies_configured=%s)",
        os.getenv("PORT", str(settings.port)),
        settings.has_llm(),
        bool(settings.proxy_url()),
    )
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
    max_buyers: int = 50
    campaign_id: Optional[int] = None


class DistressedRequest(BaseModel):
    zip: str = ""
    county_key: str = ""
    state: str = ""
    categories: List[str] = Field(
        default_factory=list,
        description="Subset of: county_clerk, public_trustee, probate_court, "
                    "tax_assessor, government_reo, auction_aggregator. Empty = all categories."
    )
    source_keys: List[str] = Field(
        default_factory=list,
        description="Pin to specific sources by key (overrides categories)."
    )
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
        "id": jid,
        "type": job_type,
        "status": "queued",
        "progress": 0,
        "params": params,
        "result": None,
        "error": None,
    }
    return jid


async def _make_progress_cb(job_id: str):
    async def cb(pct: int, message: str = "") -> None:
        if job_id in _jobs:
            _jobs[job_id]["progress"] = pct
            _jobs[job_id]["message"] = message
        try:
            await db.update_job(job_id, progress=pct, status="running")
        except Exception as e:
            # Prevent noisy stack traces in logs
            log.warning("Progress update failed for job %s: %s", job_id, str(e)[:120])
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
    try:
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
    except Exception as e:
        log.error("cash_buyers job %s failed: %s", job_id, str(e)[:120])
        _set_status(job_id, "failed", error=str(e))
        await db.update_job(job_id, status="failed", error=str(e), completed=True)
        return {"count": 0}


async def _run_distressed(job_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    try:
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
    except Exception as e:
        log.error("distressed job %s failed: %s", job_id, str(e)[:120])
        _set_status(job_id, "failed", error=str(e))
        await db.update_job(job_id, status="failed", error=str(e), completed=True)
        return {"count": 0}


async def _run_propelio_cash_buyers(job_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    try:
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
                    log.debug("persist buyer failed on retry: %s", str(e)[:120])
        _set_status(job_id, "done", progress=100, result=result)
        await db.update_job(job_id, status="done", progress=100,
                            result_count=len(buyers), completed=True)
        return {"count": len(buyers)}
    except Exception as e:
        log.error("propelio_cash_buyers job %s failed: %s", job_id, str(e)[:120])
        _set_status(job_id, "failed", error=str(e))
        await db.update_job(job_id, status="failed", error=str(e), completed=True)
        return {"count": 0}


async def _run_propwire_cash_buyers(job_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    try:
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
                    log.debug("persist buyer failed on retry: %s", str(e)[:120])
        result = {"count": len(buyers), "buyers": buyers}
        _set_status(job_id, "done", progress=100, result=result)
        await db.update_job(job_id, status="done", progress=100,
                            result_count=len(buyers), completed=True)
        return {"count": len(buyers)}
    except Exception as e:
        log.error("propwire_cash_buyers job %s failed: %s", job_id, str(e)[:120])
        _set_status(job_id, "failed", error=str(e))
        await db.update_job(job_id, status="failed", error=str(e), completed=True)
        return {"count": 0}


# ─── Retry-queue DB callbacks ────────────────────────────────────────────────

async def _on_retry_success(job_id: str, result: Any) -> None:
    """Called by the retry queue when a retry succeeds."""
    try:
        log.info("Job %s recovered via retry → result: %s", job_id, str(result)[:60])
        _set_status(job_id, "done", result=result, progress=100)
        await db.update_job(job_id, status="done", progress=100, completed=True)
    except Exception as e:
        log.error("Failed to mark job %s as success: %s", job_id, str(e)[:120])
        _set_status(job_id, "failed", error=str(e))
        await db.update_job(job_id, status="failed", error=str(e), completed=True)


async def _on_retry_exhausted(job_id: str, error: str) -> None:
    """Called when all retry attempts are exhausted — mark job as permanently failed."""
    try:
        max_attempts = getattr(settings, "max_retry_attempts", 3)
        log.error("Job %s permanently failed after %d retries: %s",
                  job_id, max_attempts, error[:120])
        _set_status(job_id, "failed", error=f"exhausted_retries: {error}")
        await db.update_job(job_id, status="failed",
                            error=f"exhausted_retries: {error[:200]}", completed=True)
    except Exception as e:
        log.error("Failed to mark job %s as exhausted: %s", job_id, str(e)[:120])
        _set_status(job_id, "failed", error=str(e))
        await db.update_job(job_id, status="failed", error=str(e), completed=True)


# ─── Routes ──────────────────────────────────────────────────────────────────

# ─── Session management endpoints ────────────────────────────────────────────

from .scrapers._browser_session import invalidate_session as _invalidate_session, _state_path

class SessionTestRequest(BaseModel):
    email: str
    password: str


@app.get("/session/{service}/status")
async def session_status(service: str) -> Dict[str, Any]:
    """Return whether a cached browser session exists for a service."""
    if service not in ("propelio", "propwire"):
        raise HTTPException(status_code=400, detail="Unknown service")
    try:
        p = _state_path(service)
        active = p.exists()
        size = p.stat().st_size if active else 0
        return {"service": service, "active": active, "state_file_bytes": size}
    except Exception as e:
        log.error("Session status check failed for %s: %s", service, str(e)[:120])
        raise HTTPException(status_code=500, detail="Session status check failed")


@app.delete("/session/{service}")
async def invalidate_service_session(service: str) -> Dict[str, Any]:
    """Delete the cached session so the next job re-authenticates."""
    if service not in ("propelio", "propwire"):
        raise HTTPException(status_code=400, detail="Unknown service")
    try:
        await _invalidate_session(service)
        return {"service": service, "invalidated": True}
    except Exception as e:
        log.error("Failed to invalidate session for %s: %s", service, str(e)[:120])
        raise HTTPException(status_code=500, detail="Failed to invalidate session")




   # ─── Session login tests ─────────────────────────────────────────────────────

@app.post("/session/propelio/test")
async def test_propelio_login(req: SessionTestRequest) -> Dict[str, Any]:
    """Test Propelio credentials by attempting a real login; returns success/error."""
    try:
        # Pass credentials directly instead of mutating env vars
        await propelio_v2.search_property(
            "123 Main St, Dallas, TX 75201",
            email=req.email,
            password=req.password,
        )
        return {"success": True, "detail": "Login OK"}
    except Exception as e:
        log.warning("Propelio login test failed: %s", str(e)[:120])
        return {"success": False, "error": str(e)[:300]}


@app.post("/session/propwire/test")
async def test_propwire_login(req: SessionTestRequest) -> Dict[str, Any]:
    """Test Propwire credentials by attempting a real login; returns success/error."""
    try:
        await propwire.fetch_property(
            "123 Main St, Dallas, TX 75201",
            email=req.email,
            password=req.password,
        )
        return {"success": True, "detail": "Login OK"}
    except Exception as e:
        log.warning("Propwire login test failed: %s", str(e)[:120])
        return {"success": False, "error": str(e)[:300]}


@app.get("/metrics")
async def metrics() -> Dict[str, Any]:
    """Return structured counters for monitoring."""
    return METRICS


# ─── Health check ───────────────────────────────────────────────────────────

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
            return {"status": "error", "latency_ms": latency_ms, "error": str(e)[:120]}

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
            "keys_total": len(settings.scraperapi_keys),
            "keys_active": 0,
        },
        "scrapingbee": {
            "status": "disabled",
            "reason": "permanently_removed_use_crawl4ai",
            "keys_total": len(settings.scrapingbee_keys),
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
            "brightdata_configured": settings.brightdata_configured(),
            "proxy_host": "brd.superproxy.io",
            "proxy_port": 33335,
        },
        "attom": {
            "keys_total": len(settings.attom_keys) + len(settings.property_api_keys),
            "attom_keys": len(settings.attom_keys),
            "property_api_keys": len(settings.property_api_keys),
        },
    }

           # ─── Session login tests ─────────────────────────────────────────────────────

@app.post("/session/propelio/test")
async def test_propelio_login(req: SessionTestRequest) -> Dict[str, Any]:
    """Test Propelio credentials by attempting a real login; returns success/error."""
    import os as _os
    orig_email = _os.environ.get("PROPELIO_EMAIL")
    orig_pw    = _os.environ.get("PROPELIO_PASSWORD")
    _os.environ["PROPELIO_EMAIL"]    = req.email
    _os.environ["PROPELIO_PASSWORD"] = req.password
    await _invalidate_session("propelio")
    try:
        await propelio_v2.search_property("123 Main St, Dallas, TX 75201")
        return {"success": True, "detail": "Login OK"}
    except Exception as e:
        log.warning("Propelio login test failed: %s", str(e)[:120])
        return {"success": False, "error": str(e)[:300]}
    finally:
        if orig_email is not None:
            _os.environ["PROPELIO_EMAIL"] = orig_email
        else:
            _os.environ.pop("PROPELIO_EMAIL", None)
        if orig_pw is not None:
            _os.environ["PROPELIO_PASSWORD"] = orig_pw
        else:
            _os.environ.pop("PROPELIO_PASSWORD", None)


@app.post("/session/propwire/test")
async def test_propwire_login(req: SessionTestRequest) -> Dict[str, Any]:
    """Test Propwire credentials by attempting a real login; returns success/error."""
    import os as _os
    orig_email = _os.environ.get("PROPWIRE_EMAIL")
    orig_pw    = _os.environ.get("PROPWIRE_PASSWORD")
    _os.environ["PROPWIRE_EMAIL"]    = req.email
    _os.environ["PROPWIRE_PASSWORD"] = req.password
    await _invalidate_session("propwire")
    try:
        await propwire.fetch_property("123 Main St, Dallas, TX 75201")
        return {"success": True, "detail": "Login OK"}
    except Exception as e:
        log.warning("Propwire login test failed: %s", str(e)[:120])
        return {"success": False, "error": str(e)[:300]}
    finally:
        if orig_email is not None:
            _os.environ["PROPWIRE_EMAIL"] = orig_email
        else:
            _os.environ.pop("PROPWIRE_EMAIL", None)
        if orig_pw is not None:
            _os.environ["PROPWIRE_PASSWORD"] = orig_pw
        else:
            _os.environ.pop("PROPWIRE_PASSWORD", None)


# ─── Health check ───────────────────────────────────────────────────────────

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
            return {"status": "error", "latency_ms": latency_ms, "error": str(e)[:120]}

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
            "keys_total": len(settings.scraperapi_keys),
            "keys_active": 0,
        },
        "scrapingbee": {
            "status": "disabled",
            "reason": "permanently_removed_use_crawl4ai",
            "keys_total": len(settings.scrapingbee_keys),
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
            "brightdata_configured": settings.brightdata_configured(),
            "proxy_host": "brd.superproxy.io",
            "proxy_port": 33335,
        },
        "attom": {
            "keys_total": len(settings.attom_keys) + len(settings.property_api_keys),
            "attom_keys": len(settings.attom_keys),
            "property_api_keys": len(settings.property_api_keys),
        },
    }


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
            try:
                results = await asyncio.wait_for(
                    cash_buyers.find_cash_buyers(
                        lead, max_buyers=req.max_buyers, job_id=job_id, progress_cb=cb,
                    ),
                    timeout=900,  # 15 minute cap
                )
                _set_status(job_id, "done", progress=100, result=results)
                await db.update_job(
                    job_id,
                    status="done",
                    progress=100,
                    result_count=len(results),
                    completed=True,
                )
                METRICS["cash_buyers_success"] += 1

            except asyncio.TimeoutError:
                log.error("cash_buyers job %s timed out after 900s", job_id)
                _set_status(job_id, "failed", error="timeout_exceeded")
                await db.update_job(
                    job_id,
                    status="failed",
                    error="timeout_exceeded",
                    completed=True,
                )
                METRICS["cash_buyers_timeout"] += 1

        except Exception as e:  # noqa: BLE001
            err = str(e)
            if is_transient(e) and retry_queue.enqueue(
                job_id, "cash_buyers", req.model_dump(), last_error=err
            ):
                log.warning(
                    "cash_buyers job %s failed (transient) — queued for retry: %s",
                    job_id,
                    err[:80],
                )
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
    reasoning, and optional satellite + street view imagery URLs (when GOOGLE_MAPS_API_KEY set).
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Distressed scraping jobs ────────────────────────────────────────────────

@app.post("/scrape/distressed")
async def scrape_distressed(req: DistressedRequest) -> Dict[str, Any]:
    if not (req.zip or req.county_key or req.state):
        raise HTTPException(status_code=400, detail="Provide zip, county_key, or state")

    job_id = _new_job("distressed", req.model_dump())
    await db.create_job(job_id, "distressed", req.model_dump(), campaign_id=req.campaign_id)

    async def runner() -> None:
        try:
            cb = await _make_progress_cb(job_id)
            # Runtime cap: 15 minutes
            listings = await asyncio.wait_for(
                distressed.find_distressed(
                    zip_code=req.zip, county_key=req.county_key, state=req.state,
                    categories=req.categories, source_keys=req.source_keys,
                    job_id=job_id, campaign_id=req.campaign_id,
                    progress_cb=cb,
                ),
                timeout=900,
            )
            _set_status(job_id, "done", progress=100, result=listings)
            await db.update_job(job_id, status="done", progress=100,
                                result_count=len(listings), completed=True)
            METRICS["distressed_success"] += 1
        except asyncio.TimeoutError:
            log.error("Distressed job %s timed out after 900s", job_id)
            _set_status(job_id, "failed", error="timeout_exceeded")
            await db.update_job(job_id, status="failed", error="timeout_exceeded", completed=True)
            METRICS["distressed_timeout"] += 1
        except Exception as e:
            err = str(e)
            if is_transient(e) and retry_queue.enqueue(job_id, "distressed",
                                                        req.model_dump(), last_error=err):
                log.warning("Distressed job %s transient failure — queued for retry: %s", job_id, err[:80])
                _set_status(job_id, "retry_pending", error=err)
                await db.update_job(job_id, status="retry_pending", error=err)
            else:
                log.exception("Distressed job %s failed (fatal)", job_id)
                _set_status(job_id, "failed", error=err)
                await db.update_job(job_id, status="failed", error=err, completed=True)
                METRICS["distressed_failed"] += 1

    asyncio.create_task(runner())
    return {"job_id": job_id, "status": "queued"}



# ─── Skip-trace ──────────────────────────────────────────────────────────────

@app.post("/scrape/skip-trace")
async def scrape_skip_trace(req: SkipTraceRequest) -> Dict[str, Any]:
    """Synchronous skip-trace — small + fast."""
    try:
        return await skip_trace.trace(
            req.name, llc=req.llc, address=req.address, state=req.state,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Jobs + retries ─────────────────────────────────────────────────────────

@app.get("/jobs/retries")
async def list_retries_early() -> Dict[str, Any]:
    """Return the current in-memory retry queue (survives only while the process is up)."""
    return {
        "queue_size": retry_queue.size(),
        "poll_interval_seconds": 30,
        "max_attempts": 3,
        "backoff_seconds": [60, 300, 900],
        "pending": retry_queue.pending(),
    }

@app.get("/jobs/{job_id}")
async def get_job(job_id: str) -> Dict[str, Any]:
    """Return job details, preferring in-memory state over DB."""
    if job_id in _jobs:
        return _jobs[job_id]
    row = await db.get_job(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return row

@app.post("/jobs/{job_id}/retry")
async def manual_retry(job_id: str) -> Dict[str, Any]:
    """Force-enqueue a job for immediate retry regardless of its current status."""
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


# ─── Buyers + distressed listings ────────────────────────────────────────────

@app.get("/leads/{lead_id}/buyers")
async def list_buyers(lead_id: int, limit: int = 100) -> Dict[str, Any]:
    rows = await db.list_cash_buyers_for_lead(lead_id, limit=limit)
    return {"lead_id": lead_id, "count": len(rows), "buyers": rows}

@app.get("/distressed/{job_id}/listings")
async def list_distressed(job_id: str, limit: int = 500) -> Dict[str, Any]:
    rows = await db.list_distressed_for_job(job_id, limit=limit)
    return {"job_id": job_id, "count": len(rows), "listings": rows}


# ─── Chained Foreclosure Lead-Gen workflow ───────────────────────────────────

class ForeclosureLeadGenRequest(BaseModel):
    city: str   = Field(..., description="Target city, e.g. 'Orlando'")
    state: str  = Field(..., description="Two-letter state code, e.g. 'FL'")
    listing_type: str = Field("for_sale", description="'for_sale' | 'sold' | 'pending'")
    site: str   = Field("zillow", description="'zillow' | 'realtor.com' | 'redfin' | 'all'")
    limit: int  = Field(5, ge=1, le=20)
    do_skip_trace: bool = Field(True, description="Run free OSINT skip trace per property")
    do_dnc_check: bool  = Field(True, description="Run Twilio Lookup for DNC/carrier flags")
    save_to_crm: bool   = Field(False, description="Persist results to cash_buyer_matches table")
    campaign_id: Optional[int] = None


async def _run_foreclosure_lead_gen(job_id: str, params: Dict[str, Any]) -> None:
    """Full chained pipeline: scrape → equity → skip-trace → DNC → report → (optional) CRM sync."""
    cb = await _make_progress_cb(job_id)

    city, state = params["city"], params["state"]
    listing_type = params.get("listing_type", "for_sale")
    site = params.get("site", "zillow")
    limit = int(params.get("limit", 5))
    do_skip_trace = params.get("do_skip_trace", True)
    do_dnc_check = params.get("do_dnc_check", True)
    save_to_crm = params.get("save_to_crm", False)
    campaign_id = params.get("campaign_id")

    try:
        # Step 1: Scrape listings with runtime cap
        await cb(5, f"Scraping {listing_type} listings in {city}, {state}…")
        if site == "all":
            listings = await asyncio.wait_for(
                homeharvest_scraper.scrape_multi_site(
                    city, state, listing_type=listing_type, limit_per_site=limit
                ),
                timeout=900,
            )
        else:
            listings = await asyncio.wait_for(
                homeharvest_scraper.scrape_foreclosures(
                    city, state, listing_type=listing_type, site=site, limit=limit
                ),
                timeout=900,
            )

        if not listings:
            summary = {"count": 0, "listings": [], "markdown_table": "_No listings found._"}
            _set_status(job_id, "done", progress=100, result=summary)
            await db.update_job(job_id, status="done", progress=100, result_count=0, completed=True)
            METRICS["foreclosure_success"] += 1
            return

        await cb(25, f"Found {len(listings)} listings — estimating equity…")

        # Step 2: Estimate equity
        enriched = []
        for l in listings[:limit]:
            est_value = l.get("estimated_value") or l.get("list_price") or 0
            estimated_equity = round(float(est_value) * 0.80) if est_value else None
            enriched.append({**l, "estimated_equity": estimated_equity})

        # Step 3: Skip-trace + DNC
        results = []
        skip_step = 50 // max(len(enriched), 1)
        for i, prop in enumerate(enriched):
            pct = 30 + i * skip_step
            street = prop.get("street") or prop.get("address", "").split(",")[0]
            await cb(pct, f"Skip-tracing {street}… ({i+1}/{len(enriched)})")

            if do_skip_trace and street:
                try:
                    trace = await osint_skip_trace.trace_by_address(
                        street, prop.get("city", city), prop.get("state", state),
                        owner_name=prop.get("owner_name"), do_dnc_check=do_dnc_check,
                    )
                    prop = {**prop, **trace}
                except Exception as e:
                    log.warning("Skip-trace failed for %s: %s", street, e)
                    prop = {**prop, "phones": [], "emails": [], "verified_mobile_count": 0, "verified_email_count": 0}
            else:
                prop = {**prop, "phones": [], "emails": [], "verified_mobile_count": 0, "verified_email_count": 0}

            results.append(prop)

        await cb(85, "Generating report…")
        markdown_table = osint_skip_trace.format_markdown_table(results)

        # Step 4: Optional CRM sync
        saved_count = 0
        if save_to_crm and results:
            await cb(90, "Syncing to CRM Cash Buyers tab…")
            import json as _json
            for r in results:
                try:
                    phones = r.get("phones") or []
                    emails = r.get("emails") or []
                    await db.pool.execute(
                        """INSERT INTO cash_buyer_matches
                           (lead_id, job_id, buyer_name, buyer_type, match_score, match_reasons,
                            city, state, zip, mailing_address, phones, emails, principals,
                            classification_reason, source, raw_data)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)""",
                        None, job_id,
                        r.get("owner_name") or "Unknown Owner",
                        "pre_foreclosure",
                        50,
                        _json.dumps(["homeharvest_scrape", "osint_skip_trace"]),
                        r.get("city", city), r.get("state", state), r.get("zip"),
                        r.get("address"),
                        _json.dumps([p["number"] for p in phones]),
                        _json.dumps([e["email"] for e in emails]),
                        _json.dumps(r.get("resident_names") or []),
                        f"Pre-foreclosure listing in {city}, {state} via HomeHarvest",
                        "homeharvest",
                        _json.dumps({
                            "list_price": r.get("list_price"),
                            "estimated_equity": r.get("estimated_equity"),
                            "beds": r.get("beds"), "baths": r.get("baths"),
                            "sqft": r.get("sqft"), "year_built": r.get("year_built"),
                            "listing_url": r.get("listing_url"),
                            "days_on_mls": r.get("days_on_mls"),
                        }),
                    )
                    saved_count += 1
                except Exception as e:
                    log.warning("CRM save failed for %s: %s", r.get("address"), e)

        await cb(100, "Done")
        summary = {"count": len(results), "saved_to_crm": saved_count, "listings": results,
                   "markdown_table": markdown_table, "city": city, "state": state}
        _set_status(job_id, "done", progress=100, result=summary)
        await db.update_job(job_id, status="done", progress=100, result_count=len(results), completed=True)
        METRICS["foreclosure_success"] += 1

    except asyncio.TimeoutError:
        log.error("Foreclosure job %s timed out after 900s", job_id)
        _set_status(job_id, "failed", error="timeout_exceeded")
        await db.update_job(job_id, status="failed", error="timeout_exceeded", completed=True)
        METRICS["foreclosure_timeout"] += 1
    except Exception as e:
        log.exception("Foreclosure lead-gen job %s failed: %s", job_id, e)
        _set_status(job_id, "failed", error=str(e))
        await db.update_job(job_id, status="failed", error=str(e), completed=True)
        METRICS["foreclosure_failed"] += 1
