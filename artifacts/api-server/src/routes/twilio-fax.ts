import { Router } from "express";
import { db } from "@workspace/db";
import { crmFaxes, crmLeads, crmCampaigns } from "@workspace/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { crmAuth } from "./crm/middleware";
import { logger } from "../lib/logger";
import { getSmsCreds } from "../services/twilioCredentials";
import { getWebhookBase } from "../lib/webhookBase";

const router = Router();

// ── POST /api/twilio/fax/inbound ─────────────────────────────────────────────
// Twilio Programmable Fax webhook — called when a fax is received.
router.post("/twilio/fax/inbound", async (req, res) => {
  res.set("Content-Type", "text/xml");
  try {
    const { FaxSid, From, To, Status, NumPages, MediaUrl } = req.body;
    logger.info({ FaxSid, From, To, Status }, "[fax/inbound] received");

    const toDigits = (To || "").replace(/\D/g, "").slice(-10);
    const fromDigits = (From || "").replace(/\D/g, "").slice(-10);

    const [campaign] = await db
      .select({ id: crmCampaigns.id })
      .from(crmCampaigns)
      .where(sql`RIGHT(REGEXP_REPLACE(${crmCampaigns.twilioPhoneNumber}, '[^0-9]', '', 'g'), 10) = ${toDigits}`)
      .limit(1);

    const [lead] = await db
      .select({ id: crmLeads.id })
      .from(crmLeads)
      .where(sql`RIGHT(REGEXP_REPLACE(${crmLeads.phone}, '[^0-9]', '', 'g'), 10) = ${fromDigits}`)
      .limit(1);

    if (FaxSid) {
      await db.insert(crmFaxes).values({
        campaignId: campaign?.id ?? null,
        leadId: lead?.id ?? null,
        direction: "inbound",
        status: (Status ?? "received").toLowerCase(),
        fromNumber: From ?? "",
        toNumber: To ?? "",
        numPages: NumPages ? parseInt(String(NumPages)) : null,
        pdfUrl: MediaUrl ?? null,
        mediaUrl: MediaUrl ?? null,
        faxSid: FaxSid,
      }).onConflictDoUpdate({
        target: crmFaxes.faxSid,
        set: {
          status: (Status ?? "received").toLowerCase(),
          numPages: NumPages ? parseInt(String(NumPages)) : null,
          pdfUrl: MediaUrl ?? null,
          mediaUrl: MediaUrl ?? null,
          updatedAt: new Date(),
        },
      });
    }

    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response/>`);
  } catch (err) {
    logger.error(err, "[fax/inbound] error");
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response/>`);
  }
});

// ── POST /api/twilio/fax/status ───────────────────────────────────────────────
// Status callback for outbound faxes.
router.post("/twilio/fax/status", async (req, res) => {
  try {
    const { FaxSid, Status, ErrorCode, ErrorMessage, NumPages, MediaUrl } = req.body;
    if (FaxSid) {
      await db
        .update(crmFaxes)
        .set({
          status: (Status ?? "unknown").toLowerCase(),
          errorCode: ErrorCode ?? null,
          errorMessage: ErrorMessage ?? null,
          ...(NumPages ? { numPages: parseInt(String(NumPages)) } : {}),
          ...(MediaUrl ? { pdfUrl: MediaUrl, mediaUrl: MediaUrl } : {}),
          updatedAt: new Date(),
        })
        .where(eq(crmFaxes.faxSid, FaxSid));
      logger.info({ FaxSid, Status }, "[fax/status] updated");
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error(err, "[fax/status] error");
    res.status(500).json({ error: "internal" });
  }
});

// ── GET /api/twilio/fax/list ──────────────────────────────────────────────────
// List inbound or outbound faxes for the current campaign.
router.get("/twilio/fax/list", crmAuth, async (req, res) => {
  try {
    const crmUser = req.crmUser!;
    const direction = req.query.direction as string | undefined;
    const isSuperAdmin = crmUser.role === "super_admin";

    const conditions: ReturnType<typeof eq>[] = [];
    if (!isSuperAdmin && crmUser.campaignId) {
      conditions.push(eq(crmFaxes.campaignId, crmUser.campaignId));
    }
    if (direction) {
      conditions.push(eq(crmFaxes.direction, direction));
    }

    const faxes = await db
      .select({
        id: crmFaxes.id,
        direction: crmFaxes.direction,
        status: crmFaxes.status,
        fromNumber: crmFaxes.fromNumber,
        toNumber: crmFaxes.toNumber,
        numPages: crmFaxes.numPages,
        pdfUrl: crmFaxes.pdfUrl,
        faxSid: crmFaxes.faxSid,
        errorMessage: crmFaxes.errorMessage,
        createdAt: crmFaxes.createdAt,
        leadId: crmFaxes.leadId,
        leadName: crmLeads.sellerName,
      })
      .from(crmFaxes)
      .leftJoin(crmLeads, eq(crmFaxes.leadId, crmLeads.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(crmFaxes.createdAt))
      .limit(100);

    res.json({ faxes });
  } catch (err: any) {
    logger.error(err, "[fax/list] error");
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/twilio/fax/send ─────────────────────────────────────────────────
// Send an outbound fax. `mediaUrl` must be a publicly accessible PDF.
router.post("/twilio/fax/send", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  try {
    const { to, mediaUrl } = req.body as { to?: string; mediaUrl?: string };
    if (!to || !mediaUrl) {
      res.status(400).json({ error: "to and mediaUrl are required" });
      return;
    }
    const campaignId = crmUser.campaignId;
    if (!campaignId) {
      res.status(400).json({ error: "No campaign assigned" });
      return;
    }
    const creds = await getSmsCreds(campaignId);
    if (!creds?.phoneNumber) {
      res.status(422).json({ error: "Twilio phone number not configured for this campaign" });
      return;
    }

    const apiBase = getWebhookBase(req);
    const authHdr = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");

    const faxRes = await fetch("https://fax.twilio.com/v1/Faxes", {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHdr}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: creds.phoneNumber,
        To: to,
        MediaUrl: mediaUrl,
        StatusCallback: `${apiBase}/twilio/fax/status`,
        StoreMedia: "true",
      }).toString(),
    });

    const data = await faxRes.json() as any;
    if (!faxRes.ok) throw new Error(data?.message || `Twilio Fax API error ${faxRes.status}`);

    await db.insert(crmFaxes).values({
      campaignId,
      leadId: null,
      direction: "outbound",
      status: (data.status ?? "queued").toLowerCase(),
      fromNumber: creds.phoneNumber,
      toNumber: to,
      mediaUrl,
      faxSid: data.sid ?? null,
    });

    logger.info({ faxSid: data.sid, to }, "[fax/send] queued");
    res.json({ success: true, faxSid: data.sid, status: data.status });
  } catch (err: any) {
    logger.error(err, "[fax/send] error");
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/twilio/fax/setup-webhook ───────────────────────────────────────
// Configures the Fax URL on the campaign's Twilio phone number so incoming
// faxes are delivered to this server.
router.post("/twilio/fax/setup-webhook", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  const campaignId = crmUser.campaignId;
  if (!campaignId) {
    res.status(400).json({ error: "No campaign assigned" });
    return;
  }
  try {
    const creds = await getSmsCreds(campaignId);
    if (!creds?.phoneNumber) {
      res.status(422).json({ error: "Twilio not configured for this campaign" });
      return;
    }

    const apiBase = getWebhookBase(req);
    const faxWebhookUrl = `${apiBase}/twilio/fax/inbound`;
    const authHdr = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");

    const listRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/IncomingPhoneNumbers.json`,
      { headers: { Authorization: `Basic ${authHdr}` } }
    );
    const listData = await listRes.json() as any;
    const numbers: any[] = listData.incoming_phone_numbers ?? [];

    const campaignDigits = creds.phoneNumber.replace(/\D/g, "").slice(-10);
    const matching = numbers.filter((n: any) =>
      (n.phone_number ?? "").replace(/\D/g, "").slice(-10) === campaignDigits
    );

    const results = await Promise.all(
      matching.map(async (n: any) => {
        const r = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/IncomingPhoneNumbers/${n.sid}.json`,
          {
            method: "POST",
            headers: { Authorization: `Basic ${authHdr}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ FaxUrl: faxWebhookUrl, FaxMethod: "POST" }).toString(),
          }
        );
        return { sid: n.sid, number: n.phone_number, ok: r.ok };
      })
    );

    logger.info({ faxWebhookUrl, results }, "[fax/setup-webhook] done");
    res.json({ success: true, faxWebhookUrl, configured: results.filter(r => r.ok).length, results });
  } catch (err: any) {
    logger.error(err, "[fax/setup-webhook] error");
    res.status(500).json({ error: err.message });
  }
});

export default router;
