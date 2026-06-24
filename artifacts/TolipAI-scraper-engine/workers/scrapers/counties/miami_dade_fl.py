"""Miami-Dade County, FL — Official Clerk Foreclosure Sales Scraper.

Source: https://www.miamidade.gov/CLDOCS/ForeclosureSales
Type:   Public HTML page — NO login required
Auth:   None
Proxy:  US domestic proxy recommended (county sites may geo-restrict)

Playwright navigates to the official Miami-Dade Clerk online services
foreclosure sales page and parses the auction listing table directly.
No CAPTCHA, no login, no RealForeclose.com dependency.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Dict, List

from .base import CountyScraper

log = logging.getLogger("miami_dade_fl")

_BASE_URL = "https://www.miamidade.gov/CLDOCS/ForeclosureSales"
_ALT_URL = "https://onlineservices.miami-dadeclerk.com/dadecoc/CircivilSearchPage.aspx"


class MiamiDadeScraper(CountyScraper):
    county = "Miami-Dade"
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

        for attempt_url in [_BASE_URL, _ALT_URL]:
            try:
                async with browser_context("miami_dade_fl", headless=True) as ctx:
                    page = await ctx.new_page()

                    ok = await _nav_with_fallback(page, attempt_url, log, "miami_dade_fl")
                    if not ok:
                        log.warning("[Miami-Dade FL] Navigation to %s failed", attempt_url)
                        self.log_block(attempt_url, "nav_failed")
                        continue

                    await page.wait_for_timeout(4000)

                    # ── Handle any search form that may be present ────────────
                    # Miami-Dade CLDOCS sometimes has a date-range form
                    try:
                        search_btn = page.locator(
                            "button:has-text('Search'), input[type='submit'], button[type='submit']"
                        ).first
                        if await search_btn.count():
                            await search_btn.click()
                            await page.wait_for_timeout(3000)
                            log.info("[Miami-Dade FL] Clicked search button")
                    except Exception:
                        pass

                    html = await page.content()
                    raw_rows = self.parse_table(html, "table")
                    log.info("[Miami-Dade FL] Found %d rows from %s", len(raw_rows), attempt_url)

                    for row in raw_rows:
                        listing = self._parse_row(row)
                        if listing and self.validate_listing(listing):
                            listings.append(listing)

                    # ── Pagination: click "Next" until no more pages ──────────
                    page_num = 1
                    while page_num < 20:
                        try:
                            next_btn = page.locator(
                                "a:has-text('Next'), a:has-text('>>'), a.next, button:has-text('Next')"
                            ).first
                            if not await next_btn.count() or not await next_btn.is_visible():
                                break
                            await next_btn.click()
                            await page.wait_for_timeout(2000)
                            page_num += 1
                            next_html = await page.content()
                            next_rows = self.parse_table(next_html, "table")
                            for row in next_rows:
                                listing = self._parse_row(row)
                                if listing and self.validate_listing(listing):
                                    listings.append(listing)
                        except Exception:
                            break

                    if listings:
                        break  # Got results, no need to try alt URL

            except Exception as e:
                self.log_block(attempt_url, "scraper_error", str(e)[:200])
                log.warning("[Miami-Dade FL] Error with %s: %s", attempt_url, str(e)[:120])

        log.info("[Miami-Dade FL] Scraped %d valid listings from official county site", len(listings))
        return listings

    def _parse_row(self, row: Dict[str, str]) -> Dict[str, Any] | None:
        address = (
            row.get("property_address")
            or row.get("address")
            or row.get("property address")
            or row.get("street")
            or row.get("location")
            or ""
        ).strip()
        if not address or len(address) < 5:
            return None

        if address.lower() in ("address", "property", "location", "n/a", "street address"):
            return None

        return {
            "address": address,
            "city": (row.get("city") or row.get("municipality") or "Miami").strip(),
            "state": "FL",
            "zip": (row.get("zip") or row.get("zip_code") or row.get("postal") or "").strip() or None,
            "county": "Miami-Dade",
            "case_number": (
                row.get("case_number")
                or row.get("case#")
                or row.get("case number")
                or row.get("case no")
                or row.get("certificate#")
                or ""
            ).strip() or None,
            "parcel_id": (
                row.get("parcel_id") or row.get("folio") or row.get("parcel") or row.get("folio number") or ""
            ).strip() or None,
            "sale_date": self.parse_date(
                row.get("sale_date") or row.get("auction_date") or row.get("sale date") or row.get("date") or ""
            ),
            "sale_type": "foreclosure",
            "opening_bid": self.parse_money(
                row.get("opening_bid")
                or row.get("opening bid")
                or row.get("assessed_value")
                or row.get("judgment amount")
                or ""
            ),
            "source_url": self.source_url,
            "source": "miami_dade_fl",
            "scraped_at": datetime.utcnow().isoformat(),
        }
