# TolipAI — Agent & Developer Guide

## Monorepo Structure

```
/
├── artifacts/
│   ├── api-server/             Express 5 + Node 22 backend (port 5000)
│   │   └── src/
│   │       ├── routes/         Thin route handlers
│   │       │   ├── crm/        CRM leads, pipeline, stats, analytics
│   │       │   ├── twilio.ts           SMS + click-to-call
│   │       │   ├── twilio-voice.ts     Outbound voice + inbound routing
│   │       │   ├── twilio-voice-agent.ts  AI inbound voice agent (OpenAI Realtime)
│   │       │   ├── twilio-power-dialer.ts Power dialer sessions
│   │       │   ├── sse.ts              Server-sent events (real-time push)
│   │       │   ├── stripe.ts           Billing / subscriptions
│   │       │   └── tools.ts            AI tools (skip trace, comps, ARV)
│   │       ├── services/       Business logic (smsService, aiSmsService, twilioCredentials, etc.)
│   │       ├── lib/            Logger, Zod validation, rate limiting
│   │       └── seed.ts         DB seeding + idempotent column migrations
│   ├── TolipAI-crm/            React + Vite CRM (base path: /crm/)
│   ├── TolipAI-website/        React + Vite marketing site (base path: /)
│   ├── TolipAI-tools/          React + Vite tools portal (base path: /tools/)
│   └── TolipAI-scraper-engine/ Python FastAPI scraper engine (port 8000)
├── lib/
│   ├── db/                     Drizzle ORM schema (PostgreSQL)
│   │   └── src/schema/crm.ts   Primary schema — crm_campaigns, crm_leads, etc.
│   ├── api-spec/               OpenAPI 3.1 spec
│   └── api-client-react/       Generated TanStack Query hooks (do not edit manually)
├── node-start.sh               Dev/prod startup script (install → build → serve)
└── replit                      Workflow configuration
```

## Database

- **Provider**: NeonDB (PostgreSQL 17) — serverless Postgres
- **ORM**: Drizzle ORM (type-safe, no migration files — uses `drizzle-kit push`)
- **Schema**: `lib/db/src/schema/crm.ts`
- **Column migrations**: `artifacts/api-server/src/seed.ts` → `ensureColumns()` runs `ALTER TABLE IF NOT EXISTS` at every startup
- **Connection**: Pool of 6–20 connections, keepAlive enabled
- **Switching DBs**: Update `DATABASE_URL` env var; run `pnpm db:push` or rely on `ensureColumns()` at first boot

## Key Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | NeonDB connection string (sslmode=require) |
| `JWT_SECRET` | ✅ | Auth token signing |
| `CRM_ADMIN_EMAIL` / `CRM_ADMIN_PASSWORD` | ✅ | Super-admin seed |
| `OPENAI_API_KEY` | 🟡 | AI voice agent + AI SMS + transcription + coaching |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | 🟡 | Global Twilio fallback (per-campaign creds preferred) |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | 🟡 | Browser Voice SDK tokens |
| `TWILIO_VOICE_APP_SID` | 🟡 | TwiML App SID for browser calling |
| `TWILIO_VOICE_CALLER_ID` | 🟡 | Global caller ID fallback |
| `API_BASE_URL` | 🟡 | e.g. `https://yourapp.railway.app/api` — used for Twilio webhooks + WS URL |
| `STRIPE_SECRET_KEY` | 🟡 | Billing |
| `ENCRYPTION_KEY` | 🟡 | AES-256 for stored secrets (auth tokens, passwords) |

## Inbound Call Flow

```
Caller → Twilio → POST /api/twilio/voice/inbound
  ├─ Campaign identified by called number / AccountSid
  ├─ Lead lookup (fromNum in crm_leads)
  ├─ Known lead → <Dial timeout=30>
  │     <Client>user_N</Client>  (each campaign user — browser dialer)
  │     <Number>forwardPhone</Number>  (campaign forward phone — rings simultaneously)
  │   action → /api/twilio/voice/inbound-no-answer
  │     ├─ OPENAI_API_KEY set → AI agent stream (gpt-4o-realtime)
  │     └─ No key → voicemail (<Record maxLength=120>)
  └─ Unknown caller → AI agent directly
```

## Twilio WebSocket / Streaming

- WebSocket upgrade handled in `artifacts/api-server/src/index.ts`
- AI agent stream at `wss://<host>/api/twilio/voice/agent-stream`
- Connects Twilio ↔ OpenAI Realtime API (gpt-4o-realtime-preview)
- Uses G.711 μ-law audio (Twilio format) ↔ OpenAI Realtime
- WebSocket close code: **1000** (normal) — never 1011 (avoids Twilio Error 31921)

## Per-Campaign Twilio Credentials

All Twilio credentials are stored per-campaign in `crm_campaigns`:
- `twilio_account_sid`, `twilio_auth_token` (AES-256 encrypted), `twilio_phone_number`
- `twilio_api_key_sid`, `twilio_api_key_secret` (encrypted), `twilio_voice_app_sid`
- `twilio_forward_phone` — personal/backup phone for simultaneous inbound ring
- `twilio_enabled` — toggle per campaign

Credentials resolved via `artifacts/api-server/src/services/twilioCredentials.ts`.

## Build & Dev

```bash
# Install all deps
pnpm install

# Build everything (API + all 3 frontends)
pnpm --filter @workspace/api-server run build:prod

# Start server (pre-built)
PORT=5000 NODE_ENV=production node --enable-source-maps artifacts/api-server/dist/index.mjs

# Dev (hot reload)
pnpm --filter @workspace/api-server run dev
```

## Deployment

- **Production**: Railway — push to `main` triggers redeploy
- **API_BASE_URL** must be set to `https://<railway-domain>/api` for Twilio webhooks to work
- **Suggested split** (future): Frontend (Vercel/Cloudflare Pages) + Backend (Railway) + Scraper (AWS Fargate)

## Adding a New Column

1. Add field to `lib/db/src/schema/crm.ts`
2. Add `ALTER TABLE <table> ADD COLUMN IF NOT EXISTS <col> <type>` to `ensureColumns()` in `seed.ts`
3. Rebuild + deploy — migration runs automatically at startup

## Console Errors to Know

- **Twilio 31921** — WebSocket close error: caused by `ws.close(1011)`. Fix: always use `ws.close(1000)`.
- **d.map is not a function** — API returned object, not array. Fix: `Array.isArray(d) ? d : d.messages ?? []`
- **onSuccess deprecated** — TanStack Query v5 removed `onSuccess` from `useQuery`. Use `useEffect` on `data` instead.
