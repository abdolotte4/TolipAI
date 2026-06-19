import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import { crmUsers, crmCampaigns } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { crmAuth, getJwtSecret } from "./middleware";
import { logger } from "../../lib/logger";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait 15 minutes and try again." },
});

router.post("/auth/login", loginLimiter, async (req, res) => {
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
      .set({ lastLoginAt: new Date() })
      .where(eq(crmUsers.id, user.id));

    let campaignName: string | null = null;
    if (user.campaignId) {
      const [campaign] = await db.select().from(crmCampaigns).where(eq(crmCampaigns.id, user.campaignId)).limit(1);
      campaignName = campaign?.name || null;
    }

    const token = jwt.sign(
      { id: user.id, userId: user.id, email: user.email, role: user.role, campaignId: user.campaignId ?? null },
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
    req.log.error({ err }, "CRM login error");
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
    logger.error(err, "GET /me error");
    res.status(500).json({ error: "Failed to load user profile" });
  }
});

export default router;
