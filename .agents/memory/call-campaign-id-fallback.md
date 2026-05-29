---
name: Call log campaignId phone-number fallback
description: /voice/answer pre-inserts and /voice/log now fall back to matching campaign by owned phone number when accountSid lookup fails.
---

## The problem
Manual Dialer phone calls were not creating conversations. The pre-insert in `/voice/answer` and the upsert in `/voice/log` both looked up the campaign using `twilioAccountSid`. Super-admin users (who call via any campaign's number) always had a null `twilioAccountSid` match, leaving `campaignId = null` on the call log. The conversations list query filtered strictly by `campaignId = userId.campaignId`, so those null-campaign logs were invisible.

## The fix (three layers)

### Layer 1 — `/voice/answer` conference pre-insert (twilio-voice.ts ~line 370)
After `accountSid` lookup fails, do a digit-only regex match against `crmCampaigns.twilioPhoneNumber`:
```ts
const callerDigits = callerId.replace(/\D/g, "").slice(-10);
const byPhone = await db.select({ id: crmCampaigns.id })
  .from(crmCampaigns)
  .where(sql`regexp_replace(${crmCampaigns.twilioPhoneNumber}, '[^0-9]', '', 'g') LIKE ${"%" + callerDigits}`)
  .limit(1);
resolvedCampaignId = byPhone[0]?.id ?? null;
```
Same fallback applied to the fallback path (`/voice/answer` no-conference branch, ~line 446).

### Layer 2 — `/voice/log` upsert (twilio-voice.ts ~line 896)
When neither `crmUser.campaignId` nor `leadId` resolves a campaign, fall back to matching `fromNumber` (the owned Twilio number on outbound calls) against `crmCampaigns.twilioPhoneNumber`:
```ts
const fromDigits = fromNumber.replace(/\D/g, "").slice(-10);
const byPhone = await db.select({ id: crmCampaigns.id })
  .from(crmCampaigns)
  .where(sql`regexp_replace(${crmCampaigns.twilioPhoneNumber}, '[^0-9]', '', 'g') LIKE ${"%" + fromDigits}`)
  .limit(1);
resolvedCampaignId = byPhone[0]?.id ?? null;
```

### Layer 3 — Conversation query includes null-campaign rows (twilio.ts)
See `conversations-null-campaign.md` — the query now uses `or(eq(campaignId, X), isNull(campaignId))` so pre-inserted logs that still have null campaignId are still visible.

## How to apply
If you add a new code path that inserts a call log before the campaign is resolved, always add the phone-number digit fallback. Never let a call log reach the DB with a missing campaignId if any owned number can be matched.
