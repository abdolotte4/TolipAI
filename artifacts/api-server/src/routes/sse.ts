import { Router } from "express";
import { EventEmitter } from "events";
import jwt from "jsonwebtoken";
import { logger } from "../lib/logger";

// ─── Shared in-process event bus ──────────────────────────────────────────────
// Import `crmBus` in any route file and call `emitCrmActivity(type, data)` to
// push real-time events to all connected CRM clients.

export const crmBus = new EventEmitter();
crmBus.setMaxListeners(500);

export function emitCrmActivity(type: string, data: Record<string, unknown>): void {
  crmBus.emit("activity", type, data);
}

// ─── GET /api/crm/events?token=<jwt> ──────────────────────────────────────────
// Server-Sent Events stream.  EventSource doesn't support custom headers so we
// accept the JWT via the `token` query-param (falls back to Authorization header
// when the same origin can set it).

const router = Router();

router.get("/crm/events", (req, res) => {
  const token =
    (req.query.token as string) ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : "");

  if (!token) { res.status(401).end(); return; }

  const secret = process.env.JWT_SECRET;
  if (!secret) { res.status(500).end(); return; }

  let payload: { userId?: number; role?: string; campaignId?: number | null };
  try {
    payload = jwt.verify(token, secret) as any;
  } catch {
    res.status(401).end();
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const write = (event: string, data: unknown) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch { }
  };

  write("connected", { ts: Date.now() });

  const ping = setInterval(() => {
    try { res.write(":ping\n\n"); } catch { clearInterval(ping); }
  }, 25_000);

  const listener = (type: string, data: any) => {
    if (
      payload.role === "super_admin" ||
      data.campaignId == null ||
      data.campaignId === payload.campaignId
    ) {
      write(type, data);
    }
  };

  crmBus.on("activity", listener);

  req.on("close", () => {
    clearInterval(ping);
    crmBus.off("activity", listener);
    logger.debug({ userId: payload.userId }, "[sse] client disconnected");
  });
});

export default router;
