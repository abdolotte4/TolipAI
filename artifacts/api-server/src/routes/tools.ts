/**
 * Digor Tools API Routes
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { scraperEngine, ScraperEngineUnavailable } from "../services/scraperEngineClient";

const router: Router = Router();

function requirePin(req: Request, res: Response, next: NextFunction) {
  const toolsPin = process.env.TOOLS_PIN;
  if (!toolsPin) { res.status(503).json({ error: "TOOLS_PIN not configured" }); return; }
  const provided = req.headers["x-tools-pin"] as string | undefined;
  if (!provided || provided.trim() !== toolsPin.trim()) { res.status(403).json({ error: "Invalid PIN" }); return; }
  next();
}

router.get("/tools/auth/verify", (req, res) => {
  const toolsPin = process.env.TOOLS_PIN;
  if (!toolsPin) { res.status(503).json({ error: "TOOLS_PIN not configured" }); return; }
  const provided = req.headers["x-tools-pin"] as string | undefined;
  if (!provided || provided.trim() !== toolsPin.trim()) { res.status(403).json({ error: "Invalid PIN" }); return; }
  res.json({
    success: true,
    attomConfigured: !!process.env.ATTOM_API_KEY,
    engineConfigured: !!(process.env.SCRAPER_ENGINE_URL || "https://scraper-engine-production-6207.up.railway.app"),
  });
});

router.post("/tools/distressed/search", requirePin, async (req: Request, res: Response) => {
  try {
    const { state, city, county, zip, categories } = req.body || {};
    const job = await scraperEngine.startDistressed({
      zip: zip || "",
      countyKey: county || "",
      state: state || "",
      categories: categories || [],
    });
    const jobId = job.job_id;
    res.json({ jobId, id: jobId, status: job.status || "queued", progress: 0 });
  } catch (err: any) {
    if (err instanceof ScraperEngineUnavailable) {
      res.status(503).json({ error: err.message });
    } else {
      res.status(500).json({ error: err?.message || "Failed to start distressed search" });
    }
  }
});

router.get("/tools/distressed/status/:jobId", requirePin, async (req: Request, res: Response) => {
  try {
    const job = await scraperEngine.getJob(req.params.jobId);
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

router.get("/tools/distressed/jobs", requirePin, async (_req, res) => {
  res.json([]);
});

export default router;
