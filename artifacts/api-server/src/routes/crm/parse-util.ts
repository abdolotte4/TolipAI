import { Response } from "express";

/**
 * Safely parse an integer path/query parameter.
 * Returns the integer on success, or sends a 400 and returns null.
 * Usage:
 *   const id = parseIntParam(req.params.id, res, "id");
 *   if (id === null) return;
 */
export function parseIntParam(
  raw: string | undefined,
  res: Response,
  name = "id"
): number | null {
  const n = parseInt(raw ?? "", 10);
  if (isNaN(n) || n <= 0) {
    res.status(400).json({ error: `Invalid ${name}: must be a positive integer` });
    return null;
  }
  return n;
}

/**
 * Safely parse an optional integer (returns undefined if not provided).
 * Returns the integer, undefined, or sends 400 and returns null.
 */
export function parseOptionalIntParam(
  raw: string | undefined,
  res: Response,
  name = "id"
): number | undefined | null {
  if (raw === undefined || raw === "") return undefined;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) {
    res.status(400).json({ error: `Invalid ${name}: must be a positive integer` });
    return null;
  }
  return n;
}
