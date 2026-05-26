"""HTTP fetcher: direct (residential proxy) → Crawl4AI (JS rendering + PDF support).

ScraperAPI and ScrapingBee are PERMANENTLY REMOVED — credits exhausted.

Tier order per fetch_html() call:
  1. Direct httpx with residential proxy + browser-like headers (fast)
  2. Crawl4AI Playwright rendering (only when render=True and direct fails)
  3. PDF detection: return raw bytes if response is a PDF

A single persistent httpx.AsyncClient is reused for all API calls to avoid
per-request TCP handshake overhead. Call init_client() at startup and
close_client() at shutdown (done automatically by the FastAPI lifespan).

OOM protection: at most BROWSER_MAX_CONCURRENT Playwright/Crawl4AI browser
contexts run simultaneously. Excess requests wait on the semaphore.
"""

from __future__ import annotations
import asyncio
import io
import logging
import os
import random
import ssl
from typing import Any, Dict, Optional
import httpx
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)
from .config import settings

log = logging.getLogger("http")

# ─── Browser concurrency guard (OOM prevention) ───────────────────────────────
# Default 2 concurrent Playwright/Crawl4AI sessions.  Each Chromium instance
# can consume 200-400 MB; keep this low on Railway Hobby (512 MB) or Starter
# (1 GB).  Set BROWSER_MAX_CONCURRENT=1 on very memory-constrained plans.
_BROWSER_SEM: Optional[asyncio.Semaphore] = None


def _browser_sem() -> asyncio.Semaphore:
    global _BROWSER_SEM
    if _BROWSER_SEM is None:
        limit = int(os.getenv("BROWSER_MAX_CONCURRENT", "2"))
        _BROWSER_SEM = asyncio.Semaphore(limit)
    return _BROWSER_SEM


# Government / county sites that block residential proxies
_PROXY_BLOCKED_DOMAINS = (
    "treasurer.cuyahoga",
    "auditor.cuyahoga",
    "probate.cuyahoga",
    "cuyahogacounty.us",
    "sheriffsaleauction.ohio.gov",
    ".state.oh.us",
    ".state.nc.us",
    ".state.tx.us",
    ".state.fl.us",
    "hctax.net",
    "lacounty.gov",
    "ttc.lacounty",
    "cclerk.hctx",
    "octaxcol.com",
    "broward.county-taxes",
)


def _should_skip_proxy(url: str) -> bool:
    u = url.lower()
    return any(d in u for d in _PROXY_BLOCKED_DOMAINS)


USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
]

_DOMAIN_HEADERS: dict[str, dict[str, str]] = {
    "zillow.com": {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    },
    "redfin.com": {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.redfin.com/",
        "Origin": "https://www.redfin.com",
    },
}

# Import the canonical stealth script from _browser_session to avoid duplication.
from .scrapers._browser_session import _STEALTH_SCRIPT as _STEALTH_JS

# Persistent shared client
_persistent_client: Optional[httpx.AsyncClient] = None


async def init_client() -> None:
    global _persistent_client
    if _persistent_client is None or _persistent_client.is_closed:
        # verify=False — government/county sites routinely use self-signed certs
        # or broken cert chains. Since we are a scraper, not a security client,
        # disabling SSL verification is safe and prevents the majority of
        # "CERTIFICATE_VERIFY_FAILED" failures on public-record portals.
        _persistent_client = httpx.AsyncClient(
            timeout=settings.request_timeout,
            verify=False,
        )
    log.info("Persistent HTTP client initialised")


async def close_client() -> None:
    if _persistent_client and not _persistent_client.is_closed:
        await _persistent_client.aclose()
        log.info("Persistent HTTP client closed")


def _build_headers(url: str) -> dict[str, str]:
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
    base["User-Agent"] = random.choice(USER_AGENTS)
    return base


def _ssl_ctx(verify: bool = False) -> Any:
    if verify:
        return True  # httpx uses OS trust store
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


# ─── Direct fetch ────────────────────────────────────────────────────────────
async def fetch_direct(url: str, *, use_proxy: bool = True, verify_ssl: bool = True) -> Any:
    """Plain httpx fetch with rotating UA + optional residential proxy.
    Returns .text for HTML, raw bytes for PDFs.
    Reuses the persistent client (connection pooling) when no proxy is needed.
    """
    proxy = settings.proxy_url() if use_proxy else None
    headers = _build_headers(url)
    ssl_context: Any = _ssl_ctx(verify=verify_ssl)

    async def _do_request(cli: httpx.AsyncClient) -> Any:
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(2),
            wait=wait_exponential(min=0.5, max=3),
            retry=retry_if_exception_type(httpx.TransportError),
            reraise=True,
        ):
            with attempt:
                r = await cli.get(url, headers=headers, follow_redirects=True)
                r.raise_for_status()
                ctype = r.headers.get("Content-Type", "").lower()
                if "pdf" in ctype or url.lower().endswith(".pdf"):
                    return r.content  # raw bytes
                return r.text
        return ""

    if proxy is None and _persistent_client and not _persistent_client.is_closed:
        return await _do_request(_persistent_client)

    async with httpx.AsyncClient(
        timeout=settings.request_timeout,
        proxy=proxy,
        follow_redirects=True,
        verify=ssl_context,
    ) as cli:
        return await _do_request(cli)


# ─── Tiered fetch ────────────────────────────────────────────────────────────
async def fetch_html(url: str, *, render: bool = False, country: str = "us", is_google: bool = False) -> Any:
    """Tiered fetch: direct proxy → Crawl4AI (render-only fallback).
    Returns HTML text or raw PDF bytes.
    """
    errors: list[str] = []
    gov_site = _should_skip_proxy(url)

    try:
        return await fetch_direct(url, use_proxy=not gov_site, verify_ssl=False)
    except Exception as e:
        errors.append(f"direct: {e}")
        log.debug("Direct fetch failed for %s: %s", url, e)

    if render:
        try:
            return await fetch_crawl4ai(url, use_proxy=not gov_site)
        except Exception as e:
            errors.append(f"crawl4ai: {e}")
            log.info("Crawl4AI failed for %s: %s", url, e)

    raise RuntimeError(f"All fetch tiers failed for {url}: {'; '.join(errors)}")


# ─── Crawl4AI rendered fetch ─────────────────────────────────────────────────
async def fetch_crawl4ai(url: str, *, wait_for: Optional[str] = None, use_proxy: bool = True) -> Any:
    """Playwright-based render with stealth patches.

    Guarded by _browser_sem() so at most BROWSER_MAX_CONCURRENT Chromium
    instances run concurrently — prevents OOM kills on Railway.
    """
    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
    except (ImportError, OSError) as e:
        raise RuntimeError(f"Crawl4AI unavailable: {e}") from e

    # Determine proxy config dict
    _proxy_cfg: Optional[Dict[str, str]] = None
    if use_proxy:
        _proxy_cfg = settings.proxy_dict()
        if _proxy_cfg is None and settings.proxy_url():
            # Fallback: parse proxy_url() manually
            from urllib.parse import urlparse as _urlparse

            _u = _urlparse(settings.proxy_url() or "")
            _proxy_cfg = {"server": f"{_u.scheme}://{_u.hostname}:{_u.port}"}
            if _u.username:
                _proxy_cfg["username"] = _u.username
            if _u.password:
                _proxy_cfg["password"] = _u.password

    # Extra Chromium args for stealth + memory efficiency
    extra_args = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--window-size=1920,1080",
        "--start-maximized",
        "--disable-extensions",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
    ]

    # Zillow-specific: wait for the listing grid before returning
    _wait_for = wait_for
    if _wait_for is None and "zillow.com" in url:
        # Wait for either the listing cards or the __NEXT_DATA__ script
        _wait_for = "css:#__NEXT_DATA__"

    # BrowserConfig — only pass well-known stable kwargs
    _browser_kwargs: Dict[str, Any] = dict(
        headless=True,
        proxy_config=_proxy_cfg,
        user_agent=random.choice(USER_AGENTS),
        ignore_https_errors=True,
        extra_args=extra_args,
        java_script_enabled=True,
    )
    cfg = BrowserConfig(**_browser_kwargs)

    # CrawlerRunConfig — build defensively; newer crawl4ai features are
    # injected only when the constructor accepts them.
    import inspect as _inspect

    _run_params = set(_inspect.signature(CrawlerRunConfig.__init__).parameters)

    _run_kwargs: Dict[str, Any] = dict(
        cache_mode=CacheMode.BYPASS,
        word_count_threshold=10,
        wait_for=_wait_for,
    )
    # page_timeout: 60 s — available in crawl4ai >= 0.3
    if "page_timeout" in _run_params:
        _run_kwargs["page_timeout"] = 60000
    # js_code: injected after page load for stealth
    if "js_code" in _run_params:
        _run_kwargs["js_code"] = _STEALTH_JS
    # delay_before_return_html: let SPA hydrate
    if "delay_before_return_html" in _run_params:
        _run_kwargs["delay_before_return_html"] = 2.5
    # simulate_user: jitter mouse/scroll to beat behavioural fingerprinting
    if "simulate_user" in _run_params:
        _run_kwargs["simulate_user"] = True
    # override_navigator: crawl4ai built-in webdriver spoof
    if "override_navigator" in _run_params:
        _run_kwargs["override_navigator"] = True
    # magic: crawl4ai comprehensive anti-bot mode
    if "magic" in _run_params:
        _run_kwargs["magic"] = True
    run_cfg = CrawlerRunConfig(**_run_kwargs)

    async with _browser_sem():
        try:
            async with AsyncWebCrawler(config=cfg) as crawler:
                result = await crawler.arun(url=url, config=run_cfg)
                if not result.success:
                    # ERR_HTTP_RESPONSE_CODE_FAILURE means the server returned a non-2xx
                    # status but Playwright may still have captured the response body.
                    # Return whatever HTML we got rather than hard-failing — downstream
                    # parsers will receive empty content if the page was truly blank.
                    err = result.error_message or ""
                    html_fallback = result.html or result.markdown or ""
                    if "ERR_HTTP_RESPONSE_CODE_FAILURE" in err and html_fallback:
                        log.info(
                            "Crawl4AI got non-2xx response for %s — returning partial HTML (%d chars)",
                            url,
                            len(html_fallback),
                        )
                        return html_fallback
                    if "ERR_HTTP_RESPONSE_CODE_FAILURE" in err:
                        raise RuntimeError(f"Crawl4AI: server returned error HTTP status for {url}")
                    raise RuntimeError(f"Crawl4AI failed: {err}")
                return result.html or result.markdown or result.binary or ""
        except RuntimeError:
            raise
        except OSError as e:
            raise RuntimeError(f"Crawl4AI system dependency missing: {e}") from e


# ─── Small helpers ────────────────────────────────────────────────────────────
async def polite_sleep(min_ms: int = 250, max_ms: int = 800) -> None:
    await asyncio.sleep(random.randint(min_ms, max_ms) / 1000)


# ─── PDF fetch + extraction ──────────────────────────────────────────────────
import fitz  # PyMuPDF  # noqa: E402  # type: ignore[import]
import pdfplumber  # noqa: E402  # type: ignore[import]
from PIL import Image  # noqa: E402  # type: ignore[import]
import pytesseract  # noqa: E402  # type: ignore[import]


async def fetch_pdf(url: str, *, use_proxy: bool = True) -> str:
    """Fetch a PDF and extract text/tables using PyMuPDF → pdfplumber → OCR fallback."""
    try:
        proxy = settings.proxy_url() if use_proxy else None
        headers = _build_headers(url)
        if proxy is None and _persistent_client and not _persistent_client.is_closed:
            r = await _persistent_client.get(url, headers=headers, follow_redirects=True)
        else:
            async with httpx.AsyncClient(proxy=proxy, headers=headers, timeout=settings.request_timeout) as cli:
                r = await cli.get(url, follow_redirects=True)
        r.raise_for_status()
        pdf_bytes = r.content
    except Exception as e:
        log.warning("PDF fetch failed for %s: %s", url, str(e)[:120])
        return ""

    # 1. Try PyMuPDF (fast text)
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        text = "\n".join(page.get_text("text") for page in doc)
        if text.strip():
            return " ".join(text.split())
    except Exception as e:
        log.debug("PyMuPDF failed: %s", e)

    # 2. Try pdfplumber (structured tables)
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            text = "\n".join(page.extract_text() or "" for page in pdf.pages)
            if text.strip():
                return " ".join(text.split())
    except Exception as e:
        log.debug("pdfplumber failed: %s", e)

    # 3. OCR fallback (scanned images)
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        text_blocks = []
        for page in doc:
            pix = page.get_pixmap(dpi=150)  # lower DPI for speed/memory
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            text_blocks.append(pytesseract.image_to_string(img))
        return " ".join(" ".join(text_blocks).split())
    except Exception as e:
        log.warning("OCR failed: %s", e)

    return ""
