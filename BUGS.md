# TolipAI CRM — Bug Tracker

> Last updated: 2026-05-24
> Status legend: 🔴 Open | 🟡 In-Progress | 🟢 Fixed | ⚪ Needs-Test

---

## CRITICAL

### BUG-001 — Logout triggered by scraper PIN failure 🟢 Fixed
**File:** `artifacts/api-server/src/routes/scraper.ts:28`  
**Fix:** Changed `requirePin` from returning `401` → `403`. Frontend 401-handler only logs out on JWT auth failures, not PIN errors.  
**Also fixed:** `api-setup.ts` `isToolsRoute` guard extended to include `/scraper/` paths; `api.ts` `apiRawFetch` now has `shouldLogoutOn401()` path check.

### BUG-002 — Conversations endpoint 500 crash 🟢 Fixed
**File:** `artifacts/api-server/src/routes/twilio.ts`  
**Cause 1:** Dynamic `await import()` of DB schema inside route handler (race condition / TDZ crash).  
**Cause 2:** `crmOpenPhoneMessages.body` used — column is actually named `content`.  
**Fix:** Removed dynamic imports; changed `body` → `content` throughout.

### BUG-003 — All 6 AI routes 502 🟢 Fixed
**File:** `artifacts/api-server/src/routes/crm/leads.ts`  
**Cause:** Routes used raw `fetch()` calls without imports or fallback logic.  
**Fix:** All 6 routes (repair-estimate, fetchCompsViaAI, detect-condition, ai-deal-score, ai-seller-script, ai-offer-letter) now use `callAI()` with OpenAI → Groq fallback.

---

## HIGH

### BUG-004 — Manual Dialer shows empty (no call records / conversations) 🟡 In-Progress
**File:** `artifacts/TolipAI-crm/src/pages/integrations/PhoneNumbers.tsx`  
**Cause:** Depended on BUG-002 (conversations 500). Now fixed upstream. Also requires Twilio credentials configured per-campaign.  
**Status:** Conversations endpoint now returns data. Need to verify in dev env with Twilio credentials.

### BUG-005 — Scraper engine 504 / 502 (intermittent) 🟡 In-Progress
**Details:** AWS ECS Fargate service behind ELB returns 504 after deploys. Usually resolves within 5-10 minutes as containers warm up.  
**Deploys triggered:** Run #26361502230 (success), re-triggered 2026-05-24.  
**Possible causes:** ELB health check grace period; container cold start; Playwright browser pool initialization takes >30s.  
**Next:** Monitor health endpoint; check ECS task logs in CloudWatch.

### BUG-006 — TOOLS_PIN 403 on Railway production 🔴 Open
**Cause:** Railway production server has a different `TOOLS_PIN` env var than `Abdo4413#`.  
**Fix required:** Go to Railway dashboard → API service → Variables → update `TOOLS_PIN=Abdo4413#`.  
**Note:** Local/Replit dev environment works correctly.

### BUG-007 — Live transcript only works for agent side, not caller 🟢 Fixed
**File:** `artifacts/api-server/src/routes/twilio-voice.ts`  
**Fix:** Added `transcribe="true" transcribeCallback="..."` to both Conference elements — agent answer route AND caller join-conference route.

### BUG-008 — Twilio recordings not saving (intermittent) 🟡 In-Progress
**File:** `artifacts/api-server/src/routes/twilio-voice.ts`  
**Root cause investigation:**  
- Recording callback URL uses `getWebhookBase()` → resolves to `API_BASE_URL` = `https://tolip-production.up.railway.app/api` ✅  
- `recordingStatusCallback` set on Conference `record="record-from-start"` ✅  
- DB update logic has 3 fallback strategies (by callSid, by conferenceName, by conferenceSid) ✅  
- **Likely issue:** Race condition where Twilio sends recording callback before call log row is created. Orphan insert path exists but may fail on DB constraints.  
**Next:** Add `conferenceSid` column to `crmCallLogs` for reliable reverse-lookup; also add retry logic.

### BUG-009 — Scraper engine loops without returning results 🔴 Open
**File:** `artifacts/TolipAI-scraper-engine/workers/main.py`  
**Symptoms:** Job stays in `running` state, progress never reaches 100%, results empty.  
**Possible causes:** Circuit breaker open on BrightData; Playwright browser pool exhausted; asyncio task leak; ECS spot interruption mid-job.  
**Next:** Check `/admin/circuit-breakers` endpoint; check `/admin/retry-queue`; add job timeout enforcement.

### BUG-010 — Empty results on 200 OK across scraper features 🔴 Open
**Symptoms:** API returns `{"results": [], "total": 0}` with status 200, nothing displays in frontend.  
**Possible causes:**  
- BrightData proxy not configured (env vars not in ECS task definition)  
- Propelio/Propwire session expired  
- Response parser failing silently (returns empty instead of throwing)  
**Next:** Test `/health/providers` and `/health/keys` on scraper engine; verify BrightData env vars in ECS.

---

## MEDIUM

### BUG-011 — API error messages too generic (just "error 400" / "error 500") 🟡 In-Progress
**Files:** All `artifacts/api-server/src/routes/crm/*.ts` files  
**Cause:** `catch` blocks return `{ error: "Internal server error" }` with no context.  
**Fix:** Improving error messages to include the actual error detail and route context.

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
**Issue:** `tools.ts` accepts PIN from both header AND body; `scraper.ts` only reads header.  
**Fix:** Changed 401 → 403 (main fix). Body PIN acceptance to be added next.

### BUG-016 — Satellite DFD (Dive for Dollar) — needs real test 🔴 Open
**File:** `artifacts/TolipAI-scraper-engine/workers/scrapers/satellite_dfd.py`  
**Next:** Test with real addresses and verify output structure.

### BUG-017 — PDF scraping — needs test 🔴 Open
**Next:** POST to scraper engine with PDF URL; verify backend parses and returns structured data.

### BUG-018 — BrightData proxy not verified as active 🔴 Open
**File:** `artifacts/TolipAI-scraper-engine/workers/proxy_pool.py`  
**Next:** Hit `/debug/proxy` on scraper engine to confirm proxy credentials are loaded and circuit breaker is closed.

### BUG-019 — Distressed leads / cash buyers returning empty 🔴 Open
**Next:** Test with real zip codes; check if Propelio/Propwire sessions are valid.

### BUG-020 — Frontend error messages still generic 🟡 In-Progress
**File:** `artifacts/TolipAI-crm/src/lib/api.ts`  
**Fix:** Updated error format to `Request failed (${status}): ${JSON.stringify(json)}` for better debugging.

### BUG-021 — CRM frontend not built (preview not working) 🟡 In-Progress
**Fix:** Building `artifacts/TolipAI-crm` now; will be served via API server at `/crm`.

### BUG-022 — Tools frontend not built 🟡 In-Progress
**Fix:** Will build `artifacts/TolipAI-tools` after CRM build completes.

---

## LOW

### BUG-023 — CORS origin `$REPLIT_DEV_DOMAIN` not in allowed list 🔴 Open
**File:** `artifacts/api-server/src/app.ts`  
**Fix:** Current CORS config allows `*.replit.dev` and `*.replit.app`. Verify Replit dev domain format matches.

### BUG-024 — Campaigns missing logger on update error 🟢 Fixed
**File:** `artifacts/api-server/src/routes/crm/campaigns.ts:208`  
**Cause:** `catch (err)` block has no `logger.error()` call — error silently swallowed.  
**Fix:** Will add logger call.

### BUG-025 — AI sequences / email drip — needs test 🔴 Open
**File:** `artifacts/api-server/src/routes/crm/sequences.ts`

### BUG-026 — Buyer management — needs test 🔴 Open
**File:** `artifacts/TolipAI-crm/src/pages/buyers/`

### BUG-027 — Analytics dashboard — needs test 🔴 Open

### BUG-028 — Contract generation — needs test 🔴 Open

---

## INFRASTRUCTURE

### INFRA-001 — Scraper engine BrightData credentials in ECS 🔴 Open
**Required env vars in ECS task definition:**  
- `BRIGHTDATA_USERNAME`  
- `BRIGHTDATA_PASSWORD`  
- `BRIGHTDATA_HOST`  
- `BRIGHTDATA_PORT`  

### INFRA-002 — Railway TOOLS_PIN needs update 🔴 Open
**Action:** Railway dashboard → API service → Variables → `TOOLS_PIN=Abdo4413#`

### INFRA-003 — Scraper engine GROQ_API_KEY in ECS 🔴 Open
**Required:** ECS task definition needs `GROQ_API_KEY` for AI research endpoints.

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
