/**
 * Reusable Twilio webhook signature validation middleware.
 *
 * Usage:
 *   router.post("/my-webhook", twilioWebhookMiddleware(), handler)
 *   router.post("/my-webhook", twilioWebhookMiddleware(specificAuthToken), handler)
 *
 * URL reconstruction priority:
 *   1. API_BASE_URL env var (always correct in production — set to https://tolipai.com)
 *   2. x-forwarded-proto + x-forwarded-host headers (fallback for local dev)
 *   3. req.protocol + req.headers.host (last resort)
 *
 * Using headers alone is unreliable behind Railway/Replit proxies where
 * x-forwarded-host may carry an internal hostname instead of the public one,
 * causing Twilio signature validation to fail with 403.
 */

import { Request, Response, NextFunction } from "express";
import twilio from "twilio";
import { logger } from "./logger";

export function twilioWebhookMiddleware(authToken?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = authToken ?? process.env.TWILIO_AUTH_TOKEN;
    if (!token) {
      logger.error("[twilioWebhook] TWILIO_AUTH_TOKEN not set — refusing request (hard-fail)");
      res.status(500).json({ error: "Server misconfiguration: webhook validation unavailable" });
      return;
    }

    const twilioSig = req.headers["x-twilio-signature"] as string | undefined;
    if (!twilioSig) {
      logger.warn({ url: req.originalUrl }, "[twilioWebhook] Missing X-Twilio-Signature");
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Build the canonical webhook URL.
    // API_BASE_URL (e.g. "https://tolipai.com") is the authoritative source in
    // production — it is what's configured in the Twilio console and what Twilio
    // uses when computing the HMAC signature. Fall back to forwarded headers only
    // in local dev where API_BASE_URL is typically not set.
    const apiBase = process.env.API_BASE_URL?.replace(/\/$/, "")
      ?? (() => {
        const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0].trim() || req.protocol || "https";
        const host = (req.headers["x-forwarded-host"] as string)?.split(",")[0].trim() || req.headers.host || "localhost";
        return `${proto}://${host}`;
      })();

    const url = `${apiBase}${req.originalUrl}`;
    const params = req.body as Record<string, string>;

    const valid = twilio.validateRequest(token, twilioSig, url, params);
    if (!valid) {
      logger.warn({ url, originalUrl: req.originalUrl }, "[twilioWebhook] Invalid X-Twilio-Signature");
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  };
}
