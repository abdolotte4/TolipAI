import { Router } from "express";
import { db } from "@workspace/db";
import { crmLeads, crmTasks, crmUsers } from "@workspace/db/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { crmAuth } from "./middleware";

const router = Router();

router.get("/", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  try {
    const campaignFilter = crmUser.role !== "super_admin" && crmUser.campaignId
      ? eq(crmLeads.campaignId, crmUser.campaignId)
      : undefined;
    const taskFilter = crmUser.role !== "super_admin" && crmUser.campaignId
      ? eq(crmTasks.campaignId, crmUser.campaignId)
      : undefined;

    const leadConditions: any[] = [];
    if (campaignFilter) leadConditions.push(campaignFilter);
    if (crmUser.role === "va") leadConditions.push(eq(crmLeads.assignedTo, crmUser.userId));
    const leadWhere = leadConditions.length > 0 ? and(...leadConditions) : undefined;

    const taskConditions: any[] = [];
    if (taskFilter) taskConditions.push(taskFilter);
    if (crmUser.role === "va") taskConditions.push(eq(crmTasks.assignedTo, crmUser.userId));
    const taskWhere = taskConditions.length > 0 ? and(...taskConditions) : undefined;

    const [
      [{ total }],
      [{ newCount }],
      [{ underContract }],
      [{ closed }],
      [{ totalTasks }],
      [{ pendingTasks }],
      statusGroups,
      recentLeads,
    ] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int` }).from(crmLeads).where(leadWhere),
      db.select({ newCount: sql<number>`count(*)::int` }).from(crmLeads).where(leadWhere ? and(leadWhere, eq(crmLeads.status, "new")) : eq(crmLeads.status, "new")),
      db.select({ underContract: sql<number>`count(*)::int` }).from(crmLeads).where(leadWhere ? and(leadWhere, eq(crmLeads.status, "under_contract")) : eq(crmLeads.status, "under_contract")),
      db.select({ closed: sql<number>`count(*)::int` }).from(crmLeads).where(leadWhere ? and(leadWhere, eq(crmLeads.status, "closed")) : eq(crmLeads.status, "closed")),
      db.select({ totalTasks: sql<number>`count(*)::int` }).from(crmTasks).where(taskWhere),
      db.select({ pendingTasks: sql<number>`count(*)::int` }).from(crmTasks).where(taskWhere ? and(taskWhere, eq(crmTasks.status, "pending")) : eq(crmTasks.status, "pending")),
      db.select({ status: crmLeads.status, count: sql<number>`count(*)::int` }).from(crmLeads).where(leadWhere).groupBy(crmLeads.status),
      db.select().from(crmLeads).where(leadWhere).orderBy(desc(crmLeads.createdAt)).limit(5),
    ]);

    const userIds = [...new Set(recentLeads.map(l => l.assignedTo).filter(Boolean))] as number[];
    let usersMap: Record<number, string> = {};
    if (userIds.length > 0) {
      const { inArray } = await import("drizzle-orm");
      const users = await db
        .select({ id: crmUsers.id, name: crmUsers.name })
        .from(crmUsers)
        .where(inArray(crmUsers.id, userIds));
      usersMap = Object.fromEntries(users.map(u => [u.id, u.name]));
    }

    res.json({
      totalLeads: total, newLeads: newCount, underContract, closed, totalTasks, pendingTasks,
      leadsByStatus: statusGroups,
      recentLeads: recentLeads.map(l => ({
        id: l.id, campaignId: l.campaignId, sellerName: l.sellerName, phone: l.phone, email: l.email, leadSource: l.leadSource,
        address: l.address, city: l.city, state: l.state, zip: l.zip, propertyType: l.propertyType,
        beds: l.beds, baths: l.baths ? parseFloat(l.baths) : null, sqft: l.sqft, condition: l.condition,
        currentValue: l.currentValue ? parseFloat(l.currentValue) : null,
        estimatedRepairCost: l.estimatedRepairCost ? parseFloat(l.estimatedRepairCost) : null,
        arv: l.arv ? parseFloat(l.arv) : null, mao: l.mao ? parseFloat(l.mao) : null, status: l.status,
        assignedTo: l.assignedTo, assignedToName: l.assignedTo ? (usersMap[l.assignedTo] || null) : null,
        createdAt: l.createdAt.toISOString(), updatedAt: l.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
