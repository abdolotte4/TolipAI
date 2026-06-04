"""Maricopa County, AZ — Tax Lien / Tax Deed Sales scraper.

Source: https://mctreasurer.maricopa.gov/
Type: Public list, no login required
Data: Annual tax lien certificate sale list (typically held in February)
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List

from .base import CountyScraper

log = logging.getLogger("maricopa_az")

_SOURCE_URL = "https://mctreasurer.maricopa.gov/TaxSale/"


class MaricopaScraper(CountyScraper):
    county = "Maricopa"
    state = "AZ"
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
            async with browser_context("maricopa_az", headless=True, no_proxy=True) as ctx:
                page = await ctx.new_page()
                await _nav_with_fallback(page, self.source_url, log, "maricopa_az")

                try:
                    await page.wait_for_selector("table, .tax-sale-list, a[href$='.pdf']", timeout=30000)
                except Exception:
                    self.log_block(self.source_url, "no_content")
                    return []

                html = await page.content()

                # Also look for linked PDF/spreadsheet downloads
                pdf_links = await page.query_selector_all("a[href$='.pdf'], a[href$='.xlsx'], a[href$='.csv']")
                if pdf_links:
                    log.info("[Maricopa AZ] Found %d downloadable list(s) — HTML table will be primary", len(pdf_links))

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
                    or row.get("property_location")
                    or ""
                ).strip()
                if not address:
                    continue

                listing: Dict[str, Any] = {
                    "address": address,
                    "city": (row.get("city") or row.get("situs_city") or "Phoenix").strip(),
                    "state": "AZ",
                    "zip": (row.get("zip") or row.get("situs_zip") or "").strip() or None,
                    "county": "Maricopa",
                    "parcel_id": (row.get("parcel_number") or row.get("parcel") or row.get("apn") or "").strip() or None,
                    "owner_name": (row.get("owner") or row.get("owner_name") or row.get("taxpayer") or "").strip() or None,
                    "sale_date": self.parse_date(row.get("sale_date") or row.get("auction_date") or ""),
                    "sale_type": "tax_lien",
                    "lien_amount": self.parse_money(row.get("amount_due") or row.get("lien_amount") or row.get("taxes_due") or ""),
                    "opening_bid": self.parse_money(row.get("minimum_bid") or row.get("opening_bid") or ""),
                    "source_url": self.source_url,
                    "source": "maricopa_az",
                    "scraped_at": datetime.utcnow().isoformat(),
                }

                if self.validate_listing(listing):
                    listings.append(listing)

            except Exception as e:
                log.debug("[Maricopa AZ] Row parse failed: %s", e)
                continue

        log.info("[Maricopa AZ] Scraped %d valid listings", len(listings))
        return listings
