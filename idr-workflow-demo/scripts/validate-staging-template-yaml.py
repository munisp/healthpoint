#!/usr/bin/env python3
"""Parse external-gate and TigerBeetle YAML templates after safe non-secret substitution.

This is a structural check only. It does not render a deployable manifest, call a
cluster, resolve images, or replace any real secret.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
PATHS = [
    ROOT / "infrastructure/external-gates-staging/k8s",
    ROOT / "infrastructure/tigerbeetle-staging/k8s",
]

SAFE_VALUES = {
    "CIDR": "10.20.0.0/16",
    "PORT": "443",
    "ID": "validation",
    "CLUSTER_ID": "1",
    "MAX_QUEUED_REQUESTS": "100",
}


def replacement(match: re.Match[str]) -> str:
    token = match.group(1)
    for suffix, value in SAFE_VALUES.items():
        if token.endswith(suffix):
            return value
    if "IMAGE" in token:
        return "registry.staging.internal/component@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    if "ENDPOINT" in token or "HOST" in token or "DNS" in token:
        return "component.staging.svc.cluster.local"
    if "NAMESPACE" in token:
        return "healthpoint-staging"
    if "SECRET" in token:
        return "staging/component"
    if "PATH" in token:
        return "/healthz"
    if "MODE" in token:
        return "standalone"
    if "REFERENCE" in token:
        return "oci://registry.staging.internal/chart"
    if "SHA256" in token:
        return "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    if "TOPIC" in token:
        return "staging-health"
    if "CLASS" in token:
        return "staging-gateway"
    return "validation"


errors: list[str] = []
checked = 0
for root in PATHS:
    for path in sorted(root.rglob("*.yaml.template")):
        checked += 1
        rendered = re.sub(r"\$\{([A-Z0-9_]+)\}", replacement, path.read_text())
        try:
            documents = [doc for doc in yaml.safe_load_all(rendered) if doc is not None]
            if not documents:
                raise ValueError("no YAML documents")
            for index, document in enumerate(documents, start=1):
                if not isinstance(document, dict):
                    raise ValueError(f"document {index} is not a YAML mapping")
                if path.name.endswith(".fragment.yaml.template"):
                    if not {"route", "receivers"}.issubset(document):
                        raise ValueError(f"Alertmanager routing fragment document {index} lacks route or receivers")
                elif "apiVersion" not in document or "kind" not in document:
                    raise ValueError(f"document {index} lacks apiVersion or kind")
        except Exception as error:  # structural parser output is surfaced below
            errors.append(f"{path.relative_to(ROOT)}: {error}")

if errors:
    sys.stderr.write("STAGING_TEMPLATE_YAML_INVALID\n" + "\n".join(errors) + "\n")
    sys.exit(2)
print(f"STAGING_TEMPLATE_YAML_VALID: {checked} templates parsed with safe non-secret substitutions")
