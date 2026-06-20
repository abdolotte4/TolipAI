"""Los Angeles County, CA — Tax Defaulted Property Auction scraper.

Source: https://ttc.lacounty.gov/auction/
Type: Public auction list, no login required
Data: Tax deed auction properties with parcel numbers and minimum bids
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List

from .base import CountyScraper

log = logging.getLogger("los_angeles_ca")

_SOURCE_URL = "https://ttc.lacounty.gov/auction/"


class LosAngelesCountyScraper(CountyScraper):
    county = "Los Angeles"
    state = "CA"
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
            async with browser_context("los_angeles_ca", headless=True, no_proxy=True) as ctx:
                page = await ctx.new_page()
                await _nav_with_fallback(page, self.source_url, log, "los_angeles_ca")

                try:
                    await page.wait_for_selector("table, .auction-properties, a[href*='download'], a[href$='.pdf']", timeout=20000)
                except Exception:
                    self.log_block(self.source_url, "no_content")
                    return []

                # LA County often links to a downloadable CSV or separate auction page
                csv_link = await page.query_selector("a[href$='.csv'], a[href$='.xls'], a[href$='.xlsx']")
                if csv_link:
                    href = await csv_link.get_attribute("href") or ""
                    log.info("[LA County CA] Found downloadable list: %s", href)

                html = await page.content()

        except Exception as e:
            self.log_block(self.source_url, "navigation_failed", str(e)[:120])
            return []

        raw_rows = self.parse_table(html, "table")
        for row in raw_rows:
            try:
                address = (
                    row.get("situs_address")
                    or row.get("property_address")
                    or row.get("address")
                    or row.get("location")
                    or row.get("situs")
                    or ""
                ).strip()
                if not address:
                    continue

                listing: Dict[str, Any] = {
                    "address": address,
                    "city": (row.get("city") or row.get("situs_city") or "Los Angeles").strip(),
                    "state": "CA",
                    "zip": (row.get("zip") or row.get("zip_code") or "").strip() or None,
                    "county": "Los Angeles",
                    "parcel_id": (row.get("apn") or row.get("assessor_parcel_number") or row.get("parcel") or "").strip() or None,
                    "owner_name": (row.get("assessee") or row.get("owner") or row.get("owner_name") or "").strip() or None,
                    "sale_date": self.parse_date(row.get("sale_date") or row.get("auction_date") or ""),
                    "sale_type": "tax_lien",
                    "opening_bid": self.parse_money(row.get("minimum_bid") or row.get("amount") or row.get("defaulted_taxes") or ""),
                    "source_url": self.source_url,
                    "source": "los_angeles_ca",
                    "scraped_at": datetime.utcnow().isoformat(),
                }

                if self.validate_listing(listing):
                    listings.append(listing)

            except Exception as e:
                log.debug("[LA County CA] Row parse failed: %s", e)
                continue

        log.info("[LA County CA] Scraped %d valid listings", len(listings))
        return listings
