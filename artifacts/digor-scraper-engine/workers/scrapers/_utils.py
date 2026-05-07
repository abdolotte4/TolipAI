"""Shared scraper utilities — imported by propelio_v2 and propwire.

Centralises helpers that were previously duplicated across multiple scrapers.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Optional


def _safe_num(s: Any) -> Optional[float]:
    """Coerce a raw value (str/int/float/None) to float, or None if unparseable."""
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    m = re.search(r"-?\d[\d,]*\.?\d*", str(s))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def _parse_buyer_card(text: str) -> Dict[str, Any]:
    """Heuristic parser for rendered buyer cards (Propelio / Propwire card layout).

    Handles text like:
        JOHN SMITH LLC
        123 Main St, Dallas TX 75201
        47 Props  Average Deal: $128,000  Total Deal: $6.0M
        Last Deal: 03/12/2024  Price Range: $80,000 - $200,000
        Landlord  Flipper
    """
    out: Dict[str, Any] = {"_raw_text": text}
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if lines:
        out["name"] = lines[0]

    m = re.search(r"(\d+)\s*Props?", text, re.IGNORECASE)
    if m:
        out["props_count"] = int(m.group(1))

    m = re.search(r"Average\s+Deal[\s\S]*?\$([\d,]+)", text, re.IGNORECASE)
    if m:
        out["avg_deal"] = _safe_num(m.group(1))

    m = re.search(r"Total\s+Deal[\s\S]*?\$([\d.]+)([MK])?", text, re.IGNORECASE)
    if m:
        n = float(m.group(1)) * (1_000_000 if m.group(2) == "M" else (1_000 if m.group(2) == "K" else 1))
        out["total_deal"] = n

    m = re.search(r"Last\s+Deal[\s\S]*?(\d{2}[./]\d{2}[./]\d{2,4})", text, re.IGNORECASE)
    if m:
        out["last_deal"] = m.group(1)

    m = re.search(r"Price\s+Range[\s\S]*?\$([\d,]+)\s*-\s*\$([\d,]+)", text, re.IGNORECASE)
    if m:
        out["price_min"] = _safe_num(m.group(1))
        out["price_max"] = _safe_num(m.group(2))

    if re.search(r"\bLandlord\b", text):
        out["types"] = (out.get("types") or []) + ["landlord"]
    if re.search(r"\bFlipper\b", text):
        out["types"] = (out.get("types") or []) + ["flipper"]

    for ln in lines[1:6]:
        if re.search(r"\d", ln) and ("," in ln or re.search(r"[A-Z]{2}\s*\d{5}", ln)):
            out["address"] = ln
            break

    return out
