import { Router, type IRouter } from "express";
import { crmAuth } from "./crm/middleware";
import { db } from "@workspace/db";
import { crmOpenPhoneMessages, crmLeads, crmUsers, crmNotifications } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { toE164 } from "../services/coreCalculations";

const router: IRouter = Router();

function swConfig() {
  const projectId = process.env.SIGNALWIRE_PROJECT_ID;
  const token = process.env.SIGNALWIRE_API_TOKEN;
  const space = process.env.SIGNALWIRE_SPACE_URL;
  if (!projectId || !token || !space) throw new Error("SignalWire credentials not configured");
  const auth = Buffer.from(`${projectId}:${token}`).toString("base64");
  const baseUrl = `https://${space}/api/laml/2010-04-01/Accounts/${projectId}`;
  return { auth, baseUrl, projectId, space };
}

async function swFetch(path: string, options: RequestInit = {}) {
  const { auth, baseUrl } = swConfig();
  const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw Object.assign(new Error(json?.message || "SignalWire error"), { status: res.status, body: json });
  return json;
}

// ── GET /api/signalwire/phone-numbers ────────────────────────────────────────
router.get("/signalwire/phone-numbers", crmAuth, async (_req, res) => {
  try {
    const data = await swFetch("/IncomingPhoneNumbers.json");
    const numbers = (data.incoming_phone_numbers || []).map((n: any) => ({
      id: n.phone_number,   // E.164 number used directly as From in SMS/Calls
      sid: n.sid,
      number: n.phone_number,
      name: n.friendly_name || n.phone_number,
    }));
    res.json({ phoneNumbers: numbers });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /api/signalwire/messages ──────────────────────────────────────────────
// Fetch conversation history from SignalWire (Twilio-compatible API)
router.get("/signalwire/messages", crmAuth, async (req, res) => {
  const { phoneNumberId, contactPhone } = req.query as Record<string, string>;
  if (!phoneNumberId || !contactPhone) {
    res.status(400).json({ error: "phoneNumberId and contactPhone are required" });
    return;
  }
  try {
    const e164 = toE164(contactPhone);
    const params = new URLSearchParams({ PageSize: "50" });
    // Fetch sent + received messages
    const [sent, recv] = await Promise.all([
      swFetch(`/Messages.json?From=${encodeURIComponent(phoneNumberId)}&To=${encodeURIComponent(e164)}&${params}`).catch(() => ({ messages: [] })),
      swFetch(`/Messages.json?From=${encodeURIComponent(e164)}&To=${encodeURIComponent(phoneNumberId)}&${params}`).catch(() => ({ messages: [] })),
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

// ── GET /api/signalwire/lead-messages/:leadId ────────────────────────────────
// Locally stored messages for a lead
router.get("/signalwire/lead-messages/:leadId", crmAuth, async (req, res) => {
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

// ── POST /api/signalwire/messages ─────────────────────────────────────────────
// Send an SMS via SignalWire and store locally
router.post("/signalwire/messages", crmAuth, async (req, res) => {
  const { phoneNumberId, to, content, leadId, campaignId } = req.body;
  if (!phoneNumberId || !to || !content) {
    res.status(400).json({ error: "phoneNumberId, to, and content are required" });
    return;
  }
  try {
    const body = new URLSearchParams({
      From: phoneNumberId,
      To: toE164(to),
      Body: content,
    });
    const data = await swFetch("/Messages.json", {
      method: "POST",
      body: body.toString(),
    });
    // Store outbound message locally
    if (data.sid) {
      await db.insert(crmOpenPhoneMessages).values({
        leadId: leadId ? Number(leadId) : null,
        campaignId: campaignId ? Number(campaignId) : null,
        openPhoneMessageId: data.sid,
        direction: "outgoing",
        fromNumber: phoneNumberId,
        toNumber: toE164(to),
        content,
        status: data.status || "sent",
      }).onConflictDoNothing();
    }
    res.json({ message: data });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /api/signalwire/calls ─────────────────────────────────────────────────
router.get("/signalwire/calls", crmAuth, async (req, res) => {
  const { phoneNumberId, contactPhone } = req.query as Record<string, string>;
  if (!phoneNumberId || !contactPhone) {
    res.status(400).json({ error: "phoneNumberId and contactPhone are required" });
    return;
  }
  try {
    const e164 = toE164(contactPhone);
    const [outCalls, inCalls] = await Promise.all([
      swFetch(`/Calls.json?From=${encodeURIComponent(phoneNumberId)}&To=${encodeURIComponent(e164)}&PageSize=20`).catch(() => ({ calls: [] })),
      swFetch(`/Calls.json?From=${encodeURIComponent(e164)}&To=${encodeURIComponent(phoneNumberId)}&PageSize=20`).catch(() => ({ calls: [] })),
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

// ── GET /api/signalwire/twiml/call ───────────────────────────────────────────
// Public TwiML callback: SignalWire calls this when the agent picks up their phone.
// It then dials the lead to connect both parties.
router.get("/signalwire/twiml/call", (req, res) => {
  const to = (req.query.to as string) || "";
  const callerId = (req.query.callerId as string) || "+18889145690";
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

// ── POST /api/signalwire/click-to-call ───────────────────────────────────────
// Auth required. Calls the agent's phone first, then connects them to the lead.
// Body: { fromNumber, agentPhone, leadPhone }
router.post("/signalwire/click-to-call", crmAuth, async (req, res) => {
  const { fromNumber, agentPhone, leadPhone } = req.body;
  if (!fromNumber || !agentPhone || !leadPhone) {
    res.status(400).json({ error: "fromNumber, agentPhone, and leadPhone are required" });
    return;
  }

  const leadE164 = toE164(leadPhone);
  const agentE164 = toE164(agentPhone);

  // TwiML URL: when agent picks up, connect them to the lead
  const baseUrl = process.env.SIGNALWIRE_WEBHOOK_URL?.replace("/webhook", "") || "https://tolipai.com/api/signalwire";
  const twimlUrl = `${baseUrl}/twiml/call?to=${encodeURIComponent(leadE164)}&callerId=${encodeURIComponent(fromNumber)}`;

  try {
    const body = new URLSearchParams({
      From: fromNumber,
      To: agentE164,
      Url: twimlUrl,
      Method: "GET",
    });
    const data = await swFetch("/Calls.json", { method: "POST", body: body.toString() });
    res.json({ success: true, callSid: data.sid, status: data.status, leadPhone: leadE164, agentPhone: agentE164 });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /api/signalwire/setup-webhooks ───────────────────────────────────────
// Admin: auto-configure SMS webhook for all purchased phone numbers
router.post("/signalwire/setup-webhooks", crmAuth, async (req, res) => {
  try {
    const webhookUrl = process.env.SIGNALWIRE_WEBHOOK_URL || "https://tolipai.com/api/signalwire/webhook";
    const data = await swFetch("/IncomingPhoneNumbers.json");
    const numbers: any[] = data.incoming_phone_numbers || [];

    const results = await Promise.all(
      numbers.map(async (n: any) => {
        try {
          const body = new URLSearchParams({
            SmsUrl: webhookUrl,
            SmsMethod: "POST",
          });
          await swFetch(`/IncomingPhoneNumbers/${n.sid}.json`, {
            method: "POST",
            body: body.toString(),
            headers: { "X-HTTP-Method-Override": "PUT" },
          });
          return { number: n.phone_number, sid: n.sid, status: "configured", webhook: webhookUrl };
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

// ── POST /api/signalwire/webhook ──────────────────────────────────────────────
// Receive inbound SMS from SignalWire — no auth (public webhook)
// Register in SignalWire: Phone Number → Messaging → Webhook URL → https://yourdomain/api/signalwire/webhook
router.post("/signalwire/webhook", async (req, res) => {
  // Acknowledge immediately with empty TwiML
  res.set("Content-Type", "text/xml").send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>");

  try {
    const fromNumber = req.body?.From;
    const toNumber = req.body?.To;
    const content = req.body?.Body || "";
    const sid = req.body?.MessageSid;

    if (!fromNumber) return;

    const normalize = (p: string) => p.replace(/\D/g, "");
    const normFrom = normalize(fromNumber);

    const allLeads = await db
      .select({ id: crmLeads.id, phone: crmLeads.phone, campaignId: crmLeads.campaignId })
      .from(crmLeads)
      .limit(1000);

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
      const users = await db
        .select({ id: crmUsers.id })
        .from(crmUsers)
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
    }
  } catch (err) {
    console.error("[signalwire webhook]", err);
  }
});

export default router;
