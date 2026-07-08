#!/usr/bin/env python3
"""
HealthPoint Platform — ML Training Service (Port 8036)
Exposes REST API for:
  • Model training (FraudGNN, CreditScoringDNN, IDROutcomePredictor)
  • A/B test management (create, route, record outcomes, evaluate, promote)
  • Drift detection (feature drift via PSI, performance drift via rolling AUC)
  • Continuous training pipeline (trigger, status, history)
  • MLflow experiment/run browser
  • Model registry (list versions, promote champion, rollback)
"""

from __future__ import annotations

import json
import logging
import os
import sys
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import asyncpg
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Add repo root to path for shared imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))

from backend.ml.ml_infrastructure import (
    ABTestingFramework,
    ContinuousTrainingPipeline,
    ModelDriftDetector,
    ModelTrainer,
    ML_SCHEMA_SQL,
)
from backend.shared.auth import TokenPayload, get_current_user
from backend.shared.database import bootstrap_schema, get_pool
from backend.shared.telemetry import instrument_fastapi, setup_telemetry
from backend.shared.security_middleware import security_headers_middleware

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

# ─────────────────────────────── Pydantic Models ─────────────────────────────

class TrainModelRequest(BaseModel):
    model_type: str = Field(..., description="fraud_detection | credit_scoring | idr_outcome")
    tenant_id: str
    epochs: Optional[int] = None
    lr: Optional[float] = None
    batch_size: Optional[int] = None
    use_ray: bool = False

class CreateABExperimentRequest(BaseModel):
    name: str
    champion_model_id: str
    challenger_model_id: str
    challenger_traffic_pct: float = Field(0.10, ge=0.01, le=0.50)
    success_metric: str = "auc"
    min_samples: int = 1000
    confidence_level: float = 0.95

class RecordOutcomeRequest(BaseModel):
    experiment_id: str
    request_id: str
    model_variant: str
    prediction: float
    ground_truth: Optional[float] = None
    latency_ms: float

class DriftCheckRequest(BaseModel):
    model_id: str
    tenant_id: str
    feature_names: List[str]
    reference_window_days: int = 30
    current_window_days: int = 7

class PerformanceDriftRequest(BaseModel):
    model_id: str
    tenant_id: str
    metric: str = "auc"
    window_days: int = 7
    baseline_days: int = 30

class PromoteModelRequest(BaseModel):
    model_version_id: str
    tenant_id: str
    promoted_by: str

# ─────────────────────────────── App Setup ───────────────────────────────────

setup_telemetry(service_name="ml-training-service", service_version="1.0.0")

app = FastAPI(
    title="HealthPoint — ML Training Service",
    description="End-to-end ML model training, A/B testing, drift detection, and continuous pipeline",
    version="1.0.0",
)

instrument_fastapi(app)
app.middleware("http")(security_headers_middleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_db_pool: Optional[asyncpg.Pool] = None
_trainer: Optional[ModelTrainer] = None
_pipeline: Optional[ContinuousTrainingPipeline] = None
_ab_framework: Optional[ABTestingFramework] = None
_drift_detector: Optional[ModelDriftDetector] = None


@app.on_event("startup")
async def startup():
    global _db_pool, _trainer, _pipeline, _ab_framework, _drift_detector
    _db_pool = await get_pool()
    await bootstrap_schema(_db_pool, ML_SCHEMA_SQL)
    _trainer = ModelTrainer(db_pool=_db_pool)
    _pipeline = ContinuousTrainingPipeline(db_pool=_db_pool)
    _ab_framework = ABTestingFramework(db_pool=_db_pool)
    _drift_detector = ModelDriftDetector(db_pool=_db_pool)
    logger.info("ML Training Service started")


@app.on_event("shutdown")
async def shutdown():
    if _db_pool:
        await _db_pool.close()


# ─────────────────────────────── Health ──────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "ml-training-service", "timestamp": datetime.utcnow().isoformat()}


# ─────────────────────────────── Training Endpoints ──────────────────────────

@app.post("/train", status_code=status.HTTP_202_ACCEPTED)
async def trigger_training(
    req: TrainModelRequest,
    background_tasks: BackgroundTasks,
    current_user: TokenPayload = Depends(get_current_user),
):
    """
    Trigger model training asynchronously.
    Supports: fraud_detection (FraudGNN), credit_scoring (DNN), idr_outcome (MLP).
    Uses production DB data; falls back to synthetic US healthcare data for cold-start.
    """
    valid_types = {"fraud_detection", "credit_scoring", "idr_outcome"}
    if req.model_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model_type. Must be one of: {valid_types}",
        )

    job_id = str(uuid.uuid4())

    async def run_training():
        kwargs: Dict[str, Any] = {}
        if req.epochs is not None:
            kwargs["epochs"] = req.epochs
        if req.lr is not None:
            kwargs["lr"] = req.lr
        if req.batch_size is not None:
            kwargs["batch_size"] = req.batch_size

        try:
            result = await _pipeline.run_training_job(
                model_type=req.model_type,
                tenant_id=req.tenant_id,
                triggered_by=f"api_user:{current_user.sub}",
                use_ray=req.use_ray,
                **kwargs,
            )
            # Persist job result
            if _db_pool:
                async with _db_pool.acquire() as conn:
                    await conn.execute(
                        """
                        INSERT INTO training_jobs (id, model_type, tenant_id, status, result, created_at)
                        VALUES ($1,$2,$3,'completed',$4,NOW())
                        ON CONFLICT (id) DO UPDATE SET status='completed', result=$4
                        """,
                        job_id, req.model_type, req.tenant_id, json.dumps(result),
                    )
        except Exception as e:
            logger.error("Training job %s failed: %s", job_id, e)
            if _db_pool:
                async with _db_pool.acquire() as conn:
                    await conn.execute(
                        """
                        INSERT INTO training_jobs (id, model_type, tenant_id, status, error, created_at)
                        VALUES ($1,$2,$3,'failed',$4,NOW())
                        ON CONFLICT (id) DO UPDATE SET status='failed', error=$4
                        """,
                        job_id, req.model_type, req.tenant_id, str(e),
                    )

    background_tasks.add_task(run_training)

    return {
        "job_id": job_id,
        "status": "queued",
        "model_type": req.model_type,
        "tenant_id": req.tenant_id,
        "message": "Training job queued. Poll /train/jobs/{job_id} for status.",
    }


@app.get("/train/jobs/{job_id}")
async def get_training_job(
    job_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get training job status and results."""
    if not _db_pool:
        raise HTTPException(status_code=503, detail="Database unavailable")

    async with _db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM training_jobs WHERE id = $1", job_id
        )

    if not row:
        raise HTTPException(status_code=404, detail="Training job not found")

    result = dict(row)
    if result.get("result"):
        result["result"] = json.loads(result["result"])
    return result


@app.get("/train/jobs")
async def list_training_jobs(
    tenant_id: str = Query(...),
    model_type: Optional[str] = Query(None),
    limit: int = Query(20, le=100),
    current_user: TokenPayload = Depends(get_current_user),
):
    """List recent training jobs for a tenant."""
    if not _db_pool:
        raise HTTPException(status_code=503, detail="Database unavailable")

    async with _db_pool.acquire() as conn:
        if model_type:
            rows = await conn.fetch(
                """
                SELECT id, model_type, tenant_id, status, created_at
                FROM training_jobs
                WHERE tenant_id = $1 AND model_type = $2
                ORDER BY created_at DESC LIMIT $3
                """,
                tenant_id, model_type, limit,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT id, model_type, tenant_id, status, created_at
                FROM training_jobs
                WHERE tenant_id = $1
                ORDER BY created_at DESC LIMIT $2
                """,
                tenant_id, limit,
            )

    return [dict(r) for r in rows]


@app.get("/models")
async def list_model_versions(
    tenant_id: str = Query(...),
    model_type: Optional[str] = Query(None),
    current_user: TokenPayload = Depends(get_current_user),
):
    """List all trained model versions for a tenant."""
    if not _db_pool:
        raise HTTPException(status_code=503, detail="Database unavailable")

    async with _db_pool.acquire() as conn:
        if model_type:
            rows = await conn.fetch(
                """
                SELECT id, model_type, tenant_id, mlflow_run_id, metrics,
                       triggered_by, training_duration_seconds, is_champion, trained_at
                FROM ml_model_versions
                WHERE tenant_id = $1 AND model_type = $2
                ORDER BY trained_at DESC
                """,
                tenant_id, model_type,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT id, model_type, tenant_id, mlflow_run_id, metrics,
                       triggered_by, training_duration_seconds, is_champion, trained_at
                FROM ml_model_versions
                WHERE tenant_id = $1
                ORDER BY trained_at DESC
                """,
                tenant_id,
            )

    result = []
    for r in rows:
        row = dict(r)
        if row.get("metrics"):
            row["metrics"] = json.loads(row["metrics"]) if isinstance(row["metrics"], str) else row["metrics"]
        result.append(row)
    return result


@app.post("/models/promote")
async def promote_model_to_champion(
    req: PromoteModelRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Manually promote a model version to champion."""
    if not _db_pool:
        raise HTTPException(status_code=503, detail="Database unavailable")

    async with _db_pool.acquire() as conn:
        # Verify model exists
        model = await conn.fetchrow(
            "SELECT id, model_type FROM ml_model_versions WHERE id = $1 AND tenant_id = $2",
            req.model_version_id, req.tenant_id,
        )
        if not model:
            raise HTTPException(status_code=404, detail="Model version not found")

        # Demote current champion
        await conn.execute(
            """
            UPDATE ml_model_versions SET is_champion = false
            WHERE tenant_id = $1 AND model_type = $2 AND is_champion = true
            """,
            req.tenant_id, model["model_type"],
        )

        # Promote new champion
        await conn.execute(
            "UPDATE ml_model_versions SET is_champion = true WHERE id = $1",
            req.model_version_id,
        )

    return {
        "success": True,
        "promoted_model_id": req.model_version_id,
        "promoted_by": req.promoted_by,
        "promoted_at": datetime.utcnow().isoformat(),
    }


# ─────────────────────────────── Should-Retrain Check ────────────────────────

@app.get("/train/should-retrain")
async def check_should_retrain(
    model_type: str = Query(...),
    tenant_id: str = Query(...),
    min_new_records: int = Query(500),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Check if a model should be retrained based on data volume and schedule."""
    should, reason = await _pipeline.should_retrain(
        model_type=model_type,
        tenant_id=tenant_id,
        min_new_records=min_new_records,
    )
    return {"should_retrain": should, "reason": reason}


# ─────────────────────────────── A/B Testing Endpoints ───────────────────────

@app.post("/ab-tests", status_code=status.HTTP_201_CREATED)
async def create_ab_experiment(
    req: CreateABExperimentRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create a new A/B test between champion and challenger models."""
    experiment_id = await _ab_framework.create_experiment(
        name=req.name,
        champion_model_id=req.champion_model_id,
        challenger_model_id=req.challenger_model_id,
        challenger_traffic_pct=req.challenger_traffic_pct,
        success_metric=req.success_metric,
        min_samples=req.min_samples,
        confidence_level=req.confidence_level,
    )
    return {"experiment_id": experiment_id, "status": "running"}


@app.get("/ab-tests/{experiment_id}/route")
async def route_ab_request(
    experiment_id: str,
    request_id: str = Query(...),
    challenger_traffic_pct: float = Query(0.10),
):
    """Deterministically route a request to champion or challenger model."""
    variant = _ab_framework.route_request(
        experiment_id=experiment_id,
        request_id=request_id,
        challenger_traffic_pct=challenger_traffic_pct,
    )
    return {"experiment_id": experiment_id, "request_id": request_id, "variant": variant}


@app.post("/ab-tests/{experiment_id}/outcomes")
async def record_ab_outcome(
    experiment_id: str,
    req: RecordOutcomeRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Record a prediction outcome for A/B test analysis."""
    await _ab_framework.record_outcome(
        experiment_id=experiment_id,
        request_id=req.request_id,
        model_variant=req.model_variant,
        prediction=req.prediction,
        ground_truth=req.ground_truth,
        latency_ms=req.latency_ms,
    )
    return {"recorded": True}


@app.get("/ab-tests/{experiment_id}/evaluate")
async def evaluate_ab_experiment(
    experiment_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """
    Evaluate A/B test using two-proportion z-test.
    Returns statistical significance, p-value, and recommendation.
    """
    result = await _ab_framework.evaluate_experiment(experiment_id)
    return result


@app.post("/ab-tests/{experiment_id}/promote")
async def promote_ab_challenger(
    experiment_id: str,
    promoted_by: str = Query(...),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Promote the challenger model to champion after a successful A/B test."""
    success = await _ab_framework.promote_challenger(
        experiment_id=experiment_id,
        promoted_by=promoted_by,
    )
    return {"success": success, "experiment_id": experiment_id}


@app.get("/ab-tests")
async def list_ab_experiments(
    status_filter: Optional[str] = Query(None),
    limit: int = Query(20, le=100),
    current_user: TokenPayload = Depends(get_current_user),
):
    """List all A/B test experiments."""
    if not _db_pool:
        raise HTTPException(status_code=503, detail="Database unavailable")

    async with _db_pool.acquire() as conn:
        if status_filter:
            rows = await conn.fetch(
                """
                SELECT id, name, champion_model_id, challenger_model_id,
                       challenger_traffic_pct, success_metric, status, created_at
                FROM ab_test_experiments
                WHERE status = $1
                ORDER BY created_at DESC LIMIT $2
                """,
                status_filter, limit,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT id, name, champion_model_id, challenger_model_id,
                       challenger_traffic_pct, success_metric, status, created_at
                FROM ab_test_experiments
                ORDER BY created_at DESC LIMIT $1
                """,
                limit,
            )

    return [dict(r) for r in rows]


# ─────────────────────────────── Drift Detection Endpoints ───────────────────

@app.post("/drift/feature")
async def check_feature_drift(
    req: DriftCheckRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """
    Check feature distribution drift using Population Stability Index (PSI).
    PSI < 0.10: stable | 0.10–0.25: moderate drift | > 0.25: significant drift.
    """
    result = await _drift_detector.check_feature_drift(
        model_id=req.model_id,
        tenant_id=req.tenant_id,
        feature_names=req.feature_names,
        reference_window_days=req.reference_window_days,
        current_window_days=req.current_window_days,
    )
    return result


@app.post("/drift/performance")
async def check_performance_drift(
    req: PerformanceDriftRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """
    Check model performance degradation using rolling window AUC comparison.
    Triggers retraining alert if AUC drops by more than 5%.
    """
    result = await _drift_detector.check_performance_drift(
        model_id=req.model_id,
        tenant_id=req.tenant_id,
        metric=req.metric,
        window_days=req.window_days,
        baseline_days=req.baseline_days,
    )
    return result


@app.post("/drift/run-all-checks")
async def run_all_drift_checks(
    tenant_id: str = Query(...),
    background_tasks: BackgroundTasks = None,
    current_user: TokenPayload = Depends(get_current_user),
):
    """
    Run drift checks for all active models for a tenant.
    Automatically triggers retraining if drift is detected.
    """
    if background_tasks:
        background_tasks.add_task(_pipeline.run_drift_checks, tenant_id)
        return {"status": "drift_checks_queued", "tenant_id": tenant_id}
    else:
        result = await _pipeline.run_drift_checks(tenant_id)
        return result


# ─────────────────────────────── Continuous Pipeline Endpoints ───────────────

@app.post("/pipeline/trigger")
async def trigger_continuous_pipeline(
    tenant_id: str = Query(...),
    model_type: str = Query(...),
    background_tasks: BackgroundTasks = None,
    current_user: TokenPayload = Depends(get_current_user),
):
    """
    Manually trigger the continuous training pipeline for a specific model.
    Checks if retraining is warranted before executing.
    """
    should, reason = await _pipeline.should_retrain(model_type, tenant_id)

    if not should:
        return {
            "triggered": False,
            "reason": reason,
            "message": "Retraining not warranted at this time",
        }

    job_id = str(uuid.uuid4())
    if background_tasks:
        background_tasks.add_task(
            _pipeline.run_training_job,
            model_type=model_type,
            tenant_id=tenant_id,
            triggered_by="manual_pipeline_trigger",
        )

    return {
        "triggered": True,
        "job_id": job_id,
        "reason": reason,
        "model_type": model_type,
        "tenant_id": tenant_id,
    }


@app.get("/pipeline/history")
async def get_pipeline_history(
    tenant_id: str = Query(...),
    limit: int = Query(50, le=200),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get continuous training pipeline execution history."""
    if not _db_pool:
        raise HTTPException(status_code=503, detail="Database unavailable")

    async with _db_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, model_type, mlflow_run_id, metrics,
                   triggered_by, training_duration_seconds, is_champion, trained_at
            FROM ml_model_versions
            WHERE tenant_id = $1
            ORDER BY trained_at DESC LIMIT $2
            """,
            tenant_id, limit,
        )

    result = []
    for r in rows:
        row = dict(r)
        if row.get("metrics"):
            row["metrics"] = json.loads(row["metrics"]) if isinstance(row["metrics"], str) else row["metrics"]
        result.append(row)
    return result


# ─────────────────────────────── MLflow Proxy Endpoints ──────────────────────

@app.get("/mlflow/experiments")
async def list_mlflow_experiments(
    current_user: TokenPayload = Depends(get_current_user),
):
    """List all MLflow experiments."""
    import mlflow
    mlflow.set_tracking_uri(os.getenv("MLFLOW_TRACKING_URI", "http://mlflow:5000"))
    try:
        experiments = mlflow.search_experiments()
        return [
            {
                "experiment_id": e.experiment_id,
                "name": e.name,
                "artifact_location": e.artifact_location,
                "lifecycle_stage": e.lifecycle_stage,
            }
            for e in experiments
        ]
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"MLflow unavailable: {e}")


@app.get("/mlflow/runs")
async def list_mlflow_runs(
    experiment_name: str = Query(...),
    max_results: int = Query(20, le=100),
    current_user: TokenPayload = Depends(get_current_user),
):
    """List recent MLflow runs for an experiment."""
    import mlflow
    mlflow.set_tracking_uri(os.getenv("MLFLOW_TRACKING_URI", "http://mlflow:5000"))
    try:
        runs = mlflow.search_runs(
            experiment_names=[experiment_name],
            max_results=max_results,
            order_by=["start_time DESC"],
        )
        return runs.to_dict(orient="records") if not runs.empty else []
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"MLflow unavailable: {e}")


# ─────────────────────────────── DB Schema Bootstrap ─────────────────────────

TRAINING_JOBS_SCHEMA = """
CREATE TABLE IF NOT EXISTS training_jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_type  VARCHAR(100) NOT NULL,
    tenant_id   UUID NOT NULL,
    status      VARCHAR(50) DEFAULT 'queued',
    result      JSONB,
    error       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_training_jobs_tenant ON training_jobs(tenant_id, model_type, created_at);
"""
