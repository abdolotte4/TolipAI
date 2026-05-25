import type { Request } from "express";

/**
 * Returns the correct HTTPS base URL for Twilio webhook callbacks.
 *
 * Priority order:
 * 1. REPLIT_DEV_DOMAIN — set automatically by Replit; ensures dev webhooks
 *    route back to this Replit container, not Railway.
 * 2. API_BASE_URL env var — set in Railway/production.
 *    e.g. API_BASE_URL=https://tolip-production.up.railway.app/api
 * 3. x-forwarded-host header — set by Railway / Replit proxies.
 * 4. Host header — local dev fallback.
 */
export function getWebhookBase(req: Request): string {
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
  }
  if (process.env.API_BASE_URL) {
    return process.env.API_BASE_URL.replace(/\/+$/, "");
  }
  const fwdHost = (req.headers["x-forwarded-host"] as string | undefined)
    ?.split(",")[0]
    ?.trim();
  const host =
    fwdHost ||
    req.headers.host ||
    "localhost:3000";
  return `https://${host.replace(/:\d+$/, "")}/api`;
}
