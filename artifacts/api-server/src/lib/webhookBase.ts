import type { Request } from "express";

/**
 * Returns the correct HTTPS base URL for Twilio webhook callbacks.
 *
 * Priority order:
 * 1. API_BASE_URL env var — set this in Railway to your production domain
 *    e.g. API_BASE_URL=https://heroic-curiosity-production-dc5a.up.railway.app/api
 *    This guarantees Twilio always calls back the correct server no matter
 *    which environment originally configured the TwiML App.
 * 2. x-forwarded-host header — set by Railway / Replit proxies.
 * 3. Host header — local dev fallback.
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
    process.env.REPLIT_DEV_DOMAIN ||
    "localhost:8080";
  return `https://${host.replace(/:\d+$/, "")}/api`;
}
