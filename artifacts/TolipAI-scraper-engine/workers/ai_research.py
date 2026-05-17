"""AI-powered research helpers.

Lets the user issue freeform research commands like

    "List trustees in counties where hedge funds are buying.  Link to each
     trustee site and the public sale-date listings if they exist."

We hand the prompt to Kimi K2 (with a structured-JSON system prompt) and
the model returns a curated list we can then feed back into the
distressed-property scraper as ad-hoc sources.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List

from .llm import _chat

log = logging.getLogger("ai_research")


TRUSTEE_DISCOVERY_SYSTEM = (
    "You are a real-estate foreclosure research assistant.  Given a US state "
    "(and optionally a county / market), enumerate the public trustees, "
    "sheriffs, or county clerks who FACILITATE foreclosure sales there.  "
    "For each, return JSON with keys: "
    "  name, role (one of: public_trustee, sheriff, county_clerk, substitute_trustee), "
    "  county, state, website (https URL), sale_listings_url (https URL or null), "
    "  notes (1-sentence). "
    "Bias toward markets with heavy institutional / hedge-fund acquisition "
    "(Phoenix, Atlanta, Charlotte, Tampa, Orlando, Houston, Dallas, Vegas). "
    "Return STRICT JSON: { trustees: [...] }.  Do NOT invent URLs — if you "
    "are not confident, set the URL to null and explain in `notes`."
)


async def discover_trustees(state: str, *, county: str = "", max_results: int = 25) -> List[Dict[str, Any]]:
    """Ask the LLM to enumerate trustees for foreclosure sales in a market."""
    user = (
        f"Target market: {county + ', ' if county else ''}{state}\n"
        f"Return up to {max_results} trustees / sale-listing sites."
    )
    raw = await _chat(
        [
            {"role": "system", "content": TRUSTEE_DISCOVERY_SYSTEM},
            {"role": "user", "content": user},
        ],
        json_mode=True,
        max_tokens=1500,
        temperature=0.2,
    )
    try:
        data = json.loads(raw)
        trustees = [t for t in (data.get("trustees") or []) if isinstance(t, dict) and t.get("name")]
        return trustees[:max_results]
    except Exception as exc:
        log.warning("Trustee LLM parse returned non-JSON: %s", raw[:200], exc_info=True)
        return []


HEDGE_FUND_MARKETS_SYSTEM = (
    "You are a real-estate analyst.  List the US metros where institutional "
    "and hedge-fund single-family-rental (SFR) buyers are most active right "
    "now (Invitation Homes, AMH, Tricon, Pretium, Blackstone, Pearlmark, "
    "Roofstock, Conrex etc.).  Return JSON: "
    "{ markets: [ { metro, state, primary_counties: [...], dominant_buyers: [...], "
    "notes: '1-sentence' } ] }."
)


async def hedge_fund_markets(max_results: int = 12) -> List[Dict[str, Any]]:
    raw = await _chat(
        [
            {"role": "system", "content": HEDGE_FUND_MARKETS_SYSTEM},
            {"role": "user", "content": f"Return top {max_results} metros."},
        ],
        json_mode=True,
        max_tokens=1200,
        temperature=0.2,
    )
    try:
        data = json.loads(raw)
        return (data.get("markets") or [])[:max_results]
    except Exception as exc:
        log.warning("Markets LLM parse failed", exc_info=True)
        return []


GENERIC_RESEARCH_SYSTEM = (
    "You are a real-estate research assistant for a wholesaler.  Return STRICT "
    "JSON: { results: [ { title, url, summary } ] } — concise, factual, and "
    "free of speculation.  When unsure of a URL, omit it.  Do not invent."
)


async def research(query: str, *, max_results: int = 10) -> Dict[str, Any]:
    """Generic LLM research with a structured-JSON contract."""
    raw = await _chat(
        [
            {"role": "system", "content": GENERIC_RESEARCH_SYSTEM},
            {
                "role": "user",
                "content": f"Query: {query}\nReturn up to {max_results} results.",
            },
        ],
        json_mode=True,
        max_tokens=1400,
        temperature=0.3,
    )
    try:
        data = json.loads(raw)
        results = (data.get("results") or [])[:max_results]
        return {"query": query, "results": results, "count": len(results)}
    except Exception as exc:
        log.warning("Research LLM parse returned non-JSON", exc_info=True)
        return {"query": query, "results": [], "count": 0, "error": "non-JSON"}
