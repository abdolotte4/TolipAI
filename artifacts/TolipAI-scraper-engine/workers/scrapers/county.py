"""County distressed-property scraper — legacy wrapper.

AUDIT COMPLIANCE:
  The original implementation used parse_distressed_page() (LLM extraction)
  to extract listings from HTML text. This has been permanently removed.

  Active scraping is now handled by workers/scrapers/counties/ which contains
  real per-county Playwright scrapers with DOM parsing (no LLM).

  This file is kept for:
  - list_supported_counties() — now returns COUNTY_SCRAPERS metadata
  - scrape_county() — returns [] immediately with a log note directing to counties/
  - scrape_auction_com() — stub
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

from .counties import COUNTY_SCRAPERS

log = logging.getLogger("county")


def list_supported_counties() -> List[Dict[str, str]]:
    """Return metadata for all registered county scrapers.

    Replaces the old distressed_sources-based list which pointed to sites that
    used LLM extraction. Now returns only counties with real Playwright scrapers.
    """
    out: List[Dict[str, str]] = []
    for key, cls in COUNTY_SCRAPERS.items():
        try:
            scraper = cls()
            meta = scraper.metadata()
            out.append({
                "key": key,
                "name": meta.get("name", key),
                "state": meta.get("state", ""),
                "county": meta.get("county", ""),
                "source_url": meta.get("source_url", ""),
                "sale_type": meta.get("sale_type", ""),
            })
        except Exception as e:
            log.warning("list_supported_counties: metadata() failed for %s: %s", key, e)
    return out


async def scrape_county(
    county_key: str,
    *,
    zip_code: str = "",
    state: str = "",
    date: str = "",
) -> List[Dict[str, Any]]:
    """Attempt to run a registered county scraper by its key.

    If the county_key is in COUNTY_SCRAPERS, delegates to the real scraper.
    Otherwise returns [] immediately — no HTTP fetch, no LLM.

    AUDIT NOTE: The old generic HTML→LLM pipeline has been removed.
    To add scraping for a new county, add a scraper to workers/scrapers/counties/.
    """
    if county_key in COUNTY_SCRAPERS:
        cls = COUNTY_SCRAPERS[county_key]
        scraper = cls()
        log.info("scrape_county: dispatching to %s scraper", county_key)
        try:
            return await scraper.scrape(days_back=30)
        except Exception as e:
            log.warning("scrape_county: %s scraper failed: %s", county_key, str(e)[:200])
            return []

    log.info(
        "scrape_county(%s): no dedicated scraper registered — returning []. "
        "Add a scraper to workers/scrapers/counties/ to enable this county.",
        county_key,
    )
    return []


async def scrape_auction_com(state: str, zip_code: str) -> List[Dict[str, Any]]:
    """Auction.com scraper stub — requires dedicated scraper implementation."""
    log.info(
        "scrape_auction_com: Auction.com scraper not yet implemented. "
        "Returning empty. Add a dedicated scraper to workers/scrapers/counties/."
    )
    return []
