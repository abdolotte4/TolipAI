"""TolipAI Scraper Engine — FastAPI entrypoint.

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
from . import job_store
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

# Job state — aliased to job_store._memory so sync helpers (_set_status,
# _new_job) work unchanged while async paths also persist to Redis.
_jobs: Dict[str, Dict[str, Any]] = job_store._memory

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
    await job_store.init()

    # Mark any jobs that were mid-flight when the container last OOM-crashed.
    recovered = await job_store.recover_interrupted_jobs()
    if recovered:
        log.warning("Startup: reset %d interrupted job(s) from previous run", recovered)

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
        "Engine ready on port %s (LLM=%s, proxies_configured=%s, redis=%s)",
        os.getenv("PORT", str(settings.port)),
        settings.has_llm(),
        bool(settings.proxy_url()),
        job_store._redis is not None,
    )
    yield
    retry_queue.stop()
    await job_store.close()
    await http_client.close_client()
    await db.close_pool()


app = FastAPI(
    title="TolipAI Scraper Engine",
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
    city: str = ""
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


class GoogleMapsRequest(BaseModel):
    keywords: List[str] = Field(default_factory=list)
    locations: List[str] = Field(default_factory=list)
    maxResults: int = 50


class GoogleSearchRequest(BaseModel):
    keywords: List[str] = Field(default_factory=list)
    locations: List[str] = Field(default_factory=list)
    maxResults: int = 50


class BulkRequest(BaseModel):
    tool: str = "google-maps"
    keywords: List[str] = Field(default_factory=list)
    locations: List[str] = Field(default_factory=list)
    maxPerCombo: int = 20


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
            # Persist progress to Redis so status polls survive restarts
            await job_store.set_job(job_id, _jobs[job_id])
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
        # Fire-and-forget Redis write from sync context
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.ensure_future(job_store.set_job(job_id, _jobs[job_id]))
        except Exception:
            pass

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
    listings: List[Dict[str, Any]] = []
    partial = False
    try:
        _jobs.setdefault(job_id, {"id": job_id, "type": "distressed",
                                   "status": "retrying", "progress": 0,
                                   "params": params, "result": None, "error": None})
        _set_status(job_id, "retrying")
        await db.update_job(job_id, status="running", progress=0)
        cb = await _make_progress_cb(job_id)
        # Overall job timeout: 8 minutes; sources each have their own 45 s timeout
        try:
            listings = await asyncio.wait_for(
                distressed.find_distressed(
                    zip_code=params.get("zip", ""),
                    county_key=params.get("county_key", ""),
                    state=params.get("state", ""),
                    categories=params.get("categories"),
                    source_keys=params.get("source_keys"),
                    job_id=job_id,
                    campaign_id=params.get("campaign_id"),
                    progress_cb=cb,
                ),
                timeout=480,
            )
        except asyncio.TimeoutError:
            log.warning("distressed job %s: overall timeout hit — returning partial results (%d so far)",
                        job_id, len(listings))
            partial = True

        if listings:
            final_status = "partial_success" if partial else "done"
            _set_status(job_id, final_status, progress=100, result=listings)
            await db.update_job(job_id, status=final_status, progress=100,
                                result_count=len(listings), completed=True)
        else:
            # No results at all — treat as failed
            _set_status(job_id, "failed", error="No listings found" + (" (timeout)" if partial else ""))
            await db.update_job(job_id, status="failed",
                                error="No listings found" + (" (timeout)" if partial else ""),
                                completed=True)
        return {"count": len(listings)}
    except Exception as e:
        log.error("distressed job %s failed: %s", job_id, str(e)[:120])
        if listings:
            log.info("distressed job %s: returning %d partial results despite error", job_id, len(listings))
            _set_status(job_id, "partial_success", progress=100, result=listings)
            await db.update_job(job_id, status="partial_success", progress=100,
                                result_count=len(listings), completed=True)
        else:
            _set_status(job_id, "failed", error=str(e))
            await db.update_job(job_id, status="failed", error=str(e), completed=True)
        return {"count": len(listings)}


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
            "proxy_host": settings.brightdata_host,
            "proxy_port": settings.brightdata_port,
            "zone": settings.brightdata_zone or "(embedded in username)",
            "browser_max_concurrent": int(os.getenv("BROWSER_MAX_CONCURRENT", "2")),
        },
        "attom": {
            "keys_total": len(settings.attom_keys) + len(settings.property_api_keys),
            "attom_keys": len(settings.attom_keys),
            "property_api_keys": len(settings.property_api_keys),
        },
    }

# ─── Proxy diagnostics ───────────────────────────────────────────────────────

@app.get("/debug/proxy")
async def debug_proxy() -> Dict[str, Any]:
    """Show constructed proxy config (password masked) and run a live test request.

    Hits https://api.ipify.org through the residential proxy so you can verify:
      - The zone suffix is being appended correctly
      - The proxy host/port are reachable
      - The IP returned is a residential US IP (not the container's datacenter IP)

    On 407 errors the response will include the raw error detail to help diagnose
    zone-name mismatches.
    """
    import re as _re
    import httpx as _httpx

    # Build masked proxy URL for display  (mask password only, preserve username)
    proxy_url = settings.proxy_url()
    if proxy_url:
        # Format is http://user:password@host:port — mask only the password segment
        masked = _re.sub(r'(?<=:)[^/:@]+(?=@)', '***', proxy_url)
    else:
        masked = None

    proxy_dict = settings.proxy_dict()

    result: Dict[str, Any] = {
        "brightdata_configured": settings.brightdata_configured(),
        "proxy_url_masked": masked,
        "proxy_host": settings.brightdata_host,
        "proxy_port": settings.brightdata_port,
        "username_full": settings.brightdata_username or "(not set)",
        "username_has_zone": "-zone-" in (settings.brightdata_username or ""),
        "zone_env_var": settings.brightdata_zone or "(not set — must be embedded in username)",
        "test": None,
    }

    if not proxy_url:
        result["test"] = {"status": "skipped", "reason": "no_proxy_configured"}
        return result

    # Live probe through the proxy
    try:
        async with _httpx.AsyncClient(
            proxy=proxy_url,
            timeout=20.0,
            follow_redirects=True,
            verify=False,
        ) as cli:
            r = await cli.get("https://api.ipify.org?format=json")
            if r.status_code == 407:
                result["test"] = {
                    "status": "407_zone_not_found",
                    "detail": r.text[:300],
                    "hint": (
                        "Your Bright Data zone name is wrong or the port doesn't match the zone type. "
                        "Check: 22225=residential, 33335=datacenter, 24000=scraping_browser. "
                        f"Current username: {settings.brightdata_username}"
                    ),
                }
            elif r.status_code == 200:
                result["test"] = {
                    "status": "ok",
                    "egress_ip": r.json().get("ip"),
                    "http_status": 200,
                }
            else:
                result["test"] = {
                    "status": f"unexpected_{r.status_code}",
                    "body": r.text[:300],
                }
    except Exception as e:
        result["test"] = {"status": "error", "error": str(e)[:300]}

    return result


@app.post("/debug/proxy/zone")
async def debug_proxy_set_zone(body: Dict[str, Any]) -> Dict[str, Any]:
    """Temporarily override the proxy zone for one test request (does NOT persist).

    Body: {"zone": "residential_1", "port": 22225}

    Useful for trying different zone names without an env restart.
    """
    import re as _re
    import httpx as _httpx

    zone = (body.get("zone") or "").strip()
    port = int(body.get("port") or settings.brightdata_port)
    if not zone:
        return {"error": "zone is required"}

    base_user = settings.brightdata_username or ""
    # Strip any existing zone suffix first
    base_user = _re.sub(r'-zone-.*', '', base_user)
    test_user = f"{base_user}-zone-{zone}"
    test_pw   = settings.brightdata_password or ""
    test_url  = f"http://{test_user}:{test_pw}@{settings.brightdata_host}:{port}"
    masked    = f"http://{test_user}:***@{settings.brightdata_host}:{port}"

    try:
        async with _httpx.AsyncClient(
            proxy=test_url,
            timeout=20.0,
            follow_redirects=True,
            verify=False,
        ) as cli:
            r = await cli.get("https://api.ipify.org?format=json")
            if r.status_code == 407:
                return {
                    "proxy_tested": masked,
                    "status": "407_zone_not_found",
                    "detail": r.text[:300],
                }
            elif r.status_code == 200:
                return {
                    "proxy_tested": masked,
                    "status": "ok",
                    "egress_ip": r.json().get("ip"),
                }
            else:
                return {
                    "proxy_tested": masked,
                    "status": f"http_{r.status_code}",
                    "body": r.text[:200],
                }
    except Exception as e:
        return {"proxy_tested": masked, "status": "error", "error": str(e)[:300]}


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


# ─── Propelio authenticated cash buyers ──────────────────────────────────────

class PropelioCashBuyersRequest(BaseModel):
    address: str
    distance_miles: float = 10.0
    active_within: str = "ANY_TIME"
    min_properties: int = 3
    landlords: bool = True
    flippers: bool = True
    max_results: int = 500
    lead_id: Optional[int] = None
    campaign_id: Optional[int] = None
    persist: bool = True


@app.post("/scrape/propelio/cash-buyers")
async def scrape_propelio_cash_buyers(req: PropelioCashBuyersRequest) -> Dict[str, Any]:
    """Start an authenticated Propelio cash-buyer search. Returns job_id immediately."""
    job_id = _new_job("propelio_cash_buyers", req.model_dump())
    await db.create_job(job_id, "propelio_cash_buyers", req.model_dump(),
                        lead_id=req.lead_id, campaign_id=req.campaign_id)
    asyncio.create_task(_run_propelio_cash_buyers(job_id, req.model_dump()))
    return {"job_id": job_id, "status": "queued", "lead_id": req.lead_id}


# ─── Propwire authenticated endpoints ────────────────────────────────────────

class PropwireQueryRequest(BaseModel):
    query: str


class PropwireCashBuyersNearbyRequest(BaseModel):
    query: str
    radius_miles: float = 1.0
    min_properties: int = 3
    max_results: int = 200
    lead_id: Optional[int] = None
    campaign_id: Optional[int] = None
    persist: bool = True


@app.post("/scrape/propwire/property")
async def scrape_propwire_property(req: PropwireQueryRequest) -> Dict[str, Any]:
    """Fetch Propwire property details for an address or URL."""
    try:
        return await propwire.fetch_property(req.query)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:300])


@app.post("/scrape/propwire/comps")
async def scrape_propwire_comps(req: PropwireQueryRequest) -> Dict[str, Any]:
    """Fetch Propwire comparable sales for an address or URL."""
    try:
        comps = await propwire.fetch_comps(req.query)
        return {"query": req.query, "count": len(comps), "comps": comps}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:300])


@app.post("/scrape/propwire/history")
async def scrape_propwire_history(req: PropwireQueryRequest) -> Dict[str, Any]:
    """Fetch Propwire sales + mortgage history for an address or URL."""
    try:
        return await propwire.fetch_history(req.query)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:300])


@app.post("/scrape/propwire/cash-buyers-nearby")
async def scrape_propwire_cash_buyers_nearby(req: PropwireCashBuyersNearbyRequest) -> Dict[str, Any]:
    """Start an authenticated Propwire cash-buyer search nearby an address. Returns job_id."""
    job_id = _new_job("propwire_cash_buyers", req.model_dump())
    await db.create_job(job_id, "propwire_cash_buyers", req.model_dump(),
                        lead_id=req.lead_id, campaign_id=req.campaign_id)
    asyncio.create_task(_run_propwire_cash_buyers(job_id, req.model_dump()))
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


# ─── Google Maps / Google Search / Bulk lead-scraper endpoints ───────────────
# These endpoints give the Node API server a Playwright-primary route so it can
# call tryEngine("/google-maps", …) and get real Places API data instead of
# immediately falling back to ScraperAPI.

@app.post("/google-maps")
async def google_maps_scrape(req: GoogleMapsRequest) -> Dict[str, Any]:
    """Search Google Maps via Google Places Text Search API (primary) or 503 if unconfigured."""
    import httpx as _httpx
    gkey = os.environ.get("GOOGLE_MAPS_API_KEY", "")
    if not gkey:
        raise HTTPException(
            status_code=503,
            detail="GOOGLE_MAPS_API_KEY not configured — ScraperAPI fallback will be used",
        )

    results: List[Dict[str, Any]] = []
    limit = min(int(req.maxResults), 200)
    base = "https://maps.googleapis.com/maps/api/place/textsearch/json"

    async with _httpx.AsyncClient(timeout=15) as client:
        for keyword in req.keywords[:5]:
            for location in req.locations[:10]:
                if len(results) >= limit:
                    break
                query = f"{keyword} near {location}"
                try:
                    r = await client.get(base, params={"query": query, "key": gkey})
                    data = r.json()
                    for place in (data.get("results") or []):
                        if len(results) >= limit:
                            break
                        results.append({
                            "name":     place.get("name", ""),
                            "category": ", ".join((place.get("types") or [])[:3]),
                            "address":  place.get("formatted_address", ""),
                            "phone":    "",
                            "website":  "",
                            "rating":   place.get("rating", ""),
                            "reviews":  place.get("user_ratings_total", ""),
                            "keyword":  keyword,
                            "location": location,
                            "source":   "Google Places API",
                        })
                except Exception as e:
                    log.warning("Google Places failed for '%s near %s': %s", keyword, location, e)

    return {"count": len(results), "results": results}


@app.post("/google-search")
async def google_search_scrape(req: GoogleSearchRequest) -> Dict[str, Any]:
    """Search Google via Crawl4AI / Playwright rendering (primary) or 503 if browser unavailable."""
    results: List[Dict[str, Any]] = []
    limit = min(int(req.maxResults), 200)

    for keyword in req.keywords[:5]:
        for location in req.locations[:10]:
            if len(results) >= limit:
                break
            query_str = f"{keyword} {location}".replace(" ", "+")
            url = f"https://www.google.com/search?q={query_str}&num=10"
            try:
                from .http_client import fetch_html
                html = await fetch_html(url, render=True)
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(html, "lxml")
                for a in soup.select("a[href]"):
                    href = a.get("href", "")
                    if not href.startswith("http") or "google.com" in href:
                        continue
                    title = a.get_text(strip=True)
                    if not title or len(title) < 3:
                        continue
                    results.append({
                        "name":     title[:120],
                        "website":  href,
                        "keyword":  keyword,
                        "location": location,
                        "source":   "Google Search (Playwright)",
                    })
                    if len(results) >= limit:
                        break
            except Exception as e:
                log.warning("Google Search Playwright failed for '%s %s': %s", keyword, location, e)
                # Continue to next keyword/location — don't abort the whole request.
                # A 503 here would break the tryEngine() null-check in the Node server.
                continue

    if not results:
        raise HTTPException(status_code=503, detail="Browser scrape returned no results — Playwright may be unavailable")

    return {"count": len(results), "results": results}


# ─── NAR Directory Scraper ───────────────────────────────────────────────────

class NARDirectoryRequest(BaseModel):
    state: str
    city: str = ""
    maxResults: int = 50


@app.post("/nar-directory")
async def nar_directory_scrape(req: NARDirectoryRequest) -> Dict[str, Any]:
    """Scrape the NAR Realtor Directory using their public member search JSON API.

    Tries three documented endpoint patterns in order. Returns structured member records
    without any third-party scraping service.
    """
    import httpx as _httpx

    state = req.state.upper().strip()
    city  = (req.city or "").strip()
    limit = min(int(req.maxResults), 200)

    headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Referer": "https://directories.apps.realtor/memberResults",
        "Origin": "https://directories.apps.realtor",
    }

    api_patterns = [
        (
            "GET",
            "https://directories.apps.realtor/api/v1/search/realtor",
            {"stateAbbreviation": state, **({"city": city} if city else {}),
             "pageSize": min(limit, 100), "pageNumber": 1},
        ),
        (
            "GET",
            "https://directories.apps.realtor/api/memberSearch",
            {"stateAbbreviation": state, **({"city": city} if city else {}),
             "pageSize": min(limit, 100)},
        ),
        (
            "GET",
            "https://directories.apps.realtor/api/v1/members",
            {"stateAbbreviation": state, **({"city": city} if city else {}),
             "take": min(limit, 100), "skip": 0},
        ),
    ]

    results: List[Dict[str, Any]] = []

    async with _httpx.AsyncClient(timeout=25, headers=headers,
                                   follow_redirects=True) as client:
        for method, url, params in api_patterns:
            try:
                r = await client.request(method, url, params=params)
                if r.status_code != 200:
                    log.debug("NAR API %s → HTTP %d", url, r.status_code)
                    continue
                data = r.json()
                # Various key names seen across NAR API versions
                members: List[Any] = (
                    data.get("members")
                    or data.get("results")
                    or data.get("data")
                    or data.get("items")
                    or []
                )
                if not members:
                    continue
                for m in members[:limit]:
                    first = m.get("firstName", "")
                    last  = m.get("lastName", "")
                    full  = m.get("fullName") or m.get("name") or (
                        f"{first} {last}".strip() if first or last else ""
                    )
                    results.append({
                        "name":       full,
                        "state":      state,
                        "city":       m.get("city") or m.get("officeCity") or city,
                        "phone":      m.get("phoneNumber") or m.get("phone") or m.get("cellPhone") or "",
                        "email":      m.get("email") or m.get("emailAddress") or "",
                        "office":     m.get("officeName") or m.get("brokerage") or "",
                        "memberType": m.get("memberType") or m.get("designations") or "REALTOR®",
                        "nrdsId":     m.get("nrdsId") or m.get("memberId") or "",
                        "profileUrl": (
                            f"https://directories.apps.realtor/memberProfile?nrdsId={m['nrdsId']}"
                            if m.get("nrdsId") else ""
                        ),
                        "source": "NAR Directory (Python Engine)",
                    })
                log.info("NAR API hit on %s — %d members returned", url, len(results))
                break  # Success — no need to try next pattern
            except Exception as e:
                log.debug("NAR API attempt failed (%s): %s", url, str(e)[:120])
                continue

    if not results:
        raise HTTPException(
            status_code=503,
            detail=(
                "NAR directory API returned no members — "
                "all endpoint patterns failed (state=%s, city=%s)" % (state, city)
            ),
        )

    return {"count": len(results), "results": results}


# ─── Zillow Scraper ───────────────────────────────────────────────────────────

class ZillowRequest(BaseModel):
    mode: str = "agents"     # agents | listings | fsbo
    city: str
    state: str
    maxResults: int = 40


@app.post("/zillow")
async def zillow_scrape(req: ZillowRequest) -> Dict[str, Any]:
    """Scrape Zillow using Playwright (residential proxy) to bypass DataDome.

    Returns structured agent/listing/FSBO records by extracting __NEXT_DATA__
    from the server-side-rendered page.
    """
    from .scrapers._browser_session import browser_context
    import json as _json

    city     = req.city.strip()
    state    = req.state.upper().strip()
    mode     = req.mode.lower()
    limit    = min(int(req.maxResults), 100)

    # Build the Zillow URL slug and target
    slug     = f"{city.lower().replace(' ', '-')}-{state.lower()}"
    url_map  = {
        "agents":   f"https://www.zillow.com/professionals/real-estate-agents/{slug}/",
        "listings": f"https://www.zillow.com/homes/for_sale/{slug}_rb/",
        "fsbo":     f"https://www.zillow.com/homes/fsbo/{slug}_rb/",
    }
    target_url = url_map.get(mode, url_map["agents"])

    results: List[Dict[str, Any]] = []

    try:
        async with browser_context("zillow") as ctx:
            page = await ctx.new_page()
            await page.set_extra_http_headers({
                "Accept-Language": "en-US,en;q=0.9",
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                ),
            })
            await page.goto(target_url, wait_until="domcontentloaded", timeout=45000)
            await page.wait_for_timeout(2500)

            # Extract __NEXT_DATA__ JSON (Zillow is Next.js)
            next_data_raw = await page.evaluate(
                "() => { const el = document.getElementById('__NEXT_DATA__'); "
                "return el ? el.textContent : null; }"
            )
            if not next_data_raw:
                # Fall back: try window.__PRELOADED_STATE__
                next_data_raw = await page.evaluate(
                    "() => JSON.stringify(window.__PRELOADED_STATE__ || null)"
                )
            await page.close()

    except Exception as e:
        log.warning("Zillow Playwright failed: %s", str(e)[:200])
        raise HTTPException(
            status_code=503,
            detail=f"Zillow Playwright scrape failed: {str(e)[:200]}"
        )

    if not next_data_raw:
        raise HTTPException(status_code=503, detail="Zillow returned no __NEXT_DATA__ — possibly blocked by DataDome")

    try:
        next_data = _json.loads(next_data_raw) if isinstance(next_data_raw, str) else next_data_raw
    except _json.JSONDecodeError:
        raise HTTPException(status_code=503, detail="Zillow __NEXT_DATA__ could not be parsed as JSON")

    page_props = next_data.get("props", {}).get("pageProps", {})

    if mode == "agents":
        # New card format (2024+)
        new_cards: List[Any] = (
            page_props.get("displayData", {})
            .get("agentDirectoryFinderDisplay", {})
            .get("searchResults", {})
            .get("results", {})
            .get("resultsCards", [])
        )
        legacy: List[Any] = (
            page_props.get("searchResultsProps", {}).get("agentResults", [])
            or page_props.get("agents", [])
            or page_props.get("agentList", {}).get("agents", [])
        )
        cards = new_cards or legacy
        for c in cards[:limit]:
            if new_cards:
                pd = c.get("profileData", [])
                def _stat(label: str) -> str:
                    return next(
                        (x.get("formattedData", "") for x in pd
                         if label in (x.get("label") or "").lower()),
                        ""
                    )
                results.append({
                    "name":       c.get("cardTitle", ""),
                    "sales12mo":  _stat("sales last 12"),
                    "priceRange": _stat("price range"),
                    "profileUrl": c.get("cardActionLink", ""),
                    "isTopAgent": "Yes" if c.get("isTopAgent") else "No",
                    "city": city, "state": state,
                    "source": "Zillow Agents (Python Engine)",
                })
            else:
                results.append({
                    "name":           c.get("fullName") or c.get("displayName") or c.get("name", ""),
                    "brokerage":      c.get("businessName") or c.get("brokerageName", ""),
                    "phone":          c.get("phone") or c.get("phoneNumber", ""),
                    "city":           c.get("location", {}).get("city", city),
                    "state":          c.get("location", {}).get("stateCode", state),
                    "rating":         str(c.get("rating") or c.get("reviewStats", {}).get("averageRating", "")),
                    "reviews":        str(c.get("reviewCount") or c.get("reviewStats", {}).get("totalReviewCount", "")),
                    "activeListings": str(c.get("activeListingCount", "")),
                    "profileUrl":     ("https://www.zillow.com" + c["profileUrl"]) if c.get("profileUrl") else "",
                    "source": "Zillow Agents (Python Engine)",
                })

    elif mode in ("listings", "fsbo"):
        # __NEXT_DATA__ listing results
        search_results = (
            page_props.get("searchPageState", {})
            .get("cat1", {})
            .get("searchResults", {})
            .get("listResults", [])
        ) or page_props.get("searchResults", {}).get("listResults", [])

        for prop in search_results[:limit]:
            results.append({
                "address":      prop.get("address", ""),
                "price":        prop.get("price") or prop.get("unformattedPrice", ""),
                "beds":         str(prop.get("beds", "")),
                "baths":        str(prop.get("baths", "")),
                "sqft":         str(prop.get("area", "")),
                "daysOnMarket": str(prop.get("daysOnMarket", "")),
                "city":         city,
                "state":        state,
                "zillowUrl":    prop.get("detailUrl", ""),
                "zpid":         str(prop.get("zpid", "")),
                "source":       f"Zillow {mode.upper()} (Python Engine)",
            })

    if not results:
        raise HTTPException(
            status_code=503,
            detail=(
                "Zillow scrape succeeded but returned 0 results — "
                "DataDome may have served a challenge page or the slug is incorrect. "
                f"URL: {target_url}"
            ),
        )

    return {"count": len(results), "results": results}


@app.post("/bulk")
async def bulk_scrape(req: BulkRequest) -> Dict[str, Any]:
    """Bulk keyword × location scrape — delegates to /google-maps or /google-search."""
    if req.tool == "google-search":
        inner = GoogleSearchRequest(
            keywords=req.keywords,
            locations=req.locations,
            maxResults=min(req.maxPerCombo * len(req.keywords) * len(req.locations), 500),
        )
        return await google_search_scrape(inner)
    else:
        inner_maps = GoogleMapsRequest(
            keywords=req.keywords,
            locations=req.locations,
            maxResults=min(req.maxPerCombo * len(req.keywords) * len(req.locations), 500),
        )
        return await google_maps_scrape(inner_maps)


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
    """Return job details — checks memory, then Redis (survives restarts), then Postgres."""
    job = await job_store.get_job(job_id)
    if job:
        return job
    row = await db.get_job(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return dict(row)

@app.post("/jobs/{job_id}/retry")
async def manual_retry(job_id: str) -> Dict[str, Any]:
    """Force-enqueue a job for immediate retry regardless of its current status."""
    row = await job_store.get_job(job_id) or await db.get_job(job_id)
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
                    _pool = await db.init_pool()
                    async with _pool.acquire() as _conn:
                        await _conn.execute(
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
                            _json.dumps([p["number"] if isinstance(p, dict) else str(p) for p in phones]),
                            _json.dumps([e["email"] if isinstance(e, dict) else str(e) for e in emails]),
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


# ─── Foreclosure Lead-Gen result alias ───────────────────────────────────────

@app.get("/lead-gen/foreclosure/result/{job_id}")
async def get_lead_gen_result(job_id: str) -> Dict[str, Any]:
    """Alias for /jobs/{job_id} — returns a foreclosure lead-gen job result."""
    job = await job_store.get_job(job_id)
    if job:
        return job
    row = await db.get_job(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return dict(row)


# ─── Playwright smoke-test endpoint ──────────────────────────────────────────

@app.get("/debug/playwright")
async def debug_playwright() -> Dict[str, Any]:
    """Smoke-test Playwright by opening example.com headlessly.

    Returns the browser executable path, page title, and any errors so you can
    quickly confirm Chromium is working inside this container.
    """
    import time as _time
    from .scrapers._browser_session import _find_chromium_executable, _ensure_nix_ld_path

    _ensure_nix_ld_path()
    exec_path = _find_chromium_executable()
    result: Dict[str, Any] = {
        "executable_path": exec_path,
        "ld_library_path_set": bool(os.environ.get("LD_LIBRARY_PATH")),
    }

    t0 = _time.monotonic()
    try:
        from playwright.async_api import async_playwright as _ap
        pw = await _ap().start()
        try:
            browser = await pw.chromium.launch(
                headless=True,
                executable_path=exec_path,
                args=["--no-sandbox", "--disable-setuid-sandbox",
                      "--disable-dev-shm-usage", "--no-zygote",
                      "--disable-gpu", "--disable-software-rasterizer"],
            )
            page = await browser.new_page()
            await page.goto("https://example.com", wait_until="domcontentloaded", timeout=20000)
            title = await page.title()
            await browser.close()
            result.update({
                "status": "ok",
                "title": title,
                "latency_ms": int((_time.monotonic() - t0) * 1000),
            })
        finally:
            await pw.stop()
    except Exception as e:
        result.update({
            "status": "error",
            "error": str(e)[:500],
            "latency_ms": int((_time.monotonic() - t0) * 1000),
        })

    return result


@app.get("/debug/satellite")
async def debug_satellite() -> Dict[str, Any]:
    """Show satellite DFD config: Google Maps API status, YOLO availability."""
    from .scrapers.satellite_dfd import _google_key, _YOLO_AVAILABLE

    gkey = _google_key()
    return {
        "google_maps_configured": bool(gkey),
        "google_maps_key_prefix": (gkey[:8] + "…") if gkey else None,
        "yolo_available": _YOLO_AVAILABLE,
        "yolo_note": "Install ultralytics to enable YOLO visual distress detection" if not _YOLO_AVAILABLE else "YOLO ready",
        "satellite_endpoint": "POST /ai/satellite-dfd",
        "required_params": {"city": "str", "state": "str (or zip: str)"},
    }


@app.get("/debug/env")
async def debug_env() -> Dict[str, Any]:
    """Show all configured env vars with values masked — useful for verifying Railway secrets."""
    def _check(name: str) -> Dict[str, Any]:
        val = os.environ.get(name, "")
        return {"set": bool(val), "length": len(val)}

    return {
        "database_url":         _check("DATABASE_URL"),
        "brightdata_username":  _check("BRIGHTDATA_USERNAME"),
        "brightdata_password":  _check("BRIGHTDATA_PASSWORD"),
        "google_maps_api_key":  _check("GOOGLE_MAPS_API_KEY"),
        "groq_api_key":         _check("GROQ_API_KEY"),
        "cerebras_api_key":     _check("CEREBRAS_API_KEY"),
        "nvidia_api_key":       _check("NVIDIA_API_KEY"),
        "openrouter_api_key":   _check("OPENROUTER_API_KEY"),
        "propelio_email":       _check("PROPELIO_EMAIL"),
        "propelio_password":    _check("PROPELIO_PASSWORD"),
        "propwire_email":       _check("PROPWIRE_EMAIL"),
        "propwire_password":    _check("PROPWIRE_PASSWORD"),
        "twilio_account_sid":   _check("TWILIO_ACCOUNT_SID"),
        "twilio_auth_token":    _check("TWILIO_AUTH_TOKEN"),
        "redis_url":            _check("REDIS_URL"),
        "port":                 os.environ.get("PORT", "8765"),
    }


# ─── Foreclosure Lead-Gen route ───────────────────────────────────────────────

@app.post("/lead-gen/foreclosure")
async def lead_gen_foreclosure(req: ForeclosureLeadGenRequest) -> Dict[str, Any]:
    """Start chained foreclosure lead-gen pipeline. Returns job_id immediately."""
    job_id = _new_job("foreclosure_lead_gen", req.model_dump())
    await db.create_job(job_id, "foreclosure_lead_gen", req.model_dump(),
                        campaign_id=req.campaign_id)
    asyncio.create_task(_run_foreclosure_lead_gen(job_id, req.model_dump()))
    return {"job_id": job_id, "status": "queued", "city": req.city, "state": req.state}

