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

    # ── Cleveland / Cuyahoga County OH ──────────────────────────────────────
    # 1. County Clerk — Cuyahoga County Auditor (lis pendens / deeds)
    {"key": "OH-cuyahoga-clerk",  "category": "county_clerk", "state": "OH",
     "name": "Cuyahoga County OH — Auditor Property Search",
     "url": "https://auditor.cuyahogacounty.us/en-US/property-search.aspx",
     "render": True,
     "notes": "Search recent lis pendens & deeds. Look for filings with 'FORECLOSURE' or 'LIS PENDENS'."},

    # 2. Cuyahoga County RealAuction Sheriff Sales (the REAL system)
    {"key": "OH-cuyahoga-sheriff", "category": "public_trustee", "state": "OH",
     "name": "Cuyahoga County OH — Sheriff Sale Auction (RealAuction)",
     "url": "https://cuyahoga.sheriffsaleauction.ohio.gov/index.cfm?zaction=AUCTION&Zmethod=PREVIEW",
     "render": True,
     "notes": "Live Cuyahoga County sheriff foreclosure auctions. Extract case#, address, opening bid, sale date, plaintiff."},

    # 3. Cuyahoga Sheriff Sale — item detail (individual listings)
    {"key": "OH-cuyahoga-sheriff-items", "category": "public_trustee", "state": "OH",
     "name": "Cuyahoga County OH — Sheriff Sale Items",
     "url": "https://cuyahoga.sheriffsaleauction.ohio.gov/index.cfm?zaction=AUCTION&Zmethod=PREVIEW&AuctionDate={date}",
     "render": True,
     "notes": "Date-specific sheriff sale listings. Requires {date} substitution (e.g., 05/05/2026). Extract case#, address, opening bid."},

    # 4. Cuyahoga County Probate Court
    {"key": "OH-cuyahoga-probate", "category": "probate_court", "state": "OH",
     "name": "Cuyahoga County OH — Probate Court",
     "url": "https://probate.cuyahogacounty.us/",
     "render": True,
     "notes": "Probate estate filings — look for real estate assets in estate cases."},

    # 5. Cuyahoga County Treasurer — Tax Delinquent
    {"key": "OH-cuyahoga-tax",    "category": "tax_assessor", "state": "OH",
     "name": "Cuyahoga County OH — Treasurer Tax Delinquent",
     "url": "https://treasurer.cuyahogacounty.us/en-US/delinquent-tax.aspx",
     "render": True,
     "notes": "Tax-delinquent property lists. Extract address, owner, tax amount owed."},

    # 6. Auction.com — Ohio foreclosures (Cleveland area)
    {"key": "OH-auction-com",     "category": "auction_aggregator", "state": "OH",
     "name": "Auction.com — Ohio Foreclosures (Cleveland)",
     "url": "https://www.auction.com/residential/ohio/?q=cleveland",
     "render": True,
     "notes": "Foreclosure + bank-owned auctions in Cleveland OH area. Extract address, price, auction date."},

    # 7. Hubzu Ohio
    {"key": "OH-hubzu",           "category": "auction_aggregator", "state": "OH",
     "name": "Hubzu — Ohio Real Estate Auctions",
     "url": "https://www.hubzu.com/storefront/list?state=OH",
     "render": True,
     "notes": "Hubzu auction listings for Ohio — focus on Cuyahoga / Cleveland area."},

    # 8. Xome — Ohio
    {"key": "OH-xome",            "category": "auction_aggregator", "state": "OH",
     "name": "Xome — Ohio Foreclosure Auctions",
     "url": "https://www.xome.com/auctions/ohio/",
     "render": True,
     "notes": "Xome bank-owned and foreclosure auctions for Ohio."},

    # ── North Carolina / Fayetteville (Cumberland County) ───────────────────
    {"key": "NC-cumberland-clerk",  "category": "county_clerk", "state": "NC",
     "name": "Cumberland County NC — Register of Deeds",
     "url": "https://rodweb.cumberlandcountync.gov/RodWeb/search.do?searchType=REWRITE_INSTRUMENT&docTypeCode=LIS",
     "render": False,
     "notes": "Lis Pendens filings in Cumberland County (Fayetteville NC area). Extract grantor/grantee names, address, filing date."},

    {"key": "NC-cumberland-foreclosure", "category": "public_trustee", "state": "NC",
     "name": "Cumberland County NC — Clerk of Superior Court Foreclosures",
     "url": "https://www.nccourts.gov/courts/superior-court/cumberland-county",
     "render": True,
     "notes": "NC uses judicial foreclosures filed in Superior Court. Look for Special Proceedings (10-SP) — these are foreclosure actions."},

    {"key": "NC-cumberland-tax",  "category": "tax_assessor", "state": "NC",
     "name": "Cumberland County NC — Tax Administration Delinquent",
     "url": "https://taxadmin.co.cumberland.nc.us/",
     "render": True,
     "notes": "Delinquent real property tax list. Extract parcel, owner name, address, amount owed."},

    {"key": "NC-auction-com", "category": "auction_aggregator", "state": "NC",
     "name": "Auction.com — North Carolina Foreclosures (Fayetteville)",
     "url": "https://www.auction.com/residential/north-carolina/?q=fayetteville",
     "render": True,
     "notes": "Foreclosure + bank-owned auctions in Fayetteville NC / Cumberland County area."},

    {"key": "NC-hubzu", "category": "auction_aggregator", "state": "NC",
     "name": "Hubzu — North Carolina Real Estate Auctions",
     "url": "https://www.hubzu.com/storefront/list?state=NC",
     "render": True,
     "notes": "Hubzu auction listings for NC — focus on Cumberland / Fayetteville area."},

    {"key": "NC-wake-clerk", "category": "county_clerk", "state": "NC",
     "name": "Wake County NC — Register of Deeds (Lis Pendens)",
     "url": "https://services.wakegov.com/realestate/SearchDeed.asp",
     "render": False,
     "notes": "Wake County (Raleigh) deed/lis pendens search. Document type LIS PENDENS."},

    {"key": "NC-mecklenburg-clerk", "category": "county_clerk", "state": "NC",
     "name": "Mecklenburg County NC — Register of Deeds (Charlotte)",
     "url": "https://meckrod.manatron.com/",
     "render": True,
     "notes": "Mecklenburg County (Charlotte NC) ROD — search for LIS PENDENS last 60 days."},

    # ── Illinois / Cook County (Chicago) ────────────────────────────────────
    {"key": "IL-cook-clerk",      "category": "county_clerk", "state": "IL",
     "name": "Cook County IL — Recorder of Deeds (Lis Pendens)",
     "url": "https://ccrd.cook.county.il.us/",
     "render": True,
     "notes": "Search for LIS PENDENS and NOTICE OF FORECLOSURE filings in Cook County (Chicago area)."},
    {"key": "IL-cook-sheriff",    "category": "public_trustee", "state": "IL",
     "name": "Cook County IL — Sheriff's Office Judicial Sales",
     "url": "https://www.cookcountysheriff.org/real-estate-sales/",
     "render": True,
     "notes": "Judicial foreclosure sales for Cook County. Extract address, case number, sale date, opening bid."},
    {"key": "IL-cook-probate",    "category": "probate_court", "state": "IL",
     "name": "Cook County IL — Circuit Court Probate Division",
     "url": "https://courtlink.cookcountyclerkofcourt.org/", "render": True,
     "notes": "Probate cases — look for estate filings with real property listed. Department P (Probate)."},
    {"key": "IL-cook-tax",        "category": "tax_assessor", "state": "IL",
     "name": "Cook County IL — Treasurer Tax Sales",
     "url": "https://www.cookcountytreasurer.com/taxsaleresults.aspx",
     "render": True,
     "notes": "Tax sale and scavenger sale listings — delinquent real estate taxes. Extract parcel, owner, amount."},

    # ── Pennsylvania / Philadelphia & Allegheny ──────────────────────────────
    {"key": "PA-philly-sheriff",  "category": "public_trustee", "state": "PA",
     "name": "Philadelphia PA — Sheriff's Sale (judicial foreclosures)",
     "url": "https://www.philasheriff.org/sales/",
     "render": True,
     "notes": "Philadelphia Sheriff foreclosure sale listings. Extract address, writ number, sale date, upset price."},
    {"key": "PA-philly-recorder", "category": "county_clerk", "state": "PA",
     "name": "Philadelphia PA — Recorder of Deeds (Lis Pendens)",
     "url": "https://rodapps.phila.gov/rodpublicweb/",
     "render": True,
     "notes": "Search for LIS PENDENS document type in Philadelphia County recorder records."},
    {"key": "PA-allegheny-sheriff", "category": "public_trustee", "state": "PA",
     "name": "Allegheny County PA — Sheriff's Sale (Pittsburgh)",
     "url": "https://www.sheriffalleghenycounty.com/real-estate-sales.html",
     "render": True,
     "notes": "Pittsburgh-area sheriff foreclosure sales. Extract address, sale date, case number."},
    {"key": "PA-allegheny-recorder", "category": "county_clerk", "state": "PA",
     "name": "Allegheny County PA — Recorder of Deeds",
     "url": "https://www.alleghenycounty.us/real-estate/rod-search.aspx",
     "render": True,
     "notes": "Search LIS PENDENS filings in Allegheny County (Pittsburgh)."},

    # ── Arizona / Maricopa County (Phoenix) ─────────────────────────────────
    {"key": "AZ-maricopa-clerk",  "category": "county_clerk", "state": "AZ",
     "name": "Maricopa County AZ — Recorder (Notice of Trustee Sale)",
     "url": "https://recorder.maricopa.gov/webrecorder/",
     "render": True,
     "notes": "Search for NOTICE OF TRUSTEE SALE — Arizona non-judicial foreclosure trigger. Extract trustor name, address, sale date."},
    {"key": "AZ-maricopa-trustee","category": "public_trustee", "state": "AZ",
     "name": "Maricopa County AZ — Trustee Sales (Foreclosure.com mirror)",
     "url": "https://www.foreclosure.com/listing/results.html?stateCode=AZ&county=maricopa",
     "render": True,
     "notes": "Non-judicial trustee sales in Maricopa County (Phoenix metro). Extract address, opening bid, sale date, lender."},
    {"key": "AZ-maricopa-tax",    "category": "tax_assessor", "state": "AZ",
     "name": "Maricopa County AZ — Treasurer Tax Lien Sale",
     "url": "https://treasurer.maricopa.gov/property/tax-lien-sale",
     "render": True,
     "notes": "Tax lien certificate sale listings. Extract parcel ID, owner, address, delinquent amount."},
    {"key": "AZ-maricopa-probate","category": "probate_court", "state": "AZ",
     "name": "Maricopa County AZ — Superior Court Probate",
     "url": "https://apps.supremecourt.az.gov/publicaccess/",
     "render": True,
     "notes": "AZ Superior Court public access — search Probate case type in Maricopa County."},

    # ── Nevada / Clark County (Las Vegas) ────────────────────────────────────
    {"key": "NV-clark-recorder",  "category": "county_clerk", "state": "NV",
     "name": "Clark County NV — Recorder (Notice of Default)",
     "url": "https://www.clarkcountynv.gov/government/departments/recorder/property-records.php",
     "render": True,
     "notes": "Search for NOTICE OF DEFAULT and NOTICE OF TRUSTEE SALE in Clark County (Las Vegas). Non-judicial foreclosure state."},
    {"key": "NV-clark-foreclosures","category": "public_trustee", "state": "NV",
     "name": "Clark County NV — Foreclosure Listings (NV Trustee Sales)",
     "url": "https://www.nevadatrustees.com/",
     "render": True,
     "notes": "Nevada trustee sale auction listings for Clark County. Extract address, sale date, opening bid, trustee."},
    {"key": "NV-clark-tax",       "category": "tax_assessor", "state": "NV",
     "name": "Clark County NV — Treasurer Tax Sale",
     "url": "https://www.clarkcountynv.gov/government/departments/treasurer/delinquent-tax-sale.php",
     "render": True,
     "notes": "Clark County delinquent tax auction listings. Extract parcel, owner, address, delinquent amount."},

    # ── Washington / King County (Seattle) ──────────────────────────────────
    {"key": "WA-king-recorder",   "category": "county_clerk", "state": "WA",
     "name": "King County WA — Recorder (Lis Pendens / Notice of Trustee Sale)",
     "url": "https://recordsearch.kingcounty.gov/LandmarkWeb/",
     "render": True,
     "notes": "Search for NOTICE OF TRUSTEE SALE (WA non-judicial) or LIS PENDENS in King County (Seattle area)."},
    {"key": "WA-king-foreclosures","category": "public_trustee", "state": "WA",
     "name": "King County WA — Foreclosure Trustee Sales",
     "url": "https://www.foreclosure.com/listing/results.html?stateCode=WA&county=king",
     "render": True,
     "notes": "Non-judicial trustee sales in King County WA. Extract address, sale date, opening bid."},
    {"key": "WA-king-probate",    "category": "probate_court", "state": "WA",
     "name": "King County WA — Superior Court Probate",
     "url": "https://www.kingcounty.gov/courts/superior-court/probate.aspx",
     "render": True,
     "notes": "Probate estate filings with real property in King County Superior Court."},

    # ── Michigan / Wayne County (Detroit) ────────────────────────────────────
    {"key": "MI-wayne-clerk",     "category": "county_clerk", "state": "MI",
     "name": "Wayne County MI — Register of Deeds (Lis Pendens)",
     "url": "https://www.waynecounty.com/elected/clerk/register-of-deeds.aspx",
     "render": True,
     "notes": "Search for LIS PENDENS and NOTICE OF FORECLOSURE filings in Wayne County (Detroit metro)."},
    {"key": "MI-wayne-sheriff",   "category": "public_trustee", "state": "MI",
     "name": "Wayne County MI — Sheriff's Sale (Foreclosure Auctions)",
     "url": "https://www.wcsosales.com/",
     "render": True,
     "notes": "Wayne County Sheriff mortgage foreclosure auction listings (Detroit). Extract address, case number, sale date, minimum bid."},
    {"key": "MI-wayne-tax",       "category": "tax_assessor", "state": "MI",
     "name": "Wayne County MI — Treasurer Tax Foreclosure",
     "url": "https://www.waynecounty.com/elected/treasurer/tax-foreclosure.aspx",
     "render": True,
     "notes": "Wayne County tax foreclosure auction — delinquent properties. Detroit area has high volumes. Extract parcel, address, owner, delinquent amount."},

    # ── New York / Kings + Queens (NYC) ──────────────────────────────────────
    {"key": "NY-kings-acris",     "category": "county_clerk", "state": "NY",
     "name": "NYC ACRIS — Kings County (Brooklyn) Lis Pendens",
     "url": "https://a836-acris.nyc.gov/DS/DocumentSearch/DocumentType?hid_DocType=LIS+PENDENS",
     "render": True,
     "notes": "NYC ACRIS — search LIS PENDENS document type in Kings County (Brooklyn). Extract grantor/grantee, block/lot, filing date."},
    {"key": "NY-queens-acris",    "category": "county_clerk", "state": "NY",
     "name": "NYC ACRIS — Queens County Lis Pendens",
     "url": "https://a836-acris.nyc.gov/DS/DocumentSearch/DocumentType?hid_DocType=LIS+PENDENS",
     "render": True,
     "notes": "NYC ACRIS — search LIS PENDENS in Queens County. NY uses judicial foreclosure via court system."},
    {"key": "NY-nyc-foreclosures","category": "public_trustee", "state": "NY",
     "name": "NYC — Referee's Sales (Judicial Foreclosures)",
     "url": "https://www.foreclosure.com/listing/results.html?stateCode=NY&county=queens",
     "render": True,
     "notes": "NY judicial foreclosure referee sales in NYC metro area (Queens, Kings). Extract address, case number, sale date."},

    # ── Georgia / Gwinnett County ────────────────────────────────────────────
    {"key": "GA-gwinnett-clerk",  "category": "county_clerk", "state": "GA",
     "name": "Gwinnett County GA — Clerk of Courts",
     "url": "https://www.gwinnettcourts.com/",
     "render": True,
     "notes": "Gwinnett County (Atlanta suburb) — search for NOTICE OF SALE UNDER POWER filings in real estate index."},
    {"key": "GA-gwinnett-tax",    "category": "tax_assessor", "state": "GA",
     "name": "Gwinnett County GA — Tax Commissioner Tax Sale",
     "url": "https://www.gwinnettcountytaxcommissioner.com/property-taxes/delinquent-taxes.html",
     "render": True,
     "notes": "Gwinnett County delinquent property tax sale listings. Extract parcel, owner, address, amount owed."},

    # ── Tennessee / Shelby County (Memphis) ──────────────────────────────────
    {"key": "TN-shelby-clerk",    "category": "county_clerk", "state": "TN",
     "name": "Shelby County TN — Register of Deeds (Memphis area)",
     "url": "https://register.shelby.tn.us/",
     "render": True,
     "notes": "Shelby County Register of Deeds — search for NOTICE OF TRUSTEE SALE and LIS PENDENS. Memphis metro."},
    {"key": "TN-shelby-foreclosures","category": "public_trustee", "state": "TN",
     "name": "Shelby County TN — Foreclosure Sales (Memphis)",
     "url": "https://www.foreclosure.com/listing/results.html?stateCode=TN&county=shelby",
     "render": True,
     "notes": "Trustee foreclosure sales in Shelby County TN (Memphis). Extract address, sale date, opening bid."},

    # ── Missouri / St. Louis County ──────────────────────────────────────────
    {"key": "MO-stlouis-recorder","category": "county_clerk", "state": "MO",
     "name": "St. Louis County MO — Recorder of Deeds",
     "url": "https://www.stlouiscountymo.gov/st-louis-county-departments/recorder/",
     "render": True,
     "notes": "St. Louis County recorder — search for NOTICE OF TRUSTEE SALE and LIS PENDENS filings."},
    {"key": "MO-stlouis-sheriff", "category": "public_trustee", "state": "MO",
     "name": "St. Louis County MO — Sheriff Foreclosure Sales",
     "url": "https://www.stlouiscountysheriff.com/sales/",
     "render": True,
     "notes": "St. Louis County Sheriff real estate sales (foreclosure auctions). Extract address, case number, sale date."},

    # ── Indiana / Marion County (Indianapolis) ──────────────────────────────
    {"key": "IN-marion-recorder", "category": "county_clerk", "state": "IN",
     "name": "Marion County IN — Recorder (Indianapolis) Lis Pendens",
     "url": "https://recorder.indy.gov/",
     "render": True,
     "notes": "Marion County (Indianapolis) recorder — search LIS PENDENS and NOTICE OF SHERIFF SALE filings."},
    {"key": "IN-marion-sheriff",  "category": "public_trustee", "state": "IN",
     "name": "Marion County IN — Sheriff's Sale (Indianapolis)",
     "url": "https://www.indy.gov/activity/sheriff-sales",
     "render": True,
     "notes": "Marion County Sheriff judicial foreclosure sales. Extract address, cause number, sale date, minimum bid."},
    {"key": "IN-marion-tax",      "category": "tax_assessor", "state": "IN",
     "name": "Marion County IN — Treasurer Tax Sale",
     "url": "https://www.indy.gov/activity/property-tax-delinquencies",
     "render": True,
     "notes": "Marion County delinquent property tax sale. Extract parcel, owner, address, delinquent amount."},

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
    {"key": "foreclosure-com",    "category": "auction_aggregator", "state": "*",
     "name": "Foreclosure.com (nationwide pre-foreclosure + REO)",
     "url": "https://www.foreclosure.com/listing/results.html?stateCode={state}", "render": True,
     "notes": "Nationwide aggregator for pre-foreclosure, foreclosure, REO, and tax lien listings."},
    {"key": "realtytrack",        "category": "auction_aggregator", "state": "*",
     "name": "RealtyTrac / ATTOM Foreclosures (nationwide)",
     "url": "https://www.realtytrac.com/mapsearch/?state={state}", "render": True,
     "notes": "Nationwide pre-foreclosure and bank-owned (REO) listings."},
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
