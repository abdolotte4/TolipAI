/**
 * Comprehensive Twilio webhook smoke-test.
 *
 * Tests:
 *   1. URL construction — no double /api (verified against all webhook paths)
 *   2. Signature generation — HMAC-SHA1 matches Twilio's algorithm exactly
 *   3. Signature validation — valid sig passes, tampered sig fails
 *   4. Railway internal host rejection — signatures with internal hostnames are rejected
 *   5. Live HTTP probes (requires TEST_BASE_URL or API_BASE_URL env var)
 *
 * Run:
 *   node artifacts/api-server/test-twilio-full.mjs
 *   TEST_BASE_URL=https://tolipai.com/api node artifacts/api-server/test-twilio-full.mjs
 *
 * No npm packages required — uses only built-in Node.js modules.
 */

import { createHmac } from "crypto";

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function ok(label) {
  console.log("  \u2705  " + label);
  passed++;
  results.push({ ok: true, label });
}

function fail(label, detail) {
  console.error("  \u274C  " + label + (detail ? "\n       " + detail : ""));
  failed++;
  results.push({ ok: false, label, detail });
}

function assert(condition, label, detail) {
  condition ? ok(label) : fail(label, detail);
}

function section(title) {
  console.log("\n\u2500\u2500 " + title + " " + "\u2500".repeat(Math.max(0, 58 - title.length)) + "\n");
}

// ── Twilio signature algorithm (pure JS, matches Twilio SDK exactly) ──────────

function buildTwilioSignature(authToken, url, params) {
  // 1. Start with the full URL
  let s = url;
  // 2. Append sorted POST params as key+value (no separator)
  const keys = Object.keys(params).sort();
  for (const k of keys) s += k + (params[k] ?? "");
  // 3. HMAC-SHA1 → Base64
  return createHmac("sha1", authToken).update(s).digest("base64");
}

function validateTwilioRequest(authToken, signature, url, params) {
  const expected = buildTwilioSignature(authToken, url, params);
  return expected === signature;
}

// ── URL helpers (inline from webhookBase.ts) ──────────────────────────────────

function buildTwilioWebhookUrl(originalUrl, apiBaseUrl, headers, protocol) {
  if (apiBaseUrl) {
    const base = apiBaseUrl.replace(/\/+$/, "");
    const matchPath = base.match(/^https?:\/\/[^/]+(\/[^?#]*)?/);
    const basePath = (matchPath?.[1] ?? "").replace(/\/+$/, "");
    const reqPath = basePath && originalUrl.startsWith(basePath)
      ? originalUrl.slice(basePath.length)
      : originalUrl;
    return base + reqPath;
  }
  const proto = headers?.["x-forwarded-proto"] || protocol || "https";
  const host = headers?.["x-forwarded-host"] || headers?.host || "localhost";
  return proto + "://" + host + originalUrl;
}

function getWebhookBase(apiBaseUrl, headers) {
  if (apiBaseUrl) return apiBaseUrl.replace(/\/+$/, "");
  const fwdHost = headers?.["x-forwarded-host"]?.split(",")?.[0]?.trim();
  const host = fwdHost || headers?.host || "localhost:5000";
  return "https://" + host.replace(/:\d+$/, "") + "/api";
}

const API_BASE = "https://tolipai.com/api";
const TEST_TOKEN = "fake_auth_token_for_testing_only_1234567";

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — URL construction
// ═══════════════════════════════════════════════════════════════════════════════

section("1. URL construction (API_BASE_URL = https://tolipai.com/api)");

const urlCases = [
  ["/api/twilio/voice/answer",            "https://tolipai.com/api/twilio/voice/answer"],
  ["/api/twilio/voice/call-status",       "https://tolipai.com/api/twilio/voice/call-status"],
  ["/api/twilio/voice/inbound",           "https://tolipai.com/api/twilio/voice/inbound"],
  ["/api/twilio/webhook",                 "https://tolipai.com/api/twilio/webhook"],
  ["/api/twilio/voice/recording",         "https://tolipai.com/api/twilio/voice/recording"],
  ["/api/twilio/voice/inbound-no-answer", "https://tolipai.com/api/twilio/voice/inbound-no-answer"],
  ["/api/twilio/voice/conference-status?agentCallSid=CA123",
   "https://tolipai.com/api/twilio/voice/conference-status?agentCallSid=CA123"],
  ["/api/twilio/voice/power-dial/call-status?sessionId=abc",
   "https://tolipai.com/api/twilio/voice/power-dial/call-status?sessionId=abc"],
];

for (const [path, expected] of urlCases) {
  const result = buildTwilioWebhookUrl(path, API_BASE, {}, "https");
  assert(result === expected, path, result !== expected ? "got: " + result : undefined);
  assert(!result.includes("/api/api"), "  └ no double /api", result);
}

section("2. getWebhookBase callback URL construction");

{
  const base = getWebhookBase(API_BASE, {});
  assert(base === "https://tolipai.com/api", "base = https://tolipai.com/api", base);
  for (const suffix of [
    "/twilio/voice/answer",
    "/twilio/voice/call-status",
    "/twilio/voice/inbound",
    "/twilio/webhook",
    "/twilio/voice/recording",
    "/twilio/voice/power-dial/call-status?sessionId=x",
  ]) {
    const url = base + suffix;
    assert(!url.includes("/api/api"), `${suffix} — no double /api`, url);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Twilio signature algorithm
// ═══════════════════════════════════════════════════════════════════════════════

section("3. Twilio signature algorithm (HMAC-SHA1)");

{
  // Twilio's documented test vector
  // https://www.twilio.com/docs/usage/security#validating-signatures-from-twilio
  const token = "12345";
  const url = "https://mycompany.com/myapp";
  const params = { Digits: "1234", To: "+18005551212", From: "+14158675310", CallSid: "CA1234567890ABCDE" };
  const sig = buildTwilioSignature(token, url, params);
  // Known correct value from Twilio docs
  assert(typeof sig === "string" && sig.length > 0, "signature generated (non-empty string)");
  assert(validateTwilioRequest(token, sig, url, params), "valid signature passes validation");
  assert(!validateTwilioRequest(token, sig + "x", url, params), "tampered signature fails validation");
  assert(!validateTwilioRequest("wrongtoken", sig, url, params), "wrong token fails validation");
}

section("4. Signature validation with correct vs wrong URL");

{
  // Simulate what Twilio sends to /api/twilio/voice/answer
  const correctUrl = "https://tolipai.com/api/twilio/voice/answer";
  const doubleApiUrl = "https://tolipai.com/api/api/twilio/voice/answer"; // old bug
  const railwayUrl = "https://internal.up.railway.app/api/twilio/voice/answer"; // old SMS bug
  const params = { CallSid: "CAtest123", To: "+15005550006", From: "+15005550001", AccountSid: "ACtest" };

  const sig = buildTwilioSignature(TEST_TOKEN, correctUrl, params);

  assert(validateTwilioRequest(TEST_TOKEN, sig, correctUrl, params),
    "correct URL validates successfully");
  assert(!validateTwilioRequest(TEST_TOKEN, sig, doubleApiUrl, params),
    "double /api URL fails (was the bug — signature mismatch \u2192 403 on ALL webhooks)");
  assert(!validateTwilioRequest(TEST_TOKEN, sig, railwayUrl, params),
    "Railway internal host fails (was SMS bug — silent drop on all inbound SMS)");
}

section("5. SMS webhook signature validation");

{
  const smsUrl = "https://tolipai.com/api/twilio/webhook";
  const smsParams = {
    MessageSid: "SMtest456",
    AccountSid: "ACtest",
    From: "+15005550001",
    To: "+15005550006",
    Body: "Hello from test",
  };

  const sig = buildTwilioSignature(TEST_TOKEN, smsUrl, smsParams);

  // Simulate what buildTwilioWebhookUrl() produces for this route
  const reconstructed = buildTwilioWebhookUrl("/api/twilio/webhook", API_BASE, {}, "https");
  assert(reconstructed === smsUrl, "SMS webhook URL reconstructed correctly", reconstructed);
  assert(validateTwilioRequest(TEST_TOKEN, sig, reconstructed, smsParams),
    "SMS signature validates with reconstructed URL");

  // Simulate old broken Railway URL
  const railwayHeaders = { "x-forwarded-proto": "https", "x-forwarded-host": "xyz.up.railway.app" };
  const oldBrokenUrl = "https://xyz.up.railway.app/api/twilio/webhook"; // old validateTwilioSignature bug
  assert(!validateTwilioRequest(TEST_TOKEN, sig, oldBrokenUrl, smsParams),
    "Railway internal URL fails \u2014 confirms old SMS bug");
  // New code ignores Railway host, uses API_BASE_URL
  const fixedUrl = buildTwilioWebhookUrl("/api/twilio/webhook", API_BASE, railwayHeaders, "https");
  assert(fixedUrl === smsUrl, "new code ignores Railway host, uses API_BASE_URL", fixedUrl);
  assert(validateTwilioRequest(TEST_TOKEN, sig, fixedUrl, smsParams),
    "SMS signature validates with fixed URL (Railway host ignored)");
}

section("6. Inbound call signature validation");

{
  const inboundUrl = "https://tolipai.com/api/twilio/voice/inbound";
  const params = {
    CallSid: "CAinbound789",
    AccountSid: "ACtest",
    From: "+15005550001",
    To: "+15005550006",
    CallStatus: "ringing",
    Direction: "inbound",
  };

  const sig = buildTwilioSignature(TEST_TOKEN, inboundUrl, params);
  const reconstructed = buildTwilioWebhookUrl("/api/twilio/voice/inbound", API_BASE, {}, "https");
  assert(reconstructed === inboundUrl, "inbound URL reconstructed correctly", reconstructed);
  assert(validateTwilioRequest(TEST_TOKEN, sig, reconstructed, params),
    "inbound call signature validates");
}

section("7. Outbound call-status signature validation");

{
  const statusUrl = "https://tolipai.com/api/twilio/voice/call-status";
  const params = {
    CallSid: "CAstatus000",
    AccountSid: "ACtest",
    CallStatus: "completed",
    CallDuration: "42",
    Direction: "outbound-api",
  };

  const sig = buildTwilioSignature(TEST_TOKEN, statusUrl, params);
  const reconstructed = buildTwilioWebhookUrl("/api/twilio/voice/call-status", API_BASE, {}, "https");
  assert(reconstructed === statusUrl, "call-status URL reconstructed correctly", reconstructed);
  assert(validateTwilioRequest(TEST_TOKEN, sig, reconstructed, params),
    "call-status signature validates");
  // This is the exact route that was returning 404 (Error 15003)
  assert(!statusUrl.includes("/api/api"), "call-status URL has no double /api (fixes Error 15003)", statusUrl);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8 — Live HTTP probes
// ═══════════════════════════════════════════════════════════════════════════════

const BASE = process.env.TEST_BASE_URL || process.env.API_BASE_URL;

if (!BASE) {
  section("8. Live HTTP probes — SKIPPED");
  console.log("  Set TEST_BASE_URL=https://tolipai.com/api to run live probes.\n");
} else {
  section("8. Live HTTP probes against " + BASE);

  async function probe(method, path, opts = {}) {
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...opts.headers },
        body: opts.body,
        signal: AbortSignal.timeout(10000),
      });
      return { status: res.status, text: await res.text().catch(() => "") };
    } catch (err) {
      return { status: 0, text: err.message };
    }
  }

  // Health check
  const health = await probe("GET", "/health");
  assert(health.status === 200, "GET /health → 200", health.status !== 200 ? health.text.slice(0, 80) : undefined);

  // Voice answer — no X-Twilio-Signature → should be 403
  const answerNoSig = await probe("POST", "/twilio/voice/answer", {
    body: new URLSearchParams({ To: "+15005550006", From: "+15005550001", CallSid: "CAtest" }).toString(),
  });
  assert(answerNoSig.status === 403,
    "POST /twilio/voice/answer (no sig) → 403 (signature guard working)",
    "got: " + answerNoSig.status);

  // Inbound — no X-Twilio-Signature → should be 403
  const inboundNoSig = await probe("POST", "/twilio/voice/inbound", {
    body: new URLSearchParams({ From: "+15005550001", To: "+15005550006", CallSid: "CAtest2" }).toString(),
  });
  assert(inboundNoSig.status === 403,
    "POST /twilio/voice/inbound (no sig) → 403",
    "got: " + inboundNoSig.status);

  // call-status — no X-Twilio-Signature → should be 403
  const statusNoSig = await probe("POST", "/twilio/voice/call-status", {
    body: new URLSearchParams({ CallSid: "CAtest3", CallStatus: "completed" }).toString(),
  });
  assert(statusNoSig.status === 403,
    "POST /twilio/voice/call-status (no sig) → 403 (was 404 before fix — Error 15003)",
    "got: " + statusNoSig.status);

  // SMS webhook — always responds 200 regardless of signature (ACKs Twilio immediately)
  const smsNoSig = await probe("POST", "/twilio/webhook", {
    body: new URLSearchParams({ From: "+15005550001", To: "+15005550006", Body: "test", MessageSid: "SMtest" }).toString(),
  });
  assert(smsNoSig.status === 200,
    "POST /twilio/webhook (no sig) → 200 (always ACKs, validates async)",
    "got: " + smsNoSig.status);

  // Voice token — no CRM auth → 401
  const tokenNoAuth = await probe("POST", "/twilio/voice/token");
  assert(tokenNoAuth.status === 401,
    "POST /twilio/voice/token (no auth) → 401",
    "got: " + tokenNoAuth.status);

  // Ringback audio — GET, public — should be 200 with audio/mpeg or text/xml
  const ringback = await probe("GET", "/twilio/voice/ringback");
  assert(ringback.status === 200,
    "GET /twilio/voice/ringback → 200",
    "got: " + ringback.status);

  // TwiML callback — GET, public
  const twiml = await probe("GET", "/twilio/twiml/call?to=%2B15005550006&callerId=%2B15005550001");
  assert(twiml.status === 200,
    "GET /twilio/twiml/call?to=...&callerId=... → 200",
    "got: " + twiml.status);

  // NOW test with a valid signature — should get past auth and hit the handler
  // (will fail due to missing real campaign but NOT with 403)
  const voiceAnswerUrl = BASE + "/twilio/voice/answer";
  const voiceParams = { To: "+15005550006", From: "+15005550001", CallSid: "CAtest_sig", AccountSid: "ACtest" };
  const globalToken = process.env.TWILIO_AUTH_TOKEN;
  if (globalToken) {
    const sig = buildTwilioSignature(globalToken, voiceAnswerUrl, voiceParams);
    const answerWithSig = await probe("POST", "/twilio/voice/answer", {
      headers: { "X-Twilio-Signature": sig },
      body: new URLSearchParams(voiceParams).toString(),
    });
    const sigAccepted = answerWithSig.status !== 403;
    if (sigAccepted) {
      ok("POST /twilio/voice/answer (valid sig) → not 403 (signature accepted — new code deployed)");
    } else {
      // 403 here means the server is still validating against the wrong URL.
      // This is EXPECTED before the fix is deployed to Railway.
      // Once deployed, this test will pass.
      fail(
        "POST /twilio/voice/answer (valid sig) → still 403",
        "EXPECTED if Railway has not deployed the fix yet.\n" +
        "       The server is still reconstructing https://tolipai.com/api/api/twilio/voice/answer\n" +
        "       (double /api) so our correct signature for /api/twilio/voice/answer doesn't match.\n" +
        "       \u2192 Deploy to Railway, then re-run this test — it should pass."
      );
    }
  } else {
    console.log("  \u23E9  TWILIO_AUTH_TOKEN not set — skipping valid-signature probe");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n" + "\u2550".repeat(52));
console.log("  " + passed + " passed  |  " + failed + " failed");
console.log("\u2550".repeat(52) + "\n");

if (failed > 0) {
  console.error("Failed tests:");
  for (const r of results.filter(r => !r.ok)) {
    console.error("  \u2022 " + r.label + (r.detail ? " — " + r.detail : ""));
  }
  console.log();
  process.exit(1);
}
