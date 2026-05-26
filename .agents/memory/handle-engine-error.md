---
name: handleEngineError status propagation
description: Express bridge helper propagates upstream HTTP status codes so clients get correct 404/422/etc instead of always 500.
---

## Rule

`handleEngineError` in `scraperEngine.ts` checks `(err as any).status` (set by `scraperEngineClient.ts` when upstream returns non-2xx) and uses it as the HTTP response status.

**Why:** The `scraperEngineClient.ts` `request()` function does `(err as any).status = res.status` on non-OK responses. Without the status propagation in `handleEngineError`, every upstream 404/422 became a 500 to the client.

**How to apply:** When adding new routes that call `scraperEngine.*` methods and catch errors with `handleEngineError`, this propagation is automatic. For routes using the raw catch-all proxy (`fetch` directly), status is already propagated via `res.status(upstream.status)`.
