import { Router } from "express";
import { db } from "@workspace/db";
import { crmSubmissionLinks } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { crmAuth, crmAdminOnly } from "./middleware";
import crypto from "crypto";

const router = Router();

function getBaseUrl(): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  if (process.env.API_BASE_URL) return process.env.API_BASE_URL.replace(/\/api\/?$/, "").replace(/\/$/, "");
  return "";
}

function formatLink(link: typeof crmSubmissionLinks.$inferSelect, baseUrl: string) {
  return {
    id: link.id,
    campaignId: link.campaignId,
    token: link.token,
    label: link.label,
    leadSource: link.leadSource,
    active: link.active,
    submissionsCount: link.submissionsCount,
    createdAt: link.createdAt ? link.createdAt.toISOString() : new Date().toISOString(),
    url: `${baseUrl}/crm/submit/${link.token}`,
  };
}

router.get("/", crmAuth, crmAdminOnly, async (req, res) => {
  const crmUser = req.crmUser!;
  try {
    const conditions: any[] = [];
    if (crmUser.role !== "super_admin" && crmUser.campaignId) {
      conditions.push(eq(crmSubmissionLinks.campaignId, crmUser.campaignId));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const links = await db.select().from(crmSubmissionLinks).where(where).orderBy(crmSubmissionLinks.createdAt);
    const base = getBaseUrl();
    res.json(links.map(l => formatLink(l, base)));
  } catch (err) {
    res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) || "Internal server error" });
  }
});

router.post("/", crmAuth, crmAdminOnly, async (req, res) => {
  const crmUser = req.crmUser!;
  const { label, leadSource, campaignId: reqCampaignId } = req.body;
  const campaignId = crmUser.role === "super_admin"
    ? (reqCampaignId ? parseInt(reqCampaignId) : null)
    : crmUser.campaignId;
  try {
    const token = crypto.randomBytes(12).toString("hex");
    const [link] = await db.insert(crmSubmissionLinks).values({
      campaignId, token, label: label || null, leadSource: leadSource || null, active: true,
      createdBy: crmUser.userId, submissionsCount: 0,
    }).returning();
    const base = getBaseUrl();
    res.status(201).json(formatLink(link, base));
  } catch (err) {
    res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) || "Internal server error" });
  }
});

router.patch("/:id", crmAuth, crmAdminOnly, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const crmUser = req.crmUser!;
  const { label, leadSource, active } = req.body;
  try {
    const [existing] = await db.select().from(crmSubmissionLinks).where(eq(crmSubmissionLinks.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Link not found" }); return; }
    if (crmUser.role !== "super_admin" && existing.campaignId !== crmUser.campaignId) {
      res.status(403).json({ error: "Access denied" }); return;
    }
    const updates: any = {};
    if (label !== undefined) updates.label = label;
    if (leadSource !== undefined) updates.leadSource = leadSource;
    if (active !== undefined) updates.active = active;
    const [link] = await db.update(crmSubmissionLinks).set(updates).where(eq(crmSubmissionLinks.id, id)).returning();
    res.json(formatLink(link, getBaseUrl()));
  } catch (err) {
    res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) || "Internal server error" });
  }
});

router.delete("/:id", crmAuth, crmAdminOnly, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const crmUser = req.crmUser!;
  try {
    const [existing] = await db.select().from(crmSubmissionLinks).where(eq(crmSubmissionLinks.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Link not found" }); return; }
    if (crmUser.role !== "super_admin" && existing.campaignId !== crmUser.campaignId) {
      res.status(403).json({ error: "Access denied" }); return;
    }
    await db.delete(crmSubmissionLinks).where(eq(crmSubmissionLinks.id, id));
    res.json({ success: true, message: "Link deleted" });
  } catch (err) {
    res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) || "Internal server error" });
  }
});

export default router;
