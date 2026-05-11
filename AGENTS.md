# Digor Project Architecture

## Monorepo Structure
- `artifacts/` — runnable applications (api-server, digor-crm, digor-website, digor-tools)
- `lib/` — shared libraries (db schema, API zod types)
- `scripts/` — utility scripts

## Database
PostgreSQL (NeonDB in production, Replit built-in in dev) managed via Drizzle ORM in `lib/db`.

## Key Services
- `artifacts/api-server` — Express + Node.js backend, port 8080
- `artifacts/digor-crm` — React + Vite CRM frontend, port 3001
- `artifacts/digor-website` — React + Vite marketing site, port 3000
- `artifacts/digor-tools` — React + Vite tools dashboard, port 3002

## Environment Variables
- `DATABASE_URL` — Replit built-in Postgres (dev)
- `NEON_DATABASE_URL` — Neon production DB
- `JWT_SECRET` — auth token signing
- `AI_INTEGRATIONS_OPENAI_BASE_URL` / `AI_INTEGRATIONS_OPENAI_API_KEY` — LLM proxy
- `PROPERTY_API_KEY` — PropertyAPI.co for comps
- `ATTOM_API_KEY` — ATTOM Data for AVM and comps

## Deployment
Deployed on Railway. Push to `main` branch triggers redeploy.
