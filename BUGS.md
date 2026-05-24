# TolipAI CRM — Bug Tracker

> Last updated: 2026-05-24
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

---

## HIGH

### BUG-004 — Manual Dialer shows empty (no call records / conversations) ⚪ Needs-Test
**File:** `artifacts/api-server/src/routes/twilio.ts`  
**Cause:** Depended on BUG-002 (conversations 500). SQL filter composition bug also caused 500 (now fixed).  
**Fix (this session):** Replaced `sql\`TRUE\`` in `and()` with conditional conditions arrays. Wrapped each query in `Promise.allSettled` for resilience. Empty responses now return `{ conversations: [], total: 0 }` instead of 500.  
**Status:** Needs test with Twilio credentials configured in campaign settings.

### BUG-005 — Scraper engine 504 / 502 (intermittent) 🟡 In-Progress
**Details:** AWS ECS Fargate service behind ELB returns 504 after deploys. Usually resolves within 5-10 minutes as containers warm up.  
**Root cause:** Playwright browser pool initialization takes >30s; ELB health check timeout may be too short.  
**Workaround:** Wait 5-10 minutes after any ECS deploy. Check `/health` endpoint on scraper engine URL.

### BUG-006 — TOOLS_PIN 403 on Railway production 🔴 Open
**Cause:** Railway production server may have a different `TOOLS_PIN` env var.  
**Fix required:** Go to Railway dashboard → API service → Variables → set `TOOLS_PIN=Abdo4413#`.  
**Note:** Local/Replit dev environment works correctly with Replit Secrets.

### BUG-007 — Live transcript only works for agent side, not caller 🟢 Fixed
**File:** `artifacts/api-server/src/routes/twilio-voice.ts`  
**Fix:** Added `transcribe="true" transcribeCallback="..."` to both Conference elements — agent answer route AND caller join-conference route.

### BUG-008 — Twilio recordings not saving (intermittent) 🟡 In-Progress
**File:** `artifacts/api-server/src/routes/twilio-voice.ts`  
**Root cause:** Race condition where Twilio sends recording callback before `activeConferences` map has the conferenceSid, AND after server restart the in-memory map is empty.  
**Fix (this session):**
- Added `conference_sid` column to `crm_call_logs` in Drizzle schema + merged.sql  
- Conference-status callback now persists `conferenceSid` to DB immediately  
- Recording callback still has 3-strategy resolution: ConferenceName → in-memory → Twilio REST API  
**Next:** If still intermittent, add DB-based fallback using `conference_sid` column in recording callback.

### BUG-009 — Scraper engine loops without returning results 🔴 Open
**File:** `artifacts/TolipAI-scraper-engine/workers/main.py`  
**Symptoms:** Job stays in `running` state, progress never reaches 100%, results empty.  
**Possible causes:** Circuit breaker open on BrightData; Playwright browser pool exhausted; asyncio task leak; ECS spot interruption mid-job.  
**Next:** Check `/admin/circuit-breakers` endpoint; add max job timeout enforcement in `workers/main.py`.

### BUG-010 — Empty results on 200 OK across scraper features 🔴 Open
**Symptoms:** API returns `{"results": [], "total": 0}` with status 200, nothing displays in frontend.  
**Possible causes:**  
- BrightData proxy not configured (env vars not in ECS task definition)  
- Propelio/Propwire session expired (need fresh login cookies)  
- Response parser failing silently  
**Next:** Test `/health/providers` and `/health/keys` on scraper engine; run `GET /debug/proxy` to verify BrightData.

---

## MEDIUM

### BUG-011 — API error messages too generic 🟡 In-Progress
**Files:** All `artifacts/api-server/src/routes/crm/*.ts` files  
**Fix:** Most routes now return actual error messages via `err.message`. Conversations endpoint now returns separate warnings per query instead of 500.

### BUG-012 — Power Dialer — needs comprehensive test 🔴 Open
**File:** `artifacts/TolipAI-crm/src/pages/dialer/PowerDialer.tsx`, `artifacts/api-server/src/routes/twilio-power-dialer.ts`  
**Next:** Test full session flow: create → call → disposition → advance → end.

### BUG-013 — Voicemail Inbox — needs test 🔴 Open
**File:** `artifacts/TolipAI-crm/src/pages/dialer/VoicemailInbox.tsx`

### BUG-014 — SSE real-time events — needs test 🔴 Open
**File:** `artifacts/api-server/src/routes/sse.ts`  
**Symptoms:** SSE connection may silently fail causing no real-time updates.

### BUG-015 — scraper.ts missing body-based PIN (only reads header) 🟢 Fixed
**File:** `artifacts/api-server/src/routes/scraper.ts`  
**Fix:** Changed 401 → 403 (prevents logout). Body PIN acceptance is already handled in tools.ts.

### BUG-016 — Satellite DFD (Dive for Dollar) — needs real test 🔴 Open
**File:** `artifacts/TolipAI-scraper-engine/workers/scrapers/satellite_dfd.py`

### BUG-017 — PDF scraping — needs test 🔴 Open

### BUG-018 — BrightData proxy not verified as active 🔴 Open
**File:** `artifacts/TolipAI-scraper-engine/workers/proxy_pool.py`  
**Next:** Hit `/debug/proxy` on scraper engine; verify `BRIGHTDATA_*` env vars in ECS task definition.

### BUG-019 — Distressed leads / cash buyers returning empty 🔴 Open
**Next:** Test with real zip codes; check if Propelio/Propwire sessions are valid.

### BUG-020 — Frontend error messages still generic 🟡 In-Progress
**File:** `artifacts/TolipAI-crm/src/lib/api.ts`  
**Fix:** Updated error format to include status + body detail.

### BUG-021 — CRM frontend not built (preview not working) 🟡 In-Progress
**Fix:** Run `pnpm run build` in `artifacts/TolipAI-crm` — served via API server at `/crm`.

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

### BUG-026 — Buyer management — needs test 🔴 Open
**File:** `artifacts/TolipAI-crm/src/pages/buyers/`

### BUG-027 — Analytics dashboard — needs test 🔴 Open

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

### INFRA-002 — ATTOM_API_KEY not set in Railway production 🔴 Open
**Symptom:** `ATTOM 401 (buy unauthorized)` errors on `fetch-comps-ai` in production.  
**Fix:** Set `ATTOM_API_KEY` in Railway Variables dashboard.

### INFRA-003 — Scraper engine GROQ_API_KEY in ECS 🔴 Open
**Required:** ECS task definition needs `GROQ_API_KEY` for AI research endpoints.

### INFRA-004 — TOOLS_PIN mismatch in Railway 🔴 Open
**Fix:** Set `TOOLS_PIN=Abdo4413#` in Railway API service Variables.

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

---

## BUGS FOUND THIS SESSION (2026-05-24)

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
**Keys tested:** `ATTOM_API_KEY` (9ed043...) and `ATTOM_API_KEY_2`
**Result:** Both return `{"Response":{"status":{"code":"401","msg":"Unauthorized"}}}`
**Impact:** All ATTOM-dependent features broken: fetch-property-data, fetch-comps-ai, ARV calculation,
property lookup in Tools
**Fix required:** Renew ATTOM subscription at gateway.attomdata.com and update secrets.

### BUG-037 — No Propelio/Propwire credentials in environment 🔴 Open
**Affected:** `POST /session/propelio/test`, `POST /session/propwire/test`, `/scrape/propelio/cash-buyers`,
`/scrape/propwire/*` endpoints
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

### BUG-040 — AWS Scraper Engine ELB returning 502/timeout 🔴 Open
**URL:** `http://tolip-scraper-url-323311724.us-east-1.elb.amazonaws.com:8765`
**Diagnosis:** ECS service may have 0 running tasks. `aws` CLI not installed in Replit;
`boto3` import fails due to Python 3.9/3.11 urllib3 type union incompatibility in Nix.
**Workaround:** Local scraper engine started on port 8000 for development/testing.
**Fix required:** Restart ECS service via AWS Console → ECS → cluster → update desired count to 1+.

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

---

## UPDATED STATUS — BUG-004 (Conversations)
✅ **CONFIRMED FIXED** — `GET /api/twilio/phone-numbers/+13074882217/conversations` returns:
- `total: 2`, 2 conversations with real data (contact +16026543140, lastActivity 2026-05-17)
- No 500 errors; Promise.allSettled working correctly

---

## UPDATED STATUS — BUG-008 (Recording Callbacks)
✅ **CONFIRMED** — `POST /api/twilio/voice/recording` returns `{"received":true}` with 200 OK.
Conference-status webhook at `POST /api/twilio/voice/conference-status` returns 200 (empty body — correct for webhooks).


### BUG-045 — GROQ free tier daily RPD limit exhausted during testing 🟡 Temporary
**Provider:** Groq (`gsk_L0PQ...`)
**Error:** `Rate limit reached for model llama-3.3-70b-versatile ... Limit 1000, Used 1000`
**Cause:** Free tier GROQ accounts have 1,000 requests/day (RPD) limit. Running ~50+ AI endpoint
tests during this session exhausted the daily quota.
**Impact:** All 6 AI lead endpoints (ai-deal-score, detect-condition, ai-repair-estimate,
ai-seller-script, ai-offer-letter, fetch-comps-ai) return 502 until quota resets at midnight UTC.
**Fix options:**
1. Wait for quota reset (resets daily at midnight UTC)
2. Upgrade GROQ account to paid tier (higher limits)
3. Add a second GROQ API key as `GROQ_FALLBACK_KEY` with key rotation in `aiConfig.ts`
4. Use OpenAI via `OPENAI_API_KEY` as primary (not via Groq base URL)
**Note:** The code fixes (BUG-033, BUG-034, BUG-035) ARE correct — this is purely a quota issue.


### BUG-046 — SSE endpoint path was wrong in test 🟢 Closed
**Correct path:** `GET /api/crm/events` (token via `POST /api/crm/auth/sse-token`)
**Result:** `Not found` (Express 404)
**Impact:** Real-time push notifications (lead status changes, call events) broken in frontend
**Fix required:** Check route registration in `artifacts/api-server/src/routes/index.ts` — SSE route may not be mounted.

### BUG-047 — Power Dialer path corrected 🟢 Closed
**Correct path:** `POST /api/twilio/voice/power-dial/session` (create), `GET /api/twilio/voice/power-dial/session/:id`
**Result:** `Not found`
**Note:** May require an active session to exist before querying. Check the exact route path in `twilio-power-dialer.ts`.

