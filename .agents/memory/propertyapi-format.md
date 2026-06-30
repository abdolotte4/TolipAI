---
name: PropertyAPI correct format and key rotation
description: How to call PropertyAPI skip-trace and property data endpoints, key ordering, and retry loop rules
---

## Skip-Trace
- POST `https://propertyapi.co/api/v1/skip-trace` (root domain — `api.propertyapi.co` has no DNS)
- Header: `X-Api-Key: <key>`, `Content-Type: application/json`
- Body: `{"lookups":[{"uid":"lead_skip","address":{"street":"...","city":"...","state":"...","zip":"..."}}]}`
- Response: `data[0].phone_1_number`, `data[0].email_1`, etc. (flat fields up to _5)
- 402 = credits exhausted → `markKeyDepleted(key)` and continue to next key
- 401 = invalid key → also mark depleted and continue (same as skip trace loop behavior)
- Loop over ALL keys before falling back to PDL

## Key Loading Order (critical — PROPERTY_API_KEY must be first)
- `loadApiKeys()` must put `PROPERTY_API_KEY` (legacy/primary) FIRST in the array
- Then PROPERTY_API_KEY_1 through 7 (numbered, often depleted)
- Then SCRAPERAPI_KEY_2/3/4 aliases (if not duplicates)
- **Why:** PROPERTY_API_KEY is the newest key the user adds. If numbered keys come first, all depleted ones get tried before the working key — wasting credits and causing failures.

## fetchPropertyData retry loop
- Must retry on BOTH 402 (credit exhausted) AND 401 (invalid key) — continue to next key
- Only stop retry loop on hard errors: 404 (address not found), 400, 5xx
- Old bug: returned null immediately on any non-402 error, skipping the working key

## PDL Fallback (runSkipTracePDL)
- PDL `/v5/person/enrich` REQUIRES at least one primary identifier: `name`, `email`, `phone`, or `profile`
- Address alone causes 400 "invalid_request"
- Skip the PDL call entirely if no `firstName`/`lastName` is available — saves credits and avoids the 400 error
- Pass `name` param = `${firstName} ${lastName}` when calling PDL

## ATTOM Keys
- Both `ATTOM_API_KEY` and `ATTOM_API_KEY_2` return 401 as of June 2026 — exhausted/unauthorized
- Geocoding, comps, and AVM via ATTOM all fail until keys are renewed
- Comps fallback chain: ATTOM → scraper engine (needs playwright) → AI (currently final fallback)
