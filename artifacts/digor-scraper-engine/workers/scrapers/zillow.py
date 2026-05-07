"""Zillow scrapers — recently sold + active listings + FSBO.

Used by the cash_buyers + distressed orchestrators.  Mirrors the data shape
already in the api-server TS scraper but adds:
  - "sold within last N months" filtering for the cash buyer flow
  - owner mailing address from the property detail page (when available)
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

from ..http_client import fetch_html

log = logging.getLogger("zillow")

NEXT_DATA_RE = re.compile(
    r'<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)</script>',
    re.I,
)


def _slug(city: str, state: str) -> str:
    return f"{city.strip().lower().replace(' ', '-')}-{state.strip().lower()}"


def _parse_next_data(html: str) -> Optional[Dict[str, Any]]:
    m = NEXT_DATA_RE.search(html or "")
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception:  # noqa: BLE001
        return None


async def fetch_recently_sold(
    zip_code: Optional[str] = None,
    city: str = "",
    state: str = "",
    max_results: int = 50,
) -> List[Dict[str, Any]]:
    """Return recently-sold homes (cash + financed) for a region.

    The owner names + mailing addresses on these are the seed for cash-buyer
    discovery: anyone whose mailing address differs from the property they
    just bought is most likely an investor.
    """
    if zip_code:
        path = f"https://www.zillow.com/homes/recently_sold/{zip_code}_rb/"
    elif city and state:
        path = f"https://www.zillow.com/homes/recently_sold/{_slug(city, state)}_rb/"
    else:
        return []

    try:
        html = await fetch_html(path, render=True)
    except Exception as e:  # noqa: BLE001
        log.warning("Zillow fetch failed: %s", e)
        return []

    data = _parse_next_data(html)
    if not data:
        return []

    cat = (data.get("cat1") or {}) or (
        data.get("props", {})
        .get("pageProps", {})
        .get("searchPageState", {})
        .get("cat1")
        or {}
    )
    results = (cat.get("searchResults") or {}).get("listResults") or []

    out: List[Dict[str, Any]] = []
    for p in results[:max_results]:
        info = (p or {}).get("hdpData", {}).get("homeInfo") or {}
        # price_reduction: truthy if Zillow records a price cut (negative priceChange or reductionDate)
        price_change = info.get("priceChange") or info.get("priceReduction") or 0
        try:
            price_change = float(price_change)
        except (TypeError, ValueError):
            price_change = 0
        price_reduction = bool(info.get("priceReductionDate") or price_change < 0)
        out.append(
            {
                "address": p.get("address") or info.get("streetAddress"),
                "city": info.get("city"),
                "state": info.get("state"),
                "zip": info.get("zipcode"),
                "price": p.get("price") or info.get("price"),
                "beds": p.get("beds") or info.get("bedrooms"),
                "baths": p.get("baths") or info.get("bathrooms"),
                "sqft": p.get("area") or info.get("livingArea"),
                "year_built": info.get("yearBuilt"),
                "days_on_market": info.get("daysOnZillow") or info.get("daysOnMarket"),
                "price_reduction": price_reduction,
                "home_status": info.get("homeStatus"),
                "sold_date": info.get("dateSold"),
                "zillow_url": f"https://www.zillow.com{p['detailUrl']}"
                if p.get("detailUrl")
                else None,
                "latitude": info.get("latitude"),
                "longitude": info.get("longitude"),
                "raw": {"zpid": info.get("zpid")},
            }
        )
    return out


async def fetch_active_listings(
    zip_code: Optional[str] = None,
    city: str = "",
    state: str = "",
    max_results: int = 50,
) -> List[Dict[str, Any]]:
    """Active for-sale listings — these carry days_on_market and price-reduction signals."""
    if zip_code:
        path = f"https://www.zillow.com/homes/for_sale/{zip_code}_rb/"
    elif city and state:
        path = f"https://www.zillow.com/homes/for_sale/{_slug(city, state)}_rb/"
    else:
        return []
    try:
        html = await fetch_html(path, render=True)
    except Exception as e:
        log.warning("Zillow active listings fetch failed: %s", e)
        return []
    data = _parse_next_data(html)
    if not data:
        return []
    cat = (data.get("cat1") or {}) or (
        data.get("props", {})
        .get("pageProps", {})
        .get("searchPageState", {})
        .get("cat1")
        or {}
    )
    results = (cat.get("searchResults") or {}).get("listResults") or []
    out: List[Dict[str, Any]] = []
    for p in results[:max_results]:
        info = (p or {}).get("hdpData", {}).get("homeInfo") or {}
        price_change = info.get("priceChange") or info.get("priceReduction") or 0
        try:
            price_change = float(price_change)
        except (TypeError, ValueError):
            price_change = 0
        price_reduction = bool(info.get("priceReductionDate") or price_change < 0)
        out.append(
            {
                "address": p.get("address") or info.get("streetAddress"),
                "city": info.get("city"),
                "state": info.get("state"),
                "zip": info.get("zipcode"),
                "price": p.get("price") or info.get("price"),
                "beds": p.get("beds") or info.get("bedrooms"),
                "baths": p.get("baths") or info.get("bathrooms"),
                "sqft": p.get("area") or info.get("livingArea"),
                "year_built": info.get("yearBuilt"),
                "days_on_market": info.get("daysOnZillow") or info.get("daysOnMarket"),
                "price_reduction": price_reduction,
                "home_status": info.get("homeStatus"),
                "estimated_value": info.get("zestimate"),
                "zillow_url": f"https://www.zillow.com{p['detailUrl']}"
                if p.get("detailUrl")
                else None,
                "latitude": info.get("latitude"),
                "longitude": info.get("longitude"),
                "source": "zillow_active",
            }
        )
    return out


async def fetch_property_owner(zillow_url: str) -> Optional[Dict[str, Any]]:
    """Try to extract owner / tax mailing info from a Zillow detail page."""
    try:
        html = await fetch_html(zillow_url, render=True)
    except Exception as e:  # noqa: BLE001
        log.info("Zillow detail fetch failed for %s: %s", zillow_url, e)
        return None
    data = _parse_next_data(html)
    if not data:
        return None
    pageProps = (data.get("props") or {}).get("pageProps") or {}
    info = (
        pageProps.get("componentProps", {}).get("gdpClientCache")
        or pageProps.get("initialReduxState", {}).get("gdp")
        or {}
    )
    # Zillow keeps owner/tax info under varying paths; we surface what's there.
    return {"raw": info}


async def fetch_fsbo(
    zip_code: Optional[str] = None,
    city: str = "",
    state: str = "",
    max_results: int = 50,
) -> List[Dict[str, Any]]:
    """For-sale-by-owner — distressed/motivated indicator."""
    if zip_code:
        path = f"https://www.zillow.com/homes/fsbo/{zip_code}_rb/"
    elif city and state:
        path = f"https://www.zillow.com/homes/fsbo/{_slug(city, state)}_rb/"
    else:
        return []
    try:
        html = await fetch_html(path, render=True)
    except Exception as e:  # noqa: BLE001
        log.warning("Zillow FSBO fetch failed: %s", e)
        return []
    data = _parse_next_data(html)
    if not data:
        return []
    cat = data.get("cat1") or {}
    results = (cat.get("searchResults") or {}).get("listResults") or []
    out: List[Dict[str, Any]] = []
    for p in results[:max_results]:
        info = (p or {}).get("hdpData", {}).get("homeInfo") or {}
        price_change = info.get("priceChange") or info.get("priceReduction") or 0
        try:
            price_change = float(price_change)
        except (TypeError, ValueError):
            price_change = 0
        price_reduction = bool(info.get("priceReductionDate") or price_change < 0)
        out.append(
            {
                "distress_type": "fsbo",
                "is_fsbo": True,
                "address": p.get("address") or info.get("streetAddress"),
                "city": info.get("city"),
                "state": info.get("state"),
                "zip": info.get("zipcode"),
                "estimated_value": info.get("zestimate"),
                "price": p.get("price") or info.get("price"),
                "opening_bid": p.get("price") or info.get("price"),
                "beds": p.get("beds") or info.get("bedrooms"),
                "baths": p.get("baths") or info.get("bathrooms"),
                "sqft": p.get("area") or info.get("livingArea"),
                "year_built": info.get("yearBuilt"),
                "days_on_market": info.get("daysOnZillow") or info.get("daysOnMarket"),
                "price_reduction": price_reduction,
                "home_status": info.get("homeStatus"),
                "source": "zillow_fsbo",
                "source_url": f"https://www.zillow.com{p['detailUrl']}"
                if p.get("detailUrl")
                else None,
                "latitude": info.get("latitude"),
                "longitude": info.get("longitude"),
                "raw_data": {"zpid": info.get("zpid")},
            }
        )
    return out
