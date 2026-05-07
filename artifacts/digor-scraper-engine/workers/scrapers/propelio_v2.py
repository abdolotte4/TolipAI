"""Propelio authenticated scraper.

Replaces the old free-tier `propelio.py` with an authenticated client that
hits https://genesis.propelio.com directly.

Capabilities
============
- `search_property(address)`           → returns property_id + basic record
- `fetch_comps(property_id)`           → MLS-style comparable sales array
- `fetch_cash_buyers(property_id, ...)` → paginated cash-buyer list (the
  "5523 results" view) with landlord/flipper filters and min-properties
- `fetch_skiptrace(property_id)`       → owner contact info if entitled

Auth: PROPELIO_EMAIL + PROPELIO_PASSWORD env vars.
Session: cached on disk via _browser_session helper.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

from ._browser_session import browser_context, invalidate_session, _nav_with_fallback
from ._utils import _safe_num, _parse_buyer_card

log = logging.getLogger("propelio")

PROPELIO_BASE = "https://genesis.propelio.com"
LOGIN_URL = f"{PROPELIO_BASE}/login"
SEARCH_URL = f"{PROPELIO_BASE}/search"

SERVICE = "propelio"


# ─── Login ───────────────────────────────────────────────────────────────────


async def _do_login(page) -> None:
    email = os.getenv("PROPELIO_EMAIL")
    password = os.getenv("PROPELIO_PASSWORD")
    if not (email and password):
        raise RuntimeError("PROPELIO_EMAIL / PROPELIO_PASSWORD not set")

    log.info("Propelio: navigating to login page")
    email_sel = (
        'input[type="email"], input[name="email"], input[name="username"], '
        'input[autocomplete="email"], input[id*="email" i], input[placeholder*="email" i]'
    )
    pw_sel = (
        'input[type="password"], input[name="password"], '
        'input[autocomplete="current-password"], input[autocomplete="password"]'
    )

    # Use "commit" (fires as soon as the server starts sending bytes) instead of
    # "domcontentloaded" — the latter waits for the full DOM parse which can
    # time out on slow proxy routes.  We then wait explicitly for the email input.
    for attempt in range(2):
        try:
            await page.goto(LOGIN_URL, wait_until="commit", timeout=30000)
            break
        except Exception as nav_err:
            if attempt == 0:
                log.warning("Propelio: first navigation attempt failed (%s), retrying…", nav_err)
                await page.wait_for_timeout(2000)
            else:
                # Last resort: try domcontentloaded with shorter budget
                log.warning("Propelio: fallback navigation with domcontentloaded")
                await page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=20000)

    # Capture a screenshot for debug if something goes wrong later
    _screenshot_path = "/tmp/propelio_login_debug.png"

    # Form selectors — try multiple variants in case Propelio updates their markup
    try:
        await page.wait_for_selector(email_sel, timeout=20000)
    except Exception:
        try:
            await page.screenshot(path=_screenshot_path)
            log.warning("Propelio: email selector not found — screenshot saved to %s", _screenshot_path)
        except Exception:
            pass
        # One more navigation attempt
        await page.goto(LOGIN_URL, wait_until="commit", timeout=20000)
        await page.wait_for_selector(email_sel, timeout=15000)

    # Explicitly click then fill — React needs focus events to fire onChange handlers
    email_el = page.locator(email_sel).first
    await email_el.click()
    await page.wait_for_timeout(300)
    await email_el.fill(email)
    await page.wait_for_timeout(200)

    pw_el = page.locator(pw_sel).first
    await pw_el.click()
    await page.wait_for_timeout(300)
    await pw_el.fill(password)
    await page.wait_for_timeout(300)

    # Submit — check all common button text variants (including all-caps "SIGN IN")
    btn = page.locator(
        'button[type="submit"], button:has-text("SIGN IN"), button:has-text("Sign In"), '
        'button:has-text("Sign in"), button:has-text("LOG IN"), button:has-text("Log In"), '
        'button:has-text("Log in"), button:has-text("Login"), input[type="submit"]'
    ).first
    if await btn.count():
        await btn.click()
    else:
        await pw_el.press("Enter")

    # Wait for navigation AWAY from /login — accept ANY URL that is not the login page
    try:
        await page.wait_for_function(
            "() => !window.location.href.includes('/login')",
            timeout=40000,
        )
    except Exception:
        try:
            await page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass

    if "/login" in page.url:
        # Capture any visible error message to help diagnose
        try:
            err_el = page.locator('[role="alert"], .error, .alert, [class*="error" i]').first
            err_text = (await err_el.inner_text(timeout=3000)).strip() if await err_el.count() else ""
        except Exception:
            err_text = ""
        raise RuntimeError(
            f"Propelio login failed (still on /login). "
            f"Page error: {err_text or 'none detected'}"
        )

    log.info("Propelio: login OK, now at %s", page.url)


# ─── Helpers ─────────────────────────────────────────────────────────────────


async def _intercept_json(page, url_pattern: re.Pattern, timeout_ms: int = 25000) -> List[Dict[str, Any]]:
    """Wait for an XHR response matching url_pattern and return its parsed JSON."""
    captured: List[Dict[str, Any]] = []

    async def on_response(resp):
        try:
            if url_pattern.search(resp.url) and "application/json" in (resp.headers.get("content-type") or ""):
                body = await resp.json()
                captured.append({"url": resp.url, "body": body})
        except Exception:
            pass

    page.on("response", on_response)
    try:
        # Wait until at least one match arrives or timeout
        end_at = asyncio.get_event_loop().time() + timeout_ms / 1000
        while not captured and asyncio.get_event_loop().time() < end_at:
            await page.wait_for_timeout(250)
    finally:
        page.remove_listener("response", on_response)
    return captured


# ─── Public API ──────────────────────────────────────────────────────────────


async def search_property(address: str) -> Dict[str, Any]:
    """Search Propelio for an address and return basic property metadata.

    Returns: {address, property_id, url, raw} where property_id is the
    numeric ID Propelio uses in URLs like /search/<id>/cash-buyers.
    """
    if not address:
        return {"address": "", "property_id": None}

    async with browser_context(SERVICE, login_fn=_do_login) as ctx:
        page = await ctx.new_page()
        try:
            await _nav_with_fallback(page, SEARCH_URL, log, SERVICE)

            # If we got bounced to login the cached session was stale → invalidate.
            if "/login" in page.url:
                await invalidate_session(SERVICE)
                raise RuntimeError("Propelio session expired; retry to re-login")

            # Type address into the search box — the input is usually labelled.
            search_input = page.locator(
                'input[placeholder*="address" i], input[placeholder*="search" i], input[type="search"]'
            ).first
            await search_input.wait_for(state="visible", timeout=15000)
            await search_input.fill(address)
            await page.wait_for_timeout(800)
            await search_input.press("Enter")

            # Wait for a navigation to /search/<id>/...
            try:
                await page.wait_for_url(re.compile(r"/search/\d+"), timeout=20000)
            except Exception:
                # Sometimes Propelio shows a dropdown — click the first suggestion.
                first = page.locator('[role="option"], li[role="option"], .search-result').first
                if await first.count():
                    await first.click()
                    await page.wait_for_url(re.compile(r"/search/\d+"), timeout=15000)

            m = re.search(r"/search/(\d+)", page.url)
            prop_id = m.group(1) if m else None
            return {
                "address": address,
                "property_id": prop_id,
                "url": page.url,
            }
        finally:
            await page.close()


async def fetch_comps(
    property_id: str,
    *,
    radius_miles: float = 0.5,
    max_results: int = 25,
) -> List[Dict[str, Any]]:
    """Pull comparable-sales rows for a property already opened in Propelio."""
    if not property_id:
        return []
    url = f"{PROPELIO_BASE}/search/{property_id}/comparable-sales"

    async with browser_context(SERVICE, login_fn=_do_login) as ctx:
        page = await ctx.new_page()
        comps: List[Dict[str, Any]] = []
        try:
            await _nav_with_fallback(page, url, log, SERVICE)
            if "/login" in page.url:
                await invalidate_session(SERVICE)
                raise RuntimeError("Propelio session expired")

            # Try API capture first — Propelio loads comps via XHR.
            api_pat = re.compile(r"/api/.*(comp|comparable)", re.IGNORECASE)
            xhr = await _intercept_json(page, api_pat, timeout_ms=10000)
            for item in xhr:
                body = item.get("body")
                if isinstance(body, dict):
                    rows = body.get("data") or body.get("comps") or body.get("results") or []
                    if isinstance(rows, list):
                        comps.extend([_normalise_comp(r) for r in rows])

            # Fallback: parse the rendered table.
            if not comps:
                rows = await page.locator('table tbody tr').all()
                for row in rows[:max_results]:
                    cells = await row.locator("td").all_text_contents()
                    if len(cells) < 4:
                        continue
                    comps.append({
                        "address": cells[0].strip() if len(cells) > 0 else None,
                        "status": cells[1].strip() if len(cells) > 1 else None,
                        "sold_date": cells[2].strip() if len(cells) > 2 else None,
                        "sold_price": _safe_num(cells[3]) if len(cells) > 3 else None,
                        "price_per_sqft": _safe_num(cells[4]) if len(cells) > 4 else None,
                        "beds": _safe_num(cells[5]) if len(cells) > 5 else None,
                        "baths": _safe_num(cells[6]) if len(cells) > 6 else None,
                        "sqft": _safe_num(cells[7]) if len(cells) > 7 else None,
                    })

            return comps[:max_results]
        finally:
            await page.close()


def _normalise_comp(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "address": r.get("address") or r.get("street") or r.get("formatted_address"),
        "city": r.get("city"),
        "state": r.get("state"),
        "zip": r.get("zip") or r.get("zip_code") or r.get("postal_code"),
        "sold_price": _safe_num(r.get("sold_price") or r.get("price") or r.get("sale_price")),
        "sold_date": r.get("sold_date") or r.get("sale_date") or r.get("close_date"),
        "beds": _safe_num(r.get("beds") or r.get("bedrooms")),
        "baths": _safe_num(r.get("baths") or r.get("bathrooms")),
        "sqft": _safe_num(r.get("sqft") or r.get("building_sqft") or r.get("living_area")),
        "lot_sqft": _safe_num(r.get("lot_sqft") or r.get("lot_size")),
        "year_built": _safe_num(r.get("year_built") or r.get("built")),
        "distance_miles": _safe_num(r.get("distance") or r.get("distance_miles")),
        "price_per_sqft": _safe_num(r.get("price_per_sqft") or r.get("ppsf")),
        "days_on_market": _safe_num(r.get("dom") or r.get("days_on_market")),
        "property_type": r.get("property_type") or r.get("type"),
        "raw": r,
    }


async def fetch_cash_buyers(
    property_id: str,
    *,
    distance_miles: int = 10,
    active_within: str = "ANY_TIME",     # ANY_TIME | LAST_6M | LAST_1Y | LAST_2Y
    min_properties: int = 3,
    landlords: bool = True,
    flippers: bool = True,
    max_results: int = 500,
    progress_cb=None,
) -> List[Dict[str, Any]]:
    """Scrape Propelio's cash-buyers panel (the 5523-result view).

    Returns list of buyers: {name, llc, props_count, avg_deal, total_deal,
                             last_deal, price_range, address, types[], raw}
    """
    if not property_id:
        return []

    url = f"{PROPELIO_BASE}/search/{property_id}/cash-buyers"
    buyers: List[Dict[str, Any]] = []
    api_pat = re.compile(r"cash[-_]?buyers?|/buyers", re.IGNORECASE)

    async with browser_context(SERVICE, login_fn=_do_login) as ctx:
        page = await ctx.new_page()
        # ── Register XHR capture BEFORE navigation so first-page results aren't missed ──
        pending_xhr: List[Dict[str, Any]] = []

        async def _capture_response(resp):
            try:
                if (api_pat.search(resp.url)
                        and "application/json" in (resp.headers.get("content-type") or "")):
                    body = await resp.json()
                    pending_xhr.append({"url": resp.url, "body": body})
            except Exception:
                pass

        page.on("response", _capture_response)
        try:
            await _nav_with_fallback(page, url, log, SERVICE)
            if "/login" in page.url:
                await invalidate_session(SERVICE)
                raise RuntimeError("Propelio session expired")

            # Apply filters via the toolbar — selectors may shift; we try several.
            # Distance pill
            try:
                pill = page.locator('text=/DISTANCE/i').first
                if await pill.count():
                    await pill.click()
                    opt = page.locator(f'text=/{distance_miles}\\s*MILES?/i').first
                    if await opt.count():
                        await opt.click()
            except Exception:
                pass

            # Active within pill
            try:
                pill = page.locator('text=/ACTIVE WITHIN/i').first
                if await pill.count():
                    await pill.click()
                    label_map = {
                        "ANY_TIME": "ANY TIME",
                        "LAST_6M": "LAST 6 MONTHS",
                        "LAST_1Y": "LAST 1 YEAR",
                        "LAST_2Y": "LAST 2 YEARS",
                    }
                    target = label_map.get(active_within.upper(), "ANY TIME")
                    opt = page.locator(f'text=/{target}/i').first
                    if await opt.count():
                        await opt.click()
            except Exception:
                pass

            # Min properties
            try:
                pill = page.locator('text=/MINIMUM PROP/i').first
                if await pill.count():
                    await pill.click()
                    opt = page.locator(
                        f'text=/^\\s*{min_properties}\\s*OR MORE\\s*$/i'
                    ).first
                    if await opt.count():
                        await opt.click()
            except Exception:
                pass

            # Landlord / Flipper checkboxes
            try:
                for label, on in [("Landlords", landlords), ("Flippers", flippers)]:
                    cb = page.locator(f'label:has-text("{label}") input[type="checkbox"]').first
                    if await cb.count():
                        is_on = await cb.is_checked()
                        if is_on != on:
                            await cb.click()
            except Exception:
                pass

            await page.wait_for_load_state("domcontentloaded", timeout=15000)

            def _drain_xhr() -> List[Dict[str, Any]]:
                """Consume all accumulated XHR responses and return normalised buyer rows."""
                rows: List[Dict[str, Any]] = []
                while pending_xhr:
                    item = pending_xhr.pop(0)
                    body = item.get("body") or {}
                    raw = (body.get("data") or body.get("buyers")
                           or body.get("results") or body.get("items") or [])
                    if isinstance(raw, list):
                        rows.extend(raw)
                return rows

            # Now paginate through results
            seen_pages = 0
            while len(buyers) < max_results and seen_pages < 50:
                # Drain any XHR responses captured since last check
                page_buyers: List[Dict[str, Any]] = _drain_xhr()

                # DOM fallback — always run to complement XHR (handles cases where
                # the API response shape doesn't match our keys)
                if not page_buyers:
                    cards = await page.locator(
                        '[data-testid*="buyer"], .buyer-card, .result-card, '
                        'li:has-text("Average Deal"), div:has-text("Average Deal")'
                    ).all()
                    for card in cards:
                        text = (await card.inner_text()).strip()
                        if not text:
                            continue
                        page_buyers.append(_parse_buyer_card(text))

                # Dedupe by name+address
                for b in page_buyers:
                    norm = _normalise_buyer(b)
                    key = (norm.get("name", "").lower(), (norm.get("address") or "").lower())
                    if not any(
                        (x.get("name", "").lower(), (x.get("address") or "").lower()) == key
                        for x in buyers
                    ):
                        buyers.append(norm)

                if progress_cb:
                    pct = min(99, int(100 * len(buyers) / max(max_results, 1)))
                    try:
                        await progress_cb(pct, f"page {seen_pages + 1}: {len(buyers)} buyers")
                    except Exception:
                        pass

                # Click NEXT
                next_btn = page.locator('button:has-text("NEXT"), button:has-text("Next")').first
                if not await next_btn.count():
                    break
                disabled = await next_btn.get_attribute("disabled")
                if disabled is not None:
                    break
                try:
                    await next_btn.click()
                    await page.wait_for_load_state("domcontentloaded", timeout=8000)
                except Exception:
                    break
                seen_pages += 1

            return buyers[:max_results]
        finally:
            try:
                page.remove_listener("response", _capture_response)
            except Exception:
                pass
            await page.close()


def _normalise_buyer(b: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "name": b.get("name") or b.get("buyer_name") or b.get("display_name"),
        "llc": b.get("llc") or b.get("entity_name") or b.get("company"),
        "props_count": b.get("props_count") or b.get("property_count") or b.get("portfolio_size"),
        "avg_deal": _safe_num(b.get("avg_deal") or b.get("average_deal") or b.get("avg_purchase_price")),
        "total_deal": _safe_num(b.get("total_deal") or b.get("portfolio_value")),
        "last_deal": b.get("last_deal") or b.get("last_purchase_date"),
        "price_min": _safe_num(b.get("price_min") or b.get("min_price")),
        "price_max": _safe_num(b.get("price_max") or b.get("max_price")),
        "address": b.get("address") or b.get("mailing_address"),
        "city": b.get("city"),
        "state": b.get("state"),
        "zip": b.get("zip") or b.get("zip_code"),
        "types": b.get("types") or [],
        "raw": b,
    }


# ─── Convenience wrappers (used by main.py) ─────────────────────────────────


async def estimate_arv(address: str, *, radius_miles: float = 0.5) -> Dict[str, Any]:
    """Search → comps → median sold price (kept for backwards compat)."""
    prop = await search_property(address)
    if not prop.get("property_id"):
        return {"address": address, "property_id": None, "comps": [], "arv_estimate": None}
    comps = await fetch_comps(prop["property_id"], radius_miles=radius_miles)
    prices = sorted(float(c["sold_price"]) for c in comps if c.get("sold_price"))
    arv = None
    if prices:
        n = len(prices)
        median = prices[n // 2] if n % 2 else (prices[n // 2 - 1] + prices[n // 2]) / 2
        arv = {
            "median": median,
            "p25": prices[max(0, n // 4)],
            "p75": prices[min(n - 1, (3 * n) // 4)],
            "n_comps": n,
        }
    return {
        "address": address,
        "property_id": prop["property_id"],
        "comps": comps,
        "arv_estimate": arv,
    }


async def cash_buyers_for_address(
    address: str,
    *,
    distance_miles: int = 10,
    min_properties: int = 3,
    active_within: str = "ANY_TIME",
    landlords: bool = True,
    flippers: bool = True,
    max_results: int = 500,
    progress_cb=None,
) -> Dict[str, Any]:
    """One-shot: find a property by address then scrape its cash-buyer list."""
    prop = await search_property(address)
    if not prop.get("property_id"):
        return {"address": address, "buyers": [], "count": 0}
    buyers = await fetch_cash_buyers(
        prop["property_id"],
        distance_miles=distance_miles,
        active_within=active_within,
        min_properties=min_properties,
        landlords=landlords,
        flippers=flippers,
        max_results=max_results,
        progress_cb=progress_cb,
    )
    return {
        "address": address,
        "property_id": prop["property_id"],
        "filters": {
            "distance_miles": distance_miles,
            "min_properties": min_properties,
            "active_within": active_within,
            "landlords": landlords,
            "flippers": flippers,
        },
        "buyers": buyers,
        "count": len(buyers),
    }
