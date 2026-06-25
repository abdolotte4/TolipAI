---
name: PropertyAPI correct format and key rotation
description: How to call PropertyAPI skip-trace and property data endpoints
---

## Skip-Trace
- POST `https://api.propertyapi.co/api/v1/skip-trace`
- Header: `X-Api-Key: <key>`, `Content-Type: application/json`
- Body: `{"lookups":[{"uid":"lead_skip","address":{"street":"...","city":"...","state":"...","zip":"..."}}]}`
- Response: `data[0].phone_1_number`, `data[0].email_1`, etc. (flat fields up to _5)
- 402 = credits exhausted → `markKeyDepleted(key)` and try next key

## Key Rotation Fix (runSkipTrace in propertyApi.ts)
- Previous bug: tried 1 key, got 402, jumped to PDL fallback immediately
- Fixed: loop over `loadApiKeys().length` iterations, calling `getNextApiKey()` + `markKeyDepleted()` on 402, continue to next
- PDL fallback only after ALL keys depleted

## Property Data
- GET `https://api.propertyapi.co/api/v1/parcels/search-by-address?address=FULL+ADDRESS+STRING`
- Header: `X-Api-Key: <key>`
- Returns sqft, beds, baths, year_built, lot_size, etc.
