# TolipAI Scraper Engine — Critical Fix Specification

> **Generated:** 2026-05-26  
> **Last Updated:** 2026-05-26  
> **Target:** AWS Fargate `tolipai-scraper-engine-service-xop`  
> **Goal:** Stop 429 rate-limit bleeding, fix container permissions/SSL, prevent infinite hangs, and force OpenAI-only LLM usage.

---

## ✅ Implementation Status — All Fixes Applied

| Fix | File | Status |
|-----|------|--------|
| Fix 1: `/health` stops burning LLM credits | `workers/main.py` | ✅ Done |
| Fix 2A/B/C: Job runner 15-min timeouts | `workers/main.py` | ✅ Done |
| Fix 3: `_run_distressed` clean timeout | `workers/main.py` | ✅ Done |
| Fix 4: `_set_status` uses `create_task` + `_completed_at` | `workers/main.py` | ✅ Done |
| Fix 5: CloudWatch EMF reads METRICS under lock | `workers/main.py` | ✅ Done |
| Fix 6: `verify=False` → `verify=True` in debug proxy | `workers/main.py` | ✅ Done |
| Fix 7A/B: Job memory eviction every 5 min | `workers/main.py` | ✅ Done |
| Fix 8: Foreclosure endpoint 30-min timeout | `workers/main.py` | ✅ Done |
| Fix 9: `/health/providers` indentation bug | `workers/main.py` | ✅ Done |
| Fix 10: Dockerfile SSL certs + `useradd -m` + HOME/CRAWL4AI_DATA_DIR | `Dockerfile.fargate` | ✅ Done |
| Fix 11: Remove dead env vars from ECS task definition | AWS Console | ⚠️ Manual — see below |
| Fix 12: `llm.py` OpenAI-only rewrite | `workers/llm.py` | ✅ Done |

### Additional Fixes Applied (beyond original 12)

| Fix | File | Status |
|-----|------|--------|
| Remove ATTOM API from cash_buyers pipeline | `workers/cash_buyers.py` | ✅ Done |
| Remove ATTOM/ScraperAPI/ScrapingBee/Groq/Cerebras/Moonshot from config | `workers/config.py` | ✅ Done |
| Remove dead API key fields from `/health/keys` and `/health/providers` | `workers/main.py` | ✅ Done |
| `has_llm()` checks only `openai_api_key` | `workers/config.py` | ✅ Done |

### Fix 11 — AWS ECS Task Definition: Environment Variables to Remove

In the AWS Console → ECS → Task Definitions → create a new revision and **remove these environment variables**:

```
GROQ_API_KEY
CEREBRAS_API_KEY
TOGETHER_API_KEY
NVIDIA_API_KEY
OPENROUTER_API_KEY
MOONSHOT_KIMI_API_KEY
SCRAPERAPI_KEY (and _2, _3, _4)
SCRAPINGBEE_API_KEY (and _2, _3, _4)
ATTOM_API_KEY (and _2)
AI_INTEGRATIONS_OPENAI_API_KEY  (if set — Groq compat key, no longer needed)
AI_INTEGRATIONS_OPENAI_BASE_URL (if set — Groq base URL, no longer needed)
WEBSCRAPER_API_KEY              (scraper engine auth is via SCRAPER_API_KEY only)
```

**Must keep:**
```
OPENAI_API_KEY          — LLM (required)
SCRAPER_API_KEY         — Engine auth (required)
DATABASE_URL            — PostgreSQL (required)
BRIGHTDATA_USERNAME     — Residential proxy (required)
BRIGHTDATA_PASSWORD     — Residential proxy (required)
BRIGHTDATA_ZONE         — Proxy zone (if not embedded in username)
PROPELIO_EMAIL          — Propelio scraper (required)
PROPELIO_PASSWORD       — Propelio scraper (required)
PROPWIRE_EMAIL          — Propwire scraper (required)
PROPWIRE_PASSWORD       — Propwire scraper (required)
PROPERTY_API_KEY        — Skip-trace (optional but recommended)
REDIS_URL               — Retry queue (optional, falls back to in-memory)
S3_CACHE_BUCKET         — Response cache (optional)
```

---

---

## Prerequisites

Run these checks **before** applying fixes to confirm the current broken state:

```bash
# 1. Confirm Groq/Cerebras keys are still in the environment (they must be REMOVED after fixes)
grep -E "GROQ_API_KEY|CEREBRAS_API_KEY|NVIDIA_API_KEY" /proc/self/environ 2>/dev/null || echo "Keys not found in current process env"

# 2. Check if /home/scraper is writable (will fail with Permission denied)
touch /home/scraper/test_write 2>&1 || echo "CONFIRMED: /home/scraper not writable"
rm -f /home/scraper/test_write

# 3. Check CA certificates (will show outdated/missing if SSL errors occur)
python3 -c "import certifi; print('certifi path:', certifi.where())"

# 4. Check current health endpoint burning credits
curl -s http://localhost:8765/health | python3 -m json.tool | grep -E "latency_ms|status"
```

---

## Fix 1: `/health` Endpoint — Stop Burning LLM Credits

**File:** `workers/main.py`  
**Severity:** CRITICAL  
**Problem:** Every health check makes live API calls to Groq, Cerebras, Nvidia, OpenRouter, Moonshot, AND OpenAI. At 30s intervals = 720+ wasted requests/hour. This exhausts Groq's 1000 RPD limit.

### Step 1A — Replace the entire `/health` route

Find `@app.get("/health")` (~line 500) and replace the entire function with:

```python
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
```

### Step 1B — Remove dead LLM imports from `/health`

Inside the old `/health` function, **delete** these lines:

```python
# DELETE THESE IMPORTS from inside /health:
from .llm import _dead_providers, _rate_hits, _MAX_RATE_HITS
from .llm import _groq, _cerebras, _nvidia, _openrouter, _moonshot, _openai
```

Also delete the old `async def _probe_llm(...)` helper entirely.

---

## Fix 2: Retry Runners — Add 15-Minute Timeout to Prevent Infinite Hangs

**File:** `workers/main.py`  
**Severity:** CRITICAL  
**Problem:** When Groq/Cerebras are dead, `find_cash_buyers()` can retry internally forever. Background tasks never die, blocking Fargate Spot drain and new jobs.

### Step 2A — `_run_cash_buyers`

Replace the function body (keep the `register_job` wrapper and `finally` block):

```python
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
```

### Step 2B — `_run_propelio_cash_buyers`

Replace the function body:

```python
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
```

### Step 2C — `_run_propwire_cash_buyers`

Replace the function body:

```python
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
```

---

## Fix 3: `_run_distressed` — Remove Dead Partial-Results Code

**File:** `workers/main.py`  
**Severity:** CRITICAL  
**Problem:** `asyncio.wait_for` cancels the coroutine on timeout, so `listings` stays `[]`. The `if listings:` branch after timeout is dead code that never executes, misleading operators.

Replace the entire `_run_distressed` function:

```python
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
            _set_status(job_id, "failed", error="No listings found")
            await db.update_job(job_id, status="failed", error="No listings found", completed=True)
        return {"count": len(listings)}

    except Exception as e:
        log.error("distressed job %s failed: %s", job_id, str(e)[:120])
        _set_status(job_id, "failed", error=str(e))
        await db.update_job(job_id, status="failed", error=str(e), completed=True)
        return {"count": 0}
    finally:
        unregister_job(job_id)
```

---

## Fix 4: `_set_status` — Fix Deprecated `ensure_future` + Add Completion Timestamp

**File:** `workers/main.py`  
**Severity:** HIGH  
**Problem:** `asyncio.ensure_future` is deprecated since Python 3.10. Also, completed jobs never get an eviction timestamp, causing memory leaks.

Replace `_set_status`:

```python
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
```

---

## Fix 5: CloudWatch EMF — Fix Race Condition on `METRICS`

**File:** `workers/main.py`  
**Severity:** HIGH  
**Problem:** `_emit_cloudwatch_emf` reads `METRICS` dict without acquiring `_METRICS_LOCK`. Concurrent increments cause torn/corrupt snapshots.

Replace `_emit_cloudwatch_emf`:

```python
async def _emit_cloudwatch_emf() -> None:
    import json as _json
    import time as _time

    while True:
        await asyncio.sleep(60)
        if _shutting_down:
            break
        try:
            ts = int(_time.time() * 1000)
            active = len([j for j in _jobs.values() if j.get("status") == "running"])

            # FIX: Read under lock to prevent torn reads
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
```

---

## Fix 6: Debug Proxy Endpoints — Remove `verify=False` (Security)

**File:** `workers/main.py`  
**Severity:** HIGH  
**Problem:** `verify=False` disables SSL certificate validation, masking real SSL issues and creating a security vulnerability.

In **both** `/debug/proxy` and `/debug/proxy/zone`, change:

```python
# BEFORE (in both endpoints):
async with _httpx.AsyncClient(
    proxy=proxy_url,
    timeout=20.0,
    follow_redirects=True,
    verify=False,  # DANGEROUS
) as cli:

# AFTER (in both endpoints):
async with _httpx.AsyncClient(
    proxy=proxy_url,
    timeout=20.0,
    follow_redirects=True,
    verify=True,   # FIXED
) as cli:
```

---

## Fix 7: Memory Leak — Evict Completed Jobs After 1 Hour

**File:** `workers/main.py`  
**Severity:** HIGH  
**Problem:** `_jobs` dict grows forever. On Fargate Spot (running until SIGKILL), this leaks memory indefinitely.

### Step 7A — Add eviction helper near top of file (after `_get_metrics_lock`)

```python
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
```

### Step 7B — Start eviction task in `lifespan`

Inside `lifespan`, after `browser_pool.start()`, add:

```python
    # Job memory eviction (prevents unbounded growth)
    _evict_task = asyncio.create_task(_evict_old_jobs(), name="job_eviction")
```

And in the `yield` cleanup section, add:

```python
    _evict_task.cancel()
    await asyncio.gather(_evict_task, return_exceptions=True)
```

---

## Fix 8: Foreclosure Lead-Gen — Add 30-Minute Absolute Timeout

**File:** `workers/main.py`  
**Severity:** HIGH  
**Problem:** Only the scrape step has a 900s timeout. Skip-tracing 20 properties sequentially can take 20+ minutes. No absolute cap on the entire pipeline.

Replace the `@app.post("/lead-gen/foreclosure")` endpoint:

```python
@app.post("/lead-gen/foreclosure")
async def lead_gen_foreclosure(req: ForeclosureLeadGenRequest) -> Dict[str, Any]:
    """Start chained foreclosure lead-gen pipeline. Returns job_id immediately."""
    job_id = _new_job("foreclosure_lead_gen", req.model_dump())
    await db.create_job(job_id, "foreclosure_lead_gen", req.model_dump(), campaign_id=req.campaign_id)

    async def _run_with_timeout() -> None:
        try:
            await asyncio.wait_for(
                _run_foreclosure_lead_gen(job_id, req.model_dump()),
                timeout=1800,  # 30 minutes absolute max
            )
        except asyncio.TimeoutError:
            log.error("Foreclosure job %s killed after 30min absolute timeout", job_id)
            _set_status(job_id, "failed", error="absolute_timeout_30min")
            await db.update_job(job_id, status="failed", error="absolute_timeout_30min", completed=True)
            async with _get_metrics_lock():
                METRICS["foreclosure_timeout"] += 1

    safe_create_task(_run_with_timeout(), name="foreclosure_lead_gen")
    return {"job_id": job_id, "status": "queued", "city": req.city, "state": req.state}
```

---

## Fix 9: `/health/providers` — Fix Indentation + OpenAI-Only

**File:** `workers/main.py`  
**Severity:** HIGH  
**Problem:** The file has a 3-space indentation error (`   llm_providers`) that causes a syntax error. Also still references dead providers.

Replace the entire `/health/providers` route:

```python
@app.get("/health/providers")
async def health_providers() -> Dict[str, Any]:
    """
    Lightweight provider status endpoint.
    Reports configuration state and circuit-breaker health for every external
    provider without making any live LLM or database calls.
    """
    breakers: Dict[str, Any] = all_breaker_states()

    def _cb(name: str) -> Dict[str, Any]:
        state = breakers.get(name)
        if state is None:
            return {"state": "closed", "note": "no_data_yet"}
        return {
            "state": state.get("state", "unknown"),
            "failure_count": state.get("failure_count", 0),
            "last_failure": state.get("last_failure_at"),
        }

    # LLM: OPENAI ONLY
    llm_providers = {
        "openai": {
            "configured": bool(settings.openai_api_key),
            "model": settings.openai_model,
            "circuit_breaker": _cb("openai"),
        },
    }

    # Scrapers
    scraper_providers = {
        "propelio": {
            "configured": bool(
                os.getenv("PROPELIO_EMAIL") and os.getenv("PROPELIO_PASSWORD")
            ),
            "circuit_breaker": _cb("propelio"),
        },
        "propwire": {
            "configured": bool(
                os.getenv("PROPWIRE_EMAIL") and os.getenv("PROPWIRE_PASSWORD")
            ),
            "circuit_breaker": _cb("propwire"),
        },
        "attom": {
            "configured": bool(settings.attom_keys),
            "key_count": len(settings.attom_keys) if settings.attom_keys else 0,
            "circuit_breaker": _cb("attom"),
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

    # Infra
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
            "mode": "openai_only",
        },
        "scrapers": scraper_providers,
        "infra": infra,
        "circuit_breakers_all": breakers,
    }
```

---

## Fix 10: Dockerfile — Fix Permissions + SSL Certificates + Crawl4AI

**File:** `Dockerfile` (repo root)  
**Severity:** CRITICAL  
**Problem:** Container lacks CA certificates (SSL errors) and `/home/scraper` is not writable (Crawl4AI permission denied).

Replace your entire `Dockerfile` with:

```dockerfile
# Base
FROM python:3.11-slim

# System deps: ca-certificates fixes SSL errors
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    chromium \
    chromium-driver \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create scraper user and writable home
# Fixes: Crawl4AI unavailable: [Errno 13] Permission denied: '/home/scraper'
RUN groupadd -r scraper && useradd -r -g scraper -d /home/scraper -m scraper \
    && mkdir -p /home/scraper/.cache /home/scraper/.local \
    && chown -R scraper:scraper /home/scraper

# Python deps
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY . .
RUN chown -R scraper:scraper /app

# Run as scraper (non-root)
USER scraper
ENV HOME=/home/scraper
ENV CRAWL4AI_DATA_DIR=/home/scraper/.cache/crawl4ai

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "workers.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## Fix 11: ECS Task Definition — Environment Variables

**File:** AWS ECS Console / CLI (not in repo)  
**Severity:** CRITICAL  
**Problem:** Groq, Cerebras, Nvidia, etc. keys are still present, causing the health check and LLM router to attempt them.

### Step 11A — Delete these environment variables from the Fargate task definition:

- `GROQ_API_KEY`
- `CEREBRAS_API_KEY`
- `TOGETHER_API_KEY`
- `NVIDIA_API_KEY`
- `OPENROUTER_API_KEY`
- `MOONSHOT_API_KEY`

### Step 11B — Keep/Add these:

| Variable | Value |
|----------|-------|
| `OPENAI_API_KEY` | `sk-your-key-here` |
| `OPENAI_MODEL` | `gpt-4o-mini` (or `gpt-4o`) |
| `OPENAI_TIMEOUT` | `60` |
| `OPENAI_MAX_RETRIES` | `3` |
| `OPENAI_BACKOFF_BASE` | `2.0` |
| `CRAWL4AI_DATA_DIR` | `/tmp/crawl4ai` |
| `DATABASE_URL` | `postgresql://...` |
| `REDIS_URL` | `redis://...` |

### Step 11C — AWS CLI command to update service

```bash
# Force new deployment after task definition update
aws ecs update-service \
  --cluster TolipAI-scraper-cluster \
  --service tolipai-scraper-engine-service-xop \
  --force-new-deployment \
  --region us-east-1
```

---

## Fix 12: LLM Router — Force OpenAI-Only (if separate file exists)

**File:** `workers/llm.py` (or wherever your LLM client lives)  
**Severity:** CRITICAL  
**Problem:** Fallback chain cycles through Groq -> Cerebras -> Nvidia -> OpenAI, burning credits on dead providers before reaching OpenAI.

If you have a separate `llm.py`, replace the provider list with:

```python
# workers/llm.py — OpenAI-only router
import os
import time
import logging
from typing import Optional, List, Dict, Any
import openai
from openai import OpenAI

logger = logging.getLogger(__name__)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_TIMEOUT = int(os.getenv("OPENAI_TIMEOUT", "60"))
MAX_RETRIES = int(os.getenv("OPENAI_MAX_RETRIES", "3"))
BACKOFF_BASE = float(os.getenv("OPENAI_BACKOFF_BASE", "2.0"))

class LLMError(Exception):
    pass

class CircuitBreakerOpen(LLMError):
    pass

class CircuitBreaker:
    def __init__(self, name: str, failure_threshold: int = 5, recovery_timeout: int = 60):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failures = 0
        self.last_failure_time: Optional[float] = None
        self.open = False

    def call(self, fn, *args, **kwargs):
        if self.open:
            if self.last_failure_time and (time.time() - self.last_failure_time) > self.recovery_timeout:
                self.open = False
                self.failures = 0
                logger.info(f"Circuit breaker '{self.name}' half-open, retrying...")
            else:
                raise CircuitBreakerOpen(f"Circuit breaker '{self.name}' is OPEN")
        try:
            result = fn(*args, **kwargs)
            self.failures = 0
            return result
        except Exception as e:
            self.failures += 1
            self.last_failure_time = time.time()
            if self.failures >= self.failure_threshold:
                self.open = True
                logger.error(f"Circuit breaker '{self.name}' OPENED after {self.failures} failures")
            raise e

class LLMProvider:
    def __init__(self):
        if not OPENAI_API_KEY:
            raise LLMError("OPENAI_API_KEY is not set")
        self.client = OpenAI(
            api_key=OPENAI_API_KEY,
            timeout=OPENAI_TIMEOUT,
            max_retries=0,  # We handle retries manually
        )
        self.model = OPENAI_MODEL
        self.circuit_breaker = CircuitBreaker("openai", failure_threshold=5, recovery_timeout=60)

    def chat_completion(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.3,
        max_tokens: int = 2048,
        json_mode: bool = False,
    ) -> str:
        attempt = 0
        last_exception = None
        while attempt < MAX_RETRIES:
            try:
                return self.circuit_breaker.call(
                    self._raw_chat, messages, temperature, max_tokens, json_mode
                )
            except CircuitBreakerOpen:
                raise LLMError("OpenAI circuit breaker is open — stopping to prevent cascade failure")
            except openai.RateLimitError as e:
                wait = BACKOFF_BASE ** attempt
                logger.warning(f"OpenAI rate limited (attempt {attempt + 1}/{MAX_RETRIES}), backing off {wait}s...")
                time.sleep(wait)
                last_exception = e
            except (openai.APIError, openai.APITimeoutError, openai.InternalServerError) as e:
                wait = BACKOFF_BASE ** attempt
                logger.warning(f"OpenAI API error (attempt {attempt + 1}/{MAX_RETRIES}): {e}, retrying in {wait}s...")
                time.sleep(wait)
                last_exception = e
            except Exception as e:
                logger.error(f"OpenAI non-retryable error: {e}")
                raise LLMError(f"OpenAI call failed: {e}")
            attempt += 1
        raise LLMError(f"OpenAI failed after {MAX_RETRIES} attempts: {last_exception}")

    def _raw_chat(self, messages, temperature, max_tokens, json_mode):
        kwargs = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        response = self.client.chat.completions.create(**kwargs)
        content = response.choices[0].message.content
        if not content:
            raise LLMError("OpenAI returned empty content")
        return content

_llm: Optional[LLMProvider] = None

def get_llm() -> LLMProvider:
    global _llm
    if _llm is None:
        _llm = LLMProvider()
    return _llm

def llm_chat(
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.3,
    max_tokens: int = 2048,
    json_mode: bool = False,
) -> str:
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    return get_llm().chat_completion(
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        json_mode=json_mode,
    )
```

---

## Verification Commands (Run After Deploy)

```bash
# 1. Verify health check returns instantly without LLM latency
curl -s http://localhost:8765/health | python3 -m json.tool

# 2. Verify only OpenAI is configured
curl -s http://localhost:8765/health/providers | python3 -m json.tool | grep -A5 '"llm"'

# 3. Verify /home/scraper is writable inside container
docker exec <container_id> touch /home/scraper/test_write && echo "OK" || echo "FAIL"

# 4. Verify SSL works (no more CERTIFICATE_VERIFY_FAILED)
python3 -c "import urllib.request; urllib.request.urlopen('https://www.zillow.com')" && echo "SSL OK"

# 5. Check CloudWatch logs — should show ONLY api.openai.com, no groq/cerebras/nvidia 429s
aws logs tail /ecs/tolipai-scraper-engine-service-xop --follow --region us-east-1 | grep -E "429|groq|cerebras|nvidia|openai"

# 6. Run a distressed scrape and confirm it completes within 8 minutes
curl -X POST http://localhost:8765/scrape/distressed \
  -H "Content-Type: application/json" \
  -d '{"state":"OH","city":"Cleveland","zip":"44101"}'
```

---

## Expected Outcome After All Fixes

| Before | After |
|--------|-------|
| Groq 429: "Limit 1000, Used 1000" | Zero 429 errors |
| `Crawl4AI unavailable: Permission denied` | Crawl4AI writes to `/home/scraper/.cache` |
| `SSL: CERTIFICATE_VERIFY_FAILED` | SSL validates correctly |
| Health check burns 720 req/hour | Health check is free (DB ping only) |
| Jobs hang forever on dead LLM | Jobs timeout after 15 minutes |
| Memory grows unbounded | Old jobs evicted after 1 hour |
| `_run_distressed` partial results never saved | Clean timeout failure with correct error |
| `verify=False` in debug endpoints | SSL verification enforced |
