"""LLM cost optimizer — caching, model tiering, HTML stripping.

AUDIT COMPLIANCE:
  batch_extract_profiles() previously extracted investor profiles from raw HTML
  using LLM batch calls (Rule #1 violation). It has been replaced with a stub
  that returns empty profiles and logs a deprecation warning.

  cached_extract_investor_profile() and cached_score_buyer_match() are also
  stubs — use llm.classify_buyer_type() and llm.score_buyer_match_rule_based().

  PERMITTED LLM uses in this codebase:
    - satellite_dfd._ai_distress_score() — classifying already-extracted signals
    - ai_research.hedge_fund_markets() — general market analysis
    - ai_research.research() — general freeform research queries

Caching
───────
  Every (messages + call kwargs) combination is SHA256-hashed and stored in
  the dual-layer cache (Redis → S3 → memory).  Default TTL is 7 days.

Model tiering
─────────────
  complexity="fast"  → caps max_tokens at 400
  complexity="smart" → full token budget

HTML stripping
──────────────
  strip_html(html) removes all tags and collapses whitespace before the text
  is sent to the LLM.  A typical 50 KB listing page shrinks to ~5 KB.

Usage
─────
    from .llm_cache import cached_chat, tiered_chat, strip_html

    # Drop-in replacement for llm._chat():
    raw = await cached_chat(messages, json_mode=True, max_tokens=900)

    # Cheaper route for simple tasks (distress scoring, classification):
    raw = await tiered_chat(messages, complexity="fast")

    # HTML → plain text before sending:
    text = strip_html(raw_html)
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

from .cache import cache
from .llm import _chat

log = logging.getLogger("llm_cache")

# ── Tunables ──────────────────────────────────────────────────────────────────
_LLM_CACHE_TTL  = int(os.getenv("LLM_CACHE_TTL",       str(86_400 * 7)))  # 7 days
_BATCH_SIZE     = int(os.getenv("LLM_BATCH_SIZE",       "10"))
_MAX_HTML_CHARS = int(os.getenv("LLM_MAX_HTML_CHARS",   "12000"))
_FAST_MAX_TOKENS = int(os.getenv("LLM_FAST_MAX_TOKENS", "400"))


# ── Cache key ─────────────────────────────────────────────────────────────────

def _llm_cache_key(messages: List[Dict[str, str]], **kwargs: Any) -> str:
    """Stable SHA256 fingerprint of messages + call parameters."""
    payload = json.dumps(
        {"messages": messages, "kw": sorted(kwargs.items())},
        sort_keys=True,
        default=str,
    )
    digest = hashlib.sha256(payload.encode()).hexdigest()
    return f"llm:v1:{digest}"


# ── HTML stripping ────────────────────────────────────────────────────────────

def strip_html(html: str, max_chars: int = _MAX_HTML_CHARS) -> str:
    """Remove HTML tags and collapse whitespace; trim to max_chars.

    Uses BeautifulSoup when available, falls back to a regex strip.
    A 50 KB listing page → ~5 KB plain text ≈ 90% token reduction.
    """
    if not html:
        return ""
    try:
        from bs4 import BeautifulSoup  # type: ignore[import]
        soup = BeautifulSoup(html, "lxml")
        for tag in soup(["script", "style", "noscript", "head", "meta", "link", "svg"]):
            tag.decompose()
        text = soup.get_text(separator=" ", strip=True)
    except Exception:
        # Regex fallback — removes the most common tags
        text = re.sub(r"<[^>]{1,400}>", " ", html)
    text = re.sub(r"\s{2,}", " ", text).strip()
    return text[:max_chars]


# ── Cached chat ───────────────────────────────────────────────────────────────

async def cached_chat(
    messages: List[Dict[str, str]],
    *,
    json_mode: bool = True,
    temperature: float = 0.2,
    max_tokens: int = 1500,
    ttl: int = _LLM_CACHE_TTL,
    bypass_cache: bool = False,
) -> str:
    """Drop-in replacement for llm._chat() with Redis/S3/memory caching.

    Args:
        messages:      OpenAI-format message list.
        json_mode:     Request JSON response format.
        temperature:   Sampling temperature.
        max_tokens:    Maximum response tokens.
        ttl:           Cache TTL in seconds (default 7 days).
        bypass_cache:  Set True for non-deterministic prompts (e.g. source
                       discovery) where caching would return stale results.
    """
    key = _llm_cache_key(
        messages,
        json_mode=json_mode,
        temperature=temperature,
        max_tokens=max_tokens,
    )

    if not bypass_cache:
        try:
            cached = await cache.get(key)
            if cached is not None:
                log.debug("llm_cache: hit (key=%.16s…)", key[4:])
                return cached
        except Exception as exc:
            log.debug("llm_cache: cache read error: %s", exc)

    result = await _chat(
        messages,
        json_mode=json_mode,
        temperature=temperature,
        max_tokens=max_tokens,
    )

    if not bypass_cache and result:
        try:
            await cache.set(key, result, ttl=ttl)
        except Exception as exc:
            log.debug("llm_cache: cache write error: %s", exc)

    return result


# ── Model tiering ─────────────────────────────────────────────────────────────

async def tiered_chat(
    messages: List[Dict[str, str]],
    *,
    complexity: str = "fast",
    json_mode: bool = True,
    temperature: float = 0.2,
    max_tokens: int = 1500,
    ttl: int = _LLM_CACHE_TTL,
    bypass_cache: bool = False,
) -> str:
    """Cached chat with explicit complexity hint.

    complexity="fast"
        Caps max_tokens to _FAST_MAX_TOKENS (default 400).

    complexity="smart"
        No token cap — uses whatever max_tokens is passed.

    Both paths go through the cache, so repeated identical calls are free
    regardless of complexity.
    """
    if complexity == "fast":
        max_tokens = min(max_tokens, _FAST_MAX_TOKENS)
    return await cached_chat(
        messages,
        json_mode=json_mode,
        temperature=temperature,
        max_tokens=max_tokens,
        ttl=ttl,
        bypass_cache=bypass_cache,
    )


# ── Batch extraction — REMOVED ────────────────────────────────────────────────

async def batch_extract_profiles(
    texts: List[str],
    *,
    source: str = "",
    batch_size: int = _BATCH_SIZE,
    strip: bool = True,
) -> List[Dict[str, Any]]:
    """REMOVED — LLM batch investor-profile extraction violated Rule #1.

    Replacement: use llm.classify_buyer_type() after data is already parsed
    from a real DOM scraper (county deeds, propelio_v2, propwire).

    This stub returns empty profile dicts so callers that haven't been updated
    yet do not raise ImportError or TypeError.
    """
    log.warning(
        "batch_extract_profiles() is deprecated (LLM extraction removed). "
        "Use classify_buyer_type() on already-parsed buyer data. "
        "Source was: %s, texts count: %d",
        source,
        len(texts),
    )
    _empty: Dict[str, Any] = {"buyer_name": "Unknown", "buyer_type": "unknown"}
    return [dict(_empty) for _ in texts]


# ── Convenience: cached versions of the public llm helpers ───────────────────

def cached_extract_investor_profile(
    text: str,
    *,
    source: str = "",
    is_html: bool = False,
) -> Dict[str, Any]:
    """REMOVED — LLM investor profile extraction has been replaced with rule-based
    classification via llm.classify_buyer_type(). This stub exists so callers that
    have not yet been updated do not raise ImportError.

    Use workers.llm.classify_buyer_type() instead.
    """
    import logging
    logging.getLogger("llm_cache").warning(
        "cached_extract_investor_profile() is deprecated — use classify_buyer_type(). "
        "Returning empty profile."
    )
    return {"buyer_name": "Unknown", "buyer_type": "unknown"}


def cached_score_buyer_match(
    buyer: Dict[str, Any],
    lead: Dict[str, Any],
) -> Dict[str, Any]:
    """REMOVED — LLM match scoring has been replaced with rule-based scoring via
    llm.score_buyer_match_rule_based(). This stub exists so callers that have not
    yet been updated do not raise ImportError.

    Use workers.llm.score_buyer_match_rule_based() instead.
    """
    import logging
    logging.getLogger("llm_cache").warning(
        "cached_score_buyer_match() is deprecated — use score_buyer_match_rule_based(). "
        "Returning zero score."
    )
    return {"match_score": 0, "match_reasons": []}
