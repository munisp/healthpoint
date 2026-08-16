#!/usr/bin/env bash
set -euo pipefail

: "${SETTLEMENT_PROVIDER_SANDBOX_URL:?Provider sandbox HTTPS URL is required}"
: "${SETTLEMENT_MTLS_CLIENT_CERT_PATH:?Provider client certificate path is required}"
: "${SETTLEMENT_MTLS_CA_PATH:?Provider CA bundle path is required}"
: "${SETTLEMENT_MTLS_CLIENT_KEY_PEM:?Provider client private key PEM secret is required}"

if [[ "${PAYMENT_EXECUTION_MODE:-disabled}" != "disabled" ]]; then
  echo "Provider sandbox validation requires PAYMENT_EXECUTION_MODE=disabled" >&2
  exit 1
fi

if [[ ! "${SETTLEMENT_PROVIDER_SANDBOX_URL}" =~ ^https:// ]]; then
  echo "Provider sandbox URL must use HTTPS" >&2
  exit 1
fi

if [[ ! -r "${SETTLEMENT_MTLS_CLIENT_CERT_PATH}" || ! -r "${SETTLEMENT_MTLS_CA_PATH}" ]]; then
  echo "Provider certificate or CA bundle is unavailable" >&2
  exit 1
fi

umask 077
key_file="$(mktemp)"
trap 'rm -f "${key_file}"' EXIT
printf '%s\n' "${SETTLEMENT_MTLS_CLIENT_KEY_PEM}" > "${key_file}"

openssl x509 -in "${SETTLEMENT_MTLS_CLIENT_CERT_PATH}" -noout -checkend 0 >/dev/null
openssl verify -CAfile "${SETTLEMENT_MTLS_CA_PATH}" "${SETTLEMENT_MTLS_CLIENT_CERT_PATH}" >/dev/null

cert_public_key="$(openssl x509 -in "${SETTLEMENT_MTLS_CLIENT_CERT_PATH}" -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256)"
key_public_key="$(openssl pkey -in "${key_file}" -pubout -outform der | openssl dgst -sha256)"
if [[ "${cert_public_key}" != "${key_public_key}" ]]; then
  echo "Provider client certificate does not match the supplied private key" >&2
  exit 1
fi

echo "PROVIDER_SANDBOX_MTLS_MATERIAL_VALID"
