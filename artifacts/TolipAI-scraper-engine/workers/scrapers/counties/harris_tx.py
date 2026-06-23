"""Harris County, TX — Tax Foreclosure & Notice of Sale scraper.

Primary source:  https://www.hctax.net/Property/PropertyTaxForeclosureSales
Fallback source: https://www.cclerk.hctx.net/applications/realprop/foreclosures.aspx

Strategy (in order):
  1. Playwright fetch of primary URL → selectolax table extraction
  2. http_client.fetch_rendered() of primary URL as Crawl4AI fallback
  3. Playwright fetch of clerk URL → same extraction
  Always returns [] (never raises) on block/error.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Dict, List

from .base import CountyScraper

log = logging.getLogger("harris_tx")

_MONEY_RE = re.compile(r"\$[\d,]+(\.\d{2})?")
_ADDRESS_RE = re.compile(
    r"\b\d{3,6}\s+\w[\w\s]{3,40}(?:ST|AVE|BLVD|DR|RD|LN|WAY|CT|PL|CIR|HWY|PKWY|"
    r"STREET|AVENUE|BOULEVARD|DRIVE|ROAD|LANE|COURT|PLACE|CIRCLE)\b",
    re.IGNORECASE,
)

_FALLBACK_URLS = [
    "https://www.cclerk.hctx.net/applications/realprop/foreclosures.aspx",
    "https://www.hctax.net/Property/Foreclosure",
]


class HarrisCountyScraper(CountyScraper):
    county = "Harris"
    state = "TX"
    source_url = "https://www.hctax.net/Property/PropertyTaxForeclosureSales"
    requires_login = False
    requires_captcha = False

    async def scrape(self, days_back: int = 30) -> List[Dict[str, Any]]:
        # Try primary URL first via Playwright
        listings = await self._scrape_url_playwright(self.source_url)
        if listings:
            return listings

        # Try fallback URLs via Crawl4AI (fetch_rendered)
        for url in _FALLBACK_URLS:
            listings = await self._scrape_url_crawl4ai(url)
            if listings:
                return listings

        log.info("[Harris TX] All sources returned 0 listings — site may need form interaction")
        return []

    async def _scrape_url_playwright(self, url: str) -> List[Dict[str, Any]]:
        """Fetch URL with Playwright and extract table data."""
        try:
            from ..._browser_session import _nav_with_fallback, browser_context
        except ImportError:
            try:
                from workers.scrapers._browser_session import _nav_with_fallback, browser_context
            except ImportError:
                return []

        try:
            async with browser_context("harris_tx", headless=True, no_proxy=True) as ctx:
                page = await ctx.new_page()
                await _nav_with_fallback(page, url, log, "harris_tx")

                try:
                    await page.wait_for_selector("table, .content, #main, body", timeout=25000)
                except Exception:
                    pass

                html = await page.content()

        except Exception as e:
            self.log_block(url, "navigation_failed", str(e)[:120])
            return []

        return self._extract_listings(html, url)

    async def _scrape_url_crawl4ai(self, url: str) -> List[Dict[str, Any]]:
        """Fetch URL with Crawl4AI (http_client.fetch_rendered) and extract table data."""
        try:
            try:
                from ...http_client import fetch_crawl4ai as fetch_rendered
            except ImportError:
                from workers.http_client import fetch_crawl4ai as fetch_rendered

            import asyncio

            html = await asyncio.wait_for(fetch_rendered(url, use_proxy=False), timeout=40)
        except Exception as e:
            log.debug("[Harris TX] Crawl4AI fetch failed for %s: %s", url, str(e)[:80])
            return []

        return self._extract_listings(html, url)

    def _extract_listings(self, html: str, url: str) -> List[Dict[str, Any]]:
        """Extract listings from HTML — tries table parse first, then text fallback."""
        if not html or len(html) < 200:
            return []

        # Try structured table extraction
        raw_rows = self.parse_table(html, "table")
        if raw_rows:
            return self._rows_to_listings(raw_rows, url)

        # Fallback: scan for address patterns in the raw text
        return self._text_address_fallback(html, url)

    def _rows_to_listings(self, raw_rows: List[Dict[str, str]], url: str) -> List[Dict[str, Any]]:
        listings: List[Dict[str, Any]] = []
        for row in raw_rows:
            try:
                address = (
                    row.get("property_address")
                    or row.get("address")
                    or row.get("situs_address")
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
                    "city": (row.get("city") or "Houston").strip(),
                    "state": "TX",
                    "zip": (row.get("zip") or row.get("zip_code") or "").strip() or None,
                    "county": "Harris",
                    "case_number": (
                        row.get("cause_number") or row.get("case_number") or row.get("case#") or ""
                    ).strip()
                    or None,
                    "parcel_id": (
                        row.get("parcel_id") or row.get("account_number") or row.get("account#") or ""
                    ).strip()
                    or None,
                    "sale_date": sale_date,
                    "sale_type": "tax_foreclosure",
                    "opening_bid": self.parse_money(
                        row.get("minimum_bid") or row.get("opening_bid") or row.get("bid") or ""
                    ),
                    "source_url": url,
                    "source": "harris_tx",
                    "scraped_at": datetime.utcnow().isoformat(),
                }

                if self.validate_listing(listing):
                    listings.append(listing)

            except Exception as e:
                log.debug("[Harris TX] Row parse failed: %s — %s", row, e)
                continue

        log.info("[Harris TX] Table parse → %d valid listings from %s", len(listings), url)
        return listings

    def _text_address_fallback(self, html: str, url: str) -> List[Dict[str, Any]]:
        """Extract addresses via regex when no table is found."""
        try:
            from selectolax.parser import HTMLParser

            text = HTMLParser(html).text()
        except Exception:
            text = re.sub(r"<[^>]+>", " ", html)

        addresses = list(dict.fromkeys(_ADDRESS_RE.findall(text)))[:50]
        if not addresses:
            log.info("[Harris TX] Text fallback found no addresses in %s", url)
            return []

        listings: List[Dict[str, Any]] = []
        for addr in addresses:
            listing: Dict[str, Any] = {
                "address": addr.strip(),
                "city": "Houston",
                "state": "TX",
                "zip": None,
                "county": "Harris",
                "sale_type": "tax_foreclosure",
                "source_url": url,
                "source": "harris_tx",
                "scraped_at": datetime.utcnow().isoformat(),
            }
            if self.validate_listing(listing):
                listings.append(listing)

        log.info("[Harris TX] Text fallback → %d addresses from %s", len(listings), url)
        return listings
