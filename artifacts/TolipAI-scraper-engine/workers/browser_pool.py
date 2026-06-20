"""Browser pool — reuse warm Playwright browsers across scrape jobs.

Problem
───────
  Every fresh AsyncWebCrawler / browser.launch() call:
    • Takes 3-5 seconds cold-start (Chromium spawn + sandbox init)
    • Consumes ~150-200 MB RAM while alive
    • Adds TCP/IPC overhead on each new context

Solution
────────
  Keep a pool of at most MAX_BROWSERS warm Playwright Chromium instances.
  Callers acquire a browser (or a pre-warmed page), use it, then release it
  back to the pool.  A background task closes browsers that have been idle
  longer than IDLE_TIMEOUT seconds to free RAM between job bursts.

  Concurrency is still capped by _browser_sem() in http_client.py; this pool
  sits above that layer and provides warm instances to it.

Usage
─────
    from .browser_pool import browser_pool

    # Acquire a Browser object:
    async with browser_pool.acquire() as browser:
        page = await browser.new_page()
        await page.goto(url)
        html  = await page.content()
        await page.close()

    # Acquire a Page already navigated to a URL (fastest path):
    async with browser_pool.acquire_page(url) as page:
        html = await page.content()

    # Start/stop lifecycle (called by FastAPI lifespan):
    browser_pool.start()
    await browser_pool.stop()
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Dict, List, Optional

log = logging.getLogger("browser_pool")

MAX_BROWSERS     = int(os.getenv("BROWSER_POOL_SIZE",      "3"))
IDLE_TIMEOUT     = int(os.getenv("BROWSER_IDLE_TIMEOUT",   "300"))   # seconds
ACQUIRE_TIMEOUT  = int(os.getenv("BROWSER_ACQUIRE_TIMEOUT","60"))    # seconds
CLEANUP_INTERVAL = int(os.getenv("BROWSER_CLEANUP_INTERVAL","30"))   # seconds

# Chromium flags — memory-efficient + stealth
_LAUNCH_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-zygote",
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--window-size=1920,1080",
    "--disable-extensions",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--js-flags=--max-old-space-size=256",
    "--disable-features=TranslateUI",
]


class _PooledBrowser:
    """Thin wrapper around a Playwright Browser with busy/idle metadata."""

    def __init__(self, browser: Any, pw_instance: Any) -> None:
        self.browser = browser
        self._pw = pw_instance
        self.busy: bool = False
        self.last_used: float = time.monotonic()
        self._id = id(self)

    async def close(self) -> None:
        try:
            await self.browser.close()
        except Exception as exc:
            log.debug("Browser.close error: %s", exc)
        try:
            await self._pw.stop()
        except Exception as exc:
            log.debug("Playwright.stop error: %s", exc)


class BrowserPool:
    """Pool of warm Playwright Chromium browsers with idle eviction."""

    def __init__(self) -> None:
        self._pool: List[_PooledBrowser] = []
        self._lock = asyncio.Lock()
        self._cleanup_task: Optional[asyncio.Task] = None
        self._started = False

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self) -> None:
        """Spawn the idle-eviction background task. Call once at app startup."""
        if self._started:
            return
        self._started = True
        self._cleanup_task = asyncio.create_task(
            self._cleanup_loop(), name="browser-pool-cleanup"
        )
        log.info(
            "BrowserPool started (max=%d, idle_timeout=%ds)",
            MAX_BROWSERS, IDLE_TIMEOUT,
        )

    async def stop(self) -> None:
        """Close all pooled browsers and cancel the cleanup task."""
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
        async with self._lock:
            for pb in list(self._pool):
                await pb.close()
            self._pool.clear()
        log.info("BrowserPool stopped — all browsers closed")

    # ── Browser launch ────────────────────────────────────────────────────────

    async def _launch_browser(self) -> _PooledBrowser:
        """Launch a fresh Playwright Chromium instance."""
        try:
            from playwright.async_api import async_playwright
        except ImportError as exc:
            raise RuntimeError(f"Playwright not installed: {exc}") from exc

        # Resolve Chromium path (handles both Nix and standard installs)
        try:
            from .scrapers._browser_session import (
                _ensure_nix_ld_path,
                _find_chromium_executable,
            )
            _ensure_nix_ld_path()
            exec_path: Optional[str] = _find_chromium_executable()
        except Exception as exc:
            log.debug("Chromium exec lookup error: %s", exc)
            exec_path = None

        pw = await async_playwright().start()
        launch_kwargs: Dict[str, Any] = dict(headless=True, args=_LAUNCH_ARGS)
        if exec_path:
            launch_kwargs["executable_path"] = exec_path

        browser = await pw.chromium.launch(**launch_kwargs)
        pb = _PooledBrowser(browser, pw)
        log.info(
            "BrowserPool: launched new browser %x (pool size will be %d)",
            pb._id, len(self._pool) + 1,
        )
        return pb

    # ── Acquire / release ─────────────────────────────────────────────────────

    async def _acquire_browser(self) -> _PooledBrowser:
        """Return an idle browser or launch a new one (blocks if pool is full)."""
        deadline = time.monotonic() + ACQUIRE_TIMEOUT
        while True:
            async with self._lock:
                # Prefer an existing idle browser (fastest path)
                for pb in self._pool:
                    if not pb.busy:
                        pb.busy = True
                        pb.last_used = time.monotonic()
                        log.debug("BrowserPool: reusing idle browser %x", pb._id)
                        return pb

                # Launch a new browser if under the cap
                if len(self._pool) < MAX_BROWSERS:
                    pb = await self._launch_browser()
                    pb.busy = True
                    self._pool.append(pb)
                    return pb

            # Pool saturated — wait and retry
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(
                    f"BrowserPool: no browser available after {ACQUIRE_TIMEOUT}s"
                )
            log.debug("BrowserPool: all %d browsers busy — waiting…", MAX_BROWSERS)
            await asyncio.sleep(min(1.0, remaining))

    def _release_browser(self, pb: _PooledBrowser) -> None:
        """Return a browser to the idle pool."""
        pb.busy = False
        pb.last_used = time.monotonic()
        log.debug("BrowserPool: released browser %x", pb._id)

    # ── Public context managers ───────────────────────────────────────────────

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[Any]:
        """Yield a Playwright Browser object from the pool.

        The browser is automatically returned to the pool on exit.

        Example::

            async with browser_pool.acquire() as browser:
                page = await browser.new_page()
                await page.goto(url)
                html = await page.content()
                await page.close()
        """
        pb = await self._acquire_browser()
        try:
            yield pb.browser
        finally:
            self._release_browser(pb)

    @asynccontextmanager
    async def acquire_page(self, url: Optional[str] = None) -> AsyncIterator[Any]:
        """Yield a Playwright Page (optionally pre-navigated to url).

        Reusing a warm browser + new page is faster than a cold browser
        because the Chromium renderer process is already running.

        Example::

            async with browser_pool.acquire_page("https://propelio.com/...") as page:
                html = await page.content()
        """
        async with self.acquire() as browser:
            page = await browser.new_page()
            try:
                if url:
                    await page.goto(
                        url, wait_until="domcontentloaded", timeout=30_000
                    )
                yield page
            finally:
                try:
                    await page.close()
                except Exception as exc:
                    log.debug("Page.close error: %s", exc)

    # ── Idle eviction ─────────────────────────────────────────────────────────

    async def _cleanup_loop(self) -> None:
        """Periodically evict browsers idle longer than IDLE_TIMEOUT."""
        while True:
            try:
                await asyncio.sleep(CLEANUP_INTERVAL)
                await self._evict_idle()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                log.error("BrowserPool cleanup error: %s", exc)

    async def _evict_idle(self) -> None:
        now = time.monotonic()
        to_close: List[_PooledBrowser] = []
        async with self._lock:
            survivors: List[_PooledBrowser] = []
            for pb in self._pool:
                idle_secs = now - pb.last_used
                if not pb.busy and idle_secs > IDLE_TIMEOUT:
                    log.info(
                        "BrowserPool: evicting browser %x (idle %.0fs > %ds)",
                        pb._id, idle_secs, IDLE_TIMEOUT,
                    )
                    to_close.append(pb)
                else:
                    survivors.append(pb)
            self._pool = survivors
        for pb in to_close:
            await pb.close()

    # ── Stats ─────────────────────────────────────────────────────────────────

    def stats(self) -> Dict[str, Any]:
        now = time.monotonic()
        return {
            "total":             len(self._pool),
            "busy":              sum(1 for pb in self._pool if pb.busy),
            "idle":              sum(1 for pb in self._pool if not pb.busy),
            "max":               MAX_BROWSERS,
            "idle_timeout_secs": IDLE_TIMEOUT,
            "browsers": [
                {
                    "id":        hex(pb._id),
                    "busy":      pb.busy,
                    "idle_secs": 0 if pb.busy else int(now - pb.last_used),
                }
                for pb in self._pool
            ],
        }


# ── Module singleton ───────────────────────────────────────────────────────────
browser_pool = BrowserPool()
