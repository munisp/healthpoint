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

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Appeal & Escalation Management Service",
    description="Comprehensive appeal and escalation management for NSA/IDR dispute resolutions",
    version="1.0.0"
)

app.middleware("http")(security_headers_middleware)

@app.on_event("startup")
async def startup_event():
    pool = await get_pool()
    if pool:
        await pool.execute(APPEAL_SCHEMA_SQL)
        import logging
        logging.getLogger(__name__).info("Appeal Escalation Service: schema bootstrapped")

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


# ─── PostgreSQL Schema ────────────────────────────────────────────────────────
APPEAL_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS appeals (
    id VARCHAR(64) PRIMARY KEY,
    original_dispute_id VARCHAR(128) NOT NULL,
    idr_decision_id VARCHAR(128) NOT NULL,
    tenant_id VARCHAR(128),
    case_number VARCHAR(64) UNIQUE,
    appeal_type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    appellant_id VARCHAR(128) NOT NULL,
    appellant_type VARCHAR(32) NOT NULL,
    grounds TEXT,
    description TEXT,
    requested_relief TEXT,
    filing_deadline TIMESTAMPTZ,
    filed_at TIMESTAMPTZ,
    escalation_level VARCHAR(32) DEFAULT 'idr_entity',
    assigned_reviewer VARCHAR(128),
    estimated_resolution_date TIMESTAMPTZ,
    outcome VARCHAR(32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS appeal_documents (
    document_id VARCHAR(64) PRIMARY KEY,
    appeal_id VARCHAR(64) NOT NULL REFERENCES appeals(id) ON DELETE CASCADE,
    document_type VARCHAR(64) NOT NULL,
    title VARCHAR(255),
    file_path TEXT,
    file_size BIGINT,
    mime_type VARCHAR(128),
    uploaded_by VARCHAR(128),
    is_confidential BOOLEAN DEFAULT FALSE,
    page_count INT,
    checksum VARCHAR(128),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS appeal_timeline_events (
    timeline_id VARCHAR(64) PRIMARY KEY,
    appeal_id VARCHAR(64) NOT NULL REFERENCES appeals(id) ON DELETE CASCADE,
    event_type VARCHAR(64) NOT NULL,
    event_description TEXT,
    event_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by VARCHAR(128),
    metadata_json JSONB
);
CREATE TABLE IF NOT EXISTS appeal_decisions (
    decision_id VARCHAR(64) PRIMARY KEY,
    appeal_id VARCHAR(64) NOT NULL REFERENCES appeals(id) ON DELETE CASCADE,
    decision_maker VARCHAR(128),
    decision_date TIMESTAMPTZ,
    outcome VARCHAR(32),
    reasoning TEXT,
    financial_impact DECIMAL(15,2),
    effective_date TIMESTAMPTZ,
    appeal_rights TEXT,
    implementation_deadline TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS escalation_requests (
    escalation_id VARCHAR(64) PRIMARY KEY,
    appeal_id VARCHAR(64) NOT NULL REFERENCES appeals(id) ON DELETE CASCADE,
    from_level VARCHAR(32),
    to_level VARCHAR(32),
    requested_by VARCHAR(128),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    justification TEXT,
    approved BOOLEAN,
    approved_by VARCHAR(128),
    approved_at TIMESTAMPTZ
);
CREATE SEQUENCE IF NOT EXISTS appeal_case_number_seq START 1000;
"""
# ─────────────────────────────────────────────────────────────────────────────

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
        """Generate unique case number for appeal - use DB sequence for uniqueness"""
        year = datetime.utcnow().year
        # Sequence is incremented in create_appeal via PostgreSQL
        return f"NSA-{year}-PENDING"
    
    async def create_appeal(self, appeal: Appeal, idr_decision_date: datetime) -> Appeal:
        """Create a new appeal — persisted to PostgreSQL"""
        appeal.filing_deadline = self._calculate_filing_deadline(idr_decision_date, appeal.appeal_type)
        pool = await get_pool()
        if not pool:
            raise HTTPException(503, "Database unavailable")
        seq_val = await pool.fetchval("SELECT nextval('appeal_case_number_seq')")
        year = datetime.utcnow().year
        appeal.case_number = f"NSA-{year}-{seq_val:06d}"
        await pool.execute("""
            INSERT INTO appeals (id, original_dispute_id, idr_decision_id, case_number,
                appeal_type, status, appellant_id, appellant_type, grounds, description,
                requested_relief, filing_deadline, escalation_level, created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
            ON CONFLICT (id) DO NOTHING
        """,
            appeal.appeal_id, appeal.original_dispute_id, appeal.idr_decision_id,
            appeal.case_number, appeal.appeal_type.value, appeal.status.value,
            appeal.appellant_id, appeal.appellant_type,
            json.dumps(appeal.grounds) if isinstance(appeal.grounds, list) else appeal.grounds,
            appeal.description, appeal.requested_relief, appeal.filing_deadline,
            appeal.escalation_level.value,
        )
        timeline_id = str(uuid.uuid4())
        await pool.execute("""
            INSERT INTO appeal_timeline_events (timeline_id, appeal_id, event_type, event_description, created_by)
            VALUES ($1,$2,'appeal_created','Appeal case created',$3)
        """, timeline_id, appeal.appeal_id, appeal.appellant_id)
        logger.info(f"Created appeal: {appeal.appeal_id} with case number {appeal.case_number}")
        return appeal
    
    async def file_appeal(self, appeal_id: str, filing_documents: List[str]) -> Appeal:
        """File an appeal with required documents — persisted to PostgreSQL"""
        pool = await get_pool()
        if not pool:
            raise HTTPException(503, "Database unavailable")
        row = await pool.fetchrow("SELECT * FROM appeals WHERE id=$1", appeal_id)
        if not row:
            raise HTTPException(status_code=404, detail="Appeal not found")
        from datetime import timezone
        if datetime.utcnow().replace(tzinfo=timezone.utc) > row["filing_deadline"]:
            raise HTTPException(status_code=400, detail="Filing deadline has passed")
        doc_count = await pool.fetchval(
            "SELECT COUNT(*) FROM appeal_documents WHERE appeal_id=$1 AND document_type='appeal_brief'",
            appeal_id
        )
        if doc_count == 0:
            raise HTTPException(status_code=400, detail="Missing required document: appeal_brief")
        reviewer = "idr_review_panel" if row["escalation_level"] == "idr_entity" else "cms_appeals_board"
        est_date = datetime.utcnow() + timedelta(days=60)
        await pool.execute("""
            UPDATE appeals SET status='submitted', filed_at=NOW(), assigned_reviewer=$1,
                estimated_resolution_date=$2, updated_at=NOW()
            WHERE id=$3
        """, reviewer, est_date, appeal_id)
        timeline_id = str(uuid.uuid4())
        await pool.execute("""
            INSERT INTO appeal_timeline_events (timeline_id, appeal_id, event_type, event_description, created_by, metadata_json)
            VALUES ($1,$2,'appeal_filed','Appeal formally filed with all required documents',$3,$4)
        """, timeline_id, appeal_id, row["appellant_id"], json.dumps({"documents": filing_documents}))
        logger.info(f"Filed appeal: {appeal_id}")
        # Return updated appeal as dict-based object
        updated = await pool.fetchrow("SELECT * FROM appeals WHERE id=$1", appeal_id)
        return Appeal(**{k: v for k, v in dict(updated).items() if k in Appeal.__fields__})
    
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
        """Upload a document for an appeal — persisted to PostgreSQL"""
        pool = await get_pool()
        if not pool:
            raise HTTPException(503, "Database unavailable")
        exists = await pool.fetchval("SELECT id FROM appeals WHERE id=$1", appeal_id)
        if not exists:
            raise HTTPException(status_code=404, detail="Appeal not found")
        import hashlib
        document.checksum = hashlib.sha256(file_content).hexdigest()
        await pool.execute("""
            INSERT INTO appeal_documents
                (document_id, appeal_id, document_type, title, file_path, file_size,
                 mime_type, uploaded_by, is_confidential, page_count, checksum)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        """,
            document.document_id, appeal_id, document.document_type.value, document.title,
            document.file_path, document.file_size, document.mime_type, document.uploaded_by,
            document.is_confidential, document.page_count, document.checksum,
        )
        timeline_id = str(uuid.uuid4())
        await pool.execute("""
            INSERT INTO appeal_timeline_events (timeline_id, appeal_id, event_type, event_description, created_by, metadata_json)
            VALUES ($1,$2,'document_uploaded',$3,$4,$5)
        """, timeline_id, appeal_id,
            f"Document uploaded: {document.title}", document.uploaded_by,
            json.dumps({"document_type": document.document_type.value}))
        logger.info(f"Uploaded document {document.document_id} for appeal {appeal_id}")
        return document
    
    async def update_appeal_status(self, appeal_id: str, status: AppealStatus,
                                 notes: Optional[str] = None) -> dict:
        """Update appeal status — persisted to PostgreSQL"""
        pool = await get_pool()
        if not pool:
            raise HTTPException(503, "Database unavailable")
        row = await pool.fetchrow("SELECT status FROM appeals WHERE id=$1", appeal_id)
        if not row:
            raise HTTPException(status_code=404, detail="Appeal not found")
        old_status = row["status"]
        await pool.execute(
            "UPDATE appeals SET status=$1, updated_at=NOW() WHERE id=$2",
            status.value, appeal_id
        )
        timeline_id = str(uuid.uuid4())
        await pool.execute("""
            INSERT INTO appeal_timeline_events (timeline_id, appeal_id, event_type, event_description, created_by, metadata_json)
            VALUES ($1,$2,'status_updated',$3,'system',$4)
        """, timeline_id, appeal_id,
            f"Status changed from {old_status} to {status.value}",
            json.dumps({"old_status": old_status, "new_status": status.value, "notes": notes}))
        logger.info(f"Updated appeal {appeal_id} status to {status.value}")
        return {"appeal_id": appeal_id, "old_status": old_status, "new_status": status.value}
    
    async def create_escalation_request(self, escalation: EscalationRequest) -> EscalationRequest:
        """Create an escalation request to higher authority — persisted to PostgreSQL"""
        pool = await get_pool()
        if not pool:
            raise HTTPException(503, "Database unavailable")
        exists = await pool.fetchval("SELECT id FROM appeals WHERE id=$1", escalation.appeal_id)
        if not exists:
            raise HTTPException(status_code=404, detail="Appeal not found")
        await pool.execute("""
            INSERT INTO escalation_requests
                (escalation_id, appeal_id, from_level, to_level, requested_by, requested_at, justification)
            VALUES ($1,$2,$3,$4,$5,NOW(),$6)
        """,
            escalation.escalation_id, escalation.appeal_id,
            escalation.from_level.value, escalation.to_level.value,
            escalation.requested_by, escalation.justification,
        )
        timeline_id = str(uuid.uuid4())
        await pool.execute("""
            INSERT INTO appeal_timeline_events (timeline_id, appeal_id, event_type, event_description, created_by, metadata_json)
            VALUES ($1,$2,'escalation_requested',$3,$4,$5)
        """, timeline_id, escalation.appeal_id,
            f"Escalation requested from {escalation.from_level.value} to {escalation.to_level.value}",
            escalation.requested_by,
            json.dumps({"escalation_id": escalation.escalation_id}))
        logger.info(f"Created escalation request: {escalation.escalation_id}")
        return escalation
    
    async def approve_escalation(self, escalation_id: str, approved_by: str,
                               approved: bool = True) -> dict:
        """Approve or reject an escalation request — persisted to PostgreSQL"""
        pool = await get_pool()
        if not pool:
            raise HTTPException(503, "Database unavailable")
        esc_row = await pool.fetchrow("SELECT * FROM escalation_requests WHERE escalation_id=$1", escalation_id)
        if not esc_row:
            raise HTTPException(status_code=404, detail="Escalation request not found")
        await pool.execute("""
            UPDATE escalation_requests SET approved=$1, approved_by=$2, approved_at=NOW()
            WHERE escalation_id=$3
        """, approved, approved_by, escalation_id)
        if approved:
            to_level = esc_row["to_level"]
            days_map = {"federal_court": 180, "appellate_court": 365}
            est_days = days_map.get(to_level, 60)
            est_date = datetime.utcnow() + timedelta(days=est_days)
            await pool.execute("""
                UPDATE appeals SET escalation_level=$1, estimated_resolution_date=$2, updated_at=NOW()
                WHERE id=$3
            """, to_level, est_date, esc_row["appeal_id"])
        timeline_id = str(uuid.uuid4())
        await pool.execute("""
            INSERT INTO appeal_timeline_events (timeline_id, appeal_id, event_type, event_description, created_by)
            VALUES ($1,$2,'escalation_decision',$3,$4)
        """, timeline_id, esc_row["appeal_id"],
            f"Escalation {'approved' if approved else 'rejected'} by {approved_by}", approved_by)
        logger.info(f"{'Approved' if approved else 'Rejected'} escalation: {escalation_id}")
        return {"escalation_id": escalation_id, "approved": approved, "approved_by": approved_by}
    
    async def create_appeal_decision(self, decision: AppealDecision) -> AppealDecision:
        """Create an appeal decision — persisted to PostgreSQL"""
        pool = await get_pool()
        if not pool:
            raise HTTPException(503, "Database unavailable")
        exists = await pool.fetchval("SELECT id FROM appeals WHERE id=$1", decision.appeal_id)
        if not exists:
            raise HTTPException(status_code=404, detail="Appeal not found")
        await pool.execute("""
            INSERT INTO appeal_decisions
                (decision_id, appeal_id, decision_maker, decision_date, outcome, reasoning,
                 financial_impact, effective_date, appeal_rights, implementation_deadline)
            VALUES ($1,$2,$3,NOW(),$4,$5,$6,$7,$8,$9)
            ON CONFLICT (decision_id) DO NOTHING
        """,
            decision.decision_id, decision.appeal_id, decision.decision_maker,
            decision.outcome.value, decision.reasoning, decision.financial_impact,
            decision.effective_date, decision.appeal_rights, decision.implementation_deadline,
        )
        new_status = "rejected" if decision.outcome in [AppealOutcome.UPHELD, AppealOutcome.DISMISSED] else "accepted"
        await pool.execute(
            "UPDATE appeals SET status=$1, outcome=$2, updated_at=NOW() WHERE id=$3",
            new_status, decision.outcome.value, decision.appeal_id
        )
        timeline_id = str(uuid.uuid4())
        await pool.execute("""
            INSERT INTO appeal_timeline_events (timeline_id, appeal_id, event_type, event_description, created_by, metadata_json)
            VALUES ($1,$2,'decision_issued',$3,$4,$5)
        """, timeline_id, decision.appeal_id,
            f"Appeal decision issued: {decision.outcome.value}",
            decision.decision_maker,
            json.dumps({"decision_id": decision.decision_id, "outcome": decision.outcome.value}))
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

@app.get("/appeals/{appeal_id}")
async def get_appeal(appeal_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get a specific appeal — from PostgreSQL"""
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    row = await pool.fetchrow("SELECT * FROM appeals WHERE id=$1", appeal_id)
    if not row:
        raise HTTPException(status_code=404, detail="Appeal not found")
    return dict(row)

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
async def get_appeal_statistics(
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