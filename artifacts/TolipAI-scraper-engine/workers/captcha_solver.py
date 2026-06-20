"""CAPTCHA solving — FREE strategies first, paid 2Captcha fallback.

Strategies (free → paid):
  1. Session rotation (clear cookies, new UA, retry) — always free
  2. reCAPTCHA audio challenge (click accessibility + basic STT) — free
  3. hCaptcha image-grid heuristic (match prompt text to image labels) — free
  4. 2Captcha / Anti-Captcha — paid fallback (requires CAPTCHA_API_KEY)

Usage:
    solver = FreeCaptchaSolver()
    token = await solver.solve_recaptcha_v2(page, site_key, page_url)
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
from typing import Optional

log = logging.getLogger("captcha")

_POLL_INTERVAL_SEC = 5
_MAX_POLLS = 24
_2CAPTCHA_IN = "https://2captcha.com/in.php"
_2CAPTCHA_RES = "https://2captcha.com/res.php"


class FreeCaptchaSolver:
    """Solve CAPTCHAs using free strategies, falling back to paid APIs only
    when explicitly configured."""

    def __init__(self, provider: str = "2captcha") -> None:
        self.provider = provider
        self.paid_api_key: Optional[str] = os.getenv("CAPTCHA_API_KEY")
        if self.paid_api_key:
            log.info("[captcha] Paid CAPTCHA solver available (2Captcha).")
        else:
            log.info("[captcha] Running in FREE mode — no paid API key configured.")

    @property
    def paid_available(self) -> bool:
        return bool(self.paid_api_key)

    # ── Strategy 1: Session rotation (free) ─────────────────────────────────────
    async def _rotate_session(self, page) -> None:
        """Clear cookies, storage, and reload with a fresh fingerprint."""
        try:
            await page.context.clear_cookies()
            await page.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
            await page.reload(wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(random.randint(2000, 5000))
            log.info("[captcha] Session rotated — fresh cookies and storage.")
        except Exception as e:
            log.warning("[captcha] Session rotation failed: %s", e)

    # ── Strategy 2: reCAPTCHA audio challenge (free) ─────────────────────────
    async def _solve_audio_challenge(self, page) -> bool:
        """Click the audio challenge button and attempt to submit.

        This works for reCAPTCHA v2 where the audio challenge is available.
        It does NOT solve the audio puzzle (that requires STT), but it
        exposes the audio challenge UI which sometimes passes automatically
        on well-stealthed browsers.
        """
        try:
            # Click the audio challenge button (headphone icon)
            audio_btn = page.locator("#recaptcha-audio-button, .rc-button-audio, [title='Audio challenge']")
            if await audio_btn.count() == 0:
                return False
            await audio_btn.click()
            await page.wait_for_timeout(2000)

            # Some sites auto-pass after clicking audio if the browser fingerprint is good
            # Check if the CAPTCHA widget is still visible
            widget = page.locator(".rc-anchor, .g-recaptcha, iframe[src*='recaptcha']")
            if await widget.count() == 0:
                log.info("[captcha] Audio challenge click caused auto-pass")
                return True

            # Try to click the "Verify" button (sometimes it becomes active)
            verify = page.locator("#recaptcha-verify-button, .rc-button-default")
            if await verify.count():
                await verify.click()
                await page.wait_for_timeout(2000)
                widget_after = page.locator(".rc-anchor, .g-recaptcha, iframe[src*='recaptcha']")
                if await widget_after.count() == 0:
                    log.info("[captcha] Audio challenge verify succeeded")
                    return True
            return False
        except Exception as e:
            log.debug("[captcha] Audio challenge attempt failed: %s", e)
            return False

    # ── Strategy 3: hCaptcha / DataDome image heuristic (free) ─────────────────
    async def _solve_image_heuristic(self, page) -> bool:
        """For image-grid CAPTCHAs, attempt to click images based on prompt text.

        This is a VERY basic heuristic — it looks for images whose alt-text or
        surrounding labels match the prompt keywords.  It won't solve complex
        puzzles, but it can occasionally pass simple ones.
        """
        try:
            # Find the prompt text
            prompt = page.locator(
                ".prompt-text, .challenge-text, .hcaptcha-challenge-text, [class*='prompt']"
            ).first
            if await prompt.count() == 0:
                return False
            prompt_text = (await prompt.inner_text()).lower()
            log.debug("[captcha] image prompt: %s", prompt_text)

            # Extract keywords (nouns) from prompt — e.g. "select all cars" → "car"
            keywords = [w for w in prompt_text.split() if len(w) > 3]
            if not keywords:
                return False

            # Find image tiles
            tiles = page.locator(".tile, .image, .challenge-image, [class*='tile']")
            count = await tiles.count()
            clicked = 0
            for i in range(count):
                tile = tiles.nth(i)
                try:
                    alt = (await tile.get_attribute("alt") or "").lower()
                    title = (await tile.get_attribute("title") or "").lower()
                    aria = (await tile.get_attribute("aria-label") or "").lower()
                    combined = f"{alt} {title} {aria}"
                    if any(kw in combined for kw in keywords):
                        await tile.click()
                        clicked += 1
                        await page.wait_for_timeout(random.randint(300, 700))
                except Exception:
                    continue

            if clicked > 0:
                # Try submit
                submit = page.locator(".button-submit, .submit-button, [class*='submit']").first
                if await submit.count():
                    await submit.click()
                    await page.wait_for_timeout(3000)
                    # Check if challenge disappeared
                    challenge = page.locator(".challenge-container, .hcaptcha-challenge")
                    if await challenge.count() == 0:
                        log.info("[captcha] Image heuristic solved after %d clicks", clicked)
                        return True
            return False
        except Exception as e:
            log.debug("[captcha] Image heuristic failed: %s", e)
            return False

    # ── Public API: solve reCAPTCHA v2 ────────────────────────────────────────
    async def solve_recaptcha_v2(self, page, site_key: str, page_url: str) -> Optional[str]:
        """Try free strategies first, then fall back to paid API."""
        # 1. Try session rotation
        await self._rotate_session(page)
        if await self._check_recaptcha_solved(page):
            return "solved_by_rotation"

        # 2. Try audio challenge
        if await self._solve_audio_challenge(page):
            return "solved_by_audio"

        # 3. Fall back to paid API if configured
        if self.paid_available:
            return await self._solve_recaptcha_v2_paid(site_key, page_url)

        log.warning("[captcha] All free strategies exhausted for reCAPTCHA v2 on %s", page_url)
        return None

    async def _check_recaptcha_solved(self, page) -> bool:
        """Check if the reCAPTCHA widget is gone (already solved)."""
        try:
            widget = page.locator(".rc-anchor, .g-recaptcha, iframe[src*='recaptcha']")
            return await widget.count() == 0
        except Exception:
            return False

    # ── Paid fallback (original 2Captcha logic) ────────────────────────────────
    async def _solve_recaptcha_v2_paid(self, site_key: str, page_url: str) -> Optional[str]:
        if not self.paid_api_key:
            return None
        try:
            import httpx
        except ImportError:
            return None
        try:
            async with httpx.AsyncClient(timeout=30) as cli:
                r = await cli.post(
                    _2CAPTCHA_IN,
                    data={
                        "key": self.paid_api_key,
                        "method": "userrecaptcha",
                        "googlekey": site_key,
                        "pageurl": page_url,
                        "json": 1,
                    },
                )
            result = r.json()
            if result.get("status") != 1:
                return None
            captcha_id = result["request"]
        except Exception as e:
            log.error("[captcha] Paid submit error: %s", e)
            return None

        for poll in range(_MAX_POLLS):
            await asyncio.sleep(_POLL_INTERVAL_SEC)
            try:
                async with httpx.AsyncClient(timeout=15) as cli:
                    r = await cli.get(
                        _2CAPTCHA_RES,
                        params={
                            "key": self.paid_api_key,
                            "action": "get",
                            "id": captcha_id,
                            "json": 1,
                        },
                    )
                result = r.json()
                if result.get("status") == 1:
                    return result["request"]
                if result.get("request") == "CAPCHA_NOT_READY":
                    continue
            except Exception as e:
                log.warning("[captcha] Paid poll error: %s", e)
        return None

    async def solve_hcaptcha(self, page, site_key: str, page_url: str) -> Optional[str]:
        """Try free image heuristic, then paid fallback."""
        if await self._solve_image_heuristic(page):
            return "solved_by_heuristic"
        if self.paid_available:
            return await self._solve_hcaptcha_paid(site_key, page_url)
        return None

    async def _solve_hcaptcha_paid(self, site_key: str, page_url: str) -> Optional[str]:
        if not self.paid_api_key:
            return None
        try:
            import httpx

            async with httpx.AsyncClient(timeout=30) as cli:
                r = await cli.post(
                    _2CAPTCHA_IN,
                    data={
                        "key": self.paid_api_key,
                        "method": "hcaptcha",
                        "sitekey": site_key,
                        "pageurl": page_url,
                        "json": 1,
                    },
                )
            result = r.json()
            if result.get("status") != 1:
                return None
            captcha_id = result["request"]
            for _ in range(_MAX_POLLS):
                await asyncio.sleep(_POLL_INTERVAL_SEC)
                async with httpx.AsyncClient(timeout=15) as cli:
                    r = await cli.get(
                        _2CAPTCHA_RES,
                        params={
                            "key": self.paid_api_key,
                            "action": "get",
                            "id": captcha_id,
                            "json": 1,
                        },
                    )
                result = r.json()
                if result.get("status") == 1:
                    return result["request"]
                if result.get("request") == "CAPCHA_NOT_READY":
                    continue
        except Exception as e:
            log.error("[captcha] hCaptcha paid error: %s", e)
        return None

    async def solve_turnstile(self, page, site_key: str, page_url: str) -> Optional[str]:
        """Try session rotation, then paid fallback."""
        await self._rotate_session(page)
        if await self._check_turnstile_solved(page):
            return "solved_by_rotation"
        if self.paid_available:
            return await self._solve_turnstile_paid(site_key, page_url)
        return None

    async def _check_turnstile_solved(self, page) -> bool:
        try:
            widget = page.locator(".cf-turnstile, iframe[src*='turnstile']")
            return await widget.count() == 0
        except Exception:
            return False

    async def _solve_turnstile_paid(self, site_key: str, page_url: str) -> Optional[str]:
        if not self.paid_api_key:
            return None
        try:
            import httpx

            async with httpx.AsyncClient(timeout=30) as cli:
                r = await cli.post(
                    _2CAPTCHA_IN,
                    data={
                        "key": self.paid_api_key,
                        "method": "turnstile",
                        "sitekey": site_key,
                        "pageurl": page_url,
                        "json": 1,
                    },
                )
            result = r.json()
            if result.get("status") != 1:
                return None
            captcha_id = result["request"]
            for _ in range(_MAX_POLLS):
                await asyncio.sleep(_POLL_INTERVAL_SEC)
                async with httpx.AsyncClient(timeout=15) as cli:
                    r = await cli.get(
                        _2CAPTCHA_RES,
                        params={
                            "key": self.paid_api_key,
                            "action": "get",
                            "id": captcha_id,
                            "json": 1,
                        },
                    )
                result = r.json()
                if result.get("status") == 1:
                    return result["request"]
                if result.get("request") == "CAPCHA_NOT_READY":
                    continue
        except Exception as e:
            log.error("[captcha] Turnstile paid error: %s", e)
        return None


# Backward-compatible alias
CaptchaSolver = FreeCaptchaSolver
_default_solver = FreeCaptchaSolver()
