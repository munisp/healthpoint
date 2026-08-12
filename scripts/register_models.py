#!/usr/bin/env python3
"""
HealthPoint IDR Platform — ML Model Registration Script
========================================================
Registers all trained model artefacts into the MLflow Model Registry.
Designed to run as a one-shot init container after MLflow is healthy.

Usage (local):
    python scripts/register_models.py \
        --mlflow-uri http://localhost:5000 \
        --ai-models-dir ./ai-ml-dl-implementation/models \
        --analytics-models-dir ./backend/core-services/predictive-analytics-service/models \
        --stage Production

Usage (docker-compose):
    Invoked automatically by the model-registration service.
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from pathlib import Path
from typing import Optional

import mlflow
import mlflow.sklearn
import mlflow.pytorch
from mlflow.tracking import MlflowClient
from mlflow.exceptions import MlflowException

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("register_models")

# ---------------------------------------------------------------------------
# Model catalogue — maps (registry_name, flavour, relative_path)
# ---------------------------------------------------------------------------
AI_MODELS = [
    ("isolation_forest",  "sklearn",  "isolation_forest.joblib"),
    ("random_forest",     "sklearn",  "random_forest.joblib"),
    ("gradient_boosting", "sklearn",  "gradient_boosting.joblib"),
    ("svm_classifier",    "sklearn",  "svm.joblib"),
    ("gcn_model",         "pytorch",  "gcn_model.pt"),
    ("gat_model",         "pytorch",  "gat_model.pt"),
    ("graphsage_model",   "pytorch",  "graphsage_model.pt"),
    ("fraud_dnn",         "pytorch",  "fraud_dnn_production.pth"),
    ("idr_model",         "pytorch",  "idr_model_production.pth"),
]

ANALYTICS_MODELS = [
    ("puf_outcome_prediction", "sklearn", "outcome_prediction.pkl"),
    ("puf_payment_prediction", "sklearn", "payment_prediction.pkl"),
    ("puf_payment_scaler",     "sklearn", "payment_scaler.pkl"),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def wait_for_mlflow(uri: str, retries: int = 20, delay: int = 5) -> None:
    """Block until the MLflow tracking server responds."""
    import urllib.request
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(f"{uri}/health", timeout=5) as resp:
                if resp.status == 200:
                    log.info("MLflow is ready at %s", uri)
                    return
        except Exception:
            pass
        log.info("Waiting for MLflow (%d/%d)…", attempt, retries)
        time.sleep(delay)
    raise RuntimeError(f"MLflow did not become ready after {retries} attempts at {uri}")


def _ensure_experiment(client: MlflowClient, name: str) -> str:
    exp = client.get_experiment_by_name(name)
    if exp is None:
        exp_id = client.create_experiment(name)
        log.info("Created MLflow experiment '%s' (id=%s)", name, exp_id)
    else:
        exp_id = exp.experiment_id
    return exp_id


def _transition(client: MlflowClient, name: str, version: str, stage: str) -> None:
    """Transition a model version to the requested stage, archiving previous Production versions."""
    if stage == "Production":
        # Archive any existing Production versions first
        for mv in client.search_model_versions(f"name='{name}'"):
            if mv.current_stage == "Production" and mv.version != version:
                client.transition_model_version_stage(
                    name=name, version=mv.version, stage="Archived"
                )
                log.info("Archived previous Production version %s of '%s'", mv.version, name)
    client.transition_model_version_stage(name=name, version=version, stage=stage)
    log.info("Transitioned '%s' v%s → %s", name, version, stage)


def _register_sklearn(
    client: MlflowClient,
    exp_id: str,
    registry_name: str,
    model_path: Path,
    stage: str,
) -> Optional[str]:
    """Log a joblib/pickle sklearn model artefact and register it."""
    if not model_path.exists():
        log.warning("SKIP  %-35s  (file not found: %s)", registry_name, model_path)
        return None

    import joblib
    model = joblib.load(model_path)

    with mlflow.start_run(experiment_id=exp_id, run_name=f"register_{registry_name}") as run:
        mlflow.sklearn.log_model(
            sk_model=model,
            artifact_path="model",
            registered_model_name=registry_name,
        )
        run_id = run.info.run_id

    # Retrieve the version that was just created
    versions = client.search_model_versions(f"name='{registry_name}'")
    latest = max(versions, key=lambda v: int(v.version))
    _transition(client, registry_name, latest.version, stage)
    log.info("REGISTERED  %-35s  v%s  [%s]", registry_name, latest.version, stage)
    return latest.version


def _register_pytorch(
    client: MlflowClient,
    exp_id: str,
    registry_name: str,
    model_path: Path,
    stage: str,
) -> Optional[str]:
    """Log a PyTorch state-dict artefact and register it as a pyfunc model."""
    if not model_path.exists():
        log.warning("SKIP  %-35s  (file not found: %s)", registry_name, model_path)
        return None

    import torch

    # Log the raw state-dict as a generic artefact; wrap in a pyfunc model so
    # it can be loaded uniformly via mlflow.pyfunc.load_model().
    class _StateDict(mlflow.pyfunc.PythonModel):
        """Thin pyfunc wrapper that loads a state-dict on demand."""
        def load_context(self, context):
            self.state_dict = torch.load(
                context.artifacts["state_dict"], map_location="cpu"
            )
        def predict(self, context, model_input):
            # Callers are expected to build the model architecture and call
            # model.load_state_dict(self.state_dict) themselves.
            return self.state_dict

    with mlflow.start_run(experiment_id=exp_id, run_name=f"register_{registry_name}") as run:
        mlflow.pyfunc.log_model(
            artifact_path="model",
            python_model=_StateDict(),
            artifacts={"state_dict": str(model_path)},
            registered_model_name=registry_name,
        )

    versions = client.search_model_versions(f"name='{registry_name}'")
    latest = max(versions, key=lambda v: int(v.version))
    _transition(client, registry_name, latest.version, stage)
    log.info("REGISTERED  %-35s  v%s  [%s]", registry_name, latest.version, stage)
    return latest.version


# ---------------------------------------------------------------------------
# Main registration logic
# ---------------------------------------------------------------------------

def register_all(
    mlflow_uri: str,
    ai_models_dir: Path,
    analytics_models_dir: Path,
    stage: str,
) -> dict:
    """Register all models and return a summary dict."""
    mlflow.set_tracking_uri(mlflow_uri)
    client = MlflowClient(tracking_uri=mlflow_uri)

    exp_id = _ensure_experiment(client, "HealthPoint_Production_Models")

    results: dict = {"registered": [], "skipped": [], "errors": []}

    # ── AI / ML / DL models ──────────────────────────────────────────────────
    for registry_name, flavour, filename in AI_MODELS:
        model_path = ai_models_dir / filename
        try:
            if flavour == "sklearn":
                version = _register_sklearn(client, exp_id, registry_name, model_path, stage)
            else:
                version = _register_pytorch(client, exp_id, registry_name, model_path, stage)

            if version:
                results["registered"].append({"name": registry_name, "version": version, "stage": stage})
            else:
                results["skipped"].append(registry_name)
        except Exception as exc:
            log.error("ERROR registering '%s': %s", registry_name, exc)
            results["errors"].append({"name": registry_name, "error": str(exc)})

    # ── PUF analytics models ─────────────────────────────────────────────────
    for registry_name, flavour, filename in ANALYTICS_MODELS:
        model_path = analytics_models_dir / filename
        try:
            version = _register_sklearn(client, exp_id, registry_name, model_path, stage)
            if version:
                results["registered"].append({"name": registry_name, "version": version, "stage": stage})
            else:
                results["skipped"].append(registry_name)
        except Exception as exc:
            log.error("ERROR registering '%s': %s", registry_name, exc)
            results["errors"].append({"name": registry_name, "error": str(exc)})

    return results


# ---------------------------------------------------------------------------
# CLI entry-point
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Register HealthPoint ML models into MLflow")
    parser.add_argument("--mlflow-uri",          default=os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000"))
    parser.add_argument("--ai-models-dir",       type=Path, default=Path("ai-ml-dl-implementation/models"))
    parser.add_argument("--analytics-models-dir",type=Path, default=Path("backend/core-services/predictive-analytics-service/models"))
    parser.add_argument("--stage",               default="Production", choices=["Staging", "Production"])
    parser.add_argument("--skip-wait",           action="store_true", help="Skip the MLflow readiness wait")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not args.skip_wait:
        wait_for_mlflow(args.mlflow_uri)

    log.info("Starting model registration — stage=%s", args.stage)
    log.info("  AI models dir      : %s", args.ai_models_dir)
    log.info("  Analytics models dir: %s", args.analytics_models_dir)

    results = register_all(
        mlflow_uri=args.mlflow_uri,
        ai_models_dir=args.ai_models_dir,
        analytics_models_dir=args.analytics_models_dir,
        stage=args.stage,
    )

    log.info("─" * 60)
    log.info("Registration complete")
    log.info("  Registered : %d", len(results["registered"]))
    log.info("  Skipped    : %d  (model files not present)", len(results["skipped"]))
    log.info("  Errors     : %d", len(results["errors"]))

    if results["skipped"]:
        log.warning("Skipped models (no artefact file on disk): %s", results["skipped"])
    if results["errors"]:
        for err in results["errors"]:
            log.error("  %s — %s", err["name"], err["error"])
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
