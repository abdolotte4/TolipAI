import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import express from "express";
import Stripe from "stripe";
import jwt from "jsonwebtoken";
import { logger } from "../lib/logger";

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET not set");
    jwt.verify(auth.slice(7), secret);
    next();
  } catch { res.status(401).json({ error: "Invalid or expired token" }); }
}

const router: IRouter = Router();

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return new Stripe(key, { apiVersion: "2025-03-31.basil" });
}

const FULL_PRICE_ID = "price_1TJLsdIRQyNh8s19OjY6WyAH";
const HALF_PRICE_ID = "price_1TJLsdIRQyNh8s19y3Fhwjih";
const PERFORMANCE_PRICE_ID = "price_1TJR0HIRQyNh8s19lwWYhofS";

router.post("/stripe/checkout", async (req: Request, res: Response) => {
  try {
    const stripe = getStripe();
    const { priceId, email, name, company, agreedToTerms } = req.body;

    if (!agreedToTerms) {
      res.status(400).json({ error: "You must agree to the Terms of Service to proceed." });
      return;
    }

    if (!email || !name) {
      res.status(400).json({ error: "Name and email are required." });
      return;
    }

    const allowedPrices = [FULL_PRICE_ID, HALF_PRICE_ID, PERFORMANCE_PRICE_ID];
    const resolvedPriceId = allowedPrices.includes(priceId) ? priceId : FULL_PRICE_ID;

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const tosUrl = "https://tolipai.com/terms-of-service";
    const tosAcceptedAt = new Date().toISOString();
    const tosAcceptedIp =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() ||
      req.ip ||
      "unknown";

    const customer = await stripe.customers.create({
      email,
      name,
      metadata: {
        company: company || "",
        tosAccepted: "true",
        tosAcceptedAt,
        tosAcceptedIp,
        tosUrl,
        tosVersion: "2026-04-06",
      },
    });

    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      payment_method_types: ["card"],
      line_items: [{ price: resolvedPriceId, quantity: 1 }],
      mode: "subscription",
      billing_address_collection: "required",
      success_url: `${origin}/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
      subscription_data: {
        metadata: {
          customerName: name,
          customerEmail: email,
          company: company || "",
          tosAccepted: "true",
          tosAcceptedAt,
          tosAcceptedIp,
          tosUrl,
          tosVersion: "2026-04-06",
        },
      },
      metadata: {
        customerName: name,
        customerEmail: email,
        company: company || "",
        tosAccepted: "true",
        tosAcceptedAt,
        tosAcceptedIp,
        tosUrl,
        tosVersion: "2026-04-06",
      },
      consent_collection: {
        terms_of_service: "required",
      },
      custom_text: {
        terms_of_service_acceptance: {
          message: `By subscribing, you authorize TolipAI LLC to charge you until you cancel. Service is non-refundable. For billing inquiries or technical support, contact info@tolipai.com within 3 days of a charge. Full terms: [Terms of Service](${tosUrl}).`,
        },
      },
    });

    res.json({ url: session.url });
  } catch (err: any) {
    logger.error({ err: err.message }, "Stripe checkout error");
    res.status(500).json({ error: err.message || "Failed to create checkout session" });
  }
});

router.get("/stripe/session/:sessionId", async (req: Request, res: Response) => {
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId as string, {
      expand: ["subscription", "customer"],
    });
    res.json({ session });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const PRICE_LABELS: Record<string, { label: string; amount: string }> = {
  "price_1TJLsdIRQyNh8s19OjY6WyAH": { label: "Full Package", amount: "$1,500/mo" },
  "price_1TJLsdIRQyNh8s19y3Fhwjih": { label: "Half Package", amount: "$750/mo" },
  "price_1TJR0HIRQyNh8s19lwWYhofS": { label: "Growth Infrastructure", amount: "$1,000/mo" },
};

router.get("/stripe/subscriptions", authMiddleware, async (req: Request, res: Response) => {
  try {
    const stripe = getStripe();

    const subscriptions = await stripe.subscriptions.list({
      limit: 100,
      expand: ["data.customer"],
      status: "all",
    });

    const result = subscriptions.data.map((sub) => {
      const customer = sub.customer as Stripe.Customer;
      const item = sub.items.data[0];
      const priceId = item?.price?.id || "";
      const planInfo = PRICE_LABELS[priceId] || { label: "Unknown Plan", amount: "—" };

      const meta = sub.metadata || {};
      const custMeta = customer.metadata || {};

      return {
        id: sub.id,
        customerId: customer.id,
        name: meta.customerName || custMeta.customerName || customer.name || "—",
        email: meta.customerEmail || custMeta.customerEmail || customer.email || "—",
        company: meta.company || custMeta.company || "—",
        planLabel: planInfo.label,
        planAmount: planInfo.amount,
        priceId,
        status: sub.status,
        currentPeriodStart: new Date(((sub as unknown as Record<string, number>).current_period_start ?? 0) * 1000).toISOString(),
        currentPeriodEnd: new Date(((sub as unknown as Record<string, number>).current_period_end ?? 0) * 1000).toISOString(),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        createdAt: new Date(sub.created * 1000).toISOString(),
        stripeUrl: `https://dashboard.stripe.com/customers/${customer.id}`,
        tosAccepted: meta.tosAccepted === "true" || custMeta.tosAccepted === "true",
        tosAcceptedAt: meta.tosAcceptedAt || custMeta.tosAcceptedAt || null,
      };
    });

    res.json({ subscriptions: result, total: result.length });
  } catch (err: any) {
    logger.error({ err: err.message }, "Stripe subscriptions fetch error");
    res.status(500).json({ error: err.message || "Failed to fetch subscriptions" });
  }
});

// ── POST /api/stripe/webhook ──────────────────────────────────────────────────
// Stripe sends events here for subscription lifecycle management.
// Requires STRIPE_WEBHOOK_SECRET env var (from Stripe dashboard → Webhooks).
// The route uses express.raw() so the raw body is available for sig verification.

router.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      logger.warn("STRIPE_WEBHOOK_SECRET not set — webhook ignored");
      res.status(200).json({ received: true });
      return;
    }

    const sig = req.headers["stripe-signature"] as string | undefined;
    if (!sig) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    let event: Stripe.Event;
    try {
      const stripe = getStripe();
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
    } catch (err: any) {
      logger.warn({ err: err.message }, "Stripe webhook signature verification failed");
      res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
      return;
    }

    // Always acknowledge quickly so Stripe doesn't retry
    res.status(200).json({ received: true });

    // Process the event asynchronously
    try {
      switch (event.type) {
        case "customer.subscription.created":
        case "customer.subscription.updated": {
          const sub = event.data.object as Stripe.Subscription;
          logger.info(
            { subscriptionId: sub.id, status: sub.status, customerId: sub.customer },
            `[stripe webhook] subscription ${event.type}`
          );
          break;
        }
        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;
          logger.info(
            { subscriptionId: sub.id, customerId: sub.customer },
            "[stripe webhook] subscription cancelled/deleted"
          );
          break;
        }
        case "invoice.payment_succeeded": {
          const inv = event.data.object as Stripe.Invoice;
          logger.info(
            { invoiceId: inv.id, customerId: inv.customer, amount: inv.amount_paid },
            "[stripe webhook] invoice payment succeeded"
          );
          break;
        }
        case "invoice.payment_failed": {
          const inv = event.data.object as Stripe.Invoice;
          logger.warn(
            { invoiceId: inv.id, customerId: inv.customer, amount: inv.amount_due },
            "[stripe webhook] invoice payment FAILED"
          );
          break;
        }
        default:
          logger.info({ type: event.type }, "[stripe webhook] unhandled event type");
      }
    } catch (err) {
      logger.error(err, "[stripe webhook] error processing event");
    }
  }
);

export default router;
