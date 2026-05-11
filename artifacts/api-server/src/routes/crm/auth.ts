import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { crmUsers, crmCampaigns } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { crmAuth, getJwtSecret } from "./middleware";
import { encryptPassword } from "./crypto-util";

const router = Router();

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  try {
    const [user] = await db.select().from(crmUsers).where(eq(crmUsers.email, email.toLowerCase())).limit(1);
    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    if (user.status === "inactive") {
      res.status(401).json({ error: "Account is inactive. Contact your administrator." });
      return;
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    await db.update(crmUsers)
      .set({ lastLoginAt: new Date(), encryptedPassword: encryptPassword(password) })
      .where(eq(crmUsers.id, user.id));

    let campaignName: string | null = null;
    if (user.campaignId) {
      const [campaign] = await db.select().from(crmCampaigns).where(eq(crmCampaigns.id, user.campaignId)).limit(1);
      campaignName = campaign?.name || null;
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, campaignId: user.campaignId ?? null },
      getJwtSecret(),
      { expiresIn: "7d" }
    );
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        campaignId: user.campaignId,
        campaignName,
        createdAt: user.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("CRM login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/me", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!
  try {
    const [user] = await db.select().from(crmUsers).where(eq(crmUsers.id, crmUser.userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    let campaignName: string | null = null;
    let isOwner = false;
    if (user.campaignId) {
      const [campaign] = await db.select().from(crmCampaigns).where(eq(crmCampaigns.id, user.campaignId)).limit(1);
      campaignName = campaign?.name || null;
      isOwner = campaign?.ownerUserId === user.id;
    }
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      campaignId: user.campaignId,
      campaignName,
      isOwner,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
