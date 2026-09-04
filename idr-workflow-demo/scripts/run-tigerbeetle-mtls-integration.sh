#!/usr/bin/env bash
# Runs only a read-only mTLS TigerBeetle connectivity test against an approved
# staging cluster. No account, transfer, settlement, or recovery operation occurs.
set -euo pipefail

: "${HEALTHPOINT_TIGERBEETLE_TEST_ENV:=staging}"
: "${HEALTHPOINT_TIGERBEETLE_CHANGE_TICKET:=}"
: "${ARTIFACT_DIR:=artifacts/tigerbeetle-mtls-integration}"

refuse() { echo "REFUSED: $*" >&2; exit 64; }
[[ "$HEALTHPOINT_TIGERBEETLE_TEST_ENV" == "staging" ]] || refuse "HEALTHPOINT_TIGERBEETLE_TEST_ENV must equal staging"
[[ "$HEALTHPOINT_TIGERBEETLE_CHANGE_TICKET" =~ ^[A-Z][A-Z0-9]+-[0-9]+$ ]] || refuse "a staging change ticket such as CHG-1234 is required"
[[ "${PAYMENT_EXECUTION_MODE:-disabled}" != "enabled" ]] || refuse "PAYMENT_EXECUTION_MODE must not be enabled for the mTLS read-only test"
[[ "${HEALTHPOINT_RUN_TIGERBEETLE_MTLS_INTEGRATION:-}" == "true" ]] || refuse "set HEALTHPOINT_RUN_TIGERBEETLE_MTLS_INTEGRATION=true explicitly"

for variable in \
  TIGERBEETLE_ADDRESS \
  TIGERBEETLE_TLS_REMOTE_ADDRESS \
  TIGERBEETLE_TLS_SERVER_NAME \
  TIGERBEETLE_CLUSTER_ID \
  TIGERBEETLE_CA_PATH \
  TIGERBEETLE_CLIENT_CERT_PATH; do
  [[ -n "${!variable:-}" ]] || refuse "$variable is required"
done
[[ -n "${TIGERBEETLE_CLIENT_KEY_PATH:-}" || -n "${TIGERBEETLE_CLIENT_KEY_PEM:-}" ]] || refuse "configure exactly one TigerBeetle client key source"
[[ -z "${TIGERBEETLE_CLIENT_KEY_PATH:-}" || -z "${TIGERBEETLE_CLIENT_KEY_PEM:-}" ]] || refuse "configure exactly one TigerBeetle client key source"

mkdir -p "$ARTIFACT_DIR"
log="$ARTIFACT_DIR/mtls-readonly-$(date -u +%Y%m%dT%H%M%SZ).log"
echo "environment=staging ticket=$HEALTHPOINT_TIGERBEETLE_CHANGE_TICKET scope=read_only_mtls_probe" | tee "$log"
NODE_ENV=test PAYMENT_EXECUTION_MODE=disabled \
  pnpm vitest run server/tigerbeetle-mtls.integration.test.ts --reporter=verbose 2>&1 | tee -a "$log"
echo "MTLS_READONLY_INTEGRATION_COMPLETED: review redacted tunnel/certificate/cluster monitoring evidence before any readiness credit." | tee -a "$log"
