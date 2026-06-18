"""HomeHarvest wrapper — free scraping of Zillow / Realtor.com / Redfin.

HomeHarvest (pip install homeharvest) scrapes listing data into a Pandas
DataFrame without any API key.  We use it to pull:
  - Pre-foreclosure / foreclosure listings by city+state
  - Recently sold comps (for equity estimation)
  - Active listings (for cash-buyer market activity)

Listing types supported by HomeHarvest (current API):
  "for_sale"   — active MLS listings
  "for_rent"   — rentals
  "sold"       — recently sold (comps)
  "pending"    — under contract

API note (homeharvest >= 0.5.x):
  - `site_name` and `results_wanted` were removed.
  - Multi-site scraping is now automatic (scrapes all sites internally).
  - Use `limit` instead of `results_wanted`.
  - Use `foreclosure=True` to filter to foreclosure/pre-foreclosure listings.
  - `proxy` parameter accepts an http://user:pass@host:port string.
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


def _extract_phones(raw_phones) -> List[str]:
    """Parse HomeHarvest agent_phones into a flat list of number strings.

    HomeHarvest returns agent_phones as a list of dicts like:
      [{'number': '8065551234', 'type': 'Mobile', 'primary': True, 'ext': None}]
    or occasionally as a string representation of that list.
    Returns plain number strings only.
    """
    if not raw_phones:
        return []
    # Already a list of dicts
    if isinstance(raw_phones, list):
        out = []
        for item in raw_phones:
            if isinstance(item, dict):
                n = str(item.get("number") or "").strip()
                if n:
                    out.append(n)
            elif isinstance(item, str) and item.strip():
                out.append(item.strip())
        return out
    # Stringified list — use ast.literal_eval (safe; eval is intentionally avoided)
    import ast

    s = str(raw_phones).strip()
    if s.startswith("["):
        try:
            parsed = ast.literal_eval(s)
            return _extract_phones(parsed)
        except (ValueError, SyntaxError):
            pass
    return [s] if s else []


def _df_to_listings(df) -> List[Dict[str, Any]]:
    """Convert a HomeHarvest DataFrame to plain dicts, dropping NA / NaN values.

    Handles both numpy NaN (float) and pandas NA (pd.NA / pd.NaT) which are
    returned when extra_property_data=False is used with newer HomeHarvest.
    """
    if df is None or len(df) == 0:
        return []
    try:
        import pandas as _pd

        _has_pandas = True
    except ImportError:
        _has_pandas = False

    import math

    def _is_missing(val) -> bool:
        if val is None:
            return True
        # pandas NA / NaT — must check before float test (they raise on bool)
        if _has_pandas:
            try:
                if _pd.isna(val):
                    return True
            except (TypeError, ValueError):
                pass
        # numpy / plain float NaN
        if isinstance(val, float):
            try:
                return math.isnan(val)
            except (TypeError, ValueError):
                pass
        return False

    results = []
    for _, row in df.iterrows():
        d: Dict[str, Any] = {}
        for col, val in row.items():
            if _is_missing(val):
                continue
            # Convert pandas Timestamp → ISO string for JSON-serializability
            if _has_pandas and isinstance(val, _pd.Timestamp):
                val = val.isoformat()
            d[str(col)] = val
        if d:
            results.append(d)
    return results


def _normalize_listing(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Map HomeHarvest column names → our standard schema."""

    def _num(v) -> Optional[float]:
        if v is None:
            return None
        try:
            import pandas as _pd

            if _pd.isna(v):
                return None
        except Exception:
            pass
        try:
            return float(str(v).replace("$", "").replace(",", ""))
        except (ValueError, TypeError):
            return None

    def _int(v) -> Optional[int]:
        n = _num(v)
        return int(n) if n is not None else None

    street = str(raw.get("street") or raw.get("full_street_line") or "").strip()
    city = str(raw.get("city") or "").strip()
    state = str(raw.get("state") or "").strip()
    zip_ = str(raw.get("zip_code") or raw.get("zip") or "").strip()
    address = f"{street}, {city}, {state} {zip_}".strip(", ")

    # Equity estimate: list_price - estimated_mortgage (rough)
    list_price = _num(raw.get("list_price") or raw.get("price"))
    zestimate = _num(raw.get("zestimate"))
    est_value = zestimate or list_price

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

    latitude = _coord("latitude")
    longitude = _coord("longitude")

    # Price-reduction signal
    reduced_amount = _num(raw.get("price_reduced_amount") or raw.get("price_change_amount"))
    price_reduction = bool(reduced_amount and reduced_amount < 0)

    # Source-specific listing URL
    listing_url = str(raw.get("property_url") or raw.get("listing_url") or "").strip() or None

    return {
        "address": address,
        "street": street,
        "city": city,
        "state": state,
        "zip": zip_,
        "county": str(raw.get("county") or "").strip() or None,
        "latitude": latitude,
        "longitude": longitude,
        "list_price": list_price,
        "zestimate": zestimate,
        "estimated_value": est_value,
        "beds": _int(raw.get("beds")),
        "baths": _num(raw.get("full_baths") or raw.get("baths")),
        "sqft": _int(raw.get("sqft")),
        "year_built": _int(raw.get("year_built")),
        "lot_sqft": _int(raw.get("lot_sqft")),
        "property_type": str(raw.get("style") or raw.get("property_type") or "").strip() or None,
        "status": str(raw.get("status") or "").strip() or None,
        "days_on_market": _int(raw.get("days_on_mls")),
        "days_on_mls": _int(raw.get("days_on_mls")),
        "price_reduction": price_reduction,
        "mls_id": str(raw.get("mls_id") or "").strip() or None,
        "zillow_url": listing_url,
        "listing_url": listing_url,
        "agent": str(raw.get("agent_name") or "").strip() or None,
        "agent_email": str(raw.get("agent_email") or "").strip() or None,
        "agent_phones": _extract_phones(raw.get("agent_phones")),
        "owner_name": str(raw.get("owner_name") or "").strip() or None,
        "source": "homeharvest",
    }


async def scrape_foreclosures(
    city: str,
    state: str = "",
    *,
    listing_type: str = "for_sale",
    site: str = "zillow",  # kept for API compat — ignored in new HH versions
    limit: int = 20,
    location: str = "",
    foreclosure_only: bool = False,
) -> List[Dict[str, Any]]:
    """
    Async wrapper around HomeHarvest's synchronous scrape_property().

    Args:
        city:             Target city (e.g. "Lubbock") OR a ZIP code (e.g. "79401")
        state:            Two-letter state code (e.g. "TX") — omit when city is a ZIP
        listing_type:     "for_sale" | "sold" | "for_rent" | "pending"
        site:             Ignored in homeharvest >= 0.5.x (kept for caller compat).
                          New versions scrape all sites automatically.
        limit:            Maximum rows to return
        location:         Override full location string (takes priority over city+state)
        foreclosure_only: Pass foreclosure=True to HomeHarvest (filters to
                          pre-foreclosure / bank-owned listings where supported)

    Returns list of normalised listing dicts.
    """
    import inspect as _inspect

    scrape_property = _import_homeharvest()
    if not scrape_property:
        return []

    if not location:
        city_clean = (city or "").strip()
        state_clean = (state or "").strip()
        location = f"{city_clean}, {state_clean}" if state_clean else city_clean

    if not location:
        log.warning("HomeHarvest: no location provided, skipping")
        return []

    # Introspect the installed API to build kwargs defensively
    sig_params = set(_inspect.signature(scrape_property).parameters)

    def _run() -> List[Dict[str, Any]]:
        kwargs: Dict[str, Any] = {"location": location}

        # listing_type — always supported
        if listing_type:
            kwargs["listing_type"] = listing_type

        # limit (new) vs results_wanted (old)
        if "limit" in sig_params:
            kwargs["limit"] = limit
        elif "results_wanted" in sig_params:
            kwargs["results_wanted"] = limit

        # site_name — removed in >= 0.5.x (ignored in new versions)
        if "site_name" in sig_params:
            kwargs["site_name"] = site

        # NOTE: Do NOT pass proxy= to HomeHarvest. Its internal requests client
        # fails SSL cert verification when routing HTTPS through an HTTP proxy
        # (the Bright Data residential proxy causes SSLError). HomeHarvest scrapes
        # Zillow/Realtor.com fine on direct connections from this host, so we let
        # it use direct egress. The residential proxy is only used for our own
        # httpx/Playwright fetches (fetch_html, fetch_crawl4ai).

        # foreclosure filter — added in >= 0.5.x
        if "foreclosure" in sig_params and foreclosure_only:
            kwargs["foreclosure"] = True

        # extra_property_data: skip sub-page enrichment for speed
        if "extra_property_data" in sig_params:
            kwargs["extra_property_data"] = False

        log.info(
            "HomeHarvest: scraping %s listings in %r (foreclosure_filter=%s)",
            listing_type,
            location,
            foreclosure_only,
        )
        try:
            df = scrape_property(**kwargs)
            raws = _df_to_listings(df)
            listings = [_normalize_listing(r) for r in raws]
            log.info("HomeHarvest: got %d listings for %r", len(listings), location)
            return listings
        except Exception as e:
            log.warning("HomeHarvest scrape failed (%s / %s): %s", listing_type, location, e)
            return []

    return await asyncio.get_event_loop().run_in_executor(None, _run)


async def scrape_multi_site(
    city: str,
    state: str,
    *,
    listing_type: str = "for_sale",
    limit_per_site: int = 10,
) -> List[Dict[str, Any]]:
    """Scrape all sources (new HH API) or Zillow+Realtor in parallel (old API)
    and de-duplicate by address."""
    # New HomeHarvest scrapes all sources automatically in one call
    combined = await scrape_foreclosures(city, state, listing_type=listing_type, limit=limit_per_site * 3)
    if combined:
        log.info("HomeHarvest multi-site: %d unique listings", len(combined))
        return combined

    # Fallback for older installs that still support site_name
    results_z, results_r = await asyncio.gather(
        scrape_foreclosures(city, state, listing_type=listing_type, site="zillow", limit=limit_per_site),
        scrape_foreclosures(
            city,
            state,
            listing_type=listing_type,
            site="realtor.com",
            limit=limit_per_site,
        ),
        return_exceptions=True,
    )

    seen: set[str] = set()
    deduped: List[Dict[str, Any]] = []
    for batch in (results_z, results_r):
        if isinstance(batch, Exception):
            log.warning("Multi-site scrape partial failure: %s", batch)
            continue
        for listing in batch:
            key = (listing.get("street") or "").lower()
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            deduped.append(listing)

    log.info("HomeHarvest multi-site (legacy): %d unique listings", len(deduped))
    return deduped


# ─── Comparable Sales (Comps) ────────────────────────────────────────────────


async def scrape_comps(
    address: str,
    *,
    max_results: int = 12,
) -> List[Dict[str, Any]]:
    """Fetch recently-sold comparable properties near an address via HomeHarvest.

    Uses listing_type="sold" to pull recent sales data.  The `address` is
    passed as the location — HomeHarvest resolves city/state from it.
    Returns a list of normalised comp dicts with the same fields that
    Propelio/Propwire produce so callers get a uniform shape regardless
    of source.
    """
    if not address or not address.strip():
        return []

    # Extract city/state from the address for best HomeHarvest results
    # HomeHarvest works best with "City, ST" as the location
    location = address.strip()
    # Remove extra whitespace
    location = " ".join(location.split())

    listings = await scrape_foreclosures(
        city=location,
        state="",
        listing_type="sold",
        limit=max_results,
    )

    # Transform listings into comp-normalised format
    comps: List[Dict[str, Any]] = []
    for li in listings:
        # Skip non-sold listings just in case
        status = (li.get("status") or "").lower()
        if status and "sold" not in status:
            continue

        comps.append({
            "address": li.get("address") or li.get("street"),
            "city": li.get("city"),
            "state": li.get("state"),
            "zip": li.get("zip") or li.get("zip_code"),
            "sold_price": li.get("list_price") or li.get("zestimate") or li.get("estimated_value"),
            "sold_date": None,
            "beds": li.get("beds"),
            "baths": li.get("baths"),
            "sqft": li.get("sqft"),
            "lot_sqft": li.get("lot_sqft"),
            "year_built": li.get("year_built"),
            "property_type": li.get("property_type") or li.get("style"),
            "source": "homeharvest",
            "raw": li,
        })

    log.info("HomeHarvest scrape_comps: %d comps for %r", len(comps), address[:60])
    return comps
