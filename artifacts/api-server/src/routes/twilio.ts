/**
 * Twilio Integration — per-campaign credentials.
 *
 * Each campaign admin stores their own Twilio Account SID, Auth Token, and
 * phone number in their campaign settings. All Twilio API calls are made
 * using THAT campaign's credentials, not a global env var.
 *
 * Endpoints:
 *   GET  /twilio/config                    — get masked config for current campaign
 *   POST /twilio/config                    — save/update Twilio credentials (admin only)
 *   GET  /twilio/phone-numbers             — list numbers in campaign's Twilio account
 *   GET  /twilio/messages                  — fetch SMS thread for a contact
 *   POST /twilio/messages                  — send SMS
 *   GET  /twilio/lead-messages/:leadId     — locally-stored messages for a lead
 *   GET  /twilio/calls                     — fetch call log for a contact
 *   POST /twilio/click-to-call             — initiate outbound call (agent first, then lead)
 *   GET  /twilio/twiml/call                — public TwiML callback (no auth)
 *   POST /twilio/webhook                   — inbound SMS/call webhook (public)
 *   POST /twilio/setup-webhooks            — auto-configure webhooks on all numbers
 *   GET  /twilio/setup-guide               — returns step-by-step Twilio setup instructions
 */

import { Router, type IRouter } from "express";
import { crmAuth, crmAdminOnly } from "./crm/middleware";
import { db } from "@workspace/db";
import { crmCampaigns, crmOpenPhoneMessages, crmLeads, crmUsers, crmNotifications, crmSmsOptOuts, crmSmsConversations } from "@workspace/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { toE164 } from "../services/coreCalculations";
import { encryptPassword, decryptPassword } from "./crm/crypto-util";
import { logger } from "../lib/logger";
import { generateAiSmsReply, isOptOutMessage, isHumanHandoffRequest, AI_SMS_COST_USD } from "../services/aiSmsService";
import { sendSms } from "../services/smsService";

const router: IRouter = Router();

// In-memory cooldown map: leadId → last AI reply timestamp (ms)
// Acceptable for single-process deployment per spec
const aiSmsReplyThrottle = new Map<number, number>();
const THROTTLE_MS = 5 * 60 * 1000; // 5 minutes per lead

// ── Helpers ──────────────────────────────────────────────────────────────────

interface TwilioCreds {
  accountSid: string;
  authToken: string;
  phoneNumber: string | null;
}

async function getCampaignTwilioCreds(campaignId: number): Promise<TwilioCreds> {
  const [campaign] = await db.select().from(crmCampaigns).where(eq(crmCampaigns.id, campaignId)).limit(1);
  const sid = campaign?.twilioAccountSid ?? null;
  const encToken = campaign?.twilioAuthToken ?? null;
  const phoneNumber = campaign?.twilioPhoneNumber ?? null;

  if (!sid || !encToken) {
    throw Object.assign(
      new Error("Twilio is not configured for this campaign. Go to Campaign Settings → Twilio to add your credentials."),
      { status: 422 }
    );
  }

  let authToken: string;
  try {
    authToken = encToken.includes(":") ? decryptPassword(encToken) : encToken;
  } catch {
    authToken = encToken;
  }

  return { accountSid: sid, authToken, phoneNumber };
}

function twilioBaseUrl(accountSid: string) {
  return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}`;
}

async function twilioFetch(
  creds: TwilioCreds,
  path: string,
  options: RequestInit = {}
): Promise<any> {
  const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
  const url = path.startsWith("http") ? path : `${twilioBaseUrl(creds.accountSid)}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw Object.assign(
      new Error(json?.message || json?.error_message || "Twilio API error"),
      { status: res.status, body: json }
    );
  }
  return json;
}

// ── GET /api/twilio/config ────────────────────────────────────────────────────

router.get("/twilio/config", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  if (!crmUser.campaignId) { res.status(400).json({ error: "No campaign assigned" }); return; }
  try {
    const [campaign] = await db.select().from(crmCampaigns)
      .where(eq(crmCampaigns.id, crmUser.campaignId)).limit(1);
    const sid = campaign?.twilioAccountSid ?? null;
    const token = campaign?.twilioAuthToken ?? null;
    const phone = campaign?.twilioPhoneNumber ?? null;
    const enabled = campaign?.twilioEnabled ?? false;
    res.json({
      configured: !!(sid && token),
      twilioEnabled: enabled,
      accountSid: sid || null,
      authTokenMasked: token ? "••••••••••••••••••••••••" + token.slice(-4) : null,
      phoneNumber: phone || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/twilio/config ───────────────────────────────────────────────────

router.post("/twilio/config", crmAuth, crmAdminOnly, async (req, res) => {
  const crmUser = req.crmUser!;
  if (!crmUser.campaignId) { res.status(400).json({ error: "No campaign assigned" }); return; }

  const { accountSid, authToken, phoneNumber, twilioEnabled } = req.body;
  if (!accountSid || !authToken) {
    res.status(400).json({ error: "accountSid and authToken are required" }); return;
  }

  try {
    const encToken = encryptPassword(authToken);
    await db.update(crmCampaigns)
      .set({
        twilioAccountSid: accountSid,
        twilioAuthToken: encToken,
        twilioPhoneNumber: phoneNumber || null,
        twilioEnabled: twilioEnabled !== false,
      })
      .where(eq(crmCampaigns.id, crmUser.campaignId));

    res.json({ success: true, configured: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/twilio/phone-numbers ─────────────────────────────────────────────

router.get("/twilio/phone-numbers", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  if (!crmUser.campaignId) { 
    res.json({ phoneNumbers: [] });  // ✅ Return empty, don't crash
    return; 
  }
  try {
    const creds = await getCampaignTwilioCreds(crmUser.campaignId);
    const data = await twilioFetch(creds, "/IncomingPhoneNumbers.json");
    const numbers = (data.incoming_phone_numbers || []).map((n: any) => ({
      id: n.phone_number,
      sid: n.sid,
      number: n.phone_number,
      name: n.friendly_name || n.phone_number,
    }));
    res.json({ phoneNumbers: numbers });
  } catch (err: any) {
    // ✅ Return empty array on ANY error — don't crash the frontend
    console.error("[twilio/phone-numbers] error:", err.message);
    res.json({ phoneNumbers: [] });
  }
});

// ── GET /api/twilio/messages ──────────────────────────────────────────────────

router.get("/twilio/messages", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  const { phoneNumberId, contactPhone } = req.query as Record<string, string>;
  if (!phoneNumberId || !contactPhone) {
    res.status(400).json({ error: "phoneNumberId and contactPhone are required" }); return;
  }
  if (!crmUser.campaignId) { res.status(400).json({ error: "No campaign assigned" }); return; }
  try {
    const creds = await getCampaignTwilioCreds(crmUser.campaignId);
    const e164 = toE164(contactPhone);
    if (!e164) { res.status(400).json({ error: "Invalid phone number" }); return; }
    const params = new URLSearchParams({ PageSize: "50" });
    const [sent, recv] = await Promise.all([
      twilioFetch(creds, `/Messages.json?From=${encodeURIComponent(phoneNumberId)}&To=${encodeURIComponent(e164)}&${params}`).catch(() => ({ messages: [] })),
      twilioFetch(creds, `/Messages.json?From=${encodeURIComponent(e164)}&To=${encodeURIComponent(phoneNumberId)}&${params}`).catch(() => ({ messages: [] })),
    ]);
    const all = [
      ...(sent.messages || []).map((m: any) => ({ ...m, direction: "outgoing" })),
      ...(recv.messages || []).map((m: any) => ({ ...m, direction: "incoming" })),
    ].sort((a, b) => new Date(a.date_created).getTime() - new Date(b.date_created).getTime());
    res.json({ messages: all });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /api/twilio/lead-messages/:leadId ─────────────────────────────────────

router.get("/twilio/lead-messages/:leadId", crmAuth, async (req, res) => {
  const leadId = parseInt(req.params.leadId as string);
  if (isNaN(leadId)) { res.status(400).json({ error: "Invalid leadId" }); return; }
  try {
    const messages = await db
      .select()
      .from(crmOpenPhoneMessages)
      .where(eq(crmOpenPhoneMessages.leadId, leadId))
      .orderBy(desc(crmOpenPhoneMessages.createdAt))
      .limit(100);
    res.json({ messages });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/twilio/messages ─────────────────────────────────────────────────

router.post("/twilio/messages", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  const { phoneNumberId, to, content, leadId, campaignId } = req.body;
  if (!phoneNumberId || !to || !content) {
    res.status(400).json({ error: "phoneNumberId, to, and content are required" }); return;
  }
  const campId = campaignId ? Number(campaignId) : crmUser.campaignId;
  if (!campId) { res.status(400).json({ error: "No campaign assigned" }); return; }
  try {
    const creds = await getCampaignTwilioCreds(campId);
    const toE164Result = toE164(to);
    if (!toE164Result) { res.status(400).json({ error: "Invalid destination phone number" }); return; }
    const body = new URLSearchParams({
      From: phoneNumberId,
      To: toE164Result,
      Body: content,
    });
    const data = await twilioFetch(creds, "/Messages.json", { method: "POST", body: body.toString() });

    if (data.sid) {
      await db.insert(crmOpenPhoneMessages).values({
        leadId: leadId ? Number(leadId) : null,
        campaignId: campId,
        openPhoneMessageId: data.sid,
        direction: "outgoing",
        fromNumber: phoneNumberId,
        toNumber: toE164Result,
        content,
        status: data.status || "sent",
      }).onConflictDoNothing();
    }
    res.json({ message: data });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /api/twilio/calls ─────────────────────────────────────────────────────

router.get("/twilio/calls", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  const { phoneNumberId, contactPhone } = req.query as Record<string, string>;
  if (!phoneNumberId || !contactPhone) {
    res.status(400).json({ error: "phoneNumberId and contactPhone are required" }); return;
  }
  if (!crmUser.campaignId) { res.status(400).json({ error: "No campaign assigned" }); return; }
  try {
    const creds = await getCampaignTwilioCreds(crmUser.campaignId);
    const e164 = toE164(contactPhone);
    if (!e164) { res.status(400).json({ error: "Invalid phone number" }); return; }
    const [outCalls, inCalls] = await Promise.all([
      twilioFetch(creds, `/Calls.json?From=${encodeURIComponent(phoneNumberId)}&To=${encodeURIComponent(e164)}&PageSize=20`).catch(() => ({ calls: [] })),
      twilioFetch(creds, `/Calls.json?From=${encodeURIComponent(e164)}&To=${encodeURIComponent(phoneNumberId)}&PageSize=20`).catch(() => ({ calls: [] })),
    ]);
    const all = [
      ...(outCalls.calls || []).map((c: any) => ({ ...c, direction: "outgoing" })),
      ...(inCalls.calls || []).map((c: any) => ({ ...c, direction: "incoming" })),
    ].sort((a, b) => new Date(b.date_created).getTime() - new Date(a.date_created).getTime());
    res.json({ calls: all });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /api/twilio/twiml/call ────────────────────────────────────────────────
// Public TwiML callback: Twilio calls this when the agent picks up.

router.get("/twilio/twiml/call", (req, res) => {
  const to = (req.query.to as string) || "";
  const callerId = (req.query.callerId as string) || "";
  if (!to) {
    res.set("Content-Type", "text/xml").send(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>No destination number provided.</Say></Response>'
    );
    return;
  }
  res.set("Content-Type", "text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connecting you to your lead now.</Say>
  <Dial callerId="${callerId}" timeout="30">${to}</Dial>
</Response>`);
});

// ── POST /api/twilio/click-to-call ────────────────────────────────────────────

router.post("/twilio/click-to-call", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  const { fromNumber, agentPhone, leadPhone } = req.body;
  if (!fromNumber || !agentPhone || !leadPhone) {
    res.status(400).json({ error: "fromNumber, agentPhone, and leadPhone are required" }); return;
  }
  if (!crmUser.campaignId) { res.status(400).json({ error: "No campaign assigned" }); return; }

  const leadE164 = toE164(leadPhone);
  const agentE164 = toE164(agentPhone);
  if (!leadE164) { res.status(400).json({ error: "Invalid lead phone number" }); return; }
  if (!agentE164) { res.status(400).json({ error: "Invalid agent phone number" }); return; }
  const apiBase = process.env.API_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN || "localhost:8080"}/api`;
  const twimlUrl = `${apiBase}/twilio/twiml/call?to=${encodeURIComponent(leadE164)}&callerId=${encodeURIComponent(fromNumber)}`;

  try {
    const creds = await getCampaignTwilioCreds(crmUser.campaignId);
    const body = new URLSearchParams({
      From: fromNumber,
      To: agentE164,
      Url: twimlUrl,
      Method: "GET",
    });
    const data = await twilioFetch(creds, "/Calls.json", { method: "POST", body: body.toString() });
    res.json({ success: true, callSid: data.sid, status: data.status, leadPhone: leadE164, agentPhone: agentE164 });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /api/twilio/setup-webhooks ──────────────────────────────────────────

router.post("/twilio/setup-webhooks", crmAuth, crmAdminOnly, async (req, res) => {
  const crmUser = req.crmUser!;
  if (!crmUser.campaignId) { res.status(400).json({ error: "No campaign assigned" }); return; }
  try {
    const creds = await getCampaignTwilioCreds(crmUser.campaignId);
    const apiBase = process.env.API_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN || "localhost:8080"}/api`;
    const smsWebhook = `${apiBase}/twilio/webhook`;
    const data = await twilioFetch(creds, "/IncomingPhoneNumbers.json");
    const numbers: any[] = data.incoming_phone_numbers || [];

    const results = await Promise.all(
      numbers.map(async (n: any) => {
        try {
          const body = new URLSearchParams({ SmsUrl: smsWebhook, SmsMethod: "POST" });
          await twilioFetch(creds, `/IncomingPhoneNumbers/${n.sid}.json`, {
            method: "POST",
            body: body.toString(),
            headers: { "X-HTTP-Method-Override": "PUT" },
          });
          return { number: n.phone_number, sid: n.sid, status: "configured", webhook: smsWebhook };
        } catch (err: any) {
          return { number: n.phone_number, sid: n.sid, status: "error", error: err.message };
        }
      })
    );
    res.json({ configured: results.length, results });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /api/twilio/webhook ──────────────────────────────────────────────────
// Inbound SMS webhook — public (no auth). Validates Twilio signature when
// the receiving campaign has Twilio credentials configured.

async function validateTwilioSignature(req: any): Promise<boolean> {
  const twilioSig = req.headers["x-twilio-signature"] as string | undefined;
  if (!twilioSig) return false;

  // Determine which campaign owns this number
  const toNumber = req.body?.To as string | undefined;
  if (!toNumber) return false;

  const campaigns = await db
    .select({ twilioAuthToken: crmCampaigns.twilioAuthToken, twilioPhoneNumber: crmCampaigns.twilioPhoneNumber })
    .from(crmCampaigns)
    .where(eq(crmCampaigns.twilioEnabled, true));

  const { decryptPassword } = await import("./crm/crypto-util");

  let authToken: string | null = null;
  for (const c of campaigns) {
    if (!c.twilioPhoneNumber) continue;
    const normalize = (p: string) => p.replace(/\D/g, "");
    if (normalize(c.twilioPhoneNumber) === normalize(toNumber)) {
      try {
        authToken = c.twilioAuthToken
          ? (c.twilioAuthToken.includes(":") ? decryptPassword(c.twilioAuthToken) : c.twilioAuthToken)
          : null;
      } catch {
        authToken = c.twilioAuthToken;
      }
      break;
    }
  }

  if (!authToken) return false;

  // Reconstruct the full URL Twilio signed
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "localhost";
  const url = `${proto}://${host}${req.originalUrl}`;

  // Build the validation string: URL + sorted POST params
  const params = req.body as Record<string, string>;
  const sortedKeys = Object.keys(params).sort();
  const signingStr = url + sortedKeys.map(k => `${k}${params[k]}`).join("");

  const { createHmac } = await import("crypto");
  const expected = createHmac("sha1", authToken).update(signingStr).digest("base64");

  // Constant-time comparison
  if (expected.length !== twilioSig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ twilioSig.charCodeAt(i);
  }
  return diff === 0;
}

router.post("/twilio/webhook", async (req, res) => {
  // Always respond immediately so Twilio doesn't retry
  res.set("Content-Type", "text/xml").send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

  // Validate signature — reject silently (response already sent, just log)
  try {
    const valid = await validateTwilioSignature(req);
    if (!valid) {
      logger.warn({ url: req.originalUrl }, "[twilio webhook] invalid or missing X-Twilio-Signature — ignoring");
      return;
    }
  } catch (err) {
    logger.error(err, "[twilio webhook] signature validation error — ignoring request");
    return;
  }

  try {
    const fromNumber = req.body?.From;
    const toNumber = req.body?.To;
    const content = req.body?.Body || "";
    const sid = req.body?.MessageSid || req.body?.SmsSid;
    if (!fromNumber) return;

    const normalize = (p: string) => p.replace(/\D/g, "");
    const normFrom = normalize(fromNumber);
    const allLeads = await db
      .select({ id: crmLeads.id, phone: crmLeads.phone, campaignId: crmLeads.campaignId })
      .from(crmLeads).limit(2000);
    const lead = allLeads.find(l => l.phone && normalize(l.phone) === normFrom);

    await db.insert(crmOpenPhoneMessages).values({
      leadId: lead?.id ?? null,
      campaignId: lead?.campaignId ?? null,
      openPhoneMessageId: sid || null,
      direction: "incoming",
      fromNumber,
      toNumber,
      content,
      status: "received",
    }).onConflictDoNothing();

    if (lead?.campaignId) {
      const users = await db.select({ id: crmUsers.id }).from(crmUsers)
        .where(eq(crmUsers.campaignId, lead.campaignId));
      if (users.length > 0) {
        await db.insert(crmNotifications).values(
          users.map(u => ({
            userId: u.id,
            leadId: lead.id,
            type: "sms",
            content: `📱 Inbound text from ${fromNumber}: "${content.slice(0, 100)}${content.length > 100 ? "…" : ""}"`,
            read: false,
          }))
        );
      }

      // ── AI SMS Auto-Reply ────────────────────────────────────────────────────
      // Fire-and-forget — do not let this block the webhook response
      setImmediate(async () => {
        try {
          const [campaign] = await db
            .select({
              aiSmsEnabled: crmCampaigns.aiSmsEnabled,
              aiSmsPersonality: crmCampaigns.aiSmsPersonality,
              aiSmsMaxRepliesPerDay: crmCampaigns.aiSmsMaxRepliesPerDay,
              twilioEnabled: crmCampaigns.twilioEnabled,
            })
            .from(crmCampaigns)
            .where(eq(crmCampaigns.id, lead.campaignId!))
            .limit(1);

          if (!campaign?.aiSmsEnabled || !campaign.twilioEnabled) return;

          // Opt-out keyword → record and stop
          if (isOptOutMessage(content)) {
            await db.insert(crmSmsOptOuts).values({
              phone: fromNumber,
              campaignId: lead.campaignId,
            }).onConflictDoNothing();
            logger.info({ leadId: lead.id, from: fromNumber }, "[aiSms] opt-out recorded");
            return;
          }

          // Check if already opted out
          const [optOut] = await db
            .select({ id: crmSmsOptOuts.id })
            .from(crmSmsOptOuts)
            .where(eq(crmSmsOptOuts.phone, fromNumber))
            .limit(1);
          if (optOut) return;

          // Throttle: 5-min cooldown per lead
          const lastReply = aiSmsReplyThrottle.get(lead.id) ?? 0;
          if (Date.now() - lastReply < THROTTLE_MS) {
            logger.info({ leadId: lead.id }, "[aiSms] throttled — skipping");
            return;
          }

          // Daily reply limit
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const [{ todayCount }] = await db
            .select({ todayCount: sql<number>`count(*)::int` })
            .from(crmSmsConversations)
            .where(
              and(
                eq(crmSmsConversations.leadId, lead.id),
                eq(crmSmsConversations.aiGenerated, true),
                sql`${crmSmsConversations.createdAt} >= ${todayStart.toISOString()}`
              )
            );
          const maxPerDay = campaign.aiSmsMaxRepliesPerDay ?? 5;
          if (todayCount >= maxPerDay) {
            logger.info({ leadId: lead.id, todayCount, maxPerDay }, "[aiSms] daily limit reached");
            return;
          }

          // Fetch full lead for context + conversation history
          const [fullLead] = await db
            .select({
              sellerName: crmLeads.sellerName,
              address: crmLeads.address,
              city: crmLeads.city,
              state: crmLeads.state,
              askingPrice: crmLeads.askingPrice,
              arv: crmLeads.arv,
            })
            .from(crmLeads)
            .where(eq(crmLeads.id, lead.id))
            .limit(1);

          const history = await db
            .select({ direction: crmSmsConversations.direction, body: crmSmsConversations.body })
            .from(crmSmsConversations)
            .where(eq(crmSmsConversations.leadId, lead.id))
            .orderBy(desc(crmSmsConversations.createdAt))
            .limit(10);

          // Log inbound to crmSmsConversations
          await db.insert(crmSmsConversations).values({
            leadId: lead.id,
            campaignId: lead.campaignId,
            direction: "inbound",
            body: content,
            aiGenerated: false,
            twilioSid: sid || null,
          }).onConflictDoNothing();

          const humanHandoff = isHumanHandoffRequest(content);

          const aiReply = await generateAiSmsReply({
            lead: fullLead ?? {},
            inboundMessage: content,
            conversationHistory: history.reverse(),
            personality: campaign.aiSmsPersonality || "professional_investor",
            promptOverride: humanHandoff ? "The lead is asking to speak with a human — acknowledge and say a team member will follow up shortly." : null,
          });

          // Send via smsService (uses campaign Twilio credentials)
          const smsResult = await sendSms({ to: fromNumber, body: aiReply, campaignId: lead.campaignId! });

          if (smsResult.status === "sent") {
            aiSmsReplyThrottle.set(lead.id, Date.now());
            await db.insert(crmSmsConversations).values({
              leadId: lead.id,
              campaignId: lead.campaignId,
              direction: "outbound",
              body: aiReply,
              aiGenerated: true,
              twilioSid: smsResult.sid ?? null,
              aiModel: process.env.AI_SMS_MODEL || process.env.AI_MODEL || "openai/gpt-4o-mini",
              aiCostUsd: AI_SMS_COST_USD.toString(),
            });
            logger.info({ leadId: lead.id, from: fromNumber, len: aiReply.length }, "[aiSms] reply sent");
          } else {
            logger.warn({ leadId: lead.id, status: smsResult.status, err: smsResult.errorMessage }, "[aiSms] send failed");
          }
        } catch (err) {
          logger.error(err, "[aiSms] auto-reply error");
        }
      });
    }
  } catch (err) {
    logger.error(err, "[twilio webhook] handler error");
  }
});

// ── GET /api/twilio/sms-conversations/:leadId — AI SMS thread ─────────────────
router.get("/twilio/sms-conversations/:leadId", crmAuth, async (req, res) => {
  const leadId = parseInt(req.params.leadId as string);
  if (isNaN(leadId)) { res.status(400).json({ error: "Invalid leadId" }); return; }
  try {
    const msgs = await db
      .select()
      .from(crmSmsConversations)
      .where(eq(crmSmsConversations.leadId, leadId))
      .orderBy(crmSmsConversations.createdAt);
    res.json(msgs);
  } catch (err) {
    logger.error(err, "GET /twilio/sms-conversations error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/twilio/setup-guide ───────────────────────────────────────────────

router.get("/twilio/setup-guide", crmAuth, (_req, res) => {
  res.json({
    title: "Twilio Setup Guide — TolipAI CRM",
    steps: [
      {
        step: 1,
        title: "Create a Twilio Account",
        description: "Sign up for free at twilio.com. You'll get a trial number and $15 in credit.",
        url: "https://www.twilio.com/try-twilio",
      },
      {
        step: 2,
        title: "Get Your Credentials",
        description: "From the Twilio Console dashboard, copy your Account SID and Auth Token.",
        url: "https://console.twilio.com/",
        fields: ["Account SID (starts with AC...)", "Auth Token (keep secret!)"],
      },
      {
        step: 3,
        title: "Buy a Phone Number",
        description: "In Twilio Console → Phone Numbers → Buy a Number. Choose a local or toll-free number with SMS + Voice capabilities.",
        url: "https://console.twilio.com/us1/develop/phone-numbers/manage/incoming",
      },
      {
        step: 4,
        title: "Enter Credentials in CRM",
        description: "In Campaign Settings → Twilio Integration, paste your Account SID, Auth Token, and phone number. Click Save.",
      },
      {
        step: 5,
        title: "Configure Webhooks",
        description: "Click 'Auto-Configure Webhooks' in Campaign Settings. This tells Twilio to forward inbound SMS to your CRM automatically.",
      },
      {
        step: 6,
        title: "Test It",
        description: "Open any lead in the CRM and use the Dialer tab to send a test SMS or make a click-to-call. You're live!",
      },
    ],
    tips: [
      "Each campaign can use its own separate Twilio account — perfect for multi-team setups.",
      "For volume SMS, upgrade from a trial account and register a 10DLC brand to avoid carrier filtering.",
      "For HIPAA compliance, enable Twilio's Advanced Security add-on in the console.",
      "Keep your Auth Token secret — it's encrypted when stored in TolipAI CRM.",
    ],
  });
});

export default router;
