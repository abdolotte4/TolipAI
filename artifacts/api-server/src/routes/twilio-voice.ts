// src/routes/twilio-voice.ts
//
// Campaign-based Twilio Voice endpoints.
// Each campaign stores its own API Key SID / Secret / TwiML App SID in the DB.
// Super-admins fall back to global env vars when campaign creds are missing.
//
// Env-var fallback (global / super-admin):
//   TWILIO_ACCOUNT_SID       = ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   TWILIO_API_KEY_SID       = SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   TWILIO_API_KEY_SECRET    = <secret>
//   TWILIO_VOICE_APP_SID     = APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   TWILIO_VOICE_CALLER_ID   = +1XXXXXXXXXX

import { Router, type IRouter } from "express";
import { crmAuth } from "./crm/middleware";
import { jwt as twilioJwt } from "twilio";
import { db } from "@workspace/db";
import {
  crmCampaigns,
  crmCallLogs,
  crmLeads,
} from "@workspace/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { decryptPassword } from "./crm/crypto-util";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const { AccessToken } = twilioJwt;
const { VoiceGrant } = AccessToken;

// ── Helpers ───────────────────────────────────────────────────────────────────

interface VoiceConfig {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  appSid: string;
  callerId: string;
}

function getGlobalVoiceConfig(): VoiceConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  const appSid = process.env.TWILIO_VOICE_APP_SID;
  const callerId = process.env.TWILIO_VOICE_CALLER_ID;
  if (!accountSid || !apiKeySid || !apiKeySecret || !appSid || !callerId) return null;
  return { accountSid, apiKeySid, apiKeySecret, appSid, callerId };
}

async function getCampaignVoiceConfig(campaignId: number): Promise<VoiceConfig | null> {
  const [campaign] = await db
    .select()
    .from(crmCampaigns)
    .where(eq(crmCampaigns.id, campaignId))
    .limit(1);

  if (!campaign) return null;

  const accountSid = campaign.twilioAccountSid;
  const apiKeySid = campaign.twilioApiKeySid;
  const encApiSecret = campaign.twilioApiKeySecret;
  const appSid = campaign.twilioVoiceAppSid;
  const callerId = campaign.twilioPhoneNumber;

  if (!accountSid || !apiKeySid || !encApiSecret || !appSid || !callerId) return null;

  let apiKeySecret: string;
  try {
    apiKeySecret = encApiSecret.includes(":") ? decryptPassword(encApiSecret) : encApiSecret;
  } catch {
    apiKeySecret = encApiSecret;
  }

  return { accountSid, apiKeySid, apiKeySecret, appSid, callerId };
}

async function resolveVoiceConfig(
  campaignId: number | null,
  isSuperAdmin: boolean
): Promise<VoiceConfig> {
  if (campaignId) {
    const cfg = await getCampaignVoiceConfig(campaignId);
    if (cfg) return cfg;
  }
  if (isSuperAdmin) {
    const global = getGlobalVoiceConfig();
    if (global) return global;
  }
  throw Object.assign(
    new Error(
      campaignId
        ? "Twilio Voice is not fully configured for this campaign. Set API Key SID, API Key Secret, Voice App SID, and Phone Number in Campaign → Twilio settings."
        : "Twilio Voice is not configured. Ask your admin to set up Twilio credentials."
    ),
    { status: 422 }
  );
}

// ── POST /api/twilio/voice/token ──────────────────────────────────────────────
// Returns a short-lived Access Token for Twilio Voice SDK (browser calling)
router.post("/twilio/voice/token", crmAuth, async (req, res) => {
  try {
    const crmUser = req.crmUser!;
    const isSuperAdmin = crmUser.role === "super_admin";
    const cfg = await resolveVoiceConfig(crmUser.campaignId, isSuperAdmin);

    const identity = `user_${crmUser.id ?? crmUser.userId}`;

    const token = new AccessToken(cfg.accountSid, cfg.apiKeySid, cfg.apiKeySecret, {
      identity,
      ttl: 60 * 60,
    });

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: cfg.appSid,
      incomingAllow: true,
    });
    token.addGrant(voiceGrant);

    res.json({ token: token.toJwt(), identity, callerId: cfg.callerId });
  } catch (err: any) {
    logger.error(err, "[twilio/voice/token] error");
    res.status(err.status || 500).json({ error: err.message || "Failed to create voice token" });
  }
});

// ── POST /api/twilio/voice/answer ─────────────────────────────────────────────
// TwiML App Voice URL — Twilio hits this when the browser initiates a call.
router.post("/twilio/voice/answer", async (req, res) => {
  res.set("Content-Type", "text/xml");
  try {
    const to = (req.body?.To as string | undefined) || "";
    const callerId = (req.body?.CallerId as string | undefined) || "";
    const record = (req.body?.Record as string | undefined) === "true";

    if (!to) {
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>No destination number provided.</Say>
</Response>`);
      return;
    }
    if (!callerId) {
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Missing caller ID.</Say>
</Response>`);
      return;
    }

    const apiBase = process.env.API_BASE_URL ||
      `https://${process.env.REPLIT_DEV_DOMAIN || "localhost:8080"}/api`;
    const statusCallbackUrl = `${apiBase}/twilio/voice/call-status`;

    if (record) {
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId}" record="record-from-answer"
        recordingStatusCallback="${apiBase}/twilio/voice/recording"
        recordingStatusCallbackMethod="POST"
        action="${statusCallbackUrl}" method="POST">
    <Number>${to}</Number>
  </Dial>
</Response>`);
    } else {
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId}" action="${statusCallbackUrl}" method="POST">
    <Number>${to}</Number>
  </Dial>
</Response>`);
    }
  } catch (err) {
    logger.error(err, "[twilio/voice/answer] error");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>There was an error connecting your call.</Say>
</Response>`);
  }
});

// ── POST /api/twilio/voice/call-status ────────────────────────────────────────
// Twilio status callback — updates call log with final status & duration.
router.post("/twilio/voice/call-status", async (req, res) => {
  res.sendStatus(204);
  try {
    const callSid = req.body?.CallSid as string | undefined;
    const status = req.body?.CallStatus as string | undefined;
    const duration = req.body?.CallDuration ? parseInt(req.body.CallDuration) : undefined;

    if (!callSid) return;

    await db
      .update(crmCallLogs)
      .set({
        status: status || "completed",
        duration: duration ?? null,
        updatedAt: new Date(),
      })
      .where(eq(crmCallLogs.callSid, callSid));

    logger.info({ callSid, status, duration }, "[twilio/voice/call-status] updated");
  } catch (err) {
    logger.error(err, "[twilio/voice/call-status] error");
  }
});

// ── POST /api/twilio/voice/recording ─────────────────────────────────────────
// Twilio recording status callback — stores recording SID & URL, triggers AI transcription.
router.post("/twilio/voice/recording", async (req, res) => {
  res.sendStatus(204);
  try {
    const callSid = req.body?.CallSid as string | undefined;
    const recordingSid = req.body?.RecordingSid as string | undefined;
    const recordingUrl = req.body?.RecordingUrl as string | undefined;
    const recordingStatus = req.body?.RecordingStatus as string | undefined;

    if (!callSid || recordingStatus !== "completed") return;

    await db
      .update(crmCallLogs)
      .set({
        recordingSid: recordingSid ?? null,
        recordingUrl: recordingUrl ? `${recordingUrl}.mp3` : null,
        updatedAt: new Date(),
      })
      .where(eq(crmCallLogs.callSid, callSid));

    logger.info({ callSid, recordingSid }, "[twilio/voice/recording] stored");

    // Fire-and-forget AI transcription if OpenAI key available
    if (recordingUrl && process.env.OPENAI_API_KEY) {
      setImmediate(async () => {
        try {
          const audioResp = await fetch(`${recordingUrl}.mp3`);
          if (!audioResp.ok) return;
          const audioBuffer = Buffer.from(await audioResp.arrayBuffer());

          const formData = new FormData();
          formData.append("file", new Blob([audioBuffer], { type: "audio/mpeg" }), "recording.mp3");
          formData.append("model", "whisper-1");

          const transcriptResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
            body: formData,
          });

          if (!transcriptResp.ok) return;
          const { text } = await transcriptResp.json() as { text: string };

          await db
            .update(crmCallLogs)
            .set({ transcript: text, updatedAt: new Date() })
            .where(eq(crmCallLogs.callSid, callSid!));

          logger.info({ callSid }, "[twilio/voice/recording] transcript saved");
        } catch (err) {
          logger.error(err, "[twilio/voice/recording] transcription error");
        }
      });
    }
  } catch (err) {
    logger.error(err, "[twilio/voice/recording] error");
  }
});

// ── POST /api/twilio/voice/log ────────────────────────────────────────────────
// Frontend calls this when a browser call is initiated to create a call log entry.
router.post("/twilio/voice/log", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  try {
    const { callSid, leadId, toNumber, fromNumber, direction, analytics } = req.body;

    const [log] = await db.insert(crmCallLogs).values({
      callSid: callSid || null,
      campaignId: crmUser.campaignId,
      leadId: leadId ? Number(leadId) : null,
      userId: crmUser.userId ?? crmUser.id,
      direction: direction || "outbound",
      status: "initiated",
      fromNumber: fromNumber || null,
      toNumber: toNumber || null,
      mosScore: analytics?.mos ? String(analytics.mos) : null,
      jitterMs: analytics?.jitter ? String(analytics.jitter) : null,
      packetLossPct: analytics?.packetLoss ? String(analytics.packetLoss) : null,
    }).onConflictDoNothing().returning();

    res.json({ success: true, id: log?.id ?? null });
  } catch (err: any) {
    logger.error(err, "[twilio/voice/log] error");
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/twilio/voice/log/:callSid ─────────────────────────────────────
// Update a call log with final analytics (MOS, jitter, packet loss) from the SDK.
router.patch("/twilio/voice/log/:callSid", crmAuth, async (req, res) => {
  const { callSid } = req.params;
  try {
    const { mos, jitter, packetLoss, status, duration, disposition, aiCoachingSummary } = req.body;
    await db
      .update(crmCallLogs)
      .set({
        mosScore: mos != null ? String(mos) : undefined,
        jitterMs: jitter != null ? String(jitter) : undefined,
        packetLossPct: packetLoss != null ? String(packetLoss) : undefined,
        status: status || undefined,
        duration: duration != null ? Number(duration) : undefined,
        disposition: disposition || undefined,
        aiCoachingSummary: aiCoachingSummary || undefined,
        updatedAt: new Date(),
      })
      .where(eq(crmCallLogs.callSid, callSid as string));
    res.json({ success: true });
  } catch (err: any) {
    logger.error(err, "[twilio/voice/log PATCH] error");
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/twilio/voice/coach ─────────────────────────────────────────────
// AI call coaching: fetches transcript from call log and returns GPT-4o-mini
// coaching feedback (score, strengths, improvements, follow-up task, suggested offer).
router.post("/twilio/voice/coach", crmAuth, async (req, res) => {
  const { callSid, transcript: directTranscript } = req.body;

  let transcript: string | null = directTranscript ?? null;

  // Look up transcript from DB if callSid provided
  if (callSid && !transcript) {
    try {
      const [log] = await db
        .select({ transcript: crmCallLogs.transcript })
        .from(crmCallLogs)
        .where(eq(crmCallLogs.callSid, callSid as string))
        .limit(1);
      transcript = log?.transcript ?? null;
    } catch { /* fall through */ }
  }

  if (!transcript) {
    res.status(400).json({
      error: "No transcript available. The call must be recorded and transcribed first (usually takes 1–2 minutes after the call ends).",
    });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(503).json({ error: "AI coaching requires OPENAI_API_KEY to be configured." });
    return;
  }

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 500,
        messages: [
          {
            role: "system",
            content: `You are an expert real estate wholesaling call coach. Analyze the call transcript and return ONLY valid JSON with these exact keys:
{
  "score": <integer 1-10>,
  "strengths": "<one short sentence highlighting what went well>",
  "improvements": "<one short sentence on the single most important thing to improve>",
  "followUpTask": "<specific actionable next step, e.g. 'Send offer letter for $145,000 by Friday'>",
  "suggestedOffer": <number or null>,
  "offerRationale": "<one sentence explaining the suggested offer price, or null if no offer context>"
}`,
          },
          {
            role: "user",
            content: `Analyze this real estate wholesaling call transcript:\n\n${transcript.slice(0, 3000)}`,
          },
        ],
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({})) as any;
      throw new Error(errBody?.error?.message || `OpenAI API error ${resp.status}`);
    }

    const aiData = await resp.json() as any;
    const raw = aiData.choices?.[0]?.message?.content || "{}";

    let coaching: any;
    try {
      coaching = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
    } catch {
      coaching = { score: null, improvements: raw, followUpTask: null, suggestedOffer: null };
    }

    // Persist coaching summary to call log (non-critical)
    if (callSid) {
      try {
        await db
          .update(crmCallLogs)
          .set({ aiCoachingSummary: JSON.stringify(coaching), updatedAt: new Date() })
          .where(eq(crmCallLogs.callSid, callSid as string));
      } catch { /* non-critical */ }
    }

    res.json({ coaching });
  } catch (err: any) {
    logger.error(err, "[twilio/voice/coach] error");
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/twilio/voice/calls ───────────────────────────────────────────────
// List call logs for a campaign (optionally filtered by leadId).
router.get("/twilio/voice/calls", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  if (!crmUser.campaignId && crmUser.role !== "super_admin") {
    res.json({ calls: [] });
    return;
  }
  try {
    const { leadId } = req.query as Record<string, string>;
    const conditions = [];
    if (crmUser.campaignId) conditions.push(eq(crmCallLogs.campaignId, crmUser.campaignId));
    if (leadId) conditions.push(eq(crmCallLogs.leadId, Number(leadId)));

    const calls = await db
      .select()
      .from(crmCallLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(crmCallLogs.createdAt))
      .limit(100);

    res.json({ calls });
  } catch (err: any) {
    logger.error(err, "[twilio/voice/calls] error");
    res.status(500).json({ error: err.message });
  }
});

export default router;
