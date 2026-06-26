import { Router } from "express";
import { db } from "@workspace/db";
import { crmTasks, crmLeads, crmUsers } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { crmAuth } from "./middleware";
import { logger } from "../../lib/logger";
import { onTaskCreated } from "../../services/automation";

const router = Router();

function formatTask(t: any) {
  return {
    id: t.id,
    campaignId: t.campaignId,
    leadId: t.leadId,
    leadAddress: t.leadAddress || null,
    assignedTo: t.assignedTo,
    assignedToName: t.assignedToName || null,
    title: t.title,
    description: t.description,
    dueDate: t.dueDate ? (t.dueDate instanceof Date ? t.dueDate.toISOString() : t.dueDate) : null,
    status: t.status,
    priority: t.priority || "normal",
    source: t.source || "manual",
    escalated: t.escalated || false,
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
  };
}

router.get("/", crmAuth, async (req, res) => {
  const { leadId, status } = req.query as Record<string, string | undefined>;
  const crmUser = req.crmUser!;
  try {
    const conditions: any[] = [];
    if (crmUser.role !== "super_admin" && crmUser.campaignId) conditions.push(eq(crmTasks.campaignId, crmUser.campaignId));
    if (leadId) conditions.push(eq(crmTasks.leadId, parseInt(leadId)));
    if (status) conditions.push(eq(crmTasks.status, status));
    if (crmUser.role === "va") conditions.push(eq(crmTasks.assignedTo, crmUser.userId));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const tasks = await db.select({
      id: crmTasks.id, campaignId: crmTasks.campaignId, leadId: crmTasks.leadId, assignedTo: crmTasks.assignedTo,
      title: crmTasks.title, description: crmTasks.description, dueDate: crmTasks.dueDate,
      status: crmTasks.status, createdAt: crmTasks.createdAt, assignedToName: crmUsers.name, leadAddress: crmLeads.address,
    }).from(crmTasks).leftJoin(crmUsers, eq(crmTasks.assignedTo, crmUsers.id)).leftJoin(crmLeads, eq(crmTasks.leadId, crmLeads.id)).where(where).orderBy(crmTasks.dueDate);

    res.json(tasks.map(formatTask));
  } catch (err) {
    logger.error(err, "GET /crm/tasks error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  const { leadId, assignedTo, title, description, dueDate, status } = req.body;
  if (!title) { res.status(400).json({ error: "Title required" }); return; }
  const campaignId = crmUser.campaignId ?? (req.body.campaignId ? parseInt(req.body.campaignId) : null);
  try {
    const resolvedAssignedTo = assignedTo ? parseInt(assignedTo) : (crmUser.role !== "admin" && crmUser.role !== "super_admin" ? crmUser.userId : null);
    const [task] = await db.insert(crmTasks).values({
      campaignId,
      leadId: leadId ? parseInt(leadId) : null,
      assignedTo: resolvedAssignedTo,
      title, description: description || null,
      dueDate: dueDate ? new Date(dueDate) : null,
      status: status || "pending",
      priority: req.body.priority || "normal",
      source: "manual",
      escalated: false,
    }).returning();

    const [full] = await db.select({
      id: crmTasks.id, campaignId: crmTasks.campaignId, leadId: crmTasks.leadId, assignedTo: crmTasks.assignedTo,
      title: crmTasks.title, description: crmTasks.description, dueDate: crmTasks.dueDate,
      status: crmTasks.status, priority: crmTasks.priority, source: crmTasks.source, escalated: crmTasks.escalated,
      createdAt: crmTasks.createdAt, assignedToName: crmUsers.name, leadAddress: crmLeads.address,
    }).from(crmTasks).leftJoin(crmUsers, eq(crmTasks.assignedTo, crmUsers.id)).leftJoin(crmLeads, eq(crmTasks.leadId, crmLeads.id)).where(eq(crmTasks.id, task.id));

    onTaskCreated(task.id, resolvedAssignedTo, task.leadId, task.title, crmUser.userId)
      .catch(e => logger.error(e, "onTaskCreated error"));

    res.status(201).json(formatTask(full));
  } catch (err) {
    logger.error(err, "POST /crm/tasks error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", crmAuth, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const { title, description, dueDate, status, assignedTo, leadId } = req.body;
  try {
    const updates: any = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;
    if (status !== undefined) updates.status = status;
    if (assignedTo !== undefined) updates.assignedTo = assignedTo ? parseInt(assignedTo) : null;
    if (leadId !== undefined) updates.leadId = leadId ? parseInt(leadId) : null;

    const [task] = await db.update(crmTasks).set(updates).where(eq(crmTasks.id, id)).returning();
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    const [full] = await db.select({
      id: crmTasks.id, campaignId: crmCampaigns.id, leadId: crmLeads.id, assignedTo: crmUsers.id,
      title: crmTasks.title, description: crmTasks.description, dueDate: crmTasks.dueDate,
      status: crmTasks.status, createdAt: crmTasks.createdAt, assignedToName: crmUsers.name, leadAddress: crmLeads.address,
    }).from(crmTasks).leftJoin(crmUsers, eq(crmTasks.assignedTo, crmUsers.id)).leftJoin(crmLeads, eq(crmTasks.leadId, crmLeads.id)).where(eq(crmTasks.id, task.id));

    res.json(formatTask(full));
  } catch (err) {
    logger.error(err, "PATCH /crm/tasks error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", crmAuth, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    await db.delete(crmTasks).where(eq(crmTasks.id, id));
    res.json({ success: true, message: "Task deleted" });
  } catch (err) {
    res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) || "Internal server error" });
  }
});

export default router;
