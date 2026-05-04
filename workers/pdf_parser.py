"""Enhanced PDF fetching + text extraction utility.

Handles county/court foreclosure schedules, HUD bid lists, probate indexes.

Flow:
  1. Download PDF bytes (via httpx + BrightData/Oxylabs proxy if configured)
  2. Extract text with pdfplumber (preferred) → PyMuPDF fallback → OCR fallback
  3. Optionally extract tables + metadata
  4. Return plain text (chunked if large) ready for LLM parsing
"""
from __future__ import annotations

import io
import logging
import re
from typing import Optional, List, Dict

import httpx

from .config import settings

log = logging.getLogger("pdf_parser")


def _pdf_text_pdfplumber(data: bytes) -> str:
    try:
        import pdfplumber
        pages = []
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                # Try table extraction if text is empty
                if not text.strip():
                    tables = page.extract_tables()
                    for tbl in tables or []:
                        rows = [" | ".join(cell or "" for cell in row) for row in tbl]
                        text += "\n".join(rows)
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
        meta = doc.metadata or {}
        doc.close()
        text = "\n".join(pages)
        if meta:
            text = f"[META: {meta}]\n{text}"
        return text
    except Exception as e:
        log.debug("PyMuPDF failed: %s", e)
        return ""


def _pdf_text_ocr(data: bytes) -> str:
    """OCR fallback for scanned PDFs."""
    try:
        import pdf2image
        import pytesseract
        images = pdf2image.convert_from_bytes(data)
        text = []
        for img in images:
            text.append(pytesseract.image_to_string(img))
        return "\n".join(text)
    except Exception as e:
        log.debug("OCR fallback failed: %s", e)
        return ""


async def fetch_pdf_text(url: str, *, timeout: float = 45.0, chunk_size: int = 50000) -> str:
    """Download a PDF from `url` and return extracted text (chunked if large)."""
    proxy = settings.proxy_url()
    data: Optional[bytes] = None

    async def _download(p: Optional[str]) -> Optional[bytes]:
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
                    return None
                r.raise_for_status()
                return r.content
        except Exception as e:
            log.info("pdf_parser download failed (proxy=%s): %s", p, e)
            return None

    # Adaptive proxy retry
    for p in (proxy, None):
        if data:
            break
        data = await _download(p)
    if not data:
        return ""

    # Extraction pipeline
    text = _pdf_text_pdfplumber(data)
    if not text.strip():
        text = _pdf_text_pymupdf(data)
    if not text.strip():
        text = _pdf_text_ocr(data)

    # Normalize whitespace
    text = re.sub(r"\r\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    # Chunk output if very large
    if len(text) > chunk_size:
        chunks = [text[i:i+chunk_size] for i in range(0, len(text), chunk_size)]
        log.info("pdf_parser: extracted %d chars in %d chunks from %s", len(text), len(chunks), url)
        return "\n\n---CHUNK_BREAK---\n\n".join(chunks)

    log.info("pdf_parser: extracted %d chars from %s", len(text), url)
    return text.strip()


async def discover_pdfs_on_page(page_url: str) -> List[str]:
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
