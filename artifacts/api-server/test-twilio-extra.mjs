/**
 * Extra Twilio tests — edge cases, regression guards, and live endpoint checks.
 *
 * Run:
 *   node artifacts/api-server/test-twilio-extra.mjs
 *
 * No npm packages — uses only built-in Node.js crypto.
 */

import { createHmac } from "crypto";

// ── Harness ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function ok(label) { console.log("  \u2705  " + label); passed++; }
function fail(label, detail) {
  console.error("  \u274C  " + label + (detail ? "\n       " + detail : ""));
  failed++;
  failures.push(label + (detail ? " — " + detail : ""));
}
function assert(cond, label, detail) { cond ? ok(label) : fail(label, detail); }
function section(t) { console.log("\n\u2500\u2500 " + t + " " + "\u2500".repeat(Math.max(0, 58 - t.length)) + "\n"); }

// ── Twilio helpers ────────────────────────────────────────────────────────────

function sign(token, url, params) {
  let s = url;
  for (const k of Object.keys(params).sort()) s += k + (params[k] ?? "");
  return createHmac("sha1", token).update(s).digest("base64");
}

function validate(token, sig, url, params) {
  return sign(token, url, params) === sig;
}

function buildUrl(originalUrl, apiBase, headers) {
  if (apiBase) {
    const base = apiBase.replace(/\/+$/, "");
    const m = base.match(/^https?:\/\/[^/]+(\/[^?#]*)?/);
    const basePath = (m?.[1] ?? "").replace(/\/+$/, "");
    const reqPath = basePath && originalUrl.startsWith(basePath)
      ? originalUrl.slice(basePath.length) : originalUrl;
    return base + reqPath;
  }
  const proto = headers?.["x-forwarded-proto"] || "https";
  const host = headers?.["x-forwarded-host"] || headers?.host || "localhost";
  return proto + "://" + host + originalUrl;
}

const API = "https://tolipai.com/api";
const TOK = "test_auth_token_abcdef123456";

// ═══════════════════════════════════════════════════════════════════════════════
// 1. URL edge cases
// ═══════════════════════════════════════════════════════════════════════════════

section("1. URL edge cases");

// Trailing slash on API_BASE_URL stripped
assert(buildUrl("/api/twilio/voice/answer", "https://tolipai.com/api/", {}) === "https://tolipai.com/api/twilio/voice/answer",
  "trailing slash on API_BASE_URL is stripped correctly");

// Multiple trailing slashes
assert(buildUrl("/api/twilio/webhook", "https://tolipai.com/api///", {}) === "https://tolipai.com/api/twilio/webhook",
  "multiple trailing slashes on API_BASE_URL stripped");

// Query string preserved
assert(buildUrl("/api/twilio/voice/conference-status?agentCallSid=CA99&foo=bar", API, {}) ===
  "https://tolipai.com/api/twilio/voice/conference-status?agentCallSid=CA99&foo=bar",
  "query string parameters preserved in reconstructed URL");

// Path not starting with basePath — leave untouched (safety net)
const weird = buildUrl("/other/path", API, {});
assert(weird === "https://tolipai.com/api/other/path",
  "non-/api path appended safely (no double /api)");

// Power dialer callback
assert(buildUrl("/api/twilio/voice/power-dial/call-status?sessionId=xyz&foo=1", API, {}) ===
  "https://tolipai.com/api/twilio/voice/power-dial/call-status?sessionId=xyz&foo=1",
  "power dialer callback URL correct");

// Dev fallback — multiple x-forwarded-host values (comma-separated, Railway pattern)
const commaHost = buildUrl("/api/twilio/voice/answer", "", { "x-forwarded-proto": "https", "x-forwarded-host": "tolipai.com, 10.0.0.1" });
// Our code takes first value
assert(commaHost.startsWith("https://tolipai.com"), "comma-separated x-forwarded-host: first value used", commaHost);

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Signature edge cases
// ═══════════════════════════════════════════════════════════════════════════════

section("2. Signature edge cases");

// Empty params
{
  const url = "https://tolipai.com/api/twilio/voice/ringback";
  const params = {};
  const sig = sign(TOK, url, params);
  assert(validate(TOK, sig, url, params), "empty params: signature valid");
  assert(!validate(TOK, sig, url + "/extra", params), "extra path segment invalidates signature");
}

// Params with special characters
{
  const url = "https://tolipai.com/api/twilio/voice/call-status";
  const params = { CallSid: "CA123", CallStatus: "in-progress", Direction: "outbound-api", From: "+1 (415) 867-5309" };
  const sig = sign(TOK, url, params);
  assert(validate(TOK, sig, url, params), "special chars in params: signature valid");
}

// Params sorted alphabetically (Twilio requirement)
{
  const url = "https://tolipai.com/api/twilio/webhook";
  const paramsA = { Body: "hello", From: "+15005550001", MessageSid: "SM123", To: "+15005550006" };
  const paramsB = { To: "+15005550006", From: "+15005550001", Body: "hello", MessageSid: "SM123" }; // different insertion order
  const sigA = sign(TOK, url, paramsA);
  const sigB = sign(TOK, url, paramsB);
  assert(sigA === sigB, "param ordering doesn't matter — always sorted alphabetically");
  assert(validate(TOK, sigA, url, paramsB), "cross-order validation passes");
}

// Case sensitivity — keys are case-sensitive
{
  const url = "https://tolipai.com/api/twilio/voice/answer";
  const params = { callsid: "CA123" }; // wrong case
  const correctParams = { CallSid: "CA123" };
  const sig = sign(TOK, url, correctParams);
  assert(!validate(TOK, sig, url, params), "param keys are case-sensitive (callsid ≠ CallSid)");
}

// Signature is Base64 — contains no whitespace
{
  const sig = sign(TOK, "https://tolipai.com/api/twilio/voice/answer", { CallSid: "CA1" });
  assert(!/\s/.test(sig), "signature contains no whitespace (valid Base64)");
  assert(sig.length === 28, "SHA-1 HMAC Base64 length is always 28 chars", "got: " + sig.length);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Inbound SMS flow simulation
// ═══════════════════════════════════════════════════════════════════════════════

section("3. Inbound SMS flow simulation");

{
  const webhookUrl = "https://tolipai.com/api/twilio/webhook";
  const smsBody = { From: "+14155551234", To: "+19175550001", Body: "I want to sell my house", MessageSid: "SM_test_001", AccountSid: "ACtest" };
  const campaignToken = "campaign_specific_auth_token_999";
  const sig = sign(campaignToken, webhookUrl, smsBody);

  // New code reconstructs URL correctly
  const reconstructed = buildUrl("/api/twilio/webhook", API, {});
  assert(reconstructed === webhookUrl, "SMS webhook URL reconstructed (no double /api)", reconstructed);
  assert(validate(campaignToken, sig, reconstructed, smsBody), "campaign auth token validates SMS");

  // STOP message — opt-out keyword
  const stopBody = { ...smsBody, Body: "STOP", MessageSid: "SM_stop_001" };
  const stopSig = sign(campaignToken, webhookUrl, stopBody);
  assert(validate(campaignToken, stopSig, reconstructed, stopBody), "STOP message signature validates");

  // Replied STOP with different case
  const stopBody2 = { ...smsBody, Body: "stop", MessageSid: "SM_stop_002" };
  const stopSig2 = sign(campaignToken, webhookUrl, stopBody2);
  assert(validate(campaignToken, stopSig2, reconstructed, stopBody2), "lowercase stop signature validates");

  // Different campaign token FAILS for another campaign's number
  const wrongToken = "wrong_campaign_token_000";
  assert(!validate(wrongToken, sig, reconstructed, smsBody), "wrong campaign token rejected");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Inbound call flow simulation
// ═══════════════════════════════════════════════════════════════════════════════

section("4. Inbound call flow simulation");

{
  const inboundUrl = "https://tolipai.com/api/twilio/voice/inbound";
  const callBody = {
    AccountSid: "ACtest_camp",
    CallSid: "CA_inbound_001",
    From: "+14155551234",
    To: "+19175550001",
    CallStatus: "ringing",
    Direction: "inbound",
    ApiVersion: "2010-04-01",
  };
  const campToken = "campaign_voice_token_abc";
  const sig = sign(campToken, inboundUrl, callBody);

  const recon = buildUrl("/api/twilio/voice/inbound", API, {});
  assert(recon === inboundUrl, "inbound URL reconstructed correctly");
  assert(validate(campToken, sig, recon, callBody), "inbound call signature validates");
  assert(!validate(campToken, sig, recon + "-extra", callBody), "extra path segment rejects signature");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Outbound call lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

section("5. Outbound call lifecycle");

{
  const campToken = "outbound_campaign_token_xyz";

  // answer (TwiML App Voice URL)
  const answerUrl = "https://tolipai.com/api/twilio/voice/answer";
  const answerBody = { CallSid: "CA_out_001", AccountSid: "ACtest", To: "+14155559876", From: "+19175550001", Direction: "outbound-api" };
  const answerSig = sign(campToken, answerUrl, answerBody);
  assert(validate(campToken, answerSig, buildUrl("/api/twilio/voice/answer", API, {}), answerBody),
    "/voice/answer sig validates (outbound call start)");

  // call-status (StatusCallback)
  const statusUrl = "https://tolipai.com/api/twilio/voice/call-status";
  for (const callStatus of ["initiated", "ringing", "in-progress", "completed", "failed", "busy", "no-answer"]) {
    const statusBody = { CallSid: "CA_out_001", AccountSid: "ACtest", CallStatus: callStatus, CallDuration: "30" };
    const statusSig = sign(campToken, statusUrl, statusBody);
    assert(validate(campToken, statusSig, buildUrl("/api/twilio/voice/call-status", API, {}), statusBody),
      "/voice/call-status sig validates (status=" + callStatus + ")");
  }

  // recording callback
  const recUrl = "https://tolipai.com/api/twilio/voice/recording";
  const recBody = { CallSid: "CA_out_001", AccountSid: "ACtest", RecordingSid: "RE_001", RecordingUrl: "https://api.twilio.com/rec/RE_001", RecordingStatus: "completed" };
  const recSig = sign(campToken, recUrl, recBody);
  assert(validate(campToken, recSig, buildUrl("/api/twilio/voice/recording", API, {}), recBody),
    "/voice/recording sig validates");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Conference call lifecycle (power dialer)
// ═══════════════════════════════════════════════════════════════════════════════

section("6. Conference/power-dialer call lifecycle");

{
  const campToken = "power_dialer_token_pdl";
  const sessionId = "session_abc_123";

  // power-dial call-status
  const pdStatusUrl = "https://tolipai.com/api/twilio/voice/power-dial/call-status?sessionId=" + encodeURIComponent(sessionId);
  const pdBody = { CallSid: "CA_pd_001", AccountSid: "ACtest", CallStatus: "completed", CallDuration: "60" };
  const pdSig = sign(campToken, pdStatusUrl, pdBody);
  assert(validate(campToken, pdSig,
    buildUrl("/api/twilio/voice/power-dial/call-status?sessionId=" + encodeURIComponent(sessionId), API, {}),
    pdBody), "power-dial call-status sig validates (with query string)");

  // conference-status
  const confStatusUrl = "https://tolipai.com/api/twilio/voice/conference-status?agentCallSid=CA_agent_001";
  const confBody = { AccountSid: "ACtest", ConferenceSid: "CF_001", StatusCallbackEvent: "participant-join" };
  const confSig = sign(campToken, confStatusUrl, confBody);
  assert(validate(campToken, confSig,
    buildUrl("/api/twilio/voice/conference-status?agentCallSid=CA_agent_001", API, {}),
    confBody), "conference-status sig validates (with query string)");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Multi-campaign isolation
// ═══════════════════════════════════════════════════════════════════════════════

section("7. Multi-campaign isolation");

{
  const campAToken = "campaign_A_token_111";
  const campBToken = "campaign_B_token_222";
  const url = "https://tolipai.com/api/twilio/voice/call-status";
  const params = { CallSid: "CA_A_001", CallStatus: "completed" };

  const sigA = sign(campAToken, url, params);
  assert(validate(campAToken, sigA, url, params), "campaign A sig validates with campaign A token");
  assert(!validate(campBToken, sigA, url, params), "campaign A sig REJECTED by campaign B token (isolation)");
  assert(!validate("global_token_000", sigA, url, params), "campaign A sig REJECTED by global token");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Live endpoint extra checks
// ═══════════════════════════════════════════════════════════════════════════════

const BASE = process.env.TEST_BASE_URL || process.env.API_BASE_URL;

if (!BASE) {
  section("8. Live endpoint checks — SKIPPED (set TEST_BASE_URL or API_BASE_URL)");
} else {
  section("8. Live endpoint checks against " + BASE);

  async function probe(method, path, opts = {}) {
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...opts.headers },
        body: opts.body,
        signal: AbortSignal.timeout(10000),
      });
      return { status: res.status, text: await res.text().catch(() => "") };
    } catch (e) { return { status: 0, text: e.message }; }
  }

  // All webhook routes that need twilioAuth should return 403 (not 404, not 500)
  // when called without a signature — 404 would mean the route doesn't exist at all
  const protectedRoutes = [
    ["POST", "/twilio/voice/answer",            { To: "+15005550006", From: "+15005550001", CallSid: "CA1" }],
    ["POST", "/twilio/voice/inbound",           { To: "+15005550006", From: "+15005550001", CallSid: "CA2" }],
    ["POST", "/twilio/voice/call-status",       { CallSid: "CA3", CallStatus: "completed" }],
    ["POST", "/twilio/voice/inbound-no-answer", { To: "+15005550006", From: "+15005550001", CallSid: "CA4" }],
    ["POST", "/twilio/voice/recording",         { CallSid: "CA5", RecordingSid: "RE1", RecordingStatus: "completed" }],
    ["POST", "/twilio/voice/conference-status", { ConferenceSid: "CF1", StatusCallbackEvent: "end" }],
    ["POST", "/twilio/voice/status",            { CallSid: "CA6", CallStatus: "completed" }],
  ];

  for (const [method, path, params] of protectedRoutes) {
    const r = await probe(method, path, { body: new URLSearchParams(params).toString() });
    assert(r.status === 403,
      method + " " + path + " (no sig) → 403 (route exists, auth guard working)",
      r.status !== 403 ? "got: " + r.status + " " + r.text.slice(0, 60) : undefined);
  }

  // SMS webhook always returns 200
  const sms = await probe("POST", "/twilio/webhook", {
    body: new URLSearchParams({ From: "+15005550001", To: "+15005550006", Body: "test", MessageSid: "SM1" }).toString()
  });
  assert(sms.status === 200, "POST /twilio/webhook → 200 (always ACKs)", "got: " + sms.status);

  // Public routes
  const ringback = await probe("GET", "/twilio/voice/ringback");
  assert(ringback.status === 200, "GET /twilio/voice/ringback → 200 (public audio)", "got: " + ringback.status);

  const twimlNoTo = await probe("GET", "/twilio/twiml/call");
  assert(twimlNoTo.status === 200, "GET /twilio/twiml/call (no params) → 200", "got: " + twimlNoTo.status);

  const twimlWithTo = await probe("GET", "/twilio/twiml/call?to=%2B15005550006&callerId=%2B15005550001");
  assert(twimlWithTo.status === 200, "GET /twilio/twiml/call?to=...&callerId=... → 200", "got: " + twimlWithTo.status);
  assert(twimlWithTo.text.includes("<Dial"), "TwiML response contains <Dial> verb", twimlWithTo.text.slice(0, 80));

  // Auth-required routes return 401, not 404
  const tokenNoAuth = await probe("POST", "/twilio/voice/token");
  assert(tokenNoAuth.status === 401, "POST /twilio/voice/token (no auth) → 401", "got: " + tokenNoAuth.status);

  const clickNoAuth = await probe("POST", "/twilio/click-to-call", {
    body: JSON.stringify({ fromNumber: "+15005550006", agentPhone: "+14155551234", leadPhone: "+19175559876" }),
    headers: { "Content-Type": "application/json" }
  });
  assert(clickNoAuth.status === 401, "POST /twilio/click-to-call (no auth) → 401", "got: " + clickNoAuth.status);

  const setupNoAuth = await probe("POST", "/twilio/setup-webhooks");
  assert(setupNoAuth.status === 401, "POST /twilio/setup-webhooks (no auth) → 401", "got: " + setupNoAuth.status);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log("\n" + "\u2550".repeat(52));
console.log("  " + passed + " passed  |  " + failed + " failed");
console.log("\u2550".repeat(52) + "\n");

if (failures.length) {
  console.error("Failed:");
  failures.forEach(f => console.error("  \u2022 " + f));
  console.log();
  process.exit(1);
}
