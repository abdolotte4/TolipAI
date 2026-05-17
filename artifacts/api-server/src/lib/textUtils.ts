/**
 * Strips markdown code fences from LLM output so the result can be parsed as JSON.
 * Handles ```json ... ```, ``` ... ```, and bare JSON responses.
 */
export function stripJsonMarkdown(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

/**
 * Escapes a value for use inside a CSV cell.
 * Wraps in double-quotes and escapes internal double-quotes when the value
 * contains commas, double-quotes, or newlines.
 */
export function csvCell(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
