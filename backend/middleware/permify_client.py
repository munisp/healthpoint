"""
Permify authorization integration for HealthPoint IDR Platform.
Permify provides Google Zanzibar-style fine-grained authorization.

Implements:
- Role-based access control (RBAC) for IDR cases
- Attribute-based access control (ABAC) for document access
- Relationship-based access control (ReBAC) for provider/plan hierarchies
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

PERMIFY_URL: str = os.getenv("PERMIFY_URL", "http://permify:3476")
PERMIFY_TENANT_ID: str = os.getenv("PERMIFY_TENANT_ID", "healthpoint")
PERMIFY_ENABLED: bool = os.getenv("PERMIFY_ENABLED", "true").lower() == "true"

# ── Schema definition ─────────────────────────────────────────────────────────
PERMIFY_SCHEMA = """
entity user {}

entity organization {
    relation admin @user
    relation member @user

    permission manage = admin
    permission view = admin or member
}

entity idr_case {
    relation owner @user
    relation provider @user
    relation plan @user
    relation idr_entity @user
    relation admin @user

    permission view = owner or provider or plan or idr_entity or admin
    permission edit = owner or admin
    permission resolve = idr_entity or admin
    permission upload_document = owner or provider or plan or admin
    permission view_document = owner or provider or plan or idr_entity or admin
}

entity document {
    relation owner @user
    relation case_member @idr_case#view

    permission view = owner or case_member
    permission delete = owner
}

entity payment {
    relation payer @user
    relation payee @user
    relation admin @user

    permission view = payer or payee or admin
    permission approve = admin
}
"""


# ── HTTP client ───────────────────────────────────────────────────────────────
def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=PERMIFY_URL,
        timeout=10,
        headers={"Content-Type": "application/json"},
    )


# ── Schema management ─────────────────────────────────────────────────────────
async def write_schema() -> None:
    """Push the authorization schema to Permify."""
    if not PERMIFY_ENABLED:
        return
    try:
        async with _client() as client:
            resp = await client.post(
                f"/v1/tenants/{PERMIFY_TENANT_ID}/schemas/write",
                json={"schema": PERMIFY_SCHEMA},
            )
            resp.raise_for_status()
            logger.info("Permify schema written successfully")
    except httpx.HTTPError as e:
        logger.error("Failed to write Permify schema: %s", str(e))


# ── Relationship management ───────────────────────────────────────────────────
async def write_relationship(
    entity_type: str,
    entity_id: str,
    relation: str,
    subject_type: str,
    subject_id: str,
) -> bool:
    """Create a relationship tuple in Permify."""
    if not PERMIFY_ENABLED:
        return await _pg_write_relationship(entity_type, entity_id, relation, subject_type, subject_id)

    try:
        async with _client() as client:
            resp = await client.post(
                f"/v1/tenants/{PERMIFY_TENANT_ID}/relationships/write",
                json={
                    "metadata": {"schema_version": ""},
                    "tuples": [
                        {
                            "entity": {"type": entity_type, "id": entity_id},
                            "relation": relation,
                            "subject": {"type": subject_type, "id": subject_id},
                        }
                    ],
                },
            )
            resp.raise_for_status()
            return True
    except httpx.HTTPError as e:
        logger.error("Permify write_relationship failed: %s", str(e))
        return False


async def delete_relationship(
    entity_type: str,
    entity_id: str,
    relation: str,
    subject_type: str,
    subject_id: str,
) -> bool:
    """Delete a relationship tuple from Permify."""
    if not PERMIFY_ENABLED:
        return True

    try:
        async with _client() as client:
            resp = await client.post(
                f"/v1/tenants/{PERMIFY_TENANT_ID}/relationships/delete",
                json={
                    "filter": {
                        "entity_type": entity_type,
                        "entity_id": entity_id,
                        "relation": relation,
                        "subject_type": subject_type,
                        "subject_id": subject_id,
                    }
                },
            )
            resp.raise_for_status()
            return True
    except httpx.HTTPError as e:
        logger.error("Permify delete_relationship failed: %s", str(e))
        return False


# ── Permission checks ─────────────────────────────────────────────────────────
async def check_permission(
    entity_type: str,
    entity_id: str,
    permission: str,
    subject_type: str,
    subject_id: str,
) -> bool:
    """
    Check if a subject has a permission on an entity.
    Returns True if allowed, False if denied.
    Falls back to Keycloak role check if Permify is unavailable.
    """
    if not PERMIFY_ENABLED:
        return await _pg_check_permission(entity_type, entity_id, permission, subject_type, subject_id)

    try:
        async with _client() as client:
            resp = await client.post(
                f"/v1/tenants/{PERMIFY_TENANT_ID}/permissions/check",
                json={
                    "metadata": {"schema_version": "", "snap_token": "", "depth": 20},
                    "entity": {"type": entity_type, "id": entity_id},
                    "permission": permission,
                    "subject": {"type": subject_type, "id": subject_id},
                },
            )
            resp.raise_for_status()
            result = resp.json()
            return result.get("can") == "CHECK_RESULT_ALLOWED"
    except httpx.HTTPError as e:
        logger.error("Permify check_permission failed: %s — denying by default", str(e))
        return False


async def check_idr_case_permission(
    case_id: str,
    user_id: str,
    permission: str,
) -> bool:
    """Check if a user has a specific permission on an IDR case."""
    return await check_permission("idr_case", case_id, permission, "user", user_id)


async def check_document_permission(
    document_id: str,
    user_id: str,
    permission: str = "view",
) -> bool:
    """Check if a user has a specific permission on a document."""
    return await check_permission("document", document_id, permission, "user", user_id)


# ── IDR case relationship helpers ─────────────────────────────────────────────
async def grant_case_access(
    case_id: str,
    user_id: str,
    role: str,  # 'owner' | 'provider' | 'plan' | 'idr_entity' | 'admin'
) -> bool:
    """Grant a user a role on an IDR case."""
    return await write_relationship("idr_case", case_id, role, "user", user_id)


async def revoke_case_access(case_id: str, user_id: str, role: str) -> bool:
    """Revoke a user's role on an IDR case."""
    return await delete_relationship("idr_case", case_id, role, "user", user_id)


# ── PostgreSQL fallback ───────────────────────────────────────────────────────
async def _pg_write_relationship(
    entity_type: str,
    entity_id: str,
    relation: str,
    subject_type: str,
    subject_id: str,
) -> bool:
    from backend.shared.database import execute
    await execute(
        """
        INSERT INTO permify_relationships
            (entity_type, entity_id, relation, subject_type, subject_id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (entity_type, entity_id, relation, subject_type, subject_id) DO NOTHING
        """,
        entity_type, entity_id, relation, subject_type, subject_id,
    )
    return True


async def _pg_check_permission(
    entity_type: str,
    entity_id: str,
    permission: str,
    subject_type: str,
    subject_id: str,
) -> bool:
    """Simple PostgreSQL-based permission check (no graph traversal)."""
    from backend.shared.database import fetchval
    # Map permissions to relations (simplified)
    permission_to_relations = {
        "view": ["owner", "provider", "plan", "idr_entity", "admin"],
        "edit": ["owner", "admin"],
        "resolve": ["idr_entity", "admin"],
        "upload_document": ["owner", "provider", "plan", "admin"],
        "view_document": ["owner", "provider", "plan", "idr_entity", "admin"],
        "approve": ["admin"],
    }
    allowed_relations = permission_to_relations.get(permission, ["admin"])
    count = await fetchval(
        """
        SELECT COUNT(*) FROM permify_relationships
        WHERE entity_type = $1
          AND entity_id = $2
          AND relation = ANY($3)
          AND subject_type = $4
          AND subject_id = $5
        """,
        entity_type, entity_id, allowed_relations, subject_type, subject_id,
    )
    return (count or 0) > 0


# ── Schema ────────────────────────────────────────────────────────────────────
PERMIFY_PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS permify_relationships (
    id              BIGSERIAL PRIMARY KEY,
    entity_type     VARCHAR(128) NOT NULL,
    entity_id       VARCHAR(255) NOT NULL,
    relation        VARCHAR(128) NOT NULL,
    subject_type    VARCHAR(128) NOT NULL,
    subject_id      VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity_type, entity_id, relation, subject_type, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_permify_entity ON permify_relationships(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_permify_subject ON permify_relationships(subject_type, subject_id);
"""


async def bootstrap_permify_schema() -> None:
    from backend.shared.database import execute
    await execute(PERMIFY_PG_SCHEMA)
    logger.info("Permify PostgreSQL fallback schema bootstrapped")
