"""Skip-trace orchestrator.

Strategy:
  1. If we have an LLC name, look up officers/principals via Sunbiz (FL) or
     a generic web search through Kimi (other states).
  2. Use PropertyAPI.co batch skip-trace if available (the api-server already
     has keys; we re-use them here).
  3. As a last resort, scrape the principal's name + city via Google and let
     Kimi extract phones/emails.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx

from .config import settings
from .http_client import fetch_html
from .llm import extract_investor_profile
from .scrapers import sunbiz

log = logging.getLogger("skip_trace")


async def _propertyapi_skip(name: str, address: Optional[str] = None) -> Dict[str, Any]:
    if not settings.property_api_keys:
        return {}
    for key in settings.property_api_keys:
        try:
            async with httpx.AsyncClient(timeout=settings.request_timeout) as cli:
                r = await cli.post(
                    "https://api.propertyapi.co/skip-trace",
                    json={"name": name, "address": address or ""},
                    headers={"Authorization": f"Bearer {key}"},
                )
                if r.status_code == 200:
                    return r.json()
                if r.status_code in (402, 403) and "credits" in r.text.lower():
                    continue
        except Exception as e:  # noqa: BLE001
            log.info("PropertyAPI skip failed: %s", e)
            continue
    return {}


async def trace(name: str, *, llc: Optional[str] = None,
                address: Optional[str] = None, state: Optional[str] = None) -> Dict[str, Any]:
    """Return enriched contact data for a person / LLC."""
    out: Dict[str, Any] = {
        "name": name, "llc": llc, "phones": [], "emails": [],
        "principals": [], "addresses": [],
    }

    # ── Step 1: LLC lookup ───────────────────────────────────────────────────
    if llc and (state or "").upper() == "FL":
        hits = await sunbiz.search_llc(llc)
        if hits:
            detail = await sunbiz.fetch_llc_detail(hits[0]["detail_path"])
            if detail:
                out["principals"] = detail.get("principals") or []
                if detail.get("mailing_address"):
                    out["addresses"].append(detail["mailing_address"])

    # ── Step 2: PropertyAPI skip trace ───────────────────────────────────────
    papi = await _propertyapi_skip(name, address)
    if papi:
        out["phones"].extend(papi.get("phones") or [])
        out["emails"].extend(papi.get("emails") or [])

    # ── Step 3: Kimi web extraction fallback ─────────────────────────────────
    if not out["phones"] and not out["emails"]:
        q = name + (f" {state}" if state else "")
        try:
            html = await fetch_html(
                f"https://www.google.com/search?q={q.replace(' ', '+')}",
                render=False,
            )
            from bs4 import BeautifulSoup
            text = BeautifulSoup(html, "lxml").get_text("\n", strip=True)[:6000]
            profile = await extract_investor_profile(text, source="google_search")
            out["phones"].extend(profile.get("phones") or [])
            out["emails"].extend(profile.get("emails") or [])
            if profile.get("mailing_address"):
                out["addresses"].append(profile["mailing_address"])
        except Exception as e:  # noqa: BLE001
            log.info("Web fallback skip-trace failed: %s", e)

    # de-dupe
    out["phones"] = sorted({p for p in out["phones"] if p})
    out["emails"] = sorted({e for e in out["emails"] if e})
    out["addresses"] = sorted({a for a in out["addresses"] if a})
    return out
