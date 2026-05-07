"""County distressed-property scraper.

Supports HTML pages (via tiered fetch_html) and PDF documents (via pdf_parser).
Many county/court websites publish their foreclosure schedules as PDFs, so
we auto-detect PDF links and parse them directly when the source URL ends in
.pdf or when discover_pdfs_on_page() finds downloadable schedules.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List

from . import distressed_sources as ds
from ..http_client import fetch_html
from ..llm import parse_distressed_page
from ..pdf_parser import fetch_pdf_text

log = logging.getLogger("county")


def list_supported_counties() -> List[Dict[str, str]]:
    """Subset of distressed_sources limited to county_clerk + public_trustee."""
    out: List[Dict[str, str]] = []
    for s in ds.SOURCES:
        if s["category"] in ("county_clerk", "public_trustee"):
            out.append({"key": s["key"], "name": s["name"], "state": s["state"]})
    return out


async def scrape_county(
    county_key: str, *, zip_code: str = "", state: str = "", date: str = ""
) -> List[Dict[str, Any]]:
    src = ds.get_source(county_key)
    if not src:
        log.info("Unknown source key: %s", county_key)
        return []

    url = (
        src["url"]
        .replace("{zip}", zip_code or "")
        .replace("{state}", (state or "").lower())
        .replace("{date}", date or "")
    )

    cat = ds.CATEGORY_META.get(src["category"], {})
    distress_type = cat.get("distress_type", src["category"])
    source_state = src["state"] if src["state"] != "*" else state

    def _tag_listings(
        listings: List[Dict[str, Any]], source_url: str
    ) -> List[Dict[str, Any]]:
        for item in listings:
            item.setdefault("source", distress_type)
            item.setdefault("source_url", source_url)
            item.setdefault("state", source_state)
        return listings

    # ── PDF path: direct PDF URL ──────────────────────────────────────────────
    if url.lower().endswith(".pdf") or "pdf" in url.lower():
        log.info("County PDF direct: %s", url)
        text = await fetch_pdf_text(url)
        if text:
            listings = await parse_distressed_page(text, source=src["name"])
            return _tag_listings(listings, url)
        return []

    # ── HTML path ─────────────────────────────────────────────────────────────
    try:
        html = await fetch_html(url, render=src.get("render", False))
    except Exception as e:  # noqa: BLE001
        log.warning("County fetch failed for %s: %s", county_key, e)
        return []

    from bs4 import BeautifulSoup

    text = BeautifulSoup(html, "lxml").get_text("\n", strip=True)

    # ── PDF discovery: if the page links to PDFs, parse those too ────────────
    all_listings: List[Dict[str, Any]] = []
    pdf_links = [
        h
        for h in re.findall(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', html, re.I)
        if not h.startswith("#")
    ]
    if pdf_links:
        import re as _re

        root = _re.match(r"(https?://[^/]+)", url)
        for pdf_href in pdf_links[:3]:  # cap at 3 PDFs per source
            if pdf_href.startswith("http"):
                pdf_url = pdf_href
            elif pdf_href.startswith("/"):
                pdf_url = (root.group(1) if root else "") + pdf_href
            else:
                pdf_url = url.rsplit("/", 1)[0] + "/" + pdf_href
            log.info("County PDF discovered: %s", pdf_url)
            pdf_text = await fetch_pdf_text(pdf_url)
            if pdf_text:
                pdf_listings = await parse_distressed_page(
                    pdf_text, source=f"{src['name']} (PDF)"
                )
                all_listings.extend(_tag_listings(pdf_listings, pdf_url))

    # Parse HTML text
    html_listings = await parse_distressed_page(text[:9000], source=src["name"])
    all_listings.extend(_tag_listings(html_listings, url))

    # Deduplicate by address
    seen: set[str] = set()
    unique: List[Dict[str, Any]] = []
    for item in all_listings:
        key = (item.get("address") or "").lower().strip()
        if key and key not in seen:
            seen.add(key)
            unique.append(item)
    return unique


async def scrape_auction_com(state: str, zip_code: str) -> List[Dict[str, Any]]:
    return await scrape_county("auction-com", state=state, zip_code=zip_code)
