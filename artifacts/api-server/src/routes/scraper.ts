/**
 * Lead Scraper API Routes (refactored)
 *
 * Primary: Python scraper engine (SCRAPER_ENGINE_URL)
 * Fallback: ScraperAPI / ScrapingBee
 *
 * Routes:
 *   POST /api/scraper/google-maps
 *   POST /api/scraper/google-search
 *   POST /api/scraper/nar-directory
 *   POST /api/scraper/zillow
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger";

const router: Router = Router();
const ENGINE_URL = (process.env.SCRAPER_ENGINE_URL || "").replace(/\/$/, "");

// ─── PIN Auth ───────────────────────────────────────────────────────────────
function requirePin(req: Request, res: Response, next: NextFunction) {
  const toolsPin = process.env.TOOLS_PIN;
  if (!toolsPin) { res.status(503).json({ error: "TOOLS_PIN not configured" }); return; }
  const provided = req.headers["x-tools-pin"] as string | undefined;
  if (!provided || provided.trim() !== toolsPin.trim()) { res.status(401).json({ error: "Invalid PIN" }); return; }
  next();
}

// ─── Helper: build CSV string ───────────────────────────────────────────────
function toCSV(rows: Record<string, any>[]): string {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const escape = (v: any) => {
    const s = v == null ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [keys.join(","), ...rows.map(r => keys.map(k => escape(r[k])).join(","))].join("\n");
}

// ─── Phone extraction helper ───────────────────────────────────────────────
const PHONE_REGEX = /(?:\+?1[\s.\-]?)?(?:\(?\d{3}\)?[\s.\-])?\d{3}[\s.\-]\d{4}/g;
function extractPhone(text: string): string {
  if (!text) return "";
  const matches = text.match(PHONE_REGEX);
  if (!matches) return "";
  const valid = matches.filter(m => m.replace(/\D/g, "").length >= 10);
  return valid[0] || "";
}

// ─── POST /scraper/google-maps ─────────────────────────────────────────────
router.post("/scraper/google-maps", requirePin, async (req: Request, res: Response) => {
  try {
    const { keywords = [], locations = [], maxResults = 50 } = req.body;
    if (!keywords.length || !locations.length) {
      return res.status(400).json({ error: "keywords and locations are required" });
    }

    let results: any[] = [];
    let creditExhausted = false;
    let apiErrorMsg = "";

    // 1. Try Python engine first
    try {
      const pyRes = await fetch(`${ENGINE_URL}/google-maps`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, locations, maxResults }),
      });
      const data = await pyRes.json();
      if (pyRes.ok && data.results?.length) results = data.results;
    } catch (err: any) {
      logger.warn("Python engine failed for Google Maps", err.message);
    }

    // 2. Fallback to ScraperAPI/ScrapingBee
    if (!results.length) {
      try {
        const data = await scraperApiStructured("search", { query: `${keywords[0]} near ${locations[0]}`, country_code: "us", num: "20" });
        results = data?.businesses || data?.local_packs || [];
      } catch (err: any) {
        creditExhausted = true;
        apiErrorMsg = "ScraperAPI exhausted — switched to ScrapingBee fallback";
        try {
          const { businesses } = await scrapingBeeGoogleSearch(`${keywords[0]} near ${locations[0]}`);
          results = businesses || [];
        } catch (beeErr: any) {
          logger.warn("ScrapingBee fallback failed", beeErr.message);
        }
      }
    }

    res.json({ count: results.length, csv: toCSV(results), results, ...(creditExhausted && { creditExhausted: true, apiError: apiErrorMsg }) });
  } catch (err: any) {
    logger.error({ err: err.message }, "Google Maps scraper error");
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /scraper/google-search ──────────────────────────────────────────
router.post("/scraper/google-search", requirePin, async (req: Request, res: Response) => {
  try {
    const { keywords = [], locations = [], maxResults = 50 } = req.body;
    if (!keywords.length) return res.status(400).json({ error: "keywords are required" });

    let results: any[] = [];
    let creditExhausted = false;
    let apiErrorMsg = "";

    // 1. Try Python engine first
    try {
      const pyRes = await fetch(`${ENGINE_URL}/google-search`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, locations, maxResults }),
      });
      const data = await pyRes.json();
      if (pyRes.ok && data.results?.length) results = data.results;
    } catch (err: any) {
      logger.warn("Python engine failed for Google Search", err.message);
    }

    // 2. Fallback
    if (!results.length) {
      try {
        const data = await scraperApiStructured("search", { query: `${keywords[0]} ${locations[0] || "United States"}`, country_code: "us", num: "20" });
        results = data?.organic_results || [];
      } catch (err: any) {
        creditExhausted = true;
        apiErrorMsg = "ScraperAPI exhausted — switched to ScrapingBee fallback";
        try {
          const { organic } = await scrapingBeeGoogleSearch(`${keywords[0]} ${locations[0] || "United States"}`);
          results = organic || [];
        } catch (beeErr: any) {
          logger.warn("ScrapingBee fallback failed", beeErr.message);
        }
      }
    }

    res.json({ count: results.length, csv: toCSV(results), results, ...(creditExhausted && { creditExhausted: true, apiError: apiErrorMsg }) });
  } catch (err: any) {
    logger.error({ err: err.message }, "Google Search scraper error");
    res.status(500).json({ error: err.message });
  }
});


    // 1. Try Python engine first
    try {
      const pyRes = await fetch(`${ENGINE_URL}/google-search`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, locations, maxResults }),
      });
      const data = await pyRes.json();
      if (pyRes.ok && data.results?.length) results = data.results;
    } catch (err: any) {
      logger.warn("Python engine failed for Google Search", err.message);
    }

    // 2. Fallback
    if (!results.length) {
      try {
        const data = await scraperApiStructured("search", { query: `${keywords[0]} ${locations[0] || "United States"}`, country_code: "us", num: "20" });
        results = data?.organic_results || [];
      } catch (err: any) {
        creditExhausted = true;
        apiErrorMsg = "ScraperAPI exhausted — switched to ScrapingBee fallback";
        try {
          const { organic } = await scrapingBeeGoogleSearch(`${keywords[0]} ${locations[0] || "United States"}`);
          results = organic || [];
        } catch (beeErr: any) {
          logger.warn("ScrapingBee fallback failed", beeErr.message);
        }
      }
    }

    res.json({ count: results.length, csv: toCSV(results), results, ...(creditExhausted && { creditExhausted: true, apiError: apiErrorMsg }) });
  } catch (err: any) {
    logger.error({ err: err.message }, "Google Search scraper error");
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /scraper/nar-directory ──────────────────────────────────────────
router.post("/scraper/nar-directory", requirePin, async (req: Request, res: Response) => {
  try {
    const { state = "", city = "", maxResults = 50 } = req.body;
    if (!state) return res.status(400).json({ error: "state is required" });

    let results: any[] = [];

    // 1. Try Python engine first
    try {
      const pyRes = await fetch(`${ENGINE_URL}/nar-directory`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, city, maxResults }),
      });
      const data = await pyRes.json();
      if (pyRes.ok && data.results?.length) results = data.results;
    } catch (err: any) {
      logger.warn("Python engine failed for NAR", err.message);
    }

    // 2. Fallback to ScrapingBee
    if (!results.length) {
      try {
        const params = new URLSearchParams({ stateAbbreviation: state });
        if (city) params.set("city", city);
        const listUrl = `https://directories.apps.realtor/memberResults?${params.toString()}`;
        const html = await scrapingBeeGet(listUrl, { render_js: "true", wait: "3000", premium_proxy: "true" });
        results.push({ rawHtml: html, state, city, source: "NAR (ScrapingBee)" });
      } catch (err: any) {
        logger.warn("ScrapingBee NAR fallback failed", err.message);
      }
    }

    res.json({ count: results.length, csv: toCSV(results), results });
  } catch (err: any) {
    logger.error({ err: err.message }, "NAR directory scraper error");
    res.status(500).json({ error: err.message });
  }
});

// ─── Zillow URL slug helpers ───────────────────────────────────────────────
function zillowSlug(city: string, stateAbbr: string): string {
  return `${city.trim().toLowerCase().replace(/\s+/g, "-")}-${stateAbbr.trim().toLowerCase()}`;
}

// ─── POST /scraper/zillow ──────────────────────────────────────────────────
router.post("/scraper/zillow", requirePin, async (req: Request, res: Response) => {
  try {
    const { mode = "agents", city = "", state = "", maxResults = 40 } = req.body;
    if (!city || !state) return res.status(400).json({ error: "city and state are required" });

    let results: any[] = [];

    // 1. Try Python engine first
    try {
      const pyRes = await fetch(`${ENGINE_URL}/zillow`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, city, state, maxResults }),
      });
      const data = await pyRes.json();
      if (pyRes.ok && data.results?.length) results = data.results;
    } catch (err: any) {
      logger.warn("Python engine failed for Zillow", err.message);
    }

    // 2. Fallback to ScrapingBee
    if (!results.length) {
      try {
        const slug = zillowSlug(city, state);
        const urlMap: Record<string, string> = {
          agents:   `https://www.zillow.com/professionals/real-estate-agents/${slug}/`,
          listings: `https://www.zillow.com/homes/for_sale/${slug}_rb/`,
          fsbo:     `https://www.zillow.com/homes/fsbo/${slug}_rb/`,
        };
        const targetUrl = urlMap[mode] || urlMap.agents;
        const html = await scrapingBeeGet(targetUrl);
        results.push({ rawHtml: html, city, state, mode, source: "Zillow (ScrapingBee)" });
      } catch (err: any) {
        logger.warn("ScrapingBee Zillow fallback failed", err.message);
      }
    }

    res.json({ count: results.length, csv: toCSV(results), results });
  } catch (err: any) {
    logger.error({ err: err.message }, "Zillow scraper error");
    res.status(500).json({ error: err.message });
  }
});

// ─── Bulk Runner (Google Maps / Search) ─────────────────────────────────────
router.post("/scraper/bulk", requirePin, async (req: Request, res: Response) => {
  try {
    const { tool = "google-maps", keywords = [], locations = [], maxPerCombo = 20 } = req.body;
    if (!keywords.length || !locations.length) return res.status(400).json({ error: "keywords and locations required" });

    let results: any[] = [];

    // 1. Try Python engine bulk endpoint
    try {
      const pyRes = await fetch(`${ENGINE_URL}/bulk`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, keywords, locations, maxPerCombo }),
      });
      const data = await pyRes.json();
      if (pyRes.ok && data.results?.length) results = data.results;
    } catch (err: any) {
      logger.warn("Python engine failed for bulk scrape", err.message);
    }

    // 2. Fallback to ScraperAPI/ScrapingBee
    if (!results.length) {
      for (const keyword of keywords.slice(0, 5)) {
        for (const location of locations.slice(0, 10)) {
          if (results.length >= maxPerCombo) break;
          const query = `${keyword} ${location}`;
          try {
            const data = await scraperApiStructured("search", { query, country_code: "us", num: "20" });
            results.push(...(data?.organic_results || []));
          } catch (err: any) {
            logger.warn("Fallback bulk scrape failed", err.message);
          }
        }
      }
    }

    res.json({ count: results.length, csv: toCSV(results), results });
  } catch (err: any) {
    logger.error({ err: err.message }, "Bulk scraper error");
    res.status(500).json({ error: err.message });
  }
});

// ─── Utility: ScraperAPI structured fallback ───────────────────────────────
async function scraperApiStructured(endpoint: "local" | "search", params: Record<string, string>): Promise<any> {
  const key = process.env.SCRAPERAPI_KEY;
  if (!key) throw new Error("ScraperAPI key missing");