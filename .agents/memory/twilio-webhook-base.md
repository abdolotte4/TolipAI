---
name: Twilio webhook base URL
description: How getWebhookBase() and buildWebhookUrl() build production callback URLs for Twilio
---

## Key constraint
`API_BASE_URL` = `https://tolipai.com/api` (already includes the `/api` path prefix).

## getWebhookBase() — webhookBase.ts
Returns `API_BASE_URL` as-is. Callers append only the route suffix, e.g. `/twilio/voice/answer`.
Never append `/api` after calling this function — it's already included.

## buildWebhookUrl() — twilioWebhookMiddleware.ts
Used to reconstruct the exact URL Twilio signed. `req.originalUrl` starts with `/api/...`
because routes are mounted at `/api`. Must strip the base pathname (`/api`) from
`req.originalUrl` before appending, otherwise the validated URL becomes
`https://tolipai.com/api/api/twilio/voice/answer` → signature mismatch → 403 on all webhooks.

**Why:** The double-`/api` bug was invisible in dev (no `API_BASE_URL` set) but broke every
inbound Twilio webhook in production with 403 Forbidden.

**How to apply:**
- `getWebhookBase(req)` → use directly, no extra `/api` needed
- `buildWebhookUrl(req)` → strips base path prefix from `req.originalUrl` internally
- Never manually do `${API_BASE_URL}/api/...` — that's always wrong
- REPLIT_DEV_DOMAIN must never override API_BASE_URL
