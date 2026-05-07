import { Router, type IRouter } from "express";
import * as ZodSchemas from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
const { HealthCheckResponse } = ZodSchemas;

const router: IRouter = Router();

// Shallow liveness probe — no dependencies (used by load-balancer keep-alive)
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Deep readiness probe — verifies DB connectivity
router.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch (err) {
    logger.error({ err }, "Health check: DB ping failed");
    res.status(503).json({ status: "error", detail: "database unavailable" });
  }
});

export default router;
