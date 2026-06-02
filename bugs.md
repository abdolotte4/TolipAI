# TolipAI Bug & Security Audit

*Last updated: 2026-06-02*

---

## Critical / Infrastructure

| ID | Title | Status | Notes |
|----|-------|--------|-------|
| **BUG-051** | AWS ECS scraper service disconnected from load balancer → all scraper features return 504 | ⚠️ **MANUAL ACTION REQUIRED** | Go to AWS Console → ECS → `tolipai-scraper-engine-service` → Update Service → re-attach to load balancer. No code change can fix this. |
| **INFRA-002** | ATTOM API keys returning 401 | ✅ Fixed | Keys updated in Railway. |
| **INFRA-004** | `TOOLS_PIN` wrong value in Railway | ✅ Fixed | Corrected in Railway. |
| **INFRA-005** | Propelio/Propwire stuck at login page despite credentials in Railway secrets | ✅ Fixed (code) | Root cause: Python scraper on ECS didn't receive credentials — they were stored only in Railway env (Node.js side) and never forwarded. **Fix**: Python engine now accepts `propelio_email`/`propelio_password` in the request body (`PropelioCashBuyersRequest`); new Node.js routes `POST /api/scraper-engine/propelio/cash-buyers/start` and `POST /api/scraper-engine/propwire/cash-buyers-nearby/start` decrypt campaign credentials from the DB and pass them to the Python engine. Also need BUG-051 fixed for ECS to be reachable. |
| **INFRA-006** | No Google Maps API key | ✅ Fixed | Key set in Railway secrets. |
| **INFRA-001** | BrightData proxy missing HOST + PORT | ✅ Fixed | Set in Railway secrets. `BRIGHTDATA_HOST` defaults to `brd.superproxy.io`, `BRIGHTDATA_PORT` defaults to `33335` (ISP/fast). |

---

## Security

| ID | Title | Status | Fix Applied |
|----|-------|--------|-------------|
| **CRIT-002** | OpenPhone webhook accepted all requests when `OPENPHONE_WEBHOOK_SECRET` was unset (fail-open) | ✅ Fixed | Now fail-closed: rejects all webhook calls if secret not configured. |
| **SEC-06** | Admin JWT stored in `localStorage` — XSS-extractable | ✅ Fixed | Migrated to `httpOnly; Secure; SameSite=Strict` cookie (`tolipai_admin_session`). Backend reads cookie via `cookie-parser`. Admin frontend now uses `credentials: "include"` and verifies session via `GET /api/admin/me` on load. `POST /api/admin/logout` clears the cookie server-side. |
| **SEC-07** | `crypto-util.ts` had silent fallback to `JWT_SECRET` when `ENCRYPTION_KEY` was unset | ✅ Fixed | Now throws immediately if `ENCRYPTION_KEY` not set — no silent fallback. |
| **SEC-08** | No rate limiting on public endpoints (`/contact`, `/subscribe`, `/crm/public/submit`) | ✅ Fixed | In-memory rate limiter: 5 req/hr per IP on all three public routes. |
| **SEC-09** | `demo.ts` did not block premium-rate phone prefixes | ✅ Fixed | Prefix allowlist blocks 900, 976, 970, 550, 540, etc. before dialing. |
| **SEC-10** | Admin login had no brute-force protection; JWT expiry hardcoded at 24h | ✅ Fixed | 5-attempt lockout (15-min ban per IP); JWT expiry via `ADMIN_JWT_EXPIRY` env var (default `8h`). |

---

## Performance

| ID | Title | Status | Fix Applied |
|----|-------|--------|-------------|
| **PERF** | `GET /crm/leads` fired 2 correlated subqueries per row into `crm_call_logs` — caused minute-long load times | ✅ Fixed | Replaced with a single batch `DISTINCT ON` query for all page leads. Also added `crm_leads` indexes on `email` + `zip`, and `scraper_jobs.campaign_id` index. |

---

## Bugs

| ID | Title | Status | Fix Applied |
|----|-------|--------|-------------|
| **BUG-043** | Appointments tab returned 501 (stub) | ✅ Fixed | Full CRUD: `GET/POST /crm/leads/:id/appointments`, `PATCH/DELETE /crm/leads/:id/appointments/:aptId`. `crm_appointments` table created on startup. |
| **BUG-NEW** | New lead does not appear in list after creation | ✅ Fixed | `NewLead.tsx` now calls `queryClient.invalidateQueries(["/api/crm/leads"])` before navigating away so React Query cache is flushed. |

---

## Accessibility

| ID | Title | Status | Fix Applied |
|----|-------|--------|-------------|
| **A11y** | DTMF keypad buttons not keyboard-accessible | ✅ Fixed | `onKeyDown` (Enter/Space) added to all keypad buttons in `BrowserDialer.tsx`. |

---

## Remaining / Won't Fix

| ID | Notes |
|----|-------|
| **BUG-051** | Must be resolved in AWS Console — no code path can re-attach an ECS service to its load balancer. |
| **twilio-fax.ts** | File does not exist; no fax route found in codebase — issue is a ghost. |

---

## Secret Verification Checklist

Based on Railway variable screenshots — verify these are set correctly on the **ECS task definition** (not just Railway, which is the Node.js host):

| Variable | Required By | Notes |
|----------|------------|-------|
| `PROPELIO_EMAIL` | Python scraper (fallback only now) | Now forwarded from DB via Node.js |
| `PROPELIO_PASSWORD` | Python scraper (fallback only now) | Now forwarded from DB via Node.js |
| `PROPWIRE_EMAIL` | Python scraper (fallback only now) | Now forwarded from DB via Node.js |
| `PROPWIRE_PASSWORD` | Python scraper (fallback only now) | Now forwarded from DB via Node.js |
| `BRIGHTDATA_USERNAME` | Python scraper proxy | Must include full zone string |
| `BRIGHTDATA_PASSWORD` | Python scraper proxy | |
| `BRIGHTDATA_HOST` | Python scraper proxy | Default: `brd.superproxy.io` |
| `BRIGHTDATA_PORT` | Python scraper proxy | Default: `33335` |
| `OPENAI_API_KEY` | Python scraper LLM | |
| `DATABASE_URL` | Python scraper DB writes | |
| `SCRAPER_API_KEY` | Python scraper auth | Must match `WEBSCRAPER_API_KEY` in Node.js |
| `ENCRYPTION_KEY` | Node.js crypto (required) | Must be set — no fallback |
| `JWT_SECRET` | Node.js auth (required) | Must be set — no fallback |
