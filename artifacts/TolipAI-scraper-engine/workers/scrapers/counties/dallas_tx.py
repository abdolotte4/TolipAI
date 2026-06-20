"""Dallas County, TX — Trustee Sales / Tax Foreclosure scraper.

Primary source:  https://www.dallascounty.org/departments/tax/foreclosures.php
Fallback source: https://www.dallascourtrecords.com/

Strategy (in order):
  1. Playwright fetch → selectolax table extraction
  2. http_client.fetch_rendered() as Crawl4AI fallback
  3. Text-based address regex scan as last resort
  Always returns [] (never raises) on block/error.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Dict, List

from .base import CountyScraper

log = logging.getLogger("dallas_tx")

_ADDRESS_RE = re.compile(
    r"\b\d{3,6}\s+\w[\w\s]{3,40}(?:ST|AVE|BLVD|DR|RD|LN|WAY|CT|PL|CIR|HWY|PKWY|"
    r"STREET|AVENUE|BOULEVARD|DRIVE|ROAD|LANE|COURT|PLACE|CIRCLE)\b",
    re.IGNORECASE,
)

_FALLBACK_URLS = [
    "https://www.dallascounty.org/departments/constable/foreclosures.php",
]


class DallasCountyScraper(CountyScraper):
    county = "Dallas"
    state = "TX"
    source_url = "https://www.dallascounty.org/departments/tax/foreclosures.php"
    requires_login = False
    requires_captcha = False

    async def scrape(self, days_back: int = 30) -> List[Dict[str, Any]]:
        # Try primary URL via Playwright
        listings = await self._scrape_url_playwright(self.source_url)
        if listings:
            return listings

        # Try fallback URLs via Crawl4AI
        for url in _FALLBACK_URLS:
            listings = await self._scrape_url_crawl4ai(url)
            if listings:
                return listings

        log.info("[Dallas TX] All sources returned 0 listings — site may use PDFs or form interaction")
        return []

    async def _scrape_url_playwright(self, url: str) -> List[Dict[str, Any]]:
        try:
            from ..._browser_session import _nav_with_fallback, browser_context
        except ImportError:
            try:
                from workers.scrapers._browser_session import _nav_with_fallback, browser_context
            except ImportError:
                return []

        try:
            async with browser_context("dallas_tx", headless=True, no_proxy=True) as ctx:
                page = await ctx.new_page()
                await _nav_with_fallback(page, url, log, "dallas_tx")
                try:
                    await page.wait_for_selector("table, .foreclosure-list, ul.listings, body", timeout=25000)
                except Exception:
                    pass
                html = await page.content()
        except Exception as e:
            self.log_block(url, "navigation_failed", str(e)[:120])
            return []

        return self._extract_listings(html, url)

    async def _scrape_url_crawl4ai(self, url: str) -> List[Dict[str, Any]]:
        try:
            try:
                from ...http_client import fetch_rendered
            except ImportError:
                from workers.http_client import fetch_rendered

            import asyncio

            html = await asyncio.wait_for(fetch_rendered(url, use_proxy=False), timeout=40)
        except Exception as e:
            log.debug("[Dallas TX] Crawl4AI fetch failed for %s: %s", url, str(e)[:80])
            return []

        return self._extract_listings(html, url)

    def _extract_listings(self, html: str, url: str) -> List[Dict[str, Any]]:
        if not html or len(html) < 200:
            return []

        raw_rows = self.parse_table(html, "table")
        if raw_rows:
            return self._rows_to_listings(raw_rows, url)

        return self._text_address_fallback(html, url)

    def _rows_to_listings(self, raw_rows: List[Dict[str, str]], url: str) -> List[Dict[str, Any]]:
        listings: List[Dict[str, Any]] = []
        for row in raw_rows:
            try:
                address = (
                    row.get("property_address")
                    or row.get("address")
                    or row.get("property")
                    or row.get("location")
                    or ""
                ).strip()
                if not address or len(address) < 6:
                    continue

                sale_date_raw = row.get("sale_date") or row.get("auction_date") or row.get("date") or ""
                sale_date = self.parse_date(sale_date_raw) if sale_date_raw else None

                listing: Dict[str, Any] = {
                    "address": address,
                    "city": (row.get("city") or "Dallas").strip(),
                    "state": "TX",
                    "zip": (row.get("zip") or row.get("zip_code") or "").strip() or None,
                    "county": "Dallas",
                    "case_number": (
                        row.get("case_number") or row.get("cause_number") or row.get("instrument") or ""
                    ).strip()
                    or None,
                    "owner_name": (
                        row.get("owner") or row.get("owner_name") or row.get("grantor") or ""
                    ).strip()
                    or None,
                    "sale_date": sale_date,
                    "sale_type": "trustee_sale",
                    "opening_bid": self.parse_money(
                        row.get("minimum_bid") or row.get("bid") or row.get("amount") or ""
                    ),
                    "source_url": url,
                    "source": "dallas_tx",
                    "scraped_at": datetime.utcnow().isoformat(),
                }

                if self.validate_listing(listing):
                    listings.append(listing)

            except Exception as e:
                log.debug("[Dallas TX] Row parse failed: %s — %s", row, e)
                continue

        log.info("[Dallas TX] Table parse → %d valid listings from %s", len(listings), url)
        return listings

    def _text_address_fallback(self, html: str, url: str) -> List[Dict[str, Any]]:
        try:
            from selectolax.parser import HTMLParser

            text = HTMLParser(html).text()
        except Exception:
            text = re.sub(r"<[^>]+>", " ", html)

        addresses = list(dict.fromkeys(_ADDRESS_RE.findall(text)))[:50]
        if not addresses:
            log.info("[Dallas TX] Text fallback found no addresses in %s", url)
            return []

        listings: List[Dict[str, Any]] = []
        for addr in addresses:
            listing: Dict[str, Any] = {
                "address": addr.strip(),
                "city": "Dallas",
                "state": "TX",
                "zip": None,
                "county": "Dallas",
                "sale_type": "trustee_sale",
                "source_url": url,
                "source": "dallas_tx",
                "scraped_at": datetime.utcnow().isoformat(),
            }
            if self.validate_listing(listing):
                listings.append(listing)

        log.info("[Dallas TX] Text fallback → %d addresses from %s", len(listings), url)
        return listings
