---
name: Scraper engine proxy routing and deploy mechanism
description: BrightData ISP zone CONNECT tunnel failures for county sites; deploy via Python-Worker GitHub repo; selectolax in requirements but not in old Docker image
---

## Proxy: ERR_TUNNEL_CONNECTION_FAILED for county/gov sites

BrightData ISP zone (port 33335) rejects Playwright CONNECT tunnels for HTTPS gov/county sites.
The fix is in `workers/http_client.py` `fetch_html()`: domain-based proxy routing.

**Rule:**
- `_NO_PROXY_DOMAINS` list (gov, hctax.net, publicnoticetexas.com, broward.org, etc.) → `use_proxy=False` for BOTH `fetch_direct` AND `fetch_crawl4ai`
- `_PROXY_DOMAINS` list (zillow, redfin, propelio, propwire) → `use_proxy=True`
- Everything else → no proxy by default; final Crawl4AI fallback tries no-proxy after proxy fails

**Why:** BrightData ISP zone uses port 33335 which only supports outbound residential browsing, not arbitrary CONNECT tunnels for gov HTTPS endpoints. Direct fetch to county sites works fine — they have no bot protection.

## Deploy mechanism

Code lives in monorepo at `artifacts/TolipAI-scraper-engine/`. Actual deploy repo is `Agawish24/Python-Worker` (GitHub). The monorepo `sync-python-worker.yml` and `deploy-scraper.yml` workflows are DISABLED.

**To deploy code changes:** Push changed files from `artifacts/TolipAI-scraper-engine/` to `Agawish24/Python-Worker` using GitHub API single-commit approach (Git Data API: blobs → tree → commit → ref update), then `deploy.yml` (triggered by push to main touching `workers/**`) auto-builds and deploys to ECR/ECS.

Tokens available in Replit env: `GAWISH_GIT_TOKEN`, `GITHUB_PERSONAL_ACCESS_TOKEN`, `GITHUB_TOKEN`.

## selectolax missing from old Docker image

`selectolax>=0.3.17` IS in `requirements.txt` (line 83) but the running containers were built before it was added. County scrapers log `selectolax not installed — falling back to BeautifulSoup` and BS4 address regex finds nothing. Rebuild fixes this.

## Task definition clean revision

Revs 142 and 143 are both clean (no REALFORECLOSE secrets, ADMIN_API_KEY ARN corrected to `-RrQJVC` suffix). Rev 141 and below had broken ADMIN_API_KEY ARN causing start failures.

## RealForeclose removal

6 distressed_sources.py entries + 4 ai_research.py entries replaced with official county clerk sites (no login). Broward FL → broward.org; Miami-Dade FL → miamidade.gov; Orange FL → myorangeclerk.com; Palm Beach FL → mypalmbeachclerk.com; Pinellas FL → pinellasclerk.org; Hillsborough FL → hillsclerk.com. REALFORECLOSE_USERNAME/PASSWORD AWS secrets deleted.
