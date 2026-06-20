"""Broward County, FL — RealForeclose.com scraper.

Source: https://www.realforeclose.com/index.cfm?zaction=auction&zmethod=host&zhost=10
Type: Login required + reCAPTCHA (same platform as Miami-Dade)
Status: Requires CAPTCHA_API_KEY + REALFORECLOSE_USERNAME + REALFORECLOSE_PASSWORD
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any, Dict, List

from .base import CountyScraper

log = logging.getLogger("broward_fl")

_LOGIN_URL = "https://www.realforeclose.com/index.cfm?zaction=user&zmethod=logindisp"
_AUCTION_URL = "https://www.realforeclose.com/index.cfm?zaction=auction&zmethod=host&zhost=10"


class BrowardScraper(CountyScraper):
    county = "Broward"
    state = "FL"
    source_url = _AUCTION_URL
    requires_login = True
    requires_captcha = True

    async def scrape(self, days_back: int = 30) -> List[Dict[str, Any]]:
        username = os.getenv("REALFORECLOSE_USERNAME")
        password = os.getenv("REALFORECLOSE_PASSWORD")

        if not username or not password:
            log.warning(
                "[Broward FL] REALFORECLOSE_USERNAME/PASSWORD not set — skipping."
            )
            return []

        from ...captcha_solver import CaptchaSolver
        solver = CaptchaSolver()
        if not solver.available:
            log.warning("[Broward FL] CAPTCHA_API_KEY not set — skipping.")
            return []

        listings: List[Dict[str, Any]] = []

        try:
            from ..._browser_session import _nav_with_fallback, browser_context
        except ImportError:
            from workers.scrapers._browser_session import _nav_with_fallback, browser_context

        try:
            async with browser_context("broward_fl", headless=True, no_proxy=True) as ctx:
                page = await ctx.new_page()

                await _nav_with_fallback(page, _LOGIN_URL, log, "broward_fl")
                await page.wait_for_selector("input[name='username'], input[type='email']", timeout=10000)
                await page.fill("input[name='username'], input[type='email']", username)
                await page.fill("input[name='password'], input[type='password']", password)

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
                    self.log_block(_LOGIN_URL, "login_failed")
                    return []

                await _nav_with_fallback(page, _AUCTION_URL, log, "broward_fl")

                page_num = 1
                while True:
                    try:
                        await page.wait_for_selector("table, .AUCTION_ITEM", timeout=30000)
                    except Exception:
                        break

                    html = await page.content()
                    raw_rows = self.parse_table(html, "table")

                    for row in raw_rows:
                        address = (row.get("property_address") or row.get("address") or "").strip()
                        if not address:
                            continue
                        listing: Dict[str, Any] = {
                            "address": address,
                            "city": (row.get("city") or "Fort Lauderdale").strip(),
                            "state": "FL",
                            "zip": (row.get("zip") or "").strip() or None,
                            "county": "Broward",
                            "case_number": (row.get("case_number") or row.get("case#") or "").strip() or None,
                            "parcel_id": (row.get("parcel_id") or row.get("folio") or "").strip() or None,
                            "sale_date": self.parse_date(row.get("sale_date") or row.get("auction_date") or ""),
                            "sale_type": "foreclosure",
                            "opening_bid": self.parse_money(row.get("opening_bid") or row.get("assessed_value") or ""),
                            "source_url": self.source_url,
                            "source": "broward_fl",
                            "scraped_at": datetime.utcnow().isoformat(),
                        }
                        if self.validate_listing(listing):
                            listings.append(listing)

                    next_btn = await page.query_selector("a.NEXT_PAGE, a[title='Next Page'], .pager-next a")
                    if not next_btn or not await next_btn.is_visible():
                        break
                    await next_btn.click()
                    await page.wait_for_timeout(2000)
                    page_num += 1
                    if page_num > 20:
                        break

        except Exception as e:
            self.log_block(self.source_url, "scraper_error", str(e)[:200])
            return []

        log.info("[Broward FL] Scraped %d valid listings", len(listings))
        return listings
