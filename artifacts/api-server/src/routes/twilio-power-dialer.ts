/**
 * Power Dialer (P2-10)
 *
 * Agent clicks "Start Power Session" → system builds a lead list, stores the
 * session in crm_background_jobs, and auto-dials leads one by one.
 *
 * Flow:
 *   1. POST /twilio/voice/power-dial/session — create session, return first lead
 *   2. POST /twilio/voice/power-dial/session/:id/call — initiate click-to-call
 *      (Twilio calls agent first, bridges to lead when agent answers)
 *   3. POST /twilio/voice/power-dial/session/:id/disposition — log result, advance
 *   4. GET  /twilio/voice/power-dial/session/:id — poll state + current lead
 *   5. DELETE /twilio/voice/power-dial/session/:id — end session
 *
 * Session payload (stored in crm_background_jobs.payload as JSONB):
 *   { leadIds, currentIndex, agentPhone, callerIdPhone, campaignId, stats, dispositions }
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  crmLeads,
  crmCallLogs,
} from "@workspace/db/schema";
import { eq, and, inArray, asc } from "drizzle-orm";
import { crmAuth } from "./crm/middleware";
import { logger } from "../lib/logger";
import {
  createBackgroundJob,
  updateBackgroundJob,
  getBackgroundJob,
  cancelBackgroundJob,
} from "../lib/backgroundJobStore";
import { writeAuditLog } from "../lib/auditLog";
import { getSmsCreds } from "../services/twilioCredentials";
import twilio from "twilio";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

interface PowerDialStats {
  total: number;
  called: number;
  answered: number;
  voicemail: number;
  noAnswer: number;
  dnc: number;
  callback: number;
}

interface DispositionRecord {
  leadId: number;
  leadName: string;
  leadAddress: string;
  leadPhone: string;
  disposition: string;
  callSid: string | null;
  calledAt: string;
}

interface PowerDialPayload {
  leadIds: number[];
  currentIndex: number;
  agentPhone: string;
  callerIdPhone: string;
  campaignId: number;
  lines: number;
  stats: PowerDialStats;
  dispositions: DispositionRecord[];
  currentCallSid: string | null;
  currentBatchLeadIds: number[];
}


function formatSessionResponse(job: any, currentLead: any | null) {
  const p = job.payload as PowerDialPayload;
  return {
    sessionId: job.id,
    status: job.status,
    currentIndex: p.currentIndex,
    total: p.leadIds.length,
    lines: p.lines ?? 1,
    stats: p.stats,
    agentPhone: p.agentPhone,
    callerIdPhone: p.callerIdPhone,
    currentLead: currentLead
      ? {
          id: currentLead.id,
          sellerName: currentLead.sellerName,
          phone: currentLead.phone,
          address: currentLead.address,
          city: currentLead.city,
          state: currentLead.state,
          status: currentLead.status,
          howSoon: currentLead.howSoon,
          reasonForSelling: currentLead.reasonForSelling,
          askingPrice: currentLead.askingPrice,
          condition: currentLead.condition,
        }
      : null,
    dispositions: p.dispositions,
    currentCallSid: p.currentCallSid,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

// ── POST /twilio/voice/power-dial/session ─────────────────────────────────────
// Create a new power dial session. Builds the lead list from filters.

router.post("/twilio/voice/power-dial/session", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  const { agentPhone, callMode = "bridge", filters = {} } = req.body as {
    agentPhone?: string;
    callMode?: "browser" | "bridge";
    filters?: {
      status?: string | string[];
      assignedTo?: number;
    };
  };

  // agentPhone is only required for bridge (phone) mode — browser mode uses the SDK device
  if (callMode !== "browser" && !agentPhone) {
    res.status(400).json({ error: "agentPhone is required for Bridge mode — enter the number Twilio will call first" });
    return;
  }

  const campaignId = crmUser.campaignId;
  if (!campaignId) {
    res.status(400).json({ error: "You must be assigned to a campaign to use the Power Dialer" });
    return;
  }

  try {
    // Get caller ID from campaign Twilio config
    const creds = await getSmsCreds(campaignId);
    if (!creds?.phoneNumber) {
      res.status(422).json({ error: "Twilio phone number not configured for this campaign. Go to Integrations → Twilio." });
      return;
    }

    // Build lead list from filters
    const conditions = [eq(crmLeads.campaignId, campaignId)];

    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      conditions.push(inArray(crmLeads.status, statuses));
    } else {
      // Default: only leads with a phone that haven't been closed
      conditions.push(inArray(crmLeads.status, ["new", "contacted", "follow_up"]));
    }

    if (filters.assignedTo) {
      conditions.push(eq(crmLeads.assignedTo, filters.assignedTo));
    }

    const leads = await db
      .select({ id: crmLeads.id })
      .from(crmLeads)
      .where(and(...conditions))
      .orderBy(asc(crmLeads.createdAt))
      .limit(200);

    // Filter to leads with a phone number
    const leadIds = leads.map((l) => l.id);

    if (leadIds.length === 0) {
      res.status(404).json({ error: "No leads match the selected filters. Try adjusting status or assignment filters." });
      return;
    }

    const lines = Math.min(Math.max(1, Number(req.body.lines ?? 1)), 5);

    const payload: PowerDialPayload = {
      leadIds,
      currentIndex: 0,
      agentPhone,
      callerIdPhone: creds.phoneNumber,
      campaignId,
      lines,
      stats: {
        total: leadIds.length,
        called: 0,
        answered: 0,
        voicemail: 0,
        noAnswer: 0,
        dnc: 0,
        callback: 0,
      },
      dispositions: [],
      currentCallSid: null,
      currentBatchLeadIds: [],
    };

    const sessionId = await createBackgroundJob({
      type: "power_dial",
      campaignId,
      actorId: crmUser.userId,
      payload: payload as unknown as Record<string, unknown>,
      expiresInMs: 4 * 60 * 60 * 1000, // 4 hours
    });

    await updateBackgroundJob(sessionId, { status: "running" });

    // Load first lead details
    const [firstLead] = await db.select().from(crmLeads).where(eq(crmLeads.id, leadIds[0]!)).limit(1);

    logger.info({ sessionId, campaignId, totalLeads: leadIds.length }, "[powerDial] Session created");

    res.status(201).json(formatSessionResponse(
      { id: sessionId, status: "running", payload, createdAt: new Date(), updatedAt: new Date() },
      firstLead ?? null
    ));
  } catch (err: any) {
    logger.error(err, "[powerDial] session create error");
    res.status(500).json({ error: err.message });
  }
});

// ── GET /twilio/voice/power-dial/session/:id ──────────────────────────────────

router.get("/twilio/voice/power-dial/session/:id", crmAuth, async (req, res) => {
  try {
    const job = await getBackgroundJob(req.params.id as string);
    if (!job || job.type !== "power_dial") {
      res.status(404).json({ error: "Power dial session not found" }); return;
    }

    const crmUser = req.crmUser!;
    const p = job.payload as PowerDialPayload;
    if (p.campaignId !== crmUser.campaignId && crmUser.role !== "super_admin") {
      res.status(403).json({ error: "Access denied" }); return;
    }

    let currentLead = null;
    if (p.currentIndex < p.leadIds.length) {
      const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, p.leadIds[p.currentIndex]!)).limit(1);
      currentLead = lead ?? null;
    }

    res.json(formatSessionResponse(job, currentLead));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /twilio/voice/power-dial/session/:id/call ────────────────────────────
// Initiate click-to-call: Twilio calls agent first, then bridges to lead.

router.post("/twilio/voice/power-dial/session/:id/call", crmAuth, async (req, res) => {
  try {
    const job = await getBackgroundJob(req.params.id as string);
    if (!job || job.type !== "power_dial") {
      res.status(404).json({ error: "Session not found" }); return;
    }

    const p = job.payload as PowerDialPayload;
    if (p.currentIndex >= p.leadIds.length) {
      res.status(400).json({ error: "No more leads in this session" }); return;
    }

    const lines = p.lines ?? 1;

    // Collect up to `lines` consecutive leads starting at currentIndex
    const batchIds = p.leadIds.slice(p.currentIndex, p.currentIndex + lines);
    const batchLeads = await db.select().from(crmLeads)
      .where(inArray(crmLeads.id, batchIds));

    // Filter to only those with a phone number
    const dialableLeads = batchLeads.filter(l => !!l.phone);
    if (dialableLeads.length === 0) {
      res.status(422).json({ error: "No leads in this batch have a phone number — use Skip to advance" }); return;
    }

    const currentLead = batchLeads.find(l => l.id === batchIds[0]) ?? dialableLeads[0]!;

    const creds = await getSmsCreds(p.campaignId);
    if (!creds) {
      res.status(422).json({ error: "Twilio credentials not configured for this campaign" }); return;
    }

    const apiBase = process.env.API_BASE_URL || `https://${req.headers.host || "localhost"}/api`;
    const phones = dialableLeads.map(l => l.phone!).filter(Boolean);

    let twimlUrl: string;
    if (phones.length === 1) {
      twimlUrl = `${apiBase}/twilio/twiml/call?to=${encodeURIComponent(phones[0]!)}&callerId=${encodeURIComponent(p.callerIdPhone)}`;
    } else {
      twimlUrl = `${apiBase}/twilio/twiml/multi-call?numbers=${encodeURIComponent(phones.join(","))}&callerId=${encodeURIComponent(p.callerIdPhone)}`;
    }

    const client = twilio(creds.accountSid, creds.authToken);
    const call = await client.calls.create({
      from: p.callerIdPhone,
      to: p.agentPhone,
      url: twimlUrl,
      method: "GET",
    });

    // Track call SID and batch in session
    p.currentCallSid = call.sid;
    p.currentBatchLeadIds = dialableLeads.map(l => l.id);
    p.stats.called += dialableLeads.length;

    await updateBackgroundJob(job.id, { payload: p as unknown as Record<string, unknown> });

    // Log to call_logs for all leads in the batch
    for (const lead of dialableLeads) {
      await db.insert(crmCallLogs).values({
        callSid: lead.id === currentLead.id ? call.sid : `${call.sid}_batch_${lead.id}`,
        campaignId: p.campaignId,
        leadId: lead.id,
        direction: "outbound",
        status: "initiated",
        fromNumber: p.callerIdPhone,
        toNumber: lead.phone!,
        disposition: "power_dial",
      }).onConflictDoNothing();
    }

    logger.info({ sessionId: job.id, callSid: call.sid, batchSize: dialableLeads.length }, "[powerDial] Call initiated (multi-line)");

    res.json({
      callSid: call.sid,
      status: call.status,
      leadId: currentLead.id,
      leadPhone: currentLead.phone,
      agentPhone: p.agentPhone,
      batchSize: dialableLeads.length,
      lines,
    });
  } catch (err: any) {
    logger.error(err, "[powerDial] call initiate error");
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /twilio/voice/power-dial/session/:id/disposition ─────────────────────
// Log a call result and advance to the next lead.

router.post("/twilio/voice/power-dial/session/:id/disposition", crmAuth, async (req, res) => {
  const { disposition } = req.body as {
    disposition: "answered" | "no_answer" | "voicemail" | "dnc" | "callback" | "skip";
  };

  const VALID = ["answered", "no_answer", "voicemail", "dnc", "callback", "skip"];
  if (!VALID.includes(disposition)) {
    res.status(400).json({ error: `disposition must be one of: ${VALID.join(", ")}` }); return;
  }

  try {
    const job = await getBackgroundJob(req.params.id as string);
    if (!job || job.type !== "power_dial") {
      res.status(404).json({ error: "Session not found" }); return;
    }

    const p = job.payload as PowerDialPayload;
    if (p.currentIndex >= p.leadIds.length) {
      res.status(400).json({ error: "Session already complete" }); return;
    }

    const currentLeadId = p.leadIds[p.currentIndex]!;
    const [currentLead] = await db.select().from(crmLeads)
      .where(eq(crmLeads.id, currentLeadId)).limit(1);

    // Update stats
    if (disposition === "answered") p.stats.answered += 1;
    else if (disposition === "no_answer") p.stats.noAnswer += 1;
    else if (disposition === "voicemail") p.stats.voicemail += 1;
    else if (disposition === "dnc") p.stats.dnc += 1;
    else if (disposition === "callback") p.stats.callback += 1;

    // Record disposition
    if (disposition !== "skip") {
      p.dispositions.push({
        leadId: currentLeadId,
        leadName: currentLead?.sellerName ?? "Unknown",
        leadAddress: currentLead?.address ?? "",
        leadPhone: currentLead?.phone ?? "",
        disposition,
        callSid: p.currentCallSid,
        calledAt: new Date().toISOString(),
      });

      // Update call log with disposition
      if (p.currentCallSid) {
        await db.update(crmCallLogs)
          .set({ disposition, status: "completed", updatedAt: new Date() })
          .where(eq(crmCallLogs.callSid, p.currentCallSid));
      }

      // Write audit log
      await writeAuditLog({
        tableName: "crm_leads",
        rowId: currentLeadId,
        actorId: req.crmUser!.userId,
        actorName: req.crmUser!.email,
        action: "update",
        field: "power_dial_disposition",
        newValue: disposition,
        metadata: { sessionId: job.id, callSid: p.currentCallSid },
      });

      // If DNC, update lead status to dnc
      if (disposition === "dnc" && currentLead) {
        await db.update(crmLeads)
          .set({ status: "dnc", updatedAt: new Date() })
          .where(eq(crmLeads.id, currentLeadId));
      }
    }

    // Advance by the batch size (or 1 if no batch was tracked)
    const advance = Math.max(1, p.currentBatchLeadIds?.length ?? 1);
    p.currentIndex += advance;
    p.currentCallSid = null;
    p.currentBatchLeadIds = [];

    const isDone = p.currentIndex >= p.leadIds.length;
    if (isDone) {
      await updateBackgroundJob(job.id, {
        status: "done",
        payload: p as unknown as Record<string, unknown>,
        result: { stats: p.stats } as Record<string, unknown>,
        progress: 100,
      });
    } else {
      const progress = Math.round((p.currentIndex / p.leadIds.length) * 100);
      await updateBackgroundJob(job.id, {
        payload: p as unknown as Record<string, unknown>,
        progress,
      });
    }

    // Load next lead
    let nextLead = null;
    if (!isDone) {
      const [lead] = await db.select().from(crmLeads)
        .where(eq(crmLeads.id, p.leadIds[p.currentIndex]!)).limit(1);
      nextLead = lead ?? null;
    }

    logger.info({ sessionId: job.id, disposition, currentIndex: p.currentIndex, total: p.leadIds.length }, "[powerDial] Disposition logged");

    res.json({
      ...formatSessionResponse({ ...job, payload: p }, nextLead),
      done: isDone,
    });
  } catch (err: any) {
    logger.error(err, "[powerDial] disposition error");
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /twilio/voice/power-dial/session/:id ───────────────────────────────

router.delete("/twilio/voice/power-dial/session/:id", crmAuth, async (req, res) => {
  try {
    const job = await getBackgroundJob(req.params.id as string);
    if (!job || job.type !== "power_dial") {
      res.status(404).json({ error: "Session not found" }); return;
    }
    await cancelBackgroundJob(job.id);
    logger.info({ sessionId: job.id }, "[powerDial] Session cancelled");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
