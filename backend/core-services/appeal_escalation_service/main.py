"""
Appeal & Escalation Management Service
Handles appeals and escalations of IDR decisions in the NSA/IDR ecosystem
Port: 8025
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

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import uuid
import json
import asyncio
from sqlalchemy import create_engine, Column, String, DateTime, Boolean, Integer, Text, Float
import logging
import requests
from cryptography.fernet import Fernet
from shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

setup_telemetry(service_name="appeal-escalation-service", service_version="1.0.0")
app = FastAPI(
instrument_fastapi(app)

app.middleware("http")(security_headers_middleware)
    title="Appeal & Escalation Management Service",
    description="Comprehensive appeal and escalation management for NSA/IDR dispute resolutions",
    version="1.0.0"
)

# Enums
class AppealStatus(str, Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    EXPIRED = "expired"

class AppealType(str, Enum):
    PROCEDURAL = "procedural"
    SUBSTANTIVE = "substantive"
    JURISDICTIONAL = "jurisdictional"
    BIAS_CONFLICT = "bias_conflict"
    EVIDENCE_EXCLUSION = "evidence_exclusion"
    CALCULATION_ERROR = "calculation_error"

class EscalationLevel(str, Enum):
    IDR_ENTITY = "idr_entity"
    CMS_REVIEW = "cms_review"
    FEDERAL_COURT = "federal_court"
    APPELLATE_COURT = "appellate_court"

class AppealOutcome(str, Enum):
    UPHELD = "upheld"
    REVERSED = "reversed"
    REMANDED = "remanded"
    MODIFIED = "modified"
    DISMISSED = "dismissed"

class DocumentType(str, Enum):
    APPEAL_BRIEF = "appeal_brief"
    SUPPORTING_EVIDENCE = "supporting_evidence"
    LEGAL_MEMORANDUM = "legal_memorandum"
    EXPERT_TESTIMONY = "expert_testimony"
    COURT_FILING = "court_filing"
    RESPONSE_BRIEF = "response_brief"

# Data Models
class Appeal(BaseModel):
    appeal_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    original_dispute_id: str
    idr_decision_id: str
    appellant_id: str  # Provider or Payer ID
    appellant_type: str  # "provider" or "payer"
    appeal_type: AppealType
    status: AppealStatus = AppealStatus.DRAFT
    grounds: List[str] = []
    description: str
    requested_relief: str
    filing_deadline: datetime
    filed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    escalation_level: EscalationLevel = EscalationLevel.IDR_ENTITY
    case_number: Optional[str] = None
    assigned_reviewer: Optional[str] = None
    estimated_resolution_date: Optional[datetime] = None

class AppealDocument(BaseModel):
    document_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    appeal_id: str
    document_type: DocumentType
    title: str
    file_path: str
    file_size: int
    mime_type: str
    uploaded_by: str
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)
    is_confidential: bool = False
    page_count: Optional[int] = None
    checksum: str

class AppealTimeline(BaseModel):
    timeline_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    appeal_id: str
    event_type: str
    event_description: str
    event_date: datetime = Field(default_factory=datetime.utcnow)
    created_by: str
    metadata: Dict[str, Any] = {}

class AppealDecision(BaseModel):
    decision_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    appeal_id: str
    decision_maker: str
    decision_date: datetime = Field(default_factory=datetime.utcnow)
    outcome: AppealOutcome
    reasoning: str
    financial_impact: Optional[float] = None
    effective_date: datetime
    appeal_rights: Optional[str] = None
    implementation_deadline: Optional[datetime] = None

class EscalationRequest(BaseModel):
    escalation_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    appeal_id: str
    from_level: EscalationLevel
    to_level: EscalationLevel
    requested_by: str
    requested_at: datetime = Field(default_factory=datetime.utcnow)
    justification: str
    approved: Optional[bool] = None
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None

class AppealAnalytics(BaseModel):
    analytics_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    appeal_id: str
    predicted_outcome: AppealOutcome
    confidence_score: float
    key_factors: List[str] = []
    similar_cases: List[str] = []
    estimated_duration_days: int
    cost_estimate: float
    success_probability: float

# In-memory storage (replace with database in production)
appeals = {}
appeal_documents = {}
appeal_timelines = {}
appeal_decisions = {}
escalation_requests = {}
appeal_analytics = {}

# Appeal & Escalation Management Service
class AppealEscalationManager:
    def __init__(self):
        self.encryption_key = Fernet.generate_key()
        self.cipher_suite = Fernet(self.encryption_key)
        self.federal_court_api = None  # Initialize with court system API
        self.cms_api = None  # Initialize with CMS API
        
    def _calculate_filing_deadline(self, idr_decision_date: datetime, appeal_type: AppealType) -> datetime:
        """Calculate appeal filing deadline based on regulations"""
        if appeal_type == AppealType.PROCEDURAL:
            return idr_decision_date + timedelta(days=30)
        elif appeal_type == AppealType.SUBSTANTIVE:
            return idr_decision_date + timedelta(days=30)
        else:
            return idr_decision_date + timedelta(days=30)  # Default 30 days
    
    def _generate_case_number(self, appeal: Appeal) -> str:
        """Generate unique case number for appeal"""
        year = datetime.utcnow().year
        sequence = len([a for a in appeals.values() if a.created_at.year == year]) + 1
        return f"NSA-{year}-{sequence:04d}"
    
    async def create_appeal(self, appeal: Appeal, idr_decision_date: datetime) -> Appeal:
        """Create a new appeal"""
        # Calculate filing deadline
        appeal.filing_deadline = self._calculate_filing_deadline(idr_decision_date, appeal.appeal_type)
        
        # Generate case number
        appeal.case_number = self._generate_case_number(appeal)
        
        appeals[appeal.appeal_id] = appeal
        
        # Create initial timeline entry
        timeline_entry = AppealTimeline(
            appeal_id=appeal.appeal_id,
            event_type="appeal_created",
            event_description="Appeal case created",
            created_by=appeal.appellant_id
        )
        appeal_timelines[timeline_entry.timeline_id] = timeline_entry
        
        # Generate predictive analytics
        analytics = await self._generate_appeal_analytics(appeal)
        appeal_analytics[analytics.analytics_id] = analytics
        
        logger.info(f"Created appeal: {appeal.appeal_id} with case number {appeal.case_number}")
        return appeal
    
    async def file_appeal(self, appeal_id: str, filing_documents: List[str]) -> Appeal:
        """File an appeal with required documents"""
        if appeal_id not in appeals:
            raise HTTPException(status_code=404, detail="Appeal not found")
        
        appeal = appeals[appeal_id]
        
        # Check filing deadline
        if datetime.utcnow() > appeal.filing_deadline:
            raise HTTPException(status_code=400, detail="Filing deadline has passed")
        
        # Validate required documents
        required_docs = [DocumentType.APPEAL_BRIEF]
        uploaded_doc_types = [doc.document_type for doc_id in filing_documents 
                             for doc in appeal_documents.values() 
                             if doc.document_id == doc_id and doc.appeal_id == appeal_id]
        
        missing_docs = [doc for doc in required_docs if doc not in uploaded_doc_types]
        if missing_docs:
            raise HTTPException(status_code=400, detail=f"Missing required documents: {missing_docs}")
        
        # File the appeal
        appeal.status = AppealStatus.SUBMITTED
        appeal.filed_at = datetime.utcnow()
        appeal.updated_at = datetime.utcnow()
        
        # Auto-assign reviewer based on appeal type and escalation level
        appeal.assigned_reviewer = await self._assign_reviewer(appeal)
        
        # Set estimated resolution date
        appeal.estimated_resolution_date = datetime.utcnow() + timedelta(days=60)  # Standard 60-day review
        
        # Create timeline entry
        timeline_entry = AppealTimeline(
            appeal_id=appeal_id,
            event_type="appeal_filed",
            event_description="Appeal formally filed with all required documents",
            created_by=appeal.appellant_id,
            metadata={"documents": filing_documents}
        )
        appeal_timelines[timeline_entry.timeline_id] = timeline_entry
        
        # Send notifications
        await self._send_filing_notifications(appeal)
        
        logger.info(f"Filed appeal: {appeal_id}")
        return appeal
    
    async def _assign_reviewer(self, appeal: Appeal) -> str:
        """Assign appropriate reviewer based on appeal characteristics"""
        if appeal.escalation_level == EscalationLevel.IDR_ENTITY:
            return "idr_review_panel"
        elif appeal.escalation_level == EscalationLevel.CMS_REVIEW:
            return "cms_appeals_board"
        elif appeal.escalation_level == EscalationLevel.FEDERAL_COURT:
            return "federal_district_court"
        else:
            return "appellate_court_panel"
    
    async def upload_document(self, appeal_id: str, document: AppealDocument, file_content: bytes) -> AppealDocument:
        """Upload a document for an appeal"""
        if appeal_id not in appeals:
            raise HTTPException(status_code=404, detail="Appeal not found")
        
        # Calculate checksum
        import hashlib
        document.checksum = hashlib.sha256(file_content).hexdigest()
        
        # Encrypt sensitive documents
        if document.is_confidential:
            encrypted_content = self.cipher_suite.encrypt(file_content)
            # Store encrypted content (implementation depends on storage system)
        
        appeal_documents[document.document_id] = document
        
        # Create timeline entry
        timeline_entry = AppealTimeline(
            appeal_id=appeal_id,
            event_type="document_uploaded",
            event_description=f"Document uploaded: {document.title}",
            created_by=document.uploaded_by,
            metadata={"document_type": document.document_type.value}
        )
        appeal_timelines[timeline_entry.timeline_id] = timeline_entry
        
        logger.info(f"Uploaded document {document.document_id} for appeal {appeal_id}")
        return document
    
    async def update_appeal_status(self, appeal_id: str, status: AppealStatus, 
                                 notes: Optional[str] = None) -> Appeal:
        """Update appeal status"""
        if appeal_id not in appeals:
            raise HTTPException(status_code=404, detail="Appeal not found")
        
        appeal = appeals[appeal_id]
        old_status = appeal.status
        appeal.status = status
        appeal.updated_at = datetime.utcnow()
        
        # Create timeline entry
        timeline_entry = AppealTimeline(
            appeal_id=appeal_id,
            event_type="status_updated",
            event_description=f"Status changed from {old_status} to {status}",
            created_by="system",
            metadata={"old_status": old_status.value, "new_status": status.value, "notes": notes}
        )
        appeal_timelines[timeline_entry.timeline_id] = timeline_entry
        
        # Send status update notifications
        await self._send_status_notifications(appeal, old_status, status)
        
        logger.info(f"Updated appeal {appeal_id} status to {status}")
        return appeal
    
    async def create_escalation_request(self, escalation: EscalationRequest) -> EscalationRequest:
        """Create an escalation request to higher authority"""
        if escalation.appeal_id not in appeals:
            raise HTTPException(status_code=404, detail="Appeal not found")
        
        escalation_requests[escalation.escalation_id] = escalation
        
        # Create timeline entry
        timeline_entry = AppealTimeline(
            appeal_id=escalation.appeal_id,
            event_type="escalation_requested",
            event_description=f"Escalation requested from {escalation.from_level} to {escalation.to_level}",
            created_by=escalation.requested_by,
            metadata={"escalation_id": escalation.escalation_id}
        )
        appeal_timelines[timeline_entry.timeline_id] = timeline_entry
        
        logger.info(f"Created escalation request: {escalation.escalation_id}")
        return escalation
    
    async def approve_escalation(self, escalation_id: str, approved_by: str, 
                               approved: bool = True) -> EscalationRequest:
        """Approve or reject an escalation request"""
        if escalation_id not in escalation_requests:
            raise HTTPException(status_code=404, detail="Escalation request not found")
        
        escalation = escalation_requests[escalation_id]
        escalation.approved = approved
        escalation.approved_by = approved_by
        escalation.approved_at = datetime.utcnow()
        
        if approved:
            # Update appeal escalation level
            appeal = appeals[escalation.appeal_id]
            appeal.escalation_level = escalation.to_level
            appeal.assigned_reviewer = await self._assign_reviewer(appeal)
            
            # Reset estimated resolution date for new level
            if escalation.to_level == EscalationLevel.FEDERAL_COURT:
                appeal.estimated_resolution_date = datetime.utcnow() + timedelta(days=180)
            elif escalation.to_level == EscalationLevel.APPELLATE_COURT:
                appeal.estimated_resolution_date = datetime.utcnow() + timedelta(days=365)
        
        # Create timeline entry
        timeline_entry = AppealTimeline(
            appeal_id=escalation.appeal_id,
            event_type="escalation_decision",
            event_description=f"Escalation {'approved' if approved else 'rejected'} by {approved_by}",
            created_by=approved_by
        )
        appeal_timelines[timeline_entry.timeline_id] = timeline_entry
        
        logger.info(f"{'Approved' if approved else 'Rejected'} escalation: {escalation_id}")
        return escalation
    
    async def create_appeal_decision(self, decision: AppealDecision) -> AppealDecision:
        """Create an appeal decision"""
        if decision.appeal_id not in appeals:
            raise HTTPException(status_code=404, detail="Appeal not found")
        
        appeal_decisions[decision.decision_id] = decision
        
        # Update appeal status based on outcome
        appeal = appeals[decision.appeal_id]
        if decision.outcome in [AppealOutcome.UPHELD, AppealOutcome.DISMISSED]:
            appeal.status = AppealStatus.REJECTED
        else:
            appeal.status = AppealStatus.ACCEPTED
        
        # Create timeline entry
        timeline_entry = AppealTimeline(
            appeal_id=decision.appeal_id,
            event_type="decision_issued",
            event_description=f"Appeal decision issued: {decision.outcome}",
            created_by=decision.decision_maker,
            metadata={"decision_id": decision.decision_id, "outcome": decision.outcome.value}
        )
        appeal_timelines[timeline_entry.timeline_id] = timeline_entry
        
        # Send decision notifications
        await self._send_decision_notifications(appeal, decision)
        
        logger.info(f"Created appeal decision: {decision.decision_id}")
        return decision
    
    async def _generate_appeal_analytics(self, appeal: Appeal) -> AppealAnalytics:
        """Generate predictive analytics for appeal"""
        # Simplified analytics - in production, use ML models
        similar_cases = await self._find_similar_cases(appeal)
        
        # Calculate success probability based on appeal type and grounds
        base_probability = 0.3  # Base 30% success rate
        if appeal.appeal_type == AppealType.PROCEDURAL:
            base_probability = 0.45
        elif appeal.appeal_type == AppealType.CALCULATION_ERROR:
            base_probability = 0.65
        
        # Adjust based on escalation level
        if appeal.escalation_level == EscalationLevel.FEDERAL_COURT:
            base_probability *= 0.8  # Lower success rate at federal level
        
        analytics = AppealAnalytics(
            appeal_id=appeal.appeal_id,
            predicted_outcome=AppealOutcome.UPHELD if base_probability < 0.5 else AppealOutcome.REVERSED,
            confidence_score=min(base_probability + 0.2, 0.9),
            key_factors=appeal.grounds,
            similar_cases=[case["case_id"] for case in similar_cases[:5]],
            estimated_duration_days=60 if appeal.escalation_level == EscalationLevel.IDR_ENTITY else 180,
            cost_estimate=5000.0 + (10000.0 * (appeal.escalation_level == EscalationLevel.FEDERAL_COURT)),
            success_probability=base_probability
        )
        
        return analytics
    
    async def _find_similar_cases(self, appeal: Appeal) -> List[Dict[str, Any]]:
        """Find similar appeal cases for analytics"""
        similar_cases = []
        
        for existing_appeal in appeals.values():
            if existing_appeal.appeal_id == appeal.appeal_id:
                continue
            
            similarity_score = 0
            
            # Same appeal type
            if existing_appeal.appeal_type == appeal.appeal_type:
                similarity_score += 0.4
            
            # Similar grounds
            common_grounds = set(existing_appeal.grounds) & set(appeal.grounds)
            if common_grounds:
                similarity_score += 0.3 * (len(common_grounds) / max(len(existing_appeal.grounds), len(appeal.grounds)))
            
            # Same escalation level
            if existing_appeal.escalation_level == appeal.escalation_level:
                similarity_score += 0.3
            
            if similarity_score > 0.5:
                similar_cases.append({
                    "case_id": existing_appeal.appeal_id,
                    "similarity_score": similarity_score,
                    "outcome": existing_appeal.status
                })
        
        return sorted(similar_cases, key=lambda x: x["similarity_score"], reverse=True)
    
    async def _send_filing_notifications(self, appeal: Appeal):
        """Send notifications when appeal is filed"""
        # Implementation would integrate with notification service
        logger.info(f"Sending filing notifications for appeal {appeal.appeal_id}")
    
    async def _send_status_notifications(self, appeal: Appeal, old_status: AppealStatus, new_status: AppealStatus):
        """Send notifications when appeal status changes"""
        # Implementation would integrate with notification service
        logger.info(f"Sending status notifications for appeal {appeal.appeal_id}: {old_status} -> {new_status}")
    
    async def _send_decision_notifications(self, appeal: Appeal, decision: AppealDecision):
        """Send notifications when appeal decision is issued"""
        # Implementation would integrate with notification service
        logger.info(f"Sending decision notifications for appeal {appeal.appeal_id}")
    
    async def get_appeal_statistics(self) -> Dict[str, Any]:
        """Get comprehensive appeal statistics"""
        total_appeals = len(appeals)
        
        # Status distribution
        status_counts = {}
        for status in AppealStatus:
            status_counts[status.value] = len([a for a in appeals.values() if a.status == status])
        
        # Outcome distribution
        outcome_counts = {}
        for outcome in AppealOutcome:
            outcome_counts[outcome.value] = len([d for d in appeal_decisions.values() if d.outcome == outcome])
        
        # Average resolution time
        resolved_appeals = [a for a in appeals.values() if a.status in [AppealStatus.ACCEPTED, AppealStatus.REJECTED]]
        avg_resolution_days = 0
        if resolved_appeals:
            total_days = sum((datetime.utcnow() - a.filed_at).days for a in resolved_appeals if a.filed_at)
            avg_resolution_days = total_days / len(resolved_appeals)
        
        return {
            "total_appeals": total_appeals,
            "status_distribution": status_counts,
            "outcome_distribution": outcome_counts,
            "average_resolution_days": avg_resolution_days,
            "escalation_rate": len(escalation_requests) / total_appeals if total_appeals > 0 else 0,
            "success_rate": outcome_counts.get("reversed", 0) / sum(outcome_counts.values()) if sum(outcome_counts.values()) > 0 else 0
        }

# Initialize service
appeal_manager = AppealEscalationManager()

# API Endpoints
@app.post("/appeals", response_model=Appeal)
async def create_appeal(appeal: Appeal, idr_decision_date: datetime,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create a new appeal"""
    return await appeal_manager.create_appeal(appeal, idr_decision_date)

@app.get("/appeals", response_model=List[Appeal])
async def get_appeals(status: Optional[AppealStatus] = None, appellant_id: Optional[str] = None,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get appeals with optional filtering"""
    filtered_appeals = list(appeals.values())
    
    if status:
        filtered_appeals = [a for a in filtered_appeals if a.status == status]
    if appellant_id:
        filtered_appeals = [a for a in filtered_appeals if a.appellant_id == appellant_id]
    
    return filtered_appeals

@app.get("/appeals/{appeal_id}", response_model=Appeal)
async def get_appeal(appeal_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get a specific appeal"""
    if appeal_id not in appeals:
        raise HTTPException(status_code=404, detail="Appeal not found")
    return appeals[appeal_id]

@app.put("/appeals/{appeal_id}/file")
async def file_appeal(appeal_id: str, filing_documents: List[str],
    current_user: TokenPayload = Depends(get_current_user),
):
    """File an appeal with required documents"""
    return await appeal_manager.file_appeal(appeal_id, filing_documents)

@app.post("/appeals/{appeal_id}/documents", response_model=AppealDocument)
async def upload_document(appeal_id: str, document: AppealDocument, file: UploadFile = File(...),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Upload a document for an appeal"""
    file_content = await file.read()
    document.file_size = len(file_content)
    document.mime_type = file.content_type
    return await appeal_manager.upload_document(appeal_id, document, file_content)

@app.get("/appeals/{appeal_id}/documents", response_model=List[AppealDocument])
async def get_appeal_documents(appeal_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get all documents for an appeal"""
    return [d for d in appeal_documents.values() if d.appeal_id == appeal_id]

@app.put("/appeals/{appeal_id}/status")
async def update_appeal_status(appeal_id: str, status: AppealStatus, notes: Optional[str] = None,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Update appeal status"""
    return await appeal_manager.update_appeal_status(appeal_id, status, notes)

@app.get("/appeals/{appeal_id}/timeline", response_model=List[AppealTimeline])
async def get_appeal_timeline(appeal_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get timeline for an appeal"""
    return sorted([t for t in appeal_timelines.values() if t.appeal_id == appeal_id], 
                 key=lambda x: x.event_date)

@app.post("/escalations", response_model=EscalationRequest)
async def create_escalation_request(escalation: EscalationRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create an escalation request"""
    return await appeal_manager.create_escalation_request(escalation)

@app.put("/escalations/{escalation_id}/approve")
async def approve_escalation(escalation_id: str, approved_by: str, approved: bool = True,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Approve or reject an escalation request"""
    return await appeal_manager.approve_escalation(escalation_id, approved_by, approved)

@app.post("/appeals/{appeal_id}/decisions", response_model=AppealDecision)
async def create_appeal_decision(appeal_id: str, decision: AppealDecision,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create an appeal decision"""
    decision.appeal_id = appeal_id
    return await appeal_manager.create_appeal_decision(decision)

@app.get("/appeals/{appeal_id}/analytics", response_model=AppealAnalytics)
async def get_appeal_analytics(appeal_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get predictive analytics for an appeal"""
    analytics = next((a for a in appeal_analytics.values() if a.appeal_id == appeal_id), None)
    if not analytics:
        raise HTTPException(status_code=404, detail="Analytics not found")
    return analytics

@app.get("/analytics/appeals")
async def get_appeal_statistics(,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get comprehensive appeal statistics"""
    return await appeal_manager.get_appeal_statistics()

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Appeal & Escalation Management Service",
        "version": "1.0.0",
        "timestamp": datetime.utcnow().isoformat()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8025)