import math
import time
from collections import deque
from threading import Lock

from fastapi import HTTPException, Request, status

_lock = Lock()
_buckets: dict[tuple[str, str], deque[float]] = {}
_last_cleanup = 0.0
_MAX_BUCKETS = 4096
_MAX_RETENTION_S = 3600.0


def client_ip(request: Request) -> str:
    """Best-effort client IP behind the bundled nginx reverse proxy."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    if request.client is not None:
        return request.client.host
    return "unknown"


def consume_rate_limit(
    scope: str,
    key: str,
    *,
    limit: int,
    window_s: float,
) -> int | None:
    """Consume one slot, returning Retry-After seconds when the bucket is full.

    ClubJudge currently runs a single API process, so an in-process limiter is
    sufficient and avoids adding Redis to the application backend. If the API is
    later scaled to multiple processes/replicas this helper must move to a shared
    store before increasing the replica count.
    """
    now = time.monotonic()
    bucket_key = (scope, key)
    global _last_cleanup
    with _lock:
        if len(_buckets) >= _MAX_BUCKETS or now - _last_cleanup >= 60.0:
            stale_before = now - _MAX_RETENTION_S
            stale = [
                k
                for k, values in _buckets.items()
                if not values or values[-1] <= stale_before
            ]
            for stale_key in stale:
                _buckets.pop(stale_key, None)
            _last_cleanup = now
        bucket = _buckets.setdefault(bucket_key, deque())
        cutoff = now - window_s
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            retry_after = max(1, math.ceil(window_s - (now - bucket[0])))
            return retry_after
        bucket.append(now)
    return None


def enforce_rate_limit(
    request: Request,
    scope: str,
    *,
    limit: int,
    window_s: float,
) -> None:
    retry_after = consume_rate_limit(
        scope,
        client_ip(request),
        limit=limit,
        window_s=window_s,
    )
    if retry_after is None:
        return
    raise HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        {"code": "rate_limited", "retry_after_s": retry_after},
        headers={"Retry-After": str(retry_after)},
    )
