"""Redfin scrapers — recently sold + active listings.

Redfin exposes a JSON API at /stingray/api/gis-csv that returns a CSV file
of search results. Much friendlier than HTML scraping.
"""

from __future__ import annotations

import csv
import io
import json as _json
import logging
from typing import Any, Dict, List, Optional

from ..http_client import fetch_html

log = logging.getLogger("redfin")


async def _resolve_region(
    zip_code: Optional[str] = None, city: str = "", state: str = "", retries: int = 2
) -> Optional[Dict[str, Any]]:
    """Use Redfin's autocomplete to map ZIP/city → region_id + region_type."""
    q = zip_code or f"{city} {state}".strip()
    if not q:
        return None
    url = f"https://www.redfin.com/stingray/do/location-autocomplete?location={q}&v=2"
    for attempt in range(retries):
        try:
            text = await fetch_html(url, render=False)
            payload = text.split("&&", 1)[-1]
            data = _json.loads(payload)
            sections = data.get("payload", {}).get("sections") or []
            for sec in sections:
                for row in sec.get("rows") or []:
                    if row.get("id"):
                        return {
                            "region_id": str(row["id"]).split("_")[-1],
                            "region_type": row.get("type") or 6,
                            "name": row.get("name"),
                        }
        except Exception as e:
            log.warning("Redfin region lookup attempt %d failed: %s", attempt + 1, str(e)[:120])
    return None


async def _gis_csv(
    region_id: str,
    region_type: int,
    *,
    sold: bool = True,
    max_results: int = 100,
    market: str = "na",
    sold_within_days: int = 180,
) -> List[Dict[str, Any]]:
    """Fetch Redfin GIS CSV for a region."""
    base = "https://www.redfin.com/stingray/api/gis-csv"
    sf = "6,9" if sold else "1,2,3,5,7"
    sold_within = f"&sold_within_days={sold_within_days}" if sold else ""
    url = (
        f"{base}?al=1&market={market}&num_homes={max_results}&ord=redfin-recommended-asc"
        f"&page_number=1&region_id={region_id}&region_type={region_type}"
        f"&sf={sf}&status=9{sold_within}&uipt=1,2,3,4,5,6,7,8&v=8"
    )
    try:
        text = await fetch_html(url, render=False)
    except Exception as e:
        log.error("Redfin gis-csv fetch failed: %s", str(e)[:120])
        return []
    if text.startswith("{}"):
        text = text.split("&&", 1)[-1]
    try:
        reader = csv.DictReader(io.StringIO(text))
        return list(reader)
    except Exception as e:
        log.error("Redfin CSV parse failed: %s", str(e)[:120])
        return []


async def fetch_recently_sold(
    zip_code: Optional[str] = None,
    city: str = "",
    state: str = "",
    max_results: int = 100,
    market: str = "na",
    sold_within_days: int = 180,
) -> List[Dict[str, Any]]:
    """Fetch recently sold properties from Redfin."""
    region = await _resolve_region(zip_code=zip_code, city=city, state=state)
    if not region:
        return []
    rows = await _gis_csv(
        region["region_id"],
        region["region_type"],
        sold=True,
        max_results=max_results,
        market=market,
        sold_within_days=sold_within_days,
    )
    out: List[Dict[str, Any]] = []
    for r in rows:
        price_str = r.get("PRICE") or ""
        orig_str = r.get("ORIGINAL LIST PRICE") or ""
        try:
            price_cut = float(str(price_str).replace("$", "").replace(",", "") or 0) < float(
                str(orig_str).replace("$", "").replace(",", "") or 0
            )
        except (TypeError, ValueError):
            price_cut = False
        try:
            lat_raw = r.get("LATITUDE")
            lon_raw = r.get("LONGITUDE")
            lat = float(str(lat_raw)) if lat_raw is not None else None
            lon = float(str(lon_raw)) if lon_raw is not None else None
        except ValueError:
            lat, lon = None, None
        out.append(
            {
                "address": r.get("ADDRESS"),
                "city": r.get("CITY"),
                "state": r.get("STATE OR PROVINCE"),
                "zip": r.get("ZIP OR POSTAL CODE"),
                "price": price_str,
                "beds": r.get("BEDS"),
                "baths": r.get("BATHS"),
                "sqft": r.get("SQUARE FEET"),
                "year_built": r.get("YEAR BUILT"),
                "days_on_market": r.get("DAYS ON MARKET") or r.get("DOM"),
                "price_reduction": price_cut,
                "sold_date": r.get("SOLD DATE"),
                "redfin_url": r.get("URL")
                or r.get(
                    "URL (SEE https://www.redfin.com/buy-a-home/comparative-market-analysis FOR INFO ON PRICING)"
                ),
                "latitude": lat,
                "longitude": lon,
            }
        )
    return out
