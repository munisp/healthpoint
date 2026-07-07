#!/bin/bash
# Run this script once to provision Vault for HealthPoint
# Requires: vault CLI, VAULT_ADDR and VAULT_TOKEN set

set -euo pipefail

echo "=== Enabling KV v2 secrets engine ==="
vault secrets enable -path=secret kv-v2 || true

echo "=== Writing static secrets ==="
vault kv put secret/healthpoint/keycloak \
  backend_client_secret="${KEYCLOAK_BACKEND_CLIENT_SECRET}" \
  apisix_client_secret="${KEYCLOAK_APISIX_CLIENT_SECRET}"

vault kv put secret/healthpoint/jwt \
  secret="${JWT_SECRET}"

vault kv put secret/healthpoint/stripe \
  secret_key="${STRIPE_SECRET_KEY}"

vault kv put secret/healthpoint/smtp \
  host="${SMTP_HOST}" \
  port="${SMTP_PORT}" \
  user="${SMTP_USER}" \
  password="${SMTP_PASSWORD}" \
  from="${SMTP_FROM}"

vault kv put secret/healthpoint/redis \
  password="${REDIS_PASSWORD}"

echo "=== Enabling database secrets engine ==="
vault secrets enable database || true

vault write database/config/healthpoint-postgres \
  plugin_name=postgresql-database-plugin \
  allowed_roles="healthpoint-app,healthpoint-readonly" \
  connection_url="postgresql://{{username}}:{{password}}@${POSTGRES_HOST}:5432/${POSTGRES_DB}" \
  username="${POSTGRES_VAULT_ADMIN_USER}" \
  password="${POSTGRES_VAULT_ADMIN_PASSWORD}"

vault write database/roles/healthpoint-app \
  db_name=healthpoint-postgres \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO \"{{name}}\"; GRANT USAGE ON SCHEMA public TO \"{{name}}\"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO \"{{name}}\"; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO \"{{name}}\";" \
  default_ttl="1h" \
  max_ttl="24h"

vault write database/roles/healthpoint-readonly \
  db_name=healthpoint-postgres \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO \"{{name}}\"; GRANT USAGE ON SCHEMA public TO \"{{name}}\"; GRANT SELECT ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" \
  default_ttl="1h" \
  max_ttl="8h"

echo "=== Writing AppRole auth ==="
vault auth enable approle || true

vault write auth/approle/role/healthpoint-app \
  secret_id_ttl=0 \
  token_num_uses=0 \
  token_ttl=1h \
  token_max_ttl=4h \
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
