#!/usr/bin/env python3
REGISTRY = 'ghcr.io/munisp/healthpoint'
TAG_EXPR = '${IMAGE_TAG:-latest}'

fixes = {
    'kubernetes/deployments/core-services.yaml': [
        ('healthpoint/api-gateway:latest', f'{REGISTRY}/api-gateway:{TAG_EXPR}'),
        ('healthpoint/provider-management:latest', f'{REGISTRY}/provider-management:{TAG_EXPR}'),
        ('healthpoint/audit-compliance:latest', f'{REGISTRY}/audit-compliance:{TAG_EXPR}'),
        ('healthpoint/predictive-analytics:latest', f'{REGISTRY}/predictive-analytics:{TAG_EXPR}'),
    ],
    'infrastructure/lakehouse/lakehouse-stack.yaml': [
        ('healthpoint/spark-jobs:1.0.0', f'{REGISTRY}/spark-jobs:{TAG_EXPR}'),
    ],
}

for fp, replacements in fixes.items():
    with open(fp) as f:
        c = f.read()
    for old, new in replacements:
        c = c.replace(old, new)
    with open(fp, 'w') as f:
        f.write(c)
    print(f'Fixed: {fp}')

print('All done')
