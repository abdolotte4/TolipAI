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
  getSmsCreds,
  getGlobalSmsCreds,
} from "../services/twilioCredentials";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const { AccessToken } = twilioJwt;
const { VoiceGrant } = AccessToken;

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

    if (record) {
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>${whisperXml}
  <Dial callerId="${callerId}" record="record-from-answer"
        recordingStatusCallback="${apiBase}/twilio/voice/recording"
        recordingStatusCallbackMethod="POST"
        action="${statusCallbackUrl}" method="POST">
    <Number>${to}</Number>
  </Dial>
</Response>`);
    } else {
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>${whisperXml}
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
  res.type("text/xml").send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>");
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

// ── POST /api/twilio/voice/hold ───────────────────────────────────────────────
// Plays hold music to the remote party (hold=true) or stops it (hold=false).
// The browser SDK's local mute is handled client-side; this endpoint updates what
// the REMOTE party hears via the Twilio REST API — best-effort, non-blocking.
// Body: { callSid: string, hold: boolean }
router.post("/twilio/voice/hold", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  const { callSid, hold } = req.body as { callSid?: string; hold?: boolean };

  if (!callSid) {
    res.status(400).json({ error: "callSid is required" });
    return;
  }

  try {
    const isSuperAdmin = crmUser.role === "super_admin";
    const cfg = await resolveVoiceConfig(crmUser.campaignId, isSuperAdmin);

    // Hold → play royalty-free hold music loop.
    // Unhold → <Hangup> ends the hold-music leg; the browser SDK leg stays
    //           connected so the agent can speak again immediately.
    const twiml = hold
      ? `<?xml version="1.0" encoding="UTF-8"?><Response><Play loop="10">https://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP.mp3</Play></Response>`
      : `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;

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

    res.json({ success: true, held: hold });
  } catch (err: any) {
    logger.error(err, "[twilio/voice/hold] error");
    res.status(err.status || 500).json({ error: err.message });
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
    if (toNum || accountSidFromTwilio) {
      const toDigits = toNum.replace(/\D/g, "");
      const camps = await db
        .select({ id: crmCampaigns.id, twilioAccountSid: crmCampaigns.twilioAccountSid, twilioPhoneNumber: crmCampaigns.twilioPhoneNumber })
        .from(crmCampaigns)
        .where(eq(crmCampaigns.twilioEnabled, true));

      for (const c of camps) {
        const sidMatch = accountSidFromTwilio && c.twilioAccountSid === accountSidFromTwilio;
        const numMatch = c.twilioPhoneNumber &&
          c.twilioPhoneNumber.replace(/\D/g, "").slice(-10) === toDigits.slice(-10);
        if (sidMatch || numMatch) { campaignId = c.id; break; }
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

    logger.info(
      { fromNum, toNum, leadId: lead.id, agents: agents.length },
      "[twilio/voice/inbound] known lead → ringing agents"
    );

    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Incoming call from ${sellerName}.</Say>
  <Dial timeout="20" action="${apiBase}/twilio/voice/inbound-no-answer" method="POST">
${clientTags}
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

  logger.info({ fromNum, toNum }, "[twilio/voice/inbound-no-answer] no agent answered → AI agent");

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

export default router;
