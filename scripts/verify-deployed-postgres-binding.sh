#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOYED_BASE_URL:?Set DEPLOYED_BASE_URL to the published HealthPoint HTTPS origin}"

base_url="${DEPLOYED_BASE_URL%/}"
health_json="$(curl --fail --silent --show-error --max-time 20 "${base_url}/api/health")"

if ! grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' <<<"${health_json}"; then
  echo "Deployment health check did not report ok=true" >&2
  exit 1
fi

if ! grep -Eq '"db"[[:space:]]*:[[:space:]]*"connected"' <<<"${health_json}"; then
  echo "Deployment is healthy but is not reporting a connected PostgreSQL database" >&2
  exit 1
fi

echo "DEPLOYED_POSTGRES_BINDING_VERIFIED base_url=${base_url}"
