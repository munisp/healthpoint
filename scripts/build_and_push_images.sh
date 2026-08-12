#!/usr/bin/env bash
# ─── HealthPoint Docker Image Build & Push Script ─────────────────────────────
# Usage:
#   ./scripts/build_and_push_images.sh [TAG]
#
# TAG defaults to the current git commit SHA (short).
# Requires: docker buildx, GHCR_TOKEN env var (GitHub PAT with packages:write)
#
# Example:
#   GHCR_TOKEN=ghp_xxx ./scripts/build_and_push_images.sh v1.2.0

set -euo pipefail

REGISTRY="ghcr.io/munisp/healthpoint"
TAG="${1:-$(git rev-parse --short HEAD 2>/dev/null || echo 'latest')}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== HealthPoint Image Build & Push ==="
echo "Registry: $REGISTRY"
echo "Tag:      $TAG"
echo "Root:     $REPO_ROOT"
echo ""

# ── Authenticate ──────────────────────────────────────────────────────────────
if [[ -n "${GHCR_TOKEN:-}" ]]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u munisp --password-stdin
  echo "Logged in to GHCR"
else
  echo "WARNING: GHCR_TOKEN not set — skipping registry login (must be pre-authenticated)"
fi

# ── Enable buildx for multi-platform builds ───────────────────────────────────
docker buildx inspect healthpoint-builder >/dev/null 2>&1 || \
  docker buildx create --name healthpoint-builder --use

# ── Service definitions ───────────────────────────────────────────────────────
# Format: "image-name:context-path:dockerfile-path"
declare -a SERVICES=(
  # Core Python services
  "nsa-idr-dispute-service:backend/core-services/nsa-idr-dispute-service:backend/core-services/nsa-idr-dispute-service/Dockerfile"
  "payment-processing-service:backend/core-services:backend/core-services/payment_processing_service/Dockerfile"
  "claims-processing-service:backend/core-services/claims-processing-service:backend/core-services/claims-processing-service/Dockerfile"
  "gfe-management-service:backend/core-services/gfe-management-service:backend/core-services/gfe-management-service/Dockerfile"
  "eligibility-validation-service:backend/core-services/eligibility-validation-service:backend/core-services/eligibility-validation-service/Dockerfile"
  "idr-entity-selection-service:backend/core-services/idr-entity-selection-service:backend/core-services/idr-entity-selection-service/Dockerfile"
  "appeal-escalation-service:backend/core-services/appeal-escalation-service:backend/core-services/appeal-escalation-service/Dockerfile"
  "admin-fee-management-service:backend/core-services:backend/core-services/admin_fee_management_service/Dockerfile"
  "check-payment-service:backend/core-services:backend/core-services/check_payment_service/Dockerfile"
  "analytics-reporting-service:backend/core-services:backend/core-services/analytics_reporting_service/Dockerfile"
  "predictive-modeling-service:backend/core-services:backend/core-services/predictive_modeling_service/Dockerfile"
  "ai-fraud-detection-service:backend/core-services:backend/core-services/ai_fraud_detection_service_enhanced/Dockerfile"
  "security-authentication-service:backend/core-services/security-authentication-service:backend/core-services/security-authentication-service/Dockerfile"
  "workflow-engine-service:backend/core-services/workflow-engine-service:backend/core-services/workflow-engine-service/Dockerfile"
  "document-generation-service:backend/core-services/document-generation-service:backend/core-services/document-generation-service/Dockerfile"
  # Integration services
  "cms-portal-automation-service:backend/integration-services/cms-portal-automation-service:backend/integration-services/cms-portal-automation-service/Dockerfile"
  "third-party-integration-service:backend/integration-services/third-party-integration-service:backend/integration-services/third-party-integration-service/Dockerfile"
  "notification-service:backend/integration-services/notification-service:backend/integration-services/notification-service/Dockerfile"
  # Frontend
  "unified-shell:frontend/unified-shell:frontend/unified-shell/Dockerfile"
  # Spark jobs
  "spark-jobs:lakehouse:lakehouse/Dockerfile"
)

BUILT=0
FAILED=0
FAILED_SERVICES=()

for svc_def in "${SERVICES[@]}"; do
  IFS=':' read -r image_name context dockerfile <<< "$svc_def"
  
  full_image="$REGISTRY/$image_name:$TAG"
  full_context="$REPO_ROOT/$context"
  full_dockerfile="$REPO_ROOT/$dockerfile"
  
  if [[ ! -d "$full_context" ]]; then
    echo "  SKIP (no context): $image_name"
    continue
  fi
  
  if [[ ! -f "$full_dockerfile" ]]; then
    echo "  SKIP (no Dockerfile): $image_name at $dockerfile"
    continue
  fi
  
  echo ""
  echo "Building: $image_name → $full_image"
  
  if docker buildx build \
    --platform linux/amd64 \
    --file "$full_dockerfile" \
    --tag "$full_image" \
    --tag "$REGISTRY/$image_name:latest" \
    --build-arg IMAGE_TAG="$TAG" \
    --push \
    "$full_context" 2>&1; then
    echo "  ✓ Built and pushed: $image_name"
    BUILT=$((BUILT + 1))
  else
    echo "  ✗ FAILED: $image_name"
    FAILED=$((FAILED + 1))
    FAILED_SERVICES+=("$image_name")
  fi
done

echo ""
echo "=== Build Summary ==="
echo "Built:  $BUILT"
echo "Failed: $FAILED"

if [[ ${#FAILED_SERVICES[@]} -gt 0 ]]; then
  echo ""
  echo "Failed services:"
  for svc in "${FAILED_SERVICES[@]}"; do
    echo "  - $svc"
  done
  exit 1
fi

echo ""
echo "All images built and pushed successfully."
echo "Tag: $TAG"
