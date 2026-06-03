"""OSINT residential skip-trace — stub.

AUDIT COMPLIANCE:
  The original implementation scraped people-search aggregator sites
  (TruePeopleSearch, FastPeopleSearch, CyberBackgroundChecks).

  These have been permanently removed because:
    1. ToS violation — all three sites explicitly prohibit automated scraping
    2. FCRA compliance — using scraped consumer data for lead gen may violate
       the Fair Credit Reporting Act without a permissible purpose certification
    3. Block rate — all three sites use Cloudflare and return 403/challenge
       pages in 100% of headless-browser sessions without a paid residential
       proxy rotation service ($500+/month)

  Replacement: use licensed skip-trace APIs (BatchSkipTracing, Skip Genie,
  PropStream, or similar) which provide FCRA-compliant data and explicit
  permission to use it for real-estate purposes.

  To enable this module, set SKIP_TRACE_API_KEY and SKIP_TRACE_PROVIDER
  environment variables, then implement the appropriate API client below.

  The public interface (trace_by_address, format_markdown_table) is preserved
  so callers compile without changes — both return empty/placeholder data.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

log = logging.getLogger("osint_skip")

_PROVIDER = os.getenv("SKIP_TRACE_PROVIDER", "")
_API_KEY = os.getenv("SKIP_TRACE_API_KEY", "")

_STUB_NOTICE = (
    "OSINT skip-trace is disabled. Set SKIP_TRACE_PROVIDER and SKIP_TRACE_API_KEY "
    "to enable a licensed skip-trace API (BatchSkipTracing, Skip Genie, PropStream)."
)


async def trace_by_address(
    street: str,
    city: str,
    state: str,
    *,
    owner_name: Optional[str] = None,
    do_dnc_check: bool = True,
) -> Dict[str, Any]:
    """Reverse-address skip trace.

    Currently returns empty results — requires a licensed skip-trace API.
    Set SKIP_TRACE_PROVIDER and SKIP_TRACE_API_KEY to enable.
    """
    if not _API_KEY or not _PROVIDER:
        log.warning(_STUB_NOTICE)
        return {
            "street": street,
            "city": city,
            "state": state,
            "owner_name": owner_name,
            "phones": [],
            "emails": [],
            "resident_names": [],
            "verified_mobile_count": 0,
            "verified_email_count": 0,
            "skip_trace_status": "disabled",
            "skip_trace_reason": _STUB_NOTICE,
        }

    # ── Add your licensed skip-trace API client here ──────────────────────────
    # Example for BatchSkipTracing:
    # async with httpx.AsyncClient(timeout=30) as cli:
    #     r = await cli.post("https://api.batchskiptracing.com/api/lookup", json={...}, headers={...})
    # return parse_bst_response(r.json())
    log.warning("SKIP_TRACE_PROVIDER '%s' is not yet implemented", _PROVIDER)
    return {
        "street": street,
        "city": city,
        "state": state,
        "owner_name": owner_name,
        "phones": [],
        "emails": [],
        "resident_names": [],
        "verified_mobile_count": 0,
        "verified_email_count": 0,
        "skip_trace_status": f"provider_{_PROVIDER}_not_implemented",
    }


def format_markdown_table(leads: List[Dict[str, Any]]) -> str:
    """Render skip-traced leads as a Markdown table."""
    lines = [
        "| # | Address | Owner | Est. Equity | Phone(s) | Email(s) | DNC Flag |",
        "|---|---------|-------|-------------|----------|----------|----------|",
    ]
    for i, lead in enumerate(leads, 1):
        addr = lead.get("address") or f"{lead.get('street', '')}, {lead.get('city', '')}"
        owner = lead.get("owner_name") or "—"
        equity = f"${lead.get('estimated_equity', 0):,.0f}" if lead.get("estimated_equity") else "—"
        phones = "; ".join(p["number"] for p in lead.get("phones", [])[:2]) or "—"
        emails = "; ".join(e["email"] for e in lead.get("emails", [])[:2]) or "—"
        dnc_flag = "⚠️ Yes" if any(p.get("dnc_status") == "flagged" for p in lead.get("phones", [])) else "No"
        lines.append(f"| {i} | {addr} | {owner} | {equity} | {phones} | {emails} | {dnc_flag} |")
    return "\n".join(lines)
