"""File/Postgres-backed model registry (no MLflow server required).

Why not MLflow tracking server? The platform has no MLflow deployment and
adding a stateful tracking server to the compose stack for four small CPU
models is unjustified operational weight. This registry stores version,
metrics, artifact refs and stage transitions (dev -> staging -> prod) as
plain JSON (file backend) or in a `model_registry` Postgres table when
DATABASE_URL is set. ml/registry/mlflow_adapter.py can sync to MLflow when
MLFLOW_TRACKING_URI is present, making MLflow strictly optional.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Dict, List, Optional

log = logging.getLogger("ml.registry")

STAGES = ["dev", "staging", "prod"]


class ModelRegistry:
    def __init__(self, store_dir: str = "ml/registry/store"):
        self.dir = Path(store_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.db_url = os.environ.get("DATABASE_URL")
        if self.db_url:
            self._ensure_table()

    # ------------------------------------------------------------------ #
    def _ensure_table(self) -> None:
        try:
            import psycopg
            with psycopg.connect(self.db_url) as conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS model_registry (
                        model_name  text NOT NULL,
                        version     bigint NOT NULL,
                        metrics     jsonb NOT NULL,
                        artifact_ref text NOT NULL,
                        stage       text NOT NULL DEFAULT 'dev',
                        created_at  timestamptz NOT NULL DEFAULT now(),
                        PRIMARY KEY (model_name, version)
                    )""")
        except Exception as exc:  # noqa: BLE001
            log.warning("Postgres registry unavailable, file backend: %s", exc)
            self.db_url = None

    # ------------------------------------------------------------------ #
    def register(self, model_name: str, version: int, metrics: Dict,
                 artifact_ref: str, stage: str = "dev") -> Dict:
        assert stage in STAGES
        rec = {"model_name": model_name, "version": version,
               "metrics": metrics, "artifact_ref": artifact_ref,
               "stage": stage, "registered_at": time.time()}
        if self.db_url:
            try:
                import psycopg
                with psycopg.connect(self.db_url) as conn:
                    conn.execute(
                        """INSERT INTO model_registry
                           (model_name, version, metrics, artifact_ref, stage)
                           VALUES (%s,%s,%s,%s,%s)
                           ON CONFLICT (model_name, version) DO UPDATE
                           SET metrics=EXCLUDED.metrics,
                               artifact_ref=EXCLUDED.artifact_ref,
                               stage=EXCLUDED.stage""",
                        (model_name, version, json.dumps(metrics),
                         artifact_ref, stage))
            except Exception as exc:  # noqa: BLE001
                log.warning("Postgres write failed (%s); file only", exc)
        path = self.dir / f"{model_name}_v{version}.json"
        with open(path, "w") as f:
            json.dump(rec, f, indent=2)
        return rec

    # ------------------------------------------------------------------ #
    def list_versions(self, model_name: str) -> List[Dict]:
        recs = []
        for p in sorted(self.dir.glob(f"{model_name}_v*.json")):
            with open(p) as f:
                recs.append(json.load(f))
        return sorted(recs, key=lambda r: r["version"])

    def get_champion(self, model_name: str) -> Optional[Dict]:
        """Champion = highest-version record in staging/prod."""
        candidates = [r for r in self.list_versions(model_name)
                      if r["stage"] in ("staging", "prod")]
        return candidates[-1] if candidates else None

    def transition(self, model_name: str, version: int, new_stage: str) -> Dict:
        assert new_stage in STAGES
        path = self.dir / f"{model_name}_v{version}.json"
        with open(path) as f:
            rec = json.load(f)
        order = STAGES.index
        if order(new_stage) < order(rec["stage"]):
            log.info("Rollback: %s v%s %s -> %s", model_name, version,
                     rec["stage"], new_stage)
        rec["stage"] = new_stage
        rec["stage_updated_at"] = time.time()
        with open(path, "w") as f:
            json.dump(rec, f, indent=2)
        if self.db_url:
            try:
                import psycopg
                with psycopg.connect(self.db_url) as conn:
                    conn.execute(
                        """UPDATE model_registry SET stage=%s
                           WHERE model_name=%s AND version=%s""",
                        (new_stage, model_name, version))
            except Exception as exc:  # noqa: BLE001
                log.warning("Postgres stage update failed: %s", exc)
        return rec

    def rollback(self, model_name: str) -> Optional[Dict]:
        """Demote current prod champion to dev and promote prior staging."""
        versions = self.list_versions(model_name)
        prod = [r for r in versions if r["stage"] == "prod"]
        staging = [r for r in versions if r["stage"] == "staging"]
        if prod:
            self.transition(model_name, prod[-1]["version"], "dev")
        if staging:
            return self.transition(model_name, staging[-1]["version"], "prod")
        return None
