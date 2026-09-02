#!/usr/bin/env bash
# Staging-only single-replica-loss recovery drill for an externally operated
# TigerBeetle cluster. It does not create accounts, transfers, or settlements.
# Default behavior is dry-run. Execution needs an approved change ticket.
set -euo pipefail

MODE="dry-run"
if [[ "${1:-}" == "--execute" ]]; then MODE="execute"; fi

: "${HEALTHPOINT_TIGERBEETLE_DRILL_ENV:=staging}"
: "${HEALTHPOINT_TIGERBEETLE_CHANGE_TICKET:=}"
: "${TIGERBEETLE_NAMESPACE:=healthpoint-staging}"
: "${TIGERBEETLE_STATEFULSET:=tigerbeetle}"
: "${TIGERBEETLE_REPLICA_TO_RESTART:=2}"
: "${TIGERBEETLE_CLIENT_JOB:=tigerbeetle-readiness}"
: "${KUBECTL_CONTEXT:=}"
: "${ARTIFACT_DIR:=artifacts/tigerbeetle-quorum-recovery}"

if [[ "$HEALTHPOINT_TIGERBEETLE_DRILL_ENV" != "staging" ]]; then
  echo "REFUSED: HEALTHPOINT_TIGERBEETLE_DRILL_ENV must equal staging" >&2; exit 64
fi
if [[ -z "$KUBECTL_CONTEXT" || ! "$KUBECTL_CONTEXT" =~ stag ]]; then
  echo "REFUSED: KUBECTL_CONTEXT must identify a staging cluster" >&2; exit 64
fi
if ! [[ "$TIGERBEETLE_REPLICA_TO_RESTART" =~ ^[0-9]+$ ]]; then
  echo "REFUSED: TIGERBEETLE_REPLICA_TO_RESTART must be a numeric ordinal" >&2; exit 64
fi
if [[ "$MODE" == "execute" ]]; then
  if [[ ! "$HEALTHPOINT_TIGERBEETLE_CHANGE_TICKET" =~ ^[A-Z][A-Z0-9]+-[0-9]+$ ]]; then
    echo "REFUSED: --execute requires HEALTHPOINT_TIGERBEETLE_CHANGE_TICKET like CHG-1234" >&2; exit 64
  fi
  if [[ "${HEALTHPOINT_APPROVE_TIGERBEETLE_DRILL:-}" != "yes" ]]; then
    echo "REFUSED: --execute requires HEALTHPOINT_APPROVE_TIGERBEETLE_DRILL=yes" >&2; exit 64
  fi
fi

mkdir -p "$ARTIFACT_DIR"
log="$ARTIFACT_DIR/run-$(date -u +%Y%m%dT%H%M%SZ).log"
exec > >(tee "$log") 2>&1
pod="${TIGERBEETLE_STATEFULSET}-${TIGERBEETLE_REPLICA_TO_RESTART}"
echo "mode=$MODE environment=$HEALTHPOINT_TIGERBEETLE_DRILL_ENV ticket=${HEALTHPOINT_TIGERBEETLE_CHANGE_TICKET:-none}"
echo "scope=single-replica-restart readonly-client-checks only"
echo "context=$KUBECTL_CONTEXT namespace=$TIGERBEETLE_NAMESPACE statefulset=$TIGERBEETLE_STATEFULSET target_pod=$pod"

if [[ "$MODE" == "dry-run" ]]; then
  cat <<EOF
DRY_RUN: would verify all TigerBeetle replicas Ready before disruption.
DRY_RUN: would run read-only client Job/$TIGERBEETLE_CLIENT_JOB before restart.
DRY_RUN: would delete Pod/$pod and wait for StatefulSet/$TIGERBEETLE_STATEFULSET rollout.
DRY_RUN: would run read-only client Job/$TIGERBEETLE_CLIENT_JOB after recovery.
DRY_RUN: would capture pod status, bounded events, and client-job logs in $ARTIFACT_DIR.
DRY_RUN: no Kubernetes API call, provider request, ledger posting, or consensus claim was made.
EOF
  exit 0
fi

kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" get statefulset "$TIGERBEETLE_STATEFULSET" -o json > "$ARTIFACT_DIR/before-statefulset.json"
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" get pods -l app.kubernetes.io/name=tigerbeetle -o wide > "$ARTIFACT_DIR/before-pods.txt"
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" create job --from=job/"$TIGERBEETLE_CLIENT_JOB" "${TIGERBEETLE_CLIENT_JOB}-before-$(date +%s)" >/dev/null
before_job=$(kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" get jobs -o name | grep "${TIGERBEETLE_CLIENT_JOB}-before" | tail -n1)
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" wait --for=condition=complete --timeout=120s "$before_job"
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" logs "$before_job" > "$ARTIFACT_DIR/readiness-before.log"

kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" delete pod "$pod" --wait=true
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" rollout status statefulset/"$TIGERBEETLE_STATEFULSET" --timeout=300s
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" get pods -l app.kubernetes.io/name=tigerbeetle -o wide > "$ARTIFACT_DIR/after-pods.txt"
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" create job --from=job/"$TIGERBEETLE_CLIENT_JOB" "${TIGERBEETLE_CLIENT_JOB}-after-$(date +%s)" >/dev/null
after_job=$(kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" get jobs -o name | grep "${TIGERBEETLE_CLIENT_JOB}-after" | tail -n1)
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" wait --for=condition=complete --timeout=120s "$after_job"
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" logs "$after_job" > "$ARTIFACT_DIR/readiness-after.log"
kubectl --context "$KUBECTL_CONTEXT" -n "$TIGERBEETLE_NAMESPACE" get events --sort-by=.lastTimestamp | tail -n 120 > "$ARTIFACT_DIR/events.txt"
echo "RECOVERY_DRILL_COMPLETED: read-only checks passed before and after one staging replica restart. Review artifacts before any readiness credit."
