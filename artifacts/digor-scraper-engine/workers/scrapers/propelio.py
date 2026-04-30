"""Propelio comps scraper.

Propelio (https://propelio.com/) offers a free tier with MLS-quality comps.
We scrape their public comp viewer through the tiered http_client (with
JS rendering on) and let the LLM normalise the result table into a
structured array of comps.

If Propelio later requires auth or blocks scraping, the engine still works
— callers just get an empty list and we log a soft-failure.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

from bs4 import BeautifulSoup

from ..http_client import fetch_html
from ..llm import _chat
import json

log = logging.getLogger("propelio")


PROPELIO_COMP_URL = "https://propelio.com/app/comps?address={addr}&radius={radius}"


async def fetch_comps(address: str, *, radius_miles: float = 0.5,
                      max_results: int = 12) -> List[Dict[str, Any]]:
    """Return up to `max_results` MLS-style comps near `address`."""
    if not address:
        return []
    url = PROPELIO_COMP_URL.format(addr=address.replace(" ", "+"),
                                   radius=radius_miles)
    try:
        html = await fetch_html(url, render=True)
    except Exception as e:  # noqa: BLE001
        log.info("Propelio fetch failed for %s: %s", address, e)
        return []

    text = BeautifulSoup(html, "lxml").get_text("\n", strip=True)[:9000]
    sys = (
        "You extract real-estate comparable sales from a Propelio comp viewer. "
        "Return STRICTLY JSON: { comps: [...] } where each item has keys: "
        "address, city, state, zip, sold_price (number), sold_date (ISO if possible), "
        "beds, baths, sqft (number|null), lot_sqft (number|null), year_built (int|null), "
        "distance_miles (number|null), price_per_sqft (number|null), days_on_market (int|null), "
        "property_type (string|null). Drop rows you can't extract reliably."
    )
    raw = await _chat(
        [
            {"role": "system", "content": sys},
            {"role": "user", "content": f"Subject: {address} (radius {radius_miles}mi)\n\n{text}"},
        ],
        json_mode=True, max_tokens=1400, temperature=0.1,
    )
    try:
        data = json.loads(raw)
        comps = [c for c in (data.get("comps") or []) if isinstance(c, dict) and c.get("address")]
        return comps[:max_results]
    except Exception:  # noqa: BLE001
        log.warning("Propelio LLM parse returned non-JSON")
        return []


async def estimate_arv(address: str, *, radius_miles: float = 0.5) -> Dict[str, Any]:
    """Convenience: fetch comps, then return median + p25/p75 sold price."""
    comps = await fetch_comps(address, radius_miles=radius_miles)
    if not comps:
        return {"address": address, "comps": [], "arv_estimate": None}
    prices = sorted(float(c["sold_price"]) for c in comps if c.get("sold_price"))
    if not prices:
        return {"address": address, "comps": comps, "arv_estimate": None}
    n = len(prices)
    median = prices[n // 2] if n % 2 else (prices[n // 2 - 1] + prices[n // 2]) / 2
    p25 = prices[max(0, n // 4)]
    p75 = prices[min(n - 1, (3 * n) // 4)]
    return {
        "address": address,
        "comps": comps,
        "arv_estimate": median,
        "arv_low": p25,
        "arv_high": p75,
        "comp_count": n,
        "source": "propelio",
    }
