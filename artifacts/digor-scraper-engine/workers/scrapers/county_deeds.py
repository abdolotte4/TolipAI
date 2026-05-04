"""Generic County deed-transfer scraper — real grantee (buyer) names."""

from __future__ import annotations
import json, logging, re
from datetime import date, timedelta
from typing import Any, Dict, List, Optional
from bs4 import BeautifulSoup
from ..http_client import fetch_html
from ..llm import _chat
from .ai_discover import discover_deed_source       # AI discovery module
from .distressed_sources import DEED_REGISTRY       # curated registry
from .pdf_utils import extract_text_from_pdf        # PDF parsing utility

log = logging.getLogger("county_deeds")

# ─── Normalised deed record ────────────────────────────────────────────────────
def _deed(grantor: str = "", grantee: str = "", address: str = "",
          city: str = "", state: str = "", zip_code: str = "",
          price: Optional[float] = None, date_str: str = "",
          parcel: str = "", source: str = "") -> Dict[str, Any]:
    return {
        "grantor": grantor, "grantee": grantee,
        "buyer_name": grantee, "seller_name": grantor,
        "address": address, "city": city, "state": state, "zip": zip_code,
        "price": price, "sold_date": date_str, "parcel_id": parcel, "source": source,
    }

def _safe_price(s: Any) -> Optional[float]:
    try:
        return float(re.sub(r"[,$\s]", "", str(s))) if s else None
    except Exception:
        return None

def _recent_date(days: int = 180) -> str:
    return (date.today() - timedelta(days=days)).strftime("%Y-%m-%d")

# ─── AI deed extractor ───────────────────────────────────────────────────────
async def _ai_extract_deeds(text: str, *, state: str, city: str,
                            zip_code: str = "", source: str) -> List[Dict[str, Any]]:
    if not text or len(text) < 100: return []
    sys_msg = (
        "Extract deed transfer records. Return JSON: "
        "{\"deeds\": [{\"grantee\":...,\"grantor\":...,\"address\":...,"
        "\"price\":...,\"date\":...,\"parcel\":...}]} Only actual transfers."
    )
    try:
        raw = await _chat([{"role":"system","content":sys_msg},
                           {"role":"user","content":f"State: {state}, City: {city}\n\n{text[:5000]}"}],
                          json_mode=True, max_tokens=1500, temperature=0.1)
        data = json.loads(raw)
        deeds = data.get("deeds") or []
        return [
            _deed(grantee=d.get("grantee",""), grantor=d.get("grantor",""),
                  address=d.get("address",""), city=city, state=state, zip_code=zip_code,
                  price=_safe_price(d.get("price")), date_str=d.get("date",""),
                  parcel=d.get("parcel",""), source=source)
            for d in deeds if d.get("grantee")
        ]
    except Exception as e:
        log.warning("AI deed extract failed: %s", str(e)[:120])
        return []

# ─── Generic fetcher ─────────────────────────────────────────────────────────
async def _fetch_deeds_from_url(url: str, *, state: str, city: str,
                                zip_code: str = "", source: str,
                                render: bool = True, max_results: int = 100) -> List[Dict[str, Any]]:
    """Fetch deeds from a given URL using AI extraction or PDF parsing."""
    try:
        html_or_bytes = await fetch_html(url, render=render)
    except Exception as e:
        log.warning("Fetch failed for %s: %s", url, str(e)[:120]); return []

    # Detect PDF responses
    if isinstance(html_or_bytes, (bytes, bytearray)) or url.lower().endswith(".pdf"):
        text = extract_text_from_pdf(html_or_bytes if isinstance(html_or_bytes, (bytes, bytearray)) else b"")
    else:
        soup = BeautifulSoup(html_or_bytes, "lxml")
        text = soup.get_text("\n", strip=True)[:8000]

    return await _ai_extract_deeds(text, state=state, city=city,
                                   zip_code=zip_code, source=source)

# ─── PropertyShark fallback ───────────────────────────────────────────────────
async def _propertyshark_deeds(city: str, state: str,
                               max_results: int = 100) -> List[Dict[str, Any]]:
    """Best-effort PropertyShark public search for recent deed transfers."""
    slug = f"{city.lower().replace(' ', '-')}-{state.lower()}"
    url = f"https://www.propertyshark.com/Real-Estate-Reports/deed-transfers/{slug}/"
    try:
        html = await fetch_html(url, render=False)
        soup = BeautifulSoup(html, "lxml")
        text = soup.get_text("\n", strip=True)[:8000]
        return await _ai_extract_deeds(text, state=state, city=city,
                                       source=f"propertyshark_{slug}")
    except Exception as e:
        log.debug("PropertyShark fallback failed for %s, %s: %s", city, state, str(e)[:120])
        return []


# ─── Public entrypoint ────────────────────────────────────────────────────────
async def fetch_recent_deeds(
    *,
    state: str,
    city: str = "",
    county: str = "",
    zip_code: str = "",
    max_results: int = 100,
) -> List[Dict[str, Any]]:
    """
    Fetch recent deed transfers for a given area.

    Workflow:
      1. Check curated registry (DEED_REGISTRY).
      2. If missing, call AI discovery to find source URL.
      3. Scrape with Crawl4AI + AI extraction.
      4. Fallback: PropertyShark if city/state supported.
    """
    state = state.upper().strip()
    city_key = (city or county or "").lower().strip()
    county_key = county.lower().strip() if county else city_key

    # 1. Registry lookup
    source_url = DEED_REGISTRY.get((state, county_key)) or DEED_REGISTRY.get((state, city_key))
    if source_url:
        results = await _fetch_deeds_from_url(source_url, state=state, city=city or county,
                                              zip_code=zip_code, source=f"{state}_{county_key}",
                                              max_results=max_results)
        if results:
            log.info("Registry deeds (%s/%s): %d records", state, county_key, len(results))
            return results

    # 2. AI discovery
    discovered_url = await discover_deed_source(state=state, county=county, city=city)
    if discovered_url:
        results = await _fetch_deeds_from_url(discovered_url, state=state, city=city or county,
                                              zip_code=zip_code, source=f"{state}_{county_key}_discover",
                                              max_results=max_results)
        if results:
            log.info("AI-discovered deeds (%s/%s): %d records", state, county_key, len(results))
            return results

    # 3. PropertyShark fallback
    if city:
        results = await _propertyshark_deeds(city, state, max_results)
        if results:
            log.info("PropertyShark deeds (%s, %s): %d records", city, state, len(results))
            return results

    log.warning("No deed handler for %s/%s — returning empty", state, county_key)
    return []
