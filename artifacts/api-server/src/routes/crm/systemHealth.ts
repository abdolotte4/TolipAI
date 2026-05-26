/**
 * systemHealth.ts — Super-admin-only service health checks.
 *
 * GET /api/crm/admin/system-health
 *
 * Checks each integrated service in parallel (5 s timeout each) and
 * returns a structured report so the Health-Check Dashboard can render
 * real-time status for OpenAI, Groq, Twilio, Scraper Engine, ATTOM, and DB.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { crmAuth, type CrmTokenPayload } from "./middleware";
import { logger } from "../../lib/logger";
import { getOpenAIKey, getOpenAIBaseUrl, getGroqKey, getGroqBaseUrl } from "./healthHelpers";

const router: IRouter = Router();

// ─── helpers ──────────────────────────────────────────────────────────────────

type ServiceStatus = "ok" | "degraded" | "error" | "unconfigured";

interface ServiceResult {
  status: ServiceStatus;
  latencyMs: number | null;
  detail: string;
  checkedAt: string;
}

async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
    fn()
      .then((v) => { clearTimeout(t); resolve(v); })
      .catch((e) => { clearTimeout(t); reject(e); });
  });
}

async function checkOpenAI(): Promise<ServiceResult> {
  const start = Date.now();
  const checkedAt = new Date().toISOString();
  const key = getOpenAIKey();
  if (!key) {
    return { status: "unconfigured", latencyMs: null, detail: "OPENAI_API_KEY not set", checkedAt };
  }
  try {
    const res = await withTimeout(async () =>
      fetch(`${getOpenAIBaseUrl()}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5000),
      }),
    );
    const latencyMs = Date.now() - start;
    if (res.ok) return { status: "ok", latencyMs, detail: "API reachable — key valid", checkedAt };
    if (res.status === 401) return { status: "error", latencyMs, detail: "401 Unauthorized — key invalid or revoked", checkedAt };
    if (res.status === 429) return { status: "degraded", latencyMs, detail: `429 Rate Limited — quota may be exhausted`, checkedAt };
    return { status: "degraded", latencyMs, detail: `HTTP ${res.status}`, checkedAt };
  } catch (err: any) {
    return { status: "error", latencyMs: Date.now() - start, detail: err?.message ?? "Unreachable", checkedAt };
  }
}

async function checkGroq(): Promise<ServiceResult> {
  const start = Date.now();
  const checkedAt = new Date().toISOString();
  const key = getGroqKey();
  if (!key) {
    return { status: "unconfigured", latencyMs: null, detail: "GROQ_API_KEY not set", checkedAt };
  }
  try {
    const res = await withTimeout(async () =>
      fetch(`${getGroqBaseUrl()}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5000),
      }),
    );
    const latencyMs = Date.now() - start;
    if (res.ok) return { status: "ok", latencyMs, detail: "API reachable — key valid", checkedAt };
    if (res.status === 401) return { status: "error", latencyMs, detail: "401 Unauthorized — key invalid or revoked", checkedAt };
    if (res.status === 429) return { status: "degraded", latencyMs, detail: "429 Rate Limited", checkedAt };
    return { status: "degraded", latencyMs, detail: `HTTP ${res.status}`, checkedAt };
  } catch (err: any) {
    return { status: "error", latencyMs: Date.now() - start, detail: err?.message ?? "Unreachable", checkedAt };
  }
}

async function checkTwilio(): Promise<ServiceResult> {
  const start = Date.now();
  const checkedAt = new Date().toISOString();
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    return { status: "unconfigured", latencyMs: null, detail: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set", checkedAt };
  }
  try {
    const creds = Buffer.from(`${sid}:${token}`).toString("base64");
    const res = await withTimeout(async () =>
      fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
        headers: { Authorization: `Basic ${creds}` },
        signal: AbortSignal.timeout(5000),
      }),
    );
    const latencyMs = Date.now() - start;
    if (res.ok) {
      const data = await res.json() as any;
      const statusStr = data.status ?? "active";
      if (statusStr === "active") return { status: "ok", latencyMs, detail: `Account active (${sid.slice(0, 8)}…)`, checkedAt };
      return { status: "degraded", latencyMs, detail: `Account status: ${statusStr}`, checkedAt };
    }
    if (res.status === 401) return { status: "error", latencyMs, detail: "401 Unauthorized — credentials invalid", checkedAt };
    return { status: "degraded", latencyMs, detail: `HTTP ${res.status}`, checkedAt };
  } catch (err: any) {
    return { status: "error", latencyMs: Date.now() - start, detail: err?.message ?? "Unreachable", checkedAt };
  }
}

async function checkScraperEngine(): Promise<ServiceResult> {
  const start = Date.now();
  const checkedAt = new Date().toISOString();
  const engineUrl = (process.env.SCRAPER_ENGINE_URL || "").replace(/\/$/, "");
  if (!engineUrl) {
    return { status: "unconfigured", latencyMs: null, detail: "SCRAPER_ENGINE_URL not configured", checkedAt };
  }
  try {
    const apiKey = process.env.WEBSCRAPER_API_KEY;
    const res = await withTimeout(async () =>
      fetch(`${engineUrl}/health`, {
        headers: { ...(apiKey ? { "X-API-Key": apiKey } : {}) },
        signal: AbortSignal.timeout(6000),
      }),
      6000,
    );
    const latencyMs = Date.now() - start;
    if (res.ok) {
      const data = await res.json() as any;
      return {
        status: "ok",
        latencyMs,
        detail: `Engine healthy — ${engineUrl}`,
        checkedAt,
      };
    }
    return { status: "degraded", latencyMs, detail: `HTTP ${res.status} from ${engineUrl}`, checkedAt };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const msg = err?.message ?? "Unreachable";
    const detail = /timeout/i.test(msg)
      ? `Engine timed out (${engineUrl})`
      : /ECONNREFUSED|fetch failed/i.test(msg)
      ? `Engine unreachable — ECS task may be stopped (${engineUrl})`
      : msg;
    return { status: "error", latencyMs, detail, checkedAt };
  }
}

async function checkAttom(): Promise<ServiceResult> {
  const start = Date.now();
  const checkedAt = new Date().toISOString();
  const key1 = process.env.ATTOM_API_KEY?.trim();
  const key2 = process.env.ATTOM_API_KEY_2?.trim();
  const keys = [key1, key2].filter(Boolean) as string[];
  if (!keys.length) {
    return { status: "unconfigured", latencyMs: null, detail: "ATTOM_API_KEY not set — using fallback data sources", checkedAt };
  }
  try {
    const res = await withTimeout(async () =>
      fetch("https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/basicprofile?address=4529+Winona+Court&postalcode=80212", {
        headers: { apikey: keys[0]!, Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      }),
    );
    const latencyMs = Date.now() - start;
    if (res.ok) return { status: "ok", latencyMs, detail: `${keys.length} key(s) configured — API reachable`, checkedAt };
    if (res.status === 401 || res.status === 403) return { status: "error", latencyMs, detail: `Key invalid/unauthorized (HTTP ${res.status})`, checkedAt };
    if (res.status === 429) return { status: "degraded", latencyMs, detail: "Rate limited or quota exhausted", checkedAt };
    return { status: "degraded", latencyMs, detail: `HTTP ${res.status}`, checkedAt };
  } catch (err: any) {
    return { status: "error", latencyMs: Date.now() - start, detail: err?.message ?? "Unreachable", checkedAt };
  }
}

async function checkDatabase(): Promise<ServiceResult> {
  const start = Date.now();
  const checkedAt = new Date().toISOString();
  try {
    await pool.query("SELECT 1");
    return { status: "ok", latencyMs: Date.now() - start, detail: "Database reachable", checkedAt };
  } catch (err: any) {
    return { status: "error", latencyMs: Date.now() - start, detail: err?.message ?? "DB ping failed", checkedAt };
  }
}

async function checkScraperEngineDetails(): Promise<any> {
  const engineUrl = (process.env.SCRAPER_ENGINE_URL || "").replace(/\/$/, "");
  if (!engineUrl) return null;
  try {
    const apiKey = process.env.WEBSCRAPER_API_KEY;
    const [metricsRes, circuitRes] = await Promise.allSettled([
      fetch(`${engineUrl}/metrics`, {
        headers: { ...(apiKey ? { "X-API-Key": apiKey } : {}) },
        signal: AbortSignal.timeout(5000),
      }),
      fetch(`${engineUrl}/admin/circuit-breakers`, {
        headers: { ...(apiKey ? { "X-API-Key": apiKey } : {}) },
        signal: AbortSignal.timeout(5000),
      }),
    ]);
    const metrics = metricsRes.status === "fulfilled" && metricsRes.value.ok
      ? await metricsRes.value.json().catch(() => null)
      : null;
    const circuits = circuitRes.status === "fulfilled" && circuitRes.value.ok
      ? await circuitRes.value.json().catch(() => null)
      : null;
    return { metrics, circuits };
  } catch {
    return null;
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.get("/crm/admin/system-health", crmAuth, async (req: Request, res: Response) => {
  const user = req.crmUser as CrmTokenPayload;
  if (user.role !== "super_admin") {
    res.status(403).json({ error: "Super admin only" });
    return;
  }

  try {
    const [openai, groq, twilio, scraper, attom, database] = await Promise.all([
      checkOpenAI(),
      checkGroq(),
      checkTwilio(),
      checkScraperEngine(),
      checkAttom(),
      checkDatabase(),
    ]);

    const scraperDetails = scraper.status === "ok" ? await checkScraperEngineDetails() : null;

    const services = { openai, groq, twilio, scraperEngine: scraper, attom, database };

    const statuses = Object.values(services).map((s) => s.status);
    const overallStatus =
      statuses.every((s) => s === "ok") ? "ok" :
      statuses.some((s) => s === "error") ? "error" :
      statuses.some((s) => s === "degraded") ? "degraded" :
      "ok";

    res.json({
      overallStatus,
      services,
      scraperEngineDetails: scraperDetails,
      engineUrl: (process.env.SCRAPER_ENGINE_URL || "").replace(/\/$/, "") || null,
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error({ err }, "[system-health] check failed");
    res.status(500).json({ error: "Health check failed", detail: err?.message });
  }
});

export default router;
