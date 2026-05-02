"""Propwire authenticated scraper.

Capabilities
============
- `search_address(query)`         → resolves to a /realestate/<addrId>/<id> URL
- `fetch_property(url_or_query)`  → property tab: details, owner, photos
- `fetch_comps(url_or_query)`     → comparable-sales tab
- `fetch_history(url_or_query)`   → sale + mortgage history
- `fetch_cash_buyers_nearby(url_or_query, **filters)` → nearby investor list

Auth: PROPWIRE_EMAIL + PROPWIRE_PASSWORD env vars.
Session: cached on disk via _browser_session helper.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

from ._browser_session import browser_context, invalidate_session
from ._utils import _safe_num, _parse_buyer_card

log = logging.getLogger("propwire")

PROPWIRE_BASE = "https://propwire.com"
LOGIN_URL = f"{PROPWIRE_BASE}/login"
SEARCH_URL = f"{PROPWIRE_BASE}/search?filters=%7B%7D"

SERVICE = "propwire"


# ─── Login ───────────────────────────────────────────────────────────────────


async def _do_login(page) -> None:
    email = os.getenv("PROPWIRE_EMAIL")
    password = os.getenv("PROPWIRE_PASSWORD")
    if not (email and password):
        raise RuntimeError("PROPWIRE_EMAIL / PROPWIRE_PASSWORD not set")

    log.info("Propwire: navigating to login page")
    # networkidle gives React/Next.js time to fully render the login form
    await page.goto(LOGIN_URL, wait_until="networkidle", timeout=60000)

    # Try multiple selector variants — Propwire periodically updates markup
    email_sel = (
        'input[type="email"], input[name="email"], '
        'input[autocomplete="email"], input[id*="email" i], input[placeholder*="email" i]'
    )
    pw_sel = (
        'input[type="password"], input[name="password"], '
        'input[autocomplete="current-password"]'
    )

    await page.wait_for_selector(email_sel, timeout=30000)
    await page.fill(email_sel, email)
    await page.fill(pw_sel, password)

    btn = page.locator(
        'button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), '
        'button:has-text("Login"), input[type="submit"]'
    ).first
    if await btn.count():
        await btn.click()
    else:
        await page.locator(pw_sel).first.press("Enter")

    # Wait for ANY URL change away from /login
    try:
        await page.wait_for_function(
            "() => !window.location.href.includes('/login')",
            timeout=35000,
        )
    except Exception:
        await page.wait_for_load_state("networkidle", timeout=15000)

    if "/login" in page.url:
        raise RuntimeError("Propwire login failed (still on /login)")

    log.info("Propwire: login OK, now at %s", page.url)


# ─── Helpers ─────────────────────────────────────────────────────────────────


async def _resolve_property_url(ctx, query_or_url: str) -> str:
    """If `query_or_url` is a URL return it; otherwise search and return URL."""
    if query_or_url.startswith("http"):
        return query_or_url

    page = await ctx.new_page()
    try:
        await page.goto(SEARCH_URL, wait_until="domcontentloaded", timeout=30000)
        if "/login" in page.url:
            await invalidate_session(SERVICE)
            raise RuntimeError("Propwire session expired")

        search = page.locator(
            'input[placeholder*="address" i], input[placeholder*="search" i], input[type="search"]'
        ).first
        await search.wait_for(state="visible", timeout=15000)
        await search.fill(query_or_url)
        await page.wait_for_timeout(900)

        # Try to click first dropdown suggestion
        sugg = page.locator('[role="option"], li[role="option"], .suggestion-item').first
        if await sugg.count():
            await sugg.click()
        else:
            await search.press("Enter")

        try:
            await page.wait_for_url(re.compile(r"/realestate/"), timeout=20000)
        except Exception:
            pass

        url = page.url
        if "/realestate/" not in url:
            raise RuntimeError(f"Propwire could not resolve address: {query_or_url}")
        return url
    finally:
        await page.close()


# ─── Public API ──────────────────────────────────────────────────────────────


async def fetch_property(query_or_url: str) -> Dict[str, Any]:
    """Property tab: details, owner, beds/baths/sqft, value, photos."""
    async with browser_context(SERVICE, login_fn=_do_login) as ctx:
        url = await _resolve_property_url(ctx, query_or_url)
        # Force the property tab
        prop_url = re.sub(r"/(comparable-sales|history|owner|market)$", "", url) or url
        page = await ctx.new_page()
        try:
            await page.goto(prop_url, wait_until="networkidle", timeout=45000)
            if "/login" in page.url:
                await invalidate_session(SERVICE)
                raise RuntimeError("Propwire session expired")

            # Pull __NEXT_DATA__ (Propwire is a Next.js app — JSON of the page state)
            next_data = await page.evaluate(
                "() => { const el = document.getElementById('__NEXT_DATA__');"
                " return el ? el.textContent : null; }"
            )

            data: Dict[str, Any] = {}
            if next_data:
                try:
                    parsed = json.loads(next_data)
                    data = (parsed.get("props") or {}).get("pageProps") or {}
                except Exception:
                    pass

            # Fallback: scrape visible text into structured fields.
            if not data:
                data = await _scrape_property_dom(page)

            return {
                "url": prop_url,
                "address": data.get("address") or data.get("displayAddress") or query_or_url,
                "details": _extract_details(data),
                "owner": _extract_owner(data),
                "raw": data,
            }
        finally:
            await page.close()


def _extract_details(data: Dict[str, Any]) -> Dict[str, Any]:
    p = data.get("property") or data
    return {
        "beds": _safe_num(p.get("bedrooms") or p.get("beds")),
        "baths": _safe_num(p.get("bathrooms") or p.get("baths")),
        "sqft": _safe_num(p.get("livingArea") or p.get("sqft") or p.get("buildingSqft")),
        "lot_sqft": _safe_num(p.get("lotSize") or p.get("lotSqft")),
        "year_built": _safe_num(p.get("yearBuilt")),
        "garage": p.get("garage") or p.get("garageSpaces"),
        "basement": p.get("basement"),
        "pool": p.get("pool"),
        "amenities": p.get("amenities") or p.get("features") or [],
        "utilities": p.get("utilities") or {},
        "estimated_value": _safe_num(p.get("estimatedValue") or p.get("avm")),
        "last_sold_price": _safe_num(p.get("lastSoldPrice")),
        "last_sold_date": p.get("lastSoldDate"),
        "property_type": p.get("propertyType") or p.get("type"),
    }


def _extract_owner(data: Dict[str, Any]) -> Dict[str, Any]:
    o = data.get("owner") or (data.get("property") or {}).get("owner") or {}
    return {
        "name": o.get("name") or o.get("ownerName"),
        "mailing_address": o.get("mailingAddress"),
        "is_llc": bool(o.get("isLLC") or o.get("isCorporate")),
        "owner_occupied": o.get("ownerOccupied"),
    }


async def _scrape_property_dom(page) -> Dict[str, Any]:
    """Best-effort DOM fallback when __NEXT_DATA__ isn't usable."""
    out: Dict[str, Any] = {}

    async def _grab(label: str) -> Optional[str]:
        try:
            loc = page.locator(f'text=/{label}/i').first
            if not await loc.count():
                return None
            sib = loc.locator("xpath=following-sibling::*[1]")
            if await sib.count():
                return (await sib.inner_text()).strip()
        except Exception:
            return None
        return None

    for k, label in [
        ("bedrooms", "Bedrooms"), ("bathrooms", "Bathrooms"),
        ("sqft", "Building Sqft"), ("lotSize", "Lot Size"),
        ("yearBuilt", "Year Built"), ("estimatedValue", "Estimated Value"),
        ("lastSoldPrice", "Last Sold Price"), ("lastSoldDate", "Last Sold Date"),
    ]:
        v = await _grab(label)
        if v:
            out[k] = v
    return {"property": out}


async def fetch_comps(query_or_url: str, *, max_results: int = 50) -> List[Dict[str, Any]]:
    async with browser_context(SERVICE, login_fn=_do_login) as ctx:
        base = await _resolve_property_url(ctx, query_or_url)
        comps_url = base.rstrip("/") + "/comparable-sales"
        page = await ctx.new_page()
        try:
            await page.goto(comps_url, wait_until="networkidle", timeout=45000)
            if "/login" in page.url:
                await invalidate_session(SERVICE)
                raise RuntimeError("Propwire session expired")

            # Try __NEXT_DATA__ first
            next_data = await page.evaluate(
                "() => { const el = document.getElementById('__NEXT_DATA__');"
                " return el ? el.textContent : null; }"
            )
            comps: List[Dict[str, Any]] = []
            if next_data:
                try:
                    parsed = json.loads(next_data)
                    pp = (parsed.get("props") or {}).get("pageProps") or {}
                    rows = pp.get("comps") or pp.get("comparableSales") or []
                    if isinstance(rows, list):
                        comps = [_propwire_normalise_comp(r) for r in rows]
                except Exception:
                    pass

            # Fallback: scrape table
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
                        "sold_price": _safe_num(cells[3]),
                        "price_per_sqft": _safe_num(cells[4]) if len(cells) > 4 else None,
                        "beds": _safe_num(cells[5]) if len(cells) > 5 else None,
                        "baths": _safe_num(cells[6]) if len(cells) > 6 else None,
                        "sqft": _safe_num(cells[7]) if len(cells) > 7 else None,
                        "lot_sqft": _safe_num(cells[8]) if len(cells) > 8 else None,
                        "year_built": _safe_num(cells[9]) if len(cells) > 9 else None,
                        "distance_miles": _safe_num(cells[10]) if len(cells) > 10 else None,
                    })
            return comps[:max_results]
        finally:
            await page.close()


def _propwire_normalise_comp(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "address": r.get("address") or r.get("street"),
        "city": r.get("city"),
        "state": r.get("state"),
        "zip": r.get("zip") or r.get("zipCode"),
        "sold_price": _safe_num(r.get("soldPrice") or r.get("price")),
        "sold_date": r.get("soldDate") or r.get("saleDate"),
        "beds": _safe_num(r.get("bedrooms")),
        "baths": _safe_num(r.get("bathrooms")),
        "sqft": _safe_num(r.get("sqft") or r.get("livingArea")),
        "lot_sqft": _safe_num(r.get("lotSize") or r.get("lotSqft")),
        "year_built": _safe_num(r.get("yearBuilt")),
        "distance_miles": _safe_num(r.get("distance") or r.get("distanceMiles")),
        "price_per_sqft": _safe_num(r.get("pricePerSqft") or r.get("ppsf")),
        "raw": r,
    }


async def fetch_history(query_or_url: str) -> Dict[str, Any]:
    """Sale history + mortgage history."""
    async with browser_context(SERVICE, login_fn=_do_login) as ctx:
        base = await _resolve_property_url(ctx, query_or_url)
        url = base.rstrip("/") + "/history"
        page = await ctx.new_page()
        try:
            await page.goto(url, wait_until="networkidle", timeout=45000)
            if "/login" in page.url:
                await invalidate_session(SERVICE)
                raise RuntimeError("Propwire session expired")

            next_data = await page.evaluate(
                "() => { const el = document.getElementById('__NEXT_DATA__');"
                " return el ? el.textContent : null; }"
            )
            sales: List[Dict[str, Any]] = []
            mortgages: List[Dict[str, Any]] = []
            if next_data:
                try:
                    parsed = json.loads(next_data)
                    pp = (parsed.get("props") or {}).get("pageProps") or {}
                    sales = pp.get("salesHistory") or pp.get("transactionHistory") or []
                    mortgages = pp.get("mortgageHistory") or pp.get("mortgages") or []
                except Exception:
                    pass
            return {"url": url, "sales": sales, "mortgages": mortgages}
        finally:
            await page.close()


async def fetch_tax(query_or_url: str) -> Dict[str, Any]:
    """Scrape tax assessment + tax history from Propwire's Property tab.

    Returns a dict with keys:
      assessed_value, market_value, annual_tax, tax_year,
      tax_history (list of {year, assessed, taxes}),
      land_value, improvement_value, parcel_id, legal_description
    """
    import json as _json

    async with browser_context(SERVICE, login_fn=_do_login) as ctx:
        base = await _resolve_property_url(ctx, query_or_url)
        # Tax info lives on the Property tab (root URL)
        prop_url = re.sub(r"/(comparable-sales|history|owner|market|comps|buyers)$", "", base) or base
        page = await ctx.new_page()
        try:
            await page.goto(prop_url, wait_until="networkidle", timeout=45000)
            if "/login" in page.url:
                await invalidate_session(SERVICE)
                raise RuntimeError("Propwire session expired")

            # Try __NEXT_DATA__ first — most data is embedded there
            next_data_raw = await page.evaluate(
                "() => { const el = document.getElementById('__NEXT_DATA__');"
                " return el ? el.textContent : null; }"
            )
            tax: Dict[str, Any] = {}
            tax_history: List[Dict[str, Any]] = []

            if next_data_raw:
                try:
                    parsed = _json.loads(next_data_raw)
                    pp = (parsed.get("props") or {}).get("pageProps") or {}
                    prop = pp.get("property") or pp.get("propertyDetails") or pp
                    tax_info = (prop.get("tax") or prop.get("taxInfo")
                                or prop.get("assessment") or {})
                    tax = {
                        "assessed_value":   _safe_num(tax_info.get("assessedValue") or tax_info.get("assessed")),
                        "market_value":     _safe_num(tax_info.get("marketValue") or tax_info.get("market")),
                        "land_value":       _safe_num(tax_info.get("landValue") or tax_info.get("land")),
                        "improvement_value": _safe_num(tax_info.get("improvementValue") or tax_info.get("improvement")),
                        "annual_tax":       _safe_num(tax_info.get("annualTax") or tax_info.get("taxes") or tax_info.get("taxAmount")),
                        "tax_year":         tax_info.get("taxYear") or tax_info.get("year"),
                        "parcel_id":        prop.get("parcelId") or prop.get("apn") or tax_info.get("parcelId"),
                        "legal_description": prop.get("legalDescription") or tax_info.get("legalDescription"),
                    }
                    tax_history = (prop.get("taxHistory") or pp.get("taxHistory") or [])
                except Exception:
                    pass

            # If __NEXT_DATA__ didn't have tax, fall back to DOM scraping
            if not any(v for v in tax.values() if v is not None):
                async def _grab_label(label: str) -> Optional[str]:
                    try:
                        sel = f'*:has-text("{label}") + *, *:has-text("{label}") ~ *'
                        el = page.locator(sel).first
                        return (await el.inner_text(timeout=3000)).strip()
                    except Exception:
                        return None

                tax = {
                    "assessed_value":   _safe_num(await _grab_label("Assessed Value")),
                    "market_value":     _safe_num(await _grab_label("Market Value")),
                    "land_value":       _safe_num(await _grab_label("Land Value")),
                    "improvement_value": _safe_num(await _grab_label("Improvement Value")),
                    "annual_tax":       _safe_num(await _grab_label("Annual Tax") or await _grab_label("Taxes")),
                    "tax_year":         await _grab_label("Tax Year"),
                    "parcel_id":        await _grab_label("Parcel ID") or await _grab_label("APN"),
                    "legal_description": await _grab_label("Legal Description"),
                }

            return {"url": prop_url, "tax": tax, "tax_history": tax_history}
        finally:
            await page.close()


async def fetch_cash_buyers_nearby(
    query_or_url: str,
    *,
    radius_miles: float = 1.0,
    min_properties: int = 3,
    max_results: int = 200,
    progress_cb=None,
) -> List[Dict[str, Any]]:
    """Propwire's nearby cash-buyer / investor list around a property."""
    async with browser_context(SERVICE, login_fn=_do_login) as ctx:
        base = await _resolve_property_url(ctx, query_or_url)
        # Propwire's nearby-buyers tab URL pattern can vary; try a few.
        candidates = [
            base.rstrip("/") + "/cash-buyers",
            base.rstrip("/") + "/buyers",
            base.rstrip("/") + "/nearby-buyers",
        ]
        page = await ctx.new_page()
        buyers: List[Dict[str, Any]] = []
        try:
            chosen_url = None
            for c in candidates:
                await page.goto(c, wait_until="domcontentloaded", timeout=20000)
                if "/login" in page.url:
                    await invalidate_session(SERVICE)
                    raise RuntimeError("Propwire session expired")
                if not (await page.locator('text=/not found/i').count()
                        or await page.locator('text=/404/').count()):
                    chosen_url = c
                    break
            if not chosen_url:
                return []

            await page.wait_for_load_state("networkidle", timeout=10000)

            seen_pages = 0
            while len(buyers) < max_results and seen_pages < 30:
                # Try __NEXT_DATA__ first
                next_data = await page.evaluate(
                    "() => { const el = document.getElementById('__NEXT_DATA__');"
                    " return el ? el.textContent : null; }"
                )
                page_buyers: List[Dict[str, Any]] = []
                if next_data:
                    try:
                        parsed = json.loads(next_data)
                        pp = (parsed.get("props") or {}).get("pageProps") or {}
                        rows = (pp.get("buyers") or pp.get("cashBuyers")
                                or pp.get("nearbyBuyers") or [])
                        if isinstance(rows, list):
                            page_buyers = rows
                    except Exception:
                        pass

                if not page_buyers:
                    cards = await page.locator(
                        '[data-testid*="buyer"], .buyer-card, .investor-card, '
                        'li:has-text("Average Deal")'
                    ).all()
                    for card in cards:
                        text = (await card.inner_text()).strip()
                        if text:
                            page_buyers.append(_parse_buyer_card(text))

                for b in page_buyers:
                    norm = _normalise_buyer(b)
                    pc = norm.get("props_count")
                    if pc is not None and pc < min_properties:
                        continue
                    key = (str(norm.get("name", "")).lower(),
                           str(norm.get("address") or "").lower())
                    if not any(
                        (str(x.get("name", "")).lower(),
                         str(x.get("address") or "").lower()) == key for x in buyers
                    ):
                        buyers.append(norm)

                if progress_cb:
                    pct = min(99, int(100 * len(buyers) / max(max_results, 1)))
                    try:
                        await progress_cb(pct, f"page {seen_pages + 1}: {len(buyers)} buyers")
                    except Exception:
                        pass

                next_btn = page.locator(
                    'button:has-text("NEXT"), button:has-text("Next"), a:has-text("Next")'
                ).first
                if not await next_btn.count():
                    break
                disabled = await next_btn.get_attribute("disabled")
                if disabled is not None:
                    break
                try:
                    await next_btn.click()
                    await page.wait_for_load_state("networkidle", timeout=8000)
                except Exception:
                    break
                seen_pages += 1

            return buyers[:max_results]
        finally:
            await page.close()


def _normalise_buyer(b: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "name": b.get("name") or b.get("buyerName") or b.get("displayName"),
        "llc": b.get("llc") or b.get("entityName") or b.get("company"),
        "props_count": (b.get("props_count") or b.get("propertyCount")
                        or b.get("portfolioSize")),
        "avg_deal": _safe_num(b.get("avg_deal") or b.get("averagePrice")
                              or b.get("avgPurchasePrice")),
        "total_deal": _safe_num(b.get("total_deal") or b.get("portfolioValue")),
        "last_deal": b.get("last_deal") or b.get("lastPurchaseDate"),
        "price_min": _safe_num(b.get("price_min") or b.get("minPrice")),
        "price_max": _safe_num(b.get("price_max") or b.get("maxPrice")),
        "address": b.get("address") or b.get("mailingAddress"),
        "city": b.get("city"),
        "state": b.get("state"),
        "zip": b.get("zip") or b.get("zipCode"),
        "types": b.get("types") or [],
        "raw": b,
    }
