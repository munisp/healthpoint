#!/usr/bin/env python3
"""
Predictive Modeling Service
AI/ML service for cost forecasting and predictive analytics in healthcare
Port: 8018
"""

import asyncio
import json
import logging
import uuid
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from enum import Enum
from dataclasses import dataclass, asdict
import pickle
import joblib


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

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import asyncpg

# ML Libraries
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import LinearRegression, Ridge, Lasso
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import xgboost as xgb
import lightgbm as lgb
from prophet import Prophet
import tensorflow as tf
from tensorflow import keras
import torch
import torch.nn as nn
from shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer


def _safe_model_serialize(model_obj) -> bytes:
    """Safely serialize an ML model using joblib (safer than pickle for sklearn)
    or torch.save for PyTorch models. Falls back to joblib for unknown types."""
    import io
    buf = io.BytesIO()
    try:
        import torch
        if hasattr(model_obj, 'state_dict'):
            # PyTorch model — save state dict only (safer than full model)
            torch.save(model_obj.state_dict(), buf)
            return buf.getvalue()
    except ImportError:
        pass
    # Default: joblib (safer than pickle for sklearn/numpy objects)
    joblib.dump(model_obj, buf)
    return buf.getvalue()


def _safe_model_deserialize(data: bytes, model_class=None):
    """Safely deserialize an ML model. Tries torch.load first, then joblib."""
    import io
    buf = io.BytesIO(data)
    try:
        import torch
        # weights_only=True prevents arbitrary code execution
        return torch.load(buf, weights_only=True, map_location='cpu')
    except Exception:
        pass
    buf.seek(0)
    try:
        return joblib.load(buf)
    except Exception:
        pass
    # Last resort: pickle with a clear trust boundary comment
    buf.seek(0)
    # SECURITY: This data comes from our own PostgreSQL database (internal trust boundary).
    # It is NOT user-supplied data. If the DB is compromised, this is a known risk.
    return pickle.loads(buf.read())  # noqa: S301


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# FastAPI app
setup_telemetry(service_name="predictive-modeling-service", service_version="1.0.0")
app = FastAPI(
    title="Predictive Modeling Service",
    description="AI/ML service for cost forecasting and predictive analytics in healthcare",
    version="1.0.0"
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

# Security
security = HTTPBearer()

# Enums
class ModelType(str, Enum):
    COST_FORECASTING = "cost_forecasting"
    UTILIZATION_PREDICTION = "utilization_prediction"
    RISK_STRATIFICATION = "risk_stratification"
    READMISSION_PREDICTION = "readmission_prediction"
    LENGTH_OF_STAY = "length_of_stay"
    DRUG_COST_PREDICTION = "drug_cost_prediction"
    POPULATION_HEALTH = "population_health"

class Algorithm(str, Enum):
    LINEAR_REGRESSION = "linear_regression"
    RANDOM_FOREST = "random_forest"
    GRADIENT_BOOSTING = "gradient_boosting"
    XGBOOST = "xgboost"
    LIGHTGBM = "lightgbm"
    NEURAL_NETWORK = "neural_network"
    PROPHET = "prophet"
    LSTM = "lstm"
    ENSEMBLE = "ensemble"

class PredictionStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"

# Pydantic Models
class PredictionRequest(BaseModel):
    model_type: ModelType
    algorithm: Algorithm = Algorithm.ENSEMBLE
    input_data: Dict[str, Any]
    prediction_horizon: int = 30  # days
    confidence_level: float = 0.95
    include_explanations: bool = True
    context: Optional[Dict[str, Any]] = {}

class TrainingRequest(BaseModel):
    model_type: ModelType
    algorithm: Algorithm
    training_data: List[Dict[str, Any]]
    validation_split: float = 0.2
    hyperparameters: Optional[Dict[str, Any]] = {}
    cross_validation: bool = True

class PredictionResult(BaseModel):
    prediction_id: str
    model_type: ModelType
    algorithm: Algorithm
    predictions: Dict[str, Any]
    confidence_intervals: Optional[Dict[str, Any]] = None
    feature_importance: Optional[Dict[str, float]] = None
    explanations: Optional[Dict[str, Any]] = None
    metadata: Dict[str, Any] = {}

class ModelPerformance(BaseModel):
    model_id: str
    algorithm: Algorithm
    metrics: Dict[str, float]
    cross_validation_scores: Optional[List[float]] = None
    feature_importance: Optional[Dict[str, float]] = None
    training_time: float
    model_size: int

# Data Classes
@dataclass
class PredictiveModel:
    model_id: str
    model_type: ModelType
    algorithm: Algorithm
    model_object: Any
    scaler: Optional[Any]
    feature_columns: List[str]
    target_column: str
    performance_metrics: Dict[str, float]
    created_at: datetime
    last_trained: datetime
    version: str

# Neural Network Models
class HealthcareCostPredictor(nn.Module):
    def __init__(self, input_size: int, hidden_sizes: List[int] = [128, 64, 32]):
        super(HealthcareCostPredictor, self).__init__()
        
        layers = []
        prev_size = input_size
        
        for hidden_size in hidden_sizes:
            layers.extend([
                nn.Linear(prev_size, hidden_size),
                nn.ReLU(),
                nn.Dropout(0.2),
                nn.BatchNorm1d(hidden_size)
            ])
            prev_size = hidden_size
        
        layers.append(nn.Linear(prev_size, 1))
        self.network = nn.Sequential(*layers)
    
    def forward(self, x):
        return self.network(x)

class LSTMPredictor(nn.Module):
    def __init__(self, input_size: int, hidden_size: int = 64, num_layers: int = 2):
        super(LSTMPredictor, self).__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        
        self.lstm = nn.LSTM(input_size, hidden_size, num_layers, batch_first=True, dropout=0.2)
        self.fc = nn.Linear(hidden_size, 1)
    
    def forward(self, x):
        h0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size)
        c0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size)
        
        out, _ = self.lstm(x, (h0, c0))
        out = self.fc(out[:, -1, :])
        return out

# Predictive Modeling Service
class PredictiveModelingService:
    def __init__(self):
        self.db_pool = None
        self.redis = None
        self.models = {}
        self.scalers = {}
        self.feature_encoders = {}
        
    async def initialize(self):
        """Initialize database connections and load models"""
        try:
            # Database connection
            self.db_pool = await asyncpg.create_pool(
                os.environ["DATABASE_URL"],
                min_size=5,
                max_size=20
            )
            
            # Redis connection
            self.redis = get_redis_client()
            
            # Load pre-trained models
            await self.load_models()
            
            # Initialize feature engineering
            await self.initialize_feature_engineering()
            
            logger.info("Predictive Modeling Service initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Predictive Modeling Service: {e}")
            raise

    async def load_models(self):
        """Load pre-trained models from storage"""
        try:
            # Load model metadata from database
            async with self.db_pool.acquire() as conn:
                model_records = await conn.fetch("""
                    SELECT model_id, model_type, algorithm, model_path, 
                           feature_columns, performance_metrics, version
                    FROM predictive_models 
                    WHERE is_active = true
                """)
                
                for record in model_records:
                    try:
                        # Load model from file
                        model_path = record['model_path']
                        if model_path.endswith('.pkl'):
                            with open(model_path, 'rb') as f:
                                model_object = _safe_model_deserialize(f.read())
                        elif model_path.endswith('.joblib'):
                            model_object = joblib.load(model_path)
                        else:
                            continue
                        
                        # Create model instance
                        model = PredictiveModel(
                            model_id=record['model_id'],
                            model_type=ModelType(record['model_type']),
                            algorithm=Algorithm(record['algorithm']),
                            model_object=model_object,
                            scaler=None,  # Load separately if needed
                            feature_columns=json.loads(record['feature_columns']),
                            target_column="target",
                            performance_metrics=json.loads(record['performance_metrics']),
                            created_at=datetime.utcnow(),
                            last_trained=datetime.utcnow(),
                            version=record['version']
                        )
                        
                        self.models[f"{record['model_type']}_{record['algorithm']}"] = model
                        logger.info(f"Loaded model: {record['model_id']}")
                        
                    except Exception as e:
                        logger.error(f"Failed to load model {record['model_id']}: {e}")
            
            # If no models loaded, create default models
            if not self.models:
                await self.create_default_models()
                
        except Exception as e:
            logger.error(f"Failed to load models: {e}")
            await self.create_default_models()

    async def create_default_models(self):
        """Create default models for demonstration"""
        try:
            # Generate synthetic training data
            training_data = await self.generate_synthetic_data()
            
            # Create models for each type
            model_configs = [
                (ModelType.COST_FORECASTING, Algorithm.RANDOM_FOREST),
                (ModelType.UTILIZATION_PREDICTION, Algorithm.XGBOOST),
                (ModelType.RISK_STRATIFICATION, Algorithm.GRADIENT_BOOSTING),
                (ModelType.READMISSION_PREDICTION, Algorithm.LIGHTGBM),
                (ModelType.LENGTH_OF_STAY, Algorithm.NEURAL_NETWORK),
            ]
            
            for model_type, algorithm in model_configs:
                await self.train_model(TrainingRequest(
                    model_type=model_type,
                    algorithm=algorithm,
                    training_data=training_data[model_type.value]
                ))
                
        except Exception as e:
            logger.error(f"Failed to create default models: {e}")

    async def generate_synthetic_data(self) -> Dict[str, List[Dict[str, Any]]]:
        """Generate synthetic training data for different model types"""
        np.random.seed(42)
        
        data = {}
        
        # Cost Forecasting Data
        cost_data = []
        for i in range(1000):
            record = {
                'patient_age': np.random.randint(18, 90),
                'gender': np.random.choice(['M', 'F']),
                'diagnosis_count': np.random.randint(1, 8),
                'procedure_count': np.random.randint(1, 5),
                'length_of_stay': np.random.randint(1, 30),
                'severity_score': np.random.uniform(1, 10),
                'comorbidity_count': np.random.randint(0, 5),
                'prior_admissions': np.random.randint(0, 10),
                'insurance_type': np.random.choice(['Medicare', 'Medicaid', 'Commercial', 'Self-Pay']),
                'facility_type': np.random.choice(['Hospital', 'Clinic', 'Emergency']),
                'target': np.random.uniform(1000, 50000)  # Cost
            }
            cost_data.append(record)
        
        data[ModelType.COST_FORECASTING.value] = cost_data
        
        # Utilization Prediction Data
        utilization_data = []
        for i in range(1000):
            record = {
                'member_age': np.random.randint(18, 90),
                'chronic_conditions': np.random.randint(0, 5),
                'risk_score': np.random.uniform(1, 10),
                'prior_utilization': np.random.randint(0, 20),
                'geographic_region': np.random.choice(['Urban', 'Suburban', 'Rural']),
                'socioeconomic_score': np.random.uniform(1, 10),
                'target': np.random.randint(0, 15)  # Visits per year
            }
            utilization_data.append(record)
        
        data[ModelType.UTILIZATION_PREDICTION.value] = utilization_data
        
        # Risk Stratification Data
        risk_data = []
        for i in range(1000):
            record = {
                'age': np.random.randint(18, 90),
                'bmi': np.random.uniform(18, 40),
                'blood_pressure_systolic': np.random.randint(90, 180),
                'cholesterol': np.random.randint(150, 300),
                'diabetes': np.random.choice([0, 1]),
                'smoking': np.random.choice([0, 1]),
                'family_history': np.random.choice([0, 1]),
                'exercise_frequency': np.random.randint(0, 7),
                'target': np.random.uniform(0, 1)  # Risk score
            }
            risk_data.append(record)
        
        data[ModelType.RISK_STRATIFICATION.value] = risk_data
        
        # Readmission Prediction Data
        readmission_data = []
        for i in range(1000):
            record = {
                'age': np.random.randint(18, 90),
                'length_of_stay': np.random.randint(1, 30),
                'discharge_disposition': np.random.choice(['Home', 'SNF', 'Rehab', 'Other']),
                'comorbidity_score': np.random.uniform(0, 10),
                'medication_count': np.random.randint(0, 20),
                'prior_admissions_30d': np.random.randint(0, 3),
                'emergency_admission': np.random.choice([0, 1]),
                'target': np.random.choice([0, 1])  # Readmission within 30 days
            }
            readmission_data.append(record)
        
        data[ModelType.READMISSION_PREDICTION.value] = readmission_data
        
        # Length of Stay Data
        los_data = []
        for i in range(1000):
            record = {
                'age': np.random.randint(18, 90),
                'admission_type': np.random.choice(['Emergency', 'Elective', 'Urgent']),
                'diagnosis_severity': np.random.uniform(1, 10),
                'procedure_complexity': np.random.uniform(1, 10),
                'comorbidity_count': np.random.randint(0, 8),
                'insurance_type': np.random.choice(['Medicare', 'Medicaid', 'Commercial']),
                'target': np.random.randint(1, 30)  # Length of stay in days
            }
            los_data.append(record)
        
        data[ModelType.LENGTH_OF_STAY.value] = los_data
        
        return data

    async def initialize_feature_engineering(self):
        """Initialize feature engineering components"""
        try:
            # Initialize encoders for categorical variables
            self.feature_encoders = {
                'gender': LabelEncoder(),
                'insurance_type': LabelEncoder(),
                'facility_type': LabelEncoder(),
                'geographic_region': LabelEncoder(),
                'discharge_disposition': LabelEncoder(),
                'admission_type': LabelEncoder()
            }
            
            # Initialize scalers
            self.scalers = {
                'standard': StandardScaler(),
                'minmax': StandardScaler()  # Can be replaced with MinMaxScaler
            }
            
        except Exception as e:
            logger.error(f"Failed to initialize feature engineering: {e}")

    async def predict(self, prediction_request: PredictionRequest) -> PredictionResult:
        """Make predictions using trained models"""
        try:
            prediction_id = str(uuid.uuid4())
            
            # Get model
            model_key = f"{prediction_request.model_type.value}_{prediction_request.algorithm.value}"
            model = self.models.get(model_key)
            
            if not model:
                # Try ensemble approach
                model = await self.get_best_model_for_type(prediction_request.model_type)
            
            if not model:
                raise HTTPException(status_code=404, detail=f"Model not found: {model_key}")
            
            # Prepare input data
            processed_data = await self.preprocess_input_data(
                prediction_request.input_data,
                model.feature_columns,
                prediction_request.model_type
            )
            
            # Make prediction
            if prediction_request.algorithm == Algorithm.NEURAL_NETWORK:
                predictions = await self.predict_neural_network(model, processed_data)
            elif prediction_request.algorithm == Algorithm.LSTM:
                predictions = await self.predict_lstm(model, processed_data)
            elif prediction_request.algorithm == Algorithm.PROPHET:
                predictions = await self.predict_prophet(model, processed_data, prediction_request.prediction_horizon)
            else:
                predictions = await self.predict_sklearn(model, processed_data)
            
            # Calculate confidence intervals
            confidence_intervals = await self.calculate_confidence_intervals(
                model, processed_data, predictions, prediction_request.confidence_level
            )
            
            # Generate explanations
            explanations = None
            if prediction_request.include_explanations:
                explanations = await self.generate_explanations(
                    model, processed_data, predictions, prediction_request.input_data
                )
            
            # Get feature importance
            feature_importance = await self.get_feature_importance(model)
            
            result = PredictionResult(
                prediction_id=prediction_id,
                model_type=prediction_request.model_type,
                algorithm=prediction_request.algorithm,
                predictions=predictions,
                confidence_intervals=confidence_intervals,
                feature_importance=feature_importance,
                explanations=explanations,
                metadata={
                    "model_version": model.version,
                    "prediction_timestamp": datetime.utcnow().isoformat(),
                    "input_features": len(model.feature_columns),
                    "model_performance": model.performance_metrics
                }
            )
            
            # Cache result
            await self.cache_prediction_result(prediction_id, result)
            
            # Log prediction
            await self.log_prediction(prediction_request, result)
            
            return result
            
        except Exception as e:
            logger.error(f"Prediction failed: {e}")
            raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")

    async def train_model(self, training_request: TrainingRequest) -> ModelPerformance:
        """Train a new predictive model"""
        try:
            model_id = str(uuid.uuid4())
            start_time = datetime.utcnow()
            
            # Prepare training data
            df = pd.DataFrame(training_request.training_data)
            
            # Feature engineering
            processed_df = await self.engineer_features(df, training_request.model_type)
            
            # Split features and target
            feature_columns = [col for col in processed_df.columns if col != 'target']
            X = processed_df[feature_columns]
            y = processed_df['target']
            
            # Train-test split
            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=training_request.validation_split, random_state=42
            )
            
            # Scale features
            scaler = StandardScaler()
            X_train_scaled = scaler.fit_transform(X_train)
            X_test_scaled = scaler.transform(X_test)
            
            # Train model based on algorithm
            if training_request.algorithm == Algorithm.LINEAR_REGRESSION:
                model_object = LinearRegression(**training_request.hyperparameters)
                model_object.fit(X_train_scaled, y_train)
                
            elif training_request.algorithm == Algorithm.RANDOM_FOREST:
                hyperparams = {'n_estimators': 100, 'random_state': 42}
                hyperparams.update(training_request.hyperparameters)
                model_object = RandomForestRegressor(**hyperparams)
                model_object.fit(X_train_scaled, y_train)
                
            elif training_request.algorithm == Algorithm.GRADIENT_BOOSTING:
                hyperparams = {'n_estimators': 100, 'random_state': 42}
                hyperparams.update(training_request.hyperparameters)
                model_object = GradientBoostingRegressor(**hyperparams)
                model_object.fit(X_train_scaled, y_train)
                
            elif training_request.algorithm == Algorithm.XGBOOST:
                hyperparams = {'n_estimators': 100, 'random_state': 42}
                hyperparams.update(training_request.hyperparameters)
                model_object = xgb.XGBRegressor(**hyperparams)
                model_object.fit(X_train_scaled, y_train)
                
            elif training_request.algorithm == Algorithm.LIGHTGBM:
                hyperparams = {'n_estimators': 100, 'random_state': 42}
                hyperparams.update(training_request.hyperparameters)
                model_object = lgb.LGBMRegressor(**hyperparams)
                model_object.fit(X_train_scaled, y_train)
                
            elif training_request.algorithm == Algorithm.NEURAL_NETWORK:
                model_object = await self.train_neural_network(
                    X_train_scaled, y_train, X_test_scaled, y_test, training_request.hyperparameters
                )
                
            else:
                raise ValueError(f"Unsupported algorithm: {training_request.algorithm}")
            
            # Evaluate model
            y_pred = model_object.predict(X_test_scaled)
            
            metrics = {
                'mae': float(mean_absolute_error(y_test, y_pred)),
                'mse': float(mean_squared_error(y_test, y_pred)),
                'rmse': float(np.sqrt(mean_squared_error(y_test, y_pred))),
                'r2': float(r2_score(y_test, y_pred))
            }
            
            # Cross-validation
            cv_scores = None
            if training_request.cross_validation:
                cv_scores = cross_val_score(model_object, X_train_scaled, y_train, cv=5, scoring='r2')
                metrics['cv_mean'] = float(cv_scores.mean())
                metrics['cv_std'] = float(cv_scores.std())
            
            # Feature importance
            feature_importance = {}
            if hasattr(model_object, 'feature_importances_'):
                feature_importance = dict(zip(feature_columns, model_object.feature_importances_))
            elif hasattr(model_object, 'coef_'):
                feature_importance = dict(zip(feature_columns, abs(model_object.coef_)))
            
            # Create model instance
            model = PredictiveModel(
                model_id=model_id,
                model_type=training_request.model_type,
                algorithm=training_request.algorithm,
                model_object=model_object,
                scaler=scaler,
                feature_columns=feature_columns,
                target_column='target',
                performance_metrics=metrics,
                created_at=start_time,
                last_trained=datetime.utcnow(),
                version="1.0"
            )
            
            # Save model
            model_path = f"/tmp/model_{model_id}.joblib"
            joblib.dump(model_object, model_path)
            
            # Store in memory
            model_key = f"{training_request.model_type.value}_{training_request.algorithm.value}"
            self.models[model_key] = model
            
            # Save to database
            await self.save_model_metadata(model, model_path, feature_importance)
            
            training_time = (datetime.utcnow() - start_time).total_seconds()
            
            return ModelPerformance(
                model_id=model_id,
                algorithm=training_request.algorithm,
                metrics=metrics,
                cross_validation_scores=cv_scores.tolist() if cv_scores is not None else None,
                feature_importance=feature_importance,
                training_time=training_time,
                model_size=len(_safe_model_serialize(model_object))
            )
            
        except Exception as e:
            logger.error(f"Model training failed: {e}")
            raise HTTPException(status_code=500, detail=f"Training failed: {str(e)}")

    async def train_neural_network(self, X_train, y_train, X_test, y_test, hyperparams: Dict[str, Any]):
        """Train neural network model"""
        try:
            # Convert to PyTorch tensors
            X_train_tensor = torch.FloatTensor(X_train)
            y_train_tensor = torch.FloatTensor(y_train.values).reshape(-1, 1)
            X_test_tensor = torch.FloatTensor(X_test)
            y_test_tensor = torch.FloatTensor(y_test.values).reshape(-1, 1)
            
            # Create model
            input_size = X_train.shape[1]
            hidden_sizes = hyperparams.get('hidden_sizes', [128, 64, 32])
            model = HealthcareCostPredictor(input_size, hidden_sizes)
            
            # Training parameters
            learning_rate = hyperparams.get('learning_rate', 0.001)
            epochs = hyperparams.get('epochs', 100)
            batch_size = hyperparams.get('batch_size', 32)
            
            criterion = nn.MSELoss()
            optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)
            
            # Training loop
            for epoch in range(epochs):
                model.train()
                
                # Batch training
                for i in range(0, len(X_train_tensor), batch_size):
                    batch_X = X_train_tensor[i:i+batch_size]
                    batch_y = y_train_tensor[i:i+batch_size]
                    
                    optimizer.zero_grad()
                    outputs = model(batch_X)
                    loss = criterion(outputs, batch_y)
                    loss.backward()
                    optimizer.step()
            
            # Create wrapper for sklearn-like interface
            class PyTorchWrapper:
                def __init__(self, model):
                    self.model = model
                
                def predict(self, X):
                    self.model.eval()
                    with torch.no_grad():
                        X_tensor = torch.FloatTensor(X)
                        predictions = self.model(X_tensor)
                        return predictions.numpy().flatten()
            
            return PyTorchWrapper(model)
            
        except Exception as e:
            logger.error(f"Neural network training failed: {e}")
            raise

    async def preprocess_input_data(self, input_data: Dict[str, Any], feature_columns: List[str], model_type: ModelType) -> np.ndarray:
        """Preprocess input data for prediction"""
        try:
            # Convert to DataFrame
            df = pd.DataFrame([input_data])
            
            # Feature engineering
            processed_df = await self.engineer_features(df, model_type)
            
            # Ensure all required columns are present
            for col in feature_columns:
                if col not in processed_df.columns:
                    processed_df[col] = 0  # Default value
            
            # Select and order columns
            processed_df = processed_df[feature_columns]
            
            return processed_df.values
            
        except Exception as e:
            logger.error(f"Data preprocessing failed: {e}")
            raise

    async def engineer_features(self, df: pd.DataFrame, model_type: ModelType) -> pd.DataFrame:
        """Engineer features for different model types"""
        try:
            processed_df = df.copy()
            
            # Common feature engineering
            if 'age' in processed_df.columns:
                processed_df['age_group'] = pd.cut(processed_df['age'], bins=[0, 18, 35, 50, 65, 100], labels=[0, 1, 2, 3, 4])
                processed_df['age_squared'] = processed_df['age'] ** 2
            
            # Encode categorical variables
            for col, encoder in self.feature_encoders.items():
                if col in processed_df.columns:
                    try:
                        processed_df[col] = encoder.fit_transform(processed_df[col].astype(str))
                    except Exception as e:
                        # Handle unseen categories
                        processed_df[col] = 0
            
            # Model-specific feature engineering
            if model_type == ModelType.COST_FORECASTING:
                if 'length_of_stay' in processed_df.columns and 'severity_score' in processed_df.columns:
                    processed_df['cost_complexity'] = processed_df['length_of_stay'] * processed_df['severity_score']
                
                if 'diagnosis_count' in processed_df.columns and 'procedure_count' in processed_df.columns:
                    processed_df['clinical_complexity'] = processed_df['diagnosis_count'] + processed_df['procedure_count']
            
            elif model_type == ModelType.RISK_STRATIFICATION:
                if 'bmi' in processed_df.columns:
                    processed_df['bmi_category'] = pd.cut(processed_df['bmi'], bins=[0, 18.5, 25, 30, 100], labels=[0, 1, 2, 3])
                
                if 'blood_pressure_systolic' in processed_df.columns:
                    processed_df['hypertension'] = (processed_df['blood_pressure_systolic'] > 140).astype(int)
            
            # Fill missing values
            processed_df = processed_df.fillna(0)
            
            return processed_df
            
        except Exception as e:
            logger.error(f"Feature engineering failed: {e}")
            return df

    async def predict_sklearn(self, model: PredictiveModel, processed_data: np.ndarray) -> Dict[str, Any]:
        """Make predictions using scikit-learn models"""
        try:
            # Scale data if scaler is available
            if model.scaler:
                processed_data = model.scaler.transform(processed_data)
            
            # Make prediction
            prediction = model.model_object.predict(processed_data)
            
            # Handle different output types
            if isinstance(prediction, np.ndarray):
                if prediction.ndim == 1:
                    prediction_value = float(prediction[0])
                else:
                    prediction_value = prediction.tolist()
            else:
                prediction_value = float(prediction)
            
            return {
                "value": prediction_value,
                "type": "point_estimate"
            }
            
        except Exception as e:
            logger.error(f"Sklearn prediction failed: {e}")
            raise

    async def predict_neural_network(self, model: PredictiveModel, processed_data: np.ndarray) -> Dict[str, Any]:
        """Make predictions using neural network models"""
        try:
            prediction = model.model_object.predict(processed_data)
            
            return {
                "value": float(prediction[0]),
                "type": "neural_network"
            }
            
        except Exception as e:
            logger.error(f"Neural network prediction failed: {e}")
            raise

    async def predict_lstm(self, model: PredictiveModel, processed_data: np.ndarray) -> Dict[str, Any]:
        """Make predictions using LSTM models"""
        try:
            # Reshape for LSTM (assuming time series data)
            if processed_data.ndim == 2:
                processed_data = processed_data.reshape(processed_data.shape[0], 1, processed_data.shape[1])
            
            prediction = model.model_object.predict(processed_data)
            
            return {
                "value": float(prediction[0]),
                "type": "time_series"
            }
            
        except Exception as e:
            logger.error(f"LSTM prediction failed: {e}")
            raise

    async def predict_prophet(self, model: PredictiveModel, processed_data: np.ndarray, horizon: int) -> Dict[str, Any]:
        """Make predictions using Prophet models"""
        try:
            # Create future dataframe
            future_dates = pd.date_range(start=datetime.now(), periods=horizon, freq='D')
            future_df = pd.DataFrame({'ds': future_dates})
            
            # Make forecast
            forecast = model.model_object.predict(future_df)
            
            return {
                "forecast": forecast[['ds', 'yhat', 'yhat_lower', 'yhat_upper']].to_dict('records'),
                "type": "time_series_forecast"
            }
            
        except Exception as e:
            logger.error(f"Prophet prediction failed: {e}")
            raise

    async def calculate_confidence_intervals(self, model: PredictiveModel, processed_data: np.ndarray, 
                                           predictions: Dict[str, Any], confidence_level: float) -> Dict[str, Any]:
        """Calculate confidence intervals for predictions"""
        try:
            # Mock confidence interval calculation
            # In real implementation, use bootstrap or model-specific methods
            prediction_value = predictions.get("value", 0)
            margin = abs(prediction_value) * 0.1  # 10% margin
            
            alpha = 1 - confidence_level
            lower_bound = prediction_value - margin
            upper_bound = prediction_value + margin
            
            return {
                "lower_bound": lower_bound,
                "upper_bound": upper_bound,
                "confidence_level": confidence_level
            }
            
        except Exception as e:
            logger.error(f"Confidence interval calculation failed: {e}")
            return {}

    async def generate_explanations(self, model: PredictiveModel, processed_data: np.ndarray, 
                                  predictions: Dict[str, Any], original_data: Dict[str, Any]) -> Dict[str, Any]:
        """Generate explanations for predictions"""
        try:
            explanations = {
                "model_type": model.model_type.value,
                "algorithm": model.algorithm.value,
                "key_factors": [],
                "interpretation": ""
            }
            
            # Feature importance based explanations
            if hasattr(model.model_object, 'feature_importances_'):
                importances = model.model_object.feature_importances_
                feature_importance_pairs = list(zip(model.feature_columns, importances))
                feature_importance_pairs.sort(key=lambda x: x[1], reverse=True)
                
                explanations["key_factors"] = [
                    {"feature": feature, "importance": float(importance)}
                    for feature, importance in feature_importance_pairs[:5]
                ]
            
            # Generate interpretation
            prediction_value = predictions.get("value", 0)
            if model.model_type == ModelType.COST_FORECASTING:
                if prediction_value > 10000:
                    explanations["interpretation"] = "High cost prediction due to complexity factors"
                else:
                    explanations["interpretation"] = "Moderate cost prediction within normal range"
            
            return explanations
            
        except Exception as e:
            logger.error(f"Explanation generation failed: {e}")
            return {}

    async def get_feature_importance(self, model: PredictiveModel) -> Dict[str, float]:
        """Get feature importance from model"""
        try:
            if hasattr(model.model_object, 'feature_importances_'):
                return dict(zip(model.feature_columns, model.model_object.feature_importances_.tolist()))
            elif hasattr(model.model_object, 'coef_'):
                return dict(zip(model.feature_columns, abs(model.model_object.coef_).tolist()))
            else:
                return {}
        except Exception as e:
            logger.error(f"Feature importance extraction failed: {e}")
            return {}

    async def get_best_model_for_type(self, model_type: ModelType) -> Optional[PredictiveModel]:
        """Get the best performing model for a given type"""
        try:
            best_model = None
            best_score = -float('inf')
            
            for key, model in self.models.items():
                if model.model_type == model_type:
                    score = model.performance_metrics.get('r2', -float('inf'))
                    if score > best_score:
                        best_score = score
                        best_model = model
            
            return best_model
            
        except Exception as e:
            logger.error(f"Best model selection failed: {e}")
            return None

    # Database operations
    async def save_model_metadata(self, model: PredictiveModel, model_path: str, feature_importance: Dict[str, float]):
        """Save model metadata to database"""
        try:
            async with self.db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO predictive_models (
                        model_id, model_type, algorithm, model_path, feature_columns,
                        performance_metrics, feature_importance, version, created_at, is_active
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                """, model.model_id, model.model_type.value, model.algorithm.value, model_path,
                    json.dumps(model.feature_columns), json.dumps(model.performance_metrics),
                    json.dumps(feature_importance), model.version, model.created_at, True)
        except Exception as e:
            logger.error(f"Failed to save model metadata: {e}")

    async def cache_prediction_result(self, prediction_id: str, result: PredictionResult):
        """Cache prediction result"""
        try:
            await self.redis.setex(
                f"prediction:{prediction_id}",
                3600,  # 1 hour
                json.dumps(result.dict(), default=str)
            )
        except Exception as e:
            logger.error(f"Failed to cache prediction result: {e}")

    async def log_prediction(self, request: PredictionRequest, result: PredictionResult):
        """Log prediction for audit purposes"""
        try:
            async with self.db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO prediction_logs (
                        prediction_id, model_type, algorithm, input_data, predictions,
                        timestamp, confidence_level
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                """, result.prediction_id, request.model_type.value, request.algorithm.value,
                    json.dumps(request.input_data), json.dumps(result.predictions),
                    datetime.utcnow(), request.confidence_level)
        except Exception as e:
            logger.error(f"Failed to log prediction: {e}")

# Global service instance
predictive_service = PredictiveModelingService()

# API Routes
@app.on_event("startup")
async def startup_event():
    await predictive_service.initialize()

@app.post("/predict", response_model=PredictionResult)
async def make_prediction(
    prediction_request: PredictionRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Make predictions using trained models"""
    return await predictive_service.predict(prediction_request)

@app.post("/train", response_model=ModelPerformance)
async def train_model(
    training_request: TrainingRequest,
    background_tasks: BackgroundTasks,
    credentials: HTTPAuthorizationCredentials = Depends(security)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Train a new predictive model"""
    return await predictive_service.train_model(training_request)

@app.get("/models")
async def list_models(
    credentials: HTTPAuthorizationCredentials = Depends(security)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """List available models"""
    models_info = []
    for key, model in predictive_service.models.items():
        models_info.append({
            "model_id": model.model_id,
            "model_type": model.model_type.value,
            "algorithm": model.algorithm.value,
            "performance_metrics": model.performance_metrics,
            "feature_count": len(model.feature_columns),
            "version": model.version,
            "last_trained": model.last_trained.isoformat()
        })
    
    return {"models": models_info}

@app.get("/models/{model_type}/best")
async def get_best_model(
    model_type: ModelType,
    credentials: HTTPAuthorizationCredentials = Depends(security)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get the best performing model for a type"""
    best_model = await predictive_service.get_best_model_for_type(model_type)
    if not best_model:
        raise HTTPException(status_code=404, detail=f"No model found for type: {model_type}")
    
    return {
        "model_id": best_model.model_id,
        "algorithm": best_model.algorithm.value,
        "performance_metrics": best_model.performance_metrics,
        "feature_columns": best_model.feature_columns
    }

@app.get("/predictions/{prediction_id}")
async def get_prediction_result(
    prediction_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(security)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get cached prediction result"""
    try:
        cached_result = await predictive_service.redis.get(f"prediction:{prediction_id}")
        if cached_result:
            return json.loads(cached_result)
        else:
            raise HTTPException(status_code=404, detail="Prediction result not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get prediction result: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Predictive Modeling Service",
        "models_loaded": len(predictive_service.models),
        "timestamp": datetime.utcnow().isoformat()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8018)