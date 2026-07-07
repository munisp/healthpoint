"""
Healthcare Claims Platform - Audit & Compliance Service
HIPAA, SOX, and healthcare compliance with comprehensive audit trails and reporting.

Author: Manus AI
Date: October 8, 2025
Port: 8005
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
from decimal import Decimal
import hashlib
import hmac

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

class AuditEventType(str, Enum):
    USER_LOGIN = "user_login"
    USER_LOGOUT = "user_logout"
    USER_FAILED_LOGIN = "user_failed_login"
    DATA_ACCESS = "data_access"
    DATA_CREATE = "data_create"
    DATA_UPDATE = "data_update"
    DATA_DELETE = "data_delete"
    DATA_EXPORT = "data_export"
    SYSTEM_CONFIG_CHANGE = "system_config_change"
    PERMISSION_CHANGE = "permission_change"
    BACKUP_CREATED = "backup_created"
    BACKUP_RESTORED = "backup_restored"
    SECURITY_INCIDENT = "security_incident"
    COMPLIANCE_VIOLATION = "compliance_violation"
    ADMIN_ACTION = "admin_action"

class ComplianceFramework(str, Enum):
    HIPAA = "hipaa"
    SOX = "sox"
    GDPR = "gdpr"
    PCI_DSS = "pci_dss"
    SOC2 = "soc2"
    HITECH = "hitech"
    FDA_21CFR11 = "fda_21cfr11"

class ComplianceStatus(str, Enum):
    COMPLIANT = "compliant"
    NON_COMPLIANT = "non_compliant"
    UNDER_REVIEW = "under_review"
    REMEDIATION_REQUIRED = "remediation_required"

class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class AuditStatus(str, Enum):
    ACTIVE = "active"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

# Pydantic Models
class AuditEvent(BaseModel):
    id: Optional[str] = None
    event_type: AuditEventType
    user_id: Optional[str] = None
    session_id: Optional[str] = None
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    action: str
    description: str
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    before_data: Optional[Dict[str, Any]] = None
    after_data: Optional[Dict[str, Any]] = None
    metadata: Dict[str, Any] = {}
    tenant_id: str
    timestamp: Optional[datetime] = None
    risk_level: RiskLevel = RiskLevel.LOW

class ComplianceRule(BaseModel):
    id: Optional[str] = None
    name: str
    description: str
    framework: ComplianceFramework
    rule_type: str  # e.g., "data_retention", "access_control", "encryption"
    conditions: Dict[str, Any]
    actions: List[str]  # Actions to take when rule is violated
    is_active: bool = True
    created_by: str
    tenant_id: Optional[str] = None

class ComplianceViolation(BaseModel):
    id: Optional[str] = None
    rule_id: str
    event_id: Optional[str] = None
    violation_type: str
    description: str
    risk_level: RiskLevel
    status: ComplianceStatus = ComplianceStatus.UNDER_REVIEW
    detected_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    resolution_notes: Optional[str] = None
    assigned_to: Optional[str] = None
    tenant_id: str

class AuditReport(BaseModel):
    id: Optional[str] = None
    name: str
    description: str
    report_type: str  # e.g., "access_report", "compliance_report", "security_report"
    framework: Optional[ComplianceFramework] = None
    parameters: Dict[str, Any] = {}
    start_date: datetime
    end_date: datetime
    generated_by: str
    tenant_id: str
    status: AuditStatus = AuditStatus.ACTIVE

class DataRetentionPolicy(BaseModel):
    id: Optional[str] = None
    name: str
    description: str
    data_type: str  # e.g., "patient_data", "audit_logs", "claims_data"
    retention_period_days: int
    archive_after_days: Optional[int] = None
    delete_after_days: Optional[int] = None
    legal_hold_exempt: bool = False
    framework: ComplianceFramework
    is_active: bool = True
    created_by: str
    tenant_id: str

class AccessControlAudit(BaseModel):
    user_id: str
    resource_type: str
    resource_id: str
    permission_requested: str
    permission_granted: bool
    reason: Optional[str] = None
    timestamp: datetime
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
                CREATE TABLE IF NOT EXISTS audit_events (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    event_type VARCHAR(50) NOT NULL,
                    user_id VARCHAR(255),
                    session_id VARCHAR(255),
                    resource_type VARCHAR(100),
                    resource_id VARCHAR(255),
                    action VARCHAR(100) NOT NULL,
                    description TEXT NOT NULL,
                    ip_address INET,
                    user_agent TEXT,
                    before_data JSONB,
                    after_data JSONB,
                    metadata JSONB,
                    tenant_id VARCHAR(255) NOT NULL,
                    timestamp TIMESTAMP DEFAULT NOW(),
                    risk_level VARCHAR(20) DEFAULT 'low',
                    checksum VARCHAR(64) NOT NULL
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS compliance_rules (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    framework VARCHAR(20) NOT NULL,
                    rule_type VARCHAR(50) NOT NULL,
                    conditions JSONB NOT NULL,
                    actions TEXT[] NOT NULL,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_by VARCHAR(255) NOT NULL,
                    tenant_id VARCHAR(255),
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS compliance_violations (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    rule_id UUID NOT NULL,
                    event_id UUID,
                    violation_type VARCHAR(100) NOT NULL,
                    description TEXT NOT NULL,
                    risk_level VARCHAR(20) NOT NULL,
                    status VARCHAR(30) DEFAULT 'under_review',
                    detected_at TIMESTAMP DEFAULT NOW(),
                    resolved_at TIMESTAMP,
                    resolution_notes TEXT,
                    assigned_to VARCHAR(255),
                    tenant_id VARCHAR(255) NOT NULL,
                    FOREIGN KEY (rule_id) REFERENCES compliance_rules(id),
                    FOREIGN KEY (event_id) REFERENCES audit_events(id)
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS audit_reports (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    report_type VARCHAR(50) NOT NULL,
                    framework VARCHAR(20),
                    parameters JSONB,
                    start_date TIMESTAMP NOT NULL,
                    end_date TIMESTAMP NOT NULL,
                    generated_by VARCHAR(255) NOT NULL,
                    tenant_id VARCHAR(255) NOT NULL,
                    status VARCHAR(20) DEFAULT 'active',
                    file_path TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    completed_at TIMESTAMP
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS data_retention_policies (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    data_type VARCHAR(100) NOT NULL,
                    retention_period_days INTEGER NOT NULL,
                    archive_after_days INTEGER,
                    delete_after_days INTEGER,
                    legal_hold_exempt BOOLEAN DEFAULT FALSE,
                    framework VARCHAR(20) NOT NULL,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_by VARCHAR(255) NOT NULL,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS access_control_audit (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id VARCHAR(255) NOT NULL,
                    resource_type VARCHAR(100) NOT NULL,
                    resource_id VARCHAR(255) NOT NULL,
                    permission_requested VARCHAR(100) NOT NULL,
                    permission_granted BOOLEAN NOT NULL,
                    reason TEXT,
                    timestamp TIMESTAMP DEFAULT NOW(),
                    tenant_id VARCHAR(255) NOT NULL
                );
            """)
            
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events(timestamp);
                CREATE INDEX IF NOT EXISTS idx_audit_events_user ON audit_events(user_id);
                CREATE INDEX IF NOT EXISTS idx_audit_events_tenant ON audit_events(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_audit_events_event_type ON audit_events(event_type);
                CREATE INDEX IF NOT EXISTS idx_compliance_violations_status ON compliance_violations(status);
                CREATE INDEX IF NOT EXISTS idx_compliance_violations_risk ON compliance_violations(risk_level);
                CREATE INDEX IF NOT EXISTS idx_access_control_user ON access_control_audit(user_id);
                CREATE INDEX IF NOT EXISTS idx_access_control_timestamp ON access_control_audit(timestamp);
            """)

db_manager = DatabaseManager()

# Audit Manager
class AuditManager:
    def __init__(self):
        self.redis_client = None
        self.compliance_rules_cache = {}

    async def _get_redis_client(self):
        if not self.redis_client:
            self.redis_client = get_redis_client()
        return self.redis_client

    def _calculate_checksum(self, event_data: Dict[str, Any]) -> str:
        """Calculate checksum for audit event integrity"""
        # Create a deterministic string representation
        sorted_data = json.dumps(event_data, sort_keys=True, default=str)
        return hashlib.sha256(sorted_data.encode()).hexdigest()

    async def log_audit_event(self, event: AuditEvent) -> str:
        """Log an audit event"""
        event.id = str(uuid.uuid4())
        event.timestamp = datetime.utcnow()
        
        # Prepare data for checksum
        event_data = {
            'id': event.id,
            'event_type': event.event_type.value,
            'user_id': event.user_id,
            'action': event.action,
            'description': event.description,
            'timestamp': event.timestamp.isoformat(),
            'tenant_id': event.tenant_id
        }
        
        checksum = self._calculate_checksum(event_data)
        
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO audit_events 
                (id, event_type, user_id, session_id, resource_type, resource_id,
                 action, description, ip_address, user_agent, before_data, after_data,
                 metadata, tenant_id, timestamp, risk_level, checksum)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            """, event.id, event.event_type.value, event.user_id, event.session_id,
                event.resource_type, event.resource_id, event.action, event.description,
                event.ip_address, event.user_agent, 
                json.dumps(event.before_data) if event.before_data else None,
                json.dumps(event.after_data) if event.after_data else None,
                json.dumps(event.metadata), event.tenant_id, event.timestamp,
                event.risk_level.value, checksum)
        
        # Check for compliance violations
        await self._check_compliance_violations(event)
        
        # Send to monitoring service for alerting
        if event.risk_level in [RiskLevel.HIGH, RiskLevel.CRITICAL]:
            await self._send_security_alert(event)
        
        logger.info(f"Logged audit event: {event.id}")
        return event.id

    async def create_compliance_rule(self, rule: ComplianceRule) -> str:
        """Create a new compliance rule"""
        rule.id = str(uuid.uuid4())
        
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO compliance_rules 
                (id, name, description, framework, rule_type, conditions, actions,
                 is_active, created_by, tenant_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """, rule.id, rule.name, rule.description, rule.framework.value,
                rule.rule_type, json.dumps(rule.conditions), rule.actions,
                rule.is_active, rule.created_by, rule.tenant_id)
        
        # Clear cache to reload rules
        self.compliance_rules_cache.clear()
        
        logger.info(f"Created compliance rule: {rule.name}")
        return rule.id

    async def _check_compliance_violations(self, event: AuditEvent):
        """Check if audit event violates any compliance rules"""
        # Load rules if not cached
        if not self.compliance_rules_cache:
            await self._load_compliance_rules()
        
        for rule_id, rule in self.compliance_rules_cache.items():
            if await self._evaluate_compliance_rule(event, rule):
                await self._create_violation(rule_id, event, rule)

    async def _load_compliance_rules(self):
        """Load active compliance rules from database"""
        async with db_manager.pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM compliance_rules WHERE is_active = TRUE
            """)
            
            for row in rows:
                rule_data = dict(row)
                rule_data['conditions'] = json.loads(rule_data['conditions'])
                self.compliance_rules_cache[rule_data['id']] = rule_data

    async def _evaluate_compliance_rule(self, event: AuditEvent, rule: Dict[str, Any]) -> bool:
        """Evaluate if an event violates a compliance rule"""
        conditions = rule['conditions']
        
        # Check event type
        if 'event_types' in conditions:
            if event.event_type.value not in conditions['event_types']:
                return False
        
        # Check time-based conditions (e.g., access outside business hours)
        if 'business_hours_only' in conditions and conditions['business_hours_only']:
            hour = event.timestamp.hour
            if hour < 8 or hour > 18:  # Outside 8 AM - 6 PM
                return True
        
        # Check data access patterns
        if 'max_records_accessed' in conditions:
            if event.metadata.get('records_count', 0) > conditions['max_records_accessed']:
                return True
        
        # Check for sensitive data access
        if 'sensitive_data_types' in conditions:
            if event.resource_type in conditions['sensitive_data_types']:
                if not event.metadata.get('authorized_access', False):
                    return True
        
        # Check for failed login attempts
        if rule['rule_type'] == 'failed_login_threshold':
            if event.event_type == AuditEventType.USER_FAILED_LOGIN:
                # Count recent failed attempts
                recent_failures = await self._count_recent_failed_logins(
                    event.user_id, event.tenant_id, minutes=30
                )
                if recent_failures >= conditions.get('max_attempts', 5):
                    return True
        
        # Check for data retention violations
        if rule['rule_type'] == 'data_retention':
            if event.event_type == AuditEventType.DATA_ACCESS:
                # Check if data is beyond retention period
                data_age = await self._get_data_age(event.resource_type, event.resource_id)
                if data_age and data_age > conditions.get('retention_days', 2555):  # 7 years default
                    return True
        
        return False

    async def _count_recent_failed_logins(self, user_id: str, tenant_id: str, minutes: int) -> int:
        """Count recent failed login attempts"""
        since_time = datetime.utcnow() - timedelta(minutes=minutes)
        
        async with db_manager.pool.acquire() as conn:
            count = await conn.fetchval("""
                SELECT COUNT(*) FROM audit_events 
                WHERE user_id = $1 AND tenant_id = $2 
                AND event_type = 'user_failed_login' 
                AND timestamp >= $3
            """, user_id, tenant_id, since_time)
            
            return count or 0

    async def _get_data_age(self, resource_type: str, resource_id: str) -> Optional[int]:
        """Get age of data in days"""
        # This would typically query the specific resource table
        # For now, return None to indicate age couldn't be determined
        return None

    async def _create_violation(self, rule_id: str, event: AuditEvent, rule: Dict[str, Any]):
        """Create a compliance violation record"""
        violation_id = str(uuid.uuid4())
        
        violation = ComplianceViolation(
            id=violation_id,
            rule_id=rule_id,
            event_id=event.id,
            violation_type=rule['rule_type'],
            description=f"Compliance violation detected: {rule['name']}",
            risk_level=event.risk_level,
            tenant_id=event.tenant_id
        )
        
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO compliance_violations 
                (id, rule_id, event_id, violation_type, description, risk_level, tenant_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            """, violation.id, violation.rule_id, violation.event_id,
                violation.violation_type, violation.description,
                violation.risk_level.value, violation.tenant_id)
        
        # Execute rule actions
        for action in rule['actions']:
            await self._execute_compliance_action(action, violation, event)
        
        logger.warning(f"Compliance violation created: {violation_id}")

    async def _execute_compliance_action(self, action: str, violation: ComplianceViolation, event: AuditEvent):
        """Execute compliance rule action"""
        if action == "send_alert":
            await self._send_compliance_alert(violation, event)
        elif action == "block_user":
            await self._block_user_access(event.user_id, event.tenant_id)
        elif action == "require_approval":
            await self._require_manager_approval(violation, event)
        elif action == "log_security_incident":
            await self._log_security_incident(violation, event)

    async def _send_compliance_alert(self, violation: ComplianceViolation, event: AuditEvent):
        """Send compliance violation alert"""
        try:
            async with httpx.AsyncClient() as client:
                await client.post('http://localhost:8006/send-notification', json={
                    'type': 'email',
                    'recipients': ['compliance@company.com'],
                    'subject': f'Compliance Violation: {violation.violation_type}',
                    'message': f'Violation ID: {violation.id}\nDescription: {violation.description}\nUser: {event.user_id}'
                })
        except Exception as e:
            logger.error(f"Failed to send compliance alert: {e}")

    async def _send_security_alert(self, event: AuditEvent):
        """Send security alert for high-risk events"""
        try:
            async with httpx.AsyncClient() as client:
                await client.post('http://localhost:8013/metrics', json={
                    'name': 'security.high_risk_event',
                    'value': 1,
                    'metric_type': 'counter',
                    'labels': {
                        'event_type': event.event_type.value,
                        'risk_level': event.risk_level.value,
                        'tenant_id': event.tenant_id
                    },
                    'service_name': 'audit-compliance'
                })
        except Exception as e:
            logger.error(f"Failed to send security alert: {e}")

    async def generate_audit_report(self, report: AuditReport) -> str:
        """Generate an audit report"""
        report.id = str(uuid.uuid4())
        
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO audit_reports 
                (id, name, description, report_type, framework, parameters,
                 start_date, end_date, generated_by, tenant_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """, report.id, report.name, report.description, report.report_type,
                report.framework.value if report.framework else None,
                json.dumps(report.parameters), report.start_date, report.end_date,
                report.generated_by, report.tenant_id)
        
        # Generate report in background
        asyncio.create_task(self._generate_report_data(report))
        
        logger.info(f"Started audit report generation: {report.id}")
        return report.id

    async def _generate_report_data(self, report: AuditReport):
        """Generate report data based on type"""
        try:
            if report.report_type == "access_report":
                data = await self._generate_access_report(report)
            elif report.report_type == "compliance_report":
                data = await self._generate_compliance_report(report)
            elif report.report_type == "security_report":
                data = await self._generate_security_report(report)
            else:
                data = await self._generate_general_audit_report(report)
            
            # Save report data (in production, save to file system or cloud storage)
            file_path = f"/tmp/audit_report_{report.id}.json"
            with open(file_path, 'w') as f:
                json.dump(data, f, indent=2, default=str)
            
            # Update report status
            async with db_manager.pool.acquire() as conn:
                await conn.execute("""
                    UPDATE audit_reports 
                    SET status = 'completed', file_path = $1, completed_at = NOW()
                    WHERE id = $2
                """, file_path, report.id)
            
            logger.info(f"Completed audit report: {report.id}")
            
        except Exception as e:
            logger.error(f"Failed to generate report {report.id}: {e}")
            async with db_manager.pool.acquire() as conn:
                await conn.execute("""
                    UPDATE audit_reports SET status = 'failed' WHERE id = $1
                """, report.id)

    async def _generate_access_report(self, report: AuditReport) -> Dict[str, Any]:
        """Generate access audit report"""
        async with db_manager.pool.acquire() as conn:
            # Get access events
            access_events = await conn.fetch("""
                SELECT * FROM audit_events 
                WHERE tenant_id = $1 AND timestamp BETWEEN $2 AND $3
                AND event_type IN ('data_access', 'user_login', 'user_logout')
                ORDER BY timestamp DESC
            """, report.tenant_id, report.start_date, report.end_date)
            
            # Get access control audit records
            access_control = await conn.fetch("""
                SELECT * FROM access_control_audit 
                WHERE tenant_id = $1 AND timestamp BETWEEN $2 AND $3
                ORDER BY timestamp DESC
            """, report.tenant_id, report.start_date, report.end_date)
            
            return {
                'report_id': report.id,
                'report_type': 'access_report',
                'period': {
                    'start': report.start_date,
                    'end': report.end_date
                },
                'summary': {
                    'total_access_events': len(access_events),
                    'total_access_requests': len(access_control),
                    'denied_requests': len([r for r in access_control if not r['permission_granted']])
                },
                'access_events': [dict(event) for event in access_events],
                'access_control_records': [dict(record) for record in access_control]
            }

    async def _generate_compliance_report(self, report: AuditReport) -> Dict[str, Any]:
        """Generate compliance audit report"""
        async with db_manager.pool.acquire() as conn:
            # Get compliance violations
            violations = await conn.fetch("""
                SELECT cv.*, cr.name as rule_name, cr.framework 
                FROM compliance_violations cv
                JOIN compliance_rules cr ON cv.rule_id = cr.id
                WHERE cv.tenant_id = $1 AND cv.detected_at BETWEEN $2 AND $3
                ORDER BY cv.detected_at DESC
            """, report.tenant_id, report.start_date, report.end_date)
            
            # Get compliance rules
            rules = await conn.fetch("""
                SELECT * FROM compliance_rules 
                WHERE (tenant_id = $1 OR tenant_id IS NULL) AND is_active = TRUE
            """, report.tenant_id)
            
            return {
                'report_id': report.id,
                'report_type': 'compliance_report',
                'framework': report.framework.value if report.framework else 'all',
                'period': {
                    'start': report.start_date,
                    'end': report.end_date
                },
                'summary': {
                    'total_violations': len(violations),
                    'critical_violations': len([v for v in violations if v['risk_level'] == 'critical']),
                    'resolved_violations': len([v for v in violations if v['status'] == 'resolved']),
                    'active_rules': len(rules)
                },
                'violations': [dict(violation) for violation in violations],
                'compliance_rules': [dict(rule) for rule in rules]
            }

    async def _generate_security_report(self, report: AuditReport) -> Dict[str, Any]:
        """Generate security audit report"""
        async with db_manager.pool.acquire() as conn:
            # Get security-related events
            security_events = await conn.fetch("""
                SELECT * FROM audit_events 
                WHERE tenant_id = $1 AND timestamp BETWEEN $2 AND $3
                AND (event_type IN ('user_failed_login', 'security_incident') 
                     OR risk_level IN ('high', 'critical'))
                ORDER BY timestamp DESC
            """, report.tenant_id, report.start_date, report.end_date)
            
            # Get failed login statistics
            failed_logins = await conn.fetch("""
                SELECT user_id, COUNT(*) as failed_count
                FROM audit_events 
                WHERE tenant_id = $1 AND timestamp BETWEEN $2 AND $3
                AND event_type = 'user_failed_login'
                GROUP BY user_id
                ORDER BY failed_count DESC
            """, report.tenant_id, report.start_date, report.end_date)
            
            return {
                'report_id': report.id,
                'report_type': 'security_report',
                'period': {
                    'start': report.start_date,
                    'end': report.end_date
                },
                'summary': {
                    'total_security_events': len(security_events),
                    'failed_login_attempts': sum([r['failed_count'] for r in failed_logins]),
                    'unique_users_with_failures': len(failed_logins),
                    'high_risk_events': len([e for e in security_events if e['risk_level'] in ['high', 'critical']])
                },
                'security_events': [dict(event) for event in security_events],
                'failed_login_stats': [dict(stat) for stat in failed_logins]
            }

    async def _generate_general_audit_report(self, report: AuditReport) -> Dict[str, Any]:
        """Generate general audit report"""
        async with db_manager.pool.acquire() as conn:
            # Get all audit events for the period
            events = await conn.fetch("""
                SELECT * FROM audit_events 
                WHERE tenant_id = $1 AND timestamp BETWEEN $2 AND $3
                ORDER BY timestamp DESC
                LIMIT 10000
            """, report.tenant_id, report.start_date, report.end_date)
            
            # Get event type statistics
            event_stats = await conn.fetch("""
                SELECT event_type, COUNT(*) as event_count
                FROM audit_events 
                WHERE tenant_id = $1 AND timestamp BETWEEN $2 AND $3
                GROUP BY event_type
                ORDER BY event_count DESC
            """, report.tenant_id, report.start_date, report.end_date)
            
            return {
                'report_id': report.id,
                'report_type': 'general_audit_report',
                'period': {
                    'start': report.start_date,
                    'end': report.end_date
                },
                'summary': {
                    'total_events': len(events),
                    'event_types': len(event_stats),
                    'date_range_days': (report.end_date - report.start_date).days
                },
                'event_statistics': [dict(stat) for stat in event_stats],
                'sample_events': [dict(event) for event in events[:100]]  # First 100 events
            }

audit_manager = AuditManager()

# Lifespan manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db_manager.connect()
    yield
    await db_manager.disconnect()

app = FastAPI(
    title="Healthcare Claims Platform - Audit & Compliance Service",
    description="HIPAA, SOX, and healthcare compliance with comprehensive audit trails",
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
@app.post("/audit-events", status_code=status.HTTP_201_CREATED)
async def log_audit_event(event: AuditEvent,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Log an audit event"""
    event_id = await audit_manager.log_audit_event(event)
    return {"event_id": event_id}

@app.get("/audit-events")
async def get_audit_events(tenant_id: str = Query(...),
                          event_type: Optional[AuditEventType] = None,
                          user_id: Optional[str] = None,
                          start_date: Optional[datetime] = None,
                          end_date: Optional[datetime] = None,
                          limit: int = Query(100, le=1000),
                              current_user: TokenPayload = Depends(get_current_user),
                          ):
    """Get audit events with filters"""
    query = "SELECT * FROM audit_events WHERE tenant_id = $1"
    params = [tenant_id]
    
    if event_type:
        query += f" AND event_type = ${len(params) + 1}"
        params.append(event_type.value)
    
    if user_id:
        query += f" AND user_id = ${len(params) + 1}"
        params.append(user_id)
    
    if start_date:
        query += f" AND timestamp >= ${len(params) + 1}"
        params.append(start_date)
    
    if end_date:
        query += f" AND timestamp <= ${len(params) + 1}"
        params.append(end_date)
    
    query += f" ORDER BY timestamp DESC LIMIT ${len(params) + 1}"
    params.append(limit)
    
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        return {"events": [dict(row) for row in rows]}

@app.post("/compliance-rules", status_code=status.HTTP_201_CREATED)
async def create_compliance_rule(rule: ComplianceRule,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create a new compliance rule"""
    rule_id = await audit_manager.create_compliance_rule(rule)
    return {"rule_id": rule_id}

@app.get("/compliance-rules")
async def get_compliance_rules(tenant_id: Optional[str] = None,
                              framework: Optional[ComplianceFramework] = None,
                                  current_user: TokenPayload = Depends(get_current_user),
                              ):
    """Get compliance rules"""
    query = "SELECT * FROM compliance_rules WHERE is_active = TRUE"
    params = []
    
    if tenant_id:
        query += f" AND (tenant_id = ${len(params) + 1} OR tenant_id IS NULL)"
        params.append(tenant_id)
    
    if framework:
        query += f" AND framework = ${len(params) + 1}"
        params.append(framework.value)
    
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        return {"rules": [dict(row) for row in rows]}

@app.get("/compliance-violations")
async def get_compliance_violations(tenant_id: str = Query(...),
                                   status: Optional[ComplianceStatus] = None,
                                   risk_level: Optional[RiskLevel] = None,
                                   limit: int = Query(100, le=1000),
                                       current_user: TokenPayload = Depends(get_current_user),
                                   ):
    """Get compliance violations"""
    query = "SELECT * FROM compliance_violations WHERE tenant_id = $1"
    params = [tenant_id]
    
    if status:
        query += f" AND status = ${len(params) + 1}"
        params.append(status.value)
    
    if risk_level:
        query += f" AND risk_level = ${len(params) + 1}"
        params.append(risk_level.value)
    
    query += f" ORDER BY detected_at DESC LIMIT ${len(params) + 1}"
    params.append(limit)
    
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        return {"violations": [dict(row) for row in rows]}

@app.post("/audit-reports", status_code=status.HTTP_201_CREATED)
async def generate_audit_report(report: AuditReport,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Generate an audit report"""
    report_id = await audit_manager.generate_audit_report(report)
    return {"report_id": report_id}

@app.get("/audit-reports")
async def get_audit_reports(tenant_id: str = Query(...),
                           report_type: Optional[str] = None,
                           status: Optional[AuditStatus] = None,
                               current_user: TokenPayload = Depends(get_current_user),
                           ):
    """Get audit reports"""
    query = "SELECT * FROM audit_reports WHERE tenant_id = $1"
    params = [tenant_id]
    
    if report_type:
        query += f" AND report_type = ${len(params) + 1}"
        params.append(report_type)
    
    if status:
        query += f" AND status = ${len(params) + 1}"
        params.append(status.value)
    
    query += " ORDER BY created_at DESC"
    
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        return {"reports": [dict(row) for row in rows]}

@app.get("/audit-reports/{report_id}")
async def get_audit_report(report_id: str, tenant_id: str = Query(...),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get specific audit report"""
    async with db_manager.pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT * FROM audit_reports 
            WHERE id = $1 AND tenant_id = $2
        """, report_id, tenant_id)
        
        if not row:
            raise HTTPException(status_code=404, detail="Report not found")
        
        report_data = dict(row)
        
        # If report is completed and has file, load the data
        if report_data['status'] == 'completed' and report_data['file_path']:
            try:
                with open(report_data['file_path'], 'r') as f:
                    report_data['data'] = json.load(f)
            except Exception as e:
                logger.error(f"Failed to load report data: {e}")
        
        return report_data

@app.post("/access-control-audit", status_code=status.HTTP_201_CREATED)
async def log_access_control_audit(audit: AccessControlAudit,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Log access control audit event"""
    async with db_manager.pool.acquire() as conn:
        audit_id = await conn.fetchval("""
            INSERT INTO access_control_audit 
            (user_id, resource_type, resource_id, permission_requested,
             permission_granted, reason, timestamp, tenant_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
        """, audit.user_id, audit.resource_type, audit.resource_id,
            audit.permission_requested, audit.permission_granted,
            audit.reason, audit.timestamp, audit.tenant_id)
    
    return {"audit_id": str(audit_id)}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "audit-compliance"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8005)