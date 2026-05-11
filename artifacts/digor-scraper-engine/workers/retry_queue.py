"""Retry-queue for transient job failures — Redis Streams backend.

Architecture
────────────
• Primary backend: Redis Streams (XADD / XREADGROUP / XACK)
  - Survives container restarts (Fargate Spot interruptions)
  - Cross-container visibility (multiple ECS tasks share the queue)
  - Built-in consumer group semantics with at-least-once delivery

• Fallback backend: asyncio.deque (in-memory)
  - Used when REDIS_URL is not set or Redis is unreachable
  - Behaviour identical to the pre-Fargate version

Streams layout
──────────────
  Stream key:    digor:retry-stream
  Consumer group: digor-scrapers
  Consumer name:  <hostname>-<pid> (unique per ECS task)

  Message fields per entry:
    job_id, job_type, params (JSON), attempt, last_error, enqueued_at

Error classification
────────────────────
• Transient → retry (429, timeout, 502, 503, SSL, …)
• Fatal     → fail permanently (401, 403, deprecated, invalid key, …)

Backoff schedule
────────────────
  attempt 0 → 60 s
  attempt 1 → 300 s  (5 min)
  attempt 2 → 900 s  (15 min)
  attempt 3 → permanently failed

Usage in main.py
────────────────
    from .retry_queue import retry_queue, is_transient

    if is_transient(e) and retry_queue.enqueue(job_id, "cash_buyers", params):
        await db.update_job(job_id, status="retry_pending", error=str(e))
    else:
        await db.update_job(job_id, status="failed", error=str(e), completed=True)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine, Dict, Optional

log = logging.getLogger("retry_queue")

POLL_INTERVAL = 30       # seconds between in-memory queue scans
MAX_ATTEMPTS = 3         # retries before permanently failing
BACKOFF = [60, 300, 900] # seconds per attempt index (0-based)
MAX_QUEUE_SIZE = 500     # reject new retries beyond this depth

# Redis Streams constants
_STREAM_KEY = os.getenv("RETRY_STREAM_KEY", "digor:retry-stream")
_GROUP_NAME  = os.getenv("RETRY_GROUP_NAME",  "digor-scrapers")
_CONSUMER    = f"{socket.gethostname()}-{os.getpid()}"
_BLOCK_MS    = 5_000    # XREAD block timeout
_BATCH_SIZE  = 10       # messages read per XREADGROUP call


# ─── Error classification ────────────────────────────────────────────────────

_TRANSIENT_KEYWORDS = (
    "429", "rate limit", "too many requests", "timeout", "timed out",
    "read timeout", "connect timeout", "connection reset", "connection refused",
    "dns", "name or service not known", "502", "503", "504",
    "service unavailable", "bad gateway", "temporary", "retry", "ssl",
    "certificate",
)

_FATAL_KEYWORDS = (
    "401", "403", "unauthorized", "forbidden", "suspended", "account",
    "deprecated", "not found", "no such model", "does not exist",
    "invalid api key", "quota exceeded", "dataerror", "invalid input",
)


def is_transient(exc: Exception) -> bool:
    """Return True if the exception looks like a transient / retry-able failure."""
    msg = str(exc).lower()
    if any(k in msg for k in _FATAL_KEYWORDS):
        return False
    return any(k in msg for k in _TRANSIENT_KEYWORDS)


# ─── Data model ──────────────────────────────────────────────────────────────

@dataclass
class PendingRetry:
    job_id: str
    job_type: str
    params: Dict[str, Any]
    attempt: int = 0
    retry_at: float = field(default_factory=time.monotonic)
    last_error: str = ""


# ─── Redis Streams backend ────────────────────────────────────────────────────

_redis: Any = None
_redis_ok: bool = False


async def _get_redis() -> Any:
    global _redis, _redis_ok
    if _redis is not None:
        return _redis
    url = os.getenv("REDIS_URL") or os.getenv("REDIS_PRIVATE_URL")
    if not url:
        return None
    try:
        import redis.asyncio as aioredis  # type: ignore
        client = aioredis.from_url(url, decode_responses=True, socket_timeout=3)
        await client.ping()
        _redis = client
        _redis_ok = True
        log.info("RetryQueue: Redis Streams connected (%s)", url.split("@")[-1] if "@" in url else url)
        return _redis
    except Exception as exc:
        log.warning("RetryQueue: Redis unavailable (%s) — falling back to in-memory deque", exc)
        return None


async def _ensure_stream_group(r: Any) -> None:
    """Create the consumer group if it doesn't exist yet."""
    try:
        await r.xgroup_create(_STREAM_KEY, _GROUP_NAME, id="0", mkstream=True)
        log.info("RetryQueue: created consumer group '%s' on stream '%s'", _GROUP_NAME, _STREAM_KEY)
    except Exception as exc:
        if "BUSYGROUP" in str(exc):
            pass  # group already exists
        else:
            log.warning("RetryQueue: xgroup_create failed: %s", exc)


async def _stream_enqueue(
    r: Any,
    job_id: str,
    job_type: str,
    params: Dict[str, Any],
    *,
    attempt: int,
    last_error: str,
    delay: int,
) -> bool:
    """Push one retry entry onto the Redis stream with a scheduled timestamp."""
    retry_at_epoch = time.time() + delay
    try:
        await r.xadd(
            _STREAM_KEY,
            {
                "job_id":       job_id,
                "job_type":     job_type,
                "params":       json.dumps(params, default=str),
                "attempt":      str(attempt),
                "last_error":   last_error[:200],
                "retry_at":     str(retry_at_epoch),
                "enqueued_at":  str(time.time()),
            },
        )
        log.info(
            "RetryQueue(stream): job %s enqueued for retry #%d in %ds",
            job_id, attempt + 1, delay,
        )
        return True
    except Exception as exc:
        log.error("RetryQueue(stream): xadd failed: %s", exc)
        return False


async def _stream_drain_once(
    r: Any,
    runners: Dict[str, Callable[..., Coroutine]],
    on_success: Any,
    on_exhaust: Any,
) -> None:
    """Read ready messages from the stream and execute them."""
    now = time.time()
    try:
        # Read pending messages for this consumer (unacknowledged from previous runs)
        pending = await r.xreadgroup(
            _GROUP_NAME, _CONSUMER,
            {_STREAM_KEY: "0"},
            count=_BATCH_SIZE,
            block=0,
        )
        # Also read new messages
        new_msgs = await r.xreadgroup(
            _GROUP_NAME, _CONSUMER,
            {_STREAM_KEY: ">"},
            count=_BATCH_SIZE,
            block=0,
        )
    except Exception as exc:
        log.warning("RetryQueue(stream): xreadgroup failed: %s", exc)
        return

    all_msgs = []
    for result in (pending or [], new_msgs or []):
        if result:
            _, messages = result[0]
            all_msgs.extend(messages)

    for msg_id, fields in all_msgs:
        retry_at = float(fields.get("retry_at", 0))
        if retry_at > now:
            # Not ready yet — leave it for the next poll
            continue

        job_id   = fields.get("job_id", "?")
        job_type = fields.get("job_type", "?")
        attempt  = int(fields.get("attempt", 0))
        last_err = fields.get("last_error", "")
        params: Dict[str, Any] = {}
        try:
            params = json.loads(fields.get("params", "{}"))
        except Exception:
            pass

        runner = runners.get(job_type)
        if runner is None:
            log.warning("RetryQueue: no runner for job_type=%s — dropping %s", job_type, job_id)
            await _ack(r, msg_id)
            continue

        log.info("RetryQueue(stream): retrying job %s (attempt %d/%d)…", job_id, attempt + 1, MAX_ATTEMPTS)
        try:
            result = await runner(job_id, params)
            log.info("RetryQueue(stream): retry succeeded for job %s", job_id)
            await _ack(r, msg_id)
            if on_success:
                await on_success(job_id, result)
        except Exception as exc:
            log.warning("RetryQueue(stream): retry #%d failed for %s: %s", attempt + 1, job_id, exc)
            await _ack(r, msg_id)  # ACK so it's removed from PEL; we'll re-add if needed
            next_attempt = attempt + 1
            if next_attempt >= MAX_ATTEMPTS:
                log.error("RetryQueue(stream): job %s exhausted %d retries — permanent failure", job_id, MAX_ATTEMPTS)
                if on_exhaust:
                    await on_exhaust(job_id, str(exc))
            else:
                delay = BACKOFF[min(next_attempt, len(BACKOFF) - 1)]
                await _stream_enqueue(
                    r, job_id, job_type, params,
                    attempt=next_attempt, last_error=str(exc), delay=delay,
                )


async def _ack(r: Any, msg_id: str) -> None:
    try:
        await r.xack(_STREAM_KEY, _GROUP_NAME, msg_id)
    except Exception as exc:
        log.debug("RetryQueue: xack failed for %s: %s", msg_id, exc)


async def _stream_size(r: Any) -> int:
    try:
        return await r.xlen(_STREAM_KEY)
    except Exception:
        return 0


async def _stream_pending_snapshot(r: Any) -> list[Dict[str, Any]]:
    """Return a snapshot of pending retry entries for /jobs/retries."""
    now = time.time()
    result = []
    try:
        msgs = await r.xrange(_STREAM_KEY, count=200)
        for msg_id, fields in msgs:
            retry_at = float(fields.get("retry_at", 0))
            result.append({
                "job_id":           fields.get("job_id"),
                "job_type":         fields.get("job_type"),
                "attempt":          int(fields.get("attempt", 0)) + 1,
                "max_attempts":     MAX_ATTEMPTS,
                "retry_in_seconds": max(0, int(retry_at - now)),
                "last_error":       fields.get("last_error", "")[:120],
                "stream_id":        msg_id,
            })
    except Exception as exc:
        log.debug("RetryQueue: stream snapshot failed: %s", exc)
    return result


# ─── Queue — unified interface ────────────────────────────────────────────────

class RetryQueue:
    """
    Unified retry queue — Redis Streams primary, asyncio.deque fallback.

    The external API is identical to the old in-memory version so nothing in
    main.py needs to change except calling `await retry_queue.init()` at startup.
    """

    def __init__(self) -> None:
        self._deque: deque[PendingRetry] = deque()
        self._lock = asyncio.Lock()
        self._task: Optional[asyncio.Task] = None
        self._runners: Dict[str, Callable[..., Coroutine]] = {}
        self._use_redis: bool = False

    async def init(self) -> None:
        """Connect to Redis and set up the consumer group. Call once at startup."""
        r = await _get_redis()
        if r is not None:
            await _ensure_stream_group(r)
            self._use_redis = True
            log.info("RetryQueue: using Redis Streams backend (stream=%s, group=%s)", _STREAM_KEY, _GROUP_NAME)
        else:
            log.info("RetryQueue: using in-memory deque (Redis unavailable)")

    def register(self, job_type: str, runner: Callable[..., Coroutine]) -> None:
        self._runners[job_type] = runner

    def enqueue(
        self,
        job_id: str,
        job_type: str,
        params: Dict[str, Any],
        *,
        attempt: int = 0,
        last_error: str = "",
    ) -> bool:
        """Push a retry. Returns False if max attempts exceeded or queue is full."""
        if attempt >= MAX_ATTEMPTS:
            log.warning(
                "Job %s (%s) exhausted %d retries — permanently failed: %s",
                job_id, job_type, MAX_ATTEMPTS, last_error,
            )
            return False

        delay = BACKOFF[min(attempt, len(BACKOFF) - 1)]

        if self._use_redis:
            # Schedule async enqueue — fire-and-forget (non-blocking for callers)
            asyncio.create_task(
                self._async_enqueue(job_id, job_type, params, attempt=attempt, last_error=last_error, delay=delay),
                name=f"retry-enqueue-{job_id}",
            )
            return True
        else:
            # In-memory fallback
            if len(self._deque) >= MAX_QUEUE_SIZE:
                log.warning("RetryQueue full (%d) — dropping retry for %s", MAX_QUEUE_SIZE, job_id)
                return False
            entry = PendingRetry(
                job_id=job_id, job_type=job_type, params=params,
                attempt=attempt, retry_at=time.monotonic() + delay, last_error=last_error,
            )
            self._deque.append(entry)
            log.info("RetryQueue(mem): job %s enqueued for retry #%d in %ds", job_id, attempt + 1, delay)
            return True

    async def _async_enqueue(
        self,
        job_id: str,
        job_type: str,
        params: Dict[str, Any],
        *,
        attempt: int,
        last_error: str,
        delay: int,
    ) -> None:
        r = await _get_redis()
        if r:
            await _stream_enqueue(r, job_id, job_type, params, attempt=attempt, last_error=last_error, delay=delay)
        else:
            # Redis went away — fall back to in-memory
            if len(self._deque) < MAX_QUEUE_SIZE:
                self._deque.append(
                    PendingRetry(
                        job_id=job_id, job_type=job_type, params=params,
                        attempt=attempt, retry_at=time.monotonic() + delay, last_error=last_error,
                    )
                )

    def pending(self) -> list[Dict[str, Any]]:
        """Snapshot of all pending retries (for the /jobs/retries endpoint)."""
        if self._use_redis:
            # Return empty list synchronously; callers can use await pending_async()
            return []
        now = time.monotonic()
        return [
            {
                "job_id":           e.job_id,
                "job_type":         e.job_type,
                "attempt":          e.attempt + 1,
                "max_attempts":     MAX_ATTEMPTS,
                "retry_in_seconds": max(0, int(e.retry_at - now)),
                "last_error":       e.last_error[:120],
            }
            for e in self._deque
        ]

    async def pending_async(self) -> list[Dict[str, Any]]:
        """Async snapshot that works for both backends."""
        if self._use_redis:
            r = await _get_redis()
            if r:
                return await _stream_pending_snapshot(r)
            return []
        return self.pending()

    def size(self) -> int:
        return len(self._deque)

    async def size_async(self) -> int:
        if self._use_redis:
            r = await _get_redis()
            return await _stream_size(r) if r else 0
        return len(self._deque)

    # ── Background loop ───────────────────────────────────────────────────────

    async def _loop_redis(self, on_success: Any, on_exhaust: Any) -> None:
        """Redis Streams drain loop — polls every POLL_INTERVAL seconds."""
        while True:
            try:
                await asyncio.sleep(POLL_INTERVAL)
                r = await _get_redis()
                if r:
                    sz = await _stream_size(r)
                    if sz > 0:
                        log.debug("RetryQueue(stream): polling %d message(s)", sz)
                        await _stream_drain_once(r, self._runners, on_success, on_exhaust)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                log.error("RetryQueue(stream) loop error: %s", exc)

    async def _loop_memory(self, on_success: Any, on_exhaust: Any) -> None:
        """In-memory deque drain loop."""
        while True:
            try:
                await asyncio.sleep(POLL_INTERVAL)
                if self._deque:
                    await self._drain_once_memory(on_success=on_success, on_exhaust=on_exhaust)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                log.error("RetryQueue(mem) loop error: %s", exc)

    async def _drain_once_memory(self, on_success: Any, on_exhaust: Any) -> None:
        now = time.monotonic()
        ready: list[PendingRetry] = []
        async with self._lock:
            remaining: deque[PendingRetry] = deque()
            while self._deque:
                e = self._deque.popleft()
                if e.retry_at <= now:
                    ready.append(e)
                else:
                    remaining.append(e)
            self._deque = remaining

        for entry in ready:
            runner = self._runners.get(entry.job_type)
            if runner is None:
                log.warning("RetryQueue(mem): no runner for job_type=%s — dropping %s", entry.job_type, entry.job_id)
                continue
            log.info("RetryQueue(mem): retrying job %s (attempt %d/%d)…", entry.job_id, entry.attempt + 1, MAX_ATTEMPTS)
            try:
                result = await runner(entry.job_id, entry.params)
                log.info("RetryQueue(mem): retry succeeded for job %s → %s", entry.job_id, str(result)[:60])
                if on_success:
                    await on_success(entry.job_id, result)
            except Exception as exc:
                log.warning("RetryQueue(mem): retry #%d for %s failed: %s", entry.attempt + 1, entry.job_id, exc)
                next_attempt = entry.attempt + 1
                if on_exhaust and next_attempt >= MAX_ATTEMPTS:
                    await on_exhaust(entry.job_id, str(exc))
                else:
                    self.enqueue(entry.job_id, entry.job_type, entry.params, attempt=next_attempt, last_error=str(exc))

    def start(self, on_success: Any = None, on_exhaust: Any = None) -> asyncio.Task:
        """Spawn the background drain loop. Call once at startup."""
        loop_fn = self._loop_redis if self._use_redis else self._loop_memory
        self._task = asyncio.create_task(
            loop_fn(on_success=on_success, on_exhaust=on_exhaust),
            name="retry-queue-loop",
        )
        backend = "Redis Streams" if self._use_redis else "in-memory deque"
        log.info("RetryQueue started (backend=%s, poll=%ds, max_attempts=%d)", backend, POLL_INTERVAL, MAX_ATTEMPTS)
        return self._task

    def stop(self) -> None:
        """Cancel the background loop. Call at shutdown."""
        if self._task and not self._task.done():
            self._task.cancel()


# ─── Singleton ────────────────────────────────────────────────────────────────
retry_queue = RetryQueue()
