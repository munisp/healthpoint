#!/usr/bin/env bash
set -Eeuo pipefail

component="${1:-all}"
case "$component" in kafka|dapr|temporal|all) ;; *) echo "Usage: $0 [kafka|dapr|temporal|all]" >&2; exit 64 ;; esac

if [[ "${NODE_ENV:-}" != "integration" ]]; then
  echo "[otel-harness] result=blocked reason=NODE_ENV_must_equal_integration" >&2
  exit 2
fi
if [[ "${EVIDENCE_EXECUTION:-}" == "protected" ]]; then
  echo "[otel-harness] result=blocked reason=protected_release_mode_is_not_a_test_harness" >&2
  exit 2
fi
if [[ "${PAYMENT_EXECUTION_MODE:-disabled}" != "disabled" ]]; then
  echo "[otel-harness] result=blocked reason=payment_execution_must_be_disabled" >&2
  exit 2
fi
if [[ "${OTEL_HARNESS_ENABLED:-}" != "true" || "${OTEL_ENABLED:-}" != "true" ]]; then
  echo "[otel-harness] result=blocked reason=explicit_otel_harness_enablement_required" >&2
  exit 2
fi

run_vitest() {
  local file="$1"
  echo "[otel-harness] component=$2 phase=vitest result=starting"
  pnpm vitest run "$file"
  echo "[otel-harness] component=$2 phase=vitest result=passed"
}

if [[ "$component" == "kafka" || "$component" == "all" ]]; then
  run_vitest server/kafka-otel-harness.test.ts kafka
fi

if [[ "$component" == "temporal" || "$component" == "all" ]]; then
  run_vitest server/temporal-otel-harness.test.ts temporal
fi

if [[ "$component" == "dapr" || "$component" == "all" ]]; then
  : "${DAPR_HARNESS_ENABLED:?DAPR_HARNESS_ENABLED=true is required for Dapr}"
  : "${DAPR_HTTP_ENDPOINT:?DAPR_HTTP_ENDPOINT must be the local sidecar endpoint}"
  : "${DAPR_APP_ID:?DAPR_APP_ID is required}"
  : "${DAPR_HEALTH_PATH:=healthz}"
  if [[ "$DAPR_HTTP_ENDPOINT" != http://127.0.0.1:* && "$DAPR_HTTP_ENDPOINT" != http://localhost:* ]]; then
    echo "[otel-harness] component=dapr result=blocked reason=local_sidecar_endpoint_required" >&2
    exit 2
  fi
  echo "[otel-harness] component=dapr phase=sidecar_health result=starting"
  curl --fail --silent --show-error --max-time 10 "$DAPR_HTTP_ENDPOINT/v1.0/healthz" >/dev/null
  echo "[otel-harness] component=dapr phase=sidecar_health result=passed"
  echo "[otel-harness] component=dapr phase=service_invocation result=starting"
  curl --fail --silent --show-error --max-time 10 \
    "$DAPR_HTTP_ENDPOINT/v1.0/invoke/$DAPR_APP_ID/method/$DAPR_HEALTH_PATH" >/dev/null
  echo "[otel-harness] component=dapr phase=service_invocation result=passed"
fi

echo "[otel-harness] result=passed scope=non_production_integration"
