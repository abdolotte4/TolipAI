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
  crmUsers,
} from "@workspace/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import {
  type TwilioVoiceConfig,
  resolveVoiceConfig,
  getVoiceConfig,
  getSmsCreds,
  getGlobalVoiceConfig,
  getGlobalSmsCreds,
} from "../services/twilioCredentials";
import {
  getOpenAIKey,
  getOpenAIBaseUrl,
  callAI,
  transcribeAudio,
  hasAI,
  getChatModel,
} from "../services/aiConfig";
import { logger } from "../lib/logger";
import { emitCrmActivity } from "./sse";

const router: IRouter = Router();
const { AccessToken } = twilioJwt;
const { VoiceGrant } = AccessToken;

// ── In-memory live transcript store (per callSid) ────────────────────────────
interface TranscriptSegment {
  track: "inbound" | "outbound";
  text: string;
  ts: number;
}
interface LiveCallTranscript {
  segments: TranscriptSegment[];
  aiSuggestionTimer: ReturnType<typeof setTimeout> | null;
  fullText: string;
}
const liveTranscripts = new Map<string, LiveCallTranscript>();

function cleanupTranscript(callSid: string) {
  const entry = liveTranscripts.get(callSid);
  if (entry?.aiSuggestionTimer) clearTimeout(entry.aiSuggestionTimer);
  liveTranscripts.delete(callSid);
}

// ── Conference state (enables hold with music) ────────────────────────────────
interface ConferenceState {
  conferenceName: string;
  agentCallSid: string;
  callerCallSid: string | null;
  conferenceSid: string | null;
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
}
const activeConferences = new Map<string, ConferenceState>();

// Resolve voice API key credentials by Twilio Account SID.
// Used inside the /answer webhook (no crmAuth — looks up campaign by accountSid).
async function getVoiceConfigByAccountSid(accountSid: string): Promise<{
  accountSid: string; apiKeySid: string; apiKeySecret: string;
} | null> {
  try {
    const [camp] = await db
      .select({ id: crmCampaigns.id })
      .from(crmCampaigns)
      .where(eq(crmCampaigns.twilioAccountSid, accountSid))
      .limit(1);
    if (camp?.id) {
      const cfg = await getVoiceConfig(camp.id);
      if (cfg) return { accountSid: cfg.accountSid, apiKeySid: cfg.apiKeySid, apiKeySecret: cfg.apiKeySecret };
    }
    const global = getGlobalVoiceConfig();
    if (global && global.accountSid === accountSid) {
      return { accountSid: global.accountSid, apiKeySid: global.apiKeySid, apiKeySecret: global.apiKeySecret };
    }
    return null;
  } catch { return null; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
// Includes a Call Whisper: before dialing the seller, the agent hears a brief
// <Say> with the lead's name, status, and asking price (P1-10).
router.post("/twilio/voice/answer", async (req, res) => {
  res.set("Content-Type", "text/xml");
  try {
    const to = (req.body?.To as string | undefined) || "";
    const agentCallSid = (req.body?.CallSid as string | undefined) || "";
    let callerId = (req.body?.CallerId as string | undefined) || "";
    const record = (req.body?.Record as string | undefined) === "true";
    const accountSidFromTwilio = (req.body?.AccountSid as string | undefined) || "";

    // If CallerId is missing or not a real E.164 phone number, look up the campaign phone
    // from the DB using the AccountSid that Twilio always sends in the POST body.
    if ((!callerId || !callerId.startsWith("+")) && accountSidFromTwilio) {
      try {
        const [camp] = await db
          .select({ phone: crmCampaigns.twilioPhoneNumber })
          .from(crmCampaigns)
          .where(eq(crmCampaigns.twilioAccountSid, accountSidFromTwilio))
          .limit(1);
        if (camp?.phone) callerId = camp.phone;
      } catch {
        // Non-fatal — handled below
      }
    }

    // Global env-var fallback
    if (!callerId || !callerId.startsWith("+")) {
      callerId = process.env.TWILIO_VOICE_CALLER_ID || "";
    }

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
  <Say>No phone number is configured for this campaign. Please add a Twilio phone number in the campaign Twilio settings.</Say>
</Response>`);
      return;
    }

    const apiBase = process.env.API_BASE_URL ||
      `https://${req.headers.host || process.env.REPLIT_DEV_DOMAIN || "localhost:8080"}/api`;
    const statusCallbackUrl = `${apiBase}/twilio/voice/call-status`;

    // ── Call Whisper (P1-10) ──────────────────────────────────────────────────
    // Look up lead by destination number so the agent hears their info before
    // the call connects. Failure is silent — the call still goes through.
    let whisperXml = "";
    try {
      const digits10 = to.replace(/\D/g, "").slice(-10);
      const [lead] = await db
        .select({
          sellerName:      crmLeads.sellerName,
          status:          crmLeads.status,
          askingPrice:     crmLeads.askingPrice,
          askingPriceText: crmLeads.askingPriceText,
          howSoon:         crmLeads.howSoon,
        })
        .from(crmLeads)
        .where(sql`regexp_replace(${crmLeads.phone}, '[^0-9]', '', 'g') LIKE ${"%" + digits10}`)
        .orderBy(desc(crmLeads.createdAt))
        .limit(1);

      if (lead) {
        const name    = lead.sellerName || "Unknown seller";
        const status  = lead.status     || "new";
        const price   = lead.askingPriceText
          || (lead.askingPrice ? `$${Number(lead.askingPrice).toLocaleString()}` : "not stated");
        const timeline = lead.howSoon   || "unknown";
        whisperXml = `\n  <Say voice="Polly.Joanna">Lead: ${name}. Status: ${status}. Asking: ${price}. Timeline: ${timeline}.</Say>`;
      }
    } catch {
      // Non-fatal — whisper is optional
    }

    const transcriptionXml = `
  <Start>
    <Transcription statusCallbackUrl="${apiBase}/twilio/voice/transcript" statusCallbackMethod="POST" track="both" />
  </Start>`;

    // Try Conference-based calling (enables proper hold music via participant API).
    // Falls back to classic <Dial><Number> when API key credentials are unavailable.
    const confName = agentCallSid ? `conf-${agentCallSid}` : null;
    const voiceCfg = confName && accountSidFromTwilio
      ? await getVoiceConfigByAccountSid(accountSidFromTwilio).catch(() => null)
      : null;

    if (confName && voiceCfg) {
      // ── Conference-based TwiML (hold music capable) ───────────────────────
      const recordAttr = record
        ? `record="record-from-start" recordingStatusCallback="${apiBase}/twilio/voice/recording" recordingStatusCallbackMethod="POST"`
        : "";

      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>${whisperXml}${transcriptionXml}
  <Dial callerId="${callerId}" action="${statusCallbackUrl}" method="POST">
    <Conference startConferenceOnEnter="true"
                endConferenceOnExit="true"
                beep="false"
                waitUrl="https://twimlets.com/holdmusic?Bucket=com.twilio.music.classical"
                waitMethod="GET"
                ${recordAttr}
                statusCallback="${apiBase}/twilio/voice/conference-status?agentCallSid=${encodeURIComponent(agentCallSid)}"
                statusCallbackMethod="POST"
                statusCallbackEvent="join start end">
      ${confName}
    </Conference>
  </Dial>
</Response>`);

      // Dial the destination into the conference via Twilio REST API (async — after TwiML is sent)
      const finalCfg = voiceCfg;
      const finalTo = to;
      const finalCallerId = callerId;
      const finalApiBase = apiBase;
      const finalConfName = confName;
      setImmediate(async () => {
        try {
          const auth = Buffer.from(`${finalCfg.apiKeySid}:${finalCfg.apiKeySecret}`).toString("base64");
          const dialResp = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${finalCfg.accountSid}/Calls.json`,
            {
              method: "POST",
              headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                To: finalTo,
                From: finalCallerId,
                Url: `${finalApiBase}/twilio/voice/join-conference?conf=${encodeURIComponent(finalConfName)}`,
                Method: "POST",
              }).toString(),
            }
          );
          if (dialResp.ok) {
            const data = await dialResp.json() as any;
            const existing = activeConferences.get(finalConfName);
            activeConferences.set(finalConfName, {
              conferenceName: finalConfName,
              agentCallSid,
              callerCallSid: data.sid,
              conferenceSid: existing?.conferenceSid ?? null,
              accountSid: finalCfg.accountSid,
              apiKeySid: finalCfg.apiKeySid,
              apiKeySecret: finalCfg.apiKeySecret,
            });
            logger.info({ confName: finalConfName, callerSid: data.sid }, "[twilio/voice/answer] dialed destination into conference");
          } else {
            const text = await dialResp.text();
            logger.error({ text, to: finalTo }, "[twilio/voice/answer] failed to dial destination into conference — callee may not hear ring");
          }
        } catch (err) {
          logger.error(err, "[twilio/voice/answer] conference REST dial error");
        }
      });
    } else {
      // ── Fallback: classic <Dial><Number> (no hold music) ─────────────────
      if (record) {
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>${whisperXml}${transcriptionXml}
  <Dial callerId="${callerId}" record="record-from-answer"
        recordingStatusCallback="${apiBase}/twilio/voice/recording"
        recordingStatusCallbackMethod="POST"
        action="${statusCallbackUrl}" method="POST">
    <Number>${to}</Number>
  </Dial>
</Response>`);
      } else {
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>${whisperXml}${transcriptionXml}
  <Dial callerId="${callerId}" action="${statusCallbackUrl}" method="POST">
    <Number>${to}</Number>
  </Dial>
</Response>`);
      }
    }
  } catch (err) {
    logger.error(err, "[twilio/voice/answer] error");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>There was an error connecting your call.</Say>
</Response>`);
  }
});

// ── POST /api/twilio/voice/join-conference ────────────────────────────────────
// TwiML URL for the called party (destination) to join the agent's conference room.
router.post("/twilio/voice/join-conference", async (req, res) => {
  res.set("Content-Type", "text/xml");
  const confName = (req.query.conf as string | undefined) || "";
  if (!confName) {
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    return;
  }
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Conference startConferenceOnEnter="true"
                endConferenceOnExit="true"
                beep="false">
      ${confName}
    </Conference>
  </Dial>
</Response>`);
});

// ── POST /api/twilio/voice/conference-status ──────────────────────────────────
// Twilio fires this when the conference state changes (join/start/end).
// We capture the ConferenceSid so the hold endpoint can use the participant API.
router.post("/twilio/voice/conference-status", async (req, res) => {
  res.status(204).end();
  try {
    const agentCallSid = (req.query.agentCallSid as string | undefined) || "";
    const conferenceSid = (req.body?.ConferenceSid as string | undefined) || "";
    if (!agentCallSid || !conferenceSid) return;
    const confName = `conf-${agentCallSid}`;
    const existing = activeConferences.get(confName);
    if (existing) {
      existing.conferenceSid = conferenceSid;
      activeConferences.set(confName, existing);
    } else {
      const global = getGlobalVoiceConfig();
      activeConferences.set(confName, {
        conferenceName: confName,
        agentCallSid,
        callerCallSid: null,
        conferenceSid,
        accountSid: global?.accountSid || "",
        apiKeySid: global?.apiKeySid || "",
        apiKeySecret: global?.apiKeySecret || "",
      });
    }
    logger.info({ confName, conferenceSid }, "[twilio/voice/conference-status] stored");
  } catch (err) {
    logger.error(err, "[twilio/voice/conference-status] error");
  }
});

// ── POST /api/twilio/voice/call-status ────────────────────────────────────────
// Twilio status callback — updates call log with final status & duration.
router.post("/twilio/voice/call-status", async (req, res) => {
  res.type("text/xml").send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>");
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
  // Recording status callbacks expect a 200 with no TwiML — not text/xml
  res.status(200).json({ received: true });
  try {
    let callSid = req.body?.CallSid as string | undefined;
    const recordingSid = req.body?.RecordingSid as string | undefined;
    const recordingUrl = req.body?.RecordingUrl as string | undefined;
    const recordingStatus = req.body?.RecordingStatus as string | undefined;

    // Conference recordings don't send CallSid — extract it from ConferenceName ("conf-{agentCallSid}")
    if (!callSid) {
      const conferenceName = req.body?.ConferenceName as string | undefined;
      if (conferenceName?.startsWith("conf-")) {
        callSid = conferenceName.slice(5);
      }
    }

    if (!callSid || recordingStatus !== "completed") return;

    const [updated] = await db
      .update(crmCallLogs)
      .set({
        recordingSid: recordingSid ?? null,
        recordingUrl: recordingUrl ? `${recordingUrl}.mp3` : null,
        updatedAt: new Date(),
      })
      .where(eq(crmCallLogs.callSid, callSid))
      .returning({ id: crmCallLogs.id });

    // If no call log row exists yet (race condition or log-creation failure), insert a minimal one
    if (!updated) {
      try {
        await db.insert(crmCallLogs).values({
          callSid,
          recordingSid: recordingSid ?? null,
          recordingUrl: recordingUrl ? `${recordingUrl}.mp3` : null,
          direction: "outbound",
          status: "completed",
        } as any).onConflictDoNothing();
        logger.info({ callSid }, "[twilio/voice/recording] inserted orphaned recording row");
      } catch (insertErr) {
        logger.error(insertErr, "[twilio/voice/recording] failed to insert orphaned recording");
      }
    }

    logger.info({ callSid, recordingSid }, "[twilio/voice/recording] stored");

    // Fire-and-forget AI transcription if OpenAI key available
    if (recordingUrl && getOpenAIKey()) {
      // Look up campaign for recording auth (callSid already bound in outer scope)
      let recordingAuthHeader: Record<string, string> = {};
      try {
        const [callLogRow] = await db
          .select({ campaignId: crmCallLogs.campaignId })
          .from(crmCallLogs)
          .where(eq(crmCallLogs.callSid, callSid!))
          .limit(1);
        const creds = callLogRow?.campaignId
          ? (await getSmsCreds(callLogRow.campaignId) ?? getGlobalSmsCreds())
          : getGlobalSmsCreds();
        if (creds) {
          recordingAuthHeader = {
            Authorization: `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")}`,
          };
        }
      } catch { /* auth header best-effort — fall through without it */ }

      setImmediate(async () => {
        try {
          const audioResp = await fetch(`${recordingUrl}.mp3`, { headers: recordingAuthHeader });
          if (!audioResp.ok) return;
          const audioBuffer = Buffer.from(await audioResp.arrayBuffer());

          const text = await transcribeAudio(audioBuffer, "recording.mp3");
          if (!text) return;

          await db
            .update(crmCallLogs)
            .set({ transcript: text, updatedAt: new Date() })
            .where(eq(crmCallLogs.callSid, callSid!));

          logger.info({ callSid }, "[twilio/voice/recording] transcript saved");
        } catch (err) {
          logger.error(err, "[twilio/voice/recording] transcription error (OpenAI + Groq both failed)");
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

  if (!getOpenAIKey()) {
    res.status(503).json({ error: "AI coaching requires an OpenAI API key to be configured." });
    return;
  }

  try {
    const resp = await fetch(`${getOpenAIBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getOpenAIKey()}`,
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

// ── POST /api/twilio/voice/hold ───────────────────────────────────────────────
// Hold the active call. When conference-based calling is in use (API keys configured),
// uses the Twilio Conference Participant REST API to play hold music to the caller.
// Falls back gracefully when conference state isn't available (e.g. fallback Number dial).
// Body: { callSid: string, hold: boolean }
router.post("/twilio/voice/hold", crmAuth, async (req, res) => {
  const { callSid, hold } = req.body as { callSid?: string; hold?: boolean };
  const isHold = hold ?? false;

  if (!callSid) {
    res.json({ success: true, held: isHold, mode: "mute-only" });
    return;
  }

  const confName = `conf-${callSid}`;
  const conf = activeConferences.get(confName);

  if (!conf?.conferenceSid || !conf?.callerCallSid) {
    // Conference not yet established — client-side mute handles audio
    res.json({ success: true, held: isHold, mode: "mute-only" });
    return;
  }

  try {
    const auth = Buffer.from(`${conf.apiKeySid}:${conf.apiKeySecret}`).toString("base64");
    const holdBody = new URLSearchParams({ Hold: isHold ? "true" : "false" });
    if (isHold) {
      holdBody.set("HoldUrl", "https://twimlets.com/holdmusic?Bucket=com.twilio.music.classical");
      holdBody.set("HoldMethod", "GET");
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${conf.accountSid}/Conferences/${conf.conferenceSid}/Participants/${conf.callerCallSid}.json`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: holdBody.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.warn({ text, callSid }, "[twilio/voice/hold] participant API error — falling back to mute-only");
      res.json({ success: true, held: isHold, mode: "mute-only", warning: "Hold music unavailable" });
      return;
    }

    logger.info({ callSid, isHold, confName }, "[twilio/voice/hold] conference hold set");
    res.json({ success: true, held: isHold, mode: "conference" });
  } catch (err: any) {
    logger.error(err, "[twilio/voice/hold] error");
    res.json({ success: true, held: isHold, mode: "mute-only" });
  }
});

// ── POST /api/twilio/voice/voicemail-drop ─────────────────────────────────────
// Redirects an active outbound call to a pre-recorded voicemail message then
// hangs up, freeing the agent to move to the next lead.
// Body: { callSid: string, message?: string }
router.post("/twilio/voice/voicemail-drop", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  const { callSid, message } = req.body as { callSid?: string; message?: string };

  if (!callSid) {
    res.status(400).json({ error: "callSid is required" });
    return;
  }

  try {
    const isSuperAdmin = crmUser.role === "super_admin";
    const cfg = await resolveVoiceConfig(crmUser.campaignId, isSuperAdmin);

    const vmText = (message || "").trim() ||
      "Hi, this is a message regarding your property. We are a local real estate investor and would love to make you a fair cash offer. Please call us back at your earliest convenience. Thank you and have a great day.";

    // Escape XML special chars in the voicemail text
    const safe = vmText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">${safe}</Say><Hangup/></Response>`;

    // Use API Key SID + secret as Basic auth — Twilio accepts both AccountSID:AuthToken
    // and APIKeySID:APIKeySecret for REST API calls.
    const creds = Buffer.from(`${cfg.apiKeySid}:${cfg.apiKeySecret}`).toString("base64");
    const twilioResp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Calls/${encodeURIComponent(callSid)}.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${creds}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ Twiml: twiml }).toString(),
      }
    );

    if (!twilioResp.ok) {
      const body = await twilioResp.json().catch(() => ({})) as any;
      throw Object.assign(
        new Error(body?.message || `Twilio API error ${twilioResp.status}`),
        { status: twilioResp.status }
      );
    }

    res.json({ success: true });
  } catch (err: any) {
    logger.error(err, "[twilio/voice/voicemail-drop] error");
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /api/twilio/voice/warm-transfer ─────────────────────────────────────
// Warm / blind transfer: puts lead on hold, dials a second number (partner or
// title company), lets the agent speak privately, then bridges all parties into
// a Twilio Conference so the agent can introduce them before dropping off.
//
// Body: { callSid: string, transferTo: string }
// Returns: { conferenceRoom: string, transferCallSid: string }
router.post("/twilio/voice/warm-transfer", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  const { callSid, transferTo } = req.body as { callSid?: string; transferTo?: string };

  if (!callSid || !transferTo) {
    res.status(400).json({ error: "callSid and transferTo are required" });
    return;
  }

  try {
    const isSuperAdmin = crmUser.role === "super_admin";
    const cfg = await resolveVoiceConfig(crmUser.campaignId, isSuperAdmin);

    const creds = Buffer.from(`${cfg.apiKeySid}:${cfg.apiKeySecret}`).toString("base64");
    const conferenceRoom = `wtxfr-${callSid.slice(-8)}-${Date.now()}`;

    const conferenceTwiml = (muted: boolean, startOnEnter: boolean, endOnExit: boolean) =>
      `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Conference beep="false" startConferenceOnEnter="${startOnEnter}" endConferenceOnExit="${endOnExit}" muted="${muted}" waitUrl="https://twimlets.com/holdmusic?Bucket=com.twilio.music.classical">${conferenceRoom}</Conference></Dial></Response>`;

    // Step 1: Move the existing call (agent + lead) into the conference.
    // Redirect callSid (parent browser call) → conference, agent is unmuted.
    const redirectResp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Calls/${encodeURIComponent(callSid)}.json`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ Twiml: conferenceTwiml(false, true, false) }).toString(),
      }
    );

    if (!redirectResp.ok) {
      const body = await redirectResp.json().catch(() => ({})) as any;
      throw Object.assign(new Error(body?.message || `Twilio redirect error ${redirectResp.status}`), { status: redirectResp.status });
    }

    // Also redirect any child calls (the lead's phone leg) to the same conference — muted until bridge.
    try {
      const childResp = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Calls.json?ParentCallSid=${encodeURIComponent(callSid)}&Status=in-progress`,
        { headers: { Authorization: `Basic ${creds}` } }
      );
      if (childResp.ok) {
        const childData = await childResp.json() as any;
        for (const child of (childData.calls || [])) {
          await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Calls/${encodeURIComponent(child.sid)}.json`,
            {
              method: "POST",
              headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ Twiml: conferenceTwiml(true, false, true) }).toString(),
            }
          );
        }
      }
    } catch { /* non-critical — child redirect is best-effort */ }

    // Step 2: Dial the transfer target into the same conference.
    const apiBase = process.env.API_BASE_URL ||
      `https://${req.headers.host || process.env.REPLIT_DEV_DOMAIN || "localhost:8080"}/api`;

    const callCreateResp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Calls.json`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          To: transferTo,
          From: cfg.callerId || "",
          Twiml: `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">Please hold while your call is connected.</Say><Dial><Conference beep="true" startConferenceOnEnter="true" endConferenceOnExit="true" muted="false">${conferenceRoom}</Conference></Dial></Response>`,
          StatusCallback: `${apiBase}/twilio/voice/call-status`,
          StatusCallbackMethod: "POST",
        }).toString(),
      }
    );

    if (!callCreateResp.ok) {
      const body = await callCreateResp.json().catch(() => ({})) as any;
      throw Object.assign(new Error(body?.message || `Twilio dial error ${callCreateResp.status}`), { status: callCreateResp.status });
    }

    const newCall = await callCreateResp.json() as any;

    logger.info({ callSid, transferTo, conferenceRoom, newCallSid: newCall.sid }, "[twilio/voice/warm-transfer] initiated");
    res.json({ conferenceRoom, transferCallSid: newCall.sid });
  } catch (err: any) {
    logger.error(err, "[twilio/voice/warm-transfer] error");
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /api/twilio/voice/complete-transfer ──────────────────────────────────
// Agent hangs up their conference leg, leaving lead + transfer target connected.
// Body: { callSid: string } — the agent's browser call SID
router.post("/twilio/voice/complete-transfer", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  const { callSid } = req.body as { callSid?: string };
  if (!callSid) { res.status(400).json({ error: "callSid is required" }); return; }
  try {
    const isSuperAdmin = crmUser.role === "super_admin";
    const cfg = await resolveVoiceConfig(crmUser.campaignId, isSuperAdmin);
    const creds = Buffer.from(`${cfg.apiKeySid}:${cfg.apiKeySecret}`).toString("base64");
    await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Calls/${encodeURIComponent(callSid)}.json`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ Status: "completed" }).toString(),
      }
    );
    res.json({ success: true });
  } catch (err: any) {
    logger.error(err, "[twilio/voice/complete-transfer] error");
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /api/twilio/voice/inbound ────────────────────────────────────────────
// Smart inbound call router — set this as the Voice URL for your Twilio number.
//
// Routing logic:
//   Caller IS a known CRM lead → rings all browser-connected agents simultaneously.
//     If no agent answers within 20s → falls back to AI qualification agent.
//   Caller is NOT in CRM → routes directly to AI qualification agent.
//
// Configure via: CRM → Integrations → Twilio → "Auto-Configure Webhooks"
// Or set manually in the Twilio Console phone number Voice URL field.
router.post("/twilio/voice/inbound", async (req, res) => {
  res.set("Content-Type", "text/xml");

  const callSid   = (req.body?.CallSid as string)  || "";
  const fromNum   = (req.body?.From   as string)    || "";
  const toNum     = (req.body?.To     as string)    || "";
  const accountSidFromTwilio = (req.body?.AccountSid as string) || "";

  const rawHost = (req.headers.host || "").replace(/:\d+$/, "");
  const apiBase = process.env.API_BASE_URL ||
    `https://${process.env.REPLIT_DEV_DOMAIN || rawHost || "localhost"}/api`;

  // Helper: TwiML that connects directly to the AI agent stream
  const aiAgentTwiml = () => {
    const wsBase = apiBase.replace(/^https?/, (m) => (m === "https" ? "wss" : "ws"));
    const streamUrl = `${wsBase}/twilio/voice/agent-stream`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="from" value="${fromNum}"/>
      <Parameter name="to" value="${toNum}"/>
    </Stream>
  </Connect>
</Response>`;
  };

  try {
    // ── 1. Identify the campaign by the called Twilio number ──────────────────
    let campaignId: number | null = null;
    let campaignForwardPhone: string | null = null;
    if (toNum || accountSidFromTwilio) {
      const toDigits = toNum.replace(/\D/g, "");
      const camps = await db
        .select({ id: crmCampaigns.id, twilioAccountSid: crmCampaigns.twilioAccountSid, twilioPhoneNumber: crmCampaigns.twilioPhoneNumber, twilioForwardPhone: crmCampaigns.twilioForwardPhone })
        .from(crmCampaigns)
        .where(eq(crmCampaigns.twilioEnabled, true));

      for (const c of camps) {
        const sidMatch = accountSidFromTwilio && c.twilioAccountSid === accountSidFromTwilio;
        const numMatch = c.twilioPhoneNumber &&
          c.twilioPhoneNumber.replace(/\D/g, "").slice(-10) === toDigits.slice(-10);
        if (sidMatch || numMatch) { campaignId = c.id; campaignForwardPhone = c.twilioForwardPhone || null; break; }
      }
    }

    // ── 2. Look up the caller in CRM leads ────────────────────────────────────
    const fromDigits10 = fromNum.replace(/\D/g, "").slice(-10);
    const [lead] = await db
      .select({ id: crmLeads.id, sellerName: crmLeads.sellerName, status: crmLeads.status })
      .from(crmLeads)
      .where(
        sql`regexp_replace(${crmLeads.phone}, '[^0-9]', '', 'g') LIKE ${"%" + fromDigits10}`
      )
      .orderBy(desc(crmLeads.createdAt))
      .limit(1);

    if (!lead) {
      // Unknown caller — AI agent qualifies them as a new lead
      logger.info({ fromNum, toNum }, "[twilio/voice/inbound] unknown caller → AI agent");
      res.send(aiAgentTwiml());
      return;
    }

    // ── 3. Find browser-connected agents for this campaign ────────────────────
    const agentWhere = campaignId
      ? eq(crmUsers.campaignId, campaignId)
      : sql`1=1`;

    const agents = await db
      .select({ id: crmUsers.id, name: crmUsers.name })
      .from(crmUsers)
      .where(agentWhere)
      .limit(8);

    if (agents.length === 0) {
      logger.info({ fromNum, leadId: lead.id }, "[twilio/voice/inbound] no agents → AI agent");
      res.send(aiAgentTwiml());
      return;
    }

    // ── 4. Log the inbound call ───────────────────────────────────────────────
    if (callSid) {
      db.insert(crmCallLogs).values({
        callSid,
        campaignId,
        leadId: lead.id,
        direction: "inbound",
        status: "ringing",
        fromNumber: fromNum,
        toNumber: toNum,
        disposition: "inbound_lead",
      }).onConflictDoNothing().catch(() => { /* non-fatal */ });
    }

    // ── 5. Ring all agents simultaneously in the browser dialer ──────────────
    // Twilio Client identity format matches the token issued in /voice/token:
    //   identity = `user_${crmUser.id}`
    const sellerName = (lead.sellerName || "a lead").replace(/[<>&"]/g, (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c
    );
    const clientTags = agents.map((a) => `    <Client>user_${a.id}</Client>`).join("\n");
    // Also ring the campaign's personal/forward phone simultaneously (if set)
    const forwardTag = campaignForwardPhone
      ? `\n    <Number>${campaignForwardPhone}</Number>` : "";

    logger.info(
      { fromNum, toNum, leadId: lead.id, agents: agents.length, forwardPhone: campaignForwardPhone },
      "[twilio/voice/inbound] known lead → ringing agents"
    );

    // Notify all connected browser clients so agents see the incoming call toast
    setImmediate(() => {
      emitCrmActivity("incoming_call", {
        campaignId: campaignId ?? null,
        leadId: lead.id,
        leadName: lead.sellerName || null,
        phone: fromNum,
        ts: Date.now(),
      });
    });

    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Incoming call from ${sellerName}.</Say>
  <Dial timeout="30" action="${apiBase}/twilio/voice/inbound-no-answer" method="POST">
${clientTags}${forwardTag}
  </Dial>
</Response>`);
  } catch (err) {
    logger.error(err, "[twilio/voice/inbound] error — falling back to AI agent");
    const wsBase = apiBase.replace(/^https?/, (m) => (m === "https" ? "wss" : "ws"));
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsBase}/twilio/voice/agent-stream">
      <Parameter name="from" value="${fromNum}"/>
      <Parameter name="to" value="${toNum}"/>
    </Stream>
  </Connect>
</Response>`);
  }
});

// ── POST /api/twilio/voice/inbound-no-answer ──────────────────────────────────
// Dial action callback — called when no browser agent answers within the timeout.
// Falls back to the AI qualification agent so the caller is never dropped.
router.post("/twilio/voice/inbound-no-answer", async (req, res) => {
  res.set("Content-Type", "text/xml");

  const fromNum = (req.body?.From as string) || "";
  const toNum   = (req.body?.To   as string) || "";
  const rawHost = (req.headers.host || "").replace(/:\d+$/, "");
  const apiBase = process.env.API_BASE_URL ||
    `https://${process.env.REPLIT_DEV_DOMAIN || rawHost || "localhost"}/api`;
  const wsBase  = apiBase.replace(/^https?/, (m) => (m === "https" ? "wss" : "ws"));

  logger.info({ fromNum, toNum }, "[twilio/voice/inbound-no-answer] no agent answered → AI agent or voicemail");

  // If OpenAI is not configured, fall back to voicemail so the call never dead-ends
  if (!getOpenAIKey()) {
    logger.warn("[twilio/voice/inbound-no-answer] No OpenAI key configured — falling back to voicemail recording");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Thank you for calling. Our team is unavailable right now. Please leave a message after the tone and we will return your call within 24 hours.</Say>
  <Record maxLength="120" transcribeCallback="${apiBase}/twilio/voice/recording" playBeep="true" />
  <Say voice="Polly.Joanna">Thank you, goodbye.</Say>
  <Hangup/>
</Response>`);
    return;
  }

  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Please hold while we connect you with our assistant.</Say>
  <Connect>
    <Stream url="${wsBase}/twilio/voice/agent-stream">
      <Parameter name="from" value="${fromNum}"/>
      <Parameter name="to" value="${toNum}"/>
    </Stream>
  </Connect>
</Response>`);
});

// ── GET /api/twilio/voice/voicemails ─────────────────────────────────────────
// Returns all inbound call logs that are: missed, recorded, or AI-handled.
// Used by the Voicemail Inbox page in the CRM.
router.get("/twilio/voice/voicemails", crmAuth, async (req, res) => {
  try {
    const crmUser = req.crmUser!;
    const isSuperAdmin = crmUser.role === "super_admin";

    // Build where clause: inbound calls only
    // Super-admins see all; campaign agents see only their campaign
    const rows = await db
      .select({
        id:               crmCallLogs.id,
        callSid:          crmCallLogs.callSid,
        fromNumber:       crmCallLogs.fromNumber,
        toNumber:         crmCallLogs.toNumber,
        duration:         crmCallLogs.duration,
        status:           crmCallLogs.status,
        disposition:      crmCallLogs.disposition,
        recordingUrl:     crmCallLogs.recordingUrl,
        recordingSid:     crmCallLogs.recordingSid,
        transcript:       crmCallLogs.transcript,
        aiCoachingSummary: crmCallLogs.aiCoachingSummary,
        leadId:           crmCallLogs.leadId,
        campaignId:       crmCallLogs.campaignId,
        createdAt:        crmCallLogs.createdAt,
        updatedAt:        crmCallLogs.updatedAt,
      })
      .from(crmCallLogs)
      .where(
        isSuperAdmin
          ? and(
              eq(crmCallLogs.direction, "inbound"),
              // Only show missed calls, voicemails, or AI-handled
              sql`(
                ${crmCallLogs.status} IN ('no-answer', 'missed', 'busy', 'failed')
                OR ${crmCallLogs.recordingUrl} IS NOT NULL
                OR ${crmCallLogs.disposition} IN ('ai_pending', 'ai_qualified', 'ai_unqualified', 'inbound_lead')
              )`
            )
          : and(
              eq(crmCallLogs.direction, "inbound"),
              crmUser.campaignId
                ? eq(crmCallLogs.campaignId, crmUser.campaignId)
                : sql`TRUE`,
              sql`(
                ${crmCallLogs.status} IN ('no-answer', 'missed', 'busy', 'failed')
                OR ${crmCallLogs.recordingUrl} IS NOT NULL
                OR ${crmCallLogs.disposition} IN ('ai_pending', 'ai_qualified', 'ai_unqualified', 'inbound_lead')
              )`
            )
      )
      .orderBy(desc(crmCallLogs.createdAt))
      .limit(200);

    res.json({ voicemails: rows, total: rows.length });
  } catch (err) {
    logger.error(err, "[twilio/voice/voicemails] error");
    res.status(500).json({ error: "Failed to load voicemails" });
  }
});

// ── GET /api/twilio/voice/voicemails/unread-count ────────────────────────────
// Returns the count of inbound missed/recorded/AI-handled calls that have NOT
// yet been linked to a lead (leadId IS NULL). Used by the nav badge.
router.get("/twilio/voice/voicemails/unread-count", crmAuth, async (req, res) => {
  try {
    const crmUser = req.crmUser!;
    const isSuperAdmin = crmUser.role === "super_admin";

    const [row] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(crmCallLogs)
      .where(
        isSuperAdmin
          ? and(
              eq(crmCallLogs.direction, "inbound"),
              sql`${crmCallLogs.leadId} IS NULL`,
              sql`(
                ${crmCallLogs.status} IN ('no-answer', 'missed', 'busy', 'failed')
                OR ${crmCallLogs.recordingUrl} IS NOT NULL
                OR ${crmCallLogs.disposition} IN ('ai_pending', 'ai_qualified', 'ai_unqualified', 'inbound_lead')
              )`
            )
          : and(
              eq(crmCallLogs.direction, "inbound"),
              sql`${crmCallLogs.leadId} IS NULL`,
              crmUser.campaignId
                ? eq(crmCallLogs.campaignId, crmUser.campaignId)
                : sql`TRUE`,
              sql`(
                ${crmCallLogs.status} IN ('no-answer', 'missed', 'busy', 'failed')
                OR ${crmCallLogs.recordingUrl} IS NOT NULL
                OR ${crmCallLogs.disposition} IN ('ai_pending', 'ai_qualified', 'ai_unqualified', 'inbound_lead')
              )`
            )
      );

    res.json({ count: row?.count ?? 0 });
  } catch (err) {
    logger.error(err, "[twilio/voice/voicemails/unread-count] error");
    res.status(500).json({ count: 0 });
  }
});

// ── GET /api/twilio/voice/recording-proxy ─────────────────────────────────────
// Proxy a Twilio recording URL to the browser so authentication is handled
// server-side (Twilio recordings require Basic auth to download).
// Query params: url (full Twilio .mp3 URL)
router.get("/twilio/voice/recording-proxy", crmAuth, async (req, res) => {
  const url = req.query.url as string;
  if (!url) { res.status(400).json({ error: "url required" }); return; }
  if (!url.startsWith("https://api.twilio.com/")) {
    res.status(400).json({ error: "Only Twilio recording URLs are supported" }); return;
  }
  try {
    const crmUser = req.crmUser!;
    const creds = crmUser.campaignId
      ? (await getSmsCreds(crmUser.campaignId) ?? getGlobalSmsCreds())
      : getGlobalSmsCreds();
    if (!creds?.accountSid || !creds?.authToken) {
      res.status(503).json({ error: "Twilio credentials not configured" }); return;
    }
    const authHeader = `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")}`;
    const upstream = await fetch(url, { headers: { Authorization: authHeader } });
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: "Failed to fetch recording from Twilio" }); return;
    }
    res.set("Content-Type", upstream.headers.get("Content-Type") || "audio/mpeg");
    res.set("Cache-Control", "public, max-age=3600");
    res.set("Accept-Ranges", "bytes");
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err: any) {
    logger.error(err, "[recording-proxy] error");
    res.status(500).json({ error: "Failed to proxy recording" });
  }
});

// ── POST /api/twilio/voice/transcript ─────────────────────────────────────────
// Twilio Voice Intelligence real-time transcription webhook.
// Emits `call_transcript` and (debounced) `call_suggestion` SSE events.
router.post("/twilio/voice/transcript", async (req, res) => {
  res.status(200).json({ received: true });
  try {
    const callSid   = req.body?.CallSid        as string | undefined;
    const event     = req.body?.TranscriptionEvent as string | undefined;
    const rawData   = req.body?.TranscriptionData  as string | undefined;
    const track     = (req.body?.Track as string | undefined) || "";

    if (!callSid || !event) return;

    if (event === "transcription-stopped") { cleanupTranscript(callSid); return; }
    if (event !== "transcription-content") return;

    let transcriptText = "";
    try { transcriptText = rawData ? (JSON.parse(rawData)?.transcript || "") : ""; } catch { transcriptText = rawData || ""; }
    if (!transcriptText.trim()) return;

    if (!liveTranscripts.has(callSid)) {
      liveTranscripts.set(callSid, { segments: [], aiSuggestionTimer: null, fullText: "" });
    }
    const entry = liveTranscripts.get(callSid)!;
    const isInbound = track.toLowerCase().includes("inbound");
    const segment: TranscriptSegment = { track: isInbound ? "inbound" : "outbound", text: transcriptText, ts: Date.now() };
    entry.segments.push(segment);
    entry.fullText += ` ${transcriptText}`;

    let campaignId: number | null = null;
    try {
      const [row] = await db.select({ campaignId: crmCallLogs.campaignId }).from(crmCallLogs)
        .where(eq(crmCallLogs.callSid, callSid)).limit(1);
      campaignId = row?.campaignId ?? null;
    } catch { /* non-fatal */ }

    emitCrmActivity("call_transcript", {
      campaignId, callSid,
      segment: { track: segment.track, text: segment.text, ts: segment.ts },
    });

    // Debounced AI rebuttal suggestion — fires 8 s after last inbound segment
    if (isInbound && getOpenAIKey()) {
      if (entry.aiSuggestionTimer) clearTimeout(entry.aiSuggestionTimer);
      entry.aiSuggestionTimer = setTimeout(async () => {
        try {
          const recentText = entry.fullText.slice(-3000);
          const resp = await fetch(`${getOpenAIBaseUrl()}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${getOpenAIKey()}` },
            signal: AbortSignal.timeout(10_000),
            body: JSON.stringify({
              model: "gpt-4o-mini",
              max_tokens: 200,
              messages: [
                {
                  role: "system",
                  content: `You are a real estate wholesaling coach listening live to a seller call.
Based on the last thing the seller said, give ONE short, specific rebuttal or talking point the agent can say RIGHT NOW.
Keep it under 40 words. Be direct. If no objection is detected, return an empty string.
Return ONLY the suggested response text — nothing else.`,
                },
                { role: "user", content: `Live transcript:\n${recentText}\n\nWhat should the agent say now?` },
              ],
            }),
          });
          if (resp.ok) {
            const aiData = await resp.json() as any;
            const suggestion = (aiData.choices?.[0]?.message?.content || "").trim();
            if (suggestion) {
              emitCrmActivity("call_suggestion", { campaignId, callSid, suggestion, ts: Date.now() });
            }
          }
        } catch (err) { logger.warn(err, "[transcript] AI suggestion error"); }
      }, 8_000);
    }
  } catch (err) {
    logger.error(err, "[twilio/voice/transcript] error");
  }
});

export default router;
