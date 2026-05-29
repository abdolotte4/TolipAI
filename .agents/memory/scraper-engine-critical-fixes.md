---
name: Scraper Engine Critical Fixes
description: All 13 fixes applied to the Python scraper engine (12 original + Fix 13 SSL).
---

All fixes applied to `artifacts/TolipAI-scraper-engine/`.

**Fix 1 — /health no longer burns LLM credits**: removed live LLM probes; now only does DB ping + OpenAI key presence check.

**Fix 2A/B/C — Job runner timeouts**: `_run_cash_buyers`, `_run_propelio_cash_buyers`, `_run_propwire_cash_buyers` all wrapped in `asyncio.wait_for(..., timeout=900)`.

**Fix 3 — _run_distressed**: removed dead partial-results code after TimeoutError (wait_for cancels the coro so listings stays []); now fails cleanly with `asyncio.wait_for(..., timeout=480)`.

**Fix 4 — _set_status**: replaced `asyncio.ensure_future` with `loop.create_task`; added `_completed_at` timestamp for eviction.

**Fix 5 — _emit_cloudwatch_emf**: reads METRICS dict snapshot under `_get_metrics_lock()` to prevent torn reads.

**Fix 6 — debug proxy endpoints**: both `/debug/proxy` and `/debug/proxy/zone` changed from `verify=False` to `verify=True`.

**Fix 7A/B — Job memory eviction**: added `_evict_old_jobs()` coroutine (runs every 5 min, evicts completed jobs >1hr old); wired into lifespan startup/shutdown.

**Fix 8 — lead_gen_foreclosure**: wrapped `_run_foreclosure_lead_gen` in `asyncio.wait_for(..., timeout=1800)` via `_timed_foreclosure` inner async fn.

**Fix 9 — /health/providers indentation**: fixed 3-space → 4-space indent on `llm_providers` dict.

**Fix 10 — Dockerfile.fargate**: added `&& update-ca-certificates`; changed `useradd -r` to `useradd -r -m`; added mkdir for `.cache/.local`; added `ENV HOME=/home/scraper` and `ENV CRAWL4AI_DATA_DIR=/tmp/crawl4ai`.

**Fix 11 — ECS task env vars**: AWS Console only — not in repo. Remove GROQ_API_KEY, CEREBRAS_API_KEY etc.; ensure OPENAI_API_KEY is set.

**Fix 12 — llm.py OpenAI-only**: removed all non-OpenAI providers (Groq, Cerebras, Together, NVIDIA, OpenRouter, Moonshot); kept async interface (_chat, _chat_inner, public helpers); kept Bedrock short-circuit; kept circuit breaker + rate-limit backoff.

**config.py has_llm()**: now checks only `openai_api_key` (was checking groq/cerebras/etc. but not openai).

**Fix 13 — SSL verify=False for county/government sites**: `http_client.py` passes `verify=False` to httpx for the main `fetch_page()` call and `verify_ssl=False` to the aiohttp `fetch_direct()` call. Government/county sites routinely use self-signed or expired certs; without this, every scrape request to those domains raised `SSLCertVerificationError` and returned 0 results. The `_ssl_ctx(verify=False)` helper creates an SSL context with `CERT_NONE`. Note: Fix 6's `verify=True` change only affects the `/debug/proxy*` endpoints — the main scraping paths are correctly set to `verify=False`.

**Why:** Free-tier providers (Groq, Cerebras) were causing runaway 429s and credit bleeding. /health probes were burning tokens on every load balancer check. Jobs were hanging indefinitely without timeouts. SSL verification failures were silently returning 0 results on all county property sites.
