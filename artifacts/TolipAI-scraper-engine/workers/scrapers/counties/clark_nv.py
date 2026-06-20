"""Clark County, NV — Trustee Sales / Tax Deed scraper.

Source: https://www.clarkcountynv.gov/government/elected_officials/treasurer/tax_sales/index.php
Type: Public list, no login required
Data: Tax sale property list (CSV/HTML)
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List

from .base import CountyScraper

log = logging.getLogger("clark_nv")

_SOURCE_URL = "https://www.clarkcountynv.gov/government/elected_officials/treasurer/tax_sales/index.php"


class ClarkCountyScraper(CountyScraper):
    county = "Clark"
    state = "NV"
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
            async with browser_context("clark_nv", headless=True, no_proxy=True) as ctx:
                page = await ctx.new_page()
                await _nav_with_fallback(page, self.source_url, log, "clark_nv")

                try:
                    await page.wait_for_selector("table, .tax-sale-content, a[href$='.pdf']", timeout=30000)
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
                    or row.get("situs")
                    or row.get("location")
                    or ""
                ).strip()
                if not address:
                    continue

                listing: Dict[str, Any] = {
                    "address": address,
                    "city": (row.get("city") or "Las Vegas").strip(),
                    "state": "NV",
                    "zip": (row.get("zip") or "").strip() or None,
                    "county": "Clark",
                    "parcel_id": (row.get("apn") or row.get("parcel") or row.get("parcel_number") or "").strip() or None,
                    "owner_name": (row.get("owner") or row.get("owner_name") or row.get("taxpayer") or "").strip() or None,
                    "sale_date": self.parse_date(row.get("sale_date") or row.get("auction_date") or ""),
                    "sale_type": "tax_lien",
                    "opening_bid": self.parse_money(row.get("minimum_bid") or row.get("amount_due") or row.get("bid") or ""),
                    "source_url": self.source_url,
                    "source": "clark_nv",
                    "scraped_at": datetime.utcnow().isoformat(),
                }

                if self.validate_listing(listing):
                    listings.append(listing)

            except Exception as e:
                log.debug("[Clark NV] Row parse failed: %s", e)
                continue

        log.info("[Clark NV] Scraped %d valid listings", len(listings))
        return listings
