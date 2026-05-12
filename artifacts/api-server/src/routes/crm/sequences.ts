import { Router } from "express";
import { db } from "@workspace/db";
import { crmEmailSequences, crmSequenceSteps, crmSequenceLogs, crmLeads, crmUsers } from "@workspace/db/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { crmAuth, crmAdminOnly } from "./middleware";
import { logger } from "../../lib/logger";

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
    const { dayOffset, subject, body } = req.body;
    if (!subject || !body) { res.status(400).json({ error: "Subject and body are required" }); return; }
    const [step] = await db.insert(crmSequenceSteps).values({
      sequenceId,
      dayOffset: dayOffset !== undefined ? parseInt(dayOffset) : 0,
      subject,
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
    const { dayOffset, subject, body } = req.body;
    const updates: any = {};
    if (dayOffset !== undefined) updates.dayOffset = parseInt(dayOffset);
    if (subject !== undefined) updates.subject = subject;
    if (body !== undefined) updates.body = body;
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

// GET /crm/sequences/logs/:leadId - get email log for a lead
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
    res.json(logs.map(r => ({ ...r.log, subject: r.step?.subject })));
  } catch (err) {
    logger.error({ err }, "Sequence logs fetch error");
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

// ─── Background email job ─────────────────────────────────────────────────────
// Module-level guard: fast-path skip within the same process (single instance).
// The Postgres advisory lock below is the true multi-instance gate.
let lastEmailJobRun = 0;

export async function runEmailSequenceJob() {
  const now = Date.now();
  if (now - lastEmailJobRun < 60 * 60 * 1000) return; // same-process fast-path

  // Acquire Postgres advisory lock so only one Fargate task runs at a time
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

      // Batch leads in pages of 200 to avoid loading entire table into memory
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

        const emailLeads = leads.filter(l => l.email && l.status !== "dead" && l.status !== "closed");

        for (const lead of emailLeads) {
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

            // Replace template variables
            const subject = step.subject
              .replace(/\{\{name\}\}/g, lead.sellerName)
              .replace(/\{\{address\}\}/g, lead.address || "");
            const body = step.body
              .replace(/\{\{name\}\}/g, lead.sellerName)
              .replace(/\{\{address\}\}/g, lead.address || "");

            // Find campaign admin email for Reply-To
            let replyToEmail = process.env.BREVO_SENDER_EMAIL || "";
            if (seq.campaignId) {
              const [campaignAdmin] = await db
                .select()
                .from(crmUsers)
                .where(and(eq(crmUsers.campaignId, seq.campaignId), eq(crmUsers.role, "admin")))
                .limit(1);
              if (campaignAdmin?.email) replyToEmail = campaignAdmin.email;
            }

            // Send with retry + back-off — semaphore limits to 5 concurrent sends
            let status = "sent";
            let errorMessage: string | null = null;
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

            // Log it
            await db.insert(crmSequenceLogs).values({
              leadId: lead.id,
              sequenceId: seq.id,
              stepId: step.id,
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
