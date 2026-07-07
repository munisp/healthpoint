"""
SQLAlchemy ORM models for the HealthPoint NSA/IDR Platform.
All tables are defined here so Alembic can auto-detect schema changes.
These models mirror the CREATE TABLE statements in each service's startup hook.
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, Float, ForeignKey,
    Integer, JSON, LargeBinary, Numeric, String, Text,
    UniqueConstraint, Index, BigInteger,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    pass


def gen_uuid():
    return str(uuid.uuid4())


# ── Enums ─────────────────────────────────────────────────────────────────────

class DisputeStatus(str, enum.Enum):
    SUBMITTED = "submitted"
    OPEN_NEGOTIATION = "open_negotiation"
    IDR_INITIATED = "idr_initiated"
    PENDING_DETERMINATION = "pending_determination"
    DETERMINATION_ISSUED = "determination_issued"
    PAYMENT_PENDING = "payment_pending"
    PAYMENT_COMPLETE = "payment_complete"
    APPEALED = "appealed"
    CLOSED = "closed"
    WITHDRAWN = "withdrawn"


class ClaimStatus(str, enum.Enum):
    RECEIVED = "received"
    VALIDATED = "validated"
    ADJUDICATED = "adjudicated"
    PAID = "paid"
    DENIED = "denied"
    APPEALED = "appealed"
    VOID = "void"


class PaymentStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    REVERSED = "reversed"
    VOIDED = "voided"


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    PROVIDER = "provider"
    PAYER = "payer"
    IDR_ENTITY = "idr_entity"
    PATIENT = "patient"
    AUDITOR = "auditor"
    REGULATOR = "regulator"


class GFEStatus(str, enum.Enum):
    DRAFT = "draft"
    ISSUED = "issued"
    ACKNOWLEDGED = "acknowledged"
    DISPUTED = "disputed"
    EXPIRED = "expired"


class AppealStatus(str, enum.Enum):
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    UPHELD = "upheld"
    OVERTURNED = "overturned"
    WITHDRAWN = "withdrawn"


# ── Users & Authentication ────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    keycloak_id = Column(String(255), unique=True, nullable=True, index=True)
    email = Column(String(320), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.PROVIDER)
    organization_id = Column(UUID(as_uuid=False), ForeignKey("organizations.id"), nullable=True)
    tenant_id = Column(String(64), nullable=True, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    mfa_enabled = Column(Boolean, default=False, nullable=False)
    last_login = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_users_tenant_role", "tenant_id", "role"),
    )


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    name = Column(String(255), nullable=False)
    npi = Column(String(10), nullable=True, index=True)
    tax_id = Column(String(20), nullable=True)
    org_type = Column(String(50), nullable=False)  # provider, payer, idr_entity
    address = Column(JSONB, nullable=True)
    contact = Column(JSONB, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True, index=True)
    action = Column(String(100), nullable=False)
    resource_type = Column(String(100), nullable=False)
    resource_id = Column(String(255), nullable=True)
    tenant_id = Column(String(64), nullable=True, index=True)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)
    request_id = Column(String(64), nullable=True)
    details = Column(JSONB, nullable=True)
    severity = Column(String(20), default="info", nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    __table_args__ = (
        Index("ix_audit_logs_resource", "resource_type", "resource_id"),
        Index("ix_audit_logs_created_at", "created_at"),
    )


# ── NSA/IDR Disputes ─────────────────────────────────────────────────────────

class IDRDispute(Base):
    __tablename__ = "idr_disputes"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    case_number = Column(String(50), unique=True, nullable=False, index=True)
    status = Column(Enum(DisputeStatus), nullable=False, default=DisputeStatus.SUBMITTED, index=True)
    provider_id = Column(UUID(as_uuid=False), ForeignKey("organizations.id"), nullable=False, index=True)
    payer_id = Column(UUID(as_uuid=False), ForeignKey("organizations.id"), nullable=False, index=True)
    idr_entity_id = Column(UUID(as_uuid=False), ForeignKey("organizations.id"), nullable=True)
    claim_id = Column(UUID(as_uuid=False), ForeignKey("claims.id"), nullable=True)
    # Financial amounts
    billed_amount = Column(Numeric(12, 2), nullable=False)
    qpa_amount = Column(Numeric(12, 2), nullable=False)
    provider_offer = Column(Numeric(12, 2), nullable=True)
    payer_offer = Column(Numeric(12, 2), nullable=True)
    determination_amount = Column(Numeric(12, 2), nullable=True)
    # NSA compliance fields
    open_negotiation_deadline = Column(DateTime(timezone=True), nullable=True)
    idr_initiation_deadline = Column(DateTime(timezone=True), nullable=True)
    determination_deadline = Column(DateTime(timezone=True), nullable=True)
    payment_deadline = Column(DateTime(timezone=True), nullable=True)
    # Metadata
    service_code = Column(String(20), nullable=True)
    service_description = Column(Text, nullable=True)
    service_date = Column(DateTime(timezone=True), nullable=True)
    facility_type = Column(String(50), nullable=True)
    batched_dispute = Column(Boolean, default=False, nullable=False)
    batch_id = Column(String(50), nullable=True, index=True)
    admin_fee_paid = Column(Boolean, default=False, nullable=False)
    admin_fee_amount = Column(Numeric(8, 2), nullable=True)
    notes = Column(Text, nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_idr_disputes_status_created", "status", "created_at"),
        Index("ix_idr_disputes_provider_payer", "provider_id", "payer_id"),
    )


class DisputeTimeline(Base):
    __tablename__ = "dispute_timeline"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    dispute_id = Column(UUID(as_uuid=False), ForeignKey("idr_disputes.id"), nullable=False, index=True)
    event_type = Column(String(100), nullable=False)
    event_data = Column(JSONB, nullable=True)
    actor_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ── Claims ────────────────────────────────────────────────────────────────────

class Claim(Base):
    __tablename__ = "claims"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    claim_number = Column(String(50), unique=True, nullable=False, index=True)
    status = Column(Enum(ClaimStatus), nullable=False, default=ClaimStatus.RECEIVED, index=True)
    provider_id = Column(UUID(as_uuid=False), ForeignKey("organizations.id"), nullable=False, index=True)
    payer_id = Column(UUID(as_uuid=False), ForeignKey("organizations.id"), nullable=False, index=True)
    patient_id = Column(UUID(as_uuid=False), ForeignKey("patients.id"), nullable=True, index=True)
    # Financial
    billed_amount = Column(Numeric(12, 2), nullable=False)
    allowed_amount = Column(Numeric(12, 2), nullable=True)
    paid_amount = Column(Numeric(12, 2), nullable=True)
    patient_responsibility = Column(Numeric(12, 2), nullable=True)
    # EDI
    claim_type = Column(String(10), nullable=False)  # 837P, 837I, 837D
    edi_transaction_id = Column(String(50), nullable=True, index=True)
    # Service info
    service_date_from = Column(DateTime(timezone=True), nullable=True)
    service_date_to = Column(DateTime(timezone=True), nullable=True)
    diagnosis_codes = Column(ARRAY(String), nullable=True)
    procedure_codes = Column(ARRAY(String), nullable=True)
    place_of_service = Column(String(10), nullable=True)
    # Timely filing
    received_date = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    timely_filing_deadline = Column(DateTime(timezone=True), nullable=True)
    adjudication_date = Column(DateTime(timezone=True), nullable=True)
    payment_date = Column(DateTime(timezone=True), nullable=True)
    denial_reason = Column(String(255), nullable=True)
    raw_edi = Column(Text, nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_claims_status_received", "status", "received_date"),
        Index("ix_claims_provider_payer", "provider_id", "payer_id"),
    )


# ── Patients ──────────────────────────────────────────────────────────────────

class Patient(Base):
    __tablename__ = "patients"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    mrn = Column(String(50), unique=True, nullable=True, index=True)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    date_of_birth = Column(DateTime(timezone=True), nullable=True)
    gender = Column(String(20), nullable=True)
    ssn_hash = Column(String(64), nullable=True)  # SHA-256 hash only, never plaintext
    address = Column(JSONB, nullable=True)
    contact = Column(JSONB, nullable=True)
    insurance_info = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ── Payments ──────────────────────────────────────────────────────────────────

class Payment(Base):
    __tablename__ = "payments"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    idempotency_key = Column(String(64), unique=True, nullable=False, index=True)
    status = Column(Enum(PaymentStatus), nullable=False, default=PaymentStatus.PENDING, index=True)
    dispute_id = Column(UUID(as_uuid=False), ForeignKey("idr_disputes.id"), nullable=True, index=True)
    claim_id = Column(UUID(as_uuid=False), ForeignKey("claims.id"), nullable=True, index=True)
    payer_id = Column(UUID(as_uuid=False), ForeignKey("organizations.id"), nullable=False)
    provider_id = Column(UUID(as_uuid=False), ForeignKey("organizations.id"), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(3), default="USD", nullable=False)
    payment_method = Column(String(50), nullable=True)
    # TigerBeetle ledger references
    tigerbeetle_transfer_id = Column(BigInteger, nullable=True, unique=True)
    tigerbeetle_debit_account_id = Column(BigInteger, nullable=True)
    tigerbeetle_credit_account_id = Column(BigInteger, nullable=True)
    tigerbeetle_phase = Column(String(20), nullable=True)  # pending, posted, voided
    # Mojaloop
    mojaloop_transfer_id = Column(String(36), nullable=True, unique=True)
    # Dates
    due_date = Column(DateTime(timezone=True), nullable=True)
    paid_date = Column(DateTime(timezone=True), nullable=True)
    # Late payment
    late_payment_interest = Column(Numeric(10, 4), nullable=True)
    interest_start_date = Column(DateTime(timezone=True), nullable=True)
    # Metadata
    notes = Column(Text, nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_payments_status_created", "status", "created_at"),
    )


# ── GFE (Good Faith Estimates) ────────────────────────────────────────────────

class GoodFaithEstimate(Base):
    __tablename__ = "good_faith_estimates"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    gfe_number = Column(String(50), unique=True, nullable=False, index=True)
    status = Column(Enum(GFEStatus), nullable=False, default=GFEStatus.DRAFT, index=True)
    provider_id = Column(UUID(as_uuid=False), ForeignKey("organizations.id"), nullable=False, index=True)
    patient_id = Column(UUID(as_uuid=False), ForeignKey("patients.id"), nullable=True)
    # NSA compliance: GFE must be issued within 3 business days of scheduling
    scheduled_date = Column(DateTime(timezone=True), nullable=True)
    issue_deadline = Column(DateTime(timezone=True), nullable=True)
    issued_at = Column(DateTime(timezone=True), nullable=True)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    # Financial
    estimated_cost_low = Column(Numeric(12, 2), nullable=True)
    estimated_cost_high = Column(Numeric(12, 2), nullable=True)
    service_items = Column(JSONB, nullable=True)
    # Metadata
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ── Admin Fees ────────────────────────────────────────────────────────────────

class AdminFee(Base):
    __tablename__ = "admin_fees"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    dispute_id = Column(UUID(as_uuid=False), ForeignKey("idr_disputes.id"), nullable=False, unique=True, index=True)
    fee_year = Column(Integer, nullable=False)
    fee_amount = Column(Numeric(8, 2), nullable=False)
    paid_by = Column(String(50), nullable=False)  # provider or payer
    paid_at = Column(DateTime(timezone=True), nullable=True)
    payment_reference = Column(String(100), nullable=True)
    waived = Column(Boolean, default=False, nullable=False)
    waiver_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ── Appeals ───────────────────────────────────────────────────────────────────

class Appeal(Base):
    __tablename__ = "appeals"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    appeal_number = Column(String(50), unique=True, nullable=False, index=True)
    status = Column(Enum(AppealStatus), nullable=False, default=AppealStatus.SUBMITTED, index=True)
    dispute_id = Column(UUID(as_uuid=False), ForeignKey("idr_disputes.id"), nullable=True, index=True)
    claim_id = Column(UUID(as_uuid=False), ForeignKey("claims.id"), nullable=True, index=True)
    submitted_by = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)
    # NSA: 30-day appeal window from determination
    determination_date = Column(DateTime(timezone=True), nullable=True)
    appeal_deadline = Column(DateTime(timezone=True), nullable=True)
    submitted_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    reason = Column(Text, nullable=False)
    reviewer_notes = Column(Text, nullable=True)
    outcome = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ── Documents ─────────────────────────────────────────────────────────────────

class Document(Base):
    __tablename__ = "documents"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    filename = Column(String(255), nullable=False)
    content_type = Column(String(100), nullable=False)
    file_size = Column(BigInteger, nullable=False)
    s3_key = Column(String(500), nullable=False, unique=True)
    s3_bucket = Column(String(100), nullable=False)
    resource_type = Column(String(50), nullable=False, index=True)
    resource_id = Column(UUID(as_uuid=False), nullable=True, index=True)
    uploaded_by = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    checksum_sha256 = Column(String(64), nullable=True)
    is_encrypted = Column(Boolean, default=True, nullable=False)
    retention_until = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_documents_resource", "resource_type", "resource_id"),
    )


# ── Notifications ─────────────────────────────────────────────────────────────

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    recipient_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True, index=True)
    recipient_email = Column(String(320), nullable=True)
    recipient_phone = Column(String(20), nullable=True)
    channel = Column(String(20), nullable=False)  # email, sms, push, webhook
    subject = Column(String(255), nullable=True)
    body = Column(Text, nullable=False)
    template_id = Column(String(50), nullable=True)
    template_vars = Column(JSONB, nullable=True)
    resource_type = Column(String(50), nullable=True)
    resource_id = Column(String(255), nullable=True)
    status = Column(String(20), default="pending", nullable=False, index=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    failed_at = Column(DateTime(timezone=True), nullable=True)
    failure_reason = Column(Text, nullable=True)
    retry_count = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_notifications_status_created", "status", "created_at"),
    )


# ── Fraud Detection ───────────────────────────────────────────────────────────

class FraudAlert(Base):
    __tablename__ = "fraud_alerts"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    alert_type = Column(String(50), nullable=False, index=True)
    severity = Column(String(20), nullable=False, index=True)  # low, medium, high, critical
    resource_type = Column(String(50), nullable=False)
    resource_id = Column(UUID(as_uuid=False), nullable=True)
    organization_id = Column(UUID(as_uuid=False), ForeignKey("organizations.id"), nullable=True, index=True)
    risk_score = Column(Float, nullable=False)
    features = Column(JSONB, nullable=True)
    model_version = Column(String(20), nullable=True)
    status = Column(String(20), default="open", nullable=False, index=True)
    reviewed_by = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    resolution = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_fraud_alerts_severity_status", "severity", "status"),
    )


# ── IDR Entity Selection ──────────────────────────────────────────────────────

class IDREntity(Base):
    __tablename__ = "idr_entities"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    organization_id = Column(UUID(as_uuid=False), ForeignKey("organizations.id"), nullable=False, unique=True)
    certification_number = Column(String(50), unique=True, nullable=False, index=True)
    certification_status = Column(String(20), nullable=False, default="active")
    certification_expiry = Column(DateTime(timezone=True), nullable=True)
    specializations = Column(ARRAY(String), nullable=True)
    max_concurrent_cases = Column(Integer, default=100, nullable=False)
    current_case_count = Column(Integer, default=0, nullable=False)
    average_resolution_days = Column(Float, nullable=True)
    total_cases_resolved = Column(Integer, default=0, nullable=False)
    geographic_coverage = Column(ARRAY(String), nullable=True)
    is_available = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ── Workflow Engine ───────────────────────────────────────────────────────────

class WorkflowInstance(Base):
    __tablename__ = "workflow_instances"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    workflow_type = Column(String(50), nullable=False, index=True)
    resource_type = Column(String(50), nullable=False)
    resource_id = Column(UUID(as_uuid=False), nullable=False, index=True)
    temporal_workflow_id = Column(String(255), nullable=True, unique=True)
    temporal_run_id = Column(String(255), nullable=True)
    status = Column(String(30), nullable=False, default="running", index=True)
    current_step = Column(String(100), nullable=True)
    input_data = Column(JSONB, nullable=True)
    output_data = Column(JSONB, nullable=True)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_workflow_resource", "resource_type", "resource_id"),
    )


# ── Analytics & Reporting ─────────────────────────────────────────────────────

class AnalyticsSnapshot(Base):
    __tablename__ = "analytics_snapshots"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    snapshot_type = Column(String(50), nullable=False, index=True)
    period_start = Column(DateTime(timezone=True), nullable=False)
    period_end = Column(DateTime(timezone=True), nullable=False)
    tenant_id = Column(String(64), nullable=True, index=True)
    metrics = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("snapshot_type", "period_start", "tenant_id", name="uq_analytics_snapshot"),
        Index("ix_analytics_snapshots_period", "period_start", "period_end"),
    )


# ── Configuration ─────────────────────────────────────────────────────────────

class PlatformConfig(Base):
    __tablename__ = "platform_configs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    key = Column(String(255), nullable=False)
    value = Column(JSONB, nullable=False)
    tenant_id = Column(String(64), nullable=True)
    description = Column(Text, nullable=True)
    is_secret = Column(Boolean, default=False, nullable=False)
    created_by = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("key", "tenant_id", name="uq_platform_config_key_tenant"),
    )


# ── Aggregator Reconciliation ─────────────────────────────────────────────────

class ReconciliationRecord(Base):
    __tablename__ = "reconciliation_records"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    reconciliation_date = Column(DateTime(timezone=True), nullable=False, index=True)
    aggregator_id = Column(UUID(as_uuid=False), ForeignKey("organizations.id"), nullable=False, index=True)
    total_claims = Column(Integer, nullable=False, default=0)
    matched_claims = Column(Integer, nullable=False, default=0)
    unmatched_claims = Column(Integer, nullable=False, default=0)
    total_amount = Column(Numeric(14, 2), nullable=False, default=0)
    matched_amount = Column(Numeric(14, 2), nullable=False, default=0)
    discrepancy_amount = Column(Numeric(14, 2), nullable=False, default=0)
    status = Column(String(30), nullable=False, default="pending", index=True)
    details = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
