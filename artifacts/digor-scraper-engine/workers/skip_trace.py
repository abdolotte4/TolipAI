"""Skip-trace orchestrator — free-tier optimised.

Strategy ladder (cheapest, most legal, most accurate first):

  1. Secretary of State business-entity search (free, official)
     - Florida (Sunbiz) — already implemented in scrapers.sunbiz
     - Per-state generic crawl with LLM extraction for the rest
  2. OpenCorporates API (free tier: ~100 calls/day, 200M+ companies)
  3. SEC EDGAR (free, unlimited — for investment entities w/ Form ADV / 13D / 13G)
  4. PropertyAPI.co skip-trace if a key is configured (paid fallback)
  5. Google site-dorking — DISABLED by default (controlled by ENABLE_GOOGLE_DORKS env)

Circuit breakers: OpenCorporates 401 and PropertyAPI DNS failures are logged
ONCE then the source is silently skipped for the rest of the process lifetime.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set

import httpx

from .config import settings
from .http_client import fetch_html
from .llm import extract_investor_profile
from .scrapers import sunbiz

log = logging.getLogger("skip_trace")

# Circuit breakers — sources added here are skipped for the rest of the run
_dead_sources: Set[str] = set()

# Per-state Secretary of State search portals
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
SEC_EDGAR_SEARCH   = "https://www.sec.gov/cgi-bin/browse-edgar"
USER_AGENT = "Digor/1.0 (skip-trace; contact: ops@digor.app)"


# ─── Step 1: Secretary of State (free, official) ────────────────────────────

async def _sos_lookup(llc_name: str, state: str) -> Dict[str, Any]:
    """Query state SOS for officers + registered agent."""
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
            log.info("Sunbiz lookup failed for %s: %s", llc_name, e)
        return {}
    if state not in SOS_URLS:
        return {}
    try:
        url = f"{SOS_URLS[state]}?searchTerm={llc_name.replace(' ', '+')}"
        html = await fetch_html(url, render=True)
        from bs4 import BeautifulSoup
        text = BeautifulSoup(html, "lxml").get_text("\n", strip=True)[:6000]
        prof = await extract_investor_profile(text, source=f"sos_{state.lower()}")
        return {
            "principals": prof.get("principals") or [],
            "registered_agent": prof.get("registered_agent"),
            "address": prof.get("mailing_address"),
            "jurisdiction": f"us_{state.lower()}",
        }
    except Exception as e:
        log.info("SOS lookup failed for %s/%s: %s", state, llc_name, e)
        return {}


# ─── Step 2: OpenCorporates (free tier) ─────────────────────────────────────

async def _opencorporates_lookup(name: str, state: str) -> Dict[str, Any]:
    """Use OpenCorporates API — skipped if disabled or after first auth failure."""
    if not settings.enable_opencorporates:
        return {}
    if "opencorporates" in _dead_sources:
        return {}
    try:
        params: Dict[str, Any] = {"q": name}
        if state:
            params["jurisdiction_code"] = f"us_{state.lower()}"
        async with httpx.AsyncClient(timeout=20) as cli:
            r = await cli.get(OPENCORPORATES_API, params=params,
                              headers={"User-Agent": USER_AGENT})
        if r.status_code == 401:
            _dead_sources.add("opencorporates")
            log.warning("OpenCorporates 401 — invalid key, disabling for this run")
            return {}
        if r.status_code != 200:
            log.info("OpenCorporates returned %s — skipping", r.status_code)
            return {}
        data = r.json()
        companies = (data.get("results") or {}).get("companies") or []
        if not companies:
            return {}
        company = companies[0].get("company") or {}
        officers = [o.get("officer", {}).get("name")
                    for o in company.get("officers") or []]
        return {
            "principals": [o for o in officers if o],
            "registered_agent": company.get("registered_address_in_full"),
            "address": company.get("registered_address_in_full"),
            "jurisdiction": company.get("jurisdiction_code"),
        }
    except Exception as e:
        err = str(e).lower()
        if "name or service not known" in err or "dns" in err or "connection" in err:
            _dead_sources.add("opencorporates")
            log.warning("OpenCorporates DNS/connection failure — disabling for this run: %s", e)
        else:
            log.info("OpenCorporates lookup failed: %s", e)
        return {}


# ─── Step 3: SEC EDGAR (free, unlimited; investment entities) ───────────────

async def _sec_edgar_lookup(name: str) -> Dict[str, Any]:
    """Search SEC EDGAR — free, no API key required."""
    try:
        async with httpx.AsyncClient(timeout=20) as cli:
            r = await cli.get(SEC_EDGAR_SEARCH, params={
                "action": "getcompany", "company": name, "type": "13",
                "dateb": "", "owner": "include", "count": "10",
            }, headers={"User-Agent": USER_AGENT})
        if r.status_code != 200:
            return {}
        from bs4 import BeautifulSoup
        text = BeautifulSoup(r.text, "lxml").get_text("\n", strip=True)[:6000]
        prof = await extract_investor_profile(text, source="sec_edgar")
        return {
            "principals":   prof.get("principals") or [],
            "address":      prof.get("mailing_address"),
            "jurisdiction": "sec_filings",
        }
    except Exception as e:
        log.info("SEC EDGAR lookup failed: %s", e)
        return {}


# ─── Step 4: Paid PropertyAPI.co fallback ───────────────────────────────────

async def _propertyapi_skip(name: str, address: Optional[str] = None) -> Dict[str, Any]:
    if not settings.enable_propertyapi:
        return {}
    if not settings.property_api_keys:
        return {}
    if "propertyapi" in _dead_sources:
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
            if "name or service not known" in err or "dns" in err or "failed to connect" in err:
                _dead_sources.add("propertyapi")
                log.warning("PropertyAPI DNS failure — disabling for this run: %s", e)
                return {}
            log.info("PropertyAPI skip failed: %s", e)
            continue
    return {}


# ─── Step 5: Google site-dorking (disabled by default) ───────────────────────

async def _google_dork_lookup(name: str, state: str) -> Dict[str, Any]:
    """Google dork — only runs when ENABLE_GOOGLE_DORKS=true."""
    if not settings.enable_google_dorks:
        return {}
    if "google_dork" in _dead_sources:
        return {}

    queries: List[str] = [
        f'"{name}" "registered agent" {state}',
        f'"{name}" "phone" "email" LLC',
    ]
    if state:
        queries.insert(1, f'"{name}" site:sos.{state.lower()}.gov')

    aggregated: Dict[str, Any] = {"phones": [], "emails": [],
                                  "principals": [], "addresses": []}
    for q in queries:
        try:
            html = await fetch_html(
                f"https://www.google.com/search?q={q.replace(' ', '+')}",
                render=False,
                is_google=True,
            )
            from bs4 import BeautifulSoup
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
                log.warning("Google dork disabled — proxy/fetch error: %s", e)
                break
            log.info("Google dork failed for query '%s': %s", q, e)
    return aggregated


# ─── Public orchestrator ────────────────────────────────────────────────────

async def trace(name: str, *, llc: Optional[str] = None,
                address: Optional[str] = None,
                state: Optional[str] = None) -> Dict[str, Any]:
    """Return enriched contact data for a person / LLC."""
    out: Dict[str, Any] = {
        "name": name, "llc": llc, "phones": [], "emails": [],
        "principals": [], "addresses": [], "sources": [],
    }
    target = llc or name
    state_u = (state or "").upper()

    # 1. Secretary of State
    if llc and state_u:
        sos = await _sos_lookup(llc, state_u)
        if sos:
            out["principals"].extend(sos.get("principals") or [])
            if sos.get("address"):
                out["addresses"].append(sos["address"])
            out["sources"].append(f"secretary_of_state:{state_u.lower()}")

    # 2. OpenCorporates (skip if SOS gave us principals)
    if not out["principals"]:
        oc = await _opencorporates_lookup(target, state_u)
        if oc:
            out["principals"].extend(oc.get("principals") or [])
            if oc.get("address"):
                out["addresses"].append(oc["address"])
            out["sources"].append("opencorporates")

    # 3. SEC EDGAR (only if still nothing — likely a hedge fund / REIT)
    if not out["principals"]:
        sec = await _sec_edgar_lookup(target)
        if sec:
            out["principals"].extend(sec.get("principals") or [])
            if sec.get("address"):
                out["addresses"].append(sec["address"])
            out["sources"].append("sec_edgar")

    # 4. PropertyAPI.co paid fallback
    papi = await _propertyapi_skip(name, address)
    if papi:
        out["phones"].extend(papi.get("phones") or [])
        out["emails"].extend(papi.get("emails") or [])
        out["sources"].append("propertyapi")

    # 5. Google dork fallback (disabled by default — ENABLE_GOOGLE_DORKS=true to enable)
    if not out["phones"] and not out["emails"]:
        gd = await _google_dork_lookup(target, state_u)
        out["phones"].extend(gd.get("phones") or [])
        out["emails"].extend(gd.get("emails") or [])
        if gd.get("addresses"):
            out["addresses"].extend(gd["addresses"])
        if gd.get("phones") or gd.get("emails"):
            out["sources"].append("google_dork")

    # de-dupe + sort
    out["phones"]     = sorted({p for p in out["phones"] if p})
    out["emails"]     = sorted({e for e in out["emails"] if e})
    out["addresses"]  = sorted({a for a in out["addresses"] if a})
    out["principals"] = sorted({p for p in out["principals"] if p})
    return out
