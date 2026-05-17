# TolipAI — Project Conventions

## Monorepo Structure

```
/
├── artifacts/
│   ├── api-server/          Express 5 + TypeScript REST API (PORT=5000, serves all)
│   │   └── src/
│   │       ├── routes/      Route handlers (one file per domain)
│   │       ├── services/    Business logic (twilioCredentials, smsService, etc.)
│   │       ├── lib/         logger, validate, rate-limit
│   │       └── seed.ts      DB seed + idempotent column migrations
│   ├── TolipAI-crm/         React + Vite CRM portal (base path: /crm/)
│   ├── TolipAI-website/     React + Vite marketing site (base path: /)
│   ├── TolipAI-tools/       React + Vite tools (base path: /tools/)
│   └── TolipAI-scraper-engine/  Python FastAPI scraper (PORT=8000)
├── lib/
│   ├── db/                  Drizzle ORM schema + pg client
│   └── api-client-react/    Generated TanStack Query hooks (do NOT edit)
├── node-start.sh            Build + start script
└── replit                   Workflow config
```

## API Conventions

- All CRM routes are prefixed `/api/crm/`
- All Twilio routes are prefixed `/api/twilio/`
- Auth middleware: `crmAuth` (sets `req.crmUser`), `crmAdminOnly`
- HTTP error pattern: `res.status(4xx).json({ error: "message" })` — never silent 200 with empty data
- TwiML responses: always `res.set("Content-Type", "text/xml")` first
- WebSocket closes: use code **1000** (Normal), never 1011 (Internal Error — causes Twilio Error 31921)

## Database Conventions

- ORM: Drizzle ORM, schema-first
- Schema file: `lib/db/src/schema/crm.ts`
- Adding columns: Add to schema THEN add `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` to `ensureColumns()` in `seed.ts`
- Encrypted fields: auth tokens, API secrets, passwords → AES-256 via `encryptPassword()` / `decryptPassword()`
- Indexes: added in `ensureIndexes()` in `seed.ts`
- Never use raw SQL outside of seed migrations and special aggregations

## TypeScript Conventions

- No `any` in service/model code; `any` is acceptable in thin route handlers for request body
- All DB queries typed via Drizzle's inferred types
- Zod for body validation in critical endpoints (`validateBody(schema)`)
- Logger: always use `logger.info/warn/error` (pino), never `console.log` in production code
- Error handling: catch at route level, log with context, return structured error JSON

## React / Frontend Conventions

- State management: TanStack Query (server state) + React useState (local UI)
- `useQuery` options: **do not use `onSuccess`** (deprecated in v5) — use `useEffect(() => {...}, [data])` instead
- `apiFetch` throws on non-2xx responses — all errors are caught by React Query's `isError`
- Components: functional only, no class components
- Defensive array rendering: always `Array.isArray(data) ? data : data?.items ?? []` before `.map()`
- Tailwind v3: avoid `in-` selector variants (not supported); use standard group/peer selectors

## Twilio Conventions

- Per-campaign credentials: always use `resolveSmsCreds()` / `resolveVoiceConfig()` — never hardcode account SID
- TwiML: valid XML with `<?xml version="1.0" encoding="UTF-8"?>` header
- Inbound calls: `<Dial>` with `<Client>` tags for browser + `<Number>` for forward phone; fallback to voicemail when no AI key
- WebSocket handler: check `OPENAI_API_KEY` at start; close gracefully with code 1000 if unavailable
- Webhook URLs: built from `API_BASE_URL` env var (never `req.headers.host` alone in production)

## Security Conventions

- JWT tokens in `Authorization: Bearer` header or `?token=` query param (SSE only)
- Sensitive data encrypted at rest (AES-256-CBC, key from `ENCRYPTION_KEY` env var)
- Super-admin routes protected by role check in middleware
- No secrets in logs — log masked versions only
- XSS: escape all user data in TwiML `<Say>` and HTML templates

## File Naming

- Route files: `kebab-case.ts` in `artifacts/api-server/src/routes/`
- React components: `PascalCase.tsx`
- Services: `camelCase.ts`
- DB schema: grouped by domain in `lib/db/src/schema/`

## Startup Order

1. `ensureIndexes()` — creates DB indexes if missing
2. `ensureColumns()` — idempotent `ALTER TABLE IF NOT EXISTS` for new columns
3. `seedDatabase()` — creates super-admin users if env vars set
4. HTTP server + WebSocket upgrade handler start on PORT=5000

## Infrastructure Notes (Current)

- **Dev/Preview**: Replit — workflow runs pre-built server directly
- **Production**: Railway — single dyno serves API + all 3 frontends
- **DB**: NeonDB (serverless Postgres 17) — free tier has 100 CU-hour/month limit
- **Recommended split** (future): Vercel/Cloudflare Pages for frontends, Railway for API, AWS Fargate for scraper engine

## Last Updated: S22 — May 17, 2026
