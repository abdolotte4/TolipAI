import { Router } from "express";
import { EventEmitter } from "events";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger";

// ─── Shared in-process event bus ──────────────────────────────────────────────
export const crmBus = new EventEmitter();
crmBus.setMaxListeners(500);

export function emitCrmActivity(type: string, data: Record<string, unknown>): void {
  crmBus.emit("activity", type, data);
}

// ─── Short-lived SSE token store  (SEC-04 fix) ────────────────────────────────
// Problem: EventSource cannot send custom headers, so the JWT was passed as a
// URL query param — leaking a 7-day token into access logs / browser history.
//
// Fix:  clients call  POST /api/crm/auth/sse-token  with their Bearer JWT to
// receive a one-time UUID token that expires in 30 s and is deleted on first
// use.  Only this short UUID appears in the query string of the SSE URL.

interface SseTokenEntry {
  payload: { userId?: number; role?: string; campaignId?: number | null };
  expiresAt: number;
}

const sseTokenStore = new Map<string, SseTokenEntry>();
const SSE_TOKEN_TTL_MS = 30_000;
const SSE_STORE_MAX    = 500;

// Sweep expired tokens every 60 s so memory doesn't grow unbounded
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sseTokenStore) {
    if (v.expiresAt <= now) sseTokenStore.delete(k);
  }
}, 60_000).unref();

// ─── Router ───────────────────────────────────────────────────────────────────
const router = Router();

/**
 * POST /api/crm/auth/sse-token
 *
 * Requires: Authorization: Bearer <jwt>
 * Returns:  { token: "<uuid>", expiresIn: 30 }
 *
 * The returned UUID is valid for 30 seconds and is deleted on first use.
 * Pass it as  ?token=<uuid>  when opening the EventSource connection.
 */
router.post("/crm/auth/sse-token", (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const jwtToken = header.slice(7);
  const secret = process.env.JWT_SECRET;
  if (!secret) { res.status(500).end(); return; }

  let payload: SseTokenEntry["payload"];
  try {
    payload = jwt.verify(jwtToken, secret) as SseTokenEntry["payload"];
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  // Evict oldest entry when the store is at capacity
  if (sseTokenStore.size >= SSE_STORE_MAX) {
    const oldest = sseTokenStore.keys().next().value;
    if (oldest) sseTokenStore.delete(oldest);
  }

  const sseToken = randomUUID();
  sseTokenStore.set(sseToken, { payload, expiresAt: Date.now() + SSE_TOKEN_TTL_MS });

  res.json({ token: sseToken, expiresIn: 30 });
});

/**
 * GET /api/crm/events?token=<sse-token>
 *
 * Server-Sent Events stream.
 * The ?token param must be the short-lived UUID from POST /crm/auth/sse-token.
 * Tokens are single-use and expire after 30 seconds.
 */
router.get("/crm/events", (req, res) => {
  const tokenParam = req.query.token as string | undefined;
  if (!tokenParam) { res.status(401).end(); return; }

  const entry = sseTokenStore.get(tokenParam);
  if (!entry) {
    res.status(401).json({ error: "Invalid or expired SSE token" });
    return;
  }
  if (Date.now() > entry.expiresAt) {
    sseTokenStore.delete(tokenParam);
    res.status(401).json({ error: "SSE token expired" });
    return;
  }
  // Single-use: delete immediately on first connection
  sseTokenStore.delete(tokenParam);
  const payload = entry.payload;

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const write = (event: string, data: unknown) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { }
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
