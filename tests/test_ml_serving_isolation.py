"""Wave-W3 ML serving isolation (EXECUTED-VERIFIED with corrupt fixture).

_load_variant must isolate per-model load failures: a corrupt champion or
challenger weight file degrades THAT model to 503 with a clear error and is
reported in /health's per-model detail — it must never kill startup.

The test builds a temporary ML_WEIGHTS_DIR containing one VALID weight file
(fraudnet) and one CORRUPT JSON file (creditnet), then boots the module and
asserts:
  1. startup() completes (no exception),
  2. fraudnet scores fine,
  3. creditnet scoring raises (endpoint would 503),
  4. /health detail reports fraudnet=loaded, creditnet=error.
"""
from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))


def _valid_weights(out: Path) -> None:
    """Produce a valid fraudnet weight bundle via the same JSON format the
    loader expects (load_weights_json)."""
    from ml.models.pytorch_models import FraudNet, save_weights_file

    save_weights_file(FraudNet(), str(out))


@pytest.fixture()
def serving(tmp_path, monkeypatch):
    weights = tmp_path / "weights"
    weights.mkdir()
    _valid_weights(weights / "fraudnet.json")
    (weights / "creditnet.json").write_text("{ this is not valid json !!!")

    monkeypatch.setenv("ML_WEIGHTS_DIR", str(weights))
    monkeypatch.setenv("ML_SERVING_FASTAPI", "0")   # library use; app built manually
    monkeypatch.setenv("ML_DEV_MODE", "1")
    # Prevent the drift-baseline regeneration from writing into tmp dirs.
    monkeypatch.setenv("ML_DRIFT_BASELINE_SEED", "42")

    for mod in ["ml.serving.inference"]:
        sys.modules.pop(mod, None)
    import ml.serving.inference as inference
    importlib.reload(inference)
    return inference


def test_corrupt_weights_do_not_kill_startup(serving):
    # startup must not raise even though creditnet.json is corrupt
    serving.startup()
    assert "fraudnet" in serving._bundles["champion"]
    assert "creditnet" not in serving._bundles["champion"]


def test_corrupt_model_degrades_to_503_error(serving):
    serving.startup()
    # healthy model still scores
    from ml.models.pytorch_models import FRAUD_FEATURE_DIM
    features = [0.0] * FRAUD_FEATURE_DIM
    try:
        result = serving._score("fraudnet", features, "key-1")
        assert 0.0 <= result["probability"] <= 1.0
    except RuntimeError as exc:
        pytest.fail(f"healthy model should score, got: {exc}")
    # corrupt model raises the RuntimeError that the endpoint maps to 503
    with pytest.raises(RuntimeError, match="creditnet weights not loaded"):
        serving._score("creditnet", features, "key-1")


def test_health_reports_per_model_load_status(serving, monkeypatch):
    monkeypatch.setenv("ML_SERVING_FASTAPI", "1")
    app = serving.create_app()
    from fastapi.testclient import TestClient

    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    detail = body["model_detail"]
    assert detail["fraudnet"]["champion"]["status"] == "loaded"
    assert detail["creditnet"]["champion"]["status"] == "error"
    assert "JSONDecodeError" in detail["creditnet"]["champion"]["detail"] or "Expecting" in detail["creditnet"]["champion"]["detail"]
    # the corrupt model is absent from the loaded inventory
    assert "creditnet" not in body["models"]["champion"]
    assert "fraudnet" in body["models"]["champion"]
