"""TolipAI Scraper Engine — FastAPI entrypoint.

Endpoints all return immediately with a job_id; long work runs as an asyncio
background task that persists progress + results to Postgres.

Run:
    uvicorn workers.main:app --host 0.0.0.0 --port ${PORT:-8765}
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import signal
import uuid
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse, PlainTextResponse  # noqa: E402
from contextlib import asynccontextmanager  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from . import db, cash_buyers, distressed, skip_trace, ai_research  # noqa: E402
from . import http_client  # noqa: E402
from . import job_store  # noqa: E402
from . import osint_skip_trace  # noqa: E402
from .scrapers import homeharvest_scraper  # noqa: E402
from .config import settings  # noqa: E402
from .spot_handler import spot_handler, is_interrupted, register_job, unregister_job  # noqa: E402
from .circuit_breaker import all_breaker_states, reset_breaker  # noqa: E402
from .cache import cache  # noqa: E402
from .retry_queue import retry_queue, is_transient  # noqa: E402
from .scrapers import propelio_v2, propwire  # noqa: E402
from .scrapers import satellite_dfd  # noqa: E402
from .proxy_pool import proxy_pool  # noqa: E402
from .browser_pool import browser_pool  # noqa: E402
from . import spot_checkpoint  # noqa: E402

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("main")


class _PIIFilter(logging.Filter):
    """Redact phone numbers, emails, and SSNs from all log records."""

    _PHONE = re.compile(r'\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b')
    _EMAIL = re.compile(r'\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b')
    _SSN = re.compile(r'\b\d{3}-\d{2}-\d{4}\b')

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
            msg = self._PHONE.sub('[PHONE]', msg)
            msg = self._EMAIL.sub('[EMAIL]', msg)
            msg = self._SSN.sub('[SSN]', msg)
            record.msg = msg
            record.args = ()
        except Exception:
            pass
        return True


_pii_filter = _PIIFilter()
for _h in logging.root.handlers:
    _h.addFilter(_pii_filter)

# ─── Graceful shutdown flag ──────────────────────────────────────────────────
_shutting_down: bool = False

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
_METRICS_LOCK: Optional[asyncio.Lock] = None


def _get_metrics_lock() -> asyncio.Lock:
    global _METRICS_LOCK
    if _METRICS_LOCK is None:
        _METRICS_LOCK = asyncio.Lock()
    return _METRICS_LOCK


async def _evict_old_jobs() -> None:
    """Remove completed jobs older than 1 hour from in-memory store."""
    import time
    while True:
        await asyncio.sleep(300)  # every 5 minutes
        try:
            now = time.monotonic()
            to_evict = [
                jid for jid, j in list(_jobs.items())
                if j.get("status") in ("done", "failed", "partial_success")
                and now - j.get("_completed_at", now) > 3600
            ]
            for jid in to_evict:
                _jobs.pop(jid, None)
            if to_evict:
                log.debug("Evicted %d old jobs from memory", len(to_evict))
        except Exception as e:
            log.warning("Job eviction failed: %s", e)

# ─── Mode B safety helpers ───────────────────────────────────────────────────

_SCRAPER_SEM: Optional[asyncio.Semaphore] = None


def _get_scraper_sem() -> asyncio.Semaphore:
    global _SCRAPER_SEM
    if _SCRAPER_SEM is None:
        _SCRAPER_SEM = asyncio.Semaphore(int(os.getenv("BROWSER_MAX_CONCURRENT", "2")))
    return _SCRAPER_SEM


async def safe_get_pool():
    """Return shared DB pool idempotently (safe to call inside tight loops)."""
    return await db.init_pool()


def safe_create_task(coro, *, name: Optional[str] = None) -> "asyncio.Task":
    """Create asyncio task with an error-logging done-callback."""
    task = asyncio.create_task(coro, name=name)

    def _on_done(t: "asyncio.Task") -> None:
        if not t.cancelled() and (exc := t.exception()) is not None:
            log.error("Background task %s raised: %s", name or "?", exc)

    task.add_done_callback(_on_done)
    return task


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

    # ── Redis Streams retry queue init ───────────────────────────────────────
    await retry_queue.init()

    # Register retry runners (see _run_* functions below).
    retry_queue.register("cash_buyers", _run_cash_buyers)
    retry_queue.register("distressed", _run_distressed)
    retry_queue.register("propelio_cash_buyers", _run_propelio_cash_buyers)
    retry_queue.register("propwire_cash_buyers", _run_propwire_cash_buyers)

    retry_queue.start(
        on_success=_on_retry_success,
        on_exhaust=_on_retry_exhausted,
    )

    # ── Spot checkpoint recovery (re-queue jobs lost on previous Spot task) ──
    recovered = await spot_checkpoint.recover_checkpoints(retry_queue)
    if recovered:
        log.info("Spot checkpoint recovery: %d job(s) re-queued", recovered)

    # ── Fargate Spot SIGTERM / SIGINT handler ────────────────────────────────
    # spot_handler replaces the old _handle_sigterm — it sets the global
    # _shutting_down flag AND performs a 90-second ordered drain before exit,
    # giving in-flight jobs time to finish and flushing state to Redis before
    # AWS issues the hard SIGKILL at t=120s.
    global _shutting_down

    # Register shutdown callbacks so spot_handler can flush state
    from .spot_handler import on_shutdown as _on_shutdown

    async def _flush_on_spot() -> None:
        log.info("Spot shutdown: stopping retry queue and closing connections...")
        retry_queue.stop()
        await job_store.close()
        await http_client.close_client()
        await db.close_pool()

    _on_shutdown(_flush_on_spot)

    # Flush all in-progress job checkpoints to S3 before the Spot task dies
    _on_shutdown(spot_checkpoint.flush_all_checkpoints)

    # Wire _shutting_down to spot_handler's interrupted flag
    import ctypes as _ctypes  # noqa: F401

    from . import spot_handler as _spot_mod

    def _sync_shutdown_flag(sig: int, frame: Any) -> None:
        global _shutting_down
        _shutting_down = True

    spot_handler.install()
    # Also keep _shutting_down in sync for code that polls it directly
    import signal as _sig
    _orig_sigterm = _sig.getsignal(_sig.SIGTERM)

    def _combined_sigterm(sig: int, frame: Any) -> None:
        global _shutting_down
        _shutting_down = True
        if callable(_orig_sigterm):
            _orig_sigterm(sig, frame)

    _sig.signal(_sig.SIGTERM, _combined_sigterm)
    _sig.signal(_sig.SIGINT,  _combined_sigterm)

    # ── Memory pressure monitor ──────────────────────────────────────────────
    async def _memory_monitor() -> None:
        try:
            import psutil  # type: ignore[import]

            while True:
                pct = psutil.virtual_memory().percent
                if pct > 85:
                    log.warning(
                        "Memory pressure: %.1f%% RAM used — "
                        "new browser jobs may be deferred (BROWSER_MAX_CONCURRENT=%s)",
                        pct,
                        os.getenv("BROWSER_MAX_CONCURRENT", "2"),
                    )
                await asyncio.sleep(10)
        except ImportError:
            log.info("psutil not installed — memory monitoring disabled")
        except asyncio.CancelledError:
            pass

    _mem_task = asyncio.create_task(_memory_monitor(), name="memory_monitor")

    # ── Browser pool (warm Playwright instances, idle eviction) ──────────────
    browser_pool.start()

    # ── Job memory eviction (prevents unbounded growth on Fargate Spot) ───────
    _evict_task = asyncio.create_task(_evict_old_jobs(), name="job_eviction")

    # ── CloudWatch EMF metrics emitter (every 60 s) ───────────────────────────
    _emf_task = asyncio.create_task(_emit_cloudwatch_emf(), name="cloudwatch_emf")

    log.info(
        "Engine ready on port %s (LLM=%s, proxies_configured=%s, redis=%s, "
        "retry_backend=%s, cache_s3=%s)",
        os.getenv("PORT", str(settings.port)),
        settings.has_llm(),
        bool(settings.proxy_url()),
        job_store._redis is not None,
        "redis_streams" if retry_queue._use_redis else "in_memory",
        bool(os.getenv("S3_CACHE_BUCKET")),
    )
    yield
    # Spot handler drain fires on SIGTERM; here we just stop the retry loop
    # and clean up resources for normal (non-spot) shutdowns.
    retry_queue.stop()
    _mem_task.cancel()
    _evict_task.cancel()
    _emf_task.cancel()
    await asyncio.gather(_mem_task, _evict_task, _emf_task, return_exceptions=True)
    await browser_pool.stop()
    await job_store.close()
    await http_client.close_client()
    await db.close_pool()


app = FastAPI(
    title="TolipAI Scraper Engine",
    version="0.2.0",
    description="Advanced scraping + skip-trace + investor classification",
    lifespan=lifespan,
)

# ─── CORS ────────────────────────────────────────────────────────────────────
_cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()] or []
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Security middleware ──────────────────────────────────────────────────────
_EXEMPT_PATHS = frozenset({"/health", "/healthz", "/metrics", "/docs", "/openapi.json", "/redoc"})
_MAX_BODY_BYTES = 1_048_576  # 1 MB


@app.middleware("http")
async def _security_middleware(request: Request, call_next):
    """Enforce API key auth + request body size limit + shutdown guard."""
    if request.url.path not in _EXEMPT_PATHS:
        # ── Body size guard ──────────────────────────────────────────────────
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > _MAX_BODY_BYTES:
            return JSONResponse(
                status_code=413,
                content={"detail": "Request body too large (max 1 MB)"},
            )

        # ── API key auth ─────────────────────────────────────────────────────
        _api_key = os.getenv("SCRAPER_API_KEY")
        if _api_key:
            auth_header = request.headers.get("Authorization", "")
            provided = request.headers.get("X-API-Key") or (
                auth_header[7:] if auth_header.startswith("Bearer ") else auth_header
            )
            if provided != _api_key:
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Invalid or missing API key. Set X-API-Key header."},
                )

        # ── Admin endpoint additional auth ───────────────────────────────────
        if request.url.path.startswith("/admin/"):
            _admin_key = os.getenv("ADMIN_API_KEY")
            if _admin_key:
                provided_admin = request.headers.get("X-Admin-Key") or request.headers.get("X-API-Key")
                if provided_admin != _admin_key:
                    return JSONResponse(
                        status_code=401,
                        content={"detail": "Invalid or missing admin API key. Set X-Admin-Key header."},
                    )

        # ── Shutdown guard ───────────────────────────────────────────────────
        if _shutting_down and request.method not in ("GET", "HEAD"):
            return JSONResponse(
                status_code=503,
                content={"detail": "Service shutting down — retry in a few seconds"},
                headers={"Retry-After": "5"},
            )

    return await call_next(request)


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
        "tax_assessor, government_reo, auction_aggregator. Empty = all categories.",
    )
    source_keys: List[str] = Field(
        default_factory=list,
        description="Pin to specific sources by key (overrides categories).",
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


class CompsRequest(BaseModel):
    address: str = Field(..., description="Full property address for comp lookup")
    radius_miles: float = Field(0.5, ge=0.1, le=10.0)
    max_results: int = Field(12, ge=1, le=50)


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
    if job_id not in _jobs:
        return
    _jobs[job_id]["status"] = status
    for k, v in kwargs.items():
        _jobs[job_id][k] = v
    if status in ("done", "failed", "partial_success"):
        import time
        _jobs[job_id]["_completed_at"] = time.monotonic()

    # Safer fire-and-forget Redis persistence
    try:
        loop = asyncio.get_running_loop()
        async def _persist():
            try:
                await job_store.set_job(job_id, _jobs[job_id])
            except Exception as e:
                log.debug("Redis persist failed for job %s: %s", job_id, str(e)[:80])
        loop.create_task(_persist())
    except RuntimeError:
        log.debug("No running event loop — skipping Redis persist for job %s", job_id)


# ─── Retry-queue standalone runners ─────────────────────────────────────────
# Each runner receives (job_id, params) and runs the full job logic again.
# They are called by the retry queue after the backoff period expires.


async def _run_cash_buyers(job_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    register_job(job_id)
    try:
        lead = await db.get_lead(params["lead_id"])
        if not lead:
            raise RuntimeError(f"Lead {params['lead_id']} not found — cannot retry")
        _jobs.setdefault(
            job_id,
            {
                "id": job_id,
                "type": "cash_buyers",
                "status": "retrying",
                "progress": 0,
                "params": params,
                "result": None,
                "error": None,
            },
        )
        _set_status(job_id, "retrying")
        await db.update_job(job_id, status="running", progress=0)
        cb = await _make_progress_cb(job_id)

        # CRITICAL FIX: 15min cap — prevents infinite hang on dead LLM
        try:
            results = await asyncio.wait_for(
                cash_buyers.find_cash_buyers(
                    lead,
                    max_buyers=params.get("max_buyers", 25),
                    job_id=job_id,
                    progress_cb=cb,
                ),
                timeout=900,
            )
        except asyncio.TimeoutError:
            log.error("cash_buyers retry job %s timed out after 900s", job_id)
            _set_status(job_id, "failed", error="timeout_exceeded")
            await db.update_job(job_id, status="failed", error="timeout_exceeded", completed=True)
            return {"count": 0}

        _set_status(job_id, "done", progress=100, result=results)
        await db.update_job(
            job_id,
            status="done",
            progress=100,
            result_count=len(results),
            completed=True,
        )
        return {"count": len(results)}
    except Exception as e:
        log.error("cash_buyers job %s failed: %s", job_id, str(e)[:120])
        _set_status(job_id, "failed", error=str(e))
        await db.update_job(job_id, status="failed", error=str(e), completed=True)
        return {"count": 0}
    finally:
        unregister_job(job_id)


async def _run_distressed(job_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    register_job(job_id)
    try:
        _jobs.setdefault(
            job_id,
            {
                "id": job_id,
                "type": "distressed",
                "status": "retrying",
                "progress": 0,
                "params": params,
                "result": None,
                "error": None,
            },
        )
        _set_status(job_id, "retrying")
        await db.update_job(job_id, status="running", progress=0)
        cb = await _make_progress_cb(job_id)

        # CRITICAL FIX: asyncio.wait_for cancels the coroutine on timeout so
        # listings stays [] — the old partial-results branch was dead code.
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
            log.warning("distressed job %s: timeout after 480s", job_id)
            _set_status(job_id, "failed", error="Timeout: exceeded 8 minutes")
            await db.update_job(job_id, status="failed", error="Timeout: exceeded 8 minutes", completed=True)
            return {"count": 0}

        if listings:
            _set_status(job_id, "done", progress=100, result=listings)
            await db.update_job(
                job_id,
                status="done",
                progress=100,
                result_count=len(listings),
                completed=True,
            )
        else:
            _set_status(job_id, "completed_no_results", progress=100)
            await db.update_job(
                job_id,
                status="completed_no_results",
                progress=100,
                result_count=0,
                completed=True,
            )
            log.info(
                "distressed job %s: no listings found for state=%s county=%s zip=%s — "
                "county may not be in COUNTY_SCRAPERS registry yet",
                job_id,
                params.get("state", ""),
                params.get("county_key", ""),
                params.get("zip", ""),
            )
        return {"count": len(listings)}

    except Exception as e:
        log.error("distressed job %s failed: %s", job_id, str(e)[:120])
        _set_status(job_id, "failed", error=str(e))
        await db.update_job(job_id, status="failed", error=str(e), completed=True)
        return {"count": 0}
    finally:
        unregister_job(job_id)


async def _run_propelio_cash_buyers(job_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    register_job(job_id)
    try:
        _jobs.setdefault(
            job_id,
            {
                "id": job_id,
                "type": "propelio_cash_buyers",
                "status": "retrying",
                "progress": 0,
                "params": params,
                "result": None,
                "error": None,
            },
        )
        _set_status(job_id, "retrying")
        await db.update_job(job_id, status="running", progress=0)
        cb = await _make_progress_cb(job_id)

        # CRITICAL FIX: 15min cap
        try:
            result = await asyncio.wait_for(
                propelio_v2.cash_buyers_for_address(
                    params["address"],
                    distance_miles=params.get("distance_miles", 10),
                    active_within=params.get("active_within", "ANY_TIME"),
                    min_properties=params.get("min_properties", 3),
                    landlords=params.get("landlords", True),
                    flippers=params.get("flippers", True),
                    max_results=params.get("max_results", 500),
                    progress_cb=cb,
                    email=params.get("propelio_email") or None,
                    password=params.get("propelio_password") or None,
                ),
                timeout=900,
            )
        except asyncio.TimeoutError:
            log.error("propelio_cash_buyers job %s timed out", job_id)
            _set_status(job_id, "failed", error="timeout_exceeded")
            await db.update_job(job_id, status="failed", error="timeout_exceeded", completed=True)
            return {"count": 0}

        buyers = result.get("buyers") or []
        if params.get("persist") and params.get("lead_id"):
            try:
                inserted = await db.insert_cash_buyers_batch(params["lead_id"], job_id, buyers)
                log.debug("propelio_cash_buyers: batch-inserted %d buyers for job %s", inserted, job_id)
            except Exception as e:
                log.debug("persist buyers batch failed on retry: %s", str(e)[:120])
        _set_status(job_id, "done", progress=100, result=result)
        await db.update_job(
            job_id,
            status="done",
            progress=100,
            result_count=len(buyers),
            completed=True,
        )
        return {"count": len(buyers)}
    except Exception as e:
        log.error("propelio_cash_buyers job %s failed: %s", job_id, str(e)[:120])
        _set_status(job_id, "failed", error=str(e))
        await db.update_job(job_id, status="failed", error=str(e), completed=True)
        return {"count": 0}
    finally:
        unregister_job(job_id)


async def _run_propwire_cash_buyers(job_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    register_job(job_id)
    try:
        _jobs.setdefault(
            job_id,
            {
                "id": job_id,
                "type": "propwire_cash_buyers",
                "status": "retrying",
                "progress": 0,
                "params": params,
                "result": None,
                "error": None,
            },
        )
        _set_status(job_id, "retrying")
        await db.update_job(job_id, status="running", progress=0)
        cb = await _make_progress_cb(job_id)

        # CRITICAL FIX: 15min cap
        try:
            buyers = await asyncio.wait_for(
                propwire.fetch_cash_buyers_nearby(
                    params["query"],
                    radius_miles=params.get("radius_miles", 1.0),
                    min_properties=params.get("min_properties", 3),
                    max_results=params.get("max_results", 200),
                    progress_cb=cb,
                    email=params.get("propwire_email") or None,
                    password=params.get("propwire_password") or None,
                ),
                timeout=900,
            )
        except asyncio.TimeoutError:
            log.error("propwire_cash_buyers job %s timed out", job_id)
            _set_status(job_id, "failed", error="timeout_exceeded")
            await db.update_job(job_id, status="failed", error="timeout_exceeded", completed=True)
            return {"count": 0}

        if params.get("persist") and params.get("lead_id"):
            try:
                inserted = await db.insert_cash_buyers_batch(params["lead_id"], job_id, buyers)
                log.debug("propwire_cash_buyers: batch-inserted %d buyers for job %s", inserted, job_id)
            except Exception as e:
                log.debug("persist buyers batch failed on retry: %s", str(e)[:120])
        result = {"count": len(buyers), "buyers": buyers}
        _set_status(job_id, "done", progress=100, result=result)
        await db.update_job(
            job_id,
            status="done",
            progress=100,
            result_count=len(buyers),
            completed=True,
        )
        return {"count": len(buyers)}
    except Exception as e:
        log.error("propwire_cash_buyers job %s failed: %s", job_id, str(e)[:120])
        _set_status(job_id, "failed", error=str(e))
        await db.update_job(job_id, status="failed", error=str(e), completed=True)
        return {"count": 0}
    finally:
        unregister_job(job_id)


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
        log.error(
            "Job %s permanently failed after %d retries: %s",
            job_id,
            max_attempts,
            error[:120],
        )
        _set_status(job_id, "failed", error=f"exhausted_retries: {error}")
        await db.update_job(
            job_id,
            status="failed",
            error=f"exhausted_retries: {error[:200]}",
            completed=True,
        )
    except Exception as e:
        log.error("Failed to mark job %s as exhausted: %s", job_id, str(e)[:120])
        _set_status(job_id, "failed", error=str(e))
        await db.update_job(job_id, status="failed", error=str(e), completed=True)


# ─── Routes ──────────────────────────────────────────────────────────────────

# ─── Session management endpoints ────────────────────────────────────────────

from .scrapers._browser_session import (  # noqa: E402
    invalidate_session as _invalidate_session,
    _state_path,
)


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


_METRIC_HELP: Dict[str, str] = {
    "cash_buyers_success":    "Total successful cash-buyer scrape jobs",
    "cash_buyers_failed":     "Total failed cash-buyer scrape jobs",
    "cash_buyers_timeout":    "Total timed-out cash-buyer scrape jobs",
    "distressed_success":     "Total successful distressed-property scrape jobs",
    "distressed_failed":      "Total failed distressed-property scrape jobs",
    "distressed_timeout":     "Total timed-out distressed-property scrape jobs",
    "foreclosure_success":    "Total successful foreclosure scrape jobs",
    "foreclosure_failed":     "Total failed foreclosure scrape jobs",
    "foreclosure_timeout":    "Total timed-out foreclosure scrape jobs",
}


@app.get("/metrics", response_class=PlainTextResponse)
async def metrics() -> str:
    """Prometheus text-format metrics endpoint (CloudWatch Container Insights compatible)."""
    import time as _time
    lines: list[str] = []
    for key, value in METRICS.items():
        metric_name = f"tolipai_scraper_{key}_total"
        help_text = _METRIC_HELP.get(key, key)
        lines.append(f"# HELP {metric_name} {help_text}")
        lines.append(f"# TYPE {metric_name} counter")
        lines.append(f"{metric_name} {value}")
    lines.append(f"# HELP tolipai_scraper_active_jobs Currently running scrape jobs")
    lines.append(f"# TYPE tolipai_scraper_active_jobs gauge")
    lines.append(f"tolipai_scraper_active_jobs {len([j for j in _jobs.values() if j.get('status') == 'running'])}")
    lines.append("")
    return "\n".join(lines)


async def _emit_cloudwatch_emf() -> None:
    """Periodically emit CloudWatch Embedded Metric Format logs so Container Insights
    can ingest job throughput and error rates without a sidecar or restart."""
    import json as _json
    import time as _time

    while True:
        await asyncio.sleep(60)
        if _shutting_down:
            break
        try:
            ts = int(_time.time() * 1000)
            active = len([j for j in _jobs.values() if j.get("status") == "running"])

            # Read under lock to prevent torn reads from concurrent increments
            async with _get_metrics_lock():
                metrics_snapshot = {k: v for k, v in METRICS.items()}

            emf = {
                "_aws": {
                    "Timestamp": ts,
                    "CloudWatchMetrics": [
                        {
                            "Namespace": "TolipAI/ScraperEngine",
                            "Dimensions": [["ServiceName"]],
                            "Metrics": [
                                {"Name": k, "Unit": "Count"}
                                for k in METRICS
                            ] + [{"Name": "ActiveJobs", "Unit": "Count"}],
                        }
                    ],
                },
                "ServiceName": "scraper-engine",
                "ActiveJobs": active,
                **metrics_snapshot,
            }
            print(_json.dumps(emf), flush=True)
        except Exception as _emf_err:
            log.warning("EMF metrics emit failed: %s", _emf_err)


# ─── Health check ───────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> Dict[str, Any]:
    """Lightweight health-check: probes DB and OpenAI config only.
    Does NOT burn credits on live LLM calls."""
    import time

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

    db_result = await _probe_db()
    db_ok = db_result.get("status") == "ok"

    # OpenAI only — do NOT import or probe dead providers
    llm_openai = {
        "status": "ok" if bool(settings.openai_api_key) else "unconfigured",
        "model": settings.openai_model,
    }
    llm_ok = bool(settings.openai_api_key)

    overall = "ok" if (llm_ok and db_ok) else ("degraded" if (llm_ok or db_ok) else "down")

    return {
        "status": overall,
        "version": app.version,
        "llm": {
            "openai": llm_openai,
            "mode": "openai_only",
            "any_ok": llm_ok,
        },
        "database": db_result,
        "scrapers": {
            "residential_proxy": bool(settings.proxy_url()),
            "google_dorks_enabled": settings.enable_google_dorks,
        },
        "skip_trace": {
            "opencorporates_enabled": settings.enable_opencorporates,
            "propertyapi_enabled": settings.enable_propertyapi,
        },
        "distressed_sources": {
            "total": len(distressed.list_sources()),
            "categories": len(distressed.list_categories()),
        },
        "circuit_breakers": all_breaker_states(),
        "retry_queue": {
            "backend": "redis_streams" if retry_queue._use_redis else "in_memory",
            "size": await retry_queue.size_async(),
        },
        "cache": await cache.stats(),
        "spot_handler": {
            "interrupted": is_interrupted(),
            "active_jobs": len([j for j in _jobs.values() if j.get("status") == "running"]),
        },
        "fargate": {
            "task_arn": os.getenv("ECS_CONTAINER_METADATA_URI_V4", "not_fargate").split("/")[-1] if os.getenv("ECS_CONTAINER_METADATA_URI_V4") else "local",
            "spot_exit_deadline_seconds": int(os.getenv("SPOT_EXIT_DEADLINE_SECONDS", "90")),
        },
    }


@app.get("/health/keys")
async def health_keys() -> Dict[str, Any]:
    """Check configuration status of all third-party API keys."""
    return {
        "openai": bool(settings.openai_api_key),
        "brightdata": settings.brightdata_configured(),
        "attom": bool(settings.attom_keys),
        "property_api": bool(settings.property_api_keys),
        "propelio": bool(os.getenv("PROPELIO_EMAIL") and os.getenv("PROPELIO_PASSWORD")),
        "propwire": bool(os.getenv("PROPWIRE_EMAIL") and os.getenv("PROPWIRE_PASSWORD")),
        "google_maps": bool(os.getenv("GOOGLE_MAPS_API_KEY")),
    }


@app.get("/health/providers")
async def health_providers() -> Dict[str, Any]:
    """Return status of all configured LLM and scraper providers."""
    def _cb(svc):
        return all_breaker_states().get(svc, {"state": "closed"})

    # ─── LLM ──────────────────────────────────────────────────────────
    llm_providers = {
        "openai": {
            "configured": bool(settings.openai_api_key),
            "circuit_breaker": _cb("openai"),
        }
    }

    # ─── Scrapers ─────────────────────────────────────────────────────
    scraper_providers = {
        "attom": {
            "configured": bool(settings.attom_keys),
            "circuit_breaker": _cb("attom"),
        },
        "propelio": {
            "configured": bool(os.getenv("PROPELIO_EMAIL")),
            "circuit_breaker": _cb("propelio"),
        },
        "propwire": {
            "configured": bool(os.getenv("PROPWIRE_EMAIL")),
            "circuit_breaker": _cb("propwire"),
        },
        "property_api": {
            "configured": bool(settings.property_api_keys),
            "key_count": len(settings.property_api_keys) if settings.property_api_keys else 0,
            "circuit_breaker": _cb("property_api"),
        },
        "brightdata_proxy": {
            "configured": settings.brightdata_configured(),
            "circuit_breaker": _cb("brightdata"),
        },
    }

    # ─── Infra ────────────────────────────────────────────────────────
    infra = {
        "database": {
            "configured": bool(os.getenv("DATABASE_URL")),
            "circuit_breaker": _cb("database"),
        },
        "redis": {
            "configured": bool(os.getenv("REDIS_URL")),
            "backend": "redis_streams" if retry_queue._use_redis else "in_memory",
        },
        "s3_cache": {
            "configured": bool(os.getenv("S3_CACHE_BUCKET")),
            "bucket": os.getenv("S3_CACHE_BUCKET", ""),
        },
    }

    llm_any_configured = any(p["configured"] for p in llm_providers.values())
    llm_any_open = any(
        p["circuit_breaker"].get("state") == "open" for p in llm_providers.values()
    )

    return {
        "status": "ok",
        "llm": llm_providers,
        "llm_summary": {
            "any_configured": llm_any_configured,
            "any_open": llm_any_open,
            "mode": "openai_only",  # ← explicit flag for monitoring
        },
        "scrapers": scraper_providers,
        "infra": infra,
        "circuit_breakers_all": all_breaker_states(),
    }

# ─── Circuit breaker admin endpoints ────────────────────────────────────────


@app.get("/admin/circuit-breakers")
async def get_circuit_breakers() -> Dict[str, Any]:
    """Return status of all registered circuit breakers."""
    return {"circuit_breakers": all_breaker_states()}


@app.post("/admin/circuit-breakers/{service}/reset")
async def reset_circuit_breaker_endpoint(service: str) -> Dict[str, Any]:
    """Manually reset a named circuit breaker to CLOSED state."""
    ok = reset_breaker(service)
    if not ok:
        raise HTTPException(status_code=404, detail=f"No circuit breaker named '{service}'")
    return {"status": "reset", "service": service}


# ─── Spot handler status ──────────────────────────────────────────────────────


@app.get("/admin/spot")
async def get_spot_status() -> Dict[str, Any]:
    """Return Fargate Spot interruption status and active job list."""
    from .spot_handler import health_payload
    return health_payload()


# ─── Retry queue status ───────────────────────────────────────────────────────


@app.get("/admin/retry-queue")
async def get_retry_queue() -> Dict[str, Any]:
    """Return pending retries across all job types."""
    return {
        "backend": "redis_streams" if retry_queue._use_redis else "in_memory",
        "size": await retry_queue.size_async(),
        "pending": await retry_queue.pending_async(),
    }


# ─── Cache stats ──────────────────────────────────────────────────────────────


@app.get("/admin/cache")
async def get_cache_stats() -> Dict[str, Any]:
    """Return cache layer statistics (Redis + S3)."""
    return await cache.stats()


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
        masked = _re.sub(r"(?<=:)[^/:@]+(?=@)", "***", proxy_url)
    else:
        masked = None

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
            verify=True,
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
    base_user = _re.sub(r"-zone-.*", "", base_user)
    test_user = f"{base_user}-zone-{zone}"
    test_pw = settings.brightdata_password or ""
    test_url = f"http://{test_user}:{test_pw}@{settings.brightdata_host}:{port}"
    masked = f"http://{test_user}:***@{settings.brightdata_host}:{port}"

    try:
        async with _httpx.AsyncClient(
            proxy=test_url,
            timeout=20.0,
            follow_redirects=True,
            verify=True,
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


def _decrypt_password(ciphertext: str) -> str:
    """AES-256-CBC decrypt — matches Node.js crypto-util.ts exactly.

    Key   = sha256(ENCRYPTION_KEY or JWT_SECRET) → 32 bytes
    Format: ivHex ":" encryptedHex
    Padding: PKCS7 (same as Node's default for AES-CBC)
    """
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import padding as crypto_padding

    secret = os.getenv("ENCRYPTION_KEY") or os.getenv("JWT_SECRET")
    if not secret:
        raise ValueError("ENCRYPTION_KEY or JWT_SECRET env var is required for credential decryption")

    # If ciphertext is plain text (no ":" separator), return as-is.
    # Encrypted format is ivHex ":" encryptedHex from Node crypto-util.ts.
    if ":" not in ciphertext:
        return ciphertext

    key = hashlib.sha256(secret.encode()).digest()
    iv_hex, enc_hex = ciphertext.split(":", 1)
    iv = bytes.fromhex(iv_hex)
    encrypted = bytes.fromhex(enc_hex)

    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    padded = decryptor.update(encrypted) + decryptor.finalize()

    unpadder = crypto_padding.PKCS7(128).unpadder()
    return (unpadder.update(padded) + unpadder.finalize()).decode("utf-8")


@app.post("/session/propelio/test")
async def test_propelio_login(req: SessionTestRequest) -> Dict[str, Any]:
    """Test Propelio credentials by attempting a real login; returns success/error."""
    await _invalidate_session("propelio")
    try:
        email = _decrypt_password(req.email)
        password = _decrypt_password(req.password)
        await propelio_v2.test_login_credentials(email, password)
        return {"success": True, "detail": "Login OK"}
    except Exception as e:
        log.warning("Propelio login test failed: %s", str(e)[:120])
        return {"success": False, "error": str(e)[:300]}


@app.post("/session/propwire/test")
async def test_propwire_login(req: SessionTestRequest) -> Dict[str, Any]:
    """Test Propwire credentials by attempting a real login; returns success/error."""
    await _invalidate_session("propwire")
    try:
        email = _decrypt_password(req.email)
        password = _decrypt_password(req.password)
        await propwire.test_login_credentials(email, password)
        return {"success": True, "detail": "Login OK"}
    except Exception as e:
        log.warning("Propwire login test failed: %s", str(e)[:120])
        return {"success": False, "error": str(e)[:300]}


# ─── AI Research ────────────────────────────────────────────────────────────


class TrusteeDiscoveryRequest(BaseModel):
    state: str
    county: Optional[str] = ""
    max_results: int = 25


@app.post("/ai/trustees")
async def ai_trustees(req: TrusteeDiscoveryRequest) -> Dict[str, Any]:
    trustees = await ai_research.discover_trustees(
        state=req.state,
        county=req.county or "",
        max_results=req.max_results,
    )
    return {
        "state": req.state,
        "county": req.county,
        "trustees": trustees,
        "count": len(trustees),
    }


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
        lead = {
            "id": None,
            "address": req.address,
            "city": "",
            "state": "",
            "zip": "",
            "beds": None,
            "baths": None,
            "sqft": None,
            "year_built": None,
            "owner_name": None,
            "owner_llc": None,
        }

    job_id = _new_job("cash_buyers", req.model_dump())
    await db.create_job(
        job_id,
        "cash_buyers",
        req.model_dump(),
        lead_id=req.lead_id,
        campaign_id=req.campaign_id,
    )

    async def runner() -> None:
        try:
            cb = await _make_progress_cb(job_id)
            try:
                results = await asyncio.wait_for(
                    cash_buyers.find_cash_buyers(
                        lead,
                        max_buyers=req.max_buyers,
                        job_id=job_id,
                        progress_cb=cb,
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
                async with _get_metrics_lock():
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
                async with _get_metrics_lock():
                    METRICS["cash_buyers_timeout"] += 1

        except Exception as e:  # noqa: BLE001
            err = str(e)
            if is_transient(e) and retry_queue.enqueue(job_id, "cash_buyers", req.model_dump(), last_error=err):
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

    safe_create_task(runner(), name="cash_buyers")
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
    propelio_email: Optional[str] = None
    propelio_password: Optional[str] = None


@app.post("/scrape/propelio/cash-buyers")
async def scrape_propelio_cash_buyers(req: PropelioCashBuyersRequest) -> Dict[str, Any]:
    """Start an authenticated Propelio cash-buyer search. Returns job_id immediately."""
    job_id = _new_job("propelio_cash_buyers", req.model_dump())
    await db.create_job(
        job_id,
        "propelio_cash_buyers",
        req.model_dump(),
        lead_id=req.lead_id,
        campaign_id=req.campaign_id,
    )
    safe_create_task(_run_propelio_cash_buyers(job_id, req.model_dump()), name="propelio_cash_buyers")
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
    propwire_email: Optional[str] = None
    propwire_password: Optional[str] = None


@app.post("/scrape/propwire/property")
async def scrape_propwire_property(req: PropwireQueryRequest) -> Dict[str, Any]:
    """Fetch Propwire property details for an address or URL."""
    try:
        return await propwire.fetch_property(req.query)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:300])


@app.post("/scrape/comps")
async def scrape_comps(req: CompsRequest) -> Dict[str, Any]:
    """Fetch comparable sales for an address.

    Source priority:
      1. Propelio V2 (authenticated) — if PROPELIO_EMAIL + PROPELIO_PASSWORD are set
      2. Propwire (authenticated) — fallback if Propelio is unconfigured or returns nothing

    Returns: { address, count, comps, source }
    """
    comps: List[Dict[str, Any]] = []

    # 1. Try Propelio V2 ───────────────────────────────────────────────────────
    propelio_email = os.getenv("PROPELIO_EMAIL")
    propelio_password = os.getenv("PROPELIO_PASSWORD")
    if propelio_email and propelio_password:
        try:
            prop = await propelio_v2.search_property(req.address)
            property_id = prop.get("property_id") if prop else None
            if property_id:
                comps = await propelio_v2.fetch_comps(
                    property_id, radius_miles=req.radius_miles
                )
                if comps:
                    log.info("scrape_comps: Propelio returned %d comps for %s", len(comps), req.address[:60])
                    return {"address": req.address, "count": len(comps), "comps": comps, "source": "propelio"}
        except Exception as e:
            log.warning("scrape_comps: Propelio V2 failed for %s: %s", req.address[:60], str(e)[:200])

    # 2. Propwire fallback ─────────────────────────────────────────────────────
    try:
        comps = await propwire.fetch_comps(req.address, max_results=req.max_results)
        if comps:
            log.info("scrape_comps: Propwire returned %d comps for %s", len(comps), req.address[:60])
        return {"address": req.address, "count": len(comps), "comps": comps, "source": "propwire"}
    except Exception as e:
        log.warning("scrape_comps: Propwire also failed for %s: %s", req.address[:60], str(e)[:200])

    return {"address": req.address, "count": 0, "comps": [], "source": "none"}


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
async def scrape_propwire_cash_buyers_nearby(
    req: PropwireCashBuyersNearbyRequest,
) -> Dict[str, Any]:
    """Start an authenticated Propwire cash-buyer search nearby an address. Returns job_id."""
    job_id = _new_job("propwire_cash_buyers", req.model_dump())
    await db.create_job(
        job_id,
        "propwire_cash_buyers",
        req.model_dump(),
        lead_id=req.lead_id,
        campaign_id=req.campaign_id,
    )
    safe_create_task(_run_propwire_cash_buyers(job_id, req.model_dump()), name="propwire_cash_buyers")
    return {"job_id": job_id, "status": "queued", "lead_id": req.lead_id}


# ─── Satellite Drive-For-Dollars ─────────────────────────────────────────────


class SatelliteDFDRequest(BaseModel):
    zip: str = ""
    city: str = ""
    state: str = ""
    min_score: int = Field(
        30,
        ge=0,
        le=100,
        description="Minimum distress score 0-100 to include in results",
    )
    max_results: int = Field(50, ge=1, le=200)
    use_ai_scoring: bool = True


@app.post("/ai/satellite-dfd")
async def satellite_dfd_scan(req: SatelliteDFDRequest) -> Dict[str, Any]:
    """SkyDrive-style AI distress scan — starts a background job and returns immediately.

    Returns {"job_id": "...", "status": "queued"} so the caller can poll
    GET /jobs/{job_id} for progress/result.  This prevents Railway's 60s HTTP
    timeout from killing long-running scans.
    """
    if not (req.zip or (req.city and req.state)):
        raise HTTPException(status_code=400, detail="Provide zip or city+state")
    params = {
        "zip": req.zip,
        "city": req.city,
        "state": req.state,
        "min_score": req.min_score,
        "max_results": req.max_results,
        "use_ai_scoring": req.use_ai_scoring,
    }
    job_id = _new_job("satellite_dfd", params)
    asyncio.create_task(_run_satellite_dfd(job_id, params), name=f"satellite_dfd_{job_id}")
    return {"job_id": job_id, "status": "queued"}


async def _run_satellite_dfd(job_id: str, params: Dict[str, Any]) -> None:
    """Background worker for satellite DFD scans."""
    register_job(job_id)
    try:
        _set_status(job_id, "running", progress=5)
        result = await asyncio.wait_for(
            satellite_dfd.scan_area(
                zip_code=params.get("zip", ""),
                city=params.get("city", ""),
                state=params.get("state", ""),
                min_score=params.get("min_score", 30),
                max_results=params.get("max_results", 50),
                use_ai_scoring=params.get("use_ai_scoring", True),
            ),
            timeout=300,  # 5-minute hard cap
        )
        _set_status(job_id, "done", progress=100, result=result)
        await job_store.set_job(job_id, _jobs[job_id])
    except asyncio.TimeoutError:
        _set_status(job_id, "failed", error="Scan timed out after 5 minutes")
        await job_store.set_job(job_id, _jobs[job_id])
    except Exception as e:
        log.error("satellite_dfd job %s failed: %s", job_id, str(e)[:200])
        _set_status(job_id, "failed", error=str(e))
        await job_store.set_job(job_id, _jobs[job_id])
    finally:
        unregister_job(job_id)


# ─── Google Maps / Google Search / Bulk lead-scraper endpoints ───────────────
# These endpoints give the Node API server a Playwright-primary route so it can
# call tryEngine("/google-maps", …) and get real Places API data instead of
# immediately falling back to a direct fetch.


@app.post("/google-maps")
async def google_maps_scrape(req: GoogleMapsRequest) -> Dict[str, Any]:
    """Search Google Maps via Playwright (primary) or Google Places API (fallback)."""
    results: List[Dict[str, Any]] = []
    limit = min(int(req.maxResults), 200)
    throttle = float(os.getenv("GOOGLE_SEARCH_THROTTLE", "0.5"))

    # ── Primary: Playwright-based Google Maps scraping (no API key needed) ────
    async with _get_scraper_sem():
        for keyword in req.keywords[:5]:
            for location in req.locations[:10]:
                if len(results) >= limit:
                    break
                query_str = f"{keyword} near {location}".replace(" ", "+")
                url = f"https://www.google.com/maps/search/{query_str}"
                try:
                    from .http_client import fetch_html

                    html = await fetch_html(url, render=True)
                    from bs4 import BeautifulSoup

                    soup = BeautifulSoup(html, "lxml")
                    # Google Maps result cards — stable enough class fragments
                    for item in soup.select("[class*='Nv2PK']")[:25]:
                        name_el = item.select_one("[class*='fontHeadlineSmall'], [class*='qBF1Pd']")
                        addr_el = item.select_one("[class*='W4Efsd']:last-child")
                        rating_el = item.select_one("[class*='MW4etd']")
                        cat_el = item.select_one("[class*='W4Efsd']:first-child [class*='uEubGf']")
                        if name_el:
                            results.append(
                                {
                                    "name": name_el.get_text(strip=True),
                                    "category": cat_el.get_text(strip=True) if cat_el else "",
                                    "address": addr_el.get_text(strip=True)[:120] if addr_el else "",
                                    "phone": "",
                                    "website": "",
                                    "rating": rating_el.get_text(strip=True) if rating_el else "",
                                    "reviews": "",
                                    "keyword": keyword,
                                    "location": location,
                                    "source": "Google Maps (Playwright)",
                                }
                            )
                        if len(results) >= limit:
                            break
                    await asyncio.sleep(throttle)
                except Exception as e:
                    log.warning(
                        "Google Maps Playwright failed for '%s near %s': %s",
                        keyword,
                        location,
                        e,
                    )
                    continue

    # ── Fallback: Google Places Text Search API (when Playwright yields nothing) ──
    if not results:
        gkey = os.environ.get("GOOGLE_MAPS_API_KEY", "")
        if gkey:
            import httpx as _httpx

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
                            for place in data.get("results") or []:
                                if len(results) >= limit:
                                    break
                                results.append(
                                    {
                                        "name": place.get("name", ""),
                                        "category": ", ".join((place.get("types") or [])[:3]),
                                        "address": place.get("formatted_address", ""),
                                        "phone": "",
                                        "website": "",
                                        "rating": place.get("rating", ""),
                                        "reviews": place.get("user_ratings_total", ""),
                                        "keyword": keyword,
                                        "location": location,
                                        "source": "Google Places API",
                                    }
                                )
                        except Exception as e:
                            log.warning(
                                "Google Places API failed for '%s near %s': %s",
                                keyword,
                                location,
                                e,
                            )

    if not results:
        raise HTTPException(
            status_code=503,
            detail="Google Maps scrape returned no results — Playwright and Places API both unavailable",
        )

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
                    href = str(a.get("href", "") or "")
                    if not href.startswith("http") or "google.com" in href:
                        continue
                    title = a.get_text(strip=True)
                    if not title or len(title) < 3:
                        continue
                    results.append(
                        {
                            "name": title[:120],
                            "website": href,
                            "keyword": keyword,
                            "location": location,
                            "source": "Google Search (Playwright)",
                        }
                    )
                    if len(results) >= limit:
                        break
            except Exception as e:
                log.warning(
                    "Google Search Playwright failed for '%s %s': %s",
                    keyword,
                    location,
                    e,
                )
                continue
            await asyncio.sleep(float(os.getenv("GOOGLE_SEARCH_THROTTLE", "0.5")))

    if not results:
        raise HTTPException(
            status_code=503,
            detail="Browser scrape returned no results — Playwright may be unavailable",
        )

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
    city = (req.city or "").strip()
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
            {
                "stateAbbreviation": state,
                **({"city": city} if city else {}),
                "pageSize": min(limit, 100),
                "pageNumber": 1,
            },
        ),
        (
            "GET",
            "https://directories.apps.realtor/api/memberSearch",
            {
                "stateAbbreviation": state,
                **({"city": city} if city else {}),
                "pageSize": min(limit, 100),
            },
        ),
        (
            "GET",
            "https://directories.apps.realtor/api/v1/members",
            {
                "stateAbbreviation": state,
                **({"city": city} if city else {}),
                "take": min(limit, 100),
                "skip": 0,
            },
        ),
    ]

    results: List[Dict[str, Any]] = []

    async with _httpx.AsyncClient(timeout=25, headers=headers, follow_redirects=True) as client:
        for method, url, params in api_patterns:
            try:
                r = await client.request(method, url, params=params)
                if r.status_code != 200:
                    log.debug("NAR API %s → HTTP %d", url, r.status_code)
                    continue
                data = r.json()
                # Various key names seen across NAR API versions
                members: List[Any] = (
                    data.get("members") or data.get("results") or data.get("data") or data.get("items") or []
                )
                if not members:
                    continue
                for m in members[:limit]:
                    first = m.get("firstName", "")
                    last = m.get("lastName", "")
                    full = m.get("fullName") or m.get("name") or (f"{first} {last}".strip() if first or last else "")
                    results.append(
                        {
                            "name": full,
                            "state": state,
                            "city": m.get("city") or m.get("officeCity") or city,
                            "phone": m.get("phoneNumber") or m.get("phone") or m.get("cellPhone") or "",
                            "email": m.get("email") or m.get("emailAddress") or "",
                            "office": m.get("officeName") or m.get("brokerage") or "",
                            "memberType": m.get("memberType") or m.get("designations") or "REALTOR®",
                            "nrdsId": m.get("nrdsId") or m.get("memberId") or "",
                            "profileUrl": (
                                f"https://directories.apps.realtor/memberProfile?nrdsId={m['nrdsId']}"
                                if m.get("nrdsId")
                                else ""
                            ),
                            "source": "NAR Directory (Python Engine)",
                        }
                    )
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
    mode: str = "agents"  # agents | listings | fsbo
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

    city = req.city.strip()
    state = req.state.upper().strip()
    mode = req.mode.lower()
    limit = min(int(req.maxResults), 100)

    # Build the Zillow URL slug and target
    slug = f"{city.lower().replace(' ', '-')}-{state.lower()}"
    url_map = {
        "agents": f"https://www.zillow.com/professionals/real-estate-agents/{slug}/",
        "listings": f"https://www.zillow.com/homes/for_sale/{slug}_rb/",
        "fsbo": f"https://www.zillow.com/homes/fsbo/{slug}_rb/",
    }
    target_url = url_map.get(mode, url_map["agents"])

    results: List[Dict[str, Any]] = []

    try:
        async with browser_context("zillow") as ctx:
            page = await ctx.new_page()
            await page.set_extra_http_headers(
                {
                    "Accept-Language": "en-US,en;q=0.9",
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                    ),
                }
            )
            await page.goto(target_url, wait_until="domcontentloaded", timeout=45000)
            await page.wait_for_timeout(2500)

            # Extract __NEXT_DATA__ JSON (Zillow is Next.js)
            next_data_raw = await page.evaluate(
                "() => { const el = document.getElementById('__NEXT_DATA__'); " "return el ? el.textContent : null; }"
            )
            if not next_data_raw:
                # Fall back: try window.__PRELOADED_STATE__
                next_data_raw = await page.evaluate("() => JSON.stringify(window.__PRELOADED_STATE__ || null)")
            await page.close()

    except Exception as e:
        log.warning("Zillow Playwright failed: %s", str(e)[:200])
        raise HTTPException(status_code=503, detail=f"Zillow Playwright scrape failed: {str(e)[:200]}")

    if not next_data_raw:
        raise HTTPException(
            status_code=503,
            detail="Zillow returned no __NEXT_DATA__ — possibly blocked by DataDome",
        )

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
                        (x.get("formattedData", "") for x in pd if label in (x.get("label") or "").lower()),
                        "",
                    )

                results.append(
                    {
                        "name": c.get("cardTitle", ""),
                        "sales12mo": _stat("sales last 12"),
                        "priceRange": _stat("price range"),
                        "profileUrl": c.get("cardActionLink", ""),
                        "isTopAgent": "Yes" if c.get("isTopAgent") else "No",
                        "city": city,
                        "state": state,
                        "source": "Zillow Agents (Python Engine)",
                    }
                )
            else:
                results.append(
                    {
                        "name": c.get("fullName") or c.get("displayName") or c.get("name", ""),
                        "brokerage": c.get("businessName") or c.get("brokerageName", ""),
                        "phone": c.get("phone") or c.get("phoneNumber", ""),
                        "city": c.get("location", {}).get("city", city),
                        "state": c.get("location", {}).get("stateCode", state),
                        "rating": str(c.get("rating") or c.get("reviewStats", {}).get("averageRating", "")),
                        "reviews": str(c.get("reviewCount") or c.get("reviewStats", {}).get("totalReviewCount", "")),
                        "activeListings": str(c.get("activeListingCount", "")),
                        "profileUrl": ("https://www.zillow.com" + c["profileUrl"]) if c.get("profileUrl") else "",
                        "source": "Zillow Agents (Python Engine)",
                    }
                )

    elif mode in ("listings", "fsbo"):
        # __NEXT_DATA__ listing results
        search_results = (
            page_props.get("searchPageState", {}).get("cat1", {}).get("searchResults", {}).get("listResults", [])
        ) or page_props.get("searchResults", {}).get("listResults", [])

        for prop in search_results[:limit]:
            results.append(
                {
                    "address": prop.get("address", ""),
                    "price": prop.get("price") or prop.get("unformattedPrice", ""),
                    "beds": str(prop.get("beds", "")),
                    "baths": str(prop.get("baths", "")),
                    "sqft": str(prop.get("area", "")),
                    "daysOnMarket": str(prop.get("daysOnMarket", "")),
                    "city": city,
                    "state": state,
                    "zillowUrl": prop.get("detailUrl", ""),
                    "zpid": str(prop.get("zpid", "")),
                    "source": f"Zillow {mode.upper()} (Python Engine)",
                }
            )

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
                    zip_code=req.zip,
                    county_key=req.county_key,
                    state=req.state,
                    categories=req.categories,
                    source_keys=req.source_keys,
                    job_id=job_id,
                    campaign_id=req.campaign_id,
                    progress_cb=cb,
                ),
                timeout=900,
            )
            _set_status(job_id, "done", progress=100, result=listings)
            await db.update_job(
                job_id,
                status="done",
                progress=100,
                result_count=len(listings),
                completed=True,
            )
            async with _get_metrics_lock():
                METRICS["distressed_success"] += 1
        except asyncio.TimeoutError:
            log.error("Distressed job %s timed out after 900s", job_id)
            _set_status(job_id, "failed", error="timeout_exceeded")
            await db.update_job(job_id, status="failed", error="timeout_exceeded", completed=True)
            async with _get_metrics_lock():
                METRICS["distressed_timeout"] += 1
        except Exception as e:
            err = str(e)
            if is_transient(e) and retry_queue.enqueue(job_id, "distressed", req.model_dump(), last_error=err):
                log.warning(
                    "Distressed job %s transient failure — queued for retry: %s",
                    job_id,
                    err[:80],
                )
                _set_status(job_id, "retry_pending", error=err)
                await db.update_job(job_id, status="retry_pending", error=err)
            else:
                log.exception("Distressed job %s failed (fatal)", job_id)
                _set_status(job_id, "failed", error=err)
                await db.update_job(job_id, status="failed", error=err, completed=True)
                async with _get_metrics_lock():
                    METRICS["distressed_failed"] += 1

    safe_create_task(runner(), name="distressed")
    return {"job_id": job_id, "status": "queued"}


# ─── Skip-trace ──────────────────────────────────────────────────────────────


@app.post("/scrape/skip-trace")
async def scrape_skip_trace(req: SkipTraceRequest) -> Dict[str, Any]:
    """Synchronous skip-trace — small + fast."""
    try:
        return await skip_trace.trace(
            req.name,
            llc=req.llc,
            address=req.address,
            state=req.state,
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
    params = row.get("params") or {}
    if isinstance(params, str):
        import json as _json

        try:
            params = _json.loads(params)
        except Exception:
            params = {}

    if job_type not in (
        "cash_buyers",
        "distressed",
        "propelio_cash_buyers",
        "propwire_cash_buyers",
    ):
        raise HTTPException(
            status_code=400,
            detail=f"Manual retry not supported for job_type={job_type}",
        )

    retry_queue.enqueue(job_id, job_type, params, attempt=0, last_error="manual_retry_requested")
    _set_status(job_id, "retry_pending")
    await db.update_job(job_id, status="retry_pending", error="manual_retry_requested")

    return {
        "job_id": job_id,
        "status": "retry_pending",
        "message": "Job re-queued — will execute within 30 seconds",
    }


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
    city: str = Field(..., description="Target city, e.g. 'Orlando'")
    state: str = Field(..., description="Two-letter state code, e.g. 'FL'")
    listing_type: str = Field("for_sale", description="'for_sale' | 'sold' | 'pending'")
    site: str = Field("zillow", description="'zillow' | 'realtor.com' | 'redfin' | 'all'")
    limit: int = Field(5, ge=1, le=20)
    do_skip_trace: bool = Field(True, description="Run free OSINT skip trace per property")
    do_dnc_check: bool = Field(True, description="Run Twilio Lookup for DNC/carrier flags")
    save_to_crm: bool = Field(False, description="Persist results to cash_buyer_matches table")
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

    try:
        # Step 1: Scrape listings with runtime cap
        await cb(5, f"Scraping {listing_type} listings in {city}, {state}…")
        if site == "all":
            listings = await asyncio.wait_for(
                homeharvest_scraper.scrape_multi_site(city, state, listing_type=listing_type, limit_per_site=limit),
                timeout=900,
            )
        else:
            listings = await asyncio.wait_for(
                homeharvest_scraper.scrape_foreclosures(city, state, listing_type=listing_type, site=site, limit=limit),
                timeout=900,
            )

        if not listings:
            summary = {
                "count": 0,
                "listings": [],
                "markdown_table": "_No listings found._",
            }
            _set_status(job_id, "done", progress=100, result=summary)
            await db.update_job(job_id, status="done", progress=100, result_count=0, completed=True)
            async with _get_metrics_lock():
                METRICS["foreclosure_success"] += 1
            return

        await cb(25, f"Found {len(listings)} listings — estimating equity…")

        # Step 2: Estimate equity
        enriched = []
        for listing in listings[:limit]:
            est_value = listing.get("estimated_value") or listing.get("list_price") or 0
            estimated_equity = round(float(est_value) * 0.80) if est_value else None
            enriched.append({**listing, "estimated_equity": estimated_equity})

        # Step 3: Skip-trace + DNC
        results = []
        skip_step = max(1, 50 // max(len(enriched), 1))
        for i, prop in enumerate(enriched):
            pct = 30 + i * skip_step
            street = prop.get("street") or prop.get("address", "").split(",")[0]
            await cb(pct, f"Skip-tracing {street}… ({i+1}/{len(enriched)})")

            if do_skip_trace and street:
                try:
                    trace = await osint_skip_trace.trace_by_address(
                        street,
                        prop.get("city", city),
                        prop.get("state", state),
                        owner_name=prop.get("owner_name"),
                        do_dnc_check=do_dnc_check,
                    )
                    prop = {**prop, **trace}
                except Exception as e:
                    log.warning("Skip-trace failed for %s: %s", street, e)
                    prop = {
                        **prop,
                        "phones": [],
                        "emails": [],
                        "verified_mobile_count": 0,
                        "verified_email_count": 0,
                    }
            else:
                prop = {
                    **prop,
                    "phones": [],
                    "emails": [],
                    "verified_mobile_count": 0,
                    "verified_email_count": 0,
                }

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
                    _pool = await safe_get_pool()
                    async with _pool.acquire() as _conn:
                        await _conn.execute(
                            """INSERT INTO cash_buyer_matches
                               (lead_id, job_id, buyer_name, buyer_type, match_score, match_reasons,
                                city, state, zip, mailing_address, phones, emails, principals,
                                classification_reason, source, raw_data)
                               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)""",
                            None,
                            job_id,
                            r.get("owner_name") or "Unknown Owner",
                            "pre_foreclosure",
                            50,
                            _json.dumps(["homeharvest_scrape", "osint_skip_trace"]),
                            r.get("city", city),
                            r.get("state", state),
                            r.get("zip"),
                            r.get("address"),
                            _json.dumps([p["number"] if isinstance(p, dict) else str(p) for p in phones]),
                            _json.dumps([e["email"] if isinstance(e, dict) else str(e) for e in emails]),
                            _json.dumps(r.get("resident_names") or []),
                            f"Pre-foreclosure listing in {city}, {state} via HomeHarvest",
                            "homeharvest",
                            _json.dumps(
                                {
                                    "list_price": r.get("list_price"),
                                    "estimated_equity": r.get("estimated_equity"),
                                    "beds": r.get("beds"),
                                    "baths": r.get("baths"),
                                    "sqft": r.get("sqft"),
                                    "year_built": r.get("year_built"),
                                    "listing_url": r.get("listing_url"),
                                    "days_on_mls": r.get("days_on_mls"),
                                }
                            ),
                        )
                    saved_count += 1
                except Exception as e:
                    log.warning("CRM save failed for %s: %s", r.get("address"), e)

        await cb(100, "Done")
        summary = {
            "count": len(results),
            "saved_to_crm": saved_count,
            "listings": results,
            "markdown_table": markdown_table,
            "city": city,
            "state": state,
        }
        _set_status(job_id, "done", progress=100, result=summary)
        await db.update_job(
            job_id,
            status="done",
            progress=100,
            result_count=len(results),
            completed=True,
        )
        async with _get_metrics_lock():
            METRICS["foreclosure_success"] += 1

    except asyncio.TimeoutError:
        log.error("Foreclosure job %s timed out after 900s", job_id)
        _set_status(job_id, "failed", error="timeout_exceeded")
        await db.update_job(job_id, status="failed", error="timeout_exceeded", completed=True)
        async with _get_metrics_lock():
            METRICS["foreclosure_timeout"] += 1
    except Exception as e:
        log.exception("Foreclosure lead-gen job %s failed: %s", job_id, e)
        _set_status(job_id, "failed", error=str(e))
        await db.update_job(job_id, status="failed", error=str(e), completed=True)
        async with _get_metrics_lock():
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
    from .scrapers._browser_session import (
        _find_chromium_executable,
        _ensure_nix_ld_path,
    )

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
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--no-zygote",
                    "--disable-gpu",
                    "--disable-software-rasterizer",
                ],
            )
            page = await browser.new_page()
            await page.goto("https://example.com", wait_until="domcontentloaded", timeout=20000)
            title = await page.title()
            await browser.close()
            result.update(
                {
                    "status": "ok",
                    "title": title,
                    "latency_ms": int((_time.monotonic() - t0) * 1000),
                }
            )
        finally:
            await pw.stop()
    except Exception as e:
        result.update(
            {
                "status": "error",
                "error": str(e)[:500],
                "latency_ms": int((_time.monotonic() - t0) * 1000),
            }
        )

    return result


@app.get("/debug/satellite")
async def debug_satellite() -> Dict[str, Any]:
    """Show satellite DFD config: Google Maps API status, GCV availability."""
    from .scrapers.satellite_dfd import _google_key, _get_gcv_key

    gkey = _google_key()
    gcv_key = _get_gcv_key()
    return {
        "google_maps_configured": bool(gkey),
        "google_maps_key_prefix": (gkey[:8] + "…") if gkey else None,
        "gcv_configured": bool(gcv_key),
        "satellite_endpoint": "POST /ai/satellite-dfd",
        "required_params": {"city": "str", "state": "str (or zip: str)"},
    }


# ─── Phone Finder ─────────────────────────────────────────────────────────────


class PhoneFinderLookupRequest(BaseModel):
    name: str = Field(..., description="Company or person name")
    address: str = Field(default="", description="Address for disambiguation")


@app.post("/phone-finder/lookup")
async def phone_finder_lookup(req: PhoneFinderLookupRequest) -> Dict[str, Any]:
    """Find phone numbers for a company/LLC via Google Search and Google Maps Places API."""
    return await _phone_finder_lookup(req.name, req.address)


# ─── Foreclosure Lead-Gen route ───────────────────────────────────────────────


async def _phone_finder_lookup(name: str, address: str) -> Dict[str, Any]:
    """Internal: search Google and Google Maps for a business phone number."""
    phones: List[str] = []
    source = "none"
    phone_re = re.compile(r"\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}")

    # ── 1. Google Maps Places Text Search API (most reliable) ─────────────────
    maps_key = os.getenv("GOOGLE_MAPS_API_KEY", "")
    if maps_key and name:
        query = f"{name} {address}".strip()
        try:
            import httpx as _httpx
            async with _httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    "https://maps.googleapis.com/maps/api/place/textsearch/json",
                    params={"query": query, "key": maps_key},
                )
                data = r.json()
                place_ids = [p.get("place_id") for p in data.get("results", [])[:3] if p.get("place_id")]

            for place_id in place_ids:
                if phones:
                    break
                async with _httpx.AsyncClient(timeout=10) as client:
                    r = await client.get(
                        "https://maps.googleapis.com/maps/api/place/details/json",
                        params={
                            "place_id": place_id,
                            "fields": "formatted_phone_number,international_phone_number,name",
                            "key": maps_key,
                        },
                    )
                    detail = r.json().get("result", {})
                    for field in ("formatted_phone_number", "international_phone_number"):
                        val = detail.get(field, "")
                        if val:
                            phones.append(val)
                            source = "Google Maps"
        except Exception as exc:
            log.debug("Google Maps Places API error for '%s': %s", name, exc)

    # ── 2. Google Search fallback (scrape search result snippets) ─────────────
    if not phones and name:
        city_state = " ".join(address.split(",")[-2:]).strip() if "," in address else address
        query_str = f"{name} phone number {city_state}".replace(" ", "+")
        url = f"https://www.google.com/search?q={query_str}&num=5"
        try:
            from .http_client import fetch_html

            html = await fetch_html(url, render=False)
            found = phone_re.findall(html)
            seen: set[str] = set()
            for p in found:
                normalized = re.sub(r"[-.\s]", "-", p.strip())
                if normalized not in seen:
                    phones.append(normalized)
                    seen.add(normalized)
                if len(phones) >= 3:
                    break
            if phones:
                source = "Google Search"
        except Exception as exc:
            log.debug("Google Search scrape error for '%s': %s", name, exc)

    return {"name": name, "address": address, "phones": phones[:5], "source": source}


@app.post("/lead-gen/foreclosure")
async def lead_gen_foreclosure(req: ForeclosureLeadGenRequest) -> Dict[str, Any]:
    """Start chained foreclosure lead-gen pipeline. Returns job_id immediately."""
    job_id = _new_job("foreclosure_lead_gen", req.model_dump())
    await db.create_job(job_id, "foreclosure_lead_gen", req.model_dump(), campaign_id=req.campaign_id)

    # CRITICAL FIX: 30-min hard cap prevents infinite hang on dead LLM/scraper
    async def _timed_foreclosure():
        try:
            await asyncio.wait_for(
                _run_foreclosure_lead_gen(job_id, req.model_dump()),
                timeout=1800,
            )
        except asyncio.TimeoutError:
            log.error("foreclosure_lead_gen job %s timed out after 1800s", job_id)
            _set_status(job_id, "failed", error="timeout_exceeded")
            await db.update_job(job_id, status="failed", error="timeout_exceeded", completed=True)

    safe_create_task(_timed_foreclosure(), name="foreclosure_lead_gen")
    return {"job_id": job_id, "status": "queued", "city": req.city, "state": req.state}
