"""Dual-layer cache: Redis (fast, in-process) + S3 (persistent, cross-container).

Architecture
────────────
  L1: Redis (ElastiCache / upstash) — sub-millisecond, TTL-based
  L2: S3 — persistent across container restarts, used for large payloads

Both layers are optional — if Redis or S3 is unavailable the cache degrades
gracefully to a simple in-memory dict (no persistence).

ETag / Last-Modified support
────────────────────────────
  cache.get_etag(url) → stored ETag string or None
  cache.set_etag(url, etag, content)

  In your fetcher:
    etag = await cache.get_etag(url)
    headers = {"If-None-Match": etag} if etag else {}
    r = await client.get(url, headers=headers)
    if r.status_code == 304:
        return await cache.get(url)   # serve from cache
    await cache.set_etag(url, r.headers.get("ETag"), r.text)
    return r.text

Usage
─────
    from .cache import cache

    html = await cache.get("https://example.com/page")
    if html is None:
        html = await fetch_direct(url)
        await cache.set("https://example.com/page", html, ttl=3600)

    # Or use get_or_fetch helper:
    html = await cache.get_or_fetch(url, lambda: fetch_direct(url), ttl=3600)
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from typing import Any, Callable, Coroutine, Optional

log = logging.getLogger("cache")

# ── Config ────────────────────────────────────────────────────────────────────
_DEFAULT_TTL = int(os.getenv("CACHE_DEFAULT_TTL", "3600"))          # 1 hour
_S3_BUCKET = os.getenv("S3_CACHE_BUCKET")                           # optional
_S3_PREFIX = os.getenv("S3_CACHE_PREFIX", "scraper-cache/")
_REDIS_KEY_PREFIX = "TolipAI:cache:"
_REDIS_TTL = int(os.getenv("CACHE_REDIS_TTL", "86400"))             # 24h max in Redis

# ── Fallback in-memory store ──────────────────────────────────────────────────
_memory: dict[str, tuple[Any, float]] = {}  # key → (value, expiry_epoch)


def _cache_key(raw_key: str) -> str:
    """Normalise + hash long keys (URLs) for Redis key safety."""
    if len(raw_key) <= 200:
        safe = raw_key.replace(" ", "_").replace("\n", "")[:200]
        return f"{_REDIS_KEY_PREFIX}{safe}"
    digest = hashlib.sha256(raw_key.encode()).hexdigest()[:16]
    return f"{_REDIS_KEY_PREFIX}sha256:{digest}"


# ── Redis helper (imported lazily to avoid import errors if not installed) ────
_redis_client: Any = None


async def _get_redis() -> Any:
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    url = os.getenv("REDIS_URL") or os.getenv("REDIS_PRIVATE_URL")
    if not url:
        return None
    try:
        import redis.asyncio as aioredis  # type: ignore
        client = aioredis.from_url(url, decode_responses=True, socket_timeout=2)
        await client.ping()
        _redis_client = client
        log.info("Cache: Redis connected (%s)", url.split("@")[-1] if "@" in url else url)
    except Exception as exc:
        log.debug("Cache: Redis unavailable (%s) — memory-only", exc)
        _redis_client = None
    return _redis_client


# ── S3 helper ─────────────────────────────────────────────────────────────────
_s3_client: Any = None
_s3_ok: Optional[bool] = None


async def _get_s3():
    global _s3_client, _s3_ok
    if _s3_ok is False:
        return None
    if _s3_client is not None:
        return _s3_client
    if not _S3_BUCKET:
        _s3_ok = False
        return None
    try:
        import aioboto3  # type: ignore
        session = aioboto3.Session()
        _s3_client = session
        _s3_ok = True
        log.info("Cache: S3 enabled (bucket=%s, prefix=%s)", _S3_BUCKET, _S3_PREFIX)
    except ImportError:
        log.debug("Cache: aioboto3 not installed — S3 cache disabled")
        _s3_ok = False
        _s3_client = None
    return _s3_client


def _s3_object_key(cache_key: str) -> str:
    safe = cache_key.replace(_REDIS_KEY_PREFIX, "").replace(":", "/").replace(" ", "_")
    return f"{_S3_PREFIX}{safe}.json"


# ── Public API ────────────────────────────────────────────────────────────────

class Cache:
    """Dual-layer cache with in-memory fallback."""

    async def get(self, key: str) -> Optional[Any]:
        """Return cached value or None if not found / expired."""
        # L0: memory (fastest, process-local)
        if key in _memory:
            val, exp = _memory[key]
            if time.time() < exp:
                return val
            del _memory[key]

        # L1: Redis
        redis = await _get_redis()
        if redis is not None:
            try:
                raw = await redis.get(_cache_key(key))
                if raw:
                    data = json.loads(raw)
                    _memory[key] = (data["v"], time.time() + data.get("ttl", _DEFAULT_TTL))
                    return data["v"]
            except Exception as exc:
                log.debug("Cache Redis get error: %s", exc)

        # L2: S3 (only for misses on Redis)
        s3 = await _get_s3()
        if s3 is not None:
            try:
                async with s3.client("s3") as client:
                    resp = await client.get_object(
                        Bucket=_S3_BUCKET, Key=_s3_object_key(_cache_key(key))
                    )
                    body = await resp["Body"].read()
                    data = json.loads(body)
                    if time.time() < data.get("exp", 0):
                        val = data["v"]
                        # Warm Redis from S3
                        if redis is not None:
                            remaining = int(data["exp"] - time.time())
                            try:
                                await redis.setex(
                                    _cache_key(key),
                                    min(remaining, _REDIS_TTL),
                                    json.dumps({"v": val, "ttl": remaining}, default=str),
                                )
                            except Exception as exc:
                                log.debug("Cache redis setex error: %s", exc)
                        _memory[key] = (val, data["exp"])
                        return val
            except Exception as exc:
                log.debug("Cache S3 get error: %s", exc)

        return None

    async def set(self, key: str, value: Any, *, ttl: int = _DEFAULT_TTL) -> None:
        """Store value in all available cache layers."""
        expiry = time.time() + ttl
        _memory[key] = (value, expiry)

        redis = await _get_redis()
        if redis is not None:
            try:
                payload = json.dumps({"v": value, "ttl": ttl}, default=str)
                await redis.setex(_cache_key(key), min(ttl, _REDIS_TTL), payload)
            except Exception as exc:
                log.debug("Cache Redis set error: %s", exc)

        s3 = await _get_s3()
        if s3 is not None:
            try:
                s3_data = json.dumps({"v": value, "exp": expiry}, default=str)
                async with s3.client("s3") as client:
                    await client.put_object(
                        Bucket=_S3_BUCKET,
                        Key=_s3_object_key(_cache_key(key)),
                        Body=s3_data.encode(),
                        ContentType="application/json",
                    )
            except Exception as exc:
                log.debug("Cache S3 set error: %s", exc)

    async def delete(self, key: str) -> None:
        """Invalidate a cache entry across all layers."""
        _memory.pop(key, None)
        redis = await _get_redis()
        if redis is not None:
            try:
                await redis.delete(_cache_key(key))
            except Exception as exc:
                log.debug("Cache redis del error: %s", exc)

    async def get_or_fetch(
        self,
        key: str,
        fetch_fn: Callable[[], Coroutine[Any, Any, Any]],
        *,
        ttl: int = _DEFAULT_TTL,
    ) -> Any:
        """Return cached value if present, otherwise call fetch_fn, store, and return."""
        cached = await self.get(key)
        if cached is not None:
            return cached
        result = await fetch_fn()
        if result is not None:
            await self.set(key, result, ttl=ttl)
        return result

    # ── ETag / conditional-fetch support ──────────────────────────────────────

    async def get_etag(self, url: str) -> Optional[str]:
        """Return the stored ETag for a URL, or None."""
        data = await self.get(f"etag:{url}")
        if isinstance(data, dict):
            return data.get("etag")
        return None

    async def set_etag(self, url: str, etag: Optional[str], content: Any, *, ttl: int = _DEFAULT_TTL) -> None:
        """Store content alongside its ETag for conditional fetching."""
        if etag:
            await self.set(f"etag:{url}", {"etag": etag, "content": content}, ttl=ttl)
        await self.set(url, content, ttl=ttl)

    async def get_with_etag(self, url: str) -> tuple[Optional[Any], Optional[str]]:
        """Return (content, etag) or (None, None) on cache miss."""
        data = await self.get(f"etag:{url}")
        if isinstance(data, dict):
            return data.get("content"), data.get("etag")
        content = await self.get(url)
        return content, None

    # ── Stats / health ────────────────────────────────────────────────────────

    async def stats(self) -> dict:
        redis = await _get_redis()
        redis_connected = redis is not None
        redis_keys = 0
        if redis_connected:
            try:
                redis_keys = sum(1 async for _ in redis.scan_iter(f"{_REDIS_KEY_PREFIX}*", count=200))
            except Exception as exc:
                log.debug("Cache redis scan error: %s", exc)
        return {
            "memory_entries": len(_memory),
            "redis_connected": redis_connected,
            "redis_keys": redis_keys,
            "s3_enabled": bool(_S3_BUCKET and _s3_ok),
            "s3_bucket": _S3_BUCKET,
        }


# ── Module singleton ──────────────────────────────────────────────────────────
cache = Cache()
