"""Base class and shared utilities for all county scrapers.

All county scrapers MUST:
1. Inherit from CountyScraper
2. Implement scrape() returning List[Dict]
3. Use selectolax for HTML table parsing — NEVER pass HTML to an LLM
4. Call validate_listing() on every row before appending to results
5. Return [] (not raise) when blocked or when no data is available
6. Log structured SCRAPER_BLOCK events when blocked

Template for a new county scraper:
    class MyCountyScraper(CountyScraper):
        county = "MyCounty"
        state = "TX"
        source_url = "https://verified.county.gov/foreclosures"
        requires_login = False
        requires_captcha = False

        async def scrape(self, days_back: int = 30) -> List[Dict]:
            async with browser_context("my_county_tx") as ctx:
                page = await ctx.new_page()
                await page.goto(self.source_url)
                await page.wait_for_selector("table", timeout=30000)
                html = await page.content()
            raw_rows = self.parse_table(html, "table")
            results = []
            for row in raw_rows:
                listing = {...}  # map row fields
                if self.validate_listing(listing):
                    results.append(listing)
            return results
"""

from __future__ import annotations

import logging
import re
from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

log = logging.getLogger("county_scraper")


class CountyScraper(ABC):
    county: str = ""
    state: str = ""
    source_url: str = ""
    requires_login: bool = False
    requires_captcha: bool = False

    @abstractmethod
    async def scrape(self, days_back: int = 30) -> List[Dict[str, Any]]:
        """Return validated listing dicts. Must be implemented by each county."""

    def parse_table(self, html: str, selector: str) -> List[Dict[str, str]]:
        """Extract rows from an HTML table using selectolax.
        Returns list of dicts keyed by lowercase column headers.
        """
        try:
            from selectolax.parser import HTMLParser
        except ImportError:
            log.warning("[%s] selectolax not installed — falling back to BeautifulSoup", self.county)
            return self._parse_table_bs4(html, selector)

        tree = HTMLParser(html)
        table = tree.css_first(selector)
        if not table:
            log.warning("[%s] Table not found with selector: %s", self.county, selector)
            return []

        headers: List[str] = []
        # Try thead first, fall back to first tr
        thead = table.css_first("thead")
        if thead:
            headers = [th.text(strip=True).lower().replace(" ", "_") for th in thead.css("th")]
        else:
            first_tr = table.css_first("tr")
            if first_tr:
                headers = [td.text(strip=True).lower().replace(" ", "_") for td in first_tr.css("td,th")]

        if not headers:
            log.warning("[%s] No headers found in table", self.county)
            return []

        rows: List[Dict[str, str]] = []
        tbody = table.css_first("tbody") or table
        for tr in tbody.css("tr"):
            cells = [td.text(strip=True) for td in tr.css("td")]
            if not cells or len(cells) < 2:
                continue
            if len(cells) < len(headers):
                cells.extend([""] * (len(headers) - len(cells)))
            row = dict(zip(headers, cells[: len(headers)]))
            rows.append(row)
        return rows

    def _parse_table_bs4(self, html: str, selector: str) -> List[Dict[str, str]]:
        """BeautifulSoup fallback for table parsing."""
        try:
            from bs4 import BeautifulSoup

            soup = BeautifulSoup(html, "lxml")
            table = soup.select_one(selector)
            if not table:
                return []
            headers = [th.get_text(strip=True).lower().replace(" ", "_") for th in table.select("thead th")]
            if not headers:
                first_row = table.select_one("tr")
                if first_row:
                    headers = [
                        td.get_text(strip=True).lower().replace(" ", "_") for td in first_row.select("td,th")
                    ]
            rows = []
            for tr in table.select("tbody tr"):
                cells = [td.get_text(strip=True) for td in tr.select("td")]
                if cells and headers:
                    rows.append(dict(zip(headers, cells)))
            return rows
        except Exception as e:
            log.warning("[%s] BS4 table parse failed: %s", self.county, e)
            return []

    def parse_money(self, val: str) -> Optional[float]:
        """Parse a currency string to float. Returns None on failure."""
        if not val:
            return None
        try:
            cleaned = re.sub(r"[$,\s]", "", val)
            return float(cleaned)
        except (ValueError, TypeError):
            return None

    def parse_date(self, val: str, *formats: str) -> Optional[str]:
        """Parse a date string, trying multiple formats. Returns ISO string or None."""
        default_formats = formats or ("%m/%d/%Y", "%m-%d-%Y", "%Y-%m-%d", "%B %d, %Y", "%b %d, %Y")
        for fmt in default_formats:
            try:
                return datetime.strptime(val.strip(), fmt).date().isoformat()
            except (ValueError, AttributeError):
                continue
        return None

    def validate_listing(self, listing: Dict[str, Any]) -> bool:
        """Ensure required fields are present and non-empty."""
        required = ["address", "county", "state", "source_url"]
        for field in required:
            if not listing.get(field):
                log.debug("[%s] Dropped listing missing '%s': %s", self.county, field, str(listing)[:120])
                return False
        if len(listing.get("address", "")) < 5:
            log.debug("[%s] Dropped listing with too-short address: %s", self.county, listing.get("address"))
            return False
        return True

    def log_block(self, url: str, block_type: str, extra: str = "") -> None:
        """Emit a structured SCRAPER_BLOCK event."""
        log.warning(
            "SCRAPER_BLOCK county=%s url=%s block_type=%s %s",
            f"{self.county}_{self.state}".lower(),
            url,
            block_type,
            extra,
        )

    def cutoff_date(self, days_back: int) -> datetime:
        return datetime.now() - timedelta(days=days_back)
