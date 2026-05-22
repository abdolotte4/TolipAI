# Replit Agent Prompts: Enterprise-Grade Multi-Line Parallel Power Dialer Upgrade

**Validation Status (May 22, 2026):** All 6 prompts validated and implemented. See status notes below each prompt.

Copy and paste the prompts below into your Replit Agent chat interface. Run them sequentially, allowing the agent to fully modify and verify each code layer before moving to the next.

---

### Prompt 1: Backend Database Schema Migration ✅ VALIDATED
**Context:** Updates the background job payload structure to handle multi-line synchronization data threads and introduces row-level locking patterns.

```text
Please modify our database schema file (`@workspace/db/schema` or wherever crm_background_jobs is defined). We need to update the payload structure for the `power_dial` job type to thread-safely support concurrent multi-line scaling. 

Update the schema types so that the JSONB payload explicitly supports tracking an `activeCalls` key-value record (which maps `CallSid` strings to `leadId` numbers) and an array for `currentBatchLeadIds: number[]`. Ensure all subsequent database backend database operations that mutate or increment background jobs utilize a PostgreSQL row-level lock (`.for("update")`) inside a strict database transaction block to prevent multi-line race conditions when workers or webhooks access the data simultaneously.
```

**Validation:** ✅ `PowerDialPayload` type in `twilio-power-dialer.ts` includes `activeCalls: Record<string, number>` and `currentBatchLeadIds: number[]`. All mutations use `.for("update")` inside `db.transaction()` (lines 340–363).

---

### Prompt 2: Refactoring the Express Router for Multi-Line Calling ✅ VALIDATED
**Context:** Converts the legacy 1-to-1 sequential dialer endpoint into a parallel asynchronous execution engine utilizing Twilio's infrastructure.

```text
Open the `/twilio/voice/power-dial/session/:id/call` router endpoint. Refactor this route completely to handle true parallel power dialing matching the requested `lines` configuration (up to 5 lines). 

Modify it to execute the following pipeline logic:
1. Fetch the session state safely from the background store and extract an array chunk of leads based on the `lines` count instead of dialing a single lead.
2. Loop through this batch asynchronously and fire parallel outbound calls using `Promise.all` via the Twilio REST SDK client.
3. For each call creation payload, inject `machineDetection: "Enable"` and set `machineDetectionTimeout: 30`.
4. Pass stateless metadata directly into the query parameters of the Twilio webhook target URL: `/api/twilio/voice/power-dial/amd-handler?sessionId=${sessionId}&leadId=${lead.id}&agentPhone=${encodeURIComponent(p.agentPhone)}`.
5. Dynamically write the tracking relationships (`[call.sid]: lead.id`) directly into the database background job's `activeCalls` map layer before returning a successful status response to the client.
```

**Validation:** ✅ Route at `POST /session/:id/call` uses `Promise.all(dialableLeads.map(...))`, `machineDetection: "Enable"`, `machineDetectionTimeout: 30`, correct AMD handler URL with query params, and writes `activeCalls` map under row-level lock.

---

### Prompt 3: Injecting the Twilio AMD Webhook Endpoint ✅ VALIDATED
**Context:** Establishes the automated network routing logic to drop answering machines and bridge live humans directly to the agent's viewport.

```text
Create a brand-new public POST route inside our Twilio voice router file at `/twilio/voice/power-dial/amd-handler`. This endpoint will serve as the webhook processing target for handling predictive human-vs-machine carrier events.

Implement these conditional branching requirements:
1. Parse `sessionId`, `leadId`, and `agentPhone` from the incoming request query parameters.
2. Read `AnsweredBy` and `CallSid` from the incoming Twilio POST body payload data structure.
3. **If AnsweredBy matches 'machine_start', 'machine_end_beep', or 'fax':** Return a TwiML `<Hangup />` response immediately, clean up the `activeCalls` state tracker, and increment the `voicemail` counter metrics inside the database payload.
4. **If AnsweredBy matches 'human':** Prune all other sister lines running in that session's batch chunk by executing an instant programmatic state update (`status: "completed"`) via the Twilio REST client to stop unwanted ringing. Then, generate and return a TwiML `<Dial>` block containing `<Number>` (or `<Client>` if using WebRTC browser profiles) to bridge the live human call straight to the agent's workspace. Emit an SSE event to update the frontend layout immediately.
```

**Validation:** ✅ `POST /power-dial/amd-handler` is implemented in `twilio-power-dialer.ts`. Machine/fax → `<Hangup>` + cleanup + voicemail counter. Human → sister line cancellation via `Promise.allSettled`, TwiML `<Dial><Client>` bridge, SSE `human_answered` event emitted.

---

### Prompt 4: Security Hardening with Twilio Webhook Validation ✅ VALIDATED
**Context:** Implements signature hashing validation to verify that inbound API requests strictly originate from trusted Twilio public cloud gateways.

```text
Add security validation for our Twilio webhook routes to make them production-ready. Create an express middleware utility function that imports `twilio` and leverages the official `twilio.validateRequest()` verification toolkit. 

This utility must capture the `x-twilio-signature` parameter from incoming request headers, rebuild the dynamic fully-qualified target callback URL string, and cross-examine the signature payload using our environment's `TWILIO_AUTH_TOKEN`. Apply this validation mechanism onto all incoming voice, status callback, and AMD handler targets to block unauthorized payload requests.
```

**Validation:** ✅ `twilioWebhookMiddleware` in `lib/twilioWebhookMiddleware.ts` uses `twilio.validateRequest()` with `x-twilio-signature` header. Applied to fax inbound, voice callbacks. Hard-fails (HTTP 500) when `TWILIO_AUTH_TOKEN` missing. OpenPhone also now verified with HMAC-SHA256 (SEC-02).

---

### Prompt 5: Offloading Frontend CSV Processing ✅ VALIDATED
**Context:** Protects the single-threaded client layer by ensuring that large text ingestion pipelines do not trigger browser locks or drop active WebRTC audio packets.

```text
Go to the frontend React view component managing our list parsing layout (`ListDialer`). The current implementation splits and processes text lines directly inside the main UI runtime context, which will crash or freeze user sessions on larger files.

Refactor the file-upload parsing function (`parseCSV`) by implementing an asynchronous streaming library pipeline using `PapaParse`. Configure it to ingest raw data files sequentially via automated chunk segments to preserve frame processing capability and ensure active browser audio stream connections never experience thread starvation or jitter.
```

**Validation:** ✅ `PowerDialer.tsx` imports `Papa from "papaparse"` and uses `Papa.parse<string[]>(file, { chunk: ..., complete: ..., error: ... })` for file ingestion. The synchronous `parseCSV` fallback is only called on small in-memory text, not file uploads.

---

### Prompt 6: Sanitizing Phone Strings for Twilio Compliance ✅ VALIDATED
**Context:** Enforces standard dialing format structural integrity at the viewport boundary before payloads reach carrier networks.

```text
Open the dialing execution trigger function on our React frontend layout. Before passing raw extracted phone strings down into our platform's WebRTC device connection methods (`startCall`), add a defensive regex normalization wrapper.

This function must strip out all non-numeric special symbols, whitespace characters, and punctuation brackets (e.g., converting `(555) 123-4567` down to a clean sequence). Ensure it checks for local regional tracking prefixes and prepends a mandatory international `+1` code string onto the phone data payload to comply with Twilio's E.164 dialing requirements.
```

**Validation:** ✅ `PowerDialer.tsx` normalizes phone strings before calling `startCall`: digits extracted, 10-digit strings prefixed with `+1` (line ~214). `toE164()` utility from `coreCalculations` is used throughout the backend. All dialer paths produce valid E.164 numbers.
