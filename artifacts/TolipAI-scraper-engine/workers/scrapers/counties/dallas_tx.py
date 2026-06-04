"""Dallas County, TX — Trustee Sales / Tax Foreclosure scraper.

Source: https://www.dallascounty.org/departments/tax/foreclosures.php
Type: Public list, no login required
Data: Trustee sale list with property addresses and sale dates
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List

from .base import CountyScraper

log = logging.getLogger("dallas_tx")


class DallasCountyScraper(CountyScraper):
    county = "Dallas"
    state = "TX"
    source_url = "https://www.dallascounty.org/departments/tax/foreclosures.php"
    requires_login = False
    requires_captcha = False

    async def scrape(self, days_back: int = 30) -> List[Dict[str, Any]]:
        listings: List[Dict[str, Any]] = []

        try:
            from ..._browser_session import browser_context, _nav_with_fallback
        except ImportError:
            from workers.scrapers._browser_session import browser_context, _nav_with_fallback

        try:
            async with browser_context("dallas_tx", headless=True, no_proxy=True) as ctx:
                page = await ctx.new_page()
                await _nav_with_fallback(page, self.source_url, log, "dallas_tx")

                try:
                    await page.wait_for_selector("table, .foreclosure-list, ul.listings, body", timeout=30000)
                except Exception:
                    self.log_block(self.source_url, "no_content", "No listing content found within 30s")
                    return []

                html = await page.content()

        except Exception as e:
            self.log_block(self.source_url, "navigation_failed", str(e)[:120])
            return []

        raw_rows = self.parse_table(html, "table")
        if not raw_rows:
            log.info("[Dallas TX] No table rows found — page may use a different layout")
            return []

        for row in raw_rows:
            try:
                address = (
                    row.get("property_address")
                    or row.get("address")
                    or row.get("property")
                    or row.get("location")
                    or ""
                ).strip()
                if not address:
                    continue

                sale_date_raw = row.get("sale_date") or row.get("auction_date") or row.get("date") or ""
                sale_date = self.parse_date(sale_date_raw) if sale_date_raw else None

                listing: Dict[str, Any] = {
                    "address": address,
                    "city": (row.get("city") or "Dallas").strip(),
                    "state": "TX",
                    "zip": (row.get("zip") or row.get("zip_code") or "").strip() or None,
                    "county": "Dallas",
                    "case_number": (row.get("case_number") or row.get("cause_number") or row.get("instrument") or "").strip() or None,
                    "owner_name": (row.get("owner") or row.get("owner_name") or row.get("grantor") or "").strip() or None,
                    "sale_date": sale_date,
                    "sale_type": "trustee_sale",
                    "opening_bid": self.parse_money(row.get("minimum_bid") or row.get("bid") or row.get("amount") or ""),
                    "source_url": self.source_url,
                    "source": "dallas_tx",
                    "scraped_at": datetime.utcnow().isoformat(),
                }

                if self.validate_listing(listing):
                    listings.append(listing)

            except Exception as e:
                log.debug("[Dallas TX] Row parse failed: %s — %s", row, e)
                continue

        log.info("[Dallas TX] Scraped %d valid listings", len(listings))
        return listings
