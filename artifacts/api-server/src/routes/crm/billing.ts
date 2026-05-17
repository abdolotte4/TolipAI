import { Router } from "express";
import Stripe from "stripe";
import { db } from "@workspace/db";
import { crmCampaigns } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { crmAuth, crmAdminOnly } from "./middleware";

const router = Router();

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return new Stripe(key, { apiVersion: "2025-03-31.basil" });
}

// POST /api/crm/billing/portal
// Returns a Stripe Customer Portal session URL so the admin can manage their
// subscription, update their payment method, and download invoices.
// Requires: admin or super_admin role + a stripeCustomerId on their campaign.
router.post("/portal", crmAuth, crmAdminOnly, async (req, res) => {
  const crmUser = req.crmUser!;
  const { campaignId } = crmUser;

  if (!campaignId) {
    res.status(400).json({ error: "No campaign is associated with your account." });
    return;
  }

  try {
    const [campaign] = await db
      .select({ stripeCustomerId: crmCampaigns.stripeCustomerId })
      .from(crmCampaigns)
      .where(eq(crmCampaigns.id, campaignId))
      .limit(1);

    if (!campaign?.stripeCustomerId) {
      res.status(404).json({
        error: "No Stripe subscription found for this account. Please contact info@tolipai.com for billing support.",
      });
      return;
    }

    const stripe = getStripe();
    const origin = (req.headers.origin as string | undefined) || "https://tolipai.com";
    const returnUrl = `${origin}/crm/admin/billing`;

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: campaign.stripeCustomerId,
      return_url: returnUrl,
    });

    logger.info(
      { campaignId, customerId: campaign.stripeCustomerId },
      "[stripe/portal] customer portal session created"
    );
    res.json({ url: portalSession.url });
  } catch (err: any) {
    logger.error({ err: err.message, campaignId }, "[stripe/portal] failed to create portal session");
    res.status(500).json({ error: err.message || "Failed to create billing portal session" });
  }
});

export default router;
