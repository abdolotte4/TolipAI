import { logger } from "../lib/logger";
import type { PropertyApiData } from "./propertyApi";

const ATTOM_BASE = "https://api.gateway.attomdata.com";

function loadAttomKeys(): string[] {
  const keys: string[] = [];
  const k1 = process.env.ATTOM_API_KEY?.trim();
  if (k1) keys.push(k1);
  const k2 = process.env.ATTOM_API_KEY_2?.trim();
  if (k2 && k2 !== k1) keys.push(k2);
  return keys;
}

let _attomKeyIndex = 0;
const _depletedAttomKeys = new Set<string>();
const _depletedAttomKeyTimes = new Map<string, number>();

// Auto-clear ATTOM depleted-key cache after 5 minutes so transient auth errors self-heal
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, t] of _depletedAttomKeyTimes) {
    if (t < cutoff) {
      _depletedAttomKeys.delete(key);
      _depletedAttomKeyTimes.delete(key);
      logger.info({ key: key.slice(0, 8) + "…" }, "[ATTOM] depleted-key cache expired — key re-enabled");
    }
  }
}, 60_000).unref();

export function hasAttomKey(): boolean {
  return loadAttomKeys().length > 0;
}

function getNextAttomKey(): string | null {
  const keys = loadAttomKeys();
  if (!keys.length) return null;
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = keys[_attomKeyIndex % keys.length]!;
    _attomKeyIndex = (_attomKeyIndex + 1) % keys.length;
    if (!_depletedAttomKeys.has(key)) return key;
  }
  return null;
}

export async function attomGet(path: string, params: Record<string, string | number>): Promise<any> {
  const keys = loadAttomKeys();
  if (!keys.length) throw new Error("ATTOM_API_KEY not configured");

  let lastError = "";
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = getNextAttomKey();
    if (!key) break;

    const url = new URL(`${ATTOM_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

    try {
      const res = await fetch(url.toString(), {
        headers: { "apikey": key, "accept": "application/json" },
        signal: AbortSignal.timeout(8000),
      });

      if (res.status === 401 || res.status === 403) {
        _depletedAttomKeys.add(key);
        _depletedAttomKeyTimes.set(key, Date.now());
        lastError = `ATTOM ${res.status} (key unauthorized)`;
        logger.warn({ key: key.slice(0, 8) + "…", status: res.status }, "[ATTOM] key unauthorized — rotating to next");
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`ATTOM ${res.status}: ${text.slice(0, 300)}`);
      }

      return await res.json();
    } catch (err: any) {
      if (err?.message?.startsWith("ATTOM")) throw err;
      lastError = err?.message || "Network error";
      logger.warn({ err: err?.message, attempt, path }, "[ATTOM] network error — retrying");
    }
  }

  throw new Error(lastError || "All ATTOM keys exhausted or unauthorized");
}

export interface AttomComp {
  address: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  yearBuilt?: number;
  salePrice: number;
  soldDate: string;
  propertyType?: string;
}

export async function geocodeViaAttom(
  street: string,
  city?: string | null,
  state?: string | null,
  zip?: string | null,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const address2 = [city, state, zip].filter(Boolean).join(" ");
    const data = await attomGet("/propertyapi/v1.0.0/property/snapshot", {
      address1: street,
      ...(address2 ? { address2 } : {}),
    });
    const prop = data?.property?.[0];
    const lat = parseFloat(prop?.location?.latitude ?? prop?.address?.latitude ?? "0");
    const lng = parseFloat(prop?.location?.longitude ?? prop?.address?.longitude ?? "0");
    if (lat && lng) return { lat, lng };
    return null;
  } catch (err) {
    logger.warn({ err }, "[ATTOM] geocodeViaAttom failed");
    return null;
  }
}

export async function fetchCompsViaAttom(
  lat: number,
  lng: number,
  radiusMiles: number,
  maxComps = 8,
  subjectSqft?: number | null,
  subjectPropertyType?: string | null,
  subjectBeds?: number | null,
  subjectBaths?: number | null,
  subjectYearBuilt?: number | null,
): Promise<AttomComp[]> {
  // Pull a larger pool so strict post-filtering still yields enough comps.
  const data = await attomGet("/propertyapi/v1.0.0/sale/snapshot", {
    latitude: lat,
    longitude: lng,
    radius: radiusMiles,
    pagesize: 200,
  });

  const sales: any[] = data?.property || [];
  const TWO_YEARS_AGO = new Date();
  TWO_YEARS_AGO.setMonth(TWO_YEARS_AGO.getMonth() - 24);

  const comps: AttomComp[] = [];
  const excluded: Record<string, number> = {
    noPrice: 0, oldSale: 0, multiFamily: 0,
    sqftMismatch: 0, bedsMismatch: 0, bathsMismatch: 0, yearMismatch: 0,
  };

  // Only filter multi-family if the subject is *explicitly* single-family.
  const subjStr = (subjectPropertyType || "").toLowerCase();
  const subjectIsSingleFamily = ["single", "sfr", "residential", "sfh"].some(t => subjStr.includes(t));

  for (const sale of sales) {
    const salePrice = sale?.sale?.amount?.saleamt;
    if (!salePrice || salePrice <= 0) { excluded.noPrice++; continue; }

    const saleDateRaw = sale?.sale?.saleTransDate || sale?.sale?.salesearchdate;
    if (saleDateRaw) {
      const d = new Date(saleDateRaw);
      if (isNaN(d.getTime()) || d < TWO_YEARS_AGO) { excluded.oldSale++; continue; }
    }

    const rawPropType = (sale?.summary?.proptype || "").toUpperCase();
    if (subjectIsSingleFamily && rawPropType) {
      const INCOMPATIBLE = ["MULTI", "DUPLEX", "TRIPLEX", "QUADRUPLEX", "COMMERCIAL", "APARTMENT", "CONDO"];
      if (INCOMPATIBLE.some(m => rawPropType.includes(m))) { excluded.multiFamily++; continue; }
    }

    // ── Beds: exact match (if both known) ───────────────────────────────────
    const compBeds: number | undefined = sale?.building?.rooms?.bedroomscount;
    if (subjectBeds != null && compBeds != null && compBeds !== subjectBeds) {
      excluded.bedsMismatch++; continue;
    }

    // ── Baths: ±0.5 tolerance for half-bath differences ─────────────────────
    const compBaths: number | undefined = sale?.building?.rooms?.bathstotal;
    if (subjectBaths != null && compBaths != null && Math.abs(compBaths - subjectBaths) > 0.5) {
      excluded.bathsMismatch++; continue;
    }

    // ── Sqft: ±200 sq ft (industry standard for comping) ────────────────────
    const compSqft: number | undefined = sale?.building?.size?.universalsize;
    if (subjectSqft && compSqft && Math.abs(compSqft - subjectSqft) > 200) {
      excluded.sqftMismatch++; continue;
    }

    // ── Year built: ±10 years ────────────────────────────────────────────────
    const compYearBuilt: number | undefined = sale?.summary?.yearbuilt;
    if (subjectYearBuilt != null && compYearBuilt != null && Math.abs(compYearBuilt - subjectYearBuilt) > 10) {
      excluded.yearMismatch++; continue;
    }

    const addr = sale?.address;
    const fullAddr = [addr?.line1, addr?.locality, addr?.countrySubd]
      .filter(Boolean).join(", ");

    const soldDate = saleDateRaw
      ? new Date(saleDateRaw).toISOString().split("T")[0]!
      : "";

    comps.push({
      address: fullAddr,
      beds: compBeds || undefined,
      baths: compBaths || undefined,
      sqft: compSqft || undefined,
      yearBuilt: compYearBuilt || undefined,
      salePrice,
      soldDate,
      propertyType: sale?.summary?.proptype || undefined,
    });

    if (comps.length >= maxComps) break;
  }

  logger.info(
    { lat, lng, radiusMiles, matched: comps.length, excluded, subjectSqft, subjectBeds, subjectBaths, subjectYearBuilt },
    "[ATTOM] fetchCompsViaAttom filtering complete",
  );

  return comps;
}

export async function fetchPropertyDataViaAttom(
  street: string,
  city?: string | null,
  state?: string | null,
  zip?: string | null,
): Promise<PropertyApiData | null> {
  try {
    const address2 = [city, state, zip].filter(Boolean).join(" ");
    const addrParams = { address1: street, ...(address2 ? { address2 } : {}) };

    // Fire detail + allevents in parallel — allevents reliably carries sale history and owner
    const [detailData, eventsData] = await Promise.allSettled([
      attomGet("/propertyapi/v1.0.0/property/detail", addrParams),
      attomGet("/propertyapi/v1.0.0/allevents/detail", addrParams),
    ]);

    const prop = detailData.status === "fulfilled" ? detailData.value?.property?.[0] : null;
    const evt  = eventsData.status  === "fulfilled" ? eventsData.value?.property?.[0]  : null;

    if (!prop && !evt) return null;

    const num = (v: any): number | null => {
      const n = parseFloat(v);
      return isNaN(n) ? null : n;
    };
    const str = (v: any): string | null =>
      v && typeof v === "string" && v.trim() ? v.trim() : null;

    // ── Physical characteristics (from detail) ────────────────────────────────
    const beds      = num(prop?.building?.rooms?.bedroomscount);
    const baths     = num(prop?.building?.rooms?.bathstotal ?? prop?.building?.rooms?.bathscalculated);
    const sqft      = num(prop?.building?.size?.livingsize ?? prop?.building?.size?.universalsize);
    const yearBuilt = num(prop?.summary?.yearbuilt);

    const lotAcres  = num(prop?.lot?.lotsize1);
    const lotSqft   = lotAcres != null ? Math.round(lotAcres * 43560)
                    : num(prop?.lot?.lotsize2) ?? null;

    const propertyType = str(prop?.summary?.proptype ?? prop?.summary?.propClass
                           ?? evt?.summary?.proptype ?? evt?.summary?.propClass);
    const lat = num(prop?.location?.latitude  ?? evt?.address?.latitude);
    const lng = num(prop?.location?.longitude ?? evt?.address?.longitude);

    // ── Owner name — try multiple paths across both responses ─────────────────
    const _o1 = prop?.owner?.owner1;
    const _e1 = evt?.owner?.owner1;
    const _ownerFull = str(_o1?.fullname)
      ?? ((_o1?.firstName || _o1?.lastName) ? [_o1.firstName, _o1.lastName].filter(Boolean).join(" ") : null)
      ?? str(_o1?.lastName)
      ?? str(_o1?.corpname)
      ?? str(_e1?.fullname)
      ?? str(_e1?.lastName)
      ?? str(_e1?.corpname);
    const ownerName = _ownerFull;

    // ── Tax assessed value ────────────────────────────────────────────────────
    const taxAssessed = num(
      prop?.assessment?.assessed?.assdttlvalue ??
      prop?.assessment?.market?.mktttlvalue,
    );

    // ── Sale history — prefer allevents (more reliable), fall back to detail ──
    // allevents returns an array of events; find the most recent DEED/sale
    let lastSalePrice: number | null = null;
    let lastSaleDateRaw: string | null = null;

    const evtList: any[] = evt?.eventHistory ?? [];
    const saleEvent = evtList
      .filter((e: any) => {
        const type = (e?.recordinginfo?.formtype ?? e?.recordingInfo?.formType ?? "").toUpperCase();
        return type.includes("DEED") || type.includes("SALE") || type.includes("TRANSFER");
      })
      .sort((a: any, b: any) => {
        const da = new Date(a?.recordinginfo?.recordingdate ?? a?.recordingInfo?.recordingDate ?? 0).getTime();
        const db = new Date(b?.recordinginfo?.recordingdate ?? b?.recordingInfo?.recordingDate ?? 0).getTime();
        return db - da;
      })[0];

    if (saleEvent) {
      lastSalePrice    = num(saleEvent?.amount?.saleamt ?? saleEvent?.saleamt);
      lastSaleDateRaw  = saleEvent?.recordinginfo?.recordingdate ?? saleEvent?.recordingInfo?.recordingDate
                        ?? saleEvent?.saleTransDate ?? null;
    }

    // Fall back to property/detail sale block
    if (lastSalePrice == null) lastSalePrice = num(prop?.sale?.amount?.saleamt);
    if (lastSaleDateRaw == null) lastSaleDateRaw = prop?.sale?.saleTransDate ?? prop?.sale?.salesearchdate ?? null;

    const lastSaleDate = lastSaleDateRaw
      ? new Date(lastSaleDateRaw).toISOString().split("T")[0]
      : null;

    // ── Amenities ─────────────────────────────────────────────────────────────
    const prkgType  = str(prop?.building?.parking?.prkgtype);
    const hasGarage = prkgType != null && prkgType.toUpperCase() !== "NONE";
    const poolStr   = str(prop?.utilities?.PoolInd ?? prop?.utilities?.poolInd);
    const hasPool   = poolStr != null && poolStr.toUpperCase() === "YES";

    logger.info(
      { street, city, state, ownerName, lastSalePrice, lastSaleDate, detailOk: !!prop, eventsOk: !!evt },
      "[ATTOM] fetchPropertyDataViaAttom success",
    );

    return {
      beds, baths, sqft, yearBuilt, ownerName, lotSqft, hasPool, hasGarage,
      taxAssessedValue: taxAssessed, lastSalePrice, lastSaleDate, propertyType,
      latitude: lat, longitude: lng,
      avm: null,
    };
  } catch (err: any) {
    logger.warn({ err: err?.message }, "[ATTOM] fetchPropertyDataViaAttom failed");
    return null;
  }
}

// ─── Distressed property search (Opportunity Finder ATTOM fallback) ──────────

export interface AttomDistressedResult {
  address: string;
  city: string;
  state: string;
  zip: string;
  ownerName: string | null;
  mailingAddress: string | null;
  isAbsenteeOwner: boolean;
  avm: number | null;
  assessedValue: number | null;
  mortgageBalance: number | null;
  equity: number | null;
  equityPercent: number | null;
  distressIndicators: string[];
  source: "attom";
}

/**
 * Search ATTOM for distressed properties in a ZIP code.
 *
 * Uses /property/snapshot (postal code list mode) and filters by:
 *   - Absentee Owner  — mailing address differs from property address
 *   - Free & Clear    — no recorded first-mortgage amount
 *   - High Equity     — estimated equity ≥ 40 %
 *
 * Empty `categories` array = return ALL distress types.
 */
export async function fetchDistressedViaAttom(
  zip: string,
  categories: string[] = [],
  maxRecords = 100,
): Promise<AttomDistressedResult[]> {
  try {
    const data = await attomGet("/propertyapi/v1.0.0/property/snapshot", {
      postalcode: zip,
      pagesize: Math.min(maxRecords * 3, 500),
      page: 1,
    });

    const properties: any[] = data?.property || [];
    if (!properties.length) return [];

    const wantAbsentee  = !categories.length || categories.some(c => /absentee/i.test(c));
    const wantFreeClear = !categories.length || categories.some(c => /free|clear|no mortgage/i.test(c));
    const wantHighEquity = !categories.length || categories.some(c => /high.?equity|equity/i.test(c));

    const results: AttomDistressedResult[] = [];

    for (const prop of properties) {
      if (results.length >= maxRecords) break;

      const addr     = prop?.address;
      const owner    = prop?.owner?.owner1;
      const assess   = prop?.assessment;
      const mortgage = prop?.mortgage;
      const avmBlock = prop?.avm;

      const propertyLine1 = (addr?.line1 || "").toLowerCase();
      const mailingLine   = (
        owner?.mailingaddressoneline ||
        owner?.mailAddr?.oneLine ||
        owner?.mailingAddress?.oneLine ||
        ""
      );

      const ownerName = (
        owner?.fullname ||
        owner?.corpname ||
        [owner?.firstName, owner?.lastName].filter(Boolean).join(" ") ||
        null
      ) as string | null;

      const isAbsentee = !!(
        mailingLine &&
        propertyLine1 &&
        !mailingLine.toLowerCase().includes(propertyLine1.split(" ").slice(0, 2).join(" "))
      );

      const assessedValue =
        parseFloat(assess?.assessed?.assdttlvalue || assess?.market?.mktttlvalue || "0") || null;
      const mortgageAmt =
        parseFloat(mortgage?.amount?.fstMtgAmt || "0") || null;
      const avmValue =
        parseFloat(avmBlock?.amount?.value || "0") || assessedValue;

      const equity =
        avmValue != null && mortgageAmt != null
          ? Math.max(0, avmValue - mortgageAmt)
          : avmValue ?? null;
      const equityPercent =
        equity != null && avmValue ? Math.round((equity / avmValue) * 100) : null;

      const isFreeClear = !mortgageAmt || mortgageAmt === 0;
      const isHighEquity = equityPercent != null && equityPercent >= 40;

      const matches =
        (wantAbsentee  && isAbsentee) ||
        (wantFreeClear && isFreeClear) ||
        (wantHighEquity && isHighEquity);

      if (!matches) continue;

      const propertyAddr = [addr?.line1, addr?.locality, addr?.countrySubd]
        .filter(Boolean).join(", ");
      if (!propertyAddr) continue;

      const indicators: string[] = [];
      if (isAbsentee)  indicators.push("Absentee Owner");
      if (isFreeClear) indicators.push("Free & Clear");
      if (isHighEquity) indicators.push("High Equity");

      results.push({
        address:          propertyAddr,
        city:             addr?.locality     || "",
        state:            addr?.countrySubd  || "",
        zip:              addr?.postal1      || zip,
        ownerName,
        mailingAddress:   mailingLine || null,
        isAbsenteeOwner:  isAbsentee,
        avm:              avmValue    ? Math.round(avmValue)    : null,
        assessedValue:    assessedValue ? Math.round(assessedValue) : null,
        mortgageBalance:  mortgageAmt  ? Math.round(mortgageAmt)   : null,
        equity:           equity       ? Math.round(equity)         : null,
        equityPercent,
        distressIndicators: indicators,
        source: "attom",
      });
    }

    logger.info({ zip, count: results.length, categories }, "[ATTOM] fetchDistressedViaAttom completed");
    return results;
  } catch (err: any) {
    logger.warn({ err: err?.message, zip }, "[ATTOM] fetchDistressedViaAttom failed");
    return [];
  }
}

export async function fetchAttomAvm(
  street: string,
  cityStateZip: string,
): Promise<{ value: number; low: number; high: number; confidence: number } | null> {
  try {
    // ✅ Use the Property API endpoint, not the legacy one
    const data = await attomGet("/propertyapi/v1.0.0/avm/detail", {
      address1: street,
      address2: cityStateZip,
    }); 

    const avm = data?.property?.[0]?.avm;
    if (!avm?.amount?.value) return null;

    return {
      value:      Math.round(avm.amount.value),
      low:        Math.round(avm.amount.low   ?? avm.amount.value),
      high:       Math.round(avm.amount.high  ?? avm.amount.value),
      // ✅ Use confidenceScore (numeric) instead of indicatorCode (categorical)
      confidence: avm.confidenceScore ?? 0,
    };
  } catch (err: any) {
    // ✅ Log the full error object for better debugging
    logger.warn({ err }, "[ATTOM] fetchAttomAvm failed");
    return null;
  }
}
