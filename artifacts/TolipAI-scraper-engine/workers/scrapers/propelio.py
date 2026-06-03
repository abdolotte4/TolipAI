"""Propelio comps — DEPRECATED stub.

AUDIT COMPLIANCE:
  The original implementation scraped Propelio's public comp viewer
  (https://propelio.com/app/comps) using fetch_html + LLM extraction,
  violating Rule #1 (NEVER use LLMs for data extraction).

  This file is NOT used by any active endpoint in main.py.
  Authenticated Propelio cash-buyer data is handled by propelio_v2.py
  (which uses real login + HTML table parsing, no LLM).

  To get real comps data:
    1. Use propelio_v2.py for authenticated Propelio access.
    2. Use propwire.fetch_comps() for PropWire comp data (endpoint: /scrape/propwire/comps).
    3. Use homeharvest_scraper.py for publicly available MLS comps.

  Both functions below are preserved as stubs so any lingering import
  references do not raise ImportError.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

log = logging.getLogger("propelio")

_STUB_NOTICE = (
    "propelio.py (public scraper) is deprecated. "
    "Use propelio_v2.py (authenticated) or propwire.py for comp data. "
    "LLM-based comp extraction has been permanently removed."
)


async def fetch_comps(
    address: str,
    *,
    radius_miles: float = 0.5,
    max_results: int = 12,
) -> List[Dict[str, Any]]:
    """DEPRECATED — returns empty list.

    LLM-based comp extraction removed (Rule #1 violation).
    Use propelio_v2.py or propwire.py instead.
    """
    log.warning(_STUB_NOTICE)
    return []


async def estimate_arv(
    address: str,
    *,
    radius_miles: float = 0.5,
) -> Dict[str, Any]:
    """DEPRECATED — returns empty ARV.

    LLM-based comp extraction removed (Rule #1 violation).
    Use propelio_v2.py or propwire.py instead.
    """
    log.warning(_STUB_NOTICE)
    return {
        "address": address,
        "comps": [],
        "arv_estimate": None,
        "arv_low": None,
        "arv_high": None,
        "comp_count": 0,
        "source": "propelio_deprecated",
        "error": _STUB_NOTICE,
    }
