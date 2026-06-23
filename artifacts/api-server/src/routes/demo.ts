/**
 * Demo Call Routes
 *
 * Allows website visitors to request a live AI demo call.
 * Uses a global demo Twilio account (env: TWILIO_DEMO_*).
 * Rate-limited to 2 calls per IP per hour to prevent abuse.
 *
 * POST /api/demo/call   — request a demo call
 * GET  /api/demo/twiml  — TwiML callback served to Twilio
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── In-memory rate limiter: 2 calls per IP per 60 minutes ────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const WINDOW_MS = 60 * 60 * 1000;
  const MAX_PER_WINDOW = 2;

  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_PER_WINDOW) return false;
  entry.count++;
  return true;
}

// Purge stale rate-limit entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 30 * 60 * 1000);

// ── Brevo email notification helper ──────────────────────────────────────────
async function sendDemoNotification(name: string | undefined, phone: string, status: "requested" | "initiated" | "failed") {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || "info@tolipai.com";
  if (!apiKey) {
    logger.warn("[demo/call] BREVO_API_KEY not set — demo notification skipped");
    return;
  }
  const statusLabel = status === "initiated" ? "✅ Call Initiated" : status === "requested" ? "📞 Call Requested" : "❌ Call Failed";
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f9f9f9;">
      <div style="background:#0a0e1a;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
        <h1 style="color:#d4af37;margin:0;font-size:24px;">TOLIP GROUP LLC</h1>
        <p style="color:#aaa;margin:8px 0 0;font-size:13px;">${statusLabel} — Website Demo Request</p>
      </div>
      <div style="background:#fff;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;">
        <h2 style="color:#0a0e1a;margin-top:0;">Demo Call ${status === "initiated" ? "Initiated" : status === "requested" ? "Requested" : "Failed"}</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px 0;font-weight:bold;color:#555;width:140px;">Name:</td><td style="padding:8px 0;color:#222;">${name || "Not provided"}</td></tr>
          <tr><td style="padding:8px 0;font-weight:bold;color:#555;">Phone:</td><td style="padding:8px 0;color:#222;">${phone}</td></tr>
          <tr><td style="padding:8px 0;font-weight:bold;color:#555;">Status:</td><td style="padding:8px 0;color:#222;">${statusLabel}</td></tr>
          <tr><td style="padding:8px 0;font-weight:bold;color:#555;">Time:</td><td style="padding:8px 0;color:#222;">${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} ET</td></tr>
        </table>
        <p style="margin-top:24px;color:#888;font-size:12px;border-top:1px solid #eee;padding-top:16px;">
          Tolip Group LLC | 1095 Sugar View Dr Ste 500, Sheridan, WY 82801
        </p>
      </div>
    </div>
  `;
  try {
    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "TolipAI Website", email: senderEmail },
        to: [{ email: "info@tolipai.com", name: "TolipAI Info" }],
        subject: `${statusLabel}: Demo Call from ${name || phone}`,
        htmlContent: html,
        textContent: `Demo call ${status}\nName: ${name || "N/A"}\nPhone: ${phone}\nTime: ${new Date().toISOString()}`,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    logger.info({ phone, status }, "[demo/call] Notification email sent via Brevo");
  } catch (err: any) {
    logger.error({ err: err.message }, "[demo/call] Failed to send Brevo notification");
  }
}

// ── POST /api/demo/call ───────────────────────────────────────────────────────
router.post("/demo/call", async (req: Request, res: Response) => {
  const { phone, name } = req.body as { phone?: string; name?: string };

  if (!phone || phone.replace(/\D/g, "").length < 10) {
    res.status(400).json({ error: "A valid US phone number is required." });
    return;
  }

  // Reject premium-rate, toll-fraud, and non-geographic numbers
  const digits10 = phone.replace(/\D/g, "").slice(-10);
  const premiumPrefixes = ["900", "976", "970", "550", "540", "535", "520", "500"];
  if (premiumPrefixes.some(p => digits10.startsWith(p))) {
    res.status(400).json({ error: "Premium-rate numbers are not permitted for demo calls." });
    return;
  }

  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() ||
    req.ip ||
    "unknown";

  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Too many demo requests. Please try again in an hour." });
    return;
  }

  const accountSid = process.env.TWILIO_DEMO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_DEMO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_DEMO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    logger.warn("[demo/call] Demo Twilio credentials not configured — TWILIO_DEMO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER missing");
    // Still notify via email even when Twilio isn't configured
    sendDemoNotification(name, phone, "requested").catch(() => {});
    res.status(503).json({ error: "Demo calling is not yet configured. Please book a consultation via the contact form." });
    return;
  }

  // Normalize to E.164
  const digits = phone.replace(/\D/g, "");
  const toNumber = digits.startsWith("1") && digits.length === 11
    ? `+${digits}`
    : `+1${digits}`;

  try {
    const host = process.env.API_HOST || `https://${req.headers.host}`;
    const twimlUrl = `${host}/api/demo/twiml?name=${encodeURIComponent(name || "there")}`;

    const body = new URLSearchParams({
      To: toNumber,
      From: fromNumber,
      Url: twimlUrl,
      StatusCallback: `${host}/api/demo/twiml-status`,
      StatusCallbackMethod: "POST",
    });

    const callRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        },
        body: body.toString(),
      }
    );

    const json = await callRes.json() as any;
    if (!callRes.ok) {
      logger.error({ status: callRes.status, body: json }, "[demo/call] Twilio call creation failed");
      sendDemoNotification(name, toNumber, "failed").catch(() => {});
      res.status(502).json({ error: "Failed to initiate demo call. Please try the contact form." });
      return;
    }

    logger.info({ sid: json.sid, to: toNumber }, "[demo/call] Demo call initiated");
    sendDemoNotification(name, toNumber, "initiated").catch(() => {});
    res.json({ success: true, message: "Your demo call is on the way! You'll receive a call within 30 seconds.", sid: json.sid });
  } catch (err: any) {
    logger.error({ err: err.message }, "[demo/call] Error initiating demo call");
    const normalizedPhone = phone.replace(/\D/g, "");
    const toNumber = normalizedPhone.startsWith("1") && normalizedPhone.length === 11 ? `+${normalizedPhone}` : `+1${normalizedPhone}`;
    sendDemoNotification(name, toNumber, "failed").catch(() => {});
    res.status(500).json({ error: "Something went wrong. Please try the contact form instead." });
  }
});

// ── GET /api/demo/twiml ───────────────────────────────────────────────────────
// Twilio fetches this URL when the call connects; responds with TwiML instructions.
router.get("/demo/twiml", (req: Request, res: Response) => {
  const name = (req.query.name as string | undefined) || "there";
  const safeName = name.replace(/[<>"&]/g, "").slice(0, 40);

  res.set("Content-Type", "text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" language="en-US">
    Hello ${safeName}, and welcome to TolipAI's live demo.
  </Say>
  <Pause length="1"/>
  <Say voice="Polly.Joanna" language="en-US">
    TolipAI is a managed real estate acquisition platform. We combine AI-powered lead scoring, automated follow-up sequences, a built-in dialer, and a full CRM — all in one place.
  </Say>
  <Pause length="1"/>
  <Say voice="Polly.Joanna" language="en-US">
    Our clients typically see a 3x increase in deals within 90 days. We'd love to show you how.
  </Say>
  <Pause length="1"/>
  <Say voice="Polly.Joanna" language="en-US">
    Visit tolipai dot com to book a live walkthrough with our team, or access the demo CRM at the link on our homepage. Thank you for your interest in TolipAI!
  </Say>
</Response>`);
});

// ── POST /api/demo/twiml-status ───────────────────────────────────────────────
router.post("/demo/twiml-status", (req: Request, res: Response) => {
  logger.info({ sid: req.body?.CallSid, status: req.body?.CallStatus }, "[demo] call status update");
  res.status(200).send("OK");
});

export default router;
