import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { crmUsers, crmCampaigns, crmNotifications } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { crmAuth, crmAdminOnly } from "./middleware";
import { logger } from "../../lib/logger";

const router = Router();

function formatUser(u: typeof crmUsers.$inferSelect, ownerUserId?: number | null) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    campaignId: u.campaignId,
    isOwner: ownerUserId != null ? u.id === ownerUserId : undefined,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}

async function getCampaignOwnerUserId(campaignId: number): Promise<number | null> {
  const [campaign] = await db.select({ ownerUserId: crmCampaigns.ownerUserId })
    .from(crmCampaigns).where(eq(crmCampaigns.id, campaignId)).limit(1);
  return campaign?.ownerUserId ?? null;
}

// GET /crm/users — list users in the caller's campaign (or all for super_admin)
// Any authenticated user can list campaign members (for @mentions, assignment, etc.)
router.get("/", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  try {
    let users;
    let ownerUserId: number | null = null;
    if (crmUser.role === "super_admin") {
      const campaignId = req.query.campaignId ? parseInt(req.query.campaignId as string) : undefined;
      users = campaignId
        ? await db.select().from(crmUsers).where(eq(crmUsers.campaignId, campaignId)).orderBy(crmUsers.createdAt)
        : await db.select().from(crmUsers).orderBy(crmUsers.createdAt);
      if (campaignId) ownerUserId = await getCampaignOwnerUserId(campaignId);
    } else {
      users = await db.select().from(crmUsers)
        .where(eq(crmUsers.campaignId, crmUser.campaignId!))
        .orderBy(crmUsers.createdAt);
      ownerUserId = await getCampaignOwnerUserId(crmUser.campaignId!);
    }
    res.json(users.map(u => formatUser(u, ownerUserId)));
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /crm/users — create user within the caller's campaign
router.post("/", crmAuth, crmAdminOnly, async (req, res) => {
  const crmUser = req.crmUser!;
  const { name, email, password, role, status, campaignId: reqCampaignId } = req.body;
  if (!name || !email || !role) {
    res.status(400).json({ error: "Name, email, and role required" });
    return;
  }
  if (!password) {
    res.status(400).json({ error: "Password required when creating a user" });
    return;
  }
  const targetCampaignId = crmUser.role === "super_admin"
    ? (reqCampaignId ? parseInt(reqCampaignId) : null)
    : crmUser.campaignId;

  if (crmUser.role !== "super_admin" && role === "super_admin") {
    res.status(403).json({ error: "Cannot create super admin users" });
    return;
  }

  // Non-super-admin: only the campaign owner can create other admin accounts
  if (crmUser.role !== "super_admin" && role === "admin" && targetCampaignId) {
    const ownerUserId = await getCampaignOwnerUserId(targetCampaignId);
    if (crmUser.userId !== ownerUserId) {
      res.status(403).json({ error: "Only the campaign owner can create admin accounts." });
      return;
    }
  }

  // Enforce maxUsers cap for campaign users
  if (targetCampaignId) {
    try {
      const [campaign] = await db.select().from(crmCampaigns).where(eq(crmCampaigns.id, targetCampaignId)).limit(1);
      if (campaign?.maxUsers != null) {
        const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(crmUsers).where(eq(crmUsers.campaignId, targetCampaignId));
        if (count >= campaign.maxUsers) {
          res.status(403).json({ error: `This campaign has reached its user limit of ${campaign.maxUsers}. Contact your administrator to increase the limit.` });
          return;
        }
      }
    } catch (err) {
      logger.error({ err }, "User limit check error");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await db.insert(crmUsers).values({
      name,
      email: email.toLowerCase(),
      passwordHash,
      role: role || "sales",
      status: status || "active",
      campaignId: targetCampaignId,
    }).returning();
    const ownerUserId = targetCampaignId ? await getCampaignOwnerUserId(targetCampaignId) : null;
    // Notify super admin of new user creation (if creator isn't super admin)
    if (crmUser.role !== "super_admin") {
      try {
        const [superAdmin] = await db.select({ id: crmUsers.id }).from(crmUsers).where(eq(crmUsers.role, "super_admin")).limit(1);
        if (superAdmin) {
          await db.insert(crmNotifications).values({
            userId: superAdmin.id, leadId: null, type: "new_user",
            content: `New user created: ${name} (${role})`, read: false,
          });
        }
      } catch (e) { logger.error({ err: e }, "super_admin notify error"); }
    }
    res.status(201).json(formatUser(user, ownerUserId));
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(400).json({ error: "Email already exists" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /crm/users/:id — update user (scoped to campaign)
router.patch("/:id", crmAuth, crmAdminOnly, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const crmUser = req.crmUser!;
  const isSelf = crmUser.userId === id;
  let { name, email, password, role, status } = req.body;

  // Non-super-admins cannot change their own name, email, or role via this endpoint
  if (isSelf && crmUser.role !== "super_admin") {
    name = undefined;
    email = undefined;
    role = undefined;
  }

  try {
    const [existing] = await db.select().from(crmUsers).where(eq(crmUsers.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Campaign admin can only edit users in their campaign
    if (crmUser.role !== "super_admin" && existing.campaignId !== crmUser.campaignId) {
      res.status(403).json({ error: "You can only edit users in your campaign" });
      return;
    }

    // Prevent modifying super_admin by non-super-admin
    if (existing.role === "super_admin" && crmUser.role !== "super_admin") {
      res.status(403).json({ error: "Cannot modify super admin users" });
      return;
    }

    // Non-super-admin campaign admins cannot edit other admin accounts
    // unless they are the campaign owner
    if (crmUser.role !== "super_admin" && !isSelf && existing.role === "admin" && existing.campaignId) {
      const ownerUserId = await getCampaignOwnerUserId(existing.campaignId);
      if (crmUser.userId !== ownerUserId) {
        res.status(403).json({ error: "Only the campaign owner can edit other admin accounts." });
        return;
      }
    }

    // Non-owner admins cannot promote a user to admin role
    if (crmUser.role !== "super_admin" && role === "admin" && existing.campaignId) {
      const ownerUserId = await getCampaignOwnerUserId(existing.campaignId);
      if (crmUser.userId !== ownerUserId) {
        res.status(403).json({ error: "Only the campaign owner can promote users to admin." });
        return;
      }
    }

    // Campaign owner cannot have their role downgraded by anyone except super_admin
    if (crmUser.role !== "super_admin" && existing.campaignId) {
      const ownerUserId = await getCampaignOwnerUserId(existing.campaignId);
      if (existing.id === ownerUserId && role && role !== "admin") {
        res.status(403).json({ error: "Cannot change the campaign owner's role." });
        return;
      }
    }

    const updates: Partial<typeof crmUsers.$inferInsert> = {};
    if (name) updates.name = name;
    if (email) updates.email = email.toLowerCase();
    if (role && !(existing.role === "super_admin" && role !== "super_admin")) updates.role = role;
    if (status) updates.status = status;
    if (password) {
      updates.passwordHash = await bcrypt.hash(password, 12);
    }

    const [user] = await db.update(crmUsers).set(updates).where(eq(crmUsers.id, id)).returning();
    const ownerUserId = user.campaignId ? await getCampaignOwnerUserId(user.campaignId) : null;
    res.json(formatUser(user, ownerUserId));
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /crm/users/:id — delete user (scoped to campaign)
router.delete("/:id", crmAuth, crmAdminOnly, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const crmUser = req.crmUser!;
  if (crmUser.userId === id) {
    res.status(400).json({ error: "Cannot delete your own account" });
    return;
  }
  try {
    const [existing] = await db.select().from(crmUsers).where(eq(crmUsers.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (crmUser.role !== "super_admin" && existing.campaignId !== crmUser.campaignId) {
      res.status(403).json({ error: "You can only delete users in your campaign" });
      return;
    }
    if (existing.role === "super_admin") {
      res.status(403).json({ error: "Cannot delete super admin users" });
      return;
    }

    // Non-super-admin admins cannot delete other admin accounts unless they are the campaign owner
    if (crmUser.role !== "super_admin" && existing.role === "admin" && existing.campaignId) {
      const ownerUserId = await getCampaignOwnerUserId(existing.campaignId);
      if (crmUser.userId !== ownerUserId) {
        res.status(403).json({ error: "Only the campaign owner can delete admin accounts." });
        return;
      }
    }

    // The campaign owner account can never be deleted (even by themselves — only super_admin can)
    if (existing.campaignId && crmUser.role !== "super_admin") {
      const ownerUserId = await getCampaignOwnerUserId(existing.campaignId);
      if (existing.id === ownerUserId) {
        res.status(403).json({ error: "The campaign owner account cannot be deleted." });
        return;
      }
    }

    await db.delete(crmUsers).where(eq(crmUsers.id, id));
    res.json({ success: true, message: "User deleted" });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
