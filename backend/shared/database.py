"""
Shared PostgreSQL database layer for all HealthPoint services.
Uses asyncpg connection pool — no in-memory fallback, no hardcoded credentials.
All services import from here instead of managing their own connections.
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Optional

import asyncpg

logger = logging.getLogger(__name__)

# ── Configuration (all from environment — NO hardcoded values) ──────────────
DATABASE_URL: str = os.environ["DATABASE_URL"]  # raises KeyError if missing — intentional
DB_MIN_POOL: int = int(os.getenv("DB_MIN_POOL", "5"))
DB_MAX_POOL: int = int(os.getenv("DB_MAX_POOL", "20"))
DB_COMMAND_TIMEOUT: float = float(os.getenv("DB_COMMAND_TIMEOUT", "30"))
DB_MAX_INACTIVE_CONN_LIFETIME: float = float(os.getenv("DB_MAX_INACTIVE_CONN_LIFETIME", "300"))

# ── Pool singleton ────────────────────────────────────────────────────────────
_pool: Optional[asyncpg.Pool] = None
_pool_lock = asyncio.Lock()


async def get_pool() -> asyncpg.Pool:
    """Return the shared connection pool, creating it on first call."""
    global _pool
    if _pool is not None:
        return _pool
    async with _pool_lock:
        if _pool is not None:
            return _pool
        logger.info("Creating asyncpg connection pool (min=%d, max=%d)", DB_MIN_POOL, DB_MAX_POOL)
        _pool = await asyncpg.create_pool(
            DATABASE_URL,
            min_size=DB_MIN_POOL,
            max_size=DB_MAX_POOL,
            command_timeout=DB_COMMAND_TIMEOUT,
            max_inactive_connection_lifetime=DB_MAX_INACTIVE_CONN_LIFETIME,
            server_settings={"application_name": "healthpoint"},
        )
        logger.info("Connection pool created successfully")
        return _pool


async def close_pool() -> None:
    """Gracefully close the connection pool on shutdown."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("Connection pool closed")


@asynccontextmanager
async def acquire() -> AsyncGenerator[asyncpg.Connection, None]:
    """Acquire a connection from the pool as a context manager."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn


@asynccontextmanager
async def transaction() -> AsyncGenerator[asyncpg.Connection, None]:
    """Acquire a connection and start a transaction."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            yield conn


async def execute(query: str, *args: Any) -> str:
    """Execute a query that returns no rows (INSERT/UPDATE/DELETE)."""
    async with acquire() as conn:
        return await conn.execute(query, *args)


async def fetchrow(query: str, *args: Any) -> Optional[asyncpg.Record]:
    """Fetch a single row."""
    async with acquire() as conn:
        return await conn.fetchrow(query, *args)


async def fetch(query: str, *args: Any) -> list[asyncpg.Record]:
    """Fetch multiple rows."""
    async with acquire() as conn:
        return await conn.fetch(query, *args)


async def fetchval(query: str, *args: Any) -> Any:
    """Fetch a single scalar value."""
    async with acquire() as conn:
        return await conn.fetchval(query, *args)


# ── Schema bootstrap ──────────────────────────────────────────────────────────
SCHEMA_SQL = """
-- Core tables required by all services

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id     VARCHAR(255) UNIQUE,          -- Keycloak sub claim
    email           VARCHAR(320) UNIQUE NOT NULL,
    name            VARCHAR(255),
    role            VARCHAR(64) NOT NULL DEFAULT 'user',
    organization_id UUID,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service         VARCHAR(128) NOT NULL,
    action          VARCHAR(128) NOT NULL,
    actor_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    resource_type   VARCHAR(128),
    resource_id     UUID,
    payload         JSONB,
    ip_address      INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor    ON audit_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_resource ON audit_events(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_created  ON audit_events(created_at DESC);

CREATE TABLE IF NOT EXISTS idr_cases (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_number         VARCHAR(64) UNIQUE NOT NULL,
    status              VARCHAR(64) NOT NULL DEFAULT 'initiated',
    initiating_party    VARCHAR(64) NOT NULL,   -- 'provider' | 'plan'
    provider_id         UUID,
    plan_id             UUID,
    disputed_amount     NUMERIC(15,2) NOT NULL,
    qpa_amount          NUMERIC(15,2),
    final_amount        NUMERIC(15,2),
    service_date        DATE NOT NULL,
    service_code        VARCHAR(32),
    service_description TEXT,
    idr_entity_id       UUID,
    deadline_at         TIMESTAMPTZ,
    resolved_at         TIMESTAMPTZ,
    metadata            JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_idr_cases_status   ON idr_cases(status);
CREATE INDEX IF NOT EXISTS idx_idr_cases_provider ON idr_cases(provider_id);
CREATE INDEX IF NOT EXISTS idx_idr_cases_plan     ON idr_cases(plan_id);

CREATE TABLE IF NOT EXISTS idr_documents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id     UUID NOT NULL REFERENCES idr_cases(id) ON DELETE CASCADE,
    uploader_id UUID REFERENCES users(id) ON DELETE SET NULL,
    filename    VARCHAR(512) NOT NULL,
    s3_key      VARCHAR(1024) NOT NULL,
    mime_type   VARCHAR(128),
    size_bytes  BIGINT,
    virus_clean BOOLEAN,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_idr_documents_case ON idr_documents(case_id);

CREATE TABLE IF NOT EXISTS payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id         UUID REFERENCES idr_cases(id) ON DELETE SET NULL,
    payer_id        UUID,
    payee_id        UUID,
    amount          NUMERIC(15,2) NOT NULL,
    currency        CHAR(3) NOT NULL DEFAULT 'USD',
    status          VARCHAR(64) NOT NULL DEFAULT 'pending',
    provider        VARCHAR(64),           -- 'stripe' | 'mojaloop' | 'tigerbeetle'
    external_ref    VARCHAR(255),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_payments_case   ON payments(case_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

CREATE TABLE IF NOT EXISTS fraud_detections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id         UUID REFERENCES idr_cases(id) ON DELETE SET NULL,
    payment_id      UUID REFERENCES payments(id) ON DELETE SET NULL,
    score           NUMERIC(5,4) NOT NULL,
    is_fraud        BOOLEAN NOT NULL,
    layer_scores    JSONB DEFAULT '{}',
    model_version   VARCHAR(64),
    reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    review_outcome  VARCHAR(64),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fraud_detections_case ON fraud_detections(case_id);

CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    type        VARCHAR(128) NOT NULL,
    title       VARCHAR(512) NOT NULL,
    body        TEXT,
    channel     VARCHAR(64) NOT NULL DEFAULT 'in_app',  -- 'email'|'sms'|'in_app'|'push'
    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
    metadata    JSONB DEFAULT '{}',
    sent_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read) WHERE NOT is_read;

CREATE TABLE IF NOT EXISTS workflow_instances (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_type   VARCHAR(128) NOT NULL,
    entity_id       UUID,
    entity_type     VARCHAR(128),
    status          VARCHAR(64) NOT NULL DEFAULT 'running',
    temporal_run_id VARCHAR(255),
    input_payload   JSONB DEFAULT '{}',
    result_payload  JSONB,
    error_message   TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_workflow_entity ON workflow_instances(entity_id, entity_type);

CREATE TABLE IF NOT EXISTS rate_limit_log (
    id          BIGSERIAL PRIMARY KEY,
    identifier  VARCHAR(255) NOT NULL,
    endpoint    VARCHAR(512) NOT NULL,
    hit_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_identifier ON rate_limit_log(identifier, hit_at DESC);

-- Trigger to auto-update updated_at columns
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_idr_cases_updated_at
    BEFORE UPDATE ON idr_cases FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
"""


async def bootstrap_schema() -> None:
    """Create all tables if they don't exist. Safe to call on every startup."""
    async with acquire() as conn:
        await conn.execute(SCHEMA_SQL)
        logger.info("Database schema bootstrapped successfully")
