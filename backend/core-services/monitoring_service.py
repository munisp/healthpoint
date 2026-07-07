"""
Healthcare Claims Platform - Monitoring Service
Comprehensive monitoring with Wazuh SIEM integration, metrics collection, and alerting.

Author: Manus AI
Date: October 8, 2025
Port: 8013
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

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, status, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any, Union
from datetime import datetime, timedelta
from enum import Enum
import uuid
import logging
import asyncio
import asyncpg

import json
import os
from contextlib import asynccontextmanager
import httpx
import psutil
import time
from collections import defaultdict, deque
import statistics
import aiofiles

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
WAZUH_API_URL = os.getenv("WAZUH_API_URL", "https://localhost:55000")
WAZUH_API_USER = os.getenv("WAZUH_API_USER", "wazuh")
WAZUH_API_PASSWORD = os.getenv("WAZUH_API_PASSWORD", "wazuh")

class AlertSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class AlertStatus(str, Enum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"
    CLOSED = "closed"

class MetricType(str, Enum):
    COUNTER = "counter"
    GAUGE = "gauge"
    HISTOGRAM = "histogram"
    SUMMARY = "summary"

class ServiceStatus(str, Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    DOWN = "down"

# Pydantic Models
class MetricData(BaseModel):
    name: str
    value: float
    metric_type: MetricType
    labels: Dict[str, str] = {}
    timestamp: Optional[datetime] = None
    tenant_id: Optional[str] = None
    service_name: Optional[str] = None

class AlertRule(BaseModel):
    id: Optional[str] = None
    name: str
    description: str
    metric_name: str
    condition: str  # e.g., "> 100", "< 0.5", "== 0"
    threshold_value: float
    severity: AlertSeverity
    evaluation_window: int = Field(default=300, description="Seconds")
    notification_channels: List[str] = []
    tenant_id: Optional[str] = None
    service_name: Optional[str] = None
    is_active: bool = True
    created_by: str

class Alert(BaseModel):
    id: str
    rule_id: str
    severity: AlertSeverity
    status: AlertStatus
    title: str
    description: str
    metric_name: str
    current_value: float
    threshold_value: float
    tenant_id: Optional[str] = None
    service_name: Optional[str] = None
    triggered_at: datetime
    acknowledged_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    acknowledged_by: Optional[str] = None

class ServiceHealth(BaseModel):
    service_name: str
    status: ServiceStatus
    response_time: Optional[float] = None
    error_rate: Optional[float] = None
    last_check: datetime
    details: Dict[str, Any] = {}
    tenant_id: Optional[str] = None

class SystemMetrics(BaseModel):
    cpu_usage: float
    memory_usage: float
    disk_usage: float
    network_io: Dict[str, float]
    active_connections: int
    timestamp: datetime

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
                CREATE TABLE IF NOT EXISTS metrics (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    value DOUBLE PRECISION NOT NULL,
                    metric_type VARCHAR(20) NOT NULL,
                    labels JSONB,
                    timestamp TIMESTAMP NOT NULL,
                    tenant_id VARCHAR(255),
                    service_name VARCHAR(255),
                    created_at TIMESTAMP DEFAULT NOW()
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS alert_rules (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    metric_name VARCHAR(255) NOT NULL,
                    condition VARCHAR(50) NOT NULL,
                    threshold_value DOUBLE PRECISION NOT NULL,
                    severity VARCHAR(20) NOT NULL,
                    evaluation_window INTEGER DEFAULT 300,
                    notification_channels TEXT[],
                    tenant_id VARCHAR(255),
                    service_name VARCHAR(255),
                    is_active BOOLEAN DEFAULT TRUE,
                    created_by VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS alerts (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    rule_id UUID NOT NULL,
                    severity VARCHAR(20) NOT NULL,
                    status VARCHAR(20) DEFAULT 'open',
                    title VARCHAR(255) NOT NULL,
                    description TEXT,
                    metric_name VARCHAR(255) NOT NULL,
                    current_value DOUBLE PRECISION NOT NULL,
                    threshold_value DOUBLE PRECISION NOT NULL,
                    tenant_id VARCHAR(255),
                    service_name VARCHAR(255),
                    triggered_at TIMESTAMP DEFAULT NOW(),
                    acknowledged_at TIMESTAMP,
                    resolved_at TIMESTAMP,
                    acknowledged_by VARCHAR(255),
                    FOREIGN KEY (rule_id) REFERENCES alert_rules(id)
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS service_health (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    service_name VARCHAR(255) NOT NULL,
                    status VARCHAR(20) NOT NULL,
                    response_time DOUBLE PRECISION,
                    error_rate DOUBLE PRECISION,
                    last_check TIMESTAMP NOT NULL,
                    details JSONB,
                    tenant_id VARCHAR(255),
                    created_at TIMESTAMP DEFAULT NOW()
                );
            """)
            
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_metrics_name_timestamp ON metrics(name, timestamp);
                CREATE INDEX IF NOT EXISTS idx_metrics_service ON metrics(service_name);
                CREATE INDEX IF NOT EXISTS idx_metrics_tenant ON metrics(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
                CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
                CREATE INDEX IF NOT EXISTS idx_service_health_name ON service_health(service_name);
            """)

db_manager = DatabaseManager()

# Monitoring Manager
class MonitoringManager:
    def __init__(self):
        self.redis_client = None
        self.metrics_buffer = defaultdict(deque)
        self.alert_rules = {}
        self.service_endpoints = {
            "ai-fraud-detection": "http://localhost:8001/health",
            "claims-processing": "http://localhost:8002/health",
            "provider-management": "http://localhost:8003/health",
            "patient-management": "http://localhost:8004/health",
            "audit-compliance": "http://localhost:8005/health",
            "notification": "http://localhost:8006/health",
            "analytics-reporting": "http://localhost:8007/health",
            "api-gateway": "http://localhost:8000/health",
            "user-management": "http://localhost:8008/health",
            "document-management": "http://localhost:8009/health",
            "integration": "http://localhost:8010/health",
            "workflow-engine": "http://localhost:8011/health",
            "configuration": "http://localhost:8012/health",
            "backup": "http://localhost:8014/health",
            "security": "http://localhost:8015/health",
        }
        self.connected_websockets = set()

    async def _get_redis_client(self):
        if not self.redis_client:
            self.redis_client = get_redis_client()
        return self.redis_client

    async def collect_metric(self, metric: MetricData):
        """Collect a metric data point"""
        if not metric.timestamp:
            metric.timestamp = datetime.utcnow()
        
        # Store in database
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO metrics (name, value, metric_type, labels, timestamp, tenant_id, service_name)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            """, metric.name, metric.value, metric.metric_type.value, 
                json.dumps(metric.labels), metric.timestamp, metric.tenant_id, metric.service_name)
        
        # Add to buffer for real-time processing
        buffer_key = f"{metric.name}:{metric.service_name or 'global'}"
        self.metrics_buffer[buffer_key].append((metric.timestamp, metric.value))
        
        # Keep only recent data in buffer (last 1 hour)
        cutoff_time = datetime.utcnow() - timedelta(hours=1)
        while (self.metrics_buffer[buffer_key] and 
               self.metrics_buffer[buffer_key][0][0] < cutoff_time):
            self.metrics_buffer[buffer_key].popleft()
        
        # Check alert rules
        await self._evaluate_alert_rules(metric)
        
        # Broadcast to WebSocket clients
        await self._broadcast_metric(metric)

    async def create_alert_rule(self, rule: AlertRule) -> str:
        """Create a new alert rule"""
        rule.id = str(uuid.uuid4())
        
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO alert_rules 
                (id, name, description, metric_name, condition, threshold_value, severity,
                 evaluation_window, notification_channels, tenant_id, service_name, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            """, rule.id, rule.name, rule.description, rule.metric_name, rule.condition,
                rule.threshold_value, rule.severity.value, rule.evaluation_window,
                rule.notification_channels, rule.tenant_id, rule.service_name, rule.created_by)
        
        # Cache the rule
        self.alert_rules[rule.id] = rule
        
        logger.info(f"Created alert rule: {rule.name}")
        return rule.id

    async def _evaluate_alert_rules(self, metric: MetricData):
        """Evaluate alert rules against incoming metrics"""
        # Load rules if not cached
        if not self.alert_rules:
            await self._load_alert_rules()
        
        for rule_id, rule in self.alert_rules.items():
            if (rule.metric_name == metric.name and 
                rule.is_active and
                (not rule.service_name or rule.service_name == metric.service_name) and
                (not rule.tenant_id or rule.tenant_id == metric.tenant_id)):
                
                # Evaluate condition
                if self._evaluate_condition(metric.value, rule.condition, rule.threshold_value):
                    await self._trigger_alert(rule, metric)

    def _evaluate_condition(self, value: float, condition: str, threshold: float) -> bool:
        """Evaluate alert condition"""
        condition = condition.strip()
        if condition.startswith('>'):
            return value > threshold
        elif condition.startswith('<'):
            return value < threshold
        elif condition.startswith('>='):
            return value >= threshold
        elif condition.startswith('<='):
            return value <= threshold
        elif condition.startswith('=='):
            return value == threshold
        elif condition.startswith('!='):
            return value != threshold
        return False

    async def _trigger_alert(self, rule: AlertRule, metric: MetricData):
        """Trigger an alert"""
        # Check if alert already exists and is open
        async with db_manager.pool.acquire() as conn:
            existing_alert = await conn.fetchrow("""
                SELECT id FROM alerts 
                WHERE rule_id = $1 AND status IN ('open', 'acknowledged')
                ORDER BY triggered_at DESC LIMIT 1
            """, rule.id)
            
            if existing_alert:
                return  # Alert already active
            
            # Create new alert
            alert_id = str(uuid.uuid4())
            alert = Alert(
                id=alert_id,
                rule_id=rule.id,
                severity=rule.severity,
                status=AlertStatus.OPEN,
                title=f"Alert: {rule.name}",
                description=f"Metric {rule.metric_name} value {metric.value} {rule.condition} {rule.threshold_value}",
                metric_name=rule.metric_name,
                current_value=metric.value,
                threshold_value=rule.threshold_value,
                tenant_id=metric.tenant_id,
                service_name=metric.service_name,
                triggered_at=datetime.utcnow()
            )
            
            await conn.execute("""
                INSERT INTO alerts 
                (id, rule_id, severity, status, title, description, metric_name, 
                 current_value, threshold_value, tenant_id, service_name, triggered_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            """, alert.id, alert.rule_id, alert.severity.value, alert.status.value,
                alert.title, alert.description, alert.metric_name, alert.current_value,
                alert.threshold_value, alert.tenant_id, alert.service_name, alert.triggered_at)
        
        # Send notifications
        await self._send_alert_notifications(alert, rule)
        
        # Broadcast to WebSocket clients
        await self._broadcast_alert(alert)
        
        logger.warning(f"Alert triggered: {alert.title}")

    async def _send_alert_notifications(self, alert: Alert, rule: AlertRule):
        """Send alert notifications"""
        for channel in rule.notification_channels:
            try:
                if channel.startswith('email:'):
                    email = channel[6:]
                    await self._send_email_notification(alert, email)
                elif channel.startswith('slack:'):
                    webhook_url = channel[6:]
                    await self._send_slack_notification(alert, webhook_url)
                elif channel.startswith('webhook:'):
                    webhook_url = channel[8:]
                    await self._send_webhook_notification(alert, webhook_url)
            except Exception as e:
                logger.error(f"Failed to send notification to {channel}: {e}")

    async def _send_email_notification(self, alert: Alert, email: str):
        """Send email notification"""
        # Call notification service
        async with httpx.AsyncClient() as client:
            await client.post('http://localhost:8006/send-notification', json={
                'type': 'email',
                'recipients': [email],
                'subject': f"Alert: {alert.title}",
                'message': alert.description
            })

    async def _send_slack_notification(self, alert: Alert, webhook_url: str):
        """Send Slack notification"""
        payload = {
            'text': f"🚨 {alert.title}",
            'attachments': [{
                'color': 'danger' if alert.severity in ['high', 'critical'] else 'warning',
                'fields': [
                    {'title': 'Severity', 'value': alert.severity.upper(), 'short': True},
                    {'title': 'Service', 'value': alert.service_name or 'Global', 'short': True},
                    {'title': 'Metric', 'value': alert.metric_name, 'short': True},
                    {'title': 'Value', 'value': str(alert.current_value), 'short': True},
                    {'title': 'Description', 'value': alert.description, 'short': False}
                ]
            }]
        }
        
        async with httpx.AsyncClient() as client:
            await client.post(webhook_url, json=payload)

    async def _send_webhook_notification(self, alert: Alert, webhook_url: str):
        """Send webhook notification"""
        payload = {
            'alert_id': alert.id,
            'severity': alert.severity,
            'title': alert.title,
            'description': alert.description,
            'metric_name': alert.metric_name,
            'current_value': alert.current_value,
            'threshold_value': alert.threshold_value,
            'service_name': alert.service_name,
            'tenant_id': alert.tenant_id,
            'triggered_at': alert.triggered_at.isoformat()
        }
        
        async with httpx.AsyncClient() as client:
            await client.post(webhook_url, json=payload)

    async def check_service_health(self) -> List[ServiceHealth]:
        """Check health of all services"""
        health_results = []
        
        for service_name, endpoint in self.service_endpoints.items():
            try:
                start_time = time.time()
                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.get(endpoint)
                response_time = (time.time() - start_time) * 1000  # ms
                
                if response.status_code == 200:
                    status = ServiceStatus.HEALTHY
                else:
                    status = ServiceStatus.DEGRADED
                
                health = ServiceHealth(
                    service_name=service_name,
                    status=status,
                    response_time=response_time,
                    last_check=datetime.utcnow(),
                    details={'status_code': response.status_code}
                )
                
            except Exception as e:
                health = ServiceHealth(
                    service_name=service_name,
                    status=ServiceStatus.DOWN,
                    last_check=datetime.utcnow(),
                    details={'error': str(e)}
                )
            
            health_results.append(health)
            
            # Store in database
            async with db_manager.pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO service_health 
                    (service_name, status, response_time, last_check, details)
                    VALUES ($1, $2, $3, $4, $5)
                """, health.service_name, health.status.value, health.response_time,
                    health.last_check, json.dumps(health.details))
        
        return health_results

    async def get_system_metrics(self) -> SystemMetrics:
        """Get current system metrics"""
        # CPU usage
        cpu_usage = psutil.cpu_percent(interval=1)
        
        # Memory usage
        memory = psutil.virtual_memory()
        memory_usage = memory.percent
        
        # Disk usage
        disk = psutil.disk_usage('/')
        disk_usage = (disk.used / disk.total) * 100
        
        # Network I/O
        network = psutil.net_io_counters()
        network_io = {
            'bytes_sent': float(network.bytes_sent),
            'bytes_recv': float(network.bytes_recv),
            'packets_sent': float(network.packets_sent),
            'packets_recv': float(network.packets_recv)
        }
        
        # Active connections
        active_connections = len(psutil.net_connections())
        
        metrics = SystemMetrics(
            cpu_usage=cpu_usage,
            memory_usage=memory_usage,
            disk_usage=disk_usage,
            network_io=network_io,
            active_connections=active_connections,
            timestamp=datetime.utcnow()
        )
        
        # Store as metrics
        await self.collect_metric(MetricData(
            name="system.cpu_usage",
            value=cpu_usage,
            metric_type=MetricType.GAUGE,
            service_name="system"
        ))
        
        await self.collect_metric(MetricData(
            name="system.memory_usage",
            value=memory_usage,
            metric_type=MetricType.GAUGE,
            service_name="system"
        ))
        
        await self.collect_metric(MetricData(
            name="system.disk_usage",
            value=disk_usage,
            metric_type=MetricType.GAUGE,
            service_name="system"
        ))
        
        return metrics

    async def _load_alert_rules(self):
        """Load alert rules from database"""
        async with db_manager.pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM alert_rules WHERE is_active = TRUE
            """)
            
            for row in rows:
                rule_data = dict(row)
                rule = AlertRule(**rule_data)
                self.alert_rules[rule.id] = rule

    async def _broadcast_metric(self, metric: MetricData):
        """Broadcast metric to WebSocket clients"""
        if self.connected_websockets:
            message = {
                'type': 'metric',
                'data': {
                    'name': metric.name,
                    'value': metric.value,
                    'timestamp': metric.timestamp.isoformat(),
                    'service_name': metric.service_name,
                    'labels': metric.labels
                }
            }
            
            # Send to all connected clients
            disconnected = set()
            for websocket in self.connected_websockets:
                try:
                    await websocket.send_text(json.dumps(message))
                except:
                    disconnected.add(websocket)
            
            # Remove disconnected clients
            self.connected_websockets -= disconnected

    async def _broadcast_alert(self, alert: Alert):
        """Broadcast alert to WebSocket clients"""
        if self.connected_websockets:
            message = {
                'type': 'alert',
                'data': {
                    'id': alert.id,
                    'severity': alert.severity,
                    'title': alert.title,
                    'description': alert.description,
                    'service_name': alert.service_name,
                    'triggered_at': alert.triggered_at.isoformat()
                }
            }
            
            # Send to all connected clients
            disconnected = set()
            for websocket in self.connected_websockets:
                try:
                    await websocket.send_text(json.dumps(message))
                except:
                    disconnected.add(websocket)
            
            # Remove disconnected clients
            self.connected_websockets -= disconnected

monitoring_manager = MonitoringManager()

# Background tasks
async def periodic_health_checks():
    """Periodic health checks for all services"""
    while True:
        try:
            await monitoring_manager.check_service_health()
            await monitoring_manager.get_system_metrics()
            await asyncio.sleep(60)  # Check every minute
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            await asyncio.sleep(60)

# Lifespan manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db_manager.connect()
    # Start background tasks
    asyncio.create_task(periodic_health_checks())
    yield
    await db_manager.disconnect()

app = FastAPI(

app.middleware("http")(security_headers_middleware)
    title="Healthcare Claims Platform - Monitoring Service",
    description="Comprehensive monitoring with SIEM integration and alerting",
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
@app.post("/metrics", status_code=status.HTTP_201_CREATED)
async def collect_metric(metric: MetricData):
    """Collect a metric data point"""
    await monitoring_manager.collect_metric(metric)
    return {"message": "Metric collected successfully"}

@app.post("/metrics/batch", status_code=status.HTTP_201_CREATED)
async def collect_metrics_batch(metrics: List[MetricData]):
    """Collect multiple metrics in batch"""
    for metric in metrics:
        await monitoring_manager.collect_metric(metric)
    return {"message": f"Collected {len(metrics)} metrics successfully"}

@app.get("/metrics/{metric_name}")
async def get_metric_history(metric_name: str, 
                            service_name: Optional[str] = None,
                            tenant_id: Optional[str] = None,
                            start_time: Optional[datetime] = None,
                            end_time: Optional[datetime] = None,
                            limit: int = 100):
    """Get metric history"""
    if not start_time:
        start_time = datetime.utcnow() - timedelta(hours=1)
    if not end_time:
        end_time = datetime.utcnow()
    
    query = """
        SELECT * FROM metrics 
        WHERE name = $1 AND timestamp BETWEEN $2 AND $3
    """
    params = [metric_name, start_time, end_time]
    
    if service_name:
        query += " AND service_name = $4"
        params.append(service_name)
    
    if tenant_id:
        query += f" AND tenant_id = ${len(params) + 1}"
        params.append(tenant_id)
    
    query += f" ORDER BY timestamp DESC LIMIT ${len(params) + 1}"
    params.append(limit)
    
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        return [dict(row) for row in rows]

@app.post("/alert-rules", status_code=status.HTTP_201_CREATED)
async def create_alert_rule(rule: AlertRule):
    """Create a new alert rule"""
    rule_id = await monitoring_manager.create_alert_rule(rule)
    return {"rule_id": rule_id}

@app.get("/alert-rules")
async def list_alert_rules(tenant_id: Optional[str] = None, service_name: Optional[str] = None):
    """List alert rules"""
    query = "SELECT * FROM alert_rules WHERE is_active = TRUE"
    params = []
    
    if tenant_id:
        query += " AND tenant_id = $1"
        params.append(tenant_id)
    
    if service_name:
        query += f" AND service_name = ${len(params) + 1}"
        params.append(service_name)
    
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        return [dict(row) for row in rows]

@app.get("/alerts")
async def list_alerts(status: Optional[AlertStatus] = None,
                     severity: Optional[AlertSeverity] = None,
                     service_name: Optional[str] = None,
                     tenant_id: Optional[str] = None,
                     limit: int = 50):
    """List alerts"""
    query = "SELECT * FROM alerts WHERE 1=1"
    params = []
    
    if status:
        query += f" AND status = ${len(params) + 1}"
        params.append(status.value)
    
    if severity:
        query += f" AND severity = ${len(params) + 1}"
        params.append(severity.value)
    
    if service_name:
        query += f" AND service_name = ${len(params) + 1}"
        params.append(service_name)
    
    if tenant_id:
        query += f" AND tenant_id = ${len(params) + 1}"
        params.append(tenant_id)
    
    query += f" ORDER BY triggered_at DESC LIMIT ${len(params) + 1}"
    params.append(limit)
    
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        return [dict(row) for row in rows]

@app.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str, acknowledged_by: str):
    """Acknowledge an alert"""
    async with db_manager.pool.acquire() as conn:
        result = await conn.execute("""
            UPDATE alerts 
            SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $2
            WHERE id = $1 AND status = 'open'
        """, alert_id, acknowledged_by)
        
        if result == "UPDATE 0":
            raise HTTPException(status_code=404, detail="Alert not found or already acknowledged")
    
    return {"message": "Alert acknowledged successfully"}

@app.post("/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: str):
    """Resolve an alert"""
    async with db_manager.pool.acquire() as conn:
        result = await conn.execute("""
            UPDATE alerts 
            SET status = 'resolved', resolved_at = NOW()
            WHERE id = $1 AND status IN ('open', 'acknowledged')
        """, alert_id)
        
        if result == "UPDATE 0":
            raise HTTPException(status_code=404, detail="Alert not found or already resolved")
    
    return {"message": "Alert resolved successfully"}

@app.get("/health-check")
async def get_service_health():
    """Get health status of all services"""
    health_results = await monitoring_manager.check_service_health()
    return {"services": [health.dict() for health in health_results]}

@app.get("/system-metrics")
async def get_system_metrics():
    """Get current system metrics"""
    metrics = await monitoring_manager.get_system_metrics()
    return metrics.dict()

@app.websocket("/ws/monitoring")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time monitoring"""
    await websocket.accept()
    monitoring_manager.connected_websockets.add(websocket)
    
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
    except Exception as ws_err:
        logger.info(f"Monitoring WebSocket disconnected: {ws_err}")
    finally:
        monitoring_manager.connected_websockets.discard(websocket)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "monitoring"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8013)
