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

    // 2. /**
 * Lead Scraper API Routes
 *
 * Tools:
 *   POST /api/scraper/google-maps   — Search Google Maps by keyword + location (Oxylabs)
 *   POST /api/scraper/google-search — Search Google for companies by keyword (ScraperAPI)
 *   POST /api/scraper/nar-directory — Scrape NAR Realtor Directory by state/city (ScrapingBee)
 *   POST /api/scraper/zillow        — Scrape Zillow agents or property listings (Oxylabs universal)
 *
 * Auth: X-Tools-Pin header (same as other tools routes)
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger";

const router: Router = Router();

// ─── PIN Auth ─────────────────────────────────────────────────────────────────

function requirePin(req: Request, res: Response, next: NextFunction) {
  const toolsPin = process.env.TOOLS_PIN;
  if (!toolsPin) { res.status(503).json({ error: "TOOLS_PIN not configured" }); return; }
  const provided = req.headers["x-tools-pin"] as string | undefined;
  if (!provided || provided.trim() !== toolsPin.trim()) { res.status(401).json({ error: "Invalid PIN" }); return; }
  next();
}

// ─── Helper: build CSV string ─────────────────────────────────────────────────

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

// ─── Phone extraction helper ─────────────────────────────────────────────────
// Extracts the first US phone number from any text (snippets, details, descriptions)
const PHONE_REGEX = /(?:\+?1[\s.\-]?)?(?:\(?\d{3}\)?[\s.\-])?\d{3}[\s.\-]\d{4}/g;
const PHONE_TEST = /(?:\+?1[\s.\-]?)?(?:\(?\d{3}\)?[\s.\-])?\d{3}[\s.\-]\d{4}/;

function extractPhone(text: string): string {
  if (!text) return "";
  const matches = text.match(PHONE_REGEX);
  if (!matches) return "";
  // Filter out numbers that look like years or zip codes (5 digits or fewer)
  const valid = matches.filter(m => m.replace(/\D/g, "").length >= 10);
  return valid[0] || "";
}

// Extract all unique phone numbers from text
function extractPhones(text: string): string[] {
  if (!text) return [];
  const matches = text.match(PHONE_REGEX) || [];
  return [...new Set(matches.filter(m => m.replace(/\D/g, "").length >= 10))];
}

// ─── ScraperAPI helpers ──────────────────────────────────────────────────────

export class CreditExhaustedError extends Error {
  constructor(service: string, msg: string) {
    super(`CREDITS_EXHAUSTED:${service}:${msg}`);
    this.name = "CreditExhaustedError";
  }
}

// ─── Key rotation state ───────────────────────────────────────────────────────
// Exhausted keys are skipped automatically; rotation is round-robin across
// all healthy keys so load is spread evenly and credits last 4× longer.

const exhaustedKeys = new Set<string>();
let scraperApiRR = 0;
let scrapingBeeRR = 0;

function getScraperApiKeys(): string[] {
  return [
    process.env.SCRAPERAPI_KEY,
    process.env.SCRAPERAPI_KEY_2,
    process.env.SCRAPERAPI_KEY_3,
    process.env.SCRAPERAPI_KEY_4,
  ].filter((k): k is string => !!k && !exhaustedKeys.has(k));
}

function getScrapingBeeKeys(): string[] {
  return [
    process.env.SCRAPINGBEE_API_KEY,
    process.env.SCRAPINGBEE_API_KEY_2,
    process.env.SCRAPINGBEE_API_KEY_3,
    process.env.SCRAPINGBEE_API_KEY_4,
  ].filter((k): k is string => !!k && !exhaustedKeys.has(k));
}

function isExhaustedResponse(text: string, status: number): boolean {
  return status === 403 && text.toLowerCase().includes("exhausted");
}

async function scraperApiGet(targetUrl: string, extraParams: Record<string, string> = {}): Promise<string> {
  const keys = getScraperApiKeys();
  if (!keys.length) throw new CreditExhaustedError("ScraperAPI", "All ScraperAPI keys exhausted");

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = keys[(scraperApiRR + attempt) % keys.length];
    const params = new URLSearchParams({ api_key: key, url: targetUrl, render: "false", ...extraParams });
    const res = await fetch(`https://api.scraperapi.com/?${params.toString()}`);
    const text = await res.text();
    if (isExhaustedResponse(text, res.status)) {
      exhaustedKeys.add(key);
      logger.warn({ keyTail: key.slice(-6) }, "ScraperAPI key exhausted — rotating");
      continue;
    }
    if (!res.ok) throw new Error(`ScraperAPI ${res.status}: ${text.slice(0, 200)}`);
    scraperApiRR = (scraperApiRR + attempt + 1);
    return text;
  }
  throw new CreditExhaustedError("ScraperAPI", "All ScraperAPI keys exhausted");
}

// ScraperAPI Structured — returns clean JSON for Google local/search results
async function scraperApiStructured(endpoint: "local" | "search", params: Record<string, string>): Promise<any> {
  const keys = getScraperApiKeys();
  if (!keys.length) throw new CreditExhaustedError("ScraperAPI", "All ScraperAPI keys exhausted");

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = keys[(scraperApiRR + attempt) % keys.length];
    const qs = new URLSearchParams({ api_key: key, ...params });
    const url = `https://api.scraperapi.com/structured/google/${endpoint}?${qs.toString()}`;
    const res = await fetch(url);
    const text = await res.text();
    if (isExhaustedResponse(text, res.status)) {
      exhaustedKeys.add(key);
      logger.warn({ keyTail: key.slice(-6) }, "ScraperAPI key exhausted — rotating");
      continue;
    }
    if (!res.ok) throw new Error(`ScraperAPI structured ${res.status}: ${text.slice(0, 300)}`);
    scraperApiRR = (scraperApiRR + attempt + 1);
    try { return JSON.parse(text); }
    catch { throw new Error(`ScraperAPI structured: non-JSON response: ${text.slice(0, 200)}`); }
  }
  throw new CreditExhaustedError("ScraperAPI", "All ScraperAPI keys exhausted");
}

// ─── ScrapingBee Google fallback ─────────────────────────────────────────────
// When ScraperAPI credits are exhausted, fall back to ScrapingBee HTML scraping.

async function scrapingBeeGoogleSearch(query: string): Promise<{ businesses: any[]; organic: any[] }> {
  const encoded = encodeURIComponent(query);
  const googleUrl = `https://www.google.com/search?q=${encoded}&num=20&gl=us&hl=en`;

  const html = await scrapingBeeGet(googleUrl, {
    custom_google: "true",
    render_js: "false",
    premium_proxy: "false",
    block_ads: "true",
    wait: "0",
  });

  const businesses: any[] = [];
  const organic: any[] = [];

  // ── Extract JSON-LD structured data ──────────────────────────────────────
  const jsonLdRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let jm: RegExpExecArray | null;
  while ((jm = jsonLdRegex.exec(html)) !== null) {
    try {
      const obj = JSON.parse(jm[1]);
      const items: any[] = Array.isArray(obj) ? obj : [obj];
      for (const item of items) {
        if (item["@type"] === "LocalBusiness" || item["@type"]?.includes("Business")) {
          businesses.push({
            title: item.name || "",
            telephone_number: item.telephone || "",
            location: item.address?.streetAddress || item.address || "",
            url: item.url || "",
            rating: item.aggregateRating?.ratingValue || "",
            reviews: item.aggregateRating?.reviewCount || "",
          });
        }
      }
    } catch { /* skip */ }
  }

  // ── Extract organic results from HTML titles + URLs ───────────────────────
  // Google renders <h3> tags for titles and data-ved links around them
  const titleRegex = /<h3[^>]*class="[^"]*LC20lb[^"]*"[^>]*>(.*?)<\/h3>/gi;
  const urlRegex = /<a[^>]+href="(https?:\/\/(?!www\.google\.com)[^"&]+)"/gi;
  const snippetRegex = /class="[^"]*VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;

  const titles: string[] = [];
  const urls: string[] = [];
  const snippets: string[] = [];

  let tm: RegExpExecArray | null;
  while ((tm = titleRegex.exec(html)) !== null) {
    titles.push(tm[1].replace(/<[^>]+>/g, "").trim());
  }
  let um: RegExpExecArray | null;
  while ((um = urlRegex.exec(html)) !== null) {
    if (!urls.includes(um[1])) urls.push(um[1]);
  }
  let sm: RegExpExecArray | null;
  while ((sm = snippetRegex.exec(html)) !== null) {
    snippets.push(sm[1].replace(/<[^>]+>/g, "").trim());
  }

  for (let i = 0; i < Math.min(titles.length, 20); i++) {
    organic.push({
      title: titles[i] || "",
      link: urls[i] || "",
      snippet: snippets[i] || "",
    });
  }

  return { businesses, organic };
}

// ─── ScrapingBee helper ──────────────────────────────────────────────────────

async function scrapingBeeGet(url: string, extraParams: Record<string, string> = {}): Promise<string> {
  const keys = getScrapingBeeKeys();
  if (!keys.length) throw new CreditExhaustedError("ScrapingBee", "All ScrapingBee keys exhausted");

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = keys[(scrapingBeeRR + attempt) % keys.length];
    const params = new URLSearchParams({
      api_key: key,
      url,
      render_js: "true",
      premium_proxy: "true",
      block_ads: "true",
      wait: "2000",
      ...extraParams,
    });
    const res = await fetch(`https://app.scrapingbee.com/api/v1/?${params.toString()}`);
    const text = await res.text();
    if (isExhaustedResponse(text, res.status) || (res.status === 403 && text.includes("credits"))) {
      exhaustedKeys.add(key);
      logger.warn({ keyTail: key.slice(-8) }, "ScrapingBee key exhausted — rotating");
      continue;
    }
    if (!res.ok) {
      logger.error({ status: res.status, body: text.slice(0, 500) }, "ScrapingBee error");
      throw new Error(`ScrapingBee ${res.status}: ${text.slice(0, 300)}`);
    }
    scrapingBeeRR = (scrapingBeeRR + attempt + 1);
    return text;
  }
  throw new CreditExhaustedError("ScrapingBee", "All ScrapingBee keys exhausted");
}

// ─── POST /scraper/google-maps ─────────────────────────────────────────────
// Uses ScraperAPI Structured — Google Local results (business name, address, phone, rating)

router.post("/scraper/google-maps", requirePin, async (req: Request, res: Response) => {
  try {
    const { keywords = [], locations = [], maxResults = 50 } = req.body as {
      keywords: string[];
      locations: string[];
      maxResults: number;
    };

    if (!keywords.length || !locations.length) {
      res.status(400).json({ error: "keywords and locations are required" });
      return;
    }

    const allResults: Record<string, any>[] = [];
    const limit = Math.min(Number(maxResults) || 50, 200);
    let creditExhausted = false;
    let apiErrorMsg = "";

    for (const keyword of keywords.slice(0, 5)) {
      for (const location of locations.slice(0, 10)) {
        if (allResults.length >= limit) break;

        const query = `${keyword} near ${location}`;

        const processBusinesses = (businesses: any[], organic: any[], source: string) => {
          for (const r of businesses) {
            if (allResults.length >= limit) break;
            const allText = [
              r.telephone_number || "",
              Array.isArray(r.details) ? r.details.join(" ") : (r.details || ""),
              r.description || "",
              r.snippet || "",
            ].join(" ");
            const phone = r.telephone_number || extractPhone(allText) || "";
            const detailsArr: string[] = Array.isArray(r.details) ? r.details : [];
            const addrLine = detailsArr.find((d: string) =>
              /\d/.test(d) && !PHONE_TEST.test(d) && d.length > 5
            ) || r.location || "";
            allResults.push({
              name: r.title || r.name || "",
              category: r.type || "",
              address: addrLine,
              phone,
              website: r.url || r.website || "",
              rating: r.rating || "",
              reviews: r.reviews || "",
              keyword,
              location,
              source,
            });
          }
          if (businesses.length === 0) {
            for (const r of organic.slice(0, 5)) {
              if (allResults.length >= limit) break;
              const url = r.link || r.url || "";
              if (!url || url.includes("google.com")) continue;
              let domain = "";
              try { domain = new URL(url).hostname.replace("www.", ""); } catch {}
              allResults.push({
                name: r.title || domain,
                category: "", address: "", phone: "",
                website: url, rating: "", reviews: "",
                keyword, location, source: source + " (organic)",
              });
            }
          }
        };

        try {
          const data = await scraperApiStructured("search", { query, country_code: "us", num: "20" });
          const businesses: any[] = data?.businesses || data?.local_packs || [];
          const organic: any[] = data?.organic_results || [];
          processBusinesses(businesses, organic, "Google Maps");
        } catch (err: any) {
          if (err.name === "CreditExhaustedError" || err.message.includes("CREDITS_EXHAUSTED")) {
            creditExhausted = true;
            apiErrorMsg = "ScraperAPI monthly credits exhausted — switched to ScrapingBee fallback";
            logger.warn({ query }, "ScraperAPI exhausted — falling back to ScrapingBee for Google Maps");
            try {
              const { businesses, organic } = await scrapingBeeGoogleSearch(query);
              processBusinesses(businesses, organic, "Google Maps (ScrapingBee)");
            } catch (beeErr: any) {
              logger.warn({ query, err: beeErr.message }, "ScrapingBee fallback also failed");
            }
          } else {
            logger.warn({ keyword, location, err: err.message }, "Google Maps scrape failed for combo");
          }
        }

        await new Promise(r => setTimeout(r, 400));
      }
    }

    res.json({
      count: allResults.length,
      csv: allResults.length ? toCSV(allResults) : "",
      results: allResults,
      ...(creditExhausted && { creditExhausted: true, apiError: apiErrorMsg }),
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "Google Maps scraper error");
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /scraper/google-search ──────────────────────────────────────────
// Uses ScraperAPI Structured — Google organic search results (clean JSON, no HTML parsing)

router.post("/scraper/google-search", requirePin, async (req: Request, res: Response) => {
  try {
    const { keywords = [], locations = [], maxResults = 50 } = req.body as {
      keywords: string[];
      locations: string[];
      maxResults: number;
    };

    if (!keywords.length) {
      res.status(400).json({ error: "keywords are required" });
      return;
    }

    const allResults: Record<string, any>[] = [];
    const limit = Math.min(Number(maxResults) || 50, 200);
    let creditExhausted = false;
    let apiErrorMsg = "";

    const pushOrganic = (organic: any[], keyword: string, location: string, source: string) => {
      for (const r of organic) {
        if (allResults.length >= limit) break;
        const url = r.link || r.url || "";
        if (!url || url.includes("google.com") || url.includes("maps.google")) continue;
        let domain = "";
        try { domain = new URL(url).hostname.replace("www.", ""); } catch {}
        const snippet = r.snippet || r.description || "";
        allResults.push({
          name: r.title || r.name || domain,
          phone: extractPhone(snippet),
          url, domain, snippet, keyword, location, source,
        });
      }
    };

    for (const keyword of keywords.slice(0, 5)) {
      for (const location of (locations.length ? locations : ["United States"]).slice(0, 10)) {
        if (allResults.length >= limit) break;
        const query = `${keyword} ${location}`;

        try {
          const data = await scraperApiStructured("search", { query, country_code: "us", num: "20" });
          pushOrganic(data?.organic_results || data?.results || [], keyword, location, "Google Search");
        } catch (err: any) {
          if (err.name === "CreditExhaustedError" || err.message.includes("CREDITS_EXHAUSTED")) {
            creditExhausted = true;
            apiErrorMsg = "ScraperAPI monthly credits exhausted — switched to ScrapingBee fallback";
            logger.warn({ query }, "ScraperAPI exhausted — falling back to ScrapingBee for Google Search");
            try {
              const { organic } = await scrapingBeeGoogleSearch(query);
              pushOrganic(organic, keyword, location, "Google Search (ScrapingBee)");
            } catch (beeErr: any) {
              logger.warn({ query, err: beeErr.message }, "ScrapingBee Google Search fallback failed");
            }
          } else {
            logger.warn({ keyword, location, err: err.message }, "Google Search scrape failed");
          }
        }

        await new Promise(r => setTimeout(r, 300));
      }
    }

    res.json({
      count: allResults.length,
      csv: toCSV(allResults),
      results: allResults,
      ...(creditExhausted && { creditExhausted: true, apiError: apiErrorMsg }),
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "Google Search scraper error");
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /scraper/nar-directory ──────────────────────────────────────────

router.post("/scraper/nar-directory", requirePin, async (req: Request, res: Response) => {
  try {
    const { state = "", city = "", maxResults = 50 } = req.body as {
      state: string;
      city: string;
      maxResults: number;
    };

    if (!state) {
      res.status(400).json({ error: "state is required" });
      return;
    }

    const limit = Math.min(Number(maxResults) || 50, 300);
    const allResults: Record<string, any>[] = [];

    // Build NAR search URL
    const params = new URLSearchParams({ stateAbbreviation: state });
    if (city) params.set("city", city);
    const listUrl = `https://directories.apps.realtor/memberResults?${params.toString()}`;

    logger.info({ listUrl }, "Scraping NAR directory listing");

    const html = await scrapingBeeGet(listUrl, {
      render_js: "true",
      wait: "3000",
      premium_proxy: "true",
    });

    // Parse member rows from the listing page
    // NAR listing page links look like: /memberProfile?...
    const profileLinkRegex = /href="(\/memberProfile\?[^"]+)"/g;
    const profileLinks: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = profileLinkRegex.exec(html)) !== null) {
      const href = m[1];
      if (!profileLinks.includes(href)) profileLinks.push(href);
    }

    // Also parse names and locations directly from listing if no profiles found
    const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const nameRegex = /\/memberProfile[^"]*">([^<]+)<\/a>/g;
    const locationRegex = /<td[^>]*>([A-Z]{2}|[A-Za-z ,]+)<\/td>/g;

    if (profileLinks.length === 0) {
      // Fallback: parse names directly from table
      let nameMatch: RegExpExecArray | null;
      const nameRe = /href="\/memberProfile[^"]*">([^<]+)<\/a>/g;
      const locRe = /<td[^>]*class="[^"]*location[^"]*"[^>]*>([\s\S]*?)<\/td>/gi;

      const names: string[] = [];
      const locs: string[] = [];

      while ((nameMatch = nameRe.exec(html)) !== null) {
        names.push(nameMatch[1].trim());
      }

      for (let i = 0; i < Math.min(names.length, limit); i++) {
        allResults.push({
          name: names[i] || "",
          state,
          city: city || "",
          phone: "",
          memberType: "REALTOR®",
          profileUrl: "",
          source: "NAR Directory",
        });
      }
    } else {
      // Visit individual profiles to get phone numbers (up to limit)
      const profilesToFetch = profileLinks.slice(0, limit);
      for (const link of profilesToFetch) {
        try {
          const profileUrl = `https://directories.apps.realtor${link}`;
          const profileHtml = await scrapingBeeGet(profileUrl, {
            render_js: "true",
            wait: "2000",
            premium_proxy: "true",
          });

          const nameM = profileHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
          const phoneM = profileHtml.match(/(\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4})/);
          const cityM = profileHtml.match(/class="[^"]*city[^"]*"[^>]*>([^<]+)<\/\w+>/);
          const typeM = profileHtml.match(/REALTOR®[^\s]?\s*(Associate)?/);

          allResults.push({
            name: nameM ? nameM[1].replace(/<[^>]+>/g, "").trim() : "",
            state,
            city: cityM ? cityM[1].trim() : city,
            phone: phoneM ? phoneM[1] : "",
            memberType: typeM ? typeM[0] : "REALTOR®",
            profileUrl,
            source: "NAR Directory",
          });
        } catch (err: any) {
          logger.warn({ link, err: err.message }, "NAR profile scrape failed");
        }
        await new Promise(r => setTimeout(r, 800));
      }
    }

    res.json({ count: allResults.length, csv: toCSV(allResults), results: allResults });
  } catch (err: any) {
    logger.error({ err: err.message }, "NAR directory scraper error");
    res.status(500).json({ error: err.message });
  }
});

// ─── Zillow URL slug helpers ──────────────────────────────────────────────────

function zillowSlug(city: string, stateAbbr: string): string {
  return `${city.trim().toLowerCase().replace(/\s+/g, "-")}-${stateAbbr.trim().toLowerCase()}`;
}

// ─── Zillow: parse __NEXT_DATA__ JSON from rendered HTML ─────────────────────

function extractNextData(html: string): any {
  const match = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

// ─── POST /scraper/zillow ─────────────────────────────────────────────────────

router.post("/scraper/zillow", requirePin, async (req: Request, res: Response) => {
  try {
    const {
      mode = "agents",
      city = "",
      state = "",
      maxResults = 40,
    } = req.body as { mode: "agents" | "listings" | "fsbo"; city: string; state: string; maxResults: number };

    if (!city || !state) {
      res.status(400).json({ error: "city and state are required" });
      return;
    }

    const limit = Math.min(Number(maxResults) || 40, 100);
    const slug = zillowSlug(city, state);
    const allResults: Record<string, any>[] = [];

    const urlMap: Record<string, string> = {
      agents:   `https://www.zillow.com/professionals/real-estate-agents/${slug}/`,
      listings: `https://www.zillow.com/homes/for_sale/${slug}_rb/`,
      fsbo:     `https://www.zillow.com/homes/fsbo/${slug}_rb/`,
    };

    const targetUrl = urlMap[mode] || urlMap.agents;
    logger.info({ mode, targetUrl }, "Zillow scrape start");

    // Use ScrapingBee with JS rendering + premium proxies to bypass DataDome
    const html = await scrapingBeeGet(targetUrl);

    if (!html || html.length < 500) {
      res.status(502).json({ error: "Zillow returned an empty or blocked response. Try again — DataDome blocks vary by request." });
      return;
    }

    // ── Strategy 1: extract __NEXT_DATA__ JSON (most reliable) ───────────────

    const nextData = extractNextData(html);

    if (nextData && mode === "agents") {
      const pageProps = nextData?.props?.pageProps || {};

      // ── New Zillow structure (2024+): displayData.agentDirectoryFinderDisplay ──
      const newCards: any[] =
        pageProps?.displayData?.agentDirectoryFinderDisplay?.searchResults?.results?.resultsCards || [];

      // ── Legacy Zillow structure (fallback) ────────────────────────────────────
      const legacyAgents: any[] =
        pageProps?.searchResultsProps?.agentResults ||
        pageProps?.agents ||
        pageProps?.agentList?.agents ||
        [];

      if (newCards.length > 0) {
        const realCards = newCards.filter((c: any) =>
          c?.cardTitle && !c.cardTitle.toLowerCase().includes("get help") && c?.cardActionLink?.includes("/profile/")
        );
        for (const card of realCards.slice(0, limit)) {

// profileData is [{formattedData, label}] — pull sales/price stats
          const pd: any[] = card?.profileData || [];
          const getStat = (label: string) =>
            pd.find((x: any) => x?.label?.toLowerCase().includes(label))?.formattedData || "";

          allResults.push({
            name: card?.cardTitle || "",
            sales12mo: getStat("sales last 12"),
            priceRange: getStat("price range"),
            totalSales: getStat("sales in"),
            profileUrl: card?.cardActionLink || "",
            isTopAgent: card?.isTopAgent ? "Yes" : "No",
            city,
            state,
            source: "Zillow Agents",
          });
        }
      } else {
        // Legacy path
        for (const agent of legacyAgents.slice(0, limit)) {
          allResults.push({
            name: agent?.fullName || agent?.displayName || agent?.name || "",
            brokerage: agent?.businessName || agent?.brokerageName || "",
            phone: agent?.phone || agent?.phoneNumber || "",
            city: agent?.location?.city || city,
            state: agent?.location?.stateCode || state,
            rating: agent?.rating || agent?.reviewStats?.averageRating || "",
            reviews: agent?.reviewCount || agent?.reviewStats?.totalReviewCount || "",
            recentSales: agent?.recentSales || agent?.saleCountAllTime || "",
            activeListings: agent?.activeListingCount || "",
            profileUrl: agent?.profileUrl ? `https://www.zillow.com${agent.profileUrl}` : "",
            source: "Zillow Agents",
          });
        }
      }
    }

    if (nextData && (mode === "listings" || mode === "fsbo") && !allResults.length) {
      const cat = nextData?.cat1 || nextData?.searchPageState?.cat1 || {};
      const props =
        cat?.searchResults?.listResults ||
        cat?.searchResults?.mapResults ||
        nextData?.searchPageState?.searchResults?.listResults ||
        [];

      for (const p of props.slice(0, limit)) {
        allResults.push({
          address: p?.address || p?.hdpData?.homeInfo?.streetAddress || "",
          city: p?.hdpData?.homeInfo?.city || city,
          state: p?.hdpData?.homeInfo?.state || state,
          zip: p?.hdpData?.homeInfo?.zipcode || "",
          price: p?.price || p?.hdpData?.homeInfo?.price || "",
          beds: p?.beds || p?.hdpData?.homeInfo?.bedrooms || "",
          baths: p?.baths || p?.hdpData?.homeInfo?.bathrooms || "",
          sqft: p?.area || p?.hdpData?.homeInfo?.livingArea || "",
          daysOnMarket: p?.hdpData?.homeInfo?.daysOnZillow ?? "",
          listingAgent: p?.brokerName || "",
          listingType: mode === "fsbo" ? "FSBO" : "Active Listing",
          zillowUrl: p?.detailUrl ? `https://www.zillow.com${p.detailUrl}` : "",
          source: mode === "fsbo" ? "Zillow FSBO" : "Zillow Listings",
        });
      }
    }

    // ── Strategy 2: regex HTML fallback (when __NEXT_DATA__ is missing) ──────

    if (!allResults.length && mode === "agents") {
      const nameRegex = /class="[^"]*agent-name[^"]*"[^>]*>([^<]+)</gi;
      const phoneRegex = /(\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4})/g;
      const brokerRegex = /class="[^"]*business-name[^"]*"[^>]*>([^<]+)</gi;

      const names: string[] = []; const phones: string[] = []; const brokers: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = nameRegex.exec(html)) !== null) names.push(m[1].trim());
      while ((m = phoneRegex.exec(html)) !== null) phones.push(m[1]);
      while ((m = brokerRegex.exec(html)) !== null) brokers.push(m[1].trim());

      for (let i = 0; i < Math.min(names.length, limit); i++) {
        allResults.push({
          name: names[i] || "",
          brokerage: brokers[i] || "",
          phone: phones[i] || "",
          city, state,
          source: "Zillow Agents (HTML fallback)",
        });
      }
    }

    if (!allResults.length && (mode === "listings" || mode === "fsbo")) {
      const addressRegex = /class="[^"]*property-card-addr[^"]*"[^>]*>([^<]+)</gi;
      const priceRegex = /class="[^"]*property-card-price[^"]*"[^>]*>([^<]+)</gi;

      const addresses: string[] = []; const prices: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = addressRegex.exec(html)) !== null) addresses.push(m[1].trim());
      while ((m = priceRegex.exec(html)) !== null) prices.push(m[1].trim());

      for (let i = 0; i < Math.min(addresses.length, limit); i++) {
        allResults.push({
          address: addresses[i] || "",
          price: prices[i] || "",
          city, state,
          listingType: mode === "fsbo" ? "FSBO" : "Active Listing",
          source: mode === "fsbo" ? "Zillow FSBO (HTML fallback)" : "Zillow Listings (HTML fallback)",
        });
      }
    }

    if (!allResults.length) {
      res.json({
        count: 0, csv: "", results: [],
        warning: "Zillow returned a page but no data could be extracted. DataDome may have detected the request. Try again.",
      });
      return;
    }

    res.json({ count: allResults.length, csv: toCSV(allResults), results: allResults });
  } catch (err: any) {
    logger.error({ err: err.message }, "Zillow scraper error");
    res.status(500).json({ error: err.message });
  }
});

export default router;

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

async function scrapingBeeGoogleSearch(query: string): Promise<any> {
  const key = process.env.SCRAPINGBEE_KEY;
  if (!key) throw new Error("ScrapingBee key missing");

  const params = new URLSearchParams({
    api_key: key,
    url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    render_js: "false",
  });

  const res = await fetch(`https://app.scrapingbee.com/api/v1?${params.toString()}`);
  if (!res.ok) throw new Error(`ScrapingBee error: ${res.status}`);
  return await res.text(); // Google search returns HTML, not JSON
}

async function scrapingBeeGet(url: string, opts: Record<string, string> = {}): Promise<string> {
  const key = process.env.SCRAPINGBEE_KEY;
  if (!key) throw new Error("ScrapingBee key missing");

  const params = new URLSearchParams({ api_key: key, url, ...opts });
  const res = await fetch(`https://app.scrapingbee.com/api/v1?${params.toString()}`);
  if (!res.ok) throw new Error(`ScrapingBee error: ${res.status}`);
  return await res.text();
}


// ─── Utility: ScraperAPI structured fallback ───────────────────────────────
async function scraperApiStructured(endpoint: "local" | "search", params: Record<string, string>): Promise<any> {
  const key = process.env.SCRAPERAPI_KEY;
  if (!key) throw new Error("ScraperAPI key missing");

  const url = `https://api.scraperapi.com/${endpoint}?api_key=${key}&${new URLSearchParams(params).toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ScraperAPI error: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}
