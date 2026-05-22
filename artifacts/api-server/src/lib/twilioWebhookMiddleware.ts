/**
 * Reusable Twilio webhook signature validation middleware.
 *
 * Usage:
 *   router.post("/my-webhook", twilioWebhookMiddleware(), handler)
 *   router.post("/my-webhook", twilioWebhookMiddleware(specificAuthToken), handler)
 *
 * If no auth token is available (e.g., env var not set), the request is
 * allowed through with a warning — prevents lockout in misconfigured envs.
 */

import { Request, Response, NextFunction } from "express";
import twilio from "twilio";
import { logger } from "./logger";

export function twilioWebhookMiddleware(authToken?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = authToken ?? process.env.TWILIO_AUTH_TOKEN;
    if (!token) {
      logger.warn("[twilioWebhook] TWILIO_AUTH_TOKEN not set — skipping signature validation");
      next();
      return;
    }

    const twilioSig = req.headers["x-twilio-signature"] as string | undefined;
    if (!twilioSig) {
      logger.warn({ url: req.originalUrl }, "[twilioWebhook] Missing X-Twilio-Signature");
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
    const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "localhost";
    const url = `${proto}://${host}${req.originalUrl}`;
    const params = req.body as Record<string, string>;

    const valid = twilio.validateRequest(token, twilioSig, url, params);
    if (!valid) {
      logger.warn({ url: req.originalUrl }, "[twilioWebhook] Invalid X-Twilio-Signature");
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  };
}
