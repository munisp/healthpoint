"""
Security, Authentication, and HIPAA Compliance Service
=======================================================
Handles user authentication via Keycloak, RBAC via Permify,
and HIPAA audit logging via PostgreSQL.

All user data is persisted to PostgreSQL — no in-memory stores.
Authentication is delegated to Keycloak (real OAuth2/OIDC).
"""
from __future__ import annotations

import sys
import os as _os
_repo_root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from backend.shared.database import execute, fetch, fetchrow, fetchval, transaction
from backend.shared.cache import get_json, rate_limit_check, set_json
from backend.shared.auth import (
    TokenPayload,
    get_current_user,
    require_admin,
    require_provider,
    require_role,
    security_headers_middleware,
)
from backend.shared.messaging import Topics, publish
from backend.shared.security_middleware import apply_security_middleware

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────
SECRET_KEY: str = os.environ["JWT_SECRET_KEY"]  # Must be set — no default
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

KEYCLOAK_URL: str = os.getenv("KEYCLOAK_URL", "http://keycloak:8080")
KEYCLOAK_REALM: str = os.getenv("KEYCLOAK_REALM", "healthpoint")
KEYCLOAK_CLIENT_ID: str = os.getenv("KEYCLOAK_CLIENT_ID", "healthpoint-api")
KEYCLOAK_CLIENT_SECRET: str = os.environ.get("KEYCLOAK_CLIENT_SECRET", "")

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Security & Authentication Service",
    version="2.0.0",
    description="Keycloak-backed authentication with PostgreSQL audit logging",
)
apply_security_middleware(app, service_name="security-authentication")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


# ── Pydantic models ───────────────────────────────────────────────────────────
class UserCreate(BaseModel):
    username: str
    email: str
    full_name: str
    password: str
    roles: List[str] = ["user"]


class UserResponse(BaseModel):
    id: str
    username: str
    email: Optional[str]
    full_name: Optional[str]
    roles: List[str]
    is_active: bool
    created_at: datetime


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    refresh_token: Optional[str] = None


class TokenData(BaseModel):
    sub: Optional[str] = None
    roles: List[str] = []


class AuditLogEntry(BaseModel):
    user_id: str
    action: str
    resource_type: str
    resource_id: Optional[str] = None
    details: Dict[str, Any] = {}
    ip_address: Optional[str] = None


# ── Database schema ───────────────────────────────────────────────────────────
AUTH_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS auth_users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR(128) UNIQUE NOT NULL,
    email           VARCHAR(320) UNIQUE,
    full_name       TEXT,
    hashed_password TEXT,
    roles           TEXT[] NOT NULL DEFAULT ARRAY['user'],
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    keycloak_id     VARCHAR(255),
    last_login      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_users_username ON auth_users(username);
CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email);
CREATE INDEX IF NOT EXISTS idx_auth_users_keycloak ON auth_users(keycloak_id);

CREATE TABLE IF NOT EXISTS hipaa_audit_log (
    id              BIGSERIAL PRIMARY KEY,
    event_id        UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,
    action          VARCHAR(128) NOT NULL,
    resource_type   VARCHAR(128),
    resource_id     TEXT,
    details         JSONB,
    ip_address      VARCHAR(64),
    user_agent      TEXT,
    outcome         VARCHAR(32) NOT NULL DEFAULT 'success',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hipaa_audit_user ON hipaa_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_hipaa_audit_action ON hipaa_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_hipaa_audit_created ON hipaa_audit_log(created_at);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(64) UNIQUE NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
"""


async def bootstrap_auth_schema() -> None:
    await execute(AUTH_SCHEMA_SQL)
    logger.info("Auth schema bootstrapped")


# ── Startup ───────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    await bootstrap_auth_schema()
    logger.info("Security & Authentication Service started")


# ── Password helpers ──────────────────────────────────────────────────────────
def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


# ── JWT helpers ───────────────────────────────────────────────────────────────
def create_access_token(sub: str, roles: List[str], expires_delta: Optional[timedelta] = None) -> str:
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    payload = {
        "sub": sub,
        "roles": roles,
        "exp": expire,
        "iat": datetime.utcnow(),
        "iss": "healthpoint-auth",
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(sub: str) -> str:
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {
        "sub": sub,
        "type": "refresh",
        "exp": expire,
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


# ── Keycloak token exchange ───────────────────────────────────────────────────
async def keycloak_authenticate(username: str, password: str) -> Optional[dict]:
    """Authenticate against Keycloak and return token response."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/token",
                data={
                    "grant_type": "password",
                    "client_id": KEYCLOAK_CLIENT_ID,
                    "client_secret": KEYCLOAK_CLIENT_SECRET,
                    "username": username,
                    "password": password,
                    "scope": "openid profile email",
                },
            )
            if resp.status_code == 200:
                return resp.json()
            return None
    except Exception as e:
        logger.warning("Keycloak auth failed: %s — falling back to local auth", str(e))
        return None


# ── DB helpers ────────────────────────────────────────────────────────────────
async def get_user_by_username(username: str) -> Optional[dict]:
    row = await fetchrow("SELECT * FROM auth_users WHERE username = $1 AND is_active = TRUE", username)
    return dict(row) if row else None


async def get_user_by_id(user_id: str) -> Optional[dict]:
    row = await fetchrow("SELECT * FROM auth_users WHERE id = $1::uuid", user_id)
    return dict(row) if row else None


async def log_hipaa_event(
    user_id: str,
    action: str,
    resource_type: str = "",
    resource_id: Optional[str] = None,
    details: Optional[dict] = None,
    ip_address: Optional[str] = None,
    outcome: str = "success",
) -> None:
    """Persist HIPAA audit log entry to PostgreSQL."""
    import json
    await execute(
        """
        INSERT INTO hipaa_audit_log
            (user_id, action, resource_type, resource_id, details, ip_address, outcome)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
        """,
        user_id, action, resource_type, resource_id,
        json.dumps(details or {}), ip_address, outcome,
    )


# ── Authentication endpoints ──────────────────────────────────────────────────
@app.post("/api/v1/auth/token", response_model=Token)
async def login_for_access_token(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """
    Authenticate user via Keycloak (primary) or local PostgreSQL (fallback).
    Returns JWT access token and refresh token.
    """
    ip = request.client.host if request.client else "unknown"

    # Rate limit: 5 attempts per minute per IP
    allowed = await rate_limit_check(f"login:{ip}", limit=5, window=60)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please wait 60 seconds.",
        )

    # Try Keycloak first
    kc_result = await keycloak_authenticate(form_data.username, form_data.password)
    if kc_result:
        # Sync user to local DB
        user = await get_user_by_username(form_data.username)
        if not user:
            # Create local user record from Keycloak
            await execute(
                """
                INSERT INTO auth_users (username, email, roles, keycloak_id, last_login)
                VALUES ($1, $2, ARRAY['user'], $3, NOW())
                ON CONFLICT (username) DO UPDATE SET last_login = NOW()
                """,
                form_data.username,
                kc_result.get("email", ""),
                kc_result.get("sub", ""),
            )
            user = await get_user_by_username(form_data.username)

        await log_hipaa_event(
            user_id=str(user["id"]) if user else form_data.username,
            action="LOGIN_SUCCESS",
            resource_type="auth",
            ip_address=ip,
        )
        return Token(
            access_token=kc_result["access_token"],
            token_type="bearer",
            expires_in=kc_result.get("expires_in", 1800),
            refresh_token=kc_result.get("refresh_token"),
        )

    # Fallback: local PostgreSQL auth
    user = await get_user_by_username(form_data.username)
    if not user or not user.get("hashed_password"):
        await log_hipaa_event(
            user_id=form_data.username,
            action="LOGIN_FAILED",
            resource_type="auth",
            ip_address=ip,
            outcome="failure",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not verify_password(form_data.password, user["hashed_password"]):
        await log_hipaa_event(
            user_id=str(user["id"]),
            action="LOGIN_FAILED",
            resource_type="auth",
            ip_address=ip,
            outcome="failure",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Update last login
    await execute("UPDATE auth_users SET last_login = NOW() WHERE id = $1", user["id"])

    access_token = create_access_token(str(user["id"]), list(user["roles"]))
    refresh_token = create_refresh_token(str(user["id"]))

    await log_hipaa_event(
        user_id=str(user["id"]),
        action="LOGIN_SUCCESS",
        resource_type="auth",
        ip_address=ip,
    )

    return Token(
        access_token=access_token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        refresh_token=refresh_token,
    )


@app.post("/api/v1/auth/register", response_model=UserResponse, status_code=201)
async def register_user(user_data: UserCreate, request: Request,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Register a new user in PostgreSQL (and optionally Keycloak)."""
    existing = await get_user_by_username(user_data.username)
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")

    hashed = hash_password(user_data.password)
    user_id = str(uuid.uuid4())

    await execute(
        """
        INSERT INTO auth_users (id, username, email, full_name, hashed_password, roles)
        VALUES ($1::uuid, $2, $3, $4, $5, $6)
        """,
        user_id, user_data.username, user_data.email,
        user_data.full_name, hashed, user_data.roles,
    )

    await log_hipaa_event(
        user_id=user_id,
        action="USER_REGISTERED",
        resource_type="user",
        resource_id=user_id,
        ip_address=request.client.host if request.client else None,
    )

    return UserResponse(
        id=user_id,
        username=user_data.username,
        email=user_data.email,
        full_name=user_data.full_name,
        roles=user_data.roles,
        is_active=True,
        created_at=datetime.utcnow(),
    )


@app.get("/api/v1/users/me", response_model=UserResponse)
async def get_me(current_user: TokenPayload = Depends(get_current_user)):
    """Get current authenticated user profile."""
    user = await get_user_by_id(current_user.sub)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserResponse(
        id=str(user["id"]),
        username=user["username"],
        email=user.get("email"),
        full_name=user.get("full_name"),
        roles=list(user.get("roles", [])),
        is_active=user.get("is_active", True),
        created_at=user["created_at"],
    )


@app.get("/api/v1/audit-logs")
async def get_audit_logs(
    limit: int = 50,
    offset: int = 0,
    user_id: Optional[str] = None,
    action: Optional[str] = None,
    current_user: TokenPayload = Depends(require_admin),
):
    """Get HIPAA audit logs (admin only). Persisted to PostgreSQL."""
    from backend.shared.query_builder import QueryBuilder
    qb = QueryBuilder("SELECT * FROM hipaa_audit_log")
    if user_id:
        qb.where("user_id = $p", user_id)
    if action:
        qb.where("action = $p", action)
    qb.order_by_raw("created_at DESC")
    qb.paginate(limit, offset)
    sql, params = qb.build()
    rows = await fetch(sql, *params)
    return [dict(r) for r in rows]


@app.post("/api/v1/audit-logs")
async def create_audit_log(
    entry: AuditLogEntry,
    request: Request,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create a HIPAA audit log entry."""
    await log_hipaa_event(
        user_id=entry.user_id,
        action=entry.action,
        resource_type=entry.resource_type,
        resource_id=entry.resource_id,
        details=entry.details,
        ip_address=entry.ip_address or (request.client.host if request.client else None),
    )
    return {"status": "logged"}


@app.get("/api/v1/admin/dashboard")
async def get_admin_dashboard(current_user: TokenPayload = Depends(require_admin)):
    """Admin dashboard summary (admin role required)."""
    total_users = await fetchval("SELECT COUNT(*) FROM auth_users WHERE is_active = TRUE")
    recent_logins = await fetchval(
        "SELECT COUNT(*) FROM hipaa_audit_log WHERE action = 'LOGIN_SUCCESS' AND created_at > NOW() - INTERVAL '24 hours'"
    )
    failed_logins = await fetchval(
        "SELECT COUNT(*) FROM hipaa_audit_log WHERE action = 'LOGIN_FAILED' AND created_at > NOW() - INTERVAL '24 hours'"
    )
    return {
        "total_active_users": total_users,
        "logins_last_24h": recent_logins,
        "failed_logins_last_24h": failed_logins,
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.get("/health")
async def health_check():
    """Service health check."""
    try:
        count = await fetchval("SELECT 1")
        db_ok = count == 1
    except Exception:
        db_ok = False
    return {
        "status": "healthy" if db_ok else "degraded",
        "service": "Security & Authentication Service",
        "version": "2.0.0",
        "database": "connected" if db_ok else "disconnected",
        "timestamp": datetime.utcnow().isoformat(),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8031")))