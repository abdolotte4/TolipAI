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
import logging
import os
import random
import re
from functools import partial
from typing import Any, Dict, List

from ._browser_session import (
    _humanize_mouse,
    _humanize_scroll,
    _humanize_type,
    _nav_with_fallback,
    browser_context,
    invalidate_session,
)
from ._utils import _parse_buyer_card, _safe_num

log = logging.getLogger("propelio")

PROPELIO_BASE = "https://genesis.propelio.com"
LOGIN_URL = f"{PROPELIO_BASE}/login"
SEARCH_URL = f"{PROPELIO_BASE}/search"

SERVICE = "propelio"


# ─── Login ───────────────────────────────────────────────────────────────────


async def _do_login(page, email: str | None = None, password: str | None = None) -> None:
    """Authenticate with Propelio via the /login page.

    Robust login flow with:
    - Multiple navigation strategies (commit → domcontentloaded → networkidle)
    - Screenshot capture at every step for remote debugging
    - Console error capture to diagnose JS issues
    - Retry loop for transient failures
    - Proxy-aware timeouts (longer waits for slow proxy routes)
    - Detection of bot-block pages, CAPTCHAs, and session redirects
    """
    email = email or os.getenv("PROPELIO_EMAIL")
    password = password or os.getenv("PROPELIO_PASSWORD")
    if not (email and password):
        raise RuntimeError("PROPELIO_EMAIL / PROPELIO_PASSWORD not set")

    # ── Debug screenshot paths ──
    _ss_dir = "/tmp"
    _ss_nav = f"{_ss_dir}/propelio_login_01_nav.png"
    _ss_form = f"{_ss_dir}/propelio_login_02_form.png"
    _ss_filled = f"{_ss_dir}/propelio_login_03_filled.png"
    _ss_submit = f"{_ss_dir}/propelio_login_04_submit.png"
    _ss_final = f"{_ss_dir}/propelio_login_05_final.png"

    email_sel = (
        'input[type="email"], input[name="email"], input[name="username"], '
        'input[autocomplete="email"], input[id*="email" i], input[placeholder*="email" i]'
    )
    pw_sel = (
        'input[type="password"], input[name="password"], '
        'input[autocomplete="current-password"], input[autocomplete="password"]'
    )

    # Capture JS console errors to help diagnose rendering/login issues
    _console_errors: list[str] = []

    def _on_console(msg):
        if msg.type in ("error", "warning"):
            _console_errors.append(f"[{msg.type}] {msg.text[:200]}")

    page.on("console", _on_console)

    # Capture network responses during login to detect auth API failures
    _login_api_responses: list[str] = []

    def _on_response(resp):
        url = resp.url
        # Capture auth-related API responses
        if any(kw in url.lower() for kw in ("auth", "login", "signin", "session", "token", "api")):
            status = resp.status
            if status >= 400:
                _login_api_responses.append(f"API {status}: {url[:120]}")

    page.on("response", _on_response)

    # ═══════════════════════════════════════════════════════════════════════════
    # Phase 1: Navigate to login page
    # ═══════════════════════════════════════════════════════════════════════════
    log.info(
        "Propelio: navigating to login page (email=%s)", email[:3] + "***@***" + email.split("@")[-1][3:]
    )

    # Check if we're already logged in (session redirect)
    current_url = page.url
    if "/search" in current_url or "/lists" in current_url:
        log.info("Propelio: already on authenticated page (%s), skipping login", current_url)
        page.remove_listener("console", _on_console)
        try:
            page.remove_listener("response", _on_response)
        except Exception:
            pass
        return

    nav_ok = False
    for strategy, timeout in [("commit", 30000), ("domcontentloaded", 30000), ("load", 25000)]:
        try:
            await page.goto(LOGIN_URL, wait_until=strategy, timeout=timeout)  # type: ignore[arg-type]
            nav_ok = True
            log.info("Propelio: navigation OK with strategy=%s, url=%s", strategy, page.url)
            break
        except Exception as nav_err:
            log.warning("Propelio: navigation failed (strategy=%s): %s", strategy, str(nav_err)[:120])
            await page.wait_for_timeout(1500)

    if not nav_ok:
        try:
            await page.screenshot(path=_ss_nav)
        except Exception:
            pass
        page.remove_listener("console", _on_console)
        try:
            page.remove_listener("response", _on_response)
        except Exception:
            pass
        raise RuntimeError(
            f"Propelio: all navigation strategies failed for {LOGIN_URL}. "
            f"Console errors: {_console_errors[:5] or 'none'}"
        )

    # Check for bot-block / challenge pages immediately after navigation
    title = (await page.title()).lower()
    body_text = ""
    try:
        body_text = (await page.locator("body").inner_text(timeout=5000)).lower()[:300]
    except Exception:
        pass

    bot_keywords = ("just a moment", "cloudflare", "access denied", "blocked", "captcha", "challenge")
    if any(kw in title for kw in bot_keywords) or any(kw in body_text for kw in bot_keywords):
        log.warning("Propelio: bot-block page detected (title=%r) — attempting bypass", title)
        await page.screenshot(path=_ss_nav)

        # Cloudflare JS challenges often auto-resolve within 5–10 s.
        # Also try the captcha solver (session rotation + paid fallback).
        try:
            from ...captcha_solver import FreeCaptchaSolver as _Solver
        except ImportError:
            from workers.captcha_solver import FreeCaptchaSolver as _Solver

        solver = _Solver()
        # Cloudflare Turnstile / hCaptcha check first
        if "captcha" in body_text or "hcaptcha" in body_text:
            await solver.solve_hcaptcha(page, "", LOGIN_URL)
        elif "turnstile" in body_text or "cloudflare" in title:
            await solver.solve_turnstile(page, "", LOGIN_URL)
        else:
            # Generic: session rotation + wait
            await solver._rotate_session(page)
            await page.wait_for_timeout(8000)

        # Re-check after solver attempt
        title = (await page.title()).lower()
        body_text = ""
        try:
            body_text = (await page.locator("body").inner_text(timeout=5000)).lower()[:300]
        except Exception:
            pass

        if any(kw in title for kw in bot_keywords) or any(kw in body_text for kw in bot_keywords):
            page.remove_listener("console", _on_console)
            try:
                page.remove_listener("response", _on_response)
            except Exception:
                pass
            raise RuntimeError(
                f"Propelio: bot-block page could not be bypassed "
                f"(title={title!r}, body={body_text[:100]!r}). "
                f"Screenshot: {_ss_nav}. "
                f"Set CAPTCHA_API_KEY (2Captcha) for paid bypass."
            )
        log.info("Propelio: bot-block page resolved — continuing login")

    # If we were redirected away from /login (already authenticated), we're done
    if "/login" not in page.url:
        log.info("Propelio: redirected to %s (already authenticated)", page.url)
        page.remove_listener("console", _on_console)
        try:
            page.remove_listener("response", _on_response)
        except Exception:
            pass
        return

    # ═══════════════════════════════════════════════════════════════════════════
    # Phase 2: Wait for login form to render (React SPA)
    # ═══════════════════════════════════════════════════════════════════════════
    for wait_attempt in range(3):
        try:
            await page.wait_for_selector(email_sel, timeout=30000)
            log.info("Propelio: login form rendered (attempt %d)", wait_attempt + 1)
            break
        except Exception:
            # React may still be mounting — check how many inputs exist
            input_count = await page.locator("input").count()
            log.warning(
                "Propelio: email input not found (attempt %d, %d total inputs on page). Console errors: %s",
                wait_attempt + 1,
                input_count,
                _console_errors[-3:] or "none",
            )
            if wait_attempt == 0:
                # Screenshot for debugging + retry navigation
                try:
                    await page.screenshot(path=_ss_form)
                    log.warning("Propelio: screenshot saved to %s", _ss_form)
                except Exception:
                    pass
                # Force a reload — sometimes the React bundle stalls on proxy
                try:
                    await page.reload(wait_until="domcontentloaded", timeout=20000)
                except Exception:
                    pass
            elif wait_attempt == 1:
                # Hard refresh with cache clear
                try:
                    await page.reload(wait_until="domcontentloaded", timeout=20000)
                    await page.wait_for_timeout(3000)
                except Exception:
                    pass
            else:
                # Last attempt — take final screenshot and fail
                try:
                    await page.screenshot(path=_ss_form)
                except Exception:
                    pass
                page.remove_listener("console", _on_console)
                try:
                    page.remove_listener("response", _on_response)
                except Exception:
                    pass
                raise RuntimeError(
                    f"Propelio: login form never rendered after 3 attempts. "
                    f"URL={page.url}, title={title!r}, inputs={input_count}, "
                    f"screenshot={_ss_form}, console_errors={_console_errors[-5:] or 'none'}"
                )

    # ═══════════════════════════════════════════════════════════════════════════
    # Phase 3: Fill the form (trigger React onChange events)
    # ═══════════════════════════════════════════════════════════════════════════
    log.info("Propelio: filling login form")

    await _humanize_scroll(page)
    await _humanize_mouse(page)

    email_el = page.locator(email_sel).first
    await email_el.click(click_count=3)
    await page.wait_for_timeout(200)
    await _humanize_type(page, email_sel, email)
    await page.wait_for_timeout(300)

    pw_el = page.locator(pw_sel).first
    await pw_el.click(click_count=3)
    await page.wait_for_timeout(200)
    await _humanize_type(page, pw_sel, password)
    await page.wait_for_timeout(500)

    # Verify values were actually entered
    entered_email = await email_el.input_value()
    entered_pw = await pw_el.input_value()
    if not entered_email or not entered_pw:
        try:
            await page.screenshot(path=_ss_filled)
        except Exception:
            pass
        page.remove_listener("console", _on_console)
        try:
            page.remove_listener("response", _on_response)
        except Exception:
            pass
        raise RuntimeError(
            f"Propelio: form values not set (email_empty={not entered_email}, pw_empty={not entered_pw}). "
            f"Screenshot: {_ss_filled}"
        )

    log.info("Propelio: form filled, email=%s...", entered_email[:5])

    # ═══════════════════════════════════════════════════════════════════════════
    # Phase 4: Submit the form
    # ═══════════════════════════════════════════════════════════════════════════
    btn = page.locator(
        'button[type="submit"], button:has-text("SIGN IN"), button:has-text("Sign In"), '
        'button:has-text("Sign in"), button:has-text("LOG IN"), button:has-text("Log In"), '
        'button:has-text("Log in"), button:has-text("Login"), input[type="submit"]'
    ).first
    btn_count = await btn.count()

    if btn_count:
        is_disabled = await btn.is_disabled()
        if is_disabled:
            log.warning("Propelio: submit button disabled — using Enter key")
            # Screenshot to debug why button is disabled
            try:
                await page.screenshot(path=_ss_filled)
            except Exception:
                pass
            await pw_el.press("Enter")
        else:
            await page.wait_for_timeout(random.randint(400, 900))
            await btn.click()
            log.info("Propelio: clicked submit button")
    else:
        log.warning("Propelio: no submit button found — using Enter key")
        await page.wait_for_timeout(random.randint(400, 900))
        await pw_el.press("Enter")

    await page.wait_for_timeout(1000)  # brief pause for submission to start

    # ═══════════════════════════════════════════════════════════════════════════
    # Phase 5: Wait for navigation / auth response
    # ═══════════════════════════════════════════════════════════════════════════
    for nav_strategy, nav_timeout in [
        ("function", 45000),  # wait_for_function
        ("networkidle", 25000),  # networkidle fallback
    ]:
        try:
            if nav_strategy == "function":
                await page.wait_for_function(
                    "() => !window.location.href.includes('/login')",
                    timeout=nav_timeout,
                )
            else:
                await page.wait_for_load_state("networkidle", timeout=nav_timeout)
            log.info("Propelio: navigation detected (strategy=%s)", nav_strategy)
            break
        except Exception as e:
            log.warning("Propelio: nav wait failed (strategy=%s): %s", nav_strategy, str(e)[:100])

    # ═══════════════════════════════════════════════════════════════════════════
    # Phase 6: Verify login result
    # ═══════════════════════════════════════════════════════════════════════════
    final_url = page.url
    log.info("Propelio: post-submit URL: %s", final_url)

    # If navigated away from login page → success
    if "/login" not in final_url:
        page.remove_listener("console", _on_console)
        try:
            page.remove_listener("response", _on_response)
        except Exception:
            pass
        log.info("Propelio: login OK, now at %s", final_url)
        return

    # ── Still on /login → diagnose why ──
    try:
        await page.screenshot(path=_ss_final)
    except Exception:
        pass

    # Try to extract any visible error message
    err_text = ""
    try:
        err_el = page.locator('[role="alert"], .error, .alert, [class*="error" i], .chakra-alert').first
        if await err_el.count():
            err_text = (await err_el.inner_text(timeout=3000)).strip()
    except Exception:
        pass

    # Check the page body for common error patterns
    body_text = ""
    try:
        body_text = (await page.locator("body").inner_text(timeout=3000)).strip()[:500]
    except Exception:
        pass

    # Check for specific error patterns
    error_patterns = {
        "invalid": "Invalid email or password",
        "incorrect": "Invalid email or password",
        "unauthorized": "Authentication failed",
        "verify": "Please verify your email",
        "suspended": "Account suspended",
        "locked": "Account locked",
        "mfa": "Two-factor authentication required",
        "2fa": "Two-factor authentication required",
        "captcha": "CAPTCHA verification required",
    }
    detected_error = err_text
    if not detected_error:
        body_lower = body_text.lower()
        for pattern, meaning in error_patterns.items():
            if pattern in body_lower:
                detected_error = meaning
                break

    page.remove_listener("console", _on_console)

    # Clean up network listener
    try:
        page.remove_listener("response", _on_response)
    except Exception:
        pass

    raise RuntimeError(
        f"Propelio login failed (still on /login). "
        f"Detected error: {detected_error or 'none detected'}. "
        f"Final URL: {final_url}. "
        f"Screenshot: {_ss_final}. "
        f"Console errors: {_console_errors[-5:] or 'none'}. "
        f"API failures: {_login_api_responses[-5:] or 'none'}. "
        f"Body snippet: {body_text[:200]!r}"
    )


# ─── Test helper ─────────────────────────────────────────────────────────────


async def test_login_credentials(email: str, password: str) -> Dict[str, Any]:
    """Test login with explicit credentials without caching or mutating env vars.

    Returns a dict with {ok: bool, url: str, error: str, screenshots: list}
    so the caller can diagnose issues remotely.
    """
    import time
    from functools import partial

    result: Dict[str, Any] = {
        "ok": False,
        "url": "",
        "error": "",
        "screenshots": [],
        "timestamp": time.time(),
    }
    login_fn = partial(_do_login, email=email, password=password)

    try:
        async with browser_context(SERVICE, login_fn=login_fn, no_proxy=True) as ctx:
            page = await ctx.new_page()
            try:
                # Navigate to the search page to verify the session is valid
                await page.goto(f"{PROPELIO_BASE}/search", wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(3000)
                result["url"] = page.url

                if "/login" in page.url:
                    result["error"] = "Session invalid — redirected to login"
                    # Capture diagnostic screenshot
                    ss_path = f"/tmp/propelio_test_login_{int(time.time())}.png"
                    try:
                        await page.screenshot(path=ss_path)
                        result["screenshots"].append(ss_path)
                    except Exception:
                        pass
                else:
                    result["ok"] = True
                    result["error"] = ""
            finally:
                await page.close()
    except Exception as e:
        result["error"] = str(e)
        log.error("Propelio test_login_credentials failed: %s", str(e)[:200])

    return result


# ─── Helpers ─────────────────────────────────────────────────────────────────


async def _intercept_json(page, url_pattern: re.Pattern, timeout_ms: int = 25000) -> List[Dict[str, Any]]:
    """Wait for an XHR response matching url_pattern and return its parsed JSON."""
    captured: List[Dict[str, Any]] = []

    async def on_response(resp):
        try:
            if url_pattern.search(resp.url) and "application/json" in (
                resp.headers.get("content-type") or ""
            ):
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


async def search_property(address: str, *, login_fn=None) -> Dict[str, Any]:
    """Search Propelio for an address and return basic property metadata.

    Returns: {address, property_id, url, raw} where property_id is the
    numeric ID Propelio uses in URLs like /search/<id>/cash-buyers.
    """
    if not address:
        return {"address": "", "property_id": None}

    async with browser_context(SERVICE, login_fn=login_fn or _do_login, no_proxy=True) as ctx:
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
            await search_input.wait_for(state="visible", timeout=30000)
            await search_input.fill(address)
            await page.wait_for_timeout(800)
            await search_input.press("Enter")

            # Wait for a navigation to /search/<id>/...
            try:
                await page.wait_for_url(re.compile(r"/search/\d+"), timeout=25000)
            except Exception:
                # Sometimes Propelio shows a dropdown — click the first suggestion.
                first = page.locator('[role="option"], li[role="option"], .search-result').first
                if await first.count():
                    await first.click()
                    await page.wait_for_url(re.compile(r"/search/\d+"), timeout=20000)

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
    login_fn=None,
) -> List[Dict[str, Any]]:
    """Pull comparable-sales rows for a property already opened in Propelio."""
    if not property_id:
        return []
    url = f"{PROPELIO_BASE}/search/{property_id}/comparable-sales"

    async with browser_context(SERVICE, login_fn=login_fn or _do_login, no_proxy=True) as ctx:
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
                            "sold_price": _safe_num(cells[3]) if len(cells) > 3 else None,
                            "price_per_sqft": _safe_num(cells[4]) if len(cells) > 4 else None,
                            "beds": _safe_num(cells[5]) if len(cells) > 5 else None,
                            "baths": _safe_num(cells[6]) if len(cells) > 6 else None,
                            "sqft": _safe_num(cells[7]) if len(cells) > 7 else None,
                        }
                    )

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
    active_within: str = "ANY_TIME",  # ANY_TIME | LAST_6M | LAST_1Y | LAST_2Y
    min_properties: int = 3,
    landlords: bool = True,
    flippers: bool = True,
    max_results: int = 500,
    progress_cb=None,
    login_fn=None,
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

    async with browser_context(SERVICE, login_fn=login_fn or _do_login, no_proxy=True) as ctx:
        page = await ctx.new_page()
        # ── Register XHR capture BEFORE navigation so first-page results aren't missed ──
        pending_xhr: List[Dict[str, Any]] = []

        async def _capture_response(resp):
            try:
                if api_pat.search(resp.url) and "application/json" in (
                    resp.headers.get("content-type") or ""
                ):
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
                pill = page.locator("text=/DISTANCE/i").first
                if await pill.count():
                    await pill.click()
                    opt = page.locator(f"text=/{distance_miles}\\s*MILES?/i").first
                    if await opt.count():
                        await opt.click()
            except Exception:
                pass

            # Active within pill
            try:
                pill = page.locator("text=/ACTIVE WITHIN/i").first
                if await pill.count():
                    await pill.click()
                    label_map = {
                        "ANY_TIME": "ANY TIME",
                        "LAST_6M": "LAST 6 MONTHS",
                        "LAST_1Y": "LAST 1 YEAR",
                        "LAST_2Y": "LAST 2 YEARS",
                    }
                    target = label_map.get(active_within.upper(), "ANY TIME")
                    opt = page.locator(f"text=/{target}/i").first
                    if await opt.count():
                        await opt.click()
            except Exception:
                pass

            # Min properties
            try:
                pill = page.locator("text=/MINIMUM PROP/i").first
                if await pill.count():
                    await pill.click()
                    opt = page.locator(f"text=/^\\s*{min_properties}\\s*OR MORE\\s*$/i").first
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

            await page.wait_for_load_state("networkidle", timeout=30000)

            def _drain_xhr() -> List[Dict[str, Any]]:
                """Consume all accumulated XHR responses and return normalised buyer rows."""
                rows: List[Dict[str, Any]] = []
                while pending_xhr:
                    item = pending_xhr.pop(0)
                    body = item.get("body") or {}
                    raw = (
                        body.get("data")
                        or body.get("buyers")
                        or body.get("results")
                        or body.get("items")
                        or []
                    )
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
                    key = (
                        norm.get("name", "").lower(),
                        (norm.get("address") or "").lower(),
                    )
                    if not any(
                        (x.get("name", "").lower(), (x.get("address") or "").lower()) == key for x in buyers
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
        return {
            "address": address,
            "property_id": None,
            "comps": [],
            "arv_estimate": None,
        }
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
    email: str | None = None,
    password: str | None = None,
) -> Dict[str, Any]:
    """One-shot: find a property by address then scrape its cash-buyer list.

    When `email`/`password` are provided they override the PROPELIO_EMAIL /
    PROPELIO_PASSWORD env vars so the Node.js API can pass campaign-specific
    credentials from the encrypted DB record instead of relying on container env.
    """
    login_fn = partial(_do_login, email=email, password=password) if (email or password) else _do_login
    prop = await search_property(address, login_fn=login_fn)
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
        login_fn=login_fn,
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
