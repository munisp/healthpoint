"""Optional MLflow sync adapter.

If MLFLOW_TRACKING_URI is set and the `mlflow` package is installed, registry
records are mirrored into an MLflow tracking server (params/metrics/artifact
ref logged per run). If not, every call is a logged no-op — MLflow is
strictly optional; ml.registry.registry.ModelRegistry is the source of truth.
"""

from __future__ import annotations

import logging
import os
from typing import Dict

log = logging.getLogger("ml.registry.mlflow")


def _client():
    uri = os.environ.get("MLFLOW_TRACKING_URI")
    if not uri:
        return None
    try:
        import mlflow
    except ImportError:
        log.warning("MLFLOW_TRACKING_URI set but mlflow not installed")
        return None
    mlflow.set_tracking_uri(uri)
    return mlflow


def sync_record(rec: Dict) -> bool:
    """Mirror a registry record to MLflow. Returns True if synced."""
    mlflow = _client()
    if mlflow is None:
        log.info("MLflow not configured; record %s v%s not synced",
                 rec.get("model_name"), rec.get("version"))
        return False
    mlflow.set_experiment(f"healthpoint/{rec['model_name']}")
    with mlflow.start_run(run_name=f"v{rec['version']}"):
        mlflow.log_param("model_name", rec["model_name"])
        mlflow.log_param("version", rec["version"])
        mlflow.log_param("stage", rec["stage"])
        mlflow.log_param("artifact_ref", rec["artifact_ref"])
        for k, v in rec.get("metrics", {}).items():
            if isinstance(v, (int, float)):
                mlflow.log_metric(k, v)
    log.info("Synced %s v%s to MLflow", rec["model_name"], rec["version"])
    return True
