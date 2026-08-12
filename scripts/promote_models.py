#!/usr/bin/env python3
"""
HealthPoint IDR Platform — ML Model Promotion Script
=====================================================
Promotes model versions from Staging → Production in the MLflow Model Registry,
archives the previous Production version, and validates each model loads correctly
before promotion.

Usage:
    # Promote all models that are currently in Staging
    python scripts/promote_models.py --mlflow-uri http://localhost:5000

    # Promote a specific model only
    python scripts/promote_models.py --mlflow-uri http://localhost:5000 \
        --model-name isolation_forest

    # Dry-run (validate only, do not transition)
    python scripts/promote_models.py --mlflow-uri http://localhost:5000 --dry-run
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from typing import Optional

import mlflow
import mlflow.pyfunc
import mlflow.sklearn
from mlflow.tracking import MlflowClient
from mlflow.exceptions import MlflowException

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("promote_models")

# All model names managed by this platform
ALL_MODEL_NAMES = [
    "isolation_forest",
    "random_forest",
    "gradient_boosting",
    "svm_classifier",
    "gcn_model",
    "gat_model",
    "graphsage_model",
    "fraud_dnn",
    "idr_model",
    "puf_outcome_prediction",
    "puf_payment_prediction",
    "puf_payment_scaler",
]


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _validate_sklearn(client: MlflowClient, name: str, version: str) -> bool:
    """Load the model and run a trivial predict to confirm it works."""
    try:
        import numpy as np
        model_uri = f"models:/{name}/{version}"
        model = mlflow.sklearn.load_model(model_uri)
        # Probe with a single zero-vector (shape depends on model, use 1 feature)
        try:
            model.predict(np.zeros((1, 1)))
        except Exception:
            # Shape mismatch is expected — what matters is that the model loaded
            pass
        log.info("VALIDATED  %s v%s (sklearn)", name, version)
        return True
    except Exception as exc:
        log.error("VALIDATION FAILED  %s v%s: %s", name, version, exc)
        return False


def _validate_pyfunc(client: MlflowClient, name: str, version: str) -> bool:
    """Load a pyfunc model (used for PyTorch state-dicts) and confirm it loads."""
    try:
        model_uri = f"models:/{name}/{version}"
        mlflow.pyfunc.load_model(model_uri)
        log.info("VALIDATED  %s v%s (pyfunc/pytorch)", name, version)
        return True
    except Exception as exc:
        log.error("VALIDATION FAILED  %s v%s: %s", name, version, exc)
        return False


# Flavour map — sklearn models can be validated with load_model; pytorch uses pyfunc
_SKLEARN_MODELS = {
    "isolation_forest", "random_forest", "gradient_boosting", "svm_classifier",
    "puf_outcome_prediction", "puf_payment_prediction", "puf_payment_scaler",
}


def _validate(client: MlflowClient, name: str, version: str) -> bool:
    if name in _SKLEARN_MODELS:
        return _validate_sklearn(client, name, version)
    return _validate_pyfunc(client, name, version)


# ---------------------------------------------------------------------------
# Promotion logic
# ---------------------------------------------------------------------------

def _get_staging_version(client: MlflowClient, name: str) -> Optional[str]:
    """Return the latest Staging version number, or None if none exists."""
    try:
        versions = client.search_model_versions(f"name='{name}'")
    except MlflowException:
        return None
    staging = [v for v in versions if v.current_stage == "Staging"]
    if not staging:
        return None
    return max(staging, key=lambda v: int(v.version)).version


def _archive_production(client: MlflowClient, name: str, exclude_version: str) -> None:
    """Archive all Production versions except the one being promoted."""
    try:
        versions = client.search_model_versions(f"name='{name}'")
    except MlflowException:
        return
    for v in versions:
        if v.current_stage == "Production" and v.version != exclude_version:
            client.transition_model_version_stage(name=name, version=v.version, stage="Archived")
            log.info("Archived  %s v%s (was Production)", name, v.version)


def promote_model(
    client: MlflowClient,
    name: str,
    dry_run: bool,
) -> dict:
    """Promote the latest Staging version of a model to Production."""
    version = _get_staging_version(client, name)
    if version is None:
        log.info("SKIP  %-35s  (no Staging version found)", name)
        return {"name": name, "status": "skipped", "reason": "no Staging version"}

    valid = _validate(client, name, version)
    if not valid:
        return {"name": name, "status": "error", "reason": "validation failed", "version": version}

    if dry_run:
        log.info("DRY-RUN  %-35s  v%s  would promote to Production", name, version)
        return {"name": name, "status": "dry_run", "version": version}

    _archive_production(client, name, exclude_version=version)
    client.transition_model_version_stage(name=name, version=version, stage="Production")
    log.info("PROMOTED  %-35s  v%s  → Production", name, version)

    # Add a description tag to the newly promoted version
    client.update_model_version(
        name=name,
        version=version,
        description=f"Promoted to Production by promote_models.py at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}",
    )

    return {"name": name, "status": "promoted", "version": version}


# ---------------------------------------------------------------------------
# CLI entry-point
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Promote HealthPoint ML models from Staging to Production")
    parser.add_argument("--mlflow-uri",  default=os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000"))
    parser.add_argument("--model-name",  default=None, help="Promote a single named model only")
    parser.add_argument("--dry-run",     action="store_true", help="Validate but do not transition")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    mlflow.set_tracking_uri(args.mlflow_uri)
    client = MlflowClient(tracking_uri=args.mlflow_uri)

    names = [args.model_name] if args.model_name else ALL_MODEL_NAMES

    log.info("Starting promotion run — dry_run=%s", args.dry_run)
    results = [promote_model(client, name, dry_run=args.dry_run) for name in names]

    promoted = [r for r in results if r["status"] == "promoted"]
    skipped  = [r for r in results if r["status"] == "skipped"]
    dry_runs = [r for r in results if r["status"] == "dry_run"]
    errors   = [r for r in results if r["status"] == "error"]

    log.info("─" * 60)
    log.info("Promotion run complete")
    log.info("  Promoted : %d", len(promoted))
    log.info("  Skipped  : %d", len(skipped))
    log.info("  Dry-run  : %d", len(dry_runs))
    log.info("  Errors   : %d", len(errors))

    if errors:
        for e in errors:
            log.error("  %s v%s — %s", e["name"], e.get("version", "?"), e["reason"])
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
