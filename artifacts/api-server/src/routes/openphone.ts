import { Router, type IRouter, type Request } from "express";
import crypto from "crypto";
import { crmAuth } from "./crm/middleware";
import { db } from "@workspace/db";
import { crmOpenPhoneMessages, crmLeads, crmCampaigns, crmUsers, crmNotifications } from "@workspace/db/schema";
import { eq, desc, or, sql as drizzleSql } from "drizzle-orm";
import { toE164, digitsOnly } from "../services/coreCalculations";
import { logger } from "../lib/logger";

// ── OpenPhone webhook signature verification (SEC-02) ─────────────────────────
// OpenPhone signs each webhook request with HMAC-SHA256(signingSecret, rawBody).
// Set OPENPHONE_WEBHOOK_SECRET in env from OpenPhone Settings → Webhooks → Signing Secret.
function verifyOpenPhoneSignature(req: Request): boolean {
  const secret = process.env.OPENPHONE_WEBHOOK_SECRET;
  if (!secret) {
    logger.warn("[openphone] OPENPHONE_WEBHOOK_SECRET not configured — webhook signature NOT verified");
    return true; // fail-open with loud warning until secret is configured
  }
  const signature = req.headers["openphone-signature"] as string | undefined;
  if (!signature) {
    logger.warn("[openphone] Missing openphone-signature header — rejecting request");
    return false;
  }
  // Reconstruct body as JSON string (Express json() body-parser re-serialises)
  const rawBody = JSON.stringify(req.body);
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

const router: IRouter = Router();

const OPENPHONE_BASE = "https://api.openphone.com/v1";

function openphoneHeaders() {
  const key = process.env.OPENPHONE_API_KEY;
  if (!key) throw new Error("OPENPHONE_API_KEY is not configured");
  return { "Authorization": key, "Content-Type": "application/json" };
}

async function opFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${OPENPHONE_BASE}${path}`, {
    ...options,
    headers: { ...openphoneHeaders(), ...(options.headers || {}) },
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw Object.assign(new Error(json?.message || "OpenPhone API error"), { status: res.status, body: json });
  return json;
}

// ── State abbreviation → OpenPhone number name matching ──────────────────────
// Matches lead state (e.g., "TX") to the best OpenPhone number
// by scanning the number's name for the state abbreviation
export function pickNumberForState(
  phoneNumbers: Array<{ id: string; name?: string; number?: string }>,
  state: string | null | undefined
): string | null {
  if (!state || !phoneNumbers.length) return null;
  const abbr = state.trim().toUpperCase().slice(0, 2);
  // Try: name starts with state abbr (e.g., "TX1", "TX", "VA")
  const match = phoneNumbers.find(n => {
    const name = (n.name || "").toUpperCase().trim();
    return name === abbr || name.startsWith(abbr + " ") || name.startsWith(abbr + "1") || name.startsWith(abbr + "2");
  }) || phoneNumbers.find(n => {
    // Looser: name contains state abbr as a word (e.g., "GRANET TX", "AZ Abdullah")
    const name = (n.name || "").toUpperCase();
    return name.includes(` ${abbr}`) || name.includes(`${abbr} `) || name.endsWith(abbr);
  });
  return match?.id ?? null;
}

// ── GET /api/openphone/phone-numbers ─────────────────────────────────────────
router.get("/openphone/phone-numbers", crmAuth, async (req, res) => {
  try {
    const data = await opFetch("/phone-numbers");
    res.json({ phoneNumbers: data.data ?? [] });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /api/openphone/messages ───────────────────────────────────────────────
// Fetch live conversation from OpenPhone API
router.get("/openphone/messages", crmAuth, async (req, res) => {
  const { phoneNumberId, contactPhone, maxResults = "50" } = req.query as Record<string, string>;
  if (!phoneNumberId || !contactPhone) {
    res.status(400).json({ error: "phoneNumberId and contactPhone are required" });
    return;
  }
  try {
    const e164 = toE164(contactPhone);
    if (!e164) { res.status(400).json({ error: "Invalid phone number" }); return; }
    // Build URL manually to ensure + is encoded as %2B (not space)
    const url = `/messages?phoneNumberId=${encodeURIComponent(phoneNumberId)}&participants%5B%5D=${encodeURIComponent(e164)}&maxResults=${maxResults}`;
    const data = await opFetch(url);
    res.json({ messages: data.data ?? [] });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /api/openphone/lead-messages/:leadId ──────────────────────────────────
// Returns locally stored messages for a lead (real-time inbound included)
router.get("/openphone/lead-messages/:leadId", crmAuth, async (req, res) => {
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

// ── POST /api/openphone/messages ──────────────────────────────────────────────
// Send an SMS and store it locally
router.post("/openphone/messages", crmAuth, async (req, res) => {
  const { phoneNumberId, to, content, leadId, campaignId } = req.body;
  if (!phoneNumberId || !to || !content) {
    res.status(400).json({ error: "phoneNumberId, to, and content are required" });
    return;
  }
  try {
    const toE164Result = toE164(to);
    if (!toE164Result) { res.status(400).json({ error: "Invalid destination phone number" }); return; }
    const data = await opFetch("/messages", {
      method: "POST",
      body: JSON.stringify({ phoneNumberId, to: [toE164Result], content }),
    });
    // Store outbound message locally
    const msg = data.data;
    if (msg?.id) {
      await db.insert(crmOpenPhoneMessages).values({
        leadId: leadId ? Number(leadId) : null,
        campaignId: campaignId ? Number(campaignId) : null,
        openPhoneMessageId: msg.id,
        direction: "outgoing",
        fromNumber: msg.from,
        toNumber: to,
        content,
        status: "sent",
      }).onConflictDoNothing();
    }
    res.json({ message: msg });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /api/openphone/calls ─────────────────────────────────────────────────
router.post("/openphone/calls", crmAuth, async (req, res) => {
  const { phoneNumberId, to, userId } = req.body;
  if (!phoneNumberId || !to) {
    res.status(400).json({ error: "phoneNumberId and to are required" });
    return;
  }
  try {
    const toE164Result = toE164(to);
    if (!toE164Result) { res.status(400).json({ error: "Invalid destination phone number" }); return; }
    const payload: any = { phoneNumberId, to: toE164Result };
    if (userId) payload.userId = userId;
    const data = await opFetch("/calls", { method: "POST", body: JSON.stringify(payload) });
    res.json({ call: data.data });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /api/openphone/calls ──────────────────────────────────────────────────
router.get("/openphone/calls", crmAuth, async (req, res) => {
  const { phoneNumberId, contactPhone, maxResults = "20" } = req.query as Record<string, string>;
  if (!phoneNumberId || !contactPhone) {
    res.status(400).json({ error: "phoneNumberId and contactPhone are required" });
    return;
  }
  try {
    const e164 = toE164(contactPhone);
    if (!e164) { res.status(400).json({ error: "Invalid phone number" }); return; }
    const url = `/calls?phoneNumberId=${encodeURIComponent(phoneNumberId)}&participants%5B%5D=${encodeURIComponent(e164)}&maxResults=${maxResults}`;
    const data = await opFetch(url);
    res.json({ calls: data.data ?? [] });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /api/openphone/webhook ───────────────────────────────────────────────
// OpenPhone sends real-time events here. Signature verified via HMAC-SHA256.
// Register this URL in OpenPhone Settings → Webhooks:
//   https://your-domain/api/openphone/webhook
// Add signing secret as env var: OPENPHONE_WEBHOOK_SECRET
router.post("/openphone/webhook", async (req, res) => {
  if (!verifyOpenPhoneSignature(req)) {
    res.status(403).json({ error: "Invalid webhook signature" });
    return;
  }
  const event = req.body;
  res.status(200).json({ received: true }); // Respond immediately

  try {
    const type = event?.type;
    if (type !== "message.received") return; // Only handle inbound SMS

    const msgData = event?.data?.object;
    if (!msgData) return;

    const fromNumber = msgData.from;
    const toNumber = Array.isArray(msgData.to) ? msgData.to[0] : msgData.to;
    const content = msgData.body || msgData.content || "";
    const openPhoneMessageId = msgData.id;
    const createdAt = msgData.createdAt ? new Date(msgData.createdAt) : new Date();

    if (!fromNumber) return;

    // Normalize phone for lookup (strip non-digits for comparison)
    const normFrom = digitsOnly(fromNumber);

    // Query DB directly using normalized phone — avoids full-table scan + JS find
    const [lead] = await db
      .select({ id: crmLeads.id, campaignId: crmLeads.campaignId, assignedTo: crmLeads.assignedTo })
      .from(crmLeads)
      .where(drizzleSql`regexp_replace(${crmLeads.phone}, '[^0-9]', '', 'g') = ${normFrom}`)
      .limit(1);
    if (!lead) {
      // No lead found — store without leadId for reference
      await db.insert(crmOpenPhoneMessages).values({
        leadId: null,
        campaignId: null,
        openPhoneMessageId,
        direction: "incoming",
        fromNumber,
        toNumber,
        content,
        status: "received",
        createdAt,
      }).onConflictDoNothing();
      return;
    }

    // Store message linked to lead
    await db.insert(crmOpenPhoneMessages).values({
      leadId: lead.id,
      campaignId: lead.campaignId,
      openPhoneMessageId,
      direction: "incoming",
      fromNumber,
      toNumber,
      content,
      status: "received",
      createdAt,
    }).onConflictDoNothing();

    // Create notifications for all users in this campaign
    if (lead.campaignId) {
      const users = await db
        .select({ id: crmUsers.id })
        .from(crmUsers)
        .where(eq(crmUsers.campaignId, lead.campaignId));

      const notifications = users.map(u => ({
        userId: u.id,
        leadId: lead.id,
        type: "sms",
        content: `📱 New inbound text from ${fromNumber}: "${content.slice(0, 100)}${content.length > 100 ? "…" : ""}"`,
        read: false,
      }));

      if (notifications.length > 0) {
        await db.insert(crmNotifications).values(notifications);
      }
    }
  } catch (err) {
    logger.error(err, "[openphone webhook] handler error");
  }
});

export default router;
