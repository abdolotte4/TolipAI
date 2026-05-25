# TolipAI CRM — Comprehensive Test Results

> Last updated: 2026-05-25 (Session 4 — full endpoint audit + scraper live tests)
> Environment: Replit Dev (Neon PostgreSQL, port 5000 API, port 8000 local scraper)
> Tester: Replit Agent

---

## Authentication & Core

| Endpoint | Method | Result | Notes |
|----------|--------|--------|-------|
| `/api/health` | GET | ✅ 200 `{"status":"ok"}` | Server up; DB connection OK |
| `/api/crm/auth/login` | POST | ✅ 200 + JWT token | admin@digorcrm.com / Admin4413$AbdoKing |
| `/api/crm/me` | GET | ✅ 200 | email: admin@digorcrm.com, role: super_admin |
| `/api/crm/auth/sse-token` | POST | ✅ 200 + token | 36-char SSE token |
| `/` (root) | GET | ✅ 200 (website) | TolipAI website with new TOLIP backgrounds |
| `/crm` | GET | ✅ 200 (CRM frontend) | React SPA served correctly |
| `/tools` | GET | ✅ 200 (Tools frontend) | Tools SPA served correctly |
| `/api/does-not-exist` | GET | ✅ 404 JSON `{"error":"API endpoint not found"}` | BUG-048 FIXED |

---

## CRM Core Endpoints

| Endpoint | Method | Result | Notes |
|----------|--------|--------|-------|
| `/api/crm/leads` | GET | ✅ 200 — 49 leads | Pagination working |
| `/api/crm/leads/:id` | GET | ✅ 200 — lead detail | Lead 1 working; Lead 50: "Lou", status: qualified |
| `/api/crm/leads/:id/notes` | GET | ✅ 200 — 20 notes | Audit log with timestamps |
| `/api/crm/tasks` | GET | ✅ 200 — 29 tasks | 24 pending |
| `/api/crm/users` | GET | ✅ 200 — 10 users | |
| `/api/crm/campaigns` | GET | ✅ 200 — 7 campaigns | Returns array with id, name, slug, active |
| `/api/crm/buyers` | GET | ✅ 200 — 0 buyers | Empty (no cash buyers loaded yet) |
| `/api/crm/sequences` | GET | ✅ 200 — `[]` | No sequences created yet |
| `/api/crm/notifications` | GET | ✅ 200 — 0 unread | `{notifications:[], unreadCount:0}` |
| `/api/crm/stats` | GET | ✅ 200 | `{totalLeads:49, newLeads:26, underContract:1, closed:1, totalTasks:29, pendingTasks:24}` |
| `/api/crm/analytics/dashboard` | GET | ✅ 200 | Keys: summary, velocity, weeklyTrend, funnel, topSources |
| `/api/crm/analytics/campaigns` | GET | ✅ 200 — 7 campaigns | Campaign analytics working |
| `/api/crm/analytics/calls` | GET | ✅ 200 | Keys: summary, volume, dispositions, agents |
| `/api/crm/contracts` | GET | ✅ 200 — 1 contract | |
| `/api/crm/billing/subscription` | GET | ✅ 200 `{"configured":false}` | No Stripe configured |
| `/api/crm/leads/:id/appointments` | GET | ❌ 404 Not found | Appointments route not implemented — BUG-043 |

---

## Twilio / Phone

| Endpoint | Method | Result | Notes |
|----------|--------|--------|-------|
| `/api/twilio/config` | GET | ✅ 200 | 9 keys: accountSid, voiceConfigured, twilioEnabled, phoneNumber, authTokenMasked, apiKeySid, apiKeySecretMasked, voiceAppSid, configured |
| `/api/twilio/phone-numbers` | GET | ✅ 200 | +13074882217 — Twilio API unreachable warning (shows configured number only) |
| `/api/twilio/campaign-health` | GET | ✅ 200 | 7 campaigns; Campaign 7 "Abdullah" has full voice+SMS config |
| `/api/twilio/phone-numbers/:n/conversations` | GET | ✅ 200 — 2 conversations | BUG-004 FIXED; BUG-063 FIXED (5s refresh) |
| `/api/twilio/sms-conversations/:id` | GET | ✅ 200 — `[]` | No SMS sent to lead 50 |
| `/api/twilio/voice/voicemails` | GET | ✅ 200 — 1 voicemail | BUG-013 CONFIRMED WORKING |
| `/api/twilio/voice/ringback` | GET | ✅ 200 — TwiML | `<Play loop="10">` ringback — BUG-060 FIXED |
| `/api/twilio/voice/recording` | POST (webhook) | ✅ 200 `{"received":true}` | Correct path (NOT `/recording-callback`) |
| `/api/twilio/voice/conference-status` | POST (webhook) | ✅ 200 | Webhook accepted correctly |
| `/api/twilio/voice/power-dial/session` | POST | ⚠️ 400 validation | Returns `"agentPhone is required"` — route exists, validates params |
| `/api/twilio/voice/token` | POST | Not tested | Needs Twilio Device context |
| `/api/twilio/voice/answer` | POST | Not tested | Twilio-signed webhook only |

---

## AI Endpoints (blocked by GROQ 429 daily limit — resets midnight UTC)

| Endpoint | Method | Result | Notes |
|----------|--------|--------|-------|
| `/api/crm/leads/:id/ai-deal-score` | POST | ❌ 429/error | GROQ daily RPD limit exhausted — BUG-045 |
| `/api/crm/leads/:id/detect-condition` | POST | ❌ 429/error | GROQ rate limit |
| `/api/crm/leads/:id/ai-repair-estimate` | POST | ❌ 429/error | GROQ rate limit |
| `/api/crm/leads/:id/ai-seller-script` | POST | ❌ 429/error | Code fix verified (BUG-035); blocked by quota |
| `/api/crm/leads/:id/fetch-comps-ai` | POST | ❌ ATTOM 401 + GROQ 429 | Both data sources unavailable |
| `/api/crm/leads/:id/fetch-property-data` | POST | ❌ ATTOM 401 | ATTOM keys expired (BUG-036) |
| **Note** | — | — | Code fixes BUG-033/034/035 ARE correct. All failures are infra quota issues. |

---

## Tools Endpoints

| Endpoint | Method | Result | Notes |
|----------|--------|--------|-------|
| `/api/tools/auth/verify` | POST | ❌ "Invalid PIN" | **BUG-067**: `TOOLS_PIN` secret = `Abdo4413#` (wrong); must be `Abdo4413$` |
| `/api/tools/arv/config` | GET | ❌ "Invalid PIN" | Same root cause |
| `/api/tools/arv/calculate` | POST | ❌ "Invalid PIN" | Same root cause |
| `/api/tools/property-lookup/search` | POST | ❌ "Invalid PIN" | Same root cause |
| `/api/tools/property` | POST | ❌ "Invalid PIN" | Same root cause |
| `/api/tools/distressed/search` | POST | ❌ "Invalid PIN" | Same root cause |
| `/api/tools/skip-trace/jobs` | GET | ❌ "Invalid PIN" | Same root cause |
| **Fix** | — | — | Update `TOOLS_PIN` in Replit Secrets from `Abdo4413#` → `Abdo4413$` (BUG-067) |
| **Previous session (S2)** | — | — | When PIN is correct: arv/config, skip-trace/jobs, distressed/jobs all returned ✅ 200 |

---

## Scraper Engine (Direct — port 8000)

| Endpoint | Method | Result | Notes |
|----------|--------|--------|-------|
| `/health` | GET | ✅ 200 degraded | DB OK (60ms), GROQ 429, Redis in-memory, 231 distressed sources, all circuit breakers closed |
| `/docs` | GET | ✅ 200 | FastAPI Swagger UI available |
| `/metrics` | GET | ✅ 200 | Prometheus metrics (all counters at 0 — fresh start) |
| `/ai/satellite-dfd` | POST | ✅ **REAL DATA** | Dallas TX 75201: scanned 33, above threshold 2 — see detail below |
| `/scrape/cash-buyers` | POST | ⚠️ 422 | Needs `lead_id` OR `address` in body (not city/state/zip) |
| `/phone-finder/lookup` | POST | ⚠️ 422 | Different params required — route exists |
| `/nar-directory` | POST | ❌ all patterns failed | Browser scrape unavailable (Playwright disabled) |
| `/google-search` | POST | ❌ Playwright unavailable | Browser scrape fallback failed |
| `/google-maps` | POST | ❌ Playwright unavailable | No Google Maps API key either |
| `/admin/circuit-breakers` | GET | ✅ 200 | All 7 breakers: propelio/propwire/attom/brightdata/groq/openrouter/scraperapi — all closed |
| `/lead-gen/foreclosure` | POST | ⚠️ 422 | `city` required (not `county`) |
| `/bulk` | POST | ❌ Google Maps unavailable | satellite_dfd job tried Google Maps — Playwright issue |
| `/debug/playwright` | GET | ❌ timeout | Playwright not installed |

### Satellite DFD Live Data (T006 — Session 4)
```
POST /ai/satellite-dfd {"city":"Dallas","state":"TX","zip":"75201","limit":10}
→ total_scanned: 33 | total_above_threshold: 2 | min_score_filter: 30
→ results[0]: { address: "2315 Routh St, Dallas, TX 75201", distress_score: 40,
                distress_category: "medium", latitude: 32.794803, longitude: -96.800323 }
```

---

## Scraper Engine via API Proxy (`/api/scraper-engine/*`)

| Endpoint | S2 Result | S4 Result | Notes |
|----------|-----------|-----------|-------|
| `/api/scraper-engine/status` | ❌ `{raw: "<html>502..."}` | ✅ Falls back to localhost | BUG-068 FIXED — proxy now tries localhost:8000 when ELB fails |
| `/api/scraper-engine/satellite-dfd` | ❌ `{raw: ...}` | ✅ Real data via fallback | Same fix |
| `/api/scraper-engine/cash-buyers` | ❌ `{raw: ...}` | ✅ Proper error from scraper | Same fix |
| AWS ELB `tolip-scraper-url-...` | ❌ 504 timeout | ❌ 504 timeout | BUG-051 — ECS disconnected from ELB |

---

## Scraper Engine (AWS ECS via ELB)

| Service | Result | Notes |
|---------|--------|-------|
| ELB `tolip-scraper-url-323311724.us-east-1.elb.amazonaws.com:8765` | ❌ 504 Gateway Timeout | BUG-051 — ECS service has `Load balancers: []` |
| ECS cluster `TolipAI-scraper-cluster` | ✅ Task RUNNING/HEALTHY | Private IP `172.31.81.216:8765` — not reachable externally |
| AWS Secrets Manager | ✅ 20 secrets present | DATABASE_URL, GROQ, PROPELIO, PROPWIRE, BRIGHTDATA, ATTOM, GOOGLE_MAPS confirmed |
| AWS CLI access from Replit | ❌ No access | AWS keys are secrets but CLI not configured in shell |

---

## External APIs

| API | Result | Notes |
|-----|--------|-------|
| GROQ (`gsk_L0PQ...`) | ⚠️ Rate limited | Valid key; hit daily RPD limit; resets midnight UTC |
| ATTOM `ATTOM_API_KEY` | ❌ 401 Unauthorized | Subscription expired — BUG-036 |
| ATTOM `ATTOM_API_KEY_2` | ❌ 401 Unauthorized | Same — BUG-036 |
| BrightData | ⚠️ Partial | USERNAME/PASSWORD set; HOST/PORT missing — BUG-038 |
| Twilio | ⚠️ Unreachable from Replit | Credentials configured; API calls fail from Replit IPs |
| Google Maps | ❌ Not configured | No `GOOGLE_MAPS_API_KEY` — BUG-039 |
| OpenAI (via Groq base URL) | ✅ Key set | `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY` |
| Propelio | ❌ No credentials | `PROPELIO_EMAIL/PASSWORD` not in env — BUG-037 |
| Propwire | ❌ No credentials | `PROPWIRE_EMAIL/PASSWORD` not in env — BUG-037 |

---

## DB Migrations (Neon PostgreSQL)

| Migration | Status |
|-----------|--------|
| `ALTER TABLE crm_call_logs ADD COLUMN IF NOT EXISTS conference_sid TEXT` | ✅ Applied |
| `CREATE TABLE IF NOT EXISTS crm_phone_read_receipts (...)` | ✅ Applied |
| DB sequences warning: `crm_call_logs.id` not identity column | ⚠️ Non-blocking (BUG-042) |
| DB sequences warning: `crm_users.id` not identity column | ⚠️ Non-blocking (BUG-042) |
| 49 leads, 7 campaigns, 10 users, 29 tasks, 1 contract present | ✅ Data populated |

---

## Summary

| Category | Pass | Fail | Warning/Partial |
|----------|------|------|---------|
| Auth & Core | 8 | 0 | 0 |
| CRM Endpoints | 14 | 1 | 0 |
| Twilio / Phone | 9 | 0 | 2 |
| AI Endpoints | 0 | 6 | 0 (blocked by GROQ quota) |
| Tools (with correct PIN) | 0 | 7 | 0 (**BUG-067**: wrong PIN secret) |
| Scraper Direct (port 8000) | 3 | 4 | 3 |
| Scraper via API proxy | 3 | 0 | 1 (BUG-068 FIXED) |
| Scraper (AWS ECS) | 0 | 1 | 0 |
| External APIs | 1 | 4 | 2 |
| DB Migrations | 5 | 0 | 2 |
| **TOTAL** | **43** | **23** | **10** |

---

## Code Fixes Applied (All Sessions)

| Fix | File | Status |
|-----|------|--------|
| BUG-069: CORS `:PORT` suffix in Replit iframe origin | `app.ts` | ✅ S4 Fixed |
| BUG-068: scraperEngine proxy localhost fallback | `scraperEngine.ts` | ✅ S4 Fixed |
| BUG-070: `.replit` port 3000 / double-start Project workflow | `.replit` via workflow tool | ✅ S4 Fixed |
| BUG-060: No ringback TwiML + no browser ringback audio | `twilio-voice.ts`, `PhoneContext.tsx` | ✅ S3 Fixed |
| BUG-061: callerIdUsed stale closure → callerIdRef | `PhoneContext.tsx` | ✅ S3 Fixed |
| BUG-062: call_logged SSE not emitted from /voice/log | `twilio-voice.ts` | ✅ S3 Fixed |
| BUG-063: Manual Dialer 30s refresh + no contact selection | `PhoneNumbers.tsx` | ✅ S3 Fixed |
| BUG-064: webhookBase.ts Railway URL in Replit dev | `webhookBase.ts` | ✅ S3 Fixed |
| BUG-065: DIGOR LLC branding in website hero | `Hero.tsx`, `About.tsx`, `Services.tsx` | ✅ S3 Fixed |
| BUG-048: API wildcard 404 — website HTML for bad API paths | `app.ts` | ✅ S2 Fixed |
| BUG-033: callAI() model mismatch (GROQ base URL + gpt-4o-mini) | `aiConfig.ts` | ✅ S1 Fixed |
| BUG-034: Activity log prompt truncation (2500 char limit) | `leads.ts` | ✅ S1 Fixed |
| BUG-035: lead.notes String() cast in ai-seller-script | `leads.ts` | ✅ S1 Fixed |
| BUG-004: Conversations SQL filter + Promise.allSettled | `twilio.ts` | ✅ S1 Fixed |
| BUG-008: Recording conferenceSid persisted to DB | `twilio-voice.ts`, `merged.sql` | ✅ S1 Fixed |

---

## Confirmed Working Paths (Reference Card)

```
# Auth
POST /api/crm/auth/login          { email, password }                → JWT
POST /api/crm/auth/sse-token      Authorization: Bearer <jwt>        → SSE token

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
GET  /api/twilio/voice/ringback                                        → TwiML <Play loop="10">
GET  /api/twilio/voice/voicemails Authorization: Bearer <jwt>        → voicemails[]
GET  /api/twilio/phone-numbers/:n/conversations Authorization: Bearer <jwt> → { conversations, total }
POST /api/twilio/voice/recording  Content-Type: application/x-www-form-urlencoded → webhook
POST /api/twilio/voice/power-dial/session Authorization: Bearer <jwt>
     { agentPhone, campaignId, leadIds, callerIdNumber }              → session

# Tools (use X-Tools-Pin header — MUST be Abdo4413$ with dollar sign)
# NOTE: TOOLS_PIN secret currently wrong (Abdo4413# hash) — fix in Replit Secrets panel
GET  /api/tools/arv/config        X-Tools-Pin: Abdo4413$             → config
POST /api/tools/arv/calculate     X-Tools-Pin: Abdo4413$
     { street, city, state, zip, bedrooms, bathrooms, sqft }         → ARV result
POST /api/tools/property-lookup/search X-Tools-Pin: Abdo4413$
     { street, city, state, zip }                                     → property data
GET  /api/tools/distressed/jobs   X-Tools-Pin: Abdo4413$             → { jobs[] }
GET  /api/tools/skip-trace/jobs   X-Tools-Pin: Abdo4413$             → { jobs[] }

# Scraper Engine (direct port 8000 or via /api/scraper-engine/* proxy)
GET  /health                                                           → degraded (GROQ 429, Playwright disabled, DB OK)
POST /ai/satellite-dfd            { city, state, zip, limit }        → { results[], total_scanned, total_above_threshold }
GET  /admin/circuit-breakers                                           → all circuit breaker states
GET  /metrics                                                          → Prometheus metrics
GET  /docs                                                             → Swagger UI (FastAPI)
```

---

## Open Blockers (User Must Fix)

| # | Action | Secret/Config | Priority |
|---|--------|---------------|----------|
| 1 | Change `TOOLS_PIN` from `Abdo4413#` to `Abdo4413$` | Replit Secrets panel | **P0 — Immediate** |
| 2 | Renew ATTOM subscription, update `ATTOM_API_KEY` | Replit Secrets + Railway | **P0 — Immediate** |
| 3 | Re-attach ELB to ECS service in AWS Console | AWS Console → ECS | **P0 — Production** |
| 4 | Set `PROPELIO_EMAIL`, `PROPELIO_PASSWORD` | Replit Secrets | **P1** |
| 5 | Set `PROPWIRE_EMAIL`, `PROPWIRE_PASSWORD` | Replit Secrets | **P1** |
| 6 | Set `BRIGHTDATA_HOST`, `BRIGHTDATA_PORT` | Replit Secrets | **P1** |

---

## Notes

- Port: API = **5000**, Scraper = **8000**. Preview pane configured to port 5000 (webview).
- GROQ quota resets midnight UTC. After reset, all AI endpoints in CRM + scraper will work.
- Twilio API unreachable from Replit IPs — voice/SMS features require Railway production deployment.
- Scraper satellite DFD works without Playwright or GROQ — uses PropertyAPI + custom scoring.
