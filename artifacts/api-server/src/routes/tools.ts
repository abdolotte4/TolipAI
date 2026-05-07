/**
 * TolipAI Tools API Routes
 *
 * Routes:
 *   POST /api/tools/auth/verify            — PIN check + config status
 *   POST /api/tools/distressed/search      — start distressed scrape job
 *   GET  /api/tools/distressed/status/:id  — poll distressed job
 *   GET  /api/tools/distressed/jobs        — list distressed jobs (stub)
 *   GET  /api/tools/arv/config             — ARV configuration info
 *   POST /api/tools/arv/calculate          — auto ARV via ATTOM comps
 *   POST /api/tools/arv/calculate-manual   — manual ARV from user comps
 *   POST /api/tools/property-lookup/search — full property profile (ATTOM)
 *   GET  /api/tools/skip-trace/jobs        — list batch skip-trace jobs
 *   POST /api/tools/skip-trace/upload      — start a batch skip-trace job
 *   GET  /api/tools/skip-trace/status/:id  — poll a skip-trace job
 *   GET  /api/tools/skip-trace/download/:id — download completed CSV
 *   POST /api/tools/property               — ARV + property lookup combined
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "crypto";
import { scraperEngine, ScraperEngineUnavailable } from "../services/scraperEngineClient";
import {
  hasAttomKey,
  attomGet,
  geocodeViaAttom,
  fetchCompsViaAttom,
  fetchPropertyDataViaAttom,
  fetchAttomAvm,
  fetchDistressedViaAttom,
} from "../services/attomApi";
import {
  calculateAdjustedComp,
  calculateArvFromComps,
  calculateMao,
} from "../services/coreCalculations";
import { runSkipTrace, getNextApiKey } from "../services/propertyApi";
import { logger } from "../lib/logger";

const router: Router = Router();

// ─── PIN Auth ─────────────────────────────────────────────────────────────────

function requirePin(req: Request, res: Response, next: NextFunction) {
  const toolsPin = process.env.TOOLS_PIN;
  if (!toolsPin) { res.status(503).json({ error: "TOOLS_PIN not configured" }); return; }
  const provided = (req.headers["x-tools-pin"] as string | undefined) || (req.body as any)?.pin;
  if (!provided || provided.trim() !== toolsPin.trim()) { res.status(403).json({ error: "Invalid PIN" }); return; }
  next();
}

// ─── POST /tools/auth/verify ──────────────────────────────────────────────────

router.post("/tools/auth/verify", (req, res) => {
  const toolsPin = process.env.TOOLS_PIN;
  if (!toolsPin) { res.status(503).json({ error: "TOOLS_PIN not configured" }); return; }
  const fromHeader = req.headers["x-tools-pin"] as string | undefined;
  const fromBody   = (req.body as any)?.pin as string | undefined;
  const provided   = fromHeader || fromBody;
  if (!provided || provided.trim() !== toolsPin.trim()) { res.status(403).json({ error: "Invalid PIN" }); return; }
  res.json({
    success: true,
    attomConfigured: hasAttomKey(),
    engineConfigured: !!(process.env.SCRAPER_ENGINE_URL || "https://scraper-engine-production-6207.up.railway.app"),
    skipTraceConfigured: !!(getNextApiKey() || process.env.PEOPLEDATALABS_API_KEY),
  });
});

// ─── Distressed routes ────────────────────────────────────────────────────────

router.post("/tools/distressed/search", requirePin, async (req: Request, res: Response) => {
  try {
    const { state, city, county, zip, categories, locations, locationType } = req.body || {};

    // Support both legacy single-field format and new locations[]+locationType format
    const locArr: string[] = Array.isArray(locations) ? locations : (locations ? [locations] : []);

    // Map each location to the correct engine field based on locationType
    const resolveFields = (loc: string) => {
      const t = locationType || "zip";
      if (t === "city") {
        // "Baltimore, MD" → extract state abbreviation for engine filtering
        const parts = loc.split(",").map((s: string) => s.trim());
        const stateAbbr = parts.length > 1 ? parts[parts.length - 1] : "";
        return { zip: "", countyKey: "", state: stateAbbr };
      }
      return {
        zip:       t === "zip"    ? loc : (zip    || ""),
        countyKey: t === "county" ? loc : (county || ""),
        state:     t === "state"  ? loc : (state  || ""),
      };
    };

    if (locArr.length === 0 && !zip && !county && !state) {
      res.status(400).json({ error: "Provide at least one location" });
      return;
    }

    // Start one job per location (fall back to legacy single-field if no array)
    const toSearch = locArr.length > 0 ? locArr : ["__legacy__"];
    const jobIds: string[] = [];

    for (const loc of toSearch) {
      const fields = loc === "__legacy__"
        ? { zip: zip || "", countyKey: county || "", state: state || "", city: city || "" }
        : resolveFields(loc);

      const job = await scraperEngine.startDistressed({
        ...fields,
        categories: categories || [],
      });
      jobIds.push(job.job_id);
      distressedJobIds.push({ jobId: job.job_id, createdAt: new Date().toISOString() });
    }

    // Return first jobId for backward compat; also include full list
    res.json({
      jobId: jobIds[0],
      id: jobIds[0],
      jobIds,
      status: "queued",
      progress: 0,
    });
  } catch (err: any) {
    if (err instanceof ScraperEngineUnavailable) {
      // ── ATTOM fallback: when engine is unavailable but ATTOM key is configured ──
      if (hasAttomKey()) {
        const { zip, categories } = req.body || {};
        const searchZip = String(zip || "").trim();
        if (searchZip) {
          const jobId = `attom_${randomUUID().slice(0, 8)}`;
          const createdAt = new Date().toISOString();
          _attomDistressedJobs.set(jobId, { status: "queued", progress: 0, result: null, error: null, createdAt });
          distressedJobIds.push({ jobId, createdAt });

          // Run ATTOM search in background (non-blocking)
          setImmediate(async () => {
            _attomDistressedJobs.set(jobId, { status: "running", progress: 10, result: null, error: null, createdAt });
            try {
              const listings = await fetchDistressedViaAttom(searchZip, categories || [], 100);
              _attomDistressedJobs.set(jobId, {
                status: "done", progress: 100,
                result: { count: listings.length, listings, source: "ATTOM" },
                error: null, createdAt,
              });
              logger.info({ jobId, count: listings.length, zip: searchZip }, "[tools] ATTOM distressed fallback completed");
            } catch (attomErr: any) {
              _attomDistressedJobs.set(jobId, {
                status: "failed", progress: 0, result: null,
                error: attomErr?.message || "ATTOM search failed", createdAt,
              });
              logger.warn({ jobId, err: attomErr?.message }, "[tools] ATTOM distressed fallback failed");
            }
          });

          res.json({ jobId, id: jobId, jobIds: [jobId], status: "queued", progress: 0, source: "attom" });
          return;
        }
      }
      res.status(503).json({ error: err.message });
    } else {
      res.status(500).json({ error: err?.message || "Failed to start distressed search" });
    }
  }
});

router.get("/tools/distressed/status/:jobId", requirePin, async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);

  // Check ATTOM in-memory jobs first (prefix attom_ or any key stored there)
  const attomJob = _attomDistressedJobs.get(jobId);
  if (attomJob) {
    res.json({
      id: jobId,
      type: "distressed",
      status: attomJob.status === "done" ? "completed" : attomJob.status,
      progress: attomJob.progress,
      result: attomJob.result,
      error: attomJob.error,
      source: "attom",
    });
    return;
  }

  try {
    const job = await scraperEngine.getJob(jobId);
    if ((job as any).status === "done") (job as any).status = "completed";
    res.json(job);
  } catch (err: any) {
    if (err instanceof ScraperEngineUnavailable) {
      res.status(503).json({ error: err.message });
    } else {
      res.status(500).json({ error: err?.message || "Job not found" });
    }
  }
});

// ─── In-memory distressed job tracker ────────────────────────────────────────
// Keeps the ordered list of job IDs created via /tools/distressed/search so the
// History panel can display them.  The engine holds the actual job state.

interface DistressedJobEntry {
  jobId: string;
  createdAt: string;
}

const distressedJobIds: DistressedJobEntry[] = [];

// ─── ATTOM-backed distressed job store (fallback when engine unavailable) ─────

interface AttomDistressedJob {
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  result: any | null;
  error: string | null;
  createdAt: string;
}

const _attomDistressedJobs = new Map<string, AttomDistressedJob>();

// Auto-expire entries older than 24 h to prevent unbounded growth.
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let i = 0;
  while (i < distressedJobIds.length && new Date(distressedJobIds[i]!.createdAt).getTime() < cutoff) i++;
  if (i > 0) distressedJobIds.splice(0, i);
  for (const [id, job] of _attomDistressedJobs) {
    if (new Date(job.createdAt).getTime() < cutoff) _attomDistressedJobs.delete(id);
  }
}, 60 * 60 * 1000).unref();

router.get("/tools/distressed/jobs", requirePin, (_req, res) => {
  res.json({ jobs: [...distressedJobIds].reverse() });
});

// ─── In-memory distressed enrich job store ────────────────────────────────────

interface EnrichJob {
  enrichJobId: string;
  sourceJobId: string;
  status: "running" | "completed" | "failed";
  total: number;
  processed: number;
  results: any[];
  startedAt: string;
  error?: string;
}

const enrichJobs = new Map<string, EnrichJob>();

// Auto-expire enrich jobs older than 8 h.
setInterval(() => {
  const cutoff = Date.now() - 8 * 60 * 60 * 1000;
  for (const [id, job] of enrichJobs) {
    if (new Date(job.startedAt).getTime() < cutoff) enrichJobs.delete(id);
  }
}, 30 * 60 * 1000).unref();

// ─── GET /tools/distressed/download/:jobId ─────────────────────────────────
// Fetches the completed distressed listings from the engine and returns a CSV.

router.get("/tools/distressed/download/:jobId", requirePin, async (req: Request, res: Response) => {
  try {
    const jobId = String(req.params.jobId);
    const data = await scraperEngine.listDistressedForJob(jobId);
    const listings: any[] = data.listings || [];

    if (!listings.length) {
      res.status(404).json({ error: "No listings found for this job" });
      return;
    }

    const COLS = [
      "address", "city", "state", "zip", "county",
      "property_type", "year_built", "sqft", "beds", "baths", "lot_size",
      "apn", "owner_name", "estimated_value", "opening_bid", "mortgage_balance",
      "distress_type", "source", "source_url",
    ];

    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const header = COLS.join(",");
    const rows = listings.map(r =>
      COLS.map(col => esc(r[col] ?? r[col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] ?? "")).join(",")
    );

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="distressed_${jobId.substring(0, 8)}_${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send([header, ...rows].join("\n"));
  } catch (err: any) {
    if (err instanceof ScraperEngineUnavailable) { res.status(503).json({ error: err.message }); return; }
    res.status(500).json({ error: err?.message || "Download failed" });
  }
});

// ─── POST /tools/distressed/enrich/:jobId ─────────────────────────────────
// Fetches distressed listings from the engine, runs skip-trace on each record,
// and stores the enriched results in-memory for later download.

router.post("/tools/distressed/enrich/:jobId", requirePin, async (req: Request, res: Response) => {
  try {
    const jobId = String(req.params.jobId);
    const data = await scraperEngine.listDistressedForJob(jobId);
    const listings: any[] = data.listings || [];

    if (!listings.length) {
      res.status(404).json({ error: "No listings found for this job — nothing to enrich" });
      return;
    }

    const enrichJobId = randomUUID();
    const enrichJob: EnrichJob = {
      enrichJobId,
      sourceJobId: jobId,
      status: "running",
      total: listings.length,
      processed: 0,
      results: [],
      startedAt: new Date().toISOString(),
    };
    enrichJobs.set(enrichJobId, enrichJob);

    // Run enrichment in the background — do not await.
    setImmediate(async () => {
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
        // Throttle ~2 records/sec to respect API rate limits
        await new Promise(r => setTimeout(r, 500));
      }

      enrichJob.status = "completed";
    });

    logger.info({ enrichJobId, sourceJobId: req.params.jobId, total: listings.length }, "[distressed] enrich job started");
    res.json({ enrichJobId, total: listings.length, status: "running" });
  } catch (err: any) {
    if (err instanceof ScraperEngineUnavailable) { res.status(503).json({ error: err.message }); return; }
    res.status(500).json({ error: err?.message || "Failed to start enrichment" });
  }
});

// ─── GET /tools/distressed/enrich-status/:enrichJobId ────────────────────
// Poll the progress of an enrichment job.

router.get("/tools/distressed/enrich-status/:enrichJobId", requirePin, (req: Request, res: Response) => {
  const job = enrichJobs.get(String(req.params.enrichJobId));
  if (!job) { res.status(404).json({ error: "Enrich job not found" }); return; }
  res.json({
    enrichJobId: job.enrichJobId,
    sourceJobId: job.sourceJobId,
    status:      job.status,
    total:       job.total,
    processed:   job.processed,
    error:       job.error ?? null,
  });
});

// ─── GET /tools/distressed/download-enriched/:enrichJobId ─────────────────
// Download the completed enriched CSV (includes phones + emails from skip-trace).

router.get("/tools/distressed/download-enriched/:enrichJobId", requirePin, (req: Request, res: Response) => {
  const job = enrichJobs.get(String(req.params.enrichJobId));
  if (!job) { res.status(404).json({ error: "Enrich job not found" }); return; }
  if (job.status !== "completed") { res.status(409).json({ error: "Enrichment not yet completed" }); return; }
  if (!job.results.length) { res.status(404).json({ error: "No enriched results to download" }); return; }

  const COLS = [
    "address", "city", "state", "zip", "county",
    "property_type", "year_built", "sqft", "beds", "baths",
    "owner_name", "estimated_value", "distress_type", "source",
    "phones", "emails", "skip_trace_status",
  ];

  const esc = (v: any) => {
    const s = Array.isArray(v) ? v.join(" | ") : v == null ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const header = COLS.join(",");
  const rows = job.results.map(r =>
    COLS.map(col => esc(r[col] ?? r[col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] ?? "")).join(",")
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="distressed-enriched_${job.sourceJobId.substring(0, 8)}_${new Date().toISOString().slice(0, 10)}.csv"`
  );
  res.send([header, ...rows].join("\n"));
});

// ─── GET /tools/arv/config ────────────────────────────────────────────────────

router.get("/tools/arv/config", requirePin, (_req, res) => {
  res.json({
    attomConfigured: hasAttomKey(),
    propertyApiConfigured: !!getNextApiKey(),
    engineConfigured: !!(process.env.SCRAPER_ENGINE_URL || "https://scraper-engine-production-6207.up.railway.app"),
    defaultRadiusMiles: 0.5,
    defaultMaxComps: 8,
    adjustmentFactors: {
      bedroom:   12500,
      bathroom:  7500,
      sqft:      50,
      yearBuilt: 150,
      pool:      15000,
      garage:    7500,
    },
    maoDiscounts: {
      heavyRehab:  0.70,
      lightUpdate: 0.80,
      turnkey:     0.90,
    },
  });
});

// ─── POST /tools/arv/calculate ────────────────────────────────────────────────

router.post("/tools/arv/calculate", requirePin, async (req: Request, res: Response) => {
  try {
    const {
      street,
      city,
      state,
      zip,
      repairCost = 0,
      maxComps = 8,
      miles = 0.5,
    } = (req.body || {}) as {
      street: string;
      city?: string;
      state?: string;
      zip?: string;
      repairCost?: number;
      maxComps?: number;
      miles?: number;
    };

    if (!street) { res.status(400).json({ error: "street is required" }); return; }
    if (!hasAttomKey()) { res.status(503).json({ error: "ATTOM API key not configured" }); return; }

    // 1. Geocode subject property
    const coords = await geocodeViaAttom(street, city, state, zip);
    if (!coords) { res.status(404).json({ error: "Could not geocode address — check street/city/state and try again" }); return; }

    // 2. Fetch subject property details + comps in parallel
    const [subjectData, compsRaw, attomAvm] = await Promise.allSettled([
      fetchPropertyDataViaAttom(street, city, state, zip),
      fetchCompsViaAttom(coords.lat, coords.lng, miles, Math.min(Number(maxComps) || 8, 20), null, null),
      fetchAttomAvm(street, [city, state, zip].filter(Boolean).join(" ")),
    ]);

    const subject = subjectData.status === "fulfilled" ? subjectData.value : null;
    const rawComps = compsRaw.status === "fulfilled" ? compsRaw.value : [];
    const avmResult = attomAvm.status === "fulfilled" ? attomAvm.value : null;

    if (!rawComps.length) {
      res.status(404).json({ error: "No recent comparable sales found in this area. Try a larger radius." });
      return;
    }

    // 3. Derive market $/sqft from comp pool (median of sale price ÷ sqft)
    const sqftRates = rawComps
      .filter(c => c.sqft && c.sqft > 200 && c.salePrice > 0)
      .map(c => c.salePrice / c.sqft!);
    const sortedRates = [...sqftRates].sort((a, b) => a - b);
    const marketPricePerSqft = sortedRates.length
      ? Math.round(sortedRates[Math.floor(sortedRates.length / 2)]!)
      : 50;

    // 4. For each comp calculate adjusted price
    const subjectProp = {
      beds:      subject?.beds      ?? null,
      baths:     subject?.baths     ?? null,
      sqft:      subject?.sqft      ?? null,
      yearBuilt: subject?.yearBuilt ?? null,
    };

    const subjectSqftSource = subject?.sqft ? "ATTOM" : "unknown";

    const compsWithAdj = rawComps.map(comp => {
      const compProp = {
        salePrice: comp.salePrice,
        beds:      comp.beds      ?? null,
        baths:     comp.baths     ?? null,
        sqft:      comp.sqft      ?? null,
        yearBuilt: comp.yearBuilt ?? null,
        soldDate:  comp.soldDate  ?? null,
      };
      const adjustedPrice = calculateAdjustedComp(subjectProp, compProp, marketPricePerSqft);

      // Time adjustment component for display
      const timeAdj = comp.soldDate
        ? (() => {
            const ms = (Date.now() - new Date(comp.soldDate).getTime());
            const monthsAgo = ms / (1000 * 60 * 60 * 24 * 30.5);
            return Math.round(comp.salePrice * 0.03 * (monthsAgo / 12));
          })()
        : 0;

      return {
        address:      comp.address,
        beds:         comp.beds   ?? null,
        baths:        comp.baths  ?? null,
        sqft:         comp.sqft   ?? null,
        yearBuilt:    comp.yearBuilt ?? null,
        salePrice:    comp.salePrice,
        saleDate:     comp.soldDate  ?? null,
        propertyType: comp.propertyType ?? null,
        adjustedPrice,
        distanceMiles: `< ${miles}`,
        adjustments: { time: timeAdj },
      };
    });

    const adjustedPrices = compsWithAdj.map(c => c.adjustedPrice);
    const arv = calculateArvFromComps(adjustedPrices);
    if (!arv) { res.status(422).json({ error: "Not enough valid comps to calculate ARV" }); return; }

    const mao     = calculateMao(arv, Number(repairCost), null, 0.80) ?? 0;
    const maxOffer = calculateMao(arv, Number(repairCost), null, 0.75) ?? 0;
    const arvPricePerSqft = subject?.sqft ? Math.round(arv / subject.sqft) : marketPricePerSqft;

    res.json({
      arv,
      mao,
      maxOffer,
      repairCost: Number(repairCost),
      arvPricePerSqft,
      compsUsed: compsWithAdj.length,
      comps: compsWithAdj,
      subject: {
        address: [street, city, state, zip].filter(Boolean).join(", "),
        beds:      subject?.beds      ?? null,
        baths:     subject?.baths     ?? null,
        sqft:      subject?.sqft      ?? null,
        yearBuilt: subject?.yearBuilt ?? null,
        ownerName: subject?.ownerName ?? null,
        lastSalePrice: subject?.lastSalePrice ?? null,
        lastSaleDate:  subject?.lastSaleDate  ?? null,
      },
      attomAvm: avmResult ?? null,
      marketPricePerSqft,
      subjectSqftSource,
      radiusMiles: miles,
    });
  } catch (err: any) {
    logger.error({ err: err?.message }, "[tools] /arv/calculate error");
    res.status(500).json({ error: err?.message || "ARV calculation failed" });
  }
});

// ─── POST /tools/arv/calculate-manual ────────────────────────────────────────

router.post("/tools/arv/calculate-manual", requirePin, (req: Request, res: Response) => {
  try {
    const {
      beds, baths, sqft, yearBuilt,
      repairCost = 0,
      comps = [],
    } = (req.body || {}) as {
      beds?: number;
      baths?: number;
      sqft?: number;
      yearBuilt?: number;
      repairCost?: number;
      comps: Array<{
        address?: string;
        beds?: number;
        baths?: number;
        sqft?: number;
        yearBuilt?: number;
        salePrice: number;
        soldDate?: string;
      }>;
    };

    if (!comps.length) { res.status(400).json({ error: "At least one comp is required" }); return; }

    const subject = { beds: beds ?? null, baths: baths ?? null, sqft: sqft ?? null, yearBuilt: yearBuilt ?? null };

    const sqftRates = comps.filter(c => c.sqft && c.sqft > 200).map(c => c.salePrice / c.sqft!);
    const sortedRates = [...sqftRates].sort((a, b) => a - b);
    const marketPricePerSqft = sortedRates.length
      ? Math.round(sortedRates[Math.floor(sortedRates.length / 2)]!)
      : 50;

    const compsWithAdj = comps.map(comp => {
      const adjustedPrice = calculateAdjustedComp(subject, {
        salePrice: comp.salePrice,
        beds:      comp.beds      ?? null,
        baths:     comp.baths     ?? null,
        sqft:      comp.sqft      ?? null,
        yearBuilt: comp.yearBuilt ?? null,
        soldDate:  comp.soldDate  ?? null,
      }, marketPricePerSqft);

      const timeAdj = comp.soldDate
        ? Math.round(comp.salePrice * 0.03 * ((Date.now() - new Date(comp.soldDate).getTime()) / (1000 * 60 * 60 * 24 * 30.5 * 12)))
        : 0;

      return { ...comp, adjustedPrice, distanceMiles: null, adjustments: { time: timeAdj } };
    });

    const arv = calculateArvFromComps(compsWithAdj.map(c => c.adjustedPrice));
    if (!arv) { res.status(422).json({ error: "Not enough valid comps to calculate ARV" }); return; }

    const mao      = calculateMao(arv, Number(repairCost), null, 0.80) ?? 0;
    const maxOffer = calculateMao(arv, Number(repairCost), null, 0.75) ?? 0;
    const arvPricePerSqft = sqft ? Math.round(arv / sqft) : marketPricePerSqft;

    res.json({
      arv, mao, maxOffer,
      repairCost: Number(repairCost),
      arvPricePerSqft,
      compsUsed: compsWithAdj.length,
      comps: compsWithAdj,
      marketPricePerSqft,
      subjectSqftSource: "manual",
      attomAvm: null,
    });
  } catch (err: any) {
    logger.error({ err: err?.message }, "[tools] /arv/calculate-manual error");
    res.status(500).json({ error: err?.message || "Manual ARV calculation failed" });
  }
});

// ─── POST /tools/property-lookup/search ───────────────────────────────────────

router.post("/tools/property-lookup/search", requirePin, async (req: Request, res: Response) => {
  try {
    const { street, city, state, zip } = (req.body || {}) as {
      street: string; city?: string; state?: string; zip?: string;
    };

    if (!street) { res.status(400).json({ error: "street is required" }); return; }
    if (!hasAttomKey()) { res.status(503).json({ error: "ATTOM API key not configured" }); return; }

    const address2 = [city, state, zip].filter(Boolean).join(" ");
    const addrParams: Record<string, string> = { address1: street };
    if (address2) addrParams.address2 = address2;

    // Fire all ATTOM calls in parallel: detail+mortgage, allevents, AVM
    const [detailRes, avmRes, mortgageRes] = await Promise.allSettled([
      fetchPropertyDataViaAttom(street, city, state, zip),
      fetchAttomAvm(street, address2),
      attomGet("/propertyapi/v1.0.0/property/detailmortgage", addrParams).catch(() => null),
    ]);

    const propData = detailRes.status === "fulfilled" ? detailRes.value : null;
    const avmData  = avmRes.status  === "fulfilled" ? avmRes.value  : null;
    const mortRaw  = mortgageRes.status === "fulfilled" ? mortgageRes.value : null;

    if (!propData && !avmData) {
      res.status(404).json({ error: "No property data found — check the address and try again" });
      return;
    }

    // Extract mortgage data
    const mortProp = mortRaw?.property?.[0];
    const mort = mortProp?.mortgage;
    const assessment = mortProp?.assessment;

    const mortgageAmount   = mort?.loaninfo?.loanamt         ?? null;
    const mortgageLender   = mort?.loaninfo?.lenderName      ?? mort?.loaninfo?.lender ?? null;
    const mortgageLoanType = mort?.loaninfo?.loantype        ?? null;
    const mortgageTerm     = mort?.loaninfo?.loanterm        ?? null;
    const mortgageDate     = mort?.recordinginformation?.recordingdate ?? null;
    const mortgageDueDate  = mort?.loaninfo?.duedate         ?? null;

    const taxAmount: number | null = (() => {
      const v = assessment?.tax?.taxamt ?? mortProp?.assessment?.tax?.taxamt;
      return v != null ? parseFloat(v) : null;
    })();

    const county: string | null = mortProp?.area?.countyuse1 ?? mortProp?.area?.subdname ?? null;

    // Owner2, owner type, absentee
    const ownerName2        = mortProp?.owner?.owner2?.fullname ?? null;
    const ownerType         = mortProp?.owner?.owner1?.ownertype ?? null;
    const isAbsenteeOwner   = (() => {
      const mailing = mortProp?.owner?.mailingaddress?.line1;
      const property = street;
      if (!mailing) return null;
      return !(mailing.toLowerCase().includes(property.toLowerCase().split(" ").slice(0, 2).join(" ").toLowerCase()));
    })();
    const ownerMailingAddress = mortProp?.owner?.mailingaddress
      ? [mortProp.owner.mailingaddress.line1, mortProp.owner.mailingaddress.locality, mortProp.owner.mailingaddress.countrySubd].filter(Boolean).join(", ")
      : null;

    // AVM-derived equity estimates
    const avm         = avmData?.value ?? null;
    const avmLow      = avmData?.low   ?? null;
    const avmHigh     = avmData?.high  ?? null;

    // Try skip trace for contact info (non-blocking — fail soft)
    let phones: string[] = [];
    let emails: string[] = [];
    try {
      if (getNextApiKey() || process.env.PEOPLEDATALABS_API_KEY) {
        const ownerParts = propData?.ownerName?.split(" ") ?? [];
        const st = await runSkipTrace(
          street, city, state, zip,
          ownerParts[0] ?? null,
          ownerParts.slice(1).join(" ") || null,
        );
        if (st) {
          phones = st.phones.map(p => p.number);
          emails = st.emails;
        }
      }
    } catch {
      // Skip trace is best-effort; don't fail the whole request
    }

    const estimatedEquity = avm != null && mortgageAmount != null ? avm - mortgageAmount : null;
    const equityPercent   = avm != null && avm > 0 && estimatedEquity != null
      ? Math.round((estimatedEquity / avm) * 100) : null;
    const ltvPercent      = avm != null && avm > 0 && mortgageAmount != null
      ? Math.round((mortgageAmount / avm) * 100) : null;
    const pricePerSqft    = avm != null && propData?.sqft
      ? Math.round(avm / propData.sqft) : null;
    const assessedToAvmPercent = avm != null && avm > 0 && propData?.taxAssessedValue != null
      ? Math.round((propData.taxAssessedValue / avm) * 100) : null;

    res.json({
      property: {
        address: street,
        city: city ?? null,
        state: state ?? null,
        zip: zip ?? null,
        county,
        propertyType:   propData?.propertyType   ?? null,
        beds:           propData?.beds            ?? null,
        baths:          propData?.baths           ?? null,
        sqft:           propData?.sqft            ?? null,
        lotSqft:        propData?.lotSqft         ?? null,
        yearBuilt:      propData?.yearBuilt       ?? null,
        hasPool:        propData?.hasPool         ?? null,
        hasGarage:      propData?.hasGarage       ?? null,
        avm,
        avmLow,
        avmHigh,
        avmConfidence:  avmData?.confidence       ?? null,
        assessedTotalValue: propData?.taxAssessedValue ?? null,
        taxAmount,
        lastSalePrice:  propData?.lastSalePrice   ?? null,
        lastSaleDate:   propData?.lastSaleDate    ?? null,
        mortgageAmount:   mortgageAmount ? Number(mortgageAmount) : null,
        mortgageLender:   mortgageLender   ?? null,
        mortgageLoanType: mortgageLoanType ?? null,
        mortgageTerm:     mortgageTerm     ?? null,
        mortgageDate:     mortgageDate     ?? null,
        mortgageDueDate:  mortgageDueDate  ?? null,
        mortgageBalance:  mortgageAmount   ? Number(mortgageAmount) : null,
        estimatedEquity,
        ownerName:          propData?.ownerName ?? null,
        ownerName2:         ownerName2          ?? null,
        ownerType:          ownerType           ?? null,
        isAbsenteeOwner:    isAbsenteeOwner,
        ownerMailingAddress: ownerMailingAddress ?? null,
        latitude:   propData?.latitude  ?? null,
        longitude:  propData?.longitude ?? null,
        phones,
        emails,
      },
      metrics: {
        isAbsenteeOwner: isAbsenteeOwner ?? false,
        hasPhone: phones.length > 0,
        equityPercent,
        ltvPercent,
        pricePerSqft,
        assessedToAvmPercent,
      },
    });
  } catch (err: any) {
    logger.error({ err: err?.message }, "[tools] /property-lookup/search error");
    res.status(500).json({ error: err?.message || "Property lookup failed" });
  }
});

// ─── POST /tools/property ─────────────────────────────────────────────────────
// Combined ARV + property data endpoint for external integrations

router.post("/tools/property", requirePin, async (req: Request, res: Response) => {
  try {
    const {
      street, city, state, zip,
      repairCost = 0,
      radiusMiles = 0.5,
      maxComps = 8,
    } = (req.body || {}) as {
      street: string; city?: string; state?: string; zip?: string;
      repairCost?: number; radiusMiles?: number; maxComps?: number;
    };

    if (!street) { res.status(400).json({ error: "street is required" }); return; }
    if (!hasAttomKey()) { res.status(503).json({ error: "ATTOM API key not configured" }); return; }

    const coords = await geocodeViaAttom(street, city, state, zip);
    if (!coords) { res.status(404).json({ error: "Could not geocode address" }); return; }

    const [subjectData, compsRaw, avmData] = await Promise.allSettled([
      fetchPropertyDataViaAttom(street, city, state, zip),
      fetchCompsViaAttom(coords.lat, coords.lng, radiusMiles, Math.min(maxComps, 20), null, null),
      fetchAttomAvm(street, [city, state, zip].filter(Boolean).join(" ")),
    ]);

    const subject = subjectData.status === "fulfilled" ? subjectData.value : null;
    const comps   = compsRaw.status  === "fulfilled" ? compsRaw.value  : [];
    const avm     = avmData.status   === "fulfilled" ? avmData.value   : null;

    const sqftRates = comps.filter(c => c.sqft && c.sqft > 200).map(c => c.salePrice / c.sqft!);
    const sortedRates = [...sqftRates].sort((a, b) => a - b);
    const marketPricePerSqft = sortedRates.length
      ? Math.round(sortedRates[Math.floor(sortedRates.length / 2)]!)
      : 50;

    const subjectProp = {
      beds: subject?.beds ?? null, baths: subject?.baths ?? null,
      sqft: subject?.sqft ?? null, yearBuilt: subject?.yearBuilt ?? null,
    };

    const adjustedPrices = comps.map(c =>
      calculateAdjustedComp(subjectProp, {
        salePrice: c.salePrice, beds: c.beds ?? null, baths: c.baths ?? null,
        sqft: c.sqft ?? null, yearBuilt: c.yearBuilt ?? null, soldDate: c.soldDate ?? null,
      }, marketPricePerSqft)
    );

    const arvValue = calculateArvFromComps(adjustedPrices);
    const mao      = arvValue ? (calculateMao(arvValue, Number(repairCost), null, 0.80) ?? 0) : null;

    res.json({
      address: { street, city: city ?? null, state: state ?? null, zip: zip ?? null },
      property: subject,
      arv: arvValue,
      mao,
      repairCost: Number(repairCost),
      attomAvm: avm,
      compsCount: comps.length,
      marketPricePerSqft,
    });
  } catch (err: any) {
    logger.error({ err: err?.message }, "[tools] /tools/property error");
    res.status(500).json({ error: err?.message || "Property ARV lookup failed" });
  }
});

// ─── In-memory skip-trace batch job store ─────────────────────────────────────

interface SkipTraceRecord {
  original: Record<string, string>;
  phones: string[];
  emails: string[];
  matchStatus?: string;
}

interface SkipTraceJob {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  startedAt: string;
  totalRecords: number;
  processed: number;
  succeeded: number;
  failed: number;
  progressPercent: number;
  results: SkipTraceRecord[];
  errorMessage?: string;
}

const skipTraceJobs = new Map<string, SkipTraceJob>();

/** Auto-expire jobs older than 4 hours to prevent unbounded memory growth. */
setInterval(() => {
  const cutoff = Date.now() - 4 * 60 * 60 * 1000;
  for (const [id, job] of skipTraceJobs) {
    if (new Date(job.startedAt).getTime() < cutoff) skipTraceJobs.delete(id);
  }
}, 30 * 60 * 1000).unref();

/** Try to detect the address columns from an arbitrary spreadsheet row. */
function detectColumns(row: Record<string, string>): {
  streetKey: string | null; cityKey: string | null; stateKey: string | null; zipKey: string | null;
  firstNameKey: string | null; lastNameKey: string | null;
} {
  const keys = Object.keys(row).map(k => k.toLowerCase().trim());
  const find = (...patterns: string[]) => {
    for (const p of patterns) {
      const match = Object.keys(row).find(k => keys[Object.keys(row).indexOf(k)]?.includes(p));
      if (match) return match;
    }
    return null;
  };
  return {
    streetKey:    find("street", "address", "addr"),
    cityKey:      find("city"),
    stateKey:     find("state", "st"),
    zipKey:       find("zip", "postal"),
    firstNameKey: find("first", "fname"),
    lastNameKey:  find("last", "lname", "surname"),
  };
}

async function processSkipTraceJob(job: SkipTraceJob, records: Record<string, string>[]) {
  job.status = "running";

  const cols = records.length ? detectColumns(records[0]!) : {
    streetKey: null, cityKey: null, stateKey: null, zipKey: null, firstNameKey: null, lastNameKey: null,
  };

  for (let i = 0; i < records.length; i++) {
    const row = records[i]!;
    const street    = cols.streetKey    ? row[cols.streetKey]    ?? "" : "";
    const city      = cols.cityKey      ? row[cols.cityKey]      ?? "" : "";
    const state     = cols.stateKey     ? row[cols.stateKey]     ?? "" : "";
    const zip       = cols.zipKey       ? row[cols.zipKey]       ?? "" : "";
    const firstName = cols.firstNameKey ? row[cols.firstNameKey] ?? "" : "";
    const lastName  = cols.lastNameKey  ? row[cols.lastNameKey]  ?? "" : "";

    try {
      const result = await runSkipTrace(
        street, city || null, state || null, zip || null,
        firstName || null, lastName || null,
      );
      if (result && (result.phones.length || result.emails.length)) {
        job.results.push({
          original: row,
          phones: result.phones.map(p => p.number),
          emails: result.emails,
          matchStatus: result.matchStatus,
        });
        job.succeeded++;
      } else {
        job.results.push({ original: row, phones: [], emails: [], matchStatus: "not_found" });
        job.failed++;
      }
    } catch {
      job.results.push({ original: row, phones: [], emails: [], matchStatus: "error" });
      job.failed++;
    }

    job.processed++;
    job.progressPercent = Math.round((job.processed / job.totalRecords) * 100);

    // Throttle to ~2 records/sec to respect API rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  job.status = "completed";
  job.progressPercent = 100;
}

// ─── GET /tools/skip-trace/jobs ───────────────────────────────────────────────

router.get("/tools/skip-trace/jobs", requirePin, (_req, res) => {
  const jobs = Array.from(skipTraceJobs.values()).map(j => ({
    jobId:          j.jobId,
    status:         j.status,
    startedAt:      j.startedAt,
    totalRecords:   j.totalRecords,
    processed:      j.processed,
    succeeded:      j.succeeded,
    failed:         j.failed,
    progressPercent: j.progressPercent,
  })).sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  res.json({ jobs });
});

// ─── POST /tools/skip-trace/upload ───────────────────────────────────────────

router.post("/tools/skip-trace/upload", requirePin, async (req: Request, res: Response) => {
  try {
    const { records, filename } = (req.body || {}) as { records: Record<string, string>[]; filename?: string };
    if (!Array.isArray(records) || !records.length) {
      res.status(400).json({ error: "records array is required and must not be empty" });
      return;
    }
    if (records.length > 50000) {
      res.status(400).json({ error: "Maximum 50,000 records per upload" });
      return;
    }

    const jobId = randomUUID();
    const job: SkipTraceJob = {
      jobId,
      status:         "queued",
      startedAt:      new Date().toISOString(),
      totalRecords:   records.length,
      processed:      0,
      succeeded:      0,
      failed:         0,
      progressPercent: 0,
      results:        [],
    };
    skipTraceJobs.set(jobId, job);

    // Start processing in background (non-blocking)
    setImmediate(() => {
      processSkipTraceJob(job, records).catch(err => {
        job.status = "failed";
        job.errorMessage = err?.message || "Processing failed";
        logger.error({ jobId, err: err?.message }, "[skipTrace] batch job failed");
      });
    });

    logger.info({ jobId, records: records.length, filename }, "[skipTrace] batch job created");
    res.json({ jobId, status: "queued", totalRecords: records.length });
  } catch (err: any) {
    logger.error({ err: err?.message }, "[tools] /skip-trace/upload error");
    res.status(500).json({ error: err?.message || "Failed to start skip trace job" });
  }
});

// ─── GET /tools/skip-trace/status/:jobId ─────────────────────────────────────

router.get("/tools/skip-trace/status/:jobId", requirePin, (req: Request, res: Response) => {
  const job = skipTraceJobs.get(String(req.params.jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json({
    jobId:           job.jobId,
    status:          job.status,
    startedAt:       job.startedAt,
    totalRecords:    job.totalRecords,
    processed:       job.processed,
    succeeded:       job.succeeded,
    failed:          job.failed,
    progressPercent: job.progressPercent,
    errorMessage:    job.errorMessage ?? null,
  });
});

// ─── GET /tools/skip-trace/download/:jobId ────────────────────────────────────

router.get("/tools/skip-trace/download/:jobId", requirePin, (req: Request, res: Response) => {
  const job = skipTraceJobs.get(String(req.params.jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.status !== "completed") { res.status(409).json({ error: "Job not yet completed" }); return; }
  if (!job.results.length) { res.status(404).json({ error: "No results to download" }); return; }

  // Build CSV
  const originalKeys = Object.keys(job.results[0]!.original);
  const headers = [...originalKeys, "phones", "emails", "match_status"];

  const escape = (v: any) => {
    const s = v == null ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const rows = job.results.map(r => [
    ...originalKeys.map(k => escape(r.original[k] ?? "")),
    escape(r.phones.join(" | ")),
    escape(r.emails.join(" | ")),
    escape(r.matchStatus ?? ""),
  ].join(","));

  const csv = [headers.join(","), ...rows].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="contact-enrichment-${job.jobId.substring(0, 8)}.csv"`);
  res.send(csv);
});

// ─────────────────────────────────────────────────────────────────────────────
// Phone Finder — batch phone number lookup via scraper engine
// ─────────────────────────────────────────────────────────────────────────────

interface PhoneFinderJob {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  startedAt: string;
  totalRecords: number;
  processed: number;
  found: number;
  notFound: number;
  progressPercent: number;
  results: Array<{
    name: string;
    address: string;
    phones: string[];
    source: string;
    original: Record<string, string>;
  }>;
  errorMessage?: string;
}

const phoneFinderJobs = new Map<string, PhoneFinderJob>();

// ─── POST /tools/phone-finder/upload ─────────────────────────────────────────

router.post("/tools/phone-finder/upload", requirePin, async (req: Request, res: Response) => {
  try {
    const { records, filename } = req.body as { records: Record<string, string>[]; filename?: string };
    if (!Array.isArray(records) || records.length === 0) {
      res.status(400).json({ error: "No records provided" });
      return;
    }

    const jobId = randomUUID();
    const job: PhoneFinderJob = {
      jobId,
      status: "queued",
      startedAt: new Date().toISOString(),
      totalRecords: records.length,
      processed: 0,
      found: 0,
      notFound: 0,
      progressPercent: 0,
      results: [],
    };
    phoneFinderJobs.set(jobId, job);

    logger.info({ jobId, count: records.length, file: filename }, "[phone-finder] Job queued");
    res.json({ jobId, status: "queued", totalRecords: records.length });

    // Run in background
    (async () => {
      job.status = "running";
      try {
        for (let i = 0; i < records.length; i++) {
          const raw = records[i]!;

          // Auto-detect name and address columns
          const name =
            raw["Investor Name"] || raw["investor name"] ||
            raw["Company"] || raw["company"] ||
            raw["Name"] || raw["name"] ||
            raw["LLC"] || raw["Business Name"] ||
            Object.values(raw)[0] || "";

          const addr1 =
            raw["Buyer Adress"] || raw["Buyer Address"] || raw["buyer_address"] ||
            raw["Address"] || raw["address"] || raw["Street"] || raw["street"] || "";
          const addr2 =
            raw["Buyer adress 2"] || raw["Buyer Address 2"] || raw["City State"] ||
            raw["City"] || raw["city"] || "";
          const address = [addr1, addr2].filter(Boolean).join(", ");

          let phones: string[] = [];
          let source = "none";

          try {
            const result = await scraperEngine.lookupPhone(name.trim(), address.trim());
            phones = result?.phones ?? [];
            source = result?.source ?? "google";
          } catch (err: any) {
            if (!(err instanceof ScraperEngineUnavailable)) {
              logger.warn({ name, err: err?.message }, "[phone-finder] lookup failed for record");
            }
          }

          job.results.push({ name, address, phones, source, original: raw });
          job.processed = i + 1;
          job.progressPercent = Math.round(((i + 1) / records.length) * 100);
          if (phones.length > 0) job.found++; else job.notFound++;
        }
        job.status = "completed";
        logger.info({ jobId, found: job.found, notFound: job.notFound }, "[phone-finder] Job completed");
      } catch (err: any) {
        job.status = "failed";
        job.errorMessage = err?.message || "Unknown error";
        logger.error({ jobId, err: err?.message }, "[phone-finder] Job failed");
      }
    })();
  } catch (err: any) {
    logger.error({ err: err?.message }, "[phone-finder] /upload error");
    res.status(500).json({ error: err?.message || "Failed to start phone finder job" });
  }
});

// ─── GET /tools/phone-finder/status/:jobId ───────────────────────────────────

router.get("/tools/phone-finder/status/:jobId", requirePin, (req: Request, res: Response) => {
  const job = phoneFinderJobs.get(String(req.params.jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json({
    jobId: job.jobId,
    status: job.status,
    startedAt: job.startedAt,
    totalRecords: job.totalRecords,
    processed: job.processed,
    found: job.found,
    notFound: job.notFound,
    progressPercent: job.progressPercent,
    errorMessage: job.errorMessage ?? null,
    results: job.status === "completed" ? job.results.map(r => ({
      name: r.name,
      address: r.address,
      phones: r.phones,
      source: r.source,
    })) : [],
  });
});

// ─── GET /tools/phone-finder/download/:jobId ─────────────────────────────────

router.get("/tools/phone-finder/download/:jobId", requirePin, (req: Request, res: Response) => {
  const job = phoneFinderJobs.get(String(req.params.jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.status !== "completed") { res.status(409).json({ error: "Job not yet completed" }); return; }

  const escape = (v: any) => {
    const s = v == null ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const originalKeys = job.results.length > 0 ? Object.keys(job.results[0]!.original) : [];
  const headers = [...originalKeys, "phones_found", "source"];

  const rows = job.results.map(r => [
    ...originalKeys.map(k => escape(r.original[k] ?? "")),
    escape(r.phones.join(" | ")),
    escape(r.source),
  ].join(","));

  const csv = [headers.join(","), ...rows].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="phone-finder-${job.jobId.substring(0, 8)}.csv"`);
  res.send(csv);
});

export default router;
