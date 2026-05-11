import { Router } from "express";
import { db } from "@workspace/db";
import { crmBuyers, crmCampaigns } from "@workspace/db/schema";
import { eq, and, desc, ilike, or } from "drizzle-orm";
import { crmAuth } from "./middleware";
import { logger } from "../../lib/logger";

const router = Router();

function getCampaignId(crmUser: any): number | null {
  if (crmUser.role === "super_admin") return null;
  return crmUser.campaignId ?? null;
}

// Parse a single CSV line (handles quoted fields)
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// GET /api/crm/buyers — list buyers for the current campaign
router.get("/", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!
  const campaignId = getCampaignId(crmUser);
  const search = req.query.search as string | undefined;

  try {
    let query = db.select().from(crmBuyers);
    const conditions: any[] = [];

    if (campaignId !== null) {
      conditions.push(eq(crmBuyers.campaignId, campaignId));
    } else if (req.query.campaignId) {
      conditions.push(eq(crmBuyers.campaignId, parseInt(req.query.campaignId as string)));
    }

    if (search) {
      conditions.push(
        or(
          ilike(crmBuyers.name, `%${search}%`),
          ilike(crmBuyers.phone, `%${search}%`),
          ilike(crmBuyers.email, `%${search}%`)
        )
      );
    }

    const buyers = conditions.length > 0
      ? await db.select().from(crmBuyers).where(and(...conditions)).orderBy(desc(crmBuyers.createdAt))
      : await db.select().from(crmBuyers).orderBy(desc(crmBuyers.createdAt));

    res.json(buyers);
  } catch (err) {
    logger.error(err, "buyers list error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/crm/buyers — add a single buyer
router.post("/", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!
  const campaignId = getCampaignId(crmUser) ?? req.body.campaignId;
  const { name, phone, email, address, notes } = req.body;

  if (!name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  try {
    const [buyer] = await db.insert(crmBuyers).values({
      campaignId: campaignId ? Number(campaignId) : null,
      name,
      phone: phone || null,
      email: email || null,
      address: address || null,
      notes: notes || null,
      uploadedBy: crmUser.userId,
    }).returning();
    res.status(201).json(buyer);
  } catch (err) {
    logger.error(err, "buyers create error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/crm/buyers/upload — bulk import from CSV/TSV text body
// Expects multipart or raw text; we accept JSON body with { csv: "..." }
router.post("/upload", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!
  const campaignId = getCampaignId(crmUser) ?? req.body.campaignId;

  const csvText: string = req.body.csv || "";
  if (!csvText.trim()) {
    res.status(400).json({ error: "No CSV data provided" });
    return;
  }

  const CSV_SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB
  const CSV_ROW_LIMIT = 10_000;
  if (Buffer.byteLength(csvText, "utf8") > CSV_SIZE_LIMIT) {
    res.status(413).json({ error: "CSV file too large (max 5 MB)" });
    return;
  }

  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) {
    res.status(400).json({ error: "CSV must have a header row and at least one data row" });
    return;
  }
  if (lines.length - 1 > CSV_ROW_LIMIT) {
    res.status(413).json({ error: `CSV exceeds maximum row limit of ${CSV_ROW_LIMIT.toLocaleString()} rows` });
    return;
  }

  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""));
  const nameIdx = headers.findIndex(h => h.includes("name") || h === "n");
  const phoneIdx = headers.findIndex(h => h.includes("phone") || h.includes("mobile") || h.includes("cell") || h.includes("number"));
  const emailIdx = headers.findIndex(h => h.includes("email") || h.includes("mail"));
  const addressIdx = headers.findIndex(h => h.includes("address") || h.includes("addr"));
  const notesIdx = headers.findIndex(h => h.includes("note") || h.includes("comment"));

  if (nameIdx === -1) {
    res.status(400).json({ error: "CSV must have a 'name' column" });
    return;
  }

  const rows = lines.slice(1);
  const toInsert: any[] = [];
  let skipped = 0;

  for (const line of rows) {
    const cols = parseCsvLine(line);
    const name = cols[nameIdx]?.trim();
    if (!name) { skipped++; continue; }
    toInsert.push({
      campaignId: campaignId ? Number(campaignId) : null,
      name,
      phone: phoneIdx >= 0 ? cols[phoneIdx]?.trim() || null : null,
      email: emailIdx >= 0 ? cols[emailIdx]?.trim() || null : null,
      address: addressIdx >= 0 ? cols[addressIdx]?.trim() || null : null,
      notes: notesIdx >= 0 ? cols[notesIdx]?.trim() || null : null,
      uploadedBy: crmUser.userId,
    });
  }

  if (toInsert.length === 0) {
    res.status(400).json({ error: "No valid rows found in CSV" });
    return;
  }

  try {
    const BATCH = 100;
    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      await db.insert(crmBuyers).values(toInsert.slice(i, i + BATCH));
      inserted += Math.min(BATCH, toInsert.length - i);
    }
    res.json({ success: true, inserted, skipped });
  } catch (err) {
    logger.error(err, "buyers upload error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/crm/buyers/:id
router.delete("/:id", crmAuth, async (req, res) => {
  const crmUser = req.crmUser!
  const id = parseInt(req.params.id as string);
  try {
    const [buyer] = await db.select().from(crmBuyers).where(eq(crmBuyers.id, id)).limit(1);
    if (!buyer) { res.status(404).json({ error: "Buyer not found" }); return; }
    if (crmUser.role !== "super_admin" && buyer.campaignId !== crmUser.campaignId) {
      res.status(403).json({ error: "Access denied" }); return;
    }
    await db.delete(crmBuyers).where(eq(crmBuyers.id, id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
