/**
 * HTTP client for the Python tolipai-scraper-engine FastAPI service.
 *
 * The engine URL is configured via SCRAPER_ENGINE_URL.  All calls fail soft —
 * if the engine is unreachable, callers get a 503 with a clear message instead of a 500.
 * Requests are authenticated via WEBSCRAPER_API_KEY (Replit env var) sent as X-API-Key header.
 * The Fargate container validates against SCRAPER_API_KEY (from AWS secret TolipAI/scraper/api-key).
 */
import { logger } from "../lib/logger";

const ENGINE_URL = (process.env.SCRAPER_ENGINE_URL || "").replace(/\/$/, "");
const DEFAULT_TIMEOUT_MS = 60_000;

export class ScraperEngineUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScraperEngineUnavailable";
  }
}

async function request<T = any>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const apiKey = process.env.WEBSCRAPER_API_KEY;
    const res = await fetch(`${ENGINE_URL}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
        ...(rest.headers || {}),
      },
    });
    const text = await res.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) {
      const detail = body?.detail || body?.error || (typeof body === "string" ? body : "Engine error");
      const err = new Error(`scraper-engine ${res.status}: ${detail}`);
      (err as any).status = res.status;
      throw err;
    }
    return body as T;
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new ScraperEngineUnavailable(`Engine timeout after ${timeoutMs}ms (${path})`);
    }
    if (e?.cause?.code === "ECONNREFUSED" || /ECONNREFUSED|fetch failed/.test(e?.message || "")) {
      throw new ScraperEngineUnavailable(
        `Cannot reach scraper engine${ENGINE_URL ? ` at ${ENGINE_URL}` : ""}. Set SCRAPER_ENGINE_URL to enable.`,
      );
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface JobResponse {
  job_id: string;
  status: string;
  [k: string]: any;
}

export interface JobStatus {
  id: string;
  type: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  message?: string;
  result?: any;
  error?: string | null;
}

export const scraperEngine = {
  async health() {
    return request<any>("/health", { method: "GET", timeoutMs: 5000 });
  },

  async startCashBuyers(leadId: number, opts: { maxBuyers?: number; campaignId?: number } = {}) {
    return request<JobResponse>("/scrape/cash-buyers", {
      method: "POST",
      body: JSON.stringify({
        lead_id: leadId,
        max_buyers: opts.maxBuyers ?? 50,
        campaign_id: opts.campaignId,
      }),
    });
  },

  async startDistressed(params: {
    zip?: string;
    countyKey?: string;
    state?: string;
    categories?: string[];
    sourceKeys?: string[];
    campaignId?: number;
    limit?: number;
  }) {
    return request<JobResponse>("/scrape/distressed", {
      method: "POST",
      body: JSON.stringify({
        zip: params.zip || "",
        county_key: params.countyKey || "",
        state: params.state || "",
        categories: params.categories || [],
        source_keys: params.sourceKeys || [],
        campaign_id: params.campaignId,
        limit: params.limit,
      }),
    });
  },

  async listSources(state?: string) {
    const q = state ? `?state=${encodeURIComponent(state)}` : "";
    return request<{ categories: any[]; sources: any[]; count: number }>(
      `/sources${q}`, { method: "GET", timeoutMs: 5000 },
    );
  },

  async fetchComps(req: { address: string; radiusMiles?: number; maxResults?: number }) {
    return request<any>("/scrape/comps", {
      method: "POST",
      body: JSON.stringify({
        address: req.address,
        radius_miles: req.radiusMiles ?? 0.5,
        max_results: req.maxResults ?? 12,
      }),
      timeoutMs: 60_000,
    });
  },

  async discoverTrustees(req: { state: string; county?: string; maxResults?: number }) {
    return request<{ state: string; county?: string; trustees: any[]; count: number }>(
      "/ai/trustees",
      {
        method: "POST",
        body: JSON.stringify({
          state: req.state, county: req.county || "",
          max_results: req.maxResults ?? 25,
        }),
        timeoutMs: 45_000,
      },
    );
  },

  async hedgeFundMarkets(maxResults = 12) {
    return request<{ markets: any[]; count: number }>(
      `/ai/hedge-fund-markets?max_results=${maxResults}`,
      { method: "GET", timeoutMs: 30_000 },
    );
  },

  async aiResearch(query: string, maxResults = 10) {
    return request<{ query: string; results: any[]; count: number }>(
      "/ai/research",
      {
        method: "POST",
        body: JSON.stringify({ query, max_results: maxResults }),
        timeoutMs: 30_000,
      },
    );
  },

  async skipTrace(req: { name: string; llc?: string; address?: string; state?: string }) {
    return request<any>("/scrape/skip-trace", {
      method: "POST",
      body: JSON.stringify(req),
      timeoutMs: 90_000,
    });
  },

  async getJob(jobId: string) {
    return request<JobStatus>(`/jobs/${encodeURIComponent(jobId)}`, { method: "GET" });
  },

  async listBuyersForLead(leadId: number, limit = 100) {
    return request<{ lead_id: number; count: number; buyers: any[] }>(
      `/leads/${leadId}/buyers?limit=${limit}`,
      { method: "GET" },
    );
  },

  async listDistressedForJob(jobId: string, limit = 500) {
    return request<{ job_id: string; count: number; listings: any[] }>(
      `/distressed/${encodeURIComponent(jobId)}/listings?limit=${limit}`,
      { method: "GET" },
    );
  },

  // ─── Propelio (authenticated) ────────────────────────────────────────────

  async startPropelioCashBuyers(req: {
    address: string;
    distanceMiles?: number;
    activeWithin?: "ANY_TIME" | "LAST_6M" | "LAST_1Y" | "LAST_2Y";
    minProperties?: number;
    landlords?: boolean;
    flippers?: boolean;
    maxResults?: number;
    leadId?: number;
    campaignId?: number;
    persist?: boolean;
    propelioEmail?: string;
    propelioPassword?: string;
  }) {
    return request<JobResponse>("/scrape/propelio/cash-buyers", {
      method: "POST",
      body: JSON.stringify({
        address: req.address,
        distance_miles: req.distanceMiles ?? 10,
        active_within: req.activeWithin ?? "ANY_TIME",
        min_properties: req.minProperties ?? 3,
        landlords: req.landlords ?? true,
        flippers: req.flippers ?? true,
        max_results: req.maxResults ?? 500,
        lead_id: req.leadId,
        campaign_id: req.campaignId,
        persist: req.persist ?? true,
        ...(req.propelioEmail ? { propelio_email: req.propelioEmail } : {}),
        ...(req.propelioPassword ? { propelio_password: req.propelioPassword } : {}),
      }),
      timeoutMs: 30_000,
    });
  },

  // ─── Propwire (authenticated) ────────────────────────────────────────────

  async propwireProperty(query: string) {
    return request<any>("/scrape/propwire/property", {
      method: "POST",
      body: JSON.stringify({ query }),
      timeoutMs: 90_000,
    });
  },

  async propwireComps(query: string) {
    return request<{ query: string; count: number; comps: any[] }>(
      "/scrape/propwire/comps",
      { method: "POST", body: JSON.stringify({ query }), timeoutMs: 90_000 },
    );
  },

  async propwireHistory(query: string) {
    return request<any>("/scrape/propwire/history", {
      method: "POST",
      body: JSON.stringify({ query }),
      timeoutMs: 90_000,
    });
  },

  async startPropwireCashBuyers(req: {
    query: string;
    radiusMiles?: number;
    minProperties?: number;
    maxResults?: number;
    leadId?: number;
    campaignId?: number;
    persist?: boolean;
    propwireEmail?: string;
    propwirePassword?: string;
  }) {
    return request<JobResponse>("/scrape/propwire/cash-buyers-nearby", {
      method: "POST",
      body: JSON.stringify({
        query: req.query,
        radius_miles: req.radiusMiles ?? 1.0,
        min_properties: req.minProperties ?? 3,
        max_results: req.maxResults ?? 200,
        lead_id: req.leadId,
        campaign_id: req.campaignId,
        persist: req.persist ?? true,
        ...(req.propwireEmail ? { propwire_email: req.propwireEmail } : {}),
        ...(req.propwirePassword ? { propwire_password: req.propwirePassword } : {}),
      }),
      timeoutMs: 90_000,
    });
  },

  async satelliteDfd(req: {
    zip?: string;
    city?: string;
    state?: string;
    minScore?: number;
    maxResults?: number;
    useAiScoring?: boolean;
  }) {
    return request<any>("/ai/satellite-dfd", {
      method: "POST",
      body: JSON.stringify({
        zip: req.zip || "",
        city: req.city || "",
        state: req.state || "",
        min_score: req.minScore ?? 30,
        max_results: req.maxResults ?? 50,
        use_ai_scoring: req.useAiScoring ?? true,
      }),
      timeoutMs: 180_000,
    });
  },

  // ─── Distressed Lead-Gen (HomeHarvest + OSINT) ────────────────────────────

  async startLeadGenForeclosure(req: {
    city: string;
    state: string;
    listingType?: string;
    site?: string;
    limit?: number;
    doSkipTrace?: boolean;
    doDncCheck?: boolean;
    saveToCrm?: boolean;
    campaignId?: number;
  }) {
    return request<JobResponse>("/lead-gen/foreclosure", {
      method: "POST",
      body: JSON.stringify({
        city: req.city,
        state: req.state,
        listing_type: req.listingType ?? "for_sale",
        site: req.site ?? "zillow",
        limit: req.limit ?? 10,
        do_skip_trace: req.doSkipTrace ?? true,
        do_dnc_check: req.doDncCheck ?? true,
        save_to_crm: req.saveToCrm ?? false,
        campaign_id: req.campaignId,
      }),
      timeoutMs: 30_000,
    });
  },

  async getLeadGenResult(jobId: string) {
    return request<any>(`/lead-gen/foreclosure/result/${encodeURIComponent(jobId)}`, {
      method: "GET",
    });
  },

  // ─── Session management ───────────────────────────────────────────────────

  async sessionStatus(service: string) {
    return request<{ service: string; active: boolean; state_file_bytes: number }>(
      `/session/${encodeURIComponent(service)}/status`,
      { method: "GET" },
    );
  },

  async invalidateSession(service: string) {
    return request<{ service: string; invalidated: boolean }>(
      `/session/${encodeURIComponent(service)}`,
      { method: "DELETE" },
    );
  },

  async testSession(service: string, email: string, password: string) {
    return request<{ success: boolean; detail?: string; error?: string }>(
      `/session/${encodeURIComponent(service)}/test`,
      { method: "POST", body: JSON.stringify({ email, password }) },
    );
  },

  async setSessionCreds(_service: string, _email: string, _password: string) {
    // No-op on the engine side — env vars are managed per-deployment.
    // Credentials are passed at job-run time via the DB; this is a placeholder.
    return Promise.resolve();
  },

  async lookupPhone(name: string, address: string) {
    return request<{ phones: string[]; source: string }>(
      "/phone-finder/lookup",
      { method: "POST", body: JSON.stringify({ name, address }) },
    );
  },

  async startDistressedCrm(params: {
    zip?: string;
    city?: string;
    countyKey?: string;
    state?: string;
    categories?: string[];
    sourceKeys?: string[];
    campaignId?: number;
  }) {
    return request<JobResponse>("/scrape/distressed", {
      method: "POST",
      body: JSON.stringify({
        zip: params.zip || "",
        county_key: params.countyKey || "",
        state: params.state || "",
        categories: params.categories || [],
        source_keys: params.sourceKeys || [],
        campaign_id: params.campaignId,
      }),
    });
  },
};

export function logEngineConfig() {
  logger.info({ engineUrl: ENGINE_URL }, "Scraper engine client configured");
}
