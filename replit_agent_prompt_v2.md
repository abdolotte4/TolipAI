# Replit Agent Prompt: Fargate Production Cleanup + New Features (Single-Task, No Redis)

> **Scope:** Fix remaining verified bugs, verify all prior fixes, remove non-Fargate code, and implement SMS + Direct Mail + PWA. Target: **AWS Fargate single-task deployment** (no Redis required at current scale).
>
> **Scale Assumption:** < 50 concurrent users, < 10,000 leads. Single Fargate task for API server is sufficient. Module-level in-memory state is acceptable.
>
> **Repos:** `Agawish24/Python-Worker` + `Agawish24/Digor`
>
> **Previous Audit:** Session 6 completed ~90/99 items. This prompt covers remaining items + new features.

---

## PART 0: VERIFIED ALREADY DONE — DO NOT RE-IMPLEMENT

The following were verified as complete in the Session 6 audit. **Do not waste time re-implementing.** Only verify they still exist:

### Python Scraper Engine
- ✅ SSL verification enabled by default (`http_client.py`)
- ✅ `/debug/env` endpoint removed (`main.py`)
- ✅ CORS defaults to `[]` (`main.py`)
- ✅ `/admin/*` checks `ADMIN_API_KEY` (`main.py`)
- ✅ Connection pooling via `_persistent_client` (`http_client.py`)
- ✅ METRICS uses `asyncio.Lock()` (`main.py`)
- ✅ Session tests don't mutate `os.environ` (`main.py`)
- ✅ `propelio_v2._do_login()` accepts email/password params
- ✅ `propwire._do_login()` accepts email/password params
- ✅ `satellite_rekognition.py` doesn't mutate `os.environ`
- ✅ Health returns `app.version` (`main.py`)
- ✅ No inline `__import__` calls (`main.py`, `cash_buyers.py`)
- ✅ `STEALTH_JS` imported from `_browser_session` (not duplicated)
- ✅ Single `requirements.txt` with bloat removed

### Node.js API Server
- ✅ `crmAuth` on catch-all proxy (`scraperEngine.ts`)
- ✅ `X-API-Key` in `scraperEngineClient.ts`
- ✅ Catch-all forwards `X-API-Key` + `Authorization`
- ✅ All 5 AI endpoints have circuit breaker + timeout (`leads.ts`)
- ✅ Email job batches leads with cursor pagination (`sequences.ts`)
- ✅ Email job concurrency control — `makeSemaphore(5)`
- ✅ Brevo calls have retry + backoff (`sequences.ts`)
- ✅ Campaign deletion uses `chunkArray(500)` (`campaigns.ts`)
- ✅ CSV upload wrapped in transaction (`buyers.ts`)
- ✅ Comps fallback uses `X-API-Key` (`leads.ts`)
- ✅ Comps recalculation uses `Promise.all` parallel update
- ✅ Super admin password uses `timingSafeEqual` (`campaigns.ts`)
- ✅ Twilio SID not exposed in responses (`campaigns.ts`)
- ✅ AI endpoints no `response_format` (`leads.ts`)
- ✅ `formatLead` JSON.parse is safe — `Array.isArray` + `try/catch`
- ✅ Email sequence job uses Postgres advisory lock (`sequences.ts`)

### Fargate Cleanup
- ✅ Railway artifacts deleted
- ✅ Lambda artifacts deleted
- ✅ `start.fargate.sh` only runs uvicorn
- ✅ Package cleanup (YOLO, bloat removed)

### Tools Frontend/Backend
- ✅ `X-API-Key` in scraperEngineClient
- ✅ No Railway fallback URL
- ✅ Skip Trace async contract (`skipTraceJobs` Map + polling)
- ✅ Phone Finder async contract (`phoneFinderJobs` Map + polling)
- ✅ ARV handles empty comps (404)
- ✅ Property lookup parallel calls
- ✅ Auth hook redirects on 401
- ✅ Tools hook has request timeouts (`AbortSignal.timeout(60s)`)

### Backend Performance
- ✅ List view uses single JOIN query
- ✅ `formatLead` no raw JSON.parse
- ✅ Database indexes migration created
- ✅ Search uses trgm index
- ✅ `/full` endpoint supports `?include=`
- ✅ Notes/tasks have LIMIT pagination

### Frontend List
- ✅ Staggered animation delays removed
- ✅ Search input debounced (400ms)
- ✅ Dates pre-formatted in backend
- ✅ `STATUS_COLORS` lookup object

---

## PART 1: REMAINING BUGS TO FIX

### 1.1 `services/coreCalculations.ts` — `toE164` Does Not Reject Invalid Lengths
**File:** `artifacts/api-server/src/services/coreCalculations.ts`  
**Bug:** Current code returns the original string unchanged for invalid lengths (e.g., 9-digit number returns `"123456789"` instead of being rejected).  
**Fix:** Reject invalid lengths. Return `null` or throw:
```typescript
export function toE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null; // REJECT invalid lengths
}
```
**Verify:** Update all callers to handle `null` return (do not pass invalid phone numbers to APIs).

### 1.2 `routes/crm/links.ts` — Verify `getBaseUrl` Uses `PUBLIC_URL`
**File:** `artifacts/api-server/src/routes/crm/links.ts`  
**Bug (from prompt):** `getBaseUrl` may use unvalidated `x-forwarded-host` header.  
**Fix:** Ensure `process.env.PUBLIC_URL` is checked first and validated:
```typescript
function getBaseUrl(): string {
  if (process.env.PUBLIC_URL) {
    return process.env.PUBLIC_URL.replace(/\/$/, "");
  }
  throw new Error("PUBLIC_URL is required");
}
```

---

## PART 2: MULTI-INSTANCE STATE — SINGLE-TASK FARGATE DECISION

> **Decision:** We are deploying as a **single Fargate task** for the API server. Module-level in-memory Maps are acceptable at our scale (< 50 users). No Redis required.

The following items are **intentionally left as module-level Maps** because they are cost-optimization concerns, not correctness bugs, when running a single task:

| Item | File | Status | Reason |
|------|------|--------|--------|
| PropertyAPI cooldown Maps | `services/propertyApi.ts` | ✅ Acceptable | Single task = shared memory. Cooldowns work correctly. |
| PropertyAPI key rotation state | `services/propertyApi.ts` | ✅ Acceptable | Single task = shared memory. Key rotation works correctly. |
| ATTOM depleted key cache | `services/attomApi.ts` | ✅ Acceptable | Single task = shared memory. Depletion tracking works correctly. |
| Comps job store | `routes/crm/leads.ts` | ✅ Acceptable | Single task = jobs and polling on same container. |
| Skip trace job store | `routes/tools.ts` | ✅ Acceptable | Single task = jobs and polling on same container. |
| Phone finder job store | `routes/tools.ts` | ✅ Acceptable | Single task = jobs and polling on same container. |
| Lead list Redis cache | `routes/crm/leads.ts` | ❌ Not needed | Skip entirely. DB query optimization is sufficient. |

**Future note:** When scaling to 3+ Fargate tasks, migrate these to Postgres tables or add Redis.

---

## PART 3: NEW FEATURES

### 3.1 SMS Sequences via Twilio

**Context:** Twilio credentials (`twilioAccountSid`, `twilioAuthToken`) already exist in campaigns table. Sequences infrastructure exists for email via Brevo.

**Implementation:**

1. **Database Schema Changes** (`artifacts/api-server/src/db/schema.ts`):
   - Add `crm_sms_opt_outs` table: `id`, `phone` (TEXT, unique), `campaignId` (INTEGER), `optedOutAt` (TIMESTAMP)
   - Extend `crm_sequence_templates` to support `type: "sms"`
   - Extend `crm_sequence_steps` to support `type: "sms"` in the JSONB `steps` array
   - Extend `crm_sequence_logs` to track SMS delivery status

2. **SMS Service** (`artifacts/api-server/src/services/smsService.ts`):
   - `sendSms({ to, body, campaignId })` using Twilio REST API (`/Messages`)
   - Rate limit: 1 msg/sec per Twilio number (use `p-limit` or simple queue)
   - Check `crm_sms_opt_outs` before sending
   - Track delivery status (sent, delivered, failed, undelivered)
   - Cost tracking: log approximate cost per segment

3. **Sequence Job Extension** (`artifacts/api-server/src/routes/crm/sequences.ts`):
   - Extend `runEmailSequenceJob` to also process SMS steps
   - SMS steps run after email steps in the same job loop
   - Respect `delayDays` and `delayHours` for SMS timing
   - Log SMS sends to `crm_sequence_logs` with `type: "sms"`

4. **Opt-out Handling**:
   - Add `POST /api/crm/sms-opt-out` endpoint (phone number opts out)
   - Add `GET /api/crm/sms-opt-out/:campaignId` to check opt-out list
   - Store opt-outs in `crm_sms_opt_outs` table (not Redis)

5. **Frontend** (`artifacts/digor-tools/src/pages/sequences/`):
   - Add SMS step type to sequence builder UI
   - SMS template editor with 160-char limit warning
   - Show SMS delivery status in sequence logs

**Files to modify:**
- `artifacts/api-server/src/db/schema.ts`
- `artifacts/api-server/src/services/smsService.ts` (new)
- `artifacts/api-server/src/routes/crm/sequences.ts`
- `artifacts/api-server/src/routes/crm/campaigns.ts` (add opt-out endpoints)
- `artifacts/digor-tools/src/pages/sequences/` (add SMS step UI)

---

### 3.2 Direct Mail via Brevo

**Context:** Brevo already integrated for email. Brevo offers direct mail (postcards/letters) via Transactional API.

**Implementation:**

1. **Database Schema Changes** (`artifacts/api-server/src/db/schema.ts`):
   - Extend `crm_sequence_templates` to support `type: "direct_mail"`
   - Extend `crm_sequence_steps` to support `type: "direct_mail"`
   - Extend `crm_sequence_logs` to track direct mail status

2. **Direct Mail Service** (`artifacts/api-server/src/services/directMailService.ts`):
   - `sendDirectMail({ toName, toAddress, templateId, mergeFields })` using Brevo Transactional API
   - Address validation: ensure street, city, state, zip are present
   - Cost tracking: log approximate cost per piece (~$0.75–1.50)
   - Status tracking: queued, printed, shipped, delivered

3. **Sequence Job Extension** (`artifacts/api-server/src/routes/crm/sequences.ts`):
   - Process `direct_mail` steps in the same job loop
   - Direct mail has longer delay (e.g., +3 days after email/SMS step)
   - Log to `crm_sequence_logs` with `type: "direct_mail"`

4. **Webhook Handler** (`artifacts/api-server/src/routes/crm/sequences.ts`):
   - Add `POST /api/crm/direct-mail/webhook` for Brevo status updates
   - Update `crm_sequence_logs` status on webhook receipt

5. **Frontend** (`artifacts/digor-tools/src/pages/sequences/`):
   - Add direct mail step type to sequence builder
   - Template editor for postcards/letters with merge fields
   - Show direct mail status in sequence logs

**Files to modify:**
- `artifacts/api-server/src/db/schema.ts`
- `artifacts/api-server/src/services/directMailService.ts` (new)
- `artifacts/api-server/src/routes/crm/sequences.ts`
- `artifacts/digor-tools/src/pages/sequences/` (add direct mail step UI)

---

### 3.3 PWA (Progressive Web App) for digor-tools

**Context:** `digor-tools` is a React/Vite app. PWA adds installability, offline cache, and push notifications.

**Implementation:**

1. **Vite PWA Plugin** (`artifacts/digor-tools/vite.config.ts`):
   - Install `vite-plugin-pwa`
   - Configure with `registerType: 'autoUpdate'`
   - Include all tool routes in manifest

2. **Web App Manifest** (`artifacts/digor-tools/public/manifest.json`):
   - App name: "Digor Tools"
   - Icons: 192x192, 512x512 (use existing logo or placeholder)
   - Theme color: match existing UI
   - Display mode: `standalone`
   - Start URL: `/`
   - Scope: `/`

3. **Service Worker** (auto-generated by `vite-plugin-pwa`):
   - Cache static assets (JS, CSS, icons)
   - Cache API responses for offline viewing (lead lists, property lookups)
   - Use Workbox strategies: stale-while-revalidate for assets, network-first for API

4. **Offline Indicator** (`artifacts/digor-tools/src/App.tsx`):
   - Add `navigator.onLine` listener
   - Show "Offline mode" banner when disconnected
   - Disable sync-dependent buttons when offline

5. **Install Prompt** (`artifacts/digor-tools/src/App.tsx`):
   - Listen for `beforeinstallprompt` event
   - Show "Add to Home Screen" button on mobile
   - Store user preference in localStorage

6. **Mobile Responsive** (all tool pages):
   - Ensure all 9 tools work on mobile screens:
     - Lead Scraper, Skip Trace, Distressed, ARV, Property Lookup, AI Distressed, Satellite DFD, Phone Finder
   - Touch targets minimum 44px
   - Font sizes readable on mobile (no < 14px)
   - Horizontal scroll eliminated

7. **GPS Location** (`artifacts/digor-tools/src/pages/SatelliteDFD.tsx`):
   - Add "Use my location" button
   - Use `navigator.geolocation.getCurrentPosition()` to center map
   - Handle permission denied gracefully

8. **Push Notifications** (optional, if time permits):
   - Use web push API for job completion alerts
   - Simple server endpoint to store push subscriptions
   - Trigger push when skip trace / scrape job completes

**Files to modify:**
- `artifacts/digor-tools/vite.config.ts`
- `artifacts/digor-tools/public/manifest.json` (new)
- `artifacts/digor-tools/src/App.tsx`
- `artifacts/digor-tools/src/pages/SatelliteDFD.tsx`
- `artifacts/digor-tools/src/components/layout/AppLayout.tsx` (mobile nav)
- All tool pages (mobile responsiveness pass)

---

## PART 4: CROSS-REPO ALIGNMENT (Verify Still Correct)

1. **Python:** `propelio_v2._do_login()` and `propwire._do_login()` accept `email`/`password` params. ✅
2. **Python:** Session test endpoints pass credentials as params. ✅
3. **Node.js:** `scraperEngine.ts` test endpoints do NOT decrypt. Pass encrypted strings to Python. ✅
4. **Node.js `scraperEngineClient.ts`:** Sends `X-API-Key` to all requests. ✅
5. **Node.js `scraperEngine.ts`:** Forwards `X-API-Key` + `Authorization` in catch-all proxy. ✅

---

## PART 5: CAPTCHA SOLVER (Optional — Implement If Time Permits)

**Context:** Use existing AI infrastructure (OpenRouter/GPT-4o-mini) to solve CAPTCHAs instead of paid services.

**Implementation:**
1. **New module** `workers/scrapers/captcha_solver.py`:
   - `solve_text_captcha(image_bytes) -> str`: Send to GPT-4o-mini
   - `solve_image_selection_captcha(image_bytes, instruction) -> list`: Send to GPT-4o
   - `detect_captcha_type(page) -> str`: Check for reCAPTCHA, hCaptcha, text CAPTCHA

2. **Integrate into `_browser_session.py`**:
   - After `page.goto()`, detect CAPTCHA
   - Screenshot challenge, call solver, inject answer
   - Max 3 attempts, then raise `CaptchaError`

3. **Add to `http_client.py`**:
   - Detect CAPTCHA indicators in HTTP 403 responses
   - Raise `CaptchaError` for retry queue to handle

4. **Cost optimization**:
   - Use `gpt-4o-mini` for text CAPTCHAs
   - Use `gpt-4o` only for complex image challenges
   - Log solve success/failure rates

**If this adds more than 1 day of work, skip it and mark as future feature.**

---

## PART 6: CONSTRAINTS

- **Single-task Fargate only.** No Redis. No distributed locks beyond Postgres advisory locks (already done).
- **Do NOT change working stealth logic** in `_browser_session.py`, `browser_pool.py`, `propelio_v2.py`, `propwire.py`.
- **Do NOT add new dependencies** unless absolutely required for new features.
- **Preserve all existing API contracts** — return shapes, status codes, job status strings.
- **Prefer explicit over implicit** — no env-var fallbacks without clear defaults.
- **Never expose internal error details** to API clients.
- **Fargate-only** — no Railway, Lambda, or Replit-specific code should remain.
- **PWA only** — do NOT build native iOS/Android apps.
- **AWS RDS compatible** — standard Postgres indexes and JSONB. No Neon-specific features.
- **Do NOT split lead detail into popups/modals.** Keep single-page layout.
- **Do NOT remove any features.** All 9 tools, AI panels, comps, dialer, notes, tasks stay.

---

## PART 7: VERIFICATION CHECKLIST

### Already Done — Verify Only
- [ ] `python3 -m py_compile workers/main.py` passes
- [ ] `python3 -m py_compile workers/http_client.py` passes
- [ ] `npx tsc --noEmit` passes (api-server)
- [ ] `npx tsc --noEmit` passes (digor-tools)
- [ ] `npx tsc --noEmit` passes (digor-crm)
- [ ] All 5 AI endpoints have circuit breaker + timeout
- [ ] Email sequence job uses Postgres advisory lock
- [ ] Campaign deletion uses chunkArray(500)
- [ ] CSV upload wrapped in transaction
- [ ] `X-API-Key` present in all scraper engine calls
- [ ] Database indexes migration exists and is valid SQL

### Remaining Bugs to Fix
- [ ] `toE164` rejects invalid lengths (returns `null` for 9-digit, 7-digit, etc.)
- [ ] All callers of `toE164` handle `null` return correctly
- [ ] `getBaseUrl` in `links.ts` uses `PUBLIC_URL` env var, no unvalidated forwarded headers

### New Features
- [ ] **SMS Sequences:**
  - [ ] `crm_sms_opt_outs` table created
  - [ ] `smsService.ts` created with Twilio send logic
  - [ ] SMS step type supported in sequences
  - [ ] Opt-out endpoint exists
  - [ ] SMS delivery status tracked in `crm_sequence_logs`
  - [ ] Frontend sequence builder supports SMS steps
  - [ ] 160-char limit warning in SMS template editor
- [ ] **Direct Mail:**
  - [ ] `directMailService.ts` created with Brevo API integration
  - [ ] Direct mail step type supported in sequences
  - [ ] Address validation before sending
  - [ ] Webhook handler for Brevo status updates
  - [ ] Frontend sequence builder supports direct mail steps
  - [ ] Cost tracking per piece
- [ ] **PWA:**
  - [ ] `vite-plugin-pwa` added to `vite.config.ts`
  - [ ] `manifest.json` created with valid fields
  - [ ] Service worker caches static assets
  - [ ] Offline indicator shows when disconnected
  - [ ] Install prompt works on mobile browsers
  - [ ] All 9 tools are mobile-responsive (touch targets, font sizes, no horizontal scroll)
  - [ ] Satellite DFD has "Use my location" GPS button
  - [ ] Property Lookup supports camera/photos (optional)

### Excluded (Intentionally Left Out)
- [ ] ~~Redis for multi-instance state~~ — Not needed for single-task Fargate
- [ ] ~~Lead list Redis cache~~ — Not needed at current scale
- [ ] ~~PropertyAPI cooldown Maps in Redis~~ — Single task = in-memory is fine
- [ ] ~~Comps job store in Redis~~ — Single task = in-memory is fine
- [ ] ~~Skip trace / phone finder job stores in Redis~~ — Single task = in-memory is fine

---

## PART 8: HONEST SCOPE & PRIORITY

### Priority 1 (Must Have)
1. Fix `toE164` bug
2. Verify `getBaseUrl` security
3. SMS Sequences (core functionality)
4. PWA manifest + service worker + offline indicator
5. Mobile responsiveness for all 9 tools

### Priority 2 (Should Have)
6. Direct Mail via Brevo
7. SMS opt-out table + frontend
8. GPS location in Satellite DFD
9. PWA install prompt

### Priority 3 (Nice to Have)
10. Push notifications for job completion
11. Camera/photo support in Property Lookup
12. CAPTCHA solver
13. Direct mail webhook status tracking

### If Running Out of Time
- Skip Priority 3 items entirely
- Skip Direct Mail if SMS is working well (SMS is higher impact)
- Ensure PWA works minimally (manifest + service worker + offline indicator) even if install prompt is basic
