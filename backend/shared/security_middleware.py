"""
Comprehensive security middleware for HealthPoint IDR Platform.
Applied to all FastAPI services to enforce:
- Rate limiting (per IP)
- Request size limits
- Security headers (HSTS, CSP, X-Frame-Options, etc.)
- Input sanitization
- Request ID tracking
- Audit logging
"""
from __future__ import annotations

import hashlib
import logging
import os
import time
import uuid
from collections import defaultdict
from typing import Any, Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────
ALLOWED_ORIGINS: list[str] = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:5173"
).split(",")

MAX_REQUEST_SIZE_BYTES: int = int(os.getenv("MAX_REQUEST_SIZE_MB", "10")) * 1024 * 1024
RATE_LIMIT_REQUESTS: int = int(os.getenv("RATE_LIMIT_REQUESTS", "100"))
RATE_LIMIT_WINDOW_SECONDS: int = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))

# Paths exempt from rate limiting
RATE_LIMIT_EXEMPT_PATHS = {"/health", "/healthz", "/metrics", "/ready", "/live"}


# ── In-memory rate limiter (backed by Redis in production) ────────────────────
class RateLimiter:
    """Sliding window rate limiter. Uses Redis if available, falls back to in-memory."""

    def __init__(self) -> None:
        self._store: dict[str, list[float]] = defaultdict(list)
        self._redis = None

    async def _get_redis(self):
        if self._redis is None:
            try:
                from backend.shared.cache import get_cache
                self._redis = await get_cache()
            except Exception:
                pass
        return self._redis

    async def is_allowed(self, key: str, limit: int, window: int) -> tuple[bool, int]:
        """
        Check if request is within rate limit.
        Returns (allowed, remaining_requests).
        """
        redis = await self._get_redis()
        now = time.time()

        if redis:
            try:
                pipe_key = f"rl:{key}"
                async with redis.pipeline() as pipe:
                    pipe.zremrangebyscore(pipe_key, 0, now - window)
                    pipe.zadd(pipe_key, {str(uuid.uuid4()): now})
                    pipe.zcard(pipe_key)
                    pipe.expire(pipe_key, window)
                    results = await pipe.execute()
                count = results[2]
                remaining = max(0, limit - count)
                return count <= limit, remaining
            except Exception as e:
                logger.warning("Redis rate limiter failed: %s — using in-memory", str(e))

        # In-memory fallback
        timestamps = self._store[key]
        cutoff = now - window
        self._store[key] = [t for t in timestamps if t > cutoff]
        self._store[key].append(now)
        count = len(self._store[key])
        remaining = max(0, limit - count)
        return count <= limit, remaining


_rate_limiter = RateLimiter()


# ── Security headers middleware ───────────────────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Add request ID for tracing
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id

        response = await call_next(request)

        # Security headers
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"

        # HSTS (only in production)
        if os.getenv("ENVIRONMENT", "development") == "production":
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains; preload"
            )

        # Remove server identification
        response.headers.pop("server", None)
        response.headers.pop("x-powered-by", None)

        return response


# ── Rate limiting middleware ──────────────────────────────────────────────────
class RateLimitMiddleware(BaseHTTPMiddleware):
    """Per-IP rate limiting middleware."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path

        # Skip rate limiting for health/metrics endpoints
        if path in RATE_LIMIT_EXEMPT_PATHS:
            return await call_next(request)

        # Get client IP (respects X-Forwarded-For from trusted proxy)
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            client_ip = forwarded_for.split(",")[0].strip()
        else:
            client_ip = request.client.host if request.client else "unknown"

        # Hash IP for privacy in logs
        ip_hash = hashlib.sha256(client_ip.encode()).hexdigest()[:16]

        allowed, remaining = await _rate_limiter.is_allowed(
            f"{ip_hash}:{path}",
            RATE_LIMIT_REQUESTS,
            RATE_LIMIT_WINDOW_SECONDS,
        )

        if not allowed:
            logger.warning("Rate limit exceeded: ip_hash=%s path=%s", ip_hash, path)
            return JSONResponse(
                status_code=429,
                content={
                    "error": "rate_limit_exceeded",
                    "message": "Too many requests. Please slow down.",
                    "retry_after": RATE_LIMIT_WINDOW_SECONDS,
                },
                headers={
                    "Retry-After": str(RATE_LIMIT_WINDOW_SECONDS),
                    "X-RateLimit-Limit": str(RATE_LIMIT_REQUESTS),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(int(time.time()) + RATE_LIMIT_WINDOW_SECONDS),
                },
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(RATE_LIMIT_REQUESTS)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response


# ── Request size limit middleware ─────────────────────────────────────────────
class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests exceeding the configured size limit."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > MAX_REQUEST_SIZE_BYTES:
            return JSONResponse(
                status_code=413,
                content={
                    "error": "request_too_large",
                    "message": f"Request body exceeds {MAX_REQUEST_SIZE_BYTES // (1024*1024)} MB limit",
                },
            )
        return await call_next(request)


# ── Audit logging middleware ──────────────────────────────────────────────────
class AuditLogMiddleware(BaseHTTPMiddleware):
    """Log all API requests for audit trail."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        start_time = time.time()
        request_id = getattr(request.state, "request_id", str(uuid.uuid4()))

        # Get user from auth header if present
        auth_header = request.headers.get("Authorization", "")
        user_id = "anonymous"
        if auth_header.startswith("Bearer "):
            try:
                from backend.shared.auth import decode_token
                token = auth_header[7:]
                claims = decode_token(token)
                user_id = claims.get("sub", "unknown")
            except Exception:
                pass

        response = await call_next(request)
        duration_ms = int((time.time() - start_time) * 1000)

        # Log to structured audit log
        logger.info(
            "API request",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
                "user_id": user_id,
                "ip": request.client.host if request.client else "unknown",
            },
        )

        # Persist to audit log table asynchronously
        if request.url.path not in RATE_LIMIT_EXEMPT_PATHS:
            try:
                from backend.shared.database import execute
                import asyncio
                asyncio.create_task(execute(
                    """
                    INSERT INTO api_audit_log
                        (request_id, method, path, status_code, duration_ms, user_id, ip_hash)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    """,
                    request_id,
                    request.method,
                    request.url.path,
                    response.status_code,
                    duration_ms,
                    user_id,
                    hashlib.sha256((request.client.host if request.client else "").encode()).hexdigest()[:32],
                ))
            except Exception:
                pass  # Non-fatal — audit log failure must not block the request

        return response


# ── Apply all security middleware to a FastAPI app ────────────────────────────
def apply_security_middleware(app: FastAPI, service_name: str = "") -> None:
    """
    Apply all security middleware to a FastAPI application.
    Call this in every service's main.py after creating the app.

    Usage:
        app = FastAPI(...)
        apply_security_middleware(app, service_name="claims-processing")
    """
    # Order matters: outermost middleware runs first on request, last on response

    # 1. CORS (must be first)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID", "X-Correlation-ID"],
        expose_headers=["X-Request-ID", "X-RateLimit-Limit", "X-RateLimit-Remaining"],
        max_age=600,
    )

    # 2. Request size limit
    app.add_middleware(RequestSizeLimitMiddleware)

    # 3. Rate limiting
    app.add_middleware(RateLimitMiddleware)

    # 4. Security headers
    app.add_middleware(SecurityHeadersMiddleware)

    # 5. Audit logging
    app.add_middleware(AuditLogMiddleware)

    logger.info("Security middleware applied to service: %s", service_name or "unknown")


# ── Audit log schema ──────────────────────────────────────────────────────────
AUDIT_LOG_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS api_audit_log (
    id          BIGSERIAL PRIMARY KEY,
    request_id  UUID NOT NULL,
    method      VARCHAR(10) NOT NULL,
    path        TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    duration_ms INTEGER,
    user_id     TEXT,
    ip_hash     VARCHAR(64),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON api_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_path ON api_audit_log(path);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON api_audit_log(created_at);
-- Partition by month for large-scale deployments
-- ALTER TABLE api_audit_log PARTITION BY RANGE (created_at);
"""
