import type { Request } from "express";

/**
 * Returns the correct HTTPS base URL for Twilio webhook callbacks.
 * Always derived from the incoming request host so it works correctly
 * in every environment (Replit dev, Railway prod, local) without relying
 * on the API_BASE_URL env var, which points to a specific deployment and
 * would route Twilio callbacks to the wrong server if you're testing in dev.
 */
export function getWebhookBase(req: Request): string {
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
