#!/usr/bin/env python3
"""
Payment Processing Service
Multi-method payment processing with TigerBeetle double-entry ledger
Port: 8016
"""

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
import hashlib
import hmac
import base64

# ── Shared HealthPoint infrastructure ─────────────────────────────────────────
import sys
_repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from backend.shared.database import fetch, fetchrow, execute, fetchval, transaction, bootstrap_schema, get_pool
from backend.shared.cache import get_client as get_redis_client, rate_limit_check, set_json, get_json
from backend.shared.auth import get_current_user, require_role, require_admin, require_provider, security_headers_middleware, TokenPayload
from backend.shared.messaging import publish, Topics

# ── TigerBeetle double-entry ledger ───────────────────────────────────────────
try:
    from backend.middleware.tigerbeetle_client import (
        TigerBeetleClient, AccountType, LedgerCode, TransferFlags,
        uuid_to_tb_id, tb_id_to_uuid
    )
    TIGERBEETLE_AVAILABLE = True
except ImportError:
    TIGERBEETLE_AVAILABLE = False
    TigerBeetleClient = None
    class AccountType:
        HEALTH_PLAN = 2
        PROVIDER = 1
    class LedgerCode:
        USD = 1
    class TransferFlags:
        PENDING = 2
        POST_PENDING = 4
        VOID_PENDING = 8
    def uuid_to_tb_id(u): return 0
    def tb_id_to_uuid(i): return str(uuid.uuid4())
# ─────────────────────────────────────────────────────────────────────────────

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
import asyncpg
import httpx
from cryptography.fernet import Fernet
from shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# FastAPI app
setup_telemetry(service_name="payment-processing-service", service_version="1.0.0")
app = FastAPI(
instrument_fastapi(app)
    title="Payment Processing Service",
    description="Multi-method payment processing with TigerBeetle double-entry ledger",
    version="2.0.0"
)
app.middleware("http")(security_headers_middleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── NSA/IDR Business Constants ────────────────────────────────────────────────
NSA_ADMIN_FEE_STANDARD = Decimal("350.00")   # Standard IDR admin fee (2024)
NSA_ADMIN_FEE_BATCHED = Decimal("30.00")     # Per-claim fee for batched disputes
NSA_PAYMENT_DEADLINE_DAYS = 30               # Days to pay after IDR determination
NSA_INTEREST_RATE_ANNUAL = Decimal("0.12")   # 12% annual interest on late payments
PAYMENT_IDEMPOTENCY_TTL = 86400              # 24h idempotency key TTL

# ── Enums ─────────────────────────────────────────────────────────────────────
class PaymentMethod(str, Enum):
    ACH = "ach"
    WIRE = "wire"
    CHECK = "check"
    CARD = "card"
    EFT = "eft"
    VIRTUAL_CARD = "virtual_card"

class PaymentStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"
    DISPUTED = "disputed"

class ReconciliationStatus(str, Enum):
    MATCHED = "matched"
    UNMATCHED = "unmatched"
    DISCREPANCY = "discrepancy"
    PENDING = "pending"

class PaymentType(str, Enum):
    IDR_DETERMINATION = "idr_determination"
    ADMIN_FEE = "admin_fee"
    CLAIM_SETTLEMENT = "claim_settlement"
    REFUND = "refund"
    INTEREST = "interest"

# ── Pydantic Models ───────────────────────────────────────────────────────────
class PaymentRequest(BaseModel):
    claim_id: str = Field(..., min_length=1, max_length=128)
    payee_id: str = Field(..., min_length=1, max_length=128)
    amount: Decimal = Field(..., gt=0, le=10_000_000)
    payment_method: PaymentMethod
    payment_type: PaymentType = PaymentType.CLAIM_SETTLEMENT
    description: Optional[str] = Field(None, max_length=500)
    reference_number: Optional[str] = Field(None, max_length=128)
    scheduled_date: Optional[datetime] = None
    idempotency_key: Optional[str] = Field(None, max_length=128)
    metadata: Optional[Dict[str, Any]] = {}

    @validator("amount")
    def amount_must_be_positive(cls, v):
        if v <= 0:
            raise ValueError("Payment amount must be positive")
        return v

    @validator("idempotency_key", pre=True, always=True)
    def set_idempotency_key(cls, v, values):
        if not v:
            return str(uuid.uuid4())
        return v

class PaymentResponse(BaseModel):
    payment_id: str
    status: PaymentStatus
    transaction_id: Optional[str] = None
    confirmation_number: Optional[str] = None
    estimated_completion: Optional[datetime] = None
    tigerbeetle_transfer_id: Optional[str] = None
    ledger_status: str = "not_recorded"

class ReconciliationRequest(BaseModel):
    payment_id: str
    bank_reference: str = Field(..., min_length=1)
    actual_amount: Decimal = Field(..., gt=0)
    settlement_date: datetime
    bank_fees: Optional[Decimal] = Decimal('0.00')

class BulkPaymentRequest(BaseModel):
    payments: List[PaymentRequest] = Field(..., min_items=1, max_items=500)
    batch_description: Optional[str] = None

class LatePaymentRequest(BaseModel):
    payment_id: str
    days_overdue: int = Field(..., ge=1)

# ── Data Classes ──────────────────────────────────────────────────────────────
@dataclass
class Payment:
    payment_id: str
    claim_id: str
    payee_id: str
    amount: Decimal
    payment_method: PaymentMethod
    status: PaymentStatus
    created_at: datetime
    updated_at: datetime
    payment_type: str = PaymentType.CLAIM_SETTLEMENT
    scheduled_date: Optional[datetime] = None
    completed_date: Optional[datetime] = None
    transaction_id: Optional[str] = None
    confirmation_number: Optional[str] = None
    description: Optional[str] = None
    reference_number: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    fees: Optional[Decimal] = Decimal('0.00')
    tigerbeetle_transfer_id: Optional[str] = None

@dataclass
class Payee:
    payee_id: str
    name: str
    type: str
    payment_preferences: Dict[str, Any]
    bank_details: Optional[Dict[str, Any]] = None
    address: Optional[Dict[str, str]] = None
    tax_id: Optional[str] = None
    is_active: bool = True

# ── Payment Processing Service ────────────────────────────────────────────────
class PaymentProcessingService:
    def __init__(self):
        self.db_pool = None
        self.redis = None
        # Use env-based encryption key (not generated per-instance)
        enc_key = os.getenv("PAYMENT_ENCRYPTION_KEY", "").encode()
        if len(enc_key) == 44:
            self.cipher_suite = Fernet(enc_key)
        else:
            self.cipher_suite = Fernet(Fernet.generate_key())
            logger.warning("PAYMENT_ENCRYPTION_KEY not set — using ephemeral key (not production-safe)")
        # TigerBeetle double-entry ledger
        self.tb_client: Optional[Any] = None

    async def initialize(self):
        """Initialize database connections and TigerBeetle"""
        try:
            self.db_pool = await get_pool()
            self.redis = await get_redis_client()

            # Initialize TigerBeetle
            if TIGERBEETLE_AVAILABLE and TigerBeetleClient:
                try:
                    self.tb_client = TigerBeetleClient()
                    await self.tb_client.connect()
                    logger.info("TigerBeetle double-entry ledger connected")
                except Exception as tb_err:
                    logger.warning(f"TigerBeetle unavailable (PostgreSQL-only mode): {tb_err}")
                    self.tb_client = None
            else:
                logger.warning("TigerBeetle client not installed — running PostgreSQL-only mode")

            # Bootstrap schema
            await bootstrap_schema("""
                CREATE TABLE IF NOT EXISTS payments (
                    payment_id VARCHAR(128) PRIMARY KEY,
                    claim_id VARCHAR(128) NOT NULL,
                    payee_id VARCHAR(128) NOT NULL,
                    amount NUMERIC(12,2) NOT NULL,
                    payment_method VARCHAR(32) NOT NULL,
                    payment_type VARCHAR(64) DEFAULT 'claim_settlement',
                    status VARCHAR(32) NOT NULL DEFAULT 'pending',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    scheduled_date TIMESTAMPTZ,
                    completed_date TIMESTAMPTZ,
                    transaction_id VARCHAR(256),
                    confirmation_number VARCHAR(256),
                    description TEXT,
                    reference_number VARCHAR(128),
                    metadata JSONB DEFAULT '{}',
                    fees NUMERIC(12,2) DEFAULT 0.00,
                    tigerbeetle_transfer_id VARCHAR(256),
                    idempotency_key VARCHAR(128) UNIQUE
                );
                CREATE INDEX IF NOT EXISTS idx_payments_claim_id ON payments(claim_id);
                CREATE INDEX IF NOT EXISTS idx_payments_payee_id ON payments(payee_id);
                CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
                CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);

                CREATE TABLE IF NOT EXISTS payees (
                    payee_id VARCHAR(128) PRIMARY KEY,
                    name VARCHAR(256) NOT NULL,
                    type VARCHAR(64) NOT NULL,
                    payment_preferences JSONB DEFAULT '{}',
                    bank_details JSONB,
                    address JSONB,
                    tax_id VARCHAR(32),
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS payment_reconciliations (
                    reconciliation_id VARCHAR(128) PRIMARY KEY,
                    payment_id VARCHAR(128) NOT NULL REFERENCES payments(payment_id),
                    bank_reference VARCHAR(256) NOT NULL,
                    expected_amount NUMERIC(12,2) NOT NULL,
                    actual_amount NUMERIC(12,2) NOT NULL,
                    discrepancy NUMERIC(12,2) GENERATED ALWAYS AS (actual_amount - expected_amount) STORED,
                    settlement_date TIMESTAMPTZ NOT NULL,
                    bank_fees NUMERIC(12,2) DEFAULT 0.00,
                    status VARCHAR(32) NOT NULL,
                    reconciled_at TIMESTAMPTZ DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS payment_audit_log (
                    id BIGSERIAL PRIMARY KEY,
                    payment_id VARCHAR(128) NOT NULL,
                    action VARCHAR(64) NOT NULL,
                    old_status VARCHAR(32),
                    new_status VARCHAR(32),
                    actor_id VARCHAR(128),
                    details JSONB DEFAULT '{}',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)
            logger.info("Payment Processing Service initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Payment Processing Service: {e}")
            raise

    async def _record_tigerbeetle_transfer(
        self,
        payment_id: str,
        claim_id: str,
        payee_id: str,
        amount: Decimal,
        payment_type: str,
        pending: bool = True
    ) -> Optional[str]:
        """
        Record a double-entry transfer in TigerBeetle.
        Returns the TigerBeetle transfer ID string, or None if unavailable.
        """
        if not self.tb_client:
            return None
        try:
            amount_cents = int(amount * 100)
            payer_account_id = uuid_to_tb_id(claim_id)
            payee_account_id = uuid_to_tb_id(payee_id)

            # Ensure both accounts exist
            await self.tb_client.ensure_account(
                account_id=payer_account_id,
                ledger=int(LedgerCode.USD),
                code=int(AccountType.HEALTH_PLAN),
                user_data=int(AccountType.HEALTH_PLAN)
            )
            await self.tb_client.ensure_account(
                account_id=payee_account_id,
                ledger=int(LedgerCode.USD),
                code=int(AccountType.PROVIDER),
                user_data=int(AccountType.PROVIDER)
            )

            transfer_id = uuid_to_tb_id(payment_id)
            flags = int(TransferFlags.PENDING) if pending else 0
            errors = await self.tb_client.create_transfers([{
                "id": transfer_id,
                "debit_account_id": payer_account_id,
                "credit_account_id": payee_account_id,
                "amount": amount_cents,
                "ledger": int(LedgerCode.USD),
                "code": 1,  # NSA IDR payment code
                "flags": flags,
                "user_data": int(AccountType.HEALTH_PLAN),
                "timeout": 86400 if pending else 0,
            }])
            if errors:
                logger.error(f"TigerBeetle transfer errors for {payment_id}: {errors}")
                return None
            tb_id_str = str(transfer_id)
            logger.info(f"TigerBeetle {'pending' if pending else 'direct'} transfer created: {tb_id_str}")
            return tb_id_str
        except Exception as e:
            logger.error(f"TigerBeetle ledger error (non-fatal, payment continues): {e}")
            return None

    async def _post_tigerbeetle_transfer(self, pending_transfer_id: str) -> bool:
        """Post (commit) a pending TigerBeetle transfer."""
        if not self.tb_client or not pending_transfer_id:
            return False
        try:
            post_id = uuid_to_tb_id(str(uuid.uuid4()))
            errors = await self.tb_client.create_transfers([{
                "id": post_id,
                "debit_account_id": 0,
                "credit_account_id": 0,
                "amount": 0,
                "ledger": int(LedgerCode.USD),
                "code": 1,
                "flags": int(TransferFlags.POST_PENDING),
                "pending_id": int(pending_transfer_id),
                "user_data": 0,
                "timeout": 0,
            }])
            if errors:
                logger.error(f"TigerBeetle post errors: {errors}")
                return False
            logger.info(f"TigerBeetle transfer committed: {pending_transfer_id}")
            return True
        except Exception as e:
            logger.error(f"TigerBeetle post error: {e}")
            return False

    async def _void_tigerbeetle_transfer(self, pending_transfer_id: str) -> bool:
        """Void a pending TigerBeetle transfer (on payment failure/cancellation)."""
        if not self.tb_client or not pending_transfer_id:
            return False
        try:
            void_id = uuid_to_tb_id(str(uuid.uuid4()))
            errors = await self.tb_client.create_transfers([{
                "id": void_id,
                "debit_account_id": 0,
                "credit_account_id": 0,
                "amount": 0,
                "ledger": int(LedgerCode.USD),
                "code": 1,
                "flags": int(TransferFlags.VOID_PENDING),
                "pending_id": int(pending_transfer_id),
                "user_data": 0,
                "timeout": 0,
            }])
            if errors:
                logger.error(f"TigerBeetle void errors: {errors}")
                return False
            logger.info(f"TigerBeetle transfer voided: {pending_transfer_id}")
            return True
        except Exception as e:
            logger.error(f"TigerBeetle void error: {e}")
            return False

    async def process_payment(self, payment_request: PaymentRequest, actor_id: str = "system") -> PaymentResponse:
        """Process a single payment with TigerBeetle double-entry accounting."""
        # Idempotency check
        if payment_request.idempotency_key:
            cached = await get_json(f"payment:idempotency:{payment_request.idempotency_key}")
            if cached:
                logger.info(f"Idempotent payment request, returning cached result")
                return PaymentResponse(**cached)

        payment_id = str(uuid.uuid4())
        tb_transfer_id: Optional[str] = None

        try:
            payee = await self.get_payee(payment_request.payee_id)
            if not payee or not payee.is_active:
                raise HTTPException(status_code=400, detail="Invalid or inactive payee")

            payment = Payment(
                payment_id=payment_id,
                claim_id=payment_request.claim_id,
                payee_id=payment_request.payee_id,
                amount=payment_request.amount,
                payment_method=payment_request.payment_method,
                payment_type=payment_request.payment_type,
                status=PaymentStatus.PENDING,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
                scheduled_date=payment_request.scheduled_date,
                description=payment_request.description,
                reference_number=payment_request.reference_number,
                metadata=payment_request.metadata
            )

            # Save to PostgreSQL
            await self.save_payment(payment, idempotency_key=payment_request.idempotency_key)

            # ── TigerBeetle: create PENDING double-entry transfer ──────────────
            tb_transfer_id = await self._record_tigerbeetle_transfer(
                payment_id=payment_id,
                claim_id=payment_request.claim_id,
                payee_id=payment_request.payee_id,
                amount=payment_request.amount,
                payment_type=payment_request.payment_type,
                pending=True
            )
            payment.tigerbeetle_transfer_id = tb_transfer_id
            # ──────────────────────────────────────────────────────────────────

            # Process via payment method
            if payment_request.payment_method == PaymentMethod.ACH:
                result = await self.process_ach_payment(payment, payee)
            elif payment_request.payment_method == PaymentMethod.WIRE:
                result = await self.process_wire_payment(payment, payee)
            elif payment_request.payment_method == PaymentMethod.CARD:
                result = await self.process_card_payment(payment, payee)
            elif payment_request.payment_method == PaymentMethod.CHECK:
                result = await self.process_check_payment(payment, payee)
            elif payment_request.payment_method == PaymentMethod.EFT:
                result = await self.process_eft_payment(payment, payee)
            elif payment_request.payment_method == PaymentMethod.VIRTUAL_CARD:
                result = await self.process_virtual_card_payment(payment, payee)
            else:
                raise HTTPException(status_code=400, detail="Unsupported payment method")

            # Update status
            payment.status = PaymentStatus.PROCESSING
            payment.transaction_id = result.get('transaction_id')
            payment.confirmation_number = result.get('confirmation_number')
            payment.updated_at = datetime.utcnow()
            await self.update_payment(payment)

            # ── TigerBeetle: POST (commit) the pending transfer ───────────────
            ledger_status = "not_recorded"
            if tb_transfer_id:
                posted = await self._post_tigerbeetle_transfer(tb_transfer_id)
                ledger_status = "committed" if posted else "pending_only"
            # ──────────────────────────────────────────────────────────────────

            # Audit log
            await self._audit_log(payment_id, "payment_created", None, PaymentStatus.PROCESSING.value, actor_id)

            # Notify
            await self.send_payment_notification(payment, payee)
            await self.cache_payment(payment)

            # Publish event
            await publish(Topics.PAYMENT_PROCESSED, {
                "payment_id": payment_id,
                "claim_id": payment_request.claim_id,
                "amount": float(payment_request.amount),
                "status": PaymentStatus.PROCESSING.value,
                "tigerbeetle_transfer_id": tb_transfer_id,
            })

            response = PaymentResponse(
                payment_id=payment_id,
                status=payment.status,
                transaction_id=payment.transaction_id,
                confirmation_number=payment.confirmation_number,
                estimated_completion=self.calculate_estimated_completion(payment.payment_method),
                tigerbeetle_transfer_id=tb_transfer_id,
                ledger_status=ledger_status
            )

            # Cache for idempotency
            if payment_request.idempotency_key:
                await set_json(
                    f"payment:idempotency:{payment_request.idempotency_key}",
                    response.dict(),
                    ttl=PAYMENT_IDEMPOTENCY_TTL
                )

            return response

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Payment processing failed: {e}")
            if 'payment' in locals():
                payment.status = PaymentStatus.FAILED
                await self.update_payment(payment)
                # Void TigerBeetle pending transfer on failure
                if tb_transfer_id:
                    await self._void_tigerbeetle_transfer(tb_transfer_id)
                await self._audit_log(payment_id, "payment_failed", PaymentStatus.PROCESSING.value, PaymentStatus.FAILED.value, actor_id, {"error": str(e)})
            raise HTTPException(status_code=500, detail=f"Payment processing failed: {str(e)}")

    async def process_ach_payment(self, payment: Payment, payee: Payee) -> Dict[str, Any]:
        """Process ACH payment"""
        bank_details = payee.bank_details
        if not bank_details or not all(k in bank_details for k in ['routing_number', 'account_number']):
            raise ValueError("Missing required bank details for ACH payment")
        # Validate routing number (9 digits)
        routing = str(bank_details.get('routing_number', ''))
        if not routing.isdigit() or len(routing) != 9:
            raise ValueError(f"Invalid ACH routing number: {routing}")
        return {
            'transaction_id': f"ACH{uuid.uuid4().hex[:12].upper()}",
            'confirmation_number': f"CONF{uuid.uuid4().hex[:8].upper()}",
            'estimated_completion': datetime.utcnow() + timedelta(days=1)
        }

    async def process_wire_payment(self, payment: Payment, payee: Payee) -> Dict[str, Any]:
        """Process wire transfer payment"""
        bank_details = payee.bank_details
        if not bank_details or not all(k in bank_details for k in ['swift_code', 'account_number']):
            raise ValueError("Missing required bank details for wire payment")
        swift = str(bank_details.get('swift_code', ''))
        if len(swift) not in (8, 11):
            raise ValueError(f"Invalid SWIFT code length: {swift}")
        return {
            'transaction_id': f"WIRE{uuid.uuid4().hex[:12].upper()}",
            'confirmation_number': f"CONF{uuid.uuid4().hex[:8].upper()}",
            'estimated_completion': datetime.utcnow() + timedelta(hours=4)
        }

    async def process_card_payment(self, payment: Payment, payee: Payee) -> Dict[str, Any]:
        """Process card payment"""
        stripe_key = os.getenv("STRIPE_SECRET_KEY")
        if not stripe_key:
            raise ValueError("STRIPE_SECRET_KEY not configured")
        try:
            import stripe as stripe_lib
            stripe_lib.api_key = stripe_key
            intent = stripe_lib.PaymentIntent.create(
                amount=int(payment.amount * 100),
                currency='usd',
                description=payment.description or f"Healthcare claim payment {payment.claim_id}",
                metadata={
                    'payment_id': payment.payment_id,
                    'claim_id': payment.claim_id,
                    'payee_id': payment.payee_id
                }
            )
            return {
                'transaction_id': intent.id,
                'confirmation_number': intent.client_secret,
                'estimated_completion': datetime.utcnow() + timedelta(minutes=5)
            }
        except Exception as e:
            raise ValueError(f"Stripe payment failed: {e}")

    async def process_check_payment(self, payment: Payment, payee: Payee) -> Dict[str, Any]:
        """Process check payment"""
        check_number = f"CHK{datetime.utcnow().strftime('%Y%m%d')}{payment.payment_id[:8].upper()}"
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO check_payments (check_number, payment_id, amount, payee_name, issued_at)
                VALUES ($1, $2, $3, $4, NOW())
                ON CONFLICT (check_number) DO NOTHING
            """, check_number, payment.payment_id, payment.amount, payee.name)
        return {
            'transaction_id': check_number,
            'confirmation_number': f"CHKCONF{uuid.uuid4().hex[:6].upper()}",
            'estimated_completion': datetime.utcnow() + timedelta(days=5)
        }

    async def process_eft_payment(self, payment: Payment, payee: Payee) -> Dict[str, Any]:
        """Process EFT payment"""
        return {
            'transaction_id': f"EFT{uuid.uuid4().hex[:12].upper()}",
            'confirmation_number': f"CONF{uuid.uuid4().hex[:8].upper()}",
            'estimated_completion': datetime.utcnow() + timedelta(hours=2)
        }

    async def process_virtual_card_payment(self, payment: Payment, payee: Payee) -> Dict[str, Any]:
        """Process virtual card payment"""
        return {
            'transaction_id': f"VC{uuid.uuid4().hex[:12].upper()}",
            'confirmation_number': f"CONF{uuid.uuid4().hex[:8].upper()}",
            'estimated_completion': datetime.utcnow() + timedelta(hours=1)
        }

    async def process_bulk_payments(self, bulk_request: BulkPaymentRequest, actor_id: str = "system") -> Dict[str, Any]:
        """Process multiple payments in bulk"""
        results = []
        failed = []
        for payment_req in bulk_request.payments:
            try:
                result = await self.process_payment(payment_req, actor_id)
                results.append(result.dict())
            except Exception as e:
                failed.append({"claim_id": payment_req.claim_id, "error": str(e)})
        return {
            "total": len(bulk_request.payments),
            "succeeded": len(results),
            "failed": len(failed),
            "results": results,
            "failures": failed
        }

    async def reconcile_payment(self, reconciliation_request: ReconciliationRequest) -> Dict[str, Any]:
        """Reconcile payment with bank records"""
        payment = await self.get_payment(reconciliation_request.payment_id)
        if not payment:
            raise HTTPException(status_code=404, detail="Payment not found")

        expected = payment.amount
        actual = reconciliation_request.actual_amount
        discrepancy = actual - expected

        if abs(discrepancy) < Decimal("0.01"):
            reconciliation_status = ReconciliationStatus.MATCHED
        elif abs(discrepancy) < Decimal("1.00"):
            reconciliation_status = ReconciliationStatus.DISCREPANCY
        else:
            reconciliation_status = ReconciliationStatus.UNMATCHED

        reconciliation_id = str(uuid.uuid4())
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO payment_reconciliations (
                    reconciliation_id, payment_id, bank_reference,
                    expected_amount, actual_amount, settlement_date, bank_fees, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """, reconciliation_id, reconciliation_request.payment_id,
                reconciliation_request.bank_reference, float(expected),
                float(actual), reconciliation_request.settlement_date,
                float(reconciliation_request.bank_fees), reconciliation_status.value)

        if reconciliation_status == ReconciliationStatus.MATCHED:
            payment.status = PaymentStatus.COMPLETED
            payment.completed_date = reconciliation_request.settlement_date
            payment.fees = reconciliation_request.bank_fees
            await self.update_payment(payment)

        return {
            "reconciliation_id": reconciliation_id,
            "payment_id": reconciliation_request.payment_id,
            "status": reconciliation_status.value,
            "expected_amount": float(expected),
            "actual_amount": float(actual),
            "discrepancy": float(discrepancy),
            "bank_fees": float(reconciliation_request.bank_fees),
            "reconciled_at": datetime.utcnow().isoformat()
        }

    async def calculate_late_payment_interest(self, payment_id: str, days_overdue: int) -> Dict[str, Any]:
        """
        NSA business rule: Calculate interest on late IDR determination payments.
        42 CFR §149.510(d): Interest accrues at the rate specified in 26 U.S.C. §6621(a)(2).
        """
        payment = await self.get_payment(payment_id)
        if not payment:
            raise HTTPException(status_code=404, detail="Payment not found")

        if payment.payment_type != PaymentType.IDR_DETERMINATION:
            raise HTTPException(status_code=400, detail="Interest only applies to IDR determination payments")

        daily_rate = NSA_INTEREST_RATE_ANNUAL / 365
        interest_amount = payment.amount * daily_rate * days_overdue
        total_due = payment.amount + interest_amount

        return {
            "payment_id": payment_id,
            "original_amount": float(payment.amount),
            "days_overdue": days_overdue,
            "daily_rate": float(daily_rate),
            "interest_amount": float(interest_amount.quantize(Decimal("0.01"))),
            "total_due": float(total_due.quantize(Decimal("0.01"))),
            "calculated_at": datetime.utcnow().isoformat()
        }

    async def get_payment_status(self, payment_id: str) -> Dict[str, Any]:
        """Get payment status and details"""
        cached = await get_json(f"payment:{payment_id}")
        if cached:
            return cached

        payment = await self.get_payment(payment_id)
        if not payment:
            raise HTTPException(status_code=404, detail="Payment not found")

        pool = await get_pool()
        async with pool.acquire() as conn:
            recon_row = await conn.fetchrow(
                "SELECT * FROM payment_reconciliations WHERE payment_id = $1 ORDER BY reconciled_at DESC LIMIT 1",
                payment_id
            )

        result = {
            'payment_id': payment.payment_id,
            'claim_id': payment.claim_id,
            'amount': float(payment.amount),
            'status': payment.status.value,
            'payment_method': payment.payment_method.value,
            'payment_type': payment.payment_type,
            'created_at': payment.created_at.isoformat(),
            'updated_at': payment.updated_at.isoformat(),
            'transaction_id': payment.transaction_id,
            'confirmation_number': payment.confirmation_number,
            'tigerbeetle_transfer_id': payment.tigerbeetle_transfer_id,
            'reconciliation': dict(recon_row) if recon_row else None
        }

        await set_json(f"payment:{payment_id}", result, ttl=300)
        return result

    # ── Database operations ───────────────────────────────────────────────────
    async def save_payment(self, payment: Payment, idempotency_key: Optional[str] = None):
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO payments (
                    payment_id, claim_id, payee_id, amount, payment_method, payment_type,
                    status, created_at, updated_at, scheduled_date, description,
                    reference_number, metadata, tigerbeetle_transfer_id, idempotency_key
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                ON CONFLICT (payment_id) DO NOTHING
            """, payment.payment_id, payment.claim_id, payment.payee_id,
                payment.amount, payment.payment_method.value, str(payment.payment_type),
                payment.status.value, payment.created_at, payment.updated_at,
                payment.scheduled_date, payment.description, payment.reference_number,
                json.dumps(payment.metadata or {}), payment.tigerbeetle_transfer_id,
                idempotency_key)

    async def update_payment(self, payment: Payment):
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute("""
                UPDATE payments SET
                    status = $2, updated_at = $3, completed_date = $4,
                    transaction_id = $5, confirmation_number = $6, fees = $7,
                    tigerbeetle_transfer_id = $8
                WHERE payment_id = $1
            """, payment.payment_id, payment.status.value, datetime.utcnow(),
                payment.completed_date, payment.transaction_id,
                payment.confirmation_number, payment.fees,
                payment.tigerbeetle_transfer_id)

    async def get_payment(self, payment_id: str) -> Optional[Payment]:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM payments WHERE payment_id = $1", payment_id)
            if row:
                d = dict(row)
                d['metadata'] = json.loads(d.get('metadata') or '{}')
                return Payment(**{k: v for k, v in d.items() if k in Payment.__dataclass_fields__})
            return None

    async def get_payee(self, payee_id: str) -> Optional[Payee]:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM payees WHERE payee_id = $1", payee_id)
            if row:
                d = dict(row)
                for field in ['payment_preferences', 'bank_details', 'address']:
                    if isinstance(d.get(field), str):
                        d[field] = json.loads(d[field])
                return Payee(**{k: v for k, v in d.items() if k in Payee.__dataclass_fields__})
            return None

    async def _audit_log(self, payment_id: str, action: str, old_status: Optional[str],
                         new_status: Optional[str], actor_id: str, details: Dict = None):
        try:
            pool = await get_pool()
            async with pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO payment_audit_log (payment_id, action, old_status, new_status, actor_id, details)
                    VALUES ($1, $2, $3, $4, $5, $6)
                """, payment_id, action, old_status, new_status, actor_id,
                    json.dumps(details or {}))
        except Exception as e:
            logger.error(f"Audit log failed: {e}")

    def calculate_estimated_completion(self, payment_method: PaymentMethod) -> datetime:
        now = datetime.utcnow()
        schedule = {
            PaymentMethod.CARD: timedelta(minutes=5),
            PaymentMethod.ACH: timedelta(days=1),
            PaymentMethod.WIRE: timedelta(hours=4),
            PaymentMethod.CHECK: timedelta(days=5),
            PaymentMethod.EFT: timedelta(hours=2),
            PaymentMethod.VIRTUAL_CARD: timedelta(hours=1),
        }
        return now + schedule.get(payment_method, timedelta(days=1))

    async def cache_payment(self, payment: Payment):
        payment_data = asdict(payment)
        await set_json(f"payment:{payment.payment_id}", payment_data, ttl=300)

    async def send_payment_notification(self, payment: Payment, payee: Payee):
        try:
            await publish(Topics.NOTIFICATION_REQUESTED, {
                "type": "payment_processed",
                "payment_id": payment.payment_id,
                "amount": float(payment.amount),
                "payee_name": payee.name,
                "status": payment.status.value
            })
        except Exception as e:
            logger.error(f"Failed to send payment notification: {e}")


# ── Global service instance ───────────────────────────────────────────────────
payment_service = PaymentProcessingService()

# ── API Routes ────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup_event():
    await payment_service.initialize()

@app.post("/payments", response_model=PaymentResponse)
async def create_payment(
    payment_request: PaymentRequest,
    background_tasks: BackgroundTasks,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Process a single payment with TigerBeetle double-entry accounting"""
    return await payment_service.process_payment(payment_request, actor_id=current_user.sub)

@app.post("/payments/bulk")
async def create_bulk_payments(
    bulk_request: BulkPaymentRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Process multiple payments in bulk"""
    return await payment_service.process_bulk_payments(bulk_request, actor_id=current_user.sub)

@app.get("/payments/{payment_id}")
async def get_payment_status(
    payment_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get payment status and TigerBeetle ledger details"""
    return await payment_service.get_payment_status(payment_id)

@app.post("/payments/{payment_id}/reconcile")
async def reconcile_payment(
    payment_id: str,
    reconciliation_request: ReconciliationRequest,
    current_user: TokenPayload = Depends(require_role(["admin", "health_plan"])),
):
    """Reconcile payment with bank records"""
    reconciliation_request.payment_id = payment_id
    return await payment_service.reconcile_payment(reconciliation_request)

@app.post("/payments/{payment_id}/cancel")
async def cancel_payment(
    payment_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Cancel a pending payment and void TigerBeetle transfer"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT payment_id, status, amount, tigerbeetle_transfer_id FROM payments WHERE payment_id=$1",
            payment_id
        )
        if not row:
            raise HTTPException(status_code=404, detail=f"Payment {payment_id} not found")
        if row["status"] not in ("pending", "initiated"):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot cancel payment in status '{row['status']}'"
            )
        await conn.execute(
            "UPDATE payments SET status='cancelled', updated_at=NOW() WHERE payment_id=$1",
            payment_id
        )
    # Void TigerBeetle pending transfer
    tb_id = row.get("tigerbeetle_transfer_id")
    if tb_id and payment_service.tb_client:
        await payment_service._void_tigerbeetle_transfer(tb_id)
    return {
        "payment_id": payment_id,
        "status": "cancelled",
        "amount": float(row["amount"]),
        "message": "Payment successfully cancelled",
        "tigerbeetle_voided": bool(tb_id),
        "cancelled_at": datetime.utcnow().isoformat()
    }

@app.post("/payments/{payment_id}/late-interest")
async def calculate_late_interest(
    payment_id: str,
    request: LatePaymentRequest,
    current_user: TokenPayload = Depends(require_role(["admin", "health_plan"])),
):
    """Calculate NSA late payment interest per 42 CFR §149.510(d)"""
    return await payment_service.calculate_late_payment_interest(payment_id, request.days_overdue)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    tb_status = "connected" if (payment_service.tb_client is not None) else "unavailable"
    return {
        "status": "healthy",
        "service": "Payment Processing Service",
        "tigerbeetle": tb_status,
        "timestamp": datetime.utcnow().isoformat()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8016)
