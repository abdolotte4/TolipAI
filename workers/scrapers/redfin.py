"""Redfin scrapers — recently sold + active listings.

Redfin exposes a JSON API at /stingray/api/gis-csv that returns a CSV file
of search results.  Much friendlier than HTML scraping.
"""
from __future__ import annotations

import csv
import io
import logging
from typing import Any, Dict, List, Optional

from ..http_client import fetch_html

log = logging.getLogger("redfin")


async def _resolve_region(zip_code: Optional[str] = None,
                          city: str = "", state: str = "") -> Optional[Dict[str, Any]]:
    """Use Redfin's autocomplete to map ZIP/city → region_id + region_type."""
    q = zip_code or f"{city} {state}".strip()
    if not q:
        return None
    try:
        # Redfin's locationAutocomplete is JSON wrapped in {} preceded by `{}&&`
        url = f"https://www.redfin.com/stingray/do/location-autocomplete?location={q}&v=2"
        text = await fetch_html(url, render=False)
    except Exception as e:  # noqa: BLE001
        log.info("Redfin region lookup failed: %s", e)
        return None
    payload = text.split("&&", 1)[-1]
    try:
        import json as _json
        data = _json.loads(payload)
    except Exception:
        return None
    sections = data.get("payload", {}).get("sections") or []
    for sec in sections:
        rows = sec.get("rows") or []
        for row in rows:
            if row.get("id"):
                return {"region_id": str(row["id"]).split("_")[-1],
                        "region_type": row.get("type") or 6,
                        "name": row.get("name")}
    return None


async def _gis_csv(region_id: str, region_type: int, *, sold: bool = True,
                   max_results: int = 100) -> List[Dict[str, Any]]:
    base = "https://www.redfin.com/stingray/api/gis-csv"
    sf = "1,2,3,5,6,7" if sold else "1,2,3,5,6,7"
    sold_within = "&sold_within_days=180" if sold else ""
    url = (
        f"{base}?al=1&market=socal&num_homes={max_results}&ord=redfin-recommended-asc"
        f"&page_number=1&region_id={region_id}&region_type={region_type}"
        f"&sf={sf}&status=9{sold_within}&uipt=1,2,3,4,5,6,7,8&v=8"
    )
    try:
        text = await fetch_html(url, render=False)
    except Exception as e:  # noqa: BLE001
        log.warning("Redfin gis-csv failed: %s", e)
        return []
    # Redfin prefixes responses with `{}&&`
    if text.startswith("{}"):
        text = text.split("&&", 1)[-1]
    try:
        reader = csv.DictReader(io.StringIO(text))
        return list(reader)
    except Exception as e:  # noqa: BLE001
        log.warning("Redfin CSV parse failed: %s", e)
        return []


async def fetch_recently_sold(zip_code: Optional[str] = None, city: str = "",
                              state: str = "", max_results: int = 100) -> List[Dict[str, Any]]:
    region = await _resolve_region(zip_code=zip_code, city=city, state=state)
    if not region:
        return []
    rows = await _gis_csv(region["region_id"], region["region_type"],
                          sold=True, max_results=max_results)
    out: List[Dict[str, Any]] = []
    for r in rows:
        out.append({
            "address": r.get("ADDRESS"),
            "city": r.get("CITY"), "state": r.get("STATE OR PROVINCE"),
            "zip": r.get("ZIP OR POSTAL CODE"),
            "price": r.get("PRICE"),
            "beds": r.get("BEDS"), "baths": r.get("BATHS"),
            "sqft": r.get("SQUARE FEET"), "year_built": r.get("YEAR BUILT"),
            "sold_date": r.get("SOLD DATE"),
            "redfin_url": r.get("URL (SEE https://www.redfin.com/buy-a-home/comparative-market-analysis FOR INFO ON PRICING)") or r.get("URL"),
            "latitude": r.get("LATITUDE"), "longitude": r.get("LONGITUDE"),
        })
    return out
