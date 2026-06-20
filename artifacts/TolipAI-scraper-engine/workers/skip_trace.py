"""Skip-trace orchestrator — public record and licensed API sources only.

Strategy ladder (cheapest, most legal, most accurate first):

  1. Secretary of State business-entity search (FL: sunbiz; other states: stub)
  2. OpenCorporates API (free tier)
  3. SEC EDGAR (investment entities — regex extraction, no LLM)
  4. PropertyAPI.co skip-trace (paid fallback)

REMOVED (AUDIT COMPLIANCE):
  ✗ Tier 0 — FastPeopleSearch scraper (violates ToS + FCRA)
  ✗ Tier 0 — CyberBackgroundChecks scraper (violates ToS + FCRA)
  ✗ Tier 5 — Google site-dorking with LLM extraction (hallucination risk)
  ✗ LLM calls in _sos_lookup() and _sec_edgar_lookup() (replaced with regex)

All contact data now comes from official sources only:
  - FL Secretary of State (Sunbiz) — official state portal
  - OpenCorporates — licensed aggregator
  - SEC EDGAR — official federal disclosure database
  - PropertyAPI.co — licensed skip-trace provider
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Set
from urllib.parse import quote as _url_quote

import httpx
from bs4 import BeautifulSoup

from .config import settings
from .http_client import fetch_html
from .scrapers import sunbiz

log = logging.getLogger("skip_trace")

_dead_sources: Set[str] = set()

SOS_URLS: Dict[str, str] = {
    "FL": "https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults",
    "TX": "https://mycpa.cpa.state.tx.us/coa/",
    "CA": "https://businesssearch.sos.ca.gov/CBS/SearchResults",
    "NY": "https://apps.dos.ny.gov/publicInquiry/",
    "GA": "https://ecorp.sos.ga.gov/BusinessSearch",
    "IL": "https://apps.ilsos.gov/businessentitysearch/",
    "AZ": "https://ecorp.azcc.gov/EntitySearch/Index",
    "OH": "https://businesssearch.ohiosos.gov/",
    "PA": "https://www.corporations.pa.gov/Search/CorpSearch",
    "NC": "https://www.sosnc.gov/online_services/search/by_title/_Business_Registration",
    "MI": "https://cofs.lara.state.mi.us/SearchApi/Search/Search",
    "WA": "https://ccfs.sos.wa.gov/#/AdvancedSearch",
}

OPENCORPORATES_API = "https://api.opencorporates.com/v0.4/companies/search"
SEC_EDGAR_SEARCH = "https://www.sec.gov/cgi-bin/browse-edgar"
USER_AGENT = "TolipAI/1.0 (skip-trace; contact: ops@tolipai.com)"

# Regex helpers for non-LLM extraction from SOS/EDGAR pages
_PHONE_RE = re.compile(r"\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}")
_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
_ADDRESS_RE = re.compile(
    r"\d{1,5}\s+[A-Za-z0-9\s,\.#]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl)[,\s]+[A-Za-z\s]+,\s*[A-Z]{2}\s+\d{5}",
    re.IGNORECASE,
)
_NAME_LABEL_RE = re.compile(
    r"(?:Registered Agent|Principal|Officer|President|Manager|Member)[:\s]+([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)",
    re.IGNORECASE,
)


def _extract_phones(text: str) -> List[str]:
    seen: set[str] = set()
    result = []
    for m in _PHONE_RE.finditer(text):
        digits = re.sub(r"\D", "", m.group())
        if len(digits) == 10:
            num = f"+1{digits}"
        elif len(digits) == 11 and digits.startswith("1"):
            num = f"+{digits}"
        else:
            continue
        if num not in seen:
            seen.add(num)
            result.append(num)
    return result


def _extract_emails(text: str) -> List[str]:
    seen: set[str] = set()
    result = []
    for m in _EMAIL_RE.finditer(text):
        email = m.group().lower()
        if email not in seen and not email.endswith((".png", ".jpg", ".gif", ".css", ".js")):
            seen.add(email)
            result.append(email)
    return result


def _extract_named_principals(text: str) -> List[str]:
    """Extract names from labeled SOS/EDGAR HTML (no LLM required)."""
    seen: set[str] = set()
    result = []
    for m in _NAME_LABEL_RE.finditer(text):
        name = m.group(1).strip()
        if name not in seen:
            seen.add(name)
            result.append(name)
    return result


# ─── Tier 1: Secretary of State ─────────────────────────────────────────────
async def _sos_lookup(llc_name: str, state: str) -> Dict[str, Any]:
    state = state.upper()

    # FL: use the real Sunbiz scraper (no LLM — sunbiz.py uses structured HTML parsing)
    if state == "FL":
        try:
            hits = await sunbiz.search_llc(llc_name)
            if hits:
                detail = await sunbiz.fetch_llc_detail(hits[0]["detail_path"])
                if detail:
                    return {
                        "principals": detail.get("principals") or [],
                        "registered_agent": detail.get("registered_agent"),
                        "address": detail.get("mailing_address"),
                        "jurisdiction": "us_fl",
                    }
        except Exception as e:
            log.info("Sunbiz lookup failed: %s", e)
        return {}

    # Other states: fetch SOS page and extract with regex (no LLM)
    if state not in SOS_URLS:
        log.debug("No SOS URL configured for state %s", state)
        return {}

    try:
        url = f"{SOS_URLS[state]}?searchTerm={_url_quote(llc_name)}"
        html = await fetch_html(url, render=True)
        soup = BeautifulSoup(html, "lxml")
        text = soup.get_text("\n", strip=True)

        principals = _extract_named_principals(text)
        phones = _extract_phones(text)
        emails = _extract_emails(text)

        # Try to extract mailing address
        address_matches = _ADDRESS_RE.findall(text)
        address = address_matches[0] if address_matches else None

        if not principals and not phones and not emails and not address:
            log.debug("SOS lookup for %s/%s: no structured data found", llc_name, state)
            return {}

        return {
            "principals": principals,
            "address": address,
            "phones": phones,
            "emails": emails,
            "jurisdiction": f"us_{state.lower()}",
        }
    except Exception as e:
        log.info("SOS lookup failed for %s/%s: %s", llc_name, state, e)
        return {}


# ─── Tier 2: OpenCorporates ─────────────────────────────────────────────────
async def _opencorporates_lookup(name: str, state: str) -> Dict[str, Any]:
    if not settings.enable_opencorporates or "opencorporates" in _dead_sources:
        return {}
    try:
        params: Dict[str, Any] = {"q": name}
        if state:
            params["jurisdiction_code"] = f"us_{state.lower()}"
        async with httpx.AsyncClient(timeout=20) as cli:
            r = await cli.get(OPENCORPORATES_API, params=params, headers={"User-Agent": USER_AGENT})
        if r.status_code == 401:
            _dead_sources.add("opencorporates")
            log.warning("OpenCorporates 401 — disabling")
            return {}
        if r.status_code != 200:
            return {}
        data = r.json()
        companies = (data.get("results") or {}).get("companies") or []
        if not companies:
            return {}
        company = companies[0].get("company") or {}
        officers = [o.get("officer", {}).get("name") for o in company.get("officers") or []]
        return {
            "principals": [o for o in officers if o],
            "registered_agent": company.get("registered_address_in_full"),
            "address": company.get("registered_address_in_full"),
            "jurisdiction": company.get("jurisdiction_code"),
        }
    except Exception as e:
        log.info("OpenCorporates failed: %s", e)
        return {}


# ─── Tier 3: SEC EDGAR (regex extraction — no LLM) ──────────────────────────
async def _sec_edgar_lookup(name: str) -> Dict[str, Any]:
    """Query SEC EDGAR for the entity and extract structured data with regex.
    Only useful for large investment companies that file 13-F/10-K with the SEC.
    """
    try:
        async with httpx.AsyncClient(timeout=20) as cli:
            r = await cli.get(
                SEC_EDGAR_SEARCH,
                params={
                    "action": "getcompany",
                    "company": name,
                    "type": "13",
                    "owner": "include",
                    "count": "10",
                },
                headers={"User-Agent": USER_AGENT},
            )
        if r.status_code != 200:
            return {}

        soup = BeautifulSoup(r.text, "lxml")
        text = soup.get_text("\n", strip=True)

        principals = _extract_named_principals(text)
        address_matches = _ADDRESS_RE.findall(text)
        address = address_matches[0] if address_matches else None

        if not principals and not address:
            return {}

        return {
            "principals": principals,
            "address": address,
            "jurisdiction": "sec_filings",
        }
    except Exception as e:
        log.info("SEC EDGAR failed: %s", e)
        return {}


# ─── Tier 4: PropertyAPI.co ─────────────────────────────────────────────────
async def _propertyapi_skip(name: str, address: Optional[str] = None) -> Dict[str, Any]:
    if not settings.enable_propertyapi or not settings.property_api_keys or "propertyapi" in _dead_sources:
        return {}
    for key in settings.property_api_keys:
        try:
            async with httpx.AsyncClient(timeout=20) as cli:
                r = await cli.post(
                    "https://api.propertyapi.co/skip-trace",
                    json={"name": name, "address": address or ""},
                    headers={"Authorization": f"Bearer {key}"},
                )
            if r.status_code == 200:
                return r.json()
            if r.status_code in (402, 403) and "credit" in r.text.lower():
                continue
        except Exception as e:
            err = str(e).lower()
            if "dns" in err or "failed to connect" in err:
                _dead_sources.add("propertyapi")
                log.warning("PropertyAPI DNS failure — disabling: %s", e)
                return {}
            log.info("PropertyAPI skip failed: %s", e)
            continue
    return {}


# ─── Public orchestrator ────────────────────────────────────────────────────
async def trace(
    name: str,
    *,
    llc: Optional[str] = None,
    address: Optional[str] = None,
    state: Optional[str] = None,
) -> Dict[str, Any]:
    """Return enriched contact data for a person / LLC.

    Sources (in order): SOS → OpenCorporates → SEC EDGAR → PropertyAPI.
    OSINT people-search scrapers (FastPeopleSearch, CyberBackgroundChecks) have
    been permanently removed — they violate ToS and FCRA requirements.
    """
    out: Dict[str, Any] = {
        "name": name,
        "llc": llc,
        "phones": [],
        "emails": [],
        "principals": [],
        "addresses": [],
        "sources": [],
    }
    target = llc or name
    state_u = (state or "").upper()

    # 1. Secretary of State (FL: full; other states: regex-extracted)
    if llc and state_u:
        sos = await _sos_lookup(llc, state_u)
        if sos:
            out["principals"].extend(sos.get("principals") or [])
            out["phones"].extend(sos.get("phones") or [])
            out["emails"].extend(sos.get("emails") or [])
            if sos.get("address"):
                out["addresses"].append(sos["address"])
            out["sources"].append(f"sos:{state_u.lower()}")

    # 2. OpenCorporates
    if not out["principals"]:
        oc = await _opencorporates_lookup(target, state_u)
        if oc:
            out["principals"].extend(oc.get("principals") or [])
            if oc.get("address"):
                out["addresses"].append(oc["address"])
            out["sources"].append("opencorporates")

    # 3. SEC EDGAR (investment companies only)
    if not out["principals"]:
        sec = await _sec_edgar_lookup(target)
        if sec:
            out["principals"].extend(sec.get("principals") or [])
            if sec.get("address"):
                out["addresses"].append(sec["address"])
            out["sources"].append("sec_edgar")

    # 4. PropertyAPI
    papi = await _propertyapi_skip(name, address)
    if papi:
        out["phones"].extend(papi.get("phones") or [])
        out["emails"].extend(papi.get("emails") or [])
        out["sources"].append("propertyapi")

    # Dedup + normalize
    out["phones"] = sorted({p.strip() for p in out["phones"] if p})
    out["emails"] = sorted({e.strip().lower() for e in out["emails"] if e})
    out["addresses"] = sorted({a.strip() for a in out["addresses"] if a})
    out["principals"] = sorted({p.strip() for p in out["principals"] if p})
    return out
