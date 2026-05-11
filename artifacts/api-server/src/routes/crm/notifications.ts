import { Router } from "express";
import { db } from "@workspace/db";
import { crmNotifications, crmLeads } from "@workspace/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { crmAuth } from "./middleware";

const router = Router();

// GET /crm/notifications — list notifications for current user
router.get("/", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  try {
    const notifications = await db.select().from(crmNotifications)
      .where(eq(crmNotifications.userId, crmUser.userId))
      .orderBy(desc(crmNotifications.createdAt))
      .limit(50);
    const unreadCount = notifications.filter(n => !n.read).length;
    res.json({
      notifications: notifications.map(n => ({
        id: n.id,
        leadId: n.leadId,
        type: n.type,
        content: n.content,
        read: n.read,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /crm/notifications/:id/read — mark one notification as read
router.post("/:id/read", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  const id = parseInt(req.params.id as string);
  try {
    await db.update(crmNotifications)
      .set({ read: true })
      .where(and(eq(crmNotifications.id, id), eq(crmNotifications.userId, crmUser.userId)));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /crm/notifications/read-all — mark all as read
router.post("/read-all", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  try {
    await db.update(crmNotifications)
      .set({ read: true })
      .where(and(eq(crmNotifications.userId, crmUser.userId), eq(crmNotifications.read, false)));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
