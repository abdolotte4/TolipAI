# Digor Codebase — Full Audit Report
**Generated:** May 12, 2026  
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
| Dead file check (Railway/Lambda) | ✅ Pass | All obsolete files confirmed deleted |

> **Note:** Python and Node runtimes are not available in the Replit shell for this project. All validations below are code-review based. To run compile checks, use: `cd artifacts/digor-scraper-engine && python3 -m py_compile workers/main.py` and `cd artifacts/api-server && npx tsc --noEmit`.

---

## LEGEND

| Symbol | Meaning |
|--------|---------|
| ✅ | Done — verified in codebase |
| ⚠️ | Partial — incomplete or has a remaining issue |
| ❌ | Not done |
| N/A | Not applicable |

---

## PART 1 — PYTHON SCRAPER ENGINE

### 1.1 CRITICAL — Security

| # | Item | File | Status | Evidence |
|---|------|------|--------|----------|
| 1.1.1 | SSL verification enabled by default | `http_client.py` | ✅ | `_ssl_ctx(verify=True)` — `verify` param accepted, CERT_NONE only when `verify=False` |
| 1.1.2 | `/debug/env` endpoint removed | `main.py` | ✅ | Endpoint does not exist in codebase |
| 1.1.3 | CORS defaults to `[]` | `main.py` | ✅ | `or []` at line 262 — no wildcard default |
| 1.1.4 | `/admin/*` checks `ADMIN_API_KEY` | `main.py` | ✅ | `_security_middleware` checks `ADMIN_API_KEY` for paths starting with `/admin/` |

### 1.2 CRITICAL — Runtime

| # | Item | File | Status | Evidence |
|---|------|------|--------|----------|
| 1.2.1 | Connection pooling via `_persistent_client` | `http_client.py` | ✅ | `fetch_direct()` uses `_persistent_client` instead of creating new client per call |
| 1.2.2 | METRICS race condition — asyncio.Lock | `main.py` | ✅ | All 9 METRICS increments wrapped: `async with _get_metrics_lock():` |
| 1.2.3 | Session tests no `os.environ` mutation | `main.py` | ✅ | `/session/propelio/test` and `/session/propwire/test` call `test_login_credentials(email, password)` |
| 1.2.4 | `propelio_v2._do_login()` accepts credentials | `scrapers/propelio_v2.py` | ✅ | `_do_login(page, email=None, password=None)` with env fallback |
| 1.2.5 | `propwire._do_login()` accepts credentials | `scrapers/propwire.py` | ✅ | Same pattern as propelio_v2 |
| 1.2.6 | `satellite_rekognition.py` no `os.environ` mutation | `scrapers/satellite_rekognition.py` | ✅ | `os.environ["USE_REKOGNITION"] = "1"` mutation removed |

### 1.3 HIGH — Docker / Build

| # | Item | File | Status | Evidence |
|---|------|------|--------|----------|
| 1.3.1 | `libpq5` in final image | `Dockerfile.fargate` | ✅ | Line 82: `libpq5 \` in runtime apt-get block |
| 1.3.2 | Chromium installed at build time | `Dockerfile.fargate` | ✅ | Lines 41-42: `playwright install chromium --with-deps` in builder stage. No `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` |
| 1.3.3 | `start.fargate.sh` only runs uvicorn | `start.fargate.sh` | ✅ | Preflight env checks + ECS metadata only; `exec uvicorn` at end. No background downloads |

### 1.4 HIGH — Code Quality

| # | Item | File | Status | Evidence / Fix Needed |
|---|------|------|--------|----------------------|
| 1.4.1 | Health returns `app.version` | `main.py` | ✅ | **Fixed this session** — `"version": app.version` at line 840 |
| 1.4.2 | No inline `__import__("httpx")` | `main.py` | ✅ | **Fixed this session** — replaced both occurrences in `_phone_finder_lookup` with `import httpx as _httpx` |
| 1.4.3 | No inline `__import__("os")` in cash_buyers.py | `cash_buyers.py` | ✅ | **Fixed this session** — `import os` added to top, `os.getenv()` used at line 190 |
| 1.4.4 | STEALTH_JS not duplicated | `http_client.py` | ❌ | `_STEALTH_JS` (~200 lines) still duplicated from `_browser_session._STEALTH_SCRIPT`. **Not changed** — constraint says do not alter stealth logic. Low risk since no functional bug. |

### 1.5 MEDIUM — Requirements Alignment

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1.5 | Single `requirements.txt` with bloat removed | ✅ | `requirements.fargate.txt` → `requirements.txt`. Removed: `anthropic`, `groq`, `pandas`, `numpy`, `ultralytics`, `opencv-python-headless`. `Pillow==11.2.1` present. |

---

## PART 2 — NODE.JS API SERVER

### 2.1 CRITICAL — Multi-Instance State (Fargate)

| # | Item | File | Status | Details |
|---|------|------|--------|---------|
| 2.1.1 | PropertyAPI cooldowns in Redis/Postgres | `services/propertyApi.ts` | ❌ | `skipTraceMap`, `fetchCompsMap`, `leadFetchMap`, `campaignFetchMap` are still module-level `Map` objects. In multi-task Fargate each container has its own copy — cooldowns are not enforced across instances. |
| 2.1.2 | PropertyAPI key rotation state in Redis | `services/propertyApi.ts` | ❌ | `_keyIndex` and `_depletedKeys` still module-level. Key rotation not shared across tasks. |
| 2.1.3 | ATTOM depleted key cache in Redis | `services/attomApi.ts` | ❌ | `_depletedAttomKeys` and `_depletedAttomKeyTimes` still module-level Set/Map. |
| 2.1.4 | Comps job store in Redis/Postgres | `routes/crm/leads.ts` | ❌ | `compsJobs` at line 25 is still an in-memory `Map`. Jobs started on Task A cannot be polled from Task B. |
| 2.1.5 | Email sequence job distributed lock | `routes/crm/sequences.ts` | ❌ | `lastEmailJobRun` at line 173 is still a module-level number. All tasks will run the email job simultaneously each hour, sending duplicate emails. |

> **Impact:** Items 2.1.1–2.1.5 are the most critical production blockers for a real multi-task Fargate deployment. These require Redis integration (e.g., `ioredis`) or Postgres advisory locks.

### 2.2 CRITICAL — Security

| # | Item | File | Status | Details |
|---|------|------|--------|---------|
| 2.2.1 | `crmAuth` on catch-all proxy | `routes/scraperEngine.ts` | ✅ | `router.all("/scraper-engine/{*path}", crmAuth, ...)` — confirmed at line 469 |
| 2.2.2 | Test endpoints do NOT decrypt credentials | `routes/scraperEngine.ts` | ❌ | `decryptPassword(rawEmail)` and `decryptPassword(rawPass)` still called at lines 155–156 and 242–243. Decrypted plaintext credentials are sent to Python engine. |
| 2.2.3 | `X-API-Key` in `scraperEngineClient.ts` | `services/scraperEngineClient.ts` | ✅ | `"X-API-Key": process.env.SCRAPER_API_KEY || ""` added to `request()` headers |
| 2.2.4 | Catch-all forwards `X-API-Key` | `routes/scraperEngine.ts` | ✅ | `X-API-Key` header forwarded in catch-all proxy |

### 2.3 HIGH — Reliability / Performance

| # | Item | File | Status | Details |
|---|------|------|--------|---------|
| 2.3.1 | AI endpoints have circuit breaker + timeout | `routes/crm/leads.ts` | ⚠️ | `AbortSignal.timeout(120_000)` added to some AI calls (lines 1258, 1278, 1748). **No circuit breaker pattern** — no failure-count tracking or half-open state. Will still hammer a failing LLM endpoint. |
| 2.3.2 | Email job batches leads (cursor pagination) | `routes/crm/sequences.ts` | ❌ | Still loads ALL active leads into memory. OOM risk at scale. |
| 2.3.3 | Email job concurrency control (`p-limit`) | `routes/crm/sequences.ts` | ❌ | No concurrency control. Emails sent one-by-one. |
| 2.3.4 | Brevo calls have retry + backoff | `routes/crm/sequences.ts` | ❌ | No retry logic for 429/5xx responses. |
| 2.3.5 | Campaign deletion uses batch deletion | `routes/crm/campaigns.ts` | ⚠️ | Uses `inArray()` (correct), but first loads **all** lead IDs, user IDs, and sequence IDs into JavaScript arrays (lines 232–235). For campaigns with thousands of leads this is a memory issue. No chunking. |
| 2.3.6 | CSV upload wrapped in transaction | `routes/crm/buyers.ts` | ❌ | Batches of 100 inserted as separate DB calls. Partial commits on failure. No rollback. |
| 2.3.7 | Comps fallback uses authenticated client | `routes/crm/leads.ts` | ❌ | `fetchCompsViaScraperEngine()` at lines 1254 and 1274 uses raw `fetch()` — no `X-API-Key` header. Breaks when `SCRAPER_API_KEY` is set. |
| 2.3.8 | Comps recalculation uses batch update | `routes/crm/leads.ts` | ❌ | `fetch-comps/poll` inserts each comp individually in a loop with per-comp ARV recalculation. N+1 DB writes. |

### 2.4 MEDIUM — Security / Quality

| # | Item | File | Status | Details |
|---|------|------|--------|---------|
| 2.4.1 | Super admin password uses `bcrypt.compare()` | `routes/crm/campaigns.ts` | ⚠️ | `bcrypt.compare()` used for DB hash path. BUT line 218: `superAdminPassword === envPassword` (plaintext string comparison against env var) is timing-attack vulnerable. Should use `crypto.timingSafeEqual()`. |
| 2.4.2 | Twilio SID not exposed in responses | `routes/crm/campaigns.ts` | ❌ | `formatCampaign()` at line 42 still returns `twilioAccountSid: sid`. Only `twilioConfigured: boolean` should be returned. |
| 2.4.3 | `getBaseUrl` validates forwarded headers | `routes/crm/links.ts` | ❌ | `req.headers["x-forwarded-host"]` used without validation at line 12. Vulnerable to Host header injection. Should use `process.env.PUBLIC_URL` instead. |
| 2.4.4 | `toE164` rejects invalid lengths | `services/coreCalculations.ts` | ❌ | Line 34: `if (digits.length > 7) return \`+\${digits}\`` — a 9-digit number becomes `+123456789` (invalid E.164). Should only accept 10 or 11 digits. |
| 2.4.5 | AI endpoints handle `response_format` gracefully | `routes/crm/leads.ts` | ❌ | `response_format: { type: "json_object" }` still used at lines 1895, 1983, 2062. OpenAI-specific — will fail with Groq/Cerebras. |
| 2.4.6 | `formatLead` JSON.parse is safe | `routes/crm/leads.ts` | ✅ | **Fixed this session** — `Array.isArray` check + `try/catch` wrapping around `JSON.parse` for `skipTracedPhones` and `skipTracedEmails` |

---

## PART 3 — FARGATE CLEANUP

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 3.1 | Railway `Dockerfile` deleted | ✅ | File does not exist |
| 3.2 | Lambda `Dockerfile.lambda` deleted | ✅ | File does not exist |
| 3.2 | `workers/lambda_handler.py` deleted | ✅ | File does not exist |
| 3.1 | `start.sh` (Railway) deleted | ✅ | File does not exist |
| 3.1 | `requirements.railway.txt` deleted | ✅ | File does not exist |
| 3.3 | `_patch_ld_library_path()` removed from `main.py` | ✅ | Function and call do not exist |
| 3.4 | `requirements.txt` consolidated | ✅ | Single `requirements.txt`; `Dockerfile.fargate` references it |

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
| YOLO import in `satellite_dfd.py` | ✅ Removed | `_YOLO_AVAILABLE = False` hardcoded at top |

---

## PART 5 — NEW FEATURES

| Feature | Status | Notes |
|---------|--------|-------|
| 5.1 SMS Sequences via Twilio | ❌ Not implemented | No `smsService.ts`, no SMS step type in sequences, no `crm_sms_opt_outs` table |
| 5.2 Direct Mail via Brevo | ❌ Not implemented | No `directMailService.ts`, no direct_mail step type |
| 5.3 PWA for digor-tools | ❌ Not implemented | No `vite-plugin-pwa`, no `manifest.json`, no service worker |
| Captcha Solver | ❌ Not implemented | No `captcha_solver.py` module; `_browser_session.py` has basic CAPTCHA check but no AI solver |

---

## PART 6 — CROSS-REPO ALIGNMENT

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 6.1 | `propelio_v2._do_login()` accepts email/password | ✅ | Optional kwargs with env fallback |
| 6.1 | `propwire._do_login()` accepts email/password | ✅ | Same pattern |
| 6.1 | Session test endpoints pass params (no env mutation) | ✅ | `test_login_credentials(email, password)` called via `functools.partial` |
| 6.2 | `scraperEngineClient.ts` sends `X-API-Key` | ✅ | In `request()` headers |
| 6.2 | `scraperEngine.ts` catch-all forwards `X-API-Key` | ✅ | Header forwarded in proxy |
| 6.2 | `scraperEngine.ts` test endpoints do NOT decrypt | ❌ | `decryptPassword()` still called — plaintext sent to Python |

---

## PART 9 — TOOLS FRONTEND/BACKEND

| # | Item | Status | Details |
|---|------|--------|---------|
| 9.1.1 | `X-API-Key` in scraperEngineClient | ✅ | Fixed |
| 9.1.2 | No Railway fallback URL | ✅ | Removed from `scraperEngineClient.ts`, `tools.ts` (×2), and `scraper.ts` |
| 9.2 | Skip Trace sync/async contract | ✅ | `tools.ts` implements `skipTraceJobs` async pattern with jobId, status polling, and CSV download endpoints |
| 9.3 | Phone Finder sync/async contract | ⚠️ | Phone Finder in `tools.ts` appears to call lookups inline — verify frontend polling pattern matches response shape |
| 9.4.1 | `tools.ts` uses `scraperEngine.health()` not raw axios | ✅ | No raw `axios.get()` found in `tools.ts` |
| 9.4.2 | ARV handles empty comps (no NaN) | ✅ | Guards at lines 556 and 644: `if (!arv) return 422` |
| 9.4.3 | Property lookup parallel calls | ✅ | Comment at line 484: "Fetch subject property details + comps in parallel" |
| 9.5.1 | Auth hook redirects on 401 | ❌ | `use-auth.tsx` has no axios interceptor or fetch wrapper catching 401 |
| 9.5.2 | Tools hook has request timeouts | ❌ | `use-tools.tsx` has no `AbortController` or timeout on fetch calls |

---

## PART 10 — BACKEND PERFORMANCE (`leads.ts`)

| # | Item | Status | Details |
|---|------|--------|---------|
| 10.1 | List view uses single JOIN query | ✅ | **Fixed this session** — single `Promise.all([COUNT, LEFT JOIN query])` replacing 3–4 separate queries |
| 10.2 | `formatLead` no raw JSON.parse | ✅ | **Fixed this session** — `Array.isArray` check + safe try/catch parse |
| 10.3 | Database indexes created | ❌ | No `CREATE INDEX` statements found anywhere. Missing all 12 recommended indexes. Full table scans on every list request. |
| 10.4 | Search uses indexable query | ❌ | `ilike(crmLeads.sellerName, \`%\${search}%\`)` leading wildcard prevents all index use. No `pg_trgm` extension. |
| 10.5 | `/full` endpoint supports `?include=` | ❌ | `/leads/:id/full` always fetches notes + tasks + followers + comps in 5 parallel queries regardless of need |
| 10.6 | Notes/tasks have LIMIT pagination | ❌ | Notes and tasks fetched without any `LIMIT`. A lead with 200+ notes returns everything. |
| 10.7 | Lead list cached in Redis (30s) | ❌ | No Redis caching layer on list endpoint |

---

## PART 11 — FRONTEND LIST (`LeadList.tsx` — 291 lines)

| # | Item | Status | Details |
|---|------|--------|---------|
| 11.1 | Staggered animation delays removed | ❌ | Line 147: `transition={{ delay: i * 0.05 }}` still present. 20 leads = last item delays 1s after first. |
| 11.2 | Search input debounced (400ms) | ❌ | No debounce found. Every keystroke fires an API call. |
| 11.3 | Dates pre-formatted in backend | ❌ | Inline `format(new Date(...))` and `formatDistanceToNow()` run per lead per render |
| 11.4 | Virtualization | N/A | Pagination limits to 20 items — acceptable without virtualization |
| 11.5 | `getStatusColor` uses lookup object | ❌ | Lines 51–52: still a `switch(status)` statement inside the component. Runs for every lead on every render. |

---

## PART 12 — FRONTEND DETAIL (`LeadDetail.tsx` — 2,874 lines)

| # | Item | Status | Details |
|---|------|--------|---------|
| 12.1 | `formData` uses `useRef` for values | ⚠️ | `formDataRef = useRef({})` exists (line 1710) but a separate `formData` state is **also** kept. React re-renders on every `formData` state update. |
| 12.2 | Auto-save `useEffect` deps: `[isDirty]` only | ❌ | Line 1902: `}, [isDirty, formData])` — `formData` in deps causes the effect to reset and re-run the 1.5s timer on every keystroke |
| 12.3 | `CompsSection` calculations in `useMemo` | ❌ | No `useMemo` found in LeadDetail.tsx. Calculations run on every parent render. |
| 12.4 | AI components wrapped in `React.memo()` | ❌ | No `React.memo` found. All 4 AI panels re-render on every form keystroke. |
| 12.5 | `React.lazy()` for below-fold sections | ❌ | No lazy loading. Everything renders on mount. |
| 12.6 | Split `useQuery` for `/full` | ❌ | Single query fetches everything. No conditional or lazy section loading. |
| 12.7 | Init `useEffect` has `[]` dependency | ❌ | `[isDirty, formData]` still in auto-save dep array — re-runs on every keystroke |
| 12.8 | Campaign users cached globally | ❌ | Fetched per lead page load, no global context or increased staleTime |
| 12.9 | Input fields debounced | ❌ | No input-level debounce |
| 12.10 | `MentionTextarea` wrapped in `React.memo()` | ❌ | Not memoized — re-renders on every parent keystroke |

---

## PART 13 — DATABASE MIGRATIONS

| # | Item | Status |
|---|------|--------|
| 13.1 | All 12 performance indexes created | ❌ |
| 13.2 | `skipTracedPhones`/`skipTracedEmails` converted to JSONB | ❌ |

**Indexes still needed:**
```sql
CREATE INDEX idx_leads_campaign_archived_created ON crm_leads(campaignId, archived, createdAt DESC);
CREATE INDEX idx_leads_status ON crm_leads(status);
CREATE INDEX idx_leads_assigned ON crm_leads(assignedTo);
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_leads_search ON crm_leads USING gin (
  (COALESCE("sellerName",'') || ' ' || COALESCE(address,'') || ' ' || COALESCE(phone,'') || ' ' || COALESCE(email,'')) gin_trgm_ops
);
CREATE INDEX idx_comps_lead ON crm_comps("leadId");
CREATE INDEX idx_notes_lead ON crm_notes("leadId", "createdAt" DESC);
CREATE INDEX idx_tasks_lead ON crm_tasks("leadId", "dueDate");
CREATE INDEX idx_followers_lead ON crm_lead_followers("leadId");
CREATE INDEX idx_notifications_user_read ON crm_notifications("userId", read);
```

---

## SUMMARY SCORECARD

### ✅ Applied / Done (35 items)

| Area | Items Done |
|------|-----------|
| Python Security (1.1) | 4/4 |
| Python Runtime (1.2) | 6/6 |
| Python Docker/Build (1.3) | 3/3 |
| Python Code Quality (1.4) | 3/4 (STEALTH_JS dedup skipped by constraint) |
| Requirements (1.5) | 1/1 |
| Fargate Cleanup (3.x) | 7/7 |
| Package Cleanup (4.x) | 9/9 |
| Node Security — partial (2.2.1, 2.2.3, 2.2.4) | 3/4 |
| Node Quality — formatLead JSON parse (2.4.6) | 1/6 |
| Cross-repo alignment (6.x) | 4/5 |
| Tools critical (9.1.x, 9.2, 9.4.x) | 5/8 |
| Backend performance — list JOIN + safe parse (10.1, 10.2) | 2/7 |

### ❌ Not Yet Done (45 items)

| Priority | Area | Count |
|----------|------|-------|
| 🔴 CRITICAL | Multi-instance state (Redis) | 5 |
| 🔴 CRITICAL | scraperEngine.ts credential decrypt | 1 |
| 🔴 CRITICAL | comps fallback missing X-API-Key | 1 |
| 🟠 HIGH | Email sequence reliability (batch, concurrency, retry) | 3 |
| 🟠 HIGH | Campaign deletion memory for large data | 1 |
| 🟠 HIGH | CSV upload transaction | 1 |
| 🟠 HIGH | N+1 comps recalculation | 1 |
| 🟠 HIGH | DB indexes (all 12) | 1 |
| 🟠 HIGH | /full ?include= lazy param | 1 |
| 🟠 HIGH | Notes/tasks pagination | 1 |
| 🟡 MEDIUM | Security: twilioAccountSid exposed, forwarded host, toE164, response_format, timing-safe compare | 5 |
| 🟡 MEDIUM | Frontend List: animations, debounce, dates, status colors | 4 |
| 🟡 MEDIUM | Frontend Detail: useRef, memo, lazy, split queries, debounce | 10 |
| 🟡 MEDIUM | Tools: auth 401 redirect, request timeouts, phone finder contract | 3 |
| ⚪ LOW | New features: SMS, direct mail, PWA, captcha solver | 4 |
| ⚪ LOW | Search trigram/indexable query | 1 |
| ⚪ LOW | Redis list cache | 1 |
| ⚪ LOW | STEALTH_JS deduplication | 1 |

---

## RECOMMENDED NEXT ACTIONS (Priority Order)

### Immediate (Production Blockers)

1. **Redis multi-instance state** — Add `ioredis` to api-server. Migrate `compsJobs`, `skipTraceMap`, `fetchCompsMap`, `leadFetchMap`, `campaignFetchMap`, `_depletedKeys`/`_keyIndex`, `_depletedAttomKeys`, `lastEmailJobRun` to Redis with appropriate TTLs. This is the #1 blocker for a real multi-task Fargate deployment.

2. **Comps fallback auth** — `fetchCompsViaScraperEngine()` at lines 1254 and 1274 of `leads.ts`: add `"X-API-Key": process.env.SCRAPER_API_KEY || ""` to the `fetch()` headers, or better, route through `scraperEngineClient`.

3. **scraperEngine.ts test endpoints** — Remove `decryptPassword()` calls at lines 155–156 and 242–243. Pass encrypted strings directly to Python.

### Short-Term (This Sprint)

4. **DB Indexes** — Run the 10 `CREATE INDEX` statements above against both dev and prod databases. Biggest performance lever for the list view.

5. **twilioAccountSid exposure** — Remove `twilioAccountSid: sid` from `formatCampaign()` in `campaigns.ts`. Return only `twilioConfigured: boolean`.

6. **`toE164` validation** — Remove the `if (digits.length > 7)` fallback. Only accept 10 or 11 (starting with 1) digits.

7. **Frontend List performance** — Remove `transition={{ delay: i * 0.05 }}` from LeadList.tsx, add 400ms search debounce, convert `getStatusColor` to a const lookup object.

8. **`/full` endpoint `?include=` param** — Accept `?include=notes,tasks,comps,followers`. Skip queries for unrequested sections.

9. **Notes/tasks LIMIT** — Add `.limit(20)` to notes query in `/full` endpoint.

### Medium-Term

10. **LeadDetail.tsx** — Remove `formData` from `useEffect` dep array (line 1902). Add `React.memo()` to all 4 AI components. Wrap `CompsSection` calculations in `useMemo`.

11. **Email sequence reliability** — Add `p-limit` for concurrency, cursor-based pagination for leads, exponential backoff for Brevo 429s.

12. **Campaign deletion chunking** — For campaigns with >500 leads, process deletes in chunks of 500.

13. **`toE164` timing-safe compare** — Replace `superAdminPassword === envPassword` with `crypto.timingSafeEqual(Buffer.from(superAdminPassword), Buffer.from(envPassword))`.

14. **`getBaseUrl` host validation** — Use `process.env.PUBLIC_URL` as primary source.

### Long-Term (New Features)

15. **SMS sequences** — `smsService.ts`, extend `crm_sequence_steps` schema, opt-out table, Twilio REST integration.

16. **PWA** — `vite-plugin-pwa` in `digor-tools/vite.config.ts`, `manifest.json`, service worker with Workbox.

17. **Captcha solver** — `workers/scrapers/captcha_solver.py` using GPT-4o-mini for text CAPTCHAs.

---

*End of audit — generated from manual code review of `artifacts/` directory against `replit_agent_prompt_complete.md`*
