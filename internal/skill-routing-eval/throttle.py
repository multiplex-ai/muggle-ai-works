"""Throttle detection + shared backoff for the routing-eval worker threads.

Every eval run is an isolated `claude -p` subprocess sharing one subscription
token, so the scarce resource is the token's rate budget. The gate is shared
across the thread pool: one rate-limited run pauses new starts for all workers
instead of letting the pool pile onto an already-throttled token.
"""

import random
import re
import threading
import time

THROTTLE_SIGNATURE = re.compile(
    r"\b429\b|\b529\b|rate.?limit|overloaded|too many requests|usage.?limit|quota exceeded",
    re.IGNORECASE,
)

MAX_THROTTLE_RETRIES = 3
BACKOFF_BASE_SECONDS = 15.0
BACKOFF_CAP_SECONDS = 120.0
JITTER_MAX_SECONDS = 5.0


def is_throttle_text(text: str) -> bool:
    return bool(text) and bool(THROTTLE_SIGNATURE.search(text))


def backoff_seconds(attempt: int, rand: random.Random | None = None) -> float:
    jitter = (rand or random).uniform(0, JITTER_MAX_SECONDS)
    return min(BACKOFF_BASE_SECONDS * 2 ** (attempt - 1) + jitter, BACKOFF_CAP_SECONDS)


class ThrottleGate:
    def __init__(self, clock=time.monotonic, sleeper=time.sleep):
        self._lock = threading.Lock()
        self._cooldown_until = 0.0
        self._clock = clock
        self._sleeper = sleeper

    def report_throttle(self, backoff: float) -> None:
        with self._lock:
            self._cooldown_until = max(self._cooldown_until, self._clock() + backoff)

    def wait_until_clear(self) -> None:
        # Re-check after every sleep: another worker may have extended the
        # cooldown while this one was waiting.
        while True:
            with self._lock:
                remaining = self._cooldown_until - self._clock()
            if remaining <= 0:
                return
            self._sleeper(remaining)
