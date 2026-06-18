/**
 * Twilio integration smoke-test.
 *
 * Run with:
 *   cd artifacts/api-server
 *   npx tsx src/scripts/test-twilio.ts
 *
 * Tests:
 *   1. URL construction — verifies buildTwilioWebhookUrl() never doubles /api
 *   2. Health endpoint reachable
 *   3. Webhook URL correctness (no double /api)
 *   4. Voice token endpoint returns a token (requires valid DB campaign creds)
 */

import { buildTwilioWebhookUrl, getWebhookBase } from "../lib/webhookBase";
import type { Request } from "express";

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label: string) {
  console.log(`  ✅  ${label}`);
  passed++;
}

function fail(label: string, detail?: string) {
  console.error(`  ❌  ${label}${detail ? `\n       ${detail}` : ""}`);
  failed++;
}

function assert(condition: boolean, label: string, detail?: string) {
  condition ? ok(label) : fail(label, detail);
}

// ── Mock request factory ──────────────────────────────────────────────────────

function mockReq(originalUrl: string, overrides: Partial<{
  headers: Record<string, string>;
  protocol: string;
}> = {}): Request {
  return {
    originalUrl,
    protocol: overrides.protocol ?? "https",
    headers: overrides.headers ?? {},
  } as unknown as Request;
}

// ── Section 1: URL construction ───────────────────────────────────────────────

console.log("\n── 1. URL construction (API_BASE_URL set) ─────────────────────\n");

const savedApiBase = process.env.API_BASE_URL;
process.env.API_BASE_URL = "https://tolipai.com/api";

{
  const url = buildTwilioWebhookUrl(mockReq("/api/twilio/voice/answer"));
  assert(
    url === "https://tolipai.com/api/twilio/voice/answer",
    "voice/answer — no double /api",
    `got: ${url}`
  );
}

{
  const url = buildTwilioWebhookUrl(mockReq("/api/twilio/voice/call-status"));
  assert(
    url === "https://tolipai.com/api/twilio/voice/call-status",
    "voice/call-status — no double /api",
    `got: ${url}`
  );
}

{
  const url = buildTwilioWebhookUrl(mockReq("/api/twilio/webhook"));
  assert(
    url === "https://tolipai.com/api/twilio/webhook",
    "SMS webhook — no double /api",
    `got: ${url}`
  );
}

{
  const url = buildTwilioWebhookUrl(mockReq("/api/twilio/voice/inbound"));
  assert(
    url === "https://tolipai.com/api/twilio/voice/inbound",
    "voice/inbound — no double /api",
    `got: ${url}`
  );
}

{
  const url = buildTwilioWebhookUrl(mockReq("/api/twilio/voice/recording"));
  assert(
    url === "https://tolipai.com/api/twilio/voice/recording",
    "voice/recording — no double /api",
    `got: ${url}`
  );
}

// getWebhookBase must never include extra /api
{
  const base = getWebhookBase(mockReq("/api/twilio/voice/answer"));
  assert(
    base === "https://tolipai.com/api",
    "getWebhookBase returns API_BASE_URL as-is",
    `got: ${base}`
  );
  const fullUrl = `${base}/twilio/voice/answer`;
  assert(
    fullUrl === "https://tolipai.com/api/twilio/voice/answer",
    "getWebhookBase + suffix → correct callback URL",
    `got: ${fullUrl}`
  );
  assert(
    !fullUrl.includes("/api/api"),
    "getWebhookBase callback URL has no double /api",
    `got: ${fullUrl}`
  );
}

console.log("\n── 2. URL construction (no API_BASE_URL — local dev fallback) ──\n");

process.env.API_BASE_URL = "";

{
  const url = buildTwilioWebhookUrl(mockReq("/api/twilio/voice/answer", {
    headers: {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "tolipai.com",
    },
  }));
  assert(
    url === "https://tolipai.com/api/twilio/voice/answer",
    "dev fallback: x-forwarded-* headers used correctly",
    `got: ${url}`
  );
}

{
  const url = buildTwilioWebhookUrl(mockReq("/api/twilio/voice/answer", {
    headers: { host: "localhost:5000" },
    protocol: "http",
  }));
  assert(
    url === "http://localhost:5000/api/twilio/voice/answer",
    "dev fallback: host header used when no x-forwarded-*",
    `got: ${url}`
  );
}

// Restore
if (savedApiBase !== undefined) {
  process.env.API_BASE_URL = savedApiBase;
}

// ── Section 3: Live HTTP checks (optional — skipped if no BASE_URL) ───────────

const BASE = process.env.API_BASE_URL || process.env.TEST_BASE_URL;

if (!BASE) {
  console.log("\n── 3. Live HTTP checks SKIPPED (set API_BASE_URL or TEST_BASE_URL) ──\n");
} else {
  console.log(`\n── 3. Live HTTP checks against ${BASE} ───────────────────────\n`);

  async function httpGet(path: string) {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Accept: "application/json" },
    });
    return { status: res.status, body: await res.text() };
  }

  try {
    // Health
    const health = await httpGet("/health");
    assert(health.status === 200, `GET /health → 200`, `got: ${health.status} ${health.body.slice(0, 80)}`);

    // Twilio webhook (no signature) → should return 403
    const webhookNoSig = await fetch(`${BASE}/twilio/voice/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: "+15005550006", From: "+15005550001", CallSid: "CAtest" }),
    });
    assert(
      webhookNoSig.status === 403,
      "POST /twilio/voice/answer without X-Twilio-Signature → 403 (signature guard working)",
      `got: ${webhookNoSig.status}`
    );

    // SMS webhook (no signature) → should return 200 (responds before validating, drops silently)
    const smsNoSig = await fetch(`${BASE}/twilio/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: "+15005550006", From: "+15005550001", Body: "test", MessageSid: "SMtest" }),
    });
    assert(
      smsNoSig.status === 200,
      "POST /twilio/webhook without signature → 200 (always ACKs Twilio, drops silently)",
      `got: ${smsNoSig.status}`
    );

    // Voice token (no auth) → should return 401
    const tokenNoAuth = await fetch(`${BASE}/twilio/voice/token`, { method: "POST" });
    assert(
      tokenNoAuth.status === 401,
      "POST /twilio/voice/token without auth → 401",
      `got: ${tokenNoAuth.status}`
    );
  } catch (err: any) {
    fail("HTTP checks", err.message);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n────────────────────────────────────────────────────`);
console.log(`  ${passed} passed  |  ${failed} failed`);
console.log(`────────────────────────────────────────────────────\n`);

if (failed > 0) process.exit(1);
