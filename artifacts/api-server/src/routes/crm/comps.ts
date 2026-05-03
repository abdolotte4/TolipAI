import { Router } from "express";
import { db } from "@workspace/db";
import { crmComps, crmLeads } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { crmAuth } from "./middleware";
import { calculateAdjustedComp, calculateArvFromComps, calculateMao, estimateMarketPricePerSqft } from "../../services/propertyApi";

const router = Router();

function formatComp(c: any) {
  return {
    id: c.id,
    leadId: c.leadId,
    address: c.address,
    beds: c.beds,
    baths: c.baths ? parseFloat(c.baths) : null,
    sqft: c.sqft,
    yearBuilt: c.yearBuilt,
    salePrice: c.salePrice ? parseFloat(c.salePrice) : null,
    adjustedPrice: c.adjustedPrice ? parseFloat(c.adjustedPrice) : null,
    soldDate: c.soldDate,
    notes: c.notes,
    source: c.source || "manual",
    pricePerSqft: c.sqft && c.salePrice ? Math.round(parseFloat(c.salePrice) / c.sqft) : null,
    createdAt: c.createdAt,
  };
}

// GET /crm/leads/:leadId/comps
router.get("/:leadId/comps", crmAuth, async (req, res) => {
  try {
    const leadId = parseInt(req.params["leadId"] as string);
    const comps = await db
      .select()
      .from(crmComps)
      .where(eq(crmComps.leadId, leadId))
      .orderBy(desc(crmComps.createdAt));
    res.json(comps.map(formatComp));
  } catch (err) {
    console.error("Get comps error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /crm/leads/:leadId/comps
router.post("/:leadId/comps", crmAuth, async (req, res) => {
  try {
    const leadId = parseInt(req.params["leadId"] as string);
    const { address, beds, baths, sqft, yearBuilt, salePrice, soldDate, notes } = req.body;
    if (!address) { res.status(400).json({ error: "Address is required" }); return; }

    // Get lead info for adjustment calculation
    const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, leadId)).limit(1);

    // Calculate adjusted price if we have enough data
    let adjustedPrice: string | null = null;
    if (salePrice && parseFloat(salePrice) > 0) {
      const adj = calculateAdjustedComp(
        {
          beds: lead?.beds ?? null,
          baths: lead?.baths ? parseFloat(lead.baths as string) : null,
          sqft: lead?.sqft ?? null,
          yearBuilt: lead?.yearBuilt ?? null,
          condition: lead?.condition ?? null,
        },
        {
          salePrice: parseFloat(salePrice),
          beds: beds ? parseInt(beds) : null,
          baths: baths ? parseFloat(baths) : null,
          sqft: sqft ? parseInt(sqft) : null,
          yearBuilt: yearBuilt ? parseInt(yearBuilt) : null,
        }
      );
      adjustedPrice = adj.toString();
    }

    const [comp] = await db.insert(crmComps).values({
      leadId,
      address,
      beds: beds ? parseInt(beds) : null,
      baths: baths ? baths.toString() : null,
      sqft: sqft ? parseInt(sqft) : null,
      yearBuilt: yearBuilt ? parseInt(yearBuilt) : null,
      salePrice: salePrice ? parseFloat(salePrice).toString() : null,
      adjustedPrice,
      soldDate: soldDate || null,
      notes: notes || null,
      source: "manual",
    }).returning();

    // Auto-calculate and update ARV on the lead
    await recalculateAndUpdateArv(leadId, lead);

    res.status(201).json(formatComp(comp));
  } catch (err) {
    console.error("Create comp error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /crm/leads/:leadId/comps/:compId
router.delete("/:leadId/comps/:compId", crmAuth, async (req, res) => {
  try {
    const leadId = parseInt(req.params["leadId"] as string);
    const compId = parseInt(req.params["compId"] as string);
    await db.delete(crmComps).where(eq(crmComps.id, compId));
    // Recalculate ARV after removing a comp
    const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, leadId)).limit(1);
    await recalculateAndUpdateArv(leadId, lead);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /crm/leads/:leadId/comps/recalculate  — re-run adjustments + ARV on all existing comps
router.post("/:leadId/comps/recalculate", crmAuth, async (req, res) => {
  try {
    const leadId = parseInt(req.params["leadId"] as string);
    const [lead] = await db.select().from(crmLeads).where(eq(crmLeads.id, leadId)).limit(1);
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

    const comps = await db.select().from(crmComps).where(eq(crmComps.leadId, leadId));

    // Derive market price-per-sqft from the actual comps (median of salePrice/sqft).
    // If comp records don't have usable sqft, query the AI for a market-specific estimate
    // so adjustments are never based on a hardcoded constant.
    const sqftRates = comps
      .filter(c => c.salePrice && c.sqft && (c.sqft as number) > 0)
      .map(c => parseFloat(c.salePrice as string) / (c.sqft as number))
      .sort((a, b) => a - b);
    const marketPricePerSqft: number | undefined = sqftRates.length > 0
      ? sqftRates[Math.floor(sqftRates.length / 2)]
      : (await estimateMarketPricePerSqft(lead.city ?? "", lead.state ?? "", lead.zip ?? undefined)) ?? undefined;

    for (const comp of comps) {
      if (!comp.salePrice) continue;
      const adj = calculateAdjustedComp(
        {
          beds: lead.beds ?? null,
          baths: lead.baths ? parseFloat(lead.baths as string) : null,
          sqft: lead.sqft ?? null,
          yearBuilt: lead.yearBuilt ?? null,
          condition: lead.condition ?? null,
        },
        {
          salePrice: parseFloat(comp.salePrice as string),
          beds: comp.beds ?? null,
          baths: comp.baths ? parseFloat(comp.baths as string) : null,
          sqft: comp.sqft ?? null,
          yearBuilt: comp.yearBuilt ?? null,
          soldDate: comp.soldDate ?? null,
        },
        marketPricePerSqft
      );
      await db.update(crmComps).set({ adjustedPrice: adj.toString() }).where(eq(crmComps.id, comp.id));
    }

    await recalculateAndUpdateArv(leadId, lead);

    const updatedComps = await db.select().from(crmComps).where(eq(crmComps.leadId, leadId)).orderBy(desc(crmComps.createdAt));
    res.json(updatedComps.map(formatComp));
  } catch (err) {
    console.error("Recalculate error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/** Recalculate ARV from current comps and update the lead. */
async function recalculateAndUpdateArv(leadId: number, lead: any) {
  const comps = await db.select().from(crmComps).where(eq(crmComps.leadId, leadId));
  const adjustedPrices = comps
    .filter(c => c.adjustedPrice && parseFloat(c.adjustedPrice as string) > 0)
    .map(c => parseFloat(c.adjustedPrice as string));

  if (adjustedPrices.length >= 1) {
    const arv = calculateArvFromComps(adjustedPrices);
    if (arv && arv > 0) {
      const erc = lead?.estimatedRepairCost ? parseFloat(lead.estimatedRepairCost as string) : 0;
      const override = lead?.maoDiscountOverride ? parseFloat(lead.maoDiscountOverride as string) : null;
      const mao = calculateMao(arv, erc, lead?.condition ?? null, override);
      await db.update(crmLeads).set({
        arv: arv.toString(),
        mao: (mao ?? 0).toString(),
        updatedAt: new Date(),
      }).where(eq(crmLeads.id, leadId));
    }
  }
}

export default router;
