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

// ── POST /api/demo/call ───────────────────────────────────────────────────────
router.post("/demo/call", async (req: Request, res: Response) => {
  const { phone, name } = req.body as { phone?: string; name?: string };

  if (!phone || phone.replace(/\D/g, "").length < 10) {
    res.status(400).json({ error: "A valid US phone number is required." });
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
      res.status(502).json({ error: "Failed to initiate demo call. Please try the contact form." });
      return;
    }

    logger.info({ sid: json.sid, to: toNumber }, "[demo/call] Demo call initiated");
    res.json({ success: true, message: "Your demo call is on the way! You'll receive a call within 30 seconds.", sid: json.sid });
  } catch (err: any) {
    logger.error({ err: err.message }, "[demo/call] Error initiating demo call");
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
