# TolipAI — Enterprise Deployment & Architecture Guide

> Last updated: 2026-05-25 · Session 6

---

## 1. System Overview

TolipAI is a multi-tenant real-estate CRM with an AI-powered lead acquisition engine.  
It is composed of three independently deployable services:

| Service | Runtime | Hosting | Port |
|---|---|---|---|
| **API Server** | Node 20 / Express + TypeScript | Railway (always-on) | 5000 |
| **CRM Frontend** | React 18 + Vite | Served by API server (`/crm/*`) | — |
| **Scraper Engine** | Python 3.12 / FastAPI | AWS Fargate (ECS) | 8000 |

All three services share one **PostgreSQL 16** database (managed by Railway).  
Twilio is used for SMS and browser-based PSTN calls.

---

## 2. Repository Layout

```
/
├── artifacts/
│   ├── api-server/          # Node/Express REST API + Twilio webhooks
│   │   ├── src/
│   │   │   ├── routes/      # twilio.ts, crm/, scraper-engine.ts, …
│   │   │   ├── services/    # aiSmsService.ts, …
│   │   │   ├── db/          # schema.ts (Drizzle ORM)
│   │   │   └── lib/         # sse.ts, logger.ts, …
│   │   └── package.json
│   ├── TolipAI-crm/         # React SPA (served at /crm/)
│   │   └── src/
│   │       ├── pages/       # Leads, Pipeline, Campaigns, PhoneNumbers, …
│   │       ├── contexts/    # PhoneContext.tsx (Twilio browser SDK)
│   │       └── components/
│   └── TolipAI-scraper-engine/   # Python AI scraping microservice
│       └── workers/
│           ├── main.py      # FastAPI app + all HTTP endpoints
│           ├── llm.py       # Provider chain (OpenAI → Groq → …)
│           ├── config.py    # Settings loaded from env vars
│           ├── distressed.py
│           ├── cash_buyers.py
│           └── …
├── node-start.sh            # API server startup (kills stale PIDs on 5000)
├── BUGS.md                  # Session-by-session bug log
└── ENTERPRISE.md            # This file
```

---

## 3. Multi-Tenant Model

Each **Campaign** is the top-level tenant unit.

```
Campaign
  ├── Users          (crm_users — belong to one campaign)
  ├── Leads          (crm_leads — always scoped by campaignId)
  ├── Phone Numbers  (crm_campaign_phone_numbers — secondary Twilio numbers)
  ├── Twilio Config  (embedded in crm_campaigns — accountSid, apiKey, twimlAppSid)
  └── AI Settings    (aiSmsEnabled, aiSmsPersonality, aiSmsMaxRepliesPerDay)
```

**Isolation guarantees:**
- Every DB query in the API server includes a `campaignId` filter derived from the authenticated user's JWT.
- Twilio webhooks resolve the campaign from the receiving `To` number before any data access.
- Scraper jobs are scoped to a campaign at enqueue time; results are tagged with `campaignId`.

---

## 4. Authentication

| Mechanism | Used by |
|---|---|
| JWT (HS256, 24h expiry) | CRM frontend → API server |
| `X-API-Key` header | API server → Scraper engine (internal) |
| Twilio request signature | Twilio → API server webhooks |

JWT payload:
```json
{ "userId": 42, "campaignId": 7, "role": "admin" }
```

The `SCRAPER_API_KEY` env var must be identical in both the API server and the scraper engine.  
All non-`/health` scraper endpoints return `401 Unauthorized` without a valid key.

---

## 5. Environment Variables

### API Server (Railway)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | HS256 signing secret |
| `TWILIO_ACCOUNT_SID` | ✅ | Global Twilio account (Wyoming number) |
| `TWILIO_AUTH_TOKEN` | ✅ | Global Twilio auth token |
| `TWILIO_PHONE_NUMBER` | ✅ | Global outbound number (+13074882217) |
| `TWILIO_API_KEY_SID` | ✅ | For browser SDK (TwiML App) |
| `TWILIO_API_KEY_SECRET` | ✅ | For browser SDK |
| `TWILIO_TWIML_APP_SID` | ✅ | TwiML App SID for browser calls |
| `OPENAI_API_KEY` | ✅ | AI SMS replies + scraper LLM |
| `SCRAPER_API_KEY` | ✅ | Shared secret for scraper proxy |
| `API_BASE_URL` | ✅ | Railway public URL (Twilio webhook base) |
| `ATTOM_API_KEY` | ⚠️ | Property data / ARV (subscription required) |
| `GOOGLE_MAPS_API_KEY` | ⚠️ | Satellite DFD geocoding |

### Scraper Engine (AWS ECS Task Definition)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Same PostgreSQL DB as API server |
| `SCRAPER_API_KEY` | ✅ | Must match API server value |
| `OPENAI_API_KEY` | ✅ | Primary LLM (GPT-4o-mini) |
| `GROQ_API_KEY` | ⚠️ | Free fallback (hits 429 daily) |
| `MOONSHOT_KIMI_API_KEY` | ⚠️ | Kimi K2.6 — best model if available |
| `OPENROUTER_API_KEY` | ⚠️ | Kimi K2.6 via OpenRouter fallback |
| `BRIGHTDATA_HOST` | ⚠️ | Residential proxy for scraping |
| `BRIGHTDATA_PORT` | ⚠️ | Residential proxy port |
| `PROPELIO_EMAIL` | ⚠️ | Propelio login for distressed leads |
| `PROPELIO_PASSWORD` | ⚠️ | Propelio login |
| `PROPWIRE_EMAIL` | ⚠️ | Propwire login for cash buyers |
| `PROPWIRE_PASSWORD` | ⚠️ | Propwire login |
| `GOOGLE_MAPS_API_KEY` | ⚠️ | Satellite DFD |
| `PORT` | — | Default `8000` (Fargate maps 8000→8000) |

---

## 6. LLM Provider Chain (Scraper Engine)

The scraper uses a waterfall of LLM providers with automatic circuit breakers and cooldown timers.  
Providers are tried in order; if one fails or rate-limits, the next is tried automatically.

```
1. Moonshot (Kimi K2.6 direct)     — 1M context, best quality
2. OpenRouter (Kimi K2.6)          — same model via proxy
3. OpenAI (GPT-4o-mini)            — ✅ reliable paid tier (added Session 6)
4. Groq (Llama 3.3 70B)            — free, resets midnight UTC (429s often)
5. Cerebras (Llama 3.1 8B)         — free fallback
6. Together (Llama 3.3 70B Turbo)  — free fallback
7. NVIDIA (Llama 3.3 70B)          — free fallback
```

**Configuration:** `artifacts/TolipAI-scraper-engine/workers/llm.py` + `config.py`

Health endpoint `GET /health` reports `llm.any_ok` — if `false`, all AI scoring is disabled and scrapers return 0 results.

---

## 7. Scraper Engine — AI Features

| Endpoint | What it does | Required credentials |
|---|---|---|
| `POST /scrape/distressed` | Find distressed property leads in a county | LLM + BrightData + Propelio |
| `POST /scrape/cash-buyers` | Find cash buyers in a market | LLM + BrightData + Propwire |
| `POST /ai/satellite-dfd` | AI satellite image damage/distress analysis | LLM + Google Maps |
| `POST /session/propelio/test` | Test Propelio login credentials | Propelio creds + Playwright |
| `POST /session/propwire/test` | Test Propwire login credentials | Propwire creds + Playwright |
| `GET /health` | Service health + provider status | — (public) |
| `GET /health/providers` | Detailed per-provider circuit-breaker state | — (public) |
| `GET /jobs/{id}` | Poll async job status | `X-API-Key` |

All endpoints except `/health` and `/health/providers` require `X-API-Key` header.

---

## 8. Twilio — Per-Campaign Configuration

Each campaign can have its own Twilio credentials (separate account) or inherit the global account.

**Campaign Twilio settings (stored in `crm_campaigns`):**

| Field | Description |
|---|---|
| `twilioAccountSid` | Campaign-specific Twilio account SID (optional — falls back to global) |
| `twilioApiKeySid` | API Key SID for browser SDK token generation |
| `twilioApiKeySecret` | API Key Secret |
| `twilioTwimlAppSid` | TwiML App SID for outbound browser calls |
| `twilioPhoneNumber` | Primary Twilio number for this campaign |
| `twilioEnabled` | Master on/off switch |
| `aiSmsEnabled` | Enable AI auto-reply to inbound SMS |
| `aiSmsPersonality` | Prompt modifier for AI SMS persona |
| `aiSmsMaxRepliesPerDay` | Daily AI reply cap per lead (default: 5) |

**Secondary phone numbers** are stored in `crm_campaign_phone_numbers` (one-to-many).  
When user selects a secondary number in the Phone Numbers panel, all outbound calls use that number as the `CallerId`.

**Inbound SMS webhook flow:**
```
Twilio → POST /api/twilio/sms-webhook
  → Resolve lead by From number
  → If no lead: auto-create lead (source=inbound_sms)   ← NEW in Session 6
  → Save message to crm_open_phone_messages
  → Emit SSE event (toast in UI)
  → STOP/HELP compliance check
  → Notify campaign users (in-app notification)
  → AI auto-reply (if aiSmsEnabled + not opted out + throttle OK)
```

---

## 9. Database Schema — Key Tables

| Table | Purpose |
|---|---|
| `crm_campaigns` | Top-level tenant; Twilio config; AI settings |
| `crm_users` | Agents/admins scoped to a campaign |
| `crm_leads` | Property seller leads (phone, address, status, source) |
| `crm_open_phone_messages` | SMS message log (all directions) |
| `crm_sms_conversations` | AI-generated SMS thread for rate limiting |
| `crm_sms_opt_outs` | TCPA opt-out registry |
| `crm_notifications` | In-app notification feed |
| `crm_call_logs` | Outbound/inbound call history |
| `crm_campaign_phone_numbers` | Secondary Twilio numbers per campaign |
| `crm_notes` | Lead notes + audit trail |
| `crm_tasks` | Lead follow-up tasks |
| `crm_contracts` | Contract/offer tracking |

---

## 10. AWS Infrastructure

### Scraper Engine on Fargate

```
Route 53 (optional)
    └── Application Load Balancer (ALB)
            └── ECS Service: tolipai-scraper-engine-service-xop
                    └── Fargate Task (Python 3.12, 0.5 vCPU, 1GB RAM)
                            └── FastAPI on port 8000
```

**Known infrastructure gap:** The ALB target group is not attached to the ECS service.  
Until fixed, the scraper is only reachable directly by task IP — not via the load balancer.  
**Fix:** AWS Console → ECS → cluster `TolipAI-scraper-cluster` → service → Update → attach ALB target group.

### ECS Task Definition (key settings)
- Container port: `8000`
- Health check: `GET /health` → 200
- Spot interruption handler: `SPOT_EXIT_DEADLINE_SECONDS=90` (graceful job draining)
- Log driver: `awslogs` → CloudWatch log group `/ecs/tolipai-scraper`

---

## 11. Adding a New Campaign (Onboarding Checklist)

1. **Create campaign** in DB: `INSERT INTO crm_campaigns (name, ...) VALUES (...)`
2. **Set Twilio credentials** in Campaign → Integrations → Twilio:
   - Account SID, API Key SID, API Key Secret, TwiML App SID, Phone Number
3. **Configure Twilio webhook** on the phone number:
   - SMS webhook: `https://<API_BASE_URL>/api/twilio/sms-webhook` (POST)
   - Voice webhook: `https://<API_BASE_URL>/api/twilio/voice-webhook` (POST)
   - Status callback: `https://<API_BASE_URL>/api/twilio/call-status` (POST)
4. **Create admin user** for the campaign
5. **Enable AI SMS** (optional): Campaign → Settings → AI SMS → toggle on, set personality prompt
6. **Import lead list** (optional): Leads → Import CSV
7. **Configure secondary phone numbers** (optional): Integrations → Phone Numbers

---

## 12. Monitoring & Alerting

| Signal | Source | Check |
|---|---|---|
| API server health | Railway dashboard | HTTP 200 on `GET /` |
| Scraper health | `GET <scraper_url>/health` | `status: ok`, `llm.any_ok: true` |
| LLM availability | `GET <scraper_url>/health/providers` | Each provider `configured: true` |
| Groq rate limit | Scraper logs | 429 → resets midnight UTC |
| DB connectivity | Both health endpoints | `database.status: ok` |
| Fargate task health | CloudWatch + ECS console | Task status: RUNNING |
| Twilio SMS delivery | Twilio console | Delivery failures in message log |

**Groq rate limit recovery:** Groq free tier resets daily at midnight UTC. The circuit breaker in `llm.py` applies a 3-minute cooldown on 8+ consecutive 429s, then auto-retries. With OpenAI added (Session 6), Groq rate limits no longer block all AI features.

---

## 13. Local Development

```bash
# Start API server (port 5000)
bash node-start.sh

# Start scraper engine (port 8000)
cd artifacts/TolipAI-scraper-engine && PORT=8000 bash start.sh

# Push to GitHub
bash push-github.sh
```

**Preview URL:** Set by Replit — use `$REPLIT_DEV_DOMAIN` (not localhost) for webhook testing.  
**Database:** Shared with production — use `WHERE campaign_id = <dev_campaign_id>` in all manual queries.

---

## 14. Security Notes

- All secrets are stored in Replit Secrets (dev) and Railway Environment Variables (prod).
- `SCRAPER_API_KEY` is a 32-byte hex string. Never commit it to Git.
- Twilio webhook signature validation is enforced on all `/api/twilio/*` routes.
- JWT tokens expire in 24 hours. No refresh token flow (re-login required).
- SMS opt-outs (`crm_sms_opt_outs`) are checked before every AI reply. STOP/HELP compliance fires even for unknown numbers (fixed Session 5).
- Lead auto-creation from inbound SMS (Session 6): the new lead gets `status=new` and `source=inbound_sms` — agents are notified and can qualify or discard.
