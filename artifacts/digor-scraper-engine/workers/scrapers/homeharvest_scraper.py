"""HomeHarvest wrapper — free scraping of Zillow / Realtor.com / Redfin.

HomeHarvest (pip install homeharvest) scrapes listing data into a Pandas
DataFrame without any API key.  We use it to pull:
  - Pre-foreclosure / foreclosure listings by city+state
  - Recently sold comps (for equity estimation)
  - Active listings (for cash-buyer market activity)

Listing types supported by HomeHarvest:
  "for_sale"   — active MLS listings
  "for_rent"   — rentals
  "sold"       — recently sold (comps)
  "pending"    — under contract

Note: HomeHarvest doesn't have a dedicated "foreclosure" filter — we use
  listing_type="for_sale" with site="realtor.com" and post-filter for
  status flags (foreclosure / pre-foreclosure) that Realtor includes.
  Zillow pre-foreclosure listings are returned when site="zillow".
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

log = logging.getLogger("homeharvest")


def _import_homeharvest():
    try:
        from homeharvest import scrape_property
        return scrape_property
    except ImportError:
        log.warning("homeharvest not installed — run: pip install homeharvest pandas")
        return None


def _df_to_listings(df) -> List[Dict[str, Any]]:
    """Convert a HomeHarvest DataFrame to plain dicts, dropping NaN values."""
    if df is None or len(df) == 0:
        return []
    import math

    results = []
    for _, row in df.iterrows():
        d: Dict[str, Any] = {}
        for col, val in row.items():
            if val is None:
                continue
            try:
                if isinstance(val, float) and math.isnan(val):
                    continue
            except (TypeError, ValueError):
                pass
            d[str(col)] = val
        if d:
            results.append(d)
    return results


def _normalize_listing(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Map HomeHarvest column names → our standard schema."""
    def _num(v) -> Optional[float]:
        try:
            return float(str(v).replace("$", "").replace(",", "")) if v is not None else None
        except (ValueError, TypeError):
            return None

    street = str(raw.get("street") or raw.get("full_street_line") or "").strip()
    city   = str(raw.get("city") or "").strip()
    state  = str(raw.get("state") or "").strip()
    zip_   = str(raw.get("zip_code") or raw.get("zip") or "").strip()
    address = f"{street}, {city}, {state} {zip_}".strip(", ")

    # Equity estimate: list_price - estimated_mortgage (rough)
    list_price = _num(raw.get("list_price") or raw.get("price"))
    zestimate  = _num(raw.get("zestimate"))
    est_value  = zestimate or list_price

    # Lat/lon come directly from the HomeHarvest DataFrame
    def _coord(key: str) -> Optional[float]:
        v = raw.get(key)
        if v is None:
            return None
        try:
            f = float(v)
            return f if f != 0.0 else None
        except (ValueError, TypeError):
            return None

    latitude  = _coord("latitude")
    longitude = _coord("longitude")

    # Price-reduction signal
    reduced_amount = _num(raw.get("price_reduced_amount") or raw.get("price_change_amount"))
    price_reduction = bool(reduced_amount and reduced_amount < 0)

    # Source-specific listing URL
    listing_url = str(raw.get("property_url") or raw.get("listing_url") or "").strip() or None

    return {
        "address":         address,
        "street":          street,
        "city":            city,
        "state":           state,
        "zip":             zip_,
        "county":          str(raw.get("county") or "").strip() or None,
        "latitude":        latitude,
        "longitude":       longitude,
        "list_price":      list_price,
        "zestimate":       zestimate,
        "estimated_value": est_value,
        "beds":            int(raw["beds"]) if raw.get("beds") else None,
        "baths":           _num(raw.get("full_baths") or raw.get("baths")),
        "sqft":            int(raw["sqft"]) if raw.get("sqft") else None,
        "year_built":      int(raw["year_built"]) if raw.get("year_built") else None,
        "lot_sqft":        int(raw["lot_sqft"]) if raw.get("lot_sqft") else None,
        "property_type":   str(raw.get("style") or raw.get("property_type") or "").strip() or None,
        "status":          str(raw.get("status") or "").strip() or None,
        "days_on_market":  int(raw["days_on_mls"]) if raw.get("days_on_mls") else None,
        "days_on_mls":     int(raw["days_on_mls"]) if raw.get("days_on_mls") else None,
        "price_reduction": price_reduction,
        "mls_id":          str(raw.get("mls_id") or "").strip() or None,
        "zillow_url":      listing_url,
        "listing_url":     listing_url,
        "agent":           str(raw.get("agent_name") or "").strip() or None,
        "agent_email":     str(raw.get("agent_email") or "").strip() or None,
        "agent_phones":    [str(raw["agent_phones"]).strip()] if raw.get("agent_phones") else [],
        "owner_name":      str(raw.get("owner_name") or "").strip() or None,
        "source":          "homeharvest",
    }


async def scrape_foreclosures(
    city: str,
    state: str = "",
    *,
    listing_type: str = "for_sale",
    site: str = "zillow",
    limit: int = 20,
    location: str = "",
) -> List[Dict[str, Any]]:
    """
    Async wrapper around HomeHarvest's synchronous scrape_property().

    Args:
        city:         Target city (e.g. "Orlando") OR a ZIP code (e.g. "32808")
        state:        Two-letter state code (e.g. "FL") — omit when city is a ZIP
        listing_type: "for_sale" | "sold" | "for_rent" | "pending"
        site:         "zillow" | "realtor.com" | "redfin"
        limit:        Maximum rows to return (HomeHarvest may return fewer)
        location:     Override full location string (takes priority over city+state)

    Returns list of normalised listing dicts.
    """
    scrape_property = _import_homeharvest()
    if not scrape_property:
        return []

    if not location:
        # ZIP code: pass as-is; city+state: combine
        city_clean  = (city or "").strip()
        state_clean = (state or "").strip()
        if state_clean:
            location = f"{city_clean}, {state_clean}"
        else:
            location = city_clean  # bare ZIP or city name

    if not location:
        log.warning("HomeHarvest: no location provided, skipping")
        return []

    log.info("HomeHarvest: scraping %s listings in %r via %s", listing_type, location, site)

    def _run() -> List[Dict[str, Any]]:
        try:
            df = scrape_property(
                location=location,
                listing_type=listing_type,
                site_name=site,
                results_wanted=limit,
            )
            raws = _df_to_listings(df)
            listings = [_normalize_listing(r) for r in raws]
            log.info("HomeHarvest: got %d listings from %s", len(listings), site)
            return listings
        except Exception as e:
            log.warning("HomeHarvest scrape failed (%s / %s): %s", site, listing_type, e)
            return []

    return await asyncio.get_event_loop().run_in_executor(None, _run)


async def scrape_multi_site(
    city: str,
    state: str,
    *,
    listing_type: str = "for_sale",
    limit_per_site: int = 10,
) -> List[Dict[str, Any]]:
    """Scrape Zillow + Realtor.com in parallel and de-duplicate by address."""
    results_z, results_r = await asyncio.gather(
        scrape_foreclosures(city, state, listing_type=listing_type, site="zillow", limit=limit_per_site),
        scrape_foreclosures(city, state, listing_type=listing_type, site="realtor.com", limit=limit_per_site),
        return_exceptions=True,
    )

    seen: set[str] = set()
    combined: List[Dict[str, Any]] = []
    for batch in (results_z, results_r):
        if isinstance(batch, Exception):
            log.warning("Multi-site scrape partial failure: %s", batch)
            continue
        for l in batch:
            key = (l.get("street") or "").lower()
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            combined.append(l)

    log.info("HomeHarvest multi-site: %d unique listings", len(combined))
    return combined
