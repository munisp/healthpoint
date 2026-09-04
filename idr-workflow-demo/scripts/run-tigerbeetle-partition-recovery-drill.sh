#!/usr/bin/env bash
# Staging-only, read-only client validation during a temporary single-replica
# network partition. This is not a quorum-loss, permanent-data-loss, or
# financial-finality test. Default is dry-run.
set -euo pipefail

MODE="dry-run"
if [[ "${1:-}" == "--execute" ]]; then MODE="execute"; fi
: "${HEALTHPOINT_TIGERBEETLE_DRILL_ENV:=staging}"
: "${HEALTHPOINT_TIGERBEETLE_CHANGE_TICKET:=}"
: "${KUBECTL_CONTEXT:=}"
: "${TIGERBEETLE_NAMESPACE:=healthpoint-staging}"
: "${TIGERBEETLE_STATEFULSET:=tigerbeetle}"
: "${TIGERBEETLE_REPLICA_TO_ISOLATE:=2}"
: "${TIGERBEETLE_CLIENT_JOB:=tigerbeetle-readiness}"
: "${PARTITION_NETWORK_POLICY:=tigerbeetle-drill-isolate-replica}"
: "${ARTIFACT_DIR:=artifacts/tigerbeetle-partition-recovery}"

refuse() { echo "REFUSED: $*" >&2; exit 64; }
[[ "$HEALTHPOINT_TIGERBEETLE_DRILL_ENV" == "staging" ]] || refuse "HEALTHPOINT_TIGERBEETLE_DRILL_ENV must equal staging"
[[ "$KUBECTL_CONTEXT" =~ stag ]] || refuse "KUBECTL_CONTEXT must identify an approved staging cluster"
[[ "$TIGERBEETLE_REPLICA_TO_ISOLATE" =~ ^[0-9]+$ ]] || refuse "TIGERBEETLE_REPLICA_TO_ISOLATE must be a numeric ordinal"
[[ "$MODE" != "execute" || "$HEALTHPOINT_TIGERBEETLE_CHANGE_TICKET" =~ ^[A-Z][A-Z0-9]+-[0-9]+$ ]] || refuse "--execute requires a change ticket such as CHG-1234"
[[ "$MODE" != "execute" || "${HEALTHPOINT_APPROVE_TIGERBEETLE_PARTITION_DRILL:-}" == "yes" ]] || refuse "--execute requires HEALTHPOINT_APPROVE_TIGERBEETLE_PARTITION_DRILL=yes"

mkdir -p "$ARTIFACT_DIR"
log="$ARTIFACT_DIR/run-$(date -u +%Y%m%dT%H%M%SZ).log"
exec > >(tee "$log") 2>&1
pod="${TIGERBEETLE_STATEFULSET}-${TIGERBEETLE_REPLICA_TO_ISOLATE}"
created_policy=false
cleanup() {
  if [[ "$created_policy" == true ]]; then
    kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" delete networkpolicy "$PARTITION_NETWORK_POLICY" --ignore-not-found=true || true
    echo "cleanup_network_policy=attempted"
  fi
}
trap cleanup EXIT INT TERM

echo "mode=$MODE environment=staging ticket=${HEALTHPOINT_TIGERBEETLE_CHANGE_TICKET:-none}"
echo "scope=one-replica-temporary-network-isolation; read-only-client-checks; no account-or-transfer-creation"
echo "target_pod=$pod namespace=$TIGERBEETLE_NAMESPACE policy=$PARTITION_NETWORK_POLICY"

if [[ "$MODE" == "dry-run" ]]; then
  cat <<EOF
DRY_RUN: would require six ready TigerBeetle pods and a completed read-only readiness job.
DRY_RUN: would apply a temporary NetworkPolicy that selects only $pod and denies ingress/egress.
DRY_RUN: would observe bounded replica/client metrics during the approved interval.
DRY_RUN: would delete the temporary NetworkPolicy in a trap and wait for normal-state recovery.
DRY_RUN: would run the read-only readiness job after recovery and collect redacted artifacts.
DRY_RUN: no cluster API call, tunnel connection, ledger posting, consensus claim, or provider request was made.
EOF
  exit 0
fi

kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" get pods -l app.kubernetes.io/name=tigerbeetle -o wide > "$ARTIFACT_DIR/before-pods.txt"
ready_count=$(kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" get pods -l app.kubernetes.io/name=tigerbeetle --no-headers | awk '$2 ~ /^1\/1$/ { count++ } END { print count+0 }')
[[ "$ready_count" -eq 6 ]] || refuse "expected six ready replicas before partition, got $ready_count"

before_job="${TIGERBEETLE_CLIENT_JOB}-before-partition-$(date +%s)"
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" create job --from=job/"$TIGERBEETLE_CLIENT_JOB" "$before_job"
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" wait --for=condition=complete --timeout=120s job/"$before_job"
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" logs job/"$before_job" > "$ARTIFACT_DIR/readiness-before.log"

cat <<EOF | kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: $PARTITION_NETWORK_POLICY
  labels:
    app.kubernetes.io/name: tigerbeetle
    healthpoint.io/drill: temporary-partition
spec:
  podSelector:
    matchLabels:
      statefulset.kubernetes.io/pod-name: $pod
  policyTypes: [Ingress, Egress]
EOF
created_policy=true
sleep 60
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" get pods -l app.kubernetes.io/name=tigerbeetle -o wide > "$ARTIFACT_DIR/during-partition-pods.txt"
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" delete networkpolicy "$PARTITION_NETWORK_POLICY" --wait=true
created_policy=false
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" rollout status statefulset/"$TIGERBEETLE_STATEFULSET" --timeout=300s

after_job="${TIGERBEETLE_CLIENT_JOB}-after-partition-$(date +%s)"
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" create job --from=job/"$TIGERBEETLE_CLIENT_JOB" "$after_job"
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" wait --for=condition=complete --timeout=120s job/"$after_job"
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" logs job/"$after_job" > "$ARTIFACT_DIR/readiness-after.log"
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" get events --sort-by=.lastTimestamp | tail -n 120 > "$ARTIFACT_DIR/events.txt"
echo "PARTITION_RECOVERY_DRILL_COMPLETED: a single staging replica was isolated temporarily; pre/post read-only connectivity succeeded. Review cluster metrics and artifacts before granting any readiness credit."
