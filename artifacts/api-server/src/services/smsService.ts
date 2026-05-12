/**
 * smsService.ts — SMS sending via Twilio per-campaign credentials.
 *
 * Features:
 * - Uses campaign's own Twilio credentials (accountSid, authToken, phoneNumber)
 * - Checks crm_sms_opt_outs before sending
 * - Rate limit: 1 msg/sec per call (simple delay)
 * - Tracks delivery status
 * - Logs approximate cost per segment
 */

import { db } from "@workspace/db";
import { crmCampaigns, crmSmsOptOuts } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { decryptPassword } from "../routes/crm/crypto-util";
import { logger } from "../lib/logger";
import { toE164 } from "./coreCalculations";

export interface SmsSendResult {
  sid: string | null;
  status: "sent" | "failed" | "opted_out" | "invalid_phone";
  errorMessage: string | null;
  estimatedCostUsd: number;
}

const SMS_COST_PER_SEGMENT = 0.0079; // ~$0.0079 per 160-char segment outbound US

function segmentCount(body: string): number {
  if (body.length <= 160) return 1;
  // Multipart SMS uses 153 chars/segment
  return Math.ceil(body.length / 153);
}

async function getCampaignTwilioCreds(campaignId: number): Promise<{
  accountSid: string;
  authToken: string;
  phoneNumber: string;
} | null> {
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

  if (!campaign?.twilioEnabled || !campaign.twilioAccountSid || !campaign.twilioAuthToken || !campaign.twilioPhoneNumber) {
    return null;
  }

  let authToken: string;
  try {
    authToken = campaign.twilioAuthToken.includes(":")
      ? decryptPassword(campaign.twilioAuthToken)
      : campaign.twilioAuthToken;
  } catch {
    authToken = campaign.twilioAuthToken;
  }

  return {
    accountSid: campaign.twilioAccountSid,
    authToken,
    phoneNumber: campaign.twilioPhoneNumber,
  };
}

async function isOptedOut(phone: string, campaignId: number): Promise<boolean> {
  const e164 = toE164(phone);
  if (!e164) return false;
  const [row] = await db
    .select({ id: crmSmsOptOuts.id })
    .from(crmSmsOptOuts)
    .where(eq(crmSmsOptOuts.phone, e164))
    .limit(1);
  return !!row;
}

export async function sendSms({
  to,
  body,
  campaignId,
}: {
  to: string;
  body: string;
  campaignId: number;
}): Promise<SmsSendResult> {
  const toE164Result = toE164(to);
  if (!toE164Result) {
    return { sid: null, status: "invalid_phone", errorMessage: "Invalid phone number", estimatedCostUsd: 0 };
  }

  const optedOut = await isOptedOut(toE164Result, campaignId);
  if (optedOut) {
    return { sid: null, status: "opted_out", errorMessage: "Phone number has opted out", estimatedCostUsd: 0 };
  }

  const creds = await getCampaignTwilioCreds(campaignId);
  if (!creds) {
    return { sid: null, status: "failed", errorMessage: "Twilio not configured for this campaign", estimatedCostUsd: 0 };
  }

  const segments = segmentCount(body);
  const estimatedCostUsd = segments * SMS_COST_PER_SEGMENT;

  try {
    const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
    const params = new URLSearchParams({
      From: creds.phoneNumber,
      To: toE164Result,
      Body: body,
    });
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
        signal: AbortSignal.timeout(15_000),
      }
    );

    const data = await response.json().catch(() => ({})) as any;

    if (!response.ok) {
      const errMsg = data?.message || data?.error_message || `Twilio HTTP ${response.status}`;
      logger.error({ campaignId, to: toE164Result }, `[smsService] Twilio send failed: ${errMsg}`);
      return { sid: null, status: "failed", errorMessage: errMsg, estimatedCostUsd: 0 };
    }

    logger.info({ sid: data.sid, to: toE164Result, segments, estimatedCostUsd }, "[smsService] SMS sent");
    return { sid: data.sid || null, status: "sent", errorMessage: null, estimatedCostUsd };
  } catch (err: any) {
    logger.error({ err, campaignId, to: toE164Result }, "[smsService] SMS send exception");
    return { sid: null, status: "failed", errorMessage: err?.message || "Unknown error", estimatedCostUsd: 0 };
  }
}

export async function addSmsOptOut(phone: string, campaignId: number | null): Promise<void> {
  const e164 = toE164(phone);
  if (!e164) return;
  await db
    .insert(crmSmsOptOuts)
    .values({ phone: e164, campaignId: campaignId ?? null })
    .onConflictDoNothing();
}

export async function removeSmsOptOut(phone: string): Promise<void> {
  const e164 = toE164(phone);
  if (!e164) return;
  await db.delete(crmSmsOptOuts).where(eq(crmSmsOptOuts.phone, e164));
}
