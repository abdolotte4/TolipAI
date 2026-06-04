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

import glob as _glob

from playwright.async_api import ProxySettings


def _ensure_nix_ld_path() -> None:
    """Resolve Playwright's required .so files from the Nix store and
    prepend them to LD_LIBRARY_PATH.  This is a no-op on Railway/Ubuntu
    where the system linker already finds the libs.

    Uses direct glob-based .so searching instead of package-name pattern
    matching — this is immune to Nix hash/version changes and correctly
    handles split packages like mesa-drivers vs mesa-dev.
    """
    NIX = "/nix/store"
    if not os.path.isdir(NIX):
        return

    needed_sonames = [
        "libgbm.so.1",
        "libX11.so.6",
        "libXcomposite.so.1",
        "libXdamage.so.1",
        "libXext.so.6",
        "libXfixes.so.3",
        "libXrandr.so.2",
        "libxcb.so.1",
        "libexpat.so.1",
        "libudev.so.1",
        "libxkbcommon.so.0",
        "libXau.so.6",
        "libxshmfence.so.1",
    ]

    dirs: set[str] = set()
    for soname in needed_sonames:
        # Search /lib and /lib64 subdirs — takes the first match per soname
        for pattern in (f"{NIX}/*/lib/{soname}", f"{NIX}/*/lib64/{soname}"):
            matches = _glob.glob(pattern)
            if matches:
                dirs.add(os.path.dirname(matches[0]))
                break

    if dirs:
        existing = os.environ.get("LD_LIBRARY_PATH", "")
        existing_set = set(existing.split(":")) if existing else set()
        new_dirs = dirs - existing_set
        if new_dirs:
            combined = ":".join(sorted(new_dirs))
            os.environ["LD_LIBRARY_PATH"] = f"{combined}:{existing}" if existing else combined


# NOTE: _ensure_nix_ld_path() is NOT called at import time because it does
# glob("/nix/store/*/lib/*.so") across tens of thousands of directories and
# hangs for minutes on Replit NixOS.  It is called lazily (once, thread-safe)
# inside browser_context() right before the first Playwright launch.
_nix_ld_patched = False

log = logging.getLogger("browser")


def _find_chromium_executable() -> Optional[str]:
    """Return the path to the installed Playwright Chromium binary.

    Prefers the full Chromium over the headless shell because the full build
    ships its own GPU/mesa shims and does not need libgbm.so.1 from the host.
    Falls back to the headless shell if the full build is absent.
    Returns None so the caller can let Playwright pick its own default.
    """
    # Full Chromium (Chrome for Testing) — works headlessly without host libgbm
    for pattern in (
        "/home/runner/workspace/.cache/ms-playwright/chromium-*/chrome-linux64/chrome",
        os.path.expanduser("~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome"),
        "/root/.cache/ms-playwright/chromium-*/chrome-linux64/chrome",
    ):
        hits = sorted(_glob.glob(pattern))
        if hits:
            return hits[-1]  # latest version

    # Headless shell fallback — needs host libgbm.so.1
    for pattern in (
        "/home/runner/workspace/.cache/ms-playwright/chromium_headless_shell-*"
        "/chrome-headless-shell-linux64/chrome-headless-shell",
        os.path.expanduser(
            "~/.cache/ms-playwright/chromium_headless_shell-*" "/chrome-headless-shell-linux64/chrome-headless-shell"
        ),
    ):
        hits = sorted(_glob.glob(pattern))
        if hits:
            return hits[-1]

    return None


# Reasonable Chrome UA matching modern Chromium
DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.6099.71 Safari/537.36"
)


def _proxy_settings(service: Optional[str] = None) -> Optional[Dict[str, str]]:
    """Return a Playwright proxy dict, optionally session-pinned per service.

    When `service` is supplied the proxy is pinned to a stable Bright Data
    session ID derived from the service name.  This gives clerk/court/login
    pages a consistent exit IP across the entire browser session, which is the
    #1 fix for ERR_TUNNEL_CONNECTION_FAILED and Cloudflare re-challenge loops.
    """
    from ..config import settings

    if service:
        return settings.proxy_dict_pinned(service)
    return settings.proxy_dict()


_STATE_DIR = Path(os.getenv("BROWSER_STATE_DIR", "/tmp")).resolve()
_STATE_DIR.mkdir(parents=True, exist_ok=True)

_REDIS_SESSION_TTL = 60 * 60 * 24 * 7  # 7 days


async def _redis_save_state(service: str, state_path: Path) -> None:
    """Persist session state JSON to Redis (7-day TTL) alongside the file."""
    try:
        from ..job_store import _redis as _r

        if _r is None:
            return
        data = state_path.read_text()
        await _r.setex(f"TolipAI:session:{service}", _REDIS_SESSION_TTL, data)
        log.debug("[%s] session state saved to Redis", service)
    except Exception as exc:
        log.warning("[%s] Redis session save failed: %s", service, str(exc)[:120])


async def _redis_load_state(service: str) -> Optional[str]:
    """Return stored session JSON from Redis, or None if unavailable."""
    try:
        from ..job_store import _redis as _r

        if _r is None:
            return None
        raw = await _r.get(f"TolipAI:session:{service}")
        if raw:
            log.debug("[%s] session state restored from Redis", service)
            return raw.decode() if isinstance(raw, bytes) else raw
    except Exception as exc:
        log.warning("[%s] Redis session load failed: %s", service, str(exc)[:120])
    return None


async def _redis_delete_state(service: str) -> None:
    """Remove session key from Redis on invalidation."""
    try:
        from ..job_store import _redis as _r

        if _r is None:
            return
        await _r.delete(f"TolipAI:session:{service}")
        log.debug("[%s] Redis session key deleted", service)
    except Exception as exc:
        log.warning("[%s] Redis session delete failed: %s", service, str(exc)[:80])

# ─── Shared stealth script (extracted for reuse on re-created contexts) ───────
_STEALTH_SCRIPT = """
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
if (!window.chrome) {
  window.chrome = {
    app: { isInstalled: false, InstallState: {}, RunningState: {} },
    runtime: {
      PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
      PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
      RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
      OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
    },
    csi: () => {},
    loadTimes: () => {},
  };
}
const _origPermQuery = window.navigator.permissions.query.bind(navigator.permissions);
window.navigator.permissions.query = (params) =>
  params.name === 'notifications'
    ? Promise.resolve({ state: Notification.permission, onchange: null })
    : _origPermQuery(params);
Object.defineProperty(navigator, 'plugins', {
  get: () => {
    const arr = [
      { filename: 'internal-pdf-viewer', name: 'Chrome PDF Plugin', description: 'Portable Document Format', length: 1 },
      { filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', name: 'Chrome PDF Viewer', description: '', length: 1 },
      { filename: 'internal-nacl-plugin', name: 'Native Client', description: '', length: 2 }
    ];
    arr.item = (i) => arr[i]; arr.namedItem = (n) => arr.find(p => p.name === n) || null; arr.refresh = () => {};
    return arr;
  }, configurable: true,
});
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true });
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
if ('deviceMemory' in navigator) { Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true }); }
Object.defineProperty(navigator, 'platform', { get: () => 'Win32', configurable: true });
try {
  const getParam = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(param) {
    if (param === 37445) return 'Intel Inc.';
    if (param === 37446) return 'Intel Iris OpenGL Engine';
    return getParam.call(this, param);
  };
} catch(e) {}
try {
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
    const ctx2d = this.getContext('2d');
    if (ctx2d) { const d = ctx2d.getImageData(0,0,this.width||1,this.height||1); d.data[0]^=1; ctx2d.putImageData(d,0,0); }
    return origToDataURL.call(this, type, quality);
  };
} catch(e) {}
try {
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    const origEnum = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = () => origEnum().then(d => d.length ? d : [
      { deviceId:'default', groupId:'default', kind:'audioinput', label:'' },
      { deviceId:'default', groupId:'default', kind:'audiooutput', label:'' },
      { deviceId:'default', groupId:'default', kind:'videoinput', label:'' },
    ]);
  }
} catch(e) {}
try { Object.defineProperty(navigator, 'connection', { get: () => ({ effectiveType:'4g', rtt:50, downlink:10, saveData:false }), configurable:true }); } catch(e) {}
if (window.outerWidth === 0) Object.defineProperty(window, 'outerWidth', { get: () => 1440 });
if (window.outerHeight === 0) Object.defineProperty(window, 'outerHeight', { get: () => 900 });
"""


async def _apply_stealth(ctx: Any) -> None:
    """Apply stealth patches to a Playwright BrowserContext.

    Fix 4.1: Uses playwright-stealth (maintained library covering 50+ fingerprint
    vectors) when installed.  Falls back to the hand-rolled _STEALTH_SCRIPT so the
    engine stays functional even if the package isn't present in the image.
    """
    try:
        from playwright_stealth import StealthConfig
        config = StealthConfig()
        scripts = list(config.enabled_scripts)
        if scripts:
            for script in scripts:
                await ctx.add_init_script(script)
            log.debug("[stealth] applied playwright-stealth (%d scripts)", len(scripts))
            return
    except Exception as _e:
        log.debug("[stealth] playwright-stealth not available (%s) — using fallback", _e)

    # Fallback: hand-rolled comprehensive stealth script
    await ctx.add_init_script(_STEALTH_SCRIPT)
    log.debug("[stealth] applied hand-rolled stealth script")


async def _nav_with_fallback(page: Any, url: str, logger: Any, service: str, timeout_ms: int = 45000) -> None:
    """Navigate to `url` with a robust multi-strategy fallback.

    Strategy:
      1. Try wait_until="commit" (fastest — unblocked by proxy tunnel stalls)
      2. On failure, wait 2 s and retry with wait_until="domcontentloaded"
      3. On second failure, try wait_until="networkidle" with a shorter budget

    After each navigation, saves a debug screenshot to /tmp if the page title
    looks like a bot-detection block page (403 / Cloudflare / Just a moment).
    """
    debug_path = f"/tmp/nav_debug_{service}_{hash(url) & 0xFFFF:04x}.png"
    for attempt, strategy in enumerate(["commit", "domcontentloaded", "networkidle"]):
        try:
            await page.goto(url, wait_until=strategy, timeout=timeout_ms)
            # Check for bot-block pages after navigation
            title = (await page.title()).lower()
            if any(
                kw in title
                for kw in (
                    "403",
                    "access denied",
                    "just a moment",
                    "cloudflare",
                    "blocked",
                    "captcha",
                )
            ):
                logger.warning(
                    "[%s] bot-block detected on %s (title=%r) — screenshot: %s",
                    service,
                    url,
                    title,
                    debug_path,
                )
                try:
                    await page.screenshot(path=debug_path, full_page=False)
                except Exception:
                    pass
            return
        except Exception as nav_err:
            err_str = str(nav_err)
            # 403 / 404 — no point retrying
            if "ERR_ABORTED" in err_str or "net::ERR_NAME_NOT_RESOLVED" in err_str:
                raise
            if attempt < 2:
                logger.warning(
                    "[%s] nav attempt %d (%s) failed for %s: %s — retrying…",
                    service,
                    attempt + 1,
                    strategy,
                    url,
                    err_str[:120],
                )
                await page.wait_for_timeout(2000)
            else:
                # All strategies exhausted — save screenshot and re-raise
                logger.error(
                    "[%s] all nav strategies failed for %s: %s",
                    service,
                    url,
                    err_str[:200],
                )
                try:
                    await page.screenshot(path=debug_path, full_page=False)
                    logger.error("[%s] debug screenshot saved to %s", service, debug_path)
                except Exception:
                    pass
                raise


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
    no_proxy: bool = False,
) -> AsyncIterator[Any]:
    """Yield an authenticated Playwright context for `service`.

    If a saved storage_state exists we reuse it. Otherwise (or if it's expired)
    we call `login_fn(page)` to populate cookies, then save state for next time.

    Args:
        no_proxy: When True, skip the proxy entirely (useful for public government
                  sites that don't need a proxy and may block known proxy IPs).
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError as e:
        raise RuntimeError("playwright not installed — run `playwright install chromium`") from e

    state_file = _state_path(service)

    # ── Session resolution: Redis → file → fresh login ────────────────────────
    # On Railway every deploy wipes /tmp; Redis survives across deploys so we
    # always try Redis first and fall back to the local file if Redis is absent.
    storage_state: Optional[str] = None
    _redis_state = await _redis_load_state(service)
    if _redis_state:
        # Write to disk so Playwright can read it via file path
        state_file.write_text(_redis_state)
        storage_state = str(state_file)
        log.info("[%s] session restored from Redis", service)
    elif state_file.exists():
        storage_state = str(state_file)
        log.info("[%s] session restored from local file", service)

    # Lazy one-time Nix LD_LIBRARY_PATH setup (skipped at import time to avoid
    # expensive glob scan of /nix/store on Replit).
    global _nix_ld_patched
    if not _nix_ld_patched:
        _ensure_nix_ld_path()
        _nix_ld_patched = True

    pw = await async_playwright().start()

    proxy_cfg: Optional[ProxySettings] = None if no_proxy else _proxy_settings(service)  # type: ignore[assignment]

    # Prefer the full Chromium binary over the headless shell.
    # The headless shell (chromium_headless_shell-*) requires libgbm.so.1 from
    # mesa, which is not always present on NixOS Replit containers.  The full
    # Chrome binary ships its own GPU/mesa shims and works headlessly without it.
    _exec_path: Optional[str] = _find_chromium_executable()
    if _exec_path:
        log.debug("[%s] using chromium executable: %s", service, _exec_path)

    browser = await pw.chromium.launch(
        headless=headless,
        executable_path=_exec_path,
        proxy=proxy_cfg,
        args=[
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--no-zygote",
            "--disable-gpu",
            "--disable-software-rasterizer",
        ],
    )
    if proxy_cfg:
        log.info("[%s] using proxy %s", service, proxy_cfg["server"])

    try:
        ctx = await browser.new_context(
            storage_state=storage_state,
            user_agent=user_agent or DEFAULT_UA,
            viewport={"width": 1440, "height": 900},
            locale="en-US",
            timezone_id="America/New_York",
            geolocation={"latitude": 32.7767, "longitude": -96.7970},
            permissions=["geolocation"],
            ignore_https_errors=True,
        )

        # ── Comprehensive stealth patches (all 13 fingerprint masks) ─────────
        await _apply_stealth(ctx)

        # First-time login (or session expired) flow
        if not storage_state and login_fn is not None:
            async with _state_lock(service):
                if not state_file.exists():
                    log.info("[%s] no saved session — performing login", service)
                    page = await ctx.new_page()
                    try:
                        await login_fn(page)
                        await ctx.storage_state(path=str(state_file))
                        log.info("[%s] saved storage_state to %s", service, state_file)
                        # Persist to Redis so sessions survive Railway redeploys
                        await _redis_save_state(service, state_file)
                    finally:
                        await page.close()
                else:
                    await ctx.close()
                    ctx = await browser.new_context(
                        storage_state=str(state_file),
                        user_agent=user_agent or DEFAULT_UA,
                        viewport={"width": 1440, "height": 900},
                        locale="en-US",
                        timezone_id="America/New_York",
                        geolocation={"latitude": 32.7767, "longitude": -96.7970},
                        permissions=["geolocation"],
                        ignore_https_errors=True,
                    )
                    # Apply the same comprehensive stealth patches on the re-used context
                    await _apply_stealth(ctx)

        yield ctx
    finally:
        try:
            await ctx.close()
        except Exception:
            pass
        await browser.close()
        await pw.stop()


async def invalidate_session(service: str) -> None:
    """Delete the cached session from disk AND Redis — next call will re-login."""
    p = _state_path(service)
    if p.exists():
        try:
            p.unlink()
            log.info("[%s] local session file deleted", service)
        except Exception as e:
            log.warning("[%s] failed to delete local session file: %s", service, e)
    await _redis_delete_state(service)
    log.info("[%s] session invalidated", service)


def dump_cookies(state: Dict[str, Any]) -> str:
    """Helpful for debugging — return cookie names from a storage_state dict."""
    cookies = state.get("cookies", [])
    return ", ".join(sorted({c.get("name", "?") for c in cookies}))
