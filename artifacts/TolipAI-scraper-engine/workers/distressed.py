"""Distressed-property discovery orchestrator.

Dispatch order:
  1. County-specific scraper (workers/scrapers/counties/) — 10 counties registered
  2. Static source registry (distressed_sources.SOURCES) — aggregators
     like Fannie HomePath, Auction.com, TX/FL public-notice portals, etc.
     Fetched with http_client.fetch_rendered() + selectolax table extraction.
     Filtered by requested state and selected categories.
  3. If neither produces results → returns [] → caller sets
     status = completed_no_results

AUDIT COMPLIANCE:
  Removed:
    ✗ parse_distressed_page() LLM calls — was feeding raw HTML to LLM
    ✗ sources_for_request_ai() — hallucinated URLs via LLM

  Added / active:
    ✓ County scraper dispatch via COUNTY_SCRAPERS registry
    ✓ Static source scraping via http_client.fetch_rendered() + selectolax
    ✓ categories parameter now filters which static sources are scraped
    ✓ All results validated against DistressedListing schema before return
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from . import db
from .models import validate_listings
from .scrapers import distressed_sources as ds
from .scrapers.counties import COUNTY_SCRAPERS

log = logging.getLogger("distressed")


def _normalize_county_key(county_key: str, state: str) -> str:
    """Build the COUNTY_SCRAPERS key: {county_snake}_{state_lower}."""
    county_normalized = (county_key or "").lower().strip()
    county_normalized = county_normalized.replace(" ", "_").replace("-", "_").replace(".", "")
    state_lower = (state or "").lower().strip()
    return f"{county_normalized}_{state_lower}"


async def _run_county_scraper(scraper_key: str, days_back: int = 30) -> List[Dict[str, Any]]:
    """Run a registered county scraper and return raw listing dicts."""
    cls = COUNTY_SCRAPERS[scraper_key]
    scraper = cls()
    log.info("Running county scraper: %s", scraper_key)
    try:
        return await scraper.scrape(days_back=days_back)
    except Exception as e:
        log.warning("County scraper %s failed: %s", scraper_key, str(e)[:200])
        return []


# ─── Static-source HTML extraction (LLM-free) ────────────────────────────────

_ADDRESS_KEYWORDS = re.compile(
    r"\b(street|st|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|"
    r"way|court|ct|place|pl|circle|cir|hwy|highway|pkwy|parkway|suite|ste|"
    r"\d{3,6}\s+\w+)\b",
    re.IGNORECASE,
)

_MONEY_RE = re.compile(r"\$[\d,]+(\.\d{2})?|\d[\d,]{2,}(\.\d{2})?")

_ADDRESS_HEADER_RE = re.compile(
    r"(address|property|location|situs|parcel|legal\s+desc|street)",
    re.IGNORECASE,
)


def _looks_like_address(text: str) -> bool:
    return bool(_ADDRESS_KEYWORDS.search(text)) and len(text) > 8


def _parse_generic_table(html: str) -> List[Dict[str, str]]:
    """Extract rows from any HTML table using selectolax.
    Returns list of dicts keyed by lowercase column headers.
    """
    try:
        from selectolax.parser import HTMLParser
    except ImportError:
        return []

    tree = HTMLParser(html)
    best_rows: List[Dict[str, str]] = []

    for table in tree.css("table"):
        headers: List[str] = []
        thead = table.css_first("thead")
        if thead:
            headers = [
                th.text(strip=True).lower().replace(" ", "_")
                for th in thead.css("th,td")
                if th.text(strip=True)
            ]
        if not headers:
            first_tr = table.css_first("tr")
            if first_tr:
                headers = [
                    td.text(strip=True).lower().replace(" ", "_")
                    for td in first_tr.css("td,th")
                    if td.text(strip=True)
                ]

        if not headers:
            continue

        rows: List[Dict[str, str]] = []
        tbody = table.css_first("tbody") or table
        for tr in tbody.css("tr"):
            cells = [td.text(strip=True) for td in tr.css("td")]
            if not cells or len(cells) < 2:
                continue
            if len(cells) < len(headers):
                cells.extend([""] * (len(headers) - len(cells)))
            rows.append(dict(zip(headers, cells[: len(headers)])))

        if len(rows) > len(best_rows):
            best_rows = rows

    return best_rows


def _row_to_listing(
    row: Dict[str, str],
    src: Dict[str, Any],
    state_fallback: str,
) -> Optional[Dict[str, Any]]:
    """Convert a generic table row to a listing dict.

    Tries common column names; returns None if no address can be found.
    """
    address = (
        row.get("property_address")
        or row.get("address")
        or row.get("situs_address")
        or row.get("property")
        or row.get("location")
        or row.get("legal_description")
        or row.get("site_address")
        or row.get("prop_address")
        or ""
    ).strip()

    if not address or not _looks_like_address(address):
        for v in row.values():
            if _looks_like_address(v):
                address = v.strip()
                break

    if not address or len(address) < 6:
        return None

    state_val = src.get("state", "*")
    if state_val == "*":
        state_val = state_fallback

    sale_date_raw = (
        row.get("sale_date")
        or row.get("auction_date")
        or row.get("date")
        or row.get("filing_date")
        or row.get("recorded_date")
        or ""
    )
    sale_date: Optional[str] = None
    if sale_date_raw:
        for fmt in ("%m/%d/%Y", "%m-%d-%Y", "%Y-%m-%d", "%B %d, %Y", "%b %d, %Y"):
            try:
                sale_date = datetime.strptime(sale_date_raw.strip(), fmt).date().isoformat()
                break
            except (ValueError, AttributeError):
                continue

    opening_bid: Optional[float] = None
    bid_raw = (
        row.get("minimum_bid")
        or row.get("opening_bid")
        or row.get("bid")
        or row.get("amount")
        or row.get("taxes_due")
        or ""
    )
    if bid_raw:
        try:
            opening_bid = float(re.sub(r"[$,\s]", "", bid_raw))
        except (ValueError, TypeError):
            pass

    category = src.get("category", "")
    category_map = {
        "county_clerk": "preforeclosure",
        "public_trustee": "trustee_sale",
        "probate_court": "probate",
        "tax_assessor": "tax_lien",
        "government_reo": "reo",
        "auction_aggregator": "auction",
    }
    distress_type = category_map.get(category, category or "unknown")

    return {
        "address": address,
        "city": (row.get("city") or "").strip() or None,
        "state": state_val.upper() if state_val else None,
        "zip": (row.get("zip") or row.get("zip_code") or "").strip() or None,
        "county": (row.get("county") or src.get("name", "")).strip() or None,
        "case_number": (
            row.get("case_number")
            or row.get("cause_number")
            or row.get("instrument")
            or row.get("case#")
            or ""
        ).strip()
        or None,
        "owner_name": (
            row.get("owner") or row.get("owner_name") or row.get("grantor") or row.get("defendant") or ""
        ).strip()
        or None,
        "sale_date": sale_date,
        "sale_type": distress_type,
        "opening_bid": opening_bid,
        "source_url": src.get("url", ""),
        "source": src.get("key", "static"),
        "scraped_at": datetime.utcnow().isoformat(),
    }


async def _fetch_and_parse_source(src: Dict[str, Any], state: str) -> List[Dict[str, Any]]:
    """Fetch one static source URL with http_client.fetch_rendered() and extract listings."""
    url = src.get("url", "")
    key = src.get("key", "?")
    if not url or "{" in url:
        log.debug("[static] Skipping parameterized URL: %s", url)
        return []

    render = src.get("render", False)
    log.info("[static] Fetching source %s → %s (render=%s)", key, url, render)
    try:
        if render:
            from .http_client import fetch_crawl4ai

            html = await asyncio.wait_for(
                fetch_crawl4ai(url, use_proxy=True),
                timeout=60,
            )
        else:
            from .http_client import fetch_direct

            html = await asyncio.wait_for(
                fetch_direct(url, use_proxy=True),
                timeout=30,
            )
    except asyncio.TimeoutError:
        log.warning("[static] Timeout fetching %s", key)
        return []
    except Exception as e:
        log.warning("[static] Failed to fetch %s: %s", key, str(e)[:120])
        return []

    if not html or len(html) < 200:
        log.info("[static] %s returned empty/tiny response", key)
        return []

    rows = _parse_generic_table(html)
    if not rows:
        log.info("[static] %s → no table rows found (page may need form interaction)", key)
        return []

    results: List[Dict[str, Any]] = []
    for row in rows:
        listing = _row_to_listing(row, src, state)
        if listing:
            results.append(listing)

    log.info("[static] %s → %d raw listings from table", key, len(results))
    return results


async def _scrape_static_sources(
    state: str,
    categories: Optional[List[str]],
    zip_code: str = "",
    max_sources: int = 8,
) -> List[Dict[str, Any]]:
    """Scrape static registry sources for the requested state + categories.

    Uses ds.sources_for_request() to select relevant URLs, then fetches each
    with fetch_rendered() and extracts table data with selectolax.
    LLM-free — no AI calls.
    """
    sources = ds.sources_for_request(categories=categories, state=state)
    if not sources:
        log.info("[static] No sources found for state=%s categories=%s", state, categories)
        return []

    to_run = sources[:max_sources]
    log.info(
        "[static] Running %d static sources for state=%s (cats=%s): %s",
        len(to_run),
        state,
        categories,
        [s["key"] for s in to_run],
    )

    sem = asyncio.Semaphore(3)

    async def _bounded(src: Dict[str, Any]) -> List[Dict[str, Any]]:
        async with sem:
            return await _fetch_and_parse_source(src, state)

    batches = await asyncio.gather(*[_bounded(s) for s in to_run], return_exceptions=True)
    results: List[Dict[str, Any]] = []
    for batch in batches:
        if isinstance(batch, list):
            results.extend(batch)

    log.info("[static] Total from static sources: %d raw listings", len(results))
    return results


# ─── Main orchestrator ────────────────────────────────────────────────────────


async def find_distressed(
    *,
    zip_code: str = "",
    county_key: str = "",
    state: str = "",
    categories: Optional[List[str]] = None,
    source_keys: Optional[List[str]] = None,
    job_id: Optional[str] = None,
    campaign_id: Optional[int] = None,
    progress_cb=None,
) -> List[Dict[str, Any]]:
    """Run a distressed-property scrape.

    Routes to county-specific scrapers when available, then also runs the
    static source registry for the requested state/categories.

    Zero results → caller in main.py sets status = completed_no_results.
    """
    state_upper = (state or "").upper().strip()
    county_normalized = (county_key or "").lower().strip()

    if progress_cb:
        await progress_cb(5, "Identifying available data sources…")

    results: List[Dict[str, Any]] = []

    # ── 1. Explicit source_keys override ──────────────────────────────────────
    if source_keys:
        log.info("Distressed: using explicit source_keys=%s", source_keys)
        county_srcs = [k for k in source_keys if k in COUNTY_SCRAPERS]
        for key in county_srcs:
            batch = await _run_county_scraper(key)
            results.extend(batch)
        if progress_cb:
            await progress_cb(
                40, f"Scraped {len(county_srcs)} explicit county sources → {len(results)} raw listings"
            )

    # ── 2. County scraper dispatch ────────────────────────────────────────────
    else:
        scraper_key = _normalize_county_key(county_normalized, state_upper)

        if scraper_key in COUNTY_SCRAPERS:
            if progress_cb:
                await progress_cb(10, f"Running county scraper: {scraper_key}…")
            batch = await _run_county_scraper(scraper_key)
            results.extend(batch)
            log.info("County scraper %s → %d raw listings", scraper_key, len(batch))

        else:
            # Try all scrapers that match the state when no county was specified
            state_scrapers = (
                [k for k in COUNTY_SCRAPERS if k.endswith(f"_{state_upper.lower()}")] if state_upper else []
            )

            if state_scrapers:
                log.info(
                    "No county scraper for key '%s' — running all %d scrapers for state %s: %s",
                    scraper_key,
                    len(state_scrapers),
                    state_upper,
                    state_scrapers,
                )
                if progress_cb:
                    await progress_cb(10, f"Running {len(state_scrapers)} county scrapers for {state_upper}…")

                sem = asyncio.Semaphore(3)

                async def _bounded_county(key: str) -> List[Dict[str, Any]]:
                    async with sem:
                        return await _run_county_scraper(key)

                batches = await asyncio.gather(
                    *[_bounded_county(k) for k in state_scrapers],
                    return_exceptions=True,
                )
                for batch in batches:
                    if isinstance(batch, list):
                        results.extend(batch)

            else:
                log.info(
                    "No county scraper registered for '%s' (state=%s, county=%s) — "
                    "will rely on static source registry.",
                    scraper_key,
                    state_upper,
                    county_normalized,
                )

    county_count = len(results)
    if progress_cb:
        await progress_cb(40, f"County scrapers done — {county_count} listings; running static sources…")

    # ── 3. Static source registry (always runs — supplements county scrapers) ─
    # Scrapes URLs from distressed_sources.SOURCES filtered by state + categories.
    # Uses fetch_rendered() + selectolax for LLM-free extraction.
    if state_upper:
        try:
            static_results = await _scrape_static_sources(
                state=state_upper,
                categories=categories,
                zip_code=zip_code,
                max_sources=8,
            )
            results.extend(static_results)
            log.info(
                "Static sources → %d additional listings (total before dedup: %d)",
                len(static_results),
                len(results),
            )
        except Exception as e:
            log.warning("Static source scraping failed (non-fatal): %s", str(e)[:200])

    if progress_cb:
        await progress_cb(70, f"All sources done — {len(results)} raw listings collected")

    # ── 4. Filter by zip_code if provided ────────────────────────────────────
    if zip_code and results:
        zip_prefix = zip_code[:3]
        before = len(results)
        results = [r for r in results if not r.get("zip") or str(r.get("zip", "")).startswith(zip_prefix)]
        if before != len(results):
            log.info("ZIP filter (%s): %d → %d listings", zip_code, before, len(results))

    # ── 5. Validate against DistressedListing schema ──────────────────────────
    validated = validate_listings(results)
    dropped = len(results) - len(validated)
    if dropped:
        log.info("Schema validation: dropped %d invalid records, kept %d", dropped, len(validated))

    # ── 6. De-duplicate by (address, zip) ────────────────────────────────────
    seen: set[tuple[str, Optional[str]]] = set()
    deduped: List[Dict[str, Any]] = []
    for item in [v.model_dump() for v in validated]:
        addr = (item.get("address") or "").strip().lower()
        if not addr:
            continue
        key = (addr, item.get("zip"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)

    log.info("Distressed: %d unique validated listings after de-dup", len(deduped))

    if progress_cb:
        await progress_cb(90, f"De-duped to {len(deduped)} unique listings — saving…")

    # ── 7. Persist ────────────────────────────────────────────────────────────
    if job_id and deduped:
        try:
            saved = await db.insert_distressed_listings(job_id, deduped, campaign_id=campaign_id)
            log.info(
                "Distressed: inserted %d rows into distressed_listings for job %s",
                saved,
                job_id,
            )
        except Exception as e:
            log.error("Distressed: DB insert failed for job %s: %s", job_id, str(e)[:300])
            raise

    if progress_cb:
        await progress_cb(100, f"Done — {len(deduped)} listings found")

    return deduped


def list_sources(state: Optional[str] = None) -> List[Dict[str, Any]]:
    return ds.list_sources(state=state)


def list_categories() -> List[Dict[str, str]]:
    return ds.list_categories()
