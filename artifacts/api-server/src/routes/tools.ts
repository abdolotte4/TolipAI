/**
 * Digor Tools API Routes
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "crypto";

const router: Router = Router();

function requirePin(req: Request, res: Response, next: NextFunction) {
  const toolsPin = process.env.TOOLS_PIN;
  if (!toolsPin) { res.status(503).json({ error: "TOOLS_PIN not configured" }); return; }
  const provided = req.headers["x-tools-pin"] as string | undefined;
  if (!provided || provided.trim() !== toolsPin.trim()) { res.status(403).json({ error: "Invalid PIN" }); return; }
  next();
}

router.post("/tools/auth/verify", (req, res) => {
  const toolsPin = process.env.TOOLS_PIN;
  if (!toolsPin) { res.status(503).json({ error: "TOOLS_PIN not configured" }); return; }
  const provided = req.headers["x-tools-pin"] as string | undefined;
  if (!provided || provided.trim() !== toolsPin.trim()) { res.status(403).json({ error: "Invalid PIN" }); return; }
  res.json({ success: true });
});

router.post("/tools/distressed/search", requirePin, async (req: Request, res: Response) => {
  const jobId = randomUUID();
  const { state, city, county, zip, categories } = req.body || {};
  res.json({ jobId, id: jobId, status: "queued", state, city, county, zip, categories, progress: 0 });
});

router.get("/tools/distressed/status/:jobId", requirePin, async (req: Request, res: Response) => {
  res.json({ id: req.params.jobId, status: "completed", progress: 100, result: { listings: [], counts: {} } });
});

router.get("/tools/distressed/jobs", requirePin, async (_req, res) => {
  res.json([]);
});

export default router;
