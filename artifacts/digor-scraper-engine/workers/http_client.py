"""HTTP fetcher: direct (residential proxy) → Crawl4AI (JS rendering + PDF support).

ScraperAPI and ScrapingBee are PERMANENTLY REMOVED — credits exhausted.

Tier order per fetch_html() call:
  1. Direct httpx with residential proxy + browser-like headers (fast)
  2. Crawl4AI Playwright rendering (only when render=True and direct fails)
  3. PDF detection: return raw bytes if response is a PDF

A single persistent httpx.AsyncClient is reused for all API calls to avoid
per-request TCP handshake overhead. Call init_client() at startup and
close_client() at shutdown (done automatically by the FastAPI lifespan).
"""

from __future__ import annotations
import asyncio, logging, random, ssl, io
from typing import Any, Dict, Optional
import httpx
from tenacity import AsyncRetrying, retry_if_exception_type, stop_after_attempt, wait_exponential
from .config import settings

log = logging.getLogger("http")

# Government / county sites that block residential proxies
_PROXY_BLOCKED_DOMAINS = (
    "treasurer.cuyahoga", "auditor.cuyahoga", "probate.cuyahoga", "cuyahogacounty.us",
    "sheriffsaleauction.ohio.gov", ".state.oh.us", ".state.nc.us", ".state.tx.us", ".state.fl.us",
    "hctax.net", "lacounty.gov", "ttc.lacounty", "cclerk.hctx", "octaxcol.com", "broward.county-taxes",
)

def _should_skip_proxy(url: str) -> bool:
    u = url.lower()
    return any(d in u for d in _PROXY_BLOCKED_DOMAINS)

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36 Edg/123",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
]

_DOMAIN_HEADERS: dict[str, dict[str, str]] = {
    "zillow.com": {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
    },
    "redfin.com": {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.redfin.com/",
        "Origin": "https://www.redfin.com",
    },
}

# Persistent shared client
_persistent_client: Optional[httpx.AsyncClient] = None

async def init_client() -> None:
    global _persistent_client
    if _persistent_client is None or _persistent_client.is_closed:
        _persistent_client = httpx.AsyncClient(timeout=settings.request_timeout)
    log.info("Persistent HTTP client initialised")

async def close_client() -> None:
    global _persistent_client
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

def _ssl_ctx() -> Any:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx

# ─── Direct fetch ────────────────────────────────────────────────────────────
async def fetch_direct(url: str, *, use_proxy: bool = True,
                       verify_ssl: bool = False) -> Any:
    """Plain httpx fetch with rotating UA + optional residential proxy.
       Returns .text for HTML, raw bytes for PDFs.
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
                ctype = r.headers.get("Content-Type", "").lower()
                if "pdf" in ctype or url.lower().endswith(".pdf"):
                    return r.content  # raw bytes
                return r.text
    return ""

# ─── Tiered fetch ────────────────────────────────────────────────────────────
async def fetch_html(url: str, *, render: bool = False,
                     country: str = "us", is_google: bool = False) -> Any:
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
async def fetch_crawl4ai(url: str, *, wait_for: Optional[str] = None,
                         use_proxy: bool = True) -> Any:
    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
    except (ImportError, OSError) as e:
        raise RuntimeError(f"Crawl4AI unavailable: {e}") from e

    try:
        proxy = settings.proxy_url() if use_proxy else None
        # Build proxy_config dict (proxy= is deprecated in crawl4ai>=0.4)
        _proxy_cfg: Optional[Dict[str, str]] = None
        if proxy:
            from urllib.parse import urlparse as _urlparse
            _u = _urlparse(proxy)
            _proxy_cfg = {"server": f"{_u.scheme}://{_u.hostname}:{_u.port}"}
            if _u.username:
                _proxy_cfg["username"] = _u.username
            if _u.password:
                _proxy_cfg["password"] = _u.password
        cfg = BrowserConfig(
            headless=True,
            proxy_config=_proxy_cfg,
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
            return result.markdown or result.html or result.binary or ""
    except RuntimeError:
        raise
    except OSError as e:
        raise RuntimeError(f"Crawl4AI system dependency missing: {e}") from e

# ─── Small helpers ────────────────────────────────────────────────────────────
async def polite_sleep(min_ms: int = 250, max_ms: int = 800) -> None:
    await asyncio.sleep(random.randint(min_ms, max_ms) / 1000)

# ─── PDF fetch + extraction ──────────────────────────────────────────────────
import fitz  # PyMuPDF
import pdfplumber
import io
from PIL import Image
import pytesseract

async def fetch_pdf(url: str, *, use_proxy: bool = True) -> str:
    """Fetch a PDF and extract text/tables using PyMuPDF → pdfplumber → OCR fallback."""
    try:
        proxy = settings.proxy_url() if use_proxy else None
        headers = _build_headers(url)
        async with httpx.AsyncClient(proxy=proxy, headers=headers, timeout=settings.request_timeout) as cli:
            r = await cli.get(url)
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
