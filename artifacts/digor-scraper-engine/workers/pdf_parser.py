"""PDF fetching + text extraction utility.

Used for county/court websites that publish foreclosure schedules as PDFs
(Cuyahoga Sheriff sale schedules, HUD bid lists, probate court indexes, etc.).

Flow:
  1. Download PDF bytes (via httpx + BrightData proxy if configured)
  2. Extract text with pdfplumber (preferred) → PyMuPDF fallback
  3. Return plain text ready for LLM parsing
"""
from __future__ import annotations

import io
import logging
import re
from typing import Optional

import httpx

from .config import settings

log = logging.getLogger("pdf_parser")


def _pdf_text_pdfplumber(data: bytes) -> str:
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            pages = []
            for page in pdf.pages:
                text = page.extract_text() or ""
                pages.append(text)
            return "\n".join(pages)
    except Exception as e:
        log.debug("pdfplumber failed: %s", e)
        return ""


def _pdf_text_pymupdf(data: bytes) -> str:
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=data, filetype="pdf")
        pages = [page.get_text() for page in doc]
        doc.close()
        return "\n".join(pages)
    except Exception as e:
        log.debug("PyMuPDF failed: %s", e)
        return ""


async def fetch_pdf_text(url: str, *, timeout: float = 45.0) -> str:
    """Download a PDF from `url` and return its extracted plain text.

    Uses the BrightData/Oxylabs proxy if configured.  Falls back to a
    direct unproxied request if the proxy fails or is not set.

    Returns empty string on failure so callers can fall through gracefully.
    """
    proxy = settings.proxy_url()
    data: Optional[bytes] = None

    async def _download(use_proxy: bool) -> Optional[bytes]:
        p = proxy if use_proxy else None
        try:
            async with httpx.AsyncClient(
                timeout=timeout, proxy=p, follow_redirects=True,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 Chrome/124.0 Safari/537.36"
                    ),
                    "Accept": "application/pdf,*/*;q=0.9",
                },
            ) as cli:
                r = await cli.get(url)
                ct = r.headers.get("content-type", "")
                if "pdf" not in ct.lower() and not url.lower().endswith(".pdf"):
                    log.warning("pdf_parser: unexpected content-type %s for %s", ct, url)
                r.raise_for_status()
                return r.content
        except Exception as e:
            log.info("pdf_parser download failed (proxy=%s): %s", use_proxy, e)
            return None

    if proxy:
        data = await _download(use_proxy=True)
    if data is None:
        data = await _download(use_proxy=False)
    if not data:
        return ""

    # Extract text — pdfplumber first, PyMuPDF as fallback
    text = _pdf_text_pdfplumber(data)
    if not text.strip():
        text = _pdf_text_pymupdf(data)

    # Normalise whitespace
    text = re.sub(r"\r\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    log.info("pdf_parser: extracted %d chars from %s", len(text), url)
    return text.strip()


async def discover_pdfs_on_page(page_url: str) -> list[str]:
    """Fetch a page and return all absolute PDF link URLs found on it."""
    try:
        async with httpx.AsyncClient(
            timeout=20, proxy=settings.proxy_url(), follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 Chrome/124.0"},
        ) as cli:
            r = await cli.get(page_url)
            html = r.text
    except Exception as e:
        log.info("discover_pdfs: failed to fetch %s: %s", page_url, e)
        return []

    base = re.sub(r"/[^/]*$", "", page_url)
    hrefs = re.findall(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', html, re.I)
    pdfs = []
    for h in hrefs:
        if h.startswith("http"):
            pdfs.append(h)
        elif h.startswith("/"):
            root = re.match(r"(https?://[^/]+)", page_url)
            pdfs.append((root.group(1) if root else "") + h)
        else:
            pdfs.append(base + "/" + h)
    return list(dict.fromkeys(pdfs))  # deduplicate, preserve order
