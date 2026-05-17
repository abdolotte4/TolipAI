import { Router } from "express";
import { db } from "@workspace/db";
import { crmSubmissionLinks, crmLeads, crmCampaigns } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import authRouter from "./auth";
import campaignsRouter from "./campaigns";
import leadsRouter from "./leads";
import tasksRouter from "./tasks";
import usersRouter from "./users";
import linksRouter from "./links";
import statsRouter from "./stats";
import sequencesRouter from "./sequences";
import compsRouter from "./comps";
import notificationsRouter from "./notifications";
import buyersRouter from "./buyers";
import analyticsRouter from "./analytics";
import contractsRouter from "./contracts";

const router = Router();

// Auth: POST /crm/auth/login, GET /crm/me
router.use("/crm", authRouter);

// Campaign management
router.use("/crm/campaigns", campaignsRouter);

// Leads CRUD + notes + estimate
router.use("/crm/leads", leadsRouter);

// Lead comps
router.use("/crm/leads", compsRouter);

// Tasks CRUD
router.use("/crm/tasks", tasksRouter);

// User management
router.use("/crm/users", usersRouter);

// Submission links management
router.use("/crm/links", linksRouter);

// Email sequences
router.use("/crm/sequences", sequencesRouter);

// Public submission form: GET /crm/public/submit/:token
router.get("/crm/public/submit/:token", async (req, res) => {
  const { token } = req.params;
  try {
    const [link] = await db.select().from(crmSubmissionLinks).where(eq(crmSubmissionLinks.token, token)).limit(1);
    if (!link) { res.status(404).json({ error: "Link not found" }); return; }
    let campaignName: string | null = null;
    if (link.campaignId) {
      const [campaign] = await db.select({ name: crmCampaigns.name }).from(crmCampaigns).where(eq(crmCampaigns.id, link.campaignId)).limit(1);
      campaignName = campaign?.name ?? null;
    }
    res.json({ label: link.label, leadSource: link.leadSource, active: link.active, campaignName });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Parse a freeform US address string into components
function parseAddressComponents(full: string): { address: string; city: string | null; state: string | null; zip: string | null } {
  const s = full.trim();
  // Format 1: "123 Main St, City, ST 12345" or "123 Main St, City, ST 12345-6789"
  let m = s.match(/^(.+?),\s*(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (m) return { address: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4].trim() };
  // Format 2: "123 Main St City, ST 12345" (city runs into street with no comma)
  m = s.match(/^(.*\b(?:St|Ave|Blvd|Dr|Rd|Ct|Ln|Way|Pl|Ter|Cir|Hwy|Pkwy|Sq|Loop|Trl|Pass)\.?)\s+(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  if (m) return { address: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4].trim() };
  // Format 3: "123 Main St, City, ST" (no zip)
  m = s.match(/^(.+?),\s*(.+?),\s*([A-Za-z]{2})$/);
  if (m) return { address: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: null };
  // Format 4: "123 Main St, ST 12345" (no city)
  m = s.match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (m) return { address: m[1].trim(), city: null, state: m[2].toUpperCase(), zip: m[3].trim() };
  // Fallback — store entire string as address
  return { address: s, city: null, state: null, zip: null };
}

// Public lead submission: POST /crm/public/submit/:token
router.post("/crm/public/submit/:token", async (req, res) => {
  const { token } = req.params;
  try {
    const [link] = await db.select().from(crmSubmissionLinks).where(eq(crmSubmissionLinks.token, token)).limit(1);
    if (!link || !link.active) { res.status(404).json({ error: "Submission link not found or inactive" }); return; }
    const data = req.body;

    // Parse address into components (form sends a single combined field)
    const { address, city, state, zip } = parseAddressComponents(data.address || "");

    // Asking price: try numeric parse, keep raw text too
    const askingPriceRaw: string | null = data.askingPriceText || null;
    const askingPriceNum = askingPriceRaw ? parseFloat(askingPriceRaw.replace(/[^0-9.]/g, "")) : null;

    // Build notes from message if provided
    const notes = data.message ? data.message.trim() : null;

    await db.insert(crmLeads).values({
      campaignId: link.campaignId,
      sellerName: data.sellerName,
      phone: data.phone || null,
      email: data.email || null,
      leadSource: link.leadSource || data.leadSource || "Submission Form",
      address,
      city: data.city || city || null,
      state: data.state || state || null,
      zip: data.zip || zip || null,
      propertyType: data.propertyType || null,
      beds: data.beds ? parseInt(data.beds) : null,
      baths: data.baths ? data.baths.toString() : null,
      sqft: data.sqft ? parseInt(data.sqft) : null,
      condition: data.condition ? parseInt(data.condition) : null,
      currentValue: data.currentValue ? parseFloat(data.currentValue).toString() : null,
      occupancy: data.occupancy || null,
      isRental: data.occupancy === "Rented",
      reasonForSelling: data.reasonForSelling || null,
      howSoon: data.howSoon || null,
      askingPrice: (!isNaN(askingPriceNum!) && askingPriceNum! > 0) ? askingPriceNum!.toString() : null,
      askingPriceText: askingPriceRaw,
      notes,
      status: "new",
    });
    await db.update(crmSubmissionLinks).set({ submissionsCount: sql`${crmSubmissionLinks.submissionsCount} + 1` }).where(eq(crmSubmissionLinks.id, link.id));
    res.status(201).json({ success: true, message: "Thank you! Your property has been submitted. We will be in touch soon." });
  } catch (err) {
    req.log.error({ err }, "Public submission error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// CRM stats dashboard
router.use("/crm/stats", statsRouter);

// Notifications
router.use("/crm/notifications", notificationsRouter);

// Buyers list
router.use("/crm/buyers", buyersRouter);

// Analytics dashboard + call report
router.use("/crm/analytics", analyticsRouter);

// E-sign contracts (CRUD + native signing)
router.use("/crm/contracts", contractsRouter);

// Public waitlist: POST /crm/public/waitlist
router.post("/crm/public/waitlist", async (req, res) => {
  const { email, name } = req.body as { email?: string; name?: string };
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Valid email is required" });
    return;
  }
  try {
    // Store as a lead with a waitlist source tag so it shows up in the CRM
    await db.insert(crmLeads).values({
      firstName: name ? name.split(" ")[0] : "Waitlist",
      lastName:  name ? (name.split(" ").slice(1).join(" ") || "Lead") : "Lead",
      email:     email.toLowerCase().trim(),
      phone:     "",
      status:    "new",
      leadSource: "landing_page_waitlist",
      notes:     `Joined waitlist from landing page${name ? ` — name: ${name}` : ""}.`,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    res.json({ ok: true, message: "You're on the list! We'll reach out within 24 hours." });
  } catch (err: any) {
    // Duplicate email — treat as success so we don't leak whether they're already in
    if (err?.code === "23505") {
      res.json({ ok: true, message: "You're already on the list!" });
      return;
    }
    console.error("[waitlist]", err);
    res.status(500).json({ error: "Could not save. Please try again." });
  }
});

export default router;
