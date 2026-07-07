"""
HealthPoint CMS IDR Portal Automation Service - Production Implementation

Per 45 CFR §149.510 (NSA IDR process), 45 CFR §149.520 (Open negotiation),
and CMS IDR Portal API specification (idr.cms.gov).

Key improvements over previous version:
- All 45 CFR §149.510(b) required fields validated before submission
- Exponential backoff retry with jitter (max 5 retries)
- No mock/synthetic QPA fallback - requires real CMS API key
- Batch dispute support with air-ambulance batching rules enforced
- Supporting document S3 upload with presigned URLs
- Pre-submission validation: deadline enforcement, QPA presence, party eligibility
- Full event history persisted to PostgreSQL
- Withdrawal endpoint
"""
import asyncio, json, logging, os, random, re, uuid
from datetime import datetime, date, timedelta, timezone
from decimal import Decimal
from enum import Enum
from typing import Any, Dict, List, Optional

import asyncpg
import httpx
import redis.asyncio as aioredis
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field, root_validator, validator

from backend.shared.auth import get_current_user, require_role, TokenPayload
from backend.shared.database import get_pool
from backend.shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
CMS_API_BASE = os.getenv("CMS_IDR_API_BASE", "https://idr.cms.gov/api/v1")
CMS_API_KEY = os.getenv("CMS_IDR_API_KEY", "")
CMS_TIMEOUT = int(os.getenv("CMS_TIMEOUT_SECONDS", "30"))
S3_BUCKET = os.getenv("CMS_DOCUMENTS_S3_BUCKET", "healthpoint-cms-documents")

MAX_BATCH_ITEMS = 25
MAX_RETRY_ATTEMPTS = 5
BASE_RETRY_DELAY = 2.0

VALID_PLAN_TYPES = {
    "group_health_plan", "individual_health_insurance_coverage",
    "federal_employee_health_benefit_plan",
    "grandfathered_group_health_plan",
    "grandfathered_individual_health_insurance_coverage",
}
VALID_DISPUTE_REASONS = {
    "amount_exceeds_qpa", "no_qpa_provided", "qpa_calculation_error",
    "air_ambulance_services", "emergency_services",
    "non_emergency_services_at_participating_facility",
}
VALID_PARTY_TYPES = {"provider", "facility", "air_ambulance_provider", "plan_or_issuer"}

setup_telemetry(service_name="cms-portal-automation-service", service_version="2.0.0")
app = FastAPI(title="HealthPoint CMS Portal Automation Service", version="2.0.0")
instrument_fastapi(app)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True, allow_methods=["GET","POST","PUT","PATCH"], allow_headers=["*"],
)

class CMSSubmissionStatus(str, Enum):
    PENDING = "pending"; SUBMITTED = "submitted"; ACCEPTED = "accepted"
    REJECTED = "rejected"; PROCESSING = "processing"; COMPLETED = "completed"
    FAILED = "failed"; RETRYING = "retrying"; WITHDRAWN = "withdrawn"

class PartyDetails(BaseModel):
    party_type: str; name: str = Field(..., min_length=2, max_length=255)
    npi: Optional[str] = None; tin: Optional[str] = None
    address_line1: Optional[str] = None; address_line2: Optional[str] = None
    city: Optional[str] = None; state: Optional[str] = None; zip_code: Optional[str] = None
    contact_name: Optional[str] = None; contact_email: Optional[str] = None
    contact_phone: Optional[str] = None

    @validator("party_type")
    def validate_party_type(cls, v):
        if v not in VALID_PARTY_TYPES:
            raise ValueError(f"party_type must be one of: {', '.join(VALID_PARTY_TYPES)}")
        return v

    @validator("npi")
    def validate_npi(cls, v):
        if v and (not v.isdigit() or len(v) != 10):
            raise ValueError("NPI must be exactly 10 digits")
        return v

    @validator("tin")
    def validate_tin(cls, v):
        if v and not re.match(r"^\d{2}-\d{7}$", v):
            raise ValueError("TIN must be XX-XXXXXXX format")
        return v

class ServiceItem(BaseModel):
    claim_number: str = Field(..., min_length=1, max_length=128)
    service_code: str
    service_description: Optional[str] = None
    date_of_service: str
    place_of_service: Optional[str] = None
    billed_amount: Decimal = Field(..., gt=0)
    qpa_amount: Decimal = Field(..., gt=0)
    plan_payment_amount: Decimal = Field(..., ge=0)
    disputed_amount: Decimal = Field(..., gt=0)
    service_type: str = "emergency"
    diagnosis_codes: List[str] = Field(default_factory=list)
    modifier_codes: List[str] = Field(default_factory=list)

    @validator("date_of_service")
    def validate_dos(cls, v):
        try:
            dt = datetime.strptime(v, "%Y-%m-%d")
            if dt.date() > date.today():
                raise ValueError("Date of service cannot be in the future")
            if dt.date() < date(2022, 1, 1):
                raise ValueError("NSA IDR applies only to services on or after January 1, 2022")
        except ValueError as e:
            raise ValueError(f"Invalid date_of_service: {e}")
        return v

    @validator("service_code")
    def validate_code(cls, v):
        if not re.match(r"^[A-Z0-9]{5}$", v.upper()):
            raise ValueError(f"Invalid service code: {v}. Must be 5-character CPT/HCPCS.")
        return v.upper()

class DisputeInitiationRequest(BaseModel):
    dispute_id: str; tenant_id: str
    initiating_party: PartyDetails; responding_party: PartyDetails
    patient_date_of_birth: str; patient_state: str = Field(..., min_length=2, max_length=2)
    patient_member_id: Optional[str] = None
    plan_type: str; plan_name: Optional[str] = None; plan_year: Optional[int] = None
    service_items: List[ServiceItem] = Field(..., min_items=1, max_items=MAX_BATCH_ITEMS)
    dispute_reason: str; dispute_reason_detail: Optional[str] = None
    open_negotiation_start_date: str; open_negotiation_end_date: str
    supporting_document_s3_keys: List[str] = Field(default_factory=list)
    certifying_official_name: str = Field(..., min_length=2, max_length=255)
    certifying_official_title: str = Field(..., min_length=2, max_length=255)
    certification_date: str
    idempotency_key: Optional[str] = None

    @validator("plan_type")
    def validate_plan_type(cls, v):
        if v not in VALID_PLAN_TYPES:
            raise ValueError(f"plan_type must be one of: {', '.join(VALID_PLAN_TYPES)}")
        return v

    @validator("dispute_reason")
    def validate_reason(cls, v):
        if v not in VALID_DISPUTE_REASONS:
            raise ValueError(f"dispute_reason must be one of: {', '.join(VALID_DISPUTE_REASONS)}")
        return v

    @validator("patient_date_of_birth", "open_negotiation_start_date",
               "open_negotiation_end_date", "certification_date")
    def validate_dates(cls, v):
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError(f"Date must be YYYY-MM-DD, got: {v}")
        return v

    @root_validator
    def validate_negotiation_window(cls, values):
        end = values.get("open_negotiation_end_date")
        start = values.get("open_negotiation_start_date")
        if start and end:
            end_dt = datetime.strptime(end, "%Y-%m-%d").date()
            start_dt = datetime.strptime(start, "%Y-%m-%d").date()
            if end_dt <= start_dt:
                raise ValueError("open_negotiation_end_date must be after open_negotiation_start_date")
            # 4 business days ≈ 6 calendar days
            idr_deadline = end_dt + timedelta(days=6)
            if date.today() > idr_deadline:
                raise ValueError(
                    f"IDR initiation window expired. Open negotiation ended {end_dt}. "
                    f"IDR must be initiated within 4 business days (approx {idr_deadline}). "
                    f"Today is {date.today()}."
                )
        return values

    @root_validator
    def validate_air_ambulance_batching(cls, values):
        items = values.get("service_items", [])
        has_air = any(i.service_type == "air_ambulance" for i in items)
        has_other = any(i.service_type != "air_ambulance" for i in items)
        if has_air and has_other:
            raise ValueError(
                "Air ambulance services cannot be batched with non-air-ambulance services per CMS rules."
            )
        return values

class CMSSubmissionResponse(BaseModel):
    submission_id: str; cms_reference_number: Optional[str] = None
    status: CMSSubmissionStatus; submitted_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None; message: str
    retry_count: int = 0; next_retry_at: Optional[datetime] = None
    validation_warnings: List[str] = Field(default_factory=list)

class QPALookupRequest(BaseModel):
    service_code: str; geographic_area: str; plan_type: str = "group_health_plan"
    date_of_service: str; specialty_code: Optional[str] = None
    place_of_service: Optional[str] = None

class QPALookupResponse(BaseModel):
    service_code: str; geographic_area: str; qpa: float
    median_contracted_rate: float; percentile_25: float; percentile_75: float
    data_year: int; source: str; calculated_at: datetime

class DocumentUploadRequest(BaseModel):
    dispute_id: str; document_type: str; file_name: str = Field(..., max_length=255)
    content_type: str; file_size_bytes: int = Field(..., gt=0, le=52_428_800)

CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS cms_submissions (
    id VARCHAR(128) PRIMARY KEY, dispute_id VARCHAR(128) NOT NULL,
    tenant_id VARCHAR(128) NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'pending',
    cms_reference_number VARCHAR(128), payload JSONB NOT NULL,
    validation_warnings JSONB DEFAULT '[]',
    retry_count INT NOT NULL DEFAULT 0, next_retry_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ, accepted_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ, rejection_reason TEXT,
    completed_at TIMESTAMPTZ, withdrawn_at TIMESTAMPTZ,
    idempotency_key VARCHAR(128) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cms_sub_dispute ON cms_submissions(dispute_id);
CREATE INDEX IF NOT EXISTS idx_cms_sub_tenant ON cms_submissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cms_sub_status ON cms_submissions(status);
CREATE INDEX IF NOT EXISTS idx_cms_sub_ref ON cms_submissions(cms_reference_number);

CREATE TABLE IF NOT EXISTS cms_documents (
    id VARCHAR(128) PRIMARY KEY, submission_id VARCHAR(128),
    dispute_id VARCHAR(128) NOT NULL, tenant_id VARCHAR(128) NOT NULL,
    document_type VARCHAR(64) NOT NULL, file_name VARCHAR(255) NOT NULL,
    s3_key VARCHAR(512) NOT NULL, content_type VARCHAR(128) NOT NULL,
    file_size_bytes BIGINT, cms_document_id VARCHAR(128),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), cms_attached_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cms_docs_dispute ON cms_documents(dispute_id);

CREATE TABLE IF NOT EXISTS cms_submission_events (
    id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    submission_id VARCHAR(128) NOT NULL, event_type VARCHAR(64) NOT NULL,
    old_status VARCHAR(32), new_status VARCHAR(32),
    cms_response JSONB, error_message TEXT, actor_id VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cms_events_sub ON cms_submission_events(submission_id);
"""

_pool: Optional[asyncpg.Pool] = None
_redis: Optional[aioredis.Redis] = None

async def get_db():
    global _pool
    if _pool is None and DATABASE_URL:
        try:
            _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
        except Exception as e:
            logger.error(f"DB pool failed: {e}")
    return _pool

async def get_redis_client():
    global _redis
    if _redis is None:
        try:
            _redis = await aioredis.from_url(REDIS_URL, decode_responses=True)
        except Exception as e:
            logger.warning(f"Redis failed: {e}")
    return _redis

def _cms_headers():
    return {
        "Authorization": f"Bearer {CMS_API_KEY}",
        "Content-Type": "application/json",
        "X-API-Version": "2.0",
        "Accept": "application/json",
        "X-Request-ID": str(uuid.uuid4()),
    }

async def _log_event(pool, submission_id, event_type, old_status, new_status,
                     cms_response=None, error_message=None, actor_id=None):
    try:
        await pool.execute("""
            INSERT INTO cms_submission_events
                (id, submission_id, event_type, old_status, new_status, cms_response, error_message, actor_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        """, str(uuid.uuid4()), submission_id, event_type, old_status, new_status,
            json.dumps(cms_response) if cms_response else None, error_message, actor_id)
    except Exception as e:
        logger.warning(f"Event log failed: {e}")

def _build_cms_payload(req: DisputeInitiationRequest) -> Dict[str, Any]:
    """Build exact CMS IDR portal API payload per 45 CFR §149.510(b)."""
    return {
        "initiating_party": {
            "type": req.initiating_party.party_type,
            "name": req.initiating_party.name,
            "npi": req.initiating_party.npi,
            "tin": req.initiating_party.tin,
            "address": {
                "line1": req.initiating_party.address_line1,
                "line2": req.initiating_party.address_line2,
                "city": req.initiating_party.city,
                "state": req.initiating_party.state,
                "zip": req.initiating_party.zip_code,
            },
            "contact": {
                "name": req.initiating_party.contact_name,
                "email": req.initiating_party.contact_email,
                "phone": req.initiating_party.contact_phone,
            },
        },
        "responding_party": {
            "type": req.responding_party.party_type,
            "name": req.responding_party.name,
            "npi": req.responding_party.npi,
            "tin": req.responding_party.tin,
        },
        "service_items": [
            {
                "claim_number": item.claim_number,
                "service_code": item.service_code,
                "service_description": item.service_description,
                "date_of_service": item.date_of_service,
                "place_of_service": item.place_of_service,
                "billed_amount": float(item.billed_amount),
                "qpa_amount": float(item.qpa_amount),
                "plan_payment_amount": float(item.plan_payment_amount),
                "disputed_amount": float(item.disputed_amount),
                "service_type": item.service_type,
                "diagnosis_codes": item.diagnosis_codes,
                "modifier_codes": item.modifier_codes,
            }
            for item in req.service_items
        ],
        "patient": {
            "date_of_birth": req.patient_date_of_birth,
            "state_of_coverage": req.patient_state,
            "member_id": req.patient_member_id,
        },
        "plan": {"type": req.plan_type, "name": req.plan_name, "year": req.plan_year},
        "dispute_reason": req.dispute_reason,
        "dispute_reason_detail": req.dispute_reason_detail,
        "open_negotiation": {
            "start_date": req.open_negotiation_start_date,
            "end_date": req.open_negotiation_end_date,
        },
        "certification": {
            "official_name": req.certifying_official_name,
            "official_title": req.certifying_official_title,
            "date": req.certification_date,
        },
        "supporting_documents": req.supporting_document_s3_keys,
        "external_reference_id": req.dispute_id,
        "is_batch": len(req.service_items) > 1,
        "batch_item_count": len(req.service_items),
    }

async def _submit_with_retry(payload: Dict, submission_id: str, pool) -> Dict:
    """Submit to CMS with exponential backoff. No mock fallback."""
    if not CMS_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="CMS_IDR_API_KEY is not configured. Set this environment variable "
                   "with your CMS IDR portal API key to enable real submissions."
        )
    last_error = None
    for attempt in range(MAX_RETRY_ATTEMPTS):
        try:
            async with httpx.AsyncClient(timeout=CMS_TIMEOUT) as client:
                resp = await client.post(
                    f"{CMS_API_BASE}/disputes/initiate",
                    json=payload, headers=_cms_headers(),
                )
                if resp.status_code in (200, 201, 202):
                    return resp.json()
                if resp.status_code in (400, 401, 403, 422):
                    error_body = resp.text
                    await pool.execute(
                        "UPDATE cms_submissions SET status='rejected', rejected_at=NOW(), "
                        "rejection_reason=$1, updated_at=NOW() WHERE id=$2",
                        f"HTTP {resp.status_code}: {error_body}", submission_id
                    )
                    await _log_event(pool, submission_id, "REJECTED", "submitted", "rejected",
                                     error_message=f"HTTP {resp.status_code}: {error_body}")
                    raise HTTPException(502, f"CMS rejected submission (HTTP {resp.status_code}): {error_body}")
                last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
        except httpx.TimeoutException:
            last_error = f"Timeout after {CMS_TIMEOUT}s on attempt {attempt+1}"
        except httpx.ConnectError as e:
            last_error = f"Connection error: {e}"
        except HTTPException:
            raise
        except Exception as e:
            last_error = f"Unexpected error: {e}"

        if attempt < MAX_RETRY_ATTEMPTS - 1:
            delay = BASE_RETRY_DELAY * (2 ** attempt) + random.uniform(0, 1)
            next_retry = datetime.now(timezone.utc) + timedelta(seconds=delay)
            await pool.execute(
                "UPDATE cms_submissions SET status='retrying', retry_count=$1, next_retry_at=$2, updated_at=NOW() WHERE id=$3",
                attempt + 1, next_retry, submission_id
            )
            await _log_event(pool, submission_id, "RETRY_SCHEDULED", None, "retrying",
                             error_message=last_error)
            logger.warning(f"CMS submission {submission_id} attempt {attempt+1} failed: {last_error}. Retrying in {delay:.1f}s")
            await asyncio.sleep(delay)

    await pool.execute(
        "UPDATE cms_submissions SET status='failed', updated_at=NOW() WHERE id=$1", submission_id
    )
    await _log_event(pool, submission_id, "FAILED_ALL_RETRIES", "retrying", "failed",
                     error_message=last_error)
    raise HTTPException(502, f"CMS submission failed after {MAX_RETRY_ATTEMPTS} attempts. Last error: {last_error}")

def _collect_warnings(req: DisputeInitiationRequest) -> List[str]:
    warnings = []
    total_disputed = sum(i.disputed_amount for i in req.service_items)
    if total_disputed < Decimal("115"):
        warnings.append(
            f"Total disputed amount (${total_disputed}) is less than the CMS IDR admin fee ($115). "
            "Consider whether IDR is cost-effective."
        )
    for item in req.service_items:
        if item.qpa_amount > 0:
            deviation = abs(item.disputed_amount - item.qpa_amount) / item.qpa_amount
            if deviation < Decimal("0.20"):
                warnings.append(
                    f"Claim {item.claim_number}: deviation from QPA is less than 20%. "
                    "IDR entity will apply QPA as presumptive correct amount per §149.510(c)(4)(i)."
                )
    if req.initiating_party.party_type in ("provider", "facility") and not req.initiating_party.npi:
        warnings.append("Initiating party NPI is missing. CMS may require NPI for provider/facility parties.")
    cert_date = datetime.strptime(req.certification_date, "%Y-%m-%d").date()
    if cert_date != date.today():
        warnings.append(
            f"Certification date ({cert_date}) is not today ({date.today()}). "
            "CMS requires certification dated on the day of submission."
        )
    return warnings

async def process_submission(req: DisputeInitiationRequest, actor_id: str) -> CMSSubmissionResponse:
    pool = await get_db()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    if req.idempotency_key:
        existing = await pool.fetchrow(
            "SELECT id, cms_reference_number, status FROM cms_submissions WHERE idempotency_key=$1",
            req.idempotency_key
        )
        if existing:
            return CMSSubmissionResponse(
                submission_id=existing["id"],
                cms_reference_number=existing["cms_reference_number"],
                status=CMSSubmissionStatus(existing["status"]),
                message="Duplicate submission — returning existing record",
            )

    submission_id = str(uuid.uuid4())
    warnings = _collect_warnings(req)
    payload = _build_cms_payload(req)

    await pool.execute("""
        INSERT INTO cms_submissions (id, dispute_id, tenant_id, status, payload, validation_warnings, idempotency_key, created_at, updated_at)
        VALUES ($1,$2,$3,'pending',$4,$5,$6,NOW(),NOW())
    """, submission_id, req.dispute_id, req.tenant_id, json.dumps(payload), json.dumps(warnings), req.idempotency_key)
    await _log_event(pool, submission_id, "CREATED", None, "pending", actor_id=actor_id)

    await pool.execute(
        "UPDATE cms_submissions SET status='submitted', submitted_at=NOW(), updated_at=NOW() WHERE id=$1",
        submission_id
    )

    result = await _submit_with_retry(payload, submission_id, pool)

    cms_ref = result.get("cms_reference_number") or result.get("reference_number")
    is_accepted = result.get("status") in ("accepted", "processing", "received")
    new_status = CMSSubmissionStatus.ACCEPTED if is_accepted else CMSSubmissionStatus.SUBMITTED

    await pool.execute("""
        UPDATE cms_submissions SET status=$1, cms_reference_number=$2,
            accepted_at=CASE WHEN $3 THEN NOW() ELSE NULL END, updated_at=NOW()
        WHERE id=$4
    """, new_status.value, cms_ref, is_accepted, submission_id)
    await _log_event(pool, submission_id, "ACCEPTED" if is_accepted else "SUBMITTED",
                     "submitted", new_status.value, cms_response=result, actor_id=actor_id)

    try:
        from aiokafka import AIOKafkaProducer
        producer = AIOKafkaProducer(
            bootstrap_servers=os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092"),
            value_serializer=lambda v: json.dumps(v, default=str).encode(),
        )
        await producer.start()
        await producer.send_and_wait("cms-submissions", {
            "event": "CMS_DISPUTE_SUBMITTED",
            "submission_id": submission_id,
            "dispute_id": req.dispute_id,
            "cms_reference_number": cms_ref,
            "status": new_status.value,
            "tenant_id": req.tenant_id,
            "item_count": len(req.service_items),
            "total_disputed": float(sum(i.disputed_amount for i in req.service_items)),
        })
        await producer.stop()
    except Exception as e:
        logger.warning(f"Kafka publish failed: {e}")

    return CMSSubmissionResponse(
        submission_id=submission_id,
        cms_reference_number=cms_ref,
        status=new_status,
        submitted_at=datetime.now(timezone.utc),
        accepted_at=datetime.now(timezone.utc) if is_accepted else None,
        message=(
            f"Dispute submitted to CMS IDR portal. CMS reference: {cms_ref}. "
            f"{'Accepted.' if is_accepted else 'Pending CMS review.'}"
        ),
        validation_warnings=warnings,
    )

@app.on_event("startup")
async def startup():
    pool = await get_db()
    if pool:
        async with pool.acquire() as conn:
            await conn.execute(CREATE_TABLES_SQL)
    logger.info("CMS portal automation service started")

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "cms-portal-automation", "version": "2.0.0"}

@app.post("/api/v1/cms/disputes/initiate", response_model=CMSSubmissionResponse, status_code=201)
async def initiate_dispute(
    req: DisputeInitiationRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Initiate an IDR dispute with the CMS portal. All 45 CFR §149.510(b) fields validated."""
    return await process_submission(req, current_user.sub)

@app.get("/api/v1/cms/disputes/{submission_id}/status")
async def get_submission_status(
    submission_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    pool = await get_db()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    row = await pool.fetchrow("SELECT * FROM cms_submissions WHERE id=$1", submission_id)
    if not row:
        raise HTTPException(404, "Submission not found")
    record = dict(row)
    if record.get("cms_reference_number") and record["status"] not in (
        "completed", "rejected", "withdrawn", "failed"
    ):
        try:
            if not CMS_API_KEY:
                raise Exception("CMS_IDR_API_KEY not configured")
            async with httpx.AsyncClient(timeout=CMS_TIMEOUT) as client:
                resp = await client.get(
                    f"{CMS_API_BASE}/disputes/{record['cms_reference_number']}/status",
                    headers=_cms_headers(),
                )
                resp.raise_for_status()
                cms_status = resp.json()
            new_status = cms_status.get("status", record["status"])
            if new_status != record["status"]:
                await pool.execute(
                    "UPDATE cms_submissions SET status=$1, updated_at=NOW() WHERE id=$2",
                    new_status, submission_id
                )
                await _log_event(pool, submission_id, "STATUS_POLLED",
                                  record["status"], new_status, cms_response=cms_status)
                record["status"] = new_status
        except Exception as e:
            logger.warning(f"CMS status poll failed: {e}")
    return record

@app.post("/api/v1/cms/disputes/{submission_id}/retry")
async def retry_submission(
    submission_id: str,
    background_tasks: BackgroundTasks,
    current_user: TokenPayload = Depends(get_current_user),
):
    pool = await get_db()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    row = await pool.fetchrow("SELECT * FROM cms_submissions WHERE id=$1", submission_id)
    if not row:
        raise HTTPException(404, "Submission not found")
    if row["status"] not in (CMSSubmissionStatus.FAILED.value, CMSSubmissionStatus.REJECTED.value):
        raise HTTPException(400, f"Cannot retry submission in status: {row['status']}")

    async def _retry():
        try:
            payload = row["payload"] if isinstance(row["payload"], dict) else json.loads(row["payload"])
            await pool.execute(
                "UPDATE cms_submissions SET status='submitted', submitted_at=NOW(), updated_at=NOW() WHERE id=$1",
                submission_id
            )
            result = await _submit_with_retry(payload, submission_id, pool)
            cms_ref = result.get("cms_reference_number")
            is_accepted = result.get("status") in ("accepted", "processing", "received")
            new_status = "accepted" if is_accepted else "submitted"
            await pool.execute(
                "UPDATE cms_submissions SET status=$1, cms_reference_number=$2, updated_at=NOW() WHERE id=$3",
                new_status, cms_ref, submission_id
            )
            await _log_event(pool, submission_id, "RETRY_SUCCEEDED", row["status"], new_status,
                             actor_id=current_user.sub)
        except Exception as e:
            logger.error(f"Manual retry failed for {submission_id}: {e}")
            await pool.execute(
                "UPDATE cms_submissions SET status='failed', updated_at=NOW() WHERE id=$1", submission_id
            )
            await _log_event(pool, submission_id, "RETRY_FAILED", "submitted", "failed",
                             error_message=str(e))

    background_tasks.add_task(_retry)
    return {"submission_id": submission_id, "status": "retry_initiated"}

@app.post("/api/v1/cms/disputes/{submission_id}/withdraw")
async def withdraw_submission(
    submission_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    pool = await get_db()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    row = await pool.fetchrow(
        "SELECT status, cms_reference_number FROM cms_submissions WHERE id=$1", submission_id
    )
    if not row:
        raise HTTPException(404, "Submission not found")
    if row["status"] in ("completed", "withdrawn"):
        raise HTTPException(400, f"Cannot withdraw submission in status: {row['status']}")
    if row["cms_reference_number"] and CMS_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=CMS_TIMEOUT) as client:
                await client.post(
                    f"{CMS_API_BASE}/disputes/{row['cms_reference_number']}/withdraw",
                    headers=_cms_headers(),
                )
        except Exception as e:
            logger.warning(f"CMS withdrawal notification failed: {e}")
    await pool.execute(
        "UPDATE cms_submissions SET status='withdrawn', withdrawn_at=NOW(), updated_at=NOW() WHERE id=$1",
        submission_id
    )
    await _log_event(pool, submission_id, "WITHDRAWN", row["status"], "withdrawn",
                     actor_id=current_user.sub)
    return {"submission_id": submission_id, "status": "withdrawn"}

@app.post("/api/v1/cms/qpa/lookup", response_model=QPALookupResponse)
async def lookup_qpa(
    req: QPALookupRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Look up QPA from CMS. Requires CMS_IDR_API_KEY — no synthetic fallback."""
    cache_key = f"qpa:{req.service_code}:{req.geographic_area}:{req.plan_type}:{req.date_of_service}:{req.specialty_code}:{req.place_of_service}"
    redis = await get_redis_client()
    if redis:
        cached = await redis.get(cache_key)
        if cached:
            data = json.loads(cached)
            return QPALookupResponse(**{**data, "calculated_at": datetime.now(timezone.utc)})
    if not CMS_API_KEY:
        raise HTTPException(
            503,
            "CMS_IDR_API_KEY is not configured. QPA cannot be computed without "
            "access to the CMS All-Payer Claims Database."
        )
    async with httpx.AsyncClient(timeout=CMS_TIMEOUT) as client:
        resp = await client.get(
            f"{CMS_API_BASE}/qpa/lookup",
            headers=_cms_headers(),
            params={k: v for k, v in req.dict().items() if v is not None},
        )
        resp.raise_for_status()
        result = resp.json()
    if redis:
        await redis.setex(cache_key, 86400, json.dumps(result))
    return QPALookupResponse(**{**result, "calculated_at": datetime.now(timezone.utc)})

@app.post("/api/v1/cms/documents/upload-url")
async def get_document_upload_url(
    req: DocumentUploadRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get a presigned S3 URL for uploading a supporting document."""
    from backend.shared.secrets import get_secret
    import boto3
    s3_key = f"cms-documents/{req.dispute_id}/{uuid.uuid4()}/{req.file_name}"
    try:
        s3_client = boto3.client(
            "s3",
            aws_access_key_id=await get_secret("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=await get_secret("AWS_SECRET_ACCESS_KEY"),
            region_name=os.getenv("AWS_REGION", "us-east-1"),
        )
        presigned_url = s3_client.generate_presigned_url(
            "put_object",
            Params={"Bucket": S3_BUCKET, "Key": s3_key, "ContentType": req.content_type},
            ExpiresIn=900,
        )
    except Exception as e:
        raise HTTPException(503, f"Failed to generate upload URL: {e}")
    pool = await get_db()
    if pool:
        await pool.execute("""
            INSERT INTO cms_documents (id, dispute_id, tenant_id, document_type, file_name, s3_key, content_type, file_size_bytes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        """, str(uuid.uuid4()), req.dispute_id, current_user.tenant_id,
            req.document_type, req.file_name, s3_key, req.content_type, req.file_size_bytes)
    return {
        "upload_url": presigned_url, "s3_key": s3_key, "expires_in_seconds": 900,
        "instructions": "PUT the file to upload_url with the correct Content-Type header. "
                        "Then include s3_key in supporting_document_s3_keys when initiating the dispute.",
    }

@app.get("/api/v1/cms/submissions")
async def list_submissions(
    tenant_id: str, status: Optional[str] = Query(None),
    limit: int = Query(50, le=500), offset: int = Query(0),
    current_user: TokenPayload = Depends(get_current_user),
):
    pool = await get_db()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    params: List[Any] = [tenant_id]
    where = "WHERE tenant_id=$1"
    idx = 2
    if status:
        where += f" AND status=${idx}"; params.append(status); idx += 1
    params.extend([limit, offset])
    rows = await pool.fetch(
        f"SELECT * FROM cms_submissions {where} ORDER BY created_at DESC LIMIT ${idx} OFFSET ${idx+1}",
        *params
    )
    return {"submissions": [dict(r) for r in rows], "total": len(rows)}

@app.get("/api/v1/cms/stats")
async def cms_stats(
    tenant_id: Optional[str] = Query(None),
    current_user: TokenPayload = Depends(get_current_user),
):
    pool = await get_db()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    where = "WHERE tenant_id=$1" if tenant_id else ""
    params = [tenant_id] if tenant_id else []
    rows = await pool.fetch(
        f"SELECT status, COUNT(*) as count FROM cms_submissions {where} GROUP BY status", *params
    )
    return {"by_status": {r["status"]: r["count"] for r in rows}}

@app.get("/api/v1/cms/submissions/{submission_id}/events")
async def get_submission_events(
    submission_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    pool = await get_db()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    rows = await pool.fetch(
        "SELECT * FROM cms_submission_events WHERE submission_id=$1 ORDER BY created_at ASC",
        submission_id
    )
    return {"events": [dict(r) for r in rows]}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8033")))
