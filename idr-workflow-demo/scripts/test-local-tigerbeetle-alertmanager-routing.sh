#!/usr/bin/env bash
# Local-only Alertmanager routing harness. Default is dry-run. Execute mode
# sends synthetic non-financial alerts only to a loopback capture server.
set -euo pipefail

MODE="dry-run"
[[ "${1:-}" == "--execute" ]] && MODE="execute"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${HEALTHPOINT_LOCAL_ALERTMANAGER_TEST:=}"
: "${HEALTHPOINT_ALLOW_LOCAL_CONTAINER_PULL:=}"
: "${ALERTMANAGER_IMAGE:=prom/alertmanager@sha256:27c475db5fb156cab31d5c18a4251ac7ed567746a2483ff264516437a39b15ba}"
: "${LOCAL_ALERTMANAGER_PORT:=19093}"
: "${LOCAL_ALERT_CAPTURE_PORT:=19094}"
: "${LOCAL_ALERTMANAGER_ARTIFACT_DIR:=$ROOT/../healthpoint/artifacts/local-alertmanager-routing-test}"
: "${LOCAL_ALERTMANAGER_TIMEOUT_SECONDS:=30}"

refuse() { echo "REFUSED: $*" >&2; exit 64; }
[[ "$ALERTMANAGER_IMAGE" =~ @sha256:[a-f0-9]{64}$ ]] || refuse "ALERTMANAGER_IMAGE must be digest-pinned"
[[ "$LOCAL_ALERTMANAGER_PORT" =~ ^[0-9]+$ && "$LOCAL_ALERT_CAPTURE_PORT" =~ ^[0-9]+$ ]] || refuse "local ports must be numeric"
[[ "$LOCAL_ALERTMANAGER_PORT" != "$LOCAL_ALERT_CAPTURE_PORT" ]] || refuse "Alertmanager and capture ports must differ"

if [[ "$MODE" == "dry-run" ]]; then
  cat <<EOF
DRY_RUN: would validate the TigerBeetle Alertmanager routing fragment with an official digest-pinned local Alertmanager image.
DRY_RUN: would render a temporary config with only 127.0.0.1 capture receiver URLs and dummy local test credentials.
DRY_RUN: would use a network-disabled container for amtool config validation, then a loopback-bound Alertmanager for a synthetic routing test.
DRY_RUN: would inject five synthetic staging drill-abort alerts, one synthetic critical clock no-go alert, and one synthetic advisory clock alert.
DRY_RUN: would assert 5 abort PagerDuty + 5 abort Slack captures, 1 no-go PagerDuty + 1 no-go Slack capture, and 1 advisory Slack-only capture.
DRY_RUN: no PagerDuty, Slack, Prometheus, Kubernetes, TigerBeetle, secret store, or staging endpoint would be contacted.
EOF
  exit 0
fi

[[ "$HEALTHPOINT_LOCAL_ALERTMANAGER_TEST" == "yes" ]] || refuse "--execute requires HEALTHPOINT_LOCAL_ALERTMANAGER_TEST=yes"
command -v docker >/dev/null 2>&1 || refuse "Docker is required for --execute"
command -v curl >/dev/null 2>&1 || refuse "curl is required for --execute"
command -v python3 >/dev/null 2>&1 || refuse "python3 is required for --execute"
docker info >/dev/null 2>&1 || refuse "Docker daemon is unavailable"
[[ "$(uname -s)" == "Linux" ]] || refuse "--execute requires Linux host networking so local receivers remain loopback-only"

if ! docker image inspect "$ALERTMANAGER_IMAGE" >/dev/null 2>&1; then
  [[ "$HEALTHPOINT_ALLOW_LOCAL_CONTAINER_PULL" == "yes" ]] || refuse "digest-pinned Alertmanager image is not local; set HEALTHPOINT_ALLOW_LOCAL_CONTAINER_PULL=yes to pull it explicitly"
  docker pull "$ALERTMANAGER_IMAGE"
fi

workdir="$(mktemp -d)"
container_name="healthpoint-local-alertmanager-routing-$RANDOM-$RANDOM"
capture_pid=""
cleanup() {
  set +e
  [[ -n "$capture_pid" ]] && kill "$capture_pid" 2>/dev/null || true
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  mkdir -p "$LOCAL_ALERTMANAGER_ARTIFACT_DIR"
  [[ -f "$workdir/capture.jsonl" ]] && cp "$workdir/capture.jsonl" "$LOCAL_ALERTMANAGER_ARTIFACT_DIR/capture.jsonl" || true
  [[ -f "$workdir/alertmanager.log" ]] && cp "$workdir/alertmanager.log" "$LOCAL_ALERTMANAGER_ARTIFACT_DIR/alertmanager.log" || true
  [[ -f "$workdir/alertmanager.yml" ]] && cp "$workdir/alertmanager.yml" "$LOCAL_ALERTMANAGER_ARTIFACT_DIR/local-test-alertmanager.yml" || true
  rm -rf "$workdir"
}
trap cleanup EXIT INT TERM

python3 "$ROOT/scripts/render-local-tigerbeetle-alertmanager-test-config.py" \
  --fragment "$ROOT/infrastructure/tigerbeetle-staging/k8s/alertmanager-tigerbeetle-drill-routing.fragment.yaml.template" \
  --output "$workdir/alertmanager.yml" \
  --capture-port "$LOCAL_ALERT_CAPTURE_PORT"
# The rendered config contains only loopback endpoints and a dummy local key.
# It must be readable by the non-root Alertmanager test container.
chmod 755 "$workdir"
chmod 644 "$workdir/alertmanager.yml"

# This check runs with networking disabled and validates the fully rendered
# local config before any local listener is started.
docker run --rm --network none --read-only --tmpfs /alertmanager:rw,noexec,nosuid,size=16m \
  --entrypoint amtool \
  -v "$workdir/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro" \
  "$ALERTMANAGER_IMAGE" check-config /etc/alertmanager/alertmanager.yml

python3 "$ROOT/scripts/local-alertmanager-capture-server.py" \
  --port "$LOCAL_ALERT_CAPTURE_PORT" \
  --output "$workdir/capture.jsonl" \
  --ready-file "$workdir/capture.ready" &
capture_pid="$!"
for _ in $(seq 1 50); do [[ -f "$workdir/capture.ready" ]] && break; sleep 0.1; done
[[ -f "$workdir/capture.ready" ]] || { cat "$workdir/capture.jsonl" 2>/dev/null || true; refuse "local capture server did not start"; }

# Host networking is used only so this container can reach the loopback-only
# capture server. The rendered config contains no other notification endpoint.
docker run --rm --name "$container_name" --network host --read-only \
  --user 65534:65534 --cap-drop ALL --security-opt no-new-privileges:true \
  --tmpfs /alertmanager:rw,noexec,nosuid,size=16m \
  -v "$workdir/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro" \
  "$ALERTMANAGER_IMAGE" \
  --config.file=/etc/alertmanager/alertmanager.yml \
  --storage.path=/alertmanager \
  --web.listen-address="127.0.0.1:${LOCAL_ALERTMANAGER_PORT}" \
  >"$workdir/alertmanager.log" 2>&1 &

for _ in $(seq 1 100); do curl --fail --silent "http://127.0.0.1:${LOCAL_ALERTMANAGER_PORT}/-/ready" >/dev/null 2>&1 && break; sleep 0.1; done
curl --fail --silent "http://127.0.0.1:${LOCAL_ALERTMANAGER_PORT}/-/ready" >/dev/null || { cat "$workdir/alertmanager.log"; refuse "local Alertmanager did not become ready"; }

payload="$workdir/alerts.json"
cat > "$payload" <<'JSON'
[
  {"labels":{"alertname":"HealthPointTigerBeetleNonTargetReplicaReadinessLoss","environment":"staging","service":"tigerbeetle","severity":"critical","drill_abort":"true","cluster":"local-routing-test","namespace":"local-test","statefulset":"tigerbeetle"},"annotations":{"runbook":"http://localhost/local-alert-routing-test"}},
  {"labels":{"alertname":"HealthPointTigerBeetleReadProbeFailure","environment":"staging","service":"tigerbeetle","severity":"critical","drill_abort":"true","cluster":"local-routing-test","namespace":"local-test","statefulset":"tigerbeetle"},"annotations":{"runbook":"http://localhost/local-alert-routing-test"}},
  {"labels":{"alertname":"HealthPointTigerBeetleReadProbeLatencyHigh","environment":"staging","service":"tigerbeetle","severity":"critical","drill_abort":"true","cluster":"local-routing-test","namespace":"local-test","statefulset":"tigerbeetle"},"annotations":{"runbook":"http://localhost/local-alert-routing-test"}},
  {"labels":{"alertname":"HealthPointTigerBeetleExporterUnavailable","environment":"staging","service":"tigerbeetle","severity":"critical","drill_abort":"true","cluster":"local-routing-test","namespace":"local-test","statefulset":"tigerbeetle"},"annotations":{"runbook":"http://localhost/local-alert-routing-test"}},
  {"labels":{"alertname":"HealthPointTigerBeetlePartitionCleanupFailed","environment":"staging","service":"tigerbeetle","severity":"critical","drill_abort":"true","cluster":"local-routing-test","namespace":"local-test","statefulset":"tigerbeetle"},"annotations":{"runbook":"http://localhost/local-alert-routing-test"}},
  {"labels":{"alertname":"HealthPointTigerBeetleChronyUnavailable","environment":"staging","service":"tigerbeetle","severity":"critical","timing_gate":"no_go","healthpoint_timing_role":"cni","cluster":"local-routing-test","namespace":"local-test","statefulset":"tigerbeetle"},"annotations":{"runbook":"http://localhost/local-alert-routing-test"}},
  {"labels":{"alertname":"HealthPointTigerBeetleClockAccuracyPrecheckRisk","environment":"staging","service":"tigerbeetle","severity":"warning","timing_gate":"advisory","healthpoint_timing_role":"application","cluster":"local-routing-test","namespace":"local-test","statefulset":"tigerbeetle"},"annotations":{"runbook":"http://localhost/local-alert-routing-test"}}
]
JSON
curl --fail --silent --show-error --request POST \
  --header 'Content-Type: application/json' \
  --data-binary "@$payload" \
  "http://127.0.0.1:${LOCAL_ALERTMANAGER_PORT}/api/v2/alerts" >/dev/null

expected_abort=5
expected_no_go=1
expected_warning=1
for _ in $(seq 1 "$LOCAL_ALERTMANAGER_TIMEOUT_SECONDS"); do
  abort_pagerduty_count=$(grep -c '"path":"/pagerduty-abort"' "$workdir/capture.jsonl" 2>/dev/null || true)
  abort_slack_count=$(grep -c '"path":"/slack-abort"' "$workdir/capture.jsonl" 2>/dev/null || true)
  no_go_pagerduty_count=$(grep -c '"path":"/pagerduty-no-go"' "$workdir/capture.jsonl" 2>/dev/null || true)
  no_go_slack_count=$(grep -c '"path":"/slack-no-go"' "$workdir/capture.jsonl" 2>/dev/null || true)
  warning_slack_count=$(grep -c '"path":"/slack-warning"' "$workdir/capture.jsonl" 2>/dev/null || true)
  [[ "$abort_pagerduty_count" -eq "$expected_abort" && "$abort_slack_count" -eq "$expected_abort" && "$no_go_pagerduty_count" -eq "$expected_no_go" && "$no_go_slack_count" -eq "$expected_no_go" && "$warning_slack_count" -eq "$expected_warning" ]] && break
  sleep 1
done
abort_pagerduty_count=$(grep -c '"path":"/pagerduty-abort"' "$workdir/capture.jsonl" 2>/dev/null || true)
abort_slack_count=$(grep -c '"path":"/slack-abort"' "$workdir/capture.jsonl" 2>/dev/null || true)
no_go_pagerduty_count=$(grep -c '"path":"/pagerduty-no-go"' "$workdir/capture.jsonl" 2>/dev/null || true)
no_go_slack_count=$(grep -c '"path":"/slack-no-go"' "$workdir/capture.jsonl" 2>/dev/null || true)
warning_slack_count=$(grep -c '"path":"/slack-warning"' "$workdir/capture.jsonl" 2>/dev/null || true)
[[ "$abort_pagerduty_count" -eq "$expected_abort" ]] || { cat "$workdir/alertmanager.log"; refuse "expected $expected_abort local abort PagerDuty notifications, got $abort_pagerduty_count"; }
[[ "$abort_slack_count" -eq "$expected_abort" ]] || { cat "$workdir/alertmanager.log"; refuse "expected $expected_abort local abort Slack notifications, got $abort_slack_count"; }
[[ "$no_go_pagerduty_count" -eq "$expected_no_go" ]] || { cat "$workdir/alertmanager.log"; refuse "expected $expected_no_go local no-go PagerDuty notification, got $no_go_pagerduty_count"; }
[[ "$no_go_slack_count" -eq "$expected_no_go" ]] || { cat "$workdir/alertmanager.log"; refuse "expected $expected_no_go local no-go Slack notification, got $no_go_slack_count"; }
[[ "$warning_slack_count" -eq "$expected_warning" ]] || { cat "$workdir/alertmanager.log"; refuse "expected $expected_warning local advisory Slack notification, got $warning_slack_count"; }

echo "LOCAL_ALERTMANAGER_ROUTING_TEST_PASSED: 5 synthetic abort alerts, 1 critical clock no-go alert, and 1 advisory clock alert followed the distinct loopback-only PagerDuty/Slack routes. No real receiver was contacted."
