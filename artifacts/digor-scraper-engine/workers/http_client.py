"""Smart HTTP fetcher: ScraperAPI → ScrapingBee → direct (proxy).

Each tier knows when to escalate.  We rotate keys round-robin and remember
exhausted ones in-memory for the lifetime of the process.

Circuit breakers: each tier is attempted at most once per unique failure mode
(exhausted keys, repeated 400s).  The same error is never logged twice.

A single persistent httpx.AsyncClient is reused for all API calls to avoid
per-request TCP handshake overhead.  Call init_client() at startup and
close_client() at shutdown (done automatically by the FastAPI lifespan).
"""
from __future__ import annotations

import asyncio
import logging
import random
import ssl
from typing import Any, Dict, Optional, Set

import httpx
from tenacity import AsyncRetrying, stop_after_attempt, wait_exponential, retry_if_exception_type

from .config import settings

log = logging.getLogger("http")

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
]

_exhausted: Set[str] = set()
_sapi_rr: int = 0
_sbee_rr: int = 0

# Circuit breakers: tier name → True means dead for this process run
_tier_dead: Set[str] = set()

# Persistent shared client — initialised in lifespan, shared across all requests.
_persistent_client: Optional[httpx.AsyncClient] = None


async def init_client() -> None:
    """Create the module-level persistent client.  Call once at startup."""
    global _persistent_client
    if _persistent_client is None or _persistent_client.is_closed:
        _persistent_client = httpx.AsyncClient(timeout=settings.request_timeout)
    log.info("Persistent HTTP client initialised")


async def close_client() -> None:
    """Gracefully close the persistent client.  Call once at shutdown."""
    global _persistent_client
    if _persistent_client and not _persistent_client.is_closed:
        await _persistent_client.aclose()
        log.info("Persistent HTTP client closed")


def _get_client() -> httpx.AsyncClient:
    """Return the shared client, falling back to a temporary one if startup hasn't run."""
    if _persistent_client and not _persistent_client.is_closed:
        return _persistent_client
    log.warning("Persistent client not initialised — creating a one-shot client")
    return httpx.AsyncClient(timeout=settings.request_timeout)


def _scraperapi_keys() -> list[str]:
    return [k for k in settings.scraperapi_keys if k not in _exhausted]


def _scrapingbee_keys() -> list[str]:
    return [k for k in settings.scrapingbee_keys if k not in _exhausted]


_key_403_hits: Dict[str, int] = {}
_KEY_403_LIMIT = 1  # mark exhausted after the first 403 (ScraperAPI returns plain 403 on credit exhaustion)


def _is_exhausted(text: str, status: int, key: str = "") -> bool:
    """A key is exhausted when:
    - status 402 (explicit payment required), OR
    - 403 with "exhausted"/"quota"/"credits" text, OR
    - 403 received twice in a row (ScraperAPI returns plain 403 when out of credits)
    """
    t = (text or "").lower()
    if status == 402:
        return True
    if status == 403:
        if any(w in t for w in ("exhausted", "quota", "credits", "out of", "limit")):
            return True
        if key:
            hits = _key_403_hits.get(key, 0) + 1
            _key_403_hits[key] = hits
            if hits >= _KEY_403_LIMIT:
                return True
    else:
        # Reset hit counter on any success or non-403 status
        if key and key in _key_403_hits:
            _key_403_hits[key] = 0
    return False


async def fetch_via_scraperapi(url: str, *, render: bool = False,
                               country: str = "us", premium: bool = False) -> str:
    global _sapi_rr
    if "scraperapi" in _tier_dead:
        raise RuntimeError("ScraperAPI disabled (all keys exhausted)")
    keys = _scraperapi_keys()
    if not keys:
        _tier_dead.add("scraperapi")
        raise RuntimeError("ScraperAPI keys exhausted")
    last_err: Optional[Exception] = None
    cli = _get_client()
    for i in range(len(keys)):
        key = keys[(_sapi_rr + i) % len(keys)]
        params: Dict[str, Any] = {
            "api_key": key, "url": url, "country_code": country,
            "render": "true" if render else "false",
        }
        if premium:
            params["premium"] = "true"
        try:
            r = await cli.get("https://api.scraperapi.com/", params=params)
            if _is_exhausted(r.text, r.status_code, key):
                _exhausted.add(key)
                log.warning("ScraperAPI key …%s exhausted", key[-6:])
                continue
            if r.status_code >= 400:
                last_err = RuntimeError(f"ScraperAPI {r.status_code}: {r.text[:200]}")
                continue
            _sapi_rr = (_sapi_rr + i + 1)
            return r.text
        except httpx.HTTPError as e:
            last_err = e
    if last_err:
        raise last_err
    raise RuntimeError("ScraperAPI: no success")


async def fetch_via_scrapingbee(url: str, *, render: bool = True,
                                premium: bool = True,
                                is_google: bool = False) -> str:
    global _sbee_rr
    if "scrapingbee" in _tier_dead:
        raise RuntimeError("ScrapingBee disabled (all keys exhausted)")
    keys = _scrapingbee_keys()
    if not keys:
        _tier_dead.add("scrapingbee")
        raise RuntimeError("ScrapingBee keys exhausted")
    last_err: Optional[Exception] = None
    cli = _get_client()
    for i in range(len(keys)):
        key = keys[(_sbee_rr + i) % len(keys)]
        params: Dict[str, Any] = {
            "api_key": key, "url": url,
            "render_js": "true" if render else "false",
            "premium_proxy": "true" if premium else "false",
            "block_ads": "true",
            "wait": "2000",
        }
        # Google search requires the custom_google=True flag or ScrapingBee returns 400
        if is_google or "google.com/search" in url:
            params["custom_google"] = "true"
        try:
            r = await cli.get("https://app.scrapingbee.com/api/v1/", params=params)
            if _is_exhausted(r.text, r.status_code, key):
                _exhausted.add(key)
                log.warning("ScrapingBee key …%s exhausted", key[-6:])
                continue
            if r.status_code == 400 and "custom_google" in r.text.lower():
                # Should be fixed by the param above — log once and continue
                last_err = RuntimeError(f"ScrapingBee 400 custom_google: {r.text[:200]}")
                continue
            if r.status_code >= 400:
                last_err = RuntimeError(f"ScrapingBee {r.status_code}: {r.text[:200]}")
                continue
            _sbee_rr = (_sbee_rr + i + 1)
            return r.text
        except httpx.HTTPError as e:
            last_err = e
    if last_err:
        raise last_err
    raise RuntimeError("ScrapingBee: no success")


async def fetch_direct(url: str, *, use_proxy: bool = True,
                       verify_ssl: bool = True) -> str:
    """Plain httpx fetch with rotating UA + optional residential proxy.

    Pass verify_ssl=False for sites with self-signed or expired certificates.
    """
    proxy = settings.proxy_url() if use_proxy else None
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    # Build SSL context — disable verification only when explicitly requested
    ssl_ctx: Any = True
    if not verify_ssl:
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE

    async with httpx.AsyncClient(timeout=settings.request_timeout, proxy=proxy,
                                 follow_redirects=True, headers=headers,
                                 verify=ssl_ctx) as cli:
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(2),
            wait=wait_exponential(min=0.5, max=2),
            retry=retry_if_exception_type(httpx.HTTPError),
            reraise=True,
        ):
            with attempt:
                r = await cli.get(url)
                r.raise_for_status()
                return r.text
    return ""  # unreachable


async def fetch_html(url: str, *, render: bool = False, country: str = "us",
                     is_google: bool = False) -> str:
    """Tiered fetch — ScrapingBee → Crawl4AI → direct (proxy).

    ScraperAPI is tried only if keys are available and not all exhausted.
    Crawl4AI (our local Playwright-based engine) is the strongest free tier
    for JS-heavy pages and is preferred over bare direct fetches.
    Raises if all tiers fail.
    """
    errors: list[str] = []

    # Tier 1: ScraperAPI (paid, try only if keys are alive)
    if _scraperapi_keys() and "scraperapi" not in _tier_dead:
        try:
            return await fetch_via_scraperapi(url, render=render, country=country)
        except Exception as e:
            errors.append(f"sapi: {e}")
            log.info("ScraperAPI failed: %s", e)

    # Tier 2: ScrapingBee (paid, try only if keys are alive)
    if _scrapingbee_keys() and "scrapingbee" not in _tier_dead:
        try:
            return await fetch_via_scrapingbee(url, render=render, premium=True,
                                               is_google=is_google)
        except Exception as e:
            errors.append(f"sbee: {e}")
            log.info("ScrapingBee failed: %s", e)

    # Tier 3: Crawl4AI — our free Playwright-based engine (strong JS rendering)
    if render:
        try:
            return await fetch_crawl4ai(url)
        except Exception as e:
            errors.append(f"crawl4ai: {e}")
            log.info("Crawl4AI failed: %s", e)

    # Tier 4: Plain direct fetch with residential proxy
    try:
        return await fetch_direct(url, use_proxy=True, verify_ssl=False)
    except Exception as e:
        errors.append(f"direct: {e}")
        raise RuntimeError(f"All fetch tiers failed for {url}: {'; '.join(errors)}")


# ─── Crawl4AI rendered fetch (slowest, strongest) ───────────────────────────

async def fetch_crawl4ai(url: str, *, wait_for: Optional[str] = None) -> str:
    """Use Crawl4AI's headless browser when JS rendering + DOM is essential.

    Raises RuntimeError if Crawl4AI/Playwright is unavailable (e.g. missing
    system library libglib-2.0 in the Railway container) so the caller can
    fall through to the next tier without crashing.
    """
    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
    except (ImportError, OSError) as e:
        raise RuntimeError(f"Crawl4AI unavailable (import/library error): {e}") from e

    try:
        cfg = BrowserConfig(
            headless=True,
            proxy=settings.proxy_url(),
            user_agent=random.choice(USER_AGENTS),
        )
        run_cfg = CrawlerRunConfig(
            cache_mode=CacheMode.BYPASS,
            word_count_threshold=10,
            wait_for=wait_for,
        )
        async with AsyncWebCrawler(config=cfg) as crawler:
            result = await crawler.arun(url=url, config=run_cfg)
            if not result.success:
                raise RuntimeError(f"Crawl4AI failed: {result.error_message}")
            return result.markdown or result.html or ""
    except RuntimeError:
        raise
    except OSError as e:
        raise RuntimeError(f"Crawl4AI system dependency missing: {e}") from e


# ─── Small await helpers ─────────────────────────────────────────────────────

async def polite_sleep(min_ms: int = 250, max_ms: int = 800) -> None:
    await asyncio.sleep(random.randint(min_ms, max_ms) / 1000)
