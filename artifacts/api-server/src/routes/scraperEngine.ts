/**
 * Express bridge to the Python `digor-scraper-engine` FastAPI service.
 *
 * Mounted at `/api/scraper-engine`.  CRM-authenticated endpoints proxy
 * cash-buyer flows; PIN-authenticated endpoints (matching tools.ts) proxy
 * the distressed-property scraper.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { cashBuyerMatches, distressedListings, crmLeads, crmCampaigns } from "@workspace/db/schema";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { crmAuth, type CrmTokenPayload } from "./crm/middleware";
import { scraperEngine, ScraperEngineUnavailable } from "../services/scraperEngineClient";
import { logger } from "../lib/logger";
import { encryptPassword, decryptPassword } from "./crm/crypto-util";

const router: IRouter = Router();

function handleEngineError(err: unknown, res: Response) {
  if (err instanceof ScraperEngineUnavailable) { res.status(503).json({ error: err.message }); return; }
  const msg = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: msg });
}

function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [user, domain] = email.split("@");
  if (!domain) return email;
  return `${user.slice(0, 2)}••@${domain}`;
}

async function getCampaignSettings(user: CrmTokenPayload) {
  if (!user.campaignId) return null;
  const [campaign] = await db.select().from(crmCampaigns).where(eq(crmCampaigns.id, user.campaignId)).limit(1);
  return campaign as any;
}

async function saveCampaignCreds(campaignId: number, emailField: string, passField: string, email: string, password: string) {
  const encEmail = email ? encryptPassword(email) : null;
  const encPass = password ? encryptPassword(password) : null;
  await db.update(crmCampaigns).set({ [emailField]: encEmail, [passField]: encPass } as any).where(eq(crmCampaigns.id, campaignId));
  return { configured: !!(encEmail && encPass) };
}

async function getMaskedConfig(campaignId: number, emailField: string, passField: string, service: string) {
  const [campaign] = await db.select().from(crmCampaigns).where(eq(crmCampaigns.id, campaignId)).limit(1);
  const rawEmail = (campaign as any)?.[emailField] as string | null;
  const rawPass = (campaign as any)?.[passField] as string | null;
  const sessionActive = await scraperEngine.sessionStatus(service).then(r => !!(r as any)?.active).catch(() => false);
  return { configured: !!(rawEmail && rawPass), emailMasked: maskEmail(rawEmail), sessionActive };
}

router.get("/scraper-engine/integrations/propelio", crmAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).crmUser as CrmTokenPayload;
    const campaignId = user.role === "super_admin" ? (user.campaignId ?? 1) : user.campaignId;
    if (!campaignId) { res.status(200).json({ configured: false, emailMasked: null, sessionActive: false }); return; }
    res.json(await getMaskedConfig(campaignId, "scraperProperioEmail", "scraperProperioPassword", "propelio"));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/scraper-engine/integrations/propelio", crmAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).crmUser as CrmTokenPayload;
    const campaignId = user.role === "super_admin" ? Number(req.body.campaignId ?? user.campaignId ?? 1) : user.campaignId;
    if (!campaignId) { res.status(400).json({ error: "No campaign available" }); return; }
    const { email, password } = req.body as { email?: string; password?: string };
    res.json(await saveCampaignCreds(campaignId, "scraperProperioEmail", "scraperProperioPassword", email ?? "", password ?? ""));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/scraper-engine/integrations/propelio/session", crmAuth, async (req: Request, res: Response) => {
  try { await scraperEngine.invalidateSession("propelio"); res.json({ success: true }); } catch (err) { handleEngineError(err, res); }
});

router.post("/scraper-engine/integrations/propelio/test", crmAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).crmUser as CrmTokenPayload;
    const campaignId = user.role === "super_admin" ? (Number(req.body.campaignId ?? user.campaignId ?? 1)) : user.campaignId;
    if (!campaignId) { res.status(400).json({ success: false, error: "No campaign available" }); return; }
    const [campaign] = await db.select().from(crmCampaigns).where(eq(crmCampaigns.id, campaignId)).limit(1);
    const rawEmail = (campaign as any)?.scraperProperioEmail as string | null;
    const rawPass = (campaign as any)?.scraperProperioPassword as string | null;
    if (!rawEmail || !rawPass) { res.status(422).json({ success: false, error: "No credentials saved yet" }); return; }
    let email: string, pass: string;
    try { email = decryptPassword(rawEmail); pass = decryptPassword(rawPass); } catch { email = rawEmail; pass = rawPass; }
    res.json(await scraperEngine.testSession("propelio", email, pass));
  } catch (err) { handleEngineError(err, res); }
});

router.get("/scraper-engine/integrations/propwire", crmAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).crmUser as CrmTokenPayload;
    const campaignId = user.role === "super_admin" ? (user.campaignId ?? 1) : user.campaignId;
    if (!campaignId) { res.status(200).json({ configured: false, emailMasked: null, sessionActive: false }); return; }
    res.json(await getMaskedConfig(campaignId, "scraperPropwireEmail", "scraperPropwirePassword", "propwire"));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/scraper-engine/integrations/propwire", crmAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).crmUser as CrmTokenPayload;
    const campaignId = user.role === "super_admin" ? Number(req.body.campaignId ?? user.campaignId ?? 1) : user.campaignId;
    if (!campaignId) { res.status(400).json({ error: "No campaign available" }); return; }
    const { email, password } = req.body as { email?: string; password?: string };
    res.json(await saveCampaignCreds(campaignId, "scraperPropwireEmail", "scraperPropwirePassword", email ?? "", password ?? ""));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/scraper-engine/integrations/propwire/session", crmAuth, async (req: Request, res: Response) => {
  try { await scraperEngine.invalidateSession("propwire"); res.json({ success: true }); } catch (err) { handleEngineError(err, res); }
});

router.post("/scraper-engine/integrations/propwire/test", crmAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).crmUser as CrmTokenPayload;
    const campaignId = user.role === "super_admin" ? Number(req.body.campaignId ?? user.campaignId ?? 1) : user.campaignId;
    if (!campaignId) { res.status(400).json({ success: false, error: "No campaign available" }); return; }
    const [campaign] = await db.select().from(crmCampaigns).where(eq(crmCampaigns.id, campaignId)).limit(1);
    const rawEmail = (campaign as any)?.scraperPropwireEmail as string | null;
    const rawPass = (campaign as any)?.scraperPropwirePassword as string | null;
    if (!rawEmail || !rawPass) { res.status(422).json({ success: false, error: "No credentials saved yet" }); return; }
    let email: string, pass: string;
    try { email = decryptPassword(rawEmail); pass = decryptPassword(rawPass); } catch { email = rawEmail; pass = rawPass; }
    res.json(await scraperEngine.testSession("propwire", email, pass));
  } catch (err) { handleEngineError(err, res); }
});

// ─── Job status proxy (with done→completed normalisation) ────────────────────

router.get("/scraper-engine/jobs/:jobId", async (req: Request, res: Response) => {
  try {
    const job = await scraperEngine.getJob(req.params.jobId);
    if ((job as any).status === "done") (job as any).status = "completed";
    res.json(job);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// ─── Catch-all proxy for every other /scraper-engine/* route ─────────────────
// All routes not explicitly handled above (scrape/cash-buyers, ai/satellite-dfd,
// lead-gen/*, sources, etc.) are forwarded transparently to the Python engine.

const _ENGINE_URL = (process.env.SCRAPER_ENGINE_URL || "https://scraper-engine-production-6207.up.railway.app").replace(/\/$/, "");

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
    let body: any;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    if (body && typeof body === "object" && body.status === "done") body.status = "completed";
    res.status(upstream.status).json(body);
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === "AbortError") {
      res.status(503).json({ error: "Scraper engine request timed out" });
      return;
    }
    const isConn = e?.cause?.code === "ECONNREFUSED" || /ECONNREFUSED|fetch failed/i.test(e?.message || "");
    res.status(503).json({ error: isConn ? "Scraper engine is not running or unreachable" : (e?.message || "Unknown engine error") });
  }
});

export default router;
