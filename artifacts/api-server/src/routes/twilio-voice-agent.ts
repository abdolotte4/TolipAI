// src/routes/twilio-voice-agent.ts
//
// AI Inbound Voice Agent — P2-09
//
// When a seller calls your Twilio number, an AI agent answers, qualifies them
// (name, property address, motivation, condition, asking price, timeline), then
// automatically creates a CRM lead, sends a confirmation SMS, and logs the
// full transcript to crm_call_logs.
//
// Architecture:
//   Inbound call → POST /twilio/voice/inbound-agent (TwiML)
//     → <Connect><Stream url="wss://.../api/twilio/voice/agent-stream"/>
//   WebSocket /api/twilio/voice/agent-stream
//     ↔ OpenAI gpt-4o-realtime-preview (Realtime API over WSS)
//
// Required env vars:
//   OPENAI_API_KEY   — must have Realtime API access
//   API_BASE_URL     — e.g. https://tolipai.com/api (used for WS URL)

import { Router, type IRouter } from "express";
import type { IncomingMessage } from "http";
import WebSocket from "ws";
import { db } from "@workspace/db";
import {
  crmCampaigns,
  crmCallLogs,
  crmLeads,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getSmsCreds, getGlobalSmsCreds } from "../services/twilioCredentials";
import { getOpenAIKey } from "../services/aiConfig";
import { scoreCallTranscript, formatScoreNotes } from "../services/callScoring";
import { logger } from "../lib/logger";
import twilio from "twilio";
import { getWebhookBase } from "../lib/webhookBase";
import { twilioWebhookMiddleware } from "../lib/twilioWebhookMiddleware";

export const agentRouter: IRouter = Router();

// ── Twilio Signature Validation Middleware ──
const twilioAuth = twilioWebhookMiddleware();

// ── In-memory session store (keyed by Twilio CallSid) ────────────────────────

interface AgentSession {
  callSid: string;
  streamSid: string;
  campaignId: number | null;
  fromNumber: string;
  toNumber: string;
  callLogId: number | null;
  startTime: Date;
  // Qualification data — populated as the AI collects them
  sellerName: string | null;
  address: string | null;
  motivation: string | null;
  condition: string | null;
  askingPrice: string | null;
  timeline: string | null;
  // Full transcript lines
  transcriptLines: string[];
  // Whether we already processed this session (guard against double-run)
  processed: boolean;
}

const agentSessions = new Map<string, AgentSession>();

// ── OpenAI Realtime config ────────────────────────────────────────────────────

const OPENAI_REALTIME_URL =
  "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";

const SYSTEM_PROMPT = `You are Alex, a friendly acquisitions specialist at TolipAI (also called TolipAI). You answer inbound calls from property sellers.

SPEECH STYLE:
Use natural filler words: "um", "uh", "you know", "actually", "let me see"
Pause occasionally. Don't rush.
Sound warm, not salesy. Like you're talking to a neighbor.
If they interrupt you, stop immediately and listen.
React to their emotions: "Oh wow, that sounds tough" or "That's great to hear"

GOAL: Gather this info naturally:
Property address (street, city, state, zip)
Seller's full name
Property condition (Excellent, Good, Fair, Poor)
Asking price or "what do you think it's worth?"
Timeline to sell
Why they're selling

Only ask ONE question at a time. Wait for their answer. If they ramble, gently redirect.

Once you have name, phone, and address, call save_qualification. Then say: "Perfect, I've got everything. Our specialist will call you back within 24 hours. Take care!"

If the caller is hostile or asks for a human, be empathetic and say a specialist will call them back shortly, then call save_qualification with whatever info you have.`;

const SAVE_QUALIFICATION_TOOL = {
  type: "function" as const,
  name: "save_qualification",
  description:
    "Call this once you have collected all qualification data from the seller. This saves the lead and ends the call.",
  parameters: {
    type: "object",
    properties: {
      seller_name: {
        type: "string",
        description: "Full name of the seller",
      },
      property_address: {
        type: "string",
        description: "Full property address including city, state, zip",
      },
      motivation: {
        type: "string",
        description: "Why the seller wants to sell",
      },
      condition: {
        type: "string",
        description: "Property condition rating 1-10 as a string",
      },
      asking_price: {
        type: "string",
        description: "Seller's asking price or price range",
      },
      timeline: {
        type: "string",
        description: "How soon the seller needs to sell",
      },
    },
    required: ["seller_name", "property_address"],
  },
};

// ── Campaign lookup helpers ───────────────────────────────────────────────────

async function findCampaignByPhone(
  toNumber: string
): Promise<{ id: number; name: string; twilioAccountSid: string | null; twilioAuthToken: string | null; twilioPhoneNumber: string | null } | null> {
  // Normalize number for comparison (digits only)
  const digits = toNumber.replace(/\D/g, "");
  const campaigns = await db
    .select({
      id: crmCampaigns.id,
      name: crmCampaigns.name,
      twilioAccountSid: crmCampaigns.twilioAccountSid,
      twilioAuthToken: crmCampaigns.twilioAuthToken,
      twilioPhoneNumber: crmCampaigns.twilioPhoneNumber,
      twilioEnabled: crmCampaigns.twilioEnabled,
    })
    .from(crmCampaigns)
    .where(eq(crmCampaigns.twilioEnabled, true));

  for (const c of campaigns) {
    if (c.twilioPhoneNumber) {
      const cDigits = c.twilioPhoneNumber.replace(/\D/g, "");
      if (cDigits === digits || cDigits.slice(-10) === digits.slice(-10)) {
        return c;
      }
    }
  }
  return null;
}

// ── Twilio SMS helper ─────────────────────────────────────────────────────────

async function sendConfirmationSms(
  toNumber: string,
  fromNumber: string,
  sellerName: string,
  address: string,
  campaignId: number | null
): Promise<void> {
  const creds = campaignId
    ? (await getSmsCreds(campaignId) ?? getGlobalSmsCreds())
    : getGlobalSmsCreds();

  if (!creds) {
    logger.warn("[agent] Cannot send confirmation SMS — no Twilio credentials");
    return;
  }

  const client = twilio(creds.accountSid, creds.authToken);
  const addrShort = address.length > 60 ? address.slice(0, 57) + "…" : address;
  const body = `Hi ${sellerName.split(" ")[0]}! Thanks for calling. We received your info about ${addrShort}. A specialist will follow up within 24 hours. - The Buying Team`;

  await client.messages.create({ body, from: fromNumber, to: toNumber });
  logger.info({ to: toNumber }, "[agent] Confirmation SMS sent");
}

// ── Post-call processing ──────────────────────────────────────────────────────

async function processCallEnd(session: AgentSession): Promise<void> {
  if (session.processed) return;
  session.processed = true;
  agentSessions.delete(session.callSid);

  const transcript = session.transcriptLines.join("\n") || null;
  const durationSec = Math.round((Date.now() - session.startTime.getTime()) / 1000);
  const qualified = !!(session.address && session.sellerName);

  logger.info(
    {
      callSid: session.callSid,
      qualified,
      sellerName: session.sellerName,
      address: session.address,
    },
    "[agent] Processing call end"
  );

  try {
    // Score the transcript async (fire-and-forget so it doesn't delay lead creation)
    let qualificationScore: number | null = null;
    let qualificationNotes: string | null = null;
    if (transcript) {
      try {
        const scored = await scoreCallTranscript(transcript);
        if (scored) {
          qualificationScore = scored.score;
          qualificationNotes = formatScoreNotes(scored);
        }
      } catch (err) {
        logger.warn({ err }, "[agent] call scoring failed — skipping");
      }
    }

    // Update the call log created by the TwiML endpoint
    if (session.callLogId) {
      await db
        .update(crmCallLogs)
        .set({
          status: "completed",
          duration: durationSec,
          transcript,
          disposition: qualified ? "ai_qualified" : "ai_unqualified",
          qualificationScore,
          qualificationNotes,
          updatedAt: new Date(),
        })
        .where(eq(crmCallLogs.id, session.callLogId));
    }

    if (!qualified) return;

    // Parse condition integer (1-10)
    let conditionInt: number | null = null;
    if (session.condition) {
      const n = parseInt(session.condition.replace(/\D/g, ""), 10);
      if (n >= 1 && n <= 10) conditionInt = n;
    }

    // Create the CRM lead
    const notes = [
      session.motivation ? `Motivation: ${session.motivation}` : null,
      session.timeline   ? `Timeline: ${session.timeline}` : null,
      transcript         ? `\nAI Transcript:\n${transcript}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const [lead] = await db
      .insert(crmLeads)
      .values({
        campaignId:      session.campaignId,
        sellerName:      session.sellerName!,
        phone:           session.fromNumber,
        address:         session.address!,
        condition:       conditionInt,
        askingPriceText: session.askingPrice,
        reasonForSelling: session.motivation,
        howSoon:         session.timeline,
        leadSource:      "AI Inbound Call",
        status:          "new",
        notes,
      })
      .returning({ id: crmLeads.id });

    logger.info({ leadId: lead.id }, "[agent] CRM lead created");

    // Link the call log to the new lead
    if (session.callLogId) {
      await db
        .update(crmCallLogs)
        .set({ leadId: lead.id, updatedAt: new Date() })
        .where(eq(crmCallLogs.id, session.callLogId));
    }

    // Send confirmation SMS (fire-and-forget)
    sendConfirmationSms(
      session.fromNumber,
      session.toNumber,
      session.sellerName!,
      session.address!,
      session.campaignId
    ).catch((err) => logger.error(err, "[agent] SMS send failed"));

  } catch (err) {
    logger.error(err, "[agent] processCallEnd error");
  }
}

// ── WebSocket handler (called from index.ts on upgrade) ──────────────────────

export function handleAgentStream(
  twilioWs: WebSocket,
  _req: IncomingMessage
): void {
  const openaiKey = getOpenAIKey();
  if (!openaiKey) {
    logger.warn("[agent] No OpenAI API key found (OPENAI_API_KEY or AI_INTEGRATIONS_OPENAI_API_KEY) — closing WebSocket gracefully");
    twilioWs.close(1000, "AI agent not configured");
    return;
  }

  let session: AgentSession | null = null;
  let streamSid = "";

  // Open the OpenAI Realtime WebSocket
  const openaiWs = new WebSocket(OPENAI_REALTIME_URL, {
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  // ── OpenAI events ──

  openaiWs.on("open", () => {
    clearTimeout(openTimeout);
    logger.info("[agent] OpenAI Realtime connected");
    // Configure the session
    openaiWs.send(
      JSON.stringify({
        type: "session.update",
        session: {
          turn_detection: {
            type: "server_vad",
            threshold: 0.3,
            prefix_padding_ms: 150,
            silence_duration_ms: 400,
          },
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
          voice: "nova",
          instructions: SYSTEM_PROMPT,
          modalities: ["text", "audio"],
          temperature: 0.8,
          tools: [SAVE_QUALIFICATION_TOOL],
          tool_choice: "auto",
        },
      })
    );
  });

  openaiWs.on("message", (raw: Buffer) => {
    let event: any;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // Stream audio back to Twilio
    if (event.type === "response.audio.delta" && event.delta && streamSid) {
      if (twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.send(
          JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: event.delta },
          })
        );
      }
    }

    // Clear Twilio audio buffer on utterance start (barge-in)
    if (event.type === "input_audio_buffer.speech_started" && streamSid) {
      if (twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
      }
    }

    // Track transcript lines
    if (event.type === "response.audio_transcript.done" && event.transcript && session) {
      session.transcriptLines.push(`AI: ${event.transcript}`);
    }
    if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript && session) {
      session.transcriptLines.push(`Seller: ${event.transcript}`);
    }

    // Handle the save_qualification tool call
    if (event.type === "response.function_call_arguments.done") {
      if (event.name === "save_qualification" && session) {
        try {
          const args = JSON.parse(event.arguments || "{}");
          session.sellerName  = args.seller_name     || session.sellerName;
          session.address     = args.property_address || session.address;
          session.motivation  = args.motivation      || session.motivation;
          session.condition   = args.condition       || session.condition;
          session.askingPrice = args.asking_price    || session.askingPrice;
          session.timeline    = args.timeline        || session.timeline;

          logger.info(
            { sellerName: session.sellerName, address: session.address },
            "[agent] Qualification data captured"
          );

          // Acknowledge the function call → lets OpenAI respond verbally
          openaiWs.send(
            JSON.stringify({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: event.call_id,
                output: JSON.stringify({
                  success: true,
                  message:
                    "Lead saved successfully. Thank the seller warmly, confirm someone will follow up within 24 hours, and say goodbye.",
                }),
              },
            })
          );
          openaiWs.send(JSON.stringify({ type: "response.create" }));
        } catch (err) {
          logger.error(err, "[agent] save_qualification parse error");
        }
      }
    }

    // Log OpenAI errors
    if (event.type === "error") {
      logger.error({ event }, "[agent] OpenAI Realtime error");
    }
  });

  openaiWs.on("error", (err: Error & { code?: string }) => {
    logger.error(
      { code: err.code, message: err.message },
      "[agent] OpenAI Realtime WebSocket error — NOTE: Groq has no Realtime API equivalent; OpenAI is the only provider for AI voice"
    );
    // Close the Twilio side gracefully so the caller hears a busy signal
    // rather than silence. The call will fall through to the <Say> fallback.
    if (twilioWs.readyState === WebSocket.OPEN) twilioWs.close(1011, "AI provider error");
  });

  openaiWs.on("close", (code: number, reason: Buffer) => {
    logger.info({ code, reason: reason.toString() }, "[agent] OpenAI Realtime disconnected");
  });

  // Safety valve: if OpenAI never opens within 8 s, close Twilio gracefully
  const openTimeout = setTimeout(() => {
    if (openaiWs.readyState !== WebSocket.OPEN) {
      logger.error("[agent] OpenAI Realtime connection timed out after 8 s");
      openaiWs.terminate();
      if (twilioWs.readyState === WebSocket.OPEN) twilioWs.close(1011, "AI provider timeout");
    }
  }, 8_000);

  // ── Twilio events ──

  twilioWs.on("message", (raw: Buffer) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.event) {
      case "connected":
        logger.info("[agent] Twilio Media Stream connected");
        break;

      case "start": {
        streamSid = msg.streamSid;
        const callSid: string = msg.start?.callSid || "";
        session = agentSessions.get(callSid) || null;

        if (!session) {
          // Fallback session if TwiML lookup missed
          session = {
            callSid,
            streamSid,
            campaignId: null,
            fromNumber: msg.start?.customParameters?.from || "",
            toNumber:   msg.start?.customParameters?.to   || "",
            callLogId:  null,
            startTime:  new Date(),
            sellerName: null,
            address:    null,
            motivation: null,
            condition:  null,
            askingPrice: null,
            timeline:   null,
            transcriptLines: [],
            processed:  false,
          };
          agentSessions.set(callSid, session);
        }

        session.streamSid = streamSid;
        logger.info({ callSid, campaignId: session.campaignId }, "[agent] Stream started");

        // Enable input transcription so we get seller's words in the transcript
        if (openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.send(
            JSON.stringify({
              type: "session.update",
              session: {
                input_audio_transcription: { model: "whisper-1" },
              },
            })
          );
        }
        break;
      }

      case "media":
        if (msg.media?.payload && openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.send(
            JSON.stringify({
              type: "input_audio_buffer.append",
              audio: msg.media.payload,
            })
          );
        }
        break;

      case "stop":
        logger.info({ streamSid }, "[agent] Twilio stream stopped");
        if (session) processCallEnd(session);
        openaiWs.close();
        break;
    }
  });

  twilioWs.on("close", () => {
    logger.info("[agent] Twilio WebSocket closed");
    if (session && !session.processed) processCallEnd(session);
    if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
  });

  twilioWs.on("error", (err) => {
    logger.error(err, "[agent] Twilio WebSocket error");
  });
}

// ── POST /api/twilio/voice/inbound-agent ──────────────────────────────────────
// Twilio hits this URL for inbound calls to numbers configured with this webhook.
// Returns TwiML that connects the call to the AI agent via Media Streams.
// Configure this URL in your Twilio console or set it as the Voice URL for
// your Twilio phone number (or use Auto-Configure Webhooks in TwilioConnect).

agentRouter.post("/twilio/voice/inbound-agent", twilioAuth, async (req, res) => {
  res.set("Content-Type", "text/xml");

  const callSid:   string = req.body?.CallSid  || "";
  const fromNum:   string = req.body?.From     || "";
  const toNum:     string = req.body?.To       || "";

  if (!callSid || !fromNum) {
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, something went wrong. Please try again.</Say>
  <Hangup/>
</Response>`);
    return;
  }

  if (!getOpenAIKey()) {
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>The AI assistant is not configured. Please call back during business hours.</Say>
  <Hangup/>
</Response>`);
    return;
  }

  // Determine WebSocket URL from the request host (works correctly in all environments).
  const apiBase: string = getWebhookBase(req);
  const wsBase = apiBase.replace(/^https?/, (m) => (m === "https" ? "wss" : "ws"));
  const streamUrl = `${wsBase}/twilio/voice/agent-stream`;

  // Find campaign by Twilio phone number
  let campaignId: number | null = null;
  let callLogId:  number | null = null;

  try {
    const campaign = await findCampaignByPhone(toNum);
    campaignId = campaign?.id ?? null;

    // Create initial call log
    const [log] = await db
      .insert(crmCallLogs)
      .values({
        callSid,
        campaignId,
        direction:  "inbound",
        status:     "in-progress",
        fromNumber: fromNum,
        toNumber:   toNum,
        disposition: "ai_pending",
      })
      .onConflictDoNothing()
      .returning({ id: crmCallLogs.id });

    callLogId = log?.id ?? null;
  } catch (err) {
    logger.error(err, "[agent] inbound-agent setup error");
  }

  // Store session for the WebSocket handler
  const session: AgentSession = {
    callSid,
    streamSid:    "",
    campaignId,
    fromNumber:   fromNum,
    toNumber:     toNum,
    callLogId,
    startTime:    new Date(),
    sellerName:   null,
    address:      null,
    motivation:   null,
    condition:    null,
    askingPrice:  null,
    timeline:     null,
    transcriptLines: [],
    processed:    false,
  };
  agentSessions.set(callSid, session);

  // Clean up stale sessions (older than 2 hours)
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  for (const [sid, s] of agentSessions) {
    if (s.startTime.getTime() < twoHoursAgo) agentSessions.delete(sid);
  }

  logger.info({ callSid, fromNum, toNum, campaignId, streamUrl }, "[agent] Inbound call — starting AI agent");

  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="from" value="${fromNum}"/>
      <Parameter name="to" value="${toNum}"/>
    </Stream>
  </Connect>
</Response>`);
});

// ── GET /api/twilio/voice/agent-sessions ─────────────────────────────────────
// Internal monitoring endpoint — returns active agent sessions (super admin).
// Useful for debugging without Railway logs open.

import { crmAuth } from "./crm/middleware";

agentRouter.get("/twilio/voice/agent-sessions", crmAuth, (req, res) => {
  const user = (req as any).crmUser;
  if (user?.role !== "super_admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const sessions = [...agentSessions.values()].map((s) => ({
    callSid:     s.callSid,
    campaignId:  s.campaignId,
    fromNumber:  s.fromNumber,
    toNumber:    s.toNumber,
    startTime:   s.startTime,
    sellerName:  s.sellerName,
    address:     s.address,
    askingPrice: s.askingPrice,
    condition:   s.condition,
    timeline:    s.timeline,
    transcriptLines: s.transcriptLines.length,
    processed:   s.processed,
  }));
  res.json({ activeSessions: sessions.length, sessions });
});
