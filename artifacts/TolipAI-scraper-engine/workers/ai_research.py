"""AI-powered research helpers.

AUDIT COMPLIANCE:
  discover_trustees() previously asked the LLM to enumerate trustee websites
  and return URLs — violating Rule #2 (NEVER guess URLs). It has been replaced
  with a curated static TRUSTEE_REGISTRY of verified public-record URLs.

  hedge_fund_markets() and research() use the LLM for *general analysis* only
  (not data extraction) and remain unchanged.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List

from .llm import _chat

log = logging.getLogger("ai_research")


# ─── Static Trustee / Foreclosure Sale Registry ──────────────────────────────
# Curated, manually verified public-record URLs.
# Key = (STATE_UPPER, county_lower_or_empty)
# county="" entries are state-level fallbacks.
#
# To add a new county: verify the URL is live, then add it here.
# NEVER use LLM to generate these URLs.

TRUSTEE_REGISTRY: List[Dict[str, Any]] = [
    # ── Texas ──────────────────────────────────────────────────────────────────
    {
        "name": "Harris County Tax Assessor-Collector — Tax Sales",
        "role": "county_clerk",
        "county": "harris",
        "state": "TX",
        "website": "https://www.hctax.net/Property/TaxSales",
        "sale_listings_url": "https://www.hctax.net/Property/TaxSales",
        "notes": "Monthly first-Tuesday tax foreclosure list. Download as PDF.",
    },
    {
        "name": "Dallas County — Tax Foreclosure Sales",
        "role": "county_clerk",
        "county": "dallas",
        "state": "TX",
        "website": "https://www.dallascounty.org/departments/tax/tax_sales.php",
        "sale_listings_url": "https://www.dallascounty.org/departments/tax/tax_sales.php",
        "notes": "First Tuesday monthly; list posted ~30 days before sale.",
    },
    {
        "name": "Bexar County — Tax Sales",
        "role": "county_clerk",
        "county": "bexar",
        "state": "TX",
        "website": "https://www.bcad.org/",
        "sale_listings_url": "https://www.bcad.org/",
        "notes": "San Antonio area. First Tuesday monthly.",
    },
    {
        "name": "Travis County — Tax Sales",
        "role": "county_clerk",
        "county": "travis",
        "state": "TX",
        "website": "https://www.traviscountytx.gov/tax-office",
        "sale_listings_url": "https://www.traviscountytx.gov/tax-office",
        "notes": "Austin area. First Tuesday monthly.",
    },
    # ── Florida ────────────────────────────────────────────────────────────────
    {
        "name": "Miami-Dade Clerk of Courts — Foreclosure Sales",
        "role": "county_clerk",
        "county": "miami-dade",
        "state": "FL",
        "website": "https://www.miamidade.gov/global/finance/clerk/courts/foreclosures.page",
        "sale_listings_url": "https://www.miamidade.gov/CLDOCS/ForeclosureSales",
        "notes": "Official Miami-Dade Clerk foreclosure sale listings — public HTML, no login required.",
    },
    {
        "name": "Broward County Clerk — Foreclosure Auctions",
        "role": "county_clerk",
        "county": "broward",
        "state": "FL",
        "website": "https://www.browardclerk.org/Web2/CaseSearch/Search",
        "sale_listings_url": "https://www.broward.org/RecordsTaxesTreasury/ForeClosureSales/Pages/default.aspx",
        "notes": "Official Broward County Records/Treasury foreclosure page — public, no login required.",
    },
    {
        "name": "Hillsborough County Clerk — Foreclosure Auctions",
        "role": "county_clerk",
        "county": "hillsborough",
        "state": "FL",
        "website": "https://www.hillsclerk.com/",
        "sale_listings_url": "https://www.hillsclerk.com/",
        "notes": "Tampa area. Auctions posted weekly.",
    },
    {
        "name": "Orange County Clerk — Foreclosure Auctions",
        "role": "county_clerk",
        "county": "orange",
        "state": "FL",
        "website": "https://myeclerk.myorangeclerk.com/",
        "sale_listings_url": "https://myeclerk.myorangeclerk.com/Auctions",
        "notes": "Orlando area. Official Orange County Clerk auction portal — public, no login required.",
    },
    {
        "name": "Palm Beach County Clerk — Foreclosure Auctions",
        "role": "county_clerk",
        "county": "palm beach",
        "state": "FL",
        "website": "https://www.mypalmbeachclerk.com/",
        "sale_listings_url": "https://www.mypalmbeachclerk.com/official-records/foreclosure-auction",
        "notes": "West Palm Beach area. Official Palm Beach Clerk foreclosure auction — public, no login required.",
    },
    # ── Arizona ────────────────────────────────────────────────────────────────
    {
        "name": "Maricopa County Treasurer — Tax Lien Sales",
        "role": "public_trustee",
        "county": "maricopa",
        "state": "AZ",
        "website": "https://mctreasurer.maricopa.gov/",
        "sale_listings_url": "https://mctreasurer.maricopa.gov/",
        "notes": "Phoenix area. Annual February tax lien sale + trustee sales.",
    },
    {
        "name": "Pima County Recorder — Trustee Sales",
        "role": "public_trustee",
        "county": "pima",
        "state": "AZ",
        "website": "https://recorder.pima.gov/",
        "sale_listings_url": "https://recorder.pima.gov/",
        "notes": "Tucson area. Trustee sale notices posted online.",
    },
    # ── Nevada ─────────────────────────────────────────────────────────────────
    {
        "name": "Clark County Recorder — Trustee Sales",
        "role": "public_trustee",
        "county": "clark",
        "state": "NV",
        "website": "https://www.clarkcountynv.gov/government/elected_officials/county_recorder",
        "sale_listings_url": "https://www.clarkcountynv.gov/government/elected_officials/county_recorder/trustee_sales",
        "notes": "Las Vegas area. Trustee sale notices filed with County Recorder.",
    },
    # ── California ─────────────────────────────────────────────────────────────
    {
        "name": "Los Angeles County Tax Collector — Defaulted Tax Sales",
        "role": "county_clerk",
        "county": "los angeles",
        "state": "CA",
        "website": "https://ttc.lacounty.gov/",
        "sale_listings_url": "https://ttc.lacounty.gov/defaulted-property-tax-auction/",
        "notes": "Annual tax-defaulted land sales; also publishes Notice of Trustee Sale via county recorder.",
    },
    {
        "name": "Orange County Recorder — Notice of Trustee Sales",
        "role": "public_trustee",
        "county": "orange",
        "state": "CA",
        "website": "https://www.ocrecorder.com/",
        "sale_listings_url": "https://www.ocgov.com/gov/clerkrecorder/services/notices/default.asp",
        "notes": "Search for NTS (Notice of Trustee Sale) document type.",
    },
    {
        "name": "San Diego County Recorder — Trustee Sales",
        "role": "public_trustee",
        "county": "san diego",
        "state": "CA",
        "website": "https://www.sdarcc.gov/",
        "sale_listings_url": "https://arcc.sdcounty.ca.gov/Pages/Recorder-Home.aspx",
        "notes": "Search for NTS document type in county recorder.",
    },
    # ── Illinois ───────────────────────────────────────────────────────────────
    {
        "name": "Cook County Treasurer — Scavenger / Annual Tax Sales",
        "role": "county_clerk",
        "county": "cook",
        "state": "IL",
        "website": "https://www.cookcountytreasurer.com/taxsalesandtax-buyerinfo.aspx",
        "sale_listings_url": "https://www.cookcountytreasurer.com/taxsalesandtax-buyerinfo.aspx",
        "notes": "Chicago area. Annual and Scavenger sales; list available as downloadable spreadsheet.",
    },
    # ── Georgia ────────────────────────────────────────────────────────────────
    {
        "name": "Fulton County Tax Commissioner — Tax Sales",
        "role": "county_clerk",
        "county": "fulton",
        "state": "GA",
        "website": "https://www.fultoncountyga.gov/inside-fulton-county/fulton-county-departments/finance/tax-commissioner/real-property-tax/tax-sales",
        "sale_listings_url": "https://www.fultoncountyga.gov/inside-fulton-county/fulton-county-departments/finance/tax-commissioner/real-property-tax/tax-sales",
        "notes": "Atlanta area. First Tuesday monthly tax sales. Certified list posted ~30 days prior.",
    },
    {
        "name": "Gwinnett County Tax Commissioner — Tax Sales",
        "role": "county_clerk",
        "county": "gwinnett",
        "state": "GA",
        "website": "https://www.gwinnettcounty.com/web/gwinnett/departments/financialadministration/taxcommissioner",
        "sale_listings_url": "https://www.gwinnettcounty.com/web/gwinnett/departments/financialadministration/taxcommissioner",
        "notes": "First Tuesday monthly.",
    },
    {
        "name": "DeKalb County Tax Commissioner — Tax Sales",
        "role": "county_clerk",
        "county": "dekalb",
        "state": "GA",
        "website": "https://www.dekalbcountyga.gov/tax-commissioner",
        "sale_listings_url": "https://www.dekalbcountyga.gov/tax-commissioner",
        "notes": "First Tuesday monthly.",
    },
    # ── North Carolina ─────────────────────────────────────────────────────────
    {
        "name": "Mecklenburg County — Foreclosure Sales",
        "role": "county_clerk",
        "county": "mecklenburg",
        "state": "NC",
        "website": "https://www.mecknc.gov/courts/pages/home.aspx",
        "sale_listings_url": "https://mecklenburgcounty.iowacourts.gov/",
        "notes": "Charlotte area. Judicial foreclosures listed through court system.",
    },
    {
        "name": "Wake County — Foreclosure Sales",
        "role": "county_clerk",
        "county": "wake",
        "state": "NC",
        "website": "https://www.wakegov.com/departments-government/revenue/foreclosure",
        "sale_listings_url": "https://www.wakegov.com/departments-government/revenue/foreclosure",
        "notes": "Raleigh area. Judicial foreclosures.",
    },
    # ── Ohio ───────────────────────────────────────────────────────────────────
    {
        "name": "Cuyahoga County Sheriff — Foreclosure Sales",
        "role": "sheriff",
        "county": "cuyahoga",
        "state": "OH",
        "website": "https://www.cuyahogasheriff.us/",
        "sale_listings_url": "https://www.cuyahogasheriff.us/real-estate-sales",
        "notes": "Cleveland area. Weekly sheriff sales via judicial foreclosure.",
    },
    {
        "name": "Franklin County Sheriff — Foreclosure Sales",
        "role": "sheriff",
        "county": "franklin",
        "state": "OH",
        "website": "https://sheriff.franklincountyohio.gov/",
        "sale_listings_url": "https://sheriff.franklincountyohio.gov/divisions/civil/real-estate.cfm",
        "notes": "Columbus area.",
    },
    # ── Pennsylvania ───────────────────────────────────────────────────────────
    {
        "name": "Philadelphia Sheriff — Sheriff Sales",
        "role": "sheriff",
        "county": "philadelphia",
        "state": "PA",
        "website": "https://www.philasheriff.org/",
        "sale_listings_url": "https://www.philasheriff.org/",
        "notes": "Monthly sheriff sales; list available as PDF on website.",
    },
]

# Build lookup indexes
_BY_STATE: Dict[str, List[Dict[str, Any]]] = {}
_BY_STATE_COUNTY: Dict[tuple[str, str], List[Dict[str, Any]]] = {}

for _entry in TRUSTEE_REGISTRY:
    _s = _entry["state"].upper()
    _c = _entry["county"].lower()
    _BY_STATE.setdefault(_s, []).append(_entry)
    _BY_STATE_COUNTY.setdefault((_s, _c), []).append(_entry)


async def discover_trustees(
    state: str,
    *,
    county: str = "",
    max_results: int = 25,
) -> List[Dict[str, Any]]:
    """Return curated trustee / foreclosure-sale sites for a state (and optionally county).

    AUDIT NOTE: This function was previously an async LLM call that hallucinated
    URLs. It now performs a registry lookup against TRUSTEE_REGISTRY — a manually
    curated list of verified public-record URLs. The async signature is preserved
    so callers in main.py require no changes.

    To add new counties: append to TRUSTEE_REGISTRY above with verified URLs only.
    NEVER use LLM to generate these URLs.
    """
    state_upper = state.upper().strip()
    county_lower = county.lower().strip()

    if county_lower:
        results = _BY_STATE_COUNTY.get((state_upper, county_lower), [])
        if not results:
            results = _BY_STATE.get(state_upper, [])
    else:
        results = _BY_STATE.get(state_upper, [])

    if not results:
        log.info(
            "discover_trustees: no verified entries for state=%s county=%s. "
            "Add verified URLs to TRUSTEE_REGISTRY in ai_research.py.",
            state_upper,
            county_lower or "(any)",
        )

    return results[:max_results]


HEDGE_FUND_MARKETS_SYSTEM = (
    "You are a real-estate analyst.  List the US metros where institutional "
    "and hedge-fund single-family-rental (SFR) buyers are most active right "
    "now (Invitation Homes, AMH, Tricon, Pretium, Blackstone, Pearlmark, "
    "Roofstock, Conrex etc.).  Return JSON: "
    "{ markets: [ { metro, state, primary_counties: [...], dominant_buyers: [...], "
    "notes: '1-sentence' } ] }."
)


async def hedge_fund_markets(max_results: int = 12) -> List[Dict[str, Any]]:
    """Ask the LLM for general market analysis on institutional SFR activity.

    This is classification/analysis only — not data extraction.
    The LLM is NOT asked for property addresses, URLs, or scraped data.
    """
    raw = await _chat(
        [
            {"role": "system", "content": HEDGE_FUND_MARKETS_SYSTEM},
            {"role": "user", "content": f"Return top {max_results} metros."},
        ],
        json_mode=True,
        max_tokens=1200,
        temperature=0.2,
    )
    try:
        data = json.loads(raw)
        return (data.get("markets") or [])[:max_results]
    except Exception:
        log.warning("hedge_fund_markets LLM parse failed", exc_info=True)
        return []


GENERIC_RESEARCH_SYSTEM = (
    "You are a real-estate research assistant for a wholesaler.  Return STRICT "
    "JSON: { results: [ { title, url, summary } ] } — concise, factual, and "
    "free of speculation.  When unsure of a URL, omit it.  Do not invent."
)


async def research(query: str, *, max_results: int = 10) -> Dict[str, Any]:
    """Generic LLM research with a structured-JSON contract.

    Used only for general market research queries, never for scraping or
    extracting structured data from HTML.
    """
    raw = await _chat(
        [
            {"role": "system", "content": GENERIC_RESEARCH_SYSTEM},
            {
                "role": "user",
                "content": f"Query: {query}\nReturn up to {max_results} results.",
            },
        ],
        json_mode=True,
        max_tokens=1400,
        temperature=0.3,
    )
    try:
        data = json.loads(raw)
        results = (data.get("results") or [])[:max_results]
        return {"query": query, "results": results, "count": len(results)}
    except Exception:
        log.warning("research() LLM parse returned non-JSON", exc_info=True)
        return {"query": query, "results": [], "count": 0, "error": "non-JSON"}
