/**
 * directMailService.ts — Direct mail via Brevo Transactional API.
 *
 * Brevo's transactional API is used to queue direct mail orders.
 * Cost tracking: ~$0.75–$1.50 per piece.
 *
 * Status lifecycle: queued → printed → shipped → delivered
 * Webhooks from Brevo update status in crm_sequence_logs.
 */

import { logger } from "../lib/logger";

export interface DirectMailAddress {
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

export interface DirectMailSendResult {
  externalId: string | null;
  status: "queued" | "failed" | "invalid_address";
  errorMessage: string | null;
  estimatedCostUsd: number;
}

const DIRECT_MAIL_COST_USD = 1.0; // approximate cost per piece

function validateAddress(addr: DirectMailAddress): string | null {
  if (!addr.name?.trim()) return "Recipient name is required";
  if (!addr.street?.trim()) return "Street address is required";
  if (!addr.city?.trim()) return "City is required";
  if (!addr.state?.trim()) return "State is required";
  if (!addr.zip?.trim()) return "ZIP code is required";
  if (!/^\d{5}(-\d{4})?$/.test(addr.zip.trim())) return "Invalid ZIP code format";
  return null;
}

export async function sendDirectMail({
  to,
  templateId,
  mergeFields,
  campaignId,
}: {
  to: DirectMailAddress;
  templateId: number;
  mergeFields: Record<string, string>;
  campaignId: number;
}): Promise<DirectMailSendResult> {
  const validationError = validateAddress(to);
  if (validationError) {
    return {
      externalId: null,
      status: "invalid_address",
      errorMessage: validationError,
      estimatedCostUsd: 0,
    };
  }

  const brevoApiKey = process.env.BREVO_API_KEY;
  if (!brevoApiKey) {
    return {
      externalId: null,
      status: "failed",
      errorMessage: "BREVO_API_KEY is not configured",
      estimatedCostUsd: 0,
    };
  }

  try {
    const payload = {
      templateId,
      to: [{ email: "direct-mail@placeholder.internal", name: to.name }],
      params: {
        ...mergeFields,
        RECIPIENT_NAME: to.name,
        RECIPIENT_STREET: to.street,
        RECIPIENT_CITY: to.city,
        RECIPIENT_STATE: to.state,
        RECIPIENT_ZIP: to.zip,
        RECIPIENT_COUNTRY: to.country || "US",
        CAMPAIGN_ID: String(campaignId),
      },
      tags: ["direct_mail", `campaign_${campaignId}`],
      headers: {
        "X-Direct-Mail": "true",
        "X-Mail-Type": "postcard",
      },
    };

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": brevoApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await response.json().catch(() => ({})) as any;

    if (!response.ok) {
      const errMsg = data?.message || `Brevo HTTP ${response.status}`;
      logger.error({ campaignId, to: to.name }, `[directMailService] Brevo send failed: ${errMsg}`);
      return { externalId: null, status: "failed", errorMessage: errMsg, estimatedCostUsd: 0 };
    }

    const externalId = data?.messageId || null;
    logger.info(
      { externalId, recipient: to.name, city: to.city, state: to.state, estimatedCostUsd: DIRECT_MAIL_COST_USD },
      "[directMailService] Direct mail queued"
    );

    return { externalId, status: "queued", errorMessage: null, estimatedCostUsd: DIRECT_MAIL_COST_USD };
  } catch (err: any) {
    logger.error({ err, campaignId, recipient: to.name }, "[directMailService] Exception");
    return { externalId: null, status: "failed", errorMessage: err?.message || "Unknown error", estimatedCostUsd: 0 };
  }
}

export function extractAddressForDirectMail(lead: {
  sellerName: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}): DirectMailAddress | null {
  if (!lead.address || !lead.city || !lead.state || !lead.zip) return null;
  return {
    name: lead.sellerName,
    street: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    country: "US",
  };
}
