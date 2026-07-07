"""Medplum FHIR and EMR connector tables

Revision ID: 20240104_0004
Revises: 20240103_0003
Create Date: 2024-01-04 00:00:00.000000

Adds:
  - emr_connections: stores SMART on FHIR tokens per patient per vendor
  - emr_oauth_states: short-lived CSRF state tokens for SMART auth flow
  - fhir_resource_index: lightweight index of Medplum-stored FHIR resources
    for cross-referencing with HealthPoint PostgreSQL records
  - medplum_sync_log: audit log of all Medplum upsert operations
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20240104_0004"
down_revision = "20240103_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── EMR vendor enum ────────────────────────────────────────────────────────
    op.execute(
        """
        CREATE TYPE emr_vendor AS ENUM (
            'epic', 'cerner', 'allscripts', 'eclinicalworks', 'athenahealth',
            'nextgen', 'meditech', 'drchrono', 'practice_fusion'
        )
        """
    )

    # ── emr_connections ────────────────────────────────────────────────────────
    op.create_table(
        "emr_connections",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("patient_id", sa.String(64), nullable=False),
        sa.Column("vendor", postgresql.ENUM(name="emr_vendor"), nullable=False),
        sa.Column("access_token", sa.Text, nullable=False),
        sa.Column("refresh_token", sa.Text, nullable=True),
        sa.Column("token_expires_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("patient_fhir_id", sa.String(128), nullable=True),
        sa.Column("medplum_patient_id", sa.String(128), nullable=True),
        sa.Column("fhir_base_url", sa.String(512), nullable=False),
        sa.Column("connected_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("last_sync_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("last_sync_count", sa.Integer, nullable=True),
        sa.Column("last_sync_error", sa.Text, nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.UniqueConstraint("patient_id", "vendor", name="uq_emr_connections_patient_vendor"),
    )
    op.create_index("idx_emr_connections_patient_id", "emr_connections", ["patient_id"])
    op.create_index("idx_emr_connections_vendor", "emr_connections", ["vendor"])
    op.create_index("idx_emr_connections_token_expires", "emr_connections", ["token_expires_at"])

    # ── emr_oauth_states ───────────────────────────────────────────────────────
    op.create_table(
        "emr_oauth_states",
        sa.Column("state", sa.String(128), primary_key=True),
        sa.Column("vendor", postgresql.ENUM(name="emr_vendor"), nullable=False),
        sa.Column("patient_id", sa.String(64), nullable=False),
        sa.Column("code_verifier", sa.Text, nullable=True),  # PKCE verifier
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )
    op.create_index("idx_emr_oauth_states_created", "emr_oauth_states", ["created_at"])

    # Auto-expire states after 15 minutes (via pg_cron or application cleanup)
    op.execute(
        """
        COMMENT ON TABLE emr_oauth_states IS
        'Short-lived CSRF state tokens for SMART on FHIR authorization flow.
         Rows older than 15 minutes are invalid and should be purged periodically.'
        """
    )

    # ── fhir_resource_index ────────────────────────────────────────────────────
    op.create_table(
        "fhir_resource_index",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("medplum_resource_id", sa.String(128), nullable=False),
        sa.Column("resource_type", sa.String(64), nullable=False),
        sa.Column("healthpoint_entity_type", sa.String(64), nullable=True),
        sa.Column("healthpoint_entity_id", sa.String(128), nullable=True),
        sa.Column("patient_id", sa.String(64), nullable=True),
        sa.Column("vendor", postgresql.ENUM(name="emr_vendor"), nullable=True),
        sa.Column("version_id", sa.String(64), nullable=True),
        sa.Column("last_updated", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.UniqueConstraint("medplum_resource_id", "resource_type", name="uq_fhir_resource_index"),
    )
    op.create_index("idx_fhir_resource_index_type", "fhir_resource_index", ["resource_type"])
    op.create_index("idx_fhir_resource_index_patient", "fhir_resource_index", ["patient_id"])
    op.create_index("idx_fhir_resource_index_entity", "fhir_resource_index", ["healthpoint_entity_type", "healthpoint_entity_id"])

    # ── medplum_sync_log ───────────────────────────────────────────────────────
    op.create_table(
        "medplum_sync_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("operation", sa.String(16), nullable=False),  # create | update | delete | search
        sa.Column("resource_type", sa.String(64), nullable=False),
        sa.Column("resource_id", sa.String(128), nullable=True),
        sa.Column("source_service", sa.String(128), nullable=False),
        sa.Column("patient_id", sa.String(64), nullable=True),
        sa.Column("success", sa.Boolean, nullable=False),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("duration_ms", sa.Integer, nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )
    op.create_index("idx_medplum_sync_log_resource_type", "medplum_sync_log", ["resource_type"])
    op.create_index("idx_medplum_sync_log_patient", "medplum_sync_log", ["patient_id"])
    op.create_index("idx_medplum_sync_log_created", "medplum_sync_log", ["created_at"])
    op.create_index("idx_medplum_sync_log_success", "medplum_sync_log", ["success"])

    # ── Add medplum_patient_id to existing patients table ─────────────────────
    op.add_column(
        "patients",
        sa.Column("medplum_patient_id", sa.String(128), nullable=True),
    )
    op.create_index("idx_patients_medplum_id", "patients", ["medplum_patient_id"])

    # ── Add fhir_resource_id to key IDR tables ─────────────────────────────────
    for table in ["gfe_requests", "idr_disputes", "payments", "appeals"]:
        op.add_column(
            table,
            sa.Column("fhir_resource_id", sa.String(128), nullable=True),
        )
        op.create_index(f"idx_{table}_fhir_id", table, ["fhir_resource_id"])


def downgrade() -> None:
    # Remove fhir_resource_id columns
    for table in ["gfe_requests", "idr_disputes", "payments", "appeals"]:
        op.drop_index(f"idx_{table}_fhir_id", table_name=table)
        op.drop_column(table, "fhir_resource_id")

    op.drop_index("idx_patients_medplum_id", table_name="patients")
    op.drop_column("patients", "medplum_patient_id")

    op.drop_table("medplum_sync_log")
    op.drop_table("fhir_resource_index")
    op.drop_table("emr_oauth_states")
    op.drop_table("emr_connections")
    op.execute("DROP TYPE IF EXISTS emr_vendor")
