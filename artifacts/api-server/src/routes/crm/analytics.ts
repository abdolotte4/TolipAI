import { Router } from "express";
import { db } from "@workspace/db";
import { crmLeads, crmCallLogs, crmUsers, crmCampaigns } from "@workspace/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { crmAuth } from "./middleware";
import { logger } from "../../lib/logger";

const router = Router();

// ── GET /api/crm/analytics/dashboard ─────────────────────────────────────────
// Lead velocity, conversion funnel, avg days-to-close, top sources.

router.get("/dashboard", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  const isSuperAdmin = crmUser.role === "super_admin";
  const campaignId = crmUser.campaignId;

  // Safe integer — never user-supplied freeform text
  const campaignSql = (!isSuperAdmin && campaignId)
    ? sql`AND campaign_id = ${campaignId}`
    : sql``;

  const campaignWhere = (!isSuperAdmin && campaignId)
    ? sql`WHERE campaign_id = ${campaignId}`
    : sql`WHERE 1=1`;

  try {
    const _dashboardResults = await Promise.allSettled([
      // Lead velocity: new leads per week for past 8 weeks
      db.execute(sql`
        SELECT
          to_char(date_trunc('week', created_at), 'Mon DD') AS week,
          date_trunc('week', created_at)::date AS week_start,
          count(*)::int AS count
        FROM crm_leads
        WHERE created_at >= NOW() - INTERVAL '8 weeks'
          ${campaignSql}
        GROUP BY 1, 2
        ORDER BY 2
      `),

      // Conversion funnel counts
      db.execute(sql`
        SELECT status, count(*)::int AS count
        FROM crm_leads
        ${campaignWhere}
        GROUP BY status
        ORDER BY count DESC
      `),

      // Avg days to close
      db.execute(sql`
        SELECT
          round(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400), 1)::float AS avg_days,
          count(*)::int AS total_closed
        FROM crm_leads
        WHERE status = 'closed'
          ${campaignSql}
      `),

      // Top lead sources
      db.execute(sql`
        SELECT
          COALESCE(lead_source, 'Unknown') AS source,
          count(*)::int AS count
        FROM crm_leads
        ${campaignWhere}
          AND lead_source IS NOT NULL
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 8
      `),

      // Weekly trend for past 12 weeks (all leads)
      db.execute(sql`
        SELECT
          to_char(date_trunc('week', created_at), 'Mon DD') AS week,
          date_trunc('week', created_at)::date AS week_start,
          count(*) FILTER (WHERE status = 'new')::int AS new_count,
          count(*) FILTER (WHERE status = 'contacted')::int AS contacted_count,
          count(*) FILTER (WHERE status = 'under_contract')::int AS contract_count,
          count(*) FILTER (WHERE status = 'closed')::int AS closed_count,
          count(*)::int AS total
        FROM crm_leads
        WHERE created_at >= NOW() - INTERVAL '12 weeks'
          ${campaignSql}
        GROUP BY 1, 2
        ORDER BY 2
      `),
    ]);
    const [velocityR, funnelR, avgCloseR, sourceR, weeklyTrendR] = _dashboardResults;
    _dashboardResults.forEach((r, i) => {
      if (r.status === "rejected") logger.warn({ reason: (r as PromiseRejectedResult).reason?.message, i }, "[crm/analytics/dashboard] sub-query failed");
    });
    const velocityRows   = velocityR.status    === "fulfilled" ? velocityR.value    : { rows: [] };
    const funnelRows     = funnelR.status      === "fulfilled" ? funnelR.value      : { rows: [] };
    const avgCloseRows   = avgCloseR.status    === "fulfilled" ? avgCloseR.value    : { rows: [{}] };
    const sourceRows     = sourceR.status      === "fulfilled" ? sourceR.value      : { rows: [] };
    const weeklyTrendRows= weeklyTrendR.status === "fulfilled" ? weeklyTrendR.value : { rows: [] };

    // Total leads
    const totalsResult = await db.execute(sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status = 'closed')::int AS closed,
        count(*) FILTER (WHERE status = 'under_contract')::int AS under_contract,
        count(*) FILTER (WHERE status = 'new')::int AS new_count
      FROM crm_leads
      ${campaignWhere}
    `);

    const funnelOrder = ["new", "contacted", "qualified", "under_contract", "closed", "dead"];
    const funnelMap = Object.fromEntries((funnelRows.rows as any[]).map(r => [r.status, r.count]));
    const funnel = funnelOrder
      .filter(s => funnelMap[s] != null)
      .map(s => ({ status: s, count: funnelMap[s] as number }));

    const totals = (totalsResult.rows[0] ?? {}) as any;
    const closeRate = totals.total > 0
      ? Math.round((totals.closed / totals.total) * 100)
      : 0;

    res.json({
      summary: {
        totalLeads: Number(totals.total) || 0,
        closedLeads: Number(totals.closed) || 0,
        underContract: Number(totals.under_contract) || 0,
        newLeads: Number(totals.new_count) || 0,
        closeRate,
        avgDaysToClose: (avgCloseRows.rows[0] as any)?.avg_days
          ? Number((avgCloseRows.rows[0] as any).avg_days)
          : null,
        totalClosed: (avgCloseRows.rows[0] as any)?.total_closed
          ? Number((avgCloseRows.rows[0] as any).total_closed)
          : 0,
      },
      velocity: (velocityRows.rows as any[]).map(r => ({
        week: r.week,
        count: Number(r.count),
      })),
      weeklyTrend: (weeklyTrendRows.rows as any[]).map(r => ({
        week: r.week,
        new: Number(r.new_count),
        contacted: Number(r.contacted_count),
        contract: Number(r.contract_count),
        closed: Number(r.closed_count),
        total: Number(r.total),
      })),
      funnel,
      topSources: (sourceRows.rows as any[]).map(r => ({
        source: r.source,
        count: Number(r.count),
      })),
    });
  } catch (err: any) {
    logger.warn({ err: err.message }, "[crm/analytics/dashboard] returning empty data");
    res.json({
      summary: { totalLeads: 0, closedLeads: 0, underContract: 0, newLeads: 0, closeRate: 0, avgDaysToClose: null, totalClosed: 0 },
      velocity: [], weeklyTrend: [], funnel: [], topSources: [],
    });
  }
});

// ── GET /api/crm/analytics/calls ─────────────────────────────────────────────
// Call volume, avg duration, disposition breakdown, per-agent stats.

router.get("/calls", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  const isSuperAdmin = crmUser.role === "super_admin";
  const campaignId = crmUser.campaignId;

  const campaignSql = (!isSuperAdmin && campaignId)
    ? sql`AND campaign_id = ${campaignId}`
    : sql``;

  const campaignWhere = (!isSuperAdmin && campaignId)
    ? sql`WHERE campaign_id = ${campaignId}`
    : sql`WHERE 1=1`;

  try {
    const _callsResults = await Promise.allSettled([
      // Call volume + avg duration by week for past 8 weeks
      db.execute(sql`
        SELECT
          to_char(date_trunc('week', created_at), 'Mon DD') AS week,
          date_trunc('week', created_at)::date AS week_start,
          count(*)::int AS calls,
          round(AVG(NULLIF(duration, 0)), 0)::int AS avg_duration_sec,
          count(*) FILTER (WHERE direction = 'outbound')::int AS outbound,
          count(*) FILTER (WHERE direction = 'inbound')::int AS inbound
        FROM crm_call_logs
        WHERE created_at >= NOW() - INTERVAL '8 weeks'
          ${campaignSql}
        GROUP BY 1, 2
        ORDER BY 2
      `),

      // Disposition breakdown
      db.execute(sql`
        SELECT
          COALESCE(disposition, status, 'unknown') AS disposition,
          count(*)::int AS count
        FROM crm_call_logs
        ${campaignWhere}
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 10
      `),

      // Per-agent stats (top 20)
      db.execute(sql`
        SELECT
          cl.user_id,
          u.name AS agent_name,
          count(*)::int AS total_calls,
          count(*) FILTER (WHERE cl.direction = 'outbound')::int AS outbound,
          round(AVG(NULLIF(cl.duration, 0)), 0)::int AS avg_duration_sec,
          sum(COALESCE(cl.duration, 0))::int AS total_duration_sec,
          count(*) FILTER (WHERE cl.disposition = 'answered')::int AS answered
        FROM crm_call_logs cl
        LEFT JOIN crm_users u ON u.id = cl.user_id
        ${campaignWhere}
          AND cl.user_id IS NOT NULL
        GROUP BY cl.user_id, u.name
        ORDER BY total_calls DESC
        LIMIT 20
      `),

      // Overall summary
      db.execute(sql`
        SELECT
          count(*)::int AS total_calls,
          count(*) FILTER (WHERE direction = 'outbound')::int AS outbound,
          count(*) FILTER (WHERE direction = 'inbound')::int AS inbound,
          round(AVG(NULLIF(duration, 0)), 0)::int AS avg_duration_sec,
          sum(COALESCE(duration, 0))::int AS total_duration_sec,
          count(*) FILTER (WHERE disposition = 'answered' OR status = 'completed')::int AS answered,
          count(DISTINCT user_id)::int AS active_agents
        FROM crm_call_logs
        ${campaignWhere}
      `),
    ]);
    const [volumeR, dispositionR, agentCallsR, summaryR] = _callsResults;
    _callsResults.forEach((r, i) => {
      if (r.status === "rejected") logger.warn({ reason: (r as PromiseRejectedResult).reason?.message, i }, "[crm/analytics/calls] sub-query failed");
    });
    const volumeRows      = volumeR.status      === "fulfilled" ? volumeR.value      : { rows: [] };
    const dispositionRows = dispositionR.status === "fulfilled" ? dispositionR.value : { rows: [] };
    const agentRows       = agentCallsR.status  === "fulfilled" ? agentCallsR.value  : { rows: [] };
    const summaryRows     = summaryR.status     === "fulfilled" ? summaryR.value     : { rows: [{}] };

    const summary = summaryRows.rows[0] as any;

    res.json({
      summary: {
        totalCalls: Number(summary?.total_calls) || 0,
        outbound: Number(summary?.outbound) || 0,
        inbound: Number(summary?.inbound) || 0,
        avgDurationSec: summary?.avg_duration_sec ? Number(summary.avg_duration_sec) : null,
        totalDurationSec: Number(summary?.total_duration_sec) || 0,
        answered: Number(summary?.answered) || 0,
        answerRate: summary?.total_calls > 0
          ? Math.round((Number(summary.answered) / Number(summary.total_calls)) * 100)
          : 0,
        activeAgents: Number(summary?.active_agents) || 0,
      },
      volume: (volumeRows.rows as any[]).map(r => ({
        week: r.week,
        calls: Number(r.calls),
        avgDuration: r.avg_duration_sec ? Number(r.avg_duration_sec) : 0,
        outbound: Number(r.outbound),
        inbound: Number(r.inbound),
      })),
      dispositions: (dispositionRows.rows as any[]).map(r => ({
        name: r.disposition,
        value: Number(r.count),
      })),
      agents: (agentRows.rows as any[]).map(r => ({
        userId: r.user_id,
        name: r.agent_name || `Agent #${r.user_id}`,
        totalCalls: Number(r.total_calls),
        outbound: Number(r.outbound),
        avgDuration: r.avg_duration_sec ? Number(r.avg_duration_sec) : 0,
        totalDuration: Number(r.total_duration_sec),
        answered: Number(r.answered),
      })),
    });
  } catch (err: any) {
    logger.warn({ err: err.message }, "[crm/analytics/calls] returning empty data");
    res.json({
      summary: { totalCalls: 0, outbound: 0, inbound: 0, avgDurationSec: null, totalDurationSec: 0, answered: 0, answerRate: 0, activeAgents: 0 },
      volume: [], dispositions: [], agents: [],
    });
  }
});

// ── GET /api/crm/analytics/call-quality ───────────────────────────────────────
// Per-agent MOS score, jitter, and packet loss aggregates for the campaign.
// Query param: ?days=30 (max 90)
router.get("/call-quality", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  const isSuperAdmin = crmUser.role === "super_admin";
  const campaignId = crmUser.campaignId;
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 90);

  const campaignFilter = (!isSuperAdmin && campaignId)
    ? sql`AND cl.campaign_id = ${campaignId}`
    : sql``;

  const campaignFilterPlain = (!isSuperAdmin && campaignId)
    ? sql`AND campaign_id = ${campaignId}`
    : sql``;

  try {
    const _qualityResults = await Promise.allSettled([

      // Campaign-level summary
      db.execute(sql`
        SELECT
          COUNT(*)::int                                               AS total_calls,
          COUNT(*) FILTER (WHERE mos_score IS NOT NULL)::int         AS calls_with_quality,
          ROUND(AVG(mos_score)::numeric, 2)                         AS avg_mos,
          ROUND(AVG(jitter_ms)::numeric, 2)                         AS avg_jitter,
          ROUND(AVG(packet_loss_pct)::numeric, 2)                   AS avg_packet_loss,
          COUNT(*) FILTER (WHERE mos_score < 3.0)::int              AS poor_calls,
          COUNT(*) FILTER (WHERE mos_score >= 3.0 AND mos_score < 3.5)::int AS fair_calls,
          COUNT(*) FILTER (WHERE mos_score >= 3.5 AND mos_score < 4.0)::int AS good_calls,
          COUNT(*) FILTER (WHERE mos_score >= 4.0)::int             AS excellent_calls
        FROM crm_call_logs
        WHERE created_at >= NOW() - make_interval(days => ${days})
          ${campaignFilterPlain}
      `),

      // Per-agent breakdown
      db.execute(sql`
        SELECT
          u.id                                                        AS user_id,
          COALESCE(u.name, u.email)                                  AS agent_name,
          u.email                                                     AS agent_email,
          COUNT(cl.id)::int                                          AS total_calls,
          COUNT(cl.id) FILTER (WHERE cl.mos_score IS NOT NULL)::int AS calls_with_quality,
          ROUND(AVG(cl.mos_score)::numeric, 2)                      AS avg_mos,
          ROUND(MIN(cl.mos_score)::numeric, 2)                      AS min_mos,
          ROUND(MAX(cl.mos_score)::numeric, 2)                      AS max_mos,
          ROUND(AVG(cl.jitter_ms)::numeric, 2)                      AS avg_jitter,
          ROUND(AVG(cl.packet_loss_pct)::numeric, 2)                AS avg_packet_loss,
          ROUND(AVG(cl.duration)::numeric, 0)                       AS avg_duration_sec,
          COUNT(cl.id) FILTER (WHERE cl.mos_score IS NOT NULL AND cl.mos_score < 3.0)::int              AS poor_calls,
          COUNT(cl.id) FILTER (WHERE cl.mos_score IS NOT NULL AND cl.mos_score >= 3.0 AND cl.mos_score < 3.5)::int AS fair_calls,
          COUNT(cl.id) FILTER (WHERE cl.mos_score IS NOT NULL AND cl.mos_score >= 3.5 AND cl.mos_score < 4.0)::int AS good_calls,
          COUNT(cl.id) FILTER (WHERE cl.mos_score IS NOT NULL AND cl.mos_score >= 4.0)::int             AS excellent_calls,
          ROUND(CAST(AVG(cl.mos_score) FILTER (WHERE cl.created_at >= NOW() - make_interval(days => 7)) AS numeric), 2) AS mos_last_7d,
          ROUND(CAST(AVG(cl.mos_score) FILTER (WHERE cl.created_at >= NOW() - make_interval(days => 14) AND cl.created_at < NOW() - make_interval(days => 7)) AS numeric), 2) AS mos_prev_7d
        FROM crm_users u
        INNER JOIN crm_call_logs cl ON cl.user_id = u.id
        WHERE cl.created_at >= NOW() - make_interval(days => ${days})
          ${campaignFilter}
        GROUP BY u.id, u.name, u.email
        ORDER BY avg_mos DESC NULLS LAST
      `),

      // Daily MOS trend
      db.execute(sql`
        SELECT
          to_char(date_trunc('day', cl.created_at), 'Mon DD') AS day,
          date_trunc('day', cl.created_at)::date              AS day_date,
          ROUND(AVG(cl.mos_score)::numeric, 2)               AS avg_mos,
          ROUND(AVG(cl.jitter_ms)::numeric, 2)               AS avg_jitter,
          COUNT(cl.id)::int                                   AS calls
        FROM crm_call_logs cl
        WHERE cl.created_at >= NOW() - make_interval(days => ${days})
          AND cl.mos_score IS NOT NULL
          ${campaignFilter}
        GROUP BY 1, 2
        ORDER BY 2
      `),
    ]);
    const [summaryQR, agentQR, trendQR] = _qualityResults;
    _qualityResults.forEach((r, i) => {
      if (r.status === "rejected") logger.warn({ reason: (r as PromiseRejectedResult).reason?.message, i }, "[crm/analytics/call-quality] sub-query failed");
    });
    const summaryRows = summaryQR.status === "fulfilled" ? summaryQR.value : { rows: [{}] };
    const agentRows   = agentQR.status   === "fulfilled" ? agentQR.value   : { rows: [] };
    const trendRows   = trendQR.status   === "fulfilled" ? trendQR.value   : { rows: [] };

    const summary = (summaryRows.rows as any[])[0] || {};

    res.json({
      days,
      summary: {
        totalCalls:       Number(summary.total_calls)       || 0,
        callsWithQuality: Number(summary.calls_with_quality)|| 0,
        avgMos:           summary.avg_mos         != null ? Number(summary.avg_mos)         : null,
        avgJitter:        summary.avg_jitter      != null ? Number(summary.avg_jitter)      : null,
        avgPacketLoss:    summary.avg_packet_loss != null ? Number(summary.avg_packet_loss) : null,
        bands: {
          excellent: Number(summary.excellent_calls) || 0,
          good:      Number(summary.good_calls)      || 0,
          fair:      Number(summary.fair_calls)      || 0,
          poor:      Number(summary.poor_calls)      || 0,
        },
      },
      agents: (agentRows.rows as any[]).map(r => ({
        userId:           r.user_id,
        name:             r.agent_name || `Agent #${r.user_id}`,
        email:            r.agent_email,
        totalCalls:       Number(r.total_calls),
        callsWithQuality: Number(r.calls_with_quality),
        avgMos:           r.avg_mos         != null ? Number(r.avg_mos)         : null,
        minMos:           r.min_mos         != null ? Number(r.min_mos)         : null,
        maxMos:           r.max_mos         != null ? Number(r.max_mos)         : null,
        avgJitter:        r.avg_jitter      != null ? Number(r.avg_jitter)      : null,
        avgPacketLoss:    r.avg_packet_loss != null ? Number(r.avg_packet_loss) : null,
        avgDuration:      r.avg_duration_sec!= null ? Number(r.avg_duration_sec): null,
        bands: {
          excellent: Number(r.excellent_calls) || 0,
          good:      Number(r.good_calls)      || 0,
          fair:      Number(r.fair_calls)      || 0,
          poor:      Number(r.poor_calls)      || 0,
        },
        mosLast7d:  r.mos_last_7d  != null ? Number(r.mos_last_7d)  : null,
        mosPrev7d:  r.mos_prev_7d  != null ? Number(r.mos_prev_7d)  : null,
      })),
      trend: (trendRows.rows as any[]).map(r => ({
        day:      r.day,
        avgMos:   r.avg_mos   != null ? Number(r.avg_mos)   : null,
        avgJitter:r.avg_jitter!= null ? Number(r.avg_jitter): null,
        calls:    Number(r.calls),
      })),
    });
  } catch (err: any) {
    logger.warn({ err: err.message }, "[crm/analytics/call-quality] returning empty data");
    res.json({
      days,
      summary: { totalCalls: 0, callsWithQuality: 0, avgMos: null, avgJitter: null, avgPacketLoss: null, bands: { excellent: 0, good: 0, fair: 0, poor: 0 } },
      agents: [], trend: [],
    });
  }
});

// ── GET /api/crm/analytics/campaigns ─────────────────────────────────────────
// Per-campaign close rates, lead counts, and performance notes.
// Super-admins see all campaigns; campaign users see only their own.
router.get("/campaigns", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  const isSuperAdmin = crmUser.role === "super_admin";
  const campaignId = crmUser.campaignId;

  const campaignFilter = (!isSuperAdmin && campaignId)
    ? sql`AND l.campaign_id = ${campaignId}`
    : sql``;

  try {
    const rows = await db.execute(sql`
      SELECT
        c.id                                                        AS campaign_id,
        c.name                                                      AS campaign_name,
        COUNT(l.id)::int                                            AS total_leads,
        COUNT(l.id) FILTER (WHERE l.status = 'closed')::int        AS closed_leads,
        COUNT(l.id) FILTER (WHERE l.status = 'under_contract')::int AS under_contract,
        COUNT(l.id) FILTER (WHERE l.status = 'new')::int           AS new_leads,
        COUNT(l.id) FILTER (WHERE l.status = 'contacted')::int     AS contacted_leads,
        ROUND(
          CASE WHEN COUNT(l.id) > 0
            THEN COUNT(l.id) FILTER (WHERE l.status = 'closed')::numeric / COUNT(l.id) * 100
            ELSE 0
          END, 1
        )::float AS close_rate,
        ROUND(AVG(
          CASE WHEN l.status = 'closed'
            THEN EXTRACT(EPOCH FROM (l.updated_at - l.created_at)) / 86400
          END
        )::numeric, 1)::float AS avg_days_to_close
      FROM crm_campaigns c
      LEFT JOIN crm_leads l ON l.campaign_id = c.id
        ${campaignFilter}
      GROUP BY c.id, c.name
      ORDER BY close_rate DESC, total_leads DESC
    `);

    res.json({
      campaigns: (rows.rows as any[]).map(r => ({
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        totalLeads: Number(r.total_leads) || 0,
        closedLeads: Number(r.closed_leads) || 0,
        underContract: Number(r.under_contract) || 0,
        newLeads: Number(r.new_leads) || 0,
        contactedLeads: Number(r.contacted_leads) || 0,
        closeRate: r.close_rate != null ? Number(r.close_rate) : 0,
        avgDaysToClose: r.avg_days_to_close != null ? Number(r.avg_days_to_close) : null,
      })),
    });
  } catch (err: any) {
    logger.warn({ err: err.message }, "[crm/analytics/campaigns] returning empty data");
    res.json({ campaigns: [] });
  }
});

export default router;
