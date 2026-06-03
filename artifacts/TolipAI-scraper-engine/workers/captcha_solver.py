"""CAPTCHA solving integration — 2Captcha / Anti-Captcha.

Supports reCAPTCHA v2, reCAPTCHA v3, hCaptcha, and Cloudflare Turnstile.
Requires CAPTCHA_API_KEY environment variable (2Captcha API key).

Budget: ~$2-3 per 1,000 reCAPTCHA v2 solves. Plan for $50-100/month
for 10 counties with CAPTCHA-protected portals.

Usage:
    solver = CaptchaSolver()
    token = await solver.solve_recaptcha_v2(site_key, page_url)
    if token:
        # inject token into form and submit
        await page.evaluate(f"document.getElementById('g-recaptcha-response').value = '{token}'")
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

log = logging.getLogger("captcha")

_POLL_INTERVAL_SEC = 5
_MAX_POLLS = 24  # 2 minutes max
_2CAPTCHA_IN = "https://2captcha.com/in.php"
_2CAPTCHA_RES = "https://2captcha.com/res.php"


class CaptchaSolver:
    def __init__(self, provider: str = "2captcha") -> None:
        self.provider = provider
        self.api_key: Optional[str] = os.getenv("CAPTCHA_API_KEY")
        if not self.api_key:
            log.warning(
                "[captcha] CAPTCHA_API_KEY not set — CAPTCHA solving disabled. "
                "RealForeclose and other protected portals will be skipped."
            )

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    async def solve_recaptcha_v2(self, site_key: str, page_url: str) -> Optional[str]:
        """Solve reCAPTCHA v2. Returns g-recaptcha-response token or None."""
        if not self.api_key:
            log.warning("[captcha] No API key — cannot solve reCAPTCHA v2 for %s", page_url)
            return None

        try:
            import httpx
        except ImportError:
            log.error("[captcha] httpx not installed")
            return None

        try:
            async with httpx.AsyncClient(timeout=30) as cli:
                r = await cli.post(_2CAPTCHA_IN, data={
                    "key": self.api_key,
                    "method": "userrecaptcha",
                    "googlekey": site_key,
                    "pageurl": page_url,
                    "json": 1,
                })
            result = r.json()
            if result.get("status") != 1:
                log.error("[captcha] Submit failed: %s", result)
                return None
            captcha_id = result["request"]
            log.info("[captcha] reCAPTCHA v2 submitted, id=%s", captcha_id)
        except Exception as e:
            log.error("[captcha] Submit error: %s", e)
            return None

        for poll in range(_MAX_POLLS):
            await asyncio.sleep(_POLL_INTERVAL_SEC)
            try:
                async with httpx.AsyncClient(timeout=15) as cli:
                    r = await cli.get(_2CAPTCHA_RES, params={
                        "key": self.api_key,
                        "action": "get",
                        "id": captcha_id,
                        "json": 1,
                    })
                result = r.json()
                if result.get("status") == 1:
                    log.info("[captcha] reCAPTCHA v2 solved after %ds", (poll + 1) * _POLL_INTERVAL_SEC)
                    return result["request"]
                if result.get("request") == "CAPCHA_NOT_READY":
                    continue
                log.error("[captcha] Poll error: %s", result)
                return None
            except Exception as e:
                log.warning("[captcha] Poll error: %s", e)

        log.error("[captcha] Timed out after %ds", _MAX_POLLS * _POLL_INTERVAL_SEC)
        return None

    async def solve_hcaptcha(self, site_key: str, page_url: str) -> Optional[str]:
        """Solve hCaptcha. Returns h-captcha-response token or None."""
        if not self.api_key:
            return None
        try:
            import httpx
            async with httpx.AsyncClient(timeout=30) as cli:
                r = await cli.post(_2CAPTCHA_IN, data={
                    "key": self.api_key,
                    "method": "hcaptcha",
                    "sitekey": site_key,
                    "pageurl": page_url,
                    "json": 1,
                })
            result = r.json()
            if result.get("status") != 1:
                log.error("[captcha] hCaptcha submit failed: %s", result)
                return None
            captcha_id = result["request"]

            for _ in range(_MAX_POLLS):
                await asyncio.sleep(_POLL_INTERVAL_SEC)
                async with httpx.AsyncClient(timeout=15) as cli:
                    r = await cli.get(_2CAPTCHA_RES, params={
                        "key": self.api_key,
                        "action": "get",
                        "id": captcha_id,
                        "json": 1,
                    })
                result = r.json()
                if result.get("status") == 1:
                    return result["request"]
                if result.get("request") == "CAPCHA_NOT_READY":
                    continue
                return None
        except Exception as e:
            log.error("[captcha] hCaptcha error: %s", e)
        return None

    async def solve_turnstile(self, site_key: str, page_url: str) -> Optional[str]:
        """Solve Cloudflare Turnstile. Returns cf-turnstile-response token or None."""
        if not self.api_key:
            return None
        try:
            import httpx
            async with httpx.AsyncClient(timeout=30) as cli:
                r = await cli.post(_2CAPTCHA_IN, data={
                    "key": self.api_key,
                    "method": "turnstile",
                    "sitekey": site_key,
                    "pageurl": page_url,
                    "json": 1,
                })
            result = r.json()
            if result.get("status") != 1:
                return None
            captcha_id = result["request"]

            for _ in range(_MAX_POLLS):
                await asyncio.sleep(_POLL_INTERVAL_SEC)
                async with httpx.AsyncClient(timeout=15) as cli:
                    r = await cli.get(_2CAPTCHA_RES, params={
                        "key": self.api_key,
                        "action": "get",
                        "id": captcha_id,
                        "json": 1,
                    })
                result = r.json()
                if result.get("status") == 1:
                    return result["request"]
                if result.get("request") == "CAPCHA_NOT_READY":
                    continue
                return None
        except Exception as e:
            log.error("[captcha] Turnstile error: %s", e)
        return None


_default_solver = CaptchaSolver()
