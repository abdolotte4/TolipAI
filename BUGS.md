# TolipAI CRM — Bug Tracker

> Last updated: 2026-05-25 (Session 3 — Twilio voice bugs, website rebrand, scripts)
> Status legend: 🔴 Open | 🟡 In-Progress | 🟢 Fixed | ⚪ Needs-Test

---

## CRITICAL

### BUG-001 — Logout triggered by scraper PIN failure 🟢 Fixed
**File:** `artifacts/api-server/src/routes/scraper.ts:28`  
**Fix:** Changed `requirePin` from returning `401` → `403`. Frontend 401-handler only logs out on JWT auth failures, not PIN errors.  
**Also fixed:** `api-setup.ts` `isToolsRoute` guard extended to include `/scraper/` paths; `api.ts` `apiRawFetch` now has `shouldLogoutOn401()` path check.

### BUG-002 — Conversations endpoint 500 crash (partial) 🟢 Fixed
**File:** `artifacts/api-server/src/routes/twilio.ts`  
**Cause 1:** Dynamic `await import()` of DB schema inside route handler (race condition / TDZ crash). Fixed.  
**Cause 2:** `crmOpenPhoneMessages.body` used — column is actually named `content`. Fixed.  
**Cause 3 (this session):** `sql\`TRUE\`` passed to `and()` filter composition caused Drizzle SQL generation issues. Fixed by using conditional conditions arrays and `Promise.allSettled` so one query failure never kills the whole response.

### BUG-003 — All 6 AI routes 502 🟢 Fixed
**File:** `artifacts/api-server/src/routes/crm/leads.ts`  
**Cause:** Routes used raw `fetch()` calls without imports or fallback logic.  
**Fix:** All 6 routes (repair-estimate, fetchCompsViaAI, detect-condition, ai-deal-score, ai-seller-script, ai-offer-letter) now use `callAI()` with OpenAI → Groq fallback.  
**Note:** If 502 persists in Railway production, check that `GROQ_API_KEY` is set in Railway env vars. ATTOM-based routes also need `ATTOM_API_KEY`.

### BUG-048 — Wildcard `/*path` catch-all served website HTML for unregistered API routes 🟢 Fixed
**File:** `artifacts/api-server/src/app.ts`  
**Cause:** The static file catch-all `app.get("/*path", ...)` at the bottom of `app.ts` was matching any path that Express hadn't already handled — including typos like `/api/crm/leadss` or completely wrong paths — and serving the CRM React SPA HTML instead of a JSON 404. This made debugging very hard since curl would return a 200 with HTML.  
**Fix:** Added `app.use("/api", (_req, res) => res.status(404).json({ error: "API endpoint not found" }))` immediately after the global error handler and before the static file block.  
**Confirmed:** `GET /api/this-does-not-exist` now returns `{"error":"API endpoint not found"}` with 404.

### BUG-051 — AWS ECS service disconnected from ELB (root cause of 504) 🔴 Open
**Service:** `tolipai-scraper-engine-service-xop` on cluster `TolipAI-scraper-cluster`  
**ELB URL:** `http://tolip-scraper-url-323311724.us-east-1.elb.amazonaws.com:8765`  
**Symptom:** ELB returns 504 Gateway Timeout for ALL requests.  
**Root cause:** ECS service `Load balancers: []` — the load balancer was never attached to the ECS service, OR was detached after initial deploy. The ECS task itself is RUNNING and HEALTHY on private IP `172.31.81.216:8765`, but the ELB has no target group pointing at it.  
**Fix required:** AWS Console → ECS → cluster `TolipAI-scraper-cluster` → service `tolipai-scraper-engine-service-xop` → Update service → attach load balancer + target group.  
**OR:** Delete and recreate the ECS service with the load balancer configured from the start.  
**Workaround:** Use local scraper engine on port 8000 (Replit env) for development and testing.

---

## HIGH

### BUG-004 — Manual Dialer shows empty (no call records / conversations) 🟢 Fixed
**File:** `artifacts/api-server/src/routes/twilio.ts`  
**Cause:** Depended on BUG-002 (conversations 500). SQL filter composition bug also caused 500 (now fixed).  
**Fix (this session):** Replaced `sql\`TRUE\`` in `and()` with conditional conditions arrays. Wrapped each query in `Promise.allSettled` for resilience. Empty responses now return `{ conversations: [], total: 0 }` instead of 500.  
**Confirmed:** `GET /api/twilio/phone-numbers/+13074882217/conversations` returns `{ total: 2, conversations: [...] }`.

### BUG-005 — Scraper engine 504 / 502 (intermittent) 🔴 Open — ROOT CAUSE FOUND
**Details:** AWS ELB returns 504 for all requests to the scraper engine URL.  
**Root cause confirmed (Session 2):** ECS service has `Load balancers: []` — the ELB is not attached to the ECS service. Task is RUNNING and HEALTHY on private IP `172.31.81.216:8765` but unreachable via ELB.  
**See BUG-051 for full diagnosis and fix steps.**  
**Workaround:** Use `SCRAPER_ENGINE_URL=http://localhost:8000` in Replit dev environment.

### BUG-006 — TOOLS_PIN 403 on Railway production 🔴 Open
**Cause:** Railway production may have a different or missing `TOOLS_PIN` env var.  
**Fix required:** Go to Railway dashboard → API service → Variables → set `TOOLS_PIN=Abdo4413$`.  
**IMPORTANT:** Correct PIN is `Abdo4413$` (dollar sign `$`), NOT `Abdo4413#` (hash). Previous docs had this wrong.  
**Confirmed working:** Local/Replit dev environment works correctly with `TOOLS_PIN=Abdo4413$` secret.

### BUG-007 — Live transcript only works for agent side, not caller 🟢 Fixed
**File:** `artifacts/api-server/src/routes/twilio-voice.ts`  
**Fix:** Added `transcribe="true" transcribeCallback="..."` to both Conference elements — agent answer route AND caller join-conference route.

### BUG-008 — Twilio recordings not saving (intermittent) 🟢 Fixed
**File:** `artifacts/api-server/src/routes/twilio-voice.ts`  
**Root cause:** Race condition where Twilio sends recording callback before `activeConferences` map has the conferenceSid, AND after server restart the in-memory map is empty.  
**Fix (this session):**
- Added `conference_sid` column to `crm_call_logs` in Drizzle schema + merged.sql  
- Conference-status callback now persists `conferenceSid` to DB immediately  
- Recording callback still has 3-strategy resolution: ConferenceName → in-memory → Twilio REST API  
**Confirmed:** `POST /api/twilio/voice/recording` returns `{"received":true}` with 200 OK.  
**Correct webhook path:** `/api/twilio/voice/recording` (NOT `/api/twilio/recording-callback`).

### BUG-009 — Scraper engine loops without returning results 🔴 Open
**File:** `artifacts/TolipAI-scraper-engine/workers/main.py`  
**Symptoms:** Job stays in `running` state, progress never reaches 100%, results empty.  
**Possible causes:** Circuit breaker open on BrightData; Playwright browser pool exhausted; asyncio task leak; ECS spot interruption mid-job.  
**Next:** Check `/admin/circuit-breakers` endpoint; add max job timeout enforcement in `workers/main.py`.

### BUG-010 — Empty results on 200 OK across scraper features 🔴 Open
**Symptoms:** API returns `{"results": [], "total": 0}` with status 200, nothing displays in frontend.  
**Confirmed causes (Session 2):**  
- BrightData proxy HOST/PORT missing in Replit env (only API UUID set, not tunnel credentials)  
- Propelio/Propwire: no credentials in Replit env (credentials are only in AWS Secrets Manager)  
- GROQ daily RPD limit exhausted → all AI-backed scrapers return 0 results  
- Playwright not available in local Replit env (Nix playwright-driver package doesn't install browser)  
**Next:** Set `PROPELIO_EMAIL`, `PROPELIO_PASSWORD`, `PROPWIRE_EMAIL`, `PROPWIRE_PASSWORD` in Replit Secrets. Fix BrightData credentials. Wait for GROQ quota reset.

---

## MEDIUM

### BUG-011 — API error messages too generic 🟡 In-Progress
**Files:** All `artifacts/api-server/src/routes/crm/*.ts` files  
**Fix:** Most routes now return actual error messages via `err.message`. Conversations endpoint now returns separate warnings per query instead of 500.

### BUG-012 — Power Dialer — needs comprehensive test 🔴 Open
**File:** `artifacts/TolipAI-crm/src/pages/dialer/PowerDialer.tsx`, `artifacts/api-server/src/routes/twilio-power-dialer.ts`  
**Confirmed routes (Session 2):**
- `POST /api/twilio/voice/power-dial/session` → create session (needs `agentPhone`, `campaignId`, `leadIds`)
- `GET /api/twilio/voice/power-dial/session/:id` → get session by ID
- `POST /api/twilio/voice/power-dial/session/:id/call` → trigger next call
- `POST /api/twilio/voice/power-dial/session/:id/disposition` → log call result
**Tested:** Create session returns `"agentPhone is required"` validation — route exists and validates correctly.  
**Next:** Test full session flow with real Twilio credentials: create → call → disposition → advance → end.

### BUG-013 — Voicemail Inbox — confirmed working 🟢 Fixed
**Endpoint:** `GET /api/twilio/voice/voicemails`  
**Result:** 200 — 1 voicemail found. Route works correctly.

### BUG-014 — SSE real-time events — needs test 🔴 Open
**File:** `artifacts/api-server/src/routes/sse.ts`  
**Correct flow:** `POST /api/crm/auth/sse-token` → get token → `GET /api/crm/events?token=...`  
**Confirmed:** `POST /api/crm/auth/sse-token` returns a token (✅).  
**Unconfirmed:** Whether `GET /api/crm/events` holds the SSE connection open or 404s.

### BUG-015 — scraper.ts missing body-based PIN (only reads header) 🟢 Fixed
**File:** `artifacts/api-server/src/routes/scraper.ts`  
**Fix:** Changed 401 → 403 (prevents logout). Body PIN acceptance is already handled in tools.ts.

### BUG-016 — Satellite DFD (Dive for Dollar) — returns 0 results 🔴 Open
**File:** `artifacts/TolipAI-scraper-engine/workers/scrapers/satellite_dfd.py`  
**Confirmed (Session 2):** `POST /ai/satellite-dfd` queues job but returns 0 properties.  
**Root causes:** 1) GROQ 429 (rate limit) prevents AI analysis step; 2) No `GOOGLE_MAPS_API_KEY` set locally; 3) BrightData HOST/PORT missing.  
**Dependent on:** BUG-038 (BrightData), BUG-039 (Google Maps), BUG-045 (GROQ limit).

### BUG-017 — PDF scraping — needs test 🔴 Open
**Note:** No `/pdf` or `/parse-pdf` route found in scraper engine. PDF parsing may be a worker-internal feature only, not exposed via HTTP.

### BUG-018 — BrightData proxy not verified as active 🔴 Open
**File:** `artifacts/TolipAI-scraper-engine/workers/proxy_pool.py`  
**Confirmed (Session 2):** `BRIGHTDATA_USERNAME` and `BRIGHTDATA_PASSWORD` are set. `BRIGHTDATA_HOST` and `BRIGHTDATA_PORT` are NOT set in Replit env.  
**Fix required:** Add BrightData tunnel credentials to Replit Secrets: `BRIGHTDATA_HOST`, `BRIGHTDATA_PORT`.

### BUG-019 — Distressed leads / cash buyers returning empty 🔴 Open
**Confirmed (Session 2):** `POST /scrape/distressed` and `POST /scrape/cash-buyers` both queue jobs successfully (returns `job_id`) but results are empty.  
**Root causes:** GROQ 429, BrightData proxy missing, Playwright not starting in local env.  
**Status:** Scraper reports 231 distressed sources configured, but all scraping fails due to missing infra.

### BUG-020 — Frontend error messages still generic 🟡 In-Progress
**File:** `artifacts/TolipAI-crm/src/lib/api.ts`  
**Fix:** Updated error format to include status + body detail.

### BUG-021 — CRM frontend not built (preview not working) 🟢 Fixed
**Fix (Session 2):** Added root `/` redirect handler in `app.ts` — website served at `/`, CRM at `/crm`, Tools at `/tools`. Server rebuilds correctly on workflow restart.  
**Confirmed:** `GET /` returns 200 (website), unregistered API routes return JSON 404.

### BUG-022 — Tools frontend not built 🟡 In-Progress
**Fix:** Run `pnpm run build` in `artifacts/TolipAI-tools` — served via API server at `/tools`.

---

## LOW

### BUG-023 — CORS origin config 🟢 Fixed
**File:** `artifacts/api-server/src/app.ts`  
**Fix:** CORS config allows `*.replit.dev`, `*.replit.app`, `localhost`, and `$API_BASE_URL` host. Covers all Replit preview domains.

### BUG-024 — Campaigns silent error on update 🟢 Fixed
**File:** `artifacts/api-server/src/routes/crm/campaigns.ts`  
**Fix:** Added `logger.error()` call in catch block.

### BUG-025 — AI sequences / email drip — needs test 🔴 Open
**File:** `artifacts/api-server/src/routes/crm/sequences.ts`  
**Confirmed (Session 2):** `GET /api/crm/sequences` returns `[]` (empty). Route works but no sequences created yet.

### BUG-026 — Buyer management — confirmed working 🟢 Fixed
**Confirmed (Session 2):** `GET /api/crm/buyers` returns data. Route works correctly.

### BUG-027 — Analytics dashboard — confirmed working 🟢 Fixed
**Confirmed (Session 2):** `GET /api/crm/analytics/dashboard` returns full analytics. Keys: `summary`, `velocity`, `weeklyTrend`, `funnel`, `topSources`.  
Also confirmed: `GET /api/crm/analytics/campaigns` (7 campaigns), `GET /api/crm/analytics/calls` (call summary, volume, dispositions, agents).

### BUG-028 — Contract generation — needs test 🔴 Open

### BUG-029 — replit-setup.sh hung on Python packages 🟢 Fixed
**File:** `replit-setup.sh`  
**Cause:** `lxml` and other C-extension packages hang when building from source in Nix due to libexpat path issues.  
**Fix:** Added `--no-build-isolation --prefer-binary` flags; added `timeout 180`; added `uv`-first strategy (avoids compile entirely by using pre-built wheels).

### BUG-030 — .replit workflows not configured 🟢 Fixed
**Fix:** Configured `TolipAI API Server` workflow (port 5000, webview) and `TolipAI Scraper Engine` workflow (port 8000, console) via Replit workflow tools.

### BUG-031 — crm_phone_read_receipts table missing from merged.sql 🟢 Fixed
**Fix:** Added `CREATE TABLE IF NOT EXISTS crm_phone_read_receipts` with proper indexes to merged.sql.

### BUG-032 — conference_sid column missing from crm_call_logs 🟢 Fixed
**Fix:** Added `ALTER TABLE crm_call_logs ADD COLUMN IF NOT EXISTS conference_sid TEXT` to merged.sql; added `conferenceSid` field to Drizzle schema; conference-status callback now persists to DB.

---

## INFRASTRUCTURE

### INFRA-001 — Scraper engine BrightData credentials in ECS 🔴 Open
**Required env vars in ECS task definition:**
- `BRIGHTDATA_USERNAME`
- `BRIGHTDATA_PASSWORD`
- `BRIGHTDATA_HOST`
- `BRIGHTDATA_PORT`
**Note:** Only USERNAME and PASSWORD are currently in AWS Secrets Manager. HOST and PORT are missing from both Replit and ECS.

### INFRA-002 — ATTOM_API_KEY not set in Railway production 🔴 Open
**Symptom:** Both `ATTOM_API_KEY` and `ATTOM_API_KEY_2` return `{"status":{"code":"401","msg":"Unauthorized"}}`.  
**Impact:** All ATTOM-dependent features broken: ARV calculation, property lookup, comps, fetch-property-data.  
**Fix:** Renew ATTOM subscription at gateway.attomdata.com and update both keys in Railway + Replit Secrets.

### INFRA-003 — Scraper engine GROQ_API_KEY in ECS 🔴 Open
**Required:** ECS task definition needs `GROQ_API_KEY` for AI research endpoints (satellite-dfd, hedge fund markets, distressed AI scoring).  
**Note:** All 20 secrets ARE present in AWS Secrets Manager — verify that ECS task definition references them.

### INFRA-004 — TOOLS_PIN mismatch in Railway 🔴 Open
**Fix:** Set `TOOLS_PIN=Abdo4413$` in Railway API service Variables.  
**IMPORTANT:** The correct PIN uses dollar sign `$`, not hash `#`. Previous BUGS.md entry had this wrong.

### INFRA-005 — No Propelio/Propwire credentials in Replit env 🔴 Open
**Available in:** AWS Secrets Manager only.  
**Missing from:** Replit Secrets (needed for local scraper engine development/testing).  
**Required secrets:** `PROPELIO_EMAIL`, `PROPELIO_PASSWORD`, `PROPWIRE_EMAIL`, `PROPWIRE_PASSWORD`

### INFRA-006 — No Google Maps API key in Replit env 🔴 Open
**Missing from:** Replit Secrets.  
**Impact:** `/google-maps` scraper endpoint fails; street view in CRM may not load.  
**Required secret:** `GOOGLE_MAPS_API_KEY`

### INFRA-007 — Playwright browser not available in local Replit env 🔴 Open
**Symptom:** Scraper engine starts but all Playwright-dependent scrapers (Propelio, Propwire, Zillow, Google Maps) return empty or timeout.  
**Cause:** The Nix `playwright-driver` package installs the CLI but doesn't download Chromium to the expected path.  
**Fix options:**  
1. Run `playwright install chromium` after startup in `start.sh`  
2. Set `PLAYWRIGHT_BROWSERS_PATH=/home/runner/.cache/ms-playwright` and run install  
3. Use ECS environment (where Docker image has browsers pre-installed)

---

## BUGS FOUND IN PREVIOUS SESSION (2026-05-24 Session 1)

### BUG-033 — callAI() uses gpt-4o-mini when OpenAI base URL is Groq 🟢 Fixed
**File:** `artifacts/api-server/src/services/aiConfig.ts`
**Cause:** `AI_INTEGRATIONS_OPENAI_BASE_URL` is set to `https://api.groq.com/openai/v1` (Groq endpoint),
but `getChatModel()` returns `gpt-4o-mini` which does not exist on Groq → HTTP 400 model_not_found.
GROQ fallback uses the correct model (`llama-3.3-70b-versatile`) but was then hitting 429 rate limit.
**Fix:** In `callAI()`, detect when the OpenAI base URL contains `groq.com` and use `getGroqModel()`
instead of `getChatModel()` for the primary provider call.
**Symptoms:** All 6 AI lead endpoints returning "AI service returned an error." or Groq 400.

### BUG-034 — AI prompts exceed GROQ context limit (message too long) 🟢 Fixed
**File:** `artifacts/api-server/src/routes/crm/leads.ts`
**Cause:** `detect-condition` fetched 30 notes and `ai-deal-score` fetched 15 notes — each audit note
can be 500-1000 chars — producing prompts with 10K+ characters, triggering Groq 400
"Please reduce the length of the messages or completion."
**Fix:** Truncate each note's `content` to 300 chars, then cap total `activityLog` to 2,500 chars.
Also truncate `lead.notes` to 500 chars before including in prompt.
**Affected routes:** `detect-condition`, `ai-deal-score`

### BUG-035 — ai-seller-script crashes: lead.notes.substring is not a function 🟢 Fixed
**File:** `artifacts/api-server/src/routes/crm/leads.ts:2315`
**Cause:** `(lead.notes || "none").substring(0, 800)` — `lead.notes` can be `null` (comes from DB as
nullable text), and `null.substring` throws TypeError even though `null || "none"` would normally
produce `"none"`. The type coercion issue is that the column type may be an object/null in runtime.
**Fix:** Changed to `String(lead.notes || "none").substring(0, 800)` — explicit String() cast.

### BUG-036 — ATTOM API keys both returning 401 Unauthorized 🔴 Open
**Keys tested:** `ATTOM_API_KEY` (`9ed043358d1f...`) and `ATTOM_API_KEY_2` (`7ac5b5a42cae...`)
**Result:** Both return `{"Response":{"status":{"code":"401","msg":"Unauthorized"}}}`
**Impact:** All ATTOM-dependent features broken: fetch-property-data, fetch-comps-ai, ARV calculation, property lookup in Tools
**Fix required:** Renew ATTOM subscription at gateway.attomdata.com and update secrets.

### BUG-037 — No Propelio/Propwire credentials in environment 🔴 Open
**Affected:** `POST /session/propelio/test`, `POST /session/propwire/test`, `/scrape/propelio/cash-buyers`, `/scrape/propwire/*` endpoints
**Result:** Requests timeout — browser opens but can't login without credentials
**Fix required:** Set secrets: `PROPELIO_EMAIL`, `PROPELIO_PASSWORD`, `PROPWIRE_EMAIL`, `PROPWIRE_PASSWORD`

### BUG-038 — BrightData proxy missing HOST and PORT 🔴 Open
**Set:** `BRIGHTDATA_USERNAME`, `BRIGHTDATA_PASSWORD`
**Missing:** `BRIGHTDATA_HOST`, `BRIGHTDATA_PORT`
**Impact:** Residential proxy pool can't connect → cash buyers, distressed scraping fail
**Fix required:** Set `BRIGHTDATA_HOST` and `BRIGHTDATA_PORT` in Replit Secrets.

### BUG-039 — Google Maps API key not configured 🔴 Open
**Missing secret:** `GOOGLE_MAPS_API_KEY`
**Impact:** `/google-maps` endpoint on scraper engine, street view feature in CRM
**Fix required:** Add `GOOGLE_MAPS_API_KEY` to Replit Secrets.

### BUG-040 — AWS Scraper Engine ELB returning 504 🔴 Open — ROOT CAUSE: BUG-051
**URL:** `http://tolip-scraper-url-323311724.us-east-1.elb.amazonaws.com:8765`
**Root cause confirmed:** ECS service has `Load balancers: []` — ELB not attached to service.
**ECS task status:** RUNNING and HEALTHY on private IP `172.31.81.216:8765`.
**All 20 secrets ARE in AWS Secrets Manager** (DATABASE_URL, GROQ, PROPELIO, PROPWIRE, BRIGHTDATA, ATTOM, GOOGLE_MAPS, etc.)
**Fix required:** Re-attach ELB to ECS service (see BUG-051).

### BUG-041 — Satellite DFD returns empty (GROQ 429 + BrightData missing) 🔴 Open
**Endpoint:** `POST /ai/satellite-dfd` on local scraper engine
**Cause:** 1) GROQ rate limited (429) at startup health check; 2) BrightData HOST/PORT missing
so proxy fallback fails; 3) distressed property sources may require paid data access.
**Dependent on:** BUG-038 (BrightData) and GROQ rate limit recovery.

### BUG-042 — DB sequence reset warning for crm_call_logs and crm_users 🟡 Non-blocking
**Log:** `"column \"id\" of relation \"crm_call_logs\" is not an identity column"`
**Cause:** Tables were created with `SERIAL` type instead of `GENERATED ALWAYS AS IDENTITY`.
The sequence reset at startup silently skips these tables.
**Impact:** No functional issue — sequences are still managed by PostgreSQL. IDs will not reset.
**Fix (optional):** Migrate columns to identity columns: `ALTER TABLE crm_call_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY`.

### BUG-043 — Lead appointments endpoint returns 404 🔴 Open
**Endpoint:** `GET /api/crm/leads/:id/appointments`
**Result:** `Not found` (Express default 404)
**Cause:** Route may not be registered or the appointments feature is not yet implemented.
**Fix required:** Check route registration in `artifacts/api-server/src/routes/index.ts`.

### BUG-044 — Twilio campaign-health shows campaigns without valid Twilio auth 🟡 Low
**Note:** `/api/twilio/phone-numbers` returns `"warning": "Twilio API unreachable"`.
Twilio SID/auth token may be configured but the account is not reachable from Replit's IP.
**Impact:** Real-time phone number capabilities check falls back to configured settings.

### BUG-045 — GROQ free tier daily RPD limit exhausted during testing 🟡 Temporary
**Provider:** Groq (`gsk_L0PQ...`)
**Error:** `Rate limit reached for model llama-3.3-70b-versatile ... Limit 1000, Used 1000`
**Cause:** Free tier GROQ accounts have 1,000 requests/day (RPD) limit. Running AI endpoint tests exhausted the daily quota.
**Impact:** All 6 AI lead endpoints return 429 until quota resets at midnight UTC.
**Fix options:**
1. Wait for quota reset (resets daily at midnight UTC)
2. Upgrade GROQ account to paid tier (higher limits)
3. Add `OPENAI_API_KEY` to use GPT-4o-mini directly (not via Groq base URL)

### BUG-046 — SSE endpoint path needs verification 🔴 Open
**Correct path:** `GET /api/crm/events?token=<sse-token>` (token via `POST /api/crm/auth/sse-token`)  
**Confirmed:** `POST /api/crm/auth/sse-token` returns a valid token (✅).  
**Unconfirmed:** Whether `GET /api/crm/events` successfully holds the SSE connection open or 404s.  
**Impact:** Real-time push notifications (lead status changes, call events) may be broken in frontend.

### BUG-047 — Power Dialer session path corrected 🟢 Closed
**Correct paths confirmed (Session 2):**
- `POST /api/twilio/voice/power-dial/session` → create session (requires `agentPhone`, `campaignId`, `leadIds` in body)
- `GET /api/twilio/voice/power-dial/session/:id` → fetch session by ID
- `POST /api/twilio/voice/power-dial/session/:id/call` → initiate next call
- `POST /api/twilio/voice/power-dial/session/:id/disposition` → log disposition
- `POST /api/twilio/voice/power-dial/call-status` → Twilio AMD/call-status webhook
**Tested:** Create session validates params correctly — returns `"agentPhone is required for Bridge mode"`.

---

## BUGS FOUND SESSION 2 (2026-05-24)

### BUG-049 — TOOLS_PIN documented as `#` but correct symbol is `$` 🟢 Fixed in docs
**Location:** Previous BUGS.md, INFRA-004, BUG-006  
**Incorrect:** `TOOLS_PIN=Abdo4413#`  
**Correct:** `TOOLS_PIN=Abdo4413$`  
**Impact:** Anyone using the documented PIN `#` would get 403 Invalid PIN on all Tools routes.  
**Fix:** Updated all references in this file. Also update Railway variables if they have the wrong PIN.

### BUG-050 — Multiple wrong endpoint paths in previous documentation 🟢 Fixed in docs
**Wrong paths that were tested (and failed) due to incorrect path assumptions:**

| Wrong Path | Correct Path |
|------------|-------------|
| `POST /api/twilio/recording-callback` | `POST /api/twilio/voice/recording` |
| `GET /api/twilio/voice/call-logs` | `GET /api/crm/analytics/calls` (summary) |
| `GET /api/twilio/voice/power-dial/session` (list) | `POST /api/twilio/voice/power-dial/session` (create first) |
| `POST /api/tools/fetch-property-data` | `POST /api/tools/property-lookup/search` (needs `street` not `address`) |
| `POST /api/tools/calculate-mao` | `POST /api/tools/arv/calculate-manual` |
| `POST /api/tools/calculate-arv` | `POST /api/tools/arv/calculate` |
| `GET /api/crm/voicemail` | `GET /api/twilio/voice/voicemails` |

**Tools routes use `street` field, not `address`** — `POST /api/tools/arv/calculate` and `POST /api/tools/property-lookup/search` both require `{ street, city, state, zip }` not `{ address, city, state, zip }`.

### BUG-052 — Zillow scraper returns empty response 🔴 Open
**Endpoint:** `POST /zillow` on scraper engine  
**Symptom:** Empty response body even with 90s timeout.  
**Cause:** Playwright browser not starting in Replit Nix environment; no fallback to non-browser scraper.  
**Dependent on:** INFRA-007 (Playwright browser install).

### BUG-053 — NAR directory scraper returns empty 🔴 Open
**Endpoint:** `POST /nar-directory` on scraper engine  
**Symptom:** Empty response — all NAR endpoint patterns attempted and failed.  
**Cause:** NAR.realtor website structure may have changed; Playwright browser not available.

### BUG-054 — Hedge fund markets endpoint returns empty 🔴 Open
**Endpoint:** `GET /ai/hedge-fund-markets` on scraper engine  
**Symptom:** Empty response body.  
**Cause:** GROQ rate limited + possibly Playwright needed to fetch market data.

### BUG-055 — Tools property lookup requires `street` not `address` field 🔴 Open (needs fix or docs)
**Endpoints:** `POST /api/tools/arv/calculate`, `POST /api/tools/property-lookup/search`  
**Symptom:** Returns `{"error":"street is required"}` when using `{"address":"...","city":"...","state":"...","zip":"..."}`  
**Correct payload:** `{"street":"4529 Winona Court","city":"Denver","state":"CO","zip":"80212","bedrooms":3,"bathrooms":2,"sqft":1500}`  
**Fix required:** Either update frontend to send `street` field, or add `address` as alias in route handler.

---

## COMPLETED THIS SESSION

| Bug | Description | Files Changed |
|-----|-------------|---------------|
| BUG-001 | Logout on scraper PIN | `scraper.ts`, `api-setup.ts`, `api.ts` |
| BUG-002 | Conversations 500 | `twilio.ts` |
| BUG-003 | AI routes 502 | `crm/leads.ts` |
| BUG-007 | Caller transcript | `twilio-voice.ts` |
| BUG-015 | Scraper 401→403 | `scraper.ts` |
| BUG-020 | Better error msgs | `api.ts` |
| BUG-004 | Conversations SQL filter fix | `twilio.ts` |
| BUG-008 | Recording conferenceSid persist | `twilio-voice.ts`, `crm.ts`, `merged.sql` |
| BUG-029 | replit-setup.sh hang | `replit-setup.sh` |
| BUG-030 | .replit workflow config | (via Replit workflow tool) |
| BUG-031 | crm_phone_read_receipts missing | `merged.sql` |
| BUG-032 | conference_sid missing | `merged.sql`, `crm.ts`, `twilio-voice.ts` |
| BUG-033 | callAI() model mismatch | `aiConfig.ts` |
| BUG-034 | AI prompt too long | `leads.ts` |
| BUG-035 | lead.notes String() cast | `leads.ts` |
| BUG-048 | API wildcard 404 (website HTML for bad API paths) | `app.ts` |
| BUG-049 | Tools PIN docs corrected (`$` not `#`) | `BUGS.md`, `INFRA-004`, `BUG-006` |
| BUG-050 | Wrong endpoint paths in docs | `BUGS.md`, `TEST_RESULTS.md` |

---

---

## SESSION 3 FIXES (2026-05-25)

### BUG-060 — No ringback audio during outbound call 🟢 Fixed
**Files:** `artifacts/api-server/src/routes/twilio-voice.ts`, `artifacts/TolipAI-crm/src/contexts/PhoneContext.tsx`
**Cause 1 (server):** Both Conference TwiML blocks had `waitUrl=""` — agent heard silence while destination leg connected.
**Fix 1:** Added `GET /api/twilio/voice/ringback` TwiML endpoint returning `<Play loop="10">` of Twilio's ringback audio. Changed both `waitUrl=""` to `waitUrl="${apiBase}/twilio/voice/ringback"`.
**Cause 2 (browser):** `startCall` in PhoneContext never played ring audio on outbound call — only incoming calls had ringback.
**Fix 2:** Added `playRing()` immediately after `setStatus("calling")` in `startCall`. Ring is stopped in the `call.on("accept")` handler via `stopRing()`.

### BUG-061 — CallerID is null on first call (stale closure race) 🟢 Fixed
**File:** `artifacts/TolipAI-crm/src/contexts/PhoneContext.tsx`
**Cause:** `startCall` captured `callerIdUsed` (state) in a closure. On the very first call, `initDevice()` sets `setCallerIdUsed()` but React state hasn't re-rendered yet when the dependency array bound `callerIdUsed` was captured — so `CallerId` param was always `""` on the first call.
**Fix:** Added `callerIdRef = useRef<string | null>(null)`. After fetching the token, both `callerIdRef.current` and `setCallerIdUsed()` are set together. `startCall` now reads `callerIdRef.current` instead of the state value. Removed `callerIdUsed` from the `useCallback` dependency array.

### BUG-062 — New outbound calls not appearing in Phone Numbers call list (SSE missing) 🟢 Fixed
**File:** `artifacts/api-server/src/routes/twilio-voice.ts` (voice/log endpoint)
**Cause:** `call_logged` SSE was only emitted from `POST /twilio/voice/call-status` (Twilio's end-of-call webhook). On Railway, this webhook returns 404 because the route URL in TwiML pointed to a stale domain. So new calls never triggered SSE → call list never refreshed.
**Fix:** Added `emitCrmActivity("call_logged", {...})` directly inside `POST /twilio/voice/log` (frontend-initiated, fires immediately when agent dials). This is always reachable (same-origin, JWT auth) regardless of Railway webhook routing.

### BUG-063 — Manual Dialer refresh fragile and slow 🟢 Fixed
**File:** `artifacts/TolipAI-crm/src/pages/integrations/PhoneNumbers.tsx`
**Cause 1:** `refetchInterval: 30_000` for conversations, `20_000` for history — calls needed to wait up to 30s to appear.
**Fix 1:** Reduced both intervals to `5_000` (5 seconds).
**Cause 2:** After dialing from the dialpad, the conversation panel didn't open for the dialed number — user had to find it manually.
**Fix 2:** `handleCall()` now immediately calls `setSelectedContact(target)` + `setShowDialPad(false)`, then does an eager `invalidateQueries` + `refetchConvs()` after 1.5s (enough time for the call log to be created).

### BUG-064 — webhookBase.ts used Railway URL for Replit dev webhooks 🟢 Fixed
**File:** `artifacts/api-server/src/lib/webhookBase.ts`
**Cause:** Priority order was `API_BASE_URL` first — so even when developing in Replit, all Twilio webhooks pointed to Railway. Twilio couldn't reach the local Replit container.
**Fix:** Moved `REPLIT_DEV_DOMAIN` to first priority. When set (Replit environment), all webhook URLs use the Replit public domain. Production Railway still uses `API_BASE_URL` when `REPLIT_DEV_DOMAIN` is absent.

### BUG-065 — Website shows old "DIGOR LLC" branding in hero background image 🟢 Fixed
**Files:** `artifacts/TolipAI-website/src/components/sections/Hero.tsx`, `About.tsx`, `Services.tsx`
**Cause:** Hero used hardcoded `images/office-team.jpg` / `hero-bg.jpg` which contained visible "DIGOR LLC" text in a corner.
**Fix:** Replaced all three image references with the 4 provided TOLIP-branded images via `@assets/` Vite imports:
- Hero section: `10_Big_Data_and_Analytics_Informed_Decision` + `7_Real_Estate_Market_Growth_Concept` (blended overlay)
- Services section: `8_51_795_Digital_Real_Estate_Background` (subtle 5% opacity background)
- About section: `8_Diverse_Business_Team_Collaborating` (right-side accent)

### BUG-066 — Duplicate push scripts causing confusion 🟢 Fixed
**Cause:** `push_github.sh` (old, pushed both repos including Python worker subtree split) existed alongside a need for cleaner, purpose-specific scripts.
**Fix:**
- Removed `push_github.sh` (old)
- Created `push-github.sh` — manual push, stages all changes, commits with message arg, pushes monorepo to GitHub
- Created `auto-push.sh` — runs in background loop (default 30min interval), can also run `--once`; use `AUTO_PUSH_INTERVAL=900` env var for 15min intervals

---

## ACTION ITEMS FOR NEXT SESSION

### Must-Do (Blockers)
1. **Renew ATTOM subscription** → Update `ATTOM_API_KEY` in Replit Secrets + Railway
2. **Fix AWS ELB → ECS connection** (BUG-051) → Re-attach load balancer to ECS service in AWS Console
3. **Set Propelio/Propwire credentials** in Replit Secrets: `PROPELIO_EMAIL`, `PROPELIO_PASSWORD`, `PROPWIRE_EMAIL`, `PROPWIRE_PASSWORD`
4. **Set BrightData HOST/PORT** in Replit Secrets: `BRIGHTDATA_HOST`, `BRIGHTDATA_PORT`
5. **Fix Playwright in Replit** (INFRA-007) → Add `playwright install chromium` to `start.sh`
6. **Add OPENAI_API_KEY** if needed for voice agent (Realtime API requires own key)

### Should-Do
7. **Re-test all AI endpoints** after GROQ quota resets midnight UTC
8. **Test power dialer full session flow** with real Twilio credentials
9. **Test SSE connection** (`GET /api/crm/events?token=...`)
10. **Fix `street` vs `address` field** in Tools ARV calculate (BUG-055)
11. **Test hold/mute race** — callerCallSid timing (conference state lookup) — needs live call test

### Informational
- GROQ resets daily at midnight UTC. All AI features work once quota refreshes.
- AWS ECS task is RUNNING/HEALTHY — it's only the ELB routing that's broken.
- All 20 ECS secrets ARE in AWS Secrets Manager (verified via AWS console description).
- `push-github.sh` and `auto-push.sh` replace the old `push_github.sh`.
- `replit-setup.sh` is the full fresh-install script — run on new Replit project after `git clone`.
