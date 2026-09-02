#!/usr/bin/env bash
set -Eeuo pipefail

MODE="${1:---dry-run}"
if [[ "$MODE" != "--dry-run" && "$MODE" != "--execute" ]]; then
  echo "Usage: $0 [--dry-run|--execute]" >&2
  exit 64
fi
: "${HEALTHPOINT_ENVIRONMENT:?Set HEALTHPOINT_ENVIRONMENT=staging}"
: "${KUBECONFIG:?Set KUBECONFIG to the staging administrator configuration}"
: "${CHANGE_TICKET:?Set approved CHANGE_TICKET before running the exercise}"
NAMESPACE="${OTEL_NAMESPACE:-healthpoint-observability-staging}"
STATEFULSET="${OTEL_COLLECTOR_STATEFULSET:-otel-collector}"
PROMETHEUS_SERVICE="${PROMETHEUS_SERVICE:-prometheus}"
ARTIFACT_DIR="${ARTIFACT_DIR:-/secure/staging/evidence/collector-outage-$(date -u +%Y%m%dT%H%M%SZ)}"

if [[ "$HEALTHPOINT_ENVIRONMENT" != "staging" || "$NAMESPACE" != *staging* ]]; then
  echo "[collector-outage] result=blocked reason=staging_environment_and_namespace_required" >&2
  exit 2
fi
if [[ "$CHANGE_TICKET" =~ ^(TODO|test|example|none)$ ]]; then
  echo "[collector-outage] result=blocked reason=approved_change_ticket_required" >&2
  exit 2
fi
if [[ "$MODE" == "--execute" && "${I_ACKNOWLEDGE_STAGING_OBSERVABILITY_OUTAGE:-}" != "true" ]]; then
  echo "[collector-outage] result=blocked reason=explicit_outage_acknowledgement_required" >&2
  exit 2
fi

context="$(kubectl config current-context)"
if [[ "$context" != *staging* || "$context" == *prod* || "$context" == *production* ]]; then
  echo "[collector-outage] result=blocked reason=staging_kube_context_required" >&2
  exit 2
fi

if [[ "$MODE" == "--dry-run" ]]; then
  cat <<EOF
[collector-outage] result=dry-run environment=$HEALTHPOINT_ENVIRONMENT context=$context namespace=$NAMESPACE ticket=$CHANGE_TICKET
[collector-outage] would_capture=baseline_kubernetes_state,prometheus_targets,collector_alert_lifecycle
[collector-outage] would_scale=statefulset/$STATEFULSET replicas=0
[collector-outage] would_wait_seconds=330
[collector-outage] would_restore=statefulset/$STATEFULSET replicas=2
[collector-outage] result=dry-run-complete
EOF
  exit 0
fi

mkdir -p "$ARTIFACT_DIR"
restored=false
prometheus_pf=""
restore() {
  if [[ "$restored" != true ]]; then
    kubectl -n "$NAMESPACE" scale statefulset/"$STATEFULSET" --replicas=2 >/dev/null 2>&1 || true
    restored=true
  fi
  [[ -n "$prometheus_pf" ]] && kill "$prometheus_pf" >/dev/null 2>&1 || true
}
trap restore EXIT INT TERM

query() {
  local name="$1"
  local expression="$2"
  curl --fail --silent --show-error --get http://127.0.0.1:19090/api/v1/query \
    --data-urlencode "query=$expression" | jq . > "$ARTIFACT_DIR/$name.json"
}

echo "[collector-outage] result=starting ticket=$CHANGE_TICKET artifact_dir=$ARTIFACT_DIR"
kubectl -n "$NAMESPACE" get statefulset "$STATEFULSET" -o wide > "$ARTIFACT_DIR/collector-statefulset-before.txt"
kubectl -n "$NAMESPACE" get pvc -l app.kubernetes.io/name=otel-collector -o wide > "$ARTIFACT_DIR/collector-pvcs-before.txt"
kubectl -n "$NAMESPACE" port-forward svc/"$PROMETHEUS_SERVICE" 19090:9090 > "$ARTIFACT_DIR/prometheus-port-forward.log" 2>&1 &
prometheus_pf=$!
sleep 3
query collector-up-before 'up{job="otel-collector"}'
query collector-alert-before 'ALERTS{alertname="HealthPointOtelCollectorUnavailable"}'
date -u +%FT%TZ > "$ARTIFACT_DIR/outage-start-utc.txt"
kubectl -n "$NAMESPACE" scale statefulset/"$STATEFULSET" --replicas=0
sleep 330
query collector-up-during 'up{job="otel-collector"}'
query collector-alert-firing 'ALERTS{alertname="HealthPointOtelCollectorUnavailable",alertstate="firing"}'
if [[ "$(jq '.data.result | length' "$ARTIFACT_DIR/collector-alert-firing.json")" == "0" ]]; then
  echo "[collector-outage] result=failed reason=collector_unavailable_alert_did_not_fire" >&2
  exit 1
fi
date -u +%FT%TZ > "$ARTIFACT_DIR/outage-restore-start-utc.txt"
kubectl -n "$NAMESPACE" scale statefulset/"$STATEFULSET" --replicas=2
restored=true
kubectl -n "$NAMESPACE" rollout status statefulset/"$STATEFULSET" --timeout=10m > "$ARTIFACT_DIR/collector-rollout-recovery.log"
query collector-up-after 'up{job="otel-collector"}'
query collector-alert-after 'ALERTS{alertname="HealthPointOtelCollectorUnavailable"}'
date -u +%FT%TZ > "$ARTIFACT_DIR/outage-end-utc.txt"
echo "[collector-outage] result=passed ticket=$CHANGE_TICKET artifact_dir=$ARTIFACT_DIR"
