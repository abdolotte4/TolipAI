/**
 * twilioCredentials.ts — Single source of truth for fetching and decrypting
 * per-campaign Twilio credentials from the database.
 *
 * Previously the same fetch-decrypt pattern was duplicated across:
 *   routes/twilio.ts              (getCampaignTwilioCreds / getGlobalSmsCreds / resolveTwilioCreds)
 *   routes/twilio-voice.ts        (getCampaignVoiceConfig / getGlobalVoiceConfig / resolveVoiceConfig)
 *   services/smsService.ts        (getCampaignTwilioCreds)
 *   routes/twilio-power-dialer.ts (getTwilioCreds)
 *   routes/twilio-voice-agent.ts  (inline sendConfirmationSms)
 *
 * Export surface:
 *   getSmsCreds(campaignId, opts?)   — per-campaign SMS creds or null
 *   resolveSmsCreds(campaignId, isSuperAdmin) — throws 422 if unavailable
 *   getGlobalSmsCreds()              — reads TWILIO_* env vars for SMS
 *   getVoiceConfig(campaignId)       — per-campaign Voice (API-Key) config or null
 *   resolveVoiceConfig(campaignId, isSuperAdmin) — throws 422 if unavailable
 *   getGlobalVoiceConfig()           — reads TWILIO_* env vars for Voice
 */

import { db } from "@workspace/db";
import { crmCampaigns } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { decryptPassword } from "../routes/crm/crypto-util";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TwilioSmsCreds {
  accountSid: string;
  authToken: string;
  phoneNumber: string | null;
}

export interface TwilioVoiceConfig {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  appSid: string;
  callerId: string | null;
}

// ── Internal ─────────────────────────────────────────────────────────────────

function safeDec(enc: string): string {
  try {
    return enc.includes(":") ? decryptPassword(enc) : enc;
  } catch {
    return enc;
  }
}

// ── Global env-var fallbacks ─────────────────────────────────────────────────

export function getGlobalSmsCreds(): TwilioSmsCreds | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  return { accountSid, authToken, phoneNumber: process.env.TWILIO_VOICE_CALLER_ID || null };
}

export function getGlobalVoiceConfig(): TwilioVoiceConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  const appSid = process.env.TWILIO_VOICE_APP_SID;
  if (!accountSid || !apiKeySid || !apiKeySecret || !appSid) return null;
  return { accountSid, apiKeySid, apiKeySecret, appSid, callerId: process.env.TWILIO_VOICE_CALLER_ID || null };
}

// ── Per-campaign helpers ──────────────────────────────────────────────────────

/**
 * Fetch and decrypt per-campaign SMS credentials from the DB.
 *
 * @param requireEnabled  When true, returns null if campaign.twilioEnabled is
 *                        false — used by background jobs (smsService) to
 *                        respect the admin's on/off toggle.
 */
export async function getSmsCreds(
  campaignId: number,
  opts: { requireEnabled?: boolean } = {}
): Promise<TwilioSmsCreds | null> {
  const [campaign] = await db
    .select({
      twilioAccountSid: crmCampaigns.twilioAccountSid,
      twilioAuthToken: crmCampaigns.twilioAuthToken,
      twilioPhoneNumber: crmCampaigns.twilioPhoneNumber,
      twilioEnabled: crmCampaigns.twilioEnabled,
    })
    .from(crmCampaigns)
    .where(eq(crmCampaigns.id, campaignId))
    .limit(1);

  if (!campaign) return null;
  if (opts.requireEnabled && !campaign.twilioEnabled) return null;
  if (!campaign.twilioAccountSid || !campaign.twilioAuthToken) return null;

  return {
    accountSid: campaign.twilioAccountSid,
    authToken: safeDec(campaign.twilioAuthToken),
    phoneNumber: campaign.twilioPhoneNumber || null,
  };
}

/**
 * Resolve SMS credentials for a request context.
 * 1. Campaign creds when campaignId is provided and configured (throws 422 if not configured).
 * 2. Global env-var creds for super_admin with no campaign (throws 422 if env vars absent).
 * 3. Throws 422 if neither applies.
 */
export async function resolveSmsCreds(
  campaignId: number | null,
  isSuperAdmin: boolean
): Promise<TwilioSmsCreds> {
  if (campaignId) {
    const creds = await getSmsCreds(campaignId);
    if (creds) return creds;
    throw Object.assign(
      new Error("Twilio is not configured for this campaign. Go to Campaign Settings → Twilio to add your credentials."),
      { status: 422 }
    );
  }
  if (isSuperAdmin) {
    const global = getGlobalSmsCreds();
    if (global) return global;
    throw Object.assign(
      new Error("No global Twilio credentials configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables."),
      { status: 422 }
    );
  }
  throw Object.assign(
    new Error("No campaign assigned. Ask your admin to assign you to a campaign with Twilio configured."),
    { status: 422 }
  );
}

/**
 * Fetch and decrypt per-campaign Voice (API Key) credentials from the DB.
 * Returns null if any required field (accountSid, apiKeySid, apiKeySecret, appSid) is missing.
 */
export async function getVoiceConfig(campaignId: number): Promise<TwilioVoiceConfig | null> {
  const [campaign] = await db
    .select({
      twilioAccountSid: crmCampaigns.twilioAccountSid,
      twilioApiKeySid: crmCampaigns.twilioApiKeySid,
      twilioApiKeySecret: crmCampaigns.twilioApiKeySecret,
      twilioVoiceAppSid: crmCampaigns.twilioVoiceAppSid,
      twilioPhoneNumber: crmCampaigns.twilioPhoneNumber,
    })
    .from(crmCampaigns)
    .where(eq(crmCampaigns.id, campaignId))
    .limit(1);

  if (!campaign) return null;
  if (!campaign.twilioAccountSid || !campaign.twilioApiKeySid || !campaign.twilioApiKeySecret || !campaign.twilioVoiceAppSid) return null;

  return {
    accountSid: campaign.twilioAccountSid,
    apiKeySid: campaign.twilioApiKeySid,
    apiKeySecret: safeDec(campaign.twilioApiKeySecret),
    appSid: campaign.twilioVoiceAppSid,
    callerId: campaign.twilioPhoneNumber || null,
  };
}

/**
 * Resolve Voice (API Key) credentials for a request context.
 * 1. Campaign creds if campaignId is set and fully configured.
 * 2. Global env-var creds for super_admin.
 * 3. Throws 422 otherwise.
 */
export async function resolveVoiceConfig(
  campaignId: number | null,
  isSuperAdmin: boolean
): Promise<TwilioVoiceConfig> {
  if (campaignId) {
    const cfg = await getVoiceConfig(campaignId);
    if (cfg) return cfg;
  }
  if (isSuperAdmin) {
    const global = getGlobalVoiceConfig();
    if (global) return global;
  }
  throw Object.assign(
    new Error(
      campaignId
        ? "Twilio Voice is not fully configured for this campaign. Set API Key SID, API Key Secret, and TwiML App SID in Campaign → Twilio settings."
        : "Twilio Voice is not configured. Ask your admin to set up Twilio credentials."
    ),
    { status: 422 }
  );
}
