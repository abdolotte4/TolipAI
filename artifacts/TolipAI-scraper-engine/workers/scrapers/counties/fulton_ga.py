"""Fulton County, GA — Tax Sale scraper.

Source: https://www.fultoncountytaxes.org/
Type: Public list, no login required
Data: Tax sale property list published before each quarterly sale
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List

from .base import CountyScraper

log = logging.getLogger("fulton_ga")

_SOURCE_URL = "https://www.fultoncountytaxes.org/property-taxes/tax-lien-and-tax-deed-sales.aspx"


class FultonCountyScraper(CountyScraper):
    county = "Fulton"
    state = "GA"
    source_url = _SOURCE_URL
    requires_login = False
    requires_captcha = False

    async def scrape(self, days_back: int = 365) -> List[Dict[str, Any]]:
        listings: List[Dict[str, Any]] = []

        try:
            from ..._browser_session import _nav_with_fallback, browser_context
        except ImportError:
            from workers.scrapers._browser_session import _nav_with_fallback, browser_context

        try:
            async with browser_context("fulton_ga", headless=True, no_proxy=True) as ctx:
                page = await ctx.new_page()
                await _nav_with_fallback(page, self.source_url, log, "fulton_ga")

                try:
                    await page.wait_for_selector("table, .tax-sale-list, a[href$='.pdf'], a[href$='.xlsx']", timeout=30000)
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
                    or row.get("situs_address")
                    or row.get("location")
                    or ""
                ).strip()
                if not address:
                    continue

                listing: Dict[str, Any] = {
                    "address": address,
                    "city": (row.get("city") or "Atlanta").strip(),
                    "state": "GA",
                    "zip": (row.get("zip") or row.get("zip_code") or "").strip() or None,
                    "county": "Fulton",
                    "parcel_id": (row.get("parcel_id") or row.get("property_id") or row.get("account_number") or "").strip() or None,
                    "owner_name": (row.get("owner") or row.get("owner_name") or row.get("taxpayer") or "").strip() or None,
                    "sale_date": self.parse_date(row.get("sale_date") or row.get("tax_sale_date") or ""),
                    "sale_type": "tax_lien",
                    "lien_amount": self.parse_money(row.get("amount_due") or row.get("fi_fa_amount") or row.get("taxes") or ""),
                    "opening_bid": self.parse_money(row.get("minimum_bid") or row.get("opening_bid") or ""),
                    "source_url": self.source_url,
                    "source": "fulton_ga",
                    "scraped_at": datetime.utcnow().isoformat(),
                }

                if self.validate_listing(listing):
                    listings.append(listing)

            except Exception as e:
                log.debug("[Fulton GA] Row parse failed: %s", e)
                continue

        log.info("[Fulton GA] Scraped %d valid listings", len(listings))
        return listings
