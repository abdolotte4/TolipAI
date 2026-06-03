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

    def _tag_listings(listings: List[Dict[str, Any]], source_url: str) -> List[Dict[str, Any]]:
        for item in listings:
            item.setdefault("source", distress_type)
            item.setdefault("source_url", source_url)
            item.setdefault("state", source_state)
        return listings

    # ── PDF path: direct PDF URL ──────────────────────────────────────────────
    # parse_distressed_page (LLM extraction) has been removed.
    # PDF county sources now require a dedicated county scraper in scrapers/counties/.
    if url.lower().endswith(".pdf") or "pdf" in url.lower():
        log.info(
            "County PDF direct for %s: %s — LLM extraction removed. "
            "Add a dedicated county scraper to scrapers/counties/ to handle this source.",
            county_key, url,
        )
        return []

    # ── HTML path ─────────────────────────────────────────────────────────────
    try:
        html = await fetch_html(url, render=src.get("render", False))
    except Exception as e:  # noqa: BLE001
        log.warning("County fetch failed for %s: %s", county_key, e)
        return []

    from bs4 import BeautifulSoup

    text = BeautifulSoup(html, "lxml").get_text("\n", strip=True)

    # parse_distressed_page (LLM extraction) has been removed.
    # This generic HTML-to-LLM pipeline no longer produces results.
    # Use dedicated county scrapers in scrapers/counties/ for structured extraction.
    log.info(
        "scrape_county(%s): generic LLM extraction pipeline removed — "
        "use a dedicated county scraper in scrapers/counties/ for this source.",
        county_key,
    )
    all_listings: List[Dict[str, Any]] = []

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
