import type { Request } from "express";

/**
 * Returns the correct HTTPS base URL for Twilio webhook callbacks.
 *
 * Priority order:
 * 1. API_BASE_URL — set in Railway/production (e.g. https://tolip-production.up.railway.app/api).
 *    This is always preferred when available so Twilio webhooks reach the production server.
 * 2. REPLIT_DEV_DOMAIN — set automatically by Replit; used only when API_BASE_URL is absent
 *    (pure local dev with no Railway deployment).
 * 3. x-forwarded-host header — set by Railway / Replit proxies.
 * 4. Host header — last-resort local dev fallback.
 */
export function getWebhookBase(req: Request): string {
  if (process.env.API_BASE_URL) {
    return process.env.API_BASE_URL.replace(/\/+$/, "");
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
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
