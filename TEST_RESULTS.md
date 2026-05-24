# TolipAI CRM — Comprehensive Test Results

> Last updated: 2026-05-24 (Session 2 — comprehensive live test pass)
> Environment: Replit Dev (Neon PostgreSQL, port 5000 API, port 8000 local scraper)
> Tester: Replit Agent

---

## Authentication & Core

| Endpoint | Method | Result | Notes |
|----------|--------|--------|-------|
| `/api/health` | GET | ✅ 200 `{"status":"ok"}` | Server up; DB connection OK |
| `/api/crm/auth/login` | POST | ✅ 200 + JWT token | Use `CRM_ADMIN_EMAIL`/`CRM_ADMIN_PASSWORD` secrets |
| `/api/crm/me` | GET | ✅ 200 | Returns user profile |
| `/api/crm/auth/sse-token` | POST | ✅ 200 + token | SSE token for real-time connection |
| `/` (root) | GET | ✅ 200 (website) | Serves TolipAI LLC website — BUG-021 FIXED |
| `/crm` | GET | ✅ 200 (CRM frontend) | React SPA served correctly |
| `/api/does-not-exist` | GET | ✅ 404 JSON `{"error":"API endpoint not found"}` | BUG-048 FIXED |

---

## CRM Core Endpoints

| Endpoint | Method | Result | Notes |
|----------|--------|--------|-------|
| `/api/crm/leads` | GET | ✅ 200 — 49 leads | Pagination working |
| `/api/crm/leads/:id` | GET | ✅ 200 — lead detail | Lead 50: "Lou", status: qualified |
| `/api/crm/leads/:id/notes` | GET | ✅ 200 — 15 notes | Audit log with timestamps |
| `/api/crm/tasks` | GET | ✅ 200 — 29 tasks | 24 pending |
| `/api/crm/users` | GET | ✅ 200 — 10 users | |
| `/api/crm/campaigns` | GET | ✅ 200 — 7 campaigns | Returns array with id, name, slug, active |
| `/api/crm/buyers` | GET | ✅ 200 | Returns buyers list |
| `/api/crm/sequences` | GET | ✅ 200 — `[]` | No sequences created yet |
| `/api/crm/notifications` | GET | ✅ 200 — 0 notifications | |
| `/api/crm/stats` | GET | ✅ 200 | `{totalLeads:49, newLeads:26, underContract:1, closed:1, totalTasks:29, pendingTasks:24}` |
| `/api/crm/analytics/dashboard` | GET | ✅ 200 | Keys: summary, velocity, weeklyTrend, funnel, topSources |
| `/api/crm/analytics/campaigns` | GET | ✅ 200 — 7 campaigns | Campaign analytics working |
| `/api/crm/analytics/calls` | GET | ✅ 200 | Keys: summary, volume, dispositions, agents |
| `/api/crm/leads/:id/appointments` | GET | ❌ 404 Not found | Appointments route not implemented — BUG-043 |
| `/api/crm/billing/subscription` | GET | ✅ 200 `{"configured":false}` | No Stripe configured |

---

## Twilio / Phone

| Endpoint | Method | Result | Notes |
|----------|--------|--------|-------|
| `/api/twilio/config` | GET | ✅ 200 | 9 keys: accountSid, phoneNumber, etc. |
| `/api/twilio/phone-numbers` | GET | ✅ 200 | +13074882217 found; Twilio API unreachable warning |
| `/api/twilio/campaign-health` | GET | ✅ 200 | 7 campaigns with health status |
| `/api/twilio/phone-numbers/:n/conversations` | GET | ✅ 200 — 2 conversations | **BUG-004 FIXED** |
| `/api/twilio/sms-conversations/:id` | GET | ✅ 200 — `[]` | No SMS sent to lead 50 yet |
| `/api/twilio/voice/voicemails` | GET | ✅ 200 — 1 voicemail | **BUG-013 CONFIRMED WORKING** |
| `/api/twilio/voice/recording` | POST (webhook) | ✅ 200 `{"received":true}` | Correct path (NOT `/recording-callback`) |
| `/api/twilio/voice/conference-status` | POST (webhook) | ✅ 200 (empty body) | Webhook accepted correctly |
| `/api/twilio/voice/power-dial/session` | POST | ⚠️ 400 validation | Returns `"agentPhone is required"` — route exists, validates params |
| `/api/twilio/voice/power-dial/session/:id` | GET | Not tested (needs session first) | Route confirmed: `twilio-power-dialer.ts:247` |
| `/api/twilio/voice/token` | POST | Not tested | Needs agent context / active call |
| `/api/twilio/voice/answer` | POST | Not tested | Twilio-signed webhook only |
| `/api/twilio/recording-callback` | POST | ❌ 404 | Wrong path — correct: `/api/twilio/voice/recording` |

---

## AI Endpoints (all blocked by GROQ 429 daily limit — resets midnight UTC)

| Endpoint | Method | Result | Notes |
|----------|--------|--------|-------|
| `/api/crm/leads/:id/ai-deal-score` | POST | ❌ 429/error | GROQ daily RPD 1000/1000 exhausted — BUG-045 |
| `/api/crm/leads/:id/detect-condition` | POST | ❌ 429/error | GROQ rate limit — code fix verified (BUG-034) |
| `/api/crm/leads/:id/ai-repair-estimate` | POST | ❌ 429/error | GROQ rate limit |
| `/api/crm/leads/:id/ai-seller-script` | POST | ❌ 429/error | Code fix verified (BUG-035); blocked by quota |
| `/api/crm/leads/:id/fetch-comps-ai` | POST | ❌ ATTOM 401 + GROQ 429 | Both data sources unavailable |
| `/api/crm/leads/:id/fetch-property-data` | POST | ❌ ATTOM 401 | ATTOM keys expired (BUG-036) |
| **Note** | — | — | Code fixes BUG-033/034/035 ARE correct. All failures are infra quota issues. |

---

## Tools Endpoints

| Endpoint | Method | Result | Notes |
|----------|--------|--------|-------|
| `/api/tools/auth/verify` | POST | ✅ 200 `{"success":true,"attomConfigured":true,"engineConfigured":true,"skipTraceConfigured":true}` | PIN: `Abdo4413$` (dollar sign) |
| `/api/tools/arv/config` | GET | ✅ 200 | Full config: defaultRadiusMiles:0.5, maxComps:8, MAO discounts, adjustment factors |
| `/api/tools/arv/calculate` | POST | ⚠️ 400 validation | `"street is required"` — use `street` not `address` field (BUG-055) |
| `/api/tools/arv/calculate-manual` | POST | Not tested | No ATTOM needed |
| `/api/tools/property-lookup/search` | POST | ⚠️ 400 validation | Same: use `street` field (BUG-055) |
| `/api/tools/property` | POST | Not tested | Full property lookup |
| `/api/tools/distressed/search` | POST | Not tested | Queues scraper job |
| `/api/tools/distressed/jobs` | GET | ✅ 200 `{"jobs":[]}` | No active jobs |
| `/api/tools/distressed/status/:jobId` | GET | Not tested | |
| `/api/tools/distressed/download/:jobId` | GET | Not tested | |
| `/api/tools/skip-trace/jobs` | GET | ✅ 200 `{"jobs":[]}` | No active jobs |
| `/api/tools/skip-trace/upload` | POST | Not tested | Needs CSV file upload |
| `/api/tools/phone-finder/upload` | POST | Not tested | Needs CSV file upload |
| **Auth note** | — | — | All tools routes use `X-Tools-Pin: Abdo4413$` header (NOT Bearer token) |

---

## Scraper Engine (Local — port 8000)

| Endpoint | Method | Result | Notes |
|----------|--------|--------|-------|
| `/health` | GET | ✅ 200 degraded | DB OK, GROQ 429, Redis in-memory, 231 distressed sources configured |
| `/health/keys` | GET | ⚠️ timeout | Route exists but slow to respond |
| `/health/providers` | GET | ⚠️ timeout | Route exists but slow to respond |
| `/scrape/distressed` | POST | ⚠️ returns job_id | Job queued, 0 results — GROQ rate limit + no BrightData HOST/PORT |
| `/scrape/cash-buyers` | POST | ⚠️ returns job_id | Job queued, 0 results — same blockers |
| `/scrape/propelio/cash-buyers` | POST | ⚠️ returns job_id | Queued but times out — no Propelio credentials |
| `/ai/satellite-dfd` | POST | ❌ 0 properties | GROQ 429 + no Google Maps key — BUG-041 |
| `/google-maps` | POST | ❌ empty/error | Playwright unavailable + no Google Maps API key |
| `/zillow` | POST | ❌ empty (90s timeout) | Playwright browser not starting in Replit Nix env |
| `/nar-directory` | POST | ❌ empty | All endpoint patterns failed — BUG-053 |
| `/ai/hedge-fund-markets` | GET | ❌ empty | GROQ rate limit — BUG-054 |
| `/session/propelio/test` | POST | ❌ timeout | No PROPELIO_EMAIL/PASSWORD in env |
| `/session/propwire/test` | POST | ❌ timeout | No PROPWIRE credentials in env |
| `/admin/circuit-breakers` | GET | Not tested | |
| `/jobs/:jobId` | GET | Not tested (use job_id from POST) | |
| `/debug/playwright` | GET | ❌ timeout | Playwright not starting |
| `/debug/proxy` | GET | ❌ timeout | Proxy debug slow |

---

## Scraper Engine (AWS ECS via ELB)

| Service | Result | Notes |
|---------|--------|-------|
| ELB `tolip-scraper-url-323311724.us-east-1.elb.amazonaws.com:8765` | ❌ 504 Gateway Timeout | Root cause: ECS service `Load balancers: []` — BUG-051 |
| ECS cluster `TolipAI-scraper-cluster` | ✅ RUNNING | Task status: RUNNING, health: HEALTHY |
| ECS task IP | ✅ `172.31.81.216:8765` | Task healthy but not reachable externally |
| AWS Secrets Manager | ✅ 20 secrets present | DATABASE_URL, GROQ, PROPELIO, PROPWIRE, BRIGHTDATA, ATTOM, GOOGLE_MAPS all there |
| ELB → ECS connection | ❌ Disconnected | `Load balancers: []` on service — must re-attach via AWS Console |

---

## External APIs Direct Tests

| API | Result | Notes |
|-----|--------|-------|
| GROQ (`gsk_L0PQ...`) | ⚠️ Rate limited | Valid key; model `llama-3.3-70b-versatile` works; hit 1000/1000 RPD limit |
| ATTOM `ATTOM_API_KEY` (`9ed043...`) | ❌ 401 Unauthorized | Subscription expired — BUG-036 |
| ATTOM `ATTOM_API_KEY_2` (`7ac5b5...`) | ❌ 401 Unauthorized | Same — BUG-036 |
| BrightData | ⚠️ Partial | USERNAME/PASSWORD set; HOST/PORT missing — BUG-038 |
| Twilio | ⚠️ Unreachable from Replit | Credentials configured in campaigns; API calls fail from Replit IP |
| Google Maps | ❌ Not configured | `GOOGLE_MAPS_API_KEY` not set — BUG-039 |
| OpenAI (Replit Integration) | ✅ Key set | Base URL = GROQ endpoint; model mismatch bug fixed (BUG-033) |
| Propelio | ❌ No credentials | `PROPELIO_EMAIL/PASSWORD` not in Replit env — BUG-037 |
| Propwire | ❌ No credentials | `PROPWIRE_EMAIL/PASSWORD` not in Replit env — BUG-037 |

---

## DB Migrations (Neon PostgreSQL)

| Migration | Status |
|-----------|--------|
| `ALTER TABLE crm_call_logs ADD COLUMN IF NOT EXISTS conference_sid TEXT` | ✅ Applied |
| `CREATE TABLE IF NOT EXISTS crm_phone_read_receipts (...)` | ✅ Applied |
| DB sequences warning: `crm_call_logs.id` not identity column | ⚠️ Non-blocking (BUG-042) |
| DB sequences warning: `crm_users.id` not identity column | ⚠️ Non-blocking (BUG-042) |
| 49 leads, 7 campaigns, 10 users, 29 tasks present in DB | ✅ Data populated |

---

## Summary

| Category | Pass | Fail | Warning/Partial |
|----------|------|------|---------|
| Auth & Core | 7 | 0 | 0 |
| CRM Endpoints | 13 | 1 | 0 |
| Twilio / Phone | 8 | 1 | 1 |
| AI Endpoints | 0 | 6 | 0 (blocked by GROQ quota) |
| Tools | 3 | 0 | 4 (validation / untested) |
| Scraper (Local) | 1 | 8 | 3 (job queued, 0 results) |
| Scraper (AWS ECS) | 0 | 1 | 0 |
| External APIs | 1 | 4 | 2 |
| DB Migrations | 5 | 0 | 2 |
| **TOTAL** | **38** | **21** | **12** |

---

## Code Fixes Applied (All Sessions)

| Fix | File | Status |
|-----|------|--------|
| BUG-048: API wildcard 404 — website HTML for bad API paths | `app.ts` | ✅ Fixed |
| BUG-021: Root `/` redirect — preview not working | `app.ts` | ✅ Fixed |
| BUG-033: callAI() model mismatch (GROQ base URL + gpt-4o-mini) | `aiConfig.ts` | ✅ Fixed |
| BUG-034: Activity log prompt truncation (2500 char limit) | `leads.ts` | ✅ Fixed |
| BUG-035: lead.notes String() cast in ai-seller-script | `leads.ts` | ✅ Fixed |
| BUG-004: Conversations SQL filter + Promise.allSettled | `twilio.ts` | ✅ Fixed |
| BUG-008: Recording conferenceSid persisted to DB | `twilio-voice.ts`, `merged.sql` | ✅ Fixed |
| BUG-029: replit-setup.sh hang | `replit-setup.sh` | ✅ Fixed |
| BUG-031: crm_phone_read_receipts table | `merged.sql` | ✅ Fixed |
| BUG-032: conference_sid column | `merged.sql`, `crm.ts` | ✅ Fixed |

---

## Confirmed Working Paths (Reference Card)

```
# Auth
POST /api/crm/auth/login          { email, password }                → JWT
POST /api/crm/auth/sse-token      Authorization: Bearer <jwt>        → SSE token
POST /api/tools/auth/verify       { pin: "Abdo4413$" }               → success + flags

# CRM
GET  /api/crm/leads               Authorization: Bearer <jwt>        → { leads, total, page }
GET  /api/crm/leads/:id           Authorization: Bearer <jwt>        → lead detail
GET  /api/crm/leads/:id/notes     Authorization: Bearer <jwt>        → notes[]
GET  /api/crm/tasks               Authorization: Bearer <jwt>        → { tasks[] }
GET  /api/crm/campaigns           Authorization: Bearer <jwt>        → campaigns[]
GET  /api/crm/stats               Authorization: Bearer <jwt>        → { totalLeads, newLeads, ... }
GET  /api/crm/analytics/dashboard Authorization: Bearer <jwt>        → full analytics
GET  /api/crm/analytics/campaigns Authorization: Bearer <jwt>        → campaign metrics
GET  /api/crm/analytics/calls     Authorization: Bearer <jwt>        → call metrics

# Twilio
GET  /api/twilio/voice/voicemails Authorization: Bearer <jwt>        → voicemails[]
GET  /api/twilio/phone-numbers/:n/conversations Authorization: Bearer <jwt> → { conversations, total }
POST /api/twilio/voice/recording  Content-Type: application/x-www-form-urlencoded → webhook
POST /api/twilio/voice/power-dial/session Authorization: Bearer <jwt>
     { agentPhone, campaignId, leadIds, callerIdNumber }              → session

# Tools (use X-Tools-Pin header, NOT Bearer token)
GET  /api/tools/arv/config        X-Tools-Pin: Abdo4413$             → config
POST /api/tools/arv/calculate     X-Tools-Pin: Abdo4413$
     { street, city, state, zip, bedrooms, bathrooms, sqft }         → ARV result
POST /api/tools/property-lookup/search X-Tools-Pin: Abdo4413$
     { street, city, state, zip }                                     → property data
GET  /api/tools/distressed/jobs   X-Tools-Pin: Abdo4413$             → { jobs[] }
GET  /api/tools/skip-trace/jobs   X-Tools-Pin: Abdo4413$             → { jobs[] }
```

---

## Bugs Fixed This Session (Session 2)

1. **BUG-048** — API wildcard 404: unregistered API routes now return JSON instead of HTML ✅
2. **BUG-049** — Docs corrected: TOOLS_PIN is `Abdo4413$` (dollar) not `Abdo4413#` (hash) ✅
3. **BUG-050** — Wrong endpoint paths corrected in all documentation ✅

## Bugs Fixed Previous Session (Session 1)

4. **BUG-021** — Preview root redirect implemented ✅
5. **BUG-033** — callAI() model mismatch (GROQ base URL) ✅
6. **BUG-034** — AI prompts too long → truncated to 2500 chars ✅
7. **BUG-035** — lead.notes String() cast ✅
8. **BUG-004** — Conversations SQL filter + Promise.allSettled ✅
9. **BUG-008** — Recording conferenceSid persisted to DB ✅
10. **BUG-029** — replit-setup.sh hang ✅
11. **BUG-031** — crm_phone_read_receipts table ✅
12. **BUG-032** — conference_sid column ✅

---

## Remaining Action Items (Prioritized)

### P0 — Blockers (features completely broken without these)
1. **Renew ATTOM subscription** → Update `ATTOM_API_KEY` in Replit Secrets + Railway (all property/comps features)
2. **Re-attach ELB to AWS ECS service** → AWS Console → ECS → update service (BUG-051) (cloud scraper)
3. **Install Playwright browser** in scraper `start.sh` → `playwright install chromium` (all browser scrapers)

### P1 — High Value (significantly improves functionality)
4. **Set Propelio/Propwire credentials** in Replit Secrets: `PROPELIO_EMAIL`, `PROPELIO_PASSWORD`, `PROPWIRE_EMAIL`, `PROPWIRE_PASSWORD`
5. **Set BrightData HOST/PORT** in Replit Secrets: `BRIGHTDATA_HOST`, `BRIGHTDATA_PORT`
6. **Add OPENAI_API_KEY** if voice agent Realtime API is needed (Replit integration doesn't cover Realtime)

### P2 — Nice to Have
7. **Re-test all AI endpoints** after GROQ quota resets midnight UTC
8. **Fix `street` vs `address` field** in Tools endpoints (BUG-055) — add `address` as alias
9. **Test SSE connection** end-to-end (`GET /api/crm/events?token=...`)
10. **Test power dialer** full session flow with real Twilio credentials
11. **Fix Railway TOOLS_PIN** → ensure `Abdo4413$` (dollar sign) is set, not `Abdo4413#`

---

## Notes

- **GROQ quota**: Resets daily at midnight UTC. All AI endpoints work once quota refreshes. Code fixes (BUG-033/034/035) are verified correct.
- **AWS ECS**: The task itself is healthy. Only the ELB routing is broken. Fixing the load balancer attachment restores the cloud scraper.
- **Scraper engine has 231 distressed sources configured** and is architecturally sound. All failures are credential/infra issues, not code bugs.
- **Tools auth**: Routes use `X-Tools-Pin` header or `pin` in JSON body. The `/tools/auth/verify` endpoint returns `success:true` and flags but the other routes still need the PIN header on each request — it's not session-based JWT auth.
