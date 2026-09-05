#!/usr/bin/env bash
# cleanup-orphans.sh — one-command removal of owner-approved orphan trees.
#
# BACKGROUND
#   The remediation audit (branch assurance/remediation-2026-09-05) confirmed
#   the paths below as orphaned: standalone "manus template" demo dashboards
#   and a full duplicate copy of the application (idr-workflow-demo/). None
#   are referenced by the root build (package.json / pnpm-workspace.yaml /
#   Dockerfile / vite.config.ts) or by server code; the only references are
#   historical audit/status docs.
#
# USAGE
#   ./scripts/cleanup-orphans.sh           # dry-run (default): prints what would be removed
#   ./scripts/cleanup-orphans.sh --apply   # performs git rm -r and prints a commit reminder
#
# Idempotent: already-removed paths are skipped. Run from the repo root.

set -euo pipefail

APPLY=0
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=1
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--apply]" >&2
  exit 2
fi

# ── CONFIRMED orphans (owner-approved deletion, 2026-09-05) ──────────────────
# 21 manus-template dashboard directories (marker: .manus-template-version)
# plus 5 standalone HTML template dirs and the duplicate app tree.
ORPHAN_PATHS=(
  # Manus template dashboards (each: index.html + src/ + own pnpm-lock.yaml)
  admin-dashboard
  admin-fee-dashboard-enhanced
  admin-fee-management-dashboard
  ai-fraud-detection-dashboard
  analytics-reports-dashboard
  bulk-processing-visualization
  claims-management-dashboard
  document-management-dashboard
  emergency-services-dashboard
  fee-communication-ui
  good-faith-estimate-dashboard
  healthcare-platform-ui
  member-portal
  nsa-compliance-dashboard
  nsa-idr-dispute-resolution-dashboard
  nsa-idr-super-dashboard
  nsa-idr-ui
  nsa-idr-unified-dashboard
  nsa-idr-workflow-ui
  patient-management-dashboard
  payment-processing-dashboard
  # Standalone static HTML template/marketing dirs
  aggregator-website
  georgetown-dashboard-demo
  healthpoint-marketing
  idr-stakeholder-deck
  stakeholder-presentation
  # Full duplicate of the application at an older revision
  idr-workflow-demo
)

# ── SUSPECTED orphans — NOT deleted by this script ───────────────────────────
# Reviewed by the audit but kept out of the confirmed list. Verify usage and
# get owner sign-off before adding them above:
#   healthpoint-ai-mcmc              (mixed dashboard HTML + python demo scripts)
#   ai-ml-dl-implementation          (standalone python ML experiments)
#   api-gateway-service, cms-portal-automation-service, data-transformation-service,
#   gfe-management-service, idr-entity-integration-service, nsa-rate-calculation-engine
#       (stub FastAPI microservices; gfe-management-service/main.py still imports
#        dapr.clients — was wired to the removed Dapr stack)
#   kubernetes/                      (legacy kustomize tree referencing fictional
#                                    healthpoint/* :latest images; superseded by
#                                    deploy/helm/healthpoint)
#   helm/idr-platform                (legacy chart; superseded by deploy/helm/healthpoint)

echo "HealthPoint orphan cleanup — $([[ $APPLY -eq 1 ]] && echo APPLY || echo DRY-RUN)"
echo

removed=0
skipped=0
for path in "${ORPHAN_PATHS[@]}"; do
  if [[ -e "$path" ]]; then
    if [[ $APPLY -eq 1 ]]; then
      git rm -r -q -- "$path"
      echo "  removed: $path"
    else
      echo "  would remove: $path ($(du -sh "$path" 2>/dev/null | cut -f1))"
    fi
    removed=$((removed + 1))
  else
    echo "  skip (absent): $path"
    skipped=$((skipped + 1))
  fi
done

echo
echo "$removed path(s) $([[ $APPLY -eq 1 ]] && echo removed || echo pending), $skipped already absent."
if [[ $APPLY -eq 1 ]]; then
  echo
  echo "Review with 'git status', then commit, e.g.:"
  echo "  git commit -m \"chore(cleanup): remove orphan template dashboards and idr-workflow-demo\""
fi
