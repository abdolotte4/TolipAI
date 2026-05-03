/**
 * Digor Tools API Routes
 *
 * Auth: X-Tools-Pin header (env: TOOLS_PIN)
 * Skip Trace: PropertyAPI.co POST /skip-trace
 * Property Data: PropertyAPI.co GET /parcels/search-by-address
 * Comps: ATTOM sale/snapshot (lat/lon radius)
 * Distressed List: ATTOM property/detailmortgageowner (zip or county) — returns owner name, mortgage, absentee status
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger";
import { db } from "@workspace/db";
import { toolsSkipTraceJobs, toolsDistressedJobs } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import Papa from "papaparse";
import { estimateMarketPricePerSqft, ADJUSTMENT_FACTORS, calculateMao } from "../services/propertyApi";
import { attomGet, hasAttomKey, fetchAttomAvm, geocodeViaAttom, fetchPropertyDataViaAttom } from "../services/attomApi";

const router: Router = Router();

// ─── PIN Auth ─────────────────────────────────────────────────────────────────

function requirePin(req: Request, res: Response, next: NextFunction) {
  const toolsPin = process.env.TOOLS_PIN;
  if (!toolsPin) { res.status(503).json({ error: "TOOLS_PIN not configured" }); return; }
  const provided = req.headers["x-tools-pin"] as string | undefined;
  if (!provided || provided.trim() !== toolsPin.trim()) { res.status(401).json({ error: "Invalid PIN" }); return; }
  next();
}

// ─── PropertyAPI.co Client ────────────────────────────────────────────────────

const PAPI_BASE = "https://propertyapi.co/api/v1";

function getPropertyApiKeys(): string[] {
  const keys: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const k = process.env[`PROPERTY_API_KEY_${i}`];
    if (k) keys.push(k.trim());
  }
  const legacy = process.env.PROPERTY_API_KEY;
  if (legacy && !keys.includes(legacy.trim())) keys.push(legacy.trim());
  return keys;
}

let _papiKeyIndex = 0;
const _depletedKeys = new Set<string>();

function getNextPropertyApiKey(): string | null {
  const keys = getPropertyApiKeys();
  if (!keys.length) return null;
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = keys[_papiKeyIndex % keys.length]!;
    _papiKeyIndex = (_papiKeyIndex + 1) % keys.length;
    if (!_depletedKeys.has(key)) return key;
  }
  return null;
}

/** Batch skip trace — up to 50 lookups per call. Returns map of uid → result.
 *  Automatically retries with next key if current key is depleted.
 *  Passing ownerName costs 1 credit; address-only costs 2 credits. */
async function skipTraceBatch(
  lookups: Array<{ uid: string; street: string; city: string; state: string; zip: string; ownerName?: string }>,
): Promise<Record<string, { phones: string[]; emails: string[]; ownerName: string }>> {
  const body = {
    lookups: lookups.map(l => {
      const entry: Record<string, any> = {
        uid: l.uid,
        address: { street: l.street, city: l.city, state: l.state, zip: l.zip },
      };
      if (l.ownerName) {
        const parts = l.ownerName.trim().split(/\s+/);
        entry.name = { first: parts[0] || "", last: parts.slice(1).join(" ") || "" };
      }
      return entry;
    }),
  };

  const allKeys = getPropertyApiKeys();
  let lastError = "";

  for (let attempt = 0; attempt < allKeys.length; attempt++) {
    const key = getNextPropertyApiKey();
    if (!key) throw new Error("All PropertyAPI keys are depleted");

    const res = await fetch(`${PAPI_BASE}/skip-trace`, {
      method: "POST",
      headers: { "X-Api-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const isDepletedError = text.includes("Insufficient credits") || text.includes("insufficient");
      if (isDepletedError) {
        _depletedKeys.add(key);
        logger.warn({ key: key.slice(-8) }, "PropertyAPI key depleted — rotating to next key");
        lastError = text.slice(0, 200);
        continue;
      }
      throw new Error(`PropertyAPI skip-trace ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json() as any;

    if (json.status === "error") {
      const isDepletedError = (json.error || "").includes("Insufficient credits") || (json.error || "").includes("insufficient");
      if (isDepletedError) {
        _depletedKeys.add(key);
        logger.warn({ key: key.slice(-8) }, "PropertyAPI key depleted — rotating to next key");
        lastError = json.error;
        continue;
      }
      throw new Error(`PropertyAPI skip-trace error: ${json.error}`);
    }

    const result: Record<string, { phones: string[]; emails: string[]; ownerName: string }> = {};
    for (const item of json.data || []) {
      const uid = item?.query?.requestId || item?.id || "";
      const phones: string[] = [];
      const emails: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const num = item[`phone_${i}_number`];
        if (num) phones.push(String(num));
        const em = item[`email_${i}`];
        if (em) emails.push(String(em));
      }
      const ownerName = [item.name_first, item.name_last].filter(Boolean).join(" ");
      result[uid] = { phones, emails, ownerName };
    }
    return result;
  }

  throw new Error(`All PropertyAPI keys depleted. Last error: ${lastError}`);
}

/** Lookup single property data via PropertyAPI search-by-address (1 credit).
 *  Retries with each available key on 402 (insufficient credits). */
async function lookupProperty(address: string) {
  const allKeys = getPropertyApiKeys();
  if (!allKeys.length) throw new Error("No PropertyAPI key configured");

  let lastError = "";
  for (let attempt = 0; attempt < allKeys.length; attempt++) {
    const key = getNextPropertyApiKey();
    if (!key) break;
    // PropertyAPI requires + for spaces (not %20) — use URLSearchParams which encodes correctly
    const qs = new URLSearchParams({ address });
    const url = `${PAPI_BASE}/parcels/search-by-address?${qs}`;
    const res = await fetch(url, { headers: { "X-Api-Key": key } });
    if (res.status === 402 || res.status === 429 || res.status === 401) {
      _depletedKeys.add(key);
      lastError = `Key invalid or depleted (${res.status})`;
      logger.warn({ key: key.slice(-8), status: res.status }, "PropertyAPI key invalid/depleted — rotating");
      continue;
    }
    if (res.status >= 500) {
      // Transient server error — skip this key attempt and retry with the next
      const text = await res.text().catch(() => "");
      lastError = `PropertyAPI ${res.status}: ${text.slice(0, 120)}`;
      logger.warn({ key: key.slice(-8), status: res.status, err: lastError }, "PropertyAPI server error — skipping");
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`PropertyAPI search ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = await res.json() as any;
    const d = json.data || {};
    const num = (v: any): number | null => {
      const n = parseFloat(v);
      return isNaN(n) || n === 0 ? null : n;
    };
    return {
      beds: num(d.bedrooms),
      baths: num(d.bathrooms),
      sqft: num(d.living_sqft) ?? num(d.square_feet),
      yearBuilt: num(d.year_built) ?? num(d.struct_year_built),
      avm: num(d.market_estimate) ?? num(d.market_value),
      assessedValue: num(d.assessed_total) ?? num(d.tax_assessed_value),
      lastSalePrice: num(d.last_sale_price),
      lastSaleDate: d.last_sale_date ? String(d.last_sale_date).split("T")[0] : null,
      propertyType: d.use_standardized_desc ?? d.property_type ?? null,
      ownerName: d.owner ?? d.owner_name ?? null,
      latitude: d.latitude ?? null,
      longitude: d.longitude ?? null,
      creditsRemaining: json.credits_remaining,
    };
  }
  throw new Error(lastError || "PropertyAPI: all keys exhausted");
}

// ATTOM client is imported from ../services/attomApi (supports key rotation: ATTOM_API_KEY + ATTOM_API_KEY_2)

// ─── County FIPS Resolution (Census API) ──────────────────────────────────────

const STATE_ABBR_TO_FIPS: Record<string, string> = {
  AL:"01",AK:"02",AZ:"04",AR:"05",CA:"06",CO:"08",CT:"09",DE:"10",DC:"11",FL:"12",
  GA:"13",HI:"15",ID:"16",IL:"17",IN:"18",IA:"19",KS:"20",KY:"21",LA:"22",ME:"23",
  MD:"24",MA:"25",MI:"26",MN:"27",MS:"28",MO:"29",MT:"30",NE:"31",NV:"32",NH:"33",
  NJ:"34",NM:"35",NY:"36",NC:"37",ND:"38",OH:"39",OK:"40",OR:"41",PA:"42",RI:"44",
  SC:"45",SD:"46",TN:"47",TX:"48",UT:"49",VT:"50",VA:"51",WA:"53",WV:"54",WI:"55",WY:"56",
};

const _countyGeoIdCache = new Map<string, string>();
const _stateCountiesCache = new Map<string, string[]>();

async function fetchStateCensusRows(stateAbbr: string): Promise<string[][] | null> {
  const stateFips = STATE_ABBR_TO_FIPS[stateAbbr.toUpperCase()];
  if (!stateFips) return null;
  try {
    const url = `https://api.census.gov/data/2020/dec/pl?get=NAME,GEO_ID&for=county:*&in=state:${stateFips}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return (await res.json() as string[][]).slice(1);
  } catch { return null; }
}

async function resolveStateCounties(stateAbbr: string): Promise<string[]> {
  const key = stateAbbr.toUpperCase();
  if (_stateCountiesCache.has(key)) return _stateCountiesCache.get(key)!;
  const stateFips = STATE_ABBR_TO_FIPS[key];
  if (!stateFips) return [];
  const rows = await fetchStateCensusRows(stateAbbr);
  if (!rows) return [];
  const geoids: string[] = [];
  for (const row of rows) {
    const countyFips = row[3]?.padStart(3, "0") || "";
    if (countyFips) geoids.push(`CO${stateFips}${countyFips}`);
  }
  _stateCountiesCache.set(key, geoids);
  logger.info({ stateAbbr, count: geoids.length }, "resolveStateCounties: resolved");
  return geoids;
}

async function resolveCountyGeoid(countyName: string, stateAbbr: string): Promise<string | null> {
  const cacheKey = `${countyName.toLowerCase()}|${stateAbbr.toUpperCase()}`;
  if (_countyGeoIdCache.has(cacheKey)) return _countyGeoIdCache.get(cacheKey)!;

  const stateFips = STATE_ABBR_TO_FIPS[stateAbbr.toUpperCase()];
  if (!stateFips) {
    logger.warn({ stateAbbr }, "resolveCountyGeoid: unknown state abbreviation");
    return null;
  }

  try {
    const rows = await fetchStateCensusRows(stateAbbr);
    if (!rows) return null;
    const search = countyName.toLowerCase().replace(/\s*county\s*/i, "").trim();
    for (const row of rows) {
      const rowName = (row[0] || "").toLowerCase().replace(/\s*county,.*$/, "").trim();
      if (rowName === search) {
        const countyFips = row[3]?.padStart(3, "0") || "";
        const geoid = `CO${stateFips}${countyFips}`;
        _countyGeoIdCache.set(cacheKey, geoid);
        logger.info({ countyName, stateAbbr, geoid }, "resolveCountyGeoid: resolved");
        return geoid;
      }
    }
    logger.warn({ countyName, stateAbbr, stateFips }, "resolveCountyGeoid: county not found");
    return null;
  } catch (err) {
    logger.warn({ err }, "resolveCountyGeoid: Census API error");
    return null;
  }
}

// ─── In-Memory + Persistent Jobs ─────────────────────────────────────────────

interface SkipTraceJob {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  startedAt: string | null;
  totalRecords: number;
  processed: number;
  succeeded: number;
  failed: number;
  progressPercent: number;
  resultRows: any[];
  error?: string;
}

interface DistressedJob {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  startedAt: string | null;
  locations: string[];
  categories: string[];
  totalLocations: number;
  locationsProcessed: number;
  totalFound: number;
  resultRows: any[];
  error?: string;
}

interface EnrichJob {
  enrichJobId: string;
  parentJobId: string;
  status: "running" | "completed" | "failed";
  total: number;
  processed: number;
  resultRows: any[];
}

const skipTraceJobs = new Map<string, SkipTraceJob>();
const distressedJobs = new Map<string, DistressedJob>();
const enrichJobs = new Map<string, EnrichJob>();

// ─── DB Sync Helpers (fire-and-forget) ───────────────────────────────────────

function syncSkipJobToDB(job: SkipTraceJob, includeRows = false): void {
  const payload = {
    jobId:           job.jobId,
    status:          job.status,
    startedAt:       job.startedAt ? new Date(job.startedAt) : null,
    totalRecords:    job.totalRecords,
    processed:       job.processed,
    succeeded:       job.succeeded,
    failed:          job.failed,
    progressPercent: job.progressPercent,
    resultRows:      includeRows ? job.resultRows : [],
    error:           job.error ?? null,
  };
  db.insert(toolsSkipTraceJobs)
    .values(payload)
    .onConflictDoUpdate({ target: toolsSkipTraceJobs.jobId, set: payload })
    .catch((err: any) => logger.warn({ err: err?.message }, "syncSkipJobToDB failed"));
}

function syncDistressedJobToDB(job: DistressedJob, includeRows = false): void {
  const payload = {
    jobId:              job.jobId,
    status:             job.status,
    startedAt:          job.startedAt ? new Date(job.startedAt) : null,
    locations:          job.locations,
    categories:         job.categories,
    totalLocations:     job.totalLocations,
    locationsProcessed: job.locationsProcessed,
    totalFound:         job.totalFound,
    resultRows:         includeRows ? job.resultRows : [],
    error:              job.error ?? null,
  };
  db.insert(toolsDistressedJobs)
    .values(payload)
    .onConflictDoUpdate({ target: toolsDistressedJobs.jobId, set: payload })
    .catch((err: any) => logger.warn({ err: err?.message }, "syncDistressedJobToDB failed"));
}

function dbRowToSkipJob(row: any): SkipTraceJob {
  return {
    jobId:           row.jobId,
    status:          row.status as SkipTraceJob["status"],
    startedAt:       row.startedAt ? (row.startedAt as Date).toISOString() : null,
    totalRecords:    row.totalRecords,
    processed:       row.processed,
    succeeded:       row.succeeded,
    failed:          row.failed,
    progressPercent: row.progressPercent,
    resultRows:      (row.resultRows as any[]) ?? [],
    error:           row.error ?? undefined,
  };
}

function dbRowToDistressedJob(row: any): DistressedJob {
  return {
    jobId:              row.jobId,
    status:             row.status as DistressedJob["status"],
    startedAt:          row.startedAt ? (row.startedAt as Date).toISOString() : null,
    locations:          (row.locations as string[]) ?? [],
    categories:         (row.categories as string[]) ?? [],
    totalLocations:     row.totalLocations,
    locationsProcessed: row.locationsProcessed,
    totalFound:         row.totalFound,
    resultRows:         (row.resultRows as any[]) ?? [],
    error:              row.error ?? undefined,
  };
}

async function getSkipJob(jobId: string): Promise<SkipTraceJob | null> {
  const mem = skipTraceJobs.get(jobId);
  if (mem) return mem;
  const [row] = await db.select().from(toolsSkipTraceJobs).where(eq(toolsSkipTraceJobs.jobId, jobId)).limit(1);
  if (!row) return null;
  const job = dbRowToSkipJob(row);
  skipTraceJobs.set(jobId, job);
  return job;
}

async function getDistressedJob(jobId: string): Promise<DistressedJob | null> {
  const mem = distressedJobs.get(jobId);
  if (mem) return mem;
  const [row] = await db.select().from(toolsDistressedJobs).where(eq(toolsDistressedJobs.jobId, jobId)).limit(1);
  if (!row) return null;
  const job = dbRowToDistressedJob(row);
  distressedJobs.set(jobId, job);
  return job;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

router.post("/tools/auth/verify", (req, res) => {
  const toolsPin = process.env.TOOLS_PIN;
  if (!toolsPin) { res.status(503).json({ error: "TOOLS_PIN not configured" }); return; }
  const provided = (req.headers["x-tools-pin"] as string) || (req.body?.pin as string) || "";
  if (provided.trim() !== toolsPin.trim()) { res.status(401).json({ error: "Invalid PIN" }); return; }
  res.json({ ok: true });
});

router.get("/tools/status", requirePin, (_req, res) => {
  res.json({
    skipTraceConfigured: getPropertyApiKeys().length > 0,
    attomConfigured: hasAttomKey(),
  });
});

// ─── Bulk Skip Trace ──────────────────────────────────────────────────────────

router.get("/tools/skip-trace/jobs", requirePin, async (_req, res) => {
  // Merge in-memory (running/queued) with DB history
  const dbRows = await db.select({
    jobId: toolsSkipTraceJobs.jobId,
    status: toolsSkipTraceJobs.status,
    startedAt: toolsSkipTraceJobs.startedAt,
    totalRecords: toolsSkipTraceJobs.totalRecords,
    processed: toolsSkipTraceJobs.processed,
    succeeded: toolsSkipTraceJobs.succeeded,
    failed: toolsSkipTraceJobs.failed,
    progressPercent: toolsSkipTraceJobs.progressPercent,
    error: toolsSkipTraceJobs.error,
    createdAt: toolsSkipTraceJobs.createdAt,
  }).from(toolsSkipTraceJobs).orderBy(desc(toolsSkipTraceJobs.createdAt)).limit(50).catch(() => []);

  const seen = new Set<string>();
  const jobs: any[] = [];

  // In-memory first (has live progress)
  for (const j of skipTraceJobs.values()) {
    seen.add(j.jobId);
    const { resultRows: _r, ...safe } = j;
    jobs.push(safe);
  }
  // DB rows for historical jobs not in memory
  for (const row of dbRows) {
    if (!seen.has(row.jobId)) {
      jobs.push({
        jobId: row.jobId,
        status: row.status,
        startedAt: row.startedAt ? row.startedAt.toISOString() : null,
        totalRecords: row.totalRecords,
        processed: row.processed,
        succeeded: row.succeeded,
        failed: row.failed,
        progressPercent: row.progressPercent,
        error: row.error ?? undefined,
      });
    }
  }

  jobs.sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
  res.json({ jobs });
});

router.get("/tools/skip-trace/status/:jobId", requirePin, async (req, res) => {
  const job = await getSkipJob(req.params.jobId as string);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  const { resultRows: _r, ...safe } = job;
  res.json(safe);
});

router.post("/tools/skip-trace/upload", requirePin, async (req: any, res) => {
  const body = req.body as { records?: Record<string, string>[], filename?: string };
  if (!body?.records || !Array.isArray(body.records) || body.records.length === 0) {
    res.status(400).json({ error: "No records found. Please check your file has data rows." });
    return;
  }

  const records = body.records as Record<string, string>[];
  const jobId = randomUUID();
  const job: SkipTraceJob = {
    jobId, status: "queued", startedAt: null,
    totalRecords: records.length, processed: 0,
    succeeded: 0, failed: 0, progressPercent: 0, resultRows: [],
  };
  skipTraceJobs.set(jobId, job);
  syncSkipJobToDB(job);

  setImmediate(async () => {
    job.status = "running";
    job.startedAt = new Date().toISOString();
    const headers = Object.keys(records[0] || {});

    const find = (candidates: string[]) =>
      headers.find(h => candidates.some(c => h.toLowerCase().includes(c))) || "";

    const streetCol = find(["street", "address", "addr"]);
    const cityCol = find(["city"]);
    const stateCol = find(["state", "st"]);
    const zipCol = find(["zip", "postal"]);
    const ownerCol = find(["owner", "name"]);

    const COMBINED_RE = /^(.+?),\s*([^,]+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/;
    const COMBINED_4_RE = /^(.+?),\s*([^,]+?),\s*([A-Za-z]{2}),\s*(\d{5}(?:-\d{4})?)$/;
    let combinedCol = "";
    if (!streetCol) {
      const sample = records.slice(0, 5);
      for (const col of headers) {
        const matches = sample.filter(r => {
          const v = (r[col] || "").trim();
          return COMBINED_RE.test(v) || COMBINED_4_RE.test(v);
        });
        if (matches.length >= Math.min(3, sample.length)) { combinedCol = col; break; }
      }
    }

    function parseRow(row: Record<string, string>) {
      const srcCol = combinedCol || (streetCol && !cityCol && !zipCol ? streetCol : "");
      if (srcCol) {
        const val = (row[srcCol] || "").trim();
        const m = val.match(COMBINED_RE) || val.match(COMBINED_4_RE);
        if (m) return { street: m[1]!.trim(), city: m[2]!.trim(), state: m[3]!.trim().toUpperCase(), zip: m[4]!.trim() };
        return { street: val, city: "", state: "", zip: "" };
      }
      return {
        street: (row[streetCol] || "").trim(),
        city: (row[cityCol] || "").trim(),
        state: (row[stateCol] || "").trim(),
        zip: (row[zipCol] || "").trim(),
      };
    }

    const BATCH = 10;
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      const lookups = batch.map((row, idx) => ({
        uid: String(i + idx),
        ...parseRow(row),
        ownerName: ownerCol ? (row[ownerCol] || "").trim() : "",
      }));

      try {
        const validLookups = lookups.filter(l => l.street && l.city && l.zip && l.zip.length >= 5);
        const results = validLookups.length > 0 ? await skipTraceBatch(validLookups) : {};
        for (let j = 0; j < batch.length; j++) {
          const lookup = lookups[j]!;
          const r = results[lookup.uid];
          const hasRequiredFields = lookup.street && lookup.city && lookup.zip && lookup.zip.length >= 5;
          if (!hasRequiredFields) {
            job.resultRows.push({ ...batch[j], _status: "skipped", _phones: "", _emails: "", _owner: "" });
            job.failed++;
          } else if (r && (r.phones.length || r.emails.length || r.ownerName)) {
            job.resultRows.push({ ...batch[j], _status: "found", _phones: r.phones.join(" | "), _emails: r.emails.join(" | "), _owner: r.ownerName });
            job.succeeded++;
          } else {
            job.resultRows.push({ ...batch[j], _status: "not_found", _phones: "", _emails: "", _owner: "" });
            job.failed++;
          }
          job.processed++;
          job.progressPercent = Math.round((job.processed / job.totalRecords) * 100);
        }
      } catch (err: any) {
        logger.warn({ err: err?.message, batchStart: i, batchSize: batch.length }, "Skip trace batch error — records marked as error");
        for (const row of batch) {
          job.resultRows.push({ ...row, _status: "error", _phones: "", _emails: "", _owner: "" });
          job.failed++;
          job.processed++;
          job.progressPercent = Math.round((job.processed / job.totalRecords) * 100);
        }
      }
      await new Promise<void>(resolve => setTimeout(resolve, 300));
    }

    job.status = "completed";
    job.progressPercent = 100;
    syncSkipJobToDB(job, true);
  });

  res.json({ jobId, message: "Job started", totalRecords: records.length });
});

router.get("/tools/skip-trace/download/:jobId", requirePin, async (req, res) => {
  const job = await getSkipJob(req.params.jobId as string);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.status !== "completed") { res.status(400).json({ error: "Job not complete" }); return; }
  const csv = Papa.unparse(job.resultRows);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="skip-trace-${job.jobId.slice(0, 8)}.csv"`);
  res.send(csv);
});

// ─── Distressed Property Finder ───────────────────────────────────────────────

const MORTGAGE_FILTER_CATEGORIES = new Set(["free_clear", "absentee_owner"]);

router.get("/tools/distressed/jobs", requirePin, async (_req, res) => {
  const dbRows = await db.select({
    jobId: toolsDistressedJobs.jobId,
    status: toolsDistressedJobs.status,
    startedAt: toolsDistressedJobs.startedAt,
    locations: toolsDistressedJobs.locations,
    categories: toolsDistressedJobs.categories,
    totalLocations: toolsDistressedJobs.totalLocations,
    locationsProcessed: toolsDistressedJobs.locationsProcessed,
    totalFound: toolsDistressedJobs.totalFound,
    error: toolsDistressedJobs.error,
    createdAt: toolsDistressedJobs.createdAt,
  }).from(toolsDistressedJobs).orderBy(desc(toolsDistressedJobs.createdAt)).limit(50).catch(() => []);

  const seen = new Set<string>();
  const jobs: any[] = [];

  for (const j of distressedJobs.values()) {
    seen.add(j.jobId);
    const { resultRows: _r, ...safe } = j;
    jobs.push(safe);
  }
  for (const row of dbRows) {
    if (!seen.has(row.jobId)) {
      jobs.push({
        jobId: row.jobId,
        status: row.status,
        startedAt: row.startedAt ? row.startedAt.toISOString() : null,
        locations: row.locations,
        categories: row.categories,
        totalLocations: row.totalLocations,
        locationsProcessed: row.locationsProcessed,
        totalFound: row.totalFound,
        error: row.error ?? undefined,
      });
    }
  }

  jobs.sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
  res.json({ jobs });
});

router.get("/tools/distressed/status/:jobId", requirePin, async (req, res) => {
  const job = await getDistressedJob(req.params.jobId as string);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  const { resultRows: _r, ...safe } = job;
  res.json(safe);
});

async function resolveCityZips(city: string, stateAbbr: string): Promise<string[]> {
  try {
    const url = `https://api.zippopotam.us/us/${encodeURIComponent(stateAbbr.toLowerCase())}/${encodeURIComponent(city.toLowerCase())}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    return (data.places || []).map((p: any) => p["post code"]).filter(Boolean);
  } catch {
    return [];
  }
}

router.post("/tools/distressed/search", requirePin, async (req, res) => {
  const { locations, locationType, categories, limit } = req.body as {
    locations: string[];
    locationType: "zip" | "city" | "county" | "state";
    categories: string[];
    limit: number;
  };

  if (!locations?.length || !categories?.length) {
    res.status(400).json({ error: "locations and categories are required" });
    return;
  }

  if (!hasAttomKey()) {
    res.status(503).json({ error: "ATTOM_API_KEY not configured" });
    return;
  }

  if (locationType === "county" || locationType === "state") {
    res.status(400).json({
      error: `${locationType === "state" ? "State" : "County"}-level searches require the ATTOM geoid query feature, which is not available on the current subscription. Use ZIP Code or City search instead.`
    });
    return;
  }

  const jobId = randomUUID();

  let resolvedLocations: Array<{ label: string; searchParam: Record<string, string | number> }> = [];

  if (locationType === "zip") {
    for (const z of locations) resolvedLocations.push({ label: z, searchParam: { postalcode: z } });
  } else if (locationType === "city") {
    for (const location of locations) {
      const match = location.trim().match(/^(.+?),\s*([A-Z]{2})$/i);
      if (!match) { logger.warn({ location }, "Distressed city: invalid format, expected 'City, ST'"); continue; }
      const [, cityName, stateAbbr] = match;
      const zips = await resolveCityZips(cityName!.trim(), stateAbbr!.trim());
      if (!zips.length) {
        logger.warn({ location }, "Distressed city: could not resolve ZIP codes");
        continue;
      }
      logger.info({ location, zips }, "Distressed city: resolved to ZIPs");
      for (const zip of zips) {
        resolvedLocations.push({ label: `${location} (${zip})`, searchParam: { postalcode: zip } });
      }
    }
  } else if (locationType === "state") {
    for (const stateAbbr of locations) {
      const abbr = stateAbbr.trim().toUpperCase();
      if (!STATE_ABBR_TO_FIPS[abbr]) {
        logger.warn({ stateAbbr }, "Distressed: unknown state abbreviation");
        continue;
      }
      const countyGeoids = await resolveStateCounties(abbr);
      if (!countyGeoids.length) {
        logger.warn({ stateAbbr }, "Distressed: could not resolve counties for state");
        continue;
      }
      for (const geoid of countyGeoids) {
        resolvedLocations.push({ label: `${abbr} (${geoid})`, searchParam: { geoid } });
      }
    }
  } else if (locationType === "county") {
    for (const location of locations) {
      const match = location.trim().match(/^(.+?),\s*([A-Z]{2})$/i);
      if (!match) { logger.warn({ location }, "Distressed: invalid county format"); continue; }
      const [, countyName, stateAbbr] = match;
      const geoid = await resolveCountyGeoid(countyName!.trim(), stateAbbr!.trim());
      if (geoid) resolvedLocations.push({ label: location, searchParam: { geoid } });
      else logger.warn({ location }, "Distressed: could not resolve county geoid");
    }
  }

  if (!resolvedLocations.length) {
    res.status(400).json({ error: "Could not resolve any valid search locations. Check your inputs." });
    return;
  }

  const activeMortgageFilters = categories.filter(c => MORTGAGE_FILTER_CATEGORIES.has(c));
  const hasOnlyMortgageFilters = activeMortgageFilters.length > 0 && activeMortgageFilters.length === categories.length;

  const maxPerLocation = Math.max(1, Math.floor((limit || 500) / resolvedLocations.length));

  const job: DistressedJob = {
    jobId, status: "queued", startedAt: null,
    locations: resolvedLocations.map(l => l.label), categories,
    totalLocations: resolvedLocations.length,
    locationsProcessed: 0, totalFound: 0, resultRows: [],
  };
  distressedJobs.set(jobId, job);
  syncDistressedJobToDB(job);

  setImmediate(async () => {
    job.status = "running";
    job.startedAt = new Date().toISOString();

    for (const { label, searchParam } of resolvedLocations) {
      let page = 1;
      let fetchedForLocation = 0;
      const perPage = Math.min(maxPerLocation, 100);

      while (fetchedForLocation < maxPerLocation) {
        try {
          const params: Record<string, string | number> = {
            ...searchParam,
            pagesize: Math.min(perPage, maxPerLocation - fetchedForLocation),
            page,
          };
          const data = await attomGet("/propertyapi/v1.0.0/property/detailmortgageowner", params);
          const properties = data?.property || [];

          if (!properties.length) break;

          for (const prop of properties) {
            const addr = prop?.address;
            const bldg = prop?.building;
            const summary = prop?.summary;
            const lot = prop?.lot;
            const owner = prop?.owner;
            const mortgage = prop?.mortgage;
            const assessment = prop?.assessment;

            const absenteeStatus = owner?.absenteeownerstatus;
            const isAbsentee = absenteeStatus === "A";

            const mortgageAmt = mortgage?.amount ? Number(mortgage.amount) : null;
            const mortgageDate = mortgage?.date || "";
            const mortgageRateType = mortgage?.interestratetype || "";
            const mortgageLender = mortgage?.lender?.lastname?.trim() || "";

            const assessedVal: number | null =
              assessment?.assessed?.assdttlvalue
              ?? assessment?.assessed?.totvalue
              ?? assessment?.market?.mktttlvalue
              ?? null;
            const assessedValNum = assessedVal ? Number(assessedVal) : null;

            const ltvPct = (mortgageAmt && assessedValNum && assessedValNum > 0)
              ? Math.round((mortgageAmt / assessedValNum) * 100) : null;

            if (hasOnlyMortgageFilters) {
              let passes = true;
              for (const cat of activeMortgageFilters) {
                if (cat === "absentee_owner" && !isAbsentee) { passes = false; break; }
                if (cat === "free_clear" && mortgageAmt !== null && mortgageAmt > 0) { passes = false; break; }
              }
              if (!passes) continue;
            }

            const owner1Name = owner?.owner1?.fullname?.trim() || "";
            const owner2Name = owner?.owner2?.fullname?.trim() || "";
            const ownerNames = [owner1Name, owner2Name].filter(Boolean).join(" & ");
            const absentee = isAbsentee ? "Yes" : absenteeStatus === "O" ? "No (Owner Occupied)" : "";
            const mailingAddr = owner?.mailingaddressoneline?.trim() || "";
            const ownerType = owner?.corporateindicator === "Y" ? "Corporate" : "Individual";

            job.resultRows.push({
              location: label,
              street: addr?.line1 || "",
              city: addr?.locality || "",
              state: addr?.countrySubd || "",
              zip: addr?.postal1 || "",
              property_type: summary?.proptype || summary?.propclass || "",
              year_built: summary?.yearbuilt || "",
              sqft: bldg?.size?.universalsize || "",
              baths: bldg?.rooms?.bathstotal || "",
              lot_size_acres: lot?.lotSize1 ? Number(lot.lotSize1).toFixed(4) : "",
              owner_name: ownerNames,
              owner_type: ownerType,
              absentee_owner: absentee,
              owner_mailing_address: mailingAddr,
              mortgage_lender: mortgageLender,
              mortgage_amount: mortgageAmt ? `$${mortgageAmt.toLocaleString()}` : "",
              mortgage_date: mortgageDate,
              mortgage_rate_type: mortgageRateType,
              assessed_value: assessedValNum ? `$${assessedValNum.toLocaleString()}` : "",
              ltv_pct: ltvPct !== null ? `${ltvPct}%` : "",
              attom_id: prop?.identifier?.attomId || "",
              apn: prop?.identifier?.apn || "",
            });
            fetchedForLocation++;
            job.totalFound++;
            if (fetchedForLocation >= maxPerLocation) break;
          }

          if (properties.length < perPage) break;
          page++;
        } catch (err) {
          logger.warn({ err, location: label }, "Distressed: ATTOM detailmortgageowner failed");
          break;
        }
        await new Promise<void>(resolve => setTimeout(resolve, 200));
      }

      job.locationsProcessed++;
      syncDistressedJobToDB(job);
      await new Promise<void>(resolve => setTimeout(resolve, 300));
    }

    job.status = "completed";
    syncDistressedJobToDB(job, true);
  });

  res.json({ jobId, message: "Search started", note: "Returns properties in the selected area. Use + Deep Skip Trace to add owner contact info." });
});

router.get("/tools/distressed/download/:jobId", requirePin, async (req, res) => {
  const job = await getDistressedJob(req.params.jobId as string);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.status !== "completed") { res.status(400).json({ error: "Job not complete" }); return; }
  const csv = Papa.unparse(job.resultRows);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="property-list-${job.jobId.slice(0, 8)}.csv"`);
  res.send(csv);
});

router.post("/tools/distressed/enrich/:jobId", requirePin, async (req, res) => {
  const job = await getDistressedJob(req.params.jobId as string);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.status !== "completed" || !job.resultRows.length) { res.status(400).json({ error: "Job not complete or no results" }); return; }
  if (!getPropertyApiKeys().length) { res.status(503).json({ error: "PropertyAPI keys not configured" }); return; }

  const enrichJobId = randomUUID();
  const enrichJob: EnrichJob = {
    enrichJobId, parentJobId: req.params.jobId as string,
    status: "running", total: job.resultRows.length, processed: 0, resultRows: [],
  };
  enrichJobs.set(enrichJobId, enrichJob);

  setImmediate(async () => {
    const BATCH = 10;
    for (let i = 0; i < job.resultRows.length; i += BATCH) {
      const batch = job.resultRows.slice(i, i + BATCH);
      const lookups = batch.map((row, idx) => ({
        uid: String(i + idx),
        street: row.street || "",
        city: row.city || "",
        state: row.state || "",
        zip: row.zip || "",
      }));

      try {
        const results = await skipTraceBatch(lookups.filter(l => l.street));
        for (let j = 0; j < batch.length; j++) {
          const r = results[String(i + j)];
          enrichJob.resultRows.push({
            ...batch[j],
            owner_name: r?.ownerName || "",
            phones: r?.phones.join(" | ") || "",
            emails: r?.emails.join(" | ") || "",
          });
          enrichJob.processed++;
        }
      } catch {
        for (const row of batch) {
          enrichJob.resultRows.push({ ...row, owner_name: "", phones: "", emails: "" });
          enrichJob.processed++;
        }
      }
      await new Promise<void>(resolve => setTimeout(resolve, 300));
    }
    enrichJob.status = "completed";
  });

  res.json({ enrichJobId, total: enrichJob.total, message: "Enrichment started" });
});

router.get("/tools/distressed/enrich-status/:enrichJobId", requirePin, (req, res) => {
  const job = enrichJobs.get(req.params.enrichJobId as string);
  if (!job) { res.status(404).json({ error: "Enrich job not found" }); return; }
  const { resultRows: _r, ...safe } = job;
  res.json(safe);
});

router.get("/tools/distressed/download-enriched/:enrichJobId", requirePin, (req, res) => {
  const job = enrichJobs.get(req.params.enrichJobId as string);
  if (!job) { res.status(404).json({ error: "Enrich job not found" }); return; }
  if (job.status !== "completed") { res.status(400).json({ error: "Enrichment not complete" }); return; }
  const csv = Papa.unparse(job.resultRows);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="property-enriched-${job.parentJobId.slice(0, 8)}.csv"`);
  res.send(csv);
});

// ─── ARV Calculator ───────────────────────────────────────────────────────────

router.get("/tools/arv/config", requirePin, (_req, res) => {
  res.json({
    pricePerBed: 12500, pricePerBath: 7500, pricePerSqft: "market-derived",
    pricePerYear: 150, poolAdjustment: 15000, garageAdjustment: 7500,
    maoPercent: 0.80, conservativePercent: 0.75,
  });
});

router.post("/tools/arv/calculate", requirePin, async (req, res) => {
  const { street, city, state, zip, repairCost = 15000, maxComps = 5, miles = 0.5 } = req.body as {
    street: string; city: string; state: string; zip?: string;
    repairCost?: number; maxComps?: number; miles?: number;
  };

  if (!street) { res.status(400).json({ error: "Street address is required" }); return; }
  if (!hasAttomKey() && !getPropertyApiKeys().length) {
    res.status(503).json({ error: "Neither ATTOM nor PropertyAPI key is configured" }); return;
  }

  try {
    const fullAddress = [street, city, state, zip].filter(Boolean).join(" ");

    // Step 1a: Try PropertyAPI for geocoding + basic details; fall back to ATTOM if unavailable/exhausted
    let subject: {
      latitude: number | null; longitude: number | null;
      beds: number | null; baths: number | null; sqft: number | null;
      yearBuilt: number | null; avm: number | null; propertyType: string | null;
    } | null = null;
    let subjectSqftSource = "PropertyAPI";

    if (getPropertyApiKeys().length) {
      try {
        const pResult = await lookupProperty(fullAddress);
        subject = pResult;
      } catch (pErr: any) {
        logger.warn({ err: pErr?.message }, "[ARV] PropertyAPI failed — falling back to ATTOM for geocoding");
      }
    }

    // ATTOM fallback for geocoding + property details
    if (!subject?.latitude || !subject?.longitude) {
      if (!hasAttomKey()) {
        res.status(503).json({ error: "PropertyAPI exhausted and ATTOM key not configured — cannot geocode address" }); return;
      }
      const [coords, attomProp] = await Promise.allSettled([
        geocodeViaAttom(street, city, state, zip),
        fetchPropertyDataViaAttom(street, city, state, zip),
      ]);
      const c = coords.status === "fulfilled" ? coords.value : null;
      const a = attomProp.status === "fulfilled" ? attomProp.value : null;
      if (!c) {
        res.status(404).json({ error: "Could not geocode subject property. Please verify the address." }); return;
      }
      subject = {
        latitude: c.lat, longitude: c.lng,
        beds: a?.beds ?? null, baths: a?.baths ?? null,
        sqft: a?.sqft ?? null, yearBuilt: a?.yearBuilt ?? null,
        avm: a?.avm ?? null, propertyType: a?.propertyType ?? null,
      };
      subjectSqftSource = "ATTOM";
    }

    if (!subject.latitude || !subject.longitude) {
      res.status(404).json({ error: "Could not geocode subject property. Please verify the address." });
      return;
    }

    const subjectBeds = subject.beds ?? 3;
    const subjectBaths = subject.baths ?? 2;
    const subjectYear = subject.yearBuilt ?? 2000;

    // Step 1b: Look up subject sqft via ATTOM property/snapshot — same universalsize scale as comps
    let subjectSqft: number = subject.sqft ?? 1500;
    if (subjectSqftSource !== "ATTOM") subjectSqftSource = "PropertyAPI";
    try {
      const address2 = [city, state, zip].filter(Boolean).join(" ");
      const snapData = await attomGet("/propertyapi/v1.0.0/property/snapshot", {
        address1: street,
        address2,
      });
      const snapProp = snapData?.property?.[0];
      const attomSqft = snapProp?.building?.size?.universalsize || snapProp?.building?.size?.livingsize || 0;
      if (attomSqft > 0) {
        subjectSqft = attomSqft;
        subjectSqftSource = "ATTOM (universalsize)";
      }
    } catch (_) {
      // non-fatal — keep PropertyAPI sqft
    }

    // Detect subject property type for comp filtering
    const subjectPropTypeRaw = (subject.propertyType || "").toUpperCase();
    const subjectIsSingleFamily = !subjectPropTypeRaw ||
      ["single", "sfr", "residential"].some(t => subjectPropTypeRaw.toLowerCase().includes(t));

    // Step 2: Get comparable sales via ATTOM sale/snapshot
    const compsData = await attomGet("/propertyapi/v1.0.0/sale/snapshot", {
      latitude: subject.latitude,
      longitude: subject.longitude,
      radius: miles,
      pagesize: Math.min((maxComps as number) * 4, 50),
    });

    const allSales = compsData?.property || [];

    const PRICE_PER_YEAR = 150;
    const PRICE_PER_BATH = 7500;
    const ANNUAL_APPRECIATION_RATE = 0.03;

    // Derive price-per-sqft from actual comp data (median of salePrice/sqft)
    const sqftRates = allSales
  .map((s: any): number | null => {
    const price = s?.sale?.amount?.saleamt;
    const sqft  = s?.building?.size?.universalsize;
    return (price && sqft) ? price / sqft : null;
  })
  .filter((r: number | null): r is number => r !== null)
  .sort((a: number, b: number) => a - b);


    const PRICE_PER_SQFT: number = sqftRates.length > 0
      ? sqftRates[Math.floor(sqftRates.length / 2)]!
      : (await estimateMarketPricePerSqft(city, state, zip)) ?? ADJUSTMENT_FACTORS.sqft;

    function buildComps(sales: any[], lookbackMonths: number): any[] {
      const result: any[] = [];
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - lookbackMonths);

      for (const sale of sales) {
        const salePrice = sale?.sale?.amount?.saleamt;
        if (!salePrice) continue;

        const saleDate = sale?.sale?.saleTransDate || sale?.sale?.salesearchdate;
        if (saleDate) {
          const date = new Date(saleDate);
          if (date < cutoff) continue;
        }

        // Skip multi-family / commercial comps when subject is a single-family home
        // ATTOM universalsize on a quadruplex = total building sqft (all units combined)
        // which makes it appear 4-5x larger than our subject, destroying ARV accuracy
        const rawPropType = (sale?.summary?.proptype || "").toUpperCase();
        if (subjectIsSingleFamily) {
          const INCOMPATIBLE = ["MULTI", "DUPLEX", "TRIPLEX", "QUADRUPLEX", "COMMERCIAL", "APARTMENT"];
          if (INCOMPATIBLE.some(m => rawPropType.includes(m))) continue;
        }

        // Skip comps where sqft is more than 75% bigger or 43% smaller than subject
        // Catches multi-family that slips through proptype filter (universalsize = total building)
        const compSqft = sale?.building?.size?.universalsize || 0;
        if (subjectSqft && compSqft) {
          const ratio = compSqft / subjectSqft;
          if (ratio > 1.75 || ratio < 0.57) continue;
        }

        const compBaths = sale?.building?.rooms?.bathstotal || 0;
        const compYear = sale?.summary?.yearbuilt || subjectYear;

        const sqftAdj = subjectSqft && compSqft ? (subjectSqft - compSqft) * PRICE_PER_SQFT : 0;
        const bathAdj = (subjectBaths - compBaths) * PRICE_PER_BATH;
        const yearAdj = (subjectYear - compYear) * PRICE_PER_YEAR;

        let timeAdj = 0;
        if (saleDate) {
          const soldMs = new Date(saleDate).getTime();
          if (!isNaN(soldMs)) {
            const monthsAgo = (Date.now() - soldMs) / (1000 * 60 * 60 * 24 * 30.5);
            timeAdj = Math.round(salePrice * ANNUAL_APPRECIATION_RATE * (monthsAgo / 12));
          }
        }

        const adjustedPrice = Math.max(0, Math.round(salePrice + sqftAdj + bathAdj + yearAdj + timeAdj));

        const addr = sale?.address;
        const compLat = parseFloat(sale?.location?.latitude || "0");
        const compLon = parseFloat(sale?.location?.longitude || "0");

        const dLat = ((subject!.latitude! - compLat) * Math.PI) / 180;
        const dLon = ((subject!.longitude! - compLon) * Math.PI) / 180;
        const aHav = Math.sin(dLat / 2) ** 2 +
          Math.cos((subject!.latitude! * Math.PI) / 180) *
          Math.cos((compLat * Math.PI) / 180) *
          Math.sin(dLon / 2) ** 2;
        const distMiles = +(3959 * 2 * Math.atan2(Math.sqrt(aHav), Math.sqrt(1 - aHav))).toFixed(2);

        const soldDateStr = saleDate
          ? new Date(saleDate).toISOString().split("T")[0]
          : null;

        result.push({
          address: `${addr?.line1 || ""}, ${addr?.locality || ""}, ${addr?.countrySubd || ""}`.trim().replace(/^,\s*|,\s*$/g, ""),
          beds: subjectBeds,
          baths: compBaths,
          sqft: compSqft,
          salePrice,
          adjustedPrice,
          adjustments: { sqft: sqftAdj, bath: bathAdj, year: yearAdj, time: timeAdj },
          distanceMiles: distMiles,
          saleDate: soldDateStr,
        });

        if (result.length >= (maxComps as number)) break;
      }
      return result;
    }

    let comps = buildComps(allSales, 24);
    if (!comps.length) comps = buildComps(allSales, 48);
    if (!comps.length) comps = buildComps(allSales, 84);

    if (!comps.length) {
      res.status(404).json({ error: `No comparable sales found within ${miles} miles. Try increasing the radius.` });
      return;
    }

    const arv = Math.round(comps.reduce((s, c) => s + c.adjustedPrice, 0) / comps.length);
    const arvPricePerSqft = subjectSqft ? +(arv / subjectSqft).toFixed(0) : 0;
    const mao = calculateMao(arv, repairCost, null) ?? 0;
    const maxOffer = calculateMao(arv, repairCost, null, 0.75) ?? 0;

    // Fetch ATTOM AVM as a secondary valuation signal (non-blocking — null if it fails)
    const address2 = [city, state, zip].filter(Boolean).join(" ");
    const attomAvm = await fetchAttomAvm(street, address2).catch(() => null);

    res.json({
      arv, arvPricePerSqft, mao, maxOffer, repairCost,
      attomAvm,
      compsUsed: comps.length,
      comps,
      subjectSqftSource,
      subject: {
        beds: subjectBeds, baths: subjectBaths,
        sqft: subjectSqft, yearBuilt: subjectYear,
        avm: subject.avm,
      },
    });
  } catch (err: any) {
    logger.error({ err }, "ARV calculation error");
    res.status(500).json({ error: err?.message || "ARV calculation failed" });
  }
});

router.post("/tools/arv/calculate-manual", requirePin, async (req, res) => {
  const { comps, repairCost = 0, subjectSqft } = req.body as {
    comps: Array<{ salePrice: number; sqft?: number; beds?: number; baths?: number }>;
    repairCost?: number; subjectSqft?: number;
  };
  if (!comps?.length) { res.status(400).json({ error: "Provide at least one comp" }); return; }
  const arv = Math.round(comps.reduce((s, c) => s + c.salePrice, 0) / comps.length);
  const mao = calculateMao(arv, repairCost, null, 0.70) ?? 0;
  const maxOffer = calculateMao(arv, repairCost, null, 0.65) ?? 0;
  const arvPricePerSqft = subjectSqft ? +(arv / subjectSqft).toFixed(0) : 0;
  res.json({ arv, arvPricePerSqft, mao, maxOffer, repairCost, compsUsed: comps.length, comps });
});

// ─── Property Lookup ──────────────────────────────────────────────────────────

router.post("/tools/property-lookup/search", requirePin, async (req, res) => {
  const { street, city, state, zip } = req.body as {
    street: string; city?: string; state?: string; zip?: string;
  };
  if (!street) { res.status(400).json({ error: "Street address is required" }); return; }
  if (!getPropertyApiKeys().length && !hasAttomKey()) {
    res.status(503).json({ error: "Neither PropertyAPI nor ATTOM key is configured" }); return;
  }

  try {
    const fullAddress = [street, city, state, zip].filter(Boolean).join(" ");
    const address2 = [city, state, zip].filter(Boolean).join(" ");
    const [propData, attomResult, skipTraceResult] = await Promise.allSettled([
      getPropertyApiKeys().length
        ? lookupProperty(fullAddress)
        : Promise.reject(new Error("No PropertyAPI keys configured")),
      hasAttomKey()
        ? attomGet("/propertyapi/v1.0.0/property/detailmortgageowner", {
            address1: street,
            ...(address2 ? { address2 } : {}),
            pagesize: 1,
          })
        : Promise.resolve(null),
      skipTraceBatch([{ uid: "lookup", street: street || "", city: city || "", state: state || "", zip: zip || "" }]),
    ]);

    // If PropertyAPI failed, fall back to ATTOM for property details
    let prop = propData.status === "fulfilled" ? propData.value : null;
    if (!prop) {
      logger.warn({ err: (propData as PromiseRejectedResult).reason?.message }, "[property-lookup] PropertyAPI failed — using ATTOM data only");
      if (!hasAttomKey()) {
        throw (propData as PromiseRejectedResult).reason;
      }
      // Build a synthetic prop from ATTOM data we already fetched, or fetch directly
      const attomDetail = await fetchPropertyDataViaAttom(street, city, state, zip);
      if (!attomDetail) {
        throw new Error("PropertyAPI exhausted and ATTOM returned no data for this address");
      }
      prop = {
        beds: attomDetail.beds, baths: attomDetail.baths, sqft: attomDetail.sqft,
        yearBuilt: attomDetail.yearBuilt, avm: attomDetail.avm,
        assessedValue: attomDetail.taxAssessedValue,
        lastSalePrice: attomDetail.lastSalePrice, lastSaleDate: attomDetail.lastSaleDate ?? null,
        propertyType: attomDetail.propertyType,
        ownerName: attomDetail.ownerName,
        latitude: attomDetail.latitude, longitude: attomDetail.longitude,
        creditsRemaining: undefined,
      };
    }

    // TypeScript narrowing guard — prop is guaranteed non-null at this point
    if (!prop) throw new Error("Could not retrieve property data from any source");

    const attomProp = attomResult.status === "fulfilled" ? attomResult.value?.property?.[0] : null;
    const attomOwner = attomProp?.owner;
    const attomMortgage = attomProp?.mortgage;

    const _o1 = attomOwner?.owner1;
    const owner1Name = _o1?.fullname?.trim()
      || (_o1?.firstnameandmi && _o1?.lastname
        ? `${_o1.firstnameandmi.trim()} ${_o1.lastname.trim()}`.trim()
        : null)
      || "";
    const owner2Name = attomOwner?.owner2?.fullname?.trim() || attomOwner?.owner3?.fullname?.trim() || "";
    const isAbsenteeOwner = attomOwner?.absenteeownerstatus === "A";
    const ownerMailingAddress = attomOwner?.mailingaddressoneline?.trim() || "";
    const ownerType = attomOwner?.corporateindicator === "Y" ? "Corporate" : "Individual";

    const mortgageAmount = attomMortgage?.amount ? Number(attomMortgage.amount) : null;
    const mortgageDate = attomMortgage?.date || null;
    const mortgageLender = attomMortgage?.lender?.lastname?.trim() || null;
    const mortgageLoanType = attomMortgage?.loantypecode || attomMortgage?.deedtype || null;
    const mortgageTerm = attomMortgage?.term ? Number(attomMortgage.term) : null;
    const mortgageDueDate = attomMortgage?.duedate || null;

    const stData = skipTraceResult.status === "fulfilled" ? skipTraceResult.value["lookup"] : null;
    const phones = stData?.phones || [];
    const emails = stData?.emails || [];
    const ownerFromST = stData?.ownerName || "";

    const ownerName = owner1Name || ownerFromST || prop.ownerName || null;
    const avm = prop.avm;
    const lastSalePrice = prop.lastSalePrice;
    const mortgageBalance = mortgageAmount || null;
    const estimatedEquity = avm && mortgageBalance ? Math.round(avm - mortgageBalance) : (avm && lastSalePrice ? Math.round(avm - lastSalePrice) : null);
    const equityPercent = avm && estimatedEquity !== null ? +((estimatedEquity / avm) * 100).toFixed(1) : null;
    const ltvPercent = avm && mortgageBalance ? +((mortgageBalance / avm) * 100).toFixed(1) : null;
    const pricePerSqft = avm && prop.sqft ? +(avm / prop.sqft).toFixed(0) : null;

    res.json({
      property: {
        address: street, city, state, zip,
        propertyType: prop.propertyType,
        beds: prop.beds, baths: prop.baths,
        sqft: prop.sqft, yearBuilt: prop.yearBuilt,
        avm, avmLow: avm ? Math.round(avm * 0.9) : null, avmHigh: avm ? Math.round(avm * 1.1) : null,
        assessedTotalValue: prop.assessedValue,
        lastSalePrice, lastSaleDate: prop.lastSaleDate,
        ownerName, ownerName2: owner2Name || null,
        isAbsenteeOwner, ownerMailingAddress, ownerType,
        phones, emails,
        mortgageBalance, mortgageAmount, mortgageDate,
        mortgageLender, mortgageLoanType, mortgageTerm, mortgageDueDate,
        latitude: prop.latitude, longitude: prop.longitude,
      },
      metrics: {
        estimatedEquity, equityPercent, ltvPercent, pricePerSqft,
        hasPhone: phones.length > 0,
        isAbsenteeOwner,
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Property lookup error");
    res.status(500).json({ error: err?.message || "Property lookup failed" });
  }
});

export default router;
