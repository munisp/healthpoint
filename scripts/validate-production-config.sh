#!/usr/bin/env bash
set -euo pipefail

missing=()
invalid=()
tb_ca_path="${TIGERBEETLE_CA_PATH:-./infra/certs/tigerbeetle-ca.crt}"
tb_client_cert_path="${TIGERBEETLE_CLIENT_CERT_PATH:-./infra/certs/tigerbeetle-client.crt}"
required=(DATABASE_URL JWT_SECRET SETTLEMENT_CALLBACK_KEYRING SETTLEMENT_MTLS_CLIENT_CA_PEM SETTLEMENT_MTLS_CLIENT_FINGERPRINTS SETTLEMENT_MTLS_INGRESS_TOKEN BACKUP_ENCRYPTION_PASSPHRASE INTERNAL_SERVICE_TOKEN PAYMENT_EXECUTION_MODE EMR_CREDENTIALS_ENCRYPTION_KEY TIGERBEETLE_ENABLED TIGERBEETLE_ADDRESS TIGERBEETLE_CLUSTER_ID TIGERBEETLE_TLS_REMOTE_ADDRESS TIGERBEETLE_TLS_SERVER_NAME)
for key in "${required[@]}"; do
  [[ -n "${!key:-}" ]] || missing+=("$key")
done

if [[ -n "${DATABASE_URL:-}" && ! "$DATABASE_URL" =~ ^postgres(ql)?:// ]]; then
  invalid+=("DATABASE_URL must use the PostgreSQL URI scheme")
fi
if [[ "${ALLOW_LOCAL_DATABASE:-false}" != "true" && "${DATABASE_URL:-}" =~ @(localhost|127\.0\.0\.1|postgres): ]]; then
  invalid+=("DATABASE_URL must reference the managed production PostgreSQL endpoint, not a local or compose hostname")
fi
if [[ -n "${SETTLEMENT_CALLBACK_KEYRING:-}" ]] && ! node -e 'try { const value=JSON.parse(process.argv[1]); if (!value || Array.isArray(value) || !Object.values(value).every(v => typeof v === "string" && v.length >= 32)) process.exit(1); } catch { process.exit(1); }' "$SETTLEMENT_CALLBACK_KEYRING" 2>/dev/null; then
  invalid+=("SETTLEMENT_CALLBACK_KEYRING must be JSON with versioned 32+ character key values")
fi
for key in JWT_SECRET SETTLEMENT_MTLS_INGRESS_TOKEN BACKUP_ENCRYPTION_PASSPHRASE; do
  value="${!key:-}"
  [[ "${#value}" -ge 32 ]] || invalid+=("$key must contain at least 32 characters")
done
[[ "${EMR_CREDENTIALS_ENCRYPTION_KEY:-}" =~ ^[a-fA-F0-9]{64}$ ]] || invalid+=("EMR_CREDENTIALS_ENCRYPTION_KEY must be a 64-character hexadecimal AES-256 key")
if [[ "${TIGERBEETLE_ENABLED:-}" != "true" ]]; then
  invalid+=("TIGERBEETLE_ENABLED must be true in production; disabling a configured financial control is not permitted")
fi
[[ "${TIGERBEETLE_ADDRESS:-}" =~ ^127\.0\.0\.1:[0-9]{1,5}$ ]] || invalid+=("TIGERBEETLE_ADDRESS must use the local mTLS tunnel at 127.0.0.1:<port>")
[[ "${TIGERBEETLE_TLS_REMOTE_ADDRESS:-}" =~ ^[^:[:space:]]+:[0-9]{1,5}$ && "${TIGERBEETLE_TLS_REMOTE_ADDRESS:-}" != 127.0.0.1:* ]] || invalid+=("TIGERBEETLE_TLS_REMOTE_ADDRESS must be a non-loopback host:port")
[[ "${TIGERBEETLE_TLS_SERVER_NAME:-}" =~ ^([[:alnum:]-]+\.)+[[:alpha:]]{2,}$ ]] || invalid+=("TIGERBEETLE_TLS_SERVER_NAME must be a DNS hostname for strict certificate validation")
[[ "${TIGERBEETLE_CLUSTER_ID:-}" =~ ^[1-9][0-9]*$ ]] || invalid+=("TIGERBEETLE_CLUSTER_ID must be a positive integer")
[[ -r "$tb_ca_path" ]] || invalid+=("TIGERBEETLE_CA_PATH (or packaged default) must reference readable mutual-TLS CA material")
[[ -r "$tb_client_cert_path" ]] || invalid+=("TIGERBEETLE_CLIENT_CERT_PATH (or packaged default) must reference a readable client certificate")
if [[ -n "${TIGERBEETLE_CLIENT_KEY_PATH:-}" && -n "${TIGERBEETLE_CLIENT_KEY_PEM:-}" ]]; then
  invalid+=("Configure exactly one TigerBeetle client-key source")
elif [[ -n "${TIGERBEETLE_CLIENT_KEY_PATH:-}" ]]; then
  [[ -r "${TIGERBEETLE_CLIENT_KEY_PATH}" ]] || invalid+=("TIGERBEETLE_CLIENT_KEY_PATH must reference a readable runtime-only key")
elif [[ -z "${TIGERBEETLE_CLIENT_KEY_PEM:-}" ]]; then
  missing+=("TIGERBEETLE_CLIENT_KEY_PEM or TIGERBEETLE_CLIENT_KEY_PATH")
fi
if [[ "${NODE_ENV:-}" != "production" ]]; then
  invalid+=("NODE_ENV must be production")
fi
if [[ "${ALLOW_INSECURE_INTERNAL_TRANSPORT:-false}" == "true" ]]; then
  invalid+=("ALLOW_INSECURE_INTERNAL_TRANSPORT must not be enabled in production")
fi
case "${PAYMENT_EXECUTION_MODE:-}" in
  disabled) ;;
  sandbox)
    [[ -n "${MOJALOOP_URL:-}" ]] || missing+=("MOJALOOP_URL")
    [[ "${MOJALOOP_URL:-}" =~ ^https:// ]] || invalid+=("MOJALOOP_URL must use HTTPS when payment execution is enabled")
    [[ "${MOJALOOP_URL:-}" != *"simulator"* ]] || invalid+=("MOJALOOP_URL must not point to a simulator when payment execution is enabled")
    ;;
  *) invalid+=("PAYMENT_EXECUTION_MODE must be disabled or sandbox; live initiation is not implemented") ;;
esac

# ── Phase 15 FB (B7): optional-middleware consistency assertions ────────────
# VAPID web-push keys are both-or-neither (a lone key is a misconfiguration
# that would silently dead-letter push delivery).
if [[ -n "${VAPID_PUBLIC_KEY:-}" && -z "${VAPID_PRIVATE_KEY:-}" ]] || [[ -z "${VAPID_PUBLIC_KEY:-}" && -n "${VAPID_PRIVATE_KEY:-}" ]]; then
  invalid+=("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured together (both-or-neither)")
fi
# PERMIFY_ENFORCE=true hard-gates dispute authz on Permify — it must be reachable.
if [[ "${PERMIFY_ENFORCE:-false}" == "true" ]]; then
  [[ -n "${PERMIFY_URL:-}" ]] || missing+=("PERMIFY_URL (required when PERMIFY_ENFORCE=true)")
fi
# Permify write mirror needs an endpoint too.
if [[ "${PERMIFY_WRITE_ENABLED:-false}" == "true" ]]; then
  [[ -n "${PERMIFY_URL:-}" ]] || missing+=("PERMIFY_URL (required when PERMIFY_WRITE_ENABLED=true)")
fi
# TB_LEDGER_ENABLED routes settlement holds/posts through the Go sidecar — it
# needs the sidecar address and the internal service token.
if [[ "${TB_LEDGER_ENABLED:-false}" == "true" ]]; then
  [[ -n "${GO_SERVICES_URL:-}" ]] || missing+=("GO_SERVICES_URL (required when TB_LEDGER_ENABLED=true)")
  [[ -n "${INTERNAL_SERVICE_TOKEN:-}" ]] || missing+=("INTERNAL_SERVICE_TOKEN (required when TB_LEDGER_ENABLED=true)")
fi
# Temporal durable-execution dispatch needs an address, namespace and CA.
if [[ "${TEMPORAL_EXECUTION_ENABLED:-false}" == "true" ]]; then
  [[ -n "${TEMPORAL_ADDRESS:-}" ]] || missing+=("TEMPORAL_ADDRESS (required when TEMPORAL_EXECUTION_ENABLED=true)")
  [[ -n "${TEMPORAL_NAMESPACE:-}" ]] || missing+=("TEMPORAL_NAMESPACE (required when TEMPORAL_EXECUTION_ENABLED=true)")
  [[ -n "${TEMPORAL_CA_PATH:-}" ]] || missing+=("TEMPORAL_CA_PATH (required when TEMPORAL_EXECUTION_ENABLED=true)")
fi

if ((${#missing[@]} || ${#invalid[@]})); then
  printf 'Production configuration validation failed.\n' >&2
  ((${#missing[@]})) && printf 'Missing: %s\n' "${missing[*]}" >&2
  ((${#invalid[@]})) && printf 'Invalid: %s\n' "${invalid[*]}" >&2
  exit 1
fi
printf '{"valid":true,"database":"postgresql","settlementMtls":true,"tigerbeetleMtls":true,"versionedCallbackKeyring":true,"encryptedBackups":true,"paymentExecutionMode":"%s"}\n' "$PAYMENT_EXECUTION_MODE"
