import type { Request } from "express";

/**
 * Returns the correct HTTPS base URL for Twilio webhook callbacks.
 *
 * Priority order:
 * 1. API_BASE_URL — set in production (e.g. https://tolipai.com/api).
 *    Always preferred so Twilio webhooks reach the production server.
 * 2. x-forwarded-host header — set by Railway / reverse-proxy.
 * 3. Host header — last-resort local dev fallback.
 *
 * REPLIT_DEV_DOMAIN is intentionally NOT used — production always runs
 * behind tolipai.com and REPLIT_DEV_DOMAIN must never override API_BASE_URL.
 */
export function getWebhookBase(req: Request): string {
  if (process.env.API_BASE_URL) {
    return process.env.API_BASE_URL.replace(/\/+$/, "");
  }
  const fwdHost = (req.headers["x-forwarded-host"] as string | undefined)
    ?.split(",")[0]
    ?.trim();
  const host =
    fwdHost ||
    req.headers.host ||
    "localhost:5000";
  return `https://${host.replace(/:\d+$/, "")}/api`;
}
