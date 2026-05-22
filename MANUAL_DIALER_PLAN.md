# Manual Dialer — OpenPhone-Like Feature Plan

**Route:** `/integrations/phone-numbers` (`PhoneNumbers.tsx`)
**Status:** MVP shipped — calls + SMS thread working. This plan covers the full upgrade path to a production-grade embedded comms inbox.

---

## Current State (as of May 2026)

| Feature | Status |
|---|---|
| Left column: owned Twilio numbers | ✅ Working |
| Middle column: conversation list (calls only) | ✅ Fixed — now shows calls + SMS contacts |
| Right column: unified call+SMS thread | ✅ Working |
| Dial pad for new conversations | ✅ Working |
| SMS compose + send | ✅ Working |
| Outbound call from thread | ✅ Fixed (`startCall` signature corrected) |
| Real-time transcript during active call | ✅ Fixed — dual-speaker bubbles with auto-scroll |
| Contact name resolution (CRM leads) | ⚠️ Shows only if `leadId` already linked |
| Inbound SMS notification | ✅ Real-time SSE push (Phase 2.1 complete); TDZ crash fixed |
| Unread badge counts | ❌ Not implemented |
| Active call overlay inside thread | ❌ Not implemented |
| Sound notifications (ring, new message) | ❌ Not implemented |
| Search across all conversations | ⚠️ Digit-only filter, no name search |

---

## Phase 1 — Foundation & Bug Fixes (DONE)

### 1.1 Fix `startCall` signature
**Done.** `PhoneNumbers.tsx:503` was calling `startCall(target, selectedNumber.number)` — second arg is `leadId: number|null`, not a string. Fixed to `startCall(target, null, fmtPhone(target), true)`.

### 1.2 Fix conversations API to include SMS contacts
**Done.** `GET /twilio/phone-numbers/:number/conversations` now runs a parallel query against `crm_openphone_messages` and unions SMS-only contacts into the conversation list. Response now includes `totalSms`, `lastActivity`, `lastSnippet` in addition to call fields.

### 1.3 Live transcript dual-speaker display
**Done.** `BrowserDialer.tsx` now renders `phone.liveTranscript[]` segments as chat bubbles: outbound (agent) right-aligned with primary tint, inbound (seller) left-aligned with secondary border. Auto-scrolls to latest segment via `useEffect` + `ref.scrollTop = ref.scrollHeight`.

---

## Phase 2 — Real-Time Updates & Active Call Overlay

### 2.1 SSE-driven conversation refresh ✅ DONE
**Problem:** Conversation list only refreshes on a 30s polling interval. Inbound calls and texts appear stale.

**Solution:**
- The CRM already subscribes to an SSE stream at `/api/crm/events` (from `PhoneContext`). Extend it with new event types:
  - `new_inbound_sms` — payload: `{ from, to, body, leadId }`
  - `call_logged` — payload: `{ callSid, from, to, direction, status }`
- On receiving either event in the page component, call `qc.invalidateQueries(["phone-number-convs", selectedNumber?.number])` immediately.
- API change: in the Twilio inbound SMS webhook handler (`POST /twilio/sms`), emit `new_inbound_sms` to all SSE clients in the campaign after inserting the message.
- In the call status callback (`POST /twilio/voice/status`), emit `call_logged` after `crm_call_logs` insert.

**Files:**
- `artifacts/api-server/src/routes/twilio.ts` (SMS webhook, status callback)
- `artifacts/api-server/src/lib/sse.ts` (broadcast helper)
- `artifacts/TolipAI-crm/src/pages/integrations/PhoneNumbers.tsx` (subscribe and invalidate)

### 2.2 Unread badge counts
**Problem:** No visual indication of unread messages.

**Solution:**
- Add `lastReadAt: timestamp | null` per (ownedNumber, contactNumber) pair to a new lightweight `crm_phone_read_receipts` table.
  ```sql
  CREATE TABLE crm_phone_read_receipts (
    id          SERIAL PRIMARY KEY,
    campaign_id INTEGER NOT NULL,
    owned_number TEXT NOT NULL,
    contact     TEXT NOT NULL,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id, owned_number, contact)
  );
  ```
- The conversations API returns `unreadCount: number` per entry — count messages/calls with `createdAt > lastReadAt` (or `lastReadAt IS NULL`).
- `POST /twilio/phone-numbers/:number/conversations/:contact/read` — upserts `lastReadAt = now()`.
- Call it when a contact thread is opened.
- Show an amber badge `(N)` on the `ConversationItem` when `unreadCount > 0`.

**Files:**
- `lib/db/src/schema/crm.ts` (new table)
- `artifacts/api-server/src/routes/twilio.ts` (conversations query, new read endpoint)
- `artifacts/TolipAI-crm/src/pages/integrations/PhoneNumbers.tsx` (badge + mark-read call)

### 2.3 Active call overlay inside the thread view
**Problem:** When a call is in progress, the thread view shows no indication; the dialer is embedded in the lead detail page only.

**Solution:**
- `PhoneContext` already exposes `phone.status`, `phone.liveTranscript`, `phone.currentCallSid`, `phone.remoteNumber` (add this field: the E.164 of the other party).
- In `PhoneNumbers.tsx`, add a floating `ActiveCallBanner` when `phone.status !== "idle"` and `phone.remoteNumber === selectedContact`:
  ```tsx
  {phone.status !== "idle" && phone.remoteNumber === selectedContact && (
    <ActiveCallBanner
      status={phone.status}
      duration={callTimer}
      transcript={phone.liveTranscript}
      onHangup={phone.hangup}
      onHold={phone.toggleHold}
    />
  )}
  ```
- `ActiveCallBanner` is a sticky panel above the compose box. It shows:
  - Live call timer
  - Status pill (Calling… / Connected / On Hold)
  - Last 3 transcript segments as a mini preview
  - Hang up + Hold buttons
- No new API calls needed — `PhoneContext` already has all the data.

**Files:**
- `artifacts/TolipAI-crm/src/contexts/PhoneContext.tsx` (expose `remoteNumber`)
- `artifacts/TolipAI-crm/src/pages/integrations/PhoneNumbers.tsx` (ActiveCallBanner component)

---

## Phase 3 — Contact Intelligence

### 3.1 Resolve contact names from CRM leads
**Problem:** The conversation list shows raw phone numbers. Contacts that match a CRM lead should show the seller's name.

**Solution A (server-side, recommended):**
- In the conversations API response, for each contact, query `crm_leads` where `RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) = contactDigits` and return `leadName` and `leadAddress`.
- Cache result: the conversation list query already runs once per 30s.

**Solution B (client-side):**
- Pre-fetch all lead phone → name mappings once on page mount (lightweight query).
- Store as `Map<string, { id: number; name: string; address: string }>` keyed by 10-digit normalized number.
- Resolve in `ConversationItem` and the thread header.

**Recommendation:** Solution B for speed (no join in the hot path), Solution A for correctness.

**Files:**
- `artifacts/api-server/src/routes/twilio.ts` (if Solution A)
- `artifacts/TolipAI-crm/src/pages/integrations/PhoneNumbers.tsx` (both solutions)

### 3.2 Link unrecognized contacts to CRM leads
**Problem:** SMS contacts that have never been called won't have a `leadId`.

**Solution:**
- When a thread is opened for an unknown contact (no `leadId`), show a "Link to Lead" button.
- Clicking it opens a `LeadSearchModal` (typeahead search by name/address/phone).
- On selection, `PATCH /twilio/phone-numbers/:number/conversations/:contact/link-lead` updates all `crm_call_logs` and `crm_openphone_messages` rows for that contact to set `leadId`.

**Files:**
- `artifacts/api-server/src/routes/twilio.ts` (new PATCH endpoint)
- `artifacts/TolipAI-crm/src/pages/integrations/PhoneNumbers.tsx` (modal + button)

---

## Phase 4 — Inbound Routing per Number

### 4.1 Per-number inbound configuration
**Problem:** All inbound calls route through a single campaign-level TwiML voice URL. There is no per-owned-number routing configuration.

**Solution:**
- Add a `crm_phone_number_configs` table:
  ```sql
  CREATE TABLE crm_phone_number_configs (
    id              SERIAL PRIMARY KEY,
    campaign_id     INTEGER NOT NULL REFERENCES crm_campaigns(id),
    phone_number    TEXT NOT NULL,
    forward_to      TEXT,           -- E.164 number to forward to
    greeting_text   TEXT,           -- TTS greeting for IVR
    voicemail_url   TEXT,           -- recording URL for voicemail drop
    ai_agent_enabled BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (campaign_id, phone_number)
  );
  ```
- In the Twilio inbound voice webhook, look up `crm_phone_number_configs` by the `To` number. Route to:
  1. Forward to `forward_to` number (if set), simultaneously ringing browser agents.
  2. AI agent if `ai_agent_enabled = true` (existing `gpt-4o-realtime-preview` path).
  3. Voicemail drop using `voicemail_url`.
- Expose a simple config panel in the PhoneNumbers page (right-click or gear icon on a number in the left column).

**Files:**
- `lib/db/src/schema/crm.ts` (new table)
- `artifacts/api-server/src/routes/twilio-voice.ts` (inbound webhook)
- `artifacts/TolipAI-crm/src/pages/integrations/PhoneNumbers.tsx` (config panel)

### 4.2 Inbound SMS auto-reply
**Problem:** Inbound SMS has no automation.

**Solution:**
- In the `POST /twilio/sms` webhook, if an existing campaign auto-reply template matches, immediately respond with `<Response><Message>...</Message></Response>`.
- Store templates in a new `crm_sms_templates` table per campaign.
- Optionally, trigger the Groq-based AI to draft a reply (async — separate SSE event).

---

## Phase 5 — Notifications & UX Polish

### 5.1 Notification sounds
- On `new_inbound_sms` SSE event: play a subtle chime (`/sounds/message.mp3`) if the page is focused.
- On inbound call event (already in `PhoneContext`): play a ring tone.
- Use `document.visibilityState` to suppress sounds when the tab is in the background (or always play — user preference).

### 5.2 Browser push notifications
- Request `Notification` permission on first page load.
- On `new_inbound_sms` when tab is hidden: `new Notification("New SMS from " + fmtPhone(from), { body: snippet, icon: "/logo.png" })`.
- Click on notification → focus tab and navigate to the thread.

### 5.3 Search across all conversations
- Current search is digit-only (strips non-digits and does `includes`).
- Extend: if the contact map has `leadName` populated (Phase 3.1), also match on name.
- Add `filteredConvs` to also match on `lastSnippet` content.

### 5.4 Conversation pinning and archiving
- Add `pinned: boolean` and `archived: boolean` to `crm_phone_read_receipts` (reuse the table).
- Pinned conversations float to the top of the list.
- Archived conversations are hidden from the default view (toggle to show).

---

## Data Flow Summary

```
Inbound SMS (Twilio webhook)
  → POST /twilio/sms
  → Insert into crm_openphone_messages
  → Emit SSE new_inbound_sms to campaign clients
    → PhoneNumbers.tsx invalidates conversation list query
    → ConversationItem shows unread badge (Phase 2.2)
    → Browser notification if tab hidden (Phase 5.2)

Outbound SMS (from compose box)
  → POST /twilio/messages
  → Twilio delivers
  → Insert into crm_openphone_messages (on callback)
  → Invalidate thread query

Inbound Call
  → POST /twilio/voice (TwiML webhook)
  → Lookup crm_phone_number_configs for routing
  → Ring browser agents (existing PhoneContext SSE)
  → On answer: connect to conference
  → Transcript SSE → PhoneContext → liveTranscript[]
    → ActiveCallBanner renders in PhoneNumbers thread view (Phase 2.3)

Outbound Call (from thread)
  → startCall(target, null, fmtPhone(target), true)
  → PhoneContext initiates Twilio Device call
  → On completion: POST /twilio/voice/status webhook
  → Insert crm_call_logs
  → Emit SSE call_logged
  → Invalidate conversation list
```

---

## Implementation Priority Order

| Priority | Phase | Effort | Value |
|---|---|---|---|
| 1 | 2.1 SSE-driven refresh | Small (1–2h) | High — removes 30s staleness |
| 2 | 3.1 Lead name resolution | Small (1h) | High — huge UX improvement |
| 3 | 2.3 Active call overlay | Medium (2–3h) | High — critical for dialer use |
| 4 | 2.2 Unread badges | Medium (3–4h) | High — essential for inbox feel |
| 5 | 4.1 Per-number routing config | Large (4–6h) | Medium — power feature |
| 6 | 5.1/5.2 Notifications | Small (2h) | Medium — nice-to-have |
| 7 | 3.2 Link-to-lead | Medium (2–3h) | Medium — ops quality |
| 8 | 4.2 Auto-reply SMS | Medium (2–3h) | Medium — automation |
| 9 | 5.4 Pin/Archive | Small (1–2h) | Low — power user feature |

---

## Key Design Decisions

**Why `crm_openphone_messages` for Twilio SMS?**
The table was originally created for OpenPhone webhook data but its schema (`fromNumber`, `toNumber`, `body`, `leadId`, `campaignId`, `createdAt`) is a perfect fit for Twilio SMS too. Reusing it avoids schema fragmentation. Both OpenPhone and Twilio messages appear in the same thread view.

**Why not a dedicated `crm_messages` table?**
The existing `crmSmsConversations` table (`crm_sms_conversations`) stores AI-generated draft messages for the lead detail page, not actual sent/received Twilio messages. It is scoped to leads, not phone numbers. Creating a parallel `crm_messages` table would introduce two sources of truth. The plan is to migrate all real message traffic to `crm_openphone_messages` and eventually rename it to `crm_messages`.

**Real-time transcript architecture:**
Twilio Voice Intelligence streams `call_transcript` events via SSE from the API server to `PhoneContext`. Segments are typed as `{ track: "inbound" | "outbound", text: string, ts: number }`. "inbound" = audio from the remote party (seller). "outbound" = audio from the browser agent. The BrowserDialer renders these as aligned chat bubbles in real time. The same `liveTranscript[]` array feeds the post-call AI summary (no recording required).

**`startCall` is not free:** Every call to `startCall` in `PhoneContext` initializes a Twilio WebRTC connection, burns a Twilio minute, and creates a `crm_call_logs` entry. PhoneNumbers.tsx was previously passing `selectedNumber.number` (a string E.164) as `leadId` (expected `number | null`). TypeScript caught this; it is now `null` (no lead linked). The call will still be logged in `crm_call_logs` with `fromNumber` and `toNumber` set correctly — it just won't link to a CRM lead. Phase 3.2 covers retroactively linking calls to leads.
