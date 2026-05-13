/**
 * Shared API fetch helpers for the CRM frontend.
 * Centralizes auth header injection, 401 redirect, and JSON parsing.
 */

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
    return r.json();
  });
}

/** For non-CRM routes: /api/... (scraper-engine integrations, twilio, etc.) */
export function apiRawFetch(
  path: string, 
  options?: RequestInit & { suppressErrors?: boolean }
): Promise<any> {
  const token = localStorage.getItem("crm_token");
  return fetch(`/api${path}`, {
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
    // ✅ Don't throw if caller suppresses errors (e.g., Twilio not configured)
    if (!r.ok && !options?.suppressErrors) {
      throw new Error(json?.error || `Request failed: ${r.status}`);
    }
    return json;
  });
}