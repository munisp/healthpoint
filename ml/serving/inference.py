"""CPU inference service for the trained platform models.

Follows the ai-service/ style: a small FastAPI app with explicit request
schemas, structured logging, and no global mutable model state beyond the
weight bundles loaded at startup.

Endpoints:
    POST /fraud/score    {features: [...]} -> {fraud_probability}
    POST /credit/score   {features: [...]} -> {credit_risk_score}
    POST /outcome/score  {features: [...]} -> {outcome_probability}
    POST /gnn/score      {node_features, edge_index} -> per-node anomaly probs

Cross-cutting:
    ab_router      — deterministic hash-split champion/challenger routing with
                     structured logging of every assignment.
    drift_monitor  — PSI + population stats vs training baseline; breaches
                     emit structured log records (audit hook).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import torch

from ml.models.pytorch_models import (
    FraudNet, CreditNet, DisputeGNN, OutcomeNet,
    load_weights_json, normalize_adjacency,
)

log = logging.getLogger("ml.serving")
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")

WEIGHTS_DIR = Path(os.environ.get("ML_WEIGHTS_DIR", "ml/artifacts/weights"))


# --------------------------------------------------------------------------- #
# A/B router: deterministic champion/challenger split                          #
# --------------------------------------------------------------------------- #
class ABRouter:
    """Deterministic hash-split: same request key always routes the same way.

    traffic_fraction is the share of traffic sent to the challenger.
    """

    def __init__(self, traffic_fraction: float = 0.10):
        self.traffic_fraction = traffic_fraction

    def assign(self, model_name: str, request_key: str) -> str:
        h = int(hashlib.sha256(
            f"{model_name}:{request_key}".encode()).hexdigest()[:8], 16)
        bucket = (h % 10000) / 10000.0
        variant = "challenger" if bucket < self.traffic_fraction else "champion"
        log.info(json.dumps({
            "event": "ab_assign", "model": model_name,
            "request_key": request_key, "bucket": bucket, "variant": variant,
            "ts": time.time()}))
        return variant


# --------------------------------------------------------------------------- #
# Drift monitor: PSI + population stats vs training baseline                   #
# --------------------------------------------------------------------------- #
class DriftMonitor:
    """Population Stability Index per feature vs a stored training baseline.

    baseline: {"mean": [...], "std": [...], "hist": [[bin_edges], [probs]]...}
    PSI > alert_threshold emits a structured drift_alert log record (the
    audit hook — wire this to your audit/event bus in deployment).
    """

    def __init__(self, baseline: Optional[Dict] = None,
                 alert_threshold: float = 0.25):
        self.baseline = baseline
        self.alert_threshold = alert_threshold
        self.n_scored = 0

    @staticmethod
    def build_baseline(X: np.ndarray, n_bins: int = 10) -> Dict:
        hists = []
        for j in range(X.shape[1]):
            probs, edges = np.histogram(X[:, j], bins=n_bins, density=True)
            probs = probs / max(probs.sum(), 1e-12)
            hists.append({"edges": edges.tolist(), "probs": probs.tolist()})
        return {"mean": X.mean(axis=0).tolist(),
                "std": X.std(axis=0).tolist(), "hist": hists}

    def psi(self, x: np.ndarray) -> float:
        if self.baseline is None:
            return 0.0
        total = 0.0
        for j in range(x.shape[1]):
            hb = self.baseline["hist"][j]
            edges = np.array(hb["edges"])
            expected = np.array(hb["probs"]) + 1e-6
            actual, _ = np.histogram(x[:, j], bins=edges, density=True)
            actual = actual / max(actual.sum(), 1e-12) + 1e-6
            total += float(np.sum((expected - actual) * np.log(expected / actual)))
        return total

    def observe(self, model_name: str, x: np.ndarray) -> None:
        self.n_scored += 1
        val = self.psi(x)
        if val > self.alert_threshold:
            log.warning(json.dumps({
                "event": "drift_alert", "model": model_name,
                "psi": val, "threshold": self.alert_threshold,
                "n_scored": self.n_scored, "ts": time.time()}))
        else:
            log.info(json.dumps({"event": "drift_check", "model": model_name,
                                 "psi": val, "ts": time.time()}))


# --------------------------------------------------------------------------- #
# Model bundle loading                                                          #
# --------------------------------------------------------------------------- #
MODEL_CLASSES = {"fraudnet": FraudNet, "creditnet": CreditNet,
                 "outcomenet": OutcomeNet, "disputegnn": DisputeGNN}

_bundles: Dict[str, Dict[str, torch.nn.Module]] = {"champion": {}, "challenger": {}}
_ab = ABRouter(float(os.environ.get("AB_CHALLENGER_FRACTION", "0.10")))
_drift = DriftMonitor()


def _load_variant(variant: str) -> None:
    for name, cls in MODEL_CLASSES.items():
        candidates = sorted(WEIGHTS_DIR.glob(f"{name}_v*.json"))
        primary = WEIGHTS_DIR / f"{name}.json"
        path = primary if primary.exists() else (candidates[-1] if candidates else None)
        if path is None:
            log.warning("No weights found for %s; endpoint will 503", name)
            continue
        if variant == "challenger" and len(candidates) >= 2:
            path = candidates[-2]  # previous version as challenger
        model = cls()
        with open(path) as f:
            load_weights_json(model, json.load(f))
        model.eval()
        _bundles[variant][name] = model
        log.info("Loaded %s (%s) from %s", name, variant, path)


def startup() -> None:
    _load_variant("champion")
    _load_variant("challenger")


def _score(model_name: str, features: List[float], request_key: str) -> Dict:
    variant = _ab.assign(model_name, request_key)
    model = _bundles[variant].get(model_name) or _bundles["champion"].get(model_name)
    if model is None:
        raise RuntimeError(f"{model_name} weights not loaded")
    x = np.array(features, dtype=np.float32).reshape(1, -1)
    _drift.observe(model_name, x)
    with torch.no_grad():
        logit = model(torch.tensor(x)).item()
    return {"model": model_name, "variant": variant,
            "probability": float(1 / (1 + np.exp(-logit)))}


def gnn_score(node_features: List[List[float]], edge_index: List[List[int]],
              request_key: str) -> Dict:
    variant = _ab.assign("disputegnn", request_key)
    model = _bundles[variant].get("disputegnn") or _bundles["champion"].get("disputegnn")
    if model is None:
        raise RuntimeError("disputegnn weights not loaded")
    x = torch.tensor(node_features, dtype=torch.float32)
    adj = normalize_adjacency(torch.tensor(edge_index, dtype=torch.long),
                              x.shape[0])
    with torch.no_grad():
        probs = torch.sigmoid(model(x, adj)).tolist()
    return {"model": "disputegnn", "variant": variant,
            "node_anomaly_probabilities": probs}


# --------------------------------------------------------------------------- #
# Optional FastAPI app                                                          #
# --------------------------------------------------------------------------- #
def create_app():
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel

    class TabularRequest(BaseModel):
        features: List[float]
        request_key: str = "anonymous"

    class GNNRequest(BaseModel):
        node_features: List[List[float]]
        edge_index: List[List[int]]
        request_key: str = "anonymous"

    app = FastAPI(title="healthpoint-ml-serving")
    startup()

    @app.get("/health")
    def health():
        return {"status": "ok",
                "models": {v: sorted(m.keys()) for v, m in _bundles.items()}}

    def _tab(name: str):
        def handler(req: TabularRequest):
            try:
                return _score(name, req.features, req.request_key)
            except RuntimeError as exc:
                raise HTTPException(503, str(exc))
        return handler

    app.post("/fraud/score")(_tab("fraudnet"))
    app.post("/credit/score")(_tab("creditnet"))
    app.post("/outcome/score")(_tab("outcomenet"))

    @app.post("/gnn/score")
    def gnn(req: GNNRequest):
        try:
            return gnn_score(req.node_features, req.edge_index, req.request_key)
        except RuntimeError as exc:
            raise HTTPException(503, str(exc))

    return app


app = None
if os.environ.get("ML_SERVING_FASTAPI", "1") == "1":
    try:
        app = create_app()
    except ImportError:
        log.warning("fastapi not installed; serving via function API only")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("ml.serving.inference:create_app", factory=True,
                host="0.0.0.0", port=int(os.environ.get("ML_SERVING_PORT", "8100")))
