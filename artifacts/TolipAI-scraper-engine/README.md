# TolipAI Scraper Engine

FastAPI service that powers the **advanced scraping + skip-trace + investor
classification** pipeline for the TolipAI CRM/Tools platform. The Express
api-server proxies authenticated requests here under `/api/scraper-engine/*`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET  | `/health`                 | Health check (proxy + Kimi reachability) |
| POST | `/scrape/cash-buyers`     | Find investors active in a ZIP/county and classify them (flipper/landlord/lender/hedge_fund/wholesaler) |
| POST | `/scrape/distressed`      | Pull distressed properties from trustee sales / auction.com / Zillow / Redfin / county tax collector |
| POST | `/scrape/skip-trace`      | Skip trace an LLC or individual: phones, emails, principals |
| GET  | `/jobs/{job_id}`          | Job status + results (also persisted to Postgres) |

All long-running scrapes run as **background asyncio tasks**, so HTTP returns
in <100ms with a `jobId` you can poll...

## Stack

- **Crawl4AI** + **Playwright (Chromium headless-shell)** — rendered HTML
- **ScraperAPI / ScrapingBee** — first-line "easy mode" with auto-CAPTCHA
- **Oxylabs / BrightData residential proxies** — fallback for hardened sites
- **Kimi K2 via NVIDIA API** (Moonshot fallback) — turns raw HTML/markdown into
  structured investor profiles, classifies buyer type, scores match quality
- **Postgres** (shared `DATABASE_URL`) — job + results persistence

## Local development

```bash
# from repo root
PORT=8765 uvicorn workers.main:app --host 0.0.0.0 --port 8765 --reload \
  --app-dir artifacts/TolipAI-scraper-engine
```

## Railway deployment

Deploy this directory as its own service with `Procfile`. Set the
`SCRAPER_ENGINE_URL` env var on the api-server service to its internal URL
(e.g. `http://TolipAI-scraper-engine.railway.internal:8765`).

## Required env vars

See repo `.env.example` — the engine reads:
`DATABASE_URL`, `MOONSHOT_KIMI_API_KEY`, `NVIDIA_API_KEY`,
`SCRAPERAPI_KEY[_2..4]`, `WEBSCRAPER_API_KEY`, `OXYLABS_USERNAME/PASSWORD`,
`BRIGHTDATA_API`, `BRIGHTDATA_PASSWORD/BRIGHTDATA_USERNAME`, `PROPERTY_API_KEY[_1..7]`.
