/**
 * Express bridge to the Python `digor-scraper-engine` FastAPI service.
 *
 * Mounted at `/api/scraper-engine`.  CRM-authenticated endpoints proxy
 * cash-buyer flows; PIN-authenticated endpoints (matching tools.ts) proxy
 * the distressed-property scraper.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { cashBuyerMatches, distressedListings, crmLeads } from "@workspace/db/schema";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { crmAuth, type CrmTokenPayload } from "./crm/middleware";
import { scraperEngine, ScraperEngineUnavailable } from "../services/scraperEngineClient";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── PIN auth (mirrors tools.ts) ─────────────────────────────────────────────
function requirePin(req: Request, res: Response, next: NextFunction) {
  const toolsPin = process.env.TOOLS_PIN;
  if (!toolsPin) { res.status(503).json({ error: "TOOLS_PIN not configured" }); return; }
  const provided = req.headers["x-tools-pin"] as string | undefined;
  if (!provided || provided.trim() !== toolsPin.trim()) {
    res.status(401).json({ error: "Invalid PIN" }); return;
  }
  next();
}

function handleEngineError(err: unknown, res: Response) {
  if (err instanceof ScraperEngineUnavailable) {
    logger.warn({ err: err.message }, "scraper engine unavailable");
    res.status(503).json({ error: err.message, engineUnavailable: true });
    return;
  }
  const status = (err as any)?.status || 500;
  const message = (err as any)?.message || "Engine error";
  logger.error({ err: message, status }, "scraper engine error");
  res.status(status).json({ error: message });
}

/**
 * Normalise a job-start response from the Python engine so the frontend
 * always receives:
 *   { id, jobId, status: "queued"|"running"|"completed"|"failed", ... }
 *
 * The Python engine uses snake_case `job_id` and the status string `"done"`.
 */
function normalizeJob(raw: any): any {
  const id = raw?.job_id ?? raw?.id ?? raw?.jobId ?? null;
  const status = raw?.status === "done" ? "completed" : (raw?.status ?? "queued");
  return { ...raw, id, jobId: id, status };
}

/**
 * Normalise a job-status response (GET /jobs/:id) so the frontend sees
 * `status: "completed"` instead of `"done"`, and `id` is always present.
 */
function normalizeStatus(raw: any): any {
  const id = raw?.id ?? raw?.job_id ?? raw?.jobId ?? null;
  const status = raw?.status === "done" ? "completed" : (raw?.status ?? "queued");
  return { ...raw, id, jobId: id, status };
}

// ─── Health (proxy + engine) ─────────────────────────────────────────────────
router.get("/scraper-engine/health", async (_req, res) => {
  try {
    const h = await scraperEngine.health();
    res.json({ ok: true, engine: h });
  } catch (err) { handleEngineError(err, res); }
});

// ─── Cash Buyer AI Match (CRM-authed, per lead) ──────────────────────────────
router.post("/scraper-engine/cash-buyers/:leadId", crmAuth, async (req: Request, res: Response) => {
  const leadId = Number(req.params.leadId);
  if (!Number.isFinite(leadId)) { res.status(400).json({ error: "Invalid leadId" }); return; }
  const user = (req as any).crmUser as CrmTokenPayload;
  const { maxBuyers } = (req.body ?? {}) as { maxBuyers?: number };
  try {
    const job = await scraperEngine.startCashBuyers(leadId, {
      maxBuyers,
      campaignId: user.campaignId ?? undefined,
    });
    res.json(normalizeJob(job));
  } catch (err) { handleEngineError(err, res); }
});

router.get("/scraper-engine/leads/:leadId/buyers", crmAuth, async (req: Request, res: Response) => {
  const leadId = Number(req.params.leadId);
  if (!Number.isFinite(leadId)) { res.status(400).json({ error: "Invalid leadId" }); return; }
  try {
    // Read from DB directly so stale matches are still listable when the engine is offline.
    const rows = await db.select().from(cashBuyerMatches).where(eq(cashBuyerMatches.leadId, leadId));
    rows.sort((a: any, b: any) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
    res.json({ leadId, count: rows.length, buyers: rows });
  } catch (err) {
    logger.error({ err }, "list cash buyers failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── All Cash Buyers (CRM-authed, aggregated across leads) ───────────────────
//
// Powers the /cash-buyers page in the CRM. Lists every cash-buyer match the
// team has ever pulled from any source (Propelio, Propwire, AI), with
// portfolio + score filters and CSV export.
type BuyerListFilters = {
  search?: string;            // matches name/llcName/mailingAddress
  source?: string[];          // e.g. ["propelio","propwire","scraper-engine"]
  buyerType?: string[];       // e.g. ["flipper","landlord"]
  state?: string[];           // 2-letter codes
  minPortfolioSize?: number;
  maxPortfolioSize?: number;
  minScore?: number;
  leadId?: number;
};

function parseListFilters(q: Request["query"]): BuyerListFilters {
  const arr = (v: unknown): string[] | undefined => {
    if (!v) return undefined;
    const list = (Array.isArray(v) ? v : String(v).split(","))
      .map((s) => String(s).trim())
      .filter(Boolean);
    return list.length ? list : undefined;
  };
  const num = (v: unknown): number | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    search: q.search ? String(q.search).trim() : undefined,
    source: arr(q.source),
    buyerType: arr(q.buyerType),
    state: arr(q.state)?.map((s) => s.toUpperCase()),
    minPortfolioSize: num(q.minPortfolioSize),
    maxPortfolioSize: num(q.maxPortfolioSize),
    minScore: num(q.minScore),
    leadId: num(q.leadId),
  };
}

function buildBuyerWhere(
  filters: BuyerListFilters,
  scope: { campaignId: number | null; isSuperAdmin: boolean },
): SQL | undefined {
  const conds: SQL[] = [];

  // Campaign scope: super_admin sees everything; everyone else only their campaign.
  if (!scope.isSuperAdmin && scope.campaignId != null) {
    conds.push(eq(crmLeads.campaignId, scope.campaignId));
  } else if (!scope.isSuperAdmin && scope.campaignId == null) {
    // Non-super-admin without a campaign sees nothing.
    conds.push(sql`false`);
  }

  if (filters.leadId != null) conds.push(eq(cashBuyerMatches.leadId, filters.leadId));
  if (filters.source?.length) conds.push(inArray(cashBuyerMatches.source, filters.source));
  if (filters.buyerType?.length) conds.push(inArray(cashBuyerMatches.buyerType, filters.buyerType));
  if (filters.state?.length) conds.push(inArray(cashBuyerMatches.state, filters.state));
  if (filters.minPortfolioSize != null) conds.push(gte(cashBuyerMatches.portfolioSize, filters.minPortfolioSize));
  if (filters.maxPortfolioSize != null) conds.push(lte(cashBuyerMatches.portfolioSize, filters.maxPortfolioSize));
  if (filters.minScore != null) conds.push(gte(cashBuyerMatches.matchScore, filters.minScore));

  if (filters.search) {
    const like = `%${filters.search.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const searchExpr = or(
      ilike(cashBuyerMatches.buyerName, like),
      ilike(cashBuyerMatches.llcName, like),
      ilike(cashBuyerMatches.mailingAddress, like),
      ilike(cashBuyerMatches.city, like),
    );
    if (searchExpr) conds.push(searchExpr);
  }

  return conds.length ? and(...conds) : undefined;
}

// GET /api/scraper-engine/buyers
//   ?search=...&source=propelio,propwire&buyerType=flipper,landlord
//   &state=GA,FL&minPortfolioSize=5&maxPortfolioSize=500&minScore=40
//   &leadId=123&page=1&limit=50
router.get("/scraper-engine/buyers", crmAuth, async (req: Request, res: Response) => {
  const user = (req as any).crmUser as CrmTokenPayload;
  const filters = parseListFilters(req.query);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const where = buildBuyerWhere(filters, {
    campaignId: user.campaignId ?? null,
    isSuperAdmin: user.role === "super_admin",
  });

  try {
    const baseQuery = db
      .select({
        id: cashBuyerMatches.id,
        leadId: cashBuyerMatches.leadId,
        buyerName: cashBuyerMatches.buyerName,
        llcName: cashBuyerMatches.llcName,
        buyerType: cashBuyerMatches.buyerType,
        matchScore: cashBuyerMatches.matchScore,
        matchReasons: cashBuyerMatches.matchReasons,
        portfolioSize: cashBuyerMatches.portfolioSize,
        portfolioValue: cashBuyerMatches.portfolioValue,
        portfolioAppreciation: cashBuyerMatches.portfolioAppreciation,
        avgPurchasePrice: cashBuyerMatches.avgPurchasePrice,
        lastPurchaseDate: cashBuyerMatches.lastPurchaseDate,
        city: cashBuyerMatches.city,
        state: cashBuyerMatches.state,
        zip: cashBuyerMatches.zip,
        mailingAddress: cashBuyerMatches.mailingAddress,
        phones: cashBuyerMatches.phones,
        emails: cashBuyerMatches.emails,
        principals: cashBuyerMatches.principals,
        source: cashBuyerMatches.source,
        createdAt: cashBuyerMatches.createdAt,
        leadAddress: crmLeads.address,
        leadCampaignId: crmLeads.campaignId,
      })
      .from(cashBuyerMatches)
      .innerJoin(crmLeads, eq(cashBuyerMatches.leadId, crmLeads.id));

    const rows = await (where ? baseQuery.where(where) : baseQuery)
      .orderBy(desc(cashBuyerMatches.matchScore), desc(cashBuyerMatches.createdAt))
      .limit(limit)
      .offset(offset);

    const totalQuery = db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(cashBuyerMatches)
      .innerJoin(crmLeads, eq(cashBuyerMatches.leadId, crmLeads.id));
    const totalRows = await (where ? totalQuery.where(where) : totalQuery);
    const total = totalRows[0]?.count ?? 0;

    res.json({ buyers: rows, total, page, limit });
  } catch (err) {
    logger.error({ err }, "list all cash buyers failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/scraper-engine/buyers/facets — distinct values for filter dropdowns.
router.get("/scraper-engine/buyers/facets", crmAuth, async (req: Request, res: Response) => {
  const user = (req as any).crmUser as CrmTokenPayload;
  const isSuperAdmin = user.role === "super_admin";
  const scopeWhere = isSuperAdmin
    ? undefined
    : (user.campaignId != null ? eq(crmLeads.campaignId, user.campaignId) : sql`false`);

  try {
    const facets = await db
      .select({
        source: cashBuyerMatches.source,
        buyerType: cashBuyerMatches.buyerType,
        state: cashBuyerMatches.state,
      })
      .from(cashBuyerMatches)
      .innerJoin(crmLeads, eq(cashBuyerMatches.leadId, crmLeads.id))
      .where(scopeWhere as any);

    const uniq = (vals: (string | null)[]) =>
      Array.from(new Set(vals.filter((v): v is string => !!v))).sort();

    res.json({
      sources: uniq(facets.map((f) => f.source)),
      buyerTypes: uniq(facets.map((f) => f.buyerType)),
      states: uniq(facets.map((f) => f.state)),
      totalRows: facets.length,
    });
  } catch (err) {
    logger.error({ err }, "buyer facets failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/scraper-engine/buyers/export.csv — same filters, streamed CSV.
router.get("/scraper-engine/buyers/export.csv", crmAuth, async (req: Request, res: Response) => {
  const user = (req as any).crmUser as CrmTokenPayload;
  const filters = parseListFilters(req.query);
  const where = buildBuyerWhere(filters, {
    campaignId: user.campaignId ?? null,
    isSuperAdmin: user.role === "super_admin",
  });

  const csvCell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = Array.isArray(v) ? v.join(" | ") : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  try {
    const baseQuery = db
      .select({
        id: cashBuyerMatches.id,
        buyerName: cashBuyerMatches.buyerName,
        llcName: cashBuyerMatches.llcName,
        buyerType: cashBuyerMatches.buyerType,
        matchScore: cashBuyerMatches.matchScore,
        portfolioSize: cashBuyerMatches.portfolioSize,
        portfolioValue: cashBuyerMatches.portfolioValue,
        portfolioAppreciation: cashBuyerMatches.portfolioAppreciation,
        avgPurchasePrice: cashBuyerMatches.avgPurchasePrice,
        lastPurchaseDate: cashBuyerMatches.lastPurchaseDate,
        city: cashBuyerMatches.city,
        state: cashBuyerMatches.state,
        zip: cashBuyerMatches.zip,
        mailingAddress: cashBuyerMatches.mailingAddress,
        phones: cashBuyerMatches.phones,
        emails: cashBuyerMatches.emails,
        source: cashBuyerMatches.source,
        createdAt: cashBuyerMatches.createdAt,
        leadId: cashBuyerMatches.leadId,
        leadAddress: crmLeads.address,
      })
      .from(cashBuyerMatches)
      .innerJoin(crmLeads, eq(cashBuyerMatches.leadId, crmLeads.id));

    const rows = await (where ? baseQuery.where(where) : baseQuery)
      .orderBy(desc(cashBuyerMatches.matchScore), desc(cashBuyerMatches.createdAt))
      .limit(10000); // safety cap

    const header = [
      "id", "buyer_name", "llc_name", "buyer_type", "match_score",
      "portfolio_size", "portfolio_value", "portfolio_appreciation_pct",
      "avg_purchase_price", "last_purchase_date",
      "city", "state", "zip", "mailing_address",
      "phones", "emails", "source", "discovered_at",
      "lead_id", "lead_address",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push([
        r.id, r.buyerName, r.llcName, r.buyerType, r.matchScore,
        r.portfolioSize, r.portfolioValue, r.portfolioAppreciation,
        r.avgPurchasePrice, r.lastPurchaseDate,
        r.city, r.state, r.zip, r.mailingAddress,
        r.phones, r.emails, r.source,
        r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
        r.leadId, r.leadAddress,
      ].map(csvCell).join(","));
    }

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="cash-buyers-${stamp}.csv"`);
    res.send(lines.join("\n"));
  } catch (err) {
    logger.error({ err }, "buyer csv export failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Distressed (PIN-authed, mirrors tools.ts) ───────────────────────────────
router.get("/scraper-engine/sources", requirePin, async (req: Request, res: Response) => {
  const state = (req.query.state as string | undefined) ?? undefined;
  try {
    const out = await scraperEngine.listSources(state);
    res.json(out);
  } catch (err) { handleEngineError(err, res); }
});

router.post("/scraper-engine/distressed", requirePin, async (req: Request, res: Response) => {
  const { zip, county, countyKey, state, categories, sourceKeys } = (req.body ?? {}) as {
    zip?: string; county?: string; countyKey?: string; state?: string;
    categories?: string[]; sourceKeys?: string[];
  };
  try {
    const job = await scraperEngine.startDistressed({
      zip, state, categories, sourceKeys,
      countyKey: countyKey || county,
    });
    res.json(normalizeJob(job));
  } catch (err) { handleEngineError(err, res); }
});

router.get("/scraper-engine/distressed/:jobId", requirePin, async (req: Request, res: Response) => {
  const jobId = req.params.jobId;
  try {
    const raw = await scraperEngine.getJob(jobId);
    const status = normalizeStatus(raw);
    let listings: any[] = [];
    if (raw.status === "done" || raw.status === "completed") {
      try {
        const dbRows = await db.select().from(distressedListings).where(eq(distressedListings.jobId, jobId));
        listings = dbRows;
      } catch { /* fall back to in-memory result */ }
      if (!listings.length && Array.isArray(raw.result)) listings = raw.result;
    }
    // Put listings under result.listings so the frontend's data.result?.listings check works
    const result = { ...(status.result || {}), listings };
    res.json({ ...status, result, listings });
  } catch (err) { handleEngineError(err, res); }
});

// ─── Job polling (CRM-authed; same shape works for either flow) ──────────────
router.get("/scraper-engine/jobs/:jobId", crmAuth, async (req: Request, res: Response) => {
  try {
    const raw = await scraperEngine.getJob(req.params.jobId);
    res.json(normalizeStatus(raw));
  } catch (err) { handleEngineError(err, res); }
});

// ─── Comps via Propelio (CRM-authed) ─────────────────────────────────────────
router.post("/scraper-engine/comps", crmAuth, async (req: Request, res: Response) => {
  const { address, radiusMiles, maxResults } = (req.body ?? {}) as {
    address?: string; radiusMiles?: number; maxResults?: number;
  };
  if (!address) { res.status(400).json({ error: "address is required" }); return; }
  try {
    const result = await scraperEngine.fetchComps({ address, radiusMiles, maxResults });
    res.json(result);
  } catch (err) { handleEngineError(err, res); }
});

// ─── AI Research (PIN-authed, internal tools) ───────────────────────────────
router.post("/scraper-engine/ai/trustees", requirePin, async (req: Request, res: Response) => {
  const { state, county, maxResults } = (req.body ?? {}) as {
    state?: string; county?: string; maxResults?: number;
  };
  if (!state) { res.status(400).json({ error: "state is required" }); return; }
  try {
    const out = await scraperEngine.discoverTrustees({ state, county, maxResults });
    res.json(out);
  } catch (err) { handleEngineError(err, res); }
});

router.get("/scraper-engine/ai/hedge-fund-markets", requirePin, async (req: Request, res: Response) => {
  const max = Number(req.query.maxResults ?? 12);
  try {
    const out = await scraperEngine.hedgeFundMarkets(Number.isFinite(max) ? max : 12);
    res.json(out);
  } catch (err) { handleEngineError(err, res); }
});

router.post("/scraper-engine/ai/research", requirePin, async (req: Request, res: Response) => {
  const { query, maxResults } = (req.body ?? {}) as { query?: string; maxResults?: number };
  if (!query) { res.status(400).json({ error: "query is required" }); return; }
  try {
    const out = await scraperEngine.aiResearch(query, maxResults ?? 10);
    res.json(out);
  } catch (err) { handleEngineError(err, res); }
});

router.post("/scraper-engine/ai/satellite-dfd", requirePin, async (req: Request, res: Response) => {
  const { zip, city, state, minScore, min_score, maxResults, max_results, useAiScoring, use_ai_scoring } =
    (req.body ?? {}) as {
      zip?: string; city?: string; state?: string;
      minScore?: number; min_score?: number;
      maxResults?: number; max_results?: number;
      useAiScoring?: boolean; use_ai_scoring?: boolean;
    };
  try {
    const out = await scraperEngine.satelliteDfd({
      zip, city, state,
      minScore: minScore ?? min_score,
      maxResults: maxResults ?? max_results,
      useAiScoring: useAiScoring ?? use_ai_scoring,
    });
    res.json(out);
  } catch (err) { handleEngineError(err, res); }
});

// ─── Propelio (authenticated) — cash buyers panel ───────────────────────────
router.post("/scraper-engine/propelio/cash-buyers", crmAuth, async (req: Request, res: Response) => {
  const user = (req as any).crmUser as CrmTokenPayload;
  const {
    address, distanceMiles, activeWithin, minProperties,
    landlords, flippers, maxResults, leadId, persist,
  } = (req.body ?? {}) as {
    address?: string; distanceMiles?: number; activeWithin?: any;
    minProperties?: number; landlords?: boolean; flippers?: boolean;
    maxResults?: number; leadId?: number; persist?: boolean;
  };
  if (!address) { res.status(400).json({ error: "address is required" }); return; }
  try {
    const job = await scraperEngine.startPropelioCashBuyers({
      address, distanceMiles, activeWithin, minProperties,
      landlords, flippers, maxResults, leadId, persist,
      campaignId: user.campaignId ?? undefined,
    });
    res.json(normalizeJob(job));
  } catch (err) { handleEngineError(err, res); }
});

// ─── Propwire — property details, comps, history, nearby cash buyers ─────────
router.post("/scraper-engine/propwire/property", crmAuth, async (req: Request, res: Response) => {
  const { query } = (req.body ?? {}) as { query?: string };
  if (!query) { res.status(400).json({ error: "query is required" }); return; }
  try { res.json(await scraperEngine.propwireProperty(query)); }
  catch (err) { handleEngineError(err, res); }
});

router.post("/scraper-engine/propwire/comps", crmAuth, async (req: Request, res: Response) => {
  const { query } = (req.body ?? {}) as { query?: string };
  if (!query) { res.status(400).json({ error: "query is required" }); return; }
  try { res.json(await scraperEngine.propwireComps(query)); }
  catch (err) { handleEngineError(err, res); }
});

router.post("/scraper-engine/propwire/history", crmAuth, async (req: Request, res: Response) => {
  const { query } = (req.body ?? {}) as { query?: string };
  if (!query) { res.status(400).json({ error: "query is required" }); return; }
  try { res.json(await scraperEngine.propwireHistory(query)); }
  catch (err) { handleEngineError(err, res); }
});

router.post("/scraper-engine/propwire/cash-buyers-nearby", crmAuth, async (req: Request, res: Response) => {
  const user = (req as any).crmUser as CrmTokenPayload;
  const { query, radiusMiles, minProperties, maxResults, leadId, persist } =
    (req.body ?? {}) as {
      query?: string; radiusMiles?: number; minProperties?: number;
      maxResults?: number; leadId?: number; persist?: boolean;
    };
  if (!query) { res.status(400).json({ error: "query is required" }); return; }
  try {
    const job = await scraperEngine.startPropwireCashBuyers({
      query, radiusMiles, minProperties, maxResults, leadId, persist,
      campaignId: user.campaignId ?? undefined,
    });
    res.json(normalizeJob(job));
  } catch (err) { handleEngineError(err, res); }
});

// ─── Skip-trace (CRM-authed, sync) ───────────────────────────────────────────
router.post("/scraper-engine/skip-trace", crmAuth, async (req: Request, res: Response) => {
  const { name, llc, address, state } = (req.body ?? {}) as {
    name?: string; llc?: string; address?: string; state?: string;
  };
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  try {
    const result = await scraperEngine.skipTrace({ name, llc, address, state });
    res.json(result);
  } catch (err) { handleEngineError(err, res); }
});

export default router;
