/**
 * Shared API fetch helpers for the CRM frontend.
 * Centralizes auth header injection, 401 redirect, and JSON parsing.
 *
 * 401 logout guard: only redirect to /login if the failing path is a
 * CRM-auth–protected route (/api/crm/..., /api/twilio/..., /api/openphone/...).
 * Scraper / tools routes use PIN auth (returns 403 on wrong PIN) and must
 * never trigger a logout — the fix in scraper.ts now returns 403, but we also
 * guard here so any future regression doesn't log the user out.
 */

const NON_AUTH_PREFIXES = ["/api/scraper/", "/api/tools/", "/api/scraper-engine/"];

function shouldLogoutOn401(path: string): boolean {
  for (const prefix of NON_AUTH_PREFIXES) {
    if (path.includes(prefix)) return false;
  }
  return true;
}

/** For CRM routes: /api/crm/... */
export function apiFetch(path: string, options?: RequestInit): Promise<any> {
  const token = localStorage.getItem("crm_token");
  return fetch(`/api/crm${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
  }).then(async (r) => {
    if (r.status === 401) {
      localStorage.removeItem("crm_token");
      window.location.href = "/login";
      throw new Error("Session expired — please log in again.");
    }
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(json?.error || `Request failed (${r.status}): ${JSON.stringify(json)}`);
    }
    return json;
  });
}

/** For non-CRM routes: /api/... (twilio, scraper, tools, etc.) */
export function apiRawFetch(
  path: string,
  options?: RequestInit & { suppressErrors?: boolean }
): Promise<any> {
  const token = localStorage.getItem("crm_token");
  const fullPath = `/api${path}`;
  return fetch(fullPath, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
  }).then(async (r) => {
    if (r.status === 401 && shouldLogoutOn401(fullPath)) {
      localStorage.removeItem("crm_token");
      window.location.href = "/login";
      throw new Error("Session expired — please log in again.");
    }
    const json = await r.json().catch(() => ({}));
    if (!r.ok && !options?.suppressErrors) {
      throw new Error(json?.error || `Request failed (${r.status}): ${JSON.stringify(json)}`);
    }
    return json;
  });
}
