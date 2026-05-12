import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db } from "@workspace/db";
import {
  crmCampaigns, crmUsers, crmLeads, crmNotes, crmTasks, crmBuyers,
  crmSubmissionLinks, crmEmailSequences, crmSequenceSteps, crmSequenceLogs,
  crmComps, crmLeadFollowers, crmNotifications, crmOpenPhoneMessages,
} from "@workspace/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { crmAuth, crmSuperAdminOnly, crmAdminOnly } from "./middleware";

const router = Router();

type CampaignWithCounts = typeof crmCampaigns.$inferSelect & { userCount: number; leadCount: number };

function validateMaxUsers(value: unknown): { value: number | null } | { error: string } {
  if (value === null || value === undefined || value === "" || value === "null") return { value: null };
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 1) return { error: "maxUsers must be a positive integer or null" };
  return { value: n };
}

function formatCampaign(c: CampaignWithCounts) {
  const sid = c.twilioAccountSid ?? null;
  const encToken = c.twilioAuthToken ?? null;
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    active: c.active,
    maxUsers: c.maxUsers ?? null,
    allowLeadDeletion: c.allowLeadDeletion ?? true,
    ownerUserId: c.ownerUserId ?? null,
    skipTraceDailyLimit: c.skipTraceDailyLimit ?? 1,
    fetchCompsDailyLimit: c.fetchCompsDailyLimit ?? 1,
    openPhoneNumberId: c.openPhoneNumberId ?? null,
    openPhoneNumber: c.openPhoneNumber ?? null,
    dialerEnabled: c.dialerEnabled ?? false,
    // Twilio per-campaign config
    twilioConfigured: !!(sid && encToken),
    twilioEnabled: c.twilioEnabled ?? false,
    twilioPhoneNumber: c.twilioPhoneNumber ?? null,
    // never expose the auth token — callers use /twilio/config for masked view
    createdAt: c.createdAt.toISOString(),
    userCount: c.userCount,
    leadCount: c.leadCount,
  };
}

// GET /crm/campaigns — super admin: all campaigns; campaign admin: their own
router.get("/", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!
  try {
    if (crmUser.role === "super_admin") {
      const campaigns = await db.select().from(crmCampaigns).orderBy(crmCampaigns.createdAt);
      const enriched = await Promise.all(campaigns.map(async (c) => {
        const [[{ userCount }], [{ leadCount }]] = await Promise.all([
          db.select({ userCount: sql<number>`count(*)::int` }).from(crmUsers).where(eq(crmUsers.campaignId, c.id)),
          db.select({ leadCount: sql<number>`count(*)::int` }).from(crmLeads).where(eq(crmLeads.campaignId, c.id)),
        ]);
        return { ...c, userCount, leadCount };
      }));
      res.json(enriched.map(formatCampaign));
    } else if (crmUser.campaignId) {
      const [campaign] = await db.select().from(crmCampaigns).where(eq(crmCampaigns.id, crmUser.campaignId)).limit(1);
      if (!campaign) {
        res.status(404).json({ error: "Campaign not found" });
        return;
      }
      const [[{ userCount }], [{ leadCount }]] = await Promise.all([
        db.select({ userCount: sql<number>`count(*)::int` }).from(crmUsers).where(eq(crmUsers.campaignId, campaign.id)),
        db.select({ leadCount: sql<number>`count(*)::int` }).from(crmLeads).where(eq(crmLeads.campaignId, campaign.id)),
      ]);
      res.json([{ ...campaign, userCount, leadCount }].map(formatCampaign));
    } else {
      res.json([]);
    }
  } catch (err) {
    console.error("CRM campaigns list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /crm/campaigns — super admin only: create new campaign + campaign admin
router.post("/", crmAuth, crmSuperAdminOnly, async (req, res) => {
  const { name, slug, adminName, adminEmail, adminPassword, maxUsers, allowLeadDeletion, skipTraceDailyLimit, fetchCompsDailyLimit } = req.body;
  if (!name || !slug) {
    res.status(400).json({ error: "Campaign name and slug required" });
    return;
  }
  if (!adminName || !adminEmail || !adminPassword) {
    res.status(400).json({ error: "Admin name, email, and password required" });
    return;
  }
  const maxUsersResult = validateMaxUsers(maxUsers);
  if ("error" in maxUsersResult) {
    res.status(400).json({ error: maxUsersResult.error });
    return;
  }
  const stLimit = skipTraceDailyLimit != null ? Math.max(1, parseInt(String(skipTraceDailyLimit), 10) || 1) : 1;
  const fcLimit = fetchCompsDailyLimit != null ? Math.max(1, parseInt(String(fetchCompsDailyLimit), 10) || 1) : 1;
  try {
    const [campaign] = await db.insert(crmCampaigns).values({
      name,
      slug: slug.toLowerCase().replace(/\s+/g, "-"),
      active: true,
      maxUsers: maxUsersResult.value,
      allowLeadDeletion: allowLeadDeletion !== false && allowLeadDeletion !== "false",
      skipTraceDailyLimit: stLimit,
      fetchCompsDailyLimit: fcLimit,
    }).returning();
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const [adminUser] = await db.insert(crmUsers).values({
      name: adminName,
      email: adminEmail.toLowerCase(),
      passwordHash,
      role: "admin",
      status: "active",
      campaignId: campaign.id,
    }).returning();
    // Mark this admin as the campaign owner
    await db.update(crmCampaigns).set({ ownerUserId: adminUser.id }).where(eq(crmCampaigns.id, campaign.id));
    res.status(201).json(formatCampaign({ ...campaign, ownerUserId: adminUser.id, userCount: 1, leadCount: 0 }));
  } catch (err: any) {
    if (err.code === "23505") {
      if (err.constraint?.includes("email")) {
        res.status(400).json({ error: "Email already exists" });
      } else {
        res.status(400).json({ error: "Campaign slug already exists" });
      }
      return;
    }
    console.error("Create campaign error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /crm/campaigns/:id — super admin only for maxUsers/allowLeadDeletion; campaign admin for name/active only
router.patch("/:id", crmAuth, crmAdminOnly, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const crmUser = req.crmUser!

  if (crmUser.role !== "super_admin" && crmUser.campaignId !== id) {
    res.status(403).json({ error: "You can only update your own campaign" });
    return;
  }

  const { name, active, maxUsers, allowLeadDeletion, skipTraceDailyLimit, fetchCompsDailyLimit, openPhoneNumberId, openPhoneNumber, dialerEnabled } = req.body;
  try {
    const updates: Partial<typeof crmCampaigns.$inferInsert> = {};
    if (name !== undefined) updates.name = name;
    if (active !== undefined) updates.active = active;

    // Campaign admins can manage their own Twilio settings
    if (crmUser.role === "admin" || crmUser.role === "super_admin") {
      // Twilio config — campaign admin sets their own credentials
      // Auth token is encrypted by the /twilio/config endpoint; campaigns.ts just passes through
      if (req.body.twilioEnabled !== undefined) updates.twilioEnabled = req.body.twilioEnabled === true || req.body.twilioEnabled === "true";
    }

    // Only super admin can change governance settings
    if (crmUser.role === "super_admin") {
      if (maxUsers !== undefined) {
        const maxUsersResult = validateMaxUsers(maxUsers);
        if ("error" in maxUsersResult) {
          res.status(400).json({ error: maxUsersResult.error });
          return;
        }
        updates.maxUsers = maxUsersResult.value;
      }
      if (allowLeadDeletion !== undefined) updates.allowLeadDeletion = allowLeadDeletion === true || allowLeadDeletion === "true";
      if (skipTraceDailyLimit !== undefined) updates.skipTraceDailyLimit = Math.max(1, parseInt(String(skipTraceDailyLimit), 10) || 1);
      if (fetchCompsDailyLimit !== undefined) updates.fetchCompsDailyLimit = Math.max(1, parseInt(String(fetchCompsDailyLimit), 10) || 1);
      if (openPhoneNumberId !== undefined) updates.openPhoneNumberId = openPhoneNumberId || null;
      if (openPhoneNumber !== undefined) updates.openPhoneNumber = openPhoneNumber || null;
      if (dialerEnabled !== undefined) updates.dialerEnabled = dialerEnabled === true || dialerEnabled === "true";
    }

    const [campaign] = await db.update(crmCampaigns).set(updates).where(eq(crmCampaigns.id, id)).returning();
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const [[{ userCount }], [{ leadCount }]] = await Promise.all([
      db.select({ userCount: sql<number>`count(*)::int` }).from(crmUsers).where(eq(crmUsers.campaignId, campaign.id)),
      db.select({ leadCount: sql<number>`count(*)::int` }).from(crmLeads).where(eq(crmLeads.campaignId, campaign.id)),
    ]);
    res.json(formatCampaign({ ...campaign, userCount, leadCount }));
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /crm/campaigns/:id — super admin only, requires password confirmation
router.delete("/:id", crmAuth, crmSuperAdminOnly, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const crmUser = req.crmUser!
  const { superAdminPassword } = req.body;

  if (!superAdminPassword) {
    res.status(400).json({ error: "Super admin password is required to delete a campaign." });
    return;
  }

  try {
    // Verify the super admin's password
    const [superAdmin] = await db.select().from(crmUsers)
      .where(eq(crmUsers.id, crmUser.userId)).limit(1);

    if (!superAdmin) {
      res.status(403).json({ error: "User not found." });
      return;
    }

    // Verify against the env secret first (authoritative), then fall back to DB hash
    const envPassword = process.env.CRM_ADMIN_PASSWORD || "";
    const envMatch = envPassword.length > 0 &&
      envPassword.length === superAdminPassword.length &&
      crypto.timingSafeEqual(Buffer.from(superAdminPassword), Buffer.from(envPassword));
    const hashMatch = !envMatch && await bcrypt.compare(superAdminPassword, superAdmin.passwordHash);
    if (!envMatch && !hashMatch) {
      res.status(403).json({ error: "Incorrect password. Campaign deletion cancelled." });
      return;
    }

    const [existing] = await db.select({ id: crmCampaigns.id, name: crmCampaigns.name }).from(crmCampaigns)
      .where(eq(crmCampaigns.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Campaign not found." });
      return;
    }

    // Gather IDs for sub-queries
    const leadRows = await db.select({ id: crmLeads.id }).from(crmLeads).where(eq(crmLeads.campaignId, id));
    const leadIds = leadRows.map(r => r.id);
    const userRows = await db.select({ id: crmUsers.id }).from(crmUsers).where(eq(crmUsers.campaignId, id));
    const userIds = userRows.map(r => r.id);
    const seqRows = await db.select({ id: crmEmailSequences.id }).from(crmEmailSequences).where(eq(crmEmailSequences.campaignId, id));
    const seqIds = seqRows.map(r => r.id);

    // Delete all related records in the correct order to satisfy FK constraints
    if (seqIds.length > 0) {
      await db.delete(crmSequenceLogs).where(inArray(crmSequenceLogs.sequenceId, seqIds));
      await db.delete(crmSequenceSteps).where(inArray(crmSequenceSteps.sequenceId, seqIds));
    }
    await db.delete(crmEmailSequences).where(eq(crmEmailSequences.campaignId, id));
    await db.delete(crmSubmissionLinks).where(eq(crmSubmissionLinks.campaignId, id));
    await db.delete(crmBuyers).where(eq(crmBuyers.campaignId, id));

    if (leadIds.length > 0) {
      await db.delete(crmComps).where(inArray(crmComps.leadId, leadIds));
      await db.delete(crmNotes).where(inArray(crmNotes.leadId, leadIds));
      await db.delete(crmLeadFollowers).where(inArray(crmLeadFollowers.leadId, leadIds));
      await db.delete(crmNotifications).where(inArray(crmNotifications.leadId, leadIds));
    }
    if (userIds.length > 0) {
      await db.delete(crmNotifications).where(inArray(crmNotifications.userId, userIds));
    }
    await db.delete(crmTasks).where(eq(crmTasks.campaignId, id));
    // Nullify assignedTo before deleting leads/users
    if (leadIds.length > 0) {
      await db.update(crmLeads).set({ assignedTo: null }).where(inArray(crmLeads.id, leadIds));
      await db.delete(crmLeads).where(inArray(crmLeads.id, leadIds));
    }
    await db.delete(crmUsers).where(eq(crmUsers.campaignId, id));
    await db.delete(crmCampaigns).where(eq(crmCampaigns.id, id));

    res.json({ success: true, message: `Campaign "${existing.name}" and all its data have been deleted.` });
  } catch (err) {
    console.error("Delete campaign error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
