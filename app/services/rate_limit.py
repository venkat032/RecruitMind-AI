"""
In-memory sliding-window rate limiter for the auth endpoints.

It protects a single API process. When running several workers or
servers, move this to a shared store (e.g. Redis) so limits are global.
"""

import time
from collections import defaultdict, deque
from threading import Lock


class SlidingWindowLimiter:

    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def hit(self, key: str) -> int:
        """
        Record one attempt for `key`.
        Returns 0 if allowed, otherwise the seconds to wait before retrying.
        """

        now = time.monotonic()

        with self._lock:
            hits = self._hits[key]

            while hits and hits[0] <= now - self.window:
                hits.popleft()

            if len(hits) >= self.limit:
                return int(hits[0] + self.window - now) + 1

            hits.append(now)
            return 0

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


# 10 login attempts per IP per 5 minutes; 5 registrations per IP per hour
login_limiter = SlidingWindowLimiter(limit=10, window_seconds=5 * 60)
register_limiter = SlidingWindowLimiter(limit=5, window_seconds=60 * 60)
