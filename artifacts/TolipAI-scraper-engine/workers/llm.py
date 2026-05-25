"""LLM client — provider chain with circuit breakers.

Provider order (Kimi K2.6 first, free fallback second):
  Moonshot (Kimi K2.6 direct) → OpenRouter (Kimi K2.6) → Groq → Cerebras → Together → NVIDIA

Kimi K2.6 features:
  - 1M token context window, 200K input tokens
  - Agent swarm support (up to 300 parallel agents)
  - Top-tier coding and reasoning model

All providers expose an OpenAI-compatible Chat Completions API.
Circuit breakers: each provider is permanently skipped after its first
unrecoverable failure (suspended / deprecated / auth error) so the same
error never spams the logs.  Transient 429s are retried with backoff (max 2
retries) before the provider is considered dead for this process lifetime.
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
_groq_client: Optional[AsyncOpenAI] = None
_cerebras_client: Optional[AsyncOpenAI] = None
_together_client: Optional[AsyncOpenAI] = None
_nvidia_client: Optional[AsyncOpenAI] = None
_openrouter_client: Optional[AsyncOpenAI] = None
_moonshot_client: Optional[AsyncOpenAI] = None

# Permanently dead providers (auth/deprecated errors — never recoverable)
_dead_providers: Set[str] = set()
# Track 429 consecutive hits per provider (reset on success)
_rate_hits: Dict[str, int] = {}
# Cooldown: provider → unix timestamp when it's allowed to retry after rate-limit
_rate_cooldown_until: Dict[str, float] = {}
_MAX_RATE_HITS = 8  # cooldown after 8 consecutive 429s (was: permanently die at 5)
_RATE_COOLDOWN_SEC = 180  # 3-minute cooldown before retrying a rate-limited provider

# Global concurrency gate — Groq free tier is ~30 req/min.
# Limiting to 2 concurrent calls keeps us well under the limit and
# eliminates the 429 storm that happens when 40+ buyers are processed at once.
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


def _groq() -> Optional[AsyncOpenAI]:
    global _groq_client
    if _groq_client is None and settings.groq_api_key:
        _groq_client = AsyncOpenAI(
            api_key=settings.groq_api_key,
            base_url=settings.groq_base_url,
        )
    return _groq_client


def _cerebras() -> Optional[AsyncOpenAI]:
    global _cerebras_client
    if _cerebras_client is None and settings.cerebras_api_key:
        _cerebras_client = AsyncOpenAI(
            api_key=settings.cerebras_api_key,
            base_url=settings.cerebras_base_url,
        )
    return _cerebras_client


def _together() -> Optional[AsyncOpenAI]:
    global _together_client
    if _together_client is None and settings.together_api_key:
        _together_client = AsyncOpenAI(
            api_key=settings.together_api_key,
            base_url=settings.together_base_url,
        )
    return _together_client


def _nvidia() -> Optional[AsyncOpenAI]:
    global _nvidia_client
    if _nvidia_client is None and settings.nvidia_api_key:
        _nvidia_client = AsyncOpenAI(
            api_key=settings.nvidia_api_key,
            base_url=settings.nvidia_base_url,
        )
    return _nvidia_client


def _openrouter() -> Optional[AsyncOpenAI]:
    global _openrouter_client
    if _openrouter_client is None and settings.openrouter_api_key:
        _openrouter_client = AsyncOpenAI(
            api_key=settings.openrouter_api_key,
            base_url=settings.openrouter_base_url,
            default_headers={
                "HTTP-Referer": "https://tolipai.com",
                "X-Title": "TolipAI",
            },
        )
    return _openrouter_client


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
) -> str:
    """Run a chat completion through the provider chain with circuit breakers.

    Provider order: Moonshot/Kimi K2.6 → OpenRouter/Kimi K2.6 → Groq (free fallback).
    Each provider is skipped silently after its first fatal error.
    Rate-limit (429) is retried up to _MAX_RATE_HITS times before moving on.
    A global semaphore caps concurrent calls so we never hammer free-tier limits.
    """
    async with _get_sem():
        return await _chat_inner(
            messages,
            json_mode=json_mode,
            temperature=temperature,
            max_tokens=max_tokens,
        )


def _ensure_json_in_messages(messages: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Groq requires the word 'json' to appear in messages when json_object mode is used.

    If no message contains the word 'json', append a short reminder to the
    last system message (or the first user message as a fallback).
    """
    combined = " ".join(m.get("content", "") for m in messages).lower()
    if "json" in combined:
        return messages  # already compliant

    result = list(messages)
    for i, m in enumerate(result):
        if m.get("role") == "system":
            result[i] = {**m, "content": m["content"] + " Respond with valid JSON."}
            return result
    # No system message — append to first user message
    if result:
        result[0] = {
            **result[0],
            "content": result[0].get("content", "") + " Respond with valid JSON.",
        }
    return result


async def _chat_inner(
    messages: List[Dict[str, str]],
    *,
    json_mode: bool = True,
    temperature: float = 0.2,
    max_tokens: int = 1500,
) -> str:
    import os as _os

    # ── Amazon Bedrock short-circuit (USE_BEDROCK=1) ──────────────────────────
    if _os.getenv("USE_BEDROCK") == "1":
        try:
            import boto3 as _boto3  # type: ignore[import]
            import json as _json

            def _bedrock_sync() -> str:
                client = _boto3.client(
                    "bedrock-runtime",
                    region_name=_os.getenv("AWS_REGION", "us-east-1"),
                )
                body = _json.dumps(
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
                    modelId=_os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-3-sonnet-20240229-v1:0"),
                    body=body,
                    contentType="application/json",
                    accept="application/json",
                )
                out = _json.loads(resp["body"].read())
                return " ".join(c["text"] for c in out.get("content", []) if "text" in c)

            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, _bedrock_sync)
            log.info("LLM: Bedrock response received (%d chars)", len(result))
            return result
        except Exception as bedrock_exc:
            log.warning("Bedrock call failed — falling back to provider chain: %s", bedrock_exc)

    # Ensure Groq's json_object requirement is satisfied before any provider call
    if json_mode:
        messages = _ensure_json_in_messages(messages)

    # Provider order: Kimi K2.6 first (best model), OpenAI paid second, free tiers last.
    providers = [
        ("moonshot", _moonshot, settings.moonshot_model),    # Kimi K2.6 direct API
        ("openrouter", _openrouter, settings.openrouter_model),  # Kimi K2.6 via OpenRouter
        ("openai", _openai, settings.openai_model),           # GPT-4o-mini — reliable paid
        ("groq", _groq, settings.groq_model),                 # Free, fast (rate-limited)
        ("cerebras", _cerebras, settings.cerebras_model),
        ("together", _together, settings.together_model),
        ("nvidia", _nvidia, settings.nvidia_model),
    ]
    last_err: Optional[Exception] = None
    for provider, client_fn, model in providers:
        if provider in _dead_providers:
            continue
        client = client_fn()
        if client is None:
            continue
        hits = _rate_hits.get(provider, 0)
        # Check cooldown — provider may recover after _RATE_COOLDOWN_SEC
        cooldown_until = _rate_cooldown_until.get(provider, 0.0)
        if hits >= _MAX_RATE_HITS:
            if time.time() < cooldown_until:
                remaining = int(cooldown_until - time.time())
                log.debug("LLM provider %s in cooldown for %ds more", provider, remaining)
                continue
            else:
                # Cooldown expired — give this provider another chance
                log.info("LLM provider %s cooldown expired, retrying", provider)
                _rate_hits[provider] = 0
                hits = 0
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
                _LLM_TIMEOUT = float(__import__("os").getenv("LLM_TIMEOUT_SEC", "90"))
                resp = await asyncio.wait_for(
                    client.chat.completions.create(**kwargs),
                    timeout=_LLM_TIMEOUT,
                )
                _rate_hits[provider] = 0  # reset on success
                _rate_cooldown_until.pop(provider, None)
                return resp.choices[0].message.content or ""
            except Exception as e:
                last_err = e
                err_str = str(e)
                # Groq-specific: json_object mode without 'json' in messages — permanent config error
                if "must contain the word" in err_str and "json" in err_str.lower():
                    _dead_providers.add(provider)
                    log.warning(
                        "LLM provider %s permanently skipped: JSON mode misconfiguration — %s",
                        provider,
                        e,
                    )
                    break
                if _is_fatal(e):
                    _dead_providers.add(provider)
                    log.warning("LLM provider %s permanently dead: %s", provider, e)
                    break
                if _is_rate_limited(e):
                    new_hits = hits + 1
                    _rate_hits[provider] = new_hits
                    if new_hits >= _MAX_RATE_HITS:
                        _rate_cooldown_until[provider] = time.time() + _RATE_COOLDOWN_SEC
                        log.warning(
                            "LLM provider %s: %d consecutive 429s — cooling down for %ds",
                            provider,
                            new_hits,
                            _RATE_COOLDOWN_SEC,
                        )
                        break
                    if attempt == 0:
                        backoff = min(2.0 * (2**hits), 30.0)  # 2s → 4s → 8s … cap 30s
                        log.info(
                            "LLM provider %s rate-limited (hit %d/%d), backing off %.1fs…",
                            provider,
                            new_hits,
                            _MAX_RATE_HITS,
                            backoff,
                        )
                        await asyncio.sleep(backoff)
                        continue
                    log.info(
                        "LLM provider %s rate-limited, moving to next provider",
                        provider,
                    )
                    break
                log.warning("LLM provider %s error: %s", provider, e)
                break  # non-fatal non-rate error → try next provider

    if last_err:
        raise last_err
    raise RuntimeError(
        "No LLM provider available — set OPENAI_API_KEY, MOONSHOT_KIMI_API_KEY (Kimi K2.6), "
        "OPENROUTER_API_KEY, or GROQ_API_KEY in Replit Secrets"
    )


# ─── Public helpers ──────────────────────────────────────────────────────────

INVESTOR_TYPES = [
    "flipper",
    "landlord",
    "hedge_fund",
    "lender",
    "wholesaler",
    "unknown",
]


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
        json_mode=True,
        max_tokens=900,
    )
    try:
        data = json.loads(raw)
    except Exception:
        log.warning("LLM returned non-JSON: %s", raw[:200])
        return {
            "buyer_name": "Unknown",
            "buyer_type": "unknown",
            "raw_data": {"text": text[:1000]},
        }
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
        "buyer": {
            k: buyer.get(k)
            for k in (
                "buyer_name",
                "llc_name",
                "buyer_type",
                "city",
                "state",
                "zip",
                "portfolio_size",
                "portfolio_value",
                "avg_purchase_price",
            )
        },
        "lead": {
            k: lead.get(k)
            for k in (
                "address",
                "city",
                "state",
                "zip",
                "beds",
                "baths",
                "sqft",
                "year_built",
                "current_value",
                "asking_price",
                "arv",
                "condition",
            )
        },
    }
    raw = await _chat(
        [
            {"role": "system", "content": sys},
            {"role": "user", "content": json.dumps(payload, default=str)},
        ],
        json_mode=True,
        max_tokens=300,
        temperature=0.3,
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
        json_mode=True,
        max_tokens=1500,
        temperature=0.1,
    )
    try:
        data = json.loads(raw)
        listings = data.get("listings") or []
        return [lst for lst in listings if isinstance(lst, dict) and lst.get("address")]
    except Exception:
        log.warning("LLM distressed parse returned non-JSON")
        return []


async def suggest_distressed_sources(
    *, state: str, category: str, county: str = "", city: str = ""
) -> List[Dict[str, Any]]:
    """Suggest fallback source URLs for a state/category when registry coverage is thin."""
    sys = (
        "You discover free public-record or public-web distressed-property sources in the United States. "
        "Return strictly JSON {sources:[...]} with 3-5 items. Each item must include: "
        "name, url, render (boolean), notes, category, state, key. "
        "Prefer official county clerk, trustee, assessor, probate, or state foreclosure pages. "
        "If the exact county page is unknown, use the main metro county for the state. "
        "Do not invent private paid services."
    )
    user = {
        "state": state.upper(),
        "category": category,
        "county": county,
        "city": city,
    }
    raw = await _chat(
        [
            {"role": "system", "content": sys},
            {"role": "user", "content": json.dumps(user)},
        ],
        json_mode=True,
        max_tokens=900,
        temperature=0.2,
    )
    try:
        data = json.loads(raw)
        sources = data.get("sources") or []
        out: List[Dict[str, Any]] = []
        for idx, src in enumerate(sources):
            if not isinstance(src, dict) or not src.get("url"):
                continue
            out.append(
                {
                    "key": src.get("key") or f"{state.lower()}-{category}-{idx+1}",
                    "category": src.get("category") or category,
                    "state": src.get("state") or state.upper(),
                    "name": src.get("name") or src.get("url"),
                    "url": src["url"],
                    "render": bool(src.get("render", True)),
                    "notes": src.get("notes") or "",
                }
            )
        return out[:5]
    except Exception:
        log.warning("LLM source discovery returned non-JSON")
        return []
