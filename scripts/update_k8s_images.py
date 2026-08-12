#!/usr/bin/env python3
"""
Update all Kubernetes deployment manifests to use real container registry image paths.
Registry: ghcr.io/munisp/healthpoint
Tag strategy: ${IMAGE_TAG} env var (defaults to 'latest' for dev, commit SHA in CI)
"""
import os, re, glob

REPO = "/home/ubuntu/healthpoint-repo"
REGISTRY = "ghcr.io/munisp/healthpoint"

# Map service names to their image names
SERVICE_IMAGE_MAP = {
    # Core services
    "nsa-idr-dispute-service": "nsa-idr-dispute-service",
    "payment-processing-service": "payment-processing-service",
    "claims-processing-service": "claims-processing-service",
    "gfe-management-service": "gfe-management-service",
    "eligibility-validation-service": "eligibility-validation-service",
    "idr-entity-selection-service": "idr-entity-selection-service",
    "appeal-escalation-service": "appeal-escalation-service",
    "admin-fee-management-service": "admin-fee-management-service",
    "aggregator-reconciliation-service": "aggregator-reconciliation-service",
    "check-payment-service": "check-payment-service",
    # Integration services
    "cms-portal-automation-service": "cms-portal-automation-service",
    "third-party-integration-service": "third-party-integration-service",
    "notification-service": "notification-service",
    # Analytics & AI
    "analytics-reporting-service": "analytics-reporting-service",
    "predictive-modeling-service": "predictive-modeling-service",
    "ai-fraud-detection-service": "ai-fraud-detection-service",
    # Infrastructure services
    "security-authentication-service": "security-authentication-service",
    "workflow-engine-service": "workflow-engine-service",
    "document-generation-service": "document-generation-service",
    # Frontend
    "unified-shell": "unified-shell",
    "nsa-idr-super-dashboard": "nsa-idr-super-dashboard",
}

def update_manifest(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # Pattern 1: image: placeholder/service-name:tag
    # Pattern 2: image: service-name:tag (no registry)
    # Pattern 3: image: REGISTRY/service-name:IMAGE_TAG (already correct)
    
    def replace_image(m):
        full_match = m.group(0)
        image_part = m.group(1)
        
        # Already using our registry
        if REGISTRY in image_part:
            return full_match
        
        # Extract service name from image path
        # e.g., "healthpoint/nsa-idr-dispute-service:latest" -> "nsa-idr-dispute-service"
        # e.g., "nsa-idr-dispute-service:latest" -> "nsa-idr-dispute-service"
        parts = image_part.split('/')
        image_with_tag = parts[-1]
        image_name = image_with_tag.split(':')[0]
        
        # Find matching service
        matched_service = None
        for svc_name, img_name in SERVICE_IMAGE_MAP.items():
            if svc_name in image_name or image_name in svc_name or img_name == image_name:
                matched_service = img_name
                break
        
        if matched_service:
            return f'image: {REGISTRY}/{matched_service}:${{IMAGE_TAG:-latest}}'
        
        # Keep as-is if we can't match
        return full_match
    
    # Match image: lines in YAML
    content = re.sub(
        r'image:\s+([^\s\n]+)',
        replace_image,
        content
    )
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False


def main():
    k8s_files = glob.glob(f"{REPO}/kubernetes/**/*.yaml", recursive=True)
    k8s_files += glob.glob(f"{REPO}/infrastructure/**/*.yaml", recursive=True)
    
    fixed = 0
    for fp in k8s_files:
        if update_manifest(fp):
            print(f"  UPDATED: {fp.replace(REPO+'/', '')}")
            fixed += 1
    
    print(f"\nTotal manifests updated: {fixed}")
    
    # Verify
    print("\n--- Checking for remaining placeholder images ---")
    remaining = 0
    for fp in k8s_files:
        c = open(fp).read()
        # Look for image: lines without our registry
        for m in re.finditer(r'image:\s+([^\s\n]+)', c):
            img = m.group(1)
            if REGISTRY not in img and 'bitnami/' not in img and 'docker.io/' not in img \
               and 'quay.io/' not in img and 'gcr.io/' not in img and 'k8s.gcr.io/' not in img \
               and 'registry.k8s.io/' not in img and 'opensearchproject/' not in img \
               and 'hashicorp/' not in img and 'confluentinc/' not in img \
               and 'strimzi/' not in img and 'jaegertracing/' not in img \
               and 'prom/' not in img and 'grafana/' not in img \
               and 'nginx:' not in img and 'postgres:' not in img \
               and 'redis:' not in img and 'keycloak' not in img \
               and 'vault:' not in img and 'minio/' not in img \
               and 'apache/' not in img and 'trinodb/' not in img \
               and 'projectnessie/' not in img and 'dapr/' not in img \
               and 'temporalio/' not in img and 'percona/' not in img \
               and 'otel/' not in img and 'permify/' not in img:
                print(f"  UNRESOLVED: {img} in {fp.replace(REPO+'/', '')}")
                remaining += 1
    
    if remaining == 0:
        print("  All service images resolved to registry paths")


if __name__ == "__main__":
    main()
