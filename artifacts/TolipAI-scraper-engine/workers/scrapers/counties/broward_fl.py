"""Broward County, FL — Official County Foreclosure Sales Scraper.

Source: https://www.broward.org/RecordsTaxesTreasury/ForeClosureSales/Pages/default.aspx
Type:   Public HTML page — NO login required
Auth:   None
Proxy:  US domestic proxy recommended (county sites may geo-restrict)

Playwright navigates to the official Broward County Records & Treasury
foreclosure page and parses the auction listing table.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Dict, List

from .base import CountyScraper

log = logging.getLogger("broward_fl")

_BASE_URL = "https://www.broward.org/RecordsTaxesTreasury/ForeClosureSales/Pages/default.aspx"
_ALT_URL = "https://www.browardclerk.org/"


class BrowardScraper(CountyScraper):
    county = "Broward"
    state = "FL"
    source_url = _BASE_URL
    requires_login = False
    requires_captcha = False

    async def scrape(self, days_back: int = 30) -> List[Dict[str, Any]]:
        listings: List[Dict[str, Any]] = []

        try:
            from ..._browser_session import _nav_with_fallback, browser_context
        except ImportError:
            from workers.scrapers._browser_session import _nav_with_fallback, browser_context

        try:
            async with browser_context("broward_fl", headless=True) as ctx:
                page = await ctx.new_page()

                # ── Navigate to the official Broward foreclosure page ──────────
                ok = await _nav_with_fallback(page, _BASE_URL, log, "broward_fl")
                if not ok:
                    log.warning("[Broward FL] Navigation to %s failed", _BASE_URL)
                    self.log_block(_BASE_URL, "nav_failed")
                    return []

                # Wait for content to load
                await page.wait_for_timeout(3000)

                # ── Try to find auction/foreclosure tables or links ───────────
                html = await page.content()

                # Parse any tables present on the page
                raw_rows = self.parse_table(html, "table")
                log.info("[Broward FL] Found %d raw rows from table parse", len(raw_rows))

                # Also look for links to individual auction sale PDFs or pages
                # Many county sites list foreclosure sales as date-linked pages
                auction_links = await page.query_selector_all(
                    "a[href*='Foreclosure'], a[href*='foreclosure'], a[href*='auction'], a[href*='sale']"
                )
                log.info("[Broward FL] Found %d auction links on page", len(auction_links))

                for row in raw_rows:
                    listing = self._parse_row(row)
                    if listing and self.validate_listing(listing):
                        listings.append(listing)

                # ── Follow sub-links to individual sale listings ─────────────
                if len(listings) == 0 and len(auction_links) > 0:
                    for link_el in auction_links[:5]:
                        href = await link_el.get_attribute("href") or ""
                        if not href.startswith("http"):
                            href = "https://www.broward.org" + href
                        try:
                            await _nav_with_fallback(page, href, log, "broward_fl_sub")
                            await page.wait_for_timeout(2000)
                            sub_html = await page.content()
                            sub_rows = self.parse_table(sub_html, "table")
                            for row in sub_rows:
                                listing = self._parse_row(row)
                                if listing and self.validate_listing(listing):
                                    listings.append(listing)
                        except Exception as sub_err:
                            log.debug("[Broward FL] Sub-page error: %s", sub_err)

        except Exception as e:
            self.log_block(self.source_url, "scraper_error", str(e)[:200])
            return []

        log.info("[Broward FL] Scraped %d valid listings from official county site", len(listings))
        return listings

    def _parse_row(self, row: Dict[str, str]) -> Dict[str, Any] | None:
        # Field names vary by Broward's table layout — try common aliases
        address = (
            row.get("property_address")
            or row.get("address")
            or row.get("property address")
            or row.get("street address")
            or row.get("location")
            or ""
        ).strip()
        if not address or len(address) < 5:
            return None

        # Skip header-like rows
        if address.lower() in ("address", "property", "location", "n/a"):
            return None

        return {
            "address": address,
            "city": (
                row.get("city") or row.get("municipality") or "Fort Lauderdale"
            ).strip(),
            "state": "FL",
            "zip": (row.get("zip") or row.get("zip_code") or row.get("postal") or "").strip() or None,
            "county": "Broward",
            "case_number": (
                row.get("case_number") or row.get("case#") or row.get("case number") or row.get("case no") or ""
            ).strip() or None,
            "parcel_id": (
                row.get("parcel_id") or row.get("folio") or row.get("parcel") or row.get("folio number") or ""
            ).strip() or None,
            "sale_date": self.parse_date(
                row.get("sale_date") or row.get("auction_date") or row.get("sale date") or row.get("date") or ""
            ),
            "sale_type": "foreclosure",
            "opening_bid": self.parse_money(
                row.get("opening_bid") or row.get("opening bid") or row.get("assessed_value") or row.get("judgment") or ""
            ),
            "source_url": self.source_url,
            "source": "broward_fl",
            "scraped_at": datetime.utcnow().isoformat(),
        }
