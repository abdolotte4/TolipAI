"""Smart HTTP fetcher: ScraperAPI → ScrapingBee → Crawl4AI/Playwright (proxy).

Each tier knows when to escalate. We rotate keys round-robin and remember
exhausted ones in-memory for the lifetime of the process.
"""
from __future__ import annotations

import asyncio
import logging
import random
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


def _scraperapi_keys() -> list[str]:
    return [k for k in settings.scraperapi_keys if k not in _exhausted]


def _scrapingbee_keys() -> list[str]:
    return [k for k in settings.scrapingbee_keys if k not in _exhausted]


def _is_exhausted(text: str, status: int) -> bool:
    t = (text or "").lower()
    if status == 403 and ("exhausted" in t or "quota" in t or "credits" in t):
        return True
    return status == 402


async def fetch_via_scraperapi(url: str, *, render: bool = False,
                               country: str = "us", premium: bool = False) -> str:
    global _sapi_rr
    keys = _scraperapi_keys()
    if not keys:
        raise RuntimeError("ScraperAPI keys exhausted")
    last_err: Optional[Exception] = None
    async with httpx.AsyncClient(timeout=settings.request_timeout) as cli:
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
                if _is_exhausted(r.text, r.status_code):
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
                                premium: bool = True) -> str:
    global _sbee_rr
    keys = _scrapingbee_keys()
    if not keys:
        raise RuntimeError("ScrapingBee keys exhausted")
    last_err: Optional[Exception] = None
    async with httpx.AsyncClient(timeout=settings.request_timeout) as cli:
        for i in range(len(keys)):
            key = keys[(_sbee_rr + i) % len(keys)]
            params: Dict[str, Any] = {
                "api_key": key, "url": url,
                "render_js": "true" if render else "false",
                "premium_proxy": "true" if premium else "false",
                "block_ads": "true",
                "wait": "2000",
            }
            try:
                r = await cli.get("https://app.scrapingbee.com/api/v1/", params=params)
                if _is_exhausted(r.text, r.status_code):
                    _exhausted.add(key)
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


async def fetch_direct(url: str, *, use_proxy: bool = True) -> str:
    """Plain httpx fetch with rotating UA + optional residential proxy."""
    proxy = settings.proxy_url() if use_proxy else None
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    async with httpx.AsyncClient(timeout=settings.request_timeout, proxy=proxy,
                                 follow_redirects=True, headers=headers) as cli:
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


async def fetch_html(url: str, *, render: bool = False, country: str = "us") -> str:
    """Tiered fetch — ScraperAPI → ScrapingBee → direct (proxy).

    Returns rendered HTML when `render=True` is honoured by the chosen tier.
    Raises if all tiers fail.
    """
    errors: list[str] = []
    if _scraperapi_keys():
        try:
            return await fetch_via_scraperapi(url, render=render, country=country)
        except Exception as e:  # noqa: BLE001
            errors.append(f"sapi: {e}")
            log.info("ScraperAPI failed: %s", e)
    if _scrapingbee_keys():
        try:
            return await fetch_via_scrapingbee(url, render=render, premium=True)
        except Exception as e:  # noqa: BLE001
            errors.append(f"sbee: {e}")
            log.info("ScrapingBee failed: %s", e)
    try:
        return await fetch_direct(url, use_proxy=True)
    except Exception as e:  # noqa: BLE001
        errors.append(f"direct: {e}")
        raise RuntimeError(f"All fetch tiers failed for {url}: {'; '.join(errors)}")


# ─── Crawl4AI rendered fetch (slowest, strongest) ───────────────────────────

async def fetch_crawl4ai(url: str, *, wait_for: Optional[str] = None) -> str:
    """Use Crawl4AI's headless browser when JS rendering + DOM is essential."""
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

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
        # Prefer markdown for LLM consumption; fall back to HTML.
        return result.markdown or result.html or ""


# ─── Small await helpers ─────────────────────────────────────────────────────

async def polite_sleep(min_ms: int = 250, max_ms: int = 800) -> None:
    await asyncio.sleep(random.randint(min_ms, max_ms) / 1000)
