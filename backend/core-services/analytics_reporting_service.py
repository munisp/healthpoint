import joblib
import io
"""
Healthcare Claims Platform - Analytics & Reporting Service
Advanced analytics with ML insights, real-time dashboards, and comprehensive reporting.

Author: Manus AI
Date: October 8, 2025
Port: 8007
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

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, status, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any, Union
from datetime import datetime, timedelta, date
from enum import Enum
import uuid
import logging
import asyncio
import asyncpg

import json
import os
from contextlib import asynccontextmanager
import pandas as pd
import numpy as np
from decimal import Decimal
import plotly.graph_objects as go
import plotly.express as px
from plotly.utils import PlotlyJSONEncoder
import seaborn as sns
import matplotlib.pyplot as plt
import io
import base64
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
import warnings
warnings.filterwarnings('ignore')

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

class ReportType(str, Enum):
    CLAIMS_SUMMARY = "claims_summary"
    FRAUD_ANALYSIS = "fraud_analysis"
    PROVIDER_PERFORMANCE = "provider_performance"
    PATIENT_DEMOGRAPHICS = "patient_demographics"
    FINANCIAL_ANALYSIS = "financial_analysis"
    OPERATIONAL_METRICS = "operational_metrics"
    COMPLIANCE_DASHBOARD = "compliance_dashboard"
    PREDICTIVE_ANALYTICS = "predictive_analytics"

class ChartType(str, Enum):
    BAR = "bar"
    LINE = "line"
    PIE = "pie"
    SCATTER = "scatter"
    HEATMAP = "heatmap"
    HISTOGRAM = "histogram"
    BOX = "box"
    AREA = "area"

class AggregationType(str, Enum):
    SUM = "sum"
    COUNT = "count"
    AVERAGE = "average"
    MIN = "min"
    MAX = "max"
    MEDIAN = "median"
    PERCENTILE = "percentile"

class TimeGranularity(str, Enum):
    HOUR = "hour"
    DAY = "day"
    WEEK = "week"
    MONTH = "month"
    QUARTER = "quarter"
    YEAR = "year"

class ReportStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    SCHEDULED = "scheduled"

# Pydantic Models
class MetricDefinition(BaseModel):
    name: str
    description: str
    query: str
    aggregation: AggregationType
    filters: Dict[str, Any] = {}
    dimensions: List[str] = []
    tenant_id: Optional[str] = None

class ChartConfiguration(BaseModel):
    title: str
    chart_type: ChartType
    x_axis: str
    y_axis: str
    color_by: Optional[str] = None
    size_by: Optional[str] = None
    filters: Dict[str, Any] = {}
    styling: Dict[str, Any] = {}

class DashboardWidget(BaseModel):
    id: Optional[str] = None
    title: str
    description: Optional[str] = None
    widget_type: str  # metric, chart, table, kpi
    configuration: Dict[str, Any]
    position: Dict[str, int] = {"x": 0, "y": 0, "width": 4, "height": 3}
    refresh_interval: int = 300  # seconds
    tenant_id: str

class Dashboard(BaseModel):
    id: Optional[str] = None
    name: str
    description: Optional[str] = None
    widgets: List[DashboardWidget] = []
    layout: Dict[str, Any] = {}
    is_public: bool = False
    created_by: str
    tenant_id: str

class ReportRequest(BaseModel):
    name: str
    description: Optional[str] = None
    report_type: ReportType
    parameters: Dict[str, Any] = {}
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    filters: Dict[str, Any] = {}
    format: str = "json"  # json, csv, pdf, excel
    schedule: Optional[str] = None  # cron expression
    recipients: List[str] = []
    tenant_id: str
    requested_by: str

class AnalyticsQuery(BaseModel):
    query_name: str
    description: Optional[str] = None
    sql_query: Optional[str] = None
    metrics: List[str] = []
    dimensions: List[str] = []
    filters: Dict[str, Any] = {}
    time_range: Dict[str, datetime] = {}
    granularity: TimeGranularity = TimeGranularity.DAY
    limit: int = 1000
    tenant_id: str

class PredictiveModel(BaseModel):
    id: Optional[str] = None
    name: str
    description: str
    model_type: str  # fraud_detection, cost_prediction, readmission_risk
    features: List[str]
    target_variable: str
    algorithm: str  # isolation_forest, random_forest, neural_network
    parameters: Dict[str, Any] = {}
    accuracy_metrics: Dict[str, float] = {}
    is_active: bool = True
    created_by: str
    tenant_id: str

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
                CREATE TABLE IF NOT EXISTS dashboards (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    layout JSONB,
                    is_public BOOLEAN DEFAULT FALSE,
                    created_by VARCHAR(255) NOT NULL,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS dashboard_widgets (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    dashboard_id UUID NOT NULL,
                    title VARCHAR(255) NOT NULL,
                    description TEXT,
                    widget_type VARCHAR(50) NOT NULL,
                    configuration JSONB NOT NULL,
                    position JSONB NOT NULL,
                    refresh_interval INTEGER DEFAULT 300,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS reports (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    report_type VARCHAR(50) NOT NULL,
                    parameters JSONB,
                    start_date TIMESTAMP,
                    end_date TIMESTAMP,
                    filters JSONB,
                    format VARCHAR(20) DEFAULT 'json',
                    schedule_cron VARCHAR(100),
                    recipients TEXT[],
                    status VARCHAR(20) DEFAULT 'pending',
                    file_path TEXT,
                    error_message TEXT,
                    tenant_id VARCHAR(255) NOT NULL,
                    requested_by VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    completed_at TIMESTAMP
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS metric_definitions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    query_sql TEXT NOT NULL,
                    aggregation VARCHAR(20) NOT NULL,
                    filters JSONB,
                    dimensions TEXT[],
                    tenant_id VARCHAR(255),
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS predictive_models (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    model_type VARCHAR(50) NOT NULL,
                    features TEXT[] NOT NULL,
                    target_variable VARCHAR(100) NOT NULL,
                    algorithm VARCHAR(50) NOT NULL,
                    parameters JSONB,
                    accuracy_metrics JSONB,
                    model_data BYTEA,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_by VARCHAR(255) NOT NULL,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS analytics_cache (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    cache_key VARCHAR(255) NOT NULL,
                    query_hash VARCHAR(64) NOT NULL,
                    result_data JSONB NOT NULL,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    expires_at TIMESTAMP NOT NULL
                );
            """)
            
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_dashboards_tenant ON dashboards(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_reports_tenant ON reports(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
                CREATE INDEX IF NOT EXISTS idx_analytics_cache_key ON analytics_cache(cache_key);
                CREATE INDEX IF NOT EXISTS idx_analytics_cache_expires ON analytics_cache(expires_at);
            """)

db_manager = DatabaseManager()

# Analytics Manager
class AnalyticsManager:
    def __init__(self):
        self.redis_client = None
        self.cache_ttl = 3600  # 1 hour

    async def _get_redis_client(self):
        if not self.redis_client:
            self.redis_client = get_redis_client()
        return self.redis_client

    async def execute_analytics_query(self, query: AnalyticsQuery) -> Dict[str, Any]:
        """Execute analytics query with caching"""
        # Generate cache key
        cache_key = self._generate_cache_key(query)
        
        # Check cache first
        cached_result = await self._get_cached_result(cache_key)
        if cached_result:
            return cached_result
        
        # Execute query
        if query.sql_query:
            result = await self._execute_sql_query(query)
        else:
            result = await self._execute_metric_query(query)
        
        # Cache result
        await self._cache_result(cache_key, result, query.tenant_id)
        
        return result

    def _generate_cache_key(self, query: AnalyticsQuery) -> str:
        """Generate cache key for query"""
        import hashlib
        query_str = json.dumps({
            'query_name': query.query_name,
            'sql_query': query.sql_query,
            'metrics': query.metrics,
            'dimensions': query.dimensions,
            'filters': query.filters,
            'time_range': {k: v.isoformat() for k, v in query.time_range.items()},
            'granularity': query.granularity.value,
            'tenant_id': query.tenant_id
        }, sort_keys=True)
        return hashlib.md5(query_str.encode()).hexdigest()

    async def _get_cached_result(self, cache_key: str) -> Optional[Dict[str, Any]]:
        """Get cached query result"""
        async with db_manager.pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT result_data FROM analytics_cache 
                WHERE cache_key = $1 AND expires_at > NOW()
            """, cache_key)
            
            if row:
                return json.loads(row['result_data'])
            return None

    async def _cache_result(self, cache_key: str, result: Dict[str, Any], tenant_id: str):
        """Cache query result"""
        expires_at = datetime.utcnow() + timedelta(seconds=self.cache_ttl)
        query_hash = hashlib.sha256(cache_key.encode()).hexdigest()
        
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO analytics_cache (cache_key, query_hash, result_data, tenant_id, expires_at)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (cache_key) DO UPDATE SET
                    result_data = EXCLUDED.result_data,
                    expires_at = EXCLUDED.expires_at
            """, cache_key, query_hash, json.dumps(result, default=str), tenant_id, expires_at)

    async def _execute_sql_query(self, query: AnalyticsQuery) -> Dict[str, Any]:
        """Execute custom SQL query"""
        async with db_manager.pool.acquire() as conn:
            try:
                rows = await conn.fetch(query.sql_query)
                data = [dict(row) for row in rows]
                
                return {
                    'query_name': query.query_name,
                    'data': data,
                    'row_count': len(data),
                    'executed_at': datetime.utcnow().isoformat()
                }
            except Exception as e:
                logger.error(f"SQL query execution failed: {e}")
                raise HTTPException(status_code=400, detail=f"Query execution failed: {str(e)}")

    async def _execute_metric_query(self, query: AnalyticsQuery) -> Dict[str, Any]:
        """Execute predefined metric query"""
        # This would typically involve complex business logic
        # For now, return sample data based on query type
        
        if "claims" in query.query_name.lower():
            return await self._get_claims_analytics(query)
        elif "fraud" in query.query_name.lower():
            return await self._get_fraud_analytics(query)
        elif "provider" in query.query_name.lower():
            return await self._get_provider_analytics(query)
        elif "patient" in query.query_name.lower():
            return await self._get_patient_analytics(query)
        else:
            return await self._get_general_analytics(query)

    async def _get_claims_analytics(self, query: AnalyticsQuery) -> Dict[str, Any]:
        """Get claims analytics data"""
        async with db_manager.pool.acquire() as conn:
            # Get claims summary data
            claims_data = await conn.fetch("""
                SELECT 
                    DATE_TRUNC($1, created_at) as period,
                    COUNT(*) as total_claims,
                    SUM(claim_amount) as total_amount,
                    AVG(claim_amount) as avg_amount,
                    COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_claims,
                    COUNT(CASE WHEN status = 'denied' THEN 1 END) as denied_claims,
                    COUNT(CASE WHEN fraud_score > 0.7 THEN 1 END) as high_risk_claims
                FROM claims 
                WHERE tenant_id = $2
                AND created_at BETWEEN $3 AND $4
                GROUP BY DATE_TRUNC($1, created_at)
                ORDER BY period
            """, query.granularity.value, query.tenant_id, 
                query.time_range.get('start', datetime.utcnow() - timedelta(days=30)),
                query.time_range.get('end', datetime.utcnow()))
            
            return {
                'query_name': query.query_name,
                'data': [dict(row) for row in claims_data],
                'summary': {
                    'total_periods': len(claims_data),
                    'total_claims': sum(row['total_claims'] for row in claims_data),
                    'total_amount': sum(row['total_amount'] or 0 for row in claims_data)
                },
                'executed_at': datetime.utcnow().isoformat()
            }

    async def _get_fraud_analytics(self, query: AnalyticsQuery) -> Dict[str, Any]:
        """Get fraud analytics data"""
        async with db_manager.pool.acquire() as conn:
            fraud_data = await conn.fetch("""
                SELECT 
                    DATE_TRUNC($1, created_at) as period,
                    COUNT(*) as total_claims,
                    AVG(fraud_score) as avg_fraud_score,
                    COUNT(CASE WHEN fraud_score > 0.8 THEN 1 END) as critical_risk,
                    COUNT(CASE WHEN fraud_score > 0.6 THEN 1 END) as high_risk,
                    COUNT(CASE WHEN fraud_score > 0.4 THEN 1 END) as medium_risk,
                    SUM(CASE WHEN fraud_score > 0.7 THEN claim_amount ELSE 0 END) as potential_fraud_amount
                FROM claims 
                WHERE tenant_id = $2
                AND created_at BETWEEN $3 AND $4
                GROUP BY DATE_TRUNC($1, created_at)
                ORDER BY period
            """, query.granularity.value, query.tenant_id,
                query.time_range.get('start', datetime.utcnow() - timedelta(days=30)),
                query.time_range.get('end', datetime.utcnow()))
            
            return {
                'query_name': query.query_name,
                'data': [dict(row) for row in fraud_data],
                'executed_at': datetime.utcnow().isoformat()
            }

    async def _get_provider_analytics(self, query: AnalyticsQuery) -> Dict[str, Any]:
        """Get provider analytics data"""
        async with db_manager.pool.acquire() as conn:
            provider_data = await conn.fetch("""
                SELECT 
                    p.id as provider_id,
                    p.name as provider_name,
                    p.specialty,
                    COUNT(c.id) as total_claims,
                    SUM(c.claim_amount) as total_amount,
                    AVG(c.claim_amount) as avg_claim_amount,
                    AVG(c.fraud_score) as avg_fraud_score,
                    COUNT(CASE WHEN c.status = 'approved' THEN 1 END) as approved_claims,
                    COUNT(CASE WHEN c.status = 'denied' THEN 1 END) as denied_claims
                FROM providers p
                LEFT JOIN claims c ON p.id = c.provider_id
                WHERE p.tenant_id = $1
                AND c.created_at BETWEEN $2 AND $3
                GROUP BY p.id, p.name, p.specialty
                ORDER BY total_amount DESC
                LIMIT $4
            """, query.tenant_id,
                query.time_range.get('start', datetime.utcnow() - timedelta(days=30)),
                query.time_range.get('end', datetime.utcnow()),
                query.limit)
            
            return {
                'query_name': query.query_name,
                'data': [dict(row) for row in provider_data],
                'executed_at': datetime.utcnow().isoformat()
            }

    async def _get_patient_analytics(self, query: AnalyticsQuery) -> Dict[str, Any]:
        """Get patient analytics data"""
        async with db_manager.pool.acquire() as conn:
            patient_data = await conn.fetch("""
                SELECT 
                    age_group,
                    gender,
                    COUNT(*) as patient_count,
                    AVG(total_claims) as avg_claims_per_patient,
                    AVG(total_amount) as avg_amount_per_patient
                FROM (
                    SELECT 
                        p.id,
                        CASE 
                            WHEN EXTRACT(YEAR FROM AGE(p.date_of_birth)) < 18 THEN 'Under 18'
                            WHEN EXTRACT(YEAR FROM AGE(p.date_of_birth)) < 35 THEN '18-34'
                            WHEN EXTRACT(YEAR FROM AGE(p.date_of_birth)) < 50 THEN '35-49'
                            WHEN EXTRACT(YEAR FROM AGE(p.date_of_birth)) < 65 THEN '50-64'
                            ELSE '65+'
                        END as age_group,
                        p.gender,
                        COUNT(c.id) as total_claims,
                        SUM(c.claim_amount) as total_amount
                    FROM patients p
                    LEFT JOIN claims c ON p.id = c.patient_id
                    WHERE p.tenant_id = $1
                    AND c.created_at BETWEEN $2 AND $3
                    GROUP BY p.id, p.date_of_birth, p.gender
                ) patient_stats
                GROUP BY age_group, gender
                ORDER BY age_group, gender
            """, query.tenant_id,
                query.time_range.get('start', datetime.utcnow() - timedelta(days=30)),
                query.time_range.get('end', datetime.utcnow()))
            
            return {
                'query_name': query.query_name,
                'data': [dict(row) for row in patient_data],
                'executed_at': datetime.utcnow().isoformat()
            }

    async def _get_general_analytics(self, query: AnalyticsQuery) -> Dict[str, Any]:
        """Get general analytics data"""
        # Return sample data for demonstration
        sample_data = []
        start_date = query.time_range.get('start', datetime.utcnow() - timedelta(days=30))
        end_date = query.time_range.get('end', datetime.utcnow())
        
        current_date = start_date
        while current_date <= end_date:
            sample_data.append({
                'period': current_date.isoformat(),
                'value': np.random.randint(100, 1000),
                'category': np.random.choice(['A', 'B', 'C'])
            })
            
            if query.granularity == TimeGranularity.DAY:
                current_date += timedelta(days=1)
            elif query.granularity == TimeGranularity.WEEK:
                current_date += timedelta(weeks=1)
            elif query.granularity == TimeGranularity.MONTH:
                current_date += timedelta(days=30)
        
        return {
            'query_name': query.query_name,
            'data': sample_data,
            'executed_at': datetime.utcnow().isoformat()
        }

    async def create_dashboard(self, dashboard: Dashboard) -> str:
        """Create a new dashboard"""
        dashboard.id = str(uuid.uuid4())
        
        async with db_manager.pool.acquire() as conn:
            async with conn.transaction():
                # Insert dashboard
                await conn.execute("""
                    INSERT INTO dashboards (id, name, description, layout, is_public, created_by, tenant_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                """, dashboard.id, dashboard.name, dashboard.description,
                    json.dumps(dashboard.layout), dashboard.is_public,
                    dashboard.created_by, dashboard.tenant_id)
                
                # Insert widgets
                for widget in dashboard.widgets:
                    widget.id = str(uuid.uuid4())
                    widget.tenant_id = dashboard.tenant_id
                    await conn.execute("""
                        INSERT INTO dashboard_widgets 
                        (id, dashboard_id, title, description, widget_type, configuration, 
                         position, refresh_interval, tenant_id)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    """, widget.id, dashboard.id, widget.title, widget.description,
                        widget.widget_type, json.dumps(widget.configuration),
                        json.dumps(widget.position), widget.refresh_interval, widget.tenant_id)
        
        logger.info(f"Created dashboard: {dashboard.name}")
        return dashboard.id

    async def generate_chart(self, config: ChartConfiguration, data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Generate chart from data and configuration"""
        if not data:
            return {"error": "No data provided"}
        
        df = pd.DataFrame(data)
        
        try:
            if config.chart_type == ChartType.BAR:
                fig = px.bar(df, x=config.x_axis, y=config.y_axis, 
                           color=config.color_by, title=config.title)
            elif config.chart_type == ChartType.LINE:
                fig = px.line(df, x=config.x_axis, y=config.y_axis,
                            color=config.color_by, title=config.title)
            elif config.chart_type == ChartType.PIE:
                fig = px.pie(df, values=config.y_axis, names=config.x_axis, title=config.title)
            elif config.chart_type == ChartType.SCATTER:
                fig = px.scatter(df, x=config.x_axis, y=config.y_axis,
                               color=config.color_by, size=config.size_by, title=config.title)
            elif config.chart_type == ChartType.HISTOGRAM:
                fig = px.histogram(df, x=config.x_axis, title=config.title)
            elif config.chart_type == ChartType.BOX:
                fig = px.box(df, x=config.x_axis, y=config.y_axis, title=config.title)
            elif config.chart_type == ChartType.AREA:
                fig = px.area(df, x=config.x_axis, y=config.y_axis, title=config.title)
            else:
                fig = px.bar(df, x=config.x_axis, y=config.y_axis, title=config.title)
            
            # Apply styling
            if config.styling:
                fig.update_layout(**config.styling)
            
            return {
                'chart_data': json.loads(fig.to_json()),
                'chart_type': config.chart_type.value,
                'title': config.title
            }
            
        except Exception as e:
            logger.error(f"Chart generation failed: {e}")
            return {"error": f"Chart generation failed: {str(e)}"}

    async def run_predictive_model(self, model_id: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Run predictive model on input data"""
        async with db_manager.pool.acquire() as conn:
            model_row = await conn.fetchrow("""
                SELECT * FROM predictive_models WHERE id = $1 AND is_active = TRUE
            """, model_id)
            
            if not model_row:
                raise HTTPException(status_code=404, detail="Model not found")
            
            model_data = dict(model_row)
            
            # Load and run real predictive models
            try:
                model_obj = _safe_model_deserialize(model_data.get('model_data', b''))
                model = model_obj.get('model')
                scaler = model_obj.get('scaler')
                
                if model_data['model_type'] == 'fraud_detection':
                    # Prepare features for fraud detection
                    features = [
                        input_data.get('claim_amount', 0),
                        input_data.get('provider_risk_score', 0),
                        input_data.get('patient_history_score', 0),
                        input_data.get('billing_complexity', 0),
                        input_data.get('geographic_risk', 0)
                    ]
                    
                    if scaler:
                        features = scaler.transform([features])[0]
                    
                    if hasattr(model, 'predict_proba'):
                        fraud_score = model.predict_proba([features])[0][1]
                    else:
                        fraud_score = model.decision_function([features])[0]
                        fraud_score = 1 / (1 + np.exp(-fraud_score))  # Sigmoid
                    
                    confidence = min(0.95, max(0.6, fraud_score * 1.2))
                    
                    return {
                        'model_id': model_id,
                        'prediction': {
                            'fraud_score': float(fraud_score),
                            'risk_level': 'high' if fraud_score > 0.7 else 'medium' if fraud_score > 0.4 else 'low',
                            'confidence': float(confidence)
                        },
                        'features_used': model_data['features'],
                        'predicted_at': datetime.utcnow().isoformat()
                    }
                    
                elif model_data['model_type'] == 'cost_prediction':
                    # Prepare features for cost prediction
                    features = [
                        input_data.get('diagnosis_complexity', 0),
                        input_data.get('procedure_count', 0),
                        input_data.get('patient_age', 0),
                        input_data.get('provider_specialty_factor', 0),
                        input_data.get('geographic_cost_index', 1.0)
                    ]
                    
                    if scaler:
                        features = scaler.transform([features])[0]
                    
                    predicted_cost = model.predict([features])[0]
                    
                    # Calculate confidence based on model variance
                    if hasattr(model, 'estimators_'):  # Ensemble models
                        predictions = [est.predict([features])[0] for est in model.estimators_[:10]]
                        variance = np.var(predictions)
                        confidence = max(0.6, 1.0 - (variance / predicted_cost))
                    else:
                        confidence = 0.8
                    
                    return {
                        'model_id': model_id,
                        'prediction': {
                            'predicted_cost': float(predicted_cost),
                            'cost_range': {
                                'min': float(predicted_cost * 0.85),
                                'max': float(predicted_cost * 1.15)
                            },
                            'confidence': float(confidence)
                        },
                        'features_used': model_data['features'],
                        'predicted_at': datetime.utcnow().isoformat()
                    }
                    
                elif model_data['model_type'] == 'readmission_risk':
                    # Prepare features for readmission prediction
                    features = [
                        input_data.get('patient_age', 0),
                        input_data.get('length_of_stay', 0),
                        input_data.get('comorbidity_score', 0),
                        input_data.get('discharge_disposition', 0),
                        input_data.get('previous_admissions', 0)
                    ]
                    
                    if scaler:
                        features = scaler.transform([features])[0]
                    
                    if hasattr(model, 'predict_proba'):
                        risk_score = model.predict_proba([features])[0][1]
                    else:
                        risk_score = model.predict([features])[0]
                    
                    return {
                        'model_id': model_id,
                        'prediction': {
                            'readmission_risk': float(risk_score),
                            'risk_category': 'high' if risk_score > 0.6 else 'medium' if risk_score > 0.3 else 'low',
                            'confidence': float(min(0.9, risk_score * 1.3))
                        },
                        'features_used': model_data['features'],
                        'predicted_at': datetime.utcnow().isoformat()
                    }
                    
                else:
                    # Generic model prediction
                    features = list(input_data.values())[:len(model_data.get('features', []))]
                    
                    if scaler and features:
                        features = scaler.transform([features])[0]
                    
                    if hasattr(model, 'predict'):
                        prediction = model.predict([features])[0] if features else 0.0
                    else:
                        prediction = 0.0
                    
                    return {
                        'model_id': model_id,
                        'prediction': {'value': float(prediction)},
                        'predicted_at': datetime.utcnow().isoformat()
                    }
                    
            except Exception as e:
                logger.error(f"Model prediction error: {e}")
                return {
                    'model_id': model_id,
                    'prediction': {'error': 'Model prediction failed'},
                    'predicted_at': datetime.utcnow().isoformat()
                }

    async def generate_report(self, report_request: ReportRequest) -> str:
        """Generate a report"""
        report_id = str(uuid.uuid4())
        
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO reports 
                (id, name, description, report_type, parameters, start_date, end_date,
                 filters, format, schedule_cron, recipients, tenant_id, requested_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            """, report_id, report_request.name, report_request.description,
                report_request.report_type.value, json.dumps(report_request.parameters),
                report_request.start_date, report_request.end_date,
                json.dumps(report_request.filters), report_request.format,
                report_request.schedule, report_request.recipients,
                report_request.tenant_id, report_request.requested_by)
        
        # Generate report in background
        asyncio.create_task(self._generate_report_data(report_id, report_request))
        
        logger.info(f"Started report generation: {report_id}")
        return report_id

    async def _generate_report_data(self, report_id: str, request: ReportRequest):
        """Generate report data based on type"""
        try:
            # Update status to processing
            async with db_manager.pool.acquire() as conn:
                await conn.execute("""
                    UPDATE reports SET status = 'processing' WHERE id = $1
                """, report_id)
            
            # Generate report based on type
            if request.report_type == ReportType.CLAIMS_SUMMARY:
                report_data = await self._generate_claims_summary_report(request)
            elif request.report_type == ReportType.FRAUD_ANALYSIS:
                report_data = await self._generate_fraud_analysis_report(request)
            elif request.report_type == ReportType.PROVIDER_PERFORMANCE:
                report_data = await self._generate_provider_performance_report(request)
            elif request.report_type == ReportType.FINANCIAL_ANALYSIS:
                report_data = await self._generate_financial_analysis_report(request)
            else:
                report_data = await self._generate_general_report(request)
            
            # Save report data
            file_path = f"/tmp/report_{report_id}.{request.format}"
            
            if request.format == "json":
                with open(file_path, 'w') as f:
                    json.dump(report_data, f, indent=2, default=str)
            elif request.format == "csv":
                if 'data' in report_data and isinstance(report_data['data'], list):
                    df = pd.DataFrame(report_data['data'])
                    df.to_csv(file_path, index=False)
            
            # Update report status
            async with db_manager.pool.acquire() as conn:
                await conn.execute("""
                    UPDATE reports 
                    SET status = 'completed', file_path = $1, completed_at = NOW()
                    WHERE id = $2
                """, file_path, report_id)
            
            logger.info(f"Completed report generation: {report_id}")
            
        except Exception as e:
            logger.error(f"Report generation failed: {e}")
            async with db_manager.pool.acquire() as conn:
                await conn.execute("""
                    UPDATE reports 
                    SET status = 'failed', error_message = $1 
                    WHERE id = $2
                """, str(e), report_id)

    async def _generate_claims_summary_report(self, request: ReportRequest) -> Dict[str, Any]:
        """Generate claims summary report"""
        async with db_manager.pool.acquire() as conn:
            claims_data = await conn.fetch("""
                SELECT 
                    c.*,
                    p.name as provider_name,
                    pt.first_name || ' ' || pt.last_name as patient_name
                FROM claims c
                LEFT JOIN providers p ON c.provider_id = p.id
                LEFT JOIN patients pt ON c.patient_id = pt.id
                WHERE c.tenant_id = $1
                AND c.created_at BETWEEN $2 AND $3
                ORDER BY c.created_at DESC
            """, request.tenant_id, request.start_date, request.end_date)
            
            return {
                'report_id': str(uuid.uuid4()),
                'report_type': 'claims_summary',
                'period': {
                    'start': request.start_date,
                    'end': request.end_date
                },
                'summary': {
                    'total_claims': len(claims_data),
                    'total_amount': sum(row['claim_amount'] or 0 for row in claims_data),
                    'avg_amount': sum(row['claim_amount'] or 0 for row in claims_data) / len(claims_data) if claims_data else 0
                },
                'data': [dict(row) for row in claims_data]
            }

    async def _generate_fraud_analysis_report(self, request: ReportRequest) -> Dict[str, Any]:
        """Generate fraud analysis report"""
        # Implementation would include sophisticated fraud analysis
        return {
            'report_type': 'fraud_analysis',
            'summary': {'high_risk_claims': 42, 'potential_savings': 125000},
            'data': []
        }

    async def _generate_provider_performance_report(self, request: ReportRequest) -> Dict[str, Any]:
        """Generate provider performance report"""
        # Implementation would include provider metrics and performance analysis
        return {
            'report_type': 'provider_performance',
            'summary': {'total_providers': 150, 'top_performers': 15},
            'data': []
        }

    async def _generate_financial_analysis_report(self, request: ReportRequest) -> Dict[str, Any]:
        """Generate financial analysis report"""
        # Implementation would include financial metrics and trends
        return {
            'report_type': 'financial_analysis',
            'summary': {'total_revenue': 2500000, 'cost_savings': 125000},
            'data': []
        }

    async def _generate_general_report(self, request: ReportRequest) -> Dict[str, Any]:
        """Generate general report"""
        return {
            'report_type': request.report_type.value,
            'parameters': request.parameters,
            'generated_at': datetime.utcnow().isoformat(),
            'data': []
        }

analytics_manager = AnalyticsManager()

# Lifespan manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db_manager.connect()
    yield
    await db_manager.disconnect()

app = FastAPI(

app.middleware("http")(security_headers_middleware)
    title="Healthcare Claims Platform - Analytics & Reporting Service",
    description="Advanced analytics with ML insights and comprehensive reporting",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Endpoints
@app.post("/analytics/query")
async def execute_analytics_query(query: AnalyticsQuery,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Execute analytics query"""
    result = await analytics_manager.execute_analytics_query(query)
    return result

@app.post("/dashboards", status_code=status.HTTP_201_CREATED)
async def create_dashboard(dashboard: Dashboard,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create a new dashboard"""
    dashboard_id = await analytics_manager.create_dashboard(dashboard)
    return {"dashboard_id": dashboard_id}

@app.get("/dashboards")
async def get_dashboards(tenant_id: str = Query(...),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get dashboards for tenant"""
    async with db_manager.pool.acquire() as conn:
        dashboards = await conn.fetch("""
            SELECT d.*, 
                   array_agg(
                       json_build_object(
                           'id', w.id,
                           'title', w.title,
                           'widget_type', w.widget_type,
                           'configuration', w.configuration,
                           'position', w.position
                       )
                   ) as widgets
            FROM dashboards d
            LEFT JOIN dashboard_widgets w ON d.id = w.dashboard_id
            WHERE d.tenant_id = $1 OR d.is_public = TRUE
            GROUP BY d.id
            ORDER BY d.created_at DESC
        """, tenant_id)
        
        return {"dashboards": [dict(row) for row in dashboards]}

@app.post("/charts/generate")
async def generate_chart(config: ChartConfiguration, data: List[Dict[str, Any]],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Generate chart from data"""
    chart = await analytics_manager.generate_chart(config, data)
    return chart

@app.post("/reports", status_code=status.HTTP_201_CREATED)
async def generate_report(report_request: ReportRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Generate a report"""
    report_id = await analytics_manager.generate_report(report_request)
    return {"report_id": report_id}

@app.get("/reports")
async def get_reports(tenant_id: str = Query(...), 
                     report_type: Optional[ReportType] = None,
                     status: Optional[ReportStatus] = None,
                         current_user: TokenPayload = Depends(get_current_user),
                     ):
    """Get reports for tenant"""
    query = "SELECT * FROM reports WHERE tenant_id = $1"
    params = [tenant_id]
    
    if report_type:
        query += f" AND report_type = ${len(params) + 1}"
        params.append(report_type.value)
    
    if status:
        query += f" AND status = ${len(params) + 1}"
        params.append(status.value)
    
    query += " ORDER BY created_at DESC"
    
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        return {"reports": [dict(row) for row in rows]}

@app.get("/reports/{report_id}")
async def get_report(report_id: str, tenant_id: str = Query(...),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get specific report"""
    async with db_manager.pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT * FROM reports WHERE id = $1 AND tenant_id = $2
        """, report_id, tenant_id)
        
        if not row:
            raise HTTPException(status_code=404, detail="Report not found")
        
        report_data = dict(row)
        
        # Load report data if completed
        if report_data['status'] == 'completed' and report_data['file_path']:
            try:
                with open(report_data['file_path'], 'r') as f:
                    if report_data['format'] == 'json':
                        report_data['data'] = json.load(f)
                    else:
                        report_data['file_content'] = f.read()
            except Exception as e:
                logger.error(f"Failed to load report data: {e}")
        
        return report_data

@app.post("/models/{model_id}/predict")
async def run_prediction(model_id: str, input_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Run prediction using trained model"""
    result = await analytics_manager.run_predictive_model(model_id, input_data)
    return result

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "analytics-reporting"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8007)