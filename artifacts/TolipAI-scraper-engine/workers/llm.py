"""LLM client — OpenAI only with circuit breaker and concurrency gate.

All non-OpenAI providers (Groq, Cerebras, Together, NVIDIA, OpenRouter, Moonshot)
have been removed.  They were causing runaway 429s, credit-bleeding on free tiers,
and cascading failures that hung jobs indefinitely.

Provider: OpenAI (gpt-4o-mini default, configurable via OPENAI_MODEL env var).
Circuit breaker: permanently skips on fatal errors (auth/suspended/deprecated).
Rate-limit: exponential backoff up to _MAX_RATE_HITS before cooling down.
Concurrency: global semaphore (LLM_CONCURRENCY, default 2) caps concurrent calls.

AUDIT COMPLIANCE:
  Removed fantasy LLM-based extraction functions:
    ✗ extract_investor_profile()   — was scraping people-search sites + LLM
    ✗ score_buyer_match()          — was sending buyer+lead to LLM for scoring
    ✗ parse_distressed_page()      — was sending raw HTML to LLM for structured extraction
    ✗ suggest_distressed_sources() — was asking LLM to hallucinate URLs

  Added data-driven helper:
    ✓ classify_buyer_type()        — rule-based classification from purchase history
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional, Set

from openai import AsyncOpenAI

from .config import settings

log = logging.getLogger("llm")

_openai_client: Optional[AsyncOpenAI] = None

# Permanently dead — auth/deprecated errors, never recoverable this process lifetime
_dead_providers: Set[str] = set()
# Track consecutive 429s per provider (reset on success)
_rate_hits: Dict[str, int] = {}
# Cooldown: provider → unix timestamp when it's allowed to retry after rate-limit
_rate_cooldown_until: Dict[str, float] = {}
_MAX_RATE_HITS = 8  # enter cooldown after 8 consecutive 429s
_RATE_COOLDOWN_SEC = 180  # 3-minute cooldown before retrying

# Global concurrency gate — keeps us well under OpenAI burst limits and prevents
# a single 40-buyer job from spawning 40 concurrent API calls.
_LLM_CONCURRENCY = int(__import__("os").getenv("LLM_CONCURRENCY", "2"))
_llm_sem: Optional[asyncio.Semaphore] = None


def _get_sem() -> asyncio.Semaphore:
    global _llm_sem
    if _llm_sem is None:
        _llm_sem = asyncio.Semaphore(_LLM_CONCURRENCY)
    return _llm_sem


def _openai() -> Optional[AsyncOpenAI]:
    global _openai_client
    if _openai_client is None and settings.openai_api_key:
        _openai_client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
        )
    return _openai_client


def _is_fatal(exc: Exception) -> bool:
    """Return True for errors that mean OpenAI will never work this session."""
    msg = str(exc).lower()
    return any(
        k in msg
        for k in (
            "suspended",
            "account",
            "forbidden",
            "unauthorized",
            "401",
            "deprecated",
            "not found",
            "no such model",
            "does not exist",
        )
    )


def _is_rate_limited(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "429" in msg or "rate limit" in msg or "too many requests" in msg


async def _chat(
    messages: List[Dict[str, str]],
    *,
    json_mode: bool = True,
    temperature: float = 0.2,
    max_tokens: int = 1500,
    model: Optional[str] = None,
) -> str:
    """Run a chat completion through OpenAI with circuit breaker + rate-limit backoff.

    Uses a global semaphore to cap concurrent calls.  On fatal errors the provider
    is permanently skipped for this process lifetime.  On rate limits, exponential
    backoff is applied before giving up and entering cooldown.

    Pass ``model`` to override the default OPENAI_MODEL env var for a single call
    (e.g. use gpt-4o for high-value distress scoring while cheaper calls stay on
    gpt-4o-mini).
    """
    async with _get_sem():
        return await _chat_inner(
            messages,
            json_mode=json_mode,
            temperature=temperature,
            max_tokens=max_tokens,
            model=model,
        )


async def _chat_inner(
    messages: List[Dict[str, str]],
    *,
    json_mode: bool = True,
    temperature: float = 0.2,
    max_tokens: int = 1500,
    model: Optional[str] = None,
) -> str:
    # ── Amazon Bedrock short-circuit (USE_BEDROCK=1) ──────────────────────────
    if settings.use_bedrock:
        try:
            import boto3 as _boto3  # type: ignore[import]

            def _bedrock_sync() -> str:
                client = _boto3.client(
                    "bedrock-runtime",
                    region_name=settings.bedrock_region,
                )
                body = json.dumps(
                    {
                        "anthropic_version": "bedrock-2023-05-31",
                        "max_tokens": max_tokens,
                        "messages": [
                            {"role": m["role"], "content": m.get("content", "")}
                            for m in messages
                            if m.get("role") in ("user", "assistant")
                        ],
                    }
                )
                resp = client.invoke_model(
                    modelId=settings.bedrock_model_id,
                    body=body,
                    contentType="application/json",
                    accept="application/json",
                )
                out = json.loads(resp["body"].read())
                return " ".join(c["text"] for c in out.get("content", []) if "text" in c)

            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, _bedrock_sync)
            log.info("LLM: Bedrock response received (%d chars)", len(result))
            return result
        except Exception as bedrock_exc:
            log.warning("Bedrock call failed — falling back to OpenAI: %s", bedrock_exc)

    _LLM_TIMEOUT = float(__import__("os").getenv("LLM_TIMEOUT_SEC", "90"))
    provider = "openai"

    if provider in _dead_providers:
        raise RuntimeError("OpenAI provider is permanently dead (auth/deprecated error). Check OPENAI_API_KEY.")

    client = _openai()
    if client is None:
        raise RuntimeError(
            "No LLM available — set OPENAI_API_KEY in ECS task environment variables."
        )

    hits = _rate_hits.get(provider, 0)
    cooldown_until = _rate_cooldown_until.get(provider, 0.0)
    if hits >= _MAX_RATE_HITS:
        if time.time() < cooldown_until:
            remaining = int(cooldown_until - time.time())
            raise RuntimeError(
                f"OpenAI rate-limited — cooling down for {remaining}s more. "
                "Reduce LLM_CONCURRENCY or wait for cooldown to expire."
            )
        else:
            log.info("OpenAI cooldown expired, retrying")
            _rate_hits[provider] = 0
            hits = 0

    _LLM_TIMEOUT = float(__import__("os").getenv("LLM_TIMEOUT_SEC", "90"))
    last_err: Optional[Exception] = None

    for attempt in range(2):
        try:
            kwargs: Dict[str, Any] = {
                "model": model or settings.openai_model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            if json_mode:
                kwargs["response_format"] = {"type": "json_object"}
            resp = await asyncio.wait_for(
                client.chat.completions.create(**kwargs),
                timeout=_LLM_TIMEOUT,
            )
            _rate_hits[provider] = 0  # reset on success
            _rate_cooldown_until.pop(provider, None)
            return resp.choices[0].message.content or ""
        except Exception as e:
            last_err = e
            if _is_fatal(e):
                _dead_providers.add(provider)
                log.error("OpenAI permanently dead: %s", e)
                raise
            if _is_rate_limited(e):
                new_hits = hits + 1
                _rate_hits[provider] = new_hits
                if new_hits >= _MAX_RATE_HITS:
                    _rate_cooldown_until[provider] = time.time() + _RATE_COOLDOWN_SEC
                    log.warning(
                        "OpenAI: %d consecutive 429s — cooling down for %ds",
                        new_hits,
                        _RATE_COOLDOWN_SEC,
                    )
                    raise
                if attempt == 0:
                    backoff = min(2.0 * (2**hits), 30.0)
                    log.info(
                        "OpenAI rate-limited (hit %d/%d), backing off %.1fs…",
                        new_hits,
                        _MAX_RATE_HITS,
                        backoff,
                    )
                    await asyncio.sleep(backoff)
                    continue
                raise
            log.warning("OpenAI error: %s", e)
            raise

    if last_err:
        raise last_err
    raise RuntimeError("OpenAI: unexpected retry exhaustion")


# ─── Public helpers ──────────────────────────────────────────────────────────

INVESTOR_TYPES = [
    "flipper",
    "landlord",
    "hedge_fund",
    "lender",
    "wholesaler",
    "developer",
    "unknown",
]


def classify_buyer_type(
    buyer_name: str,
    purchase_count: int,
    avg_price: Optional[float],
    prices: Optional[List[float]] = None,
) -> Dict[str, Any]:
    """Rule-based buyer classification from purchase history data.

    This replaces the removed extract_investor_profile() + score_buyer_match() LLM calls.
    Classification is deterministic, auditable, and zero-cost.

    Rules:
      - LLC with "fund", "capital", "asset", "reit" → hedge_fund
      - LLC with "lending", "mortgage", "fund" → lender
      - LLC with "wholesale", "deals", "solutions" → wholesaler
      - LLC with "development", "builder", "construction" → developer
      - ≥15 purchases → likely hedge_fund or landlord (depends on avg price)
      - ≥5 purchases with avg price < $200k → flipper
      - ≥5 purchases with avg price ≥ $200k → landlord
      - < 5 purchases → unknown (not enough data)
    """
    name_lower = (buyer_name or "").lower()

    fund_keywords = ["fund", "capital", "asset management", "reit", "equity", "holdings llc"]
    lending_keywords = ["lending", "mortgage", "loan", "credit", "financial"]
    wholesale_keywords = ["wholesale", "solutions", "deals", "properties llc", "investments llc"]
    dev_keywords = ["development", "builder", "construction", "realty group"]

    # Name-based heuristics (strongest signal for LLCs)
    if any(kw in name_lower for kw in fund_keywords) and purchase_count >= 10:
        buyer_type = "hedge_fund"
        reason = f"Name pattern '{name_lower}' + {purchase_count} purchases"
    elif any(kw in name_lower for kw in lending_keywords):
        buyer_type = "lender"
        reason = f"Name pattern '{name_lower}'"
    elif any(kw in name_lower for kw in dev_keywords):
        buyer_type = "developer"
        reason = f"Name pattern '{name_lower}'"
    elif any(kw in name_lower for kw in wholesale_keywords) and purchase_count < 10:
        buyer_type = "wholesaler"
        reason = f"Name pattern '{name_lower}'"
    # Volume + price heuristics
    elif purchase_count >= 15:
        buyer_type = "hedge_fund" if (avg_price or 0) > 300_000 else "landlord"
        reason = f"{purchase_count} purchases avg ${avg_price:,.0f}" if avg_price else f"{purchase_count} purchases"
    elif purchase_count >= 5:
        buyer_type = "flipper" if (avg_price or 0) < 200_000 else "landlord"
        reason = f"{purchase_count} purchases avg ${avg_price:,.0f}" if avg_price else f"{purchase_count} purchases"
    else:
        buyer_type = "unknown"
        reason = f"Insufficient data ({purchase_count} purchases)"

    return {"buyer_type": buyer_type, "classification_reason": reason}


def score_buyer_match_rule_based(
    buyer: Dict[str, Any],
    lead: Dict[str, Any],
) -> Dict[str, Any]:
    """Rule-based match scoring — replaces the removed score_buyer_match() LLM call.

    Score 0-100 based on:
      - Geographic match (same ZIP = 40pts, same city = 25pts, same state = 10pts)
      - Price bracket match (buyer avg within 50% of lead price = 30pts)
      - Purchase volume (≥10 = 20pts, ≥5 = 10pts, ≥1 = 5pts)
      - Buyer type fit (flipper on distressed = 10pts bonus)
    """
    score = 0
    reasons: List[str] = []

    # Geographic match
    lead_zip = (lead.get("zip") or "").strip()
    lead_city = (lead.get("city") or "").lower().strip()
    lead_state = (lead.get("state") or "").upper().strip()

    buyer_zip = (buyer.get("zip") or "").strip()
    buyer_city = (buyer.get("city") or "").lower().strip()
    buyer_state = (buyer.get("state") or "").upper().strip()

    if lead_zip and buyer_zip and lead_zip == buyer_zip:
        score += 40
        reasons.append(f"Buys in same ZIP ({lead_zip})")
    elif lead_city and buyer_city and lead_city == buyer_city:
        score += 25
        reasons.append(f"Buys in same city ({lead_city.title()})")
    elif lead_state and buyer_state and lead_state == buyer_state:
        score += 10
        reasons.append(f"Active in {lead_state}")

    # Price bracket match
    avg_price = buyer.get("avg_purchase_price")
    lead_price = lead.get("asking_price") or lead.get("current_value") or lead.get("arv")
    if avg_price and lead_price:
        try:
            ratio = float(avg_price) / float(lead_price)
            if 0.5 <= ratio <= 2.0:
                score += 30
                reasons.append(f"Price range match (avg ${avg_price:,.0f})")
            elif 0.25 <= ratio <= 4.0:
                score += 15
                reasons.append(f"Moderate price range match (avg ${avg_price:,.0f})")
        except (TypeError, ZeroDivisionError):
            pass

    # Purchase volume
    portfolio_size = buyer.get("portfolio_size") or 0
    if portfolio_size >= 10:
        score += 20
        reasons.append(f"High-volume buyer ({portfolio_size} purchases)")
    elif portfolio_size >= 5:
        score += 10
        reasons.append(f"Active buyer ({portfolio_size} purchases)")
    elif portfolio_size >= 1:
        score += 5
        reasons.append(f"{portfolio_size} known purchase(s)")

    # Buyer type fit
    buyer_type = buyer.get("buyer_type", "unknown")
    condition = (lead.get("condition") or "").lower()
    if buyer_type == "flipper" and condition in ("distressed", "poor", "fair"):
        score += 10
        reasons.append("Flipper matched to distressed property")
    elif buyer_type == "landlord" and condition in ("good", "excellent", "rentable"):
        score += 10
        reasons.append("Landlord matched to rentable property")

    return {
        "match_score": min(score, 100),
        "match_reasons": reasons[:4],
    }
