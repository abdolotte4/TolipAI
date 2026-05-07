"""Retry-queue for transient job failures.

How it works
────────────
• When a background job fails, the error is classified as transient or fatal.
• Transient failures are placed on the RetryQueue with exponential backoff:
      attempt 1 → wait  60 s
      attempt 2 → wait 300 s  (5 min)
      attempt 3 → wait 900 s  (15 min)
      attempt 4 → permanently failed
• A background asyncio task wakes every POLL_INTERVAL seconds, picks any
  entry whose retry_at ≤ now, and re-executes the job via the registered
  runner functions.
• In-memory queue is rebuilt as empty on process restart; DB rows with
  status="retry_pending" are surfaced via GET /jobs/retries so the caller
  can re-submit if needed after a cold restart.

Usage in main.py
────────────────
    from .retry_queue import retry_queue, is_transient

    # in the job runner except-block:
    if is_transient(e) and retry_queue.enqueue(job_id, "cash_buyers", params):
        await db.update_job(job_id, status="retry_pending", error=str(e))
    else:
        await db.update_job(job_id, status="failed", error=str(e), completed=True)
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine, Dict, Optional

log = logging.getLogger("retry_queue")

POLL_INTERVAL = 30  # seconds between queue scans
MAX_ATTEMPTS = 3  # retries before permanently failing
BACKOFF = [60, 300, 900]  # seconds per attempt index (0-based)


# ─── Error classification ────────────────────────────────────────────────────

_TRANSIENT_KEYWORDS = (
    "429",
    "rate limit",
    "too many requests",
    "timeout",
    "timed out",
    "read timeout",
    "connect timeout",
    "connection reset",
    "connection refused",
    "dns",
    "name or service not known",
    "502",
    "503",
    "504",
    "service unavailable",
    "bad gateway",
    "temporary",
    "retry",
    "ssl",
    "certificate",
)

_FATAL_KEYWORDS = (
    "401",
    "403",
    "unauthorized",
    "forbidden",
    "suspended",
    "account",
    "deprecated",
    "not found",
    "no such model",
    "does not exist",
    "invalid api key",
    "quota exceeded",  # hard quota (not rate limit)
    "dataerror",  # asyncpg type mismatch
    "invalid input",
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


# ─── Queue ───────────────────────────────────────────────────────────────────


class RetryQueue:
    """Thread-safe async retry queue backed by a deque."""

    def __init__(self) -> None:
        self._queue: deque[PendingRetry] = deque()
        self._lock = asyncio.Lock()
        self._task: Optional[asyncio.Task] = None
        # registered runners: job_type → async callable(params) → result
        self._runners: Dict[str, Callable[..., Coroutine]] = {}

    def register(self, job_type: str, runner: Callable[..., Coroutine]) -> None:
        """Register an async runner function for a job_type."""
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
        """Push a retry. Returns False if max attempts exceeded."""
        if attempt >= MAX_ATTEMPTS:
            log.warning(
                "Job %s (%s) exhausted %d retries — permanently failed: %s",
                job_id,
                job_type,
                MAX_ATTEMPTS,
                last_error,
            )
            return False
        delay = BACKOFF[min(attempt, len(BACKOFF) - 1)]
        retry_at = time.monotonic() + delay
        entry = PendingRetry(
            job_id=job_id,
            job_type=job_type,
            params=params,
            attempt=attempt,
            retry_at=retry_at,
            last_error=last_error,
        )
        self._queue.append(entry)
        log.info(
            "Job %s enqueued for retry #%d in %ds (reason: %s)",
            job_id,
            attempt + 1,
            delay,
            last_error[:80],
        )
        return True

    def pending(self) -> list[Dict[str, Any]]:
        """Snapshot of all pending retries (for the /jobs/retries endpoint)."""
        now = time.monotonic()
        return [
            {
                "job_id": e.job_id,
                "job_type": e.job_type,
                "attempt": e.attempt + 1,
                "max_attempts": MAX_ATTEMPTS,
                "retry_in_seconds": max(0, int(e.retry_at - now)),
                "last_error": e.last_error[:120],
            }
            for e in self._queue
        ]

    def size(self) -> int:
        return len(self._queue)

    async def _drain_once(self, on_success=None, on_exhaust=None) -> None:
        """Process all entries whose retry_at has passed."""
        now = time.monotonic()
        ready: list[PendingRetry] = []
        async with self._lock:
            remaining: deque[PendingRetry] = deque()
            while self._queue:
                e = self._queue.popleft()
                if e.retry_at <= now:
                    ready.append(e)
                else:
                    remaining.append(e)
            self._queue = remaining

        for entry in ready:
            runner = self._runners.get(entry.job_type)
            if runner is None:
                log.warning(
                    "No runner for job_type=%s — dropping %s",
                    entry.job_type,
                    entry.job_id,
                )
                continue
            log.info(
                "Retrying job %s (attempt %d/%d) …",
                entry.job_id,
                entry.attempt + 1,
                MAX_ATTEMPTS,
            )
            try:
                result = await runner(entry.job_id, entry.params)
                log.info("Retry succeeded for job %s → %s", entry.job_id, str(result)[:60])
                if on_success:
                    await on_success(entry.job_id, result)
            except Exception as exc:
                log.warning(
                    "Retry #%d for job %s failed: %s",
                    entry.attempt + 1,
                    entry.job_id,
                    exc,
                )
                next_attempt = entry.attempt + 1
                if on_exhaust and next_attempt >= MAX_ATTEMPTS:
                    await on_exhaust(entry.job_id, str(exc))
                else:
                    self.enqueue(
                        entry.job_id,
                        entry.job_type,
                        entry.params,
                        attempt=next_attempt,
                        last_error=str(exc),
                    )

    async def _loop(self, on_success=None, on_exhaust=None) -> None:
        """Background loop — runs forever until task is cancelled."""
        while True:
            try:
                await asyncio.sleep(POLL_INTERVAL)
                if self._queue:
                    await self._drain_once(on_success=on_success, on_exhaust=on_exhaust)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                log.error("RetryQueue loop error: %s", exc)

    def start(self, on_success=None, on_exhaust=None) -> asyncio.Task:
        """Spawn the background drain loop. Call once at startup."""
        self._task = asyncio.create_task(
            self._loop(on_success=on_success, on_exhaust=on_exhaust),
            name="retry-queue-loop",
        )
        log.info(
            "RetryQueue started (poll=%ds, max_attempts=%d)",
            POLL_INTERVAL,
            MAX_ATTEMPTS,
        )
        return self._task

    def stop(self) -> None:
        """Cancel the background loop. Call at shutdown."""
        if self._task and not self._task.done():
            self._task.cancel()


# ─── Singleton ───────────────────────────────────────────────────────────────

retry_queue = RetryQueue()
