"""Cash-buyer discovery orchestrator.

Workflow per lead:
  1. Pull recently-sold properties in the lead's ZIP / county (Zillow + Redfin).
  2. Group by buyer (mailing address ≠ property address ⇒ likely investor).
     Each unique buyer becomes a candidate.
  3. Skip-trace each candidate (LLC → officers → phones/emails).
  4. Use Kimi to classify each candidate (flipper/landlord/hedge_fund/lender/
     wholesaler) based on portfolio behaviour.
  5. Use Kimi to score how well each buyer matches THIS lead.
  6. Persist matches sorted by score.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any, Dict, List, Optional

from . import db
from .llm import extract_investor_profile, score_buyer_match
from .scrapers import zillow, redfin, attom
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
        display_name = real_name or (
            f"Investor — {p.get('city') or p.get('zip') or 'Unknown Area'}"
        )
        b = by_buyer.setdefault(key, {
            "buyer_name": display_name,
            "city": p.get("city"), "state": p.get("state"), "zip": p.get("zip"),
            "purchases": [], "prices": [], "last_purchase_date": None,
        })
        b["purchases"].append(p)
        if p.get("price"):
            try:
                b["prices"].append(float(str(p["price"]).replace("$", "").replace(",", "")))
            except Exception:  # noqa: BLE001
                pass
        if p.get("sold_date") and (not b["last_purchase_date"] or p["sold_date"] > b["last_purchase_date"]):
            b["last_purchase_date"] = p["sold_date"]
    return by_buyer


async def find_cash_buyers(lead: Dict[str, Any], *, max_buyers: int = 50,
                           job_id: Optional[str] = None,
                           progress_cb=None) -> List[Dict[str, Any]]:
    """Run the full cash-buyer discovery pipeline for a lead."""
    zip_code = lead.get("zip")
    city = lead.get("city") or ""
    state = lead.get("state") or ""

    # ── Tier 1: ATTOM (paid, accurate — has real owner names) ───────────────
    sold_attom: List[Dict[str, Any]] = []
    if progress_cb:
        await progress_cb(5, "Trying ATTOM Data API for recent sales…")
    try:
        sold_attom = await attom.recent_sales(zip_code=zip_code, city=city,
                                              state=state, max_results=80)
    except Exception as e:  # noqa: BLE001
        log.info("ATTOM unavailable / exhausted, falling back to free scrape: %s", e)

    # ── Tier 2: County deed records (real grantee/buyer names from public records)
    sold_deeds: List[Dict[str, Any]] = []
    if progress_cb:
        await progress_cb(12, "Pulling county deed transfer records…")
    try:
        raw_deeds = await fetch_recent_deeds(
            state=state or "",
            city=city or "",
            zip_code=zip_code or "",
            max_results=80,
        )
        # Normalise to the same shape as ATTOM/Zillow rows
        for d in raw_deeds:
            if not d.get("grantee"):
                continue
            sold_deeds.append({
                "address":   d.get("address"),
                "city":      d.get("city"),
                "state":     d.get("state"),
                "zip":       d.get("zip"),
                "price":     d.get("price"),
                "sold_date": d.get("sold_date"),
                "owner_name": d["grantee"],   # <-- real buyer name
                "buyer_name": d["grantee"],
                "seller_name": d.get("grantor"),
                "parcel_id": d.get("parcel_id"),
                "source":    d.get("source", "county_deeds"),
            })
        log.info("County deeds: %d records with real buyer names", len(sold_deeds))
    except Exception as e:  # noqa: BLE001
        log.info("County deed scrape failed, continuing: %s", e)

    # ── Tier 3: free scrape (Zillow + Redfin) — always run as backfill ─────
    if progress_cb:
        await progress_cb(22, "Scanning recent sales (Zillow)…")
    sold_zillow = await zillow.fetch_recently_sold(zip_code=zip_code, city=city,
                                                  state=state, max_results=80)
    if progress_cb:
        await progress_cb(35, "Scanning recent sales (Redfin)…")
    sold_redfin = await redfin.fetch_recently_sold(zip_code=zip_code, city=city,
                                                  state=state, max_results=80)

    # Deeds first so real names take priority in aggregation
    all_sales = sold_attom + sold_deeds + sold_zillow + sold_redfin
    log.info("Found %d recent sales (%d ATTOM + %d Deeds + %d Zillow + %d Redfin) for ZIP=%s",
             len(all_sales), len(sold_attom), len(sold_deeds),
             len(sold_zillow), len(sold_redfin), zip_code)

    if not all_sales:
        return []

    by_buyer = _aggregate_by_buyer(all_sales)
    candidates = list(by_buyer.values())

    # Sort candidates by # purchases (heaviest investors first)
    candidates.sort(key=lambda b: len(b["purchases"]), reverse=True)
    candidates = candidates[:max_buyers]

    if progress_cb:
        await progress_cb(50, f"Classifying {len(candidates)} candidate buyers…")

    out: List[Dict[str, Any]] = []
    for i, cand in enumerate(candidates):
        # Build the profile blob the LLM will reason over
        sample_text = (
            f"Buyer: {cand['buyer_name']} ({cand['city']}, {cand['state']} {cand['zip']})\n"
            f"Recent purchases: {len(cand['purchases'])}\n"
            + "\n".join(
                f"- {p.get('address')} {p.get('city')} ${p.get('price')} "
                f"sold {p.get('sold_date')} {p.get('beds')}bd/{p.get('baths')}ba {p.get('sqft')}sqft"
                for p in cand["purchases"][:8]
            )
        )

        try:
            profile = await extract_investor_profile(sample_text, source="aggregated_sales")
        except Exception as e:  # noqa: BLE001
            log.warning("LLM profile extract failed for %s: %s", cand["buyer_name"], e)
            profile = {"buyer_name": cand["buyer_name"], "buyer_type": "unknown"}

        # Skip trace
        try:
            traced = await skip_trace(
                profile.get("buyer_name") or cand["buyer_name"],
                llc=profile.get("llc_name"),
                state=cand.get("state"),
            )
            profile["phones"] = list(set((profile.get("phones") or []) + traced.get("phones", [])))
            profile["emails"] = list(set((profile.get("emails") or []) + traced.get("emails", [])))
            if traced.get("principals"):
                profile["principals"] = traced["principals"]
            if traced.get("addresses") and not profile.get("mailing_address"):
                profile["mailing_address"] = traced["addresses"][0]
        except Exception as e:  # noqa: BLE001
            log.info("Skip-trace failed for %s: %s", cand["buyer_name"], e)

        # Match scoring vs this lead
        try:
            scoring = await score_buyer_match(profile, lead)
        except Exception as e:  # noqa: BLE001
            log.info("Match-scoring failed: %s", e)
            scoring = {"match_score": len(cand["purchases"]) * 5,
                       "match_reasons": [f"{len(cand['purchases'])} recent purchases in ZIP"]}

        prices = cand.get("prices") or []
        record = {
            **profile,
            "portfolio_size": profile.get("portfolio_size") or len(cand["purchases"]),
            "portfolio_value": profile.get("portfolio_value") or (sum(prices) if prices else None),
            "avg_purchase_price": profile.get("avg_purchase_price") or
                (sum(prices) / len(prices) if prices else None),
            "last_purchase_date": profile.get("last_purchase_date") or cand.get("last_purchase_date"),
            "city": profile.get("city") or cand.get("city"),
            "state": profile.get("state") or cand.get("state"),
            "zip": profile.get("zip") or cand.get("zip"),
            "match_score": scoring["match_score"],
            "match_reasons": scoring["match_reasons"],
            "raw_data": {"purchases": cand["purchases"][:8]},
            "source": "scraper-engine",
        }
        out.append(record)

        if progress_cb and (i + 1) % 3 == 0:
            pct = 50 + int(40 * (i + 1) / max(len(candidates), 1))
            await progress_cb(pct, f"Profiled {i + 1}/{len(candidates)} buyers")

    out.sort(key=lambda r: r.get("match_score", 0), reverse=True)

    # Persist — pass lead["id"] as-is (db coerces to str to match TEXT column)
    if job_id and lead.get("id"):
        await db.insert_cash_buyer_matches(job_id, lead["id"], out)

    if progress_cb:
        await progress_cb(95, "Saving matches…")

    return out
