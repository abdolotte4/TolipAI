# Replit Agent Prompt: Fargate-Only Production Cleanup + New Features

> **Scope:** Fix verified bugs, remove non-Fargate code, and add SMS + Direct Mail + PWA capabilities. Target: AWS Fargate multi-task deployment.
>
> **Repos:** `Agawish24/Python-Worker` + `Agawish24/Digor`

---

## PART 1: PYTHON SCRAPER ENGINE — VERIFIED BUGS

### 1.1 CRITICAL — Security (4 bugs)

#### 1.1.1 `workers/http_client.py` — SSL Verification Disabled Globally
**File:** `workers/http_client.py`  
**Bug:** `_ssl_ctx()` returns `ssl.CERT_NONE` + `check_hostname = False`. All direct fetches accept any certificate.  
**Fix:** Verify certificates by default. Only disable when explicitly requested via parameter.

#### 1.1.2 `workers/main.py` — `/debug/env` Leaks Secret Lengths
**File:** `workers/main.py`  
**Bug:** Returns `{"set": true, "length": 42}` for every env var including passwords and API keys.  
**Fix:** Remove `/debug/env` endpoint entirely.

#### 1.1.3 `workers/main.py` — CORS Defaults to `["*"]`
**File:** `workers/main.py`  
**Bug:** `_cors_origins` defaults to `["*"]` if `CORS_ORIGINS` env var is not set.  
**Fix:** Default to `[]` or known frontend origin.

#### 1.1.4 `workers/main.py` — `/admin/*` Uses Same Key as Public Endpoints
**File:** `workers/main.py`  
**Bug:** `/admin/circuit-breakers`, `/admin/spot`, `/admin/retry-queue`, `/admin/cache` use `SCRAPER_API_KEY`.  
**Fix:** Add `ADMIN_API_KEY` env var. Check it in `_security_middleware` for `/admin/*` paths.

### 1.2 CRITICAL — Runtime (6 bugs)

#### 1.2.1 `workers/http_client.py` — No Connection Pooling
**File:** `workers/http_client.py`  
**Bug:** `fetch_direct()` and `fetch_pdf()` create a **new** `httpx.AsyncClient` on every call, ignoring `_persistent_client`.  
**Fix:** Use `_persistent_client` in both functions.

#### 1.2.2 `workers/main.py` — `METRICS` Race Condition
**File:** `workers/main.py`  
**Bug:** `METRICS` dict incremented by background tasks without locks.  
**Fix:** Use `asyncio.Lock()` when incrementing counters.

#### 1.2.3 `workers/main.py` — Session Test Endpoints Pollute `os.environ`
**File:** `workers/main.py` (`/session/propelio/test`, `/session/propwire/test`)  
**Bug:** Mutate `os.environ` directly. Race condition under concurrent requests.  
**Fix:** Pass credentials as parameters after fixing 1.2.4 and 1.2.5.

#### 1.2.4 `workers/scrapers/propelio_v2.py` — Ignores Passed Credentials
**File:** `workers/scrapers/propelio_v2.py`  
**Bug:** `_do_login(page)` only reads `os.getenv()`. No parameters.  
**Fix:** Accept `email` and `password` parameters with env fallback.

#### 1.2.5 `workers/scrapers/propwire.py` — Ignores Passed Credentials
**File:** `workers/scrapers/propwire.py`  
**Bug:** Same as 1.2.4.  
**Fix:** Same pattern — accept `email` and `password` parameters.

#### 1.2.6 `workers/scrapers/satellite_rekognition.py` — Mutates Global `os.environ`
**File:** `workers/scrapers/satellite_rekognition.py`  
**Bug:** `os.environ["USE_REKOGNITION"] = "1"` mutates global process state.  
**Fix:** Pass `use_rekognition` as parameter to `scan_area()`.

### 1.3 HIGH — Docker / Build (3 bugs)

#### 1.3.1 `Dockerfile.fargate` — Missing `libpq5`
**File:** `Dockerfile.fargate`  
**Bug:** Builder installs `libpq-dev` but final stage never gets `libpq5`. `asyncpg` crashes at runtime.  
**Fix:** Add `libpq5` to final stage.

#### 1.3.2 `Dockerfile.fargate` — Playwright Browser Install Timing
**File:** `Dockerfile.fargate`  
**Bug:** May not install Chromium at build time.  
**Fix:** Ensure `python -m playwright install chromium` runs during build. Remove `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.

#### 1.3.3 `start.fargate.sh` — Verify Startup Script
**File:** `start.fargate.sh`  
**Bug:** May background Playwright install or run unnecessary setup.  
**Fix:** Only run uvicorn. All setup belongs in Dockerfile build.

### 1.4 HIGH — Code Quality (4 bugs)

#### 1.4.1 `workers/main.py` — Version Mismatch
**File:** `workers/main.py`  
**Bug:** Health hardcodes `"0.1.0"` while `app = FastAPI(version="0.2.0")`.  
**Fix:** Return `app.version`.

#### 1.4.2 `workers/main.py` — Inline `__import__("httpx")`
**File:** `workers/main.py`  
**Bug:** Uses `__import__("httpx")` inline twice in `_phone_finder_lookup`.  
**Fix:** Move `import httpx` to top.

#### 1.4.3 `workers/cash_buyers.py` — Inline `__import__("os")`
**File:** `workers/cash_buyers.py`  
**Bug:** `int(__import__("os").getenv(...))`.  
**Fix:** Move `import os` to top.

#### 1.4.4 `workers/http_client.py` — Duplicated Stealth JS
**File:** `workers/http_client.py`  
**Bug:** `_STEALTH_JS` (~200 lines) duplicated from `_browser_session.py._STEALTH_SCRIPT`.  
**Fix:** Import `_STEALTH_SCRIPT` from `_browser_session`.

### 1.5 MEDIUM — Requirements Alignment
**File:** `requirements.fargate.txt` (consolidate from railway)  
**Bug:** `crawl4ai` and `numpy` versions differed between Railway and Fargate.  
**Fix:** Single `requirements.txt` with aligned versions.

### 1.6 VERIFIED CORRECT — No Changes
- `propelio_v2.py` and `propwire.py` use `browser_context()` with stealth
- `attom.py` exists — import valid
- `skip_trace.py` config fields all exist
- `db.py` safely coerces `lead["id"]`
- `browser_pool.py`, `retry_queue.py`, `_browser_session.py`, `llm.py`, `circuit_breaker.py`, `proxy_pool.py`, `cache.py`, `job_store.py` are well-written

---

## PART 2: NODE.JS API SERVER — VERIFIED BUGS

### 2.1 CRITICAL — Multi-Instance State Issues (Fargate)

In Fargate with multiple tasks, module-level in-memory state is NOT shared across containers.

#### 2.1.1 `services/propertyApi.ts` — In-Memory Cooldown Maps
**File:** `services/propertyApi.ts`  
**Bug:** `skipTraceMap`, `fetchCompsMap`, `leadFetchMap`, `campaignFetchMap` are module-level `Map` objects. Cooldowns are per-container.  
**Fix:** Store cooldown state in Redis or Postgres with TTL.

#### 2.1.2 `services/propertyApi.ts` — In-Memory Key Rotation State
**File:** `services/propertyApi.ts`  
**Bug:** `_keyIndex` and `_depletedKeys` are module-level variables. Key rotation state not shared across tasks.  
**Fix:** Store key rotation state in Redis with TTL.

#### 2.1.3 `services/attomApi.ts` — In-Memory Depleted Key Cache
**File:** `services/attomApi.ts`  
**Bug:** `_depletedAttomKeys` is a module-level `Set` with 5-minute auto-clear. Not shared across tasks.  
**Fix:** Store depleted key state in Redis with 5-minute TTL.

#### 2.1.4 `routes/crm/leads.ts` — In-Memory Comps Job Store
**File:** `routes/crm/leads.ts`  
**Bug:** `compsJobs` is a module-level `Map` with 10-minute cleanup. Job started on Task A cannot be polled from Task B.  
**Fix:** Store comp job state in Redis or Postgres with TTL.

#### 2.1.5 `routes/crm/sequences.ts` — No Distributed Lock for Email Job
**File:** `routes/crm/sequences.ts`  
**Bug:** `runEmailSequenceJob` uses `lastEmailJobRun` (module-level number) to guard against running more than once per hour. All tasks run simultaneously, sending duplicate emails.  
**Fix:** Use distributed lock (Redis Redlock or Postgres advisory locks).

### 2.2 CRITICAL — Security (4 bugs)

#### 2.2.1 `routes/scraperEngine.ts` — Catch-All Proxy Missing `crmAuth`
**File:** `routes/scraperEngine.ts`  
**Bug:** `router.all("/scraper-engine/{*path}", ...)` has NO auth middleware.  
**Fix:** Add `crmAuth`.

#### 2.2.2 `routes/scraperEngine.ts` — Decrypts Credentials Before Sending to Python
**File:** `routes/scraperEngine.ts`  
**Bug:** Test endpoints decrypt credentials before sending to Python.  
**Fix:** Pass encrypted credentials to Python.

#### 2.2.3 `services/scraperEngineClient.ts` — Missing `X-API-Key` Header
**File:** `services/scraperEngineClient.ts`  
**Bug:** `request()` does not send `X-API-Key`.  
**Fix:** Add `X-API-Key` header.

#### 2.2.4 `routes/scraperEngine.ts` — Catch-All Proxy Strips Original Headers
**File:** `routes/scraperEngine.ts`  
**Bug:** Only sends `content-type`. Strips `Authorization`, custom headers.  
**Fix:** Forward `X-API-Key`, `Authorization`, and other relevant headers.

### 2.3 HIGH — Reliability / Performance (8 bugs)

#### 2.3.1 `routes/crm/leads.ts` — AI Endpoints Lack Circuit Breakers
**File:** `routes/crm/leads.ts`  
**Bug:** `ai-repair-estimate`, `detect-condition`, `ai-deal-score`, `ai-seller-script`, `ai-offer-letter` make direct `fetch()` calls with NO circuit breaker, NO timeout, NO retry.  
**Fix:** Add circuit breaker and timeout to all AI calls.

#### 2.3.2 `routes/crm/sequences.ts` — Email Job Loads All Leads Into Memory
**File:** `routes/crm/sequences.ts`  
**Bug:** Loads ALL active leads with emails for ALL sequences into memory. No batching. OOM risk.  
**Fix:** Process in batches using cursor-based pagination.

#### 2.3.3 `routes/crm/sequences.ts` — Email Job No Concurrency Control
**File:** `routes/crm/sequences.ts`  
**Bug:** Sends emails one by one. No concurrency control.  
**Fix:** Use `p-limit` for controlled concurrency (e.g., 5 concurrent).

#### 2.3.4 `routes/crm/sequences.ts` — No Brevo Rate Limit Handling
**File:** `routes/crm/sequences.ts`  
**Bug:** Brevo API calls have no retry logic and no rate limit handling.  
**Fix:** Add retry with exponential backoff for 429 responses.

#### 2.3.5 `routes/crm/campaigns.ts` — Campaign Deletion Memory Risk
**File:** `routes/crm/campaigns.ts`  
**Bug:** Gathers ALL lead IDs, user IDs, sequence IDs into arrays before deleting. Memory issues for large campaigns.  
**Fix:** Delete in batches.

#### 2.3.6 `routes/crm/buyers.ts` — CSV Upload No Transaction Wrapping
**File:** `routes/crm/buyers.ts`  
**Bug:** CSV upload inserts in batches of 100 but each batch is a separate transaction. Partial commits on failure.  
**Fix:** Wrap entire upload in single transaction or implement rollback.

#### 2.3.7 `routes/crm/leads.ts` — Scraper Engine Comps Fallback No Auth
**File:** `routes/crm/leads.ts`  
**Bug:** `fetchCompsViaScraperEngine` calls Python engine directly with raw `fetch()`, bypassing `scraperEngineClient`. No `X-API-Key`.  
**Fix:** Use `scraperEngineClient` for all Python engine calls.

#### 2.3.8 `routes/crm/leads.ts` — N+1 Updates in Comps Recalculation
**File:** `routes/crm/leads.ts`  
**Bug:** `fetch-comps/poll` updates each comp's adjusted price in a loop. N+1 queries.  
**Fix:** Batch update using `UPDATE ... WHERE id IN (...)`.

### 2.4 MEDIUM — Security / Quality (6 bugs)

#### 2.4.1 `routes/crm/campaigns.ts` — Plaintext Password Comparison
**File:** `routes/crm/campaigns.ts`  
**Bug:** Super admin password uses `superAdminPassword === envPassword` (plaintext comparison). Timing-attack vulnerable.  
**Fix:** Hash env var password with bcrypt at startup. Use `bcrypt.compare()`.

#### 2.4.2 `routes/crm/campaigns.ts` — Twilio SID Exposed
**File:** `routes/crm/campaigns.ts`  
**Bug:** `formatCampaign` exposes `twilioAccountSid` in API responses.  
**Fix:** Remove `twilioAccountSid` from response. Only return `twilioConfigured: boolean`.

#### 2.4.3 `routes/crm/links.ts` — Unvalidated Forwarded Headers
**File:** `routes/crm/links.ts`  
**Bug:** `getBaseUrl` uses `req.headers["x-forwarded-host"]` without validation. Host header injection possible.  
**Fix:** Validate forwarded host against allowlist or use `process.env.PUBLIC_URL`.

#### 2.4.4 `services/coreCalculations.ts` — Invalid E164 Handling
**File:** `services/coreCalculations.ts`  
**Bug:** `toE164` returns `+${digits}` for any digit string > 7 characters. 9-digit number becomes invalid `+123456789`.  
**Fix:** Reject invalid lengths. Only accept 10 digits (add +1) or 11 digits starting with 1.

#### 2.4.5 `routes/crm/leads.ts` — `response_format: json_object` Not Universal
**File:** `routes/crm/leads.ts`  
**Bug:** `ai-deal-score`, `ai-seller-script`, `ai-offer-letter` use `response_format: { type: "json_object" }` which is OpenAI-specific. May fail with Groq or other providers.  
**Fix:** Remove `response_format` and parse JSON from response text, or detect provider capabilities.

#### 2.4.6 `routes/crm/leads.ts` — `formatLead` Parses JSON on Every Call
**File:** `routes/crm/leads.ts`  
**Bug:** `formatLead` calls `JSON.parse(lead.skipTracedPhones)` and `JSON.parse(lead.skipTracedEmails)` on every API response.  
**Fix:** Store parsed data as JSONB in DB or cache parsed results.

---

## PART 3: FARGATE-ONLY CLEANUP

### 3.1 Remove Railway Artifacts
- Delete `Dockerfile` (Railway)
- Delete `start.sh` (Railway startup)
- Delete `requirements.railway.txt`

### 3.2 Remove Lambda Artifacts
- Delete `Dockerfile.lambda`
- Delete `workers/lambda_handler.py`

### 3.3 Remove Replit-Specific Code
- Remove `_patch_ld_library_path()` from `workers/main.py`
- Remove the call to `_patch_ld_library_path()` at module level

### 3.4 Consolidate Requirements
- Merge unique deps from `requirements.railway.txt` into `requirements.fargate.txt`
- Rename to `requirements.txt`
- Update `Dockerfile.fargate` to use `requirements.txt`

---

## PART 4: PACKAGE CLEANUP — REMOVE YOLO & BLOAT

| Package | Size | Action |
|---------|------|--------|
| `ultralytics` | ~500MB | Remove — replace with vision API |
| `opencv-python-headless` | ~80MB | Remove — Pillow handles images |
| `pandas` | ~100MB | Remove — use stdlib `csv` |
| `numpy` | ~50MB | Remove if no dep needs it |
| `anthropic` | ~25MB | Remove — use OpenRouter |
| `groq` | ~15MB | Remove — use OpenRouter |

**Additional cleanup:**
- Remove `yolov8n.pt` download from `Dockerfile.fargate`
- Remove `ultralytics` import from `workers/scrapers/satellite_dfd.py`
- Update `satellite_dfd.py` to use vision API only
- Update `workers/main.py` `/debug/satellite` to remove YOLO check
- Ensure `Pillow` is in requirements

---

## PART 5: NEW FEATURES

### 5.1 SMS Sequences via Twilio

**Context:** Twilio credentials (`twilioAccountSid`, `twilioAuthToken`) already exist in campaigns table. Twilio is used for DNC/carrier lookup. The sequences infrastructure already exists for email via Brevo.

**What to build:**
1. **Extend sequence steps** to support `type: "sms"` in addition to `type: "email"`. The `crm_sequences` table already has `steps` JSONB — add SMS step support.
2. **Add SMS template system** — Similar to email templates but for SMS (160 char limit awareness). Store in `crm_sequence_templates` with `type: "sms"`.
3. **Add Twilio SMS sender** — In `routes/crm/sequences.ts`, extend `runEmailSequenceJob` to also process SMS steps. Use Twilio REST API (`/Messages`) to send SMS. Handle rate limits (1 msg/sec per number).
4. **Add SMS opt-out handling** — Store opt-out numbers in a new table (`crm_sms_opt_outs`) or Redis set. Check before sending.
5. **Add SMS step to sequence builder UI** — In `digor-tools`, extend the sequences page to allow adding SMS steps.
6. **Add SMS delivery tracking** — Store delivery status (sent, delivered, failed) in `crm_sequence_logs`.
7. **Add SMS cost tracking** — Twilio charges per segment. Track approximate cost per campaign.

**Files to modify:**
- `artifacts/api-server/src/routes/crm/sequences.ts` — Add SMS sending logic
- `artifacts/api-server/src/db/schema.ts` — Add SMS opt-out table, extend sequence templates for SMS type
- `artifacts/digor-tools/src/pages/` — Add SMS step to sequence builder (if sequences UI exists)
- `artifacts/api-server/src/services/` — Create `smsService.ts` for Twilio SMS operations

### 5.2 Direct Mail via Brevo

**Context:** Brevo is already integrated for email sequences. Brevo offers a direct mail API (postcards/letters) via their Transactional API.

**What to build:**
1. **Add direct mail step type** — Extend sequence steps to support `type: "direct_mail"`.
2. **Add direct mail template system** — Templates for postcards/letters with merge fields (name, address, property address, offer amount). Store in `crm_sequence_templates` with `type: "direct_mail"`.
3. **Add Brevo direct mail sender** — Use Brevo's Transactional API to send postcards/letters. Brevo charges per piece (~$0.75-1.50). Handle address validation.
4. **Add direct mail tracking** — Track status: queued, printed, shipped, delivered. Brevo provides webhooks for status updates.
5. **Add direct mail step to sequence builder UI** — In `digor-tools`, extend sequences page.
6. **Add direct mail cost tracking** — Track cost per piece per campaign.

**Files to modify:**
- `artifacts/api-server/src/routes/crm/sequences.ts` — Add direct mail sending logic
- `artifacts/api-server/src/db/schema.ts` — Extend sequence templates for direct mail type
- `artifacts/api-server/src/services/` — Create `directMailService.ts` for Brevo direct mail operations
- `artifacts/digor-tools/src/pages/` — Add direct mail step to sequence builder

### 5.3 PWA (Progressive Web App) for digor-tools

**Context:** `digor-tools` is a React/Vite app. Making it a PWA adds installability, offline cache, and push notifications — 80% of native app value at 5% of the cost.

**What to build:**
1. **Add Vite PWA plugin** — Use `vite-plugin-pwa` to generate service worker and manifest.
2. **Create web app manifest** — `manifest.json` with app name, icons, theme color, display mode (standalone). Include all tool routes.
3. **Add service worker** — Cache static assets and API responses for offline use. Use Workbox (via vite-plugin-pwa).
4. **Add install prompt** — Show "Add to Home Screen" prompt on mobile browsers.
5. **Add offline indicators** — Show "Offline mode" banner when network is unavailable.
6. **Cache critical data** — Cache lead lists, property lookups, ARV results for offline viewing. Use IndexedDB or Cache API.
7. **Add push notifications** — For job completion (scraping done, skip trace done, sequence sent). Use web push API with a simple push server or OneSignal.
8. **Responsive mobile layout** — Ensure all 9 tools (Lead Scraper, Skip Trace, Distressed, ARV, Property Lookup, AI Distressed, Satellite DFD, Phone Finder) work well on mobile screens. Test touch targets, font sizes, scroll behavior.
9. **Add GPS location access** — For Satellite DFD and Property Lookup, use browser geolocation API to center maps on user's current location.
10. **Add camera access** — For field notes/photos on property lookup. Store photos in S3 or base64 in DB.

**Files to modify:**
- `artifacts/digor-tools/vite.config.ts` — Add `vite-plugin-pwa`
- `artifacts/digor-tools/public/manifest.json` — Create manifest
- `artifacts/digor-tools/public/sw.js` — Service worker (auto-generated by plugin)
- `artifacts/digor-tools/src/App.tsx` — Add offline indicator, install prompt
- `artifacts/digor-tools/src/pages/SatelliteDFD.tsx` — Add GPS centering
- `artifacts/digor-tools/src/pages/PropertyLookup.tsx` — Add camera/photo support
- `artifacts/digor-tools/src/components/layout/AppLayout.tsx` — Mobile-responsive nav

**Note:** This is a PWA, not a native iOS/Android app. Native apps require $50K+ and 6+ months. PWA gives you installability, offline mode, and push notifications in ~1-2 weeks.

---

## PART 6: CROSS-REPO ALIGNMENT

### 6.1 Credential Passing
1. **Python:** `propelio_v2._do_login()` and `propwire._do_login()` accept `email`/`password` params.
2. **Python:** `/session/propelio/test` and `/session/propwire/test` pass credentials as params (no `os.environ` mutation).
3. **Node.js:** `scraperEngine.ts` test endpoints do NOT decrypt. Pass encrypted strings to Python.

### 6.2 API Key Header
1. **Node.js `scraperEngineClient.ts`:** Add `X-API-Key` to all requests.
2. **Node.js `scraperEngine.ts`:** Add `X-API-Key` in catch-all proxy headers. Forward original headers.

---

## PART 7: VERIFICATION CHECKLIST

### Python Security
- [ ] `http_client.py` verifies SSL by default
- [ ] `main.py` `/debug/env` removed
- [ ] `main.py` CORS defaults to `[]`
- [ ] `main.py` `/admin/*` checks `ADMIN_API_KEY`

### Python Runtime
- [ ] `http_client.py` uses `_persistent_client`
- [ ] `main.py` health returns `app.version`
- [ ] `main.py` `METRICS` uses `asyncio.Lock()`
- [ ] `main.py` session tests don't mutate `os.environ`
- [ ] `propelio_v2.py` accepts credential params
- [ ] `propwire.py` accepts credential params
- [ ] `satellite_rekognition.py` doesn't mutate `os.environ`

### Python Cleanup
- [ ] No inline `__import__` calls
- [ ] `http_client.py` imports `_STEALTH_SCRIPT` from `_browser_session`
- [ ] Single `requirements.txt` with aligned versions

### Docker / Build
- [ ] `Dockerfile.fargate` has `libpq5`
- [ ] `Dockerfile.fargate` installs Chromium at build time
- [ ] `Dockerfile.fargate` has no YOLO download
- [ ] `start.fargate.sh` only runs uvicorn

### Fargate Cleanup
- [ ] Railway Dockerfile deleted
- [ ] Lambda Dockerfile deleted
- [ ] Railway startup script deleted
- [ ] Railway requirements deleted
- [ ] `lambda_handler.py` deleted
- [ ] `_patch_ld_library_path()` removed

### Package Cleanup
- [ ] `ultralytics` removed
- [ ] `opencv-python-headless` removed
- [ ] `pandas` removed
- [ ] `numpy` removed (if safe)
- [ ] `anthropic` removed
- [ ] `groq` removed
- [ ] `satellite_dfd.py` no YOLO import

### Node.js Security
- [ ] `scraperEngine.ts` catch-all has `crmAuth`
- [ ] `scraperEngine.ts` test endpoints don't decrypt
- [ ] `scraperEngineClient.ts` sends `X-API-Key`
- [ ] `scraperEngine.ts` forwards relevant headers

### Node.js Multi-Instance (Fargate)
- [ ] PropertyAPI cooldowns stored in Redis/Postgres
- [ ] PropertyAPI key rotation state in Redis
- [ ] ATTOM depleted key cache in Redis
- [ ] Comps job store in Redis/Postgres
- [ ] Email sequence job uses distributed lock

### Node.js Reliability
- [ ] AI endpoints have circuit breaker + timeout
- [ ] Email job batches leads (cursor pagination)
- [ ] Email job has concurrency control (`p-limit`)
- [ ] Brevo calls have retry + backoff
- [ ] Campaign deletion uses batch deletion
- [ ] CSV upload wrapped in transaction
- [ ] Scraper engine comps fallback uses authenticated client
- [ ] Comps recalculation uses batch update

### Node.js Quality
- [ ] Super admin password uses `bcrypt.compare()`
- [ ] Twilio SID not exposed in responses
- [ ] `getBaseUrl` validates forwarded headers
- [ ] `toE164` rejects invalid lengths
- [ ] AI endpoints handle `response_format` gracefully
- [ ] `formatLead` doesn't parse JSON on every call

### New Features
- [ ] SMS sequences work via Twilio
- [ ] SMS opt-out table exists and is checked
- [ ] SMS delivery status tracked
- [ ] Direct mail sequences work via Brevo
- [ ] Direct mail status tracked (queued/printed/shipped/delivered)
- [ ] PWA manifest exists and is valid
- [ ] PWA service worker caches static assets
- [ ] PWA install prompt works on mobile
- [ ] PWA offline indicator shows when disconnected
- [ ] All 9 tools are mobile-responsive
- [ ] Satellite DFD uses GPS location
- [ ] Property Lookup supports camera/photos

### Tests
- [ ] TypeScript: `npx tsc --noEmit`
- [ ] Python: `python -m py_compile workers/main.py`
- [ ] Python imports: `python -c "from workers.main import app"`
- [ ] Docker build succeeds
- [ ] PWA passes Lighthouse audit
- [ ] All existing tests pass

---

## PART 8: CONSTRAINTS

- **Do NOT change working stealth logic** in `_browser_session.py`, `browser_pool.py`, `propelio_v2.py`, or `propwire.py`.
- **Do NOT add new dependencies** unless absolutely required.
- **Preserve all existing API contracts** — return shapes, status codes, job status strings.
- **Prefer explicit over implicit** — no env-var fallbacks without clear defaults.
- **Never expose internal error details** to API clients.
- **Fargate-only** — no Railway, Lambda, or Replit-specific code should remain.
- **Multi-instance safe** — all shared state must use Redis or Postgres.
- **PWA only** — do NOT build native iOS/Android apps. Use PWA for mobile.


---

## PART 9: TOOLS FRONTEND/BACKEND — VERIFIED BUGS

### 9.1 CRITICAL — All Tools Broken (Single Root Cause)

#### 9.1.1 `services/scraperEngineClient.ts` — Missing `X-API-Key` Header
**File:** `artifacts/api-server/src/services/scraperEngineClient.ts`  
**Bug:** The `request()` function only sends `"content-type": "application/json"`. No `X-API-Key` header. The Python engine's `_security_middleware` rejects ALL requests with 401 when `SCRAPER_API_KEY` is set.  
**Impact:** **EVERY tool breaks** — Skip Trace, Phone Finder, Distressed, ARV, Property Lookup, Satellite DFD, Lead Scraper, AI Distressed. All return 401.  
**Fix:** Add `X-API-Key` header:
```typescript
headers: {
  "content-type": "application/json",
  "X-API-Key": process.env.SCRAPER_API_KEY || "",
  ...(rest.headers || {}),
},
```

#### 9.1.2 `services/scraperEngineClient.ts` — Hardcoded Railway URL
**File:** `artifacts/api-server/src/services/scraperEngineClient.ts` line 7  
**Bug:** `const ENGINE_URL = (process.env.SCRAPER_ENGINE_URL || "https://scraper-engine-production-6207.up.railway.app")`. Defaults to Railway. In Fargate, if env var is missing, connects to wrong service.  
**Fix:** Remove default. Fail fast:
```typescript
const ENGINE_URL = (process.env.SCRAPER_ENGINE_URL || "").replace(/\/$/, "");
if (!ENGINE_URL) throw new Error("SCRAPER_ENGINE_URL is required");
```

### 9.2 CRITICAL — Skip Trace Frontend/Backend Contract Mismatch

#### 9.2.1 Skip Trace Returns Sync Result, Frontend Expects Async Job
**Files:** `artifacts/digor-tools/src/hooks/use-tools.tsx` + `artifacts/api-server/src/routes/tools.ts`  
**Bug:**
- Frontend calls `/api/tools/skip-trace/upload`, expects `{ jobId }`, then polls `/api/tools/skip-trace/status/${jobId}`
- Backend calls `scraperEngine.skipTrace()` which returns `{ phones, emails, ... }` directly — **no jobId**
- Backend returns `{ result: { phones, emails } }` — no `jobId` field
- Frontend gets `jobId: undefined`, polling fails with 404
**Fix:** Either:
- **Option A:** Make skip-trace async: create a job ID, run skip-trace in background, return `jobId`, and implement a status endpoint that polls the Python engine
- **Option B:** Change frontend to handle synchronous response: show results immediately without polling

### 9.3 CRITICAL — Phone Finder Frontend/Backend Contract Mismatch

#### 9.3.1 Phone Finder Returns Sync Results, Frontend Expects Async Job
**Files:** `artifacts/digor-tools/src/hooks/use-tools.tsx` + `artifacts/api-server/src/routes/tools.ts`  
**Bug:**
- Frontend calls `/api/tools/phone-finder/upload`, expects `{ jobId }`, polls `/api/tools/phone-finder/status/${jobId}`
- Backend calls `scraperEngine.lookupPhone()` in a loop, returns `{ results: [...] }` directly — **no jobId**
- Backend `phoneFinderStatus` tries to call `scraperEngine.getJob(jobId)` but **no job was ever created**
- Result: Frontend gets `jobId: undefined`. Status endpoint always returns 404
**Fix:** Either:
- **Option A:** Make phone finder async: create job ID, run lookups in background, return `jobId`
- **Option B:** Change frontend to handle synchronous response

### 9.4 HIGH — Backend Issues

#### 9.4.1 `routes/tools.ts` — Uses Raw Axios Instead of Client
**File:** `artifacts/api-server/src/routes/tools.ts` line 65  
**Bug:** `const { data: engineHealth } = await axios.get(\`${process.env.SCRAPER_ENGINE_URL}/health\`);` uses raw axios. Inconsistent with `scraperEngine.health()`. Bypasses client middleware.  
**Fix:** Use `scraperEngine.health()`.

#### 9.4.2 `routes/tools.ts` — ARV Returns NaN for Empty Comps
**File:** `artifacts/api-server/src/routes/tools.ts` lines 271-313  
**Bug:** If `scraperEngine.fetchComps()` returns empty `comps` array, code calculates ARV/MAO with `avgPrice = 0`, `avgSqft = 0`, resulting in `NaN` or `Infinity`.  
**Fix:** Add early return:
```typescript
if (!comps || comps.length === 0) {
  return res.status(404).json({ error: "No comparable sales found" });
}
```

#### 9.4.3 `routes/tools.ts` — Property Lookup Sequential Calls, No Fallback
**File:** `artifacts/api-server/src/routes/tools.ts` lines 323-365  
**Bug:** Calls `propwireProperty()` then `skipTrace()` sequentially. If Propwire times out (90s), entire request fails. No fallback.  
**Fix:** Run calls in parallel with `Promise.allSettled()` or add timeout handling.

### 9.5 MEDIUM — Frontend Issues

#### 9.5.1 `hooks/use-auth.tsx` — No Token Refresh
**File:** `artifacts/digor-tools/src/hooks/use-auth.tsx`  
**Bug:** `checkAuth()` runs once on mount. If JWT expires while using tools, API calls fail with 401 but user isn't redirected to login.  
**Fix:** Add axios interceptor or fetch wrapper that catches 401 and redirects to `/login`.

#### 9.5.2 `hooks/use-tools.tsx` — No Request Timeout
**File:** `artifacts/digor-tools/src/hooks/use-tools.tsx`  
**Bug:** All `fetch()` calls have no timeout. If backend hangs, UI stays in "loading" forever.  
**Fix:** Add `AbortController` with timeout to all fetch calls.

### CAPTCHA Solver Using Existing AI Infrastructure

**Context:** You already pay for AI (OpenRouter/GPT-4o). Use it to solve CAPTCHAs instead of paying for 2Captcha/Anti-Captcha.

**What to build:**
1. **Add `captcha_solver.py` module** in `workers/scrapers/`
   - Function `solve_text_captcha(image_bytes) -> str`: Send image to GPT-4o-mini with prompt "Extract and return ONLY the text from this CAPTCHA image"
   - Function `solve_image_selection_captcha(image_bytes, instruction) -> list`: Send image + instruction to GPT-4o, return list of coordinates or grid positions
   - Function `detect_captcha_type(page) -> str`: Check page for common CAPTCHA indicators (reCAPTCHA iframe, hCaptcha, text CAPTCHA input)

2. **Integrate into `_browser_session.py`**
   - After `page.goto()`, check if CAPTCHA is present using `detect_captcha_type()`
   - If CAPTCHA detected: screenshot the challenge, call solver, inject answer, verify success
   - If solve fails after 3 attempts: raise `CaptchaError` so retry queue can handle it

3. **Add CAPTCHA detection to `http_client.py`**
   - In `fetch_html()`, if response contains CAPTCHA indicators (status 403 with specific body patterns), raise `CaptchaError`
   - Retry queue will then use Playwright + CAPTCHA solver instead of direct HTTP

4. **Cost optimization**
   - Use `gpt-4o-mini` for text CAPTCHAs (cheaper, sufficient accuracy)
   - Use `gpt-4o` only for complex image selection challenges
   - Cache solved CAPTCHA patterns (same site = similar challenges) to avoid repeated AI calls

5. **Accuracy tracking**
   - Log solve success/failure rates per CAPTCHA type
   - If accuracy drops below 80% for a type, fallback to paid service for that type only

**Files to create/modify:**
- `workers/scrapers/captcha_solver.py` — New module
- `workers/scrapers/_browser_session.py` — Add CAPTCHA detection + solving
- `workers/http_client.py` — Add CAPTCHA detection in HTTP responses
- `workers/retry_queue.py` — Handle `CaptchaError` with Playwright fallback
- 
### 9.6 Tools Verification Checklist
- [ ] All tools work after adding `X-API-Key` header
- [ ] `SCRAPER_ENGINE_URL` has no hardcoded Railway fallback
- [ ] Skip Trace either returns `jobId` (async) or frontend handles sync response
- [ ] Phone Finder either returns `jobId` (async) or frontend handles sync response
- [ ] ARV handles empty comps gracefully (404 or empty state)
- [ ] Property Lookup has timeout fallback
- [ ] Auth hook redirects on 401
- [ ] Tools hook has request timeouts
- [ ] `tools.ts` uses `scraperEngine.health()` not raw axios
- [ ] 
# Replit Agent Prompt: Performance Optimization for Thousands of Leads

> **Goal:** Fix all performance bottlenecks so the CRM handles 1,000+ leads smoothly. Keep the single-page lead detail layout — do NOT split into popups/modals. Target: AWS Fargate + RDS.
>
> **Files to modify:**
> - Backend: `artifacts/api-server/src/routes/crm/leads.ts`
> - Frontend List: `artifacts/digor-crm/src/pages/leads/LeadList.tsx`
> - Frontend Detail: `artifacts/digor-crm/src/pages/LeadDetail.tsx`

---

## PART 10: BACKEND — `routes/crm/leads.ts`

### 10.1 CRITICAL — Eliminate N+1 Queries on List View (`GET /`)
**Location:** `router.get("/", crmAuth, ...)` around line 190-250  
**Problem:** The list endpoint runs 3-4 separate queries: leads (paginated), COUNT, users (for names), campaigns (for super_admin). Then manually maps them in JavaScript.  
**Fix:** Replace separate queries with a single Drizzle query using LEFT JOINs. Join `crmUsers` on `assignedTo` and `crmCampaigns` on `campaignId` in one query. Select only the fields needed for `formatLeadSummary()` — do NOT select `notes`, `skipTracedPhones`, `skipTracedEmails`, or other heavy fields in the list view. The list view only needs summary data.

### 10.2 CRITICAL — Remove `JSON.parse()` from `formatLead()` and `formatLeadSummary()`
**Location:** Both formatter functions  
**Problem:** `skipTracedPhones` and `skipTracedEmails` are parsed via `JSON.parse()` on every call. With 20 leads per page, that's 40 parses per request. At scale this crushes CPU.  
**Fix:** Store these fields as JSONB in the database schema so Drizzle returns them already parsed. Remove the `JSON.parse()` calls from both formatters entirely. If the DB column is already JSONB, simply remove the manual parsing.

### 10.3 CRITICAL — Add Database Indexes
**Location:** Database schema / migration  
**Problem:** No visible indexes on heavily queried columns. Full table scans on every filter, sort, and search.  
**Fix:** Create these indexes via Drizzle migration or raw SQL:
- `crm_leads(campaignId)` — filtered in almost every query
- `crm_leads(assignedTo)` — VA dashboard filter
- `crm_leads(status)` — pipeline filtering
- `crm_leads(archived)` — default exclusion
- `crm_leads(createdAt DESC)` — default sort order
- `crm_leads(campaignId, archived, createdAt DESC)` — composite index for the default list query
- `crm_comps(leadId)` — comps are fetched per lead
- `crm_notes(leadId)` — notes are fetched per lead
- `crm_tasks(leadId)` — tasks are fetched per lead
- `crm_lead_followers(leadId)` — followers fetched per lead
- `crm_lead_followers(leadId, userId)` — uniqueness check
- `crm_notifications(userId, read)` — unread count

### 10.4 HIGH — Optimize Search Queries
**Location:** `router.get("/", ...)` search block around line 210  
**Problem:** `ilike(crmLeads.sellerName, '%${search}%')` with a leading `%` wildcard prevents index usage. Full table scan on every search.  
**Fix:** 
- Option A: Add a Postgres trigram index (`pg_trgm` extension) on a concatenated search column: `(sellerName || ' ' || address || ' ' || phone || ' ' || email)`
- Option B: Use `ilike` only with trailing wildcard (`search%`) for autocomplete-style search, and add a separate full-text search endpoint for deep search
- Option C: Add a generated `searchVector` column that concatenates searchable fields, and index that column with a GIN index

### 10.5 HIGH — Make `/full` Endpoint Lazy-Loadable
**Location:** `router.get("/:id/full", ...)` around line 380-450  
**Problem:** Always fetches notes, tasks, followers, assigned user, AND comps in 5 parallel queries. Even when the user only wants the lead summary.  
**Fix:** Accept an `?include=` query parameter. Valid values: `notes`, `tasks`, `comps`, `followers`. Only execute the queries for sections that are requested. Default to `notes,tasks,followers` (exclude comps by default since comps are the heaviest). Update the frontend to request `?include=notes,tasks,followers` on initial load, and `?include=comps` only when the comps section is first expanded or when the user clicks "Fetch Comps".

### 10.6 HIGH — Add Pagination to Notes, Tasks, and Comps
**Location:** `GET /:id/full` and `GET /:id/notes`  
**Problem:** Notes, tasks, and comps are fetched without LIMIT. A lead with 100+ notes or 50+ comps will return massive payloads.  
**Fix:**
- Notes: Add `?limit=20&offset=0` support. Default to 20 most recent.
- Tasks: Add `?limit=20` support.
- Comps: Already limited by the nature of comps, but cap at 50.

### 10.7 MEDIUM — Cache Lead Summary in Redis
**Location:** `router.get("/", ...)`  
**Problem:** The list view is the most-hit endpoint and runs a complex query every time.  
**Fix:** Cache the list view response in Redis for 30 seconds per campaign. Key: `leads:list:{campaignId}:{page}:{limit}:{status}:{search}:{archived}`. Invalidate on lead create/update/delete.

---

## PART 11: FRONTEND LIST — `pages/leads/LeadList.tsx`

### 11.1 CRITICAL — Remove Staggered Animations on List Items
**Location:** `motion.div` inside `data?.leads.map()`  
**Problem:** `transition={{ delay: i * 0.05 }}` staggers animations for all 20 leads. This causes layout thrashing and delays visible rendering. With 20 leads, the last item animates 1 second after the first.  
**Fix:** Remove the stagger delay entirely, or use a much smaller delay (0.01s max), or disable animations for lists over 10 items. Better yet, remove Framer Motion from the list entirely and use CSS transitions only.

### 11.2 CRITICAL — Debounce Search Input
**Location:** Search Input `onChange` handler  
**Problem:** `onChange={(e) => handleSearch(e.target.value)}` fires on every keystroke, immediately triggering a new API call. Typing "smith" = 5 API calls in rapid succession.  
**Fix:** Debounce the search by 300-500ms:
```typescript
const [debouncedSearch, setDebouncedSearch] = useState(search);
useEffect(() => {
  const timer = setTimeout(() => setDebouncedSearch(search), 400);
  return () => clearTimeout(timer);
}, [search]);
// Pass debouncedSearch to useCrmGetLeads instead of search
```

### 11.3 HIGH — Memoize Inline Date Calculations
**Location:** Inside `data?.leads.map()`  
**Problems:**
- `format(new Date((lead as any).createdAt), "MMM d, yyyy")` runs for every lead on every render
- `formatDistanceToNow(new Date((lead as any).updatedAt), { addSuffix: true })` runs for every lead
- `differenceInDays(new Date(), new Date((lead as any).updatedAt || lead.createdAt))` runs via IIFE for every lead
**Fix:** Pre-format dates in the backend formatter (`formatLeadSummary`) so the frontend receives strings, not raw dates. Or memoize per lead using `useMemo`.

### 11.4 HIGH — Add Virtualization for Long Lists
**Location:** Lead list grid  
**Problem:** All 20 leads are rendered in the DOM even if only 5 are visible. With 1,000 leads across 50 pages, each page still renders 20 items.  
**Fix:** This is less critical with pagination (20 items), but if you ever switch to infinite scroll, use `react-window` or `react-virtualized`.

### 11.5 MEDIUM — Memoize Status Color Function
**Location:** `getStatusColor()`  
**Problem:** The switch statement runs for every lead on every render.  
**Fix:** Convert to a lookup object outside the component:
```typescript
const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  contacted: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  // ... etc
};
```

---

## PART 12: FRONTEND DETAIL — `pages/LeadDetail.tsx`

### 12.1 CRITICAL — Stop Re-rendering Everything on Every Keystroke
**Location:** `field()` helper around line 2300  
**Problem:** `setFormData((f) => ({ ...f, [key]: val }))` creates a new object on every keystroke, triggering a re-render of the entire 2,875-line component including CompsSection, all AI panels, Twilio dialer, etc.  
**Fix:**
- Replace `formData` state with a `useRef` for the actual form values
- Keep `isDirty` in state (it's cheap to re-render)
- Create a `handleChange(key, val)` function that updates `formRef.current[key] = val` and calls `setIsDirty(true)`
- Only sync `formRef.current` back to React state on blur or when the Save button is clicked
- The UI inputs should read from `formRef.current` directly (uncontrolled inputs) or use a lightweight local state per input

### 12.2 CRITICAL — Fix Auto-Save `useEffect` Dependencies
**Location:** Auto-save timer around line 2280  
**Problem:** `useEffect(() => { ... }, [isDirty, formData])` — the `formData` dependency means every keystroke re-runs the effect, clearing and resetting the 1.5s timer.  
**Fix:** Remove `formData` from the dependency array. Use only `[isDirty]`. Read the latest values from `formRef.current` inside the timeout callback, not from state.

### 12.3 CRITICAL — Memoize Heavy Calculations in CompsSection
**Location:** Inside `CompsSection` component  
**Problems:**
- `marketSqftRate` is calculated via IIFE on every render (every keystroke in parent)
- `calcBreakdown()` runs for every comp on every render
- `avgAdjusted` is recalculated on every render
- `dealRatio` and `dealFlag` are recalculated on every render
**Fix:** Wrap ALL of these in `useMemo` with proper dependency arrays:
- `marketSqftRate` → depends on `[comps]`
- `avgAdjusted` → depends on `[comps]`
- `dealRatio` / `dealFlag` → depends on `[lead.arv, lead.askingPrice]`
- Each comp's breakdown should be memoized individually or calculated lazily when the user clicks to expand

### 12.4 CRITICAL — Memoize All AI Components
**Location:** `AiDealScorer`, `AiSellerScript`, `AiOfferLetter`, `AiRepairEstimator`  
**Problem:** These are not wrapped in `React.memo()`. Every parent re-render (every keystroke) re-renders all 4 AI components even though their props haven't changed.  
**Fix:**
- Export each AI component wrapped in `React.memo()`
- Ensure stable prop references (pass `leadId` as number, not as object)
- Move the `useQuery` hooks INSIDE each memoized component so data fetching is isolated

### 12.5 HIGH — Lazy-Load Heavy Sections
**Location:** `LeadDetail.tsx` main render  
**Problem:** Everything renders on mount — CompsSection, all 4 AI panels, Twilio dialer, Zillow card, Cash Buyer panel, Email history. Even if the user never scrolls to them.  
**Fix:** Use `React.lazy()` + `Suspense` for sections below the fold:
- Lazy load `CompsSection` — it's the heaviest component
- Lazy load all 4 AI panels (`AiDealScorer`, `AiSellerScript`, `AiOfferLetter`, `AiRepairEstimator`)
- Lazy load `CashBuyerMatchPanel`
- Keep above-the-fold content (Contact, Property Details, Financials, Notes) eager-loaded
- Add an `IntersectionObserver` wrapper that only renders lazy components when they scroll into view

### 12.6 HIGH — Split `useQuery` for `/full` into Separate Queries
**Location:** Lead detail data fetching around line 1850  
**Problem:** One `useQuery` fetches everything at once via `/leads/${leadId}/full`. Even if the user never opens comps or notes.  
**Fix:** Split into separate queries:
- `useQuery(['lead', leadId])` → fetches `/leads/${leadId}` (lightweight, no comps/notes)
- `useQuery(['lead-notes', leadId], { enabled: showNotes })` → fetches notes only when tab is active
- `useQuery(['lead-comps', leadId], { enabled: showComps })` → fetches comps only when section is visible
- `useQuery(['lead-tasks', leadId])` → tasks are lightweight, can be eager
- Update the backend `/full` endpoint to support `?include=` (see 1.5 above)

### 12.7 HIGH — Fix `useEffect` Initialization Loop
**Location:** `useEffect(() => { if (lead && !initializedRef.current) { ... } }, [lead])` around line 2250  
**Problem:** The effect runs every time `lead` changes. `lead` changes on every background refetch (staleTime: 30s). The `initializedRef` prevents overwriting, but the effect still executes and checks.  
**Fix:** Use an empty dependency array `[]` so it only runs once on mount. The `initializedRef` already guards against double-init.

### 12.8 MEDIUM — Cache Campaign Users Globally
**Location:** `useQuery` for campaign users around line 1880  
**Problem:** Fetched on every lead detail page load. Users rarely change. Wastes a query per lead view.  
**Fix:**
- Lift campaign users to a React Context or global state (Zustand) at the app level
- Fetch once when the app loads, never per-lead
- Or increase `staleTime` to `Infinity` since users don't change during a session

### 12.9 MEDIUM — Debounce Input Fields
**Location:** All text inputs in the form  
**Problem:** Every keystroke triggers state updates (even with useRef, some inputs may still be controlled).  
**Fix:** For text inputs that don't need instant feedback (address, notes, etc.), debounce the onChange handler by 100-200ms. Only number inputs and selects should be immediate.

### 12.10 MEDIUM — Optimize `MentionTextarea`
**Location:** `MentionTextarea` component  
**Problem:** Not memoized. Re-renders on every parent keystroke even though it's not visible or active.  
**Fix:** Wrap in `React.memo()`. The dropdown state is internal so it won't re-render unless props change.

---

## PART 13: DATABASE MIGRATIONS (AWS RDS Ready)

### 13.1 Create Indexes
Run these via Drizzle migration. They are AWS RDS compatible (no Neon-specific features).

```sql
-- Lead list filtering (most important)
CREATE INDEX idx_leads_campaign_archived_created ON crm_leads(campaignId, archived, createdAt DESC);
CREATE INDEX idx_leads_status ON crm_leads(status);
CREATE INDEX idx_leads_assigned ON crm_leads(assignedTo);

-- Search (if using trigram)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_leads_search ON crm_leads USING gin (
  (COALESCE(sellerName,'') || ' ' || COALESCE(address,'') || ' ' || COALESCE(phone,'') || ' ' || COALESCE(email,'')) gin_trgm_ops
);

-- Related tables
CREATE INDEX idx_comps_lead ON crm_comps(leadId);
CREATE INDEX idx_notes_lead ON crm_notes(leadId, createdAt DESC);
CREATE INDEX idx_tasks_lead ON crm_tasks(leadId, dueDate);
CREATE INDEX idx_followers_lead ON crm_lead_followers(leadId);
CREATE INDEX idx_followers_lead_user ON crm_lead_followers(leadId, userId);
CREATE INDEX idx_notifications_user_read ON crm_notifications(userId, read);
```

### 13.2 Convert Text JSON to JSONB (if applicable)
If `skipTracedPhones` and `skipTracedEmails` are stored as `text` columns:
```sql
ALTER TABLE crm_leads ALTER COLUMN skipTracedPhones TYPE JSONB USING skipTracedPhones::JSONB;
ALTER TABLE crm_leads ALTER COLUMN skipTracedEmails TYPE JSONB USING skipTracedEmails::JSONB;
```

---

## PART 14: VERIFICATION CHECKLIST

### 14.1 Backend
- [ ] List view uses single query with JOINs (not N+1)
- [ ] `formatLeadSummary()` does not call `JSON.parse()`
- [ ] All indexes from 4.1 are created
- [ ] `/full` endpoint supports `?include=` parameter
- [ ] Notes endpoint supports `?limit=` and `?offset=`
- [ ] Search uses indexable query (trigram or trailing wildcard)

### 14.2 Frontend List (LeadList.tsx)
- [ ] Staggered animation delays removed or minimized
- [ ] Search input debounced by 400ms
- [ ] Dates pre-formatted in backend (not calculated inline)
- [ ] `differenceInDays` pre-calculated in backend or memoized
- [ ] `getStatusColor` uses lookup object (not switch)

### 14.3 Frontend Detail (LeadDetail.tsx)
- [ ] `formData` uses `useRef` instead of state for values
- [ ] Only `isDirty` is in React state
- [ ] Auto-save `useEffect` has `[isDirty]` only (no `formData`)
- [ ] `CompsSection` calculations wrapped in `useMemo`
- [ ] All 4 AI components exported with `React.memo()`
- [ ] `React.lazy()` + `Suspense` used for below-fold sections
- [ ] Lead detail splits into separate `useQuery` calls (not one `/full`)
- [ ] Init `useEffect` has `[]` dependency (not `[lead]`)
- [ ] Campaign users cached globally (not fetched per-lead)
- [ ] `MentionTextarea` wrapped in `React.memo()`

### 14.4 Performance Targets
- [ ] List view (20 leads) loads in < 300ms
- [ ] Lead detail initial render in < 500ms
- [ ] Typing in form inputs has zero lag
- [ ] Comps section calculates instantly (no delay on expand)
- [ ] AI panels do not re-render on form input
- [ ] App handles 1,000 leads without slowdown
- [ ] App handles 10,000 leads with pagination

---

## PART 15: CONSTRAINTS

- **Do NOT split lead detail into popups/modals.** Keep the single-page layout. Fix performance through code optimization.
- **Do NOT remove any features.** All 9 tools, AI panels, comps, dialer, notes, tasks stay.
- **Do NOT change the UI design.** Only optimize rendering and data fetching.
- **AWS RDS compatible.** No Neon-specific features. Standard Postgres indexes and JSONB.
- **Preserve all API contracts.** Return shapes and status codes must remain the same.
