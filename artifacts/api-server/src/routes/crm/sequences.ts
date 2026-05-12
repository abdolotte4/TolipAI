import { Router } from "express";
import { db } from "@workspace/db";
import { crmEmailSequences, crmSequenceSteps, crmSequenceLogs, crmLeads, crmUsers, crmSmsOptOuts, crmSmsConversations, crmCampaigns } from "@workspace/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { crmAuth, crmAdminOnly } from "./middleware";
import { logger } from "../../lib/logger";
import { sendSms } from "../../services/smsService";
import { sendDirectMail, extractAddressForDirectMail } from "../../services/directMailService";
import { generateAiSmsReply, AI_SMS_COST_USD } from "../../services/aiSmsService";

const router = Router();

// ─── Async semaphore — limits concurrent email sends to avoid SMTP throttling ──
function makeSemaphore(concurrency: number) {
  let running = 0;
  const queue: Array<() => void> = [];
  return async function<T>(fn: () => Promise<T>): Promise<T> {
    if (running >= concurrency) {
      await new Promise<void>(resolve => queue.push(resolve));
    }
    running++;
    try {
      return await fn();
    } finally {
      running--;
      queue.shift()?.();
    }
  };
}
const emailSemaphore = makeSemaphore(5);

// GET /crm/sequences - list sequences for campaign
router.get("/", crmAuth, async (req, res) => {
  try {
    const user = req.crmUser!;
    const sequences = await db
      .select()
      .from(crmEmailSequences)
      .where(user.campaignId ? eq(crmEmailSequences.campaignId, user.campaignId) : undefined)
      .orderBy(desc(crmEmailSequences.createdAt));

    const withSteps = await Promise.all(sequences.map(async (seq) => {
      const steps = await db
        .select()
        .from(crmSequenceSteps)
        .where(eq(crmSequenceSteps.sequenceId, seq.id))
        .orderBy(crmSequenceSteps.dayOffset);
      return { ...seq, steps };
    }));

    res.json(withSteps);
  } catch (err) {
    logger.error(err, "List sequences error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /crm/sequences - create sequence
router.post("/", crmAuth, crmAdminOnly, async (req, res) => {
  try {
    const user = req.crmUser!;
    const { name, description, isActive } = req.body;
    if (!name) { res.status(400).json({ error: "Name is required" }); return; }

    const [seq] = await db.insert(crmEmailSequences).values({
      campaignId: user.campaignId || null,
      name,
      description: description || null,
      isActive: isActive !== false,
    }).returning();

    res.status(201).json({ ...seq, steps: [] });
  } catch (err) {
    logger.error(err, "Create sequence error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /crm/sequences/:id - update sequence
router.patch("/:id", crmAuth, crmAdminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params["id"] as string);
    const user = req.crmUser!;
    const { name, description, isActive } = req.body;

    const [existing] = await db.select().from(crmEmailSequences).where(eq(crmEmailSequences.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Sequence not found" }); return; }
    if (user.campaignId && existing.campaignId !== user.campaignId) { res.status(403).json({ error: "Forbidden" }); return; }

    const updates: any = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (isActive !== undefined) updates.isActive = isActive;

    const [seq] = await db.update(crmEmailSequences).set(updates).where(eq(crmEmailSequences.id, id)).returning();
    const steps = await db.select().from(crmSequenceSteps).where(eq(crmSequenceSteps.sequenceId, id)).orderBy(crmSequenceSteps.dayOffset);
    res.json({ ...seq, steps });
  } catch (err) {
    logger.error(err, "Update sequence error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /crm/sequences/:id
router.delete("/:id", crmAuth, crmAdminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params["id"] as string);
    const user = req.crmUser!;
    const [existing] = await db.select().from(crmEmailSequences).where(eq(crmEmailSequences.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Sequence not found" }); return; }
    if (user.campaignId && existing.campaignId !== user.campaignId) { res.status(403).json({ error: "Forbidden" }); return; }
    await db.delete(crmEmailSequences).where(eq(crmEmailSequences.id, id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /crm/sequences/:id/steps - add step
router.post("/:id/steps", crmAuth, crmAdminOnly, async (req, res) => {
  try {
    const sequenceId = parseInt(req.params["id"] as string);
    const { dayOffset, subject, body, type } = req.body;
    const stepType = type || "email";
    if (!body) { res.status(400).json({ error: "Body is required" }); return; }
    if (stepType === "email" && !subject) { res.status(400).json({ error: "Subject is required for email steps" }); return; }
    const [step] = await db.insert(crmSequenceSteps).values({
      sequenceId,
      dayOffset: dayOffset !== undefined ? parseInt(dayOffset) : 0,
      type: stepType,
      subject: subject || "",
      body,
    }).returning();
    res.status(201).json(step);
  } catch (err) {
    logger.error(err, "Create step error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /crm/sequences/:id/steps/:stepId - update step
router.patch("/:id/steps/:stepId", crmAuth, crmAdminOnly, async (req, res) => {
  try {
    const stepId = parseInt(req.params["stepId"] as string);
    const { dayOffset, subject, body, type } = req.body;
    const updates: any = {};
    if (dayOffset !== undefined) updates.dayOffset = parseInt(dayOffset);
    if (subject !== undefined) updates.subject = subject;
    if (body !== undefined) updates.body = body;
    if (type !== undefined) updates.type = type;
    const [step] = await db.update(crmSequenceSteps).set(updates).where(eq(crmSequenceSteps.id, stepId)).returning();
    if (!step) { res.status(404).json({ error: "Step not found" }); return; }
    res.json(step);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /crm/sequences/:id/steps/:stepId
router.delete("/:id/steps/:stepId", crmAuth, crmAdminOnly, async (req, res) => {
  try {
    const stepId = parseInt(req.params["stepId"] as string);
    await db.delete(crmSequenceSteps).where(eq(crmSequenceSteps.id, stepId));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /crm/sequences/logs/:leadId - get sequence logs for a lead
router.get("/logs/:leadId", crmAuth, async (req, res) => {
  try {
    const user = req.crmUser!;
    const leadId = parseInt(req.params["leadId"] as string);

    // Verify the lead belongs to the caller's campaign (non-super-admins only)
    if (user.role !== "super_admin" && user.campaignId) {
      const [lead] = await db.select({ campaignId: crmLeads.campaignId }).from(crmLeads).where(eq(crmLeads.id, leadId)).limit(1);
      if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
      if (lead.campaignId !== user.campaignId) { res.status(403).json({ error: "Forbidden" }); return; }
    }

    const logs = await db
      .select({ log: crmSequenceLogs, step: crmSequenceSteps })
      .from(crmSequenceLogs)
      .leftJoin(crmSequenceSteps, eq(crmSequenceLogs.stepId, crmSequenceSteps.id))
      .where(eq(crmSequenceLogs.leadId, leadId))
      .orderBy(desc(crmSequenceLogs.sentAt));
    res.json(logs.map(r => ({
      ...r.log,
      subject: r.step?.subject,
      stepType: r.step?.type || r.log.type,
    })));
  } catch (err) {
    logger.error({ err }, "Sequence logs fetch error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /crm/sms-opt-out — opt a phone out of SMS for a campaign
router.post("/sms-opt-out", crmAuth, async (req, res) => {
  try {
    const { phone, campaignId: reqCampaignId } = req.body;
    if (!phone) { res.status(400).json({ error: "phone is required" }); return; }
    const campaignId = reqCampaignId ? parseInt(reqCampaignId) : req.crmUser!.campaignId;
    await db.insert(crmSmsOptOuts).values({
      phone: phone.trim(),
      campaignId: campaignId ?? null,
    }).onConflictDoNothing();
    res.json({ success: true, phone, campaignId });
  } catch (err) {
    logger.error(err, "SMS opt-out error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /crm/sms-opt-out/:campaignId — get opt-out list for a campaign
router.get("/sms-opt-out/:campaignId", crmAuth, async (req, res) => {
  try {
    const campaignId = parseInt(req.params["campaignId"] as string);
    const user = req.crmUser!;
    if (user.role !== "super_admin" && user.campaignId !== campaignId) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const optOuts = await db
      .select()
      .from(crmSmsOptOuts)
      .where(eq(crmSmsOptOuts.campaignId, campaignId))
      .orderBy(desc(crmSmsOptOuts.optedOutAt));
    res.json(optOuts);
  } catch (err) {
    logger.error(err, "SMS opt-out list error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

// ─── Brevo send with retry + exponential back-off on 429 ─────────────────────
async function brevoSendWithRetry(payload: object): Promise<void> {
  const maxAttempts = 3;
  let delayMs = 1_000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY || "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok) return;
    if (r.status === 429 && attempt < maxAttempts) {
      await new Promise<void>(res => setTimeout(res, delayMs));
      delayMs *= 2;
      continue;
    }
    throw new Error(await r.text().catch(() => `HTTP ${r.status}`));
  }
}

// ─── Background sequence job ──────────────────────────────────────────────────
let lastEmailJobRun = 0;

export async function runEmailSequenceJob() {
  const now = Date.now();
  if (now - lastEmailJobRun < 60 * 60 * 1000) return;

  const lockResult = await db.execute(sql`SELECT pg_try_advisory_lock(44332211) AS locked`);
  const locked = (lockResult.rows[0] as any)?.locked ?? false;
  if (!locked) {
    logger.info("[emailJob] Another instance holds the lock — skipping this run");
    return;
  }

  lastEmailJobRun = now;

  try {
    const activeSequences = await db
      .select()
      .from(crmEmailSequences)
      .where(eq(crmEmailSequences.isActive, true));

    if (!activeSequences.length) return;

    for (const seq of activeSequences) {
      const steps = await db
        .select()
        .from(crmSequenceSteps)
        .where(eq(crmSequenceSteps.sequenceId, seq.id))
        .orderBy(crmSequenceSteps.dayOffset);

      if (!steps.length) continue;

      const PAGE = 200;
      let offset = 0;
      while (true) {
        const leads = await db
          .select()
          .from(crmLeads)
          .where(seq.campaignId ? and(eq(crmLeads.campaignId, seq.campaignId)) : undefined)
          .limit(PAGE)
          .offset(offset);

        if (leads.length === 0) break;
        offset += PAGE;

        for (const lead of leads) {
          if (lead.status === "dead" || lead.status === "closed") continue;

          const leadCreatedAt = lead.createdAt.getTime();
          const daysSinceCreation = Math.floor((now - leadCreatedAt) / (1000 * 60 * 60 * 24));

          for (const step of steps) {
            if (step.dayOffset !== daysSinceCreation) continue;

            // Check if already sent
            const [existingLog] = await db
              .select()
              .from(crmSequenceLogs)
              .where(and(
                eq(crmSequenceLogs.leadId, lead.id),
                eq(crmSequenceLogs.stepId, step.id)
              ))
              .limit(1);

            if (existingLog) continue;

            const stepType = step.type || "email";

            // Replace template variables in body
            const interpolate = (template: string) => template
              .replace(/\{\{name\}\}/g, lead.sellerName)
              .replace(/\{\{address\}\}/g, lead.address || "")
              .replace(/\{\{city\}\}/g, lead.city || "")
              .replace(/\{\{state\}\}/g, lead.state || "");

            let status = "sent";
            let errorMessage: string | null = null;

            if (stepType === "email") {
              if (!lead.email) continue;

              const subject = interpolate(step.subject);
              const body = interpolate(step.body);

              let replyToEmail = process.env.BREVO_SENDER_EMAIL || "";
              if (seq.campaignId) {
                const [campaignAdmin] = await db
                  .select()
                  .from(crmUsers)
                  .where(and(eq(crmUsers.campaignId, seq.campaignId), eq(crmUsers.role, "admin")))
                  .limit(1);
                if (campaignAdmin?.email) replyToEmail = campaignAdmin.email;
              }

              try {
                await emailSemaphore(() => brevoSendWithRetry({
                  sender: { name: "TolipAI CRM", email: process.env.BREVO_SENDER_EMAIL },
                  to: [{ email: lead.email!, name: lead.sellerName }],
                  replyTo: { email: replyToEmail },
                  subject,
                  textContent: body,
                  htmlContent: body.replace(/\n/g, "<br>"),
                }));
              } catch (err: any) {
                status = "failed";
                errorMessage = err?.message || "Unknown error";
                logger.error(`Email sequence send failed for lead ${lead.id}:`, err);
              }

            } else if (stepType === "sms") {
              if (!lead.phone) continue;
              if (!seq.campaignId) continue;

              const smsBody = interpolate(step.body);
              const result = await sendSms({
                to: lead.phone,
                body: smsBody,
                campaignId: seq.campaignId,
              });
              status = result.status === "sent" ? "sent" : result.status;
              errorMessage = result.errorMessage;

            } else if (stepType === "ai_sms") {
              if (!lead.phone) continue;
              if (!seq.campaignId) continue;

              const [campaign] = await db
                .select({ aiSmsPersonality: crmCampaigns.aiSmsPersonality })
                .from(crmCampaigns)
                .where(eq(crmCampaigns.id, seq.campaignId))
                .limit(1);

              const history = await db
                .select({ direction: crmSmsConversations.direction, body: crmSmsConversations.body, createdAt: crmSmsConversations.createdAt })
                .from(crmSmsConversations)
                .where(eq(crmSmsConversations.leadId, lead.id))
                .orderBy(desc(crmSmsConversations.createdAt))
                .limit(10);

              const aiReply = await generateAiSmsReply({
                lead: {
                  sellerName: lead.sellerName,
                  address: lead.address,
                  city: lead.city,
                  state: lead.state,
                  askingPrice: lead.askingPrice,
                  arv: lead.arv,
                },
                inboundMessage: "",
                conversationHistory: history.reverse(),
                personality: campaign?.aiSmsPersonality || "professional_investor",
                promptOverride: step.body || null,
              });

              const smsResult = await sendSms({
                to: lead.phone,
                body: aiReply,
                campaignId: seq.campaignId,
              });
              status = smsResult.status === "sent" ? "sent" : smsResult.status;
              errorMessage = smsResult.errorMessage;

              if (smsResult.status === "sent" && smsResult.sid) {
                await db.insert(crmSmsConversations).values({
                  leadId: lead.id,
                  campaignId: seq.campaignId,
                  direction: "outbound",
                  body: aiReply,
                  aiGenerated: true,
                  twilioSid: smsResult.sid ?? null,
                  aiModel: process.env.AI_SMS_MODEL || process.env.AI_MODEL || "openai/gpt-4o-mini",
                  aiCostUsd: AI_SMS_COST_USD.toString(),
                }).catch(e => logger.error(e, "Failed to log ai_sms to crmSmsConversations"));
              }

            } else if (stepType === "direct_mail") {
              if (!seq.campaignId) continue;

              const address = extractAddressForDirectMail(lead);
              if (!address) {
                status = "failed";
                errorMessage = "Lead missing address fields for direct mail";
              } else {
                const templateId = parseInt(step.subject) || 0; // subject holds templateId for direct_mail
                const mergeFields: Record<string, string> = {
                  NAME: interpolate("{{name}}"),
                  ADDRESS: lead.address || "",
                  CITY: lead.city || "",
                  STATE: lead.state || "",
                };
                const result = await sendDirectMail({
                  to: address,
                  templateId,
                  mergeFields,
                  campaignId: seq.campaignId,
                });
                status = result.status;
                errorMessage = result.errorMessage;
              }
            }

            await db.insert(crmSequenceLogs).values({
              leadId: lead.id,
              sequenceId: seq.id,
              stepId: step.id,
              type: stepType,
              status,
              errorMessage,
            });
          }
        }

        if (leads.length < PAGE) break;
      }
    }
  } catch (err) {
    logger.error(err, "Email sequence job error");
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(44332211)`).catch(() => {});
  }
}
