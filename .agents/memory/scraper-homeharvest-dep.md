---
name: Scraper engine homeharvest dependency and lockfile setup
description: homeharvest + pandas are required for the Tier-4 cash-buyer fallback; Dockerfile.base must install from requirements.txt not requirements.lock.
---

## Rule
`homeharvest>=0.5.0` and `pandas>=2.0.0` must be present in both `requirements.txt` and `requirements.in`.

`Dockerfile.base` must `COPY requirements.txt` and `pip install -r requirements.txt` — **not** `requirements.lock`.

`requirements.lock` is maintained as a verbatim copy of `requirements.txt` (for pip-compile workflow compatibility).

## Why
- `cash_buyers.py` added a Tier-4 `homeharvest_scraper` fallback that fires when Zillow + Redfin + Deeds all return zero results. `homeharvest` and its required dependency `pandas` were missing from requirements, so any container without them would crash on import.
- `Dockerfile.base` originally referenced `requirements.lock` which did not exist (the `update-lockfile.sh` script was never run in this repo). This caused every base-image rebuild to fail with a `COPY` error.

## How to apply
- Add both packages to `requirements.txt` and `requirements.in` under a `# Listing data scraping` section
- Keep `requirements.lock` in sync (manual copy) any time `requirements.txt` changes
- `Dockerfile.base` line 27: `COPY requirements.txt ./` and `pip install -r requirements.txt`
