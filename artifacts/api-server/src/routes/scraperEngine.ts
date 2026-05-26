/**
 * Express bridge to the Python `tolipai-scraper-engine` FastAPI service.
 *
 * Mounted at `/api/scraper-engine`.  CRM-authenticated endpoints proxy
 * cash-buyer flows; PIN-authenticated endpoints (matching tools.ts) proxy
 * the distressed-property scraper.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { csvCell } from "../lib/textUtils";
import { cashBuyerMatches, crmLeads, crmCampaigns } from "@workspace/db/schema";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { crmAuth, type CrmTokenPayload } from "./crm/middleware";
import { scraperEngine, ScraperEngineUnavailable } from "../services/scraperEngineClient";
import { encryptPassword, decryptPassword } from "./crm/crypto-util";
import { runSkipTrace } from "../services/propertyApi";
import { logger } from "../lib/logger";

const router: IRouter = Router();

type ScraperService = "propelio" | "propwire";

// ─── Dual-auth middleware — accepts CRM JWT OR Tools PIN ──────────────────────
// Used for endpoints called from both the CRM (Bearer token) and the Tools
// site (X-Tools-Pin).  Checks PIN first (cheap string compare) then falls
// through to full JWT validation.
function crmOrPinAuth(req: Request, res: Response, next: () => void): void {
  const toolsPin = process.env.TOOLS_PIN;
  const provided = req.headers["x-tools-pin"] as string | undefined;
  if (toolsPin && provided && provided.trim() === toolsPin.trim()) {
    return next();
  }
  return crmAuth(req, res, next);
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function handleEngineError(err: unknown, res: Response): void {
  if (err instanceof ScraperEngineUnavailable) {
    res.status(503).json({ error: err.message });
    return;
  }
  const upstreamStatus = (err as any)?.status;
  const httpStatus = typeof upstreamStatus === "number" && upstreamStatus >= 400 && upstreamStatus < 600
    ? upstreamStatus
    : 500;
  res.status(httpStatus).json({ error: toMessage(err) });
}

function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [user, domain] = email.split("@");
  if (!domain) return email;
  return `${user.slice(0, 2)}••@${domain}`;
}

async function saveCampaignCreds(
  campaignId: number,
  service: ScraperService,
  email: string,
  password: string,
): Promise<{ configured: boolean }> {
  const encEmail = email ? encryptPassword(email) : null;
  const encPass = password ? encryptPassword(password) : null;
  const update: Partial<typeof crmCampaigns.$inferInsert> =
    service === "propelio"
      ? { scraperProperioEmail: encEmail, scraperProperioPassword: encPass }
      : { scraperPropwireEmail: encEmail, scraperPropwirePassword: encPass };
  await db.update(crmCampaigns).set(update).where(eq(crmCampaigns.id, campaignId));
  return { configured: !!(encEmail && encPass) };
}

async function getMaskedConfig(
  campaignId: number,
  service: ScraperService,
): Promise<{ configured: boolean; emailMasked: string | null; sessionActive: boolean }> {
  const [campaign] = await db
    .select()
    .from(crmCampaigns)
    .where(eq(crmCampaigns.id, campaignId))
    .limit(1);
  const rawEmail =
    service === "propelio" ? campaign?.scraperProperioEmail : campaign?.scraperPropwireEmail;
  const rawPass =
    service === "propelio"
      ? campaign?.scraperProperioPassword
      : campaign?.scraperPropwirePassword;
  const sessionActive = await scraperEngine
    .sessionStatus(service)
    .then((r) => r.active)
    .catch(() => false);
  return {
    configured: !!(rawEmail && rawPass),
    emailMasked: maskEmail(rawEmail),
    sessionActive,
  };
}

// ─── Propelio integration ─────────────────────────────────────────────────────

router.get("/scraper-engine/integrations/propelio", crmAuth, async (req: Request, res: Response) => {
  try {
    const user = req.crmUser as CrmTokenPayload;
    const campaignId = user.role === "super_admin" ? (user.campaignId ?? 1) : user.campaignId;
    if (!campaignId) {
      res.status(200).json({ configured: false, emailMasked: null, sessionActive: false });
      return;
    }
    res.json(await getMaskedConfig(campaignId, "propelio"));
  } catch (err: unknown) {
    res.status(500).json({ error: toMessage(err) });
  }
});

router.post("/scraper-engine/integrations/propelio", crmAuth, async (req: Request, res: Response) => {
  try {
    const user = req.crmUser as CrmTokenPayload;
    const campaignId =
      user.role === "super_admin"
        ? Number(req.body.campaignId ?? user.campaignId ?? 1)
        : user.campaignId;
    if (!campaignId) {
      res.status(400).json({ error: "No campaign available" });
      return;
    }
    const { email, password } = req.body as { email?: string; password?: string };
    res.json(await saveCampaignCreds(campaignId, "propelio", email ?? "", password ?? ""));
  } catch (err: unknown) {
    res.status(500).json({ error: toMessage(err) });
  }
});

router.delete(
  "/scraper-engine/integrations/propelio/session",
  crmAuth,
  async (_req: Request, res: Response) => {
    try {
      await scraperEngine.invalidateSession("propelio");
      res.json({ success: true });
    } catch (err: unknown) {
      handleEngineError(err, res);
    }
  },
);

router.post(
  "/scraper-engine/integrations/propelio/test",
  crmAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.crmUser as CrmTokenPayload;
      const campaignId =
        user.role === "super_admin"
          ? Number(req.body.campaignId ?? user.campaignId ?? 1)
          : user.campaignId;
      if (!campaignId) {
        res.status(400).json({ success: false, error: "No campaign available" });
        return;
      }
      const [campaign] = await db
        .select()
        .from(crmCampaigns)
        .where(eq(crmCampaigns.id, campaignId))
        .limit(1);
      const rawEmail = campaign?.scraperProperioEmail;
      const rawPass = campaign?.scraperProperioPassword;
      if (!rawEmail || !rawPass) {
        res.status(422).json({ success: false, error: "No credentials saved yet" });
        return;
      }
      // Send encrypted credentials to Python — Python decrypts using ENCRYPTION_KEY (P1 #12)
      res.json(await scraperEngine.testSession("propelio", rawEmail, rawPass));
    } catch (err: unknown) {
      handleEngineError(err, res);
    }
  },
);

// ─── Propwire integration ─────────────────────────────────────────────────────

router.get("/scraper-engine/integrations/propwire", crmAuth, async (req: Request, res: Response) => {
  try {
    const user = req.crmUser as CrmTokenPayload;
    const campaignId = user.role === "super_admin" ? (user.campaignId ?? 1) : user.campaignId;
    if (!campaignId) {
      res.status(200).json({ configured: false, emailMasked: null, sessionActive: false });
      return;
    }
    res.json(await getMaskedConfig(campaignId, "propwire"));
  } catch (err: unknown) {
    res.status(500).json({ error: toMessage(err) });
  }
});

router.post("/scraper-engine/integrations/propwire", crmAuth, async (req: Request, res: Response) => {
  try {
    const user = req.crmUser as CrmTokenPayload;
    const campaignId =
      user.role === "super_admin"
        ? Number(req.body.campaignId ?? user.campaignId ?? 1)
        : user.campaignId;
    if (!campaignId) {
      res.status(400).json({ error: "No campaign available" });
      return;
    }
    const { email, password } = req.body as { email?: string; password?: string };
    res.json(await saveCampaignCreds(campaignId, "propwire", email ?? "", password ?? ""));
  } catch (err: unknown) {
    res.status(500).json({ error: toMessage(err) });
  }
});

router.delete(
  "/scraper-engine/integrations/propwire/session",
  crmAuth,
  async (_req: Request, res: Response) => {
    try {
      await scraperEngine.invalidateSession("propwire");
      res.json({ success: true });
    } catch (err: unknown) {
      handleEngineError(err, res);
    }
  },
);

router.post(
  "/scraper-engine/integrations/propwire/test",
  crmAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.crmUser as CrmTokenPayload;
      const campaignId =
        user.role === "super_admin"
          ? Number(req.body.campaignId ?? user.campaignId ?? 1)
          : user.campaignId;
      if (!campaignId) {
        res.status(400).json({ success: false, error: "No campaign available" });
        return;
      }
      const [campaign] = await db
        .select()
        .from(crmCampaigns)
        .where(eq(crmCampaigns.id, campaignId))
        .limit(1);
      const rawEmail = campaign?.scraperPropwireEmail;
      const rawPass = campaign?.scraperPropwirePassword;
      if (!rawEmail || !rawPass) {
        res.status(422).json({ success: false, error: "No credentials saved yet" });
        return;
      }
      // Send encrypted credentials to Python — Python decrypts using ENCRYPTION_KEY (P1 #12)
      res.json(await scraperEngine.testSession("propwire", rawEmail, rawPass));
    } catch (err: unknown) {
      handleEngineError(err, res);
    }
  },
);

// ─── Cash Buyer DB routes (query local DB, not the Python engine) ─────────────

async function _buyerLeadIds(user: CrmTokenPayload): Promise<number[] | null> {
  if (user.role === "super_admin") return null;
  if (!user.campaignId) return [];
  const rows = await db
    .select({ id: crmLeads.id })
    .from(crmLeads)
    .where(eq(crmLeads.campaignId, user.campaignId));
  return rows.map((r) => r.id);
}

// Postgres parameter limit is ~32,767 — chunk large inArray calls to avoid it (BUG-SCRAP-01)
function chunkedInArray(col: Parameters<typeof inArray>[0], ids: number[]): SQL {
  const CHUNK = 10_000;
  if (ids.length <= CHUNK) return inArray(col, ids);
  const chunks: SQL[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    chunks.push(inArray(col, ids.slice(i, i + CHUNK)));
  }
  return or(...chunks) as SQL;
}

function _buyerWhere(
  scopeIds: number[] | null,
  q: Record<string, string>,
): SQL | undefined {
  const conds: SQL[] = [];
  if (scopeIds !== null) {
    if (scopeIds.length === 0) return sql`false`;
    conds.push(chunkedInArray(cashBuyerMatches.leadId, scopeIds));
  }
  const search = q["search"]?.trim();
  if (search) {
    conds.push(
      or(
        ilike(cashBuyerMatches.buyerName, `%${search}%`),
        ilike(cashBuyerMatches.llcName, `%${search}%`),
        ilike(cashBuyerMatches.mailingAddress, `%${search}%`),
        ilike(cashBuyerMatches.city, `%${search}%`),
      ) as SQL,
    );
  }
  const src = q["source"]?.split(",").filter(Boolean);
  if (src?.length) conds.push(inArray(cashBuyerMatches.source, src));
  const types = q["buyerType"]?.split(",").filter(Boolean);
  if (types?.length) conds.push(inArray(cashBuyerMatches.buyerType, types));
  const states = q["state"]?.split(",").filter(Boolean);
  if (states?.length) conds.push(inArray(cashBuyerMatches.state, states));
  if (q["minPortfolioSize"])
    conds.push(gte(cashBuyerMatches.portfolioSize, Number(q["minPortfolioSize"])));
  if (q["maxPortfolioSize"])
    conds.push(lte(cashBuyerMatches.portfolioSize, Number(q["maxPortfolioSize"])));
  if (q["minScore"]) conds.push(gte(cashBuyerMatches.matchScore, Number(q["minScore"])));
  return conds.length ? and(...conds) : undefined;
}

router.get(
  "/scraper-engine/buyers/facets",
  crmAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.crmUser as CrmTokenPayload;
      const scopeIds = await _buyerLeadIds(user);
      const where = _buyerWhere(scopeIds, {});
      const [srcRows, typeRows, stateRows, [totRow]] = await Promise.all([
        db.selectDistinct({ v: cashBuyerMatches.source }).from(cashBuyerMatches).where(where),
        db.selectDistinct({ v: cashBuyerMatches.buyerType }).from(cashBuyerMatches).where(where),
        db.selectDistinct({ v: cashBuyerMatches.state }).from(cashBuyerMatches).where(where),
        db.select({ count: sql<number>`count(*)::int` }).from(cashBuyerMatches).where(where),
      ]);
      res.json({
        sources: srcRows.map((r) => r.v).filter(Boolean),
        buyerTypes: typeRows.map((r) => r.v).filter(Boolean),
        states: stateRows.map((r) => r.v).filter(Boolean),
        totalRows: totRow?.count ?? 0,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: toMessage(err) });
    }
  },
);

router.get(
  "/scraper-engine/buyers/export.csv",
  crmAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.crmUser as CrmTokenPayload;
      const scopeIds = await _buyerLeadIds(user);
      const where = _buyerWhere(scopeIds, req.query as Record<string, string>);
      const rows = await db
        .select({
          id: cashBuyerMatches.id,
          leadId: cashBuyerMatches.leadId,
          buyerName: cashBuyerMatches.buyerName,
          llcName: cashBuyerMatches.llcName,
          buyerType: cashBuyerMatches.buyerType,
          matchScore: cashBuyerMatches.matchScore,
          source: cashBuyerMatches.source,
          city: cashBuyerMatches.city,
          state: cashBuyerMatches.state,
          zip: cashBuyerMatches.zip,
          mailingAddress: cashBuyerMatches.mailingAddress,
          portfolioSize: cashBuyerMatches.portfolioSize,
          portfolioValue: cashBuyerMatches.portfolioValue,
          avgPurchasePrice: cashBuyerMatches.avgPurchasePrice,
          lastPurchaseDate: cashBuyerMatches.lastPurchaseDate,
          phones: cashBuyerMatches.phones,
          emails: cashBuyerMatches.emails,
          createdAt: cashBuyerMatches.createdAt,
          leadAddress: crmLeads.address,
        })
        .from(cashBuyerMatches)
        .leftJoin(crmLeads, eq(cashBuyerMatches.leadId, crmLeads.id))
        .where(where)
        .orderBy(desc(cashBuyerMatches.matchScore), desc(cashBuyerMatches.createdAt))
        .limit(10000);
      const esc = (v: string | null | undefined) => csvCell(v);
      const header =
        "id,leadId,buyerName,llcName,buyerType,matchScore,source,city,state,zip,mailingAddress,portfolioSize,portfolioValue,avgPurchasePrice,lastPurchaseDate,phones,emails,createdAt,leadAddress";
      const lines = rows.map((r) =>
        [
          r.id,
          r.leadId,
          esc(r.buyerName),
          esc(r.llcName),
          r.buyerType,
          r.matchScore,
          r.source,
          r.city ?? "",
          r.state ?? "",
          r.zip ?? "",
          esc(r.mailingAddress),
          r.portfolioSize ?? "",
          r.portfolioValue ?? "",
          r.avgPurchasePrice ?? "",
          r.lastPurchaseDate ?? "",
          esc((r.phones as string[]).join(";")),
          esc((r.emails as string[]).join(";")),
          r.createdAt.toISOString(),
          esc(r.leadAddress),
        ].join(","),
      );
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="cash-buyers-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      res.send([header, ...lines].join("\n"));
    } catch (err: unknown) {
      res.status(500).json({ error: toMessage(err) });
    }
  },
);

router.get(
  "/scraper-engine/buyers",
  crmAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.crmUser as CrmTokenPayload;
      const page = Math.max(1, Number(req.query["page"]) || 1);
      const limit = Math.min(200, Math.max(1, Number(req.query["limit"]) || 50));
      const scopeIds = await _buyerLeadIds(user);
      const where = _buyerWhere(scopeIds, req.query as Record<string, string>);
      const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(cashBuyerMatches)
        .where(where);
      const rows = await db
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
        })
        .from(cashBuyerMatches)
        .leftJoin(crmLeads, eq(cashBuyerMatches.leadId, crmLeads.id))
        .where(where)
        .orderBy(desc(cashBuyerMatches.matchScore), desc(cashBuyerMatches.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);
      res.json({ buyers: rows, total, page, limit });
    } catch (err: unknown) {
      res.status(500).json({ error: toMessage(err) });
    }
  },
);

// ─── Job status proxy (with done→completed normalisation) ────────────────────

router.get("/scraper-engine/jobs/:jobId", async (req: Request, res: Response) => {
  try {
    const job = await scraperEngine.getJob(req.params.jobId as string);
    const normalized = { ...job, status: job.status === "done" ? "completed" : job.status };
    res.json(normalized);
  } catch (err: unknown) {
    handleEngineError(err, res);
  }
});

// ─── Distressed Lead Gen — skip-trace enrichment ─────────────────────────────
// POST /scraper-engine/distressed/:jobId/enrich
// Fetches distressed listings from the engine for the given job, runs
// skip-trace on each record in the background, and returns a tracking ID.

interface DistressedEnrichJob {
  enrichJobId: string;
  sourceJobId: string;
  status: "running" | "completed" | "failed";
  total: number;
  processed: number;
  results: any[];
  startedAt: string;
  error?: string;
}

const distressedEnrichJobs = new Map<string, DistressedEnrichJob>();

setInterval(() => {
  const cutoff = Date.now() - 8 * 60 * 60 * 1000;
  for (const [id, job] of distressedEnrichJobs) {
    if (new Date(job.startedAt).getTime() < cutoff) distressedEnrichJobs.delete(id);
  }
}, 30 * 60 * 1000).unref();

router.post(
  "/scraper-engine/distressed/:jobId/enrich",
  crmOrPinAuth,
  async (req: Request, res: Response) => {
    try {
      const jobId = String(req.params.jobId);
      const data = await scraperEngine.listDistressedForJob(jobId);
      const listings: any[] = data.listings || [];

      if (!listings.length) {
        res.status(404).json({ error: "No listings found for this job — nothing to enrich" });
        return;
      }

      const enrichJobId = randomUUID();
      const enrichJob: DistressedEnrichJob = {
        enrichJobId,
        sourceJobId: jobId,
        status: "running",
        total: listings.length,
        processed: 0,
        results: [],
        startedAt: new Date().toISOString(),
      };
      distressedEnrichJobs.set(enrichJobId, enrichJob);

      setImmediate(async () => {
        try {
          for (const listing of listings) {
            try {
              const street    = listing.address || listing.street || "";
              const city      = listing.city || "";
              const state     = listing.state || "";
              const zip       = listing.zip || listing.zip_code || "";
              const ownerName = listing.owner_name || listing.ownerName || "";
              const parts     = ownerName.trim().split(/\s+/);
              const firstName = parts[0] || null;
              const lastName  = parts.length > 1 ? parts.slice(1).join(" ") : null;

              const st = await runSkipTrace(
                street, city || null, state || null, zip || null,
                firstName, lastName,
              );

              enrichJob.results.push({
                ...listing,
                phones: st ? st.phones.map((p: any) => p.number || p) : [],
                emails: st ? st.emails : [],
                skip_trace_status: st ? "found" : "not_found",
              });
            } catch {
              enrichJob.results.push({
                ...listing,
                phones: [],
                emails: [],
                skip_trace_status: "error",
              });
            }
            enrichJob.processed++;
            await new Promise(r => setTimeout(r, 500));
          }
          enrichJob.status = "completed";
        } catch (err: any) {
          enrichJob.status = "failed";
          enrichJob.error = err?.message;
          logger.error({ enrichJobId, err: err?.message }, "[distressed-enrich] job crashed");
        }
      });

      logger.info({ enrichJobId, sourceJobId: jobId, total: listings.length }, "[distressed-enrich] job started");
      res.json({ enrichJobId, total: listings.length, status: "running" });
    } catch (err: unknown) {
      if (err instanceof ScraperEngineUnavailable) { res.status(503).json({ error: (err as Error).message }); return; }
      res.status(500).json({ error: toMessage(err) });
    }
  },
);

router.get(
  "/scraper-engine/distressed/enrich-status/:enrichJobId",
  crmOrPinAuth,
  (req: Request, res: Response) => {
    const job = distressedEnrichJobs.get(String(req.params.enrichJobId));
    if (!job) { res.status(404).json({ error: "Enrich job not found" }); return; }
    res.json({
      enrichJobId: job.enrichJobId,
      sourceJobId: job.sourceJobId,
      status:      job.status,
      total:       job.total,
      processed:   job.processed,
      results:     job.status === "completed" ? job.results : [],
      error:       job.error ?? null,
    });
  },
);

// ─── Catch-all proxy for every other /scraper-engine/* route ─────────────────

const _ENGINE_URL = (process.env.SCRAPER_ENGINE_URL ?? "").replace(/\/$/, "");

router.all("/scraper-engine/{*path}", crmOrPinAuth, async (req: Request, res: Response) => {
  if (!_ENGINE_URL) {
    res.status(503).json({ error: "SCRAPER_ENGINE_URL is not configured" });
    return;
  }
  const subPath = req.path.slice("/scraper-engine".length) || "/";
  const isBodyMethod = !["GET", "HEAD", "DELETE"].includes(req.method.toUpperCase());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  const apiKey = process.env.WEBSCRAPER_API_KEY;
  try {
    const upstream = await fetch(`${_ENGINE_URL}${subPath}`, {
      method: req.method,
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
        ...(req.headers.authorization ? { "Authorization": req.headers.authorization } : {}),
      },
      ...(isBodyMethod ? { body: JSON.stringify(req.body) } : {}),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await upstream.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: `Scraper engine returned non-JSON response (HTTP ${upstream.status})` };
    }
    if (body && typeof body === "object" && (body as Record<string, unknown>).status === "done") {
      (body as Record<string, unknown>).status = "completed";
    }
    res.status(upstream.status).json(body);
  } catch (err: unknown) {
    clearTimeout(timer);
    const e = err as Record<string, unknown> | null;
    if (e?.["name"] === "AbortError") {
      res.status(503).json({ error: "Scraper engine request timed out" });
      return;
    }
    const cause = e?.["cause"] as Record<string, unknown> | undefined;
    const isConn =
      cause?.["code"] === "ECONNREFUSED" ||
      /ECONNREFUSED|fetch failed/i.test(toMessage(err));
    res.status(503).json({
      error: isConn
        ? "Scraper engine is unreachable — check SCRAPER_ENGINE_URL and ELB health (BUG-051)"
        : toMessage(err),
    });
  }
});

export default router;
