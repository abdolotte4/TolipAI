import { Router } from "express";
import Stripe from "stripe";
import { db } from "@workspace/db";
import { crmCampaigns } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { crmAuth, crmAdminOnly } from "./middleware";

export interface SubscriptionStatus {
  configured: boolean;
  status?: string;
  planName?: string;
  amount?: number | null;
  currency?: string;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
}

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

// GET /api/crm/billing/subscription
// Returns live Stripe subscription details (plan name, status, next billing date).
// Returns { configured: false } gracefully when Stripe is not set up or the
// campaign has no stripeCustomerId — never throws to the client.
router.get("/subscription", crmAuth, crmAdminOnly, async (req, res) => {
  const { campaignId } = req.crmUser!;

  if (!campaignId || !process.env.STRIPE_SECRET_KEY) {
    res.json({ configured: false } satisfies SubscriptionStatus);
    return;
  }

  try {
    const [campaign] = await db
      .select({ stripeCustomerId: crmCampaigns.stripeCustomerId })
      .from(crmCampaigns)
      .where(eq(crmCampaigns.id, campaignId))
      .limit(1);

    if (!campaign?.stripeCustomerId) {
      res.json({ configured: false } satisfies SubscriptionStatus);
      return;
    }

    const stripe = getStripe();
    const subs = await stripe.subscriptions.list({
      customer: campaign.stripeCustomerId,
      status: "all",
      limit: 1,
      expand: ["data.items.data.price.product"],
    });

    const sub = subs.data[0];
    if (!sub) {
      res.json({ configured: false } satisfies SubscriptionStatus);
      return;
    }

    const item = sub.items.data[0];
    const price = item?.price as Stripe.Price & { product?: Stripe.Product };
    const product = typeof price?.product === "object" ? price.product : null;

    res.json({
      configured: true,
      status: sub.status,
      planName: product?.name ?? (price as any)?.nickname ?? "TolipAI CRM",
      amount: price?.unit_amount != null ? price.unit_amount / 100 : null,
      currency: price?.currency ?? "usd",
      currentPeriodEnd: sub.current_period_end,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    } satisfies SubscriptionStatus);
  } catch (err: any) {
    logger.error({ err: err.message, campaignId }, "[stripe/subscription] failed to fetch");
    res.json({ configured: false } satisfies SubscriptionStatus);
  }
});

export default router;
