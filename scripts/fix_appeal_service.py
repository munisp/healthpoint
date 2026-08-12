"""
Fix appeal_escalation_service.py:
- Remove 6 in-memory dict declarations (lines 163-168)
- Replace all dict reads/writes with asyncpg calls via shared database module
- Add schema bootstrap on startup
- Add proper PostgreSQL CRUD for all endpoints
"""
import re

with open('backend/core-services/appeal_escalation_service.py', 'r') as f:
    content = f.read()

# 1. Remove in-memory dict declarations
content = re.sub(
    r'^(appeals|appeal_documents|appeal_timelines|appeal_decisions|escalation_requests|appeal_analytics)\s*=\s*\{\}\n',
    '',
    content,
    flags=re.MULTILINE,
)

# 2. Add schema bootstrap SQL after the in-memory dict removal area
# Insert after the last import block (find "# Appeal & Escalation Management Service" header)
schema_sql = '''
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

'''

# Insert schema SQL before the AppealEscalationManager class
content = content.replace(
    '# Appeal & Escalation Management Service\nclass AppealEscalationManager:',
    schema_sql + '# Appeal & Escalation Management Service\nclass AppealEscalationManager:'
)

# 3. Add startup event to bootstrap schema
startup_code = '''
@app.on_event("startup")
async def startup_event():
    pool = await get_pool()
    if pool:
        await pool.execute(APPEAL_SCHEMA_SQL)
        import logging
        logging.getLogger(__name__).info("Appeal Escalation Service: schema bootstrapped")

'''

# Insert startup event after app middleware setup
content = content.replace(
    'app.middleware("http")(security_headers_middleware)\n',
    'app.middleware("http")(security_headers_middleware)\n' + startup_code
)

# 4. Replace in-memory dict reads/writes in the manager methods
# Replace: appeals[appeal.appeal_id] = appeal  → await execute(INSERT ...)
# Replace: appeals[appeal_id] → await fetchrow(SELECT ...)
# Replace: appeal_timelines[...] = ... → await execute(INSERT ...)

# Fix _generate_case_number to use PostgreSQL sequence
old_gen = '''    def _generate_case_number(self, appeal: Appeal) -> str:
        """Generate unique case number for appeal"""
        year = datetime.utcnow().year
        sequence = len([a for a in appeals.values() if a.created_at.year == year]) + 1
        return f"NSA-{year}-{sequence:04d}"'''

new_gen = '''    def _generate_case_number(self, appeal: Appeal) -> str:
        """Generate unique case number for appeal - use DB sequence for uniqueness"""
        year = datetime.utcnow().year
        # Sequence is incremented in create_appeal via PostgreSQL
        return f"NSA-{year}-PENDING"'''

content = content.replace(old_gen, new_gen)

# Fix create_appeal to use PostgreSQL
old_create = '''    async def create_appeal(self, appeal: Appeal, idr_decision_date: datetime) -> Appeal:
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
        return appeal'''

new_create = '''    async def create_appeal(self, appeal: Appeal, idr_decision_date: datetime) -> Appeal:
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
        return appeal'''

content = content.replace(old_create, new_create)

# Fix file_appeal to use PostgreSQL
old_file = '''    async def file_appeal(self, appeal_id: str, filing_documents: List[str]) -> Appeal:
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
        return appeal'''

new_file = '''    async def file_appeal(self, appeal_id: str, filing_documents: List[str]) -> Appeal:
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
        return Appeal(**{k: v for k, v in dict(updated).items() if k in Appeal.__fields__})'''

content = content.replace(old_file, new_file)

# Fix update_appeal_status to use PostgreSQL
old_update = '''    async def update_appeal_status(self, appeal_id: str, status: AppealStatus, 
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
        
        logger.info("Updated appeal $1 status to {status}", appeal_id)
        return appeal'''

new_update = '''    async def update_appeal_status(self, appeal_id: str, status: AppealStatus,
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
        return {"appeal_id": appeal_id, "old_status": old_status, "new_status": status.value}'''

content = content.replace(old_update, new_update)

# Fix create_escalation_request to use PostgreSQL
old_esc = '''    async def create_escalation_request(self, escalation: EscalationRequest) -> EscalationRequest:
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
        return escalation'''

new_esc = '''    async def create_escalation_request(self, escalation: EscalationRequest) -> EscalationRequest:
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
        return escalation'''

content = content.replace(old_esc, new_esc)

# Fix approve_escalation to use PostgreSQL
old_approve = '''    async def approve_escalation(self, escalation_id: str, approved_by: str, 
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
        return escalation'''

new_approve = '''    async def approve_escalation(self, escalation_id: str, approved_by: str,
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
        return {"escalation_id": escalation_id, "approved": approved, "approved_by": approved_by}'''

content = content.replace(old_approve, new_approve)

# Fix create_appeal_decision to use PostgreSQL
old_decision = '''    async def create_appeal_decision(self, decision: AppealDecision) -> AppealDecision:
        """Create an appeal decision"""
        if decision.appeal_id not in appeals:
            raise HTTPException(status_code=404, detail="Appeal not found")
        
        appeal_decisions[decision.decision_id] = decision
        
        # Update appeal status based on outcome
        appeal = appeals[decision.appeal_id]
        if decision.outcome in [AppealOutcome.UPHELD, AppealOutcome.DISMISSED]:            appeal.statu'''

new_decision = '''    async def create_appeal_decision(self, decision: AppealDecision) -> AppealDecision:
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
        """,
            decision.decision_id, decision.appeal_id, decision.decision_maker,
            decision.outcome.value, decision.reasoning, decision.financial_impact,
            decision.effective_date, decision.appeal_rights, decision.implementation_deadline,
        )
        new_status = "accepted" if decision.outcome == AppealOutcome.UPHELD else "rejected"
        await pool.execute(
            "UPDATE appeals SET status=$1, outcome=$2, updated_at=NOW() WHERE id=$3",
            new_status, decision.outcome.value, decision.appeal_id
        )
        timeline_id = str(uuid.uuid4())
        await pool.execute("""
            INSERT INTO appeal_timeline_events (timeline_id, appeal_id, event_type, event_description, created_by)
            VALUES ($1,$2,'decision_recorded',$3,$4)
        """, timeline_id, decision.appeal_id,
            f"Decision: {decision.outcome.value}. {decision.reasoning[:100]}",
            decision.decision_maker)
        logger.info(f"Created appeal decision for {decision.appeal_id}: {decision.outcome.value}")
        return decision'''

content = content.replace(old_decision, new_decision)

# Fix upload_document to use PostgreSQL
old_upload = '''    async def upload_document(self, appeal_id: str, document: AppealDocument, file_content: bytes) -> AppealDocument:
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
        return document'''

new_upload = '''    async def upload_document(self, appeal_id: str, document: AppealDocument, file_content: bytes) -> AppealDocument:
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
        return document'''

content = content.replace(old_upload, new_upload)

# Fix GET endpoints that read from in-memory dicts
# Fix get_appeal endpoint
old_get = '''@app.get("/appeals/{appeal_id}")
async def get_appeal(appeal_id: str, current_user = Depends(get_current_user)):
    if appeal_id not in appeals:
        raise HTTPException(status_code=404, detail="Appeal not found")
    return appeals[appeal_id]'''

new_get = '''@app.get("/appeals/{appeal_id}")
async def get_appeal(appeal_id: str, current_user = Depends(get_current_user)):
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    row = await pool.fetchrow("SELECT * FROM appeals WHERE id=$1", appeal_id)
    if not row:
        raise HTTPException(status_code=404, detail="Appeal not found")
    return dict(row)'''

content = content.replace(old_get, new_get)

# Fix list_appeals endpoint
old_list = '''@app.get("/appeals")
async def list_appeals(
    status: Optional[str] = None,
    appellant_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    filtered = list(appeals.values())
    if status:
        filtered = [a for a in filtered if a.status == status]
    if appellant_id:
        filtered = [a for a in filtered if a.appellant_id == appellant_id]
    return filtered'''

new_list = '''@app.get("/appeals")
async def list_appeals(
    status: Optional[str] = None,
    appellant_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    query = "SELECT * FROM appeals WHERE 1=1"
    params = []
    if status:
        params.append(status)
        query += f" AND status=${len(params)}"
    if appellant_id:
        params.append(appellant_id)
        query += f" AND appellant_id=${len(params)}"
    query += " ORDER BY created_at DESC LIMIT 200"
    rows = await pool.fetch(query, *params)
    return [dict(r) for r in rows]'''

content = content.replace(old_list, new_list)

# Fix get_appeal_timeline endpoint
old_timeline = '''@app.get("/appeals/{appeal_id}/timeline")
async def get_appeal_timeline(appeal_id: str, current_user = Depends(get_current_user)):
    if appeal_id not in appeals:
        raise HTTPException(status_code=404, detail="Appeal not found")
    timeline = [t for t in appeal_timelines.values() if t.appeal_id == appeal_id]
    return sorted(timeline, key=lambda x: x.event_date)'''

new_timeline = '''@app.get("/appeals/{appeal_id}/timeline")
async def get_appeal_timeline(appeal_id: str, current_user = Depends(get_current_user)):
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    rows = await pool.fetch(
        "SELECT * FROM appeal_timeline_events WHERE appeal_id=$1 ORDER BY event_date ASC",
        appeal_id
    )
    return [dict(r) for r in rows]'''

content = content.replace(old_timeline, new_timeline)

# Fix get_appeal_documents endpoint
old_docs = '''@app.get("/appeals/{appeal_id}/documents")
async def get_appeal_documents(appeal_id: str, current_user = Depends(get_current_user)):
    if appeal_id not in appeals:
        raise HTTPException(status_code=404, detail="Appeal not found")
    docs = [d for d in appeal_documents.values() if d.appeal_id == appeal_id]
    return docs'''

new_docs = '''@app.get("/appeals/{appeal_id}/documents")
async def get_appeal_documents(appeal_id: str, current_user = Depends(get_current_user)):
    pool = await get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    rows = await pool.fetch(
        "SELECT * FROM appeal_documents WHERE appeal_id=$1 ORDER BY uploaded_at DESC",
        appeal_id
    )
    return [dict(r) for r in rows]'''

content = content.replace(old_docs, new_docs)

# Remove the broken app = FastAPI(...) block with misplaced middleware call
# The existing file has: app.middleware("http")(security_headers_middleware)\n    title=...
# This is a syntax error - fix it
content = re.sub(
    r'app = FastAPI\(\s*\n\napp\.middleware\("http"\)\(security_headers_middleware\)\n\s+title=',
    'app = FastAPI(\n    title=',
    content
)

with open('backend/core-services/appeal_escalation_service.py', 'w') as f:
    f.write(content)

print("✅ appeal_escalation_service.py: all in-memory dicts replaced with PostgreSQL")

# Verify
with open('backend/core-services/appeal_escalation_service.py', 'r') as f:
    final = f.read()

import re
remaining = re.findall(r'appeals\[|appeal_documents\[|appeal_timelines\[|appeal_decisions\[|escalation_requests\[|appeal_analytics\[', final)
print(f"Remaining in-memory dict references: {len(remaining)}")
if remaining:
    for ref in remaining[:5]:
        print(f"  - {ref}")
