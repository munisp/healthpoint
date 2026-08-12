"""
Shared Redis async client for all HealthPoint services.
Uses redis.asyncio (NOT deprecated aioredis).
All services import from here.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional

import redis.asyncio as aioredis
from redis.asyncio import Redis
from redis.asyncio.connection import ConnectionPool

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────
REDIS_URL: str = os.getenv("REDIS_URL", "redis://redis:6379/0")
REDIS_MAX_CONNECTIONS: int = int(os.getenv("REDIS_MAX_CONNECTIONS", "50"))
REDIS_SOCKET_TIMEOUT: float = float(os.getenv("REDIS_SOCKET_TIMEOUT", "5"))
REDIS_RETRY_ON_TIMEOUT: bool = os.getenv("REDIS_RETRY_ON_TIMEOUT", "true").lower() == "true"

# ── Pool singleton ────────────────────────────────────────────────────────────
_pool: Optional[ConnectionPool] = None
_client: Optional[Redis] = None


def get_client() -> Redis:
    """Return the shared Redis client, creating it on first call."""
    global _pool, _client
    if _client is not None:
        return _client
    _pool = ConnectionPool.from_url(
        REDIS_URL,
        max_connections=REDIS_MAX_CONNECTIONS,
        socket_timeout=REDIS_SOCKET_TIMEOUT,
        retry_on_timeout=REDIS_RETRY_ON_TIMEOUT,
        decode_responses=True,
    )
    _client = Redis(connection_pool=_pool)
    logger.info("Redis client created: %s", REDIS_URL)
    return _client


async def close_client() -> None:
    """Close the Redis connection pool on shutdown."""
    global _client, _pool
    if _client is not None:
        await _client.aclose()
        _client = None
    if _pool is not None:
        await _pool.aclose()
        _pool = None
    logger.info("Redis client closed")


# ── Convenience helpers ───────────────────────────────────────────────────────
async def get_json(key: str) -> Optional[Any]:
    """Get a JSON-encoded value from Redis."""
    client = get_client()
    raw = await client.get(key)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


async def set_json(key: str, value: Any, ttl_seconds: Optional[int] = None) -> None:
    """Set a JSON-encoded value in Redis with optional TTL."""
    client = get_client()
    encoded = json.dumps(value, default=str)
    if ttl_seconds:
        await client.setex(key, ttl_seconds, encoded)
    else:
        await client.set(key, encoded)


async def delete(key: str) -> int:
    """Delete a key from Redis."""
    return await get_client().delete(key)


async def exists(key: str) -> bool:
    """Check if a key exists in Redis."""
    return bool(await get_client().exists(key))


async def increment(key: str, amount: int = 1) -> int:
    """Increment a counter."""
    return await get_client().incrby(key, amount)


async def expire(key: str, ttl_seconds: int) -> bool:
    """Set TTL on an existing key."""
    return await get_client().expire(key, ttl_seconds)


async def rate_limit_check(identifier: str, limit: int, window_seconds: int) -> tuple[bool, int]:
    """
    Sliding window rate limiter using Redis.
    Returns (allowed: bool, remaining: int).
    """
    client = get_client()
    key = f"rl:{identifier}"
    pipe = client.pipeline()
    pipe.incr(key)
    pipe.expire(key, window_seconds)
    results = await pipe.execute()
    count = results[0]
    remaining = max(0, limit - count)
    return count <= limit, remaining
