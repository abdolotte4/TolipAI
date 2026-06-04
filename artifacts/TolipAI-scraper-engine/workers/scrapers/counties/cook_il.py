"""Cook County, IL — Tax Sale / Scavenger Sale scraper.

Source: https://www.cookcountyclerkofcourt.org/courts/county-division/tax
Type: Public list, no login required (some features require registration)
Data: Tax sale properties by tax year
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List

from .base import CountyScraper

log = logging.getLogger("cook_il")

_SOURCE_URL = "https://www.cookcountyclerkofcourt.org/courts/county-division/tax"
_TREASURER_URL = "https://www.cookcountytreasurer.com/SiteCollection/AxdServiceCalls/AxdSalePropertiesDownload.axd"


class CookCountyScraper(CountyScraper):
    county = "Cook"
    state = "IL"
    source_url = _SOURCE_URL
    requires_login = False
    requires_captcha = False

    async def scrape(self, days_back: int = 365) -> List[Dict[str, Any]]:
        listings: List[Dict[str, Any]] = []

        try:
            from ..._browser_session import browser_context, _nav_with_fallback
        except ImportError:
            from workers.scrapers._browser_session import browser_context, _nav_with_fallback

        try:
            async with browser_context("cook_il", headless=True, no_proxy=True) as ctx:
                page = await ctx.new_page()
                await _nav_with_fallback(page, self.source_url, log, "cook_il")

                try:
                    await page.wait_for_selector("table, .tax-sale-list, a[href*='download']", timeout=30000)
                except Exception:
                    self.log_block(self.source_url, "no_content")
                    return []

                html = await page.content()

        except Exception as e:
            self.log_block(self.source_url, "navigation_failed", str(e)[:120])
            return []

        raw_rows = self.parse_table(html, "table")
        for row in raw_rows:
            try:
                address = (
                    row.get("property_address")
                    or row.get("address")
                    or row.get("location")
                    or row.get("situs_address")
                    or ""
                ).strip()
                if not address:
                    continue

                listing: Dict[str, Any] = {
                    "address": address,
                    "city": (row.get("city") or row.get("municipality") or "Chicago").strip(),
                    "state": "IL",
                    "zip": (row.get("zip") or row.get("zip_code") or "").strip() or None,
                    "county": "Cook",
                    "parcel_id": (row.get("pin") or row.get("parcel_identification_number") or row.get("parcel") or "").strip() or None,
                    "owner_name": (row.get("owner") or row.get("taxpayer") or row.get("owner_name") or "").strip() or None,
                    "sale_date": self.parse_date(row.get("sale_date") or row.get("tax_sale_date") or ""),
                    "sale_type": "tax_lien",
                    "lien_amount": self.parse_money(row.get("amount_sold") or row.get("taxes_sold") or row.get("amount") or ""),
                    "source_url": self.source_url,
                    "source": "cook_il",
                    "scraped_at": datetime.utcnow().isoformat(),
                }

                if self.validate_listing(listing):
                    listings.append(listing)

            except Exception as e:
                log.debug("[Cook IL] Row parse failed: %s", e)
                continue

        log.info("[Cook IL] Scraped %d valid listings", len(listings))
        return listings
