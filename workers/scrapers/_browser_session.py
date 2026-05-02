"""Shared Playwright session helper with persistent storage_state per service.

Used by Propelio and Propwire scrapers to keep authenticated cookies between
requests so we don't re-login on every scrape (and don't trip rate limits).

Storage state JSON files live under /tmp/<service>_state.json. They survive
the lifetime of the container — on Railway you get a fresh disk per deploy,
which is fine: we just re-login on cold start.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, Optional

log = logging.getLogger("browser")


def _proxy_settings() -> Optional[Dict[str, str]]:
    """Return a Playwright proxy dict if BrightData / residential proxy is configured."""
    host = os.getenv("PROXY_HOST")
    user = os.getenv("PROXY_USER")
    pw   = os.getenv("PROXY_PASS")
    if host and user and pw:
        return {"server": f"http://{host}", "username": user, "password": pw}
    oxu = os.getenv("OXYLABS_USERNAME")
    oxp = os.getenv("OXYLABS_PASSWORD")
    if oxu and oxp:
        return {"server": "http://unblock.oxylabs.io:60000", "username": oxu, "password": oxp}
    return None

_STATE_DIR = Path(os.getenv("BROWSER_STATE_DIR", "/tmp")).resolve()
_STATE_DIR.mkdir(parents=True, exist_ok=True)

# One lock per service so two concurrent jobs can't both try to login.
_login_locks: Dict[str, asyncio.Lock] = {}


def _state_path(service: str) -> Path:
    return _STATE_DIR / f"{service}_state.json"


def _state_lock(service: str) -> asyncio.Lock:
    if service not in _login_locks:
        _login_locks[service] = asyncio.Lock()
    return _login_locks[service]


@asynccontextmanager
async def browser_context(
    service: str,
    *,
    login_fn: Optional[Callable[[Any], Awaitable[None]]] = None,
    headless: bool = True,
    user_agent: Optional[str] = None,
) -> AsyncIterator[Any]:
    """Yield an authenticated Playwright context for `service`.

    If a saved storage_state exists we reuse it. Otherwise (or if it's expired)
    we call `login_fn(page)` to populate cookies, then save state for next time.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError as e:
        raise RuntimeError(
            "playwright not installed — run `playwright install chromium`"
        ) from e

    state_file = _state_path(service)
    storage_state: Optional[str] = str(state_file) if state_file.exists() else None

    pw = await async_playwright().start()
    # Container-hardened flags — Railway/Docker environments need these to
    # prevent "Target page, context or browser has been closed" crashes.
    # --single-process keeps everything in one process (avoids /dev/shm issues).
    # --disable-dev-shm-usage reroutes shared memory to /tmp.
    proxy_cfg = _proxy_settings()
    browser = await pw.chromium.launch(
        headless=headless,
        proxy=proxy_cfg,
        args=[
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-software-rasterizer",
            "--disable-extensions",
            "--disable-background-networking",
            "--no-first-run",
            "--no-zygote",
            "--single-process",
            "--disable-blink-features=AutomationControlled",
        ],
    )
    if proxy_cfg:
        log.info("[%s] using residential proxy %s", service, proxy_cfg["server"])
    try:
        ctx = await browser.new_context(
            storage_state=storage_state,
            user_agent=user_agent or (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1440, "height": 900},
            locale="en-US",
            ignore_https_errors=True,
        )
        # First-time login (or session expired) flow
        if not storage_state and login_fn is not None:
            async with _state_lock(service):
                # Re-check after acquiring lock — another task may have logged in.
                if not state_file.exists():
                    log.info("[%s] no saved session — performing login", service)
                    page = await ctx.new_page()
                    try:
                        await login_fn(page)
                        await ctx.storage_state(path=str(state_file))
                        log.info("[%s] saved storage_state to %s", service, state_file)
                    finally:
                        await page.close()
                else:
                    # Recreate context with the now-saved state
                    await ctx.close()
                    ctx = await browser.new_context(
                        storage_state=str(state_file),
                        viewport={"width": 1440, "height": 900},
                        locale="en-US",
                    )
        yield ctx
    finally:
        try:
            await ctx.close()
        except Exception:  # noqa: BLE001
            pass
        await browser.close()
        await pw.stop()


async def invalidate_session(service: str) -> None:
    """Delete the cached session — next call will re-login."""
    p = _state_path(service)
    if p.exists():
        try:
            p.unlink()
            log.info("[%s] session invalidated", service)
        except Exception as e:  # noqa: BLE001
            log.warning("[%s] failed to invalidate session: %s", service, e)


def dump_cookies(state: Dict[str, Any]) -> str:
    """Helpful for debugging — return cookie names from a storage_state dict."""
    cookies = state.get("cookies", [])
    return ", ".join(sorted({c.get("name", "?") for c in cookies}))
