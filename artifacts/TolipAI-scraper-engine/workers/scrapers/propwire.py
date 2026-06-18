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
from functools import partial
from typing import Any, Dict, List, Optional

from ._browser_session import browser_context, invalidate_session, _nav_with_fallback, _humanize_mouse
from ._utils import _safe_num, _parse_buyer_card

log = logging.getLogger("propwire")

PROPWIRE_BASE = "https://propwire.com"
LOGIN_URL = f"{PROPWIRE_BASE}/login"
SEARCH_URL = f"{PROPWIRE_BASE}/search?filters=%7B%7D"

SERVICE = "propwire"

# ─── Bot-challenge detection ─────────────────────────────────────────────────

_BOT_CHALLENGE_INDICATORS = [
    "captcha-delivery.com",
    "datadome",
    "geo.captcha",
    "challenge",
    "cf-challenge",
    "turnstile",
    "hcaptcha",
    "recaptcha",
    "access denied",
    "blocked",
]


def _looks_like_challenge_page(html: str) -> bool:
    html_lower = html.lower()
    return any(indicator in html_lower for indicator in _BOT_CHALLENGE_INDICATORS)


# ─── Login ───────────────────────────────────────────────────────────────────


async def _do_login(page, email: str | None = None, password: str | None = None) -> None:
    email = email or os.getenv("PROPWIRE_EMAIL")
    password = password or os.getenv("PROPWIRE_PASSWORD")
    if not (email and password):
        raise RuntimeError("PROPWIRE_EMAIL / PROPWIRE_PASSWORD not set")

    log.info("Propwire: navigating to login page")

    # ── Step 0: Clear any stale state that might trigger bot detection ─────
    await page.context.clear_cookies()
    try:
        await page.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
    except Exception:
        pass

    # ── Step 1: Navigate with networkidle so JS SPA renders fully ──────────
    # Propwire is a React SPA; "commit" or "domcontentloaded" may fire before
    # the bundle downloads.  Use "networkidle" for the initial cold-start login.
    # Fallback through lighter strategies if the proxy stalls.
    _screenshot_dir = "/tmp"
    nav_ok = False
    for attempt, (strategy, timeout) in enumerate([
        ("networkidle", 45000),
        ("domcontentloaded", 30000),
        ("commit", 20000),
    ]):
        try:
            await page.goto(LOGIN_URL, wait_until=strategy, timeout=timeout)
            nav_ok = True
            log.info("Propwire: navigation succeeded with strategy=%s", strategy)
            break
        except Exception as nav_err:
            log.warning(
                "Propwire: nav attempt %d (%s) failed: %s",
                attempt + 1, strategy, str(nav_err)[:120],
            )
            if attempt < 2:
                await page.wait_for_timeout(3000)

    if not nav_ok:
        raise RuntimeError("Propwire: all navigation strategies failed for /login")

    # Wait a beat for any challenge pages to settle
    await page.wait_for_timeout(4000)

    # ── Step 2: Detect & handle bot challenge pages ────────────────────────
    html = await page.content()
    if _looks_like_challenge_page(html):
        log.warning("Propwire: bot challenge page detected — saving screenshot")
        try:
            await page.screenshot(path=f"{_screenshot_dir}/propwire_challenge_detected.png", full_page=True)
        except Exception:
            pass

        # Strategy: wait a bit longer — DataDome sometimes auto-resolves
        # when the browser passes fingerprint checks.
        log.info("Propwire: waiting 15 s for challenge to auto-resolve...")
        await page.wait_for_timeout(15000)

        # Check again
        html = await page.content()
        if _looks_like_challenge_page(html):
            # Try reloading once — fresh request through proxy may help
            log.info("Propwire: challenge still present, attempting reload...")
            await page.goto(LOGIN_URL, wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(8000)
            html = await page.content()

        if _looks_like_challenge_page(html):
            try:
                await page.screenshot(path=f"{_screenshot_dir}/propwire_challenge_still_present.png", full_page=True)
            except Exception:
                pass
            raise RuntimeError(
                "Propwire: DataDome/CAPTCHA challenge is blocking login. "
                "The bot detection could not be bypassed. "
                "Check proxy configuration and stealth settings."
            )

    # ── Step 3: Wait for the actual login form ─────────────────────────────
    # Propwire uses generic <input> elements without type="email" or name="email"
    # in their React form.  Use multiple selector strategies.
    email_selectors = [
        # Strategy A: inputs inside fieldsets near "Email" label text
        'fieldset:has-text("Email") input',
        'label:has-text("Email") + input',
        # Strategy B: first visible text input (email field comes before password)
        'input:not([type="password"]):not([type="checkbox"])',
        # Strategy C: all visible inputs — we filter by position
        'input >> visible=true',
        # Strategy D: React/Next.js generated class patterns
        'input[class*="input" i]',
        'input[class*="field" i]',
        # Strategy E: broad fallback — any input that isn't checkbox/button/hidden
        'input:not([type="checkbox"]):not([type="hidden"]):not([type="button"])',
    ]

    pw_selectors = [
        'input[type="password"]',
        'fieldset:has-text("Password") input',
        'label:has-text("Password") + input',
    ]

    # Wait for the form to render (React SPA may still be loading)
    form_visible = False
    for wait_attempt in range(3):
        try:
            # Check if ANY inputs are visible
            visible_inputs = await page.locator('input >> visible=true').count()
            if visible_inputs >= 2:
                form_visible = True
                log.info("Propwire: found %d visible input(s)", visible_inputs)
                break
        except Exception:
            pass
        log.info("Propwire: waiting for form to render (attempt %d)...", wait_attempt + 1)
        await page.wait_for_timeout(5000)

    if not form_visible:
        # Final check: maybe it's a completely different page
        page_title = await page.title()
        current_url = page.url
        try:
            await page.screenshot(path=f"{_screenshot_dir}/propwire_login_form_missing.png", full_page=True)
        except Exception:
            pass
        raise RuntimeError(
            f"Propwire: login form not found after waiting. "
            f"title={page_title}, url={current_url}, "
            f"challenge_detected={_looks_like_challenge_page(await page.content())}. "
            f"Check screenshot at {_screenshot_dir}/propwire_login_form_missing.png"
        )

    # ── Step 4: Humanize before interacting ────────────────────────────────
    await _humanize_mouse(page)

    # ── Step 5: Fill the form ──────────────────────────────────────────────
    # Try to locate email and password inputs robustly
    email_el = None
    pw_el = None

    # Strategy 1: Try label-based selectors first
    for sel in email_selectors:
        try:
            el = page.locator(sel).first
            if await el.count():
                # Verify it looks like an email field (not password, not checkbox)
                el_type = await el.get_attribute("type") or ""
                if el_type != "password":
                    email_el = el
                    log.debug("Propwire: email field found via selector: %s", sel)
                    break
        except Exception:
            continue

    for sel in pw_selectors:
        try:
            el = page.locator(sel).first
            if await el.count():
                pw_el = el
                log.debug("Propwire: password field found via selector: %s", sel)
                break
        except Exception:
            continue

    # Strategy 2: JavaScript fallback — enumerate all inputs and pick by attributes
    if email_el is None or pw_el is None:
        log.info("Propwire: using JavaScript fallback to locate inputs")
        input_info = await page.evaluate("""
            () => {
                const inputs = Array.from(document.querySelectorAll('input'));
                return inputs.map((inp, idx) => ({
                    index: idx,
                    type: inp.type || '',
                    placeholder: inp.placeholder || '',
                    id: inp.id || '',
                    name: inp.name || '',
                    autocomplete: inp.getAttribute('autocomplete') || '',
                    rect: inp.getBoundingClientRect(),
                }));
            }
        """)
        log.debug("Propwire: found inputs: %s", json.dumps(input_info, default=str))

        visible_inputs = [
            i for i in input_info
            if i["rect"]["width"] > 50 and i["rect"]["height"] > 20
        ]

        # Email = first non-password, non-checkbox visible input
        # Password = input with type="password"
        if email_el is None:
            for inp in visible_inputs:
                if inp["type"] != "password" and inp["type"] != "checkbox":
                    email_el = page.locator("input").nth(inp["index"])
                    log.info("Propwire: email field found via JS fallback at index %d", inp["index"])
                    break

        if pw_el is None:
            for inp in visible_inputs:
                if inp["type"] == "password":
                    pw_el = page.locator("input").nth(inp["index"])
                    log.info("Propwire: password field found via JS fallback at index %d", inp["index"])
                    break

    if email_el is None or pw_el is None:
        raise RuntimeError(
            f"Propwire: could not locate email or password input. "
            f"email_el={'found' if email_el else 'MISSING'}, "
            f"pw_el={'found' if pw_el else 'MISSING'}. "
            f"visible_inputs_count={len(visible_inputs) if 'visible_inputs' in dir() else 'N/A'}"
        )

    # ── Fill email ──
    await email_el.scroll_into_view_if_needed(timeout=10000)
    await email_el.click(click_count=3)
    await page.wait_for_timeout(200)
    # Use press_sequentially to fire React synthetic onChange events
    await email_el.press_sequentially(email, delay=60)
    await page.wait_for_timeout(300)

    # ── Fill password ──
    await pw_el.scroll_into_view_if_needed(timeout=10000)
    await pw_el.click(click_count=3)
    await page.wait_for_timeout(200)
    await pw_el.press_sequentially(password, delay=60)
    await page.wait_for_timeout(500)

    # ── Step 5: Submit ──
    submit_selectors = [
        'button[type="submit"]',
        'button:has-text("Log in")',
        'button:has-text("Sign in")',
        'button:has-text("Login")',
        'input[type="submit"]',
        'button[class*="submit" i]',
        'button[class*="login" i]',
    ]

    btn = None
    for sel in submit_selectors:
        try:
            el = page.locator(sel).first
            if await el.count():
                btn = el
                log.debug("Propwire: submit button found via: %s", sel)
                break
        except Exception:
            continue

    if btn:
        try:
            is_disabled = await btn.is_disabled()
        except Exception:
            is_disabled = False

        if is_disabled:
            log.warning("Propwire: submit button is disabled — submitting via Enter key")
            await pw_el.press("Enter")
        else:
            await btn.click()
    else:
        log.warning("Propwire: no submit button found — submitting via Enter key")
        await pw_el.press("Enter")

    # ── Step 6: Wait for navigation away from /login ───────────────────────
    try:
        await page.wait_for_function(
            "() => !window.location.href.includes('/login')",
            timeout=40000,
        )
    except Exception:
        await page.wait_for_load_state("domcontentloaded", timeout=15000)

    if "/login" in page.url:
        try:
            err_el = page.locator('[role="alert"], .error, .alert, [class*="error" i]').first
            err_text = (await err_el.inner_text(timeout=3000)).strip() if await err_el.count() else ""
        except Exception:
            err_text = ""
        raise RuntimeError(
            f"Propwire login failed (still on /login). "
            f"Page error: {err_text or 'none detected'}. "
            f"URL: {page.url}"
        )

    log.info("Propwire: login OK, now at %s", page.url)


# ─── Test helper ─────────────────────────────────────────────────────────────


async def test_login_credentials(email: str, password: str) -> None:
    """Test login with explicit credentials without caching or mutating env vars."""
    from functools import partial
    login_fn = partial(_do_login, email=email, password=password)
    async with browser_context(SERVICE, login_fn=login_fn) as ctx:
        page = await ctx.new_page()
        await page.close()


# ─── Helpers ─────────────────────────────────────────────────────────────────


async def _resolve_property_url(ctx, query_or_url: str) -> str:
    """If `query_or_url` is a URL return it; otherwise search and return URL."""
    if query_or_url.startswith("http"):
        return query_or_url

    page = await ctx.new_page()
    try:
        # Use "commit" (first bytes received) then wait for the search input
        # to be visible — avoids tunnel timeout on slow proxy handshakes.
        await _nav_with_fallback(page, SEARCH_URL, log, SERVICE)
        if "/login" in page.url:
            await invalidate_session(SERVICE)
            raise RuntimeError("Propwire session expired")

        search = page.locator(
            'input[placeholder*="address" i], input[placeholder*="search" i], input[type="search"]'
        ).first
        await search.wait_for(state="visible", timeout=15000)
        await search.fill(query_or_url)
        await page.wait_for_timeout(1500)

        # Try to click first dropdown suggestion
        sugg = page.locator('[role="option"], li[role="option"], .suggestion-item').first
        if await sugg.count():
            await sugg.click()
        else:
            await search.press("Enter")

        try:
            await page.wait_for_url(re.compile(r"/realestate/"), timeout=30000)
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
            await _nav_with_fallback(page, prop_url, log, SERVICE)
            if "/login" in page.url:
                await invalidate_session(SERVICE)
                raise RuntimeError("Propwire session expired")

            # Pull __NEXT_DATA__ (Propwire is a Next.js app — JSON of the page state)
            next_data = await page.evaluate(
                "() => { const el = document.getElementById('__NEXT_DATA__');" " return el ? el.textContent : null; }"
            )

            data: Dict[str, Any] = {}
            if next_data:
                try:
                    parsed = json.loads(next_data)
                    data = (parsed.get("props") or {}).get("pageProps") or {}
                except Exception:
                    log.warning("Propwire: failed to parse __NEXT_DATA__ JSON on property page")

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
            loc = page.locator(f"text=/{label}/i").first
            if not await loc.count():
                return None
            sib = loc.locator("xpath=following-sibling::*[1]")
            if await sib.count():
                return (await sib.inner_text()).strip()
        except Exception:
            return None
        return None

    for k, label in [
        ("bedrooms", "Bedrooms"),
        ("bathrooms", "Bathrooms"),
        ("sqft", "Building Sqft"),
        ("lotSize", "Lot Size"),
        ("yearBuilt", "Year Built"),
        ("estimatedValue", "Estimated Value"),
        ("lastSoldPrice", "Last Sold Price"),
        ("lastSoldDate", "Last Sold Date"),
    ]:
        v = await _grab(label)
        if v:
            out[k] = v
    return {"property": out}


async def fetch_comps(
    query_or_url: str,
    *,
    max_results: int = 50,
    login_fn=None,
) -> List[Dict[str, Any]]:
    async with browser_context(SERVICE, login_fn=login_fn or _do_login) as ctx:
        base = await _resolve_property_url(ctx, query_or_url)
        comps_url = base.rstrip("/") + "/comparable-sales"
        page = await ctx.new_page()
        try:
            await _nav_with_fallback(page, comps_url, log, SERVICE)
            if "/login" in page.url:
                await invalidate_session(SERVICE)
                raise RuntimeError("Propwire session expired")

            # Try __NEXT_DATA__ first
            next_data = await page.evaluate(
                "() => { const el = document.getElementById('__NEXT_DATA__');" " return el ? el.textContent : null; }"
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
                    log.warning("Propwire: failed to parse __NEXT_DATA__ JSON on comps page")

            # Fallback: scrape table
            if not comps:
                rows = await page.locator("table tbody tr").all()
                for row in rows[:max_results]:
                    cells = await row.locator("td").all_text_contents()
                    if len(cells) < 4:
                        continue
                    comps.append(
                        {
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
                        }
                    )
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
            await _nav_with_fallback(page, url, log, SERVICE)
            if "/login" in page.url:
                await invalidate_session(SERVICE)
                raise RuntimeError("Propwire session expired")

            next_data = await page.evaluate(
                "() => { const el = document.getElementById('__NEXT_DATA__');" " return el ? el.textContent : null; }"
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
                    log.warning("Propwire: failed to parse __NEXT_DATA__ JSON on history page")
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
    async with browser_context(SERVICE, login_fn=_do_login) as ctx:
        base = await _resolve_property_url(ctx, query_or_url)
        # Tax info lives on the Property tab (root URL)
        prop_url = re.sub(r"/(comparable-sales|history|owner|market|comps|buyers)$", "", base) or base
        page = await ctx.new_page()
        try:
            await _nav_with_fallback(page, prop_url, log, SERVICE)
            if "/login" in page.url:
                await invalidate_session(SERVICE)
                raise RuntimeError("Propwire session expired")

            # Try __NEXT_DATA__ first — most data is embedded there
            next_data_raw = await page.evaluate(
                "() => { const el = document.getElementById('__NEXT_DATA__');" " return el ? el.textContent : null; }"
            )
            tax: Dict[str, Any] = {}
            tax_history: List[Dict[str, Any]] = []

            if next_data_raw:
                try:
                    parsed = json.loads(next_data_raw)
                    pp = (parsed.get("props") or {}).get("pageProps") or {}
                    prop = pp.get("property") or pp.get("propertyDetails") or pp
                    tax_info = prop.get("tax") or prop.get("taxInfo") or prop.get("assessment") or {}
                    tax = {
                        "assessed_value": _safe_num(tax_info.get("assessedValue") or tax_info.get("assessed")),
                        "market_value": _safe_num(tax_info.get("marketValue") or tax_info.get("market")),
                        "land_value": _safe_num(tax_info.get("landValue") or tax_info.get("land")),
                        "improvement_value": _safe_num(tax_info.get("improvementValue") or tax_info.get("improvement")),
                        "annual_tax": _safe_num(
                            tax_info.get("annualTax") or tax_info.get("taxes") or tax_info.get("taxAmount")
                        ),
                        "tax_year": tax_info.get("taxYear") or tax_info.get("year"),
                        "parcel_id": prop.get("parcelId") or prop.get("apn") or tax_info.get("parcelId"),
                        "legal_description": prop.get("legalDescription") or tax_info.get("legalDescription"),
                    }
                    tax_history = prop.get("taxHistory") or pp.get("taxHistory") or []
                except Exception:
                    log.warning("Propwire: failed to parse __NEXT_DATA__ JSON on tax page")

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
                    "assessed_value": _safe_num(await _grab_label("Assessed Value")),
                    "market_value": _safe_num(await _grab_label("Market Value")),
                    "land_value": _safe_num(await _grab_label("Land Value")),
                    "improvement_value": _safe_num(await _grab_label("Improvement Value")),
                    "annual_tax": _safe_num(await _grab_label("Annual Tax") or await _grab_label("Taxes")),
                    "tax_year": await _grab_label("Tax Year"),
                    "parcel_id": await _grab_label("Parcel ID") or await _grab_label("APN"),
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
    email: str | None = None,
    password: str | None = None,
) -> List[Dict[str, Any]]:
    """Propwire's nearby cash-buyer / investor list around a property.

    When `email`/`password` are provided they override PROPWIRE_EMAIL /
    PROPWIRE_PASSWORD env vars so Node.js can pass campaign credentials from DB.
    """
    login_fn = partial(_do_login, email=email, password=password) if (email or password) else _do_login
    async with browser_context(SERVICE, login_fn=login_fn) as ctx:
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
                await _nav_with_fallback(page, c, log, SERVICE, timeout_ms=20000)
                if "/login" in page.url:
                    await invalidate_session(SERVICE)
                    raise RuntimeError("Propwire session expired")
                if not (await page.locator("text=/not found/i").count() or await page.locator("text=/404/").count()):
                    chosen_url = c
                    break
            if not chosen_url:
                return []

            await page.wait_for_load_state("networkidle", timeout=20000)

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
                        rows = pp.get("buyers") or pp.get("cashBuyers") or pp.get("nearbyBuyers") or []
                        if isinstance(rows, list):
                            page_buyers = rows
                    except Exception:
                        log.warning("Propwire: failed to parse __NEXT_DATA__ JSON on cash-buyers page")

                if not page_buyers:
                    cards = await page.locator(
                        '[data-testid*="buyer"], .buyer-card, .investor-card, ' 'li:has-text("Average Deal")'
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
                    key = (
                        str(norm.get("name", "")).lower(),
                        str(norm.get("address") or "").lower(),
                    )
                    if not any(
                        (
                            str(x.get("name", "")).lower(),
                            str(x.get("address") or "").lower(),
                        )
                        == key
                        for x in buyers
                    ):
                        buyers.append(norm)

                if progress_cb:
                    pct = min(99, int(100 * len(buyers) / max(max_results, 1)))
                    try:
                        await progress_cb(pct, f"page {seen_pages + 1}: {len(buyers)} buyers")
                    except Exception:
                        pass

                next_btn = page.locator('button:has-text("NEXT"), button:has-text("Next"), a:has-text("Next")').first
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
            await page.close()


def _normalise_buyer(b: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "name": b.get("name") or b.get("buyerName") or b.get("displayName"),
        "llc": b.get("llc") or b.get("entityName") or b.get("company"),
        "props_count": (b.get("props_count") or b.get("propertyCount") or b.get("portfolioSize")),
        "avg_deal": _safe_num(b.get("avg_deal") or b.get("averagePrice") or b.get("avgPurchasePrice")),
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
