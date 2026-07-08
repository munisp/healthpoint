"""
Flexible Refund Processing Service
Handles NSA/IDR fee refunds with options for direct provider payments or aggregator redistribution.
Supports ACH (Dwolla), wire transfer (NACHA/FedWire), physical check, and Stripe card refunds.
All database operations use asyncpg (no SQLAlchemy sync). No stubs or simulations.
"""

# ── Shared HealthPoint infrastructure ─────────────────────────────────────────
import os
import sys
import os as _os
_repo_root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from backend.shared.database import fetch, fetchrow, execute, fetchval, transaction, bootstrap_schema, get_pool
from backend.shared.cache import get_client as get_redis_client, rate_limit_check, set_json, get_json
from backend.shared.auth import get_current_user, require_role, require_admin, security_headers_middleware, TokenPayload
from backend.shared.messaging import publish, Topics
from backend.shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer
# ─────────────────────────────────────────────────────────────────────────────

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any
from datetime import datetime, date, timedelta
from enum import Enum
import asyncio
import json
import logging
import httpx
import stripe
import uuid
from decimal import Decimal, ROUND_HALF_UP

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

setup_telemetry(service_name="flexible-refund-processing-service", service_version="2.0.0")
app = FastAPI(title="Flexible Refund Processing Service", version="2.0.0")
instrument_fastapi(app)
app.middleware("http")(security_headers_middleware)

# Stripe setup — key injected from Vault/env
stripe.api_key = os.getenv("STRIPE_API_KEY", "")

# Dwolla environment
DWOLLA_KEY = os.getenv("DWOLLA_KEY", "")
DWOLLA_SECRET = os.getenv("DWOLLA_SECRET", "")
DWOLLA_ENV = os.getenv("DWOLLA_ENVIRONMENT", "sandbox")
DWOLLA_BASE = "https://api.dwolla.com" if DWOLLA_ENV == "production" else "https://api-sandbox.dwolla.com"
DWOLLA_SOURCE_FUNDING_URL = os.getenv("DWOLLA_SOURCE_FUNDING_URL", "")

# ── Enums ─────────────────────────────────────────────────────────────────────

class RefundStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    PARTIAL = "partial"

class RefundMethod(str, Enum):
    DIRECT_TO_PROVIDER = "direct_to_provider"
    TO_AGGREGATOR = "to_aggregator"
    MIXED = "mixed"

class PaymentMethodType(str, Enum):
    ACH = "ach"
    WIRE_TRANSFER = "wire_transfer"
    CHECK = "check"
    CREDIT_CARD = "credit_card"

class RefundType(str, Enum):
    NSA_IDR_FEE = "nsa_idr_fee"
    OVERPAYMENT = "overpayment"
    DISPUTE_RESOLUTION = "dispute_resolution"
    ADMINISTRATIVE_FEE = "administrative_fee"

# ── Pydantic models ───────────────────────────────────────────────────────────

class RefundRequest(BaseModel):
    aggregator_id: str
    refund_type: RefundType
    refund_method: RefundMethod
    provider_refunds: List[Dict[str, Any]]
    processing_delay_days: int = Field(default=0, ge=0, le=30)
    batch_processing: bool = Field(default=True)

class RefundProcessingResult(BaseModel):
    batch_id: str
    total_refunds: int
    successful_refunds: int
    failed_refunds: int
    total_amount: float
    status: RefundStatus
    processing_details: Dict[str, Any]

# ── DB bootstrap ──────────────────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS refund_batches (
    id              BIGSERIAL PRIMARY KEY,
    batch_id        VARCHAR(120) UNIQUE NOT NULL,
    aggregator_id   VARCHAR(60) NOT NULL,
    refund_type     VARCHAR(40) NOT NULL,
    refund_method   VARCHAR(40) NOT NULL,
    total_amount    NUMERIC(15,2) NOT NULL,
    total_refunds   INT NOT NULL,
    successful_refunds INT DEFAULT 0,
    failed_refunds  INT DEFAULT 0,
    status          VARCHAR(20) DEFAULT 'pending',
    processing_date TIMESTAMPTZ,
    completion_date TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refund_batches_aggregator ON refund_batches(aggregator_id);
CREATE INDEX IF NOT EXISTS idx_refund_batches_status ON refund_batches(status);

CREATE TABLE IF NOT EXISTS individual_refunds (
    id              BIGSERIAL PRIMARY KEY,
    refund_id       VARCHAR(120) UNIQUE NOT NULL,
    batch_id        VARCHAR(120) REFERENCES refund_batches(batch_id) ON DELETE CASCADE,
    provider_npi    VARCHAR(10) NOT NULL,
    provider_name   VARCHAR(255),
    aggregator_id   VARCHAR(60),
    original_amount NUMERIC(15,2),
    refund_amount   NUMERIC(15,2) NOT NULL,
    aggregator_fee  NUMERIC(15,2) DEFAULT 0,
    processing_fee  NUMERIC(15,2) DEFAULT 0,
    payment_method  VARCHAR(30),
    status          VARCHAR(20) DEFAULT 'pending',
    transaction_id  VARCHAR(120),
    external_reference VARCHAR(120),
    processing_date TIMESTAMPTZ,
    completion_date TIMESTAMPTZ,
    failure_reason  TEXT,
    dispute_claim_id VARCHAR(60),
    cms_confirmation_number VARCHAR(120),
    idr_decision_date DATE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_individual_refunds_batch ON individual_refunds(batch_id);
CREATE INDEX IF NOT EXISTS idx_individual_refunds_npi ON individual_refunds(provider_npi);

CREATE TABLE IF NOT EXISTS aggregator_refunds (
    id              BIGSERIAL PRIMARY KEY,
    refund_id       VARCHAR(120) UNIQUE NOT NULL,
    batch_id        VARCHAR(120) REFERENCES refund_batches(batch_id) ON DELETE CASCADE,
    aggregator_id   VARCHAR(60) NOT NULL,
    total_provider_refunds NUMERIC(15,2),
    aggregator_fee_retained NUMERIC(15,2),
    processing_fees NUMERIC(15,2),
    net_refund_amount NUMERIC(15,2) NOT NULL,
    provider_count  INT,
    provider_breakdown JSONB,
    payment_method  VARCHAR(30),
    status          VARCHAR(20) DEFAULT 'pending',
    transaction_id  VARCHAR(120),
    external_reference VARCHAR(120),
    processing_date TIMESTAMPTZ,
    completion_date TIMESTAMPTZ,
    failure_reason  TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aggregator_refunds_batch ON aggregator_refunds(batch_id);

CREATE TABLE IF NOT EXISTS refund_processing_logs (
    id          BIGSERIAL PRIMARY KEY,
    batch_id    VARCHAR(120),
    refund_id   VARCHAR(120),
    action      VARCHAR(100) NOT NULL,
    status      VARCHAR(20),
    details     JSONB,
    error_message TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refund_logs_batch ON refund_processing_logs(batch_id);
"""

@app.on_event("startup")
async def startup():
    await bootstrap_schema(SCHEMA_SQL)

# ── Payment helpers ───────────────────────────────────────────────────────────

async def _get_dwolla_token(client: httpx.AsyncClient) -> str:
    """Obtain a Dwolla OAuth2 client_credentials token."""
    if not DWOLLA_KEY or not DWOLLA_SECRET:
        raise HTTPException(
            status_code=503,
            detail="DWOLLA_KEY and DWOLLA_SECRET environment variables are required for ACH payments."
        )
    resp = await client.post(
        f"{DWOLLA_BASE}/token",
        data={"grant_type": "client_credentials"},
        auth=(DWOLLA_KEY, DWOLLA_SECRET),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Dwolla authentication failed: {resp.status_code} {resp.text[:300]}"
        )
    return resp.json()["access_token"]


async def _process_ach_payment(
    amount: Decimal,
    provider_npi: str,
    provider_name: str,
    description: str,
    idempotency_key: str,
) -> str:
    """
    Execute a real ACH credit via the Dwolla API.

    Requires:
      - DWOLLA_KEY / DWOLLA_SECRET — Dwolla application credentials
      - DWOLLA_SOURCE_FUNDING_URL  — Dwolla funding-source URL for the health plan's bank account
      - Row in payee_bank_accounts with dwolla_funding_source_url for the provider NPI
    """
    if not DWOLLA_SOURCE_FUNDING_URL:
        raise HTTPException(
            status_code=503,
            detail="DWOLLA_SOURCE_FUNDING_URL is required — set it to the Dwolla funding-source URL "
                   "for the health plan's bank account."
        )

    pool = await get_pool()
    dest_row = await pool.fetchrow(
        """SELECT dwolla_funding_source_url
           FROM payee_bank_accounts
           WHERE provider_npi = $1 AND is_active = TRUE
           ORDER BY created_at DESC LIMIT 1""",
        provider_npi,
    )
    if not dest_row or not dest_row["dwolla_funding_source_url"]:
        raise HTTPException(
            status_code=422,
            detail=f"No active Dwolla funding source found for provider NPI {provider_npi}. "
                   "The provider must register a verified bank account in Dwolla before ACH payments can be made."
        )
    dest_funding_url = dest_row["dwolla_funding_source_url"]

    async with httpx.AsyncClient(timeout=30) as client:
        access_token = await _get_dwolla_token(client)
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/vnd.dwolla.v1.hal+json",
            "Accept": "application/vnd.dwolla.v1.hal+json",
            "Idempotency-Key": idempotency_key,
        }
        transfer_payload = {
            "_links": {
                "source": {"href": DWOLLA_SOURCE_FUNDING_URL},
                "destination": {"href": dest_funding_url},
            },
            "amount": {"currency": "USD", "value": str(amount.quantize(Decimal("0.01")))},
            "metadata": {
                "provider_npi": provider_npi,
                "provider_name": provider_name,
                "description": description,
            },
            "correlationId": idempotency_key,
        }
        transfer_resp = await client.post(
            f"{DWOLLA_BASE}/transfers",
            json=transfer_payload,
            headers=headers,
        )
        if transfer_resp.status_code not in (200, 201):
            raise HTTPException(
                status_code=502,
                detail=f"Dwolla transfer failed: {transfer_resp.status_code} {transfer_resp.text[:400]}"
            )
        location = transfer_resp.headers.get("Location", "")
        transfer_id = location.split("/")[-1] if location else f"DWL-{uuid.uuid4().hex[:12].upper()}"
        logger.info(f"Dwolla ACH transfer created: {transfer_id} for ${amount} to {provider_name} (NPI {provider_npi})")
        return transfer_id


async def _process_wire_transfer(
    amount: Decimal,
    provider_npi: str,
    provider_name: str,
    description: str,
    idempotency_key: str,
) -> str:
    """
    Initiate a domestic wire transfer via the FedWire / SWIFT gateway.

    Requires:
      - WIRE_GATEWAY_URL     — Base URL of the bank's wire API (e.g. https://api.yourbank.com/wire)
      - WIRE_API_KEY         — API key for the wire gateway
      - WIRE_ORIGINATOR_ABA  — ABA routing number of the originating account
      - WIRE_ORIGINATOR_ACCT — Account number of the originating account
      - Row in payee_bank_accounts with routing_number, account_number, account_type for the provider NPI
    """
    gateway_url = os.getenv("WIRE_GATEWAY_URL")
    wire_api_key = os.getenv("WIRE_API_KEY")
    originator_aba = os.getenv("WIRE_ORIGINATOR_ABA")
    originator_acct = os.getenv("WIRE_ORIGINATOR_ACCT")

    if not all([gateway_url, wire_api_key, originator_aba, originator_acct]):
        raise HTTPException(
            status_code=503,
            detail="Wire transfer requires WIRE_GATEWAY_URL, WIRE_API_KEY, WIRE_ORIGINATOR_ABA, "
                   "and WIRE_ORIGINATOR_ACCT environment variables."
        )

    pool = await get_pool()
    bank_row = await pool.fetchrow(
        """SELECT routing_number, account_number, account_type, bank_name
           FROM payee_bank_accounts
           WHERE provider_npi = $1 AND is_active = TRUE
           ORDER BY created_at DESC LIMIT 1""",
        provider_npi,
    )
    if not bank_row:
        raise HTTPException(
            status_code=422,
            detail=f"No active bank account found for provider NPI {provider_npi}."
        )

    wire_payload = {
        "idempotencyKey": idempotency_key,
        "amount": str(amount.quantize(Decimal("0.01"))),
        "currency": "USD",
        "originator": {
            "routingNumber": originator_aba,
            "accountNumber": originator_acct,
        },
        "beneficiary": {
            "name": provider_name,
            "routingNumber": bank_row["routing_number"],
            "accountNumber": bank_row["account_number"],
            "accountType": bank_row["account_type"],
            "bankName": bank_row.get("bank_name", ""),
        },
        "remittanceInfo": description[:140],  # FedWire OBI field limit
        "providerNpi": provider_npi,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{gateway_url}/v1/wires",
            json=wire_payload,
            headers={
                "Authorization": f"Bearer {wire_api_key}",
                "Content-Type": "application/json",
                "Idempotency-Key": idempotency_key,
            },
        )
        if resp.status_code not in (200, 201, 202):
            raise HTTPException(
                status_code=502,
                detail=f"Wire gateway error: {resp.status_code} {resp.text[:400]}"
            )
        data = resp.json()
        wire_id = data.get("wireId") or data.get("referenceId") or f"WIRE-{uuid.uuid4().hex[:12].upper()}"
        logger.info(f"Wire transfer initiated: {wire_id} for ${amount} to {provider_name} (NPI {provider_npi})")
        return wire_id


async def _generate_check_request(
    amount: Decimal,
    provider_npi: str,
    provider_name: str,
    description: str,
    idempotency_key: str,
) -> str:
    """
    Submit a physical check print-and-mail request via the check fulfillment API.

    Requires:
      - CHECK_FULFILLMENT_URL — Base URL of the check fulfillment service
      - CHECK_API_KEY         — API key for the check fulfillment service
      - Row in provider_addresses with mailing address for the provider NPI
    """
    fulfillment_url = os.getenv("CHECK_FULFILLMENT_URL")
    check_api_key = os.getenv("CHECK_API_KEY")

    if not fulfillment_url or not check_api_key:
        raise HTTPException(
            status_code=503,
            detail="CHECK_FULFILLMENT_URL and CHECK_API_KEY environment variables are required for check payments."
        )

    pool = await get_pool()
    addr_row = await pool.fetchrow(
        """SELECT address_line1, address_line2, city, state, zip_code
           FROM provider_addresses
           WHERE provider_npi = $1 AND address_type = 'mailing' AND is_active = TRUE
           ORDER BY created_at DESC LIMIT 1""",
        provider_npi,
    )
    if not addr_row:
        raise HTTPException(
            status_code=422,
            detail=f"No active mailing address found for provider NPI {provider_npi}. "
                   "A mailing address is required to issue a physical check."
        )

    check_number = f"CHK-{datetime.utcnow().strftime('%Y%m%d')}-{idempotency_key[-8:].upper()}"
    check_payload = {
        "idempotencyKey": idempotency_key,
        "checkNumber": check_number,
        "amount": str(amount.quantize(Decimal("0.01"))),
        "currency": "USD",
        "payee": {
            "name": provider_name,
            "npi": provider_npi,
            "address": {
                "line1": addr_row["address_line1"],
                "line2": addr_row.get("address_line2", ""),
                "city": addr_row["city"],
                "state": addr_row["state"],
                "zip": addr_row["zip_code"],
                "country": "US",
            },
        },
        "memo": description[:80],
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{fulfillment_url}/v1/checks",
            json=check_payload,
            headers={
                "Authorization": f"Bearer {check_api_key}",
                "Content-Type": "application/json",
                "Idempotency-Key": idempotency_key,
            },
        )
        if resp.status_code not in (200, 201, 202):
            raise HTTPException(
                status_code=502,
                detail=f"Check fulfillment error: {resp.status_code} {resp.text[:400]}"
            )
        data = resp.json()
        check_id = data.get("checkId") or data.get("referenceId") or check_number
        logger.info(f"Check request submitted: {check_id} for ${amount} to {provider_name} (NPI {provider_npi})")
        # Persist the check record in DB for audit
        await execute(
            """INSERT INTO check_payments (check_number, check_id, provider_npi, provider_name,
               amount, description, idempotency_key, status, submitted_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'submitted', NOW())
               ON CONFLICT (idempotency_key) DO NOTHING""",
            check_number, check_id, provider_npi, provider_name,
            float(amount), description, idempotency_key,
        )
        return check_id


async def _process_stripe_refund(
    amount: Decimal,
    provider_npi: str,
    description: str,
    idempotency_key: str,
) -> str:
    """
    Issue a Stripe refund against the original charge stored in provider_stripe_charges.
    Requires STRIPE_API_KEY and a row in provider_stripe_charges for the provider NPI.
    """
    if not stripe.api_key:
        raise HTTPException(
            status_code=503,
            detail="STRIPE_API_KEY environment variable is required for card refunds."
        )

    pool = await get_pool()
    charge_row = await pool.fetchrow(
        """SELECT stripe_charge_id
           FROM provider_stripe_charges
           WHERE provider_npi = $1 AND refunded = FALSE
           ORDER BY created_at DESC LIMIT 1""",
        provider_npi,
    )
    if not charge_row:
        raise HTTPException(
            status_code=422,
            detail=f"No unrefunded Stripe charge found for provider NPI {provider_npi}."
        )

    refund = stripe.Refund.create(
        charge=charge_row["stripe_charge_id"],
        amount=int(amount * 100),  # Stripe uses cents
        reason="requested_by_customer",
        metadata={
            "provider_npi": provider_npi,
            "description": description,
            "idempotency_key": idempotency_key,
        },
        idempotency_key=idempotency_key,
    )
    logger.info(f"Stripe refund created: {refund.id} for ${amount} to NPI {provider_npi}")
    return refund.id


# ── Core processing engine ────────────────────────────────────────────────────

async def _log_action(batch_id: str, refund_id: Optional[str], action: str, status: str, details: Dict[str, Any]):
    """Persist a processing log entry via asyncpg."""
    try:
        await execute(
            """INSERT INTO refund_processing_logs (batch_id, refund_id, action, status, details, created_at)
               VALUES ($1, $2, $3, $4, $5::jsonb, NOW())""",
            batch_id, refund_id, action, status, json.dumps(details),
        )
    except Exception as exc:
        logger.error(f"Failed to write processing log: {exc}")


async def _execute_provider_payment(
    refund_id: str,
    batch_id: str,
    provider_npi: str,
    provider_name: str,
    refund_amount: Decimal,
    payment_method: str,
    dispute_claim_id: Optional[str],
) -> str:
    """Route to the correct payment processor and return the transaction ID."""
    idem_key = f"{batch_id}-{refund_id}"
    description = f"NSA/IDR Refund - {dispute_claim_id or refund_id}"

    if payment_method == PaymentMethodType.ACH:
        return await _process_ach_payment(refund_amount, provider_npi, provider_name, description, idem_key)
    elif payment_method == PaymentMethodType.WIRE_TRANSFER:
        return await _process_wire_transfer(refund_amount, provider_npi, provider_name, description, idem_key)
    elif payment_method == PaymentMethodType.CHECK:
        return await _generate_check_request(refund_amount, provider_npi, provider_name, description, idem_key)
    elif payment_method == PaymentMethodType.CREDIT_CARD:
        return await _process_stripe_refund(refund_amount, provider_npi, description, idem_key)
    else:
        raise ValueError(f"Unsupported payment method: {payment_method}")


async def _process_direct_provider_refunds(
    batch_id: str,
    aggregator_id: str,
    provider_refunds: List[Dict[str, Any]],
    aggregator_fee_pct: float,
    processing_fee: float,
    provider_payment_method: str,
) -> Dict[str, Any]:
    """Process refunds directly to individual providers via asyncpg."""
    successful = 0
    failed = 0
    details: Dict[str, Any] = {"direct_refunds": [], "failed_refunds": []}

    for refund_data in provider_refunds:
        provider_npi = refund_data["provider_npi"]
        provider_name = refund_data.get("provider_name", "")
        original_amount = Decimal(str(refund_data["refund_amount"]))
        agg_fee = (original_amount * Decimal(str(aggregator_fee_pct)) / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        proc_fee = Decimal(str(processing_fee)).quantize(Decimal("0.01"))
        net_amount = (original_amount - agg_fee - proc_fee).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        if net_amount <= 0:
            failed += 1
            details["failed_refunds"].append({"provider_npi": provider_npi, "reason": "Net refund amount is zero or negative after fees"})
            continue

        refund_id = f"REFUND-{provider_npi}-{uuid.uuid4().hex[:10].upper()}"

        # Persist the individual refund record
        await execute(
            """INSERT INTO individual_refunds
               (refund_id, batch_id, provider_npi, provider_name, aggregator_id,
                original_amount, refund_amount, aggregator_fee, processing_fee,
                payment_method, status, dispute_claim_id, cms_confirmation_number,
                idr_decision_date, created_at, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'processing',$11,$12,$13,NOW(),NOW())""",
            refund_id, batch_id, provider_npi, provider_name, aggregator_id,
            float(original_amount), float(net_amount), float(agg_fee), float(proc_fee),
            provider_payment_method,
            refund_data.get("dispute_claim_id"),
            refund_data.get("cms_confirmation_number"),
            refund_data.get("idr_decision_date"),
        )

        try:
            transaction_id = await _execute_provider_payment(
                refund_id, batch_id, provider_npi, provider_name,
                net_amount, provider_payment_method,
                refund_data.get("dispute_claim_id"),
            )
            await execute(
                """UPDATE individual_refunds
                   SET status='completed', transaction_id=$1, completion_date=NOW(), updated_at=NOW()
                   WHERE refund_id=$2""",
                transaction_id, refund_id,
            )
            successful += 1
            details["direct_refunds"].append({
                "refund_id": refund_id,
                "provider_npi": provider_npi,
                "net_amount": float(net_amount),
                "transaction_id": transaction_id,
            })
            await _log_action(batch_id, refund_id, "PAYMENT_COMPLETED", "completed",
                               {"transaction_id": transaction_id, "amount": float(net_amount)})
        except Exception as exc:
            logger.error(f"Payment failed for NPI {provider_npi}: {exc}")
            await execute(
                """UPDATE individual_refunds
                   SET status='failed', failure_reason=$1, updated_at=NOW()
                   WHERE refund_id=$2""",
                str(exc)[:500], refund_id,
            )
            failed += 1
            details["failed_refunds"].append({"provider_npi": provider_npi, "reason": str(exc)[:200]})
            await _log_action(batch_id, refund_id, "PAYMENT_FAILED", "failed", {"error": str(exc)[:200]})

    return {"successful_refunds": successful, "failed_refunds": failed, "details": details}


async def _process_aggregator_consolidated_refund(
    batch_id: str,
    aggregator_id: str,
    provider_refunds: List[Dict[str, Any]],
    aggregator_fee_pct: float,
    processing_fee: float,
    aggregator_payment_method: str,
) -> Dict[str, Any]:
    """Send a single consolidated payment to the aggregator for redistribution."""
    total_provider_refunds = sum(Decimal(str(r["refund_amount"])) for r in provider_refunds)
    agg_fee_retained = (total_provider_refunds * Decimal(str(aggregator_fee_pct)) / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    proc_fees = Decimal(str(processing_fee)).quantize(Decimal("0.01"))
    net_amount = (total_provider_refunds - agg_fee_retained - proc_fees).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    if net_amount <= 0:
        return {"successful_refunds": 0, "failed_refunds": len(provider_refunds),
                "details": {"error": "Net aggregator refund is zero or negative after fees"}}

    agg_refund_id = f"AGG-REFUND-{aggregator_id}-{uuid.uuid4().hex[:10].upper()}"
    provider_breakdown = [
        {"provider_npi": r["provider_npi"], "amount": float(Decimal(str(r["refund_amount"])))}
        for r in provider_refunds
    ]

    await execute(
        """INSERT INTO aggregator_refunds
           (refund_id, batch_id, aggregator_id, total_provider_refunds,
            aggregator_fee_retained, processing_fees, net_refund_amount,
            provider_count, provider_breakdown, payment_method, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,'processing',NOW(),NOW())""",
        agg_refund_id, batch_id, aggregator_id,
        float(total_provider_refunds), float(agg_fee_retained), float(proc_fees), float(net_amount),
        len(provider_refunds), json.dumps(provider_breakdown), aggregator_payment_method,
    )

    # Retrieve aggregator's bank details from DB
    pool = await get_pool()
    agg_bank = await pool.fetchrow(
        """SELECT routing_number, account_number, dwolla_funding_source_url, bank_name
           FROM aggregator_bank_accounts
           WHERE aggregator_id = $1 AND is_active = TRUE
           ORDER BY created_at DESC LIMIT 1""",
        aggregator_id,
    )
    if not agg_bank:
        await execute(
            "UPDATE aggregator_refunds SET status='failed', failure_reason=$1, updated_at=NOW() WHERE refund_id=$2",
            f"No active bank account found for aggregator {aggregator_id}", agg_refund_id,
        )
        return {"successful_refunds": 0, "failed_refunds": len(provider_refunds),
                "details": {"error": f"No active bank account for aggregator {aggregator_id}"}}

    idem_key = f"{batch_id}-{agg_refund_id}"
    description = f"Consolidated NSA/IDR refund for {len(provider_refunds)} providers"

    try:
        if aggregator_payment_method == PaymentMethodType.ACH:
            # Use aggregator's Dwolla funding source if available, else fall back to wire
            if agg_bank.get("dwolla_funding_source_url"):
                dest_funding_url = agg_bank["dwolla_funding_source_url"]
                async with httpx.AsyncClient(timeout=30) as client:
                    access_token = await _get_dwolla_token(client)
                    headers = {
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/vnd.dwolla.v1.hal+json",
                        "Accept": "application/vnd.dwolla.v1.hal+json",
                        "Idempotency-Key": idem_key,
                    }
                    transfer_resp = await client.post(
                        f"{DWOLLA_BASE}/transfers",
                        json={
                            "_links": {
                                "source": {"href": DWOLLA_SOURCE_FUNDING_URL},
                                "destination": {"href": dest_funding_url},
                            },
                            "amount": {"currency": "USD", "value": str(net_amount.quantize(Decimal("0.01")))},
                            "metadata": {"aggregator_id": aggregator_id, "description": description},
                            "correlationId": idem_key,
                        },
                        headers=headers,
                    )
                    if transfer_resp.status_code not in (200, 201):
                        raise HTTPException(status_code=502, detail=f"Dwolla aggregator transfer failed: {transfer_resp.text[:300]}")
                    location = transfer_resp.headers.get("Location", "")
                    transaction_id = location.split("/")[-1] if location else f"DWL-AGG-{uuid.uuid4().hex[:12].upper()}"
            else:
                # Fall back to wire transfer using bank routing/account
                transaction_id = await _process_wire_transfer(
                    net_amount, aggregator_id, f"Aggregator {aggregator_id}", description, idem_key
                )
        elif aggregator_payment_method == PaymentMethodType.WIRE_TRANSFER:
            transaction_id = await _process_wire_transfer(
                net_amount, aggregator_id, f"Aggregator {aggregator_id}", description, idem_key
            )
        else:
            raise ValueError(f"Unsupported aggregator payment method: {aggregator_payment_method}")

        await execute(
            """UPDATE aggregator_refunds
               SET status='completed', transaction_id=$1, completion_date=NOW(), updated_at=NOW()
               WHERE refund_id=$2""",
            transaction_id, agg_refund_id,
        )
        await _log_action(batch_id, agg_refund_id, "AGG_PAYMENT_COMPLETED", "completed",
                           {"transaction_id": transaction_id, "net_amount": float(net_amount)})
        return {
            "successful_refunds": len(provider_refunds),
            "failed_refunds": 0,
            "details": {"aggregator_refund_id": agg_refund_id, "transaction_id": transaction_id, "net_amount": float(net_amount)},
        }

    except Exception as exc:
        logger.error(f"Aggregator payment failed: {exc}")
        await execute(
            "UPDATE aggregator_refunds SET status='failed', failure_reason=$1, updated_at=NOW() WHERE refund_id=$2",
            str(exc)[:500], agg_refund_id,
        )
        await _log_action(batch_id, agg_refund_id, "AGG_PAYMENT_FAILED", "failed", {"error": str(exc)[:200]})
        return {"successful_refunds": 0, "failed_refunds": len(provider_refunds),
                "details": {"error": str(exc)[:200]}}


async def _get_aggregator_prefs(aggregator_id: str) -> Dict[str, Any]:
    """Fetch aggregator refund preferences from DB."""
    row = await fetchrow(
        """SELECT aggregator_fee_percentage, processing_fee,
                  provider_payment_method, aggregator_payment_method
           FROM aggregator_refund_preferences
           WHERE aggregator_id = $1""",
        aggregator_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail=f"Aggregator refund preferences not found for {aggregator_id}")
    return dict(row)


async def process_refund_batch(refund_request: RefundRequest) -> RefundProcessingResult:
    """Orchestrate a full refund batch — direct, aggregator, or mixed."""
    batch_id = f"REFUND-{refund_request.aggregator_id}-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"
    total_amount = sum(Decimal(str(r["refund_amount"])) for r in refund_request.provider_refunds)

    prefs = await _get_aggregator_prefs(refund_request.aggregator_id)

    await execute(
        """INSERT INTO refund_batches
           (batch_id, aggregator_id, refund_type, refund_method,
            total_amount, total_refunds, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW())""",
        batch_id, refund_request.aggregator_id,
        refund_request.refund_type.value, refund_request.refund_method.value,
        float(total_amount), len(refund_request.provider_refunds),
    )
    await _log_action(batch_id, None, "BATCH_CREATED", "pending",
                      {"total_refunds": len(refund_request.provider_refunds), "total_amount": float(total_amount)})

    if refund_request.refund_method == RefundMethod.DIRECT_TO_PROVIDER:
        result = await _process_direct_provider_refunds(
            batch_id, refund_request.aggregator_id, refund_request.provider_refunds,
            prefs["aggregator_fee_percentage"], prefs["processing_fee"],
            prefs["provider_payment_method"],
        )
    elif refund_request.refund_method == RefundMethod.TO_AGGREGATOR:
        result = await _process_aggregator_consolidated_refund(
            batch_id, refund_request.aggregator_id, refund_request.provider_refunds,
            prefs["aggregator_fee_percentage"], prefs["processing_fee"],
            prefs["aggregator_payment_method"],
        )
    else:  # MIXED — amounts > $1000 go direct, smaller amounts through aggregator
        direct = [r for r in refund_request.provider_refunds if Decimal(str(r["refund_amount"])) > 1000]
        via_agg = [r for r in refund_request.provider_refunds if Decimal(str(r["refund_amount"])) <= 1000]
        d_res = await _process_direct_provider_refunds(
            batch_id, refund_request.aggregator_id, direct,
            prefs["aggregator_fee_percentage"], prefs["processing_fee"],
            prefs["provider_payment_method"],
        ) if direct else {"successful_refunds": 0, "failed_refunds": 0, "details": {}}
        a_res = await _process_aggregator_consolidated_refund(
            batch_id, refund_request.aggregator_id, via_agg,
            prefs["aggregator_fee_percentage"], prefs["processing_fee"],
            prefs["aggregator_payment_method"],
        ) if via_agg else {"successful_refunds": 0, "failed_refunds": 0, "details": {}}
        result = {
            "successful_refunds": d_res["successful_refunds"] + a_res["successful_refunds"],
            "failed_refunds": d_res["failed_refunds"] + a_res["failed_refunds"],
            "details": {"direct": d_res["details"], "aggregator": a_res["details"]},
        }

    # Determine final batch status
    if result["failed_refunds"] == 0:
        final_status = RefundStatus.COMPLETED
    elif result["successful_refunds"] > 0:
        final_status = RefundStatus.PARTIAL
    else:
        final_status = RefundStatus.FAILED

    await execute(
        """UPDATE refund_batches
           SET successful_refunds=$1, failed_refunds=$2, status=$3,
               processing_date=NOW(), completion_date=CASE WHEN $3='completed' THEN NOW() ELSE NULL END
           WHERE batch_id=$4""",
        result["successful_refunds"], result["failed_refunds"], final_status.value, batch_id,
    )

    # Publish event for downstream consumers
    await publish(Topics.REFUND_PROCESSED, {
        "batch_id": batch_id,
        "aggregator_id": refund_request.aggregator_id,
        "status": final_status.value,
        "total_amount": float(total_amount),
        "successful_refunds": result["successful_refunds"],
    })

    return RefundProcessingResult(
        batch_id=batch_id,
        total_refunds=len(refund_request.provider_refunds),
        successful_refunds=result["successful_refunds"],
        failed_refunds=result["failed_refunds"],
        total_amount=float(total_amount),
        status=final_status,
        processing_details=result["details"],
    )


# ── API endpoints ─────────────────────────────────────────────────────────────

@app.post("/api/v1/refunds/process-batch", response_model=RefundProcessingResult)
async def api_process_refund_batch(
    refund_request: RefundRequest,
    background_tasks: BackgroundTasks,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Process a batch of NSA/IDR refunds."""
    return await process_refund_batch(refund_request)


@app.get("/api/v1/refunds/batch-status/{batch_id}")
async def api_get_batch_status(
    batch_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get refund batch status with individual and aggregator refund details."""
    batch = await fetchrow(
        "SELECT * FROM refund_batches WHERE batch_id = $1", batch_id
    )
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    individual_refunds = await fetch(
        "SELECT * FROM individual_refunds WHERE batch_id = $1 ORDER BY created_at", batch_id
    )
    aggregator_refunds = await fetch(
        "SELECT * FROM aggregator_refunds WHERE batch_id = $1 ORDER BY created_at", batch_id
    )

    return {
        "batch_id": batch["batch_id"],
        "aggregator_id": batch["aggregator_id"],
        "refund_type": batch["refund_type"],
        "refund_method": batch["refund_method"],
        "total_amount": float(batch["total_amount"]),
        "total_refunds": batch["total_refunds"],
        "successful_refunds": batch["successful_refunds"],
        "failed_refunds": batch["failed_refunds"],
        "status": batch["status"],
        "created_at": batch["created_at"].isoformat(),
        "processing_date": batch["processing_date"].isoformat() if batch["processing_date"] else None,
        "completion_date": batch["completion_date"].isoformat() if batch["completion_date"] else None,
        "individual_refunds": [
            {
                "refund_id": r["refund_id"],
                "provider_npi": r["provider_npi"],
                "provider_name": r["provider_name"],
                "refund_amount": float(r["refund_amount"]),
                "status": r["status"],
                "transaction_id": r["transaction_id"],
                "failure_reason": r["failure_reason"],
            }
            for r in individual_refunds
        ],
        "aggregator_refunds": [
            {
                "refund_id": r["refund_id"],
                "net_refund_amount": float(r["net_refund_amount"]),
                "provider_count": r["provider_count"],
                "status": r["status"],
                "transaction_id": r["transaction_id"],
                "failure_reason": r["failure_reason"],
            }
            for r in aggregator_refunds
        ],
    }


@app.get("/api/v1/refunds/aggregator-summary/{aggregator_id}")
async def api_get_aggregator_refund_summary(
    aggregator_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get refund summary statistics for an aggregator."""
    rows = await fetch(
        """SELECT batch_id, refund_type, refund_method, total_amount,
                  total_refunds, successful_refunds, failed_refunds, status, created_at
           FROM refund_batches
           WHERE aggregator_id = $1
           ORDER BY created_at DESC""",
        aggregator_id,
    )
    total_amount = sum(float(r["total_amount"]) for r in rows)
    total_refunds = sum(r["total_refunds"] for r in rows)
    successful_refunds = sum(r["successful_refunds"] for r in rows)

    return {
        "aggregator_id": aggregator_id,
        "total_batches": len(rows),
        "total_amount_refunded": total_amount,
        "total_refunds_processed": total_refunds,
        "successful_refunds": successful_refunds,
        "success_rate": (successful_refunds / total_refunds * 100) if total_refunds > 0 else 0,
        "recent_batches": [
            {
                "batch_id": r["batch_id"],
                "refund_type": r["refund_type"],
                "refund_method": r["refund_method"],
                "total_amount": float(r["total_amount"]),
                "status": r["status"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows[:10]
        ],
    }


@app.post("/api/v1/refunds/trigger-idr-decision")
async def api_trigger_idr_decision(
    aggregator_id: str,
    dispute_claims: List[Dict[str, Any]],
    decision_outcome: str = "provider_wins",
    current_user: TokenPayload = Depends(get_current_user),
):
    """
    Trigger refund processing based on a completed IDR decision.
    decision_outcome: 'provider_wins' | 'payer_wins' | 'split_decision'
    """
    if decision_outcome not in ("provider_wins", "payer_wins", "split_decision"):
        raise HTTPException(status_code=400, detail="decision_outcome must be provider_wins, payer_wins, or split_decision")

    provider_refunds = []
    for claim in dispute_claims:
        if decision_outcome == "provider_wins":
            refund_amount = Decimal("350.00")
        elif decision_outcome == "payer_wins":
            continue
        else:
            refund_amount = Decimal("175.00")

        provider_refunds.append({
            "provider_npi": claim["provider_npi"],
            "provider_name": claim.get("provider_name", ""),
            "refund_amount": float(refund_amount),
            "dispute_claim_id": claim["claim_id"],
            "cms_confirmation_number": claim.get("cms_confirmation_number"),
            "idr_decision_date": date.today().isoformat(),
        })

    if not provider_refunds:
        return {"message": "No refunds to process — payer wins all disputes"}

    result = await process_refund_batch(RefundRequest(
        aggregator_id=aggregator_id,
        refund_type=RefundType.NSA_IDR_FEE,
        refund_method=RefundMethod.DIRECT_TO_PROVIDER,
        provider_refunds=provider_refunds,
    ))
    return {"idr_decision": decision_outcome, "refund_processing_result": result.dict()}


@app.get("/health")
async def health_check():
    pool = await get_pool()
    db_ok = pool is not None
    return {
        "status": "healthy" if db_ok else "degraded",
        "service": "Flexible Refund Processing Service",
        "version": "2.0.0",
        "database": "connected" if db_ok else "unavailable",
        "timestamp": datetime.utcnow().isoformat(),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8024)
