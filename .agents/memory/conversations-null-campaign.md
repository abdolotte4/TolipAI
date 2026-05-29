---
name: Conversations query includes null-campaign call logs
description: The conversations list and thread queries use OR IS NULL so call logs pre-inserted before campaignId is resolved remain visible.
---

## The rule
Everywhere `crmCallLogs.campaignId` is filtered in the conversations endpoints, the condition must be:
```ts
or(eq(crmCallLogs.campaignId, targetCampaignId), isNull(crmCallLogs.campaignId))
```
**Never** use a bare `eq(crmCallLogs.campaignId, X)` — that hides call logs whose campaignId was null at pre-insert time.

## Why
The `/voice/answer` webhook pre-inserts a call log row before the full campaign resolution completes. If the accountSid lookup fails and the phone-number fallback also misses (race condition, new number), `campaignId` stays null. A strict equality filter makes those rows invisible in the conversations inbox.

## Files and line numbers (as of May 2026)
- `artifacts/api-server/src/routes/twilio.ts`
  - Conversations list query — line ~1231
  - Thread query (by contact) — line ~1433
  - Thread query (by callSid) — line ~1560

## Imports needed
```ts
import { eq, desc, and, sql, isNotNull, or, isNull } from "drizzle-orm";
```
Both `or` and `isNull` must be imported from drizzle-orm (they were missing before this fix).

## Super-admin exception
Super-admin users see ALL conversations already (no campaignId filter applied), so this fix only affects non-super-admin user queries.
