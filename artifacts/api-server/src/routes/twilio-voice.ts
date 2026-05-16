// src/routes/twilio-voice.ts
import { Router, type IRouter } from "express";
import { crmAuth } from "./crm/middleware";
import { jwt } from "twilio";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const { AccessToken } = jwt;
const { VoiceGrant } = AccessToken;

// NOTE: For now, this uses a SINGLE global Twilio Voice account.
// Env vars (set in Railway / later AWS):
//   TWILIO_ACCOUNT_SID       = ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   TWILIO_API_KEY_SID       = SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   TWILIO_API_KEY_SECRET    = your_api_key_secret
//   TWILIO_VOICE_APP_SID     = APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   TWILIO_VOICE_CALLER_ID   = +1XXXXXXXXXX   (verified / purchased number)

function getVoiceConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  const appSid = process.env.TWILIO_VOICE_APP_SID;
  const callerId = process.env.TWILIO_VOICE_CALLER_ID;

  if (!accountSid || !apiKeySid || !apiKeySecret || !appSid || !callerId) {
    throw Object.assign(
      new Error("Twilio Voice is not fully configured. Missing env vars."),
      { status: 500 }
    );
  }
  return { accountSid, apiKeySid, apiKeySecret, appSid, callerId };
}

// ── POST /api/twilio/voice/token ─────────────────────────────────────────────
// Returns a short-lived Access Token for Twilio Voice SDK (browser calling)
router.post("/twilio/voice/token", crmAuth, async (req, res) => {
  try {
    const crmUser = req.crmUser!;
    const { accountSid, apiKeySid, apiKeySecret, appSid } = getVoiceConfig();

    // Identity: how this browser client is identified in Twilio
    const identity = `user_${crmUser.id}`;

    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
      identity,
      ttl: 60 * 60, // 1 hour
    });

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: appSid,
      incomingAllow: true,
    });

    token.addGrant(voiceGrant);

    res.json({
      token: token.toJwt(),
      identity,
    });
  } catch (err: any) {
    logger.error(err, "[twilio/voice/token] error");
    res.status(err.status || 500).json({ error: err.message || "Failed to create voice token" });
  }
});

// ── POST /api/twilio/voice/answer ────────────────────────────────────────────
// TwiML App Voice URL — Twilio hits this when the browser starts a call.
// It should read the "To" (destination) and optional "From" (callerId) params.
router.post("/twilio/voice/answer", async (req, res) => {
  try {
    const { callerId: envCallerId } = getVoiceConfig();

    const to = (req.body?.To as string | undefined) || "";
    const fromParam = (req.body?.From as string | undefined) || "";
    const callerId = fromParam || envCallerId;

    res.set("Content-Type", "text/xml");

    if (!to) {
      // No destination → simple message
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>No destination number provided.</Say>
</Response>`);
      return;
    }

    // Dial a PSTN number from browser
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId}">
    <Number>${to}</Number>
  </Dial>
</Response>`);
  } catch (err) {
    logger.error(err, "[twilio/voice/answer] error");
    res.set("Content-Type", "text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>There was an error connecting your call.</Say>
</Response>`);
  }
});

export default router;
