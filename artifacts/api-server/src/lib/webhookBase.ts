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
 *
 * NOTE: API_BASE_URL already includes the /api path prefix
 * (e.g. https://tolipai.com/api). Never append /api after calling this.
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

/**
 * Reconstructs the exact public URL that Twilio signed for signature validation.
 *
 * Why this exists: API_BASE_URL (e.g. https://tolipai.com/api) already contains
 * the /api path prefix. Express mounts routes at /api, so req.originalUrl also
 * starts with /api (e.g. /api/twilio/voice/answer). Naively concatenating them
 * would produce https://tolipai.com/api/api/twilio/voice/answer — a double /api
 * that causes every signature check to fail with 403.
 *
 * This function strips the duplicate prefix before building the final URL.
 *
 * Use this ONLY for Twilio signature validation (where you need req.originalUrl).
 * Use getWebhookBase() for building callback URLs passed to Twilio.
 */
export function buildTwilioWebhookUrl(req: Request): string {
  if (process.env.API_BASE_URL) {
    const base = process.env.API_BASE_URL.replace(/\/+$/, "");
    try {
      const basePath = new URL(base).pathname.replace(/\/+$/, ""); // e.g. "/api"
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
