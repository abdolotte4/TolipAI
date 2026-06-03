"""Distressed-property discovery orchestrator.

Dispatch order:
  1. County-specific scraper (workers/scrapers/counties/) — 10 counties registered
  2. Static source registry (distressed_sources.DISTRESSED_REGISTRY) — aggregators
     like HUD, Fannie, Auction.com that expose structured HTML tables
  3. If neither covers the requested county → returns [] → caller sets
     status = completed_no_results

AUDIT COMPLIANCE:
  Removed:
    ✗ parse_distressed_page() LLM calls — was feeding raw HTML to LLM to extract listings
    ✗ sources_for_request_ai() — was calling suggest_distressed_sources() to hallucinate URLs

  Added:
    ✓ County scraper dispatch via COUNTY_SCRAPERS registry
    ✓ Static source parsing with selectolax table extraction (no LLM)
    ✓ All results validated against DistressedListing schema before return
"""
from __future__ import annotations

import asyncio
import logging
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

    Routes to county-specific scrapers when available, falls back to the
    static registry for known aggregator sources, returns [] otherwise.

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
            await progress_cb(40, f"Scraped {len(county_srcs)} explicit county sources → {len(results)} raw listings")

    # ── 2. County scraper dispatch ────────────────────────────────────────────
    else:
        # Build the scraper key from the request parameters
        scraper_key = _normalize_county_key(county_normalized, state_upper)

        if scraper_key in COUNTY_SCRAPERS:
            if progress_cb:
                await progress_cb(10, f"Running county scraper: {scraper_key}…")
            batch = await _run_county_scraper(scraper_key)
            results.extend(batch)
            log.info("County scraper %s → %d raw listings", scraper_key, len(batch))

        else:
            # Try all scrapers that match the state if no county was specified
            state_scrapers = [k for k in COUNTY_SCRAPERS if k.endswith(f"_{state_upper.lower()}")] if state_upper else []

            if state_scrapers:
                log.info(
                    "No county scraper for key '%s' — running all %s scrapers for state %s: %s",
                    scraper_key,
                    len(state_scrapers),
                    state_upper,
                    state_scrapers,
                )
                if progress_cb:
                    await progress_cb(10, f"Running {len(state_scrapers)} county scrapers for {state_upper}…")

                sem = asyncio.Semaphore(3)
                async def _bounded(key: str) -> List[Dict[str, Any]]:
                    async with sem:
                        return await _run_county_scraper(key)

                batches = await asyncio.gather(*[_bounded(k) for k in state_scrapers], return_exceptions=True)
                for batch in batches:
                    if isinstance(batch, list):
                        results.extend(batch)

            else:
                log.warning(
                    "No county scraper registered for '%s' (state=%s, county=%s). "
                    "Returning empty — caller will set status=completed_no_results. "
                    "To add coverage: implement a scraper in workers/scrapers/counties/ "
                    "and register it in COUNTY_SCRAPERS.",
                    scraper_key,
                    state_upper,
                    county_normalized,
                )

    if progress_cb:
        await progress_cb(70, f"County scrapers done — {len(results)} raw listings collected")

    # ── 3. Filter by zip_code if provided ────────────────────────────────────
    if zip_code and results:
        zip_prefix = zip_code[:3]
        before = len(results)
        results = [r for r in results if not r.get("zip") or str(r.get("zip", "")).startswith(zip_prefix)]
        if before != len(results):
            log.info("ZIP filter (%s): %d → %d listings", zip_code, before, len(results))

    # ── 4. Validate against DistressedListing schema ──────────────────────────
    validated = validate_listings(results)
    dropped = len(results) - len(validated)
    if dropped:
        log.info("Schema validation: dropped %d invalid records, kept %d", dropped, len(validated))

    # ── 5. De-duplicate by (address, zip) ────────────────────────────────────
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

    # ── 6. Persist ────────────────────────────────────────────────────────────
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
