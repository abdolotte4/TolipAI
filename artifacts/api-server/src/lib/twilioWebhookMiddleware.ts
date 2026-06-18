/**
 * Reusable Twilio webhook signature validation middleware.
 *
 * Usage:
 *   router.post("/my-webhook", twilioWebhookMiddleware(), handler)
 *   router.post("/my-webhook", twilioWebhookMiddleware(specificAuthToken), handler)
 *
 * URL reconstruction priority:
 *   1. API_BASE_URL env var (set to https://tolipai.com/api in production).
 *      IMPORTANT: API_BASE_URL already contains the /api path prefix. req.originalUrl
 *      also starts with /api (e.g. /api/twilio/voice/answer). buildWebhookUrl() strips
 *      the duplicate prefix before appending, producing the correct URL for validation.
 *   2. x-forwarded-proto + x-forwarded-host headers (fallback for local dev)
 *   3. req.protocol + req.headers.host (last resort)
 *
 * Using headers alone is unreliable behind Railway/Replit proxies where
 * x-forwarded-host may carry an internal hostname instead of the public one,
 * causing Twilio signature validation to fail with 403.
 *
 * Multi-campaign support:
 *   When no explicit authToken is passed the middleware tries (in order):
 *   1. Global TWILIO_AUTH_TOKEN env var
 *   2. All campaign auth tokens from the DB (decrypted)
 *   This allows each campaign admin to use their own Twilio account without
 *   needing a shared global token, and fixes 403s on /voice/inbound and
 *   /voice/call-status where Twilio signs with the campaign-specific token.
 */

import { Request, Response, NextFunction } from "express";
import twilio from "twilio";
import { logger } from "./logger";

function buildWebhookUrl(req: Request): string {
  if (process.env.API_BASE_URL) {
    const base = process.env.API_BASE_URL.replace(/\/+$/, ""); // e.g. "https://tolipai.com/api"
    // req.originalUrl already starts with the same path prefix (e.g. /api/twilio/voice/answer).
    // Extract that prefix so we don't double it: strip the pathname of API_BASE_URL from
    // the front of req.originalUrl before re-appending it.
    try {
      const basePath = new URL(base).pathname.replace(/\/+$/, ""); // "/api"
      const reqPath = basePath && req.originalUrl.startsWith(basePath)
        ? req.originalUrl.slice(basePath.length)
        : req.originalUrl;
      return `${base}${reqPath}`;
    } catch {
      return `${base}${req.originalUrl}`;
    }
  }
  // Fallback for local dev (no API_BASE_URL set)
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0].trim() || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string)?.split(",")[0].trim() || req.headers.host || "localhost";
  return `${proto}://${host}${req.originalUrl}`;
}

export function twilioWebhookMiddleware(authToken?: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const twilioSig = req.headers["x-twilio-signature"] as string | undefined;
    if (!twilioSig) {
      logger.warn({ url: req.originalUrl }, "[twilioWebhook] Missing X-Twilio-Signature");
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const url = buildWebhookUrl(req);
    const params = req.body as Record<string, string>;

    // ── 1. Explicit token (when middleware is instantiated with a specific token) ──
    if (authToken) {
      if (twilio.validateRequest(authToken, twilioSig, url, params)) {
        next();
        return;
      }
      logger.warn({ url }, "[twilioWebhook] Invalid X-Twilio-Signature (explicit token)");
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // ── 2. Global TWILIO_AUTH_TOKEN env var (fast path) ────────────────────────
    const globalToken = process.env.TWILIO_AUTH_TOKEN;
    if (globalToken && twilio.validateRequest(globalToken, twilioSig, url, params)) {
      next();
      return;
    }

    // ── 3. Campaign-specific auth tokens from DB ────────────────────────────────
    // Each campaign admin stores their own Twilio auth token. Twilio signs
    // inbound webhooks with THAT campaign's token, so we must try all of them
    // when the global token doesn't match (or isn't set).
    try {
      const { db } = await import("@workspace/db");
      const { crmCampaigns } = await import("@workspace/db/schema");
      const { isNotNull } = await import("drizzle-orm");
      const { decryptPassword } = await import("../routes/crm/crypto-util");

      const campaigns = await db
        .select({ twilioAuthToken: crmCampaigns.twilioAuthToken })
        .from(crmCampaigns)
        .where(isNotNull(crmCampaigns.twilioAuthToken));

      for (const camp of campaigns) {
        if (!camp.twilioAuthToken) continue;
        try {
          const token = camp.twilioAuthToken.includes(":")
            ? decryptPassword(camp.twilioAuthToken)
            : camp.twilioAuthToken;
          if (twilio.validateRequest(token, twilioSig, url, params)) {
            next();
            return;
          }
        } catch {
          // Decryption failed for this campaign (e.g. different ENCRYPTION_KEY) — skip
        }
      }
    } catch (dbErr) {
      logger.warn({ err: dbErr }, "[twilioWebhook] DB lookup for campaign auth token failed");
    }

    // ── All tokens exhausted ────────────────────────────────────────────────────
    if (!globalToken) {
      logger.error(
        { url },
        "[twilioWebhook] TWILIO_AUTH_TOKEN not set and no campaign token matched — refusing request"
      );
    } else {
      logger.warn({ url }, "[twilioWebhook] Invalid X-Twilio-Signature — no token matched");
    }
    res.status(403).json({ error: "Forbidden" });
  };
}
