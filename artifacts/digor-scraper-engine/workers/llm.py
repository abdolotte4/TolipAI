"""LLM client — Groq (primary, free) → NVIDIA → Moonshot fallback chain.

All three providers expose an OpenAI-compatible Chat Completions API.
Circuit breakers: each provider is permanently skipped after its first
unrecoverable failure (suspended / deprecated / auth error) so the same
error never spams the logs.  Transient 429s are retried with backoff (max 2
retries) before the provider is considered dead for this process lifetime.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional, Set

from openai import AsyncOpenAI

from .config import settings

log = logging.getLogger("llm")

_groq_client: Optional[AsyncOpenAI] = None
_nvidia_client: Optional[AsyncOpenAI] = None
_moonshot_client: Optional[AsyncOpenAI] = None

# Circuit breakers — providers added here are permanently skipped for this run
_dead_providers: Set[str] = set()
# Track 429 consecutive hits per provider (reset on success)
_rate_hits: Dict[str, int] = {}
_MAX_RATE_HITS = 3  # give up after 3 consecutive 429s


def _groq() -> Optional[AsyncOpenAI]:
    global _groq_client
    if _groq_client is None and settings.groq_api_key:
        _groq_client = AsyncOpenAI(
            api_key=settings.groq_api_key,
            base_url=settings.groq_base_url,
        )
    return _groq_client


def _nvidia() -> Optional[AsyncOpenAI]:
    global _nvidia_client
    if _nvidia_client is None and settings.nvidia_api_key:
        _nvidia_client = AsyncOpenAI(
            api_key=settings.nvidia_api_key,
            base_url=settings.nvidia_base_url,
        )
    return _nvidia_client


def _moonshot() -> Optional[AsyncOpenAI]:
    global _moonshot_client
    if _moonshot_client is None and settings.moonshot_api_key:
        _moonshot_client = AsyncOpenAI(
            api_key=settings.moonshot_api_key,
            base_url=settings.moonshot_base_url,
        )
    return _moonshot_client


def _is_fatal(exc: Exception) -> bool:
    """Return True for errors that mean this provider will never work."""
    msg = str(exc).lower()
    return any(k in msg for k in (
        "suspended", "account", "forbidden", "unauthorized", "401",
        "deprecated", "not found", "no such model", "does not exist",
    ))


def _is_rate_limited(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "429" in msg or "rate limit" in msg or "too many requests" in msg


async def _chat(messages: List[Dict[str, str]], *, json_mode: bool = True,
                temperature: float = 0.2, max_tokens: int = 1500) -> str:
    """Run a chat completion through the provider chain with circuit breakers.

    Provider order: Groq → NVIDIA → Moonshot.
    Each provider is skipped silently after its first fatal error.
    Rate-limit (429) is retried up to _MAX_RATE_HITS times before moving on.
    """
    providers = [
        ("groq",     _groq,     settings.groq_model),
        ("nvidia",   _nvidia,   settings.nvidia_model),
        ("moonshot", _moonshot, settings.moonshot_model),
    ]
    last_err: Optional[Exception] = None
    for provider, client_fn, model in providers:
        if provider in _dead_providers:
            continue
        client = client_fn()
        if client is None:
            continue
        hits = _rate_hits.get(provider, 0)
        if hits >= _MAX_RATE_HITS:
            if provider not in _dead_providers:
                _dead_providers.add(provider)
                log.warning("LLM provider %s: max rate-limit hits reached — skipping for this run", provider)
            continue
        for attempt in range(2):
            try:
                kwargs: Dict[str, Any] = {
                    "model": model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                }
                if json_mode:
                    kwargs["response_format"] = {"type": "json_object"}
                resp = await client.chat.completions.create(**kwargs)
                _rate_hits[provider] = 0  # reset on success
                return resp.choices[0].message.content or ""
            except Exception as e:
                last_err = e
                if _is_fatal(e):
                    _dead_providers.add(provider)
                    log.warning("LLM provider %s permanently dead: %s", provider, e)
                    break
                if _is_rate_limited(e):
                    _rate_hits[provider] = hits + 1
                    if attempt == 0:
                        log.info("LLM provider %s rate-limited (hit %d/%d), backing off…",
                                 provider, hits + 1, _MAX_RATE_HITS)
                        await asyncio.sleep(2 ** attempt * 1.5)
                        continue
                    log.info("LLM provider %s rate-limited, moving to next provider", provider)
                    break
                log.warning("LLM provider %s error: %s", provider, e)
                break  # non-fatal non-rate error → try next provider

    if last_err:
        raise last_err
    raise RuntimeError("No LLM provider available (set GROQ_API_KEY, NVIDIA_API_KEY, or MOONSHOT_KIMI_API_KEY)")


# ─── Public helpers ──────────────────────────────────────────────────────────

INVESTOR_TYPES = ["flipper", "landlord", "hedge_fund", "lender", "wholesaler", "unknown"]


async def extract_investor_profile(text: str, *, source: str = "") -> Dict[str, Any]:
    """Turn a chunk of scraped page text into a structured investor profile."""
    sys = (
        "You extract real-estate investor data from messy web/HTML text. "
        "Return strictly JSON with keys: buyer_name (string), llc_name (string|null), "
        "principals (array of {name, role}), city, state, zip, mailing_address, "
        "phones (array of strings), emails (array of strings), "
        "buyer_type (one of: flipper, landlord, hedge_fund, lender, wholesaler, unknown), "
        "classification_reason (1-sentence string), portfolio_size (int|null), "
        "portfolio_value (number|null), avg_purchase_price (number|null), "
        "last_purchase_date (string|null). Use null for unknown fields."
    )
    user = f"Source: {source}\n\nTEXT:\n{text[:8000]}"
    raw = await _chat(
        [{"role": "system", "content": sys}, {"role": "user", "content": user}],
        json_mode=True, max_tokens=900,
    )
    try:
        data = json.loads(raw)
    except Exception:
        log.warning("LLM returned non-JSON: %s", raw[:200])
        return {"buyer_name": "Unknown", "buyer_type": "unknown", "raw_data": {"text": text[:1000]}}
    if data.get("buyer_type") not in INVESTOR_TYPES:
        data["buyer_type"] = "unknown"
    return data


async def score_buyer_match(buyer: Dict[str, Any], lead: Dict[str, Any]) -> Dict[str, Any]:
    """Return {match_score: 0-100, match_reasons: [str]} for a buyer vs a lead."""
    sys = (
        "You score how well a real-estate cash buyer matches a wholesaler's lead. "
        "Output JSON: { match_score: 0-100 integer, match_reasons: 2-4 short bullet strings }. "
        "Higher score when: buyer's recent purchases are in the same ZIP/county, "
        "buyer's avg purchase price brackets the lead's likely sale price, "
        "buyer type fits property condition (flipper for distressed, landlord for rentable, "
        "hedge_fund for portfolio-sized, lender for owner-financed deals)."
    )
    payload = {
        "buyer": {k: buyer.get(k) for k in (
            "buyer_name", "llc_name", "buyer_type", "city", "state", "zip",
            "portfolio_size", "portfolio_value", "avg_purchase_price",
        )},
        "lead": {k: lead.get(k) for k in (
            "address", "city", "state", "zip", "beds", "baths", "sqft",
            "year_built", "current_value", "asking_price", "arv", "condition",
        )},
    }
    raw = await _chat(
        [
            {"role": "system", "content": sys},
            {"role": "user", "content": json.dumps(payload, default=str)},
        ],
        json_mode=True, max_tokens=300, temperature=0.3,
    )
    try:
        data = json.loads(raw)
        return {
            "match_score": max(0, min(100, int(data.get("match_score") or 0))),
            "match_reasons": data.get("match_reasons") or [],
        }
    except Exception:
        return {"match_score": 0, "match_reasons": []}


async def parse_distressed_page(text: str, *, source: str) -> List[Dict[str, Any]]:
    """Extract distressed property records from a scraped trustee/auction page."""
    sys = (
        "You extract distressed real-estate listings from scraped text "
        "(trustee sales, foreclosure auctions, tax liens). "
        "Return JSON {listings: [...]} where each listing has: "
        "address, city, state, zip, county, parcel_id, owner_name, sale_date "
        "(ISO if possible), opening_bid (number|null), estimated_value (number|null), "
        "mortgage_balance (number|null), distress_type "
        "(trustee_sale|auction|preforeclosure|tax_lien|code_violation|probate|fsbo|expired), "
        "source_url (string|null). Be conservative — drop rows you can't verify."
    )
    raw = await _chat(
        [
            {"role": "system", "content": sys},
            {"role": "user", "content": f"Source: {source}\n\nTEXT:\n{text[:9000]}"},
        ],
        json_mode=True, max_tokens=1500, temperature=0.1,
    )
    try:
        data = json.loads(raw)
        listings = data.get("listings") or []
        return [lst for lst in listings if isinstance(lst, dict) and lst.get("address")]
    except Exception:
        log.warning("LLM distressed parse returned non-JSON")
        return []
