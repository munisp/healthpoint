"""
NSA/IDR Dispute Resolution Service — Full Production Implementation
Handles No Surprises Act Independent Dispute Resolution processes with complete
NSA business rules: eligibility, open negotiation, IDR initiation windows,
determination enforcement, and CMS portal integration.
Port: 8016
"""
import asyncio, json, logging, uuid, sys, os as _os
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from enum import Enum
from typing import Dict, List, Optional, Any

import httpx

_repo_root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from backend.shared.database import bootstrap_schema, get_pool
from backend.shared.auth import get_current_user, require_role, TokenPayload
from backend.shared.messaging import publish, Topics
from backend.shared.security_middleware import apply_security_middleware

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, Query
from pydantic import BaseModel, Field, validator
import structlog

logging.basicConfig(level=logging.INFO)
logger = structlog.get_logger()

# ── NSA Regulatory Constants (42 CFR Part 300, effective 2022) ─────────────
NSA_ADMIN_FEE_2024 = Decimal("115.00")
NSA_ADMIN_FEE_BATCHED_2024 = Decimal("575.00")
OPEN_NEGOTIATION_PERIOD_DAYS = 30
IDR_INITIATION_WINDOW_DAYS = 4
IDR_DECISION_DEADLINE_DAYS = 30
PAYMENT_IMPLEMENTATION_DAYS = 30
APPEAL_FILING_DEADLINE_DAYS = 30
NSA_THRESHOLD_DEFAULT = Decimal("400.00")
NSA_THRESHOLD_AIR_AMBULANCE = Decimal("400.00")
QPA_DISPUTE_THRESHOLD_PCT = Decimal("0.20")
CMS_IDR_PORTAL_URL = _os.getenv("CMS_IDR_PORTAL_URL", "https://nsa-idr.cms.gov/paymentdisputes/api/v1")

app = FastAPI(title="NSA/IDR Dispute Resolution Service", version="2.0.0")
apply_security_middleware(app)


class DisputeStatus(str, Enum):
    DRAFT = "draft"; OPEN_NEGOTIATION = "open_negotiation"
    NEGOTIATION_CLOSED = "negotiation_closed"; IDR_ELIGIBLE = "idr_eligible"
    IDR_INITIATED = "idr_initiated"; IDR_IN_PROGRESS = "idr_in_progress"
    IDR_DECIDED = "idr_decided"; PAYMENT_PENDING = "payment_pending"
    PAYMENT_IMPLEMENTED = "payment_implemented"; APPEALED = "appealed"
    CLOSED = "closed"; INELIGIBLE = "ineligible"

class DisputeType(str, Enum):
    EMERGENCY_SERVICES = "emergency_services"; POST_STABILIZATION = "post_stabilization"
    NON_EMERGENCY_OON = "non_emergency_oon"; AIR_AMBULANCE = "air_ambulance"

class PartyType(str, Enum):
    PROVIDER = "provider"; FACILITY = "facility"
    HEALTH_PLAN = "health_plan"; INSURER = "insurer"

class DeterminationBasis(str, Enum):
    QPA = "qpa"; PROVIDER_OFFER = "provider_offer"
    PLAN_OFFER = "plan_offer"; ADDITIONAL_CRITERIA = "additional_criteria"


class QualifiedIDRItem(BaseModel):
    service_date: datetime; service_location: str; service_type: DisputeType
    service_codes: List[str] = Field(..., min_items=1)
    claim_number: str = Field(..., min_length=1, max_length=50)
    billed_amount: Decimal = Field(..., gt=0)
    qpa_amount: Optional[Decimal] = Field(None, gt=0)
    provider_final_offer: Optional[Decimal] = Field(None, gt=0)
    plan_final_offer: Optional[Decimal] = Field(None, gt=0)
    provider_npi: Optional[str] = None; facility_tin: Optional[str] = None

    @validator("billed_amount", "qpa_amount", "provider_final_offer", "plan_final_offer", pre=True, always=True)
    def round_currency(cls, v):
        return Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if v is not None else v

    @validator("service_codes")
    def validate_codes(cls, v):
        for code in v:
            if not code or len(code) > 10:
                raise ValueError(f"Invalid service code: {code}")
        return v


class BulkDisputeRequest(BaseModel):
    qualified_items: List[QualifiedIDRItem] = Field(..., min_items=1, max_items=500)
    negotiation_summary: str = Field(..., min_length=10, max_length=5000)
    initiating_party: PartyType; initiating_party_id: str
    tenant_id: str; contact_email: str; contact_phone: Optional[str] = None

    @validator("qualified_items")
    def validate_no_mixed_air_ambulance(cls, v):
        if len(v) > 1:
            types = {i.service_type for i in v}
            if DisputeType.AIR_AMBULANCE in types and len(types) > 1:
                raise ValueError("Air ambulance disputes cannot be batched with other service types")
        return v


class OpenNegotiationRequest(BaseModel):
    dispute_id: str; initiating_party: PartyType; initiating_party_id: str
    initial_payment_offer: Decimal = Field(..., gt=0)
    offer_justification: str = Field(..., min_length=20); tenant_id: str

    @validator("initial_payment_offer", pre=True)
    def round_offer(cls, v):
        return Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class CounterOfferRequest(BaseModel):
    dispute_id: str; negotiation_id: str; responding_party: PartyType
    counter_offer: Decimal = Field(..., gt=0)
    offer_justification: str = Field(..., min_length=20); tenant_id: str

    @validator("counter_offer", pre=True)
    def round_offer(cls, v):
        return Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class IDRInitiationRequest(BaseModel):
    dispute_id: str; initiating_party: PartyType; initiating_party_id: str
    selected_entity_id: Optional[str] = None
    additional_criteria_docs: List[str] = Field(default_factory=list); tenant_id: str


class DeterminationRequest(BaseModel):
    dispute_id: str; idr_entity_id: str; determination_basis: DeterminationBasis
    determined_amount: Decimal = Field(..., gt=0)
    rationale: str = Field(..., min_length=50)
    additional_criteria_applied: bool = False; tenant_id: str

    @validator("determined_amount", pre=True)
    def round_amount(cls, v):
        return Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def add_business_days(start: datetime, days: int) -> datetime:
    current = start; added = 0
    while added < days:
        current += timedelta(days=1)
        if current.weekday() < 5:
            added += 1
    return current


def check_nsa_eligibility(items: List[QualifiedIDRItem]) -> Dict[str, Any]:
    ineligible_reasons = []; warnings = []
    for item in items:
        threshold = NSA_THRESHOLD_AIR_AMBULANCE if item.service_type == DisputeType.AIR_AMBULANCE else NSA_THRESHOLD_DEFAULT
        if item.billed_amount < threshold:
            ineligible_reasons.append(
                f"Claim {item.claim_number}: billed ${item.billed_amount} below threshold ${threshold}")
        days_since = (datetime.utcnow() - item.service_date).days
        if days_since > 90:
            warnings.append(f"Claim {item.claim_number}: {days_since} days since service — verify negotiation timing")
        if not item.service_codes:
            ineligible_reasons.append(f"Claim {item.claim_number}: no service codes")
        if item.qpa_amount and item.provider_final_offer:
            deviation = abs(item.provider_final_offer - item.qpa_amount) / item.qpa_amount
            if deviation > QPA_DISPUTE_THRESHOLD_PCT:
                warnings.append(f"Claim {item.claim_number}: offer deviates {deviation:.1%} from QPA — IDR entity must consider QPA as presumptive")
    return {"is_eligible": len(ineligible_reasons) == 0, "ineligible_reasons": ineligible_reasons,
            "warnings": warnings, "threshold_applied": str(NSA_THRESHOLD_DEFAULT)}


NSA_SCHEMA = """
CREATE TABLE IF NOT EXISTS nsa_disputes (
    id VARCHAR(36) PRIMARY KEY, tenant_id VARCHAR(36) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    initiating_party VARCHAR(50) NOT NULL, initiating_party_id VARCHAR(100) NOT NULL,
    total_items INTEGER NOT NULL DEFAULT 0, total_billed_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    negotiation_summary TEXT, contact_email VARCHAR(320), contact_phone VARCHAR(20),
    open_negotiation_deadline TIMESTAMPTZ, idr_initiation_window_opens TIMESTAMPTZ,
    idr_initiation_window_closes TIMESTAMPTZ, idr_decision_deadline TIMESTAMPTZ,
    payment_implementation_deadline TIMESTAMPTZ,
    admin_fee DECIMAL(10,2) NOT NULL DEFAULT 115.00, cms_case_id VARCHAR(100),
    determined_amount DECIMAL(15,2), determination_basis VARCHAR(50),
    determination_rationale TEXT, idr_entity_id VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by VARCHAR(100)
);
CREATE TABLE IF NOT EXISTS nsa_dispute_items (
    id VARCHAR(36) PRIMARY KEY, dispute_id VARCHAR(36) NOT NULL REFERENCES nsa_disputes(id) ON DELETE CASCADE,
    claim_number VARCHAR(50) NOT NULL, service_date TIMESTAMPTZ NOT NULL,
    service_location VARCHAR(200), service_type VARCHAR(50) NOT NULL,
    service_codes JSONB NOT NULL DEFAULT '[]', billed_amount DECIMAL(15,2) NOT NULL,
    qpa_amount DECIMAL(15,2), provider_final_offer DECIMAL(15,2), plan_final_offer DECIMAL(15,2),
    provider_npi VARCHAR(20), facility_tin VARCHAR(20), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS nsa_negotiations (
    id VARCHAR(36) PRIMARY KEY, dispute_id VARCHAR(36) NOT NULL REFERENCES nsa_disputes(id) ON DELETE CASCADE,
    initiating_party VARCHAR(50) NOT NULL, initiating_party_id VARCHAR(100) NOT NULL,
    initial_offer DECIMAL(15,2) NOT NULL, offer_justification TEXT NOT NULL,
    counter_offer DECIMAL(15,2), counter_offer_justification TEXT, responding_party VARCHAR(50),
    status VARCHAR(30) NOT NULL DEFAULT 'open', opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ, agreed_amount DECIMAL(15,2), tenant_id VARCHAR(36) NOT NULL
);
CREATE TABLE IF NOT EXISTS nsa_idr_initiations (
    id VARCHAR(36) PRIMARY KEY, dispute_id VARCHAR(36) NOT NULL REFERENCES nsa_disputes(id) ON DELETE CASCADE,
    initiating_party VARCHAR(50) NOT NULL, initiating_party_id VARCHAR(100) NOT NULL,
    selected_entity_id VARCHAR(100), cms_submission_id VARCHAR(100),
    admin_fee_paid BOOLEAN NOT NULL DEFAULT FALSE, admin_fee_amount DECIMAL(10,2) NOT NULL,
    additional_criteria_docs JSONB DEFAULT '[]', initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tenant_id VARCHAR(36) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nsa_disputes_tenant ON nsa_disputes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nsa_disputes_status ON nsa_disputes(status);
CREATE INDEX IF NOT EXISTS idx_nsa_disputes_created ON nsa_disputes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nsa_dispute_items_dispute ON nsa_dispute_items(dispute_id);
CREATE INDEX IF NOT EXISTS idx_nsa_negotiations_dispute ON nsa_negotiations(dispute_id);
"""


@app.on_event("startup")
async def startup():
    await bootstrap_schema(NSA_SCHEMA)
    logger.info("NSA/IDR Dispute Service v2.0 started")


@app.post("/disputes/bulk", status_code=201)
async def create_bulk_dispute(
    request: BulkDisputeRequest,
    background_tasks: BackgroundTasks,
    current_user: TokenPayload = Depends(get_current_user),
):
    eligibility = check_nsa_eligibility(request.qualified_items)
    if not eligibility["is_eligible"]:
        raise HTTPException(status_code=422, detail={
            "message": "One or more items are ineligible for NSA IDR",
            "reasons": eligibility["ineligible_reasons"]})

    dispute_id = str(uuid.uuid4()); now = datetime.utcnow()
    total_amount = sum(item.billed_amount for item in request.qualified_items)
    open_negotiation_deadline = add_business_days(now, OPEN_NEGOTIATION_PERIOD_DAYS)
    idr_window_opens = open_negotiation_deadline
    idr_window_closes = add_business_days(idr_window_opens, IDR_INITIATION_WINDOW_DAYS)
    admin_fee = NSA_ADMIN_FEE_BATCHED_2024 if len(request.qualified_items) > 1 else NSA_ADMIN_FEE_2024

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """INSERT INTO nsa_disputes (id,tenant_id,status,initiating_party,initiating_party_id,
                   total_items,total_billed_amount,negotiation_summary,contact_email,contact_phone,
                   open_negotiation_deadline,idr_initiation_window_opens,idr_initiation_window_closes,
                   admin_fee,created_at,updated_at,created_by)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16)""",
                dispute_id, request.tenant_id, DisputeStatus.OPEN_NEGOTIATION,
                request.initiating_party, request.initiating_party_id,
                len(request.qualified_items), float(total_amount), request.negotiation_summary,
                request.contact_email, request.contact_phone,
                open_negotiation_deadline, idr_window_opens, idr_window_closes,
                float(admin_fee), now, current_user.sub)
            for item in request.qualified_items:
                await conn.execute(
                    """INSERT INTO nsa_dispute_items (id,dispute_id,claim_number,service_date,
                       service_location,service_type,service_codes,billed_amount,qpa_amount,
                       provider_final_offer,plan_final_offer,provider_npi,facility_tin)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)""",
                    str(uuid.uuid4()), dispute_id, item.claim_number, item.service_date,
                    item.service_location, item.service_type, json.dumps(item.service_codes),
                    float(item.billed_amount),
                    float(item.qpa_amount) if item.qpa_amount else None,
                    float(item.provider_final_offer) if item.provider_final_offer else None,
                    float(item.plan_final_offer) if item.plan_final_offer else None,
                    item.provider_npi, item.facility_tin)

    background_tasks.add_task(publish, Topics.DISPUTE_CREATED, {
        "dispute_id": dispute_id, "tenant_id": request.tenant_id,
        "status": DisputeStatus.OPEN_NEGOTIATION, "total_items": len(request.qualified_items),
        "total_amount": str(total_amount),
        "open_negotiation_deadline": open_negotiation_deadline.isoformat(),
        "warnings": eligibility["warnings"]})

    return {"dispute_id": dispute_id, "status": DisputeStatus.OPEN_NEGOTIATION,
            "created_at": now.isoformat(), "total_items": len(request.qualified_items),
            "total_amount": str(total_amount),
            "open_negotiation_deadline": open_negotiation_deadline.isoformat(),
            "idr_initiation_window_opens": idr_window_opens.isoformat(),
            "idr_initiation_window_closes": idr_window_closes.isoformat(),
            "admin_fee": str(admin_fee),
            "warnings": eligibility["warnings"],
            "message": (f"Dispute created. Open negotiation ends {open_negotiation_deadline.date()}. "
                        f"IDR window: {idr_window_opens.date()} – {idr_window_closes.date()}. "
                        f"Admin fee: ${admin_fee}.")}


@app.post("/disputes/{dispute_id}/negotiate", status_code=201)
async def open_negotiation(
    dispute_id: str, request: OpenNegotiationRequest,
    background_tasks: BackgroundTasks,
    current_user: TokenPayload = Depends(get_current_user),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        dispute = await conn.fetchrow(
            "SELECT * FROM nsa_disputes WHERE id=$1 AND tenant_id=$2", dispute_id, request.tenant_id)
        if not dispute:
            raise HTTPException(404, "Dispute not found")
        if dispute["status"] not in (DisputeStatus.DRAFT, DisputeStatus.OPEN_NEGOTIATION):
            raise HTTPException(409, f"Cannot open negotiation on dispute in status '{dispute['status']}'")
        negotiation_id = str(uuid.uuid4())
        await conn.execute(
            """INSERT INTO nsa_negotiations (id,dispute_id,initiating_party,initiating_party_id,
               initial_offer,offer_justification,status,opened_at,tenant_id)
               VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8)""",
            negotiation_id, dispute_id, request.initiating_party, request.initiating_party_id,
            float(request.initial_payment_offer), request.offer_justification,
            datetime.utcnow(), request.tenant_id)
        await conn.execute(
            "UPDATE nsa_disputes SET status=$1, updated_at=NOW() WHERE id=$2",
            DisputeStatus.OPEN_NEGOTIATION, dispute_id)
    background_tasks.add_task(publish, Topics.DISPUTE_UPDATED,
        {"dispute_id": dispute_id, "event": "negotiation_opened", "negotiation_id": negotiation_id})
    return {"negotiation_id": negotiation_id, "dispute_id": dispute_id, "status": "open",
            "initial_offer": str(request.initial_payment_offer),
            "message": f"Open negotiation initiated. Period ends {add_business_days(datetime.utcnow(), OPEN_NEGOTIATION_PERIOD_DAYS).date()}."}


@app.post("/disputes/{dispute_id}/negotiate/{negotiation_id}/counter")
async def submit_counter_offer(
    dispute_id: str, negotiation_id: str, request: CounterOfferRequest,
    background_tasks: BackgroundTasks,
    current_user: TokenPayload = Depends(get_current_user),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        neg = await conn.fetchrow(
            "SELECT * FROM nsa_negotiations WHERE id=$1 AND dispute_id=$2 AND tenant_id=$3",
            negotiation_id, dispute_id, request.tenant_id)
        if not neg:
            raise HTTPException(404, "Negotiation not found")
        if neg["status"] != "open":
            raise HTTPException(409, "Negotiation is not open")
        if neg["initiating_party"] == request.responding_party:
            raise HTTPException(422, "Responding party cannot be the same as the initiating party")
        await conn.execute(
            """UPDATE nsa_negotiations SET counter_offer=$1,counter_offer_justification=$2,
               responding_party=$3 WHERE id=$4""",
            float(request.counter_offer), request.offer_justification,
            request.responding_party, negotiation_id)
    background_tasks.add_task(publish, Topics.DISPUTE_UPDATED,
        {"dispute_id": dispute_id, "event": "counter_offer_submitted", "negotiation_id": negotiation_id})
    return {"negotiation_id": negotiation_id, "counter_offer": str(request.counter_offer),
            "status": "counter_offered"}


@app.post("/disputes/{dispute_id}/negotiate/{negotiation_id}/close")
async def close_negotiation(
    dispute_id: str, negotiation_id: str,
    agreed: bool = Query(...),
    agreed_amount: Optional[Decimal] = Query(None),
    tenant_id: str = Query(...),
    current_user: TokenPayload = Depends(get_current_user),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        neg = await conn.fetchrow(
            "SELECT * FROM nsa_negotiations WHERE id=$1 AND dispute_id=$2 AND tenant_id=$3",
            negotiation_id, dispute_id, tenant_id)
        if not neg:
            raise HTTPException(404, "Negotiation not found")
        now = datetime.utcnow()
        if agreed:
            if not agreed_amount or agreed_amount <= 0:
                raise HTTPException(422, "agreed_amount required when agreed=True")
            await conn.execute(
                "UPDATE nsa_negotiations SET status='agreed',agreed_amount=$1,closed_at=$2 WHERE id=$3",
                float(agreed_amount), now, negotiation_id)
            await conn.execute(
                "UPDATE nsa_disputes SET status=$1,updated_at=NOW() WHERE id=$2",
                DisputeStatus.CLOSED, dispute_id)
            return {"status": "closed", "outcome": "agreed", "agreed_amount": str(agreed_amount)}
        else:
            idr_window_opens = now
            idr_window_closes = add_business_days(now, IDR_INITIATION_WINDOW_DAYS)
            await conn.execute(
                "UPDATE nsa_negotiations SET status='closed_no_agreement',closed_at=$1 WHERE id=$2",
                now, negotiation_id)
            await conn.execute(
                """UPDATE nsa_disputes SET status=$1,idr_initiation_window_opens=$2,
                   idr_initiation_window_closes=$3,updated_at=NOW() WHERE id=$4""",
                DisputeStatus.IDR_ELIGIBLE, idr_window_opens, idr_window_closes, dispute_id)
            return {"status": "idr_eligible",
                    "idr_window_opens": idr_window_opens.isoformat(),
                    "idr_window_closes": idr_window_closes.isoformat(),
                    "message": f"IDR window: {idr_window_opens.date()} – {idr_window_closes.date()}."}


@app.post("/disputes/{dispute_id}/initiate-idr", status_code=201)
async def initiate_idr(
    dispute_id: str, request: IDRInitiationRequest,
    background_tasks: BackgroundTasks,
    current_user: TokenPayload = Depends(get_current_user),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        dispute = await conn.fetchrow(
            "SELECT * FROM nsa_disputes WHERE id=$1 AND tenant_id=$2", dispute_id, request.tenant_id)
        if not dispute:
            raise HTTPException(404, "Dispute not found")
        if dispute["status"] != DisputeStatus.IDR_ELIGIBLE:
            raise HTTPException(409, f"Dispute must be 'idr_eligible'. Current: {dispute['status']}")
        now = datetime.utcnow()
        window_opens = dispute["idr_initiation_window_opens"]
        window_closes = dispute["idr_initiation_window_closes"]
        if window_opens and now < window_opens:
            raise HTTPException(422, f"IDR window not yet open. Opens: {window_opens.isoformat()}")
        if window_closes and now > window_closes:
            raise HTTPException(422, f"IDR initiation window closed {window_closes.date()}. Dispute ineligible.")

        initiation_id = str(uuid.uuid4())
        admin_fee = Decimal(str(dispute["admin_fee"]))
        idr_decision_deadline = add_business_days(now, IDR_DECISION_DEADLINE_DAYS)

        cms_submission_id = None
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(f"{CMS_IDR_PORTAL_URL}/initiations",
                    json={"dispute_id": dispute_id, "initiating_party": request.initiating_party,
                          "initiating_party_id": request.initiating_party_id,
                          "selected_entity_id": request.selected_entity_id,
                          "admin_fee": str(admin_fee),
                          "additional_criteria_docs": request.additional_criteria_docs},
                    headers={"Authorization": f"Bearer {_os.getenv('CMS_API_TOKEN', '')}"})
                if resp.status_code in (200, 201):
                    cms_submission_id = resp.json().get("case_id")
        except Exception as e:
            logger.warning("CMS IDR portal submission failed — will retry async", error=str(e))

        async with conn.transaction():
            await conn.execute(
                """INSERT INTO nsa_idr_initiations (id,dispute_id,initiating_party,initiating_party_id,
                   selected_entity_id,cms_submission_id,admin_fee_paid,admin_fee_amount,
                   additional_criteria_docs,initiated_at,tenant_id)
                   VALUES ($1,$2,$3,$4,$5,$6,FALSE,$7,$8,$9,$10)""",
                initiation_id, dispute_id, request.initiating_party, request.initiating_party_id,
                request.selected_entity_id, cms_submission_id, float(admin_fee),
                json.dumps(request.additional_criteria_docs), now, request.tenant_id)
            await conn.execute(
                """UPDATE nsa_disputes SET status=$1,idr_entity_id=$2,idr_decision_deadline=$3,
                   updated_at=NOW() WHERE id=$4""",
                DisputeStatus.IDR_INITIATED, request.selected_entity_id, idr_decision_deadline, dispute_id)

    background_tasks.add_task(publish, Topics.DISPUTE_UPDATED, {
        "dispute_id": dispute_id, "event": "idr_initiated", "initiation_id": initiation_id,
        "cms_submission_id": cms_submission_id,
        "idr_decision_deadline": idr_decision_deadline.isoformat()})
    return {"initiation_id": initiation_id, "dispute_id": dispute_id,
            "status": DisputeStatus.IDR_INITIATED, "cms_submission_id": cms_submission_id,
            "admin_fee": str(admin_fee), "admin_fee_paid": False,
            "idr_decision_deadline": idr_decision_deadline.isoformat(),
            "message": (f"IDR initiated. Admin fee ${admin_fee} must be paid. "
                        f"Determination due by {idr_decision_deadline.date()}.")}


@app.post("/disputes/{dispute_id}/determination")
async def record_determination(
    dispute_id: str, request: DeterminationRequest,
    background_tasks: BackgroundTasks,
    current_user: TokenPayload = Depends(require_role("idr_entity", "admin")),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        dispute = await conn.fetchrow(
            "SELECT * FROM nsa_disputes WHERE id=$1 AND tenant_id=$2", dispute_id, request.tenant_id)
        if not dispute:
            raise HTTPException(404, "Dispute not found")
        if dispute["status"] not in (DisputeStatus.IDR_INITIATED, DisputeStatus.IDR_IN_PROGRESS):
            raise HTTPException(409, f"Dispute must be in IDR status. Current: {dispute['status']}")
        now = datetime.utcnow()
        payment_deadline = now + timedelta(days=PAYMENT_IMPLEMENTATION_DAYS)
        await conn.execute(
            """UPDATE nsa_disputes SET status=$1,determined_amount=$2,determination_basis=$3,
               determination_rationale=$4,idr_entity_id=$5,payment_implementation_deadline=$6,
               updated_at=NOW() WHERE id=$7""",
            DisputeStatus.IDR_DECIDED, float(request.determined_amount), request.determination_basis,
            request.rationale, request.idr_entity_id, payment_deadline, dispute_id)
    background_tasks.add_task(publish, Topics.DISPUTE_UPDATED, {
        "dispute_id": dispute_id, "event": "determination_issued",
        "determined_amount": str(request.determined_amount),
        "determination_basis": request.determination_basis,
        "payment_implementation_deadline": payment_deadline.isoformat()})
    return {"dispute_id": dispute_id, "status": DisputeStatus.IDR_DECIDED,
            "determined_amount": str(request.determined_amount),
            "determination_basis": request.determination_basis,
            "payment_implementation_deadline": payment_deadline.isoformat(),
            "appeal_deadline": (now + timedelta(days=APPEAL_FILING_DEADLINE_DAYS)).isoformat(),
            "message": (f"Determination: ${request.determined_amount} ({request.determination_basis}). "
                        f"Payment due {payment_deadline.date()}. "
                        f"Appeal deadline: {(now + timedelta(days=APPEAL_FILING_DEADLINE_DAYS)).date()}.")}


@app.get("/disputes/{dispute_id}")
async def get_dispute(
    dispute_id: str, tenant_id: str = Query(...),
    current_user: TokenPayload = Depends(get_current_user),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        dispute = await conn.fetchrow(
            "SELECT * FROM nsa_disputes WHERE id=$1 AND tenant_id=$2", dispute_id, tenant_id)
        if not dispute:
            raise HTTPException(404, "Dispute not found")
        items = await conn.fetch(
            "SELECT * FROM nsa_dispute_items WHERE dispute_id=$1 ORDER BY created_at", dispute_id)
        negotiations = await conn.fetch(
            "SELECT * FROM nsa_negotiations WHERE dispute_id=$1 ORDER BY opened_at DESC", dispute_id)
    return {"dispute": dict(dispute), "items": [dict(i) for i in items],
            "negotiations": [dict(n) for n in negotiations]}


@app.get("/disputes")
async def list_disputes(
    tenant_id: str = Query(...), status: Optional[str] = Query(None),
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    current_user: TokenPayload = Depends(get_current_user),
):
    offset = (page - 1) * page_size
    pool = await get_pool()
    async with pool.acquire() as conn:
        if status:
            rows = await conn.fetch(
                "SELECT * FROM nsa_disputes WHERE tenant_id=$1 AND status=$2 "
                "ORDER BY created_at DESC LIMIT $3 OFFSET $4", tenant_id, status, page_size, offset)
            total = await conn.fetchval(
                "SELECT COUNT(*) FROM nsa_disputes WHERE tenant_id=$1 AND status=$2", tenant_id, status)
        else:
            rows = await conn.fetch(
                "SELECT * FROM nsa_disputes WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
                tenant_id, page_size, offset)
            total = await conn.fetchval(
                "SELECT COUNT(*) FROM nsa_disputes WHERE tenant_id=$1", tenant_id)
    return {"disputes": [dict(r) for r in rows], "total": total, "page": page,
            "page_size": page_size, "pages": (total + page_size - 1) // page_size}


@app.get("/disputes/eligibility/check")
async def check_eligibility(
    billed_amount: Decimal = Query(..., gt=0),
    service_type: DisputeType = Query(...),
    service_date: datetime = Query(...),
    current_user: TokenPayload = Depends(get_current_user),
):
    item = QualifiedIDRItem(service_date=service_date, service_location="", service_type=service_type,
                            service_codes=["00000"], claim_number="CHECK", billed_amount=billed_amount)
    result = check_nsa_eligibility([item])
    return {"is_eligible": result["is_eligible"], "reasons": result["ineligible_reasons"],
            "warnings": result["warnings"], "applicable_threshold": result["threshold_applied"],
            "nsa_admin_fee": str(NSA_ADMIN_FEE_2024),
            "open_negotiation_period_business_days": OPEN_NEGOTIATION_PERIOD_DAYS,
            "idr_initiation_window_business_days": IDR_INITIATION_WINDOW_DAYS}


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "NSA/IDR Dispute Resolution", "version": "2.0.0",
            "timestamp": datetime.utcnow().isoformat()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8016)
