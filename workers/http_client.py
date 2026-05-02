"""HTTP fetcher: direct (residential proxy) → Crawl4AI (JS rendering).

ScraperAPI and ScrapingBee are PERMANENTLY REMOVED — credits exhausted.

Tier order per fetch_html() call:
  1. Direct httpx with residential proxy + browser-like headers (fast)
  2. Crawl4AI Playwright rendering (only when render=True and direct fails)

A single persistent httpx.AsyncClient is reused for all API calls to avoid
per-request TCP handshake overhead.  Call init_client() at startup and
close_client() at shutdown (done automatically by the FastAPI lifespan).
"""
from __future__ import annotations

import asyncio
import logging
import random
import ssl
from typing import Any, Optional

import httpx
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from .config import settings

log = logging.getLogger("http")

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
]

# Per-domain header overrides (Zillow, Redfin, etc. check Referer/Accept)
_DOMAIN_HEADERS: dict[str, dict[str, str]] = {
    "zillow.com": {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Cache-Control": "no-cache",
    },
    "redfin.com": {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.redfin.com/",
        "Origin": "https://www.redfin.com",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
    },
}

# Persistent shared client — initialised in lifespan, shared across all requests.
_persistent_client: Optional[httpx.AsyncClient] = None


async def init_client() -> None:
    """Create the module-level persistent client. Call once at startup."""
    global _persistent_client
    if _persistent_client is None or _persistent_client.is_closed:
        _persistent_client = httpx.AsyncClient(timeout=settings.request_timeout)
    log.info("Persistent HTTP client initialised")


async def close_client() -> None:
    """Gracefully close the persistent client. Call once at shutdown."""
    global _persistent_client
    if _persistent_client and not _persistent_client.is_closed:
        await _persistent_client.aclose()
        log.info("Persistent HTTP client closed")


def _build_headers(url: str) -> dict[str, str]:
    """Return browser-like headers, with domain-specific overrides when available."""
    base = {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
    }
    for domain, overrides in _DOMAIN_HEADERS.items():
        if domain in url:
            base.update(overrides)
            break
    # Always rotate User-Agent even with domain overrides
    base["User-Agent"] = random.choice(USER_AGENTS)
    return base


def _ssl_ctx() -> Any:
    """SSL context that ignores cert errors (needed for residential proxy MITM)."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


async def fetch_direct(url: str, *, use_proxy: bool = True,
                       verify_ssl: bool = False) -> str:
    """Plain httpx fetch with rotating UA + optional residential proxy.

    verify_ssl defaults to False because residential proxies use MITM certs.
    """
    proxy = settings.proxy_url() if use_proxy else None
    headers = _build_headers(url)
    ssl_context: Any = _ssl_ctx() if not verify_ssl else True

    async with httpx.AsyncClient(
        timeout=settings.request_timeout,
        proxy=proxy,
        follow_redirects=True,
        headers=headers,
        verify=ssl_context,
    ) as cli:
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(2),
            wait=wait_exponential(min=0.5, max=3),
            retry=retry_if_exception_type(httpx.TransportError),
            reraise=True,
        ):
            with attempt:
                r = await cli.get(url)
                r.raise_for_status()
                return r.text
    return ""  # unreachable


async def fetch_html(url: str, *, render: bool = False,
                     country: str = "us", is_google: bool = False) -> str:
    """Tiered fetch: direct proxy → Crawl4AI (render-only fallback).

    ScraperAPI and ScrapingBee are permanently disabled.
    - Tier 1: direct httpx with residential proxy (works for Zillow, most JSON APIs)
    - Tier 2: Crawl4AI Playwright (only when render=True and direct fails — JS-heavy SPAs)
    """
    errors: list[str] = []

    # Tier 1: Direct fetch with residential proxy
    try:
        return await fetch_direct(url, use_proxy=True, verify_ssl=False)
    except Exception as e:
        errors.append(f"direct: {e}")
        log.debug("Direct fetch failed for %s: %s", url, e)

    # Tier 2: Crawl4AI — Playwright rendering (JS-heavy sites, when direct is blocked)
    if render:
        try:
            return await fetch_crawl4ai(url)
        except Exception as e:
            errors.append(f"crawl4ai: {e}")
            log.info("Crawl4AI failed for %s: %s", url, e)

    raise RuntimeError(f"All fetch tiers failed for {url}: {'; '.join(errors)}")


# ─── Crawl4AI rendered fetch (Playwright, slowest but strongest) ─────────────

async def fetch_crawl4ai(url: str, *, wait_for: Optional[str] = None) -> str:
    """Crawl4AI headless Playwright — for JS-heavy sites that block direct fetches.

    Raises RuntimeError if Playwright is unavailable so callers can fall through.
    """
    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
    except (ImportError, OSError) as e:
        raise RuntimeError(f"Crawl4AI unavailable: {e}") from e

    try:
        cfg = BrowserConfig(
            headless=True,
            proxy=settings.proxy_url(),
            user_agent=random.choice(USER_AGENTS),
            ignore_https_errors=True,
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


# ─── Small helpers ────────────────────────────────────────────────────────────

async def polite_sleep(min_ms: int = 250, max_ms: int = 800) -> None:
    await asyncio.sleep(random.randint(min_ms, max_ms) / 1000)
