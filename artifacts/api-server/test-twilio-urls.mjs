/**
 * Plain Node.js smoke-test for Twilio URL construction logic.
 * Run: node artifacts/api-server/test-twilio-urls.mjs
 */

let passed = 0;
let failed = 0;

function assert(condition, label, detail) {
  if (condition) {
    console.log("  \u2705  " + label);
    passed++;
  } else {
    console.error("  \u274C  " + label + (detail ? "\n       got: " + detail : ""));
    failed++;
  }
}

// Inline the logic from buildTwilioWebhookUrl (webhookBase.ts)
function buildTwilioWebhookUrl(req, apiBaseUrl) {
  if (apiBaseUrl) {
    const base = apiBaseUrl.replace(/\/+$/, "");
    // Extract the pathname from the base URL (e.g. "/api" from "https://tolipai.com/api")
    const matchPath = base.match(/^https?:\/\/[^/]+(\/[^?#]*)?/);
    const basePath = (matchPath && matchPath[1] ? matchPath[1] : "").replace(/\/+$/, "");
    const reqPath = basePath && req.originalUrl.startsWith(basePath)
      ? req.originalUrl.slice(basePath.length)
      : req.originalUrl;
    return base + reqPath;
  }
  // fallback for local dev
  const proto = (req.headers && req.headers["x-forwarded-proto"]) || req.protocol || "https";
  const host = (req.headers && (req.headers["x-forwarded-host"] || req.headers["host"])) || "localhost";
  return proto + "://" + host + req.originalUrl;
}

// Inline the logic from getWebhookBase (webhookBase.ts)
function getWebhookBase(apiBaseUrl, req) {
  if (apiBaseUrl) return apiBaseUrl.replace(/\/+$/, "");
  const hdrs = (req && req.headers) || {};
  const fwdHost = hdrs["x-forwarded-host"] ? hdrs["x-forwarded-host"].split(",")[0].trim() : null;
  const host = fwdHost || hdrs["host"] || "localhost:5000";
  return "https://" + host.replace(/:\d+$/, "") + "/api";
}

const API_BASE = "https://tolipai.com/api";

console.log("\n── buildTwilioWebhookUrl (API_BASE_URL set) ─────────────────\n");

const cases = [
  ["/api/twilio/voice/answer",             "https://tolipai.com/api/twilio/voice/answer"],
  ["/api/twilio/voice/call-status",        "https://tolipai.com/api/twilio/voice/call-status"],
  ["/api/twilio/webhook",                  "https://tolipai.com/api/twilio/webhook"],
  ["/api/twilio/voice/inbound",            "https://tolipai.com/api/twilio/voice/inbound"],
  ["/api/twilio/voice/recording",          "https://tolipai.com/api/twilio/voice/recording"],
  ["/api/twilio/voice/inbound-no-answer",  "https://tolipai.com/api/twilio/voice/inbound-no-answer"],
  ["/api/twilio/voice/conference-status?agentCallSid=CA123", "https://tolipai.com/api/twilio/voice/conference-status?agentCallSid=CA123"],
];

for (const [originalUrl, expected] of cases) {
  const req = { originalUrl, headers: {}, protocol: "https" };
  const result = buildTwilioWebhookUrl(req, API_BASE);
  assert(result === expected, originalUrl, result);
  assert(!result.includes("/api/api"), "  no double /api in: " + originalUrl, result);
}

console.log("\n── getWebhookBase (API_BASE_URL set) ────────────────────────\n");

{
  const base = getWebhookBase(API_BASE, {});
  assert(base === "https://tolipai.com/api", "returns API_BASE_URL as-is", base);
  assert(!base.includes("/api/api"), "no double /api in base", base);
  const callbackUrl = base + "/twilio/voice/answer";
  assert(
    callbackUrl === "https://tolipai.com/api/twilio/voice/answer",
    "getWebhookBase + suffix = correct callback URL",
    callbackUrl
  );
}

console.log("\n── buildTwilioWebhookUrl (no API_BASE_URL — dev fallback) ───\n");

{
  const req = {
    originalUrl: "/api/twilio/voice/answer",
    headers: { "x-forwarded-proto": "https", "x-forwarded-host": "tolipai.com" },
    protocol: "https",
  };
  const result = buildTwilioWebhookUrl(req, "");
  assert(
    result === "https://tolipai.com/api/twilio/voice/answer",
    "x-forwarded-* headers used in dev fallback",
    result
  );
}

{
  const req = {
    originalUrl: "/api/twilio/webhook",
    headers: { host: "localhost:5000" },
    protocol: "http",
  };
  const result = buildTwilioWebhookUrl(req, "");
  assert(result === "http://localhost:5000/api/twilio/webhook", "host header fallback", result);
}

console.log("\n── Regression: old broken patterns ──────────────────────────\n");

// Old bug: appending /api to API_BASE_URL that already ends in /api
{
  const brokenBase = API_BASE + "/api"; // the old bug
  assert(brokenBase.includes("/api/api"), "old broken pattern produced /api/api (confirms bug was real)", brokenBase);

  const fixedBase = getWebhookBase(API_BASE, {});
  assert(!fixedBase.includes("/api/api"), "fixed getWebhookBase: no /api/api", fixedBase);
}

// Old bug: validateTwilioSignature used Railway's internal x-forwarded-host
{
  const internalHost = "internal-railway-hostname.up.railway.app";
  const req = {
    originalUrl: "/api/twilio/webhook",
    headers: { "x-forwarded-proto": "https", "x-forwarded-host": internalHost, host: internalHost },
    protocol: "https",
  };

  // Old code used x-forwarded-host directly → wrong URL
  const oldBrokenUrl = req.headers["x-forwarded-proto"] + "://" + req.headers["x-forwarded-host"] + req.originalUrl;
  const correctUrl = "https://tolipai.com/api/twilio/webhook";
  assert(
    oldBrokenUrl !== correctUrl,
    "old code: internal Railway host caused signature mismatch (bug confirmed)",
    "old URL was: " + oldBrokenUrl
  );

  // New code uses API_BASE_URL → ignores Railway internal host
  const newUrl = buildTwilioWebhookUrl(req, API_BASE);
  assert(newUrl === correctUrl, "fixed code: API_BASE_URL used, Railway internal host ignored", newUrl);
}

// buildTwilioWebhookUrl vs old middleware buildWebhookUrl equivalence
{
  const url1 = buildTwilioWebhookUrl({ originalUrl: "/api/twilio/voice/call-status", headers: {} }, API_BASE);
  assert(url1 === "https://tolipai.com/api/twilio/voice/call-status",
    "call-status callback URL correct after double-/api fix", url1);
}

console.log("\n" + "\u2500".repeat(52));
console.log("  " + passed + " passed  |  " + failed + " failed");
console.log("\u2500".repeat(52) + "\n");

if (failed > 0) process.exit(1);
