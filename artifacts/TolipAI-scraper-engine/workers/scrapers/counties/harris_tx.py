"""Harris County, TX — Tax Foreclosure Sales scraper.

Source: https://www.hctax.net/Property/PropertyTaxForeclosureSales
Type: Public list, no login required, no CAPTCHA
Data: Monthly auction list, HTML table with property address, case number, minimum bid
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List

from .base import CountyScraper

log = logging.getLogger("harris_tx")


class HarrisCountyScraper(CountyScraper):
    county = "Harris"
    state = "TX"
    source_url = "https://www.hctax.net/Property/PropertyTaxForeclosureSales"
    requires_login = False
    requires_captcha = False

    async def scrape(self, days_back: int = 30) -> List[Dict[str, Any]]:
        listings: List[Dict[str, Any]] = []

        try:
            from ..._browser_session import browser_context, _nav_with_fallback
        except ImportError:
            from workers.scrapers._browser_session import browser_context, _nav_with_fallback

        try:
            async with browser_context("harris_tx", headless=True) as ctx:
                page = await ctx.new_page()
                await _nav_with_fallback(page, self.source_url, log, "harris_tx")

                try:
                    await page.wait_for_selector("table", timeout=15000)
                except Exception:
                    self.log_block(self.source_url, "no_table", "Table not found within 15s")
                    return []

                html = await page.content()

        except Exception as e:
            self.log_block(self.source_url, "navigation_failed", str(e)[:120])
            return []

        raw_rows = self.parse_table(html, "table")
        if not raw_rows:
            log.info("[Harris TX] No rows found in table")
            return []

        for row in raw_rows:
            try:
                # Harris County table columns vary — try multiple possible header names
                address = (
                    row.get("property_address")
                    or row.get("address")
                    or row.get("situs_address")
                    or row.get("property")
                    or ""
                ).strip()
                if not address:
                    continue

                sale_date_raw = (
                    row.get("sale_date")
                    or row.get("auction_date")
                    or row.get("date")
                    or ""
                )
                sale_date = self.parse_date(sale_date_raw) if sale_date_raw else None

                city_raw = row.get("city", "Houston").strip() or "Houston"
                zip_raw = row.get("zip", "").strip() or row.get("zip_code", "").strip()

                opening_bid = self.parse_money(
                    row.get("minimum_bid") or row.get("opening_bid") or row.get("bid") or ""
                )

                listing: Dict[str, Any] = {
                    "address": address,
                    "city": city_raw,
                    "state": "TX",
                    "zip": zip_raw or None,
                    "county": "Harris",
                    "case_number": (row.get("cause_number") or row.get("case_number") or row.get("case#") or "").strip() or None,
                    "parcel_id": (row.get("parcel_id") or row.get("account_number") or row.get("account#") or "").strip() or None,
                    "sale_date": sale_date,
                    "sale_type": "tax_foreclosure",
                    "opening_bid": opening_bid,
                    "source_url": self.source_url,
                    "source": "harris_tx",
                    "scraped_at": datetime.utcnow().isoformat(),
                }

                if self.validate_listing(listing):
                    listings.append(listing)

            except Exception as e:
                log.debug("[Harris TX] Failed to parse row: %s — %s", row, e)
                continue

        log.info("[Harris TX] Scraped %d valid listings", len(listings))
        return listings
