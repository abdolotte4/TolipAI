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
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, Optional


def _ensure_nix_ld_path() -> None:
    """Resolve Playwright's required .so files from the Nix store and
    prepend them to LD_LIBRARY_PATH.  This is a no-op on Railway/Ubuntu
    where the system linker already finds the libs."""
    NIX = "/nix/store"
    if not os.path.isdir(NIX):
        return
    needed = {
        "libX11.so.6":        r"libX11-1\.[0-9]",
        "libXcomposite.so.1": r"libXcomposite-",
        "libXdamage.so.1":    r"libx?Xdamage-",
        "libXext.so.6":       r"libXext-",
        "libXfixes.so.3":     r"libXfixes-",
        "libXrandr.so.2":     r"libXrandr-|libxrandr-",
        "libxcb.so.1":        r"libxcb-1\.",
        "libgbm.so.1":        r"mesa-libgbm-|mesa-[0-9]",
        "libexpat.so.1":      r"expat-2\.",
        "libudev.so.1":       r"eudev-|libudev-zero-",
        "libxkbcommon.so.0":  r"libxkbcommon-[0-9]",
        "libXau.so.6":        r"libXau-",
        "libxshmfence.so.1":  r"libxshmfence-",
    }
    dirs: set[str] = set()
    try:
        entries = os.listdir(NIX)
    except OSError:
        return
    for soname, pattern in needed.items():
        for entry in entries:
            if (re.search(pattern, entry)
                    and not entry.endswith(".drv")
                    and not any(s in entry for s in (
                        "-dev", "-man", "-doc", "-debug",
                        "-spirv", "-opencl", "-osmesa", "-opengl", "-driversdev"))):
                lib_dir = f"{NIX}/{entry}/lib"
                if os.path.isdir(lib_dir) and os.path.exists(f"{lib_dir}/{soname}"):
                    dirs.add(lib_dir)
                    break
    if dirs:
        existing = os.environ.get("LD_LIBRARY_PATH", "")
        existing_set = set(existing.split(":")) if existing else set()
        new_dirs = dirs - existing_set
        if new_dirs:
            combined = ":".join(sorted(new_dirs))
            os.environ["LD_LIBRARY_PATH"] = (
                f"{combined}:{existing}" if existing else combined
            )


# Run once at import time — safe to call multiple times (set arithmetic prevents dups)
_ensure_nix_ld_path()

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
                        user_agent=(
                            user_agent or
                            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
                        ),
                        viewport={"width": 1440, "height": 900},
                        locale="en-US",
                        ignore_https_errors=True,
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
