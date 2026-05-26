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
  crmCampaigns,
  crmBackgroundJobs,
} from "@workspace/db/schema";
import { eq, and, inArray, asc, sql } from "drizzle-orm";
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
import { emitCrmActivity } from "./sse";
import twilio from "twilio";
import { getWebhookBase } from "../lib/webhookBase";
import { twilioWebhookMiddleware } from "../lib/twilioWebhookMiddleware";

const router: IRouter = Router();

// ── Twilio Signature Validation Middleware ──
const twilioAuth = twilioWebhookMiddleware();

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
  activeCalls: Record<string, number>;
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
  const { agentPhone, callMode = "bridge", filters = {}, fromPhoneNumber } = req.body as {
    agentPhone?: string;
    callMode?: "browser" | "bridge";
    fromPhoneNumber?: string;
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

  const isSuperAdmin = crmUser.role === "super_admin";
  let campaignId: number = crmUser.campaignId as number;
  if (!campaignId) {
    if (!isSuperAdmin) {
      res.status(400).json({ error: "You must be assigned to a campaign to use the Power Dialer" });
      return;
    }
    // Super admin: use campaignId from request body or fall back to first Twilio-enabled campaign
    const requestedId = req.body?.campaignId ? Number(req.body.campaignId) : null;
    if (requestedId) {
      campaignId = requestedId;
    } else {
      const [firstCamp] = await db
        .select({ id: crmCampaigns.id })
        .from(crmCampaigns)
        .where(eq(crmCampaigns.twilioEnabled, true))
        .limit(1);
      if (!firstCamp) {
        res.status(422).json({ error: "No Twilio-enabled campaigns found. Configure Twilio credentials in a campaign first." });
        return;
      }
      campaignId = firstCamp.id;
    }
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
      agentPhone: agentPhone ?? "",
      callerIdPhone: fromPhoneNumber || creds.phoneNumber,
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
// Parallel predictive dial: fires outbound calls directly to each lead's phone
// with AMD enabled. The AMD handler bridges a human answer to the agent and
// cancels all other lines in the batch. Row-level locking prevents double-dial.

router.post("/twilio/voice/power-dial/session/:id/call", crmAuth, async (req, res) => {
  try {
    const sessionId = req.params.id as string;

    const job = await getBackgroundJob(sessionId);
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

    const creds = await getSmsCreds(p.campaignId);
    if (!creds) {
      res.status(422).json({ error: "Twilio credentials not configured for this campaign" }); return;
    }

    const apiBase = getWebhookBase(req);
    const client = twilio(creds.accountSid, creds.authToken);

    // ── Parallel predictive dial — call each lead directly with AMD ────────
    // machineDetection fires the amd-handler webhook per call.
    // On human answer: AMD handler bridges to agent and cancels sister lines.
    const callResults = await Promise.all(
      dialableLeads.map(lead =>
        client.calls.create({
          from: p.callerIdPhone,
          to: lead.phone!,
          url: `${apiBase}/twilio/voice/power-dial/amd-handler?sessionId=${encodeURIComponent(sessionId)}&leadId=${lead.id}&agentPhone=${encodeURIComponent(p.agentPhone)}`,
          method: "POST",
          machineDetection: "Enable",
          machineDetectionTimeout: 30,
          statusCallback: `${apiBase}/twilio/voice/power-dial/call-status?sessionId=${encodeURIComponent(sessionId)}`,
          statusCallbackMethod: "POST",
          statusCallbackEvent: ["completed"],
        }).catch(err => {
          logger.warn({ leadId: lead.id, err: err.message }, "[powerDial] call creation failed for lead");
          return null;
        })
      )
    );

    const successCalls = callResults.filter(Boolean) as Awaited<ReturnType<typeof client.calls.create>>[];
    if (successCalls.length === 0) {
      res.status(422).json({ error: "All call creation attempts failed — check Twilio credentials and lead phone numbers" }); return;
    }

    // ── Update session with activeCalls map under row-level lock ───────────
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: crmBackgroundJobs.id, payload: crmBackgroundJobs.payload })
        .from(crmBackgroundJobs)
        .where(eq(crmBackgroundJobs.id, sessionId))
        .for("update")
        .limit(1);
      if (!locked) return;

      const lp = (locked.payload ?? {}) as PowerDialPayload;
      lp.activeCalls = lp.activeCalls ?? {};
      for (let i = 0; i < successCalls.length; i++) {
        const call = successCalls[i]!;
        const lead = dialableLeads[i]!;
        lp.activeCalls[call.sid] = lead.id;
      }
      lp.currentCallSid = successCalls[0]!.sid;
      lp.currentBatchLeadIds = dialableLeads.map(l => l.id);
      lp.stats.called += successCalls.length;

      await tx.update(crmBackgroundJobs)
        .set({ payload: lp as unknown as any, updatedAt: new Date() })
        .where(eq(crmBackgroundJobs.id, sessionId));
    });

    // ── Log all initiated calls — single batch INSERT (PERF-06) ──────────────
    if (successCalls.length > 0) {
      await db.insert(crmCallLogs).values(
        successCalls.map((call, i) => ({
          callSid: call.sid,
          campaignId: p.campaignId,
          leadId: dialableLeads[i]!.id,
          direction: "outbound" as const,
          status: "initiated",
          fromNumber: p.callerIdPhone,
          toNumber: dialableLeads[i]!.phone!,
          disposition: "power_dial",
        }))
      ).onConflictDoNothing();
    }

    logger.info({ sessionId, batchSize: successCalls.length, lines }, "[powerDial] Parallel AMD calls initiated");

    res.json({
      callSid: successCalls[0]!.sid,
      status: successCalls[0]!.status,
      leadId: dialableLeads[0]!.id,
      leadPhone: dialableLeads[0]!.phone,
      agentPhone: p.agentPhone,
      batchSize: successCalls.length,
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

// ── POST /twilio/voice/power-dial/call-status ──────────────────────────────────
// Public Twilio status-callback webhook. Fires when a power-dial bridge call
// reaches "completed". Infers disposition from call duration and auto-advances
// the session so the agent doesn't have to click a button after every call.
// Query param: ?sessionId=<job-id>

router.post("/twilio/voice/power-dial/call-status", twilioAuth, async (req, res) => {
  // Respond immediately — Twilio expects a fast 2xx
  res.status(204).end();

  try {
    const sessionId = (req.query.sessionId as string | undefined) || "";
    const callStatus = (req.body?.CallStatus as string | undefined) || "";
    const callDuration = parseInt((req.body?.CallDuration as string | undefined) || "0", 10) || 0;
    const callSid = (req.body?.CallSid as string | undefined) || "";

    if (!sessionId || callStatus !== "completed") return;

    const job = await getBackgroundJob(sessionId);
    if (!job || job.type !== "power_dial" || job.status !== "running") return;

    const p = job.payload as PowerDialPayload;

    // Only auto-advance if this status callback matches the current active call
    // (guards against stale callbacks from previous calls in the same session)
    if (p.currentCallSid && p.currentCallSid !== callSid) return;

    // Session already at the end or no active call to advance
    if (p.currentIndex >= p.leadIds.length) return;

    const currentLeadId = p.leadIds[p.currentIndex]!;
    const [currentLead] = await db.select().from(crmLeads)
      .where(eq(crmLeads.id, currentLeadId)).limit(1);

    // Infer disposition from call duration:
    //   >= 30 s  → "answered"  (meaningful conversation)
    //   1–29 s   → "no_answer" (picked up then dropped, VM detection, etc.)
    //   0 s      → "no_answer" (no pickup)
    const inferredDispo: "answered" | "no_answer" = callDuration >= 30 ? "answered" : "no_answer";

    // Update stats
    if (inferredDispo === "answered") p.stats.answered += 1;
    else p.stats.noAnswer += 1;

    // Record disposition
    p.dispositions.push({
      leadId: currentLeadId,
      leadName: currentLead?.sellerName ?? "Unknown",
      leadAddress: currentLead?.address ?? "",
      leadPhone: currentLead?.phone ?? "",
      disposition: inferredDispo,
      callSid: p.currentCallSid,
      calledAt: new Date().toISOString(),
    });

    // Update call log
    if (p.currentCallSid) {
      await db.update(crmCallLogs)
        .set({ disposition: inferredDispo, status: "completed", duration: callDuration, updatedAt: new Date() })
        .where(eq(crmCallLogs.callSid, p.currentCallSid));
    }

    // Advance session
    const advance = Math.max(1, p.currentBatchLeadIds?.length ?? 1);
    p.currentIndex += advance;
    p.currentCallSid = null;
    p.currentBatchLeadIds = [];

    const isDone = p.currentIndex >= p.leadIds.length;

    if (isDone) {
      await updateBackgroundJob(sessionId, {
        status: "done",
        payload: p as unknown as Record<string, unknown>,
        result: { stats: p.stats } as Record<string, unknown>,
        progress: 100,
      });
    } else {
      const progress = Math.round((p.currentIndex / p.leadIds.length) * 100);
      await updateBackgroundJob(sessionId, {
        payload: p as unknown as Record<string, unknown>,
        progress,
      });
    }

    // Load next lead for the SSE payload
    let nextLead: any = null;
    if (!isDone) {
      const [lead] = await db.select().from(crmLeads)
        .where(eq(crmLeads.id, p.leadIds[p.currentIndex]!)).limit(1);
      nextLead = lead ?? null;
    }

    // Emit SSE so the browser UI can show a toast and refresh without polling delay
    emitCrmActivity("power_dial_call_ended", {
      sessionId,
      callSid,
      callDuration,
      disposition: inferredDispo,
      autoAdvanced: true,
      done: isDone,
      currentIndex: p.currentIndex,
      total: p.leadIds.length,
      nextLeadName: nextLead?.sellerName ?? null,
      nextLeadPhone: nextLead?.phone ?? null,
      campaignId: p.campaignId,
    });

    logger.info(
      { sessionId, callSid, callDuration, inferredDispo, currentIndex: p.currentIndex, isDone },
      "[powerDial/call-status] auto-advanced session after call completion"
    );
  } catch (err) {
    logger.error(err, "[powerDial/call-status] auto-advance error");
  }
});

// ── POST /twilio/voice/power-dial/amd-handler ─────────────────────────────────
// Public Twilio AMD (Answering Machine Detection) webhook — fires per outbound
// call once Twilio determines human vs. machine.
//
// Query params: sessionId, leadId, agentPhone
// Body (Twilio): AnsweredBy, CallSid
//
// Human  → cancel all sister calls in batch, bridge this call to agent.
// Machine/fax → hangup, decrement activeCalls, increment voicemail counter.

router.post("/twilio/voice/power-dial/amd-handler", twilioAuth, async (req, res) => {
  const twiml = (xml: string) =>
    res.set("Content-Type", "text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response>${xml}</Response>`);

  try {
    const sessionId  = (req.query.sessionId  as string | undefined) ?? "";
    const leadId     = parseInt((req.query.leadId as string | undefined) ?? "0", 10) || 0;
    const agentPhone = (req.query.agentPhone as string | undefined) ?? "";
    const answeredBy = (req.body?.AnsweredBy  as string | undefined) ?? "";
    const callSid    = (req.body?.CallSid     as string | undefined) ?? "";

    if (!sessionId || !callSid) return twiml("<Hangup/>");

    // ── Machine / fax — hang up and track ──────────────────────────────────
    if (
      answeredBy === "machine_start" ||
      answeredBy === "machine_end_beep" ||
      answeredBy === "machine_end_silence" ||
      answeredBy === "fax"
    ) {
      await db.transaction(async (tx) => {
        const [locked] = await tx
          .select({ id: crmBackgroundJobs.id, payload: crmBackgroundJobs.payload })
          .from(crmBackgroundJobs)
          .where(eq(crmBackgroundJobs.id, sessionId))
          .for("update")
          .limit(1);
        if (!locked) return;

        const lp = (locked.payload ?? {}) as PowerDialPayload;
        lp.activeCalls = lp.activeCalls ?? {};
        delete lp.activeCalls[callSid];
        lp.stats.voicemail = (lp.stats.voicemail ?? 0) + 1;

        await tx.update(crmBackgroundJobs)
          .set({ payload: lp as unknown as any, updatedAt: new Date() })
          .where(eq(crmBackgroundJobs.id, sessionId));
      });

      logger.info({ sessionId, callSid, answeredBy }, "[powerDial/amd] Machine detected — hanging up");
      return twiml("<Hangup/>");
    }

    // ── Human answered — cancel sister lines and bridge to agent ───────────
    if (answeredBy === "human") {
      let sisterCallSids: string[] = [];
      let campaignId: number | null = null;
      let callerIdPhone = "";

      await db.transaction(async (tx) => {
        const [locked] = await tx
          .select({ id: crmBackgroundJobs.id, payload: crmBackgroundJobs.payload })
          .from(crmBackgroundJobs)
          .where(eq(crmBackgroundJobs.id, sessionId))
          .for("update")
          .limit(1);
        if (!locked) return;

        const lp = (locked.payload ?? {}) as PowerDialPayload;
        campaignId    = lp.campaignId;
        callerIdPhone = lp.callerIdPhone;
        lp.activeCalls = lp.activeCalls ?? {};

        // Collect and clear all other calls in this batch
        sisterCallSids = Object.keys(lp.activeCalls).filter(sid => sid !== callSid);
        delete lp.activeCalls[callSid];
        for (const s of sisterCallSids) delete lp.activeCalls[s];
        lp.stats.answered = (lp.stats.answered ?? 0) + 1;

        await tx.update(crmBackgroundJobs)
          .set({ payload: lp as unknown as any, updatedAt: new Date() })
          .where(eq(crmBackgroundJobs.id, sessionId));
      });

      // Cancel sister lines asynchronously (non-blocking)
      if (sisterCallSids.length > 0) {
        let cancelCreds: { accountSid: string; authToken: string } | null = null;
        try {
          if (campaignId != null) {
            const c = await getSmsCreds(campaignId);
            if (c) cancelCreds = c;
          }
        } catch { /* fall through */ }

        if (!cancelCreds) {
          const sid   = process.env.TWILIO_ACCOUNT_SID;
          const token = process.env.TWILIO_AUTH_TOKEN;
          if (sid && token) cancelCreds = { accountSid: sid, authToken: token };
        }

        if (cancelCreds) {
          const cancelClient = twilio(cancelCreds.accountSid, cancelCreds.authToken);
          Promise.allSettled(
            sisterCallSids.map(sid =>
              cancelClient.calls(sid).update({ status: "completed" }).catch(e =>
                logger.warn({ sid, err: e.message }, "[powerDial/amd] Failed to cancel sister call")
              )
            )
          );
        }
      }

      // Emit SSE so the frontend can update immediately
      emitCrmActivity("power_dial_human_answered", {
        sessionId, callSid, leadId, agentPhone, campaignId,
      });

      logger.info({ sessionId, callSid, leadId, agentPhone }, "[powerDial/amd] Human answered — bridging to agent");

      // Bridge the live seller call to the agent
      return twiml(
        `<Dial callerId="${callerIdPhone}" timeout="30">` +
        `<Number>${agentPhone}</Number>` +
        `</Dial>`
      );
    }

    // Unknown AnsweredBy value — hang up
    logger.info({ sessionId, callSid, answeredBy }, "[powerDial/amd] Unknown AnsweredBy — hanging up");
    return twiml("<Hangup/>");
  } catch (err) {
    logger.error(err, "[powerDial/amd] handler error");
    return twiml("<Hangup/>");
  }
});

export default router;
