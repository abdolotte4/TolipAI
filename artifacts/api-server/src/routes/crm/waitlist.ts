import { Router } from "express";
import { db } from "@workspace/db";
import { crmLeads } from "@workspace/db/schema";
import { eq, ilike, gte, lte, desc, or, and, sql } from "drizzle-orm";
import { crmAuth, crmAdminOnly } from "./middleware";
import { logger } from "../../lib/logger";

const router = Router();

// ── GET / ─────────────────────────────────────────────────────────────────────
// List waitlist signups with optional search, date range, and pagination.
// Query: search, from (ISO date), to (ISO date), page, limit
router.get("/", crmAuth, crmAdminOnly, async (req, res) => {
  const { search, from, to, page = "1", limit = "50" } = req.query as Record<string, string>;

  const pageNum  = Math.max(1, parseInt(page)  || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
  const offset   = (pageNum - 1) * limitNum;

  try {
    const base = eq(crmLeads.leadSource, "landing_page_waitlist");
    const extra: ReturnType<typeof eq>[] = [];

    if (search?.trim()) {
      extra.push(
        or(
          ilike(crmLeads.email,     `%${search.trim()}%`),
          ilike(crmLeads.firstName, `%${search.trim()}%`),
          ilike(crmLeads.lastName,  `%${search.trim()}%`),
        ) as any
      );
    }
    if (from) extra.push(gte(crmLeads.createdAt, new Date(from)) as any);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      extra.push(lte(crmLeads.createdAt, toDate) as any);
    }

    const where = extra.length ? and(base, ...extra) : base;

    const now  = new Date();
    const d7   = new Date(now); d7.setDate(now.getDate() - 7);
    const d30  = new Date(now); d30.setDate(now.getDate() - 30);

    const [rows, totalRes, s7, s30] = await Promise.all([
      db.select({
        id:        crmLeads.id,
        firstName: crmLeads.firstName,
        lastName:  crmLeads.lastName,
        email:     crmLeads.email,
        notes:     crmLeads.notes,
        createdAt: crmLeads.createdAt,
      })
        .from(crmLeads)
        .where(where)
        .orderBy(desc(crmLeads.createdAt))
        .limit(limitNum)
        .offset(offset),

      db.select({ count: sql<number>`count(*)::int` })
        .from(crmLeads).where(where),

      db.select({ count: sql<number>`count(*)::int` })
        .from(crmLeads)
        .where(and(eq(crmLeads.leadSource, "landing_page_waitlist"), gte(crmLeads.createdAt, d7))),

      db.select({ count: sql<number>`count(*)::int` })
        .from(crmLeads)
        .where(and(eq(crmLeads.leadSource, "landing_page_waitlist"), gte(crmLeads.createdAt, d30))),
    ]);

    const total = totalRes[0]?.count ?? 0;

    res.json({
      rows,
      total,
      page:       pageNum,
      limit:      limitNum,
      totalPages: Math.ceil(total / limitNum),
      stats: {
        total,
        last7days:  s7[0]?.count  ?? 0,
        last30days: s30[0]?.count ?? 0,
      },
    });
  } catch (err: any) {
    logger.error(err, "[crm/admin/waitlist] list error");
    res.status(500).json({ error: err.message });
  }
});

// ── GET /export ───────────────────────────────────────────────────────────────
// Downloads all matching waitlist entries as a CSV file.
router.get("/export", crmAuth, crmAdminOnly, async (req, res) => {
  const { search, from, to } = req.query as Record<string, string>;

  try {
    const base = eq(crmLeads.leadSource, "landing_page_waitlist");
    const extra: ReturnType<typeof eq>[] = [];

    if (search?.trim()) {
      extra.push(
        or(
          ilike(crmLeads.email,     `%${search.trim()}%`),
          ilike(crmLeads.firstName, `%${search.trim()}%`),
          ilike(crmLeads.lastName,  `%${search.trim()}%`),
        ) as any
      );
    }
    if (from) extra.push(gte(crmLeads.createdAt, new Date(from)) as any);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      extra.push(lte(crmLeads.createdAt, toDate) as any);
    }

    const where = extra.length ? and(base, ...extra) : base;

    const rows = await db.select({
      id:        crmLeads.id,
      firstName: crmLeads.firstName,
      lastName:  crmLeads.lastName,
      email:     crmLeads.email,
      notes:     crmLeads.notes,
      createdAt: crmLeads.createdAt,
    })
      .from(crmLeads)
      .where(where)
      .orderBy(desc(crmLeads.createdAt));

    const esc = (v: any) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return /[,"\n\r]/.test(s) ? `"${s}"` : s;
    };

    const lines = [
      ["ID", "First Name", "Last Name", "Email", "Notes", "Joined At"].join(","),
      ...rows.map((r: typeof rows[number]) => [
        r.id,
        esc(r.firstName),
        esc(r.lastName),
        esc(r.email),
        esc(r.notes),
        r.createdAt ? new Date(r.createdAt).toISOString() : "",
      ].join(",")),
    ];

    const date = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="tolipai-waitlist-${date}.csv"`);
    res.send(lines.join("\r\n"));
  } catch (err: any) {
    logger.error(err, "[crm/admin/waitlist] export error");
    res.status(500).json({ error: err.message });
  }
});

export default router;
