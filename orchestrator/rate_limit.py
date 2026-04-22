"""In-memory sliding-window rate limiter for auth endpoints.

Scope is a single orchestrator process; this is sufficient because the
orchestrator is a single-process FastAPI app. If we ever run multiple
replicas, move this to Redis (or similar).
"""
from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Deque

from fastapi import HTTPException, Request


class SlidingWindowLimiter:
    """Allow at most ``limit`` hits per ``window_seconds`` per key."""

    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, Deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] > self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            raise HTTPException(
                status_code=429,
                detail=f"Too many requests; try again in {self.window} seconds",
            )
        hits.append(now)

    def reset(self) -> None:
        self._hits.clear()


login_limiter = SlidingWindowLimiter(limit=5, window_seconds=60)
register_limiter = SlidingWindowLimiter(limit=3, window_seconds=60)


def _client_key(request: Request) -> str:
    client = request.client
    if client is None:
        return "anon"
    return client.host


def rate_limit_login(request: Request) -> None:
    login_limiter.check(_client_key(request))


def rate_limit_register(request: Request) -> None:
    register_limiter.check(_client_key(request))


def reset_all_limiters() -> None:
    login_limiter.reset()
    register_limiter.reset()
