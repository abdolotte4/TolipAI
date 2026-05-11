"""Redis-backed job store with in-memory fallback.

Jobs are written to Redis (TTL=24h) for fast cross-process reads and survive
container restarts.  If REDIS_URL is absent or Redis is unreachable the
module transparently falls back to the in-process _memory dict — behaviour
is identical to the old _jobs dict.

On startup call `init()`.  On shutdown call `close()`.
`recover_interrupted_jobs()` scans Postgres for jobs stuck in "running" and
marks them "interrupted" so the frontend doesn't spin forever.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

log = logging.getLogger("job_store")

_redis: Any = None  # redis.asyncio client or None
_memory: Dict[str, Dict[str, Any]] = {}  # always-available fallback
_TTL_SECONDS = 86_400  # 24 h


# ─── Lifecycle ────────────────────────────────────────────────────────────────


async def init(redis_url: Optional[str] = None) -> None:
    """Connect to Redis.  Falls back to in-memory silently if unavailable."""
    global _redis
    url = redis_url or os.getenv("REDIS_URL") or os.getenv("REDIS_PRIVATE_URL")
    if not url:
        log.info("REDIS_URL not set — job store running in-memory only")
        return
    try:
        import redis.asyncio as aioredis  # type: ignore

        client = aioredis.from_url(url, decode_responses=True, socket_timeout=3)
        await client.ping()
        _redis = client
        log.info("Redis job store connected (%s)", url.split("@")[-1] if "@" in url else url)
    except Exception as exc:
        log.warning("Redis unavailable (%s) — falling back to in-memory", exc)
        _redis = None


async def close() -> None:
    global _redis
    if _redis is not None:
        try:
            await _redis.aclose()
        except Exception:
            pass
        _redis = None


# ─── CRUD ─────────────────────────────────────────────────────────────────────


def _key(job_id: str) -> str:
    return f"digor:job:{job_id}"


async def set_job(job_id: str, data: Dict[str, Any]) -> None:
    _memory[job_id] = data
    if _redis is not None:
        try:
            await _redis.setex(_key(job_id), _TTL_SECONDS, json.dumps(data, default=str))
        except Exception as exc:
            log.debug("Redis set_job %s: %s", job_id, exc)


async def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    # 1. Fast in-memory hit
    if job_id in _memory:
        return _memory[job_id]
    # 2. Redis (survives restarts)
    if _redis is not None:
        try:
            raw = await _redis.get(_key(job_id))
            if raw:
                data: Dict[str, Any] = json.loads(raw)
                _memory[job_id] = data  # warm memory cache
                return data
        except Exception as exc:
            log.debug("Redis get_job %s: %s", job_id, exc)
    return None


async def update_job(job_id: str, **kwargs: Any) -> None:
    job = await get_job(job_id) or {"id": job_id}
    job.update(kwargs)
    await set_job(job_id, job)


async def all_jobs() -> Dict[str, Dict[str, Any]]:
    """Return a snapshot of all known jobs (memory + any Redis keys not yet in memory)."""
    if _redis is not None:
        try:
            keys: List[str] = []
            async for k in _redis.scan_iter("digor:job:*", count=100):
                keys.append(k)
            if keys:
                pipe = _redis.pipeline()
                for k in keys:
                    pipe.get(k)
                values = await pipe.execute()
                for k, v in zip(keys, values):
                    if v:
                        jid = k.split(":")[-1]
                        if jid not in _memory:
                            _memory[jid] = json.loads(v)
        except Exception as exc:
            log.debug("Redis all_jobs scan: %s", exc)
    return dict(_memory)


# ─── Startup recovery ─────────────────────────────────────────────────────────


async def recover_interrupted_jobs() -> int:
    """
    After a container restart any job that was "running" or "queued" is now
    orphaned — the asyncio task that was running it is gone.

    This scans Postgres for such jobs and:
      - Marks them "interrupted" so the UI can show a clear error state
        instead of spinning forever.
      - Writes the updated state to Redis so status polls return immediately.

    Returns the number of jobs recovered.
    """
    try:
        from . import db as _db  # local import to avoid circular dep at module load

        pool = await _db.init_pool()
        if pool is None:
            return 0

        async with pool.acquire() as c:
            rows = await c.fetch(
                """
                UPDATE scraper_jobs
                   SET status = 'interrupted',
                       error  = 'Container restarted during job execution'
                 WHERE status IN ('running', 'queued')
                   AND completed_at IS NULL
                RETURNING id, job_type, status
                """,
            )

        count = len(rows)
        if count:
            log.warning("Recovered %d interrupted job(s) from previous run", count)
            for row in rows:
                jid = row["id"]
                job_data = {
                    "id": jid,
                    "type": row["job_type"],
                    "status": "interrupted",
                    "progress": 0,
                    "error": "Container restarted during job execution",
                    "result": None,
                }
                await set_job(jid, job_data)
        return count

    except Exception as exc:
        log.warning("recover_interrupted_jobs failed: %s", exc)
        return 0
