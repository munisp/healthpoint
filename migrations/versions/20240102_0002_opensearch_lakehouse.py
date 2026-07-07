"""Add OpenSearch index tracking and Lakehouse metadata tables

Revision ID: 0002_opensearch_lakehouse
Revises: 0001_initial
Create Date: 2024-01-02 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0002_opensearch_lakehouse"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── opensearch_sync_log — tracks which records have been indexed ──────────
    op.create_table(
        "opensearch_sync_log",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("resource_type", sa.String(50), nullable=False),
        sa.Column("resource_id", sa.String(36), nullable=False),
        sa.Column("index_name", sa.String(100), nullable=False),
        sa.Column("operation", sa.String(20), nullable=False),  # index, update, delete
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
    )
    op.create_index("ix_opensearch_sync_resource", "opensearch_sync_log", ["resource_type", "resource_id"])
    op.create_index("ix_opensearch_sync_status", "opensearch_sync_log", ["status"])

    # ── lakehouse_pipeline_runs — tracks Spark/Iceberg ETL jobs ──────────────
    op.create_table(
        "lakehouse_pipeline_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("pipeline_name", sa.String(100), nullable=False, index=True),
        sa.Column("pipeline_version", sa.String(20), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="running"),
        sa.Column("source_table", sa.String(100), nullable=True),
        sa.Column("target_iceberg_table", sa.String(200), nullable=True),
        sa.Column("records_processed", sa.BigInteger, nullable=True),
        sa.Column("records_written", sa.BigInteger, nullable=True),
        sa.Column("bytes_written", sa.BigInteger, nullable=True),
        sa.Column("watermark_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("watermark_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("spark_job_id", sa.String(100), nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("metrics", postgresql.JSONB, nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_lakehouse_pipeline_runs_status", "lakehouse_pipeline_runs", ["status"])
    op.create_index("ix_lakehouse_pipeline_runs_started_at", "lakehouse_pipeline_runs", ["started_at"])

    # ── ml_model_registry — tracks deployed ML models ────────────────────────
    op.create_table(
        "ml_model_registry",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("model_name", sa.String(100), nullable=False),
        sa.Column("model_version", sa.String(20), nullable=False),
        sa.Column("model_type", sa.String(50), nullable=False),  # fraud_detection, predictive_analytics
        sa.Column("status", sa.String(20), nullable=False, server_default="staging"),  # staging, production, archived
        sa.Column("mlflow_run_id", sa.String(50), nullable=True),
        sa.Column("mlflow_model_uri", sa.String(500), nullable=True),
        sa.Column("metrics", postgresql.JSONB, nullable=True),
        sa.Column("parameters", postgresql.JSONB, nullable=True),
        sa.Column("training_dataset_version", sa.String(50), nullable=True),
        sa.Column("promoted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("promoted_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.UniqueConstraint("model_name", "model_version", name="uq_ml_model_name_version"),
    )
    op.create_index("ix_ml_model_registry_status", "ml_model_registry", ["status"])


def downgrade() -> None:
    op.drop_table("ml_model_registry")
    op.drop_table("lakehouse_pipeline_runs")
    op.drop_table("opensearch_sync_log")
