"""Miami-Dade County, FL — RealForeclose.com scraper.

Source: https://www.realforeclose.com/index.cfm?zaction=auction&zmethod=host&zhost=2
Type: Login required + reCAPTCHA v2 on login form
Status: Requires CAPTCHA_API_KEY + REALFORECLOSE_USERNAME + REALFORECLOSE_PASSWORD env vars

Without credentials and CAPTCHA solving, this scraper returns [] with a structured log.
Set the following environment variables to enable:
  CAPTCHA_API_KEY=<2captcha_key>
  REALFORECLOSE_USERNAME=<email>
  REALFORECLOSE_PASSWORD=<password>
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any, Dict, List

from .base import CountyScraper

log = logging.getLogger("miami_dade_fl")

_LOGIN_URL = "https://www.realforeclose.com/index.cfm?zaction=user&zmethod=logindisp"
_AUCTION_URL = "https://www.realforeclose.com/index.cfm?zaction=auction&zmethod=host&zhost=2"


class MiamiDadeScraper(CountyScraper):
    county = "Miami-Dade"
    state = "FL"
    source_url = _AUCTION_URL
    requires_login = True
    requires_captcha = True

    async def scrape(self, days_back: int = 30) -> List[Dict[str, Any]]:
        username = os.getenv("REALFORECLOSE_USERNAME")
        password = os.getenv("REALFORECLOSE_PASSWORD")

        if not username or not password:
            log.warning(
                "[Miami-Dade FL] REALFORECLOSE_USERNAME/PASSWORD not set — skipping. "
                "Set credentials to enable RealForeclose scraping."
            )
            return []

        from ...captcha_solver import CaptchaSolver
        solver = CaptchaSolver()
        if not solver.available:
            log.warning(
                "[Miami-Dade FL] CAPTCHA_API_KEY not set — cannot solve login CAPTCHA. "
                "Set CAPTCHA_API_KEY (2Captcha) to enable this scraper."
            )
            return []

        listings: List[Dict[str, Any]] = []

        try:
            from ..._browser_session import _nav_with_fallback, browser_context
        except ImportError:
            from workers.scrapers._browser_session import _nav_with_fallback, browser_context

        try:
            async with browser_context("miami_dade_fl", headless=True, no_proxy=True) as ctx:
                page = await ctx.new_page()

                # ── Login ──────────────────────────────────────────────────────
                await _nav_with_fallback(page, _LOGIN_URL, log, "miami_dade_fl")
                await page.wait_for_selector("input[name='username'], input[type='email']", timeout=10000)
                await page.fill("input[name='username'], input[type='email']", username)
                await page.fill("input[name='password'], input[type='password']", password)

                # Solve reCAPTCHA if present
                captcha_frame = await page.query_selector("iframe[src*='recaptcha']")
                if captcha_frame:
                    src = await captcha_frame.get_attribute("src") or ""
                    import re
                    m = re.search(r"k=([A-Za-z0-9_-]+)", src)
                    site_key = m.group(1) if m else ""
                    if site_key:
                        token = await solver.solve_recaptcha_v2(site_key, _LOGIN_URL)
                        if token:
                            await page.evaluate(
                                f"document.getElementById('g-recaptcha-response').value = '{token}'"
                            )

                await page.click("button[type='submit'], input[type='submit']")
                try:
                    await page.wait_for_url("**/index.cfm**", timeout=30000)
                except Exception:
                    self.log_block(_LOGIN_URL, "login_failed", "Post-login redirect not detected")
                    return []

                # ── Navigate to auction list ───────────────────────────────────
                await _nav_with_fallback(page, _AUCTION_URL, log, "miami_dade_fl")

                page_num = 1
                while True:
                    try:
                        await page.wait_for_selector("table, .AUCTION_ITEM", timeout=30000)
                    except Exception:
                        self.log_block(_AUCTION_URL, "no_auction_table", f"page={page_num}")
                        break

                    html = await page.content()
                    raw_rows = self.parse_table(html, "table")

                    for row in raw_rows:
                        listing = self._parse_row(row)
                        if listing and self.validate_listing(listing):
                            listings.append(listing)

                    # Pagination
                    next_btn = await page.query_selector("a.NEXT_PAGE, a[title='Next Page'], .pager-next a")
                    if not next_btn:
                        break
                    is_visible = await next_btn.is_visible()
                    if not is_visible:
                        break
                    await next_btn.click()
                    await page.wait_for_timeout(2000)
                    page_num += 1
                    if page_num > 20:
                        log.warning("[Miami-Dade FL] Pagination safety limit reached at page 20")
                        break

        except Exception as e:
            self.log_block(self.source_url, "scraper_error", str(e)[:200])
            return []

        log.info("[Miami-Dade FL] Scraped %d valid listings", len(listings))
        return listings

    def _parse_row(self, row: Dict[str, str]) -> Dict[str, Any] | None:
        address = (
            row.get("property_address")
            or row.get("address")
            or row.get("property")
            or ""
        ).strip()
        if not address:
            return None

        return {
            "address": address,
            "city": (row.get("city") or "Miami").strip(),
            "state": "FL",
            "zip": (row.get("zip") or row.get("zip_code") or "").strip() or None,
            "county": "Miami-Dade",
            "case_number": (row.get("case_number") or row.get("case#") or row.get("certificate#") or "").strip() or None,
            "parcel_id": (row.get("parcel_id") or row.get("folio") or row.get("parcel#") or "").strip() or None,
            "sale_date": self.parse_date(row.get("sale_date") or row.get("auction_date") or ""),
            "sale_type": "foreclosure",
            "opening_bid": self.parse_money(row.get("opening_bid") or row.get("assessed_value") or ""),
            "source_url": self.source_url,
            "source": "miami_dade_fl",
            "scraped_at": datetime.utcnow().isoformat(),
        }
