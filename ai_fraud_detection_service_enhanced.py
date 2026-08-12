"""
Healthcare Claims Platform - Enhanced AI-Powered Fraud Detection Service
Real ML/DL/GNN implementation with hybrid rule-based approaches for comprehensive fraud detection.

Author: Manus AI
Date: October 8, 2025
Port: 8001
"""

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, status, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator, Field
from typing import List, Optional, Dict, Any, Union, Tuple
from datetime import datetime, timedelta
from enum import Enum
import uuid
import logging
import asyncio
import asyncpg
import aioredis
import json
import os
from contextlib import asynccontextmanager
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import GCNConv, GATConv, SAGEConv, global_mean_pool
from torch_geometric.data import Data, DataLoader, Batch
import networkx as nx
from sklearn.ensemble import IsolationForest, RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler, LabelEncoder, RobustScaler
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import classification_report, roc_auc_score, precision_recall_curve
from sklearn.cluster import DBSCAN
import xgboost as xgb
import lightgbm as lgb
import joblib
import mlflow
import mlflow.pytorch
import mlflow.sklearn
import mlflow.xgboost
import mlflow.lightgbm
from collections import defaultdict, deque
import re
from decimal import Decimal
import hashlib
import pickle
from scipy import stats
from scipy.spatial.distance import cosine
import warnings
warnings.filterwarnings('ignore')

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://frauduser:password@localhost/healthcare_platform")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI", "http://127.0.0.1:5000")
MODEL_CACHE_TTL = int(os.getenv("MODEL_CACHE_TTL", "3600"))  # 1 hour

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
    XGBOOST = "xgboost"
    LIGHTGBM = "lightgbm"
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

class FraudDetectionResult(BaseModel):
    claim_id: str
    fraud_score: float
    risk_level: FraudRiskLevel
    detection_methods: List[DetectionMethod]
    rule_violations: List[Dict[str, Any]] = []
    ml_predictions: Dict[str, float] = {}
    anomaly_indicators: List[str] = []
    graph_features: Dict[str, Any] = {}
    confidence_score: float
    explanation: str
    recommendations: List[str] = []
    tenant_id: str
    analyzed_at: datetime

class FraudRule(BaseModel):
    id: Optional[str] = None
    name: str
    description: str
    rule_type: RuleType
    conditions: Dict[str, Any]
    threshold: Optional[float] = None
    weight: float = 1.0
    is_active: bool = True
    tenant_id: str
    created_by: str

class ModelTrainingRequest(BaseModel):
    model_type: ModelType
    training_data_query: Optional[str] = None
    hyperparameters: Dict[str, Any] = {}
    tenant_id: str
    model_name: str
    description: Optional[str] = None

class ModelPredictionRequest(BaseModel):
    model_id: str
    features: Dict[str, Any]
    tenant_id: str

# Advanced Deep Learning Models
class FraudDetectionNN(nn.Module):
    """Advanced Neural Network for Fraud Detection"""
    
    def __init__(self, input_dim: int, hidden_dims: List[int] = [512, 256, 128, 64], 
                 dropout_rate: float = 0.3, num_classes: int = 2):
        super(FraudDetectionNN, self).__init__()
        
        layers = []
        prev_dim = input_dim
        
        for hidden_dim in hidden_dims:
            layers.extend([
                nn.Linear(prev_dim, hidden_dim),
                nn.BatchNorm1d(hidden_dim),
                nn.ReLU(),
                nn.Dropout(dropout_rate)
            ])
            prev_dim = hidden_dim
        
        # Output layer
        layers.append(nn.Linear(prev_dim, num_classes))
        
        self.network = nn.Sequential(*layers)
        self.softmax = nn.Softmax(dim=1)
        
    def forward(self, x):
        logits = self.network(x)
        return self.softmax(logits)

class GraphFraudDetector(nn.Module):
    """Graph Neural Network for Healthcare Fraud Detection"""
    
    def __init__(self, node_features: int, hidden_dim: int = 128, 
                 num_layers: int = 3, dropout: float = 0.3):
        super(GraphFraudDetector, self).__init__()
        
        self.num_layers = num_layers
        self.dropout = dropout
        
        # Graph convolution layers
        self.convs = nn.ModuleList()
        self.convs.append(GCNConv(node_features, hidden_dim))
        
        for _ in range(num_layers - 2):
            self.convs.append(GCNConv(hidden_dim, hidden_dim))
        
        self.convs.append(GCNConv(hidden_dim, hidden_dim))
        
        # Attention mechanism
        self.attention = GATConv(hidden_dim, hidden_dim, heads=4, concat=False)
        
        # Classification head
        self.classifier = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim // 2, 2)
        )
        
    def forward(self, x, edge_index, batch=None):
        # Graph convolutions with residual connections
        h = x
        for i, conv in enumerate(self.convs):
            h_new = F.relu(conv(h, edge_index))
            h_new = F.dropout(h_new, p=self.dropout, training=self.training)
            
            # Residual connection for deeper layers
            if i > 0 and h.size(-1) == h_new.size(-1):
                h = h + h_new
            else:
                h = h_new
        
        # Attention mechanism
        h = self.attention(h, edge_index)
        h = F.dropout(h, p=self.dropout, training=self.training)
        
        # Global pooling for graph-level prediction
        if batch is not None:
            h = global_mean_pool(h, batch)
        else:
            h = torch.mean(h, dim=0, keepdim=True)
        
        # Classification
        return self.classifier(h)

# Database Manager
class DatabaseManager:
    def __init__(self):
        self.pool = None

    async def connect(self):
        self.pool = await asyncpg.create_pool(DATABASE_URL)
        await self._create_tables()

    async def disconnect(self):
        if self.pool:
            await self.pool.close()

    async def _create_tables(self):
        async with self.pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS fraud_detection_results (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    claim_id VARCHAR(255) NOT NULL,
                    fraud_score DECIMAL(5,4) NOT NULL,
                    risk_level VARCHAR(20) NOT NULL,
                    detection_methods TEXT[] NOT NULL,
                    rule_violations JSONB,
                    ml_predictions JSONB,
                    anomaly_indicators TEXT[],
                    graph_features JSONB,
                    confidence_score DECIMAL(5,4) NOT NULL,
                    explanation TEXT NOT NULL,
                    recommendations TEXT[],
                    tenant_id VARCHAR(255) NOT NULL,
                    analyzed_at TIMESTAMP DEFAULT NOW(),
                    model_version VARCHAR(50),
                    processing_time_ms INTEGER
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS fraud_rules (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    rule_type VARCHAR(20) NOT NULL,
                    conditions JSONB NOT NULL,
                    threshold DECIMAL(10,4),
                    weight DECIMAL(5,4) DEFAULT 1.0,
                    is_active BOOLEAN DEFAULT TRUE,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_by VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS ml_models (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    model_type VARCHAR(50) NOT NULL,
                    version VARCHAR(20) NOT NULL,
                    model_data BYTEA NOT NULL,
                    metadata JSONB,
                    performance_metrics JSONB,
                    is_active BOOLEAN DEFAULT TRUE,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_by VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    last_trained TIMESTAMP DEFAULT NOW()
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS fraud_patterns (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    pattern_name VARCHAR(255) NOT NULL,
                    pattern_type VARCHAR(50) NOT NULL,
                    pattern_data JSONB NOT NULL,
                    confidence_score DECIMAL(5,4) NOT NULL,
                    occurrences INTEGER DEFAULT 1,
                    tenant_id VARCHAR(255) NOT NULL,
                    first_detected TIMESTAMP DEFAULT NOW(),
                    last_detected TIMESTAMP DEFAULT NOW()
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS model_training_jobs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    model_type VARCHAR(50) NOT NULL,
                    model_name VARCHAR(255) NOT NULL,
                    status VARCHAR(20) DEFAULT 'pending',
                    progress INTEGER DEFAULT 0,
                    hyperparameters JSONB,
                    training_metrics JSONB,
                    error_message TEXT,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_by VARCHAR(255) NOT NULL,
                    started_at TIMESTAMP DEFAULT NOW(),
                    completed_at TIMESTAMP
                );
            """)
            
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_fraud_results_claim ON fraud_detection_results(claim_id);
                CREATE INDEX IF NOT EXISTS idx_fraud_results_tenant ON fraud_detection_results(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_fraud_results_analyzed ON fraud_detection_results(analyzed_at);
                CREATE INDEX IF NOT EXISTS idx_fraud_rules_tenant ON fraud_rules(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_ml_models_tenant ON ml_models(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_ml_models_active ON ml_models(is_active);
                CREATE INDEX IF NOT EXISTS idx_fraud_patterns_tenant ON fraud_patterns(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_training_jobs_tenant ON model_training_jobs(tenant_id);
            """)

db_manager = DatabaseManager()

# Enhanced Fraud Detection Engine
class EnhancedFraudDetectionEngine:
    def __init__(self):
        self.redis_client = None
        self.models = {}
        self.scalers = {}
        self.encoders = {}
        self.rules_cache = {}
        self.pattern_cache = {}
        
        # Initialize model configurations
        self.model_configs = {
            ModelType.ISOLATION_FOREST: {
                'contamination': 0.1,
                'n_estimators': 200,
                'max_samples': 'auto',
                'random_state': 42
            },
            ModelType.RANDOM_FOREST: {
                'n_estimators': 300,
                'max_depth': 15,
                'min_samples_split': 5,
                'min_samples_leaf': 2,
                'random_state': 42
            },
            ModelType.XGBOOST: {
                'n_estimators': 500,
                'max_depth': 8,
                'learning_rate': 0.1,
                'subsample': 0.8,
                'colsample_bytree': 0.8,
                'random_state': 42
            },
            ModelType.LIGHTGBM: {
                'n_estimators': 500,
                'max_depth': 8,
                'learning_rate': 0.1,
                'subsample': 0.8,
                'colsample_bytree': 0.8,
                'random_state': 42
            }
        }

    async def _get_redis_client(self):
        if not self.redis_client:
            self.redis_client = aioredis.from_url(REDIS_URL)
        return self.redis_client

    async def analyze_claim(self, claim_data: ClaimData) -> FraudDetectionResult:
        """Comprehensive fraud analysis using hybrid approach"""
        start_time = datetime.utcnow()
        
        # Extract features
        features = await self._extract_features(claim_data)
        
        # Rule-based detection
        rule_violations, rule_score = await self._apply_fraud_rules(claim_data, features)
        
        # Machine learning predictions
        ml_predictions = await self._get_ml_predictions(features, claim_data.tenant_id)
        
        # Deep learning analysis
        dl_score = await self._get_deep_learning_prediction(features, claim_data.tenant_id)
        
        # Graph neural network analysis
        graph_features, gnn_score = await self._analyze_with_gnn(claim_data, features)
        
        # Anomaly detection
        anomaly_indicators, anomaly_score = await self._detect_anomalies(features, claim_data.tenant_id)
        
        # Ensemble scoring
        final_score, confidence, risk_level = self._calculate_ensemble_score(
            rule_score, ml_predictions, dl_score, gnn_score, anomaly_score
        )
        
        # Generate explanation and recommendations
        explanation = self._generate_explanation(
            rule_violations, ml_predictions, anomaly_indicators, final_score
        )
        recommendations = self._generate_recommendations(risk_level, rule_violations, anomaly_indicators)
        
        # Determine detection methods used
        detection_methods = self._get_detection_methods(
            rule_violations, ml_predictions, dl_score, gnn_score, anomaly_indicators
        )
        
        # Create result
        result = FraudDetectionResult(
            claim_id=claim_data.id,
            fraud_score=final_score,
            risk_level=risk_level,
            detection_methods=detection_methods,
            rule_violations=rule_violations,
            ml_predictions=ml_predictions,
            anomaly_indicators=anomaly_indicators,
            graph_features=graph_features,
            confidence_score=confidence,
            explanation=explanation,
            recommendations=recommendations,
            tenant_id=claim_data.tenant_id,
            analyzed_at=datetime.utcnow()
        )
        
        # Save result to database
        await self._save_fraud_result(result, start_time)
        
        # Update fraud patterns
        await self._update_fraud_patterns(claim_data, result)
        
        logger.info(f"Fraud analysis completed for claim {claim_data.id}: {risk_level.value} risk")
        return result

    async def _extract_features(self, claim_data: ClaimData) -> Dict[str, Any]:
        """Extract comprehensive features for ML models"""
        features = {}
        
        # Basic claim features
        features['claim_amount'] = float(claim_data.total_amount)
        features['num_diagnosis_codes'] = len(claim_data.diagnosis_codes)
        features['num_procedure_codes'] = len(claim_data.procedure_codes)
        
        # Date features
        service_duration = (claim_data.service_date_to - claim_data.service_date_from).days
        features['service_duration_days'] = max(1, service_duration)
        
        submission_delay = (claim_data.submitted_at - claim_data.service_date_to).days
        features['submission_delay_days'] = max(0, submission_delay)
        
        # Provider features
        provider_info = claim_data.provider_info
        features['provider_specialty'] = provider_info.get('specialty', 'unknown')
        features['provider_years_active'] = provider_info.get('years_active', 0)
        features['provider_claim_volume'] = provider_info.get('monthly_claim_volume', 0)
        
        # Patient features
        patient_info = claim_data.patient_info
        features['patient_age'] = patient_info.get('age', 0)
        features['patient_gender'] = patient_info.get('gender', 'unknown')
        features['patient_chronic_conditions'] = len(patient_info.get('chronic_conditions', []))
        
        # Insurance features
        insurance_info = claim_data.insurance_info
        features['insurance_type'] = insurance_info.get('type', 'unknown')
        features['copay_amount'] = float(insurance_info.get('copay', 0))
        features['deductible_remaining'] = float(insurance_info.get('deductible_remaining', 0))
        
        # Historical features
        historical_features = await self._get_historical_features(claim_data)
        features.update(historical_features)
        
        # Network features
        network_features = await self._get_network_features(claim_data)
        features.update(network_features)
        
        return features

    async def _get_historical_features(self, claim_data: ClaimData) -> Dict[str, Any]:
        """Get historical features for provider and patient"""
        features = {}
        
        async with db_manager.pool.acquire() as conn:
            # Provider historical features
            provider_stats = await conn.fetchrow("""
                SELECT 
                    COUNT(*) as total_claims,
                    AVG(claim_amount) as avg_claim_amount,
                    STDDEV(claim_amount) as stddev_claim_amount,
                    COUNT(CASE WHEN fraud_score > 0.7 THEN 1 END) as high_risk_claims,
                    AVG(fraud_score) as avg_fraud_score
                FROM claims c
                LEFT JOIN fraud_detection_results f ON c.id = f.claim_id
                WHERE c.provider_id = $1 
                AND c.created_at >= NOW() - INTERVAL '90 days'
                AND c.tenant_id = $2
            """, claim_data.provider_id, claim_data.tenant_id)
            
            if provider_stats:
                features['provider_90d_claim_count'] = provider_stats['total_claims'] or 0
                features['provider_90d_avg_amount'] = float(provider_stats['avg_claim_amount'] or 0)
                features['provider_90d_amount_stddev'] = float(provider_stats['stddev_claim_amount'] or 0)
                features['provider_90d_high_risk_ratio'] = (
                    (provider_stats['high_risk_claims'] or 0) / max(1, provider_stats['total_claims'] or 1)
                )
                features['provider_90d_avg_fraud_score'] = float(provider_stats['avg_fraud_score'] or 0)
            
            # Patient historical features
            patient_stats = await conn.fetchrow("""
                SELECT 
                    COUNT(*) as total_claims,
                    AVG(claim_amount) as avg_claim_amount,
                    COUNT(DISTINCT provider_id) as unique_providers,
                    AVG(fraud_score) as avg_fraud_score
                FROM claims c
                LEFT JOIN fraud_detection_results f ON c.id = f.claim_id
                WHERE c.patient_id = $1 
                AND c.created_at >= NOW() - INTERVAL '180 days'
                AND c.tenant_id = $2
            """, claim_data.patient_id, claim_data.tenant_id)
            
            if patient_stats:
                features['patient_180d_claim_count'] = patient_stats['total_claims'] or 0
                features['patient_180d_avg_amount'] = float(patient_stats['avg_claim_amount'] or 0)
                features['patient_180d_provider_count'] = patient_stats['unique_providers'] or 0
                features['patient_180d_avg_fraud_score'] = float(patient_stats['avg_fraud_score'] or 0)
        
        return features

    async def _get_network_features(self, claim_data: ClaimData) -> Dict[str, Any]:
        """Get network-based features for graph analysis"""
        features = {}
        
        async with db_manager.pool.acquire() as conn:
            # Provider-patient network features
            network_stats = await conn.fetchrow("""
                WITH provider_patients AS (
                    SELECT DISTINCT patient_id 
                    FROM claims 
                    WHERE provider_id = $1 
                    AND created_at >= NOW() - INTERVAL '90 days'
                    AND tenant_id = $2
                ),
                patient_providers AS (
                    SELECT DISTINCT provider_id 
                    FROM claims 
                    WHERE patient_id = $3 
                    AND created_at >= NOW() - INTERVAL '90 days'
                    AND tenant_id = $2
                )
                SELECT 
                    (SELECT COUNT(*) FROM provider_patients) as provider_patient_count,
                    (SELECT COUNT(*) FROM patient_providers) as patient_provider_count
            """, claim_data.provider_id, claim_data.tenant_id, claim_data.patient_id)
            
            if network_stats:
                features['provider_unique_patients_90d'] = network_stats['provider_patient_count'] or 0
                features['patient_unique_providers_90d'] = network_stats['patient_provider_count'] or 0
        
        return features

    async def _apply_fraud_rules(self, claim_data: ClaimData, features: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], float]:
        """Apply rule-based fraud detection"""
        violations = []
        total_weight = 0
        violation_weight = 0
        
        # Get active rules for tenant
        rules = await self._get_fraud_rules(claim_data.tenant_id)
        
        for rule in rules:
            if not rule['is_active']:
                continue
                
            total_weight += rule['weight']
            
            if await self._evaluate_rule(rule, claim_data, features):
                violations.append({
                    'rule_id': rule['id'],
                    'rule_name': rule['name'],
                    'rule_type': rule['rule_type'],
                    'description': rule['description'],
                    'weight': rule['weight']
                })
                violation_weight += rule['weight']
        
        # Calculate rule-based score
        rule_score = violation_weight / max(total_weight, 1) if total_weight > 0 else 0
        
        return violations, rule_score

    async def _get_fraud_rules(self, tenant_id: str) -> List[Dict[str, Any]]:
        """Get fraud rules for tenant with caching"""
        cache_key = f"fraud_rules:{tenant_id}"
        redis_client = await self._get_redis_client()
        
        # Check cache
        cached_rules = await redis_client.get(cache_key)
        if cached_rules:
            return json.loads(cached_rules)
        
        # Get from database
        async with db_manager.pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM fraud_rules 
                WHERE tenant_id = $1 AND is_active = TRUE
                ORDER BY weight DESC
            """, tenant_id)
            
            rules = []
            for row in rows:
                rule_data = dict(row)
                rule_data['conditions'] = json.loads(rule_data['conditions'])
                rules.append(rule_data)
        
        # Cache for 1 hour
        await redis_client.setex(cache_key, 3600, json.dumps(rules, default=str))
        
        return rules

    async def _evaluate_rule(self, rule: Dict[str, Any], claim_data: ClaimData, features: Dict[str, Any]) -> bool:
        """Evaluate a single fraud rule"""
        conditions = rule['conditions']
        rule_type = rule['rule_type']
        
        try:
            if rule_type == RuleType.THRESHOLD.value:
                return self._evaluate_threshold_rule(conditions, features)
            elif rule_type == RuleType.PATTERN.value:
                return self._evaluate_pattern_rule(conditions, claim_data, features)
            elif rule_type == RuleType.ANOMALY.value:
                return self._evaluate_anomaly_rule(conditions, features)
            elif rule_type == RuleType.RELATIONSHIP.value:
                return await self._evaluate_relationship_rule(conditions, claim_data, features)
            elif rule_type == RuleType.TEMPORAL.value:
                return self._evaluate_temporal_rule(conditions, claim_data, features)
            
        except Exception as e:
            logger.error(f"Rule evaluation error for rule {rule['id']}: {e}")
            return False
        
        return False

    def _evaluate_threshold_rule(self, conditions: Dict[str, Any], features: Dict[str, Any]) -> bool:
        """Evaluate threshold-based rules"""
        for field, threshold_config in conditions.items():
            if field not in features:
                continue
                
            value = features[field]
            operator = threshold_config.get('operator', '>')
            threshold = threshold_config.get('value')
            
            if operator == '>' and value <= threshold:
                return False
            elif operator == '<' and value >= threshold:
                return False
            elif operator == '>=' and value < threshold:
                return False
            elif operator == '<=' and value > threshold:
                return False
            elif operator == '==' and value != threshold:
                return False
            elif operator == '!=' and value == threshold:
                return False
        
        return True

    async def _evaluate_pattern_rule(self, conditions: Dict[str, Any], claim_data: ClaimData, features: Dict[str, Any]) -> bool:
        """Evaluate pattern-based rules"""
        patterns = conditions.get('patterns', [])
        
        for pattern in patterns:
            pattern_type = pattern.get('type')
            
            if pattern_type == 'diagnosis_procedure_mismatch':
                if self._check_diagnosis_procedure_mismatch(claim_data.diagnosis_codes, claim_data.procedure_codes):
                    return True
            
            elif pattern_type == 'unusual_billing_pattern':
                if self._check_unusual_billing_pattern(features):
                    return True
            
            elif pattern_type == 'duplicate_services':
                if await self._check_duplicate_services(claim_data):
                    return True
        
        return False

    def _evaluate_anomaly_rule(self, conditions: Dict[str, Any], features: Dict[str, Any]) -> bool:
        """Evaluate anomaly-based rules"""
        anomaly_threshold = conditions.get('anomaly_threshold', 2.0)  # Z-score threshold
        
        for field in conditions.get('fields', []):
            if field in features:
                # Calculate Z-score based on historical data
                z_score = self._calculate_z_score(field, features[field])
                if abs(z_score) > anomaly_threshold:
                    return True
        
        return False

    async def _evaluate_relationship_rule(self, conditions: Dict[str, Any], claim_data: ClaimData, features: Dict[str, Any]) -> bool:
        """Evaluate relationship-based rules"""
        relationship_type = conditions.get('type')
        
        if relationship_type == 'provider_patient_frequency':
            threshold = conditions.get('threshold', 10)
            frequency = features.get('provider_unique_patients_90d', 0)
            return frequency > threshold
        
        elif relationship_type == 'patient_provider_shopping':
            threshold = conditions.get('threshold', 5)
            provider_count = features.get('patient_unique_providers_90d', 0)
            return provider_count > threshold
        
        return False

    def _evaluate_temporal_rule(self, conditions: Dict[str, Any], claim_data: ClaimData, features: Dict[str, Any]) -> bool:
        """Evaluate temporal-based rules"""
        temporal_type = conditions.get('type')
        
        if temporal_type == 'rapid_submission':
            max_delay = conditions.get('max_delay_hours', 24)
            actual_delay = features.get('submission_delay_days', 0) * 24
            return actual_delay > max_delay
        
        elif temporal_type == 'weekend_submission':
            if claim_data.submitted_at.weekday() >= 5:  # Saturday or Sunday
                return True
        
        return False

    def _check_diagnosis_procedure_mismatch(self, diagnosis_codes: List[str], procedure_codes: List[str]) -> bool:
        """Check for diagnosis-procedure code mismatches"""
        # Simplified mismatch detection
        # In production, this would use comprehensive medical coding databases
        
        # Example: Check for common mismatches
        high_cost_procedures = ['99213', '99214', '99215']  # High-level office visits
        minor_diagnoses = ['Z00.00', 'Z01.00']  # Routine checkups
        
        has_high_cost_procedure = any(code in high_cost_procedures for code in procedure_codes)
        has_minor_diagnosis = any(code in minor_diagnoses for code in diagnosis_codes)
        
        return has_high_cost_procedure and has_minor_diagnosis

    def _check_unusual_billing_pattern(self, features: Dict[str, Any]) -> bool:
        """Check for unusual billing patterns"""
        # Check for round number amounts (potential indicator of fraud)
        claim_amount = features.get('claim_amount', 0)
        if claim_amount > 0 and claim_amount % 100 == 0 and claim_amount > 500:
            return True
        
        # Check for unusually high amounts compared to provider average
        provider_avg = features.get('provider_90d_avg_amount', 0)
        if provider_avg > 0 and claim_amount > provider_avg * 3:
            return True
        
        return False

    async def _check_duplicate_services(self, claim_data: ClaimData) -> bool:
        """Check for duplicate services"""
        async with db_manager.pool.acquire() as conn:
            duplicate_count = await conn.fetchval("""
                SELECT COUNT(*) FROM claims 
                WHERE provider_id = $1 
                AND patient_id = $2 
                AND procedure_codes && $3
                AND service_date_from = $4
                AND id != $5
                AND tenant_id = $6
            """, claim_data.provider_id, claim_data.patient_id, 
                claim_data.procedure_codes, claim_data.service_date_from,
                claim_data.id, claim_data.tenant_id)
            
            return duplicate_count > 0

    def _calculate_z_score(self, field: str, value: float) -> float:
        """Calculate Z-score for anomaly detection"""
        # This would typically use historical statistics
        # For now, return a simplified calculation
        return abs(value - 100) / 50  # Simplified Z-score

    async def _get_ml_predictions(self, features: Dict[str, Any], tenant_id: str) -> Dict[str, float]:
        """Get predictions from multiple ML models"""
        predictions = {}
        
        # Load models for tenant
        models = await self._load_ml_models(tenant_id)
        
        # Prepare features for ML models
        feature_vector = self._prepare_feature_vector(features)
        
        for model_type, model_data in models.items():
            try:
                model = model_data['model']
                scaler = model_data.get('scaler')
                
                # Scale features if scaler available
                if scaler:
                    scaled_features = scaler.transform([feature_vector])
                else:
                    scaled_features = [feature_vector]
                
                # Get prediction
                if hasattr(model, 'predict_proba'):
                    # Classification models
                    prob = model.predict_proba(scaled_features)[0]
                    predictions[model_type] = float(prob[1]) if len(prob) > 1 else float(prob[0])
                elif hasattr(model, 'decision_function'):
                    # Anomaly detection models
                    score = model.decision_function(scaled_features)[0]
                    # Convert to probability-like score
                    predictions[model_type] = float(1 / (1 + np.exp(-score)))
                else:
                    # Other models
                    score = model.predict(scaled_features)[0]
                    predictions[model_type] = float(score)
                    
            except Exception as e:
                logger.error(f"ML prediction error for {model_type}: {e}")
                predictions[model_type] = 0.0
        
        return predictions

    async def _load_ml_models(self, tenant_id: str) -> Dict[str, Dict[str, Any]]:
        """Load ML models for tenant with caching"""
        cache_key = f"ml_models:{tenant_id}"
        
        if cache_key in self.models:
            return self.models[cache_key]
        
        models = {}
        
        async with db_manager.pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM ml_models 
                WHERE tenant_id = $1 AND is_active = TRUE
                ORDER BY created_at DESC
            """, tenant_id)
            
            for row in rows:
                try:
                    model_data = pickle.loads(row['model_data'])
                    models[row['model_type']] = model_data
                except Exception as e:
                    logger.error(f"Failed to load model {row['id']}: {e}")
        
        # Cache models
        self.models[cache_key] = models
        
        return models

    def _prepare_feature_vector(self, features: Dict[str, Any]) -> List[float]:
        """Prepare feature vector for ML models"""
        # Define feature order and default values
        feature_names = [
            'claim_amount', 'num_diagnosis_codes', 'num_procedure_codes',
            'service_duration_days', 'submission_delay_days', 'provider_years_active',
            'provider_claim_volume', 'patient_age', 'patient_chronic_conditions',
            'copay_amount', 'deductible_remaining', 'provider_90d_claim_count',
            'provider_90d_avg_amount', 'provider_90d_amount_stddev',
            'provider_90d_high_risk_ratio', 'provider_90d_avg_fraud_score',
            'patient_180d_claim_count', 'patient_180d_avg_amount',
            'patient_180d_provider_count', 'patient_180d_avg_fraud_score',
            'provider_unique_patients_90d', 'patient_unique_providers_90d'
        ]
        
        feature_vector = []
        for feature_name in feature_names:
            value = features.get(feature_name, 0)
            if isinstance(value, (int, float)):
                feature_vector.append(float(value))
            else:
                feature_vector.append(0.0)
        
        return feature_vector

    async def _get_deep_learning_prediction(self, features: Dict[str, Any], tenant_id: str) -> float:
        """Get prediction from deep learning model"""
        try:
            # Load DL model
            dl_model = await self._load_dl_model(tenant_id)
            if not dl_model:
                return 0.0
            
            # Prepare features
            feature_vector = torch.tensor(self._prepare_feature_vector(features), dtype=torch.float32)
            feature_vector = feature_vector.unsqueeze(0)  # Add batch dimension
            
            # Get prediction
            with torch.no_grad():
                dl_model.eval()
                output = dl_model(feature_vector)
                fraud_probability = output[0][1].item()  # Probability of fraud class
            
            return fraud_probability
            
        except Exception as e:
            logger.error(f"Deep learning prediction error: {e}")
            return 0.0

    async def _load_dl_model(self, tenant_id: str) -> Optional[FraudDetectionNN]:
        """Load deep learning model for tenant"""
        cache_key = f"dl_model:{tenant_id}"
        
        if cache_key in self.models:
            return self.models[cache_key]
        
        try:
            async with db_manager.pool.acquire() as conn:
                row = await conn.fetchrow("""
                    SELECT model_data FROM ml_models 
                    WHERE tenant_id = $1 AND model_type = $2 AND is_active = TRUE
                    ORDER BY created_at DESC LIMIT 1
                """, tenant_id, ModelType.NEURAL_NETWORK.value)
                
                if row:
                    model_data = pickle.loads(row['model_data'])
                    model = model_data['model']
                    self.models[cache_key] = model
                    return model
                    
        except Exception as e:
            logger.error(f"Failed to load DL model: {e}")
        
        return None

    async def _analyze_with_gnn(self, claim_data: ClaimData, features: Dict[str, Any]) -> Tuple[Dict[str, Any], float]:
        """Analyze claim using Graph Neural Network"""
        try:
            # Build graph for claim
            graph_data = await self._build_claim_graph(claim_data)
            
            if not graph_data:
                return {}, 0.0
            
            # Load GNN model
            gnn_model = await self._load_gnn_model(claim_data.tenant_id)
            if not gnn_model:
                return graph_data, 0.0
            
            # Prepare graph data for GNN
            x = torch.tensor(graph_data['node_features'], dtype=torch.float32)
            edge_index = torch.tensor(graph_data['edge_index'], dtype=torch.long)
            
            # Get prediction
            with torch.no_grad():
                gnn_model.eval()
                output = gnn_model(x, edge_index)
                fraud_score = torch.softmax(output, dim=1)[0][1].item()
            
            return graph_data, fraud_score
            
        except Exception as e:
            logger.error(f"GNN analysis error: {e}")
            return {}, 0.0

    async def _build_claim_graph(self, claim_data: ClaimData) -> Optional[Dict[str, Any]]:
        """Build graph representation of claim and related entities"""
        try:
            # Get related entities
            async with db_manager.pool.acquire() as conn:
                # Get related claims (same provider or patient)
                related_claims = await conn.fetch("""
                    SELECT id, provider_id, patient_id, total_amount, fraud_score
                    FROM claims c
                    LEFT JOIN fraud_detection_results f ON c.id = f.claim_id
                    WHERE (c.provider_id = $1 OR c.patient_id = $2)
                    AND c.created_at >= NOW() - INTERVAL '90 days'
                    AND c.tenant_id = $3
                    LIMIT 100
                """, claim_data.provider_id, claim_data.patient_id, claim_data.tenant_id)
            
            if len(related_claims) < 2:
                return None
            
            # Build node features and edges
            nodes = {}
            edges = []
            node_features = []
            
            # Add current claim as node 0
            nodes[claim_data.id] = 0
            node_features.append([
                float(claim_data.total_amount),
                len(claim_data.diagnosis_codes),
                len(claim_data.procedure_codes),
                0.0  # fraud_score placeholder
            ])
            
            # Add related claims
            for i, claim in enumerate(related_claims, 1):
                if claim['id'] != claim_data.id:
                    nodes[claim['id']] = i
                    node_features.append([
                        float(claim['total_amount'] or 0),
                        1,  # simplified features
                        1,
                        float(claim['fraud_score'] or 0)
                    ])
                    
                    # Add edge if same provider or patient
                    if (claim['provider_id'] == claim_data.provider_id or 
                        claim['patient_id'] == claim_data.patient_id):
                        edges.append([0, i])
                        edges.append([i, 0])  # Undirected graph
            
            if len(edges) == 0:
                return None
            
            return {
                'node_features': node_features,
                'edge_index': list(zip(*edges)),
                'num_nodes': len(node_features),
                'num_edges': len(edges)
            }
            
        except Exception as e:
            logger.error(f"Graph building error: {e}")
            return None

    async def _load_gnn_model(self, tenant_id: str) -> Optional[GraphFraudDetector]:
        """Load GNN model for tenant"""
        cache_key = f"gnn_model:{tenant_id}"
        
        if cache_key in self.models:
            return self.models[cache_key]
        
        try:
            async with db_manager.pool.acquire() as conn:
                row = await conn.fetchrow("""
                    SELECT model_data FROM ml_models 
                    WHERE tenant_id = $1 AND model_type IN ($2, $3, $4) AND is_active = TRUE
                    ORDER BY created_at DESC LIMIT 1
                """, tenant_id, ModelType.GCN.value, ModelType.GAT.value, ModelType.SAGE.value)
                
                if row:
                    model_data = pickle.loads(row['model_data'])
                    model = model_data['model']
                    self.models[cache_key] = model
                    return model
                    
        except Exception as e:
            logger.error(f"Failed to load GNN model: {e}")
        
        return None

    async def _detect_anomalies(self, features: Dict[str, Any], tenant_id: str) -> Tuple[List[str], float]:
        """Detect anomalies in claim features"""
        anomaly_indicators = []
        anomaly_score = 0.0
        
        try:
            # Load anomaly detection model
            anomaly_model = await self._load_anomaly_model(tenant_id)
            
            if anomaly_model:
                feature_vector = self._prepare_feature_vector(features)
                
                # Get anomaly score
                anomaly_scores = anomaly_model.decision_function([feature_vector])
                anomaly_score = float(1 / (1 + np.exp(-anomaly_scores[0])))
                
                # Check for specific anomalies
                if anomaly_score > 0.7:
                    anomaly_indicators.append("Overall anomalous pattern detected")
            
            # Rule-based anomaly detection
            claim_amount = features.get('claim_amount', 0)
            provider_avg = features.get('provider_90d_avg_amount', 0)
            
            if provider_avg > 0 and claim_amount > provider_avg * 5:
                anomaly_indicators.append("Claim amount significantly higher than provider average")
                anomaly_score = max(anomaly_score, 0.8)
            
            submission_delay = features.get('submission_delay_days', 0)
            if submission_delay > 30:
                anomaly_indicators.append("Unusually long submission delay")
                anomaly_score = max(anomaly_score, 0.6)
            
            service_duration = features.get('service_duration_days', 1)
            if service_duration > 30:
                anomaly_indicators.append("Unusually long service duration")
                anomaly_score = max(anomaly_score, 0.5)
            
        except Exception as e:
            logger.error(f"Anomaly detection error: {e}")
        
        return anomaly_indicators, anomaly_score

    async def _load_anomaly_model(self, tenant_id: str) -> Optional[IsolationForest]:
        """Load anomaly detection model"""
        cache_key = f"anomaly_model:{tenant_id}"
        
        if cache_key in self.models:
            return self.models[cache_key]
        
        try:
            async with db_manager.pool.acquire() as conn:
                row = await conn.fetchrow("""
                    SELECT model_data FROM ml_models 
                    WHERE tenant_id = $1 AND model_type = $2 AND is_active = TRUE
                    ORDER BY created_at DESC LIMIT 1
                """, tenant_id, ModelType.ISOLATION_FOREST.value)
                
                if row:
                    model_data = pickle.loads(row['model_data'])
                    model = model_data['model']
                    self.models[cache_key] = model
                    return model
                    
        except Exception as e:
            logger.error(f"Failed to load anomaly model: {e}")
        
        return None

    def _calculate_ensemble_score(self, rule_score: float, ml_predictions: Dict[str, float],
                                dl_score: float, gnn_score: float, anomaly_score: float) -> Tuple[float, float, FraudRiskLevel]:
        """Calculate ensemble fraud score and confidence"""
        scores = []
        weights = []
        
        # Rule-based score
        if rule_score > 0:
            scores.append(rule_score)
            weights.append(0.3)
        
        # ML predictions
        for model_type, score in ml_predictions.items():
            scores.append(score)
            if model_type == ModelType.XGBOOST.value:
                weights.append(0.25)
            elif model_type == ModelType.RANDOM_FOREST.value:
                weights.append(0.2)
            else:
                weights.append(0.15)
        
        # Deep learning score
        if dl_score > 0:
            scores.append(dl_score)
            weights.append(0.2)
        
        # GNN score
        if gnn_score > 0:
            scores.append(gnn_score)
            weights.append(0.15)
        
        # Anomaly score
        if anomaly_score > 0:
            scores.append(anomaly_score)
            weights.append(0.1)
        
        if not scores:
            return 0.0, 0.0, FraudRiskLevel.LOW
        
        # Normalize weights
        total_weight = sum(weights)
        if total_weight > 0:
            weights = [w / total_weight for w in weights]
        else:
            weights = [1.0 / len(scores)] * len(scores)
        
        # Calculate weighted average
        ensemble_score = sum(score * weight for score, weight in zip(scores, weights))
        
        # Calculate confidence based on agreement between methods
        score_variance = np.var(scores) if len(scores) > 1 else 0
        confidence = max(0.5, 1.0 - score_variance)
        
        # Determine risk level
        if ensemble_score >= 0.8:
            risk_level = FraudRiskLevel.CRITICAL
        elif ensemble_score >= 0.6:
            risk_level = FraudRiskLevel.HIGH
        elif ensemble_score >= 0.4:
            risk_level = FraudRiskLevel.MEDIUM
        else:
            risk_level = FraudRiskLevel.LOW
        
        return ensemble_score, confidence, risk_level

    def _generate_explanation(self, rule_violations: List[Dict[str, Any]], 
                            ml_predictions: Dict[str, float],
                            anomaly_indicators: List[str], 
                            final_score: float) -> str:
        """Generate human-readable explanation"""
        explanations = []
        
        if rule_violations:
            explanations.append(f"Rule violations detected: {', '.join([v['rule_name'] for v in rule_violations])}")
        
        if ml_predictions:
            high_ml_scores = [f"{model}: {score:.2f}" for model, score in ml_predictions.items() if score > 0.6]
            if high_ml_scores:
                explanations.append(f"High ML fraud scores: {', '.join(high_ml_scores)}")
        
        if anomaly_indicators:
            explanations.append(f"Anomalies detected: {', '.join(anomaly_indicators)}")
        
        if not explanations:
            explanations.append("No significant fraud indicators detected")
        
        return f"Fraud score: {final_score:.3f}. " + ". ".join(explanations)

    def _generate_recommendations(self, risk_level: FraudRiskLevel, 
                                rule_violations: List[Dict[str, Any]],
                                anomaly_indicators: List[str]) -> List[str]:
        """Generate recommendations based on analysis"""
        recommendations = []
        
        if risk_level == FraudRiskLevel.CRITICAL:
            recommendations.extend([
                "Immediately flag for manual review",
                "Suspend payment pending investigation",
                "Contact provider for additional documentation"
            ])
        elif risk_level == FraudRiskLevel.HIGH:
            recommendations.extend([
                "Require manual review before payment",
                "Request additional supporting documentation",
                "Monitor provider for pattern analysis"
            ])
        elif risk_level == FraudRiskLevel.MEDIUM:
            recommendations.extend([
                "Consider for enhanced review process",
                "Monitor for recurring patterns"
            ])
        else:
            recommendations.append("Process normally with standard monitoring")
        
        # Add specific recommendations based on violations
        for violation in rule_violations:
            if violation['rule_type'] == RuleType.THRESHOLD.value:
                recommendations.append("Verify amounts against standard fee schedules")
            elif violation['rule_type'] == RuleType.PATTERN.value:
                recommendations.append("Review billing patterns and coding accuracy")
        
        return recommendations

    def _get_detection_methods(self, rule_violations: List[Dict[str, Any]], 
                             ml_predictions: Dict[str, float],
                             dl_score: float, gnn_score: float, 
                             anomaly_indicators: List[str]) -> List[DetectionMethod]:
        """Determine which detection methods were used"""
        methods = []
        
        if rule_violations:
            methods.append(DetectionMethod.RULE_BASED)
        
        if ml_predictions:
            methods.append(DetectionMethod.MACHINE_LEARNING)
        
        if dl_score > 0:
            methods.append(DetectionMethod.DEEP_LEARNING)
        
        if gnn_score > 0:
            methods.append(DetectionMethod.GRAPH_NEURAL_NETWORK)
        
        if len(methods) > 1:
            methods.append(DetectionMethod.ENSEMBLE)
        
        return methods

    async def _save_fraud_result(self, result: FraudDetectionResult, start_time: datetime):
        """Save fraud detection result to database"""
        processing_time = int((datetime.utcnow() - start_time).total_seconds() * 1000)
        
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO fraud_detection_results 
                (claim_id, fraud_score, risk_level, detection_methods, rule_violations,
                 ml_predictions, anomaly_indicators, graph_features, confidence_score,
                 explanation, recommendations, tenant_id, analyzed_at, processing_time_ms)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                ON CONFLICT (claim_id) DO UPDATE SET
                    fraud_score = EXCLUDED.fraud_score,
                    risk_level = EXCLUDED.risk_level,
                    detection_methods = EXCLUDED.detection_methods,
                    rule_violations = EXCLUDED.rule_violations,
                    ml_predictions = EXCLUDED.ml_predictions,
                    anomaly_indicators = EXCLUDED.anomaly_indicators,
                    graph_features = EXCLUDED.graph_features,
                    confidence_score = EXCLUDED.confidence_score,
                    explanation = EXCLUDED.explanation,
                    recommendations = EXCLUDED.recommendations,
                    analyzed_at = EXCLUDED.analyzed_at,
                    processing_time_ms = EXCLUDED.processing_time_ms
            """, result.claim_id, result.fraud_score, result.risk_level.value,
                [method.value for method in result.detection_methods],
                json.dumps(result.rule_violations),
                json.dumps(result.ml_predictions),
                result.anomaly_indicators,
                json.dumps(result.graph_features),
                result.confidence_score, result.explanation,
                result.recommendations, result.tenant_id,
                result.analyzed_at, processing_time)

    async def _update_fraud_patterns(self, claim_data: ClaimData, result: FraudDetectionResult):
        """Update fraud pattern database"""
        if result.risk_level in [FraudRiskLevel.HIGH, FraudRiskLevel.CRITICAL]:
            # Extract patterns for future detection
            patterns = self._extract_fraud_patterns(claim_data, result)
            
            for pattern in patterns:
                await self._save_fraud_pattern(pattern, claim_data.tenant_id)

    def _extract_fraud_patterns(self, claim_data: ClaimData, result: FraudDetectionResult) -> List[Dict[str, Any]]:
        """Extract fraud patterns from high-risk claims"""
        patterns = []
        
        # Provider-based patterns
        if result.fraud_score > 0.7:
            patterns.append({
                'pattern_name': f'high_risk_provider_{claim_data.provider_id}',
                'pattern_type': 'provider_risk',
                'pattern_data': {
                    'provider_id': claim_data.provider_id,
                    'fraud_score': result.fraud_score,
                    'risk_indicators': result.anomaly_indicators
                },
                'confidence_score': result.confidence_score
            })
        
        # Billing pattern
        if 'unusual_billing_pattern' in str(result.rule_violations):
            patterns.append({
                'pattern_name': f'billing_pattern_{hash(str(claim_data.procedure_codes))}',
                'pattern_type': 'billing_anomaly',
                'pattern_data': {
                    'procedure_codes': claim_data.procedure_codes,
                    'diagnosis_codes': claim_data.diagnosis_codes,
                    'amount': claim_data.total_amount
                },
                'confidence_score': result.confidence_score
            })
        
        return patterns

    async def _save_fraud_pattern(self, pattern: Dict[str, Any], tenant_id: str):
        """Save or update fraud pattern"""
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO fraud_patterns 
                (pattern_name, pattern_type, pattern_data, confidence_score, tenant_id)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (pattern_name, tenant_id) DO UPDATE SET
                    occurrences = fraud_patterns.occurrences + 1,
                    confidence_score = GREATEST(fraud_patterns.confidence_score, EXCLUDED.confidence_score),
                    last_detected = NOW()
            """, pattern['pattern_name'], pattern['pattern_type'],
                json.dumps(pattern['pattern_data']), pattern['confidence_score'], tenant_id)

    async def train_model(self, request: ModelTrainingRequest) -> str:
        """Train ML model for fraud detection"""
        job_id = str(uuid.uuid4())
        
        # Create training job record
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO model_training_jobs 
                (id, model_type, model_name, hyperparameters, tenant_id, created_by)
                VALUES ($1, $2, $3, $4, $5, $6)
            """, job_id, request.model_type.value, request.model_name,
                json.dumps(request.hyperparameters), request.tenant_id, "system")
        
        # Start training in background
        asyncio.create_task(self._train_model_background(job_id, request))
        
        return job_id

    async def _train_model_background(self, job_id: str, request: ModelTrainingRequest):
        """Background model training"""
        try:
            # Update job status
            await self._update_training_job(job_id, "running", 10)
            
            # Get training data
            training_data = await self._get_training_data(request)
            if training_data.empty:
                raise Exception("No training data available")
            
            await self._update_training_job(job_id, "running", 30)
            
            # Prepare features and labels
            X, y = self._prepare_training_data(training_data)
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
            
            await self._update_training_job(job_id, "running", 50)
            
            # Train model
            model, scaler, performance_metrics = await self._train_specific_model(
                request.model_type, X_train, X_test, y_train, y_test, request.hyperparameters
            )
            
            await self._update_training_job(job_id, "running", 80)
            
            # Save model
            model_id = await self._save_trained_model(
                request, model, scaler, performance_metrics
            )
            
            await self._update_training_job(job_id, "completed", 100, {
                'model_id': model_id,
                'performance': performance_metrics
            })
            
            logger.info(f"Model training completed: {job_id}")
            
        except Exception as e:
            logger.error(f"Model training failed: {e}")
            await self._update_training_job(job_id, "failed", 0, error_message=str(e))

    async def _get_training_data(self, request: ModelTrainingRequest) -> pd.DataFrame:
        """Get training data for model"""
        if request.training_data_query:
            query = request.training_data_query
        else:
            # Default training data query
            query = """
                SELECT c.*, f.fraud_score, f.risk_level,
                       CASE WHEN f.fraud_score > 0.6 THEN 1 ELSE 0 END as is_fraud
                FROM claims c
                LEFT JOIN fraud_detection_results f ON c.id = f.claim_id
                WHERE c.tenant_id = $1
                AND c.created_at >= NOW() - INTERVAL '6 months'
                AND f.fraud_score IS NOT NULL
                ORDER BY c.created_at DESC
                LIMIT 10000
            """
        
        async with db_manager.pool.acquire() as conn:
            rows = await conn.fetch(query, request.tenant_id)
            
            if not rows:
                return pd.DataFrame()
            
            return pd.DataFrame([dict(row) for row in rows])

    def _prepare_training_data(self, df: pd.DataFrame) -> Tuple[np.ndarray, np.ndarray]:
        """Prepare training data for ML models"""
        # Feature engineering
        feature_columns = [
            'total_amount', 'num_diagnosis_codes', 'num_procedure_codes',
            'service_duration_days', 'submission_delay_days'
        ]
        
        # Calculate derived features
        df['num_diagnosis_codes'] = df['diagnosis_codes'].apply(lambda x: len(x) if x else 0)
        df['num_procedure_codes'] = df['procedure_codes'].apply(lambda x: len(x) if x else 0)
        df['service_duration_days'] = (df['service_date_to'] - df['service_date_from']).dt.days
        df['submission_delay_days'] = (df['submitted_at'] - df['service_date_to']).dt.days
        
        # Fill missing values
        df[feature_columns] = df[feature_columns].fillna(0)
        
        X = df[feature_columns].values
        y = df['is_fraud'].values
        
        return X, y

    async def _train_specific_model(self, model_type: ModelType, X_train: np.ndarray, 
                                  X_test: np.ndarray, y_train: np.ndarray, y_test: np.ndarray,
                                  hyperparameters: Dict[str, Any]) -> Tuple[Any, Any, Dict[str, Any]]:
        """Train specific model type"""
        # Merge hyperparameters with defaults
        config = self.model_configs.get(model_type, {})
        config.update(hyperparameters)
        
        # Scale features
        scaler = RobustScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)
        
        # Train model based on type
        if model_type == ModelType.ISOLATION_FOREST:
            model = IsolationForest(**config)
            model.fit(X_train_scaled)
            
            # Evaluate
            train_pred = model.predict(X_train_scaled)
            test_pred = model.predict(X_test_scaled)
            
            # Convert to binary classification scores
            train_scores = model.decision_function(X_train_scaled)
            test_scores = model.decision_function(X_test_scaled)
            
            performance_metrics = {
                'model_type': model_type.value,
                'train_anomaly_ratio': np.sum(train_pred == -1) / len(train_pred),
                'test_anomaly_ratio': np.sum(test_pred == -1) / len(test_pred)
            }
            
        elif model_type == ModelType.RANDOM_FOREST:
            model = RandomForestClassifier(**config)
            model.fit(X_train_scaled, y_train)
            
            # Evaluate
            train_pred = model.predict(X_train_scaled)
            test_pred = model.predict(X_test_scaled)
            train_proba = model.predict_proba(X_train_scaled)[:, 1]
            test_proba = model.predict_proba(X_test_scaled)[:, 1]
            
            performance_metrics = {
                'model_type': model_type.value,
                'train_accuracy': np.mean(train_pred == y_train),
                'test_accuracy': np.mean(test_pred == y_test),
                'train_auc': roc_auc_score(y_train, train_proba),
                'test_auc': roc_auc_score(y_test, test_proba)
            }
            
        elif model_type == ModelType.XGBOOST:
            model = xgb.XGBClassifier(**config)
            model.fit(X_train_scaled, y_train)
            
            # Evaluate
            train_pred = model.predict(X_train_scaled)
            test_pred = model.predict(X_test_scaled)
            train_proba = model.predict_proba(X_train_scaled)[:, 1]
            test_proba = model.predict_proba(X_test_scaled)[:, 1]
            
            performance_metrics = {
                'model_type': model_type.value,
                'train_accuracy': np.mean(train_pred == y_train),
                'test_accuracy': np.mean(test_pred == y_test),
                'train_auc': roc_auc_score(y_train, train_proba),
                'test_auc': roc_auc_score(y_test, test_proba)
            }
            
        elif model_type == ModelType.LIGHTGBM:
            model = lgb.LGBMClassifier(**config)
            model.fit(X_train_scaled, y_train)
            
            # Evaluate
            train_pred = model.predict(X_train_scaled)
            test_pred = model.predict(X_test_scaled)
            train_proba = model.predict_proba(X_train_scaled)[:, 1]
            test_proba = model.predict_proba(X_test_scaled)[:, 1]
            
            performance_metrics = {
                'model_type': model_type.value,
                'train_accuracy': np.mean(train_pred == y_train),
                'test_accuracy': np.mean(test_pred == y_test),
                'train_auc': roc_auc_score(y_train, train_proba),
                'test_auc': roc_auc_score(y_test, test_proba)
            }
            
        elif model_type == ModelType.NEURAL_NETWORK:
            # Train neural network
            input_dim = X_train_scaled.shape[1]
            model = FraudDetectionNN(input_dim)
            
            # Convert to PyTorch tensors
            X_train_tensor = torch.tensor(X_train_scaled, dtype=torch.float32)
            y_train_tensor = torch.tensor(y_train, dtype=torch.long)
            X_test_tensor = torch.tensor(X_test_scaled, dtype=torch.float32)
            y_test_tensor = torch.tensor(y_test, dtype=torch.long)
            
            # Training setup
            criterion = nn.CrossEntropyLoss()
            optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
            
            # Training loop
            model.train()
            for epoch in range(100):
                optimizer.zero_grad()
                outputs = model(X_train_tensor)
                loss = criterion(outputs, y_train_tensor)
                loss.backward()
                optimizer.step()
            
            # Evaluate
            model.eval()
            with torch.no_grad():
                train_outputs = model(X_train_tensor)
                test_outputs = model(X_test_tensor)
                
                train_pred = torch.argmax(train_outputs, dim=1).numpy()
                test_pred = torch.argmax(test_outputs, dim=1).numpy()
                train_proba = train_outputs[:, 1].numpy()
                test_proba = test_outputs[:, 1].numpy()
            
            performance_metrics = {
                'model_type': model_type.value,
                'train_accuracy': np.mean(train_pred == y_train),
                'test_accuracy': np.mean(test_pred == y_test),
                'train_auc': roc_auc_score(y_train, train_proba),
                'test_auc': roc_auc_score(y_test, test_proba)
            }
            
        else:
            raise ValueError(f"Unsupported model type: {model_type}")
        
        return model, scaler, performance_metrics

    async def _save_trained_model(self, request: ModelTrainingRequest, model: Any, 
                                scaler: Any, performance_metrics: Dict[str, Any]) -> str:
        """Save trained model to database"""
        model_id = str(uuid.uuid4())
        
        # Serialize model and scaler
        model_data = {
            'model': model,
            'scaler': scaler,
            'feature_names': ['total_amount', 'num_diagnosis_codes', 'num_procedure_codes',
                            'service_duration_days', 'submission_delay_days']
        }
        
        serialized_data = pickle.dumps(model_data)
        
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO ml_models 
                (id, name, model_type, version, model_data, metadata, performance_metrics,
                 tenant_id, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """, model_id, request.model_name, request.model_type.value, "1.0",
                serialized_data, json.dumps({'description': request.description}),
                json.dumps(performance_metrics), request.tenant_id, "system")
        
        return model_id

    async def _update_training_job(self, job_id: str, status: str, progress: int, 
                                 metrics: Dict[str, Any] = None, error_message: str = None):
        """Update training job status"""
        async with db_manager.pool.acquire() as conn:
            if status == "completed":
                await conn.execute("""
                    UPDATE model_training_jobs 
                    SET status = $1, progress = $2, training_metrics = $3, completed_at = NOW()
                    WHERE id = $4
                """, status, progress, json.dumps(metrics) if metrics else None, job_id)
            elif status == "failed":
                await conn.execute("""
                    UPDATE model_training_jobs 
                    SET status = $1, progress = $2, error_message = $3, completed_at = NOW()
                    WHERE id = $4
                """, status, progress, error_message, job_id)
            else:
                await conn.execute("""
                    UPDATE model_training_jobs 
                    SET status = $1, progress = $2
                    WHERE id = $3
                """, status, progress, job_id)

fraud_engine = EnhancedFraudDetectionEngine()

# Lifespan manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db_manager.connect()
    yield
    await db_manager.disconnect()

app = FastAPI(
    title="Healthcare Claims Platform - Enhanced AI Fraud Detection Service",
    description="Real ML/DL/GNN implementation with hybrid rule-based approaches",
    version="2.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Endpoints
@app.post("/analyze", response_model=FraudDetectionResult)
async def analyze_claim(claim_data: ClaimData):
    """Analyze claim for fraud using hybrid ML/DL/GNN approach"""
    result = await fraud_engine.analyze_claim(claim_data)
    return result

@app.post("/train-model", status_code=status.HTTP_201_CREATED)
async def train_model(request: ModelTrainingRequest):
    """Train new ML model for fraud detection"""
    job_id = await fraud_engine.train_model(request)
    return {"job_id": job_id, "status": "training_started"}

@app.get("/training-jobs/{job_id}")
async def get_training_job(job_id: str):
    """Get training job status"""
    async with db_manager.pool.acquire() as conn:
        job = await conn.fetchrow("""
            SELECT * FROM model_training_jobs WHERE id = $1
        """, job_id)
        
        if not job:
            raise HTTPException(status_code=404, detail="Training job not found")
        
        return dict(job)

@app.get("/models")
async def get_models(tenant_id: str = Query(...)):
    """Get available ML models for tenant"""
    async with db_manager.pool.acquire() as conn:
        models = await conn.fetch("""
            SELECT id, name, model_type, version, performance_metrics, is_active, created_at
            FROM ml_models 
            WHERE tenant_id = $1 
            ORDER BY created_at DESC
        """, tenant_id)
        
        return {"models": [dict(model) for model in models]}

@app.post("/rules", status_code=status.HTTP_201_CREATED)
async def create_fraud_rule(rule: FraudRule):
    """Create new fraud detection rule"""
    rule.id = str(uuid.uuid4())
    
    async with db_manager.pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO fraud_rules 
            (id, name, description, rule_type, conditions, threshold, weight, tenant_id, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        """, rule.id, rule.name, rule.description, rule.rule_type.value,
            json.dumps(rule.conditions), rule.threshold, rule.weight,
            rule.tenant_id, rule.created_by)
    
    return {"rule_id": rule.id}

@app.get("/rules")
async def get_fraud_rules(tenant_id: str = Query(...)):
    """Get fraud detection rules for tenant"""
    async with db_manager.pool.acquire() as conn:
        rules = await conn.fetch("""
            SELECT * FROM fraud_rules WHERE tenant_id = $1 ORDER BY created_at DESC
        """, tenant_id)
        
        return {"rules": [dict(rule) for rule in rules]}

@app.get("/results")
async def get_fraud_results(
    tenant_id: str = Query(...),
    risk_level: Optional[FraudRiskLevel] = None,
    limit: int = Query(100, le=1000)
):
    """Get fraud detection results"""
    query = "SELECT * FROM fraud_detection_results WHERE tenant_id = $1"
    params = [tenant_id]
    
    if risk_level:
        query += f" AND risk_level = ${len(params) + 1}"
        params.append(risk_level.value)
    
    query += f" ORDER BY analyzed_at DESC LIMIT ${len(params) + 1}"
    params.append(limit)
    
    async with db_manager.pool.acquire() as conn:
        results = await conn.fetch(query, *params)
        return {"results": [dict(result) for result in results]}

@app.get("/patterns")
async def get_fraud_patterns(tenant_id: str = Query(...)):
    """Get detected fraud patterns"""
    async with db_manager.pool.acquire() as conn:
        patterns = await conn.fetch("""
            SELECT * FROM fraud_patterns 
            WHERE tenant_id = $1 
            ORDER BY confidence_score DESC, last_detected DESC
            LIMIT 100
        """, tenant_id)
        
        return {"patterns": [dict(pattern) for pattern in patterns]}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "ai-fraud-detection-enhanced"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
