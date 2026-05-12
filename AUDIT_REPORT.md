# Digor Codebase — Full Audit Report
**Generated:** May 12, 2026
**Last Updated:** May 12, 2026 (Session 6 — audit corrections + detect-condition circuit breaker fix)
**Scope:** `replit_agent_prompt_complete.md` — all parts reviewed against current `artifacts/` codebase
**Auditor:** Replit Agent

---

## VALIDATION RUNS

| Check | Result | Notes |
|-------|--------|-------|
| `python3 -m py_compile workers/main.py` | ⚠️ Skipped | Python3 not in shell PATH in this environment |
| `python3 -m py_compile workers/http_client.py` | ⚠️ Skipped | Same — no python3 binary in shell |
| `npx tsc --noEmit` (api-server) | ⚠️ Skipped | node_modules not installed in this environment |
| Dockerfile.fargate syntax review | ✅ Pass | Reviewed manually — no syntax errors found |
| requirements.txt content review | ✅ Pass | Bloat packages removed, Pillow present |
| Dead file check (Railway/Lambda) | ✅ Pass | Scraper engine dir clean of all Railway/Lambda files |

> **Note on validation:** Python and Node runtimes are not available in the Replit shell for this project. All validations below are code-review based. To run compile checks, use: `cd artifacts/digor-scraper-engine && python3 -m py_compile workers/main.py` and `cd artifacts/api-server && npx tsc --noEmit`.

---

## LEGEND

| Symbol | Meaning |
|--------|---------|
| ✅ | Done — verified in codebase |
| ⚠️ | Partial — incomplete or has a remaining issue |
| ❌ | Not done |
| N/A | Not applicable |

---

## SESSION 6 — CORRECTIONS AND FIXES

### Audit Corrections (items incorrectly marked in previous audit)

| Item | Previous Status | Corrected Status | Finding |
|------|----------------|-----------------|---------|
| 12.3 CompsSection useMemo | ❌ | ✅ | `CompsSection.tsx` has `useMemo` for `marketSqftRate` (line 40) and for `avgAdjusted`, `arv`, `dealRatio`, `dealFlag`, `compsWithAdj` (line 295). `calcBreakdown()` is called only when `isOpen` — lazy on expand. Was already correct when extracted. |
| 2.3.5 Campaign deletion batching | ⚠️ | ✅ | `campaigns.ts` has `chunkArray<T>()` at line 195. All deletes loop over `chunkArray(ids, 500)`. Chunking was already in place. |
| 2.3.1 Circuit breaker (detect-condition) | ✅ | ⚠️ → **Fixed ✅** | `detect-condition` was missing `aiBreaker.isOpen()` guard and `aiBreaker.recordFailure()` in catch. Now all 5 AI endpoints are covered. |

### New Fixes Applied This Session

| # | Fix | File |
|---|-----|------|
| S6-01 | Added `aiBreaker.isOpen()` guard to `detect-condition` endpoint | `routes/crm/leads.ts` line 1750 |
| S6-02 | Added `aiBreaker.recordFailure()` to `detect-condition` catch block | `routes/crm/leads.ts` line 1885 |

---

## PART 1 — PYTHON SCRAPER ENGINE

### 1.1 CRITICAL — Security

| # | Item | File | Status | Evidence |
|---|------|------|--------|----------|
| 1.1.1 | SSL verification enabled by default | `http_client.py` | ✅ | `fetch_direct(verify_ssl=True)` default is secure. `_ssl_ctx(verify)` handles both modes. |
| 1.1.2 | `/debug/env` endpoint removed | `main.py` | ✅ | Endpoint does not exist in codebase. |
| 1.1.3 | CORS defaults to `[]` | `main.py` | ✅ | Line 262: `or []` — no wildcard default. |
| 1.1.4 | `/admin/*` checks `ADMIN_API_KEY` | `main.py` | ✅ | `_security_middleware` checks `ADMIN_API_KEY` for paths starting with `/admin/`. |

### 1.2 CRITICAL — Runtime

| # | Item | File | Status | Evidence |
|---|------|------|--------|----------|
| 1.2.1 | Connection pooling via `_persistent_client` | `http_client.py` | ✅ | `fetch_direct` and `fetch_pdf` use persistent client when no proxy; fall back to new client when proxy is required. |
| 1.2.2 | METRICS race condition — asyncio.Lock | `main.py` | ✅ | All METRICS increments wrapped: `async with _get_metrics_lock():` |
| 1.2.3 | Session tests don't mutate `os.environ` | `main.py` | ✅ | Calls `test_login_credentials(email, password)` directly — no `os.environ` mutation. |
| 1.2.4 | `propelio_v2._do_login()` accepts credentials | `scrapers/propelio_v2.py` | ✅ | `_do_login(page, email: str | None = None, password: str | None = None)` with env fallback. |
| 1.2.5 | `propwire._do_login()` accepts credentials | `scrapers/propwire.py` | ✅ | Same pattern as propelio_v2. |
| 1.2.6 | `satellite_rekognition.py` no `os.environ` mutation | `scrapers/satellite_rekognition.py` | ✅ | No `os.environ["USE_REKOGNITION"]` mutation found. |

### 1.3 HIGH — Docker / Build

| # | Item | File | Status | Evidence |
|---|------|------|--------|----------|
| 1.3.1 | `libpq5` in final image | `Dockerfile.fargate` | ✅ | `libpq5` in runtime apt-get block. |
| 1.3.2 | Chromium installed at build time | `Dockerfile.fargate` | ✅ | `playwright install chromium --with-deps` in builder stage. No `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`. |
| 1.3.3 | `start.fargate.sh` only runs uvicorn | `start.fargate.sh` | ✅ | Preflight env checks + ECS metadata only; `exec uvicorn` at end. No background downloads. |

### 1.4 HIGH — Code Quality

| # | Item | File | Status | Evidence |
|---|------|------|--------|----------|
| 1.4.1 | Health returns `app.version` | `main.py` | ✅ | `"version": app.version` in health endpoint. |
| 1.4.2 | No inline `__import__("httpx")` | `main.py` | ✅ | No `__import__` calls found in main.py. |
| 1.4.3 | No inline `__import__("os")` in cash_buyers.py | `cash_buyers.py` | ✅ | No `__import__` calls found. |
| 1.4.4 | STEALTH_JS not duplicated | `http_client.py` | ✅ | Line 107: `from .scrapers._browser_session import _STEALTH_SCRIPT as _STEALTH_JS`. Imported, not duplicated. |

### 1.5 MEDIUM — Requirements Alignment

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1.5 | Single `requirements.txt` with bloat removed | ✅ | Single `requirements.txt` in scraper engine dir. Removed: `anthropic`, `groq`, `pandas`, `numpy`, `ultralytics`, `opencv-python-headless`. `Pillow==11.2.1` present. `cryptography==44.0.2` added for AES-256-CBC. `Dockerfile.fargate` references it. |

---

## PART 2 — NODE.JS API SERVER

### 2.1 CRITICAL — Multi-Instance State (Fargate)

| # | Item | File | Status | Details |
|---|------|------|--------|---------|
| 2.1.1 | PropertyAPI cooldowns in Redis/Postgres | `services/propertyApi.ts` | ❌ | `skipTraceMap`, `fetchCompsMap`, `leadFetchMap`, `campaignFetchMap` are module-level `Map` objects. **Requires Redis. Cannot be done without infrastructure.** |
| 2.1.2 | PropertyAPI key rotation state in Redis | `services/propertyApi.ts` | ❌ | `_keyIndex` (line 44) and `_depletedKeys` (line 45) still module-level. **Requires Redis.** |
| 2.1.3 | ATTOM depleted key cache in Redis | `services/attomApi.ts` | ❌ | `_depletedAttomKeys` (line 16) still module-level Set. **Requires Redis.** |
| 2.1.4 | Comps job store in Redis/Postgres | `routes/crm/leads.ts` | ❌ | `compsJobs` at line 25 is still an in-memory `Map`. Jobs started on Task A cannot be polled from Task B. **Requires Redis or Postgres table.** |
| 2.1.5 | Email sequence job distributed lock | `routes/crm/sequences.ts` | ✅ | `pg_try_advisory_lock(44332211)` + `pg_advisory_unlock` in `finally`. Only one Fargate task runs the job at a time. |

> **Note:** `skipTraceJobs` (tools.ts line 910) and `phoneFinderJobs` (tools.ts line 1126) are also in-memory Maps with the same multi-instance issue. Not listed in the original prompt but have the same Fargate problem as 2.1.4.

> **Impact on 2.1.1–2.1.4:** These are production blockers for real multi-task Fargate. All require a Redis instance (`ioredis`). No Redis is provisioned in this environment — these cannot be fixed without infrastructure.

### 2.2 CRITICAL — Security

| # | Item | File | Status | Details |
|---|------|------|--------|---------|
| 2.2.1 | `crmAuth` on catch-all proxy | `routes/scraperEngine.ts` | ✅ | `router.all("/scraper-engine/{*path}", crmAuth, ...)` |
| 2.2.2 | Python decrypts credentials (not Node) | `routes/scraperEngine.ts` + `workers/main.py` | ✅ | Node test endpoints pass encrypted strings to Python. Python `_decrypt_password()` uses AES-256-CBC with `sha256(ENCRYPTION_KEY\|\|JWT_SECRET)` — matches Node.js `crypto-util.ts`. `cryptography==44.0.2` added to requirements.txt. |
| 2.2.3 | `X-API-Key` in `scraperEngineClient.ts` | `services/scraperEngineClient.ts` | ✅ | `"X-API-Key": apiKey` in `request()` headers. |
| 2.2.4 | Catch-all forwards `X-API-Key` + `Authorization` | `routes/scraperEngine.ts` | ✅ | `X-API-Key` and `Authorization` headers forwarded in catch-all proxy. |

### 2.3 HIGH — Reliability / Performance

| # | Item | File | Status | Details |
|---|------|------|--------|---------|
| 2.3.1 | All 5 AI endpoints have circuit breaker + timeout | `routes/crm/leads.ts` | ✅ | **Fixed S6.** All 5 endpoints (`ai-repair-estimate`, `detect-condition`, `ai-deal-score`, `ai-seller-script`, `ai-offer-letter`) now have `aiBreaker.isOpen()` guard and `aiBreaker.recordFailure()` in catch. `AbortSignal.timeout(20_000)` present in all AI fetch calls. |
| 2.3.2 | Email job batches leads (cursor pagination) | `routes/crm/sequences.ts` | ✅ | Leads fetched in pages of 200 via `.limit(PAGE).offset(offset)` loop. |
| 2.3.3 | Email job concurrency control | `routes/crm/sequences.ts` | ✅ | `makeSemaphore(5)` added. `brevoSendWithRetry` wrapped with `emailSemaphore(() => ...)` — max 5 concurrent sends. |
| 2.3.4 | Brevo calls have retry + backoff | `routes/crm/sequences.ts` | ✅ | `brevoSendWithRetry()` with 3 attempts, exponential back-off on 429. |
| 2.3.5 | Campaign deletion uses batch deletion | `routes/crm/campaigns.ts` | ✅ | `chunkArray<T>(arr, 500)` helper at line 195. All deletes loop over chunks of 500. |
| 2.3.6 | CSV upload wrapped in transaction | `routes/crm/buyers.ts` | ✅ | `db.transaction(async (tx) => { ... })` wraps all batch inserts. |
| 2.3.7 | Comps fallback uses `X-API-Key` | `routes/crm/leads.ts` | ✅ | `fetchCompsViaScraperEngine()` includes `"X-API-Key": process.env.SCRAPER_API_KEY \|\| ""`. |
| 2.3.8 | Comps recalculation uses parallel update | `routes/crm/leads.ts` | ✅ | `Promise.all(compCalcs.map(...))` — all ARV recalc updates run in parallel. |

### 2.4 MEDIUM — Security / Quality

| # | Item | File | Status | Details |
|---|------|------|--------|---------|
| 2.4.1 | Super admin password uses `timingSafeEqual` | `routes/crm/campaigns.ts` | ✅ | `crypto.timingSafeEqual(Buffer.from(superAdminPassword), Buffer.from(envPassword))` with length guard. |
| 2.4.2 | Twilio SID not exposed in responses | `routes/crm/campaigns.ts` | ✅ | `twilioAccountSid` used internally only; only `twilioConfigured: boolean` in response. |
| 2.4.3 | `getBaseUrl` uses `PUBLIC_URL` env | `routes/crm/links.ts` | ✅ | `if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "")` as first check. |
| 2.4.4 | `toE164` rejects invalid lengths | `services/coreCalculations.ts` | ✅ | Only 10-digit and 11-digit-starting-with-1 accepted. No `> 7 digit` fallback. |
| 2.4.5 | AI endpoints no `response_format` | `routes/crm/leads.ts` | ✅ | `response_format: { type: "json_object" }` removed from all AI endpoints. System prompts instruct JSON-only replies. |
| 2.4.6 | `formatLead` JSON.parse is safe | `routes/crm/leads.ts` | ✅ | `Array.isArray` check + `try/catch` for `skipTracedPhones` and `skipTracedEmails`. |

---

## PART 3 — FARGATE CLEANUP

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 3.1 | Railway `Dockerfile` deleted | ✅ | Not in `artifacts/digor-scraper-engine/` |
| 3.2 | Lambda `Dockerfile.lambda` deleted | ✅ | Not in `artifacts/digor-scraper-engine/` |
| 3.2 | `workers/lambda_handler.py` deleted | ✅ | Not in `artifacts/digor-scraper-engine/workers/` |
| 3.1 | `start.sh` (Railway) deleted from scraper engine | ✅ | Not in `artifacts/digor-scraper-engine/`. Only `start.fargate.sh` present. |
| 3.1 | `requirements.railway.txt` deleted from scraper engine | ✅ | Not in `artifacts/digor-scraper-engine/` |
| 3.1 | `railway.json` deleted from scraper engine dir | ✅ | Deleted in Session 4. |
| 3.3 | `_patch_ld_library_path()` removed from `main.py` | ✅ | Function does not exist. Only `os.environ.get("LD_LIBRARY_PATH")` for health reporting. |
| 3.4 | `requirements.txt` consolidated | ✅ | Single `requirements.txt`; `Dockerfile.fargate` references it. |

> **Root-level files (separate scope):** `start.sh`, `requirements.railway.txt`, `railway.json`, `railpack.json` at the workspace root are from the Digor Node.js repo, not the Python scraper engine. They were not deleted as they are out of scope.

---

## PART 4 — PACKAGE CLEANUP

| Package | Status | Evidence |
|---------|--------|----------|
| `ultralytics` | ✅ Removed | Not in `requirements.txt` |
| `opencv-python-headless` | ✅ Removed | Not in `requirements.txt` |
| `pandas` | ✅ Removed | Not in `requirements.txt` |
| `numpy` | ✅ Removed | Not in `requirements.txt` |
| `anthropic` | ✅ Removed | Not in `requirements.txt` |
| `groq` | ✅ Removed | Not in `requirements.txt` |
| `Pillow` | ✅ Present | `Pillow==11.2.1` in `requirements.txt` |
| `yolov8n.pt` download | ✅ Removed | Never in `Dockerfile.fargate` |
| YOLO import in `satellite_dfd.py` | ✅ Removed | All YOLO globals, constants, and functions removed. `_visual_signals()` updated to GCV-only. `/debug/satellite` updated to remove `_YOLO_AVAILABLE` import. |

---

## PART 5 — NEW FEATURES

| Feature | Status | Notes |
|---------|--------|-------|
| 5.1 SMS Sequences via Twilio | ❌ Not implemented | No `smsService.ts`, no SMS step type in sequences, no `crm_sms_opt_outs` table. Requires schema changes, new service, and UI work. Estimated 3–5 days. |
| 5.2 Direct Mail via Brevo | ❌ Not implemented | No `directMailService.ts`, no direct_mail step type. Estimated 2–3 days. |
| 5.3 PWA for digor-tools | ❌ Not implemented | No `vite-plugin-pwa`, no `manifest.json`, no service worker. Estimated 3–5 days. |

> **Honest assessment:** These three features are substantial engineering projects. None has any scaffolding, schema, or service code. They were out of scope for bug-fix sessions.

---

## PART 6 — CROSS-REPO ALIGNMENT

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 6.1 | `propelio_v2._do_login()` accepts email/password | ✅ | Optional kwargs with env fallback. |
| 6.1 | `propwire._do_login()` accepts email/password | ✅ | Same pattern. |
| 6.1 | Session test endpoints pass params (no env mutation) | ✅ | `test_login_credentials(email, password)` called directly. |
| 6.2 | `scraperEngineClient.ts` sends `X-API-Key` | ✅ | In `request()` headers. |
| 6.2 | `scraperEngine.ts` catch-all forwards `X-API-Key` + `Authorization` | ✅ | Both headers forwarded in proxy. |
| 6.2 | `scraperEngine.ts` test endpoints pass encrypted creds to Python | ✅ | Node does NOT decrypt. Python `_decrypt_password()` handles decryption. |

---

## PART 9 — TOOLS FRONTEND/BACKEND

| # | Item | Status | Details |
|---|------|--------|---------|
| 9.1.1 | `X-API-Key` in scraperEngineClient | ✅ | Fixed |
| 9.1.2 | No Railway fallback URL | ✅ | Removed from `scraperEngineClient.ts`, `tools.ts`, and `scraper.ts`. |
| 9.2 | Skip Trace sync/async contract | ✅ | `tools.ts` implements `skipTraceJobs` async polling pattern. |
| 9.3 | Phone Finder sync/async contract | ✅ | `tools.ts` implements `phoneFinderJobs` async Map + polling endpoints. |
| 9.4.1 | `tools.ts` uses `scraperEngine.health()` not raw axios | ✅ | No raw `axios.get()` found in `tools.ts`. |
| 9.4.2 | ARV handles empty comps (no NaN) | ✅ | Guards present — returns 422 on empty. |
| 9.4.3 | Property lookup parallel calls | ✅ | Parallel fetch for subject property + comps. |
| 9.5.1 | Auth hook redirects on 401 | ✅ | `use-tools.tsx`: `if (res.status === 401)` clears PIN, redirects to `/`. |
| 9.5.2 | Tools hook has request timeouts | ✅ | `use-tools.tsx`: `AbortSignal.timeout(60_000)`. |

> **Note on 9.2/9.3 multi-instance:** `phoneFinderJobs` and `skipTraceJobs` in `tools.ts` are in-memory Maps with the same Fargate multi-instance problem as `compsJobs` (2.1.4). Not in the original prompt's issue list, but same bug. Requires Redis.

> **CAPTCHA Solver (prompt section 9.6):** Not implemented. This is a new feature requiring a new `workers/scrapers/captcha_solver.py` module, changes to `_browser_session.py`, `http_client.py`, and `retry_queue.py`. Estimated effort: 2–3 days. Not a bug fix — left as a future feature.

---

## PART 10 — BACKEND PERFORMANCE (`leads.ts`)

| # | Item | Status | Details |
|---|------|--------|---------|
| 10.1 | List view uses single JOIN query | ✅ | Single `Promise.all([COUNT, LEFT JOIN query])` |
| 10.2 | `formatLead` no raw JSON.parse | ✅ | `Array.isArray` check + safe try/catch parse |
| 10.3 | Database indexes created | ✅ | `artifacts/api-server/migrations/add_performance_indexes.sql` created with all 12 indexes from prompt. |
| 10.4 | Search uses trgm index | ✅ | Migration adds `gin_trgm_ops` indexes on address/phone/email/seller_name. |
| 10.5 | `/full` endpoint supports `?include=` | ✅ | `includeSet` parses `?include=notes,tasks,followers,comps`. Unrequested sections resolve to `[]`. |
| 10.6 | Notes/tasks have LIMIT pagination | ✅ | Notes `.limit(50)` and separate `GET /:id/notes?limit=20&offset=0` endpoint. Tasks `.limit(30)`. |
| 10.7 | Lead list cached in Redis (30s) | ❌ | **Requires Redis infrastructure.** No Redis instance provisioned in this environment. |

---

## PART 11 — FRONTEND LIST (`LeadList.tsx`)

| # | Item | Status | Details |
|---|------|--------|---------|
| 11.1 | Staggered animation delays removed | ✅ | `transition={{ delay: i * 0.05 }}` removed. |
| 11.2 | Search input debounced (400ms) | ✅ | `debouncedSearch` state; query uses `debouncedSearch`. |
| 11.3 | Dates pre-formatted (not in render) | ✅ | `createdAtFormatted`, `updatedAtRelative`, `daysSinceUpdate` computed in `formatLeadSummary()` on backend. |
| 11.4 | Virtualization | N/A | Pagination limits to 20 items per page. |
| 11.5 | `STATUS_COLORS` lookup object | ✅ | `const STATUS_COLORS: Record<string, string>` used in render. |

---

## PART 12 — FRONTEND DETAIL (`LeadDetail.tsx`)

| # | Item | Status | Details |
|---|------|--------|---------|
| 12.1 | `formData` uses `useRef` for values | ⚠️ | `formDataRef = useRef({})` exists and is synced each render. Auto-save reads `formDataRef.current`. But `formData` state still kept for controlled React inputs — removing it entirely would require converting all inputs to uncontrolled, breaking React's controlled input pattern. This is the practical limit of the "useRef only" approach. Critical part (auto-save deps) is done. |
| 12.2 | Auto-save `useEffect` deps: `[isDirty]` only | ✅ | `}, [isDirty]` — `formData` removed from deps. Timer reads `formDataRef.current` inside callback. |
| 12.3 | `CompsSection` calculations in `useMemo` | ✅ | **Corrected from ❌.** `CompsSection.tsx`: `useMemo` for `marketSqftRate` (line 40) and for `avgAdjusted`, `arv`, `dealRatio`, `dealFlag`, `compsWithAdj` (line 295). `calcBreakdown()` called only when comp is expanded (`isOpen`) — lazy evaluation. |
| 12.4 | AI components wrapped in `React.memo()` | ✅ | All 4 AI component files export `memo`-wrapped components. |
| 12.5 | `React.lazy()` + `Suspense` for below-fold sections | ✅ | All 6 sections lazy-loaded: `CompsSection`, `AiRepairEstimator`, `AiDealScorer`, `AiSellerScript`, `AiOfferLetter`, `CashBuyerMatchPanel`. Suspense fallbacks: skeleton divs. |
| 12.6 | Split `useQuery` for `/full` | ✅ | Main query: `/full?include=tasks,followers`. Separate notes query: `/leads/${leadId}/notes?limit=20`. |
| 12.7 | apiFetch handles 401 | ✅ | Shared `apiFetch` in `lib/api.ts`: `if (r.status === 401)` removes `crm_token` and redirects to login. |
| 12.8 | Campaign users cached globally | ✅ | `staleTime: Infinity, gcTime: Infinity` set. |
| 12.9 | Input fields debounced | ✅ | `useDebouncedValue` hook at line 1505. `sellerName`, `phone`, `email` inputs all debounced at 200ms. Local input state drives the UI; debounced value syncs to `formData`. |
| 12.10 | `MentionTextarea` wrapped in `React.memo()` | ✅ | `const MentionTextarea = memo(function MentionTextarea(...))` |

---

## PART 13 — DATABASE MIGRATIONS

| # | Item | Status |
|---|------|--------|
| 13.1 | Performance indexes migration created | ✅ | `artifacts/api-server/migrations/add_performance_indexes.sql` — all 12 indexes from prompt. Uses `IF NOT EXISTS`. Safe for live DB. |
| 13.2 | `skipTracedPhones`/`skipTracedEmails` JSONB conversion | ✅ | SQL is in the migration file, commented out with clear instructions. Marked conditional: run only if columns are `TEXT`. Cannot be uncommented unconditionally — requires knowing current column type in prod DB. |

**To apply indexes:**
```bash
psql $DATABASE_URL -f artifacts/api-server/migrations/add_performance_indexes.sql
```
All statements use `IF NOT EXISTS` — safe to run on a live database without downtime.

---

## SUMMARY SCORECARD

### Overall Status (All Sessions through S6)

| Area | Done | Partial | Not Done | Total |
|------|------|---------|----------|-------|
| Python Security (1.1) | 4 | 0 | 0 | 4 |
| Python Runtime (1.2) | 6 | 0 | 0 | 6 |
| Python Docker/Build (1.3) | 3 | 0 | 0 | 3 |
| Python Code Quality (1.4) | 4 | 0 | 0 | 4 |
| Requirements (1.5) | 1 | 0 | 0 | 1 |
| Fargate Cleanup (3.x) | 8 | 0 | 0 | 8 |
| Package Cleanup (4.x) | 9 | 0 | 0 | 9 |
| Node Security (2.2.x) | 4 | 0 | 0 | 4 |
| Node Quality (2.4.x) | 6 | 0 | 0 | 6 |
| Node Multi-instance (2.1.x) | 1 | 0 | 4 | 5 |
| Node Reliability (2.3.x) | 8 | 0 | 0 | 8 |
| Cross-repo (6.x) | 6 | 0 | 0 | 6 |
| Tools frontend (9.x) | 8 | 0 | 0 | 8 |
| Backend perf (10.x) | 6 | 0 | 1 (10.7 Redis) | 7 |
| Frontend list (11.x) | 5 | 0 | 0 | 5 |
| Frontend detail (12.x) | 9 | 1 (12.1 partial) | 0 | 10 |
| DB migrations (13.x) | 2 | 0 | 0 | 2 |
| New Features (5.x) | 0 | 0 | 3 | 3 |
| **Total** | **90** | **1** | **8** | **99** |

> **Score: ~90.5/99 ≈ 91%** of items addressed (fully or partially).

---

## REMAINING ITEMS — HONEST ASSESSMENT

### Cannot Be Done Without Infrastructure (Redis required)

| Priority | Item | Why Redis Required |
|----------|------|--------------------|
| 🔴 CRITICAL | 2.1.1 — PropertyAPI cooldown Maps | Multi-task Fargate needs shared state |
| 🔴 CRITICAL | 2.1.2 — PropertyAPI key rotation | `_keyIndex` and `_depletedKeys` per-container |
| 🔴 CRITICAL | 2.1.3 — ATTOM depleted key cache | `_depletedAttomKeys` per-container |
| 🔴 CRITICAL | 2.1.4 — `compsJobs` Map | Job started on Task A, polled from Task B = 404 |
| 🟡 MEDIUM | 10.7 — Lead list Redis cache (30s) | No Redis instance available |

**To unblock these:** Provision a Redis instance (AWS ElastiCache or Redis Cloud). Add `ioredis` as a dependency. Each fix is then ~2–4 hours of code work.

### New Features — Not Started (out of scope for bug-fix sessions)

| Priority | Feature | Estimated Effort |
|----------|---------|-----------------|
| 🔵 NEW | 5.1 — SMS Sequences via Twilio | 3–5 days |
| 🔵 NEW | 5.2 — Direct Mail via Brevo | 2–3 days |
| 🔵 NEW | 5.3 — PWA for digor-tools | 3–5 days |
| 🔵 NEW | Captcha Solver (section 9.6) | 2–3 days |

### Partial — Practical Limit Reached

| Item | What's Done | What Remains | Why Stopped |
|------|-------------|--------------|-------------|
| 12.1 formData useRef | `formDataRef` synced every render. Auto-save reads ref only. `[isDirty]` in effect deps. | Converting all inputs to truly uncontrolled | React controlled inputs require state. Converting to uncontrolled inputs breaks label/value binding and React's validation model. The performance-critical part (auto-save not re-running on every keystroke) is done. |

---

## WHAT CANNOT BE DONE IN THIS ENVIRONMENT

| Item | Reason |
|------|--------|
| Run `python3 -m py_compile` | No Python3 in shell PATH |
| Run `npx tsc --noEmit` | node_modules not installed |
| Run database migrations | No `DATABASE_URL` connection available |
| Apply Redis fixes (2.1.x, 10.7) | No Redis instance provisioned |
| Docker build test | No Docker daemon in Replit shell |
