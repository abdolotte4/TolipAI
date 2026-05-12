# Replit Agent Prompt #1: P0 — Security & Critical Runtime Bugs

> **Priority:** P0 (Fix First) — These are security vulnerabilities and runtime crashes that must be fixed before any other work.
> **Target:** AWS Fargate deployment
> **Repos:** `Agawish24/Python-Worker` + `Agawish24/Digor`

---

## PYTHON — Security (4 bugs)

### 1. `workers/http_client.py` — SSL Verification Disabled
**Bug:** `_ssl_ctx()` returns `ssl.CERT_NONE` + `check_hostname = False`. All HTTP fetches accept any certificate. MITM vulnerability.

**Fix:**
```python
def _ssl_ctx(verify: bool = True) -> Any:
    if verify:
        return ssl.create_default_context()
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx
```
Update `fetch_direct()` default to `verify_ssl=True`.

### 2. `workers/main.py` — `/debug/env` Leaks Secret Lengths
**Bug:** Returns `{"set": true, "length": 42}` for every env var including passwords.

**Fix:** Remove the endpoint entirely.
```python
# DELETE this endpoint:
# @app.get("/debug/env")
# async def debug_env() -> Dict[str, Any]:
#     ...
```

### 3. `workers/main.py` — CORS Defaults to `["*"]`
**Bug:** `_cors_origins` defaults to `["*"]` if `CORS_ORIGINS` env var is not set.

**Fix:**
```python
_cors_origins = (
    os.getenv("CORS_ORIGINS", "").split(",")
    if os.getenv("CORS_ORIGINS")
    else []  # was ["*"]
)
```

### 4. `workers/main.py` — `/admin/*` Uses Same Key as Public
**Bug:** Admin endpoints use `SCRAPER_API_KEY`. No separation.

**Fix:**
```python
async def _security_middleware(request: Request, call_next):
    path = request.url.path
    api_key = request.headers.get("X-API-Key", "")

    if path.startswith("/admin/"):
        expected = os.getenv("ADMIN_API_KEY", "")
        if not expected or api_key != expected:
            return JSONResponse({"detail": "Forbidden"}, status_code=403)
    else:
        expected = os.getenv("SCRAPER_API_KEY", "")
        if expected and api_key != expected:
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)

    return await call_next(request)
```

---

## PYTHON — Runtime (6 bugs)

### 5. `workers/http_client.py` — No Connection Pooling
**Bug:** `fetch_direct()` creates a new `httpx.AsyncClient` on every call.

**Fix:**
```python
async def fetch_direct(url: str, *, use_proxy: bool = True, verify_ssl: bool = True) -> Any:
    proxy = settings.proxy_url() if use_proxy else None
    headers = _build_headers(url)
    ssl_context = _ssl_ctx(verify_ssl)

    client = _persistent_client or httpx.AsyncClient(
        timeout=settings.request_timeout,
        proxy=proxy,
        follow_redirects=True,
        headers=headers,
        verify=ssl_context,
    )
    try:
        async for attempt in AsyncRetrying(...):
            with attempt:
                r = await client.get(url)
                r.raise_for_status()
                return r.text
    finally:
        if not _persistent_client:
            await client.aclose()
```
Same fix for `fetch_pdf()`.

### 6. `workers/main.py` — `METRICS` Race Condition
**Bug:** `METRICS` dict incremented by background tasks without locks.

**Fix:**
```python
_metrics_lock = asyncio.Lock()

async def _inc_metric(key: str):
    async with _metrics_lock:
        METRICS[key] += 1
```
Replace all `METRICS["..."] += 1` with `await _inc_metric("...")`.

### 7. `workers/main.py` — Session Tests Pollute `os.environ`
**Bug:** `/session/propelio/test` and `/session/propwire/test` mutate `os.environ` directly.

**Fix:** After fixing #8 and #9 below, pass credentials as parameters. Remove all `os.environ` mutations.

### 8. `workers/scrapers/propelio_v2.py` — Ignores Passed Credentials
**Bug:** `_do_login(page)` only reads `os.getenv()`.

**Fix:**
```python
async def _do_login(page, email: str = "", password: str = "") -> None:
    email = email or os.getenv("PROPELIO_EMAIL", "")
    password = password or os.getenv("PROPELIO_PASSWORD", "")
    # ... rest of login logic
```

### 9. `workers/scrapers/propwire.py` — Ignores Passed Credentials
**Bug:** Same as #8.

**Fix:** Same pattern — accept `email` and `password` parameters.

### 10. `workers/scrapers/satellite_rekognition.py` — Mutates Global `os.environ`
**Bug:** `os.environ["USE_REKOGNITION"] = "1"` affects all subsequent calls.

**Fix:**
```python
# Remove: os.environ["USE_REKOGNITION"] = "1"
# Pass as parameter instead:
result = await scan_area(..., use_rekognition=True)
```

---

## NODE.JS — Security (4 bugs)

### 11. `routes/scraperEngine.ts` — Catch-All Missing `crmAuth`
**Bug:** `router.all("/scraper-engine/{*path}", ...)` has no auth middleware.

**Fix:**
```typescript
router.all("/scraper-engine/{*path}", crmAuth, async (req: Request, res: Response) => {
    // ... existing proxy logic
});
```

### 12. `routes/scraperEngine.ts` — Decrypts Credentials Before Sending
**Bug:** Test endpoints call `decryptPassword()` then send plaintext to Python.

**Fix:** Pass encrypted credentials to Python. Let Python decrypt them.
```typescript
// Instead of:
// const email = decryptPassword(rawEmail);
// const pass = decryptPassword(rawPass);
// res.json(await scraperEngine.testSession("propelio", email, pass));

// Do:
res.json(await scraperEngine.testSession("propelio", rawEmail, rawPass));
```

### 13. `services/scraperEngineClient.ts` — Missing `X-API-Key`
**Bug:** No API key header sent to Python engine.

**Fix:**
```typescript
headers: {
  "content-type": "application/json",
  "X-API-Key": process.env.SCRAPER_API_KEY || "",
  ...(rest.headers || {}),
},
```

### 14. `routes/scraperEngine.ts` — Strips Original Headers
**Bug:** Only sends `content-type`. Strips `Authorization` and custom headers.

**Fix:**
```typescript
headers: {
  "content-type": "application/json",
  "X-API-Key": process.env.SCRAPER_API_KEY || "",
  ...(req.headers.authorization ? { "Authorization": req.headers.authorization } : {}),
},
```

---

## TOOLS — Critical Bugs (4 bugs)

### 15. `services/scraperEngineClient.ts` — Hardcoded Railway URL
**Bug:** Defaults to Railway URL.

**Fix:**
```typescript
const ENGINE_URL = (process.env.SCRAPER_ENGINE_URL || "").replace(/\/$/, "");
if (!ENGINE_URL) throw new Error("SCRAPER_ENGINE_URL is required");
```

### 16. Skip Trace — Sync Result vs Async Job Expectation
**Bug:** Backend returns result directly. Frontend expects `{ jobId }` and polls status.

**Fix (Option A — make async):**
```typescript
// In routes/tools.ts:
const jobId = uuid();
// Queue skip-trace job in background
// Return { jobId }
```

**Fix (Option B — handle sync in frontend):**
```typescript
// In use-tools.tsx:
// If response has `result` instead of `jobId`, show result immediately
```

### 17. Phone Finder — Same Contract Mismatch
**Bug:** Same as #16. No `jobId` returned.

**Fix:** Same pattern as #16.

### 18. `routes/tools.ts` — Uses Raw Axios
**Bug:** `axios.get(\`${process.env.SCRAPER_ENGINE_URL}/health\`)` bypasses client.

**Fix:** Use `scraperEngine.health()` instead.

---

## VERIFICATION (Prompt #1)
- [ ] `http_client.py` verifies SSL by default
- [ ] `/debug/env` endpoint removed
- [ ] CORS defaults to `[]`
- [ ] `/admin/*` checks `ADMIN_API_KEY`
- [ ] `fetch_direct()` uses `_persistent_client`
- [ ] `METRICS` uses `asyncio.Lock()`
- [ ] Session tests don't mutate `os.environ`
- [ ] `propelio_v2.py` accepts credential params
- [ ] `propwire.py` accepts credential params
- [ ] `satellite_rekognition.py` doesn't mutate `os.environ`
- [ ] `scraperEngine.ts` catch-all has `crmAuth`
- [ ] `scraperEngine.ts` test endpoints don't decrypt
- [ ] `scraperEngineClient.ts` sends `X-API-Key`
- [ ] `scraperEngine.ts` forwards relevant headers
- [ ] `SCRAPER_ENGINE_URL` has no Railway fallback
- [ ] Skip Trace contract fixed (async or sync)
- [ ] Phone Finder contract fixed (async or sync)
- [ ] `tools.ts` uses `scraperEngine.health()` not raw axios
