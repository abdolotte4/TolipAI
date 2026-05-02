"""County deed-transfer scraper — real grantee (buyer) names from public records.

Fetches actual deed/transfer records so cash_buyers.py can return real
investor names instead of synthetic "unknown::zip::address" keys.

Supported sources (all free, no auth):
  OH  — Cuyahoga County Fiscal Officer transfer records (JSON API)
  OH  — Summit County (Akron) transfer search
  NC  — Cumberland County ROD (Fayetteville) via ncodr.com
  NC  — Wake County ROD (Raleigh)
  TX  — Harris County (Houston) HCAD sales search
  FL  — Orange County Comptroller official records
  GA  — Georgia Superior Court Clerks (GSCCCA) deed search
  *   — PropertyShark free deed search (fallback)

For any county not explicitly listed, we use the AI-powered
`ai_discover` path to find the right URL and scrape it.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from bs4 import BeautifulSoup

from ..http_client import fetch_html
from ..llm import _chat

log = logging.getLogger("county_deeds")


# ─── Normalised deed record ────────────────────────────────────────────────────
def _deed(grantor: str = "", grantee: str = "", address: str = "",
          city: str = "", state: str = "", zip_code: str = "",
          price: Optional[float] = None, date_str: str = "",
          parcel: str = "", source: str = "") -> Dict[str, Any]:
    return {
        "grantor":  grantor,
        "grantee":  grantee,
        "buyer_name": grantee,
        "seller_name": grantor,
        "address":  address,
        "city":     city,
        "state":    state,
        "zip":      zip_code,
        "price":    price,
        "sold_date": date_str,
        "parcel_id": parcel,
        "source":   source,
    }


def _safe_price(s: Any) -> Optional[float]:
    if s is None:
        return None
    try:
        return float(re.sub(r"[,$\s]", "", str(s)))
    except (ValueError, TypeError):
        return None


def _recent_date(days: int = 180) -> str:
    return (date.today() - timedelta(days=days)).strftime("%Y-%m-%d")


# ─── Cuyahoga County OH (Fiscal Officer JSON API) ─────────────────────────────

async def _cuyahoga_transfers(zip_code: str = "", max_results: int = 100) -> List[Dict[str, Any]]:
    """Cuyahoga County Fiscal Officer — transfer records (grantee = buyer name)."""
    # Auditor/Fiscal Officer — confirmed live at auditor.cuyahogacounty.us (200 OK).
    # fiscal.cuyahogacounty.us has DNS issues; auditor subdomain is canonical.
    base = "https://auditor.cuyahogacounty.us"
    search_url = (
        f"{base}/en-US/property-search.aspx"
        f"?q={zip_code or 'Cleveland'}&searchType=address&page=1&pageSize={min(max_results, 100)}"
    )
    try:
        html = await fetch_html(search_url, render=False)
    except Exception as e:
        log.info("Cuyahoga fiscal search failed: %s", e)
        return []

    # Try to parse JSON embedded in the page
    try:
        data = json.loads(html)
        records = data.get("data") or data.get("results") or []
        if isinstance(records, list):
            out = []
            for r in records[:max_results]:
                out.append(_deed(
                    grantee=r.get("ownerName") or r.get("grantee") or "",
                    grantor=r.get("previousOwner") or r.get("grantor") or "",
                    address=r.get("address") or r.get("propertyAddress") or "",
                    city=r.get("city") or "Cleveland",
                    state="OH",
                    zip_code=r.get("zip") or r.get("postalCode") or zip_code,
                    price=_safe_price(r.get("transferAmount") or r.get("salePrice")),
                    date_str=r.get("transferDate") or r.get("saleDate") or "",
                    parcel=r.get("parcelNumber") or r.get("parcelId") or "",
                    source="cuyahoga_fiscal",
                ))
            if out:
                log.info("Cuyahoga fiscal: %d transfer records", len(out))
                return out
    except (json.JSONDecodeError, TypeError):
        pass

    # HTML fallback — parse the transfer table
    soup = BeautifulSoup(html, "lxml")
    rows = soup.select("table tr, .result-row, .transfer-row")
    out = []
    for row in rows[1:max_results + 1]:
        cells = [td.get_text(strip=True) for td in row.find_all(["td", "div"])]
        if len(cells) < 3:
            continue
        out.append(_deed(
            grantee=cells[0] if cells else "",
            address=cells[1] if len(cells) > 1 else "",
            price=_safe_price(cells[2] if len(cells) > 2 else None),
            state="OH", city="Cleveland", zip_code=zip_code,
            source="cuyahoga_fiscal_html",
        ))
    return out


async def _cuyahoga_sheriff_sales(max_results: int = 50) -> List[Dict[str, Any]]:
    """Cuyahoga County Sheriff Sale auction — pending foreclosures."""
    url = "https://cuyahoga.sheriffsaleauction.ohio.gov/index.cfm?zaction=AUCTION&Zmethod=PREVIEW"
    try:
        html = await fetch_html(url, render=True)
    except Exception as e:
        log.info("Cuyahoga sheriff sale failed: %s", e)
        return []

    soup = BeautifulSoup(html, "lxml")
    out = []
    for item in soup.select(".AUCTION_ITEM, .item-container, tr[class*='auction']")[:max_results]:
        text = item.get_text(" ", strip=True)
        addr_m = re.search(r"\d+\s+[A-Z][A-Za-z\s]+(?:St|Ave|Blvd|Dr|Rd|Ln|Ct|Way|Pl)[^,]*,?\s*\w+", text)
        price_m = re.search(r"\$[\d,]+", text)
        case_m = re.search(r"Case\s*#?:?\s*([\w-]+)", text, re.IGNORECASE)
        out.append(_deed(
            address=addr_m.group(0).strip() if addr_m else "",
            price=_safe_price(price_m.group(0) if price_m else None),
            parcel=case_m.group(1) if case_m else "",
            state="OH", city="Cleveland",
            source="cuyahoga_sheriff",
        ))
    return [r for r in out if r["address"]]


# ─── NC Cumberland County (Fayetteville) ROD ─────────────────────────────────

async def _nc_cumberland_deeds(zip_code: str = "", max_results: int = 80) -> List[Dict[str, Any]]:
    """Cumberland County NC Register of Deeds — cash deed transfers."""
    # NC provides a statewide ROD search via ncodr.com
    # Cumberland County instrument search
    base_url = "https://rodweb.cumberlandcountync.gov/RodWeb/search.do"
    search_url = f"{base_url}?searchType=REWRITE_INSTRUMENT&indexName=REWRITE_INSTRUMENT&party2Name=&party1Name=&docTypeCode=WD&startDate={_recent_date(180)}&endDate={date.today().isoformat()}&pageSize={min(max_results, 50)}&indexDisplayName=DOCUMENT+INDEX"
    try:
        html = await fetch_html(search_url, render=False)
    except Exception as e:
        log.info("Cumberland County ROD search failed: %s", e)
        return []

    soup = BeautifulSoup(html, "lxml")
    out = []
    for row in soup.select("table tr")[1:max_results + 1]:
        cells = [td.get_text(strip=True) for td in row.find_all("td")]
        if len(cells) < 4:
            continue
        out.append(_deed(
            grantor=cells[0] if cells else "",
            grantee=cells[1] if len(cells) > 1 else "",
            date_str=cells[2] if len(cells) > 2 else "",
            price=_safe_price(cells[3] if len(cells) > 3 else None),
            state="NC", city="Fayetteville",
            zip_code=zip_code,
            source="cumberland_nc_rod",
        ))
    if out:
        return out

    # AI fallback — extract from page text
    text = soup.get_text("\n", strip=True)[:6000]
    return await _ai_extract_deeds(text, state="NC", city="Fayetteville",
                                   zip_code=zip_code, source="cumberland_nc_rod")


async def _nc_wake_deeds(zip_code: str = "", max_results: int = 80) -> List[Dict[str, Any]]:
    """Wake County NC ROD — Raleigh area deed transfers."""
    url = (
        "https://services.wakegov.com/realestate/SearchDeed.asp"
        f"?sttype=WD&sdate={_recent_date(180).replace('-', '/')}&edate={date.today().strftime('%m/%d/%Y')}"
        f"&maxrec={min(max_results, 100)}"
    )
    try:
        html = await fetch_html(url, render=False)
    except Exception as e:
        log.info("Wake County ROD failed: %s", e)
        return []

    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text("\n", strip=True)[:7000]
    return await _ai_extract_deeds(text, state="NC", city="Raleigh",
                                   zip_code=zip_code, source="wake_nc_rod")


# ─── Texas Harris County (Houston) ───────────────────────────────────────────

async def _harris_tx_deeds(zip_code: str = "", max_results: int = 80) -> List[Dict[str, Any]]:
    """Harris County TX HCAD recent sales — grantor/grantee exposed."""
    url = (
        f"https://hcad.org/hcad-resources/hcad-appraisal-codes-and-definitions/real-estate-transaction-data/"
    )
    try:
        html = await fetch_html(url, render=False)
    except Exception as e:
        log.info("Harris County HCAD deeds failed: %s", e)
        return []

    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text("\n", strip=True)[:7000]
    return await _ai_extract_deeds(text, state="TX", city="Houston",
                                   zip_code=zip_code, source="harris_hcad")


# ─── Generic AI deed extractor ─────────────────────────────────────────────────

async def _ai_extract_deeds(text: str, *, state: str, city: str,
                            zip_code: str = "", source: str) -> List[Dict[str, Any]]:
    """Ask LLM to extract deed records from raw page text."""
    if not text or len(text) < 100:
        return []
    sys_msg = (
        "You extract real estate deed transfer records from text. "
        "Return STRICTLY JSON: {\"deeds\": [{\"grantee\": \"buyer name or LLC\", "
        "\"grantor\": \"seller name\", \"address\": \"property address\", "
        "\"price\": number_or_null, \"date\": \"YYYY-MM-DD or empty\", "
        "\"parcel\": \"parcel id or empty\"}]}. "
        "Extract only actual property deed transfers. "
        "Empty grantee means skip that record."
    )
    try:
        raw = await _chat(
            [{"role": "system", "content": sys_msg},
             {"role": "user", "content": f"State: {state}, City: {city}\n\n{text[:5000]}"}],
            json_mode=True, max_tokens=1500, temperature=0.1,
        )
        data = json.loads(raw)
        deeds = data.get("deeds") or []
        return [
            _deed(
                grantee=d.get("grantee") or "",
                grantor=d.get("grantor") or "",
                address=d.get("address") or "",
                city=city, state=state, zip_code=zip_code,
                price=_safe_price(d.get("price")),
                date_str=d.get("date") or "",
                parcel=d.get("parcel") or "",
                source=source,
            )
            for d in deeds
            if d.get("grantee")
        ]
    except Exception as e:
        log.info("AI deed extract failed: %s", e)
        return []


# ─── PropertyShark free deed search (generic fallback) ────────────────────────

async def _propertyshark_deeds(city: str, state: str, max_results: int = 50) -> List[Dict[str, Any]]:
    """PropertyShark public deed search — works for most US counties."""
    city_slug = city.lower().replace(" ", "-")
    state_slug = state.lower()
    url = f"https://www.propertyshark.com/Real-Estate-Reports/{state_slug}/{city_slug}/recent-home-sales.html"
    try:
        html = await fetch_html(url, render=False)
    except Exception as e:
        log.info("PropertyShark deed search failed for %s, %s: %s", city, state, e)
        return []

    soup = BeautifulSoup(html, "lxml")
    out = []
    for row in soup.select("table tr, .listing-row")[:max_results]:
        cells = [td.get_text(strip=True) for td in row.find_all(["td", "div"])]
        if len(cells) < 3:
            continue
        addr_cell = cells[0] if cells else ""
        buyer_cell = cells[2] if len(cells) > 2 else ""
        price_cell = cells[3] if len(cells) > 3 else ""
        if not addr_cell:
            continue
        out.append(_deed(
            grantee=buyer_cell,
            address=addr_cell,
            price=_safe_price(price_cell),
            city=city, state=state,
            source="propertyshark",
        ))
    return out


# ─── Public entrypoint ────────────────────────────────────────────────────────

async def _fl_orange_deeds(zip_code: str = "", max_results: int = 80) -> List[Dict[str, Any]]:
    """Orange County FL Comptroller official records — recent warranty deeds (buyer names)."""
    url = (
        "https://or.occompt.com/recorder/eagleweb/docIndex.jsp"
        "?displayCount=50&searchType=documentType&documentType=WD"
        f"&startDate={_recent_date(180)}&endDate={date.today().isoformat()}"
    )
    try:
        html = await fetch_html(url, render=True)
    except Exception as e:
        log.info("Orange County FL deed search failed: %s", e)
        return []
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text("\n", strip=True)[:8000]
    return await _ai_extract_deeds(text, state="FL", city="Orlando",
                                   zip_code=zip_code, source="fl_orange_comptroller")


async def _fl_miami_dade_deeds(zip_code: str = "", max_results: int = 80) -> List[Dict[str, Any]]:
    """Miami-Dade County FL Clerk official records — recent deed transfers."""
    url = (
        "https://www2.miami-dadeclerk.com/ocs/Search.aspx"
        f"?QS=doctype%3DWD%26daterange%3D{_recent_date(180).replace('-', '%2F')}%7E{date.today().strftime('%m/%d/%Y').replace('/', '%2F')}"
    )
    try:
        html = await fetch_html(url, render=True)
    except Exception as e:
        log.info("Miami-Dade deed search failed: %s", e)
        return []
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text("\n", strip=True)[:8000]
    return await _ai_extract_deeds(text, state="FL", city="Miami",
                                   zip_code=zip_code, source="fl_miami_dade_clerk")


async def _fl_hillsborough_deeds(zip_code: str = "", max_results: int = 80) -> List[Dict[str, Any]]:
    """Hillsborough County FL (Tampa) official records — warranty deed transfers."""
    url = "https://pubrec2.hillsclerk.com/pubrec/docIndex.jsp?searchType=documentType&documentType=WD&displayCount=50"
    try:
        html = await fetch_html(url, render=True)
    except Exception as e:
        log.info("Hillsborough County deed search failed: %s", e)
        return []
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text("\n", strip=True)[:8000]
    return await _ai_extract_deeds(text, state="FL", city="Tampa",
                                   zip_code=zip_code, source="fl_hillsborough_clerk")


async def _ga_fulton_deeds(zip_code: str = "", max_results: int = 80) -> List[Dict[str, Any]]:
    """Fulton County GA (Atlanta) — GSCCCA deed index search for recent warranty deeds."""
    url = (
        "https://search.gsccca.org/RealEstate/index.asp"
        f"?County=60&DocType=WD&FromDate={_recent_date(180)}&ToDate={date.today().isoformat()}"
        f"&PageSize={min(max_results, 50)}"
    )
    try:
        html = await fetch_html(url, render=True)
    except Exception as e:
        log.info("GSCCCA Fulton County deed search failed: %s", e)
        return []
    soup = BeautifulSoup(html, "lxml")
    rows = soup.select("table tr")[1:max_results + 1]
    out: List[Dict[str, Any]] = []
    for row in rows:
        cells = [td.get_text(strip=True) for td in row.find_all("td")]
        if len(cells) < 4:
            continue
        out.append(_deed(
            grantor=cells[2] if len(cells) > 2 else "",
            grantee=cells[3] if len(cells) > 3 else "",
            date_str=cells[1] if len(cells) > 1 else "",
            state="GA", city="Atlanta", zip_code=zip_code,
            source="gsccca_fulton",
        ))
    if out:
        return [r for r in out if r["grantee"]]
    text = soup.get_text("\n", strip=True)[:8000]
    return await _ai_extract_deeds(text, state="GA", city="Atlanta",
                                   zip_code=zip_code, source="gsccca_fulton")


async def _ga_dekalb_deeds(zip_code: str = "", max_results: int = 80) -> List[Dict[str, Any]]:
    """DeKalb County GA (Atlanta suburb) — Superior Court deed index."""
    url = (
        "https://search.gsccca.org/RealEstate/index.asp"
        f"?County=44&DocType=WD&FromDate={_recent_date(180)}&ToDate={date.today().isoformat()}"
        f"&PageSize={min(max_results, 50)}"
    )
    try:
        html = await fetch_html(url, render=True)
    except Exception as e:
        log.info("GSCCCA DeKalb County deed search failed: %s", e)
        return []
    soup = BeautifulSoup(html, "lxml")
    rows = soup.select("table tr")[1:max_results + 1]
    out: List[Dict[str, Any]] = []
    for row in rows:
        cells = [td.get_text(strip=True) for td in row.find_all("td")]
        if len(cells) < 4:
            continue
        out.append(_deed(
            grantor=cells[2] if len(cells) > 2 else "",
            grantee=cells[3] if len(cells) > 3 else "",
            date_str=cells[1] if len(cells) > 1 else "",
            state="GA", city="Atlanta", zip_code=zip_code,
            source="gsccca_dekalb",
        ))
    if out:
        return [r for r in out if r["grantee"]]
    text = soup.get_text("\n", strip=True)[:8000]
    return await _ai_extract_deeds(text, state="GA", city="Atlanta",
                                   zip_code=zip_code, source="gsccca_dekalb")


COUNTY_DISPATCH = {
    # OH
    ("OH", "cuyahoga"):  lambda zip_code, n: _cuyahoga_transfers(zip_code, n),
    ("OH", "cleveland"): lambda zip_code, n: _cuyahoga_transfers(zip_code, n),
    # NC
    ("NC", "cumberland"):  lambda zip_code, n: _nc_cumberland_deeds(zip_code, n),
    ("NC", "fayetteville"): lambda zip_code, n: _nc_cumberland_deeds(zip_code, n),
    ("NC", "wake"):  lambda zip_code, n: _nc_wake_deeds(zip_code, n),
    ("NC", "raleigh"): lambda zip_code, n: _nc_wake_deeds(zip_code, n),
    # TX
    ("TX", "harris"):  lambda zip_code, n: _harris_tx_deeds(zip_code, n),
    ("TX", "houston"): lambda zip_code, n: _harris_tx_deeds(zip_code, n),
    # FL
    ("FL", "orange"):   lambda zip_code, n: _fl_orange_deeds(zip_code, n),
    ("FL", "orlando"):  lambda zip_code, n: _fl_orange_deeds(zip_code, n),
    ("FL", "miami"):    lambda zip_code, n: _fl_miami_dade_deeds(zip_code, n),
    ("FL", "miami-dade"): lambda zip_code, n: _fl_miami_dade_deeds(zip_code, n),
    ("FL", "hillsborough"): lambda zip_code, n: _fl_hillsborough_deeds(zip_code, n),
    ("FL", "tampa"):    lambda zip_code, n: _fl_hillsborough_deeds(zip_code, n),
    # GA
    ("GA", "fulton"):   lambda zip_code, n: _ga_fulton_deeds(zip_code, n),
    ("GA", "atlanta"):  lambda zip_code, n: _ga_fulton_deeds(zip_code, n),
    ("GA", "dekalb"):   lambda zip_code, n: _ga_dekalb_deeds(zip_code, n),
    ("GA", "decatur"):  lambda zip_code, n: _ga_dekalb_deeds(zip_code, n),
}


async def fetch_recent_deeds(
    *,
    state: str,
    city: str = "",
    county: str = "",
    zip_code: str = "",
    max_results: int = 100,
) -> List[Dict[str, Any]]:
    """Fetch recent deed transfers for a given area.

    Returns a list of records with `grantee` (buyer) + `grantor` (seller)
    names, address, price and date — ready for the cash-buyer pipeline.
    """
    state = state.upper().strip()
    city_key = (city or county or "").lower().strip()
    county_key = county.lower().strip() if county else city_key

    # Look up a specific handler
    fn = (COUNTY_DISPATCH.get((state, county_key))
          or COUNTY_DISPATCH.get((state, city_key)))

    if fn:
        results = await fn(zip_code, max_results)
        log.info("County deeds (%s/%s): %d records", state, city_key, len(results))
        return results

    # Generic fallback — PropertyShark + AI extraction
    if city:
        results = await _propertyshark_deeds(city, state, max_results)
        if results:
            log.info("PropertyShark deeds (%s, %s): %d records", city, state, len(results))
            return results

    log.info("No county deed handler for %s/%s — returning empty", state, city_key)
    return []
