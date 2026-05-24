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
