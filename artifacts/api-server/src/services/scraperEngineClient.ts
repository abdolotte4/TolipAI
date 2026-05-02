/**
 * HTTP client for the Python digor-scraper-engine FastAPI service.
 *
 * The engine URL is configured via SCRAPER_ENGINE_URL (defaults to
 * http://localhost:8765 for local dev).  All calls fail soft — if the engine
 * is unreachable, callers get a 503 with a clear message instead of a 500.
 */
import { logger } from "../lib/logger";

const ENGINE_URL = (process.env.SCRAPER_ENGINE_URL || "http://localhost:8000").replace(/\/$/, "");
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
    const res = await fetch(`${ENGINE_URL}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
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
        `Cannot reach scraper engine at ${ENGINE_URL}. Set SCRAPER_ENGINE_URL or start the service.`,
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
        max_buyers: opts.maxBuyers ?? 25,
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
      }),
      timeoutMs: 30_000,
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
};

export function logEngineConfig() {
  logger.info({ engineUrl: ENGINE_URL }, "Scraper engine client configured");
}
