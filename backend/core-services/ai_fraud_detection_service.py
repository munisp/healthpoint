#!/usr/bin/env python3
"""
Healthcare Claims Platform - AI-Powered Fraud Detection Service
Hybrid ML/DL/GNN implementation with rule-based approaches for comprehensive fraud detection.

Author: Manus AI
Date: October 7, 2025
"""


# ── Shared HealthPoint infrastructure ─────────────────────────────────────────
import sys, os as _os
_repo_root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)
from backend.shared.database import fetch, fetchrow, execute, fetchval, transaction, bootstrap_schema, get_pool
from backend.shared.cache import get_client as get_redis_client, rate_limit_check, set_json, get_json
from backend.shared.auth import get_current_user, require_role, require_admin, require_provider, security_headers_middleware, TokenPayload
from backend.shared.messaging import publish, Topics
# ─────────────────────────────────────────────────────────────────────────────

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator, Field
from typing import List, Optional, Dict, Any, Union, Tuple
from datetime import datetime, timedelta
from enum import Enum
import uuid
import logging
import asyncio
import asyncpg
import json
import os
from contextlib import asynccontextmanager
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import GCNConv, GATConv, SAGEConv
from torch_geometric.data import Data, DataLoader
import networkx as nx
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score
import joblib
import mlflow
import mlflow.pytorch
import mlflow.sklearn
from collections import defaultdict, deque
import re
from decimal import Decimal
import hashlib

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI", "http://127.0.0.1:5000")

# Set up MLflow
mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)

class FraudRiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class DetectionMethod(str, Enum):
    RULE_BASED = "rule_based"
    MACHINE_LEARNING = "machine_learning"
    DEEP_LEARNING = "deep_learning"
    GRAPH_NEURAL_NETWORK = "graph_neural_network"
    ENSEMBLE = "ensemble"

class RuleType(str, Enum):
    THRESHOLD = "threshold"
    PATTERN = "pattern"
    ANOMALY = "anomaly"
    RELATIONSHIP = "relationship"
    TEMPORAL = "temporal"

class ModelType(str, Enum):
    ISOLATION_FOREST = "isolation_forest"
    RANDOM_FOREST = "random_forest"
    NEURAL_NETWORK = "neural_network"
    GCN = "graph_convolutional_network"
    GAT = "graph_attention_network"
    SAGE = "graph_sage"

# Pydantic Models
class ClaimData(BaseModel):
    id: str
    claim_number: str
    provider_id: str
    patient_id: str
    tenant_id: str
    total_amount: float
    diagnosis_codes: List[str]
    procedure_codes: List[str]
    service_date_from: datetime
    service_date_to: datetime
    submitted_at: datetime
    provider_info: Dict[str, Any] = {}
    patient_info: Dict[str, Any] = {}
    insurance_info: Dict[str, Any] = {}
    line_items: List[Dict[str, Any]] = []

class FraudRule(BaseModel):
    id: str
    name: str
    description: str
    rule_type: RuleType
    conditions: Dict[str, Any]
    threshold: Optional[float] = None
    severity: FraudRiskLevel
    active: bool = True
    tenant_specific: bool = False
    tenant_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

class FraudDetectionResult(BaseModel):
    claim_id: str
    risk_level: FraudRiskLevel
    risk_score: float
    confidence: float
    detection_methods: List[DetectionMethod]
    triggered_rules: List[str] = []
    ml_predictions: Dict[str, float] = {}
    anomaly_indicators: List[str] = []
    recommendations: List[str] = []
    requires_manual_review: bool = False
    tenant_id: str
    detected_at: datetime


# Database connection management
class DatabaseManager:
    def __init__(self):
        self.pool = None
        self.redis = None
    
    async def connect(self):
        try:
            self.pool = await asyncpg.create_pool(DATABASE_URL)
            self.redis = get_redis_client()
            logger.info("AI fraud detection database connections established")
        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            raise
    
    async def disconnect(self):
        if self.pool:
            await self.pool.close()
        if self.redis:
            await self.redis.close()
        logger.info("AI fraud detection database connections closed")

db_manager = DatabaseManager()


# Graph Neural Network Models


async def lifespan(app: FastAPI):
    await db_manager.connect()
    # Load models on startup
    # await fraud_predictor.load_all_models()
    yield
    await db_manager.disconnect()

app = FastAPI(

app.middleware("http")(security_headers_middleware)
    title="Healthcare Claims Platform - AI Fraud Detection Service",
    description="Hybrid ML/DL/GNN implementation with rule-based approaches for comprehensive fraud detection.",
    version="2.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),  # In production, restrict this to trusted origins
    allow_credentials=True,
    allow_methods=["*"]
)

fraud_predictor = FraudPredictor()

@app.post("/detect-fraud", response_model=FraudDetectionResult, status_code=status.HTTP_200_OK)
async def detect_fraud(claim: ClaimData, background_tasks: BackgroundTasks):
    """Detect potential fraud in a healthcare claim"""
    return await fraud_predictor.predict_fraud(claim, background_tasks)




class FraudPredictor:
    def __init__(self):
        self.models = {}
        self.gnn_models = {}
        self.scalers = {}

    async def _load_tenant_models(self, tenant_id: str) -> Dict[str, Any]:
        """Load ML models for a specific tenant from MLflow"""
        if tenant_id in self.models:
            return self.models[tenant_id]

        models = {}
        try:
            # Load latest models from MLflow Model Registry
            models["isolation_forest"] = mlflow.sklearn.load_model(f"models:/isolation_forest/latest")
            models["random_forest"] = mlflow.sklearn.load_model(f"models:/random_forest/latest")
            self.models[tenant_id] = models
            logger.info(f"Loaded models for tenant {tenant_id} from MLflow.")
        except Exception as e:
            logger.error(f"Failed to load models for tenant {tenant_id} from MLflow: {e}")

        return models

    async def _load_gnn_model(self, tenant_id: str, model_name: str = "gcn_model") -> Optional[nn.Module]:
        """Load GNN model from MLflow"""
        model_key = f"{tenant_id}_{model_name}"
        if model_key in self.gnn_models:
            return self.gnn_models[model_key]

        try:
            model = mlflow.pytorch.load_model(f"models:/{model_name}/latest")
            self.gnn_models[model_key] = model
            logger.info(f"Loaded GNN model '{model_name}' for tenant {tenant_id} from MLflow.")
            return model
        except Exception as e:
            logger.error(f"Failed to load GNN model '{model_name}' from MLflow: {e}")
            return None

    async def predict_fraud(self, claim: ClaimData, background_tasks: BackgroundTasks) -> FraudDetectionResult:
        detection_id = str(uuid.uuid4())
        
        try:
            # 1. Rule-based detection
            triggered_rules, rule_risk_score, rule_anomalies = await rule_engine.evaluate_claim(claim)
            
            # 2. Feature extraction
            features = await self._extract_features(claim)
            
            # 3. Machine learning predictions
            ml_predictions = await self._get_ml_predictions(claim, features)
            
            # 4. Graph neural network analysis
            gnn_prediction = await self._get_gnn_prediction(claim, features)
            
            # 5. Ensemble scoring
            final_risk_score, confidence = await self._calculate_ensemble_score(
                rule_risk_score, ml_predictions, gnn_prediction
            )
            
            # 6. Determine risk level
            risk_level = self._determine_risk_level(final_risk_score)
            
            # 7. Generate recommendations
            recommendations = await self._generate_recommendations(
                claim, triggered_rules, ml_predictions, final_risk_score
            )
            
            # 8. Determine if manual review is required
            requires_manual_review = (
                risk_level in [FraudRiskLevel.HIGH, FraudRiskLevel.CRITICAL] or
                len(triggered_rules) > 2 or
                final_risk_score > 0.8
            )
            
            # 9. Compile detection methods used
            detection_methods = [DetectionMethod.RULE_BASED]
            if ml_predictions:
                detection_methods.extend([DetectionMethod.MACHINE_LEARNING, DetectionMethod.DEEP_LEARNING])
            if gnn_prediction is not None:
                detection_methods.append(DetectionMethod.GRAPH_NEURAL_NETWORK)
            if len(detection_methods) > 1:
                detection_methods.append(DetectionMethod.ENSEMBLE)
            
            result = FraudDetectionResult(
                claim_id=claim.id,
                risk_level=risk_level,
                risk_score=final_risk_score,
                confidence=confidence,
                detection_methods=detection_methods,
                triggered_rules=triggered_rules,
                ml_predictions=ml_predictions,
                anomaly_indicators=rule_anomalies,
                recommendations=recommendations,
                requires_manual_review=requires_manual_review,
                tenant_id=claim.tenant_id,
                detected_at=datetime.utcnow()
            )
            
            # Store detection result
            background_tasks.add_task(self._store_detection_result, result)
            
            # Update claim with AI insights
            background_tasks.add_task(self._update_claim_ai_insights, claim.id, result)
            
            return result
            
        except Exception as e:
            logger.error(f"Fraud detection failed for claim {claim.id}: {e}")
            
            # Return safe default result
            return FraudDetectionResult(
                claim_id=claim.id,
                risk_level=FraudRiskLevel.MEDIUM,
                risk_score=0.5,
                confidence=0.0,
                detection_methods=[DetectionMethod.RULE_BASED],
                triggered_rules=[],
                ml_predictions={},
                anomaly_indicators=["Detection system error"],
                recommendations=["Manual review recommended due to system error"],
                requires_manual_review=True,
                tenant_id=claim.tenant_id,
                detected_at=datetime.utcnow()
            )
    
    async def _extract_features(self, claim: ClaimData) -> Dict[str, float]:
        """Extract features for ML models"""
        features = {}
        
        # Basic claim features
        features["total_amount"] = float(claim.total_amount)
        features["num_diagnosis_codes"] = len(claim.diagnosis_codes)
        features["num_procedure_codes"] = len(claim.procedure_codes)
        features["service_duration_days"] = (claim.service_date_to - claim.service_date_from).days
        features["submission_delay_hours"] = (claim.submitted_at - claim.service_date_to).total_seconds() / 3600
        
        # Time-based features
        features["submission_hour"] = claim.submitted_at.hour
        features["submission_day_of_week"] = claim.submitted_at.weekday()
        features["service_month"] = claim.service_date_from.month
        
        # Provider historical features
        async with db_manager.pool.acquire() as conn:
            # Provider claim history
            provider_stats = await conn.fetchrow("""
                SELECT 
                    COUNT(*) as total_claims,
                    AVG(total_amount) as avg_amount,
                    STDDEV(total_amount) as stddev_amount,
                    COUNT(DISTINCT patient_id) as unique_patients
                FROM claims 
                WHERE provider_id = $1 
                AND submitted_at > $2
            """, claim.provider_id, datetime.utcnow() - timedelta(days=90))
            
            if provider_stats:
                features["provider_total_claims"] = provider_stats["total_claims"] or 0
                features["provider_avg_amount"] = float(provider_stats["avg_amount"] or 0)
                features["provider_stddev_amount"] = float(provider_stats["stddev_amount"] or 0)
                features["provider_unique_patients"] = provider_stats["unique_patients"] or 0
            
            # Patient history
            patient_stats = await conn.fetchrow("""
                SELECT 
                    COUNT(*) as total_claims,
                    AVG(total_amount) as avg_amount,
                    COUNT(DISTINCT provider_id) as unique_providers
                FROM claims 
                WHERE patient_id = $1 
                AND submitted_at > $2
            """, claim.patient_id, datetime.utcnow() - timedelta(days=90))
            
            if patient_stats:
                features["patient_total_claims"] = patient_stats["total_claims"] or 0
                features["patient_avg_amount"] = float(patient_stats["avg_amount"] or 0)
                features["patient_unique_providers"] = patient_stats["unique_providers"] or 0
        
        # Encode categorical features
        features["primary_diagnosis_encoded"] = hash(claim.diagnosis_codes[0] if claim.diagnosis_codes else "") % 1000
        features["primary_procedure_encoded"] = hash(claim.procedure_codes[0] if claim.procedure_codes else "") % 1000
        
        return features
    
    async def _get_ml_predictions(self, claim: ClaimData, features: Dict[str, float]) -> Dict[str, float]:
        """Get predictions from traditional ML models"""
        predictions = {}
        
        try:
            # Load models for tenant
            tenant_models = await self._load_tenant_models(claim.tenant_id)
            
            # Prepare feature vector
            feature_names = sorted(features.keys())
            feature_vector = np.array([features[name] for name in feature_names]).reshape(1, -1)
            
            # Scale features if scaler exists
            scaler_key = f"{claim.tenant_id}_scaler"
            if scaler_key in self.scalers:
                feature_vector = self.scalers[scaler_key].transform(feature_vector)
            
            # Isolation Forest (Anomaly Detection)
            if "isolation_forest" in tenant_models:
                anomaly_score = tenant_models["isolation_forest"].decision_function(feature_vector)[0]
                predictions["isolation_forest_anomaly_score"] = float(anomaly_score)
                predictions["isolation_forest_is_anomaly"] = float(anomaly_score < 0)
            
            # Random Forest
            if "random_forest" in tenant_models:
                rf_proba = tenant_models["random_forest"].predict_proba(feature_vector)[0]
                predictions["random_forest_fraud_probability"] = float(rf_proba[1] if len(rf_proba) > 1 else 0)
            
        except Exception as e:
            logger.error(f"ML prediction failed: {e}")
        
        return predictions
    
    async def _get_gnn_prediction(self, claim: ClaimData, features: Dict[str, float]) -> Optional[float]:
        """Get prediction from Graph Neural Network"""
        try:
            # Build graph for claim
            graph_data = await self._build_claim_graph(claim, features)
            
            if graph_data is None:
                return None
            
            # Load GNN model
            gnn_model = await self._load_gnn_model(claim.tenant_id)
            
            if gnn_model is None:
                return None
            
            gnn_model.eval()
            
            with torch.no_grad():
                output = gnn_model(graph_data.x, graph_data.edge_index)
                proba = F.softmax(output, dim=1)
                
                # Get prediction for the claim node (assuming it's the first node)
                fraud_probability = float(proba[0][1] if proba.size(1) > 1 else 0)
                
                return fraud_probability
                
        except Exception as e:
            logger.error(f"GNN prediction failed: {e}")
            return None
    
    async def _build_claim_graph(self, claim: ClaimData, features: Dict[str, float]) -> Optional[Data]:
        """Build graph representation for claim"""
        try:
            async with db_manager.pool.acquire() as conn:
                # Get related entities (providers, patients, procedures)
                related_claims = await conn.fetch("""
                    SELECT id, provider_id, patient_id, procedure_codes, total_amount
                    FROM claims 
                    WHERE (provider_id = $1 OR patient_id = $2)
                    AND submitted_at > $3
                    AND id != $4
                    LIMIT 50
                """, 
                    claim.provider_id, claim.patient_id,
                    datetime.utcnow() - timedelta(days=30),
                    claim.id
                
            )

                if len(related_claims) < 2:
                    return None
                
                # Build node features and edges
                nodes = [claim.id]  # Current claim is node 0
                node_features = [list(features.values())]
                edges = []
                
                node_id_map = {claim.id: 0}
                
                # Add related claims as nodes
                for i, related_claim in enumerate(related_claims):
                    node_idx = i + 1
                    nodes.append(related_claim["id"])
                    node_id_map[related_claim["id"]] = node_idx
                    
                    # Create simplified features for related claims
                    related_features = [
                        float(related_claim["total_amount"]),
                        len(json.loads(related_claim["procedure_codes"]) if related_claim["procedure_codes"] else []),
                        1.0 if related_claim["provider_id"] == claim.provider_id else 0.0,
                        1.0 if related_claim["patient_id"] == claim.patient_id else 0.0
                    ]
                    
                    # Pad features to match main claim features
                    while len(related_features) < len(features):
                        related_features.append(0.0)
                    
                    node_features.append(related_features[:len(features)])
                    
                    # Add edges based on relationships
                    if (related_claim["provider_id"] == claim.provider_id or 
                        related_claim["patient_id"] == claim.patient_id):
                        edges.append([0, node_idx])  # Connect to main claim
                        edges.append([node_idx, 0])  # Bidirectional
                
                # Convert to PyTorch Geometric format
                x = torch.FloatTensor(node_features)
                edge_index = torch.LongTensor(edges).t().contiguous() if edges else torch.empty((2, 0), dtype=torch.long)
                
                return Data(x=x, edge_index=edge_index)
                
        except Exception as e:
            logger.error(f"Graph building failed: {e}")
            return None
    
    async def _calculate_ensemble_score(
        self, 
        rule_score: float, 
        ml_predictions: Dict[str, float], 
        gnn_prediction: Optional[float]
    ) -> Tuple[float, float]:
        """Calculate ensemble fraud score and confidence"""
        scores = []
        weights = []
        
        # Rule-based score (high weight for explainability)
        if rule_score > 0:
            scores.append(rule_score)
            weights.append(0.4)
        
        # ML model scores
        if "random_forest_fraud_probability" in ml_predictions:
            scores.append(ml_predictions["random_forest_fraud_probability"])
            weights.append(0.25)
        
        if "isolation_forest_is_anomaly" in ml_predictions:
            scores.append(ml_predictions["isolation_forest_is_anomaly"])
            weights.append(0.1)
        
        # GNN score
        if gnn_prediction is not None:
            scores.append(gnn_prediction)
            weights.append(0.25)
        
        if not scores:
            return 0.5, 0.0  # Default neutral score with no confidence
        
        # Normalize weights
        total_weight = sum(weights)
        normalized_weights = [w / total_weight for w in weights]
        
        # Calculate weighted average
        ensemble_score = sum(s * w for s, w in zip(scores, normalized_weights))
        
        # Calculate confidence based on agreement between methods
        if len(scores) > 1:
            score_variance = np.var(scores)
            confidence = max(0.0, 1.0 - score_variance)
        else:
            confidence = 0.5  # Medium confidence for single method
        
        return ensemble_score, confidence
    
    def _determine_risk_level(self, risk_score: float) -> FraudRiskLevel:
        """Determine risk level based on score"""
        if risk_score >= 0.8:
            return FraudRiskLevel.CRITICAL
        elif risk_score >= 0.6:
            return FraudRiskLevel.HIGH
        elif risk_score >= 0.4:
            return FraudRiskLevel.MEDIUM
        else:
            return FraudRiskLevel.LOW
    
    async def _generate_recommendations(
        self, 
        claim: ClaimData, 
        triggered_rules: List[str], 
        ml_predictions: Dict[str, float], 
        risk_score: float
    ) -> List[str]:
        """Generate actionable recommendations"""
        recommendations = []
        
        if risk_score >= 0.8:
            recommendations.append("Immediate manual review required - high fraud risk detected")
            recommendations.append("Consider suspending payment until investigation is complete")
        elif risk_score >= 0.6:
            recommendations.append("Detailed review recommended before processing payment")
            recommendations.append("Verify provider credentials and patient information")
        elif risk_score >= 0.4:
            recommendations.append("Standard verification procedures recommended")
        
        if len(triggered_rules) > 2:
            recommendations.append("Multiple fraud rules triggered - investigate rule violations")
        
        if ml_predictions.get("isolation_forest_is_anomaly", 0) > 0.5:
            recommendations.append("Claim flagged as anomalous by Isolation Forest model.")
        
        return recommendations

    async def _store_detection_result(self, result: FraudDetectionResult):
        """Persist fraud detection result to database."""
        try:
            if db_manager.pool:
                async with db_manager.pool.acquire() as conn:
                    await conn.execute("""
                        INSERT INTO fraud_detections (
                            id, claim_id, tenant_id, risk_score, risk_level,
                            confidence, detection_methods, triggered_rules,
                            ml_predictions, anomaly_indicators, recommendations,
                            requires_manual_review, detected_at
                        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                        ON CONFLICT (id) DO UPDATE SET
                            risk_score=EXCLUDED.risk_score,
                            risk_level=EXCLUDED.risk_level,
                            updated_at=NOW()
                    """,
                        result.claim_id + "-" + result.detected_at.strftime("%Y%m%d%H%M%S"),
                        result.claim_id, result.tenant_id,
                        result.risk_score, result.risk_level.value,
                        result.confidence,
                        ",".join(m.value for m in result.detection_methods),
                        ",".join(result.triggered_rules),
                        str(result.ml_predictions),
                        ",".join(result.anomaly_indicators),
                        ",".join(result.recommendations),
                        result.requires_manual_review,
                        result.detected_at,
                )
        except Exception as e:
            logger.warning(f"Failed to store detection result: {e}")

    async def handle_feedback(self, feedback: FeedbackData):
        """Process feedback and trigger model retraining if necessary."""
        try:
            async with db_manager.pool.acquire() as conn:
                # Store feedback in the database
                await conn.execute("""
                    INSERT INTO detection_feedback (claim_id, is_correct, corrected_risk_level, feedback_notes)
                    VALUES ($1, $2, $3, $4)
                """, feedback.claim_id, feedback.is_correct, feedback.corrected_risk_level, feedback.feedback_notes)

                # If the prediction was incorrect, update the training data
                if not feedback.is_correct:
                    await conn.execute("""
                    UPDATE historical_claims SET is_fraud = $1 WHERE id = $2
                    """, feedback.corrected_risk_level in [FraudRiskLevel.HIGH, FraudRiskLevel.CRITICAL], feedback.claim_id)

            # Trigger retraining after a certain number of feedbacks
            feedback_count = await db_manager.redis.incr("feedback_count")
            if feedback_count >= 100:  # Retrain after 100 feedbacks
                await db_manager.redis.set("feedback_count", 0)
                logger.info("Triggering model retraining due to feedback threshold.")
                # In a real system, this would trigger a CI/CD pipeline or a dedicated training job.
                # For this simulation, we'll just log it.
                # os.system("python3 /home/ubuntu/ai-ml-dl-implementation/model_training_pipeline.py")

        except Exception as e:
            logger.error(f"Failed to handle feedback: {e}")





        except Exception as e:
            logger.warning(f"Failed to store detection result: {e}")

    async def _update_claim_ai_insights(self, claim_id: str, result: FraudDetectionResult):
        """Update the claim record with AI fraud detection insights."""
        try:
            if db_manager.pool:
                async with db_manager.pool.acquire() as conn:
                    await conn.execute("""
                        UPDATE claims SET
                            fraud_risk_score=$1,
                            fraud_risk_level=$2,
                            fraud_requires_review=$3,
                            fraud_checked_at=$4
                        WHERE id=$5
                    """,
                        result.risk_score, result.risk_level.value,
                        claim_id,
                )
        except Exception as e:
            logger.warning(f"Failed to update claim AI insights for {claim_id}: {e}")





class FeedbackData(BaseModel):
    claim_id: str
    is_correct: bool
    corrected_risk_level: Optional[FraudRiskLevel] = None
    feedback_notes: Optional[str] = None

@app.post("/feedback", status_code=status.HTTP_202_ACCEPTED)
async def receive_feedback(feedback: FeedbackData, background_tasks: BackgroundTasks):
    """Receive feedback on fraud detection results to enable continuous learning."""
    background_tasks.add_task(fraud_predictor.handle_feedback, feedback)
    return {"message": "Feedback received and queued for processing."}




async def _ensure_fraud_schema():
    """Ensure fraud detection tables exist — called at startup."""
    if not db_manager.pool:
        return
    async with db_manager.pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS historical_claims (
                id UUID PRIMARY KEY,
                claim_number VARCHAR(255) NOT NULL,
                provider_id VARCHAR(255) NOT NULL,
                patient_id VARCHAR(255) NOT NULL,
                tenant_id VARCHAR(255) NOT NULL,
                total_amount NUMERIC(10, 2) NOT NULL,
                diagnosis_codes TEXT[] NOT NULL,
                procedure_codes TEXT[] NOT NULL,
                service_date_from TIMESTAMP NOT NULL,
                service_date_to TIMESTAMP NOT NULL,
                submitted_at TIMESTAMP NOT NULL,
                is_fraud BOOLEAN NOT NULL DEFAULT FALSE
            );
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS detection_feedback (
                id SERIAL PRIMARY KEY,
                claim_id UUID NOT NULL,
                is_correct BOOLEAN NOT NULL,
                corrected_risk_level VARCHAR(50),
                feedback_notes TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        """)
        logger.info("Database schema created or already exists.")

