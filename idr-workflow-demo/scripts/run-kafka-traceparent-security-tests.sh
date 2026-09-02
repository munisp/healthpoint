#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${NODE_ENV:-test}" == "production" || "${HEALTHPOINT_ENVIRONMENT:-}" == "production" ]]; then
  echo "[kafka-traceparent-security] result=blocked reason=production_execution_prohibited" >&2
  exit 2
fi
unset KAFKA_BROKERS KAFKA_SASL_USERNAME KAFKA_SASL_PASSWORD KAFKA_SSL_CA_PATH KAFKA_SSL_CA_PEM KAFKA_TRACE_CONTEXT_TRUSTED
export NODE_ENV=test
export TEST_INFRA_FALLBACK_ENABLED=false
export PAYMENT_EXECUTION_MODE=disabled

cd "$(dirname "$0")/.."
echo "[kafka-traceparent-security] suite=server/events/kafka-consumer-traceparent.test.ts"
pnpm exec vitest run server/events/kafka-consumer-traceparent.test.ts
printf '%s\n' "[kafka-traceparent-security] result=passed cases=4 broker_connection=not_attempted"
