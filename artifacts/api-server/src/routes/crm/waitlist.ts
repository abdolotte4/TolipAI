import { Router } from "express";
import { pool } from "@workspace/db";
import { crmAuth, crmAdminOnly } from "./middleware";
import { logger } from "../../lib/logger";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildWhere(
  filters: { status?: string; search?: string; from?: string; to?: string }
): { where: string; params: any[] } {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.status && filters.status !== "all") {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.search?.trim()) {
    params.push(`%${filters.search.trim()}%`);
    const idx = params.length;
    conditions.push(`(email ILIKE $${idx} OR name ILIKE $${idx} OR phone ILIKE $${idx})`);
  }
  if (filters.from) {
    params.push(filters.from);
    conditions.push(`created_at >= $${params.length}::date`);
  }
  if (filters.to) {
    params.push(filters.to);
    conditions.push(`created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

// ── GET / ─────────────────────────────────────────────────────────────────────
// List waitlist entries. Supports: ?status=&search=&from=&to=&page=&limit=
router.get("/", crmAuth, crmAdminOnly, async (req, res) => {
  const { status, search, from, to, page = "1", limit = "50" } =
    req.query as Record<string, string>;

  const pageNum  = Math.max(1, parseInt(page)  || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
  const offset   = (pageNum - 1) * limitNum;

  try {
    const { where, params } = buildWhere({ status, search, from, to });

    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT * FROM crm_waitlist ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limitNum, offset]
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM crm_waitlist ${where}`, params),
    ]);

    const now  = new Date();
    const d7   = new Date(now); d7.setDate(now.getDate() - 7);
    const d30  = new Date(now); d30.setDate(now.getDate() - 30);

    const [s7, s30, sTotal] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM crm_waitlist WHERE created_at >= $1`, [d7]),
      pool.query(`SELECT COUNT(*)::int AS count FROM crm_waitlist WHERE created_at >= $1`, [d30]),
      pool.query(`SELECT COUNT(*)::int AS count FROM crm_waitlist`),
    ]);

    const total = countRow.rows[0]?.total ?? 0;

    res.json({
      rows:       rows.rows,
      total,
      page:       pageNum,
      limit:      limitNum,
      totalPages: Math.ceil(total / limitNum),
      stats: {
        total:      sTotal.rows[0]?.count ?? 0,
        last7days:  s7.rows[0]?.count     ?? 0,
        last30days: s30.rows[0]?.count    ?? 0,
      },
    });
  } catch (err: any) {
    logger.error(err, "[crm/admin/waitlist] GET / error");
    res.status(500).json({ error: err.message });
  }
});

// ── GET /chart ────────────────────────────────────────────────────────────────
// Daily signup counts for the last 30 days — used for the trend chart.
router.get("/chart", crmAuth, crmAdminOnly, async (_req, res) => {
  try {
    const result = await pool.query<{ date: string; count: number }>(`
      SELECT
        TO_CHAR(DATE(created_at), 'Mon DD') AS date,
        COUNT(*)::int                        AS count
      FROM crm_waitlist
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) ASC
    `);
    res.json({ days: result.rows });
  } catch (err: any) {
    logger.error(err, "[crm/admin/waitlist] GET /chart error");
    res.status(500).json({ error: err.message });
  }
});

// ── GET /export ───────────────────────────────────────────────────────────────
// CSV download of all matching entries (respects same filters as GET /).
router.get("/export", crmAuth, crmAdminOnly, async (req, res) => {
  const { status, search, from, to } = req.query as Record<string, string>;

  try {
    const { where, params } = buildWhere({ status, search, from, to });
    const result = await pool.query(
      `SELECT * FROM crm_waitlist ${where} ORDER BY created_at DESC`,
      params
    );

    const esc = (v: any) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return /[,"\n\r]/.test(s) ? `"${s}"` : s;
    };

    const lines = [
      ["ID", "Email", "Name", "Phone", "Source", "Status", "Notes", "Joined At"].join(","),
      ...result.rows.map(r => [
        esc(r.id),
        esc(r.email),
        esc(r.name),
        esc(r.phone),
        esc(r.source),
        esc(r.status),
        esc(r.notes),
        r.created_at ? new Date(r.created_at).toISOString() : "",
      ].join(",")),
    ];

    const date = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="tolipai-waitlist-${date}.csv"`);
    res.send(lines.join("\r\n"));
  } catch (err: any) {
    logger.error(err, "[crm/admin/waitlist] GET /export error");
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /:id ────────────────────────────────────────────────────────────────
// Update status and/or notes on a waitlist entry.
router.patch("/:id", crmAuth, crmAdminOnly, async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body as { status?: string; notes?: string };

  const VALID_STATUSES = ["pending", "contacted", "converted", "nurture", "churned"];
  if (status && !VALID_STATUSES.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
    return;
  }

  const sets: string[] = ["updated_at = NOW()"];
  const params: any[]  = [];

  if (status !== undefined) {
    params.push(status);
    sets.push(`status = $${params.length}`);
  }
  if (notes !== undefined) {
    params.push(notes);
    sets.push(`notes = $${params.length}`);
  }

  if (sets.length === 1) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  try {
    params.push(id);
    const result = await pool.query(
      `UPDATE crm_waitlist SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }

    res.json({ row: result.rows[0] });
  } catch (err: any) {
    logger.error(err, "[crm/admin/waitlist] PATCH /:id error");
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
// Remove a waitlist entry (spam / duplicate cleanup).
router.delete("/:id", crmAuth, crmAdminOnly, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `DELETE FROM crm_waitlist WHERE id = $1`,
      [id]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    logger.error(err, "[crm/admin/waitlist] DELETE /:id error");
    res.status(500).json({ error: err.message });
  }
});

export default router;
