"""Cash-buyer discovery orchestrator.

Workflow per lead:
  1. Pull recent sold properties from Zillow + Redfin (free, always run).
  2. Enhance with county deed records (real grantee/buyer names from public records).
  3. Group by buyer (mailing address ≠ property address ⇒ likely investor).
     Each unique buyer becomes a candidate.
  4. Skip-trace each candidate (LLC → officers → phones/emails).
  5. Rule-based buyer type classification (purchase volume, LLC name, avg price).
  6. Rule-based match scoring (geographic + price bracket + volume).
  7. Persist matches sorted by score.

AUDIT COMPLIANCE:
  Removed LLM calls:
    ✗ extract_investor_profile() — was scraping people-search sites + LLM
    ✗ score_buyer_match()        — was sending buyer+lead data to LLM for scoring

  Added data-driven replacements:
    ✓ classify_buyer_type()             — rule-based from purchase history
    ✓ score_buyer_match_rule_based()    — geographic + price bracket scoring
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict, List, Optional

from . import db
from .llm import classify_buyer_type, score_buyer_match_rule_based
from .scrapers import redfin, zillow
from .scrapers.county_deeds import fetch_recent_deeds
from .skip_trace import trace as skip_trace

log = logging.getLogger("cash_buyers")


def _aggregate_by_buyer(properties: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Group properties by buyer (proxied by owner_name → mailing_address)."""
    by_buyer: Dict[str, Dict[str, Any]] = {}
    for p in properties:
        # County deeds and ATTOM provide real buyer names via owner_name/buyer_name/grantee.
        # Zillow/Redfin rarely expose buyer identity, so we use the address as key
        # to group re-purchases by the same investor (same property = same entity).
        real_name = p.get("owner_name") or p.get("buyer_name") or p.get("grantee")
        addr_part = (p.get("address") or "").split(",")[0].strip()
        key = real_name or f"investor::{p.get('zip')}::{addr_part}"
        # Display name: prefer real name, fall back to a descriptive placeholder
        display_name = real_name or (f"Investor — {p.get('city') or p.get('zip') or 'Unknown Area'}")
        b = by_buyer.setdefault(
            key,
            {
                "buyer_name": display_name,
                "city": p.get("city"),
                "state": p.get("state"),
                "zip": p.get("zip"),
                "purchases": [],
                "prices": [],
                "last_purchase_date": None,
            },
        )
        b["purchases"].append(p)
        if p.get("price"):
            try:
                b["prices"].append(float(str(p["price"]).replace("$", "").replace(",", "")))
            except Exception:
                pass
        if p.get("sold_date") and (not b["last_purchase_date"] or p["sold_date"] > b["last_purchase_date"]):
            b["last_purchase_date"] = p["sold_date"]
    return by_buyer


async def find_cash_buyers(
    lead: Dict[str, Any],
    *,
    max_buyers: int = 50,
    job_id: Optional[str] = None,
    progress_cb=None,
) -> List[Dict[str, Any]]:
    """Run the full cash-buyer discovery pipeline for a lead."""
    zip_code = lead.get("zip") or ""
    city = lead.get("city") or ""
    state = lead.get("state") or ""

    # ── Tier 1: Zillow + Redfin (free, always run as primary source) ──────────
    sold_zillow: List[Dict[str, Any]] = []
    sold_redfin: List[Dict[str, Any]] = []
    if progress_cb:
        await progress_cb(10, "Scanning recent sales (Zillow)…")
    try:
        sold_zillow = await zillow.fetch_recently_sold(
            zip_code=zip_code, city=city, state=state, max_results=80
        )
        log.info("Zillow: %d sold records", len(sold_zillow))
    except Exception as e:
        log.info("Zillow failed, continuing: %s", e)

    if progress_cb:
        await progress_cb(20, "Scanning recent sales (Redfin)…")
    try:
        sold_redfin = await redfin.fetch_recently_sold(
            zip_code=zip_code, city=city, state=state, max_results=80
        )
        log.info("Redfin: %d sold records", len(sold_redfin))
    except Exception as e:
        log.info("Redfin failed, continuing: %s", e)

    # ── Tier 2: County deed records (enhancement — real grantee/buyer names)
    sold_deeds: List[Dict[str, Any]] = []
    if progress_cb:
        await progress_cb(30, "Pulling county deed transfer records…")
    try:
        raw_deeds = await fetch_recent_deeds(
            state=state or "",
            city=city or "",
            zip_code=zip_code or "",
            max_results=80,
        )
        for d in raw_deeds:
            if not d.get("grantee"):
                continue
            sold_deeds.append(
                {
                    "address": d.get("address"),
                    "city": d.get("city"),
                    "state": d.get("state"),
                    "zip": d.get("zip"),
                    "price": d.get("price"),
                    "sold_date": d.get("sold_date"),
                    "owner_name": d["grantee"],
                    "buyer_name": d["grantee"],
                    "seller_name": d.get("grantor"),
                    "parcel_id": d.get("parcel_id"),
                    "source": d.get("source", "county_deeds"),
                }
            )
        log.info("County deeds: %d records with real buyer names", len(sold_deeds))
    except Exception as e:
        log.info("County deed scrape failed, continuing: %s", e)

    # Combine all sources — Zillow/Redfin as primary, county deeds as enhancement
    all_sales = sold_zillow + sold_redfin + sold_deeds
    log.info(
        "Found %d recent sales (%d Zillow + %d Redfin + %d Deeds) for ZIP=%s city=%s",
        len(all_sales),
        len(sold_zillow),
        len(sold_redfin),
        len(sold_deeds),
        zip_code,
        city,
    )

    # ── Tier 3: Broader city+state fallback when ZIP-level search returns nothing ──
    if not all_sales and city and state:
        if progress_cb:
            await progress_cb(40, f"No ZIP-level results — broadening to {city}, {state}…")
        log.info(
            "Cash buyers: ZIP=%s returned 0 results, retrying with city=%s state=%s only",
            zip_code,
            city,
            state,
        )
        broad_zillow = await zillow.fetch_recently_sold(
            zip_code="", city=city, state=state, max_results=80
        )
        broad_redfin = await redfin.fetch_recently_sold(
            zip_code="", city=city, state=state, max_results=80
        )
        all_sales = broad_zillow + broad_redfin
        log.info(
            "Broad fallback: %d Zillow + %d Redfin for city=%s state=%s",
            len(broad_zillow),
            len(broad_redfin),
            city,
            state,
        )

    if not all_sales:
        log.warning(
            "Cash buyers: no recent sales found for ZIP=%s city=%s state=%s — "
            "check that the lead has a valid zip/city/state",
            zip_code,
            city,
            state,
        )
        return []

    by_buyer = _aggregate_by_buyer(all_sales)
    candidates = list(by_buyer.values())

    # Sort candidates by # purchases (heaviest investors first)
    candidates.sort(key=lambda b: len(b["purchases"]), reverse=True)
    candidates = candidates[:max_buyers]

    if progress_cb:
        await progress_cb(50, f"Classifying {len(candidates)} candidate buyers…")

    # Semaphore caps concurrent skip-trace calls so we don't hammer free-tier rate limits.
    _sem = asyncio.Semaphore(int(os.getenv("BUYER_CONCURRENCY", "5")))

    async def _profile_one(cand: Dict[str, Any]) -> Dict[str, Any]:
        async with _sem:
            prices = cand.get("prices") or []
            avg_price = sum(prices) / len(prices) if prices else None
            purchase_count = len(cand["purchases"])

            # ── Rule-based classification (replaces LLM extract_investor_profile) ──
            classification = classify_buyer_type(
                buyer_name=cand["buyer_name"],
                purchase_count=purchase_count,
                avg_price=avg_price,
                prices=prices,
            )

            # Calculate llc_name BEFORE building profile
            llc_name = (
                cand["buyer_name"]
                if str(cand["buyer_name"])
                .upper()
                .endswith(("LLC", "INC", "CORP", "LP", "LLP", "LTD", "TRUST"))
                else None
            )

            profile: Dict[str, Any] = {
                "buyer_name": cand["buyer_name"],
                "llc_name": llc_name,
                "buyer_type": classification["buyer_type"],
                "classification_reason": classification["classification_reason"],
                "city": cand.get("city"),
                "state": cand.get("state"),
                "zip": cand.get("zip"),
                "portfolio_size": purchase_count,
                "portfolio_value": sum(prices) if prices else None,
                "avg_purchase_price": avg_price,
                "last_purchase_date": cand.get("last_purchase_date"),
                "phones": [],
                "emails": [],
                "principals": [],
                "mailing_address": None,
            }

            # ── Skip-trace via SOS / OpenCorporates / SEC EDGAR / PropertyAPI ──
            try:
                traced = await skip_trace(
                    cand["buyer_name"],
                    llc=llc_name,
                    state=cand.get("state"),
                )
                profile["phones"] = list(set(traced.get("phones", [])))
                profile["emails"] = list(set(traced.get("emails", [])))
                if traced.get("principals"):
                    profile["principals"] = traced["principals"]
                if traced.get("addresses"):
                    profile["mailing_address"] = traced["addresses"][0]
            except Exception as e:
                log.info("Skip-trace failed for %s: %s", cand["buyer_name"], e)

            # ── Rule-based match scoring (replaces LLM score_buyer_match) ──
            scoring = score_buyer_match_rule_based(profile, lead)

            return {
                **profile,
                "match_score": scoring["match_score"],
                "match_reasons": scoring["match_reasons"],
                "raw_data": {"purchases": cand["purchases"][:8]},
                "source": "scraper-engine",
            }

    results = await asyncio.gather(*[_profile_one(c) for c in candidates], return_exceptions=True)

    out: List[Dict[str, Any]] = []
    for i, res in enumerate(results):
        if isinstance(res, Exception):
            log.warning("Buyer profiling failed for candidate %d: %s", i, res)
            continue
        out.append(res)
        if progress_cb and (i + 1) % 3 == 0:
            pct = 50 + int(40 * (i + 1) / max(len(candidates), 1))
            await progress_cb(pct, f"Profiled {i + 1}/{len(candidates)} buyers")

    out.sort(key=lambda r: r.get("match_score", 0), reverse=True)

    # Persist — pass lead["id"] as-is (db coerces to str to match TEXT column)
    if job_id and lead.get("id"):
        try:
            saved = await db.insert_cash_buyer_matches(job_id, lead["id"], out)
            log.info(
                "Cash buyers: inserted %d rows for lead %s job %s",
                saved,
                lead["id"],
                job_id,
            )
        except Exception as e:
            log.error("Cash buyers: DB insert failed for job %s: %s", job_id, str(e)[:300])

    if progress_cb:
        await progress_cb(100, f"Done — {len(out)} buyers found")

    return out
