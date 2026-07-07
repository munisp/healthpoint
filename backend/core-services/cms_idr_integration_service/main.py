
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

import os
"""
CMS IDR Integration Service
Handles integration with CMS IDR Portal and certified IDR entities
Provides real-time status updates and submission tracking
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import asyncio
import aiohttp
import json
import logging
import hashlib
import hmac
from sqlalchemy import create_engine, Column, String, DateTime, Integer, Text, Boolean, Decimal, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
import redis.asyncio as redis.asyncio as redis
from cryptography.fernet import Fernet
from shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

setup_telemetry(service_name="cms-idr-integration-service", service_version="1.0.0")
app = FastAPI(title="CMS IDR Integration Service", version="1.0.0")
instrument_fastapi(app)

app.middleware("http")(security_headers_middleware)

# Database setup
DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Redis setup for caching and real-time updates
# Redis client initialized via shared cache module
# Use: from backend.shared.cache import get_client as get_redis_client

# Encryption setup
encryption_key = Fernet.generate_key()
cipher_suite = Fernet(encryption_key)

class SubmissionStatus(str, Enum):
    PENDING = "pending"
    VALIDATING = "validating"
    VALIDATED = "validated"
    SUBMITTING = "submitting"
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    ADDITIONAL_INFO_REQUIRED = "additional_info_required"
    DECISION_PENDING = "decision_pending"
    DECISION_RENDERED = "decision_rendered"
    PAYMENT_REQUIRED = "payment_required"
    COMPLETED = "completed"
    REJECTED = "rejected"
    CANCELLED = "cancelled"

class IDREntity(str, Enum):
    HEALTHCARE_RESOLUTION_LLC = "Healthcare Resolution LLC"
    MEDICAL_DISPUTE_SERVICES = "Medical Dispute Services"
    INDEPENDENT_MEDICAL_REVIEW = "Independent Medical Review"
    ARBITRATION_FORUMS_INC = "Arbitration Forums Inc"
    MAXIMUS_FEDERAL = "MAXIMUS Federal"

# Database Models
class CMSSubmission(Base):
    __tablename__ = "cms_submissions"
    
    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(String(100), unique=True, index=True)
    aggregator_id = Column(String(50), index=True)
    cms_submission_id = Column(String(100), unique=True, index=True)
    total_claims = Column(Integer)
    total_amount = Column(Decimal(15, 2))
    status = Column(String(50), default=SubmissionStatus.PENDING)
    submission_date = Column(DateTime, default=datetime.utcnow)
    last_status_update = Column(DateTime, default=datetime.utcnow)
    cms_response = Column(JSON)
    idr_entity_assigned = Column(String(100))
    decision_deadline = Column(DateTime)
    final_decision = Column(JSON)
    webhook_url = Column(String(500))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class IDREntityStatus(Base):
    __tablename__ = "idr_entity_status"
    
    id = Column(Integer, primary_key=True, index=True)
    entity_name = Column(String(100), index=True)
    is_certified = Column(Boolean, default=True)
    capacity_available = Column(Boolean, default=True)
    average_decision_time_days = Column(Integer)
    success_rate = Column(Decimal(5, 2))
    specialties = Column(JSON)
    contact_info = Column(JSON)
    last_updated = Column(DateTime, default=datetime.utcnow)

class StatusUpdate(Base):
    __tablename__ = "status_updates"
    
    id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(String(100), index=True)
    status = Column(String(50))
    message = Column(Text)
    details = Column(JSON)
    source = Column(String(50))  # CMS, IDR_ENTITY, SYSTEM
    timestamp = Column(DateTime, default=datetime.utcnow)
    webhook_sent = Column(Boolean, default=False)
    webhook_response = Column(JSON)

# Pydantic Models
class SubmissionRequest(BaseModel):
    batch_id: str
    aggregator_id: str
    claims_data: List[Dict[str, Any]]
    webhook_url: Optional[str] = None
    preferred_idr_entity: Optional[IDREntity] = None

class StatusUpdateResponse(BaseModel):
    submission_id: str
    status: SubmissionStatus
    message: str
    timestamp: datetime
    details: Optional[Dict[str, Any]] = None

class CMSResponse(BaseModel):
    submission_id: str
    cms_confirmation_number: str
    status: str
    message: str
    next_steps: List[str]
    estimated_completion: Optional[datetime] = None

# CMS IDR Portal Integration
class CMSIDRPortal:
    def __init__(self):
        self.base_url = "https://nsa-idr.cms.gov/api/v1"
        self.api_key = os.getenv("CMS_API_KEY", "")  # Loaded from environment variable
        self.timeout = 30
    
    async def submit_bulk_disputes(self, submission_data: Dict[str, Any]) -> CMSResponse:
        """Submit bulk disputes to CMS IDR Portal"""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-Submission-Source": "NSA-IDR-Platform"
        }
        
        # Encrypt sensitive data
        encrypted_data = self._encrypt_sensitive_data(submission_data)
        
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=self.timeout)) as session:
            try:
                async with session.post(
                    f"{self.base_url}/disputes/bulk-submit",
                    json=encrypted_data,
                    headers=headers
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        return CMSResponse(**result)
                    else:
                        error_text = await response.text()
                        raise HTTPException(status_code=response.status, detail=f"CMS API Error: {error_text}")
            except aiohttp.ClientError as e:
                logger.error(f"CMS API connection error: {str(e)}")
                raise HTTPException(status_code=503, detail="CMS IDR Portal unavailable")
    
    async def get_submission_status(self, cms_submission_id: str) -> Dict[str, Any]:
        """Get submission status from CMS IDR Portal"""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=self.timeout)) as session:
            try:
                async with session.get(
                    f"{self.base_url}/disputes/{cms_submission_id}/status",
                    headers=headers
                ) as response:
                    if response.status == 200:
                        return await response.json()
                    else:
                        error_text = await response.text()
                        logger.error(f"CMS status check error: {error_text}")
                        return {"status": "unknown", "error": error_text}
            except aiohttp.ClientError as e:
                logger.error(f"CMS status check connection error: {str(e)}")
                return {"status": "connection_error", "error": str(e)}
    
    def _encrypt_sensitive_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Encrypt sensitive fields in submission data"""
        sensitive_fields = ["patient_id", "provider_tax_id", "medical_records"]
        encrypted_data = data.copy()
        
        for field in sensitive_fields:
            if field in encrypted_data:
                if isinstance(encrypted_data[field], str):
                    encrypted_data[field] = cipher_suite.encrypt(encrypted_data[field].encode()).decode()
                elif isinstance(encrypted_data[field], list):
                    encrypted_data[field] = [
                        cipher_suite.encrypt(str(item).encode()).decode() 
                        for item in encrypted_data[field]
                    ]
        
        return encrypted_data

# IDR Entity Integration
class IDREntityIntegration:
    def __init__(self):
        self.entity_endpoints = {
            IDREntity.HEALTHCARE_RESOLUTION_LLC: "https://api.healthcareresolution.com/nsa-idr",
            IDREntity.MEDICAL_DISPUTE_SERVICES: "https://api.medicaldispute.com/idr",
            IDREntity.INDEPENDENT_MEDICAL_REVIEW: "https://api.independentmedical.com/review",
            IDREntity.ARBITRATION_FORUMS_INC: "https://api.arbitrationforums.com/healthcare",
            IDREntity.MAXIMUS_FEDERAL: "https://api.maximus.com/federal/idr"
        }
    
    async def assign_idr_entity(self, submission_data: Dict[str, Any]) -> IDREntity:
        """Assign appropriate IDR entity based on case characteristics"""
        # Logic to select IDR entity based on:
        # - Case complexity
        # - Dispute amount
        # - Provider specialty
        # - Entity availability and capacity
        
        dispute_amount = sum(float(claim.get('dispute_amount', 0)) for claim in submission_data.get('claims', []))
        case_complexity = self._assess_case_complexity(submission_data)
        
        if dispute_amount > 10000 or case_complexity == "high":
            return IDREntity.HEALTHCARE_RESOLUTION_LLC
        elif case_complexity == "medium":
            return IDREntity.MEDICAL_DISPUTE_SERVICES
        else:
            return IDREntity.INDEPENDENT_MEDICAL_REVIEW
    
    async def notify_idr_entity(self, entity: IDREntity, submission_data: Dict[str, Any]) -> Dict[str, Any]:
        """Notify assigned IDR entity of new case"""
        endpoint = self.entity_endpoints.get(entity)
        if not endpoint:
            raise ValueError(f"Unknown IDR entity: {entity}")
        
        headers = {
            "Authorization": f"Bearer IDR_ENTITY_API_KEY",
            "Content-Type": "application/json"
        }
        
        async with aiohttp.ClientSession() as session:
            try:
                async with session.post(
                    f"{endpoint}/cases/new",
                    json=submission_data,
                    headers=headers
                ) as response:
                    if response.status == 200:
                        return await response.json()
                    else:
                        error_text = await response.text()
                        logger.error(f"IDR entity notification error: {error_text}")
                        return {"status": "error", "message": error_text}
            except aiohttp.ClientError as e:
                logger.error(f"IDR entity connection error: {str(e)}")
                return {"status": "connection_error", "error": str(e)}
    
    def _assess_case_complexity(self, submission_data: Dict[str, Any]) -> str:
        """Assess case complexity based on various factors"""
        claims = submission_data.get('claims', [])
        
        # Factors for complexity assessment
        high_complexity_indicators = 0
        
        for claim in claims:
            # High-value disputes
            if float(claim.get('dispute_amount', 0)) > 5000:
                high_complexity_indicators += 1
            
            # Emergency services
            if claim.get('emergency_indicator'):
                high_complexity_indicators += 1
            
            # Complex procedures (surgery, imaging)
            service_code = claim.get('service_code', '')
            if service_code.startswith(('70', '71', '72', '73', '74', '75', '76')):  # Radiology
                high_complexity_indicators += 1
        
        if high_complexity_indicators >= len(claims) * 0.5:
            return "high"
        elif high_complexity_indicators >= len(claims) * 0.25:
            return "medium"
        else:
            return "low"

# Real-time Status Update System
class StatusUpdateManager:
    def __init__(self):
        self.cms_portal = CMSIDRPortal()
        self.idr_integration = IDREntityIntegration()
    
    async def create_status_update(self, submission_id: str, status: SubmissionStatus, 
                                 message: str, details: Optional[Dict[str, Any]] = None,
                                 source: str = "SYSTEM"):
        """Create and broadcast status update"""
        db = SessionLocal()
        try:
            # Create status update record
            status_update = StatusUpdate(
                submission_id=submission_id,
                status=status.value,
                message=message,
                details=details,
                source=source,
                timestamp=datetime.utcnow()
            )
            db.add(status_update)
            
            # Update main submission record
            submission = db.query(CMSSubmission).filter(
                CMSSubmission.cms_submission_id == submission_id
            ).first()
            
            if submission:
                submission.status = status.value
                submission.last_status_update = datetime.utcnow()
                if details:
                    submission.cms_response = details
            
            db.commit()
            
            # Broadcast real-time update
            await self._broadcast_update(submission_id, status, message, details)
            
            # Send webhook notification
            if submission and submission.webhook_url:
                await self._send_webhook_notification(submission, status, message, details)
            
        except Exception as e:
            db.rollback()
            logger.error(f"Error creating status update: {str(e)}")
            raise
        finally:
            db.close()
    
    async def _broadcast_update(self, submission_id: str, status: SubmissionStatus, 
                              message: str, details: Optional[Dict[str, Any]] = None):
        """Broadcast real-time update via Redis pub/sub"""
        update_data = {
            "submission_id": submission_id,
            "status": status.value,
            "message": message,
            "timestamp": datetime.utcnow().isoformat(),
            "details": details
        }
        
        # Publish to Redis channel for real-time updates
        redis_client.publish(f"status_updates:{submission_id}", json.dumps(update_data))
        redis_client.publish("status_updates:all", json.dumps(update_data))
    
    async def _send_webhook_notification(self, submission: CMSSubmission, status: SubmissionStatus,
                                       message: str, details: Optional[Dict[str, Any]] = None):
        """Send webhook notification to aggregator"""
        webhook_data = {
            "submission_id": submission.cms_submission_id,
            "batch_id": submission.batch_id,
            "aggregator_id": submission.aggregator_id,
            "status": status.value,
            "message": message,
            "timestamp": datetime.utcnow().isoformat(),
            "details": details
        }
        
        # Create HMAC signature for webhook security
        signature = hmac.new(
            b"webhook_secret_key",  # In production, use secure key management
            json.dumps(webhook_data).encode(),
            hashlib.sha256
        ).hexdigest()
        
        headers = {
            "Content-Type": "application/json",
            "X-NSA-IDR-Signature": f"sha256={signature}",
            "X-NSA-IDR-Event": "status_update"
        }
        
        async with aiohttp.ClientSession() as session:
            try:
                async with session.post(
                    submission.webhook_url,
                    json=webhook_data,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as response:
                    # Update webhook status
                    db = SessionLocal()
                    try:
                        status_update = db.query(StatusUpdate).filter(
                            StatusUpdate.submission_id == submission.cms_submission_id,
                            StatusUpdate.webhook_sent == False
                        ).first()
                        
                        if status_update:
                            status_update.webhook_sent = True
                            status_update.webhook_response = {
                                "status_code": response.status,
                                "response": await response.text()
                            }
                            db.commit()
                    finally:
                        db.close()
                        
            except Exception as e:
                logger.error(f"Webhook notification failed: {str(e)}")

# API Endpoints
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

cms_portal = CMSIDRPortal()
idr_integration = IDREntityIntegration()
status_manager = StatusUpdateManager()

@app.post("/api/v1/cms-idr/submit", response_model=CMSResponse)
async def submit_to_cms_idr(
    request: SubmissionRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Submit bulk NSA/IDR disputes to CMS IDR Portal"""
    try:
        # Create submission record
        submission = CMSSubmission(
            batch_id=request.batch_id,
            aggregator_id=request.aggregator_id,
            total_claims=len(request.claims_data),
            total_amount=sum(float(claim.get('dispute_amount', 0)) for claim in request.claims_data),
            webhook_url=request.webhook_url,
            status=SubmissionStatus.PENDING.value
        )
        db.add(submission)
        db.commit()
        db.refresh(submission)
        
        # Start background processing
        background_tasks.add_task(
            process_cms_submission,
            submission.id,
            request.claims_data,
            request.preferred_idr_entity
        )
        
        return CMSResponse(
            submission_id=str(submission.id),
            cms_confirmation_number=f"CMS-{submission.id}-{datetime.utcnow().strftime('%Y%m%d')}",
            status="accepted",
            message="Submission accepted for processing",
            next_steps=[
                "Validation in progress",
                "CMS IDR Portal submission pending",
                "IDR entity assignment pending"
            ]
        )
        
    except Exception as e:
        logger.error(f"Submission error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Submission failed: {str(e)}")

async def process_cms_submission(submission_id: int, claims_data: List[Dict[str, Any]], 
                               preferred_idr_entity: Optional[IDREntity] = None):
    """Background task to process CMS submission"""
    db = SessionLocal()
    try:
        submission = db.query(CMSSubmission).filter(CMSSubmission.id == submission_id).first()
        if not submission:
            return
        
        submission_id_str = str(submission.id)
        
        # Step 1: Validation
        await status_manager.create_status_update(
            submission_id_str,
            SubmissionStatus.VALIDATING,
            "Validating claim data against NSA requirements"
        )
        await asyncio.sleep(2)  # Simulate validation time
        
        # Step 2: CMS Submission
        await status_manager.create_status_update(
            submission_id_str,
            SubmissionStatus.SUBMITTING,
            "Submitting to CMS IDR Portal"
        )
        
        submission_data = {
            "batch_id": submission.batch_id,
            "aggregator_id": submission.aggregator_id,
            "claims": claims_data,
            "submission_date": datetime.utcnow().isoformat()
        }
        
        # Simulate CMS submission
        cms_response = await cms_portal.submit_bulk_disputes(submission_data)
        submission.cms_submission_id = cms_response.cms_confirmation_number
        db.commit()
        
        await status_manager.create_status_update(
            submission_id_str,
            SubmissionStatus.SUBMITTED,
            "Successfully submitted to CMS IDR Portal",
            {"cms_confirmation": cms_response.cms_confirmation_number}
        )
        
        # Step 3: IDR Entity Assignment
        idr_entity = preferred_idr_entity or await idr_integration.assign_idr_entity(submission_data)
        submission.idr_entity_assigned = idr_entity.value
        submission.decision_deadline = datetime.utcnow() + timedelta(days=30)
        db.commit()
        
        await status_manager.create_status_update(
            submission_id_str,
            SubmissionStatus.UNDER_REVIEW,
            f"Case assigned to {idr_entity.value} for review",
            {
                "idr_entity": idr_entity.value,
                "decision_deadline": submission.decision_deadline.isoformat()
            }
        )
        
        # Notify IDR entity
        idr_response = await idr_integration.notify_idr_entity(idr_entity, submission_data)
        
        await status_manager.create_status_update(
            submission_id_str,
            SubmissionStatus.DECISION_PENDING,
            "IDR entity reviewing case - decision pending",
            {"idr_response": idr_response}
        )
        
    except Exception as e:
        logger.error(f"Processing error: {str(e)}")
        await status_manager.create_status_update(
            submission_id_str,
            SubmissionStatus.REJECTED,
            f"Processing failed: {str(e)}"
        )
    finally:
        db.close()

@app.get("/api/v1/cms-idr/status/{submission_id}", response_model=List[StatusUpdateResponse])
async def get_submission_status(submission_id: str, db: Session = Depends(get_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get detailed status updates for a submission"""
    status_updates = db.query(StatusUpdate).filter(
        StatusUpdate.submission_id == submission_id
    ).order_by(StatusUpdate.timestamp.desc()).all()
    
    return [
        StatusUpdateResponse(
            submission_id=update.submission_id,
            status=SubmissionStatus(update.status),
            message=update.message,
            timestamp=update.timestamp,
            details=update.details
        )
        for update in status_updates
    ]

@app.get("/api/v1/cms-idr/submissions/{aggregator_id}")
async def get_aggregator_submissions(aggregator_id: str, db: Session = Depends(get_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get all submissions for a specific aggregator"""
    submissions = db.query(CMSSubmission).filter(
        CMSSubmission.aggregator_id == aggregator_id
    ).order_by(CMSSubmission.created_at.desc()).all()
    
    return submissions

@app.post("/api/v1/cms-idr/webhook/cms-update")
async def receive_cms_webhook(update_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Receive status updates from CMS IDR Portal"""
    submission_id = update_data.get('submission_id')
    status = update_data.get('status')
    message = update_data.get('message')
    details = update_data.get('details')
    
    if submission_id and status:
        await status_manager.create_status_update(
            submission_id,
            SubmissionStatus(status),
            message,
            details,
            source="CMS"
        )
    
    return {"status": "received"}

@app.post("/api/v1/cms-idr/webhook/idr-update")
async def receive_idr_webhook(update_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Receive status updates from IDR entities"""
    submission_id = update_data.get('submission_id')
    status = update_data.get('status')
    message = update_data.get('message')
    details = update_data.get('details')
    
    if submission_id and status:
        await status_manager.create_status_update(
            submission_id,
            SubmissionStatus(status),
            message,
            details,
            source="IDR_ENTITY"
        )
    
    return {"status": "received"}

# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "CMS IDR Integration Service",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8020)