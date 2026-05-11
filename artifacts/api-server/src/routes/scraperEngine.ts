/**
 * Express bridge to the Python `digor-scraper-engine` FastAPI service.
 *
 * Mounted at `/api/scraper-engine`.  CRM-authenticated endpoints proxy
 * cash-buyer flows; PIN-authenticated endpoints (matching tools.ts) proxy
 * the distressed-property scraper.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { cashBuyerMatches, crmLeads, crmCampaigns } from "@workspace/db/schema";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { crmAuth, type CrmTokenPayload } from "./crm/middleware";
import { scraperEngine, ScraperEngineUnavailable } from "../services/scraperEngineClient";
import { encryptPassword, decryptPassword } from "./crm/crypto-util";

const router: IRouter = Router();

type ScraperService = "propelio" | "propwire";

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function handleEngineError(err: unknown, res: Response): void {
  if (err instanceof ScraperEngineUnavailable) {
    res.status(503).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: toMessage(err) });
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
      let email: string, pass: string;
      try {
        email = decryptPassword(rawEmail);
        pass = decryptPassword(rawPass);
      } catch {
        email = rawEmail;
        pass = rawPass;
      }
      res.json(await scraperEngine.testSession("propelio", email, pass));
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
      let email: string, pass: string;
      try {
        email = decryptPassword(rawEmail);
        pass = decryptPassword(rawPass);
      } catch {
        email = rawEmail;
        pass = rawPass;
      }
      res.json(await scraperEngine.testSession("propwire", email, pass));
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

function _buyerWhere(
  scopeIds: number[] | null,
  q: Record<string, string>,
): SQL | undefined {
  const conds: SQL[] = [];
  if (scopeIds !== null) {
    if (scopeIds.length === 0) return sql`false`;
    conds.push(inArray(cashBuyerMatches.leadId, scopeIds));
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
      const esc = (v: string | null | undefined) =>
        `"${(v ?? "").replace(/"/g, '""')}"`;
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

// ─── Catch-all proxy for every other /scraper-engine/* route ─────────────────

const _ENGINE_URL = (
  process.env.SCRAPER_ENGINE_URL || "https://scraper-engine-production-6207.up.railway.app"
).replace(/\/$/, "");

router.all("/scraper-engine/{*path}", async (req: Request, res: Response) => {
  const subPath = req.path.slice("/scraper-engine".length) || "/";
  const isBodyMethod = !["GET", "HEAD", "DELETE"].includes(req.method.toUpperCase());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const upstream = await fetch(`${_ENGINE_URL}${subPath}`, {
      method: req.method,
      headers: { "content-type": "application/json" },
      ...(isBodyMethod ? { body: JSON.stringify(req.body) } : {}),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await upstream.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
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
        ? "Scraper engine is not running or unreachable"
        : toMessage(err),
    });
  }
});

export default router;
