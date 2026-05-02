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
        signal: AbortSignal.timeout(15000),
      });

      if (res.status === 401 || res.status === 403) {
        _depletedAttomKeys.add(key);
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
): Promise<AttomComp[]> {
  // Pull a much larger raw pool so post-filter we still have plenty of usable comps.
  const data = await attomGet("/propertyapi/v1.0.0/sale/snapshot", {
    latitude: lat,
    longitude: lng,
    radius: radiusMiles,
    pagesize: 100,
  });

  const sales: any[] = data?.property || [];
  const TWO_YEARS_AGO = new Date();
  TWO_YEARS_AGO.setMonth(TWO_YEARS_AGO.getMonth() - 24);

  const comps: AttomComp[] = [];
  const excluded: Record<string, number> = { noPrice: 0, oldSale: 0, multiFamily: 0, sqftMismatch: 0 };

  // Only filter multi-family if the subject is *explicitly* single-family.
  // (Was: also triggered when subjectPropertyType was missing → over-filtered.)
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

    // Wider sqft band so we don't drop too many comps.
    // (Was 1.75 / 0.57 — too tight on small subjects.)
    const compSqft: number | undefined = sale?.building?.size?.universalsize;
    if (subjectSqft && compSqft) {
      const ratio = compSqft / subjectSqft;
      if (ratio > 2.0 || ratio < 0.5) { excluded.sqftMismatch++; continue; }
    }
    const addr 
      = sale?.address;
    const fullAddr = [addr?.line1, addr?.locality, addr?.countrySubd]
      .filter(Boolean).join(", ");

    const soldDate = saleDateRaw
      ? new Date(saleDateRaw).toISOString().split("T")[0]!
      : "";

    comps.push({
      address: fullAddr,
      beds: sale?.building?.rooms?.bedroomscount || undefined,
      baths: sale?.building?.rooms?.bathstotal || undefined,
      sqft: sale?.building?.size?.universalsize || undefined,
      yearBuilt: sale?.summary?.yearbuilt || undefined,
      salePrice,
      soldDate,
      propertyType: sale?.summary?.proptype || undefined,
    });

    if (comps.length >= maxComps) break;
  }

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
    const ownerName = str(
      prop?.owner?.owner1?.fullname ??
      prop?.owner?.owner1?.firstName + (prop?.owner?.owner1?.lastName ? " " + prop.owner.owner1.lastName : "") ||
      prop?.owner?.owner1?.lastName ??
      prop?.owner?.owner1?.corpname ??
      evt?.owner?.owner1?.fullname ??
      evt?.owner?.owner1?.lastName ??
      evt?.owner?.owner1?.corpname,
    );

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
