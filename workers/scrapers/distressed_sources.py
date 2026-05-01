"""Registry of FREE distressed-property data sources.

Organised by the 5 source categories the platform targets so we can replace
the paid ATTOM/PropertyAPI Distressed Lead Finder with pure scraping:

  1. county_clerk          — Lis Pendens / Pre-Foreclosure (recorder filings)
  2. public_trustee        — Active Foreclosure auctions
  3. probate_court         — Civil/Probate court records (Probate / Inherited)
  4. tax_assessor          — Tax Delinquent / Vacant property lists
  5. government_reo        — HUD / Fannie / Freddie / VA REO portals
  6. auction_aggregator    — Auction.com, Hubzu, Xome (catch-all aggregators)

Each entry tells the engine WHERE to scrape and WHAT distress_type the
listings should be tagged with.  The actual fetch happens through the tiered
http_client, and the LLM (Kimi K2) extracts the structured rows.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

# ─── Category metadata (shown to the user in the UI) ─────────────────────────

CATEGORY_META: Dict[str, Dict[str, str]] = {
    "county_clerk":       {"name": "County Clerk & Recorder", "distress_type": "preforeclosure",
                           "description": "Lis Pendens & pre-foreclosure filings"},
    "public_trustee":     {"name": "Public Trustee Sites",    "distress_type": "trustee_sale",
                           "description": "Active foreclosure auctions"},
    "probate_court":      {"name": "Probate / Civil Court",   "distress_type": "probate",
                           "description": "Probate & inherited property"},
    "tax_assessor":       {"name": "Tax Assessor / Treasurer","distress_type": "tax_lien",
                           "description": "Tax-delinquent & vacant"},
    "government_reo":     {"name": "Government REO Portals",  "distress_type": "reo",
                           "description": "HUD, Fannie, Freddie, VA"},
    "auction_aggregator": {"name": "Auction Aggregators",     "distress_type": "auction",
                           "description": "Auction.com, Hubzu, Xome"},
}


# ─── Source registry ─────────────────────────────────────────────────────────
# Each source declares:
#   key, category, name, state, url_template, render (whether to JS-render),
#   notes for the LLM to interpret the page.

SOURCES: List[Dict[str, Any]] = [
    # ── 1. County Clerk & Recorder (Lis Pendens / Pre-Foreclosure) ──────────
    {"key": "FL-orange-clerk",   "category": "county_clerk", "state": "FL",
     "name": "Orange County FL — Official Records (Lis Pendens)",
     "url": "https://or.occompt.com/recorder/web/", "render": True,
     "notes": "Search by document type 'LIS PENDENS' for the last 30 days"},
    {"key": "FL-broward-clerk",  "category": "county_clerk", "state": "FL",
     "name": "Broward County FL — Recorder Search (Lis Pendens)",
     "url": "https://officialrecords.broward.org/AcclaimWeb/", "render": True,
     "notes": "Document type LIS PENDENS"},
    {"key": "TX-harris-clerk",   "category": "county_clerk", "state": "TX",
     "name": "Harris County TX — County Clerk (Notice of Sale)",
     "url": "https://www.cclerk.hctx.net/applications/realprop/foreclosures.aspx",
     "render": True, "notes": "Notice of substitute trustee sale + lis pendens"},
    {"key": "CA-la-recorder",    "category": "county_clerk", "state": "CA",
     "name": "Los Angeles County CA — Recorder (NOD/NOS)",
     "url": "https://www.lavote.gov/home/county-clerk/county-clerk-records",
     "render": True, "notes": "Notice of Default & Notice of Sale filings"},
    {"key": "GA-fulton-clerk",   "category": "county_clerk", "state": "GA",
     "name": "Fulton County GA — Clerk Real Estate Index",
     "url": "https://www.gsccca.org/search", "render": True,
     "notes": "Index search for 'NOTICE OF SALE' UNDER POWER"},

    # ── 2. Public Trustee (Active Foreclosure auctions) ─────────────────────
    {"key": "FL-orange-trustee",  "category": "public_trustee", "state": "FL",
     "name": "Orange County FL — Foreclosure Auction",
     "url": "https://orange.realforeclose.com/index.cfm?zaction=AUCTION&Zmethod=PREVIEW",
     "render": True, "notes": "Today's foreclosure sales"},
    {"key": "FL-broward-trustee", "category": "public_trustee", "state": "FL",
     "name": "Broward County FL — Foreclosure Auction",
     "url": "https://broward.realforeclose.com/index.cfm?zaction=AUCTION&Zmethod=PREVIEW",
     "render": True, "notes": "Today's foreclosure sales"},
    {"key": "FL-miami-trustee",   "category": "public_trustee", "state": "FL",
     "name": "Miami-Dade County FL — Foreclosure Auction",
     "url": "https://miami-dade.realforeclose.com/index.cfm?zaction=AUCTION&Zmethod=PREVIEW",
     "render": True, "notes": "Today's foreclosure sales"},
    {"key": "CO-public-trustee",  "category": "public_trustee", "state": "CO",
     "name": "Colorado Public Trustees (statewide)",
     "url": "https://publictrustees.colorado.gov/foreclosures",
     "render": False, "notes": "List of upcoming public trustee sales"},
    {"key": "TX-substitute-trustee", "category": "public_trustee", "state": "TX",
     "name": "Texas Substitute Trustee Sales (statewide)",
     "url": "https://www.publicnoticetexas.com/Search.aspx?Category=Foreclosures",
     "render": True, "notes": "Statewide foreclosure notices"},

    # ── 3. Probate / Civil Court (Probate & Inherited) ──────────────────────
    {"key": "FL-orange-probate",  "category": "probate_court", "state": "FL",
     "name": "Orange County FL — Probate Court",
     "url": "https://myeclerk.myorangeclerk.com/Search/CaseSearch",
     "render": True, "notes": "Case type PROBATE filed last 60 days"},
    {"key": "FL-broward-probate", "category": "probate_court", "state": "FL",
     "name": "Broward County FL — Probate Records",
     "url": "https://www.browardclerk.org/Web2/CaseSearch/", "render": True,
     "notes": "Case type PROBATE last 60 days"},
    {"key": "TX-harris-probate",  "category": "probate_court", "state": "TX",
     "name": "Harris County TX — Probate Courts",
     "url": "https://www.cclerk.hctx.net/applications/websearch/probate.aspx",
     "render": True, "notes": "Probate cases filed last 60 days"},
    {"key": "CA-la-probate",      "category": "probate_court", "state": "CA",
     "name": "Los Angeles Superior Court — Probate",
     "url": "https://www.lacourt.org/casesummary/ui/", "render": True,
     "notes": "Probate Notes filings"},

    # ── 4. Tax Assessor & Treasurer (Tax Delinquent / Vacant) ───────────────
    {"key": "FL-orange-tax",      "category": "tax_assessor", "state": "FL",
     "name": "Orange County FL — Tax Collector Delinquent List",
     "url": "https://octaxcol.com/property/?delinquent=1",
     "render": True, "notes": "Delinquent real estate taxes"},
    {"key": "FL-broward-tax",     "category": "tax_assessor", "state": "FL",
     "name": "Broward County FL — Records, Taxes & Treasury",
     "url": "https://broward.county-taxes.com/public/real_estate/searches/standard?delinquent=1",
     "render": True, "notes": "Delinquent property taxes"},
    {"key": "TX-harris-tax",      "category": "tax_assessor", "state": "TX",
     "name": "Harris County TX — Tax Assessor Delinquent",
     "url": "https://www.hctax.net/Property/Delinquent",
     "render": True, "notes": "Delinquent tax property lists"},
    {"key": "CA-la-tax",          "category": "tax_assessor", "state": "CA",
     "name": "LA County Treasurer — Defaulted Property Tax",
     "url": "https://ttc.lacounty.gov/secured-property-tax-default/",
     "render": True, "notes": "Tax-defaulted property auctions"},

    # ── 5. Government REO Portals ───────────────────────────────────────────
    # NOTE: HUD 404, VA-Vendee 500/502, USDA 500 — disabled until sites recover.
    # {"key": "HUD-homestore", ...},  # 404 — removed from HUD
    # {"key": "VA-vendee", ...},       # 500/502 DNS — site down
    # {"key": "USDA-reo", ...},        # 500 — site error
    {"key": "Fannie-homepath",    "category": "government_reo", "state": "*",
     "name": "Fannie Mae HomePath (nationwide REO)",
     "url": "https://www.homepath.com/listings",
     "render": True, "notes": "Fannie Mae REO listings"},
    {"key": "Freddie-homesteps",  "category": "government_reo", "state": "*",
     "name": "Freddie Mac HomeSteps (nationwide REO)",
     "url": "https://www.homesteps.com/", "render": True,
     "notes": "Freddie Mac REO listings"},

    # ── 6. Auction aggregators (catch-all, multi-source) ────────────────────
    {"key": "auction-com",        "category": "auction_aggregator", "state": "*",
     "name": "Auction.com (nationwide)",
     "url": "https://www.auction.com/residential/{state}/", "render": True,
     "notes": "Foreclosure + bank-owned auctions"},
    {"key": "hubzu",              "category": "auction_aggregator", "state": "*",
     "name": "Hubzu (nationwide)",
     "url": "https://www.hubzu.com/storefront/list?state={state}", "render": True,
     "notes": "Hubzu real estate auction marketplace"},
    {"key": "xome-auctions",      "category": "auction_aggregator", "state": "*",
     "name": "Xome (nationwide)",
     "url": "https://www.xome.com/auctions/{state}/", "render": True,
     "notes": "Xome auction listings"},
    {"key": "zillow-fsbo",        "category": "auction_aggregator", "state": "*",
     "name": "Zillow For-Sale-By-Owner",
     "url": "https://www.zillow.com/homes/fsbo/{zip}_rb/", "render": True,
     "notes": "Motivated-seller indicator"},
]


def list_categories() -> List[Dict[str, str]]:
    return [{"key": k, **v} for k, v in CATEGORY_META.items()]


def list_sources(category: Optional[str] = None,
                 state: Optional[str] = None) -> List[Dict[str, Any]]:
    out = SOURCES
    if category:
        out = [s for s in out if s["category"] == category]
    if state:
        s = state.upper()
        out = [src for src in out if src["state"] in (s, "*")]
    return out


def get_source(key: str) -> Optional[Dict[str, Any]]:
    for s in SOURCES:
        if s["key"] == key:
            return s
    return None


def sources_for_request(*, categories: Optional[List[str]] = None,
                        state: str = "", zip_code: str = "") -> List[Dict[str, Any]]:
    """Resolve the set of sources for a given user request.

    If `categories` is empty, return ALL categories (filtered by state).
    """
    cats = categories or list(CATEGORY_META.keys())
    out: List[Dict[str, Any]] = []
    for c in cats:
        out.extend(list_sources(category=c, state=state))
    # Always include nationwide aggregators last
    return out
