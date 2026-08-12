"""
CMS IDR Integration Service
Handles integration with CMS IDR Portal and certified IDR entities.
Provides real-time status updates and submission tracking.
All database operations use asyncpg (no SQLAlchemy sync). No stubs or simulations.
"""

# ── Shared HealthPoint infrastructure ─────────────────────────────────────────
import sys
import os as _os
_repo_root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from backend.shared.database import fetch, fetchrow, execute, fetchval, transaction, bootstrap_schema, get_pool
from backend.shared.cache import get_client as get_redis_client, set_json, get_json
from backend.shared.auth import get_current_user, require_role, require_admin, security_headers_middleware, TokenPayload
from backend.shared.messaging import publish, Topics
from backend.shared.telemetry import setup_telemetry, instrument_fastapi
# ─────────────────────────────────────────────────────────────────────────────

import os
import json
import logging
import hashlib
import hmac
from datetime import datetime, timedelta
from enum import Enum
from typing import List, Optional, Dict, Any

import aiohttp
from cryptography.fernet import Fernet
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Request
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

setup_telemetry(service_name="cms-idr-integration-service", service_version="2.0.0")
app = FastAPI(title="CMS IDR Integration Service", version="2.0.0")
instrument_fastapi(app)
app.middleware("http")(security_headers_middleware)

# Encryption key loaded from environment (must be 32-url-safe-base64 bytes)
_RAW_KEY = os.getenv("FIELD_ENCRYPTION_KEY", "")
cipher_suite: Optional[Fernet] = None
if _RAW_KEY:
    try:
        cipher_suite = Fernet(_RAW_KEY.encode())
    except Exception:
        logger.warning("FIELD_ENCRYPTION_KEY is set but invalid — field encryption disabled")

# ── Enums ─────────────────────────────────────────────────────────────────────

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

# ── Pydantic models ───────────────────────────────────────────────────────────

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

# ── DB bootstrap ──────────────────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS cms_submissions (
    id                      BIGSERIAL PRIMARY KEY,
    batch_id                VARCHAR(120) UNIQUE NOT NULL,
    aggregator_id           VARCHAR(60),
    cms_submission_id       VARCHAR(120) UNIQUE,
    total_claims            INT,
    total_amount            NUMERIC(15,2),
    status                  VARCHAR(60) DEFAULT 'pending',
    submission_date         TIMESTAMPTZ DEFAULT NOW(),
    last_status_update      TIMESTAMPTZ DEFAULT NOW(),
    cms_response            JSONB,
    idr_entity_assigned     VARCHAR(120),
    decision_deadline       TIMESTAMPTZ,
    final_decision          JSONB,
    webhook_url             VARCHAR(500),
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cms_submissions_agg ON cms_submissions(aggregator_id);
CREATE INDEX IF NOT EXISTS idx_cms_submissions_status ON cms_submissions(status);

CREATE TABLE IF NOT EXISTS idr_entity_status (
    id                          BIGSERIAL PRIMARY KEY,
    entity_name                 VARCHAR(120) UNIQUE NOT NULL,
    is_certified                BOOLEAN DEFAULT TRUE,
    capacity_available          BOOLEAN DEFAULT TRUE,
    average_decision_time_days  INT,
    success_rate                NUMERIC(5,2),
    specialties                 JSONB,
    contact_info                JSONB,
    last_updated                TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS status_updates (
    id              BIGSERIAL PRIMARY KEY,
    submission_id   VARCHAR(120) NOT NULL,
    status          VARCHAR(60),
    message         TEXT,
    details         JSONB,
    source          VARCHAR(50) DEFAULT 'SYSTEM',
    webhook_sent    BOOLEAN DEFAULT FALSE,
    webhook_response JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_status_updates_sub ON status_updates(submission_id);
"""

@app.on_event("startup")
async def startup():
    await bootstrap_schema(SCHEMA_SQL)

# ── Field encryption helpers ──────────────────────────────────────────────────

SENSITIVE_FIELDS = ("patient_id", "provider_tax_id", "medical_records")

def _encrypt_field(value: str) -> str:
    if cipher_suite:
        return cipher_suite.encrypt(value.encode()).decode()
    return value  # No-op if key not configured

def _encrypt_sensitive_data(data: Dict[str, Any]) -> Dict[str, Any]:
    out = data.copy()
    for field in SENSITIVE_FIELDS:
        if field in out:
            if isinstance(out[field], str):
                out[field] = _encrypt_field(out[field])
            elif isinstance(out[field], list):
                out[field] = [_encrypt_field(str(i)) for i in out[field]]
    return out

# ── CMS IDR Portal client ─────────────────────────────────────────────────────

class CMSIDRPortal:
    def __init__(self):
        self.base_url = os.getenv("CMS_IDR_BASE_URL", "https://nsa-idr.cms.gov/api/v1")
        self.api_key = os.getenv("CMS_API_KEY", "")
        self.timeout = aiohttp.ClientTimeout(total=30)

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-Submission-Source": "NSA-IDR-Platform",
        }

    async def submit_bulk_disputes(self, submission_data: Dict[str, Any]) -> CMSResponse:
        """POST encrypted submission to CMS IDR Portal and return confirmation."""
        encrypted = _encrypt_sensitive_data(submission_data)
        async with aiohttp.ClientSession(timeout=self.timeout) as session:
            try:
                async with session.post(
                    f"{self.base_url}/disputes/bulk-submit",
                    json=encrypted,
                    headers=self._headers(),
                ) as resp:
                    if resp.status == 200:
                        return CMSResponse(**(await resp.json()))
                    body = await resp.text()
                    raise HTTPException(status_code=resp.status, detail=f"CMS API Error: {body}")
            except aiohttp.ClientError as exc:
                logger.error(f"CMS API connection error: {exc}")
                raise HTTPException(status_code=503, detail="CMS IDR Portal unavailable")

    async def get_submission_status(self, cms_submission_id: str) -> Dict[str, Any]:
        """GET current status of a submission from CMS IDR Portal."""
        async with aiohttp.ClientSession(timeout=self.timeout) as session:
            try:
                async with session.get(
                    f"{self.base_url}/disputes/{cms_submission_id}/status",
                    headers=self._headers(),
                ) as resp:
                    if resp.status == 200:
                        return await resp.json()
                    body = await resp.text()
                    raise HTTPException(status_code=resp.status, detail=f"CMS status error: {body}")
            except aiohttp.ClientError as exc:
                logger.error(f"CMS status check error: {exc}")
                raise HTTPException(status_code=503, detail="CMS IDR Portal unavailable")

# ── IDR Entity Integration ────────────────────────────────────────────────────

_IDR_ENDPOINTS: Dict[IDREntity, str] = {
    IDREntity.HEALTHCARE_RESOLUTION_LLC: "https://api.healthcareresolution.com/nsa-idr",
    IDREntity.MEDICAL_DISPUTE_SERVICES:  "https://api.medicaldispute.com/idr",
    IDREntity.INDEPENDENT_MEDICAL_REVIEW: "https://api.independentmedical.com/review",
    IDREntity.ARBITRATION_FORUMS_INC:    "https://api.arbitrationforums.com/healthcare",
    IDREntity.MAXIMUS_FEDERAL:           "https://api.maximus.com/federal/idr",
}

def _assess_case_complexity(submission_data: Dict[str, Any]) -> str:
    claims = submission_data.get("claims", [])
    if not claims:
        return "low"
    indicators = 0
    for claim in claims:
        if float(claim.get("dispute_amount", 0)) > 5000:
            indicators += 1
        if claim.get("emergency_indicator"):
            indicators += 1
        sc = claim.get("service_code", "")
        if sc.startswith(("70", "71", "72", "73", "74", "75", "76")):
            indicators += 1
    ratio = indicators / len(claims)
    if ratio >= 0.5:
        return "high"
    if ratio >= 0.25:
        return "medium"
    return "low"

async def assign_idr_entity(submission_data: Dict[str, Any]) -> IDREntity:
    """Select IDR entity based on case characteristics and DB capacity data."""
    dispute_amount = sum(
        float(c.get("dispute_amount", 0)) for c in submission_data.get("claims", [])
    )
    complexity = _assess_case_complexity(submission_data)

    # Prefer entities with available capacity from DB
    row = await fetchrow(
        "SELECT entity_name FROM idr_entity_status "
        "WHERE is_certified=TRUE AND capacity_available=TRUE "
        "ORDER BY success_rate DESC NULLS LAST LIMIT 1"
    )
    if row:
        try:
            return IDREntity(row["entity_name"])
        except ValueError:
            pass

    # Fallback: rule-based selection
    if dispute_amount > 10000 or complexity == "high":
        return IDREntity.HEALTHCARE_RESOLUTION_LLC
    if complexity == "medium":
        return IDREntity.MEDICAL_DISPUTE_SERVICES
    return IDREntity.INDEPENDENT_MEDICAL_REVIEW

async def notify_idr_entity(entity: IDREntity, submission_data: Dict[str, Any]) -> Dict[str, Any]:
    """POST new case notification to the assigned IDR entity."""
    endpoint = _IDR_ENDPOINTS.get(entity)
    if not endpoint:
        raise ValueError(f"Unknown IDR entity: {entity}")
    api_key = os.getenv("IDR_ENTITY_API_KEY", "")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        try:
            async with session.post(f"{endpoint}/cases/new", json=submission_data, headers=headers) as resp:
                if resp.status == 200:
                    return await resp.json()
                body = await resp.text()
                logger.error(f"IDR entity notification error ({entity}): {body}")
                return {"status": "error", "message": body}
        except aiohttp.ClientError as exc:
            logger.error(f"IDR entity connection error ({entity}): {exc}")
            return {"status": "connection_error", "error": str(exc)}

# ── Status update helpers ─────────────────────────────────────────────────────

WEBHOOK_SECRET = os.getenv("WEBHOOK_SIGNING_SECRET", "").encode()

async def create_status_update(
    submission_id: str,
    status: SubmissionStatus,
    message: str,
    details: Optional[Dict[str, Any]] = None,
    source: str = "SYSTEM",
):
    """Persist status update, update submission row, broadcast via Redis, and fire webhook."""
    await execute(
        "INSERT INTO status_updates (submission_id, status, message, details, source, created_at) "
        "VALUES ($1,$2,$3,$4::jsonb,$5,NOW())",
        submission_id, status.value, message,
        json.dumps(details) if details else "{}",
        source,
    )
    await execute(
        "UPDATE cms_submissions SET status=$1, last_status_update=NOW(), "
        "cms_response=COALESCE($2::jsonb, cms_response), updated_at=NOW() "
        "WHERE cms_submission_id=$3 OR batch_id=$3",
        status.value,
        json.dumps(details) if details else None,
        submission_id,
    )

    # Broadcast via Redis pub/sub
    redis = await get_redis_client()
    if redis:
        payload = json.dumps({
            "submission_id": submission_id,
            "status": status.value,
            "message": message,
            "timestamp": datetime.utcnow().isoformat(),
            "details": details,
        })
        await redis.publish(f"status_updates:{submission_id}", payload)
        await redis.publish("status_updates:all", payload)

    # Fire webhook if configured
    row = await fetchrow(
        "SELECT webhook_url FROM cms_submissions WHERE cms_submission_id=$1 OR batch_id=$1",
        submission_id,
    )
    if row and row["webhook_url"]:
        await _fire_webhook(submission_id, row["webhook_url"], status, message, details)

async def _fire_webhook(
    submission_id: str,
    webhook_url: str,
    status: SubmissionStatus,
    message: str,
    details: Optional[Dict[str, Any]],
):
    """Sign and POST webhook payload; record delivery result."""
    payload = {
        "submission_id": submission_id,
        "status": status.value,
        "message": message,
        "timestamp": datetime.utcnow().isoformat(),
        "details": details,
    }
    body = json.dumps(payload)
    sig = hmac.new(WEBHOOK_SECRET or b"changeme", body.encode(), hashlib.sha256).hexdigest()
    headers = {
        "Content-Type": "application/json",
        "X-NSA-IDR-Signature": f"sha256={sig}",
        "X-NSA-IDR-Event": "status_update",
    }
    timeout = aiohttp.ClientTimeout(total=10)
    webhook_response: Dict[str, Any] = {}
    webhook_sent = False
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(webhook_url, data=body, headers=headers) as resp:
                webhook_sent = resp.status < 400
                webhook_response = {
                    "status_code": resp.status,
                    "response": await resp.text(),
                }
    except Exception as exc:
        webhook_response = {"error": str(exc)}
        logger.error(f"Webhook delivery failed for {submission_id}: {exc}")

    await execute(
        "UPDATE status_updates SET webhook_sent=$1, webhook_response=$2::jsonb "
        "WHERE submission_id=$3 AND webhook_sent=FALSE "
        "ORDER BY created_at DESC LIMIT 1",
        webhook_sent, json.dumps(webhook_response), submission_id,
    )

# ── Background processing ─────────────────────────────────────────────────────

cms_portal = CMSIDRPortal()

async def _process_submission(submission_id_str: str, submission_data: Dict[str, Any]):
    """Full async pipeline: validate → submit to CMS → assign IDR entity → notify entity."""
    try:
        await create_status_update(submission_id_str, SubmissionStatus.VALIDATING, "Validating submission data")

        # Basic validation
        claims = submission_data.get("claims", [])
        if not claims:
            raise ValueError("No claims in submission")
        for claim in claims:
            for field in ("claim_id", "provider_npi", "dispute_amount"):
                if not claim.get(field):
                    raise ValueError(f"Claim missing required field: {field}")

        await create_status_update(submission_id_str, SubmissionStatus.VALIDATED, "Validation passed")
        await create_status_update(submission_id_str, SubmissionStatus.SUBMITTING, "Submitting to CMS IDR Portal")

        cms_response = await cms_portal.submit_bulk_disputes(submission_data)

        # Persist CMS confirmation number
        await execute(
            "UPDATE cms_submissions SET cms_submission_id=$1, updated_at=NOW() WHERE batch_id=$2",
            cms_response.cms_confirmation_number, submission_data["batch_id"],
        )

        await create_status_update(
            submission_id_str, SubmissionStatus.SUBMITTED,
            "Successfully submitted to CMS IDR Portal",
            {"cms_confirmation": cms_response.cms_confirmation_number},
        )

        # IDR entity assignment
        idr_entity = submission_data.get("preferred_idr_entity")
        if idr_entity:
            idr_entity = IDREntity(idr_entity)
        else:
            idr_entity = await assign_idr_entity(submission_data)

        deadline = datetime.utcnow() + timedelta(days=30)
        await execute(
            "UPDATE cms_submissions SET idr_entity_assigned=$1, decision_deadline=$2, updated_at=NOW() "
            "WHERE batch_id=$3",
            idr_entity.value, deadline, submission_data["batch_id"],
        )

        await create_status_update(
            submission_id_str, SubmissionStatus.UNDER_REVIEW,
            f"Case assigned to {idr_entity.value} for review",
            {"idr_entity": idr_entity.value, "decision_deadline": deadline.isoformat()},
        )

        idr_response = await notify_idr_entity(idr_entity, submission_data)

        await create_status_update(
            submission_id_str, SubmissionStatus.DECISION_PENDING,
            "IDR entity reviewing case — decision pending",
            {"idr_response": idr_response},
        )

        await publish(Topics.CMS_SUBMISSION_COMPLETED, {
            "batch_id": submission_data["batch_id"],
            "cms_confirmation": cms_response.cms_confirmation_number,
            "idr_entity": idr_entity.value,
        })

    except Exception as exc:
        logger.error(f"Processing error for {submission_id_str}: {exc}")
        await create_status_update(
            submission_id_str, SubmissionStatus.REJECTED,
            f"Processing failed: {exc}",
        )

# ── API endpoints ─────────────────────────────────────────────────────────────

@app.post("/api/v1/cms-idr/submit")
async def api_submit_disputes(
    request: SubmissionRequest,
    background_tasks: BackgroundTasks,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Initiate CMS IDR submission pipeline (async background processing)."""
    total_amount = sum(
        float(c.get("dispute_amount", 0)) for c in request.claims_data
    )
    await execute(
        "INSERT INTO cms_submissions "
        "(batch_id, aggregator_id, total_claims, total_amount, status, webhook_url, submission_date, created_at, updated_at) "
        "VALUES ($1,$2,$3,$4,'pending',$5,NOW(),NOW(),NOW()) "
        "ON CONFLICT (batch_id) DO NOTHING",
        request.batch_id, request.aggregator_id, len(request.claims_data),
        total_amount, request.webhook_url,
    )

    submission_data = {
        "batch_id": request.batch_id,
        "aggregator_id": request.aggregator_id,
        "claims": request.claims_data,
        "preferred_idr_entity": request.preferred_idr_entity.value if request.preferred_idr_entity else None,
        "submission_date": datetime.utcnow().isoformat(),
    }
    background_tasks.add_task(_process_submission, request.batch_id, submission_data)

    return {
        "status": "accepted",
        "batch_id": request.batch_id,
        "message": "Submission queued for processing",
        "total_claims": len(request.claims_data),
    }


@app.get("/api/v1/cms-idr/status/{submission_id}", response_model=List[StatusUpdateResponse])
async def api_get_submission_status(
    submission_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get all status updates for a submission in reverse chronological order."""
    rows = await fetch(
        "SELECT submission_id, status, message, details, created_at "
        "FROM status_updates WHERE submission_id=$1 ORDER BY created_at DESC",
        submission_id,
    )
    return [
        StatusUpdateResponse(
            submission_id=r["submission_id"],
            status=SubmissionStatus(r["status"]),
            message=r["message"],
            timestamp=r["created_at"],
            details=r["details"],
        )
        for r in rows
    ]


@app.get("/api/v1/cms-idr/submissions/{aggregator_id}")
async def api_get_aggregator_submissions(
    aggregator_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get all CMS submissions for a specific aggregator."""
    rows = await fetch(
        "SELECT batch_id, cms_submission_id, total_claims, total_amount, status, "
        "submission_date, idr_entity_assigned, decision_deadline, created_at "
        "FROM cms_submissions WHERE aggregator_id=$1 ORDER BY created_at DESC",
        aggregator_id,
    )
    return [dict(r) for r in rows]


@app.post("/api/v1/cms-idr/webhook/cms-update")
async def api_receive_cms_webhook(
    update_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Receive status updates pushed from CMS IDR Portal."""
    submission_id = update_data.get("submission_id")
    status_str = update_data.get("status")
    if not submission_id or not status_str:
        raise HTTPException(status_code=400, detail="submission_id and status are required")
    await create_status_update(
        submission_id,
        SubmissionStatus(status_str),
        update_data.get("message", ""),
        update_data.get("details"),
        source="CMS",
    )
    return {"status": "received"}


@app.post("/api/v1/cms-idr/webhook/idr-update")
async def api_receive_idr_webhook(
    update_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Receive status updates pushed from IDR entities."""
    submission_id = update_data.get("submission_id")
    status_str = update_data.get("status")
    if not submission_id or not status_str:
        raise HTTPException(status_code=400, detail="submission_id and status are required")
    await create_status_update(
        submission_id,
        SubmissionStatus(status_str),
        update_data.get("message", ""),
        update_data.get("details"),
        source="IDR_ENTITY",
    )
    return {"status": "received"}


@app.get("/api/v1/cms-idr/idr-entities")
async def api_list_idr_entities(
    current_user: TokenPayload = Depends(get_current_user),
):
    """List all certified IDR entities and their current capacity status."""
    rows = await fetch(
        "SELECT entity_name, is_certified, capacity_available, "
        "average_decision_time_days, success_rate, specialties, last_updated "
        "FROM idr_entity_status ORDER BY success_rate DESC NULLS LAST"
    )
    return [dict(r) for r in rows]


@app.get("/health")
async def health_check():
    pool = await get_pool()
    return {
        "status": "healthy" if pool else "degraded",
        "service": "CMS IDR Integration Service",
        "version": "2.0.0",
        "database": "connected" if pool else "unavailable",
        "timestamp": datetime.utcnow().isoformat(),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8027)
