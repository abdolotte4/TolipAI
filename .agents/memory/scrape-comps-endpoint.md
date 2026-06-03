---
name: scrape/comps Python endpoint
description: POST /scrape/comps exists in Python main.py; tries Propelio V2 first (if env creds), falls back to Propwire. Node crm/leads.ts calls it directly.
---

## Rule
Python `main.py` exposes `POST /scrape/comps` using `CompsRequest { address, radius_miles, max_results }`.
Node `crm/leads.ts:fetchCompsViaScraperEngine()` calls it at `${SCRAPER_ENGINE_URL}/scrape/comps`, then falls back to `/scrape/propwire/comps` if empty.

## Why
The Node.js CRM comps flow tried `/scrape/comps` first (Propelio, authenticated) but Python had no such endpoint — only `/scrape/propwire/comps`. This caused a 404 on every comps fetch attempt from the CRM, silently returning [] and falling through to the propwire direct call.

## How to apply
- Endpoint added after line 1482 in main.py.
- `CompsRequest` model added near line 394 in main.py.
- Propelio V2 path: `search_property(address)` → `fetch_comps(property_id, radius_miles=...)`. Skipped if `PROPELIO_EMAIL`/`PROPELIO_PASSWORD` env vars absent.
- Propwire fallback: `propwire.fetch_comps(address, max_results=...)` — always attempted if Propelio fails/returns empty.
- Returns `{ address, count, comps, source }`.
