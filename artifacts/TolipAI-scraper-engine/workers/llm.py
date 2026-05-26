"""LLM client — OpenAI only with circuit breaker and concurrency gate.

All non-OpenAI providers (Groq, Cerebras, Together, NVIDIA, OpenRouter, Moonshot)
have been removed.  They were causing runaway 429s, credit-bleeding on free tiers,
and cascading failures that hung jobs indefinitely.

Provider: OpenAI (gpt-4o-mini default, configurable via OPENAI_MODEL env var).
Circuit breaker: permanently skips on fatal errors (auth/suspended/deprecated).
Rate-limit: exponential backoff up to _MAX_RATE_HITS before cooling down.
Concurrency: global semaphore (LLM_CONCURRENCY, default 2) caps concurrent calls.
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
) -> str:
    """Run a chat completion through OpenAI with circuit breaker + rate-limit backoff.

    Uses a global semaphore to cap concurrent calls.  On fatal errors the provider
    is permanently skipped for this process lifetime.  On rate limits, exponential
    backoff is applied before giving up and entering cooldown.
    """
    async with _get_sem():
        return await _chat_inner(
            messages,
            json_mode=json_mode,
            temperature=temperature,
            max_tokens=max_tokens,
        )


async def _chat_inner(
    messages: List[Dict[str, str]],
    *,
    json_mode: bool = True,
    temperature: float = 0.2,
    max_tokens: int = 1500,
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
                "model": settings.openai_model,
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
