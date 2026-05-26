---
name: Twilio webhook security
description: All public Twilio POST webhooks now validate X-Twilio-Signature via twilioWebhookMiddleware. Hard-fails if TWILIO_AUTH_TOKEN not set.
---

# Twilio Webhook Security

**Rule:** Every public Twilio webhook (called by Twilio servers, not by CRM browser agents) must use `twilioAuth` middleware.

**How:** Import and apply `twilioWebhookMiddleware` from `artifacts/api-server/src/lib/twilioWebhookMiddleware.ts`:
```typescript
const twilioAuth = twilioWebhookMiddleware();
router.post("/twilio/voice/some-webhook", twilioAuth, handler);
```

**Why:** Without signature validation, any actor who knows the URL can forge Twilio callbacks, spoof call statuses, inject recordings, or trigger TwiML responses.

**How to apply:** Add `twilioAuth` as the second argument to every `router.post` that Twilio calls directly (voice webhooks, SMS webhooks, status callbacks, recording callbacks). Routes called only by CRM browser agents use `crmAuth` instead.

**Behavior when token missing:** Hard-fails with 500 (not a silent pass-through) — operator must fix the config.

**Routes protected as of last audit:**
- `/twilio/voice/answer` ✅
- `/twilio/voice/inbound` ✅
- `/twilio/voice/inbound-no-answer` ✅
- `/twilio/voice/join-conference` ✅
- `/twilio/voice/conference-status` ✅
- `/twilio/voice/call-status` ✅
- `/twilio/voice/status` ✅ (legacy alias)
- `/twilio/voice/recording` ✅
- `/twilio/voice/transcript` ✅
