/**
 * coreCalculations.ts — Single source of truth for all shared math & formatting helpers.
 *
 * Re-exports calculation functions from propertyApi so callers can import everything
 * from one place. Route files MUST import from here, never duplicate these utilities.
 */

export {
  getMaoDiscount,
  calculateMao,
  calculateArvFromComps,
  calculateAdjustedComp,
  estimateMarketPricePerSqft,
} from "./propertyApi";

/**
 * Parse any money-like value (string, number, null, undefined) to a JS number.
 * Returns null for empty / non-numeric input.
 */
export function parseMoney(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(v as string);
  return isNaN(n) ? null : n;
}

/**
 * Normalise any US phone number to E.164 format (+1XXXXXXXXXX).
 * Handles: (555) 555-1234, 555-555-1234, +15551234, etc.
 */
export function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return phone;
}

/**
 * Format a number as a USD currency string (no cents).
 * e.g. 325000 → "$325,000"
 */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
