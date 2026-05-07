"""Skip-trace orchestrator — enterprise-optimized.

Strategy ladder (cheapest, most legal, most accurate first):

  0. OSINT people-finder scrapers (FastPeopleSearch, CyberBackgroundChecks)
  1. Secretary of State business-entity search (official portals)
  2. OpenCorporates API (free tier)
  3. SEC EDGAR (investment entities)
  4. PropertyAPI.co skip-trace (paid fallback)
  5. Google site-dorking (disabled by default)

Enhancements:
  - Confidence scoring per source
  - Correlation across multiple sources
  - Deduplication + normalization
"""

from __future__ import annotations
import logging

import httpx
from typing import Any, Dict, List, Optional, Set
from bs4 import BeautifulSoup

from .config import settings
from .http_client import fetch_html
from .llm import extract_investor_profile
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


# ─── Tier 0: OSINT People-Finder ────────────────────────────────────────────
async def _fastpeople_lookup(name: str, state: str) -> Dict[str, Any]:
    """Scrape FastPeopleSearch for phones/emails."""
    try:
        url = f"https://www.fastpeoplesearch.com/name/{name.replace(' ', '-')}/{state.lower()}"
        html = await fetch_html(url, render=False)
        text = BeautifulSoup(html, "lxml").get_text("\n", strip=True)[:6000]
        prof = await extract_investor_profile(text, source="fastpeople")
        return {
            "phones": prof.get("phones") or [],
            "emails": prof.get("emails") or [],
            "addresses": [prof.get("mailing_address")] if prof.get("mailing_address") else [],
            "principals": prof.get("principals") or [],
            "jurisdiction": f"osint_fastpeople_{state.lower()}",
        }
    except Exception as e:
        log.info("FastPeopleSearch failed: %s", e)
        return {}


async def _cyberbackground_lookup(name: str, state: str) -> Dict[str, Any]:
    """Scrape CyberBackgroundChecks for phones/emails."""
    try:
        url = f"https://www.cyberbackgroundchecks.com/people/{name.replace(' ', '-')}/{state.lower()}"
        html = await fetch_html(url, render=False)
        text = BeautifulSoup(html, "lxml").get_text("\n", strip=True)[:6000]
        prof = await extract_investor_profile(text, source="cyberbackground")
        return {
            "phones": prof.get("phones") or [],
            "emails": prof.get("emails") or [],
            "addresses": [prof.get("mailing_address")] if prof.get("mailing_address") else [],
            "principals": prof.get("principals") or [],
            "jurisdiction": f"osint_cyber_{state.lower()}",
        }
    except Exception as e:
        log.info("CyberBackgroundChecks failed: %s", e)
        return {}


# ─── Tier 1: Secretary of State ─────────────────────────────────────────────
async def _sos_lookup(llc_name: str, state: str) -> Dict[str, Any]:
    state = state.upper()
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
    if state not in SOS_URLS:
        return {}
    try:
        url = f"{SOS_URLS[state]}?searchTerm={llc_name.replace(' ', '+')}"
        html = await fetch_html(url, render=True)
        text = BeautifulSoup(html, "lxml").get_text("\n", strip=True)[:6000]
        prof = await extract_investor_profile(text, source=f"sos_{state.lower()}")
        return {
            "principals": prof.get("principals") or [],
            "registered_agent": prof.get("registered_agent"),
            "address": prof.get("mailing_address"),
            "jurisdiction": f"us_{state.lower()}",
        }
    except Exception as e:
        log.info("SOS lookup failed: %s", e)
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


# ─── Tier 3: SEC EDGAR ──────────────────────────────────────────────────────
async def _sec_edgar_lookup(name: str) -> Dict[str, Any]:
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
        text = BeautifulSoup(r.text, "lxml").get_text("\n", strip=True)[:6000]
        prof = await extract_investor_profile(text, source="sec_edgar")
        return {
            "principals": prof.get("principals") or [],
            "address": prof.get("mailing_address"),
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


# ─── Tier 5: Google site-dorking ────────────────────────────────────────────
async def _google_dork_lookup(name: str, state: str) -> Dict[str, Any]:
    if not settings.enable_google_dorks or "google_dork" in _dead_sources:
        return {}

    queries: List[str] = [
        f'"{name}" "registered agent" {state}',
        f'"{name}" "phone" "email" LLC',
    ]
    if state:
        queries.insert(1, f'"{name}" site:sos.{state.lower()}.gov')

    aggregated: Dict[str, Any] = {
        "phones": [],
        "emails": [],
        "principals": [],
        "addresses": [],
    }
    for q in queries:
        try:
            html = await fetch_html(
                f"https://www.google.com/search?q={q.replace(' ', '+')}",
                render=False,
                is_google=True,
            )
            text = BeautifulSoup(html, "lxml").get_text("\n", strip=True)[:6000]
            prof = await extract_investor_profile(text, source="google_dork")
            for k in ("phones", "emails", "principals"):
                aggregated[k].extend(prof.get(k) or [])
            if prof.get("mailing_address"):
                aggregated["addresses"].append(prof["mailing_address"])
            if aggregated["phones"] or aggregated["emails"]:
                break
        except Exception as e:
            err = str(e).lower()
            if "400" in err or "custom_google" in err:
                _dead_sources.add("google_dork")
                log.warning("Google dork disabled: %s", e)
                break
            log.info("Google dork failed for query '%s': %s", q, e)
    return aggregated


# ─── Public orchestrator ────────────────────────────────────────────────────
async def trace(
    name: str,
    *,
    llc: Optional[str] = None,
    address: Optional[str] = None,
    state: Optional[str] = None,
) -> Dict[str, Any]:
    """Return enriched contact data for a person / LLC."""
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

    # 0. OSINT people-finder
    fp = await _fastpeople_lookup(name, state_u)
    cb = await _cyberbackground_lookup(name, state_u)
    for src, label in [(fp, "fastpeople"), (cb, "cyberbackground")]:
        if src:
            out["phones"].extend(src.get("phones") or [])
            out["emails"].extend(src.get("emails") or [])
            out["addresses"].extend(src.get("addresses") or [])
            out["principals"].extend(src.get("principals") or [])
            out["sources"].append(label)

    # 1. Secretary of State
    if llc and state_u:
        sos = await _sos_lookup(llc, state_u)
        if sos:
            out["principals"].extend(sos.get("principals") or [])
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

    # 3. SEC EDGAR
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

    # 5. Google dork
    if not out["phones"] and not out["emails"]:
        gd = await _google_dork_lookup(target, state_u)
        out["phones"].extend(gd.get("phones") or [])
        out["emails"].extend(gd.get("emails") or [])
        out["addresses"].extend(gd.get("addresses") or [])
        if gd.get("phones") or gd.get("emails"):
            out["sources"].append("google_dork")

    # Dedup + normalize
    out["phones"] = sorted({p.strip() for p in out["phones"] if p})
    out["emails"] = sorted({e.strip().lower() for e in out["emails"] if e})
    out["addresses"] = sorted({a.strip() for a in out["addresses"] if a})
    out["principals"] = sorted({p.strip() for p in out["principals"] if p})
    return out
