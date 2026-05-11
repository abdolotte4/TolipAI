"""AWS Fargate Spot interruption handler.

AWS gives a 2-minute SIGTERM warning before terminating a Spot task.
This module turns that 120-second window into a safe, ordered shutdown:

  t=0s    SIGTERM received → set _interrupted flag immediately
  t=0-5s  Stop accepting new jobs (reject HTTP 503)
  t=5-60s Flush in-progress jobs to Redis (status=interrupted_spot)
  t=60s   Close browser contexts gracefully
  t=90s   Call sys.exit(0) — well before AWS hard-kills at t=120s

Usage in main.py
────────────────
    from .spot_handler import SpotHandler, is_interrupted

    spot = SpotHandler()
    spot.install()          # register SIGTERM/SIGINT hooks

    # In your job endpoint:
    if is_interrupted():
        raise HTTPException(503, "Spot interruption in progress — retry on another node")

    # In your lifespan shutdown:
    await spot.drain(timeout=85)
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
import time
from typing import Any, Callable, Dict, List, Optional, Set

log = logging.getLogger("spot_handler")

# ── Global state ──────────────────────────────────────────────────────────────
_interrupted: bool = False
_interrupt_time: float = 0.0
_active_job_ids: Set[str] = set()
_shutdown_callbacks: List[Callable[[], Any]] = []

SPOT_EXIT_DEADLINE = int(os.getenv("SPOT_EXIT_DEADLINE_SECONDS", "90"))
SPOT_DRAIN_POLL = 2  # seconds between drain polls


def is_interrupted() -> bool:
    """Return True if a Spot interruption signal has been received."""
    return _interrupted


def register_job(job_id: str) -> None:
    """Mark a job as in-flight (call at job start)."""
    _active_job_ids.add(job_id)


def unregister_job(job_id: str) -> None:
    """Mark a job as complete (call at job end, even on error)."""
    _active_job_ids.discard(job_id)


def active_job_count() -> int:
    return len(_active_job_ids)


def on_shutdown(callback: Callable[[], Any]) -> None:
    """Register a callback to run during graceful shutdown."""
    _shutdown_callbacks.append(callback)


# ── Core handler ──────────────────────────────────────────────────────────────

class SpotHandler:
    """Installs signal handlers and coordinates graceful Fargate Spot shutdown."""

    def __init__(self) -> None:
        self._exit_task: Optional[asyncio.Task] = None

    def install(self) -> None:
        """Register SIGTERM and SIGINT handlers. Call once at startup."""
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)
        log.info(
            "SpotHandler installed (SIGTERM → %ds drain, then exit)", SPOT_EXIT_DEADLINE
        )

    def _handle_signal(self, sig: int, _frame: Any) -> None:
        global _interrupted, _interrupt_time
        if _interrupted:
            # Second signal — immediate exit (user pressed Ctrl+C twice)
            log.warning("Second signal %d — immediate exit", sig)
            sys.exit(1)
        _interrupted = True
        _interrupt_time = time.monotonic()
        log.warning(
            "Signal %d received — Fargate Spot interruption detected. "
            "New jobs rejected. Draining %d active job(s). "
            "Will exit in %ds.",
            sig,
            len(_active_job_ids),
            SPOT_EXIT_DEADLINE,
        )
        # Schedule async drain in the running event loop (non-blocking)
        try:
            loop = asyncio.get_running_loop()
            self._exit_task = loop.create_task(
                self._drain_and_exit(), name="spot-drain"
            )
        except RuntimeError:
            # No event loop — sync shutdown
            log.warning("No event loop — performing synchronous shutdown")
            sys.exit(0)

    async def _drain_and_exit(self) -> None:
        """
        Wait for in-flight jobs to finish (up to 60s), then run callbacks,
        then exit. Hard-exits at SPOT_EXIT_DEADLINE regardless.
        """
        deadline = _interrupt_time + SPOT_EXIT_DEADLINE
        drain_deadline = _interrupt_time + 60  # max 60s waiting for jobs

        # Phase 1: wait for active jobs to finish
        log.info(
            "Spot drain phase 1: waiting for %d active job(s) (max 60s)...",
            len(_active_job_ids),
        )
        while _active_job_ids and time.monotonic() < drain_deadline:
            await asyncio.sleep(SPOT_DRAIN_POLL)
            remaining = len(_active_job_ids)
            if remaining:
                elapsed = int(time.monotonic() - _interrupt_time)
                log.info(
                    "Spot drain: %d job(s) still active (%ds elapsed)...",
                    remaining, elapsed,
                )

        if _active_job_ids:
            log.warning(
                "Spot drain: %d job(s) did not finish in time — "
                "they will be re-queued on next container start: %s",
                len(_active_job_ids),
                list(_active_job_ids)[:10],
            )
        else:
            log.info("Spot drain: all jobs finished cleanly")

        # Phase 2: run shutdown callbacks (flush job state, close browsers, etc.)
        log.info("Spot drain phase 2: running %d shutdown callbacks...", len(_shutdown_callbacks))
        for cb in _shutdown_callbacks:
            try:
                result = cb()
                if asyncio.iscoroutine(result):
                    remaining_time = max(5.0, deadline - time.monotonic())
                    await asyncio.wait_for(result, timeout=remaining_time)
            except asyncio.TimeoutError:
                log.warning("Shutdown callback timed out")
            except Exception as exc:
                log.error("Shutdown callback error: %s", exc)

        # Phase 3: final exit
        elapsed = int(time.monotonic() - _interrupt_time)
        log.info("Spot drain complete in %ds — exiting cleanly", elapsed)
        sys.exit(0)

    async def drain(self, *, timeout: int = 85) -> None:
        """
        Explicit drain call for use in FastAPI lifespan shutdown.
        Use this if you prefer lifespan-controlled shutdown over signal-only.
        """
        if not _interrupted:
            return
        if self._exit_task and not self._exit_task.done():
            try:
                await asyncio.wait_for(self._exit_task, timeout=float(timeout))
            except asyncio.TimeoutError:
                log.warning("SpotHandler.drain() timed out after %ds", timeout)


# ── Health endpoint helper ────────────────────────────────────────────────────

def health_payload() -> Dict[str, Any]:
    """Return spot-handler fields for the /health endpoint."""
    return {
        "spot_interrupted": _interrupted,
        "spot_interrupt_age_seconds": (
            int(time.monotonic() - _interrupt_time) if _interrupted else None
        ),
        "active_jobs": len(_active_job_ids),
        "active_job_ids": list(_active_job_ids)[:20],
    }


# ── Module-level singleton ────────────────────────────────────────────────────
spot_handler = SpotHandler()
