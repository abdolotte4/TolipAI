/**
 * Express bridge to the Python `digor-scraper-engine` FastAPI service.
 *
 * Mounted at `/api/scraper-engine`.  CRM-authenticated endpoints proxy
 * cash-buyer flows; PIN-authenticated endpoints (matching tools.ts) proxy
 * the distressed-property scraper.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { cashBuyerMatches, distressedListings } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
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
    res.json(job);
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
    res.json(job);
  } catch (err) { handleEngineError(err, res); }
});

router.get("/scraper-engine/distressed/:jobId", requirePin, async (req: Request, res: Response) => {
  const jobId = req.params.jobId;
  try {
    const status = await scraperEngine.getJob(jobId);
    let listings: any[] = [];
    if (status.status === "done") {
      try {
        const dbRows = await db.select().from(distressedListings).where(eq(distressedListings.jobId, jobId));
        listings = dbRows;
      } catch { /* fall back to in-memory result */ }
      if (!listings.length && Array.isArray(status.result)) listings = status.result;
    }
    res.json({ ...status, listings });
  } catch (err) { handleEngineError(err, res); }
});

// ─── Job polling (CRM-authed; same shape works for either flow) ──────────────
router.get("/scraper-engine/jobs/:jobId", crmAuth, async (req: Request, res: Response) => {
  try {
    const status = await scraperEngine.getJob(req.params.jobId);
    res.json(status);
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
