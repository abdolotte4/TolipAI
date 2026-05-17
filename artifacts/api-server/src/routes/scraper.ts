/**
 * Lead Scraper API Routes
 *
 * Primary:  Python scraper engine (SCRAPER_ENGINE_URL)
 * Fallback: ScraperAPI / ScrapingBee (4-key rotation each)
 *
 * Routes:
 *   POST /api/scraper/google-maps    — Google Maps local results
 *   POST /api/scraper/google-search  — Google organic search
 *   POST /api/scraper/nar-directory  — NAR Realtor Directory by state/city
 *   POST /api/scraper/zillow         — Zillow agents / listings / FSBO
 *   POST /api/scraper/bulk           — Bulk keyword × location matrix
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger";
import { digitsOnly } from "../services/coreCalculations";

const router: Router = Router();
const ENGINE_URL = (process.env.SCRAPER_ENGINE_URL || "").replace(/\/$/, "");

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

// ─── Phone extraction helpers ─────────────────────────────────────────────────

const PHONE_REGEX = /(?:\+?1[\s.\-]?)?(?:\(?\d{3}\)?[\s.\-])?\d{3}[\s.\-]\d{4}/g;
const PHONE_TEST  = /(?:\+?1[\s.\-]?)?(?:\(?\d{3}\)?[\s.\-])?\d{3}[\s.\-]\d{4}/;

function extractPhone(text: string): string {
  if (!text) return "";
  const matches: string[] = (text.match(PHONE_REGEX) as string[] | null) ?? [];
  const valid = matches.filter((m) => digitsOnly(m).length >= 10);
  return valid[0] ?? "";
}

function extractPhones(text: string): string[] {
  if (!text) return [];
  const matches: string[] = (text.match(PHONE_REGEX) as string[] | null) ?? [];
  return [...new Set(matches.filter((m) => digitsOnly(m).length >= 10))];
}

// ─── ScraperAPI / ScrapingBee key-rotation helpers ────────────────────────────

export class CreditExhaustedError extends Error {
  constructor(service: string, msg: string) {
    super(`CREDITS_EXHAUSTED:${service}:${msg}`);
    this.name = "CreditExhaustedError";
  }
}

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
    } catch { /* skip malformed JSON-LD */ }
  }

  const titleRegex   = /<h3[^>]*class="[^"]*LC20lb[^"]*"[^>]*>(.*?)<\/h3>/gi;
  const urlRegex     = /<a[^>]+href="(https?:\/\/(?!www\.google\.com)[^"&]+)"/gi;
  const snippetRegex = /class="[^"]*VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;

  const titles: string[]   = [];
  const urls: string[]     = [];
  const snippets: string[] = [];

  let tm: RegExpExecArray | null;
  while ((tm = titleRegex.exec(html)) !== null) titles.push(tm[1].replace(/<[^>]+>/g, "").trim());
  let um: RegExpExecArray | null;
  while ((um = urlRegex.exec(html)) !== null) { if (!urls.includes(um[1])) urls.push(um[1]); }
  let sm: RegExpExecArray | null;
  while ((sm = snippetRegex.exec(html)) !== null) snippets.push(sm[1].replace(/<[^>]+>/g, "").trim());

  for (let i = 0; i < Math.min(titles.length, 20); i++) {
    organic.push({ title: titles[i] || "", link: urls[i] || "", snippet: snippets[i] || "" });
  }

  return { businesses, organic };
}

async function scrapingBeeGet(url: string, extraParams: Record<string, string> = {}): Promise<string> {
  const keys = getScrapingBeeKeys();
  if (!keys.length) throw new CreditExhaustedError("ScrapingBee", "All ScrapingBee keys exhausted");

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = keys[(scrapingBeeRR + attempt) % keys.length];
    const params = new URLSearchParams({
      api_key: key, url,
      render_js: "true", premium_proxy: "true", block_ads: "true", wait: "2000",
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

// ─── Helper: attempt Python scraper engine ────────────────────────────────────
// Returns the results array on success, null if engine is unavailable or returns nothing.

async function tryEngine(path: string, body: Record<string, any>): Promise<any[] | null> {
  if (!ENGINE_URL) {
    logger.warn({ path }, "SCRAPER_ENGINE_URL not set — skipping engine, falling back to API");
    return null;
  }
  try {
    logger.info({ path, engineUrl: ENGINE_URL }, "Calling Python scraper engine");
    const res = await fetch(`${ENGINE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      let errText = "";
      try { errText = await res.text(); } catch {}
      logger.warn({ path, status: res.status, body: errText.slice(0, 300) }, "Engine returned non-200 — falling back");
      return null;
    }
    const data = await res.json() as any;
    logger.info({ path, keys: Object.keys(data || {}) }, "Engine raw response shape");
    const rows: any[] = data?.results || data?.businesses || data?.organic_results || data?.listings || [];
    if (!rows.length) {
      logger.warn({ path, data: JSON.stringify(data).slice(0, 200) }, "Engine returned 0 rows — falling back");
      return null;
    }
    logger.info({ path, count: rows.length }, "Engine returned results — using engine data");
    return rows;
  } catch (err: any) {
    const isConn = /ECONNREFUSED|fetch failed|network/i.test(err.message || "");
    logger.warn({ path, err: err.message, isConnError: isConn }, isConn
      ? "Python scraper engine unreachable (ECONNREFUSED) — check SCRAPER_ENGINE_URL"
      : "Python scraper engine error — falling back to ScraperAPI/ScrapingBee");
    return null;
  }
}

// ─── Helper: call NAR directory JSON API directly ─────────────────────────────
// NAR exposes a JSON search API — we call it without any third-party service.

async function narDirectApi(state: string, city: string, limit: number): Promise<Record<string, any>[] | null> {
  const headers = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Referer": "https://directories.apps.realtor/memberResults",
    "Origin": "https://directories.apps.realtor",
  };

  const apiEndpoints = [
    `https://directories.apps.realtor/api/v1/search/realtor?stateAbbreviation=${state}${city ? `&city=${encodeURIComponent(city)}` : ""}&pageSize=${Math.min(limit, 100)}&pageNumber=1`,
    `https://directories.apps.realtor/api/memberSearch?stateAbbreviation=${state}${city ? `&city=${encodeURIComponent(city)}` : ""}&pageSize=${Math.min(limit, 100)}`,
    `https://directories.apps.realtor/api/v1/members?stateAbbreviation=${state}${city ? `&city=${encodeURIComponent(city)}` : ""}&take=${Math.min(limit, 100)}&skip=0`,
  ];

  for (const endpoint of apiEndpoints) {
    try {
      const res = await fetch(endpoint, { headers, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      const data = await res.json() as any;
      const members: any[] = data?.members || data?.results || data?.data || data?.items || [];
      if (members.length > 0) {
        logger.info({ endpoint, count: members.length }, "NAR API endpoint succeeded");
        return members.slice(0, limit).map((m: any) => ({
          name: m.fullName || m.name || m.firstName && `${m.firstName} ${m.lastName}` || "",
          state,
          city: m.city || m.officecity || city || "",
          phone: m.phoneNumber || m.phone || m.cellPhone || "",
          email: m.email || m.emailAddress || "",
          office: m.officeName || m.brokerage || "",
          memberType: m.memberType || m.designations || "REALTOR®",
          nrdsId: m.nrdsId || m.memberId || "",
          profileUrl: m.nrdsId ? `https://directories.apps.realtor/memberProfile?nrdsId=${m.nrdsId}` : "",
          source: "NAR Directory (Direct API)",
        }));
      }
    } catch (err: any) {
      logger.debug({ endpoint, err: err.message }, "NAR API endpoint failed");
    }
  }
  return null;
}

// ─── POST /scraper/google-maps ────────────────────────────────────────────────

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

    // 1. Python engine
    const engineRows = await tryEngine("/google-maps", { keywords, locations, maxResults });
    if (engineRows) {
      res.json({ count: engineRows.length, csv: toCSV(engineRows), results: engineRows });
      return;
    }

    // 2. ScraperAPI Structured → ScrapingBee fallback
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

// ─── POST /scraper/google-search ──────────────────────────────────────────────

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

    // 1. Python engine
    const engineRows = await tryEngine("/google-search", { keywords, locations, maxResults });
    if (engineRows) {
      res.json({ count: engineRows.length, csv: toCSV(engineRows), results: engineRows });
      return;
    }

    // 2. ScraperAPI Structured → ScrapingBee fallback
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

// ─── POST /scraper/nar-directory ──────────────────────────────────────────────

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

    // 1. Python engine (uses httpx + residential proxy)
    const engineRows = await tryEngine("/nar-directory", { state, city, maxResults: limit });
    if (engineRows) {
      res.json({ count: engineRows.length, csv: toCSV(engineRows), results: engineRows });
      return;
    }

    // 2. Direct NAR API (no third-party service)
    const directRows = await narDirectApi(state, city, limit);
    if (directRows && directRows.length > 0) {
      res.json({ count: directRows.length, csv: toCSV(directRows), results: directRows });
      return;
    }

    // 3. ScrapingBee fallback (last resort)
    logger.info({ state, city }, "Falling back to ScrapingBee for NAR directory");
    const allResults: Record<string, any>[] = [];

    const params = new URLSearchParams({ stateAbbreviation: state });
    if (city) params.set("city", city);
    const listUrl = `https://directories.apps.realtor/memberResults?${params.toString()}`;

    const html = await scrapingBeeGet(listUrl, {
      render_js: "true",
      wait: "3000",
      premium_proxy: "true",
    });

    const profileLinkRegex = /href="(\/memberProfile\?[^"]+)"/g;
    const profileLinks: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = profileLinkRegex.exec(html)) !== null) {
      const href = m[1];
      if (!profileLinks.includes(href)) profileLinks.push(href);
    }

    if (profileLinks.length === 0) {
      const nameRe = /href="\/memberProfile[^"]*">([^<]+)<\/a>/g;
      const names: string[] = [];
      let nameMatch: RegExpExecArray | null;
      while ((nameMatch = nameRe.exec(html)) !== null) names.push(nameMatch[1].trim());
      for (let i = 0; i < Math.min(names.length, limit); i++) {
        allResults.push({
          name: names[i] || "", state, city: city || "",
          phone: "", memberType: "REALTOR®", profileUrl: "", source: "NAR Directory",
        });
      }
    } else {
      for (const link of profileLinks.slice(0, Math.min(limit, 20))) {
        try {
          const profileUrl = `https://directories.apps.realtor${link}`;
          const profileHtml = await scrapingBeeGet(profileUrl, {
            render_js: "true", wait: "2000", premium_proxy: "true",
          });
          const nameM  = profileHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
          const phoneM = profileHtml.match(/(\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4})/);
          const cityM  = profileHtml.match(/class="[^"]*city[^"]*"[^>]*>([^<]+)<\/\w+>/);
          const typeM  = profileHtml.match(/REALTOR®[^\s]?\s*(Associate)?/);
          allResults.push({
            name: nameM ? nameM[1].replace(/<[^>]+>/g, "").trim() : "",
            state,
            city: cityM ? cityM[1].trim() : city,
            phone: phoneM ? phoneM[1] : "",
            memberType: typeM ? typeM[0] : "REALTOR®",
            profileUrl,
            source: "NAR Directory (ScrapingBee)",
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

// ─── Zillow helpers ───────────────────────────────────────────────────────────

function zillowSlug(city: string, stateAbbr: string): string {
  return `${city.trim().toLowerCase().replace(/\s+/g, "-")}-${stateAbbr.trim().toLowerCase()}`;
}

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

    // 1. Python engine
    const engineRows = await tryEngine("/zillow", { mode, city, state, maxResults });
    if (engineRows) {
      res.json({ count: engineRows.length, csv: toCSV(engineRows), results: engineRows });
      return;
    }

    // 2. ScrapingBee fallback
    const limit = Math.min(Number(maxResults) || 40, 100);
    const slug  = zillowSlug(city, state);
    const allResults: Record<string, any>[] = [];

    const urlMap: Record<string, string> = {
      agents:   `https://www.zillow.com/professionals/real-estate-agents/${slug}/`,
      listings: `https://www.zillow.com/homes/for_sale/${slug}_rb/`,
      fsbo:     `https://www.zillow.com/homes/fsbo/${slug}_rb/`,
    };

    const targetUrl = urlMap[mode] || urlMap.agents;
    logger.info({ mode, targetUrl }, "Zillow scrape start");

    const html = await scrapingBeeGet(targetUrl);

    if (!html || html.length < 500) {
      res.status(502).json({ error: "Zillow returned an empty or blocked response. Try again — DataDome blocks vary by request." });
      return;
    }

    const nextData = extractNextData(html);

    if (nextData && mode === "agents") {
      const pageProps = nextData?.props?.pageProps || {};

      const newCards: any[] =
        pageProps?.displayData?.agentDirectoryFinderDisplay?.searchResults?.results?.resultsCards || [];

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
            city, state,
            source: "Zillow Agents",
          });
        }
      } else {
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

    if (!allResults.length && mode === "agents") {
      const nameRegex   = /class="[^"]*agent-name[^"]*"[^>]*>([^<]+)</gi;
      const phoneRegex  = /(\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4})/g;
      const brokerRegex = /class="[^"]*business-name[^"]*"[^>]*>([^<]+)</gi;

      const names: string[] = []; const phones: string[] = []; const brokers: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = nameRegex.exec(html))  !== null) names.push(m[1].trim());
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
      const priceRegex   = /class="[^"]*property-card-price[^"]*"[^>]*>([^<]+)</gi;

      const addresses: string[] = []; const prices: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = addressRegex.exec(html)) !== null) addresses.push(m[1].trim());
      while ((m = priceRegex.exec(html))   !== null) prices.push(m[1].trim());

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

// ─── POST /scraper/bulk ───────────────────────────────────────────────────────

router.post("/scraper/bulk", requirePin, async (req: Request, res: Response) => {
  try {
    const { tool = "google-maps", keywords = [], locations = [], maxPerCombo = 20 } = req.body;
    if (!keywords.length || !locations.length) {
      res.status(400).json({ error: "keywords and locations required" });
      return;
    }

    // 1. Python engine
    const engineRows = await tryEngine("/bulk", { tool, keywords, locations, maxPerCombo });
    if (engineRows) {
      res.json({ count: engineRows.length, csv: toCSV(engineRows), results: engineRows });
      return;
    }

    // 2. ScraperAPI fallback
    const results: Record<string, any>[] = [];
    for (const keyword of (keywords as string[]).slice(0, 5)) {
      for (const location of (locations as string[]).slice(0, 10)) {
        const query = `${keyword} ${location}`;
        try {
          const data = await scraperApiStructured("search", { query, country_code: "us", num: "20" });
          results.push(...(data?.organic_results || []));
        } catch (err: any) {
          logger.warn({ query, err: err.message }, "Fallback bulk scrape failed");
        }
      }
    }

    res.json({ count: results.length, csv: toCSV(results), results });
  } catch (err: any) {
    logger.error({ err: err.message }, "Bulk scraper error");
    res.status(500).json({ error: err.message });
  }
});

export default router;
