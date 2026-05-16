"""Proxy cost optimizer — tier-based proxy selection with success tracking.

Tier hierarchy (cheapest → most expensive):
  datacenter  : $0.50/GB  — static HTML, ATTOM, RentCast, county sites
  residential : $15/GB    — Propelio, Propwire, Zillow, Redfin
  mobile      : $30/GB    — hardened JS sites, CAPTCHA-gated pages

Request coalescing
──────────────────
  If N concurrent callers all request the same URL within COALESCE_WINDOW
  seconds, only ONE outbound HTTP request is made and the result is fanned
  out to all waiters.  This eliminates the "5 users ask for Miami cash
  buyers → 5 identical proxy hits" problem.

Usage
─────
    from .proxy_pool import proxy_pool

    proxy_url  = proxy_pool.select_proxy_url(url)   # for httpx
    proxy_dict = proxy_pool.select_proxy_dict(url)  # for Playwright

    # With coalescing (recommended for heavy pages):
    result = await proxy_pool.coalesce(url, lambda: fetch_html(url))

    # Report outcomes so the pool can back off exhausted tiers:
    proxy_pool.record_success(url)
    proxy_pool.record_failure(url, is_rate_limit=True)
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Callable, Coroutine, Dict, List, Optional

from .config import settings

log = logging.getLogger("proxy_pool")

# ─── Tier definitions ─────────────────────────────────────────────────────────

PROXY_TIERS: Dict[str, Dict[str, Any]] = {
    "datacenter": {
        # Bright Data datacenter zone — set BRIGHTDATA_DC_ZONE env var.
        # Cost: ~$0.50/GB vs $15/GB for residential.
        "cost_per_gb": 0.50,
        "domains": [
            "attom.com", "rentcast.io", "rentcast.com",
            "realestate.com", "homejunction.com",
            "publicrecords", "taxrecords",
            "county-taxes", "mytaxcollector",
        ],
    },
    "residential": {
        "cost_per_gb": 15.00,
        "domains": [
            "propelio.com", "propwire.com",
            "zillow.com", "redfin.com",
            "realtor.com", "homes.com", "trulia.com",
            "homepath.com", "loopnet.com",
        ],
    },
    "mobile": {
        # Reserve for CAPTCHA-gated / bot-detection hardened sites only.
        "cost_per_gb": 30.00,
        "domains": [
            "foreclosure.com", "hubzu.com",
            "auction.com", "xome.com",
        ],
    },
}

# Domains that bypass ALL proxy tiers (government / county portals that block
# datacenter and residential proxies alike).
_NO_PROXY_DOMAINS = (
    "treasurer.cuyahoga", "auditor.cuyahoga", "probate.cuyahoga",
    "cuyahogacounty.us", "sheriffsaleauction.ohio.gov",
    ".state.oh.us", ".state.nc.us", ".state.tx.us", ".state.fl.us",
    "hctax.net", "lacounty.gov", "ttc.lacounty", "cclerk.hctx",
    "octaxcol.com", "broward.county-taxes",
)

# ─── Failure / exhaustion tracking ───────────────────────────────────────────
# Each tier tracks consecutive rate-limits and gets a cooldown when too many
# pile up.  After the cooldown the tier is retried automatically.

_tier_stats: Dict[str, Dict[str, Any]] = {
    t: {"successes": 0, "failures": 0, "rate_limits": 0, "exhausted_until": 0.0}
    for t in PROXY_TIERS
}

_RATE_LIMIT_THRESHOLD = int(os.getenv("PROXY_RATE_LIMIT_THRESHOLD", "5"))
_EXHAUSTION_COOLDOWN  = int(os.getenv("PROXY_EXHAUSTION_COOLDOWN",  "120"))  # seconds

# ─── Request coalescing ───────────────────────────────────────────────────────
# url → in-flight asyncio.Future
_in_flight: Dict[str, "asyncio.Future[Any]"] = {}


def _tier_for_url(url: str) -> str:
    """Return the cheapest appropriate proxy tier for a URL."""
    lower = url.lower()
    if any(d in lower for d in _NO_PROXY_DOMAINS):
        return "passthrough"
    for tier_name in ("mobile", "residential", "datacenter"):
        domains: List[str] = PROXY_TIERS[tier_name]["domains"]
        if any(d in lower for d in domains):
            return tier_name
    return "datacenter"  # safe default — cheapest


class ProxyPool:
    """Tier-based proxy selector with failure tracking and request coalescing."""

    # ── Tier health ───────────────────────────────────────────────────────────

    def _tier_exhausted(self, tier: str) -> bool:
        return time.time() < _tier_stats.get(tier, {}).get("exhausted_until", 0.0)

    def record_success(self, url: str, tier: Optional[str] = None) -> None:
        """Call after a successful fetch to reset the rate-limit counter."""
        t = tier or _tier_for_url(url)
        stats = _tier_stats.get(t)
        if stats is None:
            return
        stats["successes"] += 1
        stats["rate_limits"] = 0  # reset consecutive counter on success

    def record_failure(
        self,
        url: str,
        tier: Optional[str] = None,
        *,
        is_rate_limit: bool = False,
    ) -> None:
        """Call after a failed fetch so the pool can throttle exhausted tiers."""
        t = tier or _tier_for_url(url)
        stats = _tier_stats.get(t)
        if stats is None:
            return
        stats["failures"] += 1
        if is_rate_limit:
            stats["rate_limits"] += 1
            rl = stats["rate_limits"]
            if rl >= _RATE_LIMIT_THRESHOLD:
                stats["exhausted_until"] = time.time() + _EXHAUSTION_COOLDOWN
                log.warning(
                    "proxy_pool: tier '%s' exhausted after %d consecutive "
                    "rate-limits — cooling down %ds",
                    t, rl, _EXHAUSTION_COOLDOWN,
                )

    def select_tier(self, url: str) -> str:
        """Return the best non-exhausted tier for this URL.

        Falls back up the cost ladder when cheaper tiers are exhausted.
        """
        preferred = _tier_for_url(url)
        if preferred == "passthrough":
            return "passthrough"
        if not self._tier_exhausted(preferred):
            return preferred
        # Try the full ladder cheapest-first as fallback
        for t in ("datacenter", "residential", "mobile"):
            if t != preferred and not self._tier_exhausted(t):
                log.info(
                    "proxy_pool: preferred tier '%s' exhausted — using '%s' for %s",
                    preferred, t, url[:60],
                )
                return t
        log.warning("proxy_pool: ALL tiers exhausted — using residential as last resort")
        return "residential"

    def _brightdata_url_for_dc_zone(self) -> Optional[str]:
        """Build a Bright Data proxy URL using the configured datacenter zone."""
        dc_zone = os.getenv("BRIGHTDATA_DC_ZONE")
        if not dc_zone or not settings.brightdata_configured():
            return None
        base_user = settings.brightdata_username or ""
        if "-zone-" in base_user:
            base_user = base_user.split("-zone-")[0]
        user = f"{base_user}-zone-{dc_zone}"
        return (
            f"http://{user}:{settings.brightdata_password}"
            f"@{settings.brightdata_host}:{settings.brightdata_port}"
        )

    def _brightdata_dict_for_dc_zone(self) -> Optional[Dict[str, str]]:
        dc_zone = os.getenv("BRIGHTDATA_DC_ZONE")
        if not dc_zone or not settings.brightdata_configured():
            return None
        base_user = settings.brightdata_username or ""
        if "-zone-" in base_user:
            base_user = base_user.split("-zone-")[0]
        return {
            "server":   f"http://{settings.brightdata_host}:{settings.brightdata_port}",
            "username": f"{base_user}-zone-{dc_zone}",
            "password": settings.brightdata_password or "",
        }

    def select_proxy_url(self, url: str) -> Optional[str]:
        """Return the proxy URL string for httpx/aiohttp, or None for direct."""
        tier = self.select_tier(url)
        if tier == "passthrough":
            return None
        if tier == "datacenter":
            dc_url = self._brightdata_url_for_dc_zone()
            if dc_url:
                return dc_url
        # residential / mobile / datacenter fallback → configured residential proxy
        return settings.proxy_url()

    def select_proxy_dict(self, url: str) -> Optional[Dict[str, str]]:
        """Return a Playwright-compatible proxy dict, or None for direct."""
        tier = self.select_tier(url)
        if tier == "passthrough":
            return None
        if tier == "datacenter":
            dc_dict = self._brightdata_dict_for_dc_zone()
            if dc_dict:
                return dc_dict
        return settings.proxy_dict()

    def stats(self) -> Dict[str, Any]:
        """Return per-tier health stats (for /healthz or CloudWatch)."""
        now = time.time()
        return {
            tier: {
                **data,
                "exhausted":          now < data.get("exhausted_until", 0.0),
                "exhausted_for_secs": max(0, int(data.get("exhausted_until", 0.0) - now)),
            }
            for tier, data in _tier_stats.items()
        }

    # ── Request coalescing ────────────────────────────────────────────────────

    async def coalesce(
        self,
        url: str,
        fetch_fn: Callable[[], Coroutine[Any, Any, Any]],
    ) -> Any:
        """Deduplicate identical concurrent URL requests.

        If the same URL is already being fetched, block and return the same
        result once the first request completes — no additional proxy hit.

        Usage:
            html = await proxy_pool.coalesce(url, lambda: fetch_direct(url))
        """
        existing = _in_flight.get(url)
        if existing is not None:
            log.debug("proxy_pool.coalesce: joining in-flight request for %s", url[:80])
            return await asyncio.shield(existing)

        loop = asyncio.get_event_loop()
        fut: asyncio.Future[Any] = loop.create_future()
        _in_flight[url] = fut
        try:
            result = await fetch_fn()
            fut.set_result(result)
            return result
        except Exception as exc:
            if not fut.done():
                fut.set_exception(exc)
            raise
        finally:
            _in_flight.pop(url, None)


# ── Module singleton ───────────────────────────────────────────────────────────
proxy_pool = ProxyPool()
