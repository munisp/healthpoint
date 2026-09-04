#!/usr/bin/env bash
set -euo pipefail

"$(dirname "$0")/validate-production-config.sh"

missing=()
invalid=()
required=(
  RELEASE_APPROVAL_ID
  POSTGRESQL_TLS_CA_SHA256
  PROVIDER_FSP_SANDBOX_ATTESTATION
  PROVIDER_MTLS_CERTIFICATE_FINGERPRINT
  SETTLEMENT_REPORT_CONTRACT_REFERENCE
  SCHEDULER_EXECUTION_EVIDENCE
  DOCKER_IMAGE_DIGEST
)
for key in "${required[@]}"; do
  [[ -n "${!key:-}" ]] || missing+=("$key")
done

[[ "${POSTGRESQL_TLS_CA_SHA256:-}" =~ ^[a-fA-F0-9]{64}$ ]] || invalid+=("POSTGRESQL_TLS_CA_SHA256 must be a SHA-256 certificate fingerprint")
[[ "${PROVIDER_MTLS_CERTIFICATE_FINGERPRINT:-}" =~ ^sha256:[a-fA-F0-9]{64}$ ]] || invalid+=("PROVIDER_MTLS_CERTIFICATE_FINGERPRINT must be sha256:<64 hex>")
[[ "${DOCKER_IMAGE_DIGEST:-}" =~ ^sha256:[a-fA-F0-9]{64}$ ]] || invalid+=("DOCKER_IMAGE_DIGEST must be sha256:<64 hex>")
for key in RELEASE_APPROVAL_ID PROVIDER_FSP_SANDBOX_ATTESTATION SETTLEMENT_REPORT_CONTRACT_REFERENCE SCHEDULER_EXECUTION_EVIDENCE; do
  value="${!key:-}"
  [[ "$value" =~ ^(example|placeholder|test|todo|tbd)$ ]] && invalid+=("$key cannot be a placeholder")
done

if ((${#missing[@]} || ${#invalid[@]})); then
  printf 'Deployment evidence validation failed.\n' >&2
  ((${#missing[@]})) && printf 'Missing: %s\n' "${missing[*]}" >&2
  ((${#invalid[@]})) && printf 'Invalid: %s\n' "${invalid[*]}" >&2
  exit 1
fi

printf '{"valid":true,"releaseEvidence":true,"providerMtls":true,"providerReportContract":true,"schedulerEvidence":true}\n'
