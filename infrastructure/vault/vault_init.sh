#!/usr/bin/env bash
# HealthPoint Vault Initialization & Configuration Script
# Run ONCE after first deployment on vault-0
# Usage: ./vault_init.sh
set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-https://vault.healthpoint-infra.svc.cluster.local:8200}"
VAULT_CACERT="${VAULT_CACERT:-/vault/tls/ca.crt}"
INIT_OUTPUT_FILE="/vault/init-keys.json"

export VAULT_ADDR VAULT_CACERT

echo "=== HealthPoint Vault Initialization ==="
echo "Vault address: $VAULT_ADDR"

# ── 1. Check if already initialized ──────────────────────────────────────────
INIT_STATUS=$(vault status -format=json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['initialized'])" 2>/dev/null || echo "false")

if [ "$INIT_STATUS" = "True" ]; then
  echo "Vault is already initialized. Skipping init."
else
  echo "Initializing Vault with 5 key shares, 3 required to unseal..."
  vault operator init \
    -key-shares=5 \
    -key-threshold=3 \
    -format=json > "$INIT_OUTPUT_FILE"

  echo "Init complete. Keys written to $INIT_OUTPUT_FILE"
  echo "IMPORTANT: Distribute unseal keys to 5 separate key custodians immediately!"
  echo "IMPORTANT: Store root token in a hardware security module or secure vault!"

  # Extract root token for subsequent setup
  VAULT_TOKEN=$(python3 -c "import json; d=json.load(open('$INIT_OUTPUT_FILE')); print(d['root_token'])")
  export VAULT_TOKEN
fi

# ── 2. Wait for Vault to be unsealed (auto-unseal via KMS should handle this) ─
echo "Waiting for Vault to become active..."
for i in $(seq 1 30); do
  STATUS=$(vault status -format=json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['sealed'])" 2>/dev/null || echo "true")
  if [ "$STATUS" = "False" ]; then
    echo "Vault is unsealed and active."
    break
  fi
  echo "  Attempt $i/30: Vault still sealed, waiting 5s..."
  sleep 5
done

# ── 3. Enable audit logging ───────────────────────────────────────────────────
echo "Enabling audit logging to stdout..."
vault audit enable file file_path=stdout || echo "Audit already enabled"

# ── 4. Enable secrets engines ─────────────────────────────────────────────────
echo "Enabling secrets engines..."

# KV v2 for static secrets
vault secrets enable -path=secret kv-v2 || echo "KV already enabled"

# Database secrets engine for dynamic PostgreSQL credentials
vault secrets enable database || echo "Database engine already enabled"

# PKI for internal TLS
vault secrets enable pki || echo "PKI already enabled"
vault secrets tune -max-lease-ttl=8760h pki

# Transit for encryption-as-a-service
vault secrets enable transit || echo "Transit already enabled"

# ── 5. Configure PostgreSQL dynamic credentials ───────────────────────────────
echo "Configuring PostgreSQL dynamic credentials..."
vault write database/config/healthpoint-postgres \
  plugin_name=postgresql-database-plugin \
  allowed_roles="healthpoint-readonly,healthpoint-readwrite" \
  connection_url="postgresql://{{username}}:{{password}}@postgres.healthpoint-infra.svc.cluster.local:5432/healthpoint?sslmode=require" \
  username="${POSTGRES_VAULT_USER:-vault_admin}" \
  password="${POSTGRES_VAULT_PASSWORD}" \
  max_open_connections=10 \
  max_idle_connections=5 \
  max_connection_lifetime="5m"

vault write database/roles/healthpoint-readonly \
  db_name=healthpoint-postgres \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT SELECT ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" \
  default_ttl="1h" \
  max_ttl="24h"

vault write database/roles/healthpoint-readwrite \
  db_name=healthpoint-postgres \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO \"{{name}}\"; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO \"{{name}}\";" \
  default_ttl="1h" \
  max_ttl="24h"

# ── 6. Configure PKI ──────────────────────────────────────────────────────────
echo "Configuring PKI..."
vault write pki/root/generate/internal \
  common_name="HealthPoint Internal CA" \
  ttl=87600h \
  key_type=rsa \
  key_bits=4096

vault write pki/config/urls \
  issuing_certificates="$VAULT_ADDR/v1/pki/ca" \
  crl_distribution_points="$VAULT_ADDR/v1/pki/crl"

vault write pki/roles/healthpoint-services \
  allowed_domains="healthpoint-services.svc.cluster.local,healthpoint.internal" \
  allow_subdomains=true \
  max_ttl=720h \
  key_type=rsa \
  key_bits=2048

# ── 7. Configure Transit encryption key ──────────────────────────────────────
echo "Configuring Transit encryption..."
vault write -f transit/keys/healthpoint-data \
  type=aes256-gcm96 \
  exportable=false \
  allow_plaintext_backup=false

# ── 8. Enable AppRole auth ────────────────────────────────────────────────────
echo "Enabling AppRole auth..."
vault auth enable approle || echo "AppRole already enabled"

# ── 9. Enable Kubernetes auth ─────────────────────────────────────────────────
echo "Enabling Kubernetes auth..."
vault auth enable kubernetes || echo "Kubernetes auth already enabled"

vault write auth/kubernetes/config \
  kubernetes_host="https://kubernetes.default.svc.cluster.local:443" \
  kubernetes_ca_cert=@/var/run/secrets/kubernetes.io/serviceaccount/ca.crt \
  token_reviewer_jwt=@/var/run/secrets/kubernetes.io/serviceaccount/token

# ── 10. Write service policies ────────────────────────────────────────────────
echo "Writing service policies..."
vault policy write healthpoint-services /vault/policies/healthpoint-services.hcl

# ── 11. Create Kubernetes auth roles for each service ─────────────────────────
echo "Creating Kubernetes auth roles..."
SERVICES=(
  "nsa-idr-dispute-service"
  "payment-processing-service"
  "claims-processing-service"
  "admin-fee-management-service"
  "appeal-escalation-service"
  "gfe-management-service"
  "idr-entity-selection-service"
  "workflow-engine-service"
  "notification-service"
  "audit-compliance-service"
  "fraud-detection-service"
  "analytics-reporting-service"
  "document-management-service"
  "user-management-service"
  "security-authentication-service"
)

for SERVICE in "${SERVICES[@]}"; do
  vault write "auth/kubernetes/role/${SERVICE}" \
    bound_service_account_names="${SERVICE}" \
    bound_service_account_namespaces="healthpoint-services" \
    policies="healthpoint-services" \
    ttl="1h"
  echo "  Created role: ${SERVICE}"
done

# ── 12. Store common secrets ──────────────────────────────────────────────────
echo "Storing common platform secrets..."
vault kv put secret/healthpoint/common/jwt \
  secret="${JWT_SECRET:-CHANGE_ME_BEFORE_PRODUCTION}"

vault kv put secret/healthpoint/common/kafka \
  bootstrap_servers="${KAFKA_BOOTSTRAP_SERVERS:-kafka:9092}" \
  sasl_username="${KAFKA_SASL_USERNAME:-healthpoint}" \
  sasl_password="${KAFKA_SASL_PASSWORD:-CHANGE_ME}"

vault kv put secret/healthpoint/common/redis \
  url="${REDIS_URL:-redis://redis:6379}" \
  password="${REDIS_PASSWORD:-CHANGE_ME}"

vault kv put secret/healthpoint/common/keycloak \
  realm="${KEYCLOAK_REALM:-healthpoint}" \
  client_id="${KEYCLOAK_CLIENT_ID:-healthpoint-backend}" \
  client_secret="${KEYCLOAK_CLIENT_SECRET:-CHANGE_ME}" \
  server_url="${KEYCLOAK_SERVER_URL:-https://keycloak:8443}"

vault kv put secret/healthpoint/common/smtp \
  host="${SMTP_HOST:-smtp.sendgrid.net}" \
  port="${SMTP_PORT:-587}" \
  username="${SMTP_USERNAME:-apikey}" \
  password="${SMTP_PASSWORD:-CHANGE_ME}"

echo ""
echo "=== Vault initialization complete ==="
echo "Next steps:"
echo "  1. Distribute unseal keys from $INIT_OUTPUT_FILE to 5 custodians"
echo "  2. Delete $INIT_OUTPUT_FILE from disk"
echo "  3. Revoke the root token: vault token revoke \$VAULT_TOKEN"
echo "  4. Update POSTGRES_VAULT_PASSWORD and all CHANGE_ME values"
