"""ATTOM Data API client (paid, used as PRIMARY when credits remain).

Used for high-quality cash-buyer/owner data.  When credits are exhausted
(402/403 with "credits"/"quota"), the orchestrator transparently falls
back to the free scraping path (Zillow/Redfin + recorder).

Endpoints we use:
  • /property/snapshot       — recently-sold properties in a ZIP
  • /transaction/saleshistory— per-property sale history (LLC + buyer name)
  • /property/expandedprofile— owner mailing address (proxy for "investor")
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx

from ..config import settings

log = logging.getLogger("attom")

ATTOM_BASE = "https://api.gateway.attomdata.com/propertyapi/v1.0.0"


class AttomExhausted(Exception):
    """Raised when every ATTOM key has run out of credits."""


def _attom_keys() -> List[str]:
    seen: set = set()
    keys = []
    for k in (settings.attom_keys or []) + (settings.property_api_keys or []):
        if k and k not in seen:
            seen.add(k)
            keys.append(k)
    return keys


async def _get(path: str, params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    keys = _attom_keys()
    if not keys:
        return None
    last_err: Optional[Exception] = None
    async with httpx.AsyncClient(timeout=30) as cli:
        for key in keys:
            try:
                r = await cli.get(
                    f"{ATTOM_BASE}{path}",
                    params=params,
                    headers={"apikey": key, "Accept": "application/json"},
                )
                if r.status_code == 200:
                    return r.json()
                txt = r.text.lower()
                if r.status_code in (402, 403) and ("credit" in txt or "quota" in txt):
                    log.warning("ATTOM key …%s exhausted", key[-6:])
                    continue
                if r.status_code == 401:
                    continue
                last_err = RuntimeError(f"ATTOM {r.status_code}: {r.text[:200]}")
            except httpx.HTTPError as e:
                last_err = e
                continue
    if last_err:
        log.info("ATTOM call failed: %s", last_err)
    raise AttomExhausted("All ATTOM keys exhausted or invalid")


async def recent_sales(
    *, zip_code: str = "", city: str = "", state: str = "", max_results: int = 50
) -> List[Dict[str, Any]]:
    """Return recently-sold properties in a ZIP, normalized to our shape."""
    params: Dict[str, Any] = {"pagesize": min(max_results, 100), "page": 1}
    if zip_code:
        params["postalcode"] = zip_code
    elif city and state:
        params["address1"] = ""
        params["citystatezip"] = f"{city}, {state}"
    try:
        data = await _get("/sale/snapshot", params)
    except AttomExhausted:
        return []
    if not data:
        return []
    out: List[Dict[str, Any]] = []
    for row in (data.get("sale") or [])[:max_results]:
        addr = row.get("address") or {}
        sale = row.get("sale") or {}
        amount = sale.get("amount") or {}
        out.append(
            {
                "address": addr.get("oneLine"),
                "city": addr.get("locality"),
                "state": addr.get("countrySubd"),
                "zip": addr.get("postal1"),
                "price": amount.get("saleamt"),
                "sold_date": sale.get("salesearchdate") or sale.get("saletransdate"),
                "owner_name": (row.get("owner") or {}).get("owner1"),
                "buyer_name": (row.get("owner") or {}).get("owner1"),
                "beds": (row.get("building") or {}).get("rooms", {}).get("beds"),
                "baths": (row.get("building") or {}).get("rooms", {}).get("bathstotal"),
                "sqft": (row.get("building") or {}).get("size", {}).get("livingsize"),
                "source": "attom",
            }
        )
    log.info("ATTOM returned %d recent sales for ZIP=%s", len(out), zip_code)
    return out


async def owner_for_property(address: str, zip_code: str) -> Optional[Dict[str, Any]]:
    """Get the owner / mailing address for a property — used to flag investors."""
    try:
        data = await _get(
            "/property/expandedprofile", {"address1": address, "address2": zip_code}
        )
    except AttomExhausted:
        return None
    if not data:
        return None
    rows = data.get("property") or []
    if not rows:
        return None
    p = rows[0]
    owner = p.get("owner") or {}
    mailing = owner.get("mailingaddressoneline") or ""
    addr = (p.get("address") or {}).get("oneLine") or ""
    return {
        "owner_name": owner.get("owner1") or owner.get("owner1full"),
        "mailing_addr": mailing,
        "is_investor": bool(mailing)
        and mailing.strip().lower() != addr.strip().lower(),
        "source": "attom",
    }
