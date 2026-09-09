"""CPU inference service for the trained platform models.

Follows the ai-service/ style: a small FastAPI app with explicit request
schemas, structured logging, and no global mutable model state beyond the
weight bundles loaded at startup.

Endpoints:
    GET  /health         liveness + loaded model inventory (unauthenticated)
    POST /fraud/score    {features: [...]} -> {fraud_probability}
    POST /credit/score   {features: [...]} -> {credit_risk_score}
    POST /outcome/score  {features: [...]} -> {outcome_probability}
    POST /gnn/score      {node_features, edge_index} -> per-node anomaly probs

Cross-cutting:
    ab_router      — deterministic hash-split champion/challenger routing with
                     structured logging of every assignment.
    drift monitors — per-model PSI + population stats vs the training
                     baseline; breaches emit structured log records (audit
                     hook). The baseline is loaded from
                     ML_WEIGHTS_DIR/drift_baseline.json when present and is
                     otherwise REGENERATED at startup from the fixed-seed
                     synthetic generator (never silently PSI=0).
    auth           — API-key auth on all scoring endpoints (X-API-Key).
                     Fail-closed: without ML_API_KEY set, non-dev deployments
                     answer 401 to every scoring request.
    rate limit     — in-process sliding-window limiter, per API key
                     (ML_RATE_LIMIT_PER_MIN, default 60/min).

Environment:
    ML_WEIGHTS_DIR           weight bundle directory (default ml/artifacts/weights)
    ML_API_KEY               API key for scoring endpoints. REQUIRED outside
                             dev mode; if unset the service still boots (so
                             /health works for orchestrators) but every
                             scoring request fails closed with 401.
    ML_DEV_MODE              "1"/"true" disables API-key enforcement for local
                             development ONLY. Never set in deployed envs.
    ML_RATE_LIMIT_PER_MIN    per-key requests/minute (default 60)
    ML_DRIFT_BASELINE_SEED   fixed seed for baseline regeneration (default 42)
    ML_SERVING_PORT          uvicorn port (default 8100)
    ML_SERVING_FASTAPI       "0" disables app construction (library use)
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import threading
import time
from collections import deque
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
DRIFT_BASELINE_FILE = WEIGHTS_DIR / "drift_baseline.json"
# Fixed seed of the training run (ml/training/train.py --seed 42). Baseline
# regeneration reuses it so serving-time PSI is computed against exactly the
# training distribution; documented here so a retrained model with a
# different seed updates this constant deliberately.
DRIFT_BASELINE_SEED = int(os.environ.get("ML_DRIFT_BASELINE_SEED", "42"))

ML_API_KEY = os.environ.get("ML_API_KEY", "").strip()
ML_DEV_MODE = os.environ.get("ML_DEV_MODE", "").lower() in ("1", "true", "yes")
RATE_LIMIT_PER_MIN = int(os.environ.get("ML_RATE_LIMIT_PER_MIN", "60"))


# --------------------------------------------------------------------------- #
# Request schemas (module level so FastAPI can resolve the annotations —      #
# `from __future__ import annotations` stringifies them, and nested-class     #
# forward refs are not resolvable from create_app's local scope)              #
# --------------------------------------------------------------------------- #
try:
    from pydantic import BaseModel

    class TabularRequest(BaseModel):
        features: List[float]
        request_key: str = "anonymous"

    class GNNRequest(BaseModel):
        node_features: List[List[float]]
        edge_index: List[List[int]]
        request_key: str = "anonymous"
except ImportError:  # pydantic absent: library/function-API use only
    TabularRequest = None  # type: ignore[assignment]
    GNNRequest = None      # type: ignore[assignment]


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

    baseline: {"mean": [...], "std": [...], "hist": [{"edges","probs"}...]}
    PSI > alert_threshold emits a structured drift_alert log record (the
    audit hook — wire this to your audit/event bus in deployment).

    A monitor built with baseline=None is UNAVAILABLE, not silent: observe()
    logs a drift_unavailable record instead of returning a meaningless 0.0.
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

    def psi(self, x: np.ndarray) -> Optional[float]:
        if self.baseline is None:
            return None
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
        if val is None:
            # Never silently report PSI=0: flag the missing baseline loudly.
            log.warning(json.dumps({
                "event": "drift_unavailable", "model": model_name,
                "reason": "no drift baseline loaded",
                "n_scored": self.n_scored, "ts": time.time()}))
            return
        if val > self.alert_threshold:
            log.warning(json.dumps({
                "event": "drift_alert", "model": model_name,
                "psi": val, "threshold": self.alert_threshold,
                "n_scored": self.n_scored, "ts": time.time()}))
        else:
            log.info(json.dumps({"event": "drift_check", "model": model_name,
                                 "psi": val, "ts": time.time()}))


def _load_or_build_drift_baselines() -> Dict[str, DriftMonitor]:
    """Return per-model DriftMonitors.

    1. If ML_WEIGHTS_DIR/drift_baseline.json exists, load it (persisted
       baselines are authoritative — they were built from the actual training
       distribution and survive weight-only redeploys).
    2. Otherwise REGENERATE: re-run ml.data.synthetic_platform_data.
       generate_platform_data with the fixed training seed (42) and build the
       baseline from the regenerated training feature matrices, then persist
       it to drift_baseline.json so subsequent boots take path 1.

    If regeneration fails (e.g. data module unavailable), monitors come up
    unavailable and log drift_unavailable per request — never silent PSI=0.
    """
    monitors: Dict[str, DriftMonitor] = {}
    if DRIFT_BASELINE_FILE.exists():
        try:
            with open(DRIFT_BASELINE_FILE) as f:
                stored = json.load(f)
            for name, baseline in stored.items():
                monitors[name] = DriftMonitor(baseline)
            log.info("Drift baselines loaded from %s for %s",
                     DRIFT_BASELINE_FILE, sorted(monitors))
            return monitors
        except Exception as exc:  # corrupt file -> regenerate below
            log.warning("Failed to load drift baseline file %s (%s); "
                        "regenerating", DRIFT_BASELINE_FILE, exc)
    try:
        from ml.data.synthetic_platform_data import generate_platform_data
        log.info("No persisted drift baseline; regenerating from the "
                 "fixed-seed synthetic generator (seed=%d)",
                 DRIFT_BASELINE_SEED)
        data = generate_platform_data(seed=DRIFT_BASELINE_SEED)
        baselines = {
            "fraudnet": DriftMonitor.build_baseline(data.fraud_X),
            "creditnet": DriftMonitor.build_baseline(data.credit_X),
            "outcomenet": DriftMonitor.build_baseline(data.outcome_X),
            # Per-node GNN features (all nodes of the training graph).
            "disputegnn": DriftMonitor.build_baseline(data.gnn_x),
        }
        try:
            WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
            with open(DRIFT_BASELINE_FILE, "w") as f:
                json.dump(baselines, f)
            log.info("Persisted regenerated drift baselines to %s",
                     DRIFT_BASELINE_FILE)
        except OSError as exc:
            # Read-only mount (compose mounts the repo ro) — fine, keep the
            # in-memory baselines for this process lifetime.
            log.warning("Could not persist drift baseline (%s); using "
                        "in-memory baseline for this process", exc)
        return {name: DriftMonitor(b) for name, b in baselines.items()}
    except Exception as exc:
        log.warning("Drift baseline regeneration failed (%s: %s); drift "
                    "monitoring is UNAVAILABLE and will log loudly per "
                    "request", type(exc).__name__, exc)
        return {name: DriftMonitor() for name in MODEL_CLASSES}


# --------------------------------------------------------------------------- #
# In-process rate limiter (sliding window, per API key)                        #
# --------------------------------------------------------------------------- #
class RateLimiter:
    """Per-key sliding-window limiter. In-process only: acceptable because
    ml-service runs a single replica behind APISIX (which owns distributed
    quota). If replicas ever scale out, move this to APISIX limit-count or
    Redis."""

    def __init__(self, limit: int, window_seconds: float = 60.0):
        self.limit = limit
        self.window = window_seconds
        self._hits: Dict[str, deque] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            dq = self._hits.setdefault(key, deque())
            while dq and now - dq[0] > self.window:
                dq.popleft()
            if len(dq) >= self.limit:
                return False
            dq.append(now)
            return True


# --------------------------------------------------------------------------- #
# Model bundle loading                                                          #
# --------------------------------------------------------------------------- #
MODEL_CLASSES = {"fraudnet": FraudNet, "creditnet": CreditNet,
                 "outcomenet": OutcomeNet, "disputegnn": DisputeGNN}

_bundles: Dict[str, Dict[str, torch.nn.Module]] = {"champion": {}, "challenger": {}}
_ab = ABRouter(float(os.environ.get("AB_CHALLENGER_FRACTION", "0.10")))
_drift_monitors: Dict[str, DriftMonitor] = {}
_rate_limiter = RateLimiter(RATE_LIMIT_PER_MIN)


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
    # Build drift baselines AFTER weight loading so a slow regeneration does
    # not mask weight-load failures, and only once per process.
    global _drift_monitors
    if not _drift_monitors:
        _drift_monitors = _load_or_build_drift_baselines()
    if not ML_API_KEY and not ML_DEV_MODE:
        log.warning("ML_API_KEY is unset and ML_DEV_MODE is off: scoring "
                    "endpoints are FAIL-CLOSED (401) until ML_API_KEY is set")
    if not ML_API_KEY and ML_DEV_MODE:
        log.warning("ML_DEV_MODE is on: scoring endpoints are UNAUTHENTICATED "
                    "— local development only, never deploy this")


def _drift_for(model_name: str) -> DriftMonitor:
    mon = _drift_monitors.get(model_name)
    if mon is None:
        mon = DriftMonitor()  # unavailable: logs loudly per observe()
        _drift_monitors[model_name] = mon
    return mon


def _score(model_name: str, features: List[float], request_key: str) -> Dict:
    variant = _ab.assign(model_name, request_key)
    model = _bundles[variant].get(model_name) or _bundles["champion"].get(model_name)
    if model is None:
        raise RuntimeError(f"{model_name} weights not loaded")
    x = np.array(features, dtype=np.float32).reshape(1, -1)
    _drift_for(model_name).observe(model_name, x)
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
    _drift_for("disputegnn").observe("disputegnn", x.numpy())
    with torch.no_grad():
        probs = torch.sigmoid(model(x, adj)).tolist()
    return {"model": "disputegnn", "variant": variant,
            "node_anomaly_probabilities": probs}


# --------------------------------------------------------------------------- #
# Optional FastAPI app                                                          #
# --------------------------------------------------------------------------- #
def create_app():
    from fastapi import Depends, FastAPI, HTTPException
    from fastapi.security import APIKeyHeader

    api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

    def require_api_key(provided: Optional[str] = Depends(api_key_header)) -> str:
        """API-key auth + per-key rate limit for scoring endpoints.

        Fail-closed: if ML_API_KEY is not configured the only way to score is
        ML_DEV_MODE=1 (local development). A misconfigured production deploy
        therefore fails 401 on every request instead of silently serving an
        unauthenticated model endpoint.
        """
        if not ML_API_KEY:
            if ML_DEV_MODE:
                caller = "dev-unauthenticated"
            else:
                raise HTTPException(
                    401, "ML serving API key is not configured on this "
                         "service (fail-closed); set ML_API_KEY")
        else:
            if not provided or not hmac.compare_digest(provided, ML_API_KEY):
                raise HTTPException(401, "invalid or missing API key")
            caller = hashlib.sha256(provided.encode()).hexdigest()[:16]
        if not _rate_limiter.allow(caller):
            raise HTTPException(429, "rate limit exceeded",
                                headers={"Retry-After": "60"})
        return caller

    app = FastAPI(title="healthpoint-ml-serving")
    startup()

    @app.get("/health")
    def health():
        return {"status": "ok",
                "auth": "dev-mode" if not ML_API_KEY and ML_DEV_MODE
                        else ("configured" if ML_API_KEY else "fail-closed"),
                "drift_baselines": sorted(
                    n for n, m in _drift_monitors.items()
                    if m.baseline is not None),
                "models": {v: sorted(m.keys()) for v, m in _bundles.items()}}

    def _tab(name: str):
        def handler(req: TabularRequest, _caller: str = Depends(require_api_key)):
            try:
                return _score(name, req.features, req.request_key)
            except RuntimeError as exc:
                raise HTTPException(503, str(exc))
        return handler

    app.post("/fraud/score")(_tab("fraudnet"))
    app.post("/credit/score")(_tab("creditnet"))
    app.post("/outcome/score")(_tab("outcomenet"))

    @app.post("/gnn/score")
    def gnn(req: GNNRequest, _caller: str = Depends(require_api_key)):
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
