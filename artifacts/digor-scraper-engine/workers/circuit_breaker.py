"""Circuit breaker for external service calls.

Prevents hammering failed services and cascading failures.

States
──────
  CLOSED    Normal operation — calls pass through, failures tracked.
  OPEN      Service appears down — calls fail fast (no network hit).
            Re-tries a single probe call after RECOVERY_TIMEOUT seconds.
  HALF_OPEN One probe call allowed — success closes circuit, failure re-opens.

Usage
─────
    from .circuit_breaker import CircuitBreaker, CircuitOpenError, breaker

    # Use the per-service singleton:
    async def fetch_propelio_data():
        async with breaker("propelio"):
            return await _do_actual_scrape()

    # Or create a custom breaker:
    my_breaker = CircuitBreaker(name="attom", failure_threshold=3, recovery_timeout=60)

    # Check state in health endpoint:
    from .circuit_breaker import all_breaker_states
    states = all_breaker_states()
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncIterator, Dict, Optional

log = logging.getLogger("circuit_breaker")

# ── Config ────────────────────────────────────────────────────────────────────
_DEFAULT_FAILURE_THRESHOLD = int(os.getenv("CIRCUIT_FAILURE_THRESHOLD", "5"))
_DEFAULT_RECOVERY_TIMEOUT = int(os.getenv("CIRCUIT_RECOVERY_TIMEOUT", "120"))  # 2 min
_DEFAULT_HALF_OPEN_MAX = int(os.getenv("CIRCUIT_HALF_OPEN_PROBES", "1"))
_DEFAULT_SUCCESS_THRESHOLD = int(os.getenv("CIRCUIT_SUCCESS_THRESHOLD", "2"))


class State(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitOpenError(RuntimeError):
    """Raised when a call is rejected because the circuit is OPEN."""

    def __init__(self, name: str, reopen_in: float) -> None:
        self.name = name
        self.reopen_in = reopen_in
        super().__init__(
            f"Circuit '{name}' is OPEN — service appears down. "
            f"Will probe again in {int(reopen_in)}s."
        )


# ── Core class ────────────────────────────────────────────────────────────────

@dataclass
class CircuitBreaker:
    name: str
    failure_threshold: int = _DEFAULT_FAILURE_THRESHOLD
    recovery_timeout: float = _DEFAULT_RECOVERY_TIMEOUT
    success_threshold: int = _DEFAULT_SUCCESS_THRESHOLD   # successes needed in HALF_OPEN to close
    half_open_max_probes: int = _DEFAULT_HALF_OPEN_MAX

    # Internal counters — not in __init__
    _state: State = field(default=State.CLOSED, init=False, repr=False)
    _failure_count: int = field(default=0, init=False, repr=False)
    _success_count: int = field(default=0, init=False, repr=False)
    _opened_at: float = field(default=0.0, init=False, repr=False)
    _probe_in_flight: int = field(default=0, init=False, repr=False)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, init=False, repr=False)
    _total_calls: int = field(default=0, init=False, repr=False)
    _total_failures: int = field(default=0, init=False, repr=False)
    _total_rejected: int = field(default=0, init=False, repr=False)
    _last_failure_msg: str = field(default="", init=False, repr=False)

    @property
    def state(self) -> State:
        # Transition OPEN → HALF_OPEN when recovery timeout has elapsed
        if self._state == State.OPEN:
            if time.monotonic() - self._opened_at >= self.recovery_timeout:
                return State.HALF_OPEN
        return self._state

    @property
    def reopen_in_seconds(self) -> float:
        if self._state != State.OPEN:
            return 0.0
        return max(0.0, self.recovery_timeout - (time.monotonic() - self._opened_at))

    def _open(self, reason: str) -> None:
        self._state = State.OPEN
        self._opened_at = time.monotonic()
        self._failure_count = 0
        self._success_count = 0
        self._probe_in_flight = 0
        self._last_failure_msg = reason[:200]
        log.warning(
            "[circuit_breaker] '%s' OPENED — %s — will probe in %ds",
            self.name, reason[:120], int(self.recovery_timeout),
        )

    def _close(self) -> None:
        self._state = State.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._probe_in_flight = 0
        log.info("[circuit_breaker] '%s' CLOSED — service recovered", self.name)

    def _record_success(self) -> None:
        async def _inner():
            async with self._lock:
                self._total_calls += 1
                if self._state == State.HALF_OPEN:
                    self._success_count += 1
                    self._probe_in_flight = max(0, self._probe_in_flight - 1)
                    if self._success_count >= self.success_threshold:
                        self._close()
                elif self._state == State.CLOSED:
                    # Reset failure window on a clean success run
                    if self._failure_count > 0:
                        self._failure_count = max(0, self._failure_count - 1)
        return _inner()

    def _record_failure(self, exc: Exception) -> None:
        async def _inner():
            async with self._lock:
                self._total_calls += 1
                self._total_failures += 1
                msg = str(exc)
                if self._state == State.HALF_OPEN:
                    self._probe_in_flight = max(0, self._probe_in_flight - 1)
                    self._open(f"probe failed: {msg}")
                elif self._state == State.CLOSED:
                    self._failure_count += 1
                    if self._failure_count >= self.failure_threshold:
                        self._open(
                            f"failure threshold {self.failure_threshold} reached: {msg}"
                        )
        return _inner()

    @asynccontextmanager
    async def __call__(self) -> AsyncIterator[None]:
        """Use as: `async with breaker('propelio'):`"""
        current_state = self.state

        async with self._lock:
            if current_state == State.OPEN:
                self._total_rejected += 1
                raise CircuitOpenError(self.name, self.reopen_in_seconds)
            if current_state == State.HALF_OPEN:
                if self._probe_in_flight >= self.half_open_max_probes:
                    self._total_rejected += 1
                    raise CircuitOpenError(self.name, self.reopen_in_seconds)
                self._probe_in_flight += 1
                log.info("[circuit_breaker] '%s' HALF_OPEN — probe call allowed", self.name)

        try:
            yield
            await self._record_success()
        except CircuitOpenError:
            raise
        except Exception as exc:
            await self._record_failure(exc)
            raise

    def status(self) -> Dict[str, Any]:
        s = self.state
        return {
            "name": self.name,
            "state": s.value,
            "failure_count": self._failure_count,
            "failure_threshold": self.failure_threshold,
            "total_calls": self._total_calls,
            "total_failures": self._total_failures,
            "total_rejected": self._total_rejected,
            "reopen_in_seconds": int(self.reopen_in_seconds) if s == State.OPEN else None,
            "last_failure": self._last_failure_msg or None,
        }

    def reset(self) -> None:
        """Manually reset the breaker to CLOSED (admin action)."""
        self._state = State.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._probe_in_flight = 0
        log.info("[circuit_breaker] '%s' manually reset to CLOSED", self.name)


# ── Per-service registry ──────────────────────────────────────────────────────
_breakers: Dict[str, CircuitBreaker] = {}


def get_breaker(
    name: str,
    *,
    failure_threshold: Optional[int] = None,
    recovery_timeout: Optional[float] = None,
) -> CircuitBreaker:
    """Return (or create) a named CircuitBreaker. Thread-safe via module-level dict."""
    if name not in _breakers:
        _breakers[name] = CircuitBreaker(
            name=name,
            failure_threshold=failure_threshold or _DEFAULT_FAILURE_THRESHOLD,
            recovery_timeout=recovery_timeout or _DEFAULT_RECOVERY_TIMEOUT,
        )
    return _breakers[name]


@asynccontextmanager
async def breaker(
    service: str,
    *,
    failure_threshold: Optional[int] = None,
    recovery_timeout: Optional[float] = None,
) -> AsyncIterator[None]:
    """Convenience context manager:

        async with breaker("propelio"):
            result = await scrape_propelio(address)
    """
    cb = get_breaker(
        service,
        failure_threshold=failure_threshold,
        recovery_timeout=recovery_timeout,
    )
    async with cb():
        yield


def all_breaker_states() -> Dict[str, Dict[str, Any]]:
    """Return health-check payload for all registered breakers."""
    return {name: cb.status() for name, cb in _breakers.items()}


def reset_breaker(name: str) -> bool:
    """Reset a breaker by name. Returns False if breaker not found."""
    if name in _breakers:
        _breakers[name].reset()
        return True
    return False


# ── Pre-register known services ───────────────────────────────────────────────
# These are created eagerly so health checks always show them (even before first call).
for _svc, _thresh, _timeout in [
    ("propelio",     5, 180),  # 3-min recovery — requires browser session
    ("propwire",     5, 180),
    ("attom",        8,  60),  # faster recovery — reliable API
    ("brightdata",   6,  90),
    ("groq",        10,  30),
    ("openrouter",  10,  30),
    ("scraperapi",   8,  60),
]:
    get_breaker(_svc, failure_threshold=_thresh, recovery_timeout=float(_timeout))
