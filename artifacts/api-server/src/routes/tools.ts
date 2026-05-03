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

function requirePin(req: Request, res: Response, next: NextFunction) {
  const toolsPin = process.env.TOOLS_PIN;
  if (!toolsPin) { res.status(503).json({ error: "TOOLS_PIN not configured" }); return; }
  const provided = req.headers["x-tools-pin"] as string | undefined;
  if (!provided || provided.trim() !== toolsPin.trim()) { res.status(403).json({ error: "Invalid PIN" }); return; }
  next();
}

export class CreditExhaustedError extends Error {
  constructor(service: string, msg: string) {
    super(`CREDITS_EXHAUSTED:${service}:${msg}`);
    this.name = "CreditExhaustedError";
  }
}

router.post("/tools/auth/verify", (req, res) => {
  const toolsPin = process.env.TOOLS_PIN;
  if (!toolsPin) { res.status(503).json({ error: "TOOLS_PIN not configured" }); return; }
  const provided = req.headers["x-tools-pin"] as string | undefined;
  if (!provided || provided.trim() !== toolsPin.trim()) { res.status(403).json({ error: "Invalid PIN" }); return; }
  res.json({ success: true });
});

export default router;
