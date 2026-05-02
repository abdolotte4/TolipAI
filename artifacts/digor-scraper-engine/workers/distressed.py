"""Distressed-property discovery orchestrator.

Replaces the paid ATTOM/PropertyAPI "Distressed Lead Finder" by scraping
6 free public-record source categories in parallel:

  1. County Clerk & Recorder    — Lis Pendens / Pre-foreclosure
  2. Public Trustee Sites       — Active foreclosure auctions
  3. Probate / Civil Court      — Probate / inherited property
  4. Tax Assessor & Treasurer   — Tax-delinquent / vacant
  5. Government REO Portals     — HUD / Fannie / Freddie / VA / USDA
  6. Auction aggregators        — Auction.com, Hubzu, Xome (+Zillow FSBO)

Each source is fetched through the tiered http_client (ScraperAPI →
ScrapingBee → direct/proxy), then Kimi K2 extracts structured rows from
the markdown.  Results are de-duped, geo-tagged, and persisted.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

from bs4 import BeautifulSoup

from . import db
from .http_client import fetch_html
from .llm import parse_distressed_page
from .scrapers import distressed_sources as ds

log = logging.getLogger("distressed")


async def _scrape_source(src: Dict[str, Any], *, zip_code: str = "",
                         state: str = "") -> List[Dict[str, Any]]:
    """Fetch one source and ask the LLM to extract listings."""
    from datetime import date
    today = date.today().strftime("%m/%d/%Y")
    url = (src["url"]
           .replace("{zip}", zip_code or "")
           .replace("{state}", (state or "").lower())
           .replace("{date}", today))
    try:
        html = await fetch_html(url, render=src.get("render", False))
    except Exception as e:  # noqa: BLE001
        log.warning("Source %s fetch failed: %s", src["key"], e)
        return []

    text = BeautifulSoup(html, "lxml").get_text("\n", strip=True)[:9000]
    cat = ds.CATEGORY_META.get(src["category"], {})
    listings = await parse_distressed_page(
        text, source=f"{src['name']} ({src.get('notes','')})",
    )

    for l in listings:
        l.setdefault("distress_type", cat.get("distress_type", "unknown"))
        l.setdefault("source", src["key"])
        l.setdefault("source_url", url)
        l.setdefault("state", state or src.get("state"))
        if zip_code and not l.get("zip"):
            l["zip"] = zip_code
        l["raw_data"] = {**(l.get("raw_data") or {}),
                         "category": src["category"], "source_key": src["key"]}
    return listings


async def find_distressed(*, zip_code: str = "", county_key: str = "",
                          state: str = "",
                          categories: Optional[List[str]] = None,
                          source_keys: Optional[List[str]] = None,
                          job_id: Optional[str] = None,
                          campaign_id: Optional[int] = None,
                          progress_cb=None) -> List[Dict[str, Any]]:
    """Run a multi-source distressed scrape.

    Either pick categories (fan-out across all matching sources) or specify
    explicit source_keys.  `state` filters which state-specific sources run.
    """
    # Resolve source list
    if source_keys:
        srcs = [s for s in (ds.get_source(k) for k in source_keys) if s]
    else:
        srcs = ds.sources_for_request(categories=categories, state=state, zip_code=zip_code)
        # Always include the catch-all aggregators when state is provided
        if state and not categories:
            srcs += ds.list_sources(category="auction_aggregator")

    # de-dupe by key
    seen_keys: set[str] = set()
    unique_srcs: List[Dict[str, Any]] = []
    for s in srcs:
        if s["key"] not in seen_keys:
            seen_keys.add(s["key"])
            unique_srcs.append(s)
    srcs = unique_srcs

    if progress_cb:
        await progress_cb(10, f"Scanning {len(srcs)} free public-record sources in parallel…")

    log.info("Distressed scrape: %d sources for state=%s zip=%s",
             len(srcs), state or "*", zip_code or "*")

    # Fan out — but cap concurrency so we don't melt the proxy pool
    sem = asyncio.Semaphore(6)

    async def _bounded(src):
        async with sem:
            return src["key"], await _scrape_source(src, zip_code=zip_code, state=state)

    results: List[Dict[str, Any]] = []
    completed = 0
    for fut in asyncio.as_completed([_bounded(s) for s in srcs]):
        key, batch = await fut
        completed += 1
        if batch:
            log.info("  ✓ %s → %d listings", key, len(batch))
            results.extend(batch)
        if progress_cb:
            pct = 10 + int(75 * completed / max(len(srcs), 1))
            await progress_cb(pct, f"{completed}/{len(srcs)} sources done — {len(results)} listings so far")

    # de-dupe by (address, zip)
    seen: set[tuple[str, Optional[str]]] = set()
    deduped: List[Dict[str, Any]] = []
    for l in results:
        addr = (l.get("address") or "").strip().lower()
        if not addr:
            continue
        key = (addr, l.get("zip"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(l)

    if progress_cb:
        await progress_cb(90, f"De-duped to {len(deduped)} unique listings — saving…")

    if job_id:
        await db.insert_distressed_listings(job_id, deduped, campaign_id=campaign_id)
    return deduped


def list_sources(state: Optional[str] = None) -> List[Dict[str, Any]]:
    return ds.list_sources(state=state)


def list_categories() -> List[Dict[str, str]]:
    return ds.list_categories()
