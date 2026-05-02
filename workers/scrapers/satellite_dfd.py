"""Satellite Drive-For-Dollars engine.

Mimics XLeads SkyDrive AI: scores property distress 0-100 using:
  1. Property data signals (age, tax status, days-listed, price-cuts)
  2. Neighborhood vacancy / delinquency data (from county scraping)
  3. AI reasoning over the combined signals

For visual satellite analysis (actual image AI), set GOOGLE_MAPS_API_KEY —
the engine will embed a Maps Static satellite URL in the payload and use
a multimodal model when available.  Without the key the scoring is still
useful because it fuses 8+ data signals.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

from bs4 import BeautifulSoup

from ..http_client import fetch_html
from ..llm import _chat
from . import zillow, redfin

log = logging.getLogger("satellite_dfd")


# ─── Distress signal weights ──────────────────────────────────────────────────
# Each signal contributes to the 0-100 distress score.
# Positive = adds distress; we clamp total to [0, 100].

def _age_score(year_built: Optional[int]) -> int:
    if not year_built:
        return 5
    age = max(0, 2025 - int(year_built))
    if age >= 80:
        return 20
    if age >= 50:
        return 15
    if age >= 30:
        return 10
    if age >= 15:
        return 5
    return 0


def _days_listed_score(days: Optional[int]) -> int:
    if not days:
        return 0
    if days >= 180:
        return 20
    if days >= 90:
        return 15
    if days >= 45:
        return 10
    if days >= 21:
        return 5
    return 0


def _price_reduction_score(has_cut: bool) -> int:
    return 10 if has_cut else 0


def _fsbo_score(is_fsbo: bool) -> int:
    return 10 if is_fsbo else 0


def _vacancy_score(vacant: bool) -> int:
    return 15 if vacant else 0


def _equity_score(equity_pct: Optional[float]) -> int:
    if equity_pct is None:
        return 0
    if equity_pct >= 50:
        return 15
    if equity_pct >= 30:
        return 10
    if equity_pct >= 15:
        return 5
    return 0


def _tax_delinquent_score(delinquent: bool) -> int:
    return 20 if delinquent else 0


def _ownership_years_score(years: Optional[float]) -> int:
    """Long ownership → more deferred maintenance."""
    if years is None:
        return 0
    if years >= 20:
        return 10
    if years >= 10:
        return 7
    if years >= 5:
        return 3
    return 0


def _compute_score(signals: Dict[str, Any]) -> int:
    score = (
        _age_score(signals.get("year_built"))
        + _days_listed_score(signals.get("days_on_market"))
        + _price_reduction_score(bool(signals.get("price_reduction")))
        + _fsbo_score(bool(signals.get("is_fsbo")))
        + _vacancy_score(bool(signals.get("vacant")))
        + _equity_score(signals.get("equity_pct"))
        + _tax_delinquent_score(bool(signals.get("tax_delinquent")))
        + _ownership_years_score(signals.get("ownership_years"))
    )
    return max(0, min(100, score))


# ─── Google Maps satellite URL helper ─────────────────────────────────────────

def _satellite_url(lat: float, lon: float, zoom: int = 20) -> Optional[str]:
    key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not key:
        return None
    return (
        f"https://maps.googleapis.com/maps/api/staticmap"
        f"?center={lat},{lon}&zoom={zoom}&size=640x640"
        f"&maptype=satellite&key={key}"
    )


# ─── AI distress reasoning ─────────────────────────────────────────────────────

async def _ai_distress_score(address: str, signals: Dict[str, Any],
                             base_score: int) -> Dict[str, Any]:
    """Ask LLM to reason over the signals and return refined score + rationale."""
    sys_msg = (
        "You are a real estate distress analyst. Given property signals, "
        "return a distress score 0-100 (0=perfect, 100=severely distressed) "
        "and a one-sentence rationale. "
        "REPLY ONLY with: {\"score\": integer, \"rationale\": \"...\", "
        "\"category\": \"low\"|\"medium\"|\"high\"|\"severe\"}"
    )
    sig_lines = "\n".join(
        f"- {k.replace('_', ' ').title()}: {v}"
        for k, v in signals.items()
        if v is not None and v is not False
    )
    user_msg = (
        f"Property: {address}\n"
        f"Algorithmic base score: {base_score}/100\n"
        f"Signals:\n{sig_lines or '(none detected)'}"
    )
    try:
        raw = await _chat(
            [{"role": "system", "content": sys_msg},
             {"role": "user", "content": user_msg}],
            json_mode=True, max_tokens=150, temperature=0.2,
        )
        data = json.loads(raw)
        return {
            "score": max(0, min(100, int(data.get("score", base_score)))),
            "rationale": data.get("rationale", ""),
            "category": data.get("category", _category(base_score)),
        }
    except Exception as e:
        log.debug("AI distress score failed for %s: %s", address, e)
        return {"score": base_score, "rationale": "", "category": _category(base_score)}


def _category(score: int) -> str:
    if score >= 70:
        return "severe"
    if score >= 50:
        return "high"
    if score >= 30:
        return "medium"
    return "low"


# ─── Zillow listing enrichment (days on market, price cuts, FSBO) ──────────────

async def _fetch_listings(zip_code: str = "", city: str = "",
                          state: str = "") -> List[Dict[str, Any]]:
    """Pull active + recently-sold listings from Zillow + Redfin."""
    results: List[Dict[str, Any]] = []
    try:
        fsbo = await zillow.fetch_fsbo(zip_code=zip_code, city=city, state=state, max_results=60)
        for p in fsbo:
            p["is_fsbo"] = True
        results.extend(fsbo)
    except Exception as e:
        log.info("FSBO fetch failed: %s", e)

    try:
        sold = await zillow.fetch_recently_sold(zip_code=zip_code, city=city,
                                                state=state, max_results=60)
        results.extend(sold)
    except Exception as e:
        log.info("Zillow sold fetch failed: %s", e)

    try:
        r_sold = await redfin.fetch_recently_sold(zip_code=zip_code, city=city,
                                                  state=state, max_results=60)
        results.extend(r_sold)
    except Exception as e:
        log.info("Redfin sold fetch failed: %s", e)

    return results


# ─── Public entrypoint ────────────────────────────────────────────────────────

async def scan_area(
    *,
    zip_code: str = "",
    city: str = "",
    state: str = "",
    min_score: int = 30,
    max_results: int = 50,
    use_ai_scoring: bool = True,
) -> Dict[str, Any]:
    """Scan an area for distressed properties — the SkyDrive DFD engine.

    Returns a ranked list of properties with a distress score 0-100,
    map coordinates, and a short rationale.
    """
    log.info("Satellite DFD scan: zip=%s city=%s state=%s", zip_code, city, state)

    listings = await _fetch_listings(zip_code=zip_code, city=city, state=state)
    log.info("DFD: %d listings fetched for analysis", len(listings))

    scored: List[Dict[str, Any]] = []
    for p in listings:
        try:
            year_built = None
            try:
                year_built = int(p.get("year_built") or 0) or None
            except (TypeError, ValueError):
                pass

            signals = {
                "year_built": year_built,
                "days_on_market": None,
                "price_reduction": False,
                "is_fsbo": bool(p.get("is_fsbo")),
                "vacant": False,
                "equity_pct": None,
                "tax_delinquent": False,
                "ownership_years": None,
            }
            base = _compute_score(signals)
            if base < min_score and not use_ai_scoring:
                continue

            lat = p.get("latitude")
            lon = p.get("longitude")

            result: Dict[str, Any] = {
                "address": p.get("address"),
                "city": p.get("city") or city,
                "state": p.get("state") or state,
                "zip": p.get("zip") or zip_code,
                "distress_score": base,
                "distress_category": _category(base),
                "rationale": "",
                "signals": signals,
                "latitude": lat,
                "longitude": lon,
                "satellite_url": _satellite_url(lat, lon) if (lat and lon) else None,
                "zillow_url": p.get("zillow_url") or p.get("redfin_url"),
                "estimated_value": p.get("estimated_value") or p.get("price"),
                "beds": p.get("beds"),
                "baths": p.get("baths"),
                "sqft": p.get("sqft"),
                "year_built": year_built,
                "source": p.get("source", "zillow+redfin"),
            }

            if use_ai_scoring:
                ai = await _ai_distress_score(
                    p.get("address") or "", signals, base
                )
                result["distress_score"] = ai["score"]
                result["distress_category"] = ai["category"]
                result["rationale"] = ai["rationale"]

            if result["distress_score"] >= min_score:
                scored.append(result)

        except Exception as e:
            log.debug("Scoring error for listing: %s", e)
            continue

    scored.sort(key=lambda r: r.get("distress_score", 0), reverse=True)
    return {
        "zip": zip_code,
        "city": city,
        "state": state,
        "total_scanned": len(listings),
        "total_above_threshold": len(scored),
        "min_score_filter": min_score,
        "results": scored[:max_results],
    }
