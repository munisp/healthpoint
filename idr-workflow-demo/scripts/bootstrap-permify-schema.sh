#!/usr/bin/env bash
set -Eeuo pipefail

PERMIFY_URL="${PERMIFY_URL:-http://127.0.0.1:13476}"
PERMIFY_TENANT="${PERMIFY_TENANT:-t1}"
PERMIFY_AUTH_TOKEN="${PERMIFY_AUTH_TOKEN:-local-integration-token}"
SCHEMA_FILE="${SCHEMA_FILE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/infra/permify/healthpoint-schema.perm}"

[[ -s "$SCHEMA_FILE" ]] || { echo "Schema file not found or empty: $SCHEMA_FILE" >&2; exit 2; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }

payload="$(jq -n --arg schema "$(cat "$SCHEMA_FILE")" '{schema:$schema}')"
response="$(curl --fail-with-body --silent --show-error \
  -X POST "$PERMIFY_URL/v1/tenants/$PERMIFY_TENANT/schemas/write" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $PERMIFY_AUTH_TOKEN" \
  --data "$payload")"
printf '%s\n' "$response" | jq .
