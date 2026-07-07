"""Initial schema — all HealthPoint NSA/IDR tables

Revision ID: 0001_initial
Revises: (none)
Create Date: 2024-01-01 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── organizations ────────────────────────────────────────────────────────
    op.create_table(
        "organizations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("npi", sa.String(10), nullable=True),
        sa.Column("tax_id", sa.String(20), nullable=True),
        sa.Column("org_type", sa.String(50), nullable=False),
        sa.Column("address", postgresql.JSONB, nullable=True),
        sa.Column("contact", postgresql.JSONB, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=True),
    )
    op.create_index("ix_organizations_npi", "organizations", ["npi"])

    # ── users ────────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("keycloak_id", sa.String(255), nullable=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("role", sa.Enum("admin", "provider", "payer", "idr_entity", "patient", "auditor", "regulator", name="userrole"), nullable=False, server_default="provider"),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=True),
        sa.Column("tenant_id", sa.String(64), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("mfa_enabled", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=True),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_keycloak_id", "users", ["keycloak_id"], unique=True)
    op.create_index("ix_users_tenant_role", "users", ["tenant_id", "role"])

    # ── patients ─────────────────────────────────────────────────────────────
    op.create_table(
        "patients",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("mrn", sa.String(50), nullable=True),
        sa.Column("first_name", sa.String(100), nullable=False),
        sa.Column("last_name", sa.String(100), nullable=False),
        sa.Column("date_of_birth", sa.DateTime(timezone=True), nullable=True),
        sa.Column("gender", sa.String(20), nullable=True),
        sa.Column("ssn_hash", sa.String(64), nullable=True),
        sa.Column("address", postgresql.JSONB, nullable=True),
        sa.Column("contact", postgresql.JSONB, nullable=True),
        sa.Column("insurance_info", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=True),
    )
    op.create_index("ix_patients_mrn", "patients", ["mrn"], unique=True)

    # ── claims ───────────────────────────────────────────────────────────────
    op.create_table(
        "claims",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("claim_number", sa.String(50), nullable=False),
        sa.Column("status", sa.Enum("received", "validated", "adjudicated", "paid", "denied", "appealed", "void", name="claimstatus"), nullable=False, server_default="received"),
        sa.Column("provider_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("payer_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("patient_id", sa.String(36), sa.ForeignKey("patients.id"), nullable=True),
        sa.Column("billed_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("allowed_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("paid_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("patient_responsibility", sa.Numeric(12, 2), nullable=True),
        sa.Column("claim_type", sa.String(10), nullable=False),
        sa.Column("edi_transaction_id", sa.String(50), nullable=True),
        sa.Column("service_date_from", sa.DateTime(timezone=True), nullable=True),
        sa.Column("service_date_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("diagnosis_codes", postgresql.ARRAY(sa.String), nullable=True),
        sa.Column("procedure_codes", postgresql.ARRAY(sa.String), nullable=True),
        sa.Column("place_of_service", sa.String(10), nullable=True),
        sa.Column("received_date", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("timely_filing_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("adjudication_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payment_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("denial_reason", sa.String(255), nullable=True),
        sa.Column("raw_edi", sa.Text, nullable=True),
        sa.Column("metadata", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=True),
    )
    op.create_index("ix_claims_claim_number", "claims", ["claim_number"], unique=True)
    op.create_index("ix_claims_status_received", "claims", ["status", "received_date"])
    op.create_index("ix_claims_provider_payer", "claims", ["provider_id", "payer_id"])
    op.create_index("ix_claims_edi_transaction_id", "claims", ["edi_transaction_id"])

    # ── idr_disputes ─────────────────────────────────────────────────────────
    op.create_table(
        "idr_disputes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("case_number", sa.String(50), nullable=False),
        sa.Column("status", sa.Enum("submitted", "open_negotiation", "idr_initiated", "pending_determination", "determination_issued", "payment_pending", "payment_complete", "appealed", "closed", "withdrawn", name="disputestatus"), nullable=False, server_default="submitted"),
        sa.Column("provider_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("payer_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("idr_entity_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=True),
        sa.Column("claim_id", sa.String(36), sa.ForeignKey("claims.id"), nullable=True),
        sa.Column("billed_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("qpa_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("provider_offer", sa.Numeric(12, 2), nullable=True),
        sa.Column("payer_offer", sa.Numeric(12, 2), nullable=True),
        sa.Column("determination_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("open_negotiation_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("idr_initiation_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("determination_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payment_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("service_code", sa.String(20), nullable=True),
        sa.Column("service_description", sa.Text, nullable=True),
        sa.Column("service_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("facility_type", sa.String(50), nullable=True),
        sa.Column("batched_dispute", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("batch_id", sa.String(50), nullable=True),
        sa.Column("admin_fee_paid", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("admin_fee_amount", sa.Numeric(8, 2), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("metadata", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=True),
    )
    op.create_index("ix_idr_disputes_case_number", "idr_disputes", ["case_number"], unique=True)
    op.create_index("ix_idr_disputes_status_created", "idr_disputes", ["status", "created_at"])
    op.create_index("ix_idr_disputes_provider_payer", "idr_disputes", ["provider_id", "payer_id"])
    op.create_index("ix_idr_disputes_batch_id", "idr_disputes", ["batch_id"])

    # ── dispute_timeline ──────────────────────────────────────────────────────
    op.create_table(
        "dispute_timeline",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("dispute_id", sa.String(36), sa.ForeignKey("idr_disputes.id"), nullable=False),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("event_data", postgresql.JSONB, nullable=True),
        sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )
    op.create_index("ix_dispute_timeline_dispute_id", "dispute_timeline", ["dispute_id"])

    # ── payments ──────────────────────────────────────────────────────────────
    op.create_table(
        "payments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("idempotency_key", sa.String(64), nullable=False),
        sa.Column("status", sa.Enum("pending", "processing", "completed", "failed", "reversed", "voided", name="paymentstatus"), nullable=False, server_default="pending"),
        sa.Column("dispute_id", sa.String(36), sa.ForeignKey("idr_disputes.id"), nullable=True),
        sa.Column("claim_id", sa.String(36), sa.ForeignKey("claims.id"), nullable=True),
        sa.Column("payer_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("provider_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("payment_method", sa.String(50), nullable=True),
        sa.Column("tigerbeetle_transfer_id", sa.BigInteger, nullable=True),
        sa.Column("tigerbeetle_debit_account_id", sa.BigInteger, nullable=True),
        sa.Column("tigerbeetle_credit_account_id", sa.BigInteger, nullable=True),
        sa.Column("tigerbeetle_phase", sa.String(20), nullable=True),
        sa.Column("mojaloop_transfer_id", sa.String(36), nullable=True),
        sa.Column("due_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("late_payment_interest", sa.Numeric(10, 4), nullable=True),
        sa.Column("interest_start_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("metadata", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=True),
    )
    op.create_index("ix_payments_idempotency_key", "payments", ["idempotency_key"], unique=True)
    op.create_index("ix_payments_status_created", "payments", ["status", "created_at"])
    op.create_index("ix_payments_tigerbeetle_transfer_id", "payments", ["tigerbeetle_transfer_id"], unique=True)

    # ── good_faith_estimates ──────────────────────────────────────────────────
    op.create_table(
        "good_faith_estimates",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("gfe_number", sa.String(50), nullable=False),
        sa.Column("status", sa.Enum("draft", "issued", "acknowledged", "disputed", "expired", name="gfestatus"), nullable=False, server_default="draft"),
        sa.Column("provider_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("patient_id", sa.String(36), sa.ForeignKey("patients.id"), nullable=True),
        sa.Column("scheduled_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("issue_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("estimated_cost_low", sa.Numeric(12, 2), nullable=True),
        sa.Column("estimated_cost_high", sa.Numeric(12, 2), nullable=True),
        sa.Column("service_items", postgresql.JSONB, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=True),
    )
    op.create_index("ix_good_faith_estimates_gfe_number", "good_faith_estimates", ["gfe_number"], unique=True)
    op.create_index("ix_good_faith_estimates_status", "good_faith_estimates", ["status"])

    # ── admin_fees ────────────────────────────────────────────────────────────
    op.create_table(
        "admin_fees",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("dispute_id", sa.String(36), sa.ForeignKey("idr_disputes.id"), nullable=False),
        sa.Column("fee_year", sa.Integer, nullable=False),
        sa.Column("fee_amount", sa.Numeric(8, 2), nullable=False),
        sa.Column("paid_by", sa.String(50), nullable=False),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payment_reference", sa.String(100), nullable=True),
        sa.Column("waived", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("waiver_reason", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )
    op.create_index("ix_admin_fees_dispute_id", "admin_fees", ["dispute_id"], unique=True)

    # ── appeals ───────────────────────────────────────────────────────────────
    op.create_table(
        "appeals",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("appeal_number", sa.String(50), nullable=False),
        sa.Column("status", sa.Enum("submitted", "under_review", "upheld", "overturned", "withdrawn", name="appealstatus"), nullable=False, server_default="submitted"),
        sa.Column("dispute_id", sa.String(36), sa.ForeignKey("idr_disputes.id"), nullable=True),
        sa.Column("claim_id", sa.String(36), sa.ForeignKey("claims.id"), nullable=True),
        sa.Column("submitted_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("determination_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("appeal_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reason", sa.Text, nullable=False),
        sa.Column("reviewer_notes", sa.Text, nullable=True),
        sa.Column("outcome", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=True),
    )
    op.create_index("ix_appeals_appeal_number", "appeals", ["appeal_number"], unique=True)
    op.create_index("ix_appeals_status", "appeals", ["status"])

    # ── documents ─────────────────────────────────────────────────────────────
    op.create_table(
        "documents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("file_size", sa.BigInteger, nullable=False),
        sa.Column("s3_key", sa.String(500), nullable=False),
        sa.Column("s3_bucket", sa.String(100), nullable=False),
        sa.Column("resource_type", sa.String(50), nullable=False),
        sa.Column("resource_id", sa.String(36), nullable=True),
        sa.Column("uploaded_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("checksum_sha256", sa.String(64), nullable=True),
        sa.Column("is_encrypted", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("retention_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )
    op.create_index("ix_documents_s3_key", "documents", ["s3_key"], unique=True)
    op.create_index("ix_documents_resource", "documents", ["resource_type", "resource_id"])

    # ── notifications ─────────────────────────────────────────────────────────
    op.create_table(
        "notifications",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("recipient_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("recipient_email", sa.String(320), nullable=True),
        sa.Column("recipient_phone", sa.String(20), nullable=True),
        sa.Column("channel", sa.String(20), nullable=False),
        sa.Column("subject", sa.String(255), nullable=True),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("template_id", sa.String(50), nullable=True),
        sa.Column("template_vars", postgresql.JSONB, nullable=True),
        sa.Column("resource_type", sa.String(50), nullable=True),
        sa.Column("resource_id", sa.String(255), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_reason", sa.Text, nullable=True),
        sa.Column("retry_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )
    op.create_index("ix_notifications_status_created", "notifications", ["status", "created_at"])

    # ── fraud_alerts ──────────────────────────────────────────────────────────
    op.create_table(
        "fraud_alerts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("alert_type", sa.String(50), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("resource_type", sa.String(50), nullable=False),
        sa.Column("resource_id", sa.String(36), nullable=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=True),
        sa.Column("risk_score", sa.Float, nullable=False),
        sa.Column("features", postgresql.JSONB, nullable=True),
        sa.Column("model_version", sa.String(20), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("reviewed_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution", sa.String(100), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )
    op.create_index("ix_fraud_alerts_severity_status", "fraud_alerts", ["severity", "status"])

    # ── idr_entities ──────────────────────────────────────────────────────────
    op.create_table(
        "idr_entities",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("certification_number", sa.String(50), nullable=False),
        sa.Column("certification_status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("certification_expiry", sa.DateTime(timezone=True), nullable=True),
        sa.Column("specializations", postgresql.ARRAY(sa.String), nullable=True),
        sa.Column("max_concurrent_cases", sa.Integer, nullable=False, server_default="100"),
        sa.Column("current_case_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("average_resolution_days", sa.Float, nullable=True),
        sa.Column("total_cases_resolved", sa.Integer, nullable=False, server_default="0"),
        sa.Column("geographic_coverage", postgresql.ARRAY(sa.String), nullable=True),
        sa.Column("is_available", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=True),
    )
    op.create_index("ix_idr_entities_organization_id", "idr_entities", ["organization_id"], unique=True)
    op.create_index("ix_idr_entities_certification_number", "idr_entities", ["certification_number"], unique=True)

    # ── workflow_instances ────────────────────────────────────────────────────
    op.create_table(
        "workflow_instances",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workflow_type", sa.String(50), nullable=False),
        sa.Column("resource_type", sa.String(50), nullable=False),
        sa.Column("resource_id", sa.String(36), nullable=False),
        sa.Column("temporal_workflow_id", sa.String(255), nullable=True),
        sa.Column("temporal_run_id", sa.String(255), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="running"),
        sa.Column("current_step", sa.String(100), nullable=True),
        sa.Column("input_data", postgresql.JSONB, nullable=True),
        sa.Column("output_data", postgresql.JSONB, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=True),
    )
    op.create_index("ix_workflow_instances_temporal_workflow_id", "workflow_instances", ["temporal_workflow_id"], unique=True)
    op.create_index("ix_workflow_resource", "workflow_instances", ["resource_type", "resource_id"])

    # ── analytics_snapshots ───────────────────────────────────────────────────
    op.create_table(
        "analytics_snapshots",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("snapshot_type", sa.String(50), nullable=False),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.String(64), nullable=True),
        sa.Column("metrics", postgresql.JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.UniqueConstraint("snapshot_type", "period_start", "tenant_id", name="uq_analytics_snapshot"),
    )
    op.create_index("ix_analytics_snapshots_period", "analytics_snapshots", ["period_start", "period_end"])

    # ── platform_configs ──────────────────────────────────────────────────────
    op.create_table(
        "platform_configs",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("value", postgresql.JSONB, nullable=False),
        sa.Column("tenant_id", sa.String(64), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("is_secret", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=True),
        sa.UniqueConstraint("key", "tenant_id", name="uq_platform_config_key_tenant"),
    )

    # ── audit_logs ────────────────────────────────────────────────────────────
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("resource_type", sa.String(100), nullable=False),
        sa.Column("resource_id", sa.String(255), nullable=True),
        sa.Column("tenant_id", sa.String(64), nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.Text, nullable=True),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.Column("details", postgresql.JSONB, nullable=True),
        sa.Column("severity", sa.String(20), nullable=False, server_default="info"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )
    op.create_index("ix_audit_logs_user_id", "audit_logs", ["user_id"])
    op.create_index("ix_audit_logs_resource", "audit_logs", ["resource_type", "resource_id"])
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])
    op.create_index("ix_audit_logs_tenant_id", "audit_logs", ["tenant_id"])

    # ── reconciliation_records ────────────────────────────────────────────────
    op.create_table(
        "reconciliation_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("reconciliation_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("aggregator_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("total_claims", sa.Integer, nullable=False, server_default="0"),
        sa.Column("matched_claims", sa.Integer, nullable=False, server_default="0"),
        sa.Column("unmatched_claims", sa.Integer, nullable=False, server_default="0"),
        sa.Column("total_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("matched_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("discrepancy_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("details", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_reconciliation_records_date", "reconciliation_records", ["reconciliation_date"])
    op.create_index("ix_reconciliation_records_aggregator", "reconciliation_records", ["aggregator_id"])


def downgrade() -> None:
    # Drop in reverse dependency order
    op.drop_table("reconciliation_records")
    op.drop_table("audit_logs")
    op.drop_table("platform_configs")
    op.drop_table("analytics_snapshots")
    op.drop_table("workflow_instances")
    op.drop_table("idr_entities")
    op.drop_table("fraud_alerts")
    op.drop_table("notifications")
    op.drop_table("documents")
    op.drop_table("appeals")
    op.drop_table("admin_fees")
    op.drop_table("good_faith_estimates")
    op.drop_table("payments")
    op.drop_table("dispute_timeline")
    op.drop_table("idr_disputes")
    op.drop_table("claims")
    op.drop_table("patients")
    op.drop_table("users")
    op.drop_table("organizations")
    # Drop enums
    for enum_name in ["disputestatus", "claimstatus", "paymentstatus", "userrole", "gfestatus", "appealstatus"]:
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")
