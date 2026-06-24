import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import * as ZodSchemas from "@workspace/api-zod";
const { SubmitSubscribeBody, SubmitSubscribeResponse } = ZodSchemas;
import { db, subscribersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const _rlMap = new Map<string, { count: number; resetAt: number }>();
function subscribeRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.ip || "unknown";
  const now = Date.now();
  const entry = _rlMap.get(ip);
  if (!entry || now > entry.resetAt) { _rlMap.set(ip, { count: 1, resetAt: now + 3_600_000 }); return next(); }
  if (entry.count >= 3) { res.status(429).json({ error: "Too many requests. Please try again later." }); return; }
  entry.count++;
  next();
}
setInterval(() => { const now = Date.now(); for (const [k, v] of _rlMap) if (now > v.resetAt) _rlMap.delete(k); }, 30 * 60 * 1000);

const router: IRouter = Router();

async function sendViaBrevo(payload: object): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return false;
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

router.post("/subscribe", subscribeRateLimit, async (req, res) => {
  const parseResult = SubmitSubscribeBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid request data." });
    return;
  }

  const { name, email, company, plan } = parseResult.data;

  // Check for existing subscriber
  try {
    const existing = await db.select().from(subscribersTable).where(eq(subscribersTable.email, email)).limit(1);
    if (existing.length === 0) {
      await db.insert(subscribersTable).values({ name, email, company, plan: plan || "basic", status: "pending" });
    }
  } catch (err) {
    req.log.error({ err }, "Failed to save subscriber");
  }

  // Notify admin via Brevo
  const senderEmail = process.env.BREVO_SENDER_EMAIL || "info@tolipai.com";
  try {
    await sendViaBrevo({
      sender: { name: "TolipAI Website", email: senderEmail },
      to: [{ email: "info@tolipai.com", name: "TolipAI Info" }],
      cc: [{ email: "hello@tolipai.com" }, { email: "martin@tolipai.com" }],
      replyTo: { email },
      subject: `New Subscription Intent: ${name} — Basic Plan ($1,500/mo)`,
      htmlContent: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <div style="background:#0a0e1a;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
            <h1 style="color:#7367F0;margin:0;">Tolip Group LLC</h1>
            <p style="color:#aaa;margin:8px 0 0;">New Subscription Intent</p>
          </div>
          <div style="background:#fff;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;">
            <h2>Subscription Request: Basic Plan — $1,500/month</h2>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:8px 0;font-weight:bold;color:#555;width:120px;">Name:</td><td>${name}</td></tr>
              <tr><td style="padding:8px 0;font-weight:bold;color:#555;">Email:</td><td><a href="mailto:${email}">${email}</a></td></tr>
              <tr><td style="padding:8px 0;font-weight:bold;color:#555;">Company:</td><td>${company || "Not provided"}</td></tr>
              <tr><td style="padding:8px 0;font-weight:bold;color:#555;">Plan:</td><td>Basic — $1,500/month</td></tr>
            </table>
            <p style="margin-top:16px;color:#888;font-size:12px;">This subscriber is pending payment setup. Follow up to complete onboarding.</p>
          </div>
        </div>
      `,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to send subscriber notification email");
  }

  res.json(SubmitSubscribeResponse.parse({
    success: true,
    message: "Your subscription interest has been recorded. Our team will contact you shortly to complete onboarding.",
  }));
});

export default router;
