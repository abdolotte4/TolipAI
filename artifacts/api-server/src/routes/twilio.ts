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
import twilio from "twilio";
import { crmAuth, crmAdminOnly } from "./crm/middleware";
import { db } from "@workspace/db";
import { crmCampaigns, crmOpenPhoneMessages, crmLeads, crmUsers, crmNotifications, crmSmsOptOuts, crmSmsConversations } from "@workspace/db/schema";
import { eq, desc, and, sql, isNotNull } from "drizzle-orm";
import { toE164, digitsOnly } from "../services/coreCalculations";
import { encryptPassword, decryptPassword } from "./crm/crypto-util";
import {
  type TwilioSmsCreds,
  getSmsCreds,
  resolveSmsCreds,
  getGlobalSmsCreds,
  resolveVoiceConfig,
} from "../services/twilioCredentials";
import { logger } from "../lib/logger";
import { generateAiSmsReply, isOptOutMessage, isHumanHandoffRequest, AI_SMS_COST_USD } from "../services/aiSmsService";
import { sendSms } from "../services/smsService";
import { validateBody } from "../lib/validate";
import { z } from "zod";

const router: IRouter = Router();


// In-memory cooldown map: leadId → last AI reply timestamp (ms)
// Acceptable for single-process deployment per spec
const aiSmsReplyThrottle = new Map<number, number>();
const THROTTLE_MS = 5 * 60 * 1000; // 5 minutes per lead

// TTL cleanup: evict entries older than 1 hour to prevent unbounded memory growth
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [leadId, ts] of aiSmsReplyThrottle) {
    if (ts < cutoff) aiSmsReplyThrottle.delete(leadId);
  }
}, 10 * 60 * 1000).unref();

// ── Helpers ──────────────────────────────────────────────────────────────────

function twilioBaseUrl(accountSid: string) {
  return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}`;
}

async function twilioFetch(
  creds: TwilioSmsCreds,
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
  const isSuperAdmin = crmUser.role === "super_admin";

  if (!crmUser.campaignId && !isSuperAdmin) {
    res.status(400).json({ error: "No campaign assigned" }); return;
  }

  // Super admin may pass ?campaignId=X to load a specific campaign's config
  const queryCampaignId = isSuperAdmin && req.query.campaignId
    ? parseInt(req.query.campaignId as string, 10)
    : null;

  // Super admin with no campaign and no ?campaignId → return global env var config
  if (!crmUser.campaignId && isSuperAdmin && !queryCampaignId) {
    const global = getGlobalSmsCreds();
    res.json({
      configured: !!global,
      voiceConfigured: !!(global && process.env.TWILIO_API_KEY_SID && process.env.TWILIO_VOICE_APP_SID),
      twilioEnabled: !!global,
      accountSid: global?.accountSid || null,
      authTokenMasked: global ? "Using global environment credentials" : null,
      phoneNumber: global?.phoneNumber || null,
      apiKeySid: process.env.TWILIO_API_KEY_SID || null,
      apiKeySecretMasked: process.env.TWILIO_API_KEY_SECRET ? "Using global environment credentials" : null,
      voiceAppSid: process.env.TWILIO_VOICE_APP_SID || null,
    });
    return;
  }

  // Resolve which campaign ID to read: super admin explicit query > user's own campaign
  const effectiveCampaignId = queryCampaignId || crmUser.campaignId!;

  try {
    const [campaign] = await db.select().from(crmCampaigns)
      .where(eq(crmCampaigns.id, effectiveCampaignId)).limit(1);
    const sid = campaign?.twilioAccountSid ?? null;
    const token = campaign?.twilioAuthToken ?? null;
    const phone = campaign?.twilioPhoneNumber ?? null;
    const enabled = campaign?.twilioEnabled ?? false;
    const apiKeySid = campaign?.twilioApiKeySid ?? null;
    const apiKeySecret = campaign?.twilioApiKeySecret ?? null;
    const voiceAppSid = campaign?.twilioVoiceAppSid ?? null;
    const forwardPhone = campaign?.twilioForwardPhone ?? null;
    const voiceConfigured = !!(sid && apiKeySid && apiKeySecret && voiceAppSid);
    res.json({
      configured: !!(sid && token),
      voiceConfigured,
      twilioEnabled: enabled,
      accountSid: sid || null,
      authTokenMasked: token ? "••••••••••••••••••••••••" + token.slice(-4) : null,
      phoneNumber: phone || null,
      forwardPhone: forwardPhone || null,
      apiKeySid: apiKeySid || null,
      apiKeySecretMasked: apiKeySecret ? "••••••••••••••••••••••••" + apiKeySecret.slice(-4) : null,
      voiceAppSid: voiceAppSid || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/twilio/config ───────────────────────────────────────────────────

router.post("/twilio/config", crmAuth, crmAdminOnly, async (req, res) => {
  const crmUser = req.crmUser!;
  const isSuperAdmin = crmUser.role === "super_admin";

  const { accountSid, authToken, phoneNumber, forwardPhone, twilioEnabled, apiKeySid, apiKeySecret, voiceAppSid, campaignId: bodyCampaignId } = req.body;
  if (!accountSid || !authToken) {
    res.status(400).json({ error: "accountSid and authToken are required" }); return;
  }

  // Super admin may pass an explicit campaignId in the body to configure that campaign
  const targetCampaignId: number | null = isSuperAdmin && bodyCampaignId
    ? Number(bodyCampaignId)
    : (crmUser.campaignId ?? null);

  // Super admin without a target campaign → write credentials into process.env so the
  // existing global fallback paths (getGlobalSmsCreds + getGlobalVoiceConfig) pick them up
  // immediately. For persistence across Railway deploys, set the same vars in Railway.
  if (isSuperAdmin && !targetCampaignId) {
    process.env.TWILIO_ACCOUNT_SID = accountSid;
    process.env.TWILIO_AUTH_TOKEN = authToken;
    if (phoneNumber) process.env.TWILIO_VOICE_CALLER_ID = phoneNumber;
    if (apiKeySid) process.env.TWILIO_API_KEY_SID = apiKeySid;
    if (apiKeySecret) process.env.TWILIO_API_KEY_SECRET = apiKeySecret;
    if (voiceAppSid) process.env.TWILIO_VOICE_APP_SID = voiceAppSid;
    res.json({ success: true, configured: true });
    return;
  }

  if (!targetCampaignId) { res.status(400).json({ error: "No campaign assigned" }); return; }

  try {
    const encToken = encryptPassword(authToken);
    const encApiSecret = apiKeySecret ? encryptPassword(apiKeySecret) : undefined;

    // Always update SMS / core credentials; only update voice fields when
    // explicitly supplied — prevents accidentally clearing the Voice API Key
    // when the user re-saves only their Account SID / Auth Token.
    const updateFields: Record<string, unknown> = {
      twilioAccountSid: accountSid,
      twilioAuthToken: encToken,
      twilioPhoneNumber: phoneNumber || null,
      twilioForwardPhone: forwardPhone || null,
      twilioEnabled: twilioEnabled !== false,
    };
    if (apiKeySid) updateFields.twilioApiKeySid = apiKeySid;
    if (encApiSecret) updateFields.twilioApiKeySecret = encApiSecret;
    if (voiceAppSid) updateFields.twilioVoiceAppSid = voiceAppSid;

    await db.update(crmCampaigns)
      .set(updateFields)
      .where(eq(crmCampaigns.id, targetCampaignId!));

    // ── Auto-create TwiML App if voice API Key supplied but no VoiceAppSid ──
    // This saves campaign admins from having to manually create a TwiML App in
    // the Twilio Console and paste the SID back into the CRM.
    let autoCreatedVoiceAppSid: string | null = null;
    if (apiKeySid && !voiceAppSid) {
      try {
        // Always derive the base URL from the current request's host — NOT from
        // API_BASE_URL which may point to a different deployment (Railway vs Replit).
        const ownHost = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim()
          || (req.headers.host as string | undefined)
          || process.env.REPLIT_DEV_DOMAIN
          || "localhost:8080";
        const apiBase = `https://${ownHost.replace(/:\d+$/, "")}/api`;
        const appBody = new URLSearchParams({
          FriendlyName: `TolipAI CRM Voice – Campaign ${targetCampaignId}`,
          VoiceUrl: `${apiBase}/twilio/voice/answer`,
          VoiceMethod: "POST",
          StatusCallback: `${apiBase}/twilio/voice/call-status`,
          StatusCallbackMethod: "POST",
        });
        const tempCreds = { accountSid, authToken, phoneNumber: phoneNumber || "" };
        const appData = await twilioFetch(tempCreds as any, "/Applications.json", {
          method: "POST",
          body: appBody.toString(),
        });
        if (appData?.sid) {
          autoCreatedVoiceAppSid = appData.sid;
          await db
            .update(crmCampaigns)
            .set({ twilioVoiceAppSid: appData.sid })
            .where(eq(crmCampaigns.id, targetCampaignId!));
          logger.info(
            { campaignId: targetCampaignId, voiceAppSid: appData.sid },
            "[twilio/config] Auto-created TwiML App for campaign"
          );
        }
      } catch (appErr) {
        // Non-fatal — user can manually create the TwiML App if this fails
        logger.warn(appErr, "[twilio/config] Auto TwiML App creation failed — user must create manually in Twilio Console");
      }
    }

    // ── Auto-update existing TwiML App URL to point at this server ──────────
    // Runs whenever voiceAppSid is already stored — ensures the URL stays correct
    // across environment changes (e.g. Railway → Replit or domain updates).
    const existingVoiceAppSid = voiceAppSid || autoCreatedVoiceAppSid;
    if (apiKeySid && apiKeySecret && existingVoiceAppSid && targetCampaignId) {
      const ownHostCfg = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim()
        || (req.headers.host as string | undefined)
        || process.env.REPLIT_DEV_DOMAIN
        || "localhost:8080";
      const cfgBase = `https://${ownHostCfg.replace(/:\d+$/, "")}/api`;
      try {
        const rawSecret = apiKeySecret; // user just submitted plaintext secret in body
        const authHdr = Buffer.from(`${apiKeySid}:${rawSecret}`).toString("base64");
        await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Applications/${existingVoiceAppSid}.json`,
          {
            method: "POST",
            headers: { Authorization: `Basic ${authHdr}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              VoiceUrl: `${cfgBase}/twilio/voice/answer`,
              VoiceMethod: "POST",
              StatusCallback: `${cfgBase}/twilio/voice/call-status`,
              StatusCallbackMethod: "POST",
            }).toString(),
          }
        );
        logger.info({ existingVoiceAppSid, cfgBase }, "[twilio/config] TwiML App URL auto-updated to current server");
      } catch (updateErr) {
        logger.warn(updateErr, "[twilio/config] TwiML App URL auto-update failed (non-fatal)");
      }
    }

    res.json({
      success: true,
      configured: true,
      ...(autoCreatedVoiceAppSid ? { voiceAppSidCreated: autoCreatedVoiceAppSid } : {}),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/twilio/phone-numbers ─────────────────────────────────────────────

router.get("/twilio/phone-numbers", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  const isSuperAdmin = crmUser.role === "super_admin";

  // Helper: build a synthetic entry from the configured phone number so the page
  // always shows something useful even when the Twilio REST API is unavailable.
  // Queries the phone number directly — does NOT require credentials to be set.
  const dbFallback = async (): Promise<any[]> => {
    try {
      let phone: string | null | undefined = null;
      if (crmUser.campaignId) {
        // Direct query for the phone number only — skips credential validation
        const [camp] = await db
          .select({ phone: crmCampaigns.twilioPhoneNumber })
          .from(crmCampaigns)
          .where(eq(crmCampaigns.id, crmUser.campaignId))
          .limit(1);
        phone = camp?.phone;
      }
      // Fall back to global env var for super admins
      if (!phone && isSuperAdmin) {
        phone = getGlobalSmsCreds()?.phoneNumber || process.env.TWILIO_VOICE_CALLER_ID || null;
      }
      // Super admin last resort: scan ALL campaigns for any configured phone number
      if (!phone && isSuperAdmin) {
        const camps = await db
          .select({ phone: crmCampaigns.twilioPhoneNumber })
          .from(crmCampaigns)
          .where(isNotNull(crmCampaigns.twilioPhoneNumber))
          .limit(20);
        const phones = camps.filter(c => c.phone);
        if (phones.length > 0) {
          return phones.map(c => ({
            id: c.phone!,
            sid: "configured",
            number: c.phone!,
            name: `${c.phone} (configured)`,
            capabilities: { voice: true, sms: true, mms: false },
          }));
        }
      }
      if (!phone) return [];
      return [{
        id: phone,
        sid: "configured",
        number: phone,
        name: `${phone} (configured)`,
        capabilities: { voice: true, sms: true, mms: false },
      }];
    } catch { return []; }
  };

  // For super admin with no campaignId, try to find usable creds from any campaign in the DB
  // so the Twilio REST API can be called to list real purchased phone numbers.
  const tryFetchWithAnyCampaignCreds = async (): Promise<any[] | null> => {
    if (!isSuperAdmin || crmUser.campaignId) return null;
    try {
      const campaigns = await db
        .select({
          id: crmCampaigns.id,
          accountSid: crmCampaigns.twilioAccountSid,
          authToken: crmCampaigns.twilioAuthToken,
          phoneNumber: crmCampaigns.twilioPhoneNumber,
        })
        .from(crmCampaigns)
        .where(isNotNull(crmCampaigns.twilioAccountSid))
        .limit(5);

      for (const camp of campaigns) {
        if (!camp.accountSid || !camp.authToken) continue;
        try {
          const { safeDec } = await import("../lib/encryption");
          const campCreds = {
            accountSid: camp.accountSid,
            authToken: safeDec(camp.authToken),
            phoneNumber: camp.phoneNumber || "",
          };
          const data = await twilioFetch(campCreds as any, "/IncomingPhoneNumbers.json");
          const nums = data.incoming_phone_numbers || [];
          if (nums.length > 0) {
            return nums.map((n: any) => ({
              id: n.phone_number, sid: n.sid, number: n.phone_number,
              name: n.friendly_name || n.phone_number,
              capabilities: n.capabilities ?? { voice: true, sms: true, mms: false },
            }));
          }
        } catch { continue; }
      }
    } catch { }
    return null;
  };

  try {
    let creds: any;
    try {
      creds = await resolveSmsCreds(crmUser.campaignId, isSuperAdmin);
    } catch (credErr: any) {
      // Super admin without global env vars — try campaign DB creds before giving up
      const fromCampaigns = await tryFetchWithAnyCampaignCreds();
      if (fromCampaigns) {
        const phoneNumbers = fromCampaigns.length > 0 ? fromCampaigns : await dbFallback();
        res.json({ phoneNumbers });
        return;
      }
      throw credErr;
    }
    const data = await twilioFetch(creds, "/IncomingPhoneNumbers.json");
    const numbers = (data.incoming_phone_numbers || []).map((n: any) => ({
      id: n.phone_number,
      sid: n.sid,
      number: n.phone_number,
      name: n.friendly_name || n.phone_number,
      capabilities: n.capabilities ?? { voice: true, sms: true, mms: false },
    }));
    // If Twilio API returned nothing, still show the DB-configured number
    const phoneNumbers = numbers.length > 0 ? numbers : await dbFallback();
    res.json({ phoneNumbers });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    const fallback = await dbFallback();
    if (fallback.length > 0) {
      res.json({ phoneNumbers: fallback, warning: "Twilio API unreachable — showing configured number only." });
    } else {
      res.status(status).json({
        error: err?.message || "Failed to load phone numbers",
        phoneNumbers: [],
      });
    }
  }
});

// ── GET /api/twilio/messages ──────────────────────────────────────────────────

router.get("/twilio/messages", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  const { phoneNumberId, contactPhone } = req.query as Record<string, string>;
  if (!phoneNumberId || !contactPhone) {
    res.status(400).json({ error: "phoneNumberId and contactPhone are required" }); return;
  }
  const isSuperAdmin = crmUser.role === "super_admin";
  try {
    const creds = await resolveSmsCreds(crmUser.campaignId, isSuperAdmin);
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

const smsMessageSchema = z.object({
  phoneNumberId: z.string().min(1, "phoneNumberId is required"),
  to: z.string().min(7, "to phone number is required").max(30),
  content: z.string().min(1, "message content is required").max(1600),
  leadId: z.number().int().positive().optional().nullable(),
  campaignId: z.number().int().positive().optional().nullable(),
});

router.post("/twilio/messages", crmAuth, validateBody(smsMessageSchema), async (req, res) => {
  const crmUser = req.crmUser!;
  const { phoneNumberId, to, content, leadId, campaignId } = req.body;
  const campId = campaignId ? Number(campaignId) : crmUser.campaignId;
  const isSuperAdminMsg = crmUser.role === "super_admin";
  try {
    const creds = await resolveSmsCreds(campId, isSuperAdminMsg);
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
  const isSuperAdminCalls = crmUser.role === "super_admin";
  try {
    const creds = await resolveSmsCreds(crmUser.campaignId, isSuperAdminCalls);
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

  const leadE164 = toE164(leadPhone);
  const agentE164 = toE164(agentPhone);
  if (!leadE164) { res.status(400).json({ error: "Invalid lead phone number" }); return; }
  if (!agentE164) { res.status(400).json({ error: "Invalid agent phone number" }); return; }
  const ownHostCtC = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim()
    || (req.headers.host as string | undefined)
    || process.env.REPLIT_DEV_DOMAIN
    || "localhost:8080";
  const apiBase = `https://${ownHostCtC.replace(/:\d+$/, "")}/api`;
  const twimlUrl = `${apiBase}/twilio/twiml/call?to=${encodeURIComponent(leadE164)}&callerId=${encodeURIComponent(fromNumber)}`;

  try {
    const isSuperAdminCtC = crmUser.role === "super_admin";
    const creds = await resolveSmsCreds(crmUser.campaignId, isSuperAdminCtC);
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

// ── POST /api/twilio/reconfigure-twiml-app ───────────────────────────────────
// Updates an existing TwiML App's Voice URL to the correct /answer endpoint.
// Fixes campaigns that were set up before the /inbound → /answer rename.

router.post("/twilio/reconfigure-twiml-app", crmAuth, crmAdminOnly, async (req, res) => {
  const crmUser = req.crmUser!;
  const isSuperAdmin = crmUser.role === "super_admin";
  const targetCampaignId = isSuperAdmin
    ? (req.body?.campaignId ? Number(req.body.campaignId) : null)
    : crmUser.campaignId;

  if (!targetCampaignId) {
    res.status(400).json({ error: "Select a campaign first (or pass campaignId in the request body)." });
    return;
  }

  try {
    const voiceCfg = await resolveVoiceConfig(targetCampaignId, isSuperAdmin);
    // Always use the server that handled THIS request — not API_BASE_URL (which may point to a different env).
    // x-forwarded-host is set by Replit/Railway proxies and carries the public hostname.
    const ownHost = (req.headers["x-forwarded-host"] as string) || req.headers.host || process.env.REPLIT_DEV_DOMAIN || "localhost:8080";
    const ownBase = `https://${ownHost.split(",")[0].trim()}/api`;
    const voiceUrl = `${ownBase}/twilio/voice/answer`;

    const auth = Buffer.from(`${voiceCfg.apiKeySid}:${voiceCfg.apiKeySecret}`).toString("base64");
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${voiceCfg.accountSid}/Applications/${voiceCfg.appSid}.json`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          VoiceUrl: voiceUrl,
          VoiceMethod: "POST",
          StatusCallback: `${ownBase}/twilio/voice/call-status`,
          StatusCallbackMethod: "POST",
        }).toString(),
      }
    );

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({})) as any;
      throw Object.assign(
        new Error(body?.message || `Twilio error ${resp.status}`),
        { status: resp.status }
      );
    }

    const data = await resp.json() as any;
    logger.info({ appSid: data.sid, voiceUrl, campaignId: targetCampaignId }, "[twilio/reconfigure-twiml-app] updated");
    res.json({ success: true, voiceUrl, appSid: data.sid, friendlyName: data.friendly_name });
  } catch (err: any) {
    logger.error(err, "[twilio/reconfigure-twiml-app] error");
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /api/twilio/setup-webhooks ──────────────────────────────────────────

router.post("/twilio/setup-webhooks", crmAuth, crmAdminOnly, async (req, res) => {
  const crmUser = req.crmUser!;
  if (!crmUser.campaignId) { res.status(400).json({ error: "No campaign assigned" }); return; }
  try {
    const creds = await resolveSmsCreds(crmUser.campaignId, false);
    // Derive URLs from THIS request's host so webhooks always point to the server
    // that is actually handling traffic — never to a stale API_BASE_URL env var.
    const ownHostWH = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim()
      || (req.headers.host as string | undefined)
      || process.env.REPLIT_DEV_DOMAIN
      || "localhost:8080";
    const apiBase = `https://${ownHostWH.replace(/:\d+$/, "")}/api`;
    const smsWebhook = `${apiBase}/twilio/webhook`;
    const data = await twilioFetch(creds, "/IncomingPhoneNumbers.json");
    const numbers: any[] = data.incoming_phone_numbers || [];

    const voiceWebhook = `${apiBase}/twilio/voice/inbound`;
    const results = await Promise.all(
      numbers.map(async (n: any) => {
        try {
          const body = new URLSearchParams({
            SmsUrl: smsWebhook,
            SmsMethod: "POST",
            VoiceUrl: voiceWebhook,
            VoiceMethod: "POST",
          });
          await twilioFetch(creds, `/IncomingPhoneNumbers/${n.sid}.json`, {
            method: "POST",
            body: body.toString(),
            headers: { "X-HTTP-Method-Override": "PUT" },
          });
          return { number: n.phone_number, sid: n.sid, status: "configured", smsWebhook, voiceWebhook };
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

  let authToken: string | null = null;
  for (const c of campaigns) {
    if (!c.twilioPhoneNumber) continue;
    if (digitsOnly(c.twilioPhoneNumber) === digitsOnly(toNumber)) {
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

  // Fallback to global env var for super_admin path
  if (!authToken) {
    authToken = process.env.TWILIO_AUTH_TOKEN || null;
  }

  if (!authToken) return false;

  // Reconstruct the full URL Twilio signed
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "localhost";
  const url = `${proto}://${host}${req.originalUrl}`;

  const params = req.body as Record<string, string>;

  // Use the official Twilio SDK for signature validation — handles all edge cases
  return twilio.validateRequest(authToken, twilioSig, url, params);
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

    const normFrom = digitsOnly(fromNumber);
    // Query DB directly using normalized phone — avoids full-table scan + JS find
    const allLeads = await db
      .select({ id: crmLeads.id, phone: crmLeads.phone, campaignId: crmLeads.campaignId })
      .from(crmLeads)
      .where(sql`regexp_replace(${crmLeads.phone}, '[^0-9]', '', 'g') = ${normFrom}`)
      .limit(1);
    const lead = allLeads[0] ?? null;

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

// ── GET /api/twilio/campaign-health ──────────────────────────────────────────
// Super admin only — scans every campaign and reports Twilio credential status.

router.get("/twilio/campaign-health", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  if (crmUser.role !== "super_admin") {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  try {
    const campaigns = await db
      .select({
        id: crmCampaigns.id,
        name: crmCampaigns.name,
        slug: crmCampaigns.slug,
        twilioAccountSid: crmCampaigns.twilioAccountSid,
        twilioAuthToken: crmCampaigns.twilioAuthToken,
        twilioPhoneNumber: crmCampaigns.twilioPhoneNumber,
        twilioEnabled: crmCampaigns.twilioEnabled,
        twilioApiKeySid: crmCampaigns.twilioApiKeySid,
        twilioApiKeySecret: crmCampaigns.twilioApiKeySecret,
        twilioVoiceAppSid: crmCampaigns.twilioVoiceAppSid,
      })
      .from(crmCampaigns)
      .orderBy(crmCampaigns.name);

    const results = campaigns.map((c) => {
      const hasSms = !!(c.twilioAccountSid && c.twilioAuthToken && c.twilioPhoneNumber);
      const hasVoice = !!(
        c.twilioAccountSid &&
        c.twilioApiKeySid &&
        c.twilioApiKeySecret &&
        c.twilioVoiceAppSid &&
        c.twilioPhoneNumber
      );
      const hasAny = !!(c.twilioAccountSid && c.twilioAuthToken);

      let status: "full" | "sms_only" | "partial" | "none";
      if (hasSms && hasVoice) status = "full";
      else if (hasSms) status = "sms_only";
      else if (hasAny) status = "partial";
      else status = "none";

      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        phoneNumber: c.twilioPhoneNumber || null,
        enabled: c.twilioEnabled ?? false,
        status,
        hasSms,
        hasVoice,
        accountSidHint: c.twilioAccountSid
          ? `${c.twilioAccountSid.slice(0, 6)}…${c.twilioAccountSid.slice(-4)}`
          : null,
      };
    });

    res.json({ campaigns: results, checkedAt: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/twilio/phone-numbers/:number/conversations ───────────────────────
// Returns unique contacts (other numbers) that have had calls with this owned number,
// sorted by most recent call. Used by the Phone Numbers inbox page.
router.get("/twilio/phone-numbers/:number/conversations", crmAuth, async (req, res) => {
  const { number } = req.params;
  const crmUser = req.crmUser!;
  try {
    const isSuperAdmin = crmUser.role === "super_admin";
    const { crmCallLogs } = await import("@workspace/db/schema").then(m => m);
    const campaignFilter: any = isSuperAdmin || !crmUser.campaignId
      ? sql`TRUE`
      : eq(crmCallLogs.campaignId, crmUser.campaignId);

    const ownedDigits = number.replace(/\D/g, "").slice(-10);

    const rows = await db
      .select({
        id:           crmCallLogs.id,
        fromNumber:   crmCallLogs.fromNumber,
        toNumber:     crmCallLogs.toNumber,
        direction:    crmCallLogs.direction,
        status:       crmCallLogs.status,
        duration:     crmCallLogs.duration,
        recordingUrl: crmCallLogs.recordingUrl,
        leadId:       crmCallLogs.leadId,
        createdAt:    crmCallLogs.createdAt,
      })
      .from(crmCallLogs)
      .where(
        and(
          campaignFilter,
          sql`(RIGHT(REGEXP_REPLACE(${crmCallLogs.fromNumber}, '[^0-9]', '', 'g'), 10) = ${ownedDigits}
            OR RIGHT(REGEXP_REPLACE(${crmCallLogs.toNumber}, '[^0-9]', '', 'g'), 10) = ${ownedDigits})`
        )
      )
      .orderBy(desc(crmCallLogs.createdAt))
      .limit(500);

    const contactMap = new Map<string, {
      contact: string;
      totalCalls: number;
      lastCall: string;
      lastDirection: string;
      lastStatus: string;
      lastDuration: number | null;
      leadId: number | null;
      hasRecording: boolean;
    }>();

    for (const row of rows) {
      const fromDigits = (row.fromNumber || "").replace(/\D/g, "").slice(-10);
      const toDigits = (row.toNumber || "").replace(/\D/g, "").slice(-10);
      const otherNumber = fromDigits === ownedDigits ? row.toNumber : row.fromNumber;
      if (!otherNumber) continue;
      const normalizedOther = otherNumber.replace(/\D/g, "").slice(-10);
      const entry = contactMap.get(normalizedOther);
      if (!entry) {
        contactMap.set(normalizedOther, {
          contact: otherNumber,
          totalCalls: 1,
          lastCall: row.createdAt?.toISOString() ?? new Date().toISOString(),
          lastDirection: row.direction ?? "outbound",
          lastStatus: row.status ?? "completed",
          lastDuration: row.duration ?? null,
          leadId: row.leadId ?? null,
          hasRecording: !!row.recordingUrl,
        });
      } else {
        entry.totalCalls += 1;
        if (!entry.hasRecording && row.recordingUrl) entry.hasRecording = true;
        if (!entry.leadId && row.leadId) entry.leadId = row.leadId;
      }
    }

    res.json({ conversations: Array.from(contactMap.values()), total: contactMap.size });
  } catch (err: any) {
    logger.error(err, "[phone-numbers/conversations] error");
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/twilio/phone-numbers/:number/conversations/:contact ──────────────
// Full unified thread (calls + SMS) between an owned number and a contact number.
router.get("/twilio/phone-numbers/:number/conversations/:contact", crmAuth, async (req, res) => {
  const { number, contact } = req.params;
  const crmUser = req.crmUser!;
  try {
    const isSuperAdmin = crmUser.role === "super_admin";
    const { crmCallLogs, crmLeads: crmLeadsTable } = await import("@workspace/db/schema").then(m => m);
    const callCampaignFilter: any = isSuperAdmin || !crmUser.campaignId
      ? sql`TRUE`
      : eq(crmCallLogs.campaignId, crmUser.campaignId);
    const smsCampaignFilter: any = isSuperAdmin || !crmUser.campaignId
      ? sql`TRUE`
      : eq(crmOpenPhoneMessages.campaignId, crmUser.campaignId);

    const numDigits = number.replace(/\D/g, "").slice(-10);
    const ctDigits = contact.replace(/\D/g, "").slice(-10);

    const [callRows, smsRows] = await Promise.all([
      db.select().from(crmCallLogs)
        .where(and(
          callCampaignFilter,
          sql`(
            (RIGHT(REGEXP_REPLACE(${crmCallLogs.fromNumber}, '[^0-9]', '', 'g'), 10) = ${numDigits}
              AND RIGHT(REGEXP_REPLACE(${crmCallLogs.toNumber}, '[^0-9]', '', 'g'), 10) = ${ctDigits})
            OR
            (RIGHT(REGEXP_REPLACE(${crmCallLogs.fromNumber}, '[^0-9]', '', 'g'), 10) = ${ctDigits}
              AND RIGHT(REGEXP_REPLACE(${crmCallLogs.toNumber}, '[^0-9]', '', 'g'), 10) = ${numDigits})
          )`
        ))
        .orderBy(desc(crmCallLogs.createdAt))
        .limit(200),

      db.select().from(crmOpenPhoneMessages)
        .where(and(
          smsCampaignFilter,
          sql`(
            (RIGHT(REGEXP_REPLACE(${crmOpenPhoneMessages.fromNumber}, '[^0-9]', '', 'g'), 10) = ${numDigits}
              AND RIGHT(REGEXP_REPLACE(${crmOpenPhoneMessages.toNumber}, '[^0-9]', '', 'g'), 10) = ${ctDigits})
            OR
            (RIGHT(REGEXP_REPLACE(${crmOpenPhoneMessages.fromNumber}, '[^0-9]', '', 'g'), 10) = ${ctDigits}
              AND RIGHT(REGEXP_REPLACE(${crmOpenPhoneMessages.toNumber}, '[^0-9]', '', 'g'), 10) = ${numDigits})
          )`
        ))
        .orderBy(desc(crmOpenPhoneMessages.createdAt))
        .limit(200),
    ]);

    const thread = [
      ...callRows.map(r => ({ ...r, type: "call" as const })),
      ...smsRows.map(r => ({ ...r, type: "sms" as const })),
    ].sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime());

    let lead = null;
    const leadId = callRows.find(r => r.leadId)?.leadId ?? smsRows.find(r => r.leadId)?.leadId;
    if (leadId) {
      const [l] = await db.select({
        id: crmLeadsTable.id,
        sellerName: crmLeadsTable.sellerName,
        phone: crmLeadsTable.phone,
        address: crmLeadsTable.address,
        status: crmLeadsTable.status,
      }).from(crmLeadsTable).where(eq(crmLeadsTable.id, leadId)).limit(1);
      lead = l ?? null;
    }

    res.json({ thread, calls: callRows, total: thread.length, lead });
  } catch (err: any) {
    logger.error(err, "[phone-numbers/conversations/contact] error");
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/twilio/auto-missed-call-sms ─────────────────────────────────────
// Sends an automatic follow-up SMS after a missed call in the Power Dialer.
router.post("/twilio/auto-missed-call-sms", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  const { to, from, message, leadId } = req.body as {
    to: string; from: string; message: string; leadId?: number | null;
  };
  if (!to || !from || !message) {
    res.status(400).json({ error: "to, from, and message are required" }); return;
  }
  const isSuperAdminSms = crmUser.role === "super_admin";
  try {
    const creds = await resolveSmsCreds(crmUser.campaignId, isSuperAdminSms);
    const toE164Result = toE164(to);
    if (!toE164Result) { res.status(400).json({ error: "Invalid destination phone number" }); return; }
    const body = new URLSearchParams({ From: from, To: toE164Result, Body: message });
    const data = await twilioFetch(creds, "/Messages.json", { method: "POST", body: body.toString() });
    if (data.sid) {
      await db.insert(crmOpenPhoneMessages).values({
        leadId: leadId ? Number(leadId) : null,
        campaignId: crmUser.campaignId,
        openPhoneMessageId: data.sid,
        direction: "outgoing",
        fromNumber: from,
        toNumber: toE164Result,
        content: message,
        status: data.status || "sent",
      }).onConflictDoNothing();
    }
    res.json({ success: true, sid: data.sid });
  } catch (err: any) {
    logger.error(err, "[auto-missed-call-sms] error");
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /api/twilio/twiml/multi-call ──────────────────────────────────────────
// Multi-line power-dialer TwiML: dials up to 5 numbers simultaneously.
// The first lead to answer connects to the agent; Twilio hangs up the rest.
// Query params: numbers (comma-separated E164), callerId
router.get("/twilio/twiml/multi-call", (req, res) => {
  const numbersParam = (req.query.numbers as string) || "";
  const callerId = (req.query.callerId as string) || "";
  if (!numbersParam) {
    res.set("Content-Type", "text/xml").send(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>No destination numbers provided.</Say></Response>'
    );
    return;
  }
  const numbers = numbersParam.split(",").filter(Boolean).slice(0, 5);
  if (numbers.length === 1) {
    res.set("Content-Type", "text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connecting now.</Say>
  <Dial callerId="${callerId}" timeout="30">${numbers[0]}</Dial>
</Response>`);
    return;
  }
  const numberTags = numbers.map(n => `    <Number>${n.trim()}</Number>`).join("\n");
  res.set("Content-Type", "text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connecting. First line to answer will be bridged.</Say>
  <Dial callerId="${callerId}" timeout="30">
${numberTags}
  </Dial>
</Response>`);
});

export default router;

