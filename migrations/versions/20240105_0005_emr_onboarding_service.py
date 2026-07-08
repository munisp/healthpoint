"""Add EMR onboarding service tables

Revision ID: 20240105_0005
Revises: 20240104_0004
Create Date: 2024-01-05 00:00:00.000000

Tables created:
  - emr_onboarding_sessions   — onboarding state machine per vendor/tenant
  - emr_onboarding_events     — audit log of all state transitions
  - emr_tenant_registrations  — activated tenant registry
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers
revision = "20240105_0005"
down_revision = "20240104_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── emr_onboarding_sessions ───────────────────────────────────────────────
    op.create_table(
        "emr_onboarding_sessions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("vendor_key", sa.String(64), nullable=False),
        sa.Column("tenant_name", sa.String(256), nullable=False),
        sa.Column("tenant_fhir_base_url", sa.Text, nullable=True),
        sa.Column("environment", sa.String(16), nullable=False, server_default="sandbox"),
        sa.Column("auth_type", sa.String(32), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("contact_email", sa.String(320), nullable=False),
        sa.Column("contact_name", sa.String(256), nullable=False),
        # Credentials (encrypted at rest via pgcrypto AES-256)
        sa.Column("client_id", sa.Text, nullable=True),
        sa.Column("client_secret_encrypted", sa.Text, nullable=True),
        sa.Column("private_key_encrypted", sa.Text, nullable=True),
        sa.Column("api_key_encrypted", sa.Text, nullable=True),
        # Discovered configuration from CapabilityStatement
        sa.Column("capability_statement", JSONB, nullable=True),
        sa.Column("discovered_auth_url", sa.Text, nullable=True),
        sa.Column("discovered_token_url", sa.Text, nullable=True),
        sa.Column("discovered_scopes", JSONB, nullable=True),
        sa.Column("discovered_resources", JSONB, nullable=True),
        # Configured settings
        sa.Column("configured_scopes", JSONB, nullable=True),
        sa.Column("sync_resources", JSONB, nullable=True),
        sa.Column("sync_frequency_hours", sa.Integer, nullable=True, server_default="24"),
        sa.Column("sync_lookback_days", sa.Integer, nullable=True, server_default="365"),
        sa.Column("patient_matching_enabled", sa.Boolean, nullable=True, server_default="true"),
        sa.Column("auto_create_fhir_resources", sa.Boolean, nullable=True, server_default="true"),
        # Connection test results
        sa.Column("last_test_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("last_test_status", sa.String(32), nullable=True),
        sa.Column("last_test_error", sa.Text, nullable=True),
        sa.Column("last_test_patient_count", sa.Integer, nullable=True),
        # Lifecycle timestamps
        sa.Column("activated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("failed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("failure_reason", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    op.create_index("idx_emr_onboarding_status", "emr_onboarding_sessions", ["status"])
    op.create_index("idx_emr_onboarding_vendor", "emr_onboarding_sessions", ["vendor_key"])
    op.create_index("idx_emr_onboarding_contact", "emr_onboarding_sessions", ["contact_email"])

    # ── emr_onboarding_events ─────────────────────────────────────────────────
    op.create_table(
        "emr_onboarding_events",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "onboarding_id",
            sa.String(64),
            sa.ForeignKey("emr_onboarding_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("from_status", sa.String(32), nullable=True),
        sa.Column("to_status", sa.String(32), nullable=True),
        sa.Column("details", JSONB, nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    op.create_index("idx_emr_events_session", "emr_onboarding_events", ["onboarding_id"])
    op.create_index("idx_emr_events_type", "emr_onboarding_events", ["event_type"])
    op.create_index("idx_emr_events_created", "emr_onboarding_events", ["created_at"])

    # ── emr_tenant_registrations ──────────────────────────────────────────────
    op.create_table(
        "emr_tenant_registrations",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "onboarding_id",
            sa.String(64),
            sa.ForeignKey("emr_onboarding_sessions.id"),
            nullable=False,
        ),
        sa.Column("vendor_key", sa.String(64), nullable=False),
        sa.Column("tenant_name", sa.String(256), nullable=False),
        sa.Column("fhir_base_url", sa.Text, nullable=False),
        sa.Column("environment", sa.String(16), nullable=False),
        sa.Column("auth_type", sa.String(32), nullable=False),
        sa.Column("client_id", sa.Text, nullable=False),
        sa.Column("configured_scopes", JSONB, nullable=False),
        sa.Column("sync_resources", JSONB, nullable=False),
        sa.Column("sync_frequency_hours", sa.Integer, nullable=False, server_default="24"),
        sa.Column("sync_lookback_days", sa.Integer, nullable=False, server_default="365"),
        sa.Column("patient_matching_enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("activated_at", sa.TIMESTAMP(timezone=True), nullable=True, server_default=sa.text("NOW()")),
        sa.Column("last_sync_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("total_patients_synced", sa.Integer, nullable=True, server_default="0"),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    op.create_index("idx_emr_tenant_vendor", "emr_tenant_registrations", ["vendor_key"])
    op.create_index("idx_emr_tenant_active", "emr_tenant_registrations", ["is_active"])
    op.create_index("idx_emr_tenant_onboarding", "emr_tenant_registrations", ["onboarding_id"])


def downgrade() -> None:
    op.drop_table("emr_tenant_registrations")
    op.drop_table("emr_onboarding_events")
    op.drop_table("emr_onboarding_sessions")
