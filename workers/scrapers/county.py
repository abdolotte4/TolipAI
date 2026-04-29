"""Backwards-compat shim — see distressed_sources.py for the new registry.

Older code imports `list_supported_counties` and `scrape_county`/`scrape_auction_com`.
We keep thin wrappers so nothing breaks while the engine evolves.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from . import distressed_sources as ds
from ..http_client import fetch_html
from ..llm import parse_distressed_page

log = logging.getLogger("county")


def list_supported_counties() -> List[Dict[str, str]]:
    """Subset of distressed_sources limited to county_clerk + public_trustee."""
    out: List[Dict[str, str]] = []
    for s in ds.SOURCES:
        if s["category"] in ("county_clerk", "public_trustee"):
            out.append({"key": s["key"], "name": s["name"], "state": s["state"]})
    return out


async def scrape_county(county_key: str, *, zip_code: str = "",
                        state: str = "", date: str = "") -> List[Dict[str, Any]]:
    src = ds.get_source(county_key)
    if not src:
        log.info("Unknown source key: %s", county_key)
        return []
    url = (src["url"]
           .replace("{zip}", zip_code or "")
           .replace("{state}", (state or "").lower())
           .replace("{date}", date))
    try:
        html = await fetch_html(url, render=src.get("render", False))
    except Exception as e:  # noqa: BLE001
        log.warning("County fetch failed for %s: %s", county_key, e)
        return []
    from bs4 import BeautifulSoup
    text = BeautifulSoup(html, "lxml").get_text("\n", strip=True)[:9000]
    listings = await parse_distressed_page(text, source=src["name"])
    cat = ds.CATEGORY_META.get(src["category"], {})
    for l in listings:
        l.setdefault("source", cat.get("distress_type", src["category"]))
        l.setdefault("source_url", url)
        l.setdefault("state", src["state"] if src["state"] != "*" else state)
    return listings


async def scrape_auction_com(state: str, zip_code: str) -> List[Dict[str, Any]]:
    return await scrape_county("auction-com", state=state, zip_code=zip_code)
