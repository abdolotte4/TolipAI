# TolipAI Platform — Codebase Audit
**Version:** 2.1.0
**Audit Date:** May 22, 2026
**Auditor:** Agent Full-Scan (6 parallel subagents — exhaustive line-by-line)
**Previous Audit:** May 17, 2026 (v2.0.0, score 95/100)
**Total files scanned:** ~200 TypeScript/TSX + shared schema + config
**Overall Score:** 95/100 (maintained — new features shipped; new issues identified and catalogued)

---

## Table of Contents
1. [Architectural Map](#1-architectural-map)
2. [Code Quality Scan — API Server](#2-code-quality-scan--api-server)
3. [Code Quality Scan — CRM Frontend](#3-code-quality-scan--crm-frontend)
4. [Code Quality Scan — TolipAI-website](#4-code-quality-scan--tolipai-website)
5. [Code Quality Scan — TolipAI-tools](#5-code-quality-scan--tolipai-tools)
6. [Code Quality Scan — Scraper Engine](#6-code-quality-scan--scraper-engine)
7. [Code Quality Scan — Shared Libs (lib/)](#7-code-quality-scan--shared-libs-lib)
8. [Cross-Cutting Issues](#8-cross-cutting-issues)
9. [Action Plan](#9-action-plan)

---

## 1. Architectural Map

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Railway (Production)                            │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │               api-server (Express 5, Node 22, port 5000)        │   │
│  │  Serves 3 static SPAs from dist/:                               │   │
│  │    /         → TolipAI-website (Vite build)                    │   │
│  │    /crm      → TolipAI-crm (Vite build)                       │   │
│  │    /tools    → TolipAI-tools (Vite build)                      │   │
│  │                                                                  │   │
│  │  API Routes:                                                     │   │
│  │    /health                → health.ts                           │   │
│  │    /contact               → contact.ts                          │   │
│  │    /subscribe             → subscribe.ts                        │   │
│  │    /admin/*               → admin.ts                            │   │
│  │    /api/crm/*             → crm/index.ts (sub-router)          │   │
│  │    /api/tools/*           → tools.ts                            │   │
│  │    /api/stripe/*          → stripe.ts                           │   │
│  │    /api/scraper/*         → scraper.ts (legacy tools scraper)  │   │
│  │    /api/scraper-engine/*  → scraperEngine.ts (proxy to Python) │   │
│  │    /api/twilio/*          → twilio.ts (SMS/webhooks)           │   │
│  │    /api/twilio/voice/*    → twilio-voice.ts (browser dialer)   │   │
│  │    /api/twilio/voice/     → twilio-power-dialer.ts (AMD dialer)│   │
│  │      power-dial/*                                               │   │
│  │    /api/twilio/voice/     → twilio-voice-agent.ts (AI agent)  │   │
│  │      inbound-agent                                               │   │
│  │    /api/twilio/fax/*      → twilio-fax.ts (Programmable Fax)  │   │
│  │    /api/openphone/*       → openphone.ts (OpenPhone webhook)   │   │
│  │    /crm/events            → sse.ts (Server-Sent Events)        │   │
│  │    /demo/*                → demo.ts (public AI demo call)      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────┐   ┌──────────────────────────────────┐   │
│  │  scraper-engine          │   │  Neon PostgreSQL (serverless)    │   │
│  │  Python 3.12 / FastAPI   │   │  Drizzle ORM (shared schema)    │   │
│  │  Cash buyers, G-Maps,    │   │  20+ tables, ~45 indexes        │   │
│  │  Zillow, NAR, Propwire   │   │  lib/db/src/schema/crm.ts       │   │
│  └──────────────────────────┘   └──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22, Python 3.12 |
| HTTP Framework | Express 5 (api-server), FastAPI (scraper) |
| Database ORM | Drizzle ORM + Neon PostgreSQL (serverless) |
| Frontend | React 18, Vite 7, Tailwind v4, Shadcn/UI, Framer Motion |
| State Management | TanStack Query v5, React Context |
| Real-time | Server-Sent Events (SSE) on `/crm/events` |
| Telephony | Twilio Voice SDK (browser + server), Twilio Programmable Fax |
| AI / LLM | OpenAI GPT-4o, Groq llama-3.1-70b (via `aiConfig.ts`) |
| Auth | JWT (7d expiry), bcrypt-12 |
| Encryption | AES-256-GCM (`crypto-util.ts`) — campaign Twilio credentials |
| Package Manager | pnpm workspaces |
| Deployment | Railway (Railpack), 10 restart retries |

### Session Changelog (since last audit May 17, 2026)

| Session | Feature/Fix |
|---|---|
| S22-a | Call scoring emoji column on `LeadList.tsx` — displays `lastMotivationScore` / `lastMotivationLabel` persisted to DB |
| S22-b | AMD predictive power dialer — `amd-handler` webhook, DB row-locking, `MANUAL_DIALER_PLAN.md`, `Twiliofix.md` |
| S22-c | Dual-speaker live transcript panel added to `BrowserDialer.tsx` (827 → 865 LOC) |
| S22-d | `conversations` endpoint rewritten to union `crm_call_logs` + `crm_openphone_messages` into single sorted feed |
| S22-e | `startCall` signature bug fixed in `PhoneNumbers.tsx` — was passing wrong argument type |
| S22-f | `twilioWebhookMiddleware.ts` created (new lib file) — Twilio request signature validation |
| S22-g | `Conversation` type updated in `PhoneNumbers.tsx` to accommodate call+SMS union shape |
| S22-h | `lastMotivationScore` / `lastMotivationLabel` columns added to `crm_leads` schema |
| S22-i | PapaParse integrated in CRM for more robust CSV parsing (replaces custom regex parser in `BulkImportModal`) |
| S23-a | **Phase 2.2 Unread badges** — `crm_phone_read_receipts` table (schema + startup migration), `unreadCount` in conversations API, `POST .../read` endpoint, amber badge + bold contact name in `ConversationItem` |
| S23-b | **requirements.txt** — relaxed `openai` and `httpx` pins to semver ranges so `crawl4ai` transitive deps can resolve |
| S23-c | **infrastructure/FARGATE_MIGRATION.md** — complete step-by-step AWS Fargate Spot deployment guide for scraper engine |

---

## 2. Code Quality Scan — API Server

**Root:** `artifacts/api-server/src/`

### 2.1 Entry & App Bootstrap

| File | LOC | Status | Issues |
|---|---|---|---|
| `index.ts` | 191 | Active | ✅ BUG-BOOT-01 fixed. Now runs `crm_phone_read_receipts` + `crm_waitlist` idempotent migrations before listen. |
| `app.ts` | 256 | Active | Helmet CSP well-configured for Twilio/OpenAI origins. CORS uses regex allowlist (hardcoded in file). |
| `seed.ts` | 186 | Active | bcrypt rounds=12. Reads `CRM_ADMIN_PASSWORD` env. |
| `seed-demo.ts` | 612 | Active | Parallel `db.insert` loops in demo data (not batched). |
| `express.d.ts` | 9 | Active | Adds `crmUser` to `Express.Request`. |

### 2.2 Route Files — Twilio / Voice

| File | LOC | Endpoints | Issues |
|---|---|---|---|
| `routes/twilio.ts` | 1364 | GET/POST `/twilio/config` · GET `/twilio/phone-numbers` · GET `/twilio/messages` · GET `/twilio/lead-messages/:leadId` · POST `/twilio/messages` · GET `/twilio/calls` · POST `/twilio/click-to-call` · GET `/twilio/twiml/call` · POST `/twilio/webhook` · POST `/twilio/setup-webhooks` · GET `/twilio/setup-guide` · **GET `/twilio/conversations`** *(NEW — unions call_logs + openphone_messages)* | **PERF-02** (pre-existing, unresolved): Full `crmLeads` table scan at line 521 for phone reverse-lookup. `dbFallback`/`tryFetchWithAnyCampaignCreds` loops with many small queries. `as any` casts in error handling. |
| `routes/twilio-voice.ts` | 1636 | POST `/twilio/voice/token` · `/voice/answer` · `/voice/join-conference` · `/voice/conference-status` · `/voice/call-status` · `/voice/recording` · `/voice/hold` · `/voice/ai-suggestion` · `/voice/transcribe` · `/voice/disposition` | `safeInsertCallLog` workaround for broken DB sequences. `/voice/answer` is public (AccountSid validated only — Twilio-controlled). Heavy `as any` in transcript handlers. |
| `routes/twilio-power-dialer.ts` | 783 | POST `/voice/power-dial/session` · GET `…/session/:id` · POST `…/session/:id/call` · POST `…/session/:id/disposition` · DELETE `…/session/:id` · POST `/voice/power-dial/call-status` · **POST `/voice/power-dial/amd-handler`** *(NEW)* | N+1: `batchLeads` then individual `db.insert(crmCallLogs)` in loop (line 366). `filters` array/string validation is loose. DB row-locking for AMD concurrency is correct. |
| `routes/twilio-voice-agent.ts` | 655 | POST `/twilio/voice/inbound-agent` · GET `/twilio/voice/agent-sessions` | `/inbound-agent` is public. Static system prompt (no prompt injection risk currently). `as any` on OpenAI tool-call JSON parsing (lines 333, 372). |
| `routes/twilio-fax.ts` | 252 | POST `/twilio/fax/inbound` · POST `/twilio/fax/send` | **SEC-03 HIGH**: `/fax/inbound` has **no Twilio signature verification** — anyone can POST fake `FaxSid` to insert records. `slice(-10)` phone matching can collide across international numbers. |

### 2.3 Route Files — CRM Core

| File | LOC | Endpoints | Issues |
|---|---|---|---|
| `routes/crm/leads.ts` | 2582 | GET/POST `/` · GET `/export` · POST `/bulk-import` · POST `/bulk-status` · GET/PATCH/DELETE `/:id` · POST `/:id/notes` · GET `/:id/notes` · DELETE `/:id/notes/:noteId` · POST `/:id/fetch-data` · `/:id/skip-trace` · `/:id/estimate` · `/:id/follow` · DELETE `/:id/follow` | **PERF-03**: `bulk-import` inserts one row at a time (line 474) — should be `db.insert().values([...])`. `notifyFollowers` queries then inserts. |
| `routes/crm/auth.ts` | 98 | POST `/auth/login` · GET `/me` | JWT 7d expiry. Minimal `as any`. Clean. |
| `routes/crm/middleware.ts` | 64 | (Internal) | `getJwtSecret` throws if missing/short — correct safeguard. |
| `routes/crm/analytics.ts` | 507 | GET `/dashboard` · `/calls` · `/call-quality` · `/campaigns` | `Promise.allSettled` runs multiple complex `db.execute(sql...)` blocks. Heavy `as any` in SQL result mapping (lines 114, 119, 253, 387, 489). |
| `routes/crm/billing.ts` | 131 | POST `/portal` · GET `/subscription` | Error message at line 49 exposes internal email. `price as any`. |
| `routes/crm/buyers.ts` | 198 | GET/POST `/` · POST `/upload` · DELETE `/:id` | Manual `parseCsvLine` (line 16) may fail on complex quoted/escaped CSVs — should use `csv-parse`. Batch-100 insert (better than 1×1 but still multiple round-trips). |
| `routes/crm/campaigns.ts` | 301 | GET/POST `/` · PATCH/DELETE `/:id` | **PERF-04**: Per-campaign `count(*)` in GET `/` list (line 59) — N+1. Super-admin deletion uses `timingSafeEqual` (correct). |
| `routes/crm/comps.ts` | 192 | GET/POST `/:leadId/comps` · DELETE `/:leadId/comps/:compId` · POST `/:leadId/comps/recalculate` | `recalculate` updates every comp in a loop (line 157). `formatComp(c: any)`. |
| `routes/crm/contracts.ts` | 622 | POST/GET `/` · GET/POST `/:id` · POST `/:id/void` · `/:id/resend` · GET/POST `/public/sign/:token` | Public signing link protected by 24-byte hex token only. Dropbox Sign response as `any`. |
| `routes/crm/index.ts` | 193 | GET/POST `/crm/public/submit/:token` · POST `/crm/public/waitlist` · POST `/crm/waitlist` | No rate limiting or CAPTCHA on public lead submit. `parseAddressComponents` regex may fail on non-standard US addresses. |
| `routes/crm/notifications.ts` | 61 | GET `/` · POST `/:id/read` · POST `/read-all` | Notification ID parsing (line 37) lacks error handling if non-numeric. |
| `routes/crm/sequences.ts` | 484 | GET/POST `/` · PATCH/DELETE `/:id` · POST `/:id/steps` · PATCH/DELETE `/:id/steps/:stepId` · GET `/logs/:leadId` · POST/GET `/sms-opt-out` | N+1: `runEmailSequenceJob` (line 266) runs many individual DB checks inside nested loops. Semaphore may be redundant with Brevo rate limiting. |
| `routes/crm/stats.ts` | 82 | GET `/` | 9 separate count queries in `Promise.all`. `leadConditions: any[]`. |
| `routes/crm/tasks.ts` | 125 | GET/POST/PATCH/DELETE | `dueDate` not validated before `new Date()`. `formatTask(t: any)`. |
| `routes/crm/users.ts` | 298 | GET/POST `/` · PATCH/DELETE `/:id` · GET `/:id/password` | **SEC-01 CRITICAL**: `GET /:id/password` returns `password_plain` from DB — plaintext password retrieval via authenticated endpoint. Must be removed. |
| `routes/crm/links.ts` | 101 | GET/POST/PATCH/DELETE | `PUBLIC_URL` required. `existing as any`. |
| `routes/crm/waitlist.ts` | 218 | GET `/` · GET `/chart` · GET `/export` · PATCH `/:id` · DELETE `/:id` | **INCONSISTENCY**: Uses raw `pool.query` (line 55) instead of Drizzle ORM — sole file in codebase doing this. |

### 2.4 Route Files — Other

| File | LOC | Endpoints | Issues |
|---|---|---|---|
| `routes/admin.ts` | 127 | POST `/admin/login` · GET `/admin/contacts` · PATCH `/admin/contacts/:id/read` · GET `/admin/subscribers` · GET `/admin/stats` | JWT hardcoded `24h`. No rate limiting on login. Simple string comparison (minor timing risk). |
| `routes/contact.ts` | 97 | POST `/contact` | No rate limiting/CAPTCHA — SMTP flood risk. DB failure continues to email send. |
| `routes/demo.ts` | 150 | POST `/demo/call` · GET `/demo/twiml` · POST `/demo/twiml-status` | Custom in-memory rate limiter (2/hr). No premium-rate phone check (toll fraud risk). |
| `routes/health.ts` | 27 | GET `/healthz` · GET `/health` | Standard. No issues. |
| `routes/index.ts` | 38 | Router mount | No issues. |
| `routes/openphone.ts` | 257 | GET `/openphone/phone-numbers` · GET `/openphone/messages` · POST `/openphone/webhook` | **SEC-02 HIGH**: `/openphone/webhook` has **no signature verification** — anyone can spoof inbound SMS events. N+1: queries `crmUsers` per inbound SMS (lines 235–250). |
| `routes/scraperEngine.ts` | 503 | GET/POST `/scraper-engine/integrations/*` · GET `/scraper-engine/buyers` · ALL `/scraper-engine/{*path}` | **BUG**: `_buyerLeadIds` → `inArray` will fail if campaign >32k leads (Postgres param limit). `decryptPassword` imported but usage unclear. |
| `routes/scraper.ts` | 841 | POST `/scraper/google-maps` · `/google-search` · `/nar-directory` · `/zillow` | `exhaustedKeys` global Set never cleared until restart. `PHONE_REGEX` misses some international formats. |
| `routes/sse.ts` | 81 | GET `/crm/events` | **SEC-04 MEDIUM**: JWT in URL query param — captured in access logs. `setMaxListeners(500)` — listener pile-up risk if `close` events mis-fire. |
| `routes/stripe.ts` | 346 | POST `/stripe/checkout` · POST `/stripe/webhook` | Hardcoded Stripe price IDs (lines 33–35). Webhook signature verification: **CORRECT**. Auto-provisioning doesn't check for duplicate campaigns. |
| `routes/subscribe.ts` | 81 | POST `/subscribe` | No rate limiting. Silent DB failure then continues to email. |
| `routes/tools.ts` | 1249 | POST `/tools/arv/calculate` · POST `/tools/skip-trace/upload` | `enrichJobs` + `_attomDistressedJobs` in-memory — lost on restart. `requirePin` allows PIN in header or body. |

### 2.5 Services

| File | LOC | Purpose | Issues |
|---|---|---|---|
| `services/aiConfig.ts` | 253 | OpenAI/Groq provider resolver | `as any` for JSON response casting. `AbortSignal.timeout` used correctly. |
| `services/aiSmsService.ts` | 184 | AI SMS reply + circuit breaker | `AI_SMS_COST_USD` hardcoded. Personality prompts hardcoded. |
| `services/attomApi.ts` | 505 | ATTOM real estate data | **RACE**: `_attomKeyIndex` global mutable — concurrent requests may skip/collide on key rotation. `TWO_YEARS_AGO` hardcoded. |
| `services/automation.ts` | 324 | Onboarding sequences, reminders | **BUG-AUTO-01**: `runOnboardingEmailCron` splices `onboardingQueue` during iteration (line 52) — skips items if multiple due at same tick. Fire-and-forget `sendEmail` (no `await`). `onboardingQueue` in-memory: **lost on restart**. |
| `services/coreCalculations.ts` | 56 | MAO/ARV math, E.164 | Re-exports from `propertyApi`. `parseMoney` may fail if value is object. |
| `services/directMailService.ts` | 140 | Postcard via Brevo SMTP | `DIRECT_MAIL_COST_USD = 1.0` hardcoded. `messageId` returned without existence check. |
| `services/emailService.ts` | 261 | Transactional email via Brevo | `buildWelcomeOnboardingEmail` potentially dead code. Fire-and-forget from `automation.ts`. |
| `services/propertyApi.ts` | 1104 | PropertyAPI.co + PeopleDataLabs | **MEM-01 CRITICAL**: 4 global `Map`s (`skipTraceMap`, `fetchCompsMap`, `leadFetchMap`, `campaignFetchMap`) grow indefinitely — never pruned. Linear memory leak with codebase usage. |
| `services/rentcastApi.ts` | 41 | Rentcast AVM | Broad `try { } catch { return null }` — swallows all errors silently. |
| `services/scraperEngineClient.ts` | 395 | Python scraper HTTP client | `DEFAULT_TIMEOUT_MS = 60_000` hardcoded. Extensive `any` for job results. |
| `services/smsService.ts` | 122 | SMS send + segment cost tracking | `SMS_COST_PER_SEGMENT = 0.0079` hardcoded. |
| `services/twilioCredentials.ts` | 192 | AES-256 credential decryption | If `JWT_SECRET` rotates, old AES-encrypted tokens in DB become unrecoverable. |

### 2.6 Libraries

| File | LOC | Purpose | Issues |
|---|---|---|---|
| `lib/auditLog.ts` | 57 | DB-backed immutable audit trail | DB failures logged-and-swallowed (intentional, but hides infra issues). |
| `lib/backgroundJobStore.ts` | 99 | Async job persistence | `pruneExpiredJobs` cancels "running" but not "queued" jobs. Payload/result cast `as any`. |
| `lib/logger.ts` | 20 | Pino logger | Correct: redacts `Authorization` + `Cookie`. |
| `lib/textUtils.ts` | 24 | Markdown/CSV utils | `csvCell` defined but unused in audited services (dead code candidate). |
| `lib/twilioWebhookMiddleware.ts` | 46 | **NEW** Twilio request signature validation | **SEC-05 MEDIUM**: If `TWILIO_AUTH_TOKEN` env missing, validation is **skipped entirely** with a warning — soft-fail is dangerous in production misconfiguration. |
| `lib/validate.ts` | 81 | Zod request validation middleware | `(req as any).validatedQuery` bypasses TS types. SMS body max 1600 hardcoded. |
| `lib/webhookBase.ts` | 27 | Webhook URL resolver | `localhost:8080` fallback at line 25 — dangerous if `PUBLIC_URL` env missing in production. |

---

## 3. Code Quality Scan — CRM Frontend

**Root:** `artifacts/TolipAI-crm/src/`

### 3.1 App Shell

| File | LOC | Notes |
|---|---|---|
| `App.tsx` | 121 | Correct wrap order: `QueryClientProvider` → `TooltipProvider` → `PhoneProvider` → `ErrorBoundary`. |
| `main.tsx` | ~30 | Service worker scoped to `/crm/`. Standard Vite entry. |

### 3.2 Pages

| File | LOC | Purpose | Issues |
|---|---|---|---|
| `pages/leads/LeadDetail.tsx` | 1837 | Lead profile — all detail tabs | Largest single page. No local `<ErrorBoundary>`. A crash here unmounts entire layout. |
| `pages/leads/LeadList.tsx` | 513 | Filterable lead grid | **NEW**: Call-scoring emoji column added (`lastMotivationScore` / `lastMotivationLabel`). |
| `pages/leads/NewLead.tsx` | 340 | Lead creation form | Clean. |
| `pages/dialer/PowerDialer.tsx` | 1273 | AMD predictive dialer UI | **NEW S22**: AMD handler integration, session management. |
| `pages/campaigns/CampaignList.tsx` | 853 | Campaign admin | Mixed `apiFetch` + raw `fetch`. Password visibility toggle lacks `aria-label`. |
| `pages/admin/UserList.tsx` | 880 | User management | Presumably surfaces `password_plain` from `SEC-01` backend endpoint. |
| `pages/admin/WaitlistAdmin.tsx` | 804 | Landing signup admin | Hardcoded `/admin/waitlist` path (missing `/api` prefix). `selectedIds` stale closure in bulk ops. Direct `localStorage.getItem("crm_token")`. |
| `pages/analytics/Dashboard.tsx` | 569 | KPI dashboard | Clean. |
| `pages/analytics/CallReport.tsx` | 299 | Call analytics table | Clean. |
| `pages/analytics/CallQualityDashboard.tsx` | 531 | MOS + quality metrics | Clean. |
| `pages/integrations/PhoneNumbers.tsx` | 865 | Conversations + dialer | **NEW**: `Conversation` type updated (union calls+SMS). `startCall` bug fixed. **MEM-02**: `MiniPlayer` audio element not paused or `URL.revokeObjectURL`'d on unmount. `handleSelectNumber` may race with `isFetching`. |
| `pages/integrations/TwilioConnect.tsx` | 733 | Twilio credential management | Hardcoded `/twilio/config` without `/api` prefix in several spots. `ApiKeySecret` held in component state. Direct `localStorage.getItem("crm_token")`. |
| `pages/integrations/IntegrationsDashboard.tsx` | 101 | Integration status overview | Hardcoded `/scraper-engine` paths. No "Refresh All" button. |
| `pages/buyers/BuyersList.tsx` | 334 | Cash buyer contacts | `confirm()` for delete. `handleFileRead` sets state without mount check. |
| `pages/buyers/CashBuyersAll.tsx` | ~550 | All buyers — super admin | Inconsistent API path helper vs `apiFetch`. Filter buttons lack `aria-label`. |
| `pages/leadgen/DistressedLeadGen.tsx` | 160 | Distressed property scraper UI | Poll loop (line 78) lacks exponential backoff and error limit. `fetch` inside interval has no `AbortController`. |
| `pages/pipeline/Pipeline.tsx` | 374 | Kanban deal pipeline | Clean. |
| `pages/public/SignContract.tsx` | 232 | External e-sign page | Hardcoded `/api/crm/contracts/public/sign/`. `aria-required` missing on signature input. |

### 3.3 Components

| File | LOC | Purpose | Issues |
|---|---|---|---|
| `components/leads/BrowserDialer.tsx` | 865 | **UPDATED**: Browser dialer + **dual-speaker live transcript** panel | **BUG-BD-01**: `coachingTimerRef` not cleared on unmount — stale state update risk. **BUG-BD-02**: `checkSid` interval should also be cleared on unmount. `startCall` callback recreated on every `phone` prop change. DTMF buttons lack `onKeyDown` (a11y). |
| `components/leads/AiDealScorer.tsx` | 127 | AI lead scoring | **NEW**: `lastMotivationScore`/`lastMotivationLabel` persisted to DB. Successive `handleScore` calls not aborted (`AbortController` missing — race). |
| `components/leads/AiOfferLetter.tsx` | 71 | AI offer letter generator | Multiple generate clicks not aborted. |
| `components/leads/AiRepairEstimator.tsx` | 122 | AI repair cost estimator | Table header contrast may fail WCAG AA on dark backgrounds. |
| `components/leads/AiSellerScript.tsx` | 102 | AI phone script generator | Clean. Safe optional field handling. |
| `components/leads/BulkImportModal.tsx` | 378 | CSV batch lead importer | **NEW**: PapaParse integrated (replaces custom regex parser). No "Cancel" button during active import request. |
| `components/leads/CashBuyerMatchPanel.tsx` | 536 | Cash buyer job poller | `refreshList` recreated on every render (should be `useCallback`). Old poll interval may fire one tick after `leadId` change. ScoreRing SVG lacks ARIA label. |
| `components/leads/CompsSection.tsx` | 659 | Comps + AVM analysis | `compsPolling` interval correctly cleared on unmount. Prop-drilling `lead` may lag on external changes. |
| `components/leads/ContractsCard.tsx` | 402 | E-sign contract manager | Clean `react-query` integration. |
| `components/leads/SmsConversations.tsx` | 275 | SMS chat UI | `selectedFrom` auto-selection only runs on initial load — not re-validated if available numbers change. |
| `components/phone/ActiveCallBar.tsx` | 269 | **UPDATED**: Persistent call control bar | `setShowTranscript(true)` fires on every segment (harmless but redundant). Strong UX — pulse on new AI suggestion. |
| `components/phone/IncomingCallPopup.tsx` | 68 | Incoming call notification | Stateless-driven. Clean. |
| `components/layout/AppLayout.tsx` | 119 | Nav wrapper + SSE | Notification permission request not cleaned on unmount. `sseLeadDelta` not reset on SSE close. |
| `ErrorBoundary.tsx` | 71 | Global React error boundary | Sentry integration. "Try again" + "Go to Dashboard". No **local** boundaries on `BrowserDialer`, `CompsSection`, `LeadDetail`. |

### 3.4 Contexts

| File | LOC | Purpose | Issues |
|---|---|---|---|
| `contexts/PhoneContext.tsx` | 661 | Twilio Device + call session state | **MEM-03**: Old `AudioContext` not closed when `initDevice` called multiple times. `acceptIncoming` (L425) captures `leadId` — `pendingAcceptLeadIdRef` may be overwritten by rapid SSEs. `speechRecognitionRef.onend` may restart after `abort()` fires on unmount. |

### 3.5 Hooks & Lib

| File | Notes |
|---|---|
| `hooks/use-theme.ts` | localStorage/classList toggle. No bugs. |
| `hooks/use-toast.ts` | `TOAST_REMOVE_DELAY = 1_000_000ms` — effectively disables auto-removal. |
| `hooks/use-campaign-governance.ts` | Role-based access control. Clean. |
| `hooks/use-mobile.tsx` | `matchMedia` with correct cleanup. |
| `lib/api.ts` | Auth header injection. 401 → redirect to `/login`. |
| `lib/api-setup.ts` | Global fetch interceptor for all `/api/` calls. Correct scope. |
| `lib/utils.ts` | `clsx` wrapper. |

---

## 4. Code Quality Scan — TolipAI-website

**Root:** `artifacts/TolipAI-website/src/`

| File | LOC | Notes |
|---|---|---|
| `App.tsx` | 82 | WordPress query param redirect (security hardening). |
| `Admin.tsx` | 426 | **SEC-06 MEDIUM**: JWT stored in `localStorage` — XSS-extractable. |
| `Home.tsx` | 42 | Component-based landing page. Clean. |
| `CheckoutSuccess.tsx` | 78 | Fetches session data via Stripe `session_id` query param. |
| `ChatBot.tsx` | 203 | Keyword-based bot. Hardcoded phone `(555) 201-4892` and email. |
| `SubscribeModal.tsx` | 310 | Hardcoded Stripe price IDs — difficult to change without redeploy. |
| `Terms.tsx` | 218 | Hardcoded address and contact details. |

---

## 5. Code Quality Scan — TolipAI-tools

**Root:** `artifacts/TolipAI-tools/src/`

| File | LOC | Notes |
|---|---|---|
| `App.tsx` | 200 | `wouter` for light routing. PWA install prompt. |
| `AiDistressed.tsx` | 102 | Hardcoded `/api/tools/distressed/*` endpoints. |
| `Arv.tsx` | 318 | `STREET_SUFFIXES` fixed set — may miss rare suffixes. |
| `Distressed.tsx` | 452 | Auth via `X-Tools-Pin` header (low-security mechanism). |
| `LeadScraper.tsx` | 1213 | Large hardcoded state/metro arrays (bundle size impact). |
| `Login.tsx` | 102 | PIN entry — no frontend rate limiting. |
| `PhoneFinder.tsx` | 359 | `xlsx` parser — large bundle contribution. |
| `PropertyLookup.tsx` | 380 | `STREET_SUFFIXES` **duplicated** from `Arv.tsx` (dead code / refactor opportunity). |
| `SatelliteDFD.tsx` | 541 | Reverse geocode via OpenStreetMap — user location privacy consideration. |
| `SkipTrace.tsx` | 232 | CSV/Excel batch uploader. Clean. |

---

## 6. Code Quality Scan — Scraper Engine

**Root:** `artifacts/scraper-engine/`

- FastAPI microservice proxied via `routes/scraperEngine.ts`
- Handles: Google Maps, Google Search, NAR Directory, Zillow, Propelio, PropWire, cash buyer database ingestion
- Credentials stored AES-encrypted in `crm_campaigns`, decrypted at app-layer before proxy
- Node client `scraperEngineClient.ts` has `DEFAULT_TIMEOUT_MS = 60_000` (hardcoded)
- Job results returned via polling — in-memory job state **lost on restart**
- `exhaustedKeys` Set in `routes/scraper.ts` never un-exhausted until process restart

---

## 7. Code Quality Scan — Shared Libs (lib/)

### 7.1 Database Schema — `lib/db/src/schema/crm.ts` (685 LOC)

**Tables (20+):**
`crm_campaigns` · `crm_leads` · `crm_users` · `crm_notes` · `crm_tasks` · `crm_call_logs` · `crm_openphone_messages` · `crm_faxes` · `crm_contracts` · `crm_sequences` · `crm_sequence_steps` · `crm_sequence_logs` · `crm_notifications` · `crm_followers` · `crm_links` · `crm_waitlist` · `crm_background_jobs` · `cash_buyers` · `cash_buyer_matches` · `distressed_listings` · `property_comps` · `scraper_jobs` · `crm_audit_log`

**New Columns (added S22):**
- `crm_leads.lastMotivationScore` — `numeric(5,2)` — AI deal scorer 0–100
- `crm_leads.lastMotivationLabel` — `text` — e.g. "Hot 🔥", "Warm", "Cold"

**Schema Issues:**

| Issue | Severity | Detail |
|---|---|---|
| Date columns as `text` | Medium | `last_sale_date`, `last_purchase_date`, `sale_date`, `sold_date`, `event_date` stored as `text` — prevents native DB date-range queries and ordering. Should be `date` or `timestamp`. |
| Missing index on `crm_leads(email)` | Medium | Used for deduplication and filtering, but not indexed. |
| Missing index on `crm_leads(zip)` | Low | Common filter field — full scan on every zip-filter query. |
| Missing index on `scraper_jobs(campaignId)` | Low | Per-campaign job views require full scan. |
| Missing index on `crm_leads(phone_number)` | High | **Primary resolution for PERF-02** — phone reverse-lookup in `twilio.ts:521` does full table scan. |

**Index Coverage:** ~45 indexes across 20+ tables. FK coverage extensive with appropriate `onDelete` cascade/set-null.

**Numeric Precision (all correct):**
- Currency: `numeric(12,2)` ✓
- GPS: `numeric(10,7)` ✓
- MOS score: `numeric(4,2)` ✓
- Percentages/discount: `numeric(5,2)` ✓

### 7.2 Utility Files

| File | LOC | Notes |
|---|---|---|
| `crm/crypto-util.ts` | 64 | AES-256-GCM with legacy CBC migration. **SEC-07**: Falls back to `JWT_SECRET` if `ENCRYPTION_KEY` missing — rotation of JWT_SECRET would corrupt DB values. |
| `crm/parse-util.ts` | 40 | Express param parsing. Robust `isNaN` + positive integer checks. Clean. |

### 7.3 Config Files

| File | LOC | Notes |
|---|---|---|
| `env.example` | 135 | Comprehensive. Lists `ENCRYPTION_KEY` requirement. Risk: default API key patterns (`gsk_...`, `nvapi-...`) in comments — ensure not committed with real values. |
| `railway.json` | 13 | Railpack config. `restartPolicyMaxRetries: 10`. |
| `pnpm-workspace.yaml` | 126 | Extensive `esbuild`/`rollup` overrides for Railway architecture. |
| `package.json` | ~40 | `version: 0.0.0`. **`typecheck` script is a dummy echo — no actual type checking in CI.** |

---

## 8. Cross-Cutting Issues

### 8.1 Security Issues (ranked by severity)

| ID | Severity | Location | Description | Status |
|---|---|---|---|---|
| SEC-01 | **CRITICAL** | `crm/users.ts:225` | `GET /:id/password` returns `password_plain` from DB — authenticated but plaintext retrieval endpoint | ✅ **FIXED** — endpoint returns HTTP 410 Gone |
| SEC-02 | **HIGH** | `openphone.ts:176` | `/openphone/webhook` — no OpenPhone/Twilio signature verification; anyone can spoof inbound SMS | ✅ **FIXED** — HMAC-SHA256 via `verifyOpenPhoneSignature()`, requires `OPENPHONE_WEBHOOK_SECRET` env var |
| SEC-03 | **HIGH** | `twilio-fax.ts:14` | `/fax/inbound` — no Twilio signature verification; fake fax records injectable | ✅ **FIXED** — `twilioWebhookMiddleware` applied |
| SEC-04 | **MEDIUM** | `sse.ts:26` | JWT in URL query param — captured in access logs | **OPEN** |
| SEC-05 | **MEDIUM** | `lib/twilioWebhookMiddleware.ts:20` | Soft-fails (skips validation) if `TWILIO_AUTH_TOKEN` env var missing | ✅ **FIXED** — hard-fails with HTTP 500 |
| SEC-06 | **MEDIUM** | `TolipAI-website/Admin.tsx` | Website admin JWT stored in `localStorage` — XSS-extractable | **OPEN** |
| SEC-07 | **MEDIUM** | `crm/crypto-util.ts` | Falls back to `JWT_SECRET` for AES if `ENCRYPTION_KEY` missing | **OPEN** |
| SEC-08 | **LOW** | `crm/index.ts`, `contact.ts`, `subscribe.ts` | Public POST endpoints lack rate limiting/CAPTCHA | **OPEN** |
| SEC-09 | **LOW** | `demo.ts` | No premium-rate phone number check — toll fraud risk | **OPEN** |

### 8.2 Performance Issues

| ID | Severity | Location | Description | Status |
|---|---|---|---|---|
| PERF-01 | **HIGH** | `services/propertyApi.ts` | 4 global `Map`s grow indefinitely — linear memory leak | ✅ **FIXED** — `cappedMapSet()` evicts oldest entry when size > 50,000 |
| PERF-02 | **HIGH** | `routes/twilio.ts:521` | Full `crmLeads` table scan for phone reverse-lookup (no index on `phone_number`) | ✅ **FIXED** — `crm_leads_phone_idx` created in startup |
| PERF-03 | **MEDIUM** | `routes/crm/leads.ts:474` | `bulk-import` inserts one row at a time instead of batched | ✅ **FIXED** — single `db.insert().values([...])` batch (1 round-trip) |
| PERF-04 | **MEDIUM** | `routes/crm/campaigns.ts:59` | Per-campaign `count(*)` in list endpoint — N+1 | ✅ **FIXED** — two grouped `count(*) GROUP BY campaignId` queries replace N+1 loop |
| PERF-05 | **MEDIUM** | `routes/crm/analytics.ts` | Multiple `db.execute(sql...)` not consolidated | **OPEN** |
| PERF-06 | **LOW** | `routes/twilio-power-dialer.ts:366` | Individual `db.insert(crmCallLogs)` inside batch-dial loop | ✅ **FIXED** — single batch insert via `.values([...map...])` |

### 8.3 Memory & Resource Leaks

| ID | Location | Description | Status |
|---|---|---|---|
| MEM-01 | `services/propertyApi.ts` | 4 global Maps never pruned | ✅ **FIXED** — `cappedMapSet()` caps all 4 Maps at 50k entries |
| MEM-02 | `pages/integrations/PhoneNumbers.tsx` | `MiniPlayer` audio not paused/`revokeObjectURL`'d on unmount | ✅ **FIXED** — `useEffect` cleanup pauses audio and clears `src` |
| MEM-03 | `contexts/PhoneContext.tsx` | Old `AudioContext` not closed when `initDevice` called multiple times | **OPEN** |

### 8.4 Bug Tracking

| ID | Location | Description | Status |
|---|---|---|---|
| BUG-BOOT-01 | `src/index.ts` | `ensureIndexes()`/`repairSequences()` without `await` — race on startup | ✅ **FIXED** — `runDbStartupTasks()` awaited before `app.listen()` |
| BUG-AUTO-01 | `services/automation.ts:52` | `splice` during `onboardingQueue` iteration — skips items | ✅ **FIXED** — atomically rebuilds queue using `filter()` before processing |
| BUG-BD-01 | `BrowserDialer.tsx` | `coachingTimerRef` not cleared on unmount | ✅ **FIXED** — unmount `useEffect` clears `coachingTimerRef` |
| BUG-BD-02 | `BrowserDialer.tsx` | `checkSid` interval not cleared on unmount | ✅ **FIXED** — `checkSidRef` stored and cleared on unmount |
| BUG-SCRAP-01 | `routes/scraperEngine.ts` | `inArray` with >32k leads exceeds Postgres param limit | ✅ **FIXED** — `chunkedInArray()` splits at 10k per chunk using `or()` |
| BUG-TDZ-01 | `pages/integrations/PhoneNumbers.tsx` | `numbersData` referenced in `useEffect` dep array before `useQuery` declaration — TDZ crash "Cannot access 'w' before initialization" in minified build | ✅ **FIXED** — `useQuery` declaration moved above `useEffect` |
| BUG-SCRAPER-DOCKER | `TolipAI-scraper-engine/Dockerfile.fargate` | AWS Fargate ARM64 Dockerfile used on Railway (amd64) — Pillow/crawl4ai version conflict causes build failure | ✅ **FIXED** — `Dockerfile.railway` created for x86_64; `railway.json` updated to use it |

### 8.5 Type Safety
- Widespread `as any` in: API response handling (OpenAI, ATTOM, Twilio, Drizzle `execute` results), `formatTask`/`formatComp` helpers, scraper result rows
- `(req as any).validatedQuery` in `lib/validate.ts` bypasses Express type extensions
- `package.json` typecheck script is a no-op — **no compile-time guarantee in CI**

### 8.6 Console Logging in Production (7 files — should use Pino logger)
`routes/crm/leads.ts` · `routes/twilio-voice.ts` · `routes/twilio-power-dialer.ts` · `services/automation.ts` · `services/attomApi.ts` · `routes/openphone.ts` · `routes/scraper.ts`

### 8.7 In-Memory State (Lost on Every Railway Deploy)

| Location | State |
|---|---|
| `services/automation.ts` | `onboardingQueue` array |
| `services/propertyApi.ts` | 4 daily-limit Maps |
| `routes/tools.ts` | `enrichJobs`, `_attomDistressedJobs` |
| `routes/scraper.ts` | `exhaustedKeys` Set |
| `routes/demo.ts` | Rate limiter |
| `routes/twilio-power-dialer.ts` | Power dial sessions (DB-backed — correct) |

### 8.8 API Path Inconsistency (Frontend)
Several pages access APIs without the `/api` prefix or use different conventions:
- `pages/admin/WaitlistAdmin.tsx` → `/admin/waitlist` (missing prefix)
- `pages/integrations/TwilioConnect.tsx` → `/twilio/config` (missing `/api`)
- `pages/integrations/IntegrationsDashboard.tsx` → `/scraper-engine` (missing `/api`)
- No centralized `BASE_API_URL` constant — promotion to staging/prod URLs is manual

### 8.9 LocalStorage Token Access (Should Use `apiFetch`)
- `pages/admin/WaitlistAdmin.tsx`
- `pages/integrations/TwilioConnect.tsx`
- `pages/buyers/CashBuyersAll.tsx`

---

## 9. Action Plan

### Priority 1 — Critical (Fix Before Next Production Deploy)

| # | Task | File(s) |
|---|---|---|
| A1 | ✅ **Remove `password_plain` retrieval** — endpoint returns 410 Gone | `crm/users.ts` |
| A2 | ✅ **Add OpenPhone webhook signature verification** — HMAC-SHA256 via `OPENPHONE_WEBHOOK_SECRET` | `openphone.ts` |
| A3 | ✅ **Add Twilio signature verification to fax inbound** using `twilioWebhookMiddleware` | `twilio-fax.ts` |
| A4 | ✅ **Hard-fail `twilioWebhookMiddleware`** if `TWILIO_AUTH_TOKEN` env missing | `lib/twilioWebhookMiddleware.ts` |
| A5 | ✅ **Add `await`** to `ensureIndexes()` and `repairSequences()` in server startup | `src/index.ts` |

### Priority 2 — High (This Sprint)

| # | Task | File(s) |
|---|---|---|
| B1 | ✅ **Add index on `crm_leads(phone_number)`** — `crm_leads_phone_idx` created in startup | Schema |
| B2 | ✅ **Prune global Maps in `propertyApi.ts`** — `cappedMapSet()` evicts at 50k entries | `services/propertyApi.ts` |
| B3 | ✅ **Fix `onboardingQueue` splice-during-iteration** — atomic queue rebuild via `filter()` | `services/automation.ts` |
| B4 | ✅ **Batch `bulk-import` inserts** — single `db.insert().values([...])` call | `crm/leads.ts` |
| B5 | **Move SSE JWT to `Authorization` header** via short-lived token exchange endpoint | `sse.ts`, `AppLayout.tsx` |
| B6 | ✅ **Add local `<ErrorBoundary>`** wrappers on `BrowserDialer`, `CompsSection` in `LeadDetail` | CRM components |
| B7 | **Migrate date `text` columns to `date`/`timestamp`** in schema | `lib/db/src/schema/crm.ts` |
| B8 | ✅ **Fix `MiniPlayer` unmount** — `useEffect` cleanup pauses audio and clears `src` | `PhoneNumbers.tsx` |

### Priority 3 — Medium (Next Sprint)

| # | Task | File(s) |
|---|---|---|
| C1 | Add `AbortController` to all AI generation fetches | `AiDealScorer`, `AiOfferLetter`, `AiSellerScript`, `AiRepairEstimator` |
| C2 | Replace manual `parseCsvLine` in `buyers.ts` with `csv-parse` library | `crm/buyers.ts` |
| C3 | Migrate `waitlist.ts` from raw `pool.query` to Drizzle | `crm/waitlist.ts` |
| C4 | Replace `console.*` with Pino logger in 7 production files | Multiple |
| C5 | Enable real TypeScript type checking (`tsc --noEmit`) in CI pipeline | `package.json` |
| C6 | Persist `exhaustedKeys` to DB or use TTL cache (Redis) | `routes/scraper.ts` |
| C7 | Add missing indexes on `crm_leads(email)`, `crm_leads(zip)`, `scraper_jobs(campaignId)` | Schema |
| C8 | ✅ Fix `coachingTimerRef` and `checkSid` interval cleanup on unmount in `BrowserDialer` | `BrowserDialer.tsx` |
| C9 | Add `useCallback` / memoize `refreshList` in `CashBuyerMatchPanel` | Component |
| C10 | Add `aria-label` to all icon-only buttons (trash, edit, pencil) across CRM | Multiple pages |
| C11 | ✅ Fix `scraperEngine.ts` `inArray` — `chunkedInArray()` splits at 10k per chunk | `routes/scraperEngine.ts` |
| C12 | Fix old `AudioContext` leak in `PhoneContext.initDevice` | `PhoneContext.tsx` |

### Priority 4 — Low / Tech Debt

| # | Task |
|---|---|
| D1 | Centralize Stripe price IDs in env vars (remove frontend hardcoding in `SubscribeModal.tsx`) |
| D2 | Centralize API base URL — eliminate `/api/crm/` vs `/twilio/` vs `/scraper-engine/` path inconsistencies |
| D3 | Replace `localStorage.getItem("crm_token")` with `apiFetch` in `WaitlistAdmin`, `TwilioConnect`, `CashBuyersAll` |
| D4 | Deduplicate `STREET_SUFFIXES` between `Arv.tsx` and `PropertyLookup.tsx` (extract to shared util) |
| D5 | Add CAPTCHA/rate limiting to public lead submit, contact, and subscribe endpoints |
| D6 | Add CAPTCHA to demo call endpoint or validate number against known-safe list |
| D7 | Fix `attomApi.ts` key rotation — use atomic counter to avoid race condition |
| D8 | Set `version` in root `package.json` to actual semver |
| D9 | Add per-campaign campaign duplicate check in Stripe auto-provisioning (`stripe.ts`) |
| D10 | Fix `webhookBase.ts` `localhost:8080` fallback — throw error if `PUBLIC_URL` missing in production |

---

*End of CODEBASE_AUDIT.md — TolipAI Platform, May 22, 2026*
*Next scheduled audit: after Priority 1 + 2 fixes are merged*
