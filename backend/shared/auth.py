"""
Real Keycloak JWT authentication middleware for all HealthPoint services.
Validates tokens against Keycloak's JWKS endpoint — NO local-only JWT.
"""
from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Any, Optional

import httpx
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from jose.exceptions import ExpiredSignatureError

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────
KEYCLOAK_URL: str = os.getenv("KEYCLOAK_URL", "http://keycloak:8080")
KEYCLOAK_REALM: str = os.getenv("KEYCLOAK_REALM", "healthpoint")
KEYCLOAK_CLIENT_ID: str = os.getenv("KEYCLOAK_CLIENT_ID", "healthpoint-api")
KEYCLOAK_CLIENT_SECRET: str = os.environ.get("KEYCLOAK_CLIENT_SECRET", "")

JWKS_URL: str = f"{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/certs"
ISSUER: str = f"{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}"
ALGORITHMS: list[str] = ["RS256"]

# ── JWKS caching ─────────────────────────────────────────────────────────────
_jwks_cache: Optional[dict] = None


async def _fetch_jwks() -> dict:
    """Fetch JWKS from Keycloak. Cached after first successful fetch."""
    global _jwks_cache
    if _jwks_cache is not None:
        return _jwks_cache
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(JWKS_URL)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        logger.info("JWKS fetched from Keycloak: %d keys", len(_jwks_cache.get("keys", [])))
        return _jwks_cache


def _invalidate_jwks_cache() -> None:
    """Force JWKS refresh on next request (call after key rotation)."""
    global _jwks_cache
    _jwks_cache = None


# ── Token validation ──────────────────────────────────────────────────────────
bearer_scheme = HTTPBearer(auto_error=False)


class TokenPayload:
    """Parsed and validated Keycloak token claims."""

    def __init__(self, claims: dict[str, Any]) -> None:
        self.sub: str = claims["sub"]
        self.email: str = claims.get("email", "")
        self.name: str = claims.get("name", "")
        self.preferred_username: str = claims.get("preferred_username", "")
        self.realm_roles: list[str] = claims.get("realm_access", {}).get("roles", [])
        self.resource_roles: dict[str, list[str]] = {
            k: v.get("roles", [])
            for k, v in claims.get("resource_access", {}).items()
        }
        self.raw: dict[str, Any] = claims

    @property
    def is_admin(self) -> bool:
        return "healthpoint-admin" in self.realm_roles or "admin" in self.realm_roles

    @property
    def is_provider(self) -> bool:
        return "provider" in self.realm_roles

    @property
    def is_plan(self) -> bool:
        return "health-plan" in self.realm_roles

    @property
    def is_idr_entity(self) -> bool:
        return "idr-entity" in self.realm_roles

    def has_role(self, role: str) -> bool:
        return role in self.realm_roles

    def has_resource_role(self, resource: str, role: str) -> bool:
        return role in self.resource_roles.get(resource, [])


async def validate_token(token: str) -> TokenPayload:
    """
    Validate a JWT token against Keycloak's JWKS.
    Raises HTTPException on any validation failure.
    """
    try:
        jwks = await _fetch_jwks()
        claims = jwt.decode(
            token,
            jwks,
            algorithms=ALGORITHMS,
            audience=KEYCLOAK_CLIENT_ID,
            issuer=ISSUER,
            options={"verify_exp": True, "verify_aud": True},
        )
        return TokenPayload(claims)
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except JWTError as e:
        # Try refreshing JWKS in case of key rotation
        _invalidate_jwks_cache()
        try:
            jwks = await _fetch_jwks()
            claims = jwt.decode(
                token,
                jwks,
                algorithms=ALGORITHMS,
                audience=KEYCLOAK_CLIENT_ID,
                issuer=ISSUER,
            )
            return TokenPayload(claims)
        except JWTError:
            logger.warning("JWT validation failed: %s", str(e))
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token",
                headers={"WWW-Authenticate": "Bearer"},
            )
    except httpx.HTTPError as e:
        logger.error("Failed to fetch JWKS from Keycloak: %s", str(e))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service unavailable",
        )


# ── FastAPI dependencies ──────────────────────────────────────────────────────
async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> TokenPayload:
    """FastAPI dependency: require a valid Keycloak token."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return await validate_token(credentials.credentials)


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> Optional[TokenPayload]:
    """FastAPI dependency: return user if token present, None otherwise."""
    if credentials is None:
        return None
    try:
        return await validate_token(credentials.credentials)
    except HTTPException:
        return None


def require_role(role: str):
    """FastAPI dependency factory: require a specific Keycloak realm role."""
    async def _check(user: TokenPayload = Depends(get_current_user)) -> TokenPayload:
        if not user.has_role(role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{role}' required",
            )
        return user
    return _check


require_admin = require_role("healthpoint-admin")
require_provider = require_role("provider")
require_plan = require_role("health-plan")
require_idr_entity = require_role("idr-entity")


# ── Security headers middleware ───────────────────────────────────────────────
async def security_headers_middleware(request: Request, call_next):
    """Add security headers to every response."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
    return response


# ── Keycloak admin client (for user management) ───────────────────────────────
class KeycloakAdmin:
    """Minimal Keycloak Admin REST API client."""

    def __init__(self) -> None:
        self._token: Optional[str] = None
        self._base = f"{KEYCLOAK_URL}/admin/realms/{KEYCLOAK_REALM}"

    async def _get_admin_token(self) -> str:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{KEYCLOAK_URL}/realms/master/protocol/openid-connect/token",
                data={
                    "grant_type": "client_credentials",
                    "client_id": "admin-cli",
                    "client_secret": os.environ["KEYCLOAK_ADMIN_SECRET"],
                },
            )
            resp.raise_for_status()
            return resp.json()["access_token"]

    async def get_user(self, user_id: str) -> dict:
        token = await self._get_admin_token()
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{self._base}/users/{user_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            return resp.json()

    async def assign_realm_role(self, user_id: str, role_name: str) -> None:
        token = await self._get_admin_token()
        async with httpx.AsyncClient(timeout=10) as client:
            # Get role representation
            role_resp = await client.get(
                f"{self._base}/roles/{role_name}",
                headers={"Authorization": f"Bearer {token}"},
            )
            role_resp.raise_for_status()
            role = role_resp.json()
            # Assign role
            assign_resp = await client.post(
                f"{self._base}/users/{user_id}/role-mappings/realm",
                json=[role],
                headers={"Authorization": f"Bearer {token}"},
            )
            assign_resp.raise_for_status()

    async def create_user(self, email: str, username: str, roles: list[str]) -> str:
        token = await self._get_admin_token()
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{self._base}/users",
                json={
                    "email": email,
                    "username": username,
                    "enabled": True,
                    "emailVerified": False,
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            user_id = resp.headers["Location"].split("/")[-1]
            for role in roles:
                await self.assign_realm_role(user_id, role)
            return user_id


keycloak_admin = KeycloakAdmin()
