import { Router } from "express";
import { db } from "@workspace/db";
import { crmContracts, crmLeads, crmCampaigns } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import crypto from "crypto";
import { crmAuth } from "./middleware";
import * as DropboxSign from "@dropbox/sign";
import type { RequestFile } from "@dropbox/sign";
import { logger } from "../../lib/logger";

const router = Router();

// ── Dropbox Sign (HelloSign) helper ──────────────────────────────────────────
// Returns true when the env var is present — auto-upgrades to certified e-sigs.
function getDropboxSignClient(): DropboxSign.SignatureRequestApi | null {
  const apiKey = process.env.DROPBOX_SIGN_API_KEY;
  if (!apiKey) return null;
  const client = new DropboxSign.SignatureRequestApi();
  client.username = apiKey;
  return client;
}

interface DropboxResult {
  signatureRequestId: string;
  signingUrl: string | null;
  provider: "dropbox_sign";
}

async function sendViaDropboxSign(opts: {
  sellerName: string;
  sellerEmail: string;
  propertyAddress: string;
  contractType: string;
  documentHtml: string;
  contractId: number;
}): Promise<DropboxResult | null> {
  const client = getDropboxSignClient();
  if (!client) return null;

  const isTest = process.env.NODE_ENV !== "production";
  const htmlBuffer = Buffer.from(opts.documentHtml, "utf-8");
  const title = opts.contractType === "assignment"
    ? `Assignment of Contract — ${opts.propertyAddress}`
    : `Purchase Agreement — ${opts.propertyAddress}`;

  try {
    const sendData: DropboxSign.SignatureRequestSendRequest = {
      title,
      subject: `Please sign: ${title}`,
      message: `Hi ${opts.sellerName}, please review and sign the purchase agreement for your property at ${opts.propertyAddress}. This is a legally binding document — please read carefully before signing.`,
      signers: [{ name: opts.sellerName, emailAddress: opts.sellerEmail, order: 0 }],
      files: [htmlBuffer as unknown as RequestFile],
      metadata: { contractId: String(opts.contractId), source: "TolipAI CRM" },
      testMode: isTest,
    };
    const resp = await client.signatureRequestSend(sendData);

    const sigReq = resp.body.signatureRequest;
    const signingUrl = sigReq?.signingUrl ?? null;

    return {
      signatureRequestId: sigReq?.signatureRequestId ?? "",
      signingUrl,
      provider: "dropbox_sign",
    };
  } catch (err: any) {
    // If Dropbox Sign fails, fall through to native
    logger.error({ err: err?.message }, "[DropboxSign] API error — falling back to native");
    return null;
  }
}

// ── Brevo transactional email (replaces nodemailer/SMTP) ─────────────────────
async function sendContractEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || "info@tolipai.com";
  if (!apiKey) return false;
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "TolipAI CRM", email: senderEmail },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// ── Purchase Agreement HTML template ─────────────────────────────────────────
function buildContractHtml(data: {
  contractType: string;
  sellerName: string;
  buyerName: string;
  propertyAddress: string;
  purchasePrice: number;
  earnestMoney: number;
  closingDays: number;
  includeAssignment: boolean;
  additionalTerms?: string | null;
  createdAt: Date;
}): string {
  const closingDate = new Date(data.createdAt);
  closingDate.setDate(closingDate.getDate() + data.closingDays);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

  const isAssignment = data.contractType === "assignment";
  const title = isAssignment ? "ASSIGNMENT OF PURCHASE AND SALE AGREEMENT" : "REAL ESTATE PURCHASE AND SALE AGREEMENT";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Times New Roman", Times, serif; font-size: 13px; line-height: 1.7; color: #1a1a1a; background: #fff; padding: 48px; max-width: 820px; margin: 0 auto; }
  h1 { font-size: 17px; text-align: center; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .subtitle { text-align: center; font-size: 11px; color: #555; margin-bottom: 28px; }
  h2 { font-size: 13px; text-transform: uppercase; margin: 22px 0 8px; font-weight: bold; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  p { margin-bottom: 10px; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; background: #f9f9f9; border: 1px solid #ddd; border-radius: 6px; padding: 16px; margin-bottom: 20px; }
  .party label { font-size: 11px; text-transform: uppercase; color: #777; display: block; margin-bottom: 2px; }
  .party value { font-weight: bold; font-size: 13px; }
  .terms-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  .terms-table td { padding: 8px 12px; border: 1px solid #ddd; }
  .terms-table td:first-child { font-weight: bold; width: 40%; background: #f9f9f9; }
  ol { padding-left: 22px; margin-bottom: 12px; }
  ol li { margin-bottom: 8px; }
  .signature-section { margin-top: 40px; border-top: 2px solid #333; padding-top: 24px; }
  .sig-row { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 28px; }
  .sig-box label { font-size: 11px; text-transform: uppercase; color: #777; display: block; margin-bottom: 6px; }
  .sig-line { border-bottom: 1px solid #333; height: 32px; margin-bottom: 4px; }
  .sig-sub { font-size: 10px; color: #888; }
  .watermark-pending { text-align: center; color: #cc6600; font-size: 12px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; padding: 8px; border: 2px solid #cc6600; border-radius: 4px; margin-bottom: 16px; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
<h1>${title}</h1>
<p class="subtitle">Date: ${fmt(data.createdAt)} &nbsp;|&nbsp; Generated by TolipAI CRM</p>

<div class="parties">
  <div class="party">
    <label>Seller</label>
    <value>${data.sellerName}</value>
  </div>
  <div class="party">
    <label>Buyer / Assignee</label>
    <value>${data.buyerName}</value>
  </div>
</div>

<table class="terms-table">
  <tr><td>Property Address</td><td>${data.propertyAddress}</td></tr>
  <tr><td>Purchase Price</td><td>${money(data.purchasePrice)}</td></tr>
  <tr><td>Earnest Money Deposit</td><td>${money(data.earnestMoney)}</td></tr>
  <tr><td>Closing Date</td><td>On or before ${fmt(closingDate)} (${data.closingDays} days from execution)</td></tr>
  <tr><td>Contract Type</td><td>${isAssignment ? "Assignment of Contract" : "Direct Purchase Agreement"}</td></tr>
</table>

<h2>1. Purchase &amp; Sale</h2>
<p>Seller agrees to sell and Buyer agrees to purchase the real property located at <strong>${data.propertyAddress}</strong> (the "Property") for the total purchase price of <strong>${money(data.purchasePrice)}</strong>, subject to the terms and conditions set forth in this Agreement.</p>

<h2>2. Earnest Money</h2>
<p>Buyer shall deposit <strong>${money(data.earnestMoney)}</strong> as earnest money within three (3) business days of the execution of this Agreement. The earnest money shall be held in escrow and applied to the purchase price at closing. If Buyer fails to close for reasons not covered by contingencies herein, the earnest money shall be forfeited to Seller as liquidated damages.</p>

<h2>3. Closing</h2>
<p>Closing shall occur on or before <strong>${fmt(closingDate)}</strong>, or at such other date as mutually agreed upon in writing by both parties. Possession of the Property shall transfer to Buyer at closing. Closing costs shall be paid as customary for the jurisdiction in which the Property is located.</p>

<h2>4. Title &amp; Condition</h2>
<p>Seller warrants that they have marketable title to the Property, free and clear of all liens and encumbrances, except those of record or expressly disclosed herein. The Property is sold AS-IS, WHERE-IS, with no warranties or representations as to its condition, fitness for any particular purpose, or compliance with any laws or regulations. Buyer acknowledges that Buyer is purchasing the Property in its present condition and has had the opportunity to inspect the Property.</p>

<h2>5. Contingencies</h2>
<ol>
  <li><strong>Inspection:</strong> This Agreement is contingent upon Buyer's satisfactory inspection of the Property within seven (7) days of execution. Buyer may cancel this Agreement if inspection results are unsatisfactory, with earnest money returned in full.</li>
  <li><strong>Title:</strong> This Agreement is contingent upon Buyer's receipt of a clear title commitment within ten (10) days of execution.</li>
  <li><strong>Financing:</strong> This Agreement is NOT contingent on Buyer obtaining financing. Buyer represents they have sufficient funds or financing committed to complete this purchase.</li>
</ol>

${data.includeAssignment ? `<h2>6. Assignment</h2>
<p>Buyer reserves the right to assign this contract, or any interest therein, to any third party without the prior written consent of Seller. Seller expressly acknowledges and agrees that Buyer may assign this Agreement. Upon assignment, Buyer shall be released from all obligations under this Agreement, which shall be assumed by the assignee.</p>` : ""}

<h2>${data.includeAssignment ? "7" : "6"}. Default</h2>
<p>If Seller defaults under this Agreement, Buyer shall have the right to demand the return of the earnest money and/or seek specific performance of this Agreement. If Buyer defaults under this Agreement, Seller's sole remedy shall be to retain the earnest money as liquidated damages, and Seller shall have no other claim against Buyer.</p>

<h2>${data.includeAssignment ? "8" : "7"}. Entire Agreement</h2>
<p>This Agreement constitutes the entire agreement between the parties with respect to the purchase and sale of the Property and supersedes all prior agreements, representations, and understandings. This Agreement may not be modified except by a written instrument signed by both parties. This Agreement shall be binding upon and inure to the benefit of the parties and their respective heirs, executors, administrators, successors, and assigns.</p>

${data.additionalTerms ? `<h2>Additional Terms &amp; Conditions</h2><p>${data.additionalTerms.replace(/\n/g, "<br/>")}</p>` : ""}

<div class="signature-section">
  <h2>Signatures</h2>
  <p>By signing below, the parties agree to all terms and conditions of this Agreement.</p>
  <div class="sig-row">
    <div class="sig-box">
      <label>Seller Signature</label>
      <div class="sig-line" id="seller-sig-line"></div>
      <p class="sig-sub">Print Name: ${data.sellerName}</p>
      <p class="sig-sub">Date: ___________________________</p>
    </div>
    <div class="sig-box">
      <label>Buyer Signature</label>
      <div class="sig-line"></div>
      <p class="sig-sub">Print Name: ${data.buyerName}</p>
      <p class="sig-sub">Date: ___________________________</p>
    </div>
  </div>
</div>

</body>
</html>`;
}

// ── POST /api/crm/contracts — Create & send a contract ────────────────────────
router.post("/", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  try {
    const {
      leadId, sellerName, sellerEmail, sellerPhone,
      buyerName, contractType = "purchase_agreement",
      purchasePrice, earnestMoney = 500, closingDays = 30,
      includeAssignment = true, additionalTerms,
    } = req.body;

    if (!leadId || !sellerName || !purchasePrice) {
      res.status(400).json({ error: "leadId, sellerName, and purchasePrice are required" });
      return;
    }

    // Fetch lead for address
    const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, leadId)).limit(1);
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

    // Fetch campaign for buyer name
    let resolvedBuyerName = buyerName;
    if (!resolvedBuyerName && crmUser.campaignId) {
      const [camp] = await db.select({ name: crmCampaigns.name }).from(crmCampaigns).where(eq(crmCampaigns.id, crmUser.campaignId)).limit(1);
      resolvedBuyerName = camp?.name || crmUser.name || "Buyer";
    }
    resolvedBuyerName = resolvedBuyerName || crmUser.name || "Buyer";

    const propertyAddress = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ");
    const signingToken = crypto.randomBytes(24).toString("hex");
    const tokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    const now = new Date();

    const documentHtml = buildContractHtml({
      contractType,
      sellerName,
      buyerName: resolvedBuyerName,
      propertyAddress,
      purchasePrice: parseFloat(purchasePrice),
      earnestMoney: parseFloat(earnestMoney),
      closingDays: parseInt(closingDays),
      includeAssignment: !!includeAssignment,
      additionalTerms: additionalTerms || null,
      createdAt: now,
    });

    const [contract] = await db.insert(crmContracts).values({
      leadId,
      campaignId: lead.campaignId,
      createdById: crmUser.id,
      sellerName,
      sellerEmail: sellerEmail || null,
      sellerPhone: sellerPhone || null,
      buyerName: resolvedBuyerName,
      contractType,
      propertyAddress,
      purchasePrice: purchasePrice.toString(),
      earnestMoney: earnestMoney.toString(),
      closingDays: parseInt(closingDays),
      includeAssignment: !!includeAssignment,
      additionalTerms: additionalTerms || null,
      status: "draft",
      provider: "native",
      signingToken,
      tokenExpiresAt,
      documentHtml,
    }).returning();

    // ── Try Dropbox Sign first (auto-upgrade when API key is configured) ──────
    let signingUrl: string;
    let emailSent = false;
    let usedProvider = "native";

    if (sellerEmail && getDropboxSignClient()) {
      const dsResult = await sendViaDropboxSign({
        sellerName,
        sellerEmail,
        propertyAddress,
        contractType,
        documentHtml,
        contractId: contract.id,
      });

      if (dsResult) {
        // Dropbox Sign handled delivery — update the contract record
        await db.update(crmContracts)
          .set({
            provider:      "dropbox_sign",
            status:        "sent",
            emailSentAt:   new Date(),
            signingToken:  dsResult.signatureRequestId, // reuse field to store DS request ID
          })
          .where(eq(crmContracts.id, contract.id));
        contract.status  = "sent";
        signingUrl        = dsResult.signingUrl ?? "";
        emailSent         = true;
        usedProvider      = "dropbox_sign";
      }
    }

    // ── Native fallback ───────────────────────────────────────────────────────
    if (!emailSent) {
      const appBase = process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : (req.headers.origin || `${req.protocol}://${req.get("host")}`);
      signingUrl = `${appBase}/sign/${signingToken}`;

      if (sellerEmail) {
        try {
          const sent = await sendContractEmail(
            sellerEmail,
            `Please sign your Purchase Agreement — ${propertyAddress}`,
            `<p>Hi ${sellerName},</p>
            <p>Please review and sign the Purchase Agreement for your property at <strong>${propertyAddress}</strong>.</p>
            <p style="margin:24px 0">
              <a href="${signingUrl}" style="background:#6d28d9;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
                Review &amp; Sign Agreement →
              </a>
            </p>
            <p>This link expires in 30 days. If you have any questions, please reply to this email.</p>
            <p style="color:#888;font-size:12px">Powered by TolipAI CRM</p>`,
          );
          if (sent) {
            await db.update(crmContracts)
              .set({ status: "sent", emailSentAt: new Date() })
              .where(eq(crmContracts.id, contract.id));
            contract.status = "sent";
            emailSent = true;
          }
        } catch { /* email failure is non-fatal */ }
      }
    }

    res.status(201).json({ ...contract, signingUrl: signingUrl!, emailSent, provider: usedProvider });
  } catch (err: any) {
    req.log.error({ err }, "Create contract error");
    res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) || "Internal server error" });
  }
});

// ── GET /api/crm/contracts?leadId=X — List contracts for a lead ───────────────
router.get("/", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!;
  try {
    const leadId = req.query.leadId ? parseInt(req.query.leadId as string) : null;
    if (!leadId) { res.status(400).json({ error: "leadId query param required" }); return; }

    const rows = await db.select().from(crmContracts)
      .where(eq(crmContracts.leadId, leadId))
      .orderBy(desc(crmContracts.createdAt));

    // Build signing URL for each contract
    const appBase = process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : (req.headers.origin || `${req.protocol}://${req.get("host")}`);

    const enriched = rows.map(c => ({
      ...c,
      signingUrl: c.signingToken ? `${appBase}/sign/${c.signingToken}` : null,
    }));

    res.json(enriched);
  } catch (err: any) {
    req.log.error({ err }, "List contracts error");
    res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) || "Internal server error" });
  }
});

// ── GET /api/crm/contracts/:id — Single contract ──────────────────────────────
router.get("/:id", crmAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [contract] = await db.select().from(crmContracts).where(eq(crmContracts.id, id)).limit(1);
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }

    const appBase = process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : (req.headers.origin || `${req.protocol}://${req.get("host")}`);
    const signingUrl = contract.signingToken ? `${appBase}/sign/${contract.signingToken}` : null;
    res.json({ ...contract, signingUrl });
  } catch (err: any) {
    req.log.error({ err }, "Get contract error");
    res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) || "Internal server error" });
  }
});

// ── POST /api/crm/contracts/:id/void — Void a contract ───────────────────────
router.post("/:id/void", crmAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.update(crmContracts)
      .set({ status: "voided", updatedAt: new Date() })
      .where(eq(crmContracts.id, id));
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Void contract error");
    res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) || "Internal server error" });
  }
});

// ── POST /api/crm/contracts/:id/resend — Regenerate token + resend email ─────
router.post("/:id/resend", crmAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(crmContracts).where(eq(crmContracts.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const signingToken = crypto.randomBytes(24).toString("hex");
    const tokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.update(crmContracts)
      .set({ signingToken, tokenExpiresAt, status: "sent", updatedAt: new Date() })
      .where(eq(crmContracts.id, id));

    const appBase = process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : (req.headers.origin || `${req.protocol}://${req.get("host")}`);
    const signingUrl = `${appBase}/sign/${signingToken}`;

    // Try to email again if seller email present
    let emailSent = false;
    if (existing.sellerEmail) {
      try {
        emailSent = await sendContractEmail(
          existing.sellerEmail,
          `[Reminder] Please sign your Purchase Agreement — ${existing.propertyAddress}`,
          `<p>Hi ${existing.sellerName}, this is a reminder to sign your agreement. <a href="${signingUrl}">Click here to sign →</a></p>`,
        );
      } catch { /* non-fatal */ }
    }

    res.json({ signingUrl, emailSent });
  } catch (err: any) {
    req.log.error({ err }, "Resend contract error");
    res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) || "Internal server error" });
  }
});

// ── GET /api/crm/public/sign/:token — Fetch contract for signing (no auth) ───
router.get("/public/sign/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const [contract] = await db.select().from(crmContracts)
      .where(eq(crmContracts.signingToken, token))
      .limit(1);

    if (!contract) { res.status(404).json({ error: "Contract not found or link expired" }); return; }
    if (contract.status === "voided") { res.status(410).json({ error: "This contract has been voided" }); return; }
    if (contract.status === "signed") { res.status(409).json({ error: "This contract has already been signed" }); return; }
    if (contract.tokenExpiresAt && new Date() > contract.tokenExpiresAt) {
      res.status(410).json({ error: "This signing link has expired. Please request a new link." });
      return;
    }

    // Mark as viewed on first access
    if (contract.status === "sent" || contract.status === "draft") {
      await db.update(crmContracts)
        .set({ status: "viewed", viewedAt: new Date(), updatedAt: new Date() })
        .where(eq(crmContracts.id, contract.id));
    }

    res.json({
      id: contract.id,
      contractType: contract.contractType,
      sellerName: contract.sellerName,
      buyerName: contract.buyerName,
      propertyAddress: contract.propertyAddress,
      purchasePrice: contract.purchasePrice,
      earnestMoney: contract.earnestMoney,
      closingDays: contract.closingDays,
      status: contract.status,
      documentHtml: contract.documentHtml,
      createdAt: contract.createdAt,
    });
  } catch (err: any) {
    res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) || "Internal server error" });
  }
});

// ── POST /api/crm/public/sign/:token — Submit e-signature ────────────────────
router.post("/public/sign/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { signerName, agreed } = req.body;

    if (!signerName || !agreed) {
      res.status(400).json({ error: "You must type your name and check the agreement box" });
      return;
    }

    const [contract] = await db.select().from(crmContracts)
      .where(eq(crmContracts.signingToken, token))
      .limit(1);

    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }
    if (contract.status === "signed") { res.status(409).json({ error: "Already signed" }); return; }
    if (contract.status === "voided") { res.status(410).json({ error: "Contract has been voided" }); return; }
    if (contract.tokenExpiresAt && new Date() > contract.tokenExpiresAt) {
      res.status(410).json({ error: "Signing link has expired" });
      return;
    }

    const signerIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      || req.socket.remoteAddress || "unknown";

    await db.update(crmContracts).set({
      status: "signed",
      signedAt: new Date(),
      signerNameTyped: signerName,
      signerIp,
      updatedAt: new Date(),
    }).where(eq(crmContracts.id, contract.id));

    // Optional: email both parties a confirmation
    try {
      if (contract.sellerEmail) {
        await sendContractEmail(
          contract.sellerEmail,
          `Contract Signed — ${contract.propertyAddress}`,
          `<p>Hi ${contract.sellerName},</p><p>Your Purchase Agreement for <strong>${contract.propertyAddress}</strong> has been executed. Signed by: <strong>${signerName}</strong> on ${new Date().toLocaleDateString()}.</p><p>Thank you!</p>`,
        );
      }
    } catch { /* non-fatal */ }

    res.json({ success: true, message: "Contract signed successfully. Thank you!" });
  } catch (err: any) {
    res.status(500).json({ error: (err instanceof Error ? err.message : String(err)) || "Internal server error" });
  }
});

// ── POST /api/crm/contracts/dropbox-webhook — Dropbox Sign status callbacks ───
// Configure in Dropbox Sign dashboard: Callback URL = https://yourapp.railway.app/api/crm/contracts/dropbox-webhook
// Events handled: signature_request_signed, signature_request_viewed, signature_request_declined
router.post("/dropbox-webhook", async (req, res) => {
  try {
    // Dropbox Sign sends the event as JSON or form-encoded with a `json` field
    const payload = req.body?.json
      ? (typeof req.body.json === "string" ? JSON.parse(req.body.json) : req.body.json)
      : req.body;

    const event = payload?.event;
    const sigReq = payload?.signature_request;

    if (!event || !sigReq) {
      // Must respond with "Hello API Event Received" to acknowledge
      res.status(200).send("Hello API Event Received");
      return;
    }

    const signatureRequestId: string = sigReq.signature_request_id ?? "";
    const eventType: string = event.event_type ?? "";

    if (signatureRequestId) {
      // Find the contract where signingToken holds the Dropbox Sign request ID
      const [contract] = await db
        .select({ id: crmContracts.id, status: crmContracts.status })
        .from(crmContracts)
        .where(eq(crmContracts.signingToken, signatureRequestId))
        .limit(1);

      if (contract) {
        if (eventType === "signature_request_signed") {
          await db.update(crmContracts)
            .set({ status: "signed", signedAt: new Date(), updatedAt: new Date() })
            .where(eq(crmContracts.id, contract.id));
        } else if (eventType === "signature_request_viewed") {
          if (contract.status === "sent") {
            await db.update(crmContracts)
              .set({ status: "viewed", viewedAt: new Date(), updatedAt: new Date() })
              .where(eq(crmContracts.id, contract.id));
          }
        } else if (eventType === "signature_request_declined") {
          await db.update(crmContracts)
            .set({ status: "voided", updatedAt: new Date() })
            .where(eq(crmContracts.id, contract.id));
        }
      }
    }

    // Required acknowledgment response
    res.status(200).send("Hello API Event Received");
  } catch (err: any) {
    logger.error({ err: err?.message }, "[DropboxSign webhook] error");
    res.status(200).send("Hello API Event Received"); // always ack to prevent retries
  }
});

// ── GET /api/crm/contracts/dropbox-status — Check if Dropbox Sign is active ──
router.get("/dropbox-status", crmAuth, (_req, res) => {
  const active = !!process.env.DROPBOX_SIGN_API_KEY;
  res.json({
    active,
    provider: active ? "dropbox_sign" : "native",
    description: active
      ? "Legally certified e-signatures with Dropbox Sign audit certificates"
      : "Native e-signature (typed name + IP logging). Set DROPBOX_SIGN_API_KEY to upgrade.",
  });
});

export default router;
