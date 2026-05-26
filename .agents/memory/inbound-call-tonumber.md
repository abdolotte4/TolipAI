---
name: Inbound call toNumber bug
description: /voice/log POST was overwriting toNumber with null for inbound calls, breaking the conversations list matching.
---

## The rule
`POST /api/twilio/voice/log` must only update `fromNumber`/`toNumber` if the new value is non-null. Never overwrite an existing DB value with null.

**Why:** When an inbound call is accepted, `acceptIncoming()` in PhoneContext posts to `/voice/log` with `toNumber: null` (the agent doesn't know the owned number). The `/voice/inbound` webhook had already inserted the call log with the correct `toNumber` (the owned Twilio number). Overwriting it with null caused the conversations endpoint (which matches on `from_number` OR `to_number`) to stop finding the call, making it invisible in the Phone Numbers inbox.

**How to apply:** In the `/voice/log` handler, build a `numberPatch` object only with fields that are non-null, then spread it into `.set()`:
```ts
const numberPatch: Record<string, any> = {};
if (resolvedFromNumber !== null) numberPatch.fromNumber = resolvedFromNumber;
if (resolvedToNumber   !== null) numberPatch.toNumber   = resolvedToNumber;
db.update(crmCallLogs).set({ ...otherValues, ...numberPatch }).where(...)
```
