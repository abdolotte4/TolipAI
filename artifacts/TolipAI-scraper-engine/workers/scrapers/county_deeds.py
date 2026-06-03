"""County deed-transfer scraper — real grantee (buyer) names.

Fetches recent deed transfers from the curated DEED_REGISTRY only.
No AI extraction, no AI URL discovery, no fallback guessing.

If a state/county is not in the registry, this function returns [] and logs
"Source not implemented" — the caller should set status = completed_no_results.

To add a new county:
  1. Verify the source URL returns a real HTML table with grantee names
  2. Add it to DEED_REGISTRY in distressed_sources.py
  3. Optionally add a dedicated county scraper to scrapers/counties/
  4. Write a test in tests/test_counties.py

AUDIT COMPLIANCE:
  Removed:
    ✗ _ai_extract_deeds()     — was feeding raw HTML to LLM to hallucinate deed records
    ✗ _propertyshark_deeds()  — was scraping a paid aggregator + LLM extraction
    ✗ discover_deed_source()  — AI URL hallucination
"""

from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from bs4 import BeautifulSoup

from ..http_client import fetch_html
from .distressed_sources import DEED_REGISTRY

log = logging.getLogger("county_deeds")


# ─── Normalised deed record ────────────────────────────────────────────────────
def _deed(
    grantor: str = "",
    grantee: str = "",
    address: str = "",
    city: str = "",
    state: str = "",
    zip_code: str = "",
    price: Optional[float] = None,
    date_str: str = "",
    parcel: str = "",
    source: str = "",
) -> Dict[str, Any]:
    return {
        "grantor": grantor,
        "grantee": grantee,
        "buyer_name": grantee,
        "seller_name": grantor,
        "address": address,
        "city": city,
        "state": state,
        "zip": zip_code,
        "price": price,
        "sold_date": date_str,
        "parcel_id": parcel,
        "source": source,
    }


def _safe_price(s: Any) -> Optional[float]:
    try:
        return float(re.sub(r"[,$\s]", "", str(s))) if s else None
    except Exception:
        return None


def _recent_date(days: int = 180) -> str:
    return (date.today() - timedelta(days=days)).strftime("%Y-%m-%d")


def _parse_deed_table(html: str, *, state: str, city: str, zip_code: str = "", source: str) -> List[Dict[str, Any]]:
    """Parse a deed-transfer HTML table into normalised deed records.
    Uses BeautifulSoup with heuristic column matching — no LLM required.
    """
    soup = BeautifulSoup(html, "lxml")
    tables = soup.find_all("table")
    if not tables:
        return []

    deeds: List[Dict[str, Any]] = []

    for table in tables:
        headers_raw = [th.get_text(strip=True).lower() for th in table.find_all("th")]
        if not headers_raw:
            first_row = table.find("tr")
            if first_row:
                headers_raw = [td.get_text(strip=True).lower() for td in first_row.find_all("td")]

        if not headers_raw:
            continue

        # Heuristic column mapping
        grantee_col = next(
            (i for i, h in enumerate(headers_raw) if any(k in h for k in ("grantee", "buyer", "purchaser", "owner"))),
            None,
        )
        grantor_col = next(
            (i for i, h in enumerate(headers_raw) if any(k in h for k in ("grantor", "seller", "granto"))),
            None,
        )
        address_col = next(
            (i for i, h in enumerate(headers_raw) if any(k in h for k in ("address", "situs", "location", "property"))),
            None,
        )
        price_col = next(
            (i for i, h in enumerate(headers_raw) if any(k in h for k in ("price", "amount", "consideration", "sale_price", "sold"))),
            None,
        )
        date_col = next(
            (i for i, h in enumerate(headers_raw) if any(k in h for k in ("date", "recorded", "filed", "transfer"))),
            None,
        )
        parcel_col = next(
            (i for i, h in enumerate(headers_raw) if any(k in h for k in ("parcel", "apn", "pin", "account"))),
            None,
        )

        if grantee_col is None and address_col is None:
            continue  # not a deed table

        rows = table.find_all("tr")[1:]  # skip header row
        for tr in rows:
            cells = [td.get_text(strip=True) for td in tr.find_all("td")]
            if not cells:
                continue

            def cell(idx: Optional[int]) -> str:
                return cells[idx].strip() if idx is not None and idx < len(cells) else ""

            grantee = cell(grantee_col)
            if not grantee:
                continue  # need a buyer name

            deeds.append(_deed(
                grantee=grantee,
                grantor=cell(grantor_col),
                address=cell(address_col),
                city=city,
                state=state,
                zip_code=zip_code,
                price=_safe_price(cell(price_col)),
                date_str=cell(date_col),
                parcel=cell(parcel_col),
                source=source,
            ))

    return deeds


# ─── Public entrypoint ────────────────────────────────────────────────────────
async def fetch_recent_deeds(
    *,
    state: str,
    city: str = "",
    county: str = "",
    zip_code: str = "",
    max_results: int = 100,
) -> List[Dict[str, Any]]:
    """Fetch recent deed transfers for a given area from the curated registry.

    Returns [] if the state/county is not in the registry.
    No AI discovery, no LLM extraction — registry + structured HTML parsing only.
    """
    state = state.upper().strip()
    city_key = (city or county or "").lower().strip()
    county_key = county.lower().strip() if county else city_key

    # Registry lookup only
    source_url = DEED_REGISTRY.get((state, county_key)) or DEED_REGISTRY.get((state, city_key))

    if not source_url:
        log.info(
            "Source not implemented for %s/%s — no entry in DEED_REGISTRY. "
            "To add this county, verify the URL and add it to distressed_sources.DEED_REGISTRY.",
            state,
            county_key or city_key,
        )
        return []

    # Fetch and parse
    try:
        html = await fetch_html(source_url, render=False)
    except Exception as e:
        log.warning("Fetch failed for %s: %s", source_url, str(e)[:120])
        return []

    if isinstance(html, (bytes, bytearray)):
        log.info("Deed source %s returned PDF/binary — skipping (add PDF parser to handle)", source_url)
        return []

    results = _parse_deed_table(
        html,
        state=state,
        city=city or county,
        zip_code=zip_code,
        source=f"{state}_{county_key}",
    )

    if results:
        log.info("Registry deeds (%s/%s): %d records from %s", state, county_key, len(results), source_url)
    else:
        log.info(
            "Registry deed source %s returned no parseable rows — "
            "the site structure may have changed. Inspect and update _parse_deed_table().",
            source_url,
        )

    return results[:max_results]
