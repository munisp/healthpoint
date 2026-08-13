#!/usr/bin/env bash
set -euo pipefail

missing=()
invalid=()
required=(DATABASE_URL JWT_SECRET SETTLEMENT_CALLBACK_KEYRING SETTLEMENT_MTLS_CLIENT_CA_PEM SETTLEMENT_MTLS_CLIENT_FINGERPRINTS SETTLEMENT_MTLS_INGRESS_TOKEN BACKUP_ENCRYPTION_PASSPHRASE)
for key in "${required[@]}"; do
  [[ -n "${!key:-}" ]] || missing+=("$key")
done

if [[ -n "${DATABASE_URL:-}" && ! "$DATABASE_URL" =~ ^postgres(ql)?:// ]]; then
  invalid+=("DATABASE_URL must use the PostgreSQL URI scheme")
fi
if [[ "${ALLOW_LOCAL_DATABASE:-false}" != "true" && "${DATABASE_URL:-}" =~ @(localhost|127\.0\.0\.1|postgres): ]]; then
  invalid+=("DATABASE_URL must reference the managed production PostgreSQL endpoint, not a local or compose hostname")
fi
if [[ -n "${SETTLEMENT_CALLBACK_KEYRING:-}" ]] && ! node -e 'const value=JSON.parse(process.argv[1]); if (!value || Array.isArray(value) || !Object.values(value).every(v => typeof v === "string" && v.length >= 32)) process.exit(1)' "$SETTLEMENT_CALLBACK_KEYRING"; then
  invalid+=("SETTLEMENT_CALLBACK_KEYRING must be JSON with versioned 32+ character key values")
fi
for key in JWT_SECRET SETTLEMENT_MTLS_INGRESS_TOKEN BACKUP_ENCRYPTION_PASSPHRASE; do
  value="${!key:-}"
  [[ "${#value}" -ge 32 ]] || invalid+=("$key must contain at least 32 characters")
done

if ((${#missing[@]} || ${#invalid[@]})); then
  printf 'Production configuration validation failed.\n' >&2
  ((${#missing[@]})) && printf 'Missing: %s\n' "${missing[*]}" >&2
  ((${#invalid[@]})) && printf 'Invalid: %s\n' "${invalid[*]}" >&2
  exit 1
fi
printf '{"valid":true,"database":"postgresql","settlementMtls":true,"versionedCallbackKeyring":true,"encryptedBackups":true}\n'
