# TolipAI Platform — Enterprise Production Audit
**Version:** 2.1.0
**Audit Date:** May 22, 2026
**Auditors:** 6-Subagent Parallel Full-Scan (line-by-line)
**Previous Audit:** May 17, 2026 (v2.0.0, score 93/100)
**Scope:** Full monorepo — API server, CRM frontend, Tools frontend, Website frontend, Scraper Engine, shared libs, DB schema, config
**Objective:** Identify all issues, security vulnerabilities, dead code, feature gaps vs competitors, and produce a complete enterprise-readiness roadmap with agent-executable commands.

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Codebase Map & LOC Inventory](#2-codebase-map--loc-inventory)
3. [CRITICAL Issues — Fix Immediately](#3-critical-issues--fix-immediately)
4. [Backend API Server Audit](#4-backend-api-server-audit)
5. [Frontend CRM Audit](#5-frontend-crm-audit)
6. [Python Scraper Engine Audit](#6-python-scraper-engine-audit)
7. [Database Schema Audit](#7-database-schema-audit)
8. [Security Vulnerabilities](#8-security-vulnerabilities)
9. [Competitor Feature Matrix](#9-competitor-feature-matrix)
10. [Enterprise Readiness Assessment](#10-enterprise-readiness-assessment)
11. [Full Roadmap](#11-full-roadmap)
12. [Agent Execution Plan](#12-agent-execution-plan)

---

## 1. Executive Summary

TolipAI is a **feature-rich real estate wholesaling platform** that now ships AMD predictive power dialing, dual-speaker live call transcription, AI deal scoring with DB persistence, and a unified conversations feed. After six focused development sessions since the initial audit (score 73/100), the platform has risen to **93/100** and is entering the range where a focused security/performance cleanup sprint would make it legitimately production-grade.

### Score History

| Date | Score | Key Driver |
|---|---|---|
| May 1, 2026 (baseline) | 73/100 | Initial audit — N+1 critical, no Sentry, memory leaks |
| May 10, 2026 | 85/100 | S18–S19: Sentry wired, call logs fixed, DB sequences repaired |
| May 17, 2026 | 93/100 | S20–S21: Billing/Stripe portal, smart inbound routing, security fixes |
| **May 22, 2026** | **93/100** | S22: AMD power dialer, live transcript, call scoring, conversations union — new features shipped but 9 new issues identified that hold score steady |

### Current Score: 93/100

**Points lost (7):**
- SEC-01: Plaintext password retrieval endpoint (−2)
- SEC-02/03: Missing webhook signature verification on OpenPhone + Fax (−2)
- PERF-02: Unresolved N+1 full-table scan on `crm_leads` phone lookup (−1)
- MEM-01: 4 unbounded global Maps in `propertyApi.ts` (−1)
- BUG-BOOT-01: Startup race — `ensureIndexes` without `await` (−1)

**Target: 96/100** — achievable after Priority 1 + 2 fixes from Action Plan.

> **Infrastructure note (unchanged):** AWS Fargate migration deferred indefinitely. Railway (api-server) + Neon PostgreSQL is production-ready for current scale. Scraper Engine on its own isolated deployment.

---

## 2. Codebase Map & LOC Inventory

### API Server (`artifacts/api-server/src/`) — ~13,500 lines total (up from ~10,200 on May 17)

| File | Lines | Status |
|---|---|---|
| `routes/crm/leads.ts` | 2,582 | Active — dense but mostly clean |
| `routes/twilio-voice.ts` | 1,636 | Active — conference, recording, AI coaching, transcription |
| `routes/twilio.ts` | 1,364 | Active — **PERF-02 N+1 unresolved at line 521** |
| `routes/tools.ts` | 1,249 | Active — ARV, skip trace, 5× `setImmediate` background jobs |
| `routes/scraper.ts` | 841 | Active — G-Maps, G-Search, NAR, Zillow |
| `routes/twilio-power-dialer.ts` | 783 | **NEW S22** — AMD predictive dialer + `amd-handler` webhook |
| `routes/twilio-voice-agent.ts` | 655 | Active — AI inbound agent |
| `routes/crm/contracts.ts` | 622 | Active — Dropbox Sign e-signatures |
| `routes/crm/analytics.ts` | 507 | Active |
| `routes/scraperEngine.ts` | 503 | Active — Python proxy |
| `routes/crm/sequences.ts` | 484 | Active — email/SMS drip sequences |
| `routes/crm/campaigns.ts` | 301 | Active |
| `routes/crm/users.ts` | 298 | Active — **SEC-01 CRITICAL** |
| `routes/openphone.ts` | 257 | Active — **SEC-02 HIGH: no sig verification** |
| `routes/twilio-fax.ts` | 252 | Active — **SEC-03 HIGH: no sig verification** |
| `routes/crm/waitlist.ts` | 218 | Active — uses raw `pool.query` (inconsistency) |
| `routes/crm/index.ts` | 193 | Active |
| `routes/crm/comps.ts` | 192 | Active |
| `routes/crm/auth.ts` | 98 | Active |
| `routes/crm/billing.ts` | 131 | Active — Stripe Customer Portal |
| `routes/crm/buyers.ts` | 198 | Active |
| `routes/crm/tasks.ts` | 125 | Active |
| `routes/crm/links.ts` | 101 | Active |
| `routes/crm/notifications.ts` | 61 | Active |
| `routes/crm/stats.ts` | 82 | Active |
| `routes/crm/middleware.ts` | 64 | Active |
| `routes/admin.ts` | 127 | Active |
| `routes/stripe.ts` | 346 | Active — Stripe Checkout + webhook |
| `routes/sse.ts` | 81 | Active — SSE real-time events |
| `routes/demo.ts` | 150 | Active — public AI demo |
| `routes/contact.ts` | 97 | Active |
| `routes/subscribe.ts` | 81 | Active |
| `routes/health.ts` | 27 | Active |
| `routes/index.ts` | 38 | Active — router mount |
| `services/propertyApi.ts` | 1,104 | Active — **MEM-01: 4 unbounded global Maps** |
| `services/automation.ts` | 324 | Active — **BUG-AUTO-01: splice during iteration** |
| `services/twilioCredentials.ts` | 192 | Active — AES-256 decryption |
| `app.ts` | 256 | Active — Express + Helmet CSP |
| `index.ts` | 170 | Active — **BUG-BOOT-01: no await on startup tasks** |
| `seed-demo.ts` | 612 | Dev utility |
| `seed.ts` | 186 | Dev/migration utility |
| `lib/twilioWebhookMiddleware.ts` | 46 | **NEW S22** — Twilio sig validation (soft-fail bug) |
| `lib/backgroundJobStore.ts` | 99 | Active |
| `lib/auditLog.ts` | 57 | Active |

### CRM Frontend (`artifacts/TolipAI-crm/src/`) — ~14,700 lines total (up from ~12,000)

| File | Lines | Status |
|---|---|---|
| `pages/leads/LeadDetail.tsx` | 1,837 | Active — largest page, no local ErrorBoundary |
| `pages/dialer/PowerDialer.tsx` | 1,273 | **NEW S22** — AMD power dialer UI |
| `pages/admin/UserList.tsx` | 880 | Active |
| `pages/integrations/PhoneNumbers.tsx` | 865 | **UPDATED S22** — conversations union, startCall fix |
| `components/leads/BrowserDialer.tsx` | 865 | **UPDATED S22** — dual-speaker live transcript panel |
| `pages/campaigns/CampaignList.tsx` | 853 | Active |
| `pages/admin/WaitlistAdmin.tsx` | 804 | Active |
| `pages/integrations/TwilioConnect.tsx` | 733 | Active |
| `contexts/PhoneContext.tsx` | 661 | Active — **MEM-03: AudioContext leak** |
| `components/leads/CompsSection.tsx` | 659 | Active |
| `pages/analytics/Dashboard.tsx` | 569 | Active |
| `components/leads/CashBuyerMatchPanel.tsx` | 536 | Active |
| `pages/analytics/CallQualityDashboard.tsx` | 531 | Active |
| `pages/leads/LeadList.tsx` | 513 | **UPDATED S22** — call scoring emoji column |
| `components/leads/ContractsCard.tsx` | 402 | Active |
| `components/leads/BulkImportModal.tsx` | 378 | **UPDATED S22** — PapaParse integrated |
| `pages/pipeline/Pipeline.tsx` | 374 | Active |
| `pages/leads/NewLead.tsx` | 340 | Active |
| `pages/analytics/CallReport.tsx` | 299 | Active |
| `components/phone/ActiveCallBar.tsx` | 269 | **UPDATED S22** |
| `components/leads/SmsConversations.tsx` | 275 | Active |
| `pages/public/SignContract.tsx` | 232 | Active |
| `components/leads/AiRepairEstimator.tsx` | 122 | Active |
| `components/leads/AiDealScorer.tsx` | 127 | **UPDATED S22** — DB-persisted scoring |
| `components/leads/AiSellerScript.tsx` | 102 | Active |
| `components/leads/AiOfferLetter.tsx` | 71 | Active |
| `ErrorBoundary.tsx` | 71 | Active |
| `components/phone/IncomingCallPopup.tsx` | 68 | Active |
| `App.tsx` | 121 | Active |

### Database Schema (`lib/db/src/schema/crm.ts`)
- **685 lines** — 20+ tables, ~45 indexes
- **NEW S22**: `crm_leads.lastMotivationScore` (numeric 5,2) + `crm_leads.lastMotivationLabel` (text)

### Tools Frontend (`artifacts/TolipAI-tools/src/`) — ~3,200 lines
### Website Frontend (`artifacts/TolipAI-website/src/`) — ~1,300 lines
### Scraper Engine (`artifacts/scraper-engine/`) — ~14,790 Python lines (unchanged)

### Grand Total LOC
| Artifact | Lines |
|---|---|
| api-server (TS) | ~13,500 |
| TolipAI-crm (TSX) | ~14,700 |
| TolipAI-tools (TSX) | ~3,200 |
| TolipAI-website (TSX) | ~1,300 |
| shared libs / schema | ~900 |
| scraper-engine (Python) | ~14,790 |
| **Total** | **~48,400** |

---

## 3. CRITICAL Issues — Fix Immediately

### CRIT-001 — Plaintext Password Retrieval (SEC-01)
**File:** `artifacts/api-server/src/routes/crm/users.ts:225`
**Severity:** CRITICAL
**Status:** OPEN (pre-existing, not fixed in any session)

`GET /api/crm/users/:id/password` retrieves `password_plain` from the database and returns it to authenticated callers. Even behind CRM auth, returning a plaintext password violates every password security standard and creates an enormous liability if sessions are hijacked or the endpoint is accidentally exposed.

**Fix:** Remove this endpoint entirely. Replace with a "Send Password Reset Email" flow that generates a one-time token, emails the user, and requires them to set a new password.

```typescript
// DELETE this entire route handler in users.ts
router.get("/:id/password", requireCrmAuth, async (req, res) => { ... });

// Replace with:
router.post("/:id/reset-password", requireCrmAuth, async (req, res) => {
  const token = crypto.randomBytes(32).toString("hex");
  // Store token in DB with 1hr expiry, email user
});
```

---

### CRIT-002 — Missing Webhook Signature Verification (SEC-02 + SEC-03)
**Files:** `openphone.ts:176`, `twilio-fax.ts:14`
**Severity:** HIGH
**Status:** OPEN

Two public webhook endpoints accept POST requests from Twilio/OpenPhone with **no cryptographic verification**. Any actor can send arbitrary payloads to inject fake SMS messages or fax records into the CRM.

**Fix for `openphone.ts`:**
```typescript
// Add OpenPhone webhook signature header validation
const signature = req.headers["openphone-signature"];
if (!verifyOpenPhoneSignature(signature, req.body, process.env.OPENPHONE_WEBHOOK_SECRET)) {
  return res.status(401).json({ error: "Invalid signature" });
}
```

**Fix for `twilio-fax.ts`:**
```typescript
import { twilioWebhookMiddleware } from "../lib/twilioWebhookMiddleware";
router.post("/fax/inbound", twilioWebhookMiddleware, async (req, res) => { ... });
```

---

### CRIT-003 — `twilioWebhookMiddleware` Soft-Fail (SEC-05)
**File:** `artifacts/api-server/src/lib/twilioWebhookMiddleware.ts:20`
**Severity:** MEDIUM (escalated — affects all webhooks using this middleware)
**Status:** NEW

If `TWILIO_AUTH_TOKEN` is absent from the environment, the middleware logs a warning and **allows the request through**. In a misconfigured production deployment, this disables all Twilio signature checking silently.

**Fix:**
```typescript
if (!authToken) {
  // Hard-fail instead of soft-fail
  throw new Error("TWILIO_AUTH_TOKEN is required for webhook validation");
}
```

---

### CRIT-004 — Startup Race Condition (BUG-BOOT-01)
**File:** `artifacts/api-server/src/index.ts`
**Severity:** HIGH
**Status:** NEW

`ensureIndexes()` and `repairSequences()` are called without `await`, meaning the server begins accepting requests before indexes are created or sequences are repaired. On cold start or after a migration, the first few requests may hit unindexed tables or broken sequences.

**Fix:**
```typescript
// In index.ts server startup:
await ensureIndexes();
await repairSequences();
server.listen(PORT, () => { ... });
```

---

### CRIT-005 — Memory Leak in `propertyApi.ts` (MEM-01)
**File:** `artifacts/api-server/src/services/propertyApi.ts`
**Severity:** HIGH
**Status:** NEW

Four global `Map` objects (`skipTraceMap`, `fetchCompsMap`, `leadFetchMap`, `campaignFetchMap`) track daily rate limits. These Maps are **never pruned** — keys accumulate for every lead and campaign ever processed. On long-running Railway deployments, this causes a linear memory leak proportional to total leads/campaigns in the system.

**Fix:**
```typescript
import LRU from "lru-cache";
// Replace Map with LRU cache (max 10k entries, 24h TTL)
const skipTraceMap = new LRU<string, number>({ max: 10_000, ttl: 86_400_000 });
```

---

## 4. Backend API Server Audit

### 4.1 Authentication & Authorization
- JWT-based auth (7d expiry) implemented consistently via `requireCrmAuth` middleware
- `getJwtSecret()` throws if secret missing or under 32 chars — **correct safeguard**
- Admin portal uses separate JWT (24h) via `admin.ts`
- **Gap**: No token refresh mechanism — sessions hard-expire after 7d forcing re-login
- **Gap**: No IP binding or device fingerprinting on JWT — stolen tokens are valid anywhere

### 4.2 Twilio Integration (Voice)
- Browser dialer: token endpoint, answer, conference join, conference status, call status callbacks — all implemented
- AMD (Answering Machine Detection): `amd-handler` webhook + DB row-locking added S22 — **correct implementation**
- AI coaching suggestions: `/voice/ai-suggestion` (OpenAI, gated by campaign) — working
- Live transcription: `/voice/transcribe` → SSE push → `BrowserDialer.tsx` dual-speaker panel — **NEW S22**
- Power dialer: `twilio-power-dialer.ts` (783 lines) — session management, batch calling, disposition tracking
- AI inbound agent: `twilio-voice-agent.ts` — OpenAI tool-calling for live call handling
- **Gap**: No voicemail detection fallback path documented when AMD times out
- **Gap**: Recording storage relies on Twilio URLs (ephemeral) — no archival to S3/GCS

### 4.3 SMS & Messaging
- Twilio SMS: send/receive via `twilio.ts`
- OpenPhone: inbound webhook via `openphone.ts` — **no signature verification (SEC-02)**
- AI SMS replies: `aiSmsService.ts` with circuit breaker
- **NEW S22**: `GET /twilio/conversations` unions `crm_call_logs` + `crm_openphone_messages` into single sorted feed — clean implementation
- Opt-out tracking: `/sms-opt-out` endpoints in `sequences.ts`
- **Gap**: No MMS support

### 4.4 Data Services
- **PropertyAPI.co**: primary property data — working
- **ATTOM**: AVM + distressed data — global key-rotation race condition
- **Rentcast**: AVM fallback — silently swallows all errors
- **PeopleDataLabs**: skip trace — working
- **Brevo SMTP**: email + direct mail — working
- **Dropbox Sign**: e-signatures — working

### 4.5 Background Jobs & Queuing
- `backgroundJobStore.ts`: DB-backed job persistence — correct
- `tools.ts` `setImmediate` fire-and-forget: 5 patterns — **not observable, not retryable**
- `scraperEngineClient.ts`: polling-based job tracking — in-memory, lost on restart
- **Gap**: No durable queue (BullMQ, pg-boss) — all async work is fire-and-forget or in-memory

### 4.6 Rate Limiting
- `express-rate-limit` wired in `app.ts`
- Demo call: custom in-memory 2/hr limiter
- **Gap**: No rate limiting on public lead submit, contact form, or subscribe endpoints
- **Gap**: No per-user API rate limiting on CRM endpoints

### 4.7 Error Handling Patterns
| Pattern | Usage | Assessment |
|---|---|---|
| `try/catch` + `res.status(500)` | Most routes | Acceptable |
| `catch { return null }` (silent) | `rentcastApi.ts`, `auditLog.ts` | Hides production issues |
| Fire-and-forget `setImmediate` | `tools.ts` (5×), `automation.ts` | No retry, no observability |
| `Promise.allSettled` | `analytics.ts`, `stats.ts` | Correct — partial failures logged |

---

## 5. Frontend CRM Audit

### 5.1 Architecture & State
- `QueryClientProvider` → `TooltipProvider` → `PhoneProvider` → `ErrorBoundary` — correct wrapping order
- TanStack Query v5 for server state — cache invalidation pattern is consistent
- React Context for Twilio phone state (`PhoneContext`) — 661 lines, correctly handles SSE + SDK race
- **Gap**: No local `<ErrorBoundary>` on `BrowserDialer`, `CompsSection`, `LeadDetail` — single crash in these unmounts entire AppLayout

### 5.2 Real-Time (SSE)
- `AppLayout.tsx` connects to `/crm/events` SSE stream
- Events: `lead-delta`, `notification`, `transcript-segment`, `power-dialer-*`
- JWT passed as URL query param — **SEC-04: captured in access logs**
- `setMaxListeners(500)` — potential listener leak if `close` events mis-fire
- **New S22**: Transcript segments pushed via SSE → `BrowserDialer.tsx` dual-speaker panel — working

### 5.3 Telephony UI (Dialer)
- **`BrowserDialer.tsx`** (865 LOC): Twilio Device, DTMF, hold/transfer, AI coaching, **dual-speaker live transcript** (NEW S22)
  - `coachingTimerRef` not cleared on unmount — potential stale state update
  - `checkSid` interval not cleared on unmount
  - DTMF buttons lack `onKeyDown` — keyboard not accessible
- **`ActiveCallBar.tsx`** (269 LOC): Persistent bottom bar — strong UX, new AI suggestion pulse
- **`PhoneContext.tsx`** (661 LOC): AudioContext memory leak on re-initialization
- **`PowerDialer.tsx`** (1,273 LOC): NEW S22 — AMD session management, lead queue, disposition workflow

### 5.4 Lead Management
- **`LeadList.tsx`** (513 LOC): Filterable grid — **NEW S22**: call scoring emoji column
- **`LeadDetail.tsx`** (1,837 LOC): Full lead profile — all tabs (comps, AI tools, SMS, calls, contracts)
- **`BulkImportModal.tsx`** (378 LOC): CSV importer — **NEW S22**: PapaParse replaces custom regex parser
- **`AiDealScorer.tsx`** (127 LOC): **NEW S22**: Score + label persisted to `crm_leads` in DB

### 5.5 Accessibility (A11y)
| Issue | Severity | Locations |
|---|---|---|
| Icon-only buttons without `aria-label` | Medium | Trash, edit, pencil buttons across all list pages |
| DTMF buttons missing `onKeyDown` | Medium | `BrowserDialer.tsx` |
| Signature input missing `aria-required` | Low | `SignContract.tsx` |
| Table headers missing `scope="col"` | Low | `WaitlistAdmin.tsx`, `DistressedLeadGen.tsx` |
| Low contrast muted text | Low | `text-muted-foreground/40` across multiple components |
| ScoreRing SVG no ARIA label | Low | `CashBuyerMatchPanel.tsx` |

### 5.6 Performance
- TanStack Query caching reduces redundant requests — correct
- No React.lazy / code splitting — entire CRM bundle loads upfront (~3MB estimate)
- `LeadScraper.tsx` in Tools: large hardcoded state/metro arrays inflate bundle size
- `refreshList` in `CashBuyerMatchPanel` recreated every render — should be `useCallback`

### 5.7 API Path Inconsistency (Frontend)
Multiple pages bypass `apiFetch` or use incorrect path prefixes:
- `WaitlistAdmin.tsx`: `/admin/waitlist` (should be `/api/admin/waitlist`)
- `TwilioConnect.tsx`: `/twilio/config` (should be `/api/twilio/config`)
- `IntegrationsDashboard.tsx`: `/scraper-engine` (should be `/api/scraper-engine`)
- `CashBuyersAll.tsx`: custom `/api${path}` helper (inconsistent with `apiFetch`)
- **No centralized `BASE_API_URL`** constant — any environment promotion is manual find-and-replace

---

## 6. Python Scraper Engine Audit

- **~14,790 Python lines** across FastAPI service
- Handles: Google Maps, Google Search, NAR Directory, Zillow, Propelio, PropWire, cash buyer DB ingestion
- Credentials: AES-encrypted in `crm_campaigns`, decrypted at Node layer before proxy
- Browser pooling: Playwright with retry queues — sophisticated implementation
- LLM-assisted extraction: prompts tuned for real estate data — working
- **Gap**: In-memory job state lost on restart (no persistent queue)
- **Gap**: Node client `DEFAULT_TIMEOUT_MS = 60_000` — long-running scrape jobs may timeout
- **Gap**: `exhaustedKeys` Set in `routes/scraper.ts` never un-exhausted until Node process restart (not scraper issue — Node-layer bug)
- **Gap**: `inArray` with >32k lead IDs will hit Postgres parameter limit in `scraperEngine.ts`

---

## 7. Database Schema Audit

### 7.1 Schema Overview
**File:** `lib/db/src/schema/crm.ts` (685 lines)
**Tables:** 20+
**Indexes:** ~45

### 7.2 New Columns Added (S22)
| Table | Column | Type | Purpose |
|---|---|---|---|
| `crm_leads` | `lastMotivationScore` | `numeric(5,2)` | AI deal score 0–100 |
| `crm_leads` | `lastMotivationLabel` | `text` | Human label e.g. "Hot 🔥" |

### 7.3 Data Type Issues

| Table | Column(s) | Current Type | Correct Type | Impact |
|---|---|---|---|---|
| `crm_leads` | `last_sale_date`, `last_purchase_date` | `text` | `date` | Cannot sort/filter by date in DB |
| `property_comps` | `sale_date`, `sold_date` | `text` | `date` | Cannot sort comps by sale date |
| `distressed_listings` | `event_date` | `text` | `timestamp` | Cannot sort foreclosure events |

### 7.4 Missing Critical Index

| Table | Column | Why Needed | Issue |
|---|---|---|---|
| `crm_leads` | `phone_number` | Primary lookup in `twilio.ts:521` | **Resolves PERF-02 full table scan** |
| `crm_leads` | `email` | Deduplication on bulk-import | Slow on large datasets |
| `crm_leads` | `zip` | Common filter in LeadList | Full scan per filter |
| `scraper_jobs` | `campaignId` | Per-campaign job list view | Full scan |

### 7.5 Sensitive Data Storage

| Table | Column | Storage | Risk |
|---|---|---|---|
| `crm_campaigns` | `twilioAuthToken`, `twilioApiKeySecret` | AES-256-GCM (app-layer) | If `ENCRYPTION_KEY` missing, falls back to `JWT_SECRET` |
| `crm_campaigns` | `scraper_propelio_password`, `scraper_propwire_password` | AES-256-GCM (app-layer) | Same fallback risk |
| `crm_users` | `password_plain` | **Plaintext** | **CRIT-001: Should not exist** |

### 7.6 Foreign Key Coverage
Extensive use of `references()` with appropriate `onDelete`:
- Notes, followers, tasks → `cascade` on lead delete ✓
- Tasks assignee → `set null` on user delete ✓
- All cross-campaign references → `cascade` ✓

### 7.7 Numeric Precision (all correct)
- Currency: `numeric(12,2)` ✓
- GPS: `numeric(10,7)` ✓
- MOS score: `numeric(4,2)` ✓
- Discount percentage: `numeric(5,2)` ✓

---

## 8. Security Vulnerabilities

### 8.1 Complete Vulnerability Register

| ID | Severity | CVSS (est.) | Location | Description | Status |
|---|---|---|---|---|---|
| SEC-01 | **CRITICAL** | 8.1 | `crm/users.ts:225` | `GET /:id/password` returns `password_plain` from DB — authenticated endpoint, but plaintext retrieval is indefensible | **OPEN** |
| SEC-02 | **HIGH** | 7.5 | `openphone.ts:176` | `/openphone/webhook` — zero signature verification; arbitrary SMS injection | **OPEN** |
| SEC-03 | **HIGH** | 7.5 | `twilio-fax.ts:14` | `/fax/inbound` — zero Twilio signature verification; fake fax record injection | **OPEN** |
| SEC-04 | **MEDIUM** | 5.3 | `sse.ts:26` | JWT passed as URL query param — captured in server access logs, CDN logs, browser history | **OPEN** |
| SEC-05 | **MEDIUM** | 5.9 | `lib/twilioWebhookMiddleware.ts:20` | Soft-fail if `TWILIO_AUTH_TOKEN` missing — effectively disables signature checking in misconfigured prod | **NEW** |
| SEC-06 | **MEDIUM** | 6.1 | `TolipAI-website/Admin.tsx` | Admin JWT in `localStorage` — XSS-extractable | **OPEN** |
| SEC-07 | **MEDIUM** | 5.5 | `crm/crypto-util.ts` | AES encryption falls back to `JWT_SECRET` if `ENCRYPTION_KEY` absent — JWT rotation corrupts encrypted DB values | **OPEN** |
| SEC-08 | **LOW** | 4.3 | `crm/index.ts`, `contact.ts`, `subscribe.ts` | Public POST endpoints lack rate limiting/CAPTCHA — SMTP flood / spam lead injection risk | **OPEN** |
| SEC-09 | **LOW** | 3.7 | `demo.ts` | No premium-rate phone number check — toll fraud risk on demo call endpoint | **OPEN** |
| SEC-10 | **LOW** | 3.1 | `admin.ts:57` | Admin login JWT hardcoded 24h, no rate limiting on login endpoint | **OPEN** |

### 8.2 Security Controls That Are CORRECT
- Helmet CSP: well-configured for Twilio/OpenAI/Brevo origins ✓
- CORS: regex allowlist (not `*`) ✓
- Stripe webhook: signature verification implemented ✓
- `/voice/answer` + `/voice/conference-status`: Twilio AccountSid validation ✓
- AES-256-GCM for campaign credentials ✓
- `getJwtSecret()` throws if weak ✓
- Pino logger redacts `Authorization` + `Cookie` headers ✓
- bcrypt-12 for password hashing ✓
- `timingSafeEqual` for super-admin password comparison ✓

---

## 9. Competitor Feature Matrix

| Feature | TolipAI | PropStream | DealMachine | Propwire | Propelio | Xleads |
|---|---|---|---|---|---|---|
| Lead database | ✓ (CRM) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Skip tracing | ✓ (PeopleDataLabs) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Dialer (manual) | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ |
| **Dialer (AMD power)** | **✓ NEW** | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Live call transcript** | **✓ NEW** | ✗ | ✗ | ✗ | ✗ | ✗ |
| AI deal scoring | ✓ (DB-persisted) | ✗ | ✗ | ✗ | ✗ | ✗ |
| AI seller scripts | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| AI offer letters | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| AI repair estimates | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| AI SMS replies | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Email sequences | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ |
| E-signatures | ✓ (Dropbox Sign) | ✗ | ✗ | ✗ | ✗ | ✗ |
| ARV calculator | ✓ (ATTOM/Rentcast) | ✓ | ✗ | ✓ | ✓ | ✗ |
| Comps | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cash buyer matching | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| Direct mail | ✓ (Brevo postcard) | ✓ | ✓ | ✗ | ✗ | ✗ |
| Fax | ✓ (Twilio Fax) | ✗ | ✗ | ✗ | ✗ | ✗ |
| Pipeline / Kanban | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| MLS / Zillow scraper | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| AI inbound call agent | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Multi-tenant campaigns | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Stripe billing | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

**TolipAI competitive advantage (unique or best-in-class):**
1. AMD predictive power dialer with live transcription — **no competitor has both**
2. AI deal scoring persisted to DB + surfaced in lead list — **unique**
3. AI inbound call agent (GPT-4o tool-calling) — **unique**
4. Integrated Twilio fax — **unique**
5. Multi-tenant campaign architecture — allows reselling to other wholesalers

---

## 10. Enterprise Readiness Assessment

### 10.1 Readiness Scorecard

| Category | Score | Notes |
|---|---|---|
| **Security** | 6/10 | SEC-01 (plaintext password) + SEC-02/03 (missing webhook verification) block enterprise deals |
| **Performance** | 7/10 | PERF-02 N+1 full table scan unresolved. PERF-01 (propertyApi Maps) now added. Analytics queries could be materialized. |
| **Reliability** | 8/10 | BUG-BOOT-01 startup race. In-memory state lost on deploys. SSE reconnection handles disconnects gracefully. |
| **Observability** | 8/10 | Pino structured logging, Sentry wired, audit log in DB. Missing: distributed tracing, custom Sentry alerts per SEC issue type. |
| **Scalability** | 7/10 | Stateless API is correct. No durable job queue. DB connection pooling via Neon. In-memory Maps could OOM under load. |
| **Type Safety** | 6/10 | Widespread `as any`. `typecheck` script is a no-op in CI. No actual compile-time guarantee. |
| **Accessibility** | 5/10 | Icon buttons missing `aria-label` throughout. DTMF keyboard missing. Multiple WCAG AA contrast failures. |
| **Test Coverage** | 2/10 | No test files found in any artifact. All validation is manual. |
| **Documentation** | 9/10 | `CODEBASE_AUDIT.md`, `ENTERPRISE_AUDIT.md`, `MANUAL_DIALER_PLAN.md`, `Twiliofix.md`, `README.md`, `env.example`. |
| **Feature Completeness** | 10/10 | Exceeds all listed competitors in AI-augmented features. |

**Overall Enterprise Readiness: 7.2/10** (up from 6.8/10 on May 17)

### 10.2 Blockers for Enterprise Sales

The following issues would cause enterprise procurement teams to reject or defer purchase:

1. **SEC-01** (Critical) — Plaintext password in DB and retrievable via API. Would fail SOC 2 Type II audit.
2. **No automated tests** — Enterprise buyers expect ≥60% test coverage.
3. **No rate limiting on public endpoints** — Would fail basic penetration testing.
4. **localStorage JWT** (website admin) — Would fail XSS security review.
5. **`typecheck` no-op** — TypeScript errors are not caught before deployment.

---

## 11. Full Roadmap

### Sprint 1 — Security Hardening (Est. 2 sessions)
| # | Task | Priority | Effort |
|---|---|---|---|
| 1.1 | Remove `password_plain` endpoint, implement password reset flow | CRIT | M |
| 1.2 | Add OpenPhone webhook signature verification | CRIT | S |
| 1.3 | Add Twilio fax inbound signature verification via `twilioWebhookMiddleware` | CRIT | S |
| 1.4 | Hard-fail `twilioWebhookMiddleware` on missing `TWILIO_AUTH_TOKEN` | CRIT | XS |
| 1.5 | Add `await` to `ensureIndexes()`/`repairSequences()` in startup | HIGH | XS |
| 1.6 | Move SSE JWT to short-lived token exchange (avoid query param) | MEDIUM | M |
| 1.7 | Add rate limiting to public lead submit, contact, subscribe | LOW | S |

### Sprint 2 — Performance & Stability (Est. 2 sessions)
| # | Task | Priority | Effort |
|---|---|---|---|
| 2.1 | Add `crm_leads(phone_number)` index — resolves N+1 PERF-02 | HIGH | XS |
| 2.2 | Replace unbounded Maps in `propertyApi.ts` with LRU cache | HIGH | S |
| 2.3 | Fix `onboardingQueue` splice-during-iteration bug | HIGH | XS |
| 2.4 | Batch `bulk-import` inserts — single `db.insert().values([...])` | MEDIUM | XS |
| 2.5 | Add local `<ErrorBoundary>` on `BrowserDialer`, `CompsSection`, `LeadDetail` | MEDIUM | S |
| 2.6 | Fix `MiniPlayer` audio element unmount leak | MEDIUM | XS |
| 2.7 | Fix `BrowserDialer` `coachingTimerRef`/`checkSid` interval cleanup | MEDIUM | XS |
| 2.8 | Migrate date `text` columns to `date`/`timestamp` in schema | MEDIUM | S |
| 2.9 | Add missing schema indexes (`email`, `zip`, `scraper_jobs.campaignId`) | LOW | XS |

### Sprint 3 — Code Quality (Est. 1–2 sessions)
| # | Task | Priority | Effort |
|---|---|---|---|
| 3.1 | Enable `tsc --noEmit` in CI (fix `typecheck` script) | HIGH | S |
| 3.2 | Replace `console.*` with Pino logger in 7 production files | MEDIUM | S |
| 3.3 | Add `AbortController` to all AI generation fetches | MEDIUM | M |
| 3.4 | Replace `parseCsvLine` in `buyers.ts` with `csv-parse` | LOW | XS |
| 3.5 | Migrate `waitlist.ts` from `pool.query` to Drizzle | LOW | S |
| 3.6 | Fix `exhaustedKeys` — persist to DB with daily TTL | LOW | S |
| 3.7 | Fix `scraperEngine.ts` `inArray` > 32k limit | LOW | S |
| 3.8 | Replace `localStorage.getItem("crm_token")` with `apiFetch` (3 files) | LOW | XS |
| 3.9 | Centralize Stripe price IDs in env vars | LOW | XS |
| 3.10 | Centralize API base URL constant | LOW | S |

### Sprint 4 — Testing & Observability (Est. 2–3 sessions)
| # | Task | Priority | Effort |
|---|---|---|---|
| 4.1 | Add Vitest unit tests for `coreCalculations`, `validate`, `crypto-util` | HIGH | L |
| 4.2 | Add integration tests for auth, leads CRUD, Twilio webhook | HIGH | L |
| 4.3 | Add Playwright E2E for login → lead create → dialer → disposition flow | MEDIUM | L |
| 4.4 | Custom Sentry alert rules for SEC-01 access attempts | MEDIUM | S |
| 4.5 | Add distributed trace IDs to Pino log lines | LOW | M |

### Sprint 5 — Accessibility & UX Polish (Est. 1 session)
| # | Task | Priority | Effort |
|---|---|---|---|
| 5.1 | Add `aria-label` to all icon-only buttons | MEDIUM | M |
| 5.2 | Add `onKeyDown` to DTMF buttons in `BrowserDialer` | MEDIUM | XS |
| 5.3 | Fix low-contrast muted text (WCAG AA) | LOW | S |
| 5.4 | Add React.lazy code splitting to `LeadDetail`, `PowerDialer`, `CompsSection` | LOW | M |

---

## 12. Agent Execution Plan

### Phase 1 — Immediate (Run next session)

```bash
# A1: Remove plaintext password endpoint
# In crm/users.ts — delete GET /:id/password handler
# Replace with POST /:id/reset-password → generate token → email

# A2: Add OpenPhone webhook signature verification
# In openphone.ts:176 — verify `openphone-signature` header before processing

# A3: Wire twilioWebhookMiddleware to twilio-fax.ts
# import { twilioWebhookMiddleware } from "../lib/twilioWebhookMiddleware";
# router.post("/fax/inbound", twilioWebhookMiddleware, handler);

# A4: Hard-fail twilioWebhookMiddleware on missing TWILIO_AUTH_TOKEN
# Change warning+passthrough to throw Error()

# A5: Add await to startup tasks
# In index.ts: await ensureIndexes(); await repairSequences();
```

### Phase 2 — Performance (Run second session)

```sql
-- B1: Add missing phone_number index
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_leads_phone_number_idx
  ON crm_leads(phone_number);

-- B7: Migrate date columns
ALTER TABLE crm_leads
  ADD COLUMN last_sale_date_ts date,
  ADD COLUMN last_purchase_date_ts date;
UPDATE crm_leads SET
  last_sale_date_ts = last_sale_date::date,
  last_purchase_date_ts = last_purchase_date::date;
ALTER TABLE crm_leads
  DROP COLUMN last_sale_date,
  DROP COLUMN last_purchase_date;
ALTER TABLE crm_leads
  RENAME COLUMN last_sale_date_ts TO last_sale_date,
  RENAME COLUMN last_purchase_date_ts TO last_purchase_date;
```

```typescript
// B2: LRU cache for propertyApi.ts (install lru-cache if not present)
import { LRUCache } from "lru-cache";
const skipTraceMap = new LRUCache<string, number>({ max: 10_000, ttl: 86_400_000 });
```

```typescript
// B3: Fix onboardingQueue splice bug
// BEFORE:
for (let i = 0; i < onboardingQueue.length; i++) { splice... }
// AFTER:
const due = onboardingQueue.filter(item => item.sendAt <= Date.now());
due.forEach(item => { /* send */ });
onboardingQueue.length = 0;
onboardingQueue.push(...onboardingQueue.filter(item => item.sendAt > Date.now()));
```

### Phase 3 — Code Quality (Run third session)

```json
// package.json — fix typecheck script
{
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

```typescript
// AbortController pattern for AI fetches (apply to all 4 AI components):
const abortRef = useRef<AbortController | null>(null);
const handleGenerate = () => {
  if (abortRef.current) abortRef.current.abort();
  abortRef.current = new AbortController();
  fetch("/api/...", { signal: abortRef.current.signal });
};
useEffect(() => () => abortRef.current?.abort(), []);
```

### Verification Checklist (run after each phase)

```bash
# After Phase 1:
curl -X POST https://[domain]/api/twilio/fax/inbound -H "Content-Type: application/json" -d '{"FaxSid":"fake"}'
# Expected: 403 Forbidden (not 200)

curl -X POST https://[domain]/api/openphone/webhook -H "Content-Type: application/json" -d '{"type":"message.received"}'
# Expected: 401 Unauthorized (not 200)

# After Phase 2:
# In Neon console:
EXPLAIN ANALYZE SELECT * FROM crm_leads WHERE phone_number = '+15551234567';
# Expected: Index Scan (not Seq Scan)

# Memory check (after 24h uptime):
# Railway metrics → Memory — should plateau, not grow linearly
```

---

*End of ENTERPRISE_AUDIT.md — TolipAI Platform, May 22, 2026*
*Audit conducted by: 6 parallel subagent explorers + main agent synthesis*
*Next scheduled audit: After Sprint 1 + Sprint 2 complete*
