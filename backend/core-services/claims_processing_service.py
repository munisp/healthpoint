#!/usr/bin/env python3
"""
Healthcare Claims Platform - Claims Processing Service
Advanced workflow management, AI-powered processing, and real-time status tracking.

Author: Manus AI
Date: October 5, 2025
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

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, status, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator, Field
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
import hashlib
import base64
from decimal import Decimal
import re

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://localhost:9000")

class ClaimStatus(str, Enum):
    SUBMITTED = "submitted"
    RECEIVED = "received"
    UNDER_REVIEW = "under_review"
    PENDING_INFO = "pending_info"
    APPROVED = "approved"
    DENIED = "denied"
    PAID = "paid"
    APPEALED = "appealed"
    CANCELLED = "cancelled"

class ClaimType(str, Enum):
    MEDICAL = "medical"
    DENTAL = "dental"
    VISION = "vision"
    PHARMACY = "pharmacy"
    MENTAL_HEALTH = "mental_health"
    EMERGENCY = "emergency"
    PREVENTIVE = "preventive"

class ProcessingPriority(str, Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"
    EMERGENCY = "emergency"

class ValidationResult(str, Enum):
    VALID = "valid"
    INVALID = "invalid"
    REQUIRES_REVIEW = "requires_review"
    MISSING_INFO = "missing_info"

# Pydantic Models
class ClaimLineItem(BaseModel):
    id: Optional[str] = None
    procedure_code: str = Field(..., description="CPT/HCPCS procedure code")
    diagnosis_code: str = Field(..., description="ICD-10 diagnosis code")
    service_date: datetime
    units: int = Field(default=1, ge=1)
    unit_price: Decimal = Field(..., ge=0)
    total_amount: Decimal = Field(..., ge=0)
    place_of_service: str
    modifier_codes: List[str] = []
    description: Optional[str] = None

class ClaimSubmission(BaseModel):
    patient_id: str
    provider_id: str
    tenant_id: str
    claim_type: ClaimType
    priority: ProcessingPriority = ProcessingPriority.NORMAL
    service_date_from: datetime
    service_date_to: datetime
    total_amount: Decimal = Field(..., ge=0)
    line_items: List[ClaimLineItem]
    diagnosis_codes: List[str]
    patient_info: Dict[str, Any]
    provider_info: Dict[str, Any]
    insurance_info: Dict[str, Any]
    attachments: List[str] = []  # File paths or URLs
    notes: Optional[str] = None

class ClaimUpdate(BaseModel):
    status: Optional[ClaimStatus] = None
    notes: Optional[str] = None
    reviewer_id: Optional[str] = None
    decision_reason: Optional[str] = None
    approved_amount: Optional[Decimal] = None
    denial_reason: Optional[str] = None

class ClaimResponse(BaseModel):
    id: str
    claim_number: str
    status: ClaimStatus
    claim_type: ClaimType
    priority: ProcessingPriority
    patient_id: str
    provider_id: str
    tenant_id: str
    total_amount: Decimal
    approved_amount: Optional[Decimal] = None
    submitted_at: datetime
    updated_at: datetime
    processed_at: Optional[datetime] = None
    line_items: List[ClaimLineItem]
    status_history: List[Dict[str, Any]]
    validation_results: List[Dict[str, Any]]
    ai_insights: Optional[Dict[str, Any]] = None

class ValidationRule(BaseModel):
    id: str
    name: str
    description: str
    rule_type: str  # "eligibility", "coverage", "coding", "duplicate", "fraud"
    conditions: Dict[str, Any]
    actions: List[str]
    severity: str  # "error", "warning", "info"
    active: bool = True

class ProcessingWorkflow(BaseModel):
    id: str
    name: str
    description: str
    steps: List[Dict[str, Any]]
    conditions: Dict[str, Any]
    auto_approve_threshold: Optional[Decimal] = None
    review_required_conditions: List[str]
    active: bool = True

class AIInsight(BaseModel):
    claim_id: str
    insight_type: str  # "fraud_risk", "coding_suggestion", "approval_prediction"
    confidence_score: float = Field(..., ge=0, le=1)
    details: Dict[str, Any]
    recommendations: List[str]
    generated_at: datetime

# Database connection management
class DatabaseManager:
    def __init__(self):
        self.pool = None
        self.redis = None
    
    async def connect(self):
        """Initialize database connections"""
        try:
            self.pool = await asyncpg.create_pool(DATABASE_URL)
            self.redis = get_redis_client()
            logger.info("Claims processing database connections established")
        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            raise
    
    async def disconnect(self):
        """Close database connections"""
        if self.pool:
            await self.pool.close()
        if self.redis:
            await self.redis.close()
        logger.info("Claims processing database connections closed")

db_manager = DatabaseManager()

# AI Processing Engine
class AIProcessingEngine:
    def __init__(self):
        self.models = {
            "fraud_detection": "fraud_model_v2",
            "coding_validation": "coding_model_v1",
            "approval_prediction": "approval_model_v3"
        }
    
    async def analyze_claim(self, claim: ClaimSubmission) -> List[AIInsight]:
        """Analyze claim using AI models"""
        insights = []
        
        try:
            # Fraud detection
            fraud_risk = await self._detect_fraud_risk(claim)
            if fraud_risk["risk_score"] > 0.3:
                insights.append(AIInsight(
                    claim_id="",  # Will be set after claim creation
                    insight_type="fraud_risk",
                    confidence_score=fraud_risk["risk_score"],
                    details=fraud_risk,
                    recommendations=fraud_risk.get("recommendations", []),
                    generated_at=datetime.utcnow()
                ))
            
            # Coding validation
            coding_issues = await self._validate_coding(claim)
            if coding_issues:
                insights.append(AIInsight(
                    claim_id="",
                    insight_type="coding_suggestion",
                    confidence_score=0.8,
                    details={"issues": coding_issues},
                    recommendations=[f"Review {issue['type']}: {issue['message']}" for issue in coding_issues],
                    generated_at=datetime.utcnow()
                ))
            
            # Approval prediction
            approval_prediction = await self._predict_approval(claim)
            insights.append(AIInsight(
                claim_id="",
                insight_type="approval_prediction",
                confidence_score=approval_prediction["confidence"],
                details=approval_prediction,
                recommendations=approval_prediction.get("recommendations", []),
                generated_at=datetime.utcnow()
            ))
            
        except Exception as e:
            logger.error(f"AI analysis failed: {e}")
        
        return insights
    
    async def _detect_fraud_risk(self, claim: ClaimSubmission) -> Dict[str, Any]:
        """Detect potential fraud indicators"""
        risk_factors = []
        risk_score = 0.0
        
        # Check for duplicate submissions
        if await self._check_duplicate_claims(claim):
            risk_factors.append("Potential duplicate claim")
            risk_score += 0.3
        
        # Check for unusual billing patterns
        if claim.total_amount > 10000:
            risk_factors.append("High claim amount")
            risk_score += 0.2
        
        # Check for weekend/holiday services
        if claim.service_date_from.weekday() >= 5:
            risk_factors.append("Weekend service date")
            risk_score += 0.1
        
        # Check for multiple procedures on same day
        if len(claim.line_items) > 10:
            risk_factors.append("Multiple procedures")
            risk_score += 0.2
        
        return {
            "risk_score": min(risk_score, 1.0),
            "risk_factors": risk_factors,
            "recommendations": [
                "Manual review recommended" if risk_score > 0.5 else "Standard processing"
            ]
        }
    
    async def _validate_coding(self, claim: ClaimSubmission) -> List[Dict[str, Any]]:
        """Validate medical coding"""
        issues = []
        
        for item in claim.line_items:
            # Validate CPT codes
            if not re.match(r'^\d{5}$', item.procedure_code):
                issues.append({
                    "type": "Invalid CPT Code",
                    "message": f"CPT code {item.procedure_code} is not valid",
                    "line_item_id": item.id
                })
            
            # Validate ICD-10 codes
            if not re.match(r'^[A-Z]\d{2}(\.\d{1,4})?$', item.diagnosis_code):
                issues.append({
                    "type": "Invalid ICD-10 Code",
                    "message": f"ICD-10 code {item.diagnosis_code} is not valid",
                    "line_item_id": item.id
                })
            
            # Check for coding consistency
            if item.total_amount != item.unit_price * item.units:
                issues.append({
                    "type": "Amount Calculation Error",
                    "message": "Total amount does not match unit price × units",
                    "line_item_id": item.id
                })
        
        return issues
    
    async def _predict_approval(self, claim: ClaimSubmission) -> Dict[str, Any]:
        """Predict claim approval likelihood"""
        # Simplified approval prediction logic
        approval_score = 0.8
        factors = []
        
        # Check claim completeness
        if all([claim.patient_info, claim.provider_info, claim.insurance_info]):
            approval_score += 0.1
            factors.append("Complete documentation")
        
        # Check for pre-authorization
        if claim.notes and "pre-auth" in claim.notes.lower():
            approval_score += 0.1
            factors.append("Pre-authorization noted")
        
        # Check claim amount
        if claim.total_amount < 1000:
            approval_score += 0.05
            factors.append("Standard claim amount")
        
        return {
            "approval_probability": min(approval_score, 1.0),
            "confidence": 0.85,
            "factors": factors,
            "recommendations": [
                "Likely to be approved" if approval_score > 0.7 else "May require review"
            ]
        }
    
    async def _check_duplicate_claims(self, claim: ClaimSubmission) -> bool:
        """Check for potential duplicate claims"""
        # Simplified duplicate detection
        async with db_manager.pool.acquire() as conn:
            existing = await conn.fetchval("""
                SELECT COUNT(*) FROM claims 
                WHERE patient_id = $1 
                AND provider_id = $2 
                AND service_date_from = $3 
                AND total_amount = $4
                AND status NOT IN ('cancelled', 'denied')
            """, claim.patient_id, claim.provider_id, claim.service_date_from, claim.total_amount)
            
            return existing > 0

ai_engine = AIProcessingEngine()

# Claims Processing Engine
class ClaimsProcessor:
    def __init__(self):
        self.validation_rules = []
        self.workflows = []
    
    async def process_claim(self, claim: ClaimSubmission, background_tasks: BackgroundTasks) -> ClaimResponse:
        """Process a new claim submission"""
        claim_id = str(uuid.uuid4())
        claim_number = await self._generate_claim_number()
        
        # Initial validation
        validation_results = await self._validate_claim(claim)
        
        # AI analysis
        ai_insights = await ai_engine.analyze_claim(claim)
        for insight in ai_insights:
            insight.claim_id = claim_id
        
        # Determine initial status
        initial_status = self._determine_initial_status(validation_results, ai_insights)
        
        # Store claim in database
        async with db_manager.pool.acquire() as conn:
            # Insert main claim record
            await conn.execute("""
                INSERT INTO claims (
                    id, claim_number, status, claim_type, priority, patient_id, provider_id, tenant_id,
                    total_amount, service_date_from, service_date_to, submitted_at, updated_at,
                    patient_info, provider_info, insurance_info, notes
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            """, 
                claim_id, claim_number, initial_status.value, claim.claim_type.value, claim.priority.value,
                claim.patient_id, claim.provider_id, claim.tenant_id, claim.total_amount,
                claim.service_date_from, claim.service_date_to, datetime.utcnow(), datetime.utcnow(),
                json.dumps(claim.patient_info), json.dumps(claim.provider_info), 
                json.dumps(claim.insurance_info), claim.notes
            )
            
            # Insert line items
            for item in claim.line_items:
                item_id = str(uuid.uuid4())
                await conn.execute("""
                    INSERT INTO claim_line_items (
                        id, claim_id, procedure_code, diagnosis_code, service_date, units,
                        unit_price, total_amount, place_of_service, modifier_codes, description
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                """, 
                    item_id, claim_id, item.procedure_code, item.diagnosis_code, item.service_date,
                    item.units, item.unit_price, item.total_amount, item.place_of_service,
                    json.dumps(item.modifier_codes), item.description
                )
            
            # Insert status history
            await conn.execute("""
                INSERT INTO claim_status_history (claim_id, status, changed_at, changed_by, notes)
                VALUES ($1, $2, $3, $4, $5)
            """, claim_id, initial_status.value, datetime.utcnow(), "system", "Initial submission")
            
            # Insert validation results
            for result in validation_results:
                await conn.execute("""
                    INSERT INTO claim_validations (claim_id, rule_id, result, message, severity)
                    VALUES ($1, $2, $3, $4, $5)
                """, claim_id, result["rule_id"], result["result"], result["message"], result["severity"])
            
            # Insert AI insights
            for insight in ai_insights:
                await conn.execute("""
                    INSERT INTO claim_ai_insights (
                        claim_id, insight_type, confidence_score, details, recommendations, generated_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6)
                """, 
                    claim_id, insight.insight_type, insight.confidence_score,
                    json.dumps(insight.details), json.dumps(insight.recommendations), insight.generated_at
                )
        
        # Schedule background processing
        background_tasks.add_task(self._process_workflow, claim_id)
        
        # Cache claim for quick access
        await self._cache_claim(claim_id, {
            "status": initial_status.value,
            "priority": claim.priority.value,
            "total_amount": float(claim.total_amount),
            "submitted_at": datetime.utcnow().isoformat()
        })
        
        # Return claim response
        return await self.get_claim(claim_id)
    
    async def _validate_claim(self, claim: ClaimSubmission) -> List[Dict[str, Any]]:
        """Validate claim against business rules"""
        results = []
        
        # Load validation rules
        async with db_manager.pool.acquire() as conn:
            rules = await conn.fetch("SELECT * FROM validation_rules WHERE active = true")
        
        for rule in rules:
            try:
                result = await self._apply_validation_rule(claim, dict(rule))
                if result:
                    results.append(result)
            except Exception as e:
                logger.error(f"Validation rule {rule['id']} failed: {e}")
        
        return results
    
    async def _apply_validation_rule(self, claim: ClaimSubmission, rule: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Apply a single validation rule"""
        rule_type = rule["rule_type"]
        conditions = json.loads(rule["conditions"])
        
        if rule_type == "eligibility":
            # Check patient eligibility
            if not claim.patient_info.get("insurance_active"):
                return {
                    "rule_id": rule["id"],
                    "result": ValidationResult.INVALID.value,
                    "message": "Patient insurance not active",
                    "severity": "error"
                }
        
        elif rule_type == "coverage":
            # Check service coverage
            if claim.claim_type == ClaimType.DENTAL and not claim.insurance_info.get("dental_coverage"):
                return {
                    "rule_id": rule["id"],
                    "result": ValidationResult.INVALID.value,
                    "message": "Dental services not covered",
                    "severity": "error"
                }
        
        elif rule_type == "coding":
            # Validate medical codes
            for item in claim.line_items:
                if not item.procedure_code or len(item.procedure_code) != 5:
                    return {
                        "rule_id": rule["id"],
                        "result": ValidationResult.INVALID.value,
                        "message": f"Invalid procedure code: {item.procedure_code}",
                        "severity": "error"
                    }
        
        elif rule_type == "duplicate":
            # Check for duplicates
            if await ai_engine._check_duplicate_claims(claim):
                return {
                    "rule_id": rule["id"],
                    "result": ValidationResult.REQUIRES_REVIEW.value,
                    "message": "Potential duplicate claim detected",
                    "severity": "warning"
                }
        
        return None
    
    def _determine_initial_status(self, validation_results: List[Dict[str, Any]], ai_insights: List[AIInsight]) -> ClaimStatus:
        """Determine initial claim status based on validation and AI analysis"""
        # Check for validation errors
        for result in validation_results:
            if result["result"] == ValidationResult.INVALID.value:
                return ClaimStatus.DENIED
            elif result["result"] == ValidationResult.REQUIRES_REVIEW.value:
                return ClaimStatus.UNDER_REVIEW
        
        # Check AI insights for high fraud risk
        for insight in ai_insights:
            if insight.insight_type == "fraud_risk" and insight.confidence_score > 0.7:
                return ClaimStatus.UNDER_REVIEW
        
        return ClaimStatus.RECEIVED
    
    async def _generate_claim_number(self) -> str:
        """Generate unique claim number"""
        timestamp = datetime.utcnow().strftime("%Y%m%d")
        
        async with db_manager.pool.acquire() as conn:
            sequence = await conn.fetchval("""
                SELECT COALESCE(MAX(CAST(SUBSTRING(claim_number FROM 9) AS INTEGER)), 0) + 1
                FROM claims 
                WHERE claim_number LIKE $1
            """, f"{timestamp}%")
        
        return f"{timestamp}{sequence:04d}"
    
    async def _process_workflow(self, claim_id: str):
        """Process claim through workflow steps"""
        try:
            # Get claim details
            claim = await self.get_claim(claim_id)
            
            # Load applicable workflows
            async with db_manager.pool.acquire() as conn:
                workflows = await conn.fetch("""
                    SELECT * FROM processing_workflows 
                    WHERE active = true 
                    ORDER BY priority DESC
                """)
            
            for workflow in workflows:
                if await self._workflow_applies(claim, dict(workflow)):
                    await self._execute_workflow(claim_id, dict(workflow))
                    break
            
        except Exception as e:
            logger.error(f"Workflow processing failed for claim {claim_id}: {e}")
    
    async def _workflow_applies(self, claim: ClaimResponse, workflow: Dict[str, Any]) -> bool:
        """Check if workflow applies to claim"""
        conditions = json.loads(workflow["conditions"])
        
        # Check claim type
        if "claim_types" in conditions:
            if claim.claim_type not in conditions["claim_types"]:
                return False
        
        # Check amount threshold
        if "max_amount" in conditions:
            if claim.total_amount > conditions["max_amount"]:
                return False
        
        return True
    
    async def _execute_workflow(self, claim_id: str, workflow: Dict[str, Any]):
        """Execute workflow steps"""
        steps = json.loads(workflow["steps"])
        
        for step in steps:
            try:
                await self._execute_workflow_step(claim_id, step)
                await asyncio.sleep(1)  # Brief delay between steps
            except Exception as e:
                logger.error(f"Workflow step failed for claim {claim_id}: {e}")
                break
    
    async def _execute_workflow_step(self, claim_id: str, step: Dict[str, Any]):
        """Execute a single workflow step"""
        step_type = step["type"]
        
        if step_type == "auto_approve":
            await self.update_claim_status(claim_id, ClaimStatus.APPROVED, "system", "Auto-approved by workflow")
        
        elif step_type == "require_review":
            await self.update_claim_status(claim_id, ClaimStatus.UNDER_REVIEW, "system", "Manual review required")
        
        elif step_type == "send_notification":
            # Send notification via notification service HTTP call
            try:
                import httpx
                notification_url = os.getenv("NOTIFICATION_SERVICE_URL", "http://notification-service:8010")
                async with httpx.AsyncClient(timeout=5.0) as client:
                    await client.post(f"{notification_url}/api/v1/notifications/send", json={
                        "claim_id": claim_id,
                        "event_type": "workflow_step",
                        "step_type": step_type,
                        "timestamp": datetime.utcnow().isoformat()
                    })
            except Exception as e:
                logger.warning(f"Notification send failed for claim {claim_id}: {e}")
        
        elif step_type == "calculate_payment":
            # Calculate payment amount
            await self._calculate_payment(claim_id)
    
    async def _calculate_payment(self, claim_id: str):
        """Calculate payment amount for approved claim"""
        async with db_manager.pool.acquire() as conn:
            claim = await conn.fetchrow("SELECT * FROM claims WHERE id = $1", claim_id)
            
            if claim and claim["status"] == ClaimStatus.APPROVED.value:
                # Simplified payment calculation (apply deductibles, copays, etc.)
                approved_amount = float(claim["total_amount"]) * 0.8  # 80% coverage example
                
                await conn.execute("""
                    UPDATE claims SET approved_amount = $1, updated_at = $2 
                    WHERE id = $3
                """, approved_amount, datetime.utcnow(), claim_id)
    
    async def _cache_claim(self, claim_id: str, data: Dict[str, Any]):
        """Cache claim data for quick access"""
        await db_manager.redis.setex(f"claim:{claim_id}", 3600, json.dumps(data))
    
    async def get_claim(self, claim_id: str) -> ClaimResponse:
        """Get claim by ID"""
        async with db_manager.pool.acquire() as conn:
            # Get main claim record
            claim = await conn.fetchrow("SELECT * FROM claims WHERE id = $1", claim_id)
            if not claim:
                raise HTTPException(status_code=404, detail="Claim not found")
            
            # Get line items
            line_items = await conn.fetch("SELECT * FROM claim_line_items WHERE claim_id = $1", claim_id)
            
            # Get status history
            status_history = await conn.fetch("""
                SELECT * FROM claim_status_history 
                WHERE claim_id = $1 
                ORDER BY changed_at DESC
            """, claim_id)
            
            # Get validation results
            validations = await conn.fetch("SELECT * FROM claim_validations WHERE claim_id = $1", claim_id)
            
            # Get AI insights
            insights = await conn.fetch("SELECT * FROM claim_ai_insights WHERE claim_id = $1", claim_id)
            
            return ClaimResponse(
                id=claim["id"],
                claim_number=claim["claim_number"],
                status=ClaimStatus(claim["status"]),
                claim_type=ClaimType(claim["claim_type"]),
                priority=ProcessingPriority(claim["priority"]),
                patient_id=claim["patient_id"],
                provider_id=claim["provider_id"],
                tenant_id=claim["tenant_id"],
                total_amount=claim["total_amount"],
                approved_amount=claim["approved_amount"],
                submitted_at=claim["submitted_at"],
                updated_at=claim["updated_at"],
                processed_at=claim["processed_at"],
                line_items=[
                    ClaimLineItem(
                        id=item["id"],
                        procedure_code=item["procedure_code"],
                        diagnosis_code=item["diagnosis_code"],
                        service_date=item["service_date"],
                        units=item["units"],
                        unit_price=item["unit_price"],
                        total_amount=item["total_amount"],
                        place_of_service=item["place_of_service"],
                        modifier_codes=json.loads(item["modifier_codes"]) if item["modifier_codes"] else [],
                        description=item["description"]
                    )
                    for item in line_items
                ],
                status_history=[
                    {
                        "status": hist["status"],
                        "changed_at": hist["changed_at"].isoformat(),
                        "changed_by": hist["changed_by"],
                        "notes": hist["notes"]
                    }
                    for hist in status_history
                ],
                validation_results=[
                    {
                        "rule_id": val["rule_id"],
                        "result": val["result"],
                        "message": val["message"],
                        "severity": val["severity"]
                    }
                    for val in validations
                ],
                ai_insights={
                    "insights": [
                        {
                            "type": insight["insight_type"],
                            "confidence": insight["confidence_score"],
                            "details": json.loads(insight["details"]),
                            "recommendations": json.loads(insight["recommendations"]),
                            "generated_at": insight["generated_at"].isoformat()
                        }
                        for insight in insights
                    ]
                } if insights else None
            )
    
    async def update_claim_status(self, claim_id: str, status: ClaimStatus, user_id: str, notes: str = None):
        """Update claim status"""
        async with db_manager.pool.acquire() as conn:
            # Update main record
            await conn.execute("""
                UPDATE claims 
                SET status = $1, updated_at = $2, processed_at = CASE WHEN $1 IN ('approved', 'denied') THEN $2 ELSE processed_at END
                WHERE id = $3
            """, status.value, datetime.utcnow(), claim_id)
            
            # Add status history
            await conn.execute("""
                INSERT INTO claim_status_history (claim_id, status, changed_at, changed_by, notes)
                VALUES ($1, $2, $3, $4, $5)
            """, claim_id, status.value, datetime.utcnow(), user_id, notes)
        
        # Update cache
        await self._cache_claim(claim_id, {"status": status.value, "updated_at": datetime.utcnow().isoformat()})

claims_processor = ClaimsProcessor()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await db_manager.connect()
    await initialize_database()
    yield
    # Shutdown
    await db_manager.disconnect()

# FastAPI app
app = FastAPI(

app.middleware("http")(security_headers_middleware)
    title="Healthcare Claims Platform - Claims Processing Service",
    description="Advanced workflow management, AI-powered processing, and real-time status tracking",
    version="1.0.0",
    lifespan=lifespan
)

# Add middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def initialize_database():
    """Initialize database tables"""
    async with db_manager.pool.acquire() as conn:
        # Create claims table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS claims (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                claim_number VARCHAR(20) UNIQUE NOT NULL,
                status VARCHAR(20) NOT NULL,
                claim_type VARCHAR(20) NOT NULL,
                priority VARCHAR(20) NOT NULL,
                patient_id UUID NOT NULL,
                provider_id UUID NOT NULL,
                tenant_id UUID NOT NULL,
                total_amount DECIMAL(12,2) NOT NULL,
                approved_amount DECIMAL(12,2),
                service_date_from DATE NOT NULL,
                service_date_to DATE NOT NULL,
                submitted_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                processed_at TIMESTAMP,
                patient_info JSONB,
                provider_info JSONB,
                insurance_info JSONB,
                notes TEXT
            )
        """)
        
        # Create claim line items table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS claim_line_items (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                claim_id UUID REFERENCES claims(id) ON DELETE CASCADE,
                procedure_code VARCHAR(10) NOT NULL,
                diagnosis_code VARCHAR(10) NOT NULL,
                service_date DATE NOT NULL,
                units INTEGER NOT NULL DEFAULT 1,
                unit_price DECIMAL(10,2) NOT NULL,
                total_amount DECIMAL(10,2) NOT NULL,
                place_of_service VARCHAR(10),
                modifier_codes JSONB,
                description TEXT
            )
        """)
        
        # Create status history table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS claim_status_history (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                claim_id UUID REFERENCES claims(id) ON DELETE CASCADE,
                status VARCHAR(20) NOT NULL,
                changed_at TIMESTAMP DEFAULT NOW(),
                changed_by VARCHAR(100),
                notes TEXT
            )
        """)
        
        # Create validation rules table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS validation_rules (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(255) NOT NULL,
                description TEXT,
                rule_type VARCHAR(50) NOT NULL,
                conditions JSONB NOT NULL,
                actions JSONB NOT NULL,
                severity VARCHAR(20) NOT NULL,
                active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Create claim validations table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS claim_validations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                claim_id UUID REFERENCES claims(id) ON DELETE CASCADE,
                rule_id UUID REFERENCES validation_rules(id),
                result VARCHAR(20) NOT NULL,
                message TEXT,
                severity VARCHAR(20) NOT NULL,
                validated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Create processing workflows table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS processing_workflows (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(255) NOT NULL,
                description TEXT,
                steps JSONB NOT NULL,
                conditions JSONB NOT NULL,
                auto_approve_threshold DECIMAL(12,2),
                review_required_conditions JSONB,
                priority INTEGER DEFAULT 0,
                active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Create AI insights table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS claim_ai_insights (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                claim_id UUID REFERENCES claims(id) ON DELETE CASCADE,
                insight_type VARCHAR(50) NOT NULL,
                confidence_score FLOAT NOT NULL,
                details JSONB,
                recommendations JSONB,
                generated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Insert default validation rules
        await conn.execute("""
            INSERT INTO validation_rules (name, description, rule_type, conditions, actions, severity)
            VALUES 
                ('Patient Eligibility', 'Check if patient insurance is active', 'eligibility', '{"check_insurance": true}', '["deny_if_inactive"]', 'error'),
                ('Service Coverage', 'Verify service is covered by insurance', 'coverage', '{"check_benefits": true}', '["deny_if_not_covered"]', 'error'),
                ('Coding Validation', 'Validate CPT and ICD-10 codes', 'coding', '{"validate_codes": true}', '["flag_invalid_codes"]', 'error'),
                ('Duplicate Detection', 'Check for duplicate claims', 'duplicate', '{"check_duplicates": true}', '["flag_for_review"]', 'warning')
            ON CONFLICT DO NOTHING
        """)
        
        # Insert default workflows
        await conn.execute("""
            INSERT INTO processing_workflows (name, description, steps, conditions, auto_approve_threshold)
            VALUES 
                ('Standard Processing', 'Standard claim processing workflow', 
                 '[{"type": "validate", "order": 1}, {"type": "ai_analysis", "order": 2}, {"type": "auto_approve", "order": 3, "condition": "low_risk"}]',
                 '{"claim_types": ["medical", "dental"], "max_amount": 5000}', 1000),
                ('High Value Review', 'Manual review for high-value claims',
                 '[{"type": "validate", "order": 1}, {"type": "ai_analysis", "order": 2}, {"type": "require_review", "order": 3}]',
                 '{"min_amount": 5000}', null)
            ON CONFLICT DO NOTHING
        """)
        
        logger.info("Claims processing database tables initialized")

# API Endpoints
@app.post("/claims", response_model=ClaimResponse)
async def submit_claim(claim: ClaimSubmission, background_tasks: BackgroundTasks,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Submit a new claim for processing"""
    return await claims_processor.process_claim(claim, background_tasks)

@app.get("/claims/{claim_id}", response_model=ClaimResponse)
async def get_claim(claim_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get claim details by ID"""
    return await claims_processor.get_claim(claim_id)

@app.put("/claims/{claim_id}/status")
async def update_claim_status(claim_id: str, update: ClaimUpdate, user_id: str = "system",
    current_user: TokenPayload = Depends(get_current_user),
):
    """Update claim status"""
    if update.status:
        await claims_processor.update_claim_status(claim_id, update.status, user_id, update.notes)
    
    return {"message": "Claim status updated successfully"}

@app.get("/claims")
async def list_claims(
    tenant_id: Optional[str] = None,
    status: Optional[ClaimStatus] = None,
    claim_type: Optional[ClaimType] = None,
    limit: int = 50,
    offset: int = 0
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """List claims with filtering"""
    async with db_manager.pool.acquire() as conn:
        query = "SELECT * FROM claims WHERE 1=1"
        params = []
        param_count = 0
        
        if tenant_id:
            param_count += 1
            query += f" AND tenant_id = ${param_count}"
            params.append(tenant_id)
        
        if status:
            param_count += 1
            query += f" AND status = ${param_count}"
            params.append(status.value)
        
        if claim_type:
            param_count += 1
            query += f" AND claim_type = ${param_count}"
            params.append(claim_type.value)
        
        query += f" ORDER BY submitted_at DESC LIMIT ${param_count + 1} OFFSET ${param_count + 2}"
        params.extend([limit, offset])
        
        claims = await conn.fetch(query, *params)
        
        return {
            "claims": [
                {
                    "id": claim["id"],
                    "claim_number": claim["claim_number"],
                    "status": claim["status"],
                    "claim_type": claim["claim_type"],
                    "total_amount": float(claim["total_amount"]),
                    "submitted_at": claim["submitted_at"].isoformat(),
                    "patient_id": claim["patient_id"],
                    "provider_id": claim["provider_id"]
                }
                for claim in claims
            ],
            "total": len(claims),
            "limit": limit,
            "offset": offset
        }

@app.get("/claims/stats")
async def get_claims_stats(,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get claims processing statistics"""
    async with db_manager.pool.acquire() as conn:
        stats = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total_claims,
                COUNT(*) FILTER (WHERE status = 'approved') as approved_claims,
                COUNT(*) FILTER (WHERE status = 'denied') as denied_claims,
                COUNT(*) FILTER (WHERE status IN ('submitted', 'received', 'under_review')) as pending_claims,
                AVG(total_amount) as avg_claim_amount,
                SUM(approved_amount) as total_approved_amount
            FROM claims
            WHERE submitted_at > NOW() - INTERVAL '30 days'
        """)
        
        return {
            "total_claims": stats["total_claims"],
            "approved_claims": stats["approved_claims"],
            "denied_claims": stats["denied_claims"],
            "pending_claims": stats["pending_claims"],
            "approval_rate": (stats["approved_claims"] / max(stats["total_claims"], 1)) * 100,
            "avg_claim_amount": float(stats["avg_claim_amount"] or 0),
            "total_approved_amount": float(stats["total_approved_amount"] or 0)
        }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        async with db_manager.pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        
        await db_manager.redis.ping()
        
        return {
            "status": "healthy",
            "timestamp": datetime.utcnow().isoformat(),
            "service": "claims-processing-service",
            "version": "1.0.0"
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service unhealthy"
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8004)