"""Add check_payment_service tables

Revision ID: 20240103_0003
Revises: 20240102_0002
Create Date: 2024-01-03 00:00:00.000000

Tables added:
- check_number_sequences: Per-bank sequential check number tracking
- check_payments: Full physical check lifecycle (issue, mail, void, stop, reissue)
- positive_pay_files: Daily positive pay export records for bank verification
- check_payment_events: Immutable audit trail for all check lifecycle events
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB, ENUM
import uuid

# revision identifiers
revision = '20240103_0003'
down_revision = '20240102_0002'
branch_labels = None
depends_on = None

# ─── Enums ────────────────────────────────────────────────────────────────────
check_status_enum = ENUM(
    'draft', 'issued', 'mailed', 'delivered', 'deposited',
    'cleared', 'voided', 'stopped', 'stale', 'reissued', 'returned',
    name='check_status',
    create_type=True
)

positive_pay_status_enum = ENUM(
    'pending', 'generated', 'transmitted', 'confirmed', 'failed',
    name='positive_pay_status',
    create_type=True
)

check_event_type_enum = ENUM(
    'issued', 'mailed', 'delivered', 'deposited', 'cleared',
    'voided', 'stop_payment_requested', 'stop_payment_confirmed',
    'stale_dated', 'reissued', 'returned', 'positive_pay_transmitted',
    name='check_event_type',
    create_type=True
)


def upgrade():
    # ── check_number_sequences ────────────────────────────────────────────────
    op.create_table(
        'check_number_sequences',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('bank_routing_number', sa.String(9), nullable=False, unique=True),
        sa.Column('bank_name', sa.String(255), nullable=False),
        sa.Column('account_number_last4', sa.String(4), nullable=False),
        sa.Column('current_sequence', sa.BigInteger(), nullable=False, default=1000),
        sa.Column('prefix', sa.String(4), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('ix_check_number_sequences_routing', 'check_number_sequences', ['bank_routing_number'])

    # ── check_payments ────────────────────────────────────────────────────────
    op.create_table(
        'check_payments',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('payment_id', UUID(as_uuid=True), nullable=False),
        sa.Column('dispute_id', UUID(as_uuid=True), nullable=True),
        sa.Column('check_number', sa.String(20), nullable=False, unique=True),
        sa.Column('micr_check_number', sa.String(20), nullable=False),
        sa.Column('amount', sa.Numeric(12, 2), nullable=False),
        sa.Column('payee_name', sa.String(255), nullable=False),
        sa.Column('payee_address_line1', sa.String(255), nullable=False),
        sa.Column('payee_address_line2', sa.String(255), nullable=True),
        sa.Column('payee_city', sa.String(100), nullable=False),
        sa.Column('payee_state', sa.String(2), nullable=False),
        sa.Column('payee_zip_code', sa.String(10), nullable=False),
        sa.Column('payee_country', sa.String(2), nullable=False, default='US'),
        sa.Column('memo_line', sa.String(255), nullable=True),
        sa.Column('bank_routing_number', sa.String(9), nullable=False),
        sa.Column('bank_account_number_encrypted', sa.Text(), nullable=False),
        sa.Column('bank_name', sa.String(255), nullable=False),
        sa.Column('status', check_status_enum, nullable=False, default='draft'),
        sa.Column('issued_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('mailed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deposited_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cleared_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('voided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('void_reason', sa.Text(), nullable=True),
        sa.Column('stale_date', sa.Date(), nullable=True),
        sa.Column('stop_payment_requested_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('stop_payment_confirmed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('stop_payment_bank_ref', sa.String(100), nullable=True),
        sa.Column('reissued_from_check_id', UUID(as_uuid=True), nullable=True),
        sa.Column('reissued_to_check_id', UUID(as_uuid=True), nullable=True),
        sa.Column('tracking_number', sa.String(100), nullable=True),
        sa.Column('carrier', sa.String(50), nullable=True),
        sa.Column('positive_pay_transmitted', sa.Boolean(), nullable=False, default=False),
        sa.Column('positive_pay_file_id', UUID(as_uuid=True), nullable=True),
        sa.Column('print_job_id', sa.String(100), nullable=True),
        sa.Column('tigerbeetle_transfer_id', sa.String(100), nullable=True),
        sa.Column('idempotency_key', sa.String(100), nullable=True, unique=True),
        sa.Column('tenant_id', sa.String(64), nullable=True),
        sa.Column('created_by', sa.String(64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('metadata', JSONB(), nullable=True),
    )
    op.create_index('ix_check_payments_payment_id', 'check_payments', ['payment_id'])
    op.create_index('ix_check_payments_dispute_id', 'check_payments', ['dispute_id'])
    op.create_index('ix_check_payments_status', 'check_payments', ['status'])
    op.create_index('ix_check_payments_check_number', 'check_payments', ['check_number'])
    op.create_index('ix_check_payments_issued_at', 'check_payments', ['issued_at'])
    op.create_index('ix_check_payments_stale_date', 'check_payments', ['stale_date'])
    op.create_index('ix_check_payments_tenant_id', 'check_payments', ['tenant_id'])

    # ── positive_pay_files ────────────────────────────────────────────────────
    op.create_table(
        'positive_pay_files',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('bank_routing_number', sa.String(9), nullable=False),
        sa.Column('bank_name', sa.String(255), nullable=False),
        sa.Column('file_date', sa.Date(), nullable=False),
        sa.Column('file_format', sa.String(50), nullable=False, default='csv'),
        sa.Column('file_path_s3', sa.Text(), nullable=True),
        sa.Column('check_count', sa.Integer(), nullable=False, default=0),
        sa.Column('total_amount', sa.Numeric(14, 2), nullable=False, default=0),
        sa.Column('status', positive_pay_status_enum, nullable=False, default='pending'),
        sa.Column('transmission_method', sa.String(50), nullable=True),
        sa.Column('transmitted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('bank_confirmation_ref', sa.String(100), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('ix_positive_pay_files_bank_date', 'positive_pay_files', ['bank_routing_number', 'file_date'], unique=True)
    op.create_index('ix_positive_pay_files_status', 'positive_pay_files', ['status'])

    # ── check_payment_events ──────────────────────────────────────────────────
    op.create_table(
        'check_payment_events',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('check_id', UUID(as_uuid=True), nullable=False),
        sa.Column('event_type', check_event_type_enum, nullable=False),
        sa.Column('event_data', JSONB(), nullable=True),
        sa.Column('performed_by', sa.String(64), nullable=True),
        sa.Column('ip_address', sa.String(45), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_check_payment_events_check_id', 'check_payment_events', ['check_id'])
    op.create_index('ix_check_payment_events_event_type', 'check_payment_events', ['event_type'])
    op.create_index('ix_check_payment_events_created_at', 'check_payment_events', ['created_at'])

    # ── Foreign key constraints ───────────────────────────────────────────────
    op.create_foreign_key(
        'fk_check_payments_reissued_from',
        'check_payments', 'check_payments',
        ['reissued_from_check_id'], ['id'],
        ondelete='SET NULL'
    )
    op.create_foreign_key(
        'fk_check_payment_events_check_id',
        'check_payment_events', 'check_payments',
        ['check_id'], ['id'],
        ondelete='CASCADE'
    )
    op.create_foreign_key(
        'fk_check_payments_positive_pay_file',
        'check_payments', 'positive_pay_files',
        ['positive_pay_file_id'], ['id'],
        ondelete='SET NULL'
    )


def downgrade():
    # Drop foreign keys first
    op.drop_constraint('fk_check_payments_positive_pay_file', 'check_payments', type_='foreignkey')
    op.drop_constraint('fk_check_payment_events_check_id', 'check_payment_events', type_='foreignkey')
    op.drop_constraint('fk_check_payments_reissued_from', 'check_payments', type_='foreignkey')

    # Drop tables
    op.drop_table('check_payment_events')
    op.drop_table('positive_pay_files')
    op.drop_table('check_payments')
    op.drop_table('check_number_sequences')

    # Drop enums
    check_event_type_enum.drop(op.get_bind())
    positive_pay_status_enum.drop(op.get_bind())
    check_status_enum.drop(op.get_bind())
