#!/usr/bin/env bash
# Staging-only Alertmanager synthetic-routing drill. This script validates
# notification routing only. It never calls Kubernetes, TigerBeetle, or payment APIs.
set -Eeuo pipefail

MODE="dry-run"
[[ "${1:-}" == "--execute" ]] && MODE="execute"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${HEALTHPOINT_STAGING_ALERT_ROUTING_DRILL:=}"
: "${HEALTHPOINT_STAGING_ENV:=}"
: "${PAYMENT_EXECUTION_MODE:=}"
: "${HEALTHPOINT_CHANGE_TICKET:=}"
: "${HEALTHPOINT_IMMUTABLE_SOURCE_SHA:=}"
: "${STAGING_ALERTMANAGER_URL:=}"
: "${STAGING_ALERTMANAGER_CA_PATH:=}"
: "${STAGING_ALERTMANAGER_CLIENT_CERT_PATH:=}"
: "${STAGING_ALERTMANAGER_CLIENT_KEY_PATH:=}"
: "${STAGING_ALERT_ROUTING_EVIDENCE_DIR:=$ROOT/../healthpoint/artifacts/staging-alertmanager-routing-drill}"
: "${STAGING_ALERT_ROUTING_TIMEOUT_SECONDS:=20}"

refuse() { echo "REFUSED: $*" >&2; exit 64; }
private_alertmanager_url() {
  local url="$1" host
  [[ "$url" =~ ^https://([^/:]+)(:[0-9]{1,5})?$ ]] || return 1
  host="${BASH_REMATCH[1]}"
  [[ "$host" =~ ^10\. || "$host" =~ ^192\.168\. || "$host" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. || "$host" =~ \.svc\.cluster\.local$ || "$host" =~ \.internal$ ]]
}
validate_common() {
  [[ "$HEALTHPOINT_STAGING_ENV" == "staging" ]] || refuse "HEALTHPOINT_STAGING_ENV must equal staging"
  [[ "$PAYMENT_EXECUTION_MODE" == "disabled" ]] || refuse "PAYMENT_EXECUTION_MODE must equal disabled"
  [[ "$HEALTHPOINT_CHANGE_TICKET" =~ ^[A-Z][A-Z0-9]{1,15}-[0-9]{1,12}$ ]] || refuse "HEALTHPOINT_CHANGE_TICKET must use a controlled ticket identifier"
  [[ "$HEALTHPOINT_IMMUTABLE_SOURCE_SHA" =~ ^[a-f0-9]{40}$ ]] || refuse "HEALTHPOINT_IMMUTABLE_SOURCE_SHA must be a full 40-character lowercase commit SHA"
  private_alertmanager_url "$STAGING_ALERTMANAGER_URL" || refuse "STAGING_ALERTMANAGER_URL must be a private, credential-free HTTPS endpoint without a path"
  [[ "$STAGING_ALERT_ROUTING_EVIDENCE_DIR" != *fixture* && "$STAGING_ALERT_ROUTING_EVIDENCE_DIR" != *mock* && "$STAGING_ALERT_ROUTING_EVIDENCE_DIR" != *synthetic* ]] || refuse "evidence directory must not be a fixture/mock/synthetic path"
  [[ "$STAGING_ALERT_ROUTING_TIMEOUT_SECONDS" =~ ^[0-9]+$ && "$STAGING_ALERT_ROUTING_TIMEOUT_SECONDS" -ge 5 && "$STAGING_ALERT_ROUTING_TIMEOUT_SECONDS" -le 60 ]] || refuse "STAGING_ALERT_ROUTING_TIMEOUT_SECONDS must be between 5 and 60"
}

if [[ "$MODE" == "dry-run" ]]; then
  cat <<'EOF'
DRY_RUN: this script would validate its protected staging context before sending synthetic Alertmanager API v2 alerts.
DRY_RUN: mandatory execute-time gates are: HEALTHPOINT_STAGING_ALERT_ROUTING_DRILL=yes, staging designation, disabled payments, change ticket, immutable source SHA, private HTTPS Alertmanager URL, and readable mTLS CA/certificate/key files.
DRY_RUN: execute mode would create one short-lived synthetic alert for each routing class: active-drill abort, critical clock no-go, and advisory clock risk.
DRY_RUN: execute mode deliberately pages/alerts the configured staging operators: abort and no-go use PagerDuty plus Slack; advisory uses Slack only. It does not create a Kubernetes partition or modify TigerBeetle.
DRY_RUN: execute mode would write the request SHA-256, API acknowledgement, query confirmation, and explicit resolved-alert acknowledgement to the protected evidence directory without storing credentials.
DRY_RUN: no Alertmanager, PagerDuty, Slack, Prometheus, Kubernetes, TigerBeetle, or payment endpoint will be contacted in dry-run mode.
EOF
  exit 0
fi

[[ "$HEALTHPOINT_STAGING_ALERT_ROUTING_DRILL" == "yes" ]] || refuse "--execute requires HEALTHPOINT_STAGING_ALERT_ROUTING_DRILL=yes"
validate_common
for path in "$STAGING_ALERTMANAGER_CA_PATH" "$STAGING_ALERTMANAGER_CLIENT_CERT_PATH" "$STAGING_ALERTMANAGER_CLIENT_KEY_PATH"; do
  [[ -f "$path" && -r "$path" ]] || refuse "required mTLS file is not readable"
done
command -v curl >/dev/null 2>&1 || refuse "curl is required"
command -v sha256sum >/dev/null 2>&1 || refuse "sha256sum is required"
command -v date >/dev/null 2>&1 || refuse "date is required"

umask 077
run_id="tb-alert-routing-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}${RANDOM}"
evidence_dir="$STAGING_ALERT_ROUTING_EVIDENCE_DIR/$run_id"
mkdir -p "$evidence_dir"
chmod 700 "$evidence_dir"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ends_at="$(date -u -d '+5 minutes' +%Y-%m-%dT%H:%M:%SZ)"
resolve_started_at="$(date -u -d '-2 minutes' +%Y-%m-%dT%H:%M:%SZ)"
resolved_at="$(date -u -d '-1 minute' +%Y-%m-%dT%H:%M:%SZ)"
base_labels="\"environment\":\"staging\",\"service\":\"tigerbeetle\",\"synthetic_alert_routing_test\":\"true\",\"drill_run_id\":\"$run_id\",\"change_ticket\":\"$HEALTHPOINT_CHANGE_TICKET\",\"source_sha\":\"$HEALTHPOINT_IMMUTABLE_SOURCE_SHA\",\"cluster\":\"staging\",\"namespace\":\"tigerbeetle-staging\",\"statefulset\":\"tigerbeetle\""

cat > "$evidence_dir/alerts-active.json" <<EOF
[
  {"labels":{"alertname":"HealthPointTigerBeetleSyntheticRoutingAbort",$base_labels,"severity":"critical","drill_abort":"true","timing_gate":"abort"},"annotations":{"runbook":"approved-staging-runbook","summary":"Synthetic routing validation only; no partition was created"},"startsAt":"$started_at","endsAt":"$ends_at"},
  {"labels":{"alertname":"HealthPointTigerBeetleSyntheticClockNoGo",$base_labels,"severity":"critical","timing_gate":"no_go","healthpoint_timing_role":"cni"},"annotations":{"runbook":"approved-staging-runbook","summary":"Synthetic routing validation only; no time source was modified"},"startsAt":"$started_at","endsAt":"$ends_at"},
  {"labels":{"alertname":"HealthPointTigerBeetleSyntheticClockAdvisory",$base_labels,"severity":"warning","timing_gate":"advisory","healthpoint_timing_role":"application"},"annotations":{"runbook":"approved-staging-runbook","summary":"Synthetic routing validation only; no time source was modified"},"startsAt":"$started_at","endsAt":"$ends_at"}
]
EOF

curl_mtls() {
  curl --fail --silent --show-error --tlsv1.2 --proto '=https' --connect-timeout "$STAGING_ALERT_ROUTING_TIMEOUT_SECONDS" --max-time "$STAGING_ALERT_ROUTING_TIMEOUT_SECONDS" \
    --cacert "$STAGING_ALERTMANAGER_CA_PATH" --cert "$STAGING_ALERTMANAGER_CLIENT_CERT_PATH" --key "$STAGING_ALERTMANAGER_CLIENT_KEY_PATH" "$@"
}

injected="false"
resolve_alerts() {
  [[ "$injected" == "true" ]] || return 0
  sed "s/\"startsAt\":\"$started_at\",\"endsAt\":\"$ends_at\"/\"startsAt\":\"$resolve_started_at\",\"endsAt\":\"$resolved_at\"/g" "$evidence_dir/alerts-active.json" > "$evidence_dir/alerts-resolved.json"
  curl_mtls --request POST --header 'Content-Type: application/json' --data-binary "@$evidence_dir/alerts-resolved.json" "$STAGING_ALERTMANAGER_URL/api/v2/alerts" > "$evidence_dir/resolve-response.json" || echo "RESOLUTION_ATTEMPT_FAILED: operator must resolve the exact synthetic run ID in Alertmanager" >&2
}
trap resolve_alerts EXIT INT TERM

sha256sum "$evidence_dir/alerts-active.json" > "$evidence_dir/alerts-active.sha256"
curl_mtls --request POST --header 'Content-Type: application/json' --data-binary "@$evidence_dir/alerts-active.json" "$STAGING_ALERTMANAGER_URL/api/v2/alerts" > "$evidence_dir/inject-response.json"
injected="true"

# Alertmanager acknowledgement proves receipt only. Notification receipts must be
# confirmed by the on-call operator in PagerDuty and the designated Slack channels.
curl_mtls --get --data-urlencode "filter=synthetic_alert_routing_test=\"true\"" --data-urlencode "filter=drill_run_id=\"$run_id\"" "$STAGING_ALERTMANAGER_URL/api/v2/alerts" > "$evidence_dir/alertmanager-query.json"
grep -Fq "$run_id" "$evidence_dir/alertmanager-query.json" || refuse "Alertmanager did not return the exact synthetic run ID after injection"

cat > "$evidence_dir/manifest.json" <<EOF
{"schema_version":"healthpoint.tigerbeetle.alert-routing-drill.v1","run_id":"$run_id","environment":"staging","change_ticket":"$HEALTHPOINT_CHANGE_TICKET","source_sha":"$HEALTHPOINT_IMMUTABLE_SOURCE_SHA","started_at":"$started_at","notification_side_effects":"expected: PagerDuty+Slack for critical abort/no-go; Slack only for advisory","payment_execution_mode":"disabled","kubernetes_action":"none","tigerbeetle_action":"none"}
EOF
sha256sum "$evidence_dir/alerts-active.json" "$evidence_dir/inject-response.json" "$evidence_dir/alertmanager-query.json" "$evidence_dir/manifest.json" > "$evidence_dir/sha256sums.txt"
echo "STAGING_ALERTMANAGER_ROUTING_DRILL_INJECTED: $run_id"
echo "OPERATOR_CONFIRMATION_REQUIRED: confirm one PagerDuty and one Slack receipt for synthetic abort/no-go, one Slack receipt and no PagerDuty for advisory, then retain redacted receipt references outside this script."
