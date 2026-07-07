"""
HashiCorp Vault secrets management for HealthPoint NSA/IDR Platform.
Provides dynamic secrets for PostgreSQL, Redis, Kafka, and static secrets
for Keycloak, Stripe, SMTP, and other external services.

Falls back to environment variables when Vault is unavailable (dev/test mode).
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

# ── Vault configuration ───────────────────────────────────────────────────────
VAULT_ADDR = os.getenv("VAULT_ADDR", "http://vault:8200")
VAULT_TOKEN = os.getenv("VAULT_TOKEN", "")
VAULT_ROLE_ID = os.getenv("VAULT_ROLE_ID", "")
VAULT_SECRET_ID = os.getenv("VAULT_SECRET_ID", "")
VAULT_NAMESPACE = os.getenv("VAULT_NAMESPACE", "")
VAULT_MOUNT_KV = os.getenv("VAULT_MOUNT_KV", "secret")
VAULT_MOUNT_DB = os.getenv("VAULT_MOUNT_DB", "database")
VAULT_MOUNT_KAFKA = os.getenv("VAULT_MOUNT_KAFKA", "kafka")
VAULT_ENABLED = os.getenv("VAULT_ENABLED", "false").lower() == "true"

# ── Lease cache ───────────────────────────────────────────────────────────────
_lease_cache: Dict[str, Dict[str, Any]] = {}
_vault_token_cache: Optional[str] = None
_vault_token_expiry: float = 0.0


class VaultClient:
    """
    Async HashiCorp Vault client with AppRole authentication,
    dynamic database credentials, and automatic lease renewal.
    """

    def __init__(self):
        self._token: Optional[str] = None
        self._token_expiry: float = 0.0
        self._client = httpx.AsyncClient(
            base_url=VAULT_ADDR,
            timeout=10.0,
            headers={"X-Vault-Namespace": VAULT_NAMESPACE} if VAULT_NAMESPACE else {}
        )

    async def _authenticate(self) -> str:
        """Authenticate via AppRole and return a Vault token."""
        if self._token and time.time() < self._token_expiry - 60:
            return self._token

        # Try static token first (dev/CI)
        if VAULT_TOKEN:
            self._token = VAULT_TOKEN
            self._token_expiry = time.time() + 3600
            return self._token

        # AppRole authentication
        if not VAULT_ROLE_ID or not VAULT_SECRET_ID:
            raise RuntimeError("Vault: neither VAULT_TOKEN nor VAULT_ROLE_ID/VAULT_SECRET_ID are set")

        resp = await self._client.post(
            "/v1/auth/approle/login",
            json={"role_id": VAULT_ROLE_ID, "secret_id": VAULT_SECRET_ID}
        )
        resp.raise_for_status()
        data = resp.json()
        self._token = data["auth"]["client_token"]
        lease_duration = data["auth"].get("lease_duration", 3600)
        self._token_expiry = time.time() + lease_duration
        logger.info(f"Vault AppRole authenticated, token valid for {lease_duration}s")
        return self._token

    async def _request(self, method: str, path: str, **kwargs) -> Dict[str, Any]:
        """Make an authenticated Vault API request."""
        token = await self._authenticate()
        resp = await self._client.request(
            method, path,
            headers={"X-Vault-Token": token},
            **kwargs
        )
        resp.raise_for_status()
        return resp.json()

    async def get_kv_secret(self, path: str) -> Dict[str, Any]:
        """
        Read a KV v2 secret from Vault.
        path: e.g. "healthpoint/keycloak" → reads secret/data/healthpoint/keycloak
        """
        cache_key = f"kv:{path}"
        if cache_key in _lease_cache:
            entry = _lease_cache[cache_key]
            if time.time() < entry["expires_at"]:
                return entry["data"]

        data = await self._request("GET", f"/v1/{VAULT_MOUNT_KV}/data/{path}")
        secret_data = data["data"]["data"]
        # KV v2 secrets don't have leases, cache for 5 minutes
        _lease_cache[cache_key] = {
            "data": secret_data,
            "expires_at": time.time() + 300
        }
        return secret_data

    async def get_dynamic_db_credentials(self, role: str = "healthpoint-app") -> Dict[str, str]:
        """
        Get dynamic PostgreSQL credentials from Vault database secrets engine.
        Returns {"username": "...", "password": "...", "lease_id": "...", "lease_duration": ...}
        """
        cache_key = f"db:{role}"
        if cache_key in _lease_cache:
            entry = _lease_cache[cache_key]
            # Renew if within 20% of expiry
            remaining = entry["expires_at"] - time.time()
            if remaining > entry["lease_duration"] * 0.2:
                return entry["data"]

        data = await self._request("GET", f"/v1/{VAULT_MOUNT_DB}/creds/{role}")
        creds = {
            "username": data["data"]["username"],
            "password": data["data"]["password"],
            "lease_id": data["lease_id"],
            "lease_duration": data["lease_duration"],
        }
        _lease_cache[cache_key] = {
            "data": creds,
            "expires_at": time.time() + data["lease_duration"],
            "lease_duration": data["lease_duration"]
        }
        logger.info(f"Vault: obtained dynamic DB credentials for role '{role}', lease {data['lease_duration']}s")
        return creds

    async def get_dynamic_kafka_credentials(self, role: str = "healthpoint-producer") -> Dict[str, str]:
        """Get dynamic Kafka credentials from Vault."""
        cache_key = f"kafka:{role}"
        if cache_key in _lease_cache:
            entry = _lease_cache[cache_key]
            if time.time() < entry["expires_at"] - 60:
                return entry["data"]

        data = await self._request("GET", f"/v1/{VAULT_MOUNT_KAFKA}/creds/{role}")
        creds = {
            "username": data["data"]["username"],
            "password": data["data"]["password"],
            "lease_id": data["lease_id"],
        }
        _lease_cache[cache_key] = {
            "data": creds,
            "expires_at": time.time() + data.get("lease_duration", 3600)
        }
        return creds

    async def renew_lease(self, lease_id: str, increment: int = 3600) -> bool:
        """Renew a Vault lease."""
        try:
            await self._request("PUT", "/v1/sys/leases/renew", json={
                "lease_id": lease_id,
                "increment": increment
            })
            return True
        except Exception as e:
            logger.warning(f"Vault lease renewal failed for {lease_id}: {e}")
            return False

    async def revoke_lease(self, lease_id: str) -> bool:
        """Revoke a Vault lease on shutdown."""
        try:
            await self._request("PUT", "/v1/sys/leases/revoke", json={"lease_id": lease_id})
            return True
        except Exception as e:
            logger.warning(f"Vault lease revocation failed for {lease_id}: {e}")
            return False

    async def close(self):
        """Close the HTTP client."""
        await self._client.aclose()


# ── Global Vault client instance ──────────────────────────────────────────────
_vault_client: Optional[VaultClient] = None


def get_vault_client() -> Optional[VaultClient]:
    """Get the global Vault client (None if Vault is disabled)."""
    global _vault_client
    if VAULT_ENABLED and _vault_client is None:
        _vault_client = VaultClient()
    return _vault_client


# ── Secret resolution with env fallback ──────────────────────────────────────
async def get_secret(vault_path: str, key: str, env_var: str, default: str = "") -> str:
    """
    Resolve a secret from Vault KV, falling back to environment variable.

    Args:
        vault_path: Vault KV path (e.g. "healthpoint/keycloak")
        key: Key within the secret (e.g. "client_secret")
        env_var: Environment variable name to fall back to
        default: Default value if neither Vault nor env var is set

    Returns:
        The resolved secret value
    """
    vault = get_vault_client()
    if vault:
        try:
            secrets = await vault.get_kv_secret(vault_path)
            value = secrets.get(key)
            if value:
                return value
        except Exception as e:
            logger.warning(f"Vault secret {vault_path}/{key} unavailable, falling back to env: {e}")

    return os.getenv(env_var, default)


async def get_database_url() -> str:
    """
    Get PostgreSQL connection URL.
    Uses dynamic Vault credentials in production, env var in dev/test.
    """
    vault = get_vault_client()
    if vault:
        try:
            creds = await vault.get_dynamic_db_credentials("healthpoint-app")
            host = os.getenv("POSTGRES_HOST", "postgres")
            port = os.getenv("POSTGRES_PORT", "5432")
            db = os.getenv("POSTGRES_DB", "healthpoint")
            return f"postgresql://{creds['username']}:{creds['password']}@{host}:{port}/{db}"
        except Exception as e:
            logger.warning(f"Vault DB credentials unavailable, falling back to DATABASE_URL env: {e}")

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL environment variable is not set and Vault is unavailable")
    return db_url


async def get_redis_url() -> str:
    """Get Redis connection URL with optional Vault-managed password."""
    password = await get_secret(
        "healthpoint/redis", "password",
        "REDIS_PASSWORD", ""
    )
    host = os.getenv("REDIS_HOST", "redis")
    port = os.getenv("REDIS_PORT", "6379")
    db = os.getenv("REDIS_DB", "0")
    if password:
        return f"redis://:{password}@{host}:{port}/{db}"
    return os.getenv("REDIS_URL", f"redis://{host}:{port}/{db}")


async def get_keycloak_client_secret() -> str:
    """Get Keycloak backend client secret."""
    return await get_secret(
        "healthpoint/keycloak", "backend_client_secret",
        "KEYCLOAK_CLIENT_SECRET", ""
    )


async def get_stripe_secret_key() -> str:
    """Get Stripe secret key."""
    return await get_secret(
        "healthpoint/stripe", "secret_key",
        "STRIPE_SECRET_KEY", ""
    )


async def get_smtp_credentials() -> Dict[str, str]:
    """Get SMTP credentials."""
    vault = get_vault_client()
    if vault:
        try:
            secrets = await vault.get_kv_secret("healthpoint/smtp")
            return {
                "host": secrets.get("host", os.getenv("SMTP_HOST", "localhost")),
                "port": secrets.get("port", os.getenv("SMTP_PORT", "587")),
                "user": secrets.get("user", os.getenv("SMTP_USER", "")),
                "password": secrets.get("password", os.getenv("SMTP_PASSWORD", "")),
                "from": secrets.get("from", os.getenv("SMTP_FROM", "noreply@healthpoint.example.com")),
            }
        except Exception as e:
            logger.warning(f"Vault SMTP credentials unavailable: {e}")

    return {
        "host": os.getenv("SMTP_HOST", "localhost"),
        "port": os.getenv("SMTP_PORT", "587"),
        "user": os.getenv("SMTP_USER", ""),
        "password": os.getenv("SMTP_PASSWORD", ""),
        "from": os.getenv("SMTP_FROM", "noreply@healthpoint.example.com"),
    }


async def get_jwt_secret() -> str:
    """Get JWT signing secret."""
    secret = await get_secret(
        "healthpoint/jwt", "secret",
        "JWT_SECRET", ""
    )
    if not secret:
        raise RuntimeError("JWT_SECRET is not configured. Set VAULT_ENABLED=true with Vault path "
                           "healthpoint/jwt.secret, or set the JWT_SECRET environment variable.")
    return secret


# ── Vault policy document (for reference / provisioning) ─────────────────────
VAULT_POLICY_HCL = """
# HealthPoint application policy
path "secret/data/healthpoint/*" {
  capabilities = ["read"]
}

path "database/creds/healthpoint-app" {
  capabilities = ["read"]
}

path "kafka/creds/healthpoint-producer" {
  capabilities = ["read"]
}

path "kafka/creds/healthpoint-consumer" {
  capabilities = ["read"]
}

path "sys/leases/renew" {
  capabilities = ["update"]
}

path "sys/leases/revoke" {
  capabilities = ["update"]
}
"""

# ── Vault provisioning script (run once during infrastructure setup) ──────────
VAULT_SETUP_SCRIPT = """#!/bin/bash
# Run this script once to provision Vault for HealthPoint
# Requires: vault CLI, VAULT_ADDR and VAULT_TOKEN set

set -euo pipefail

echo "=== Enabling KV v2 secrets engine ==="
vault secrets enable -path=secret kv-v2 || true

echo "=== Writing static secrets ==="
vault kv put secret/healthpoint/keycloak \\
  backend_client_secret="${KEYCLOAK_BACKEND_CLIENT_SECRET}" \\
  apisix_client_secret="${KEYCLOAK_APISIX_CLIENT_SECRET}"

vault kv put secret/healthpoint/jwt \\
  secret="${JWT_SECRET}"

vault kv put secret/healthpoint/stripe \\
  secret_key="${STRIPE_SECRET_KEY}"

vault kv put secret/healthpoint/smtp \\
  host="${SMTP_HOST}" \\
  port="${SMTP_PORT}" \\
  user="${SMTP_USER}" \\
  password="${SMTP_PASSWORD}" \\
  from="${SMTP_FROM}"

vault kv put secret/healthpoint/redis \\
  password="${REDIS_PASSWORD}"

echo "=== Enabling database secrets engine ==="
vault secrets enable database || true

vault write database/config/healthpoint-postgres \\
  plugin_name=postgresql-database-plugin \\
  allowed_roles="healthpoint-app,healthpoint-readonly" \\
  connection_url="postgresql://{{username}}:{{password}}@${POSTGRES_HOST}:5432/${POSTGRES_DB}" \\
  username="${POSTGRES_VAULT_ADMIN_USER}" \\
  password="${POSTGRES_VAULT_ADMIN_PASSWORD}"

vault write database/roles/healthpoint-app \\
  db_name=healthpoint-postgres \\
  creation_statements="CREATE ROLE \\"{{name}}\\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO \\"{{name}}\\"; GRANT USAGE ON SCHEMA public TO \\"{{name}}\\"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO \\"{{name}}\\"; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO \\"{{name}}\\";" \\
  default_ttl="1h" \\
  max_ttl="24h"

vault write database/roles/healthpoint-readonly \\
  db_name=healthpoint-postgres \\
  creation_statements="CREATE ROLE \\"{{name}}\\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO \\"{{name}}\\"; GRANT USAGE ON SCHEMA public TO \\"{{name}}\\"; GRANT SELECT ON ALL TABLES IN SCHEMA public TO \\"{{name}}\\";" \\
  default_ttl="1h" \\
  max_ttl="8h"

echo "=== Writing AppRole auth ==="
vault auth enable approle || true

vault write auth/approle/role/healthpoint-app \\
  secret_id_ttl=0 \\
  token_num_uses=0 \\
  token_ttl=1h \\
  token_max_ttl=4h \\
  policies="healthpoint-app"

vault policy write healthpoint-app - << 'POLICY'
path "secret/data/healthpoint/*" { capabilities = ["read"] }
path "database/creds/healthpoint-app" { capabilities = ["read"] }
path "sys/leases/renew" { capabilities = ["update"] }
path "sys/leases/revoke" { capabilities = ["update"] }
POLICY

echo "=== Vault provisioning complete ==="
echo "Role ID: $(vault read -field=role_id auth/approle/role/healthpoint-app/role-id)"
echo "Secret ID: $(vault write -f -field=secret_id auth/approle/role/healthpoint-app/secret-id)"
"""


def write_vault_setup_script():
    """Write the Vault setup script to disk."""
    script_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "scripts", "vault_setup.sh"
    )
    with open(script_path, "w") as f:
        f.write(VAULT_SETUP_SCRIPT)
    os.chmod(script_path, 0o755)
    logger.info(f"Vault setup script written to {script_path}")


if __name__ == "__main__":
    write_vault_setup_script()
    print("Vault setup script written to scripts/vault_setup.sh")
