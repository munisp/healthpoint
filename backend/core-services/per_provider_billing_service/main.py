"""
Per-Provider Billing Service
Implements billing where aggregators pay based on number of providers submitted.
Handles usage recording, invoice generation, and payment processing.
All database operations use asyncpg (no SQLAlchemy sync). No stubs or simulations.
ACH payments processed via Dwolla. Card payments via Stripe.
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
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta, date
from enum import Enum
import asyncio
import json
import logging
import httpx
import stripe
import uuid
from decimal import Decimal, ROUND_HALF_UP
from dataclasses import dataclass

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

setup_telemetry(service_name="per-provider-billing-service", service_version="2.0.0")
app = FastAPI(title="Per-Provider Billing Service", version="2.0.0")
instrument_fastapi(app)
app.middleware("http")(security_headers_middleware)

stripe.api_key = os.getenv("STRIPE_API_KEY", "")

DWOLLA_KEY = os.getenv("DWOLLA_KEY", "")
DWOLLA_SECRET = os.getenv("DWOLLA_SECRET", "")
DWOLLA_ENV = os.getenv("DWOLLA_ENVIRONMENT", "sandbox")
DWOLLA_BASE = "https://api.dwolla.com" if DWOLLA_ENV == "production" else "https://api-sandbox.dwolla.com"
DWOLLA_SOURCE_FUNDING_URL = os.getenv("DWOLLA_SOURCE_FUNDING_URL", "")

# ── Enums ─────────────────────────────────────────────────────────────────────

class BillingPeriod(str, Enum):
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    ANNUAL = "annual"

class PaymentStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    PAID = "paid"
    FAILED = "failed"
    REFUNDED = "refunded"
    DISPUTED = "disputed"

class PaymentMethod(str, Enum):
    CREDIT_CARD = "credit_card"
    ACH = "ach"
    WIRE_TRANSFER = "wire_transfer"
    CHECK = "check"

class InvoiceStatus(str, Enum):
    DRAFT = "draft"
    SENT = "sent"
    PAID = "paid"
    OVERDUE = "overdue"
    CANCELLED = "cancelled"

# ── Pydantic models ───────────────────────────────────────────────────────────

class BillingPlanCreate(BaseModel):
    name: str
    description: str
    base_rate: Decimal
    per_provider_rate: Decimal
    per_claim_rate: Decimal
    billing_period: BillingPeriod = BillingPeriod.MONTHLY
    max_providers: Optional[int] = None
    features: List[str] = []

class UsageData(BaseModel):
    aggregator_id: str
    providers_submitted: int
    claims_submitted: int
    unique_providers: int
    total_dispute_amount: Decimal
    submission_count: int

class InvoiceLineItem(BaseModel):
    description: str
    quantity: int
    unit_price: Decimal
    total_price: Decimal

class BillingCalculationResult(BaseModel):
    aggregator_id: str
    billing_period_start: date
    billing_period_end: date
    base_rate: Decimal
    per_provider_charges: Decimal
    per_claim_charges: Decimal
    subtotal: Decimal
    tax_amount: Decimal
    total_amount: Decimal
    line_items: List[InvoiceLineItem]

class PaymentRequest(BaseModel):
    invoice_id: str
    payment_method: PaymentMethod
    amount: Decimal
    payment_method_details: Optional[Dict[str, Any]] = None
    idempotency_key: Optional[str] = None

# ── DB bootstrap ──────────────────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS billing_plans (
    id              BIGSERIAL PRIMARY KEY,
    plan_id         VARCHAR(60) UNIQUE NOT NULL,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    base_rate       NUMERIC(10,2) DEFAULT 0,
    per_provider_rate NUMERIC(10,2) DEFAULT 0,
    per_claim_rate  NUMERIC(10,2) DEFAULT 0,
    billing_period  VARCHAR(20) DEFAULT 'monthly',
    max_providers   INT,
    features        JSONB,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aggregator_billing (
    id                  BIGSERIAL PRIMARY KEY,
    aggregator_id       VARCHAR(60) UNIQUE NOT NULL,
    billing_plan_id     VARCHAR(60) REFERENCES billing_plans(plan_id),
    billing_period      VARCHAR(20) DEFAULT 'monthly',
    current_period_start DATE,
    current_period_end  DATE,
    next_billing_date   DATE,
    payment_method      VARCHAR(20),
    stripe_customer_id  VARCHAR(120),
    auto_pay_enabled    BOOLEAN DEFAULT FALSE,
    billing_email       VARCHAR(320),
    billing_address     TEXT,
    tax_rate            NUMERIC(5,4) DEFAULT 0.0,
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agg_billing_plan ON aggregator_billing(billing_plan_id);

CREATE TABLE IF NOT EXISTS usage_records (
    id                      BIGSERIAL PRIMARY KEY,
    aggregator_id           VARCHAR(60) NOT NULL,
    billing_period_start    DATE NOT NULL,
    billing_period_end      DATE NOT NULL,
    providers_submitted     INT DEFAULT 0,
    claims_submitted        INT DEFAULT 0,
    unique_providers        INT DEFAULT 0,
    total_dispute_amount    NUMERIC(15,2) DEFAULT 0,
    submission_count        INT DEFAULT 0,
    calculated_amount       NUMERIC(10,2),
    created_at              TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_aggregator ON usage_records(aggregator_id);

CREATE TABLE IF NOT EXISTS invoices (
    id                      VARCHAR(80) PRIMARY KEY,
    invoice_number          VARCHAR(80) UNIQUE NOT NULL,
    aggregator_id           VARCHAR(60) NOT NULL,
    billing_period_start    DATE,
    billing_period_end      DATE,
    issue_date              DATE DEFAULT CURRENT_DATE,
    due_date                DATE,
    subtotal                NUMERIC(10,2),
    tax_amount              NUMERIC(10,2) DEFAULT 0,
    total_amount            NUMERIC(10,2),
    status                  VARCHAR(20) DEFAULT 'draft',
    payment_terms           VARCHAR(50) DEFAULT 'Net 30',
    line_items              JSONB,
    notes                   TEXT,
    sent_date               TIMESTAMPTZ,
    paid_date               TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoices_aggregator ON invoices(aggregator_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

CREATE TABLE IF NOT EXISTS billing_payments (
    id                          VARCHAR(80) PRIMARY KEY,
    invoice_id                  VARCHAR(80) REFERENCES invoices(id),
    aggregator_id               VARCHAR(60) NOT NULL,
    amount                      NUMERIC(10,2) NOT NULL,
    payment_method              VARCHAR(20) NOT NULL,
    payment_date                TIMESTAMPTZ DEFAULT NOW(),
    status                      VARCHAR(20) DEFAULT 'pending',
    transaction_id              VARCHAR(120),
    stripe_payment_intent_id    VARCHAR(120),
    failure_reason              TEXT,
    metadata                    JSONB,
    idempotency_key             VARCHAR(120) UNIQUE,
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_payments_invoice ON billing_payments(invoice_id);
"""

@app.on_event("startup")
async def startup():
    await bootstrap_schema(SCHEMA_SQL)

# ── Tax rates ─────────────────────────────────────────────────────────────────

TAX_RATES: Dict[str, Decimal] = {
    "default": Decimal("0.0875"),
    "CA": Decimal("0.1025"),
    "NY": Decimal("0.08"),
    "TX": Decimal("0.0625"),
    "FL": Decimal("0.06"),
}

# ── Billing calculation ───────────────────────────────────────────────────────

async def calculate_billing_amount(
    aggregator_id: str,
    usage_data: UsageData,
    plan: Dict[str, Any],
    tax_rate: Optional[Decimal] = None,
) -> BillingCalculationResult:
    today = date.today()
    period = plan["billing_period"]
    if period == BillingPeriod.MONTHLY:
        period_start = today.replace(day=1)
        if today.month == 12:
            period_end = date(today.year + 1, 1, 1) - timedelta(days=1)
        else:
            period_end = date(today.year, today.month + 1, 1) - timedelta(days=1)
    elif period == BillingPeriod.QUARTERLY:
        quarter = (today.month - 1) // 3 + 1
        period_start = date(today.year, (quarter - 1) * 3 + 1, 1)
        end_month = quarter * 3
        if end_month > 12:
            period_end = date(today.year + 1, end_month - 12 + 1, 1) - timedelta(days=1)
        else:
            period_end = date(today.year, end_month + 1, 1) - timedelta(days=1)
    else:
        period_start = date(today.year, 1, 1)
        period_end = date(today.year, 12, 31)

    base_rate = Decimal(str(plan["base_rate"] or 0))
    per_provider_rate = Decimal(str(plan["per_provider_rate"] or 0))
    per_claim_rate = Decimal(str(plan["per_claim_rate"] or 0))

    per_provider_charges = per_provider_rate * usage_data.unique_providers
    per_claim_charges = per_claim_rate * usage_data.claims_submitted
    subtotal = base_rate + per_provider_charges + per_claim_charges

    if tax_rate is None:
        tax_rate = TAX_RATES.get("default", Decimal("0"))
    tax_amount = (subtotal * tax_rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    total_amount = subtotal + tax_amount

    line_items = []
    if base_rate > 0:
        line_items.append(InvoiceLineItem(description=f"{plan['name']} - Base Rate", quantity=1, unit_price=base_rate, total_price=base_rate))
    if per_provider_charges > 0:
        line_items.append(InvoiceLineItem(description=f"Per-Provider Charges ({usage_data.unique_providers} providers)", quantity=usage_data.unique_providers, unit_price=per_provider_rate, total_price=per_provider_charges))
    if per_claim_charges > 0:
        line_items.append(InvoiceLineItem(description=f"Per-Claim Charges ({usage_data.claims_submitted} claims)", quantity=usage_data.claims_submitted, unit_price=per_claim_rate, total_price=per_claim_charges))

    return BillingCalculationResult(
        aggregator_id=aggregator_id,
        billing_period_start=period_start,
        billing_period_end=period_end,
        base_rate=base_rate,
        per_provider_charges=per_provider_charges,
        per_claim_charges=per_claim_charges,
        subtotal=subtotal,
        tax_amount=tax_amount,
        total_amount=total_amount,
        line_items=line_items,
    )

# ── Payment helpers ───────────────────────────────────────────────────────────

async def _get_dwolla_token(client: httpx.AsyncClient) -> str:
    if not DWOLLA_KEY or not DWOLLA_SECRET:
        raise HTTPException(status_code=503, detail="DWOLLA_KEY and DWOLLA_SECRET are required for ACH payments.")
    resp = await client.post(
        f"{DWOLLA_BASE}/token",
        data={"grant_type": "client_credentials"},
        auth=(DWOLLA_KEY, DWOLLA_SECRET),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Dwolla auth failed: {resp.status_code} {resp.text[:200]}")
    return resp.json()["access_token"]


async def _process_ach_payment(
    payment_id: str,
    invoice_id: str,
    aggregator_id: str,
    amount: Decimal,
    payment_details: Dict[str, Any],
    idempotency_key: str,
) -> Dict[str, Any]:
    """
    Process ACH debit from aggregator's bank account via Dwolla.
    payment_details must include dwolla_funding_source_url OR routing_number + account_number.
    If dwolla_funding_source_url is provided, use it directly.
    Otherwise look up the aggregator's Dwolla funding source from aggregator_bank_accounts.
    """
    if not DWOLLA_SOURCE_FUNDING_URL:
        raise HTTPException(status_code=503, detail="DWOLLA_SOURCE_FUNDING_URL is required for ACH payments.")

    # Resolve destination (aggregator's bank account in Dwolla)
    dest_funding_url = payment_details.get("dwolla_funding_source_url")
    if not dest_funding_url:
        pool = await get_pool()
        row = await pool.fetchrow(
            """SELECT dwolla_funding_source_url
               FROM aggregator_bank_accounts
               WHERE aggregator_id = $1 AND is_active = TRUE
               ORDER BY created_at DESC LIMIT 1""",
            aggregator_id,
        )
        if row:
            dest_funding_url = row["dwolla_funding_source_url"]

    if not dest_funding_url:
        raise HTTPException(
            status_code=422,
            detail=f"No Dwolla funding source found for aggregator {aggregator_id}. "
                   "The aggregator must register a verified bank account in Dwolla."
        )

    async with httpx.AsyncClient(timeout=30) as client:
        access_token = await _get_dwolla_token(client)
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/vnd.dwolla.v1.hal+json",
            "Accept": "application/vnd.dwolla.v1.hal+json",
            "Idempotency-Key": idempotency_key,
        }
        # For billing (aggregator paying platform), source = aggregator, destination = platform
        transfer_payload = {
            "_links": {
                "source": {"href": dest_funding_url},        # aggregator pays
                "destination": {"href": DWOLLA_SOURCE_FUNDING_URL},  # platform receives
            },
            "amount": {"currency": "USD", "value": str(amount.quantize(Decimal("0.01")))},
            "metadata": {
                "payment_id": payment_id,
                "invoice_id": invoice_id,
                "aggregator_id": aggregator_id,
            },
            "correlationId": idempotency_key,
        }
        resp = await client.post(f"{DWOLLA_BASE}/transfers", json=transfer_payload, headers=headers)
        if resp.status_code not in (200, 201):
            raise HTTPException(status_code=502, detail=f"Dwolla ACH transfer failed: {resp.status_code} {resp.text[:400]}")

        location = resp.headers.get("Location", "")
        transfer_id = location.split("/")[-1] if location else f"DWL-{uuid.uuid4().hex[:12].upper()}"
        logger.info(f"Dwolla ACH initiated: {transfer_id} for ${amount} from aggregator {aggregator_id}")
        return {
            "transaction_id": transfer_id,
            "status": PaymentStatus.PROCESSING,  # ACH settles in 1-3 business days
            "expected_completion": (datetime.utcnow() + timedelta(days=3)).isoformat(),
        }


async def _process_stripe_payment(
    payment_id: str,
    invoice_id: str,
    aggregator_id: str,
    amount: Decimal,
    payment_details: Dict[str, Any],
    idempotency_key: str,
) -> Dict[str, Any]:
    """Process credit card payment via Stripe PaymentIntent."""
    if not stripe.api_key:
        raise HTTPException(status_code=503, detail="STRIPE_API_KEY is required for card payments.")

    intent = stripe.PaymentIntent.create(
        amount=int(amount * 100),
        currency="usd",
        payment_method=payment_details.get("payment_method_id"),
        confirmation_method="manual",
        confirm=True,
        metadata={"payment_id": payment_id, "invoice_id": invoice_id, "aggregator_id": aggregator_id},
        idempotency_key=idempotency_key,
    )
    if intent.status == "succeeded":
        return {"transaction_id": intent.id, "status": PaymentStatus.PAID, "stripe_intent_id": intent.id}
    elif intent.status == "requires_action":
        return {
            "transaction_id": intent.id,
            "status": PaymentStatus.PROCESSING,
            "stripe_intent_id": intent.id,
            "requires_action": True,
            "client_secret": intent.client_secret,
        }
    else:
        raise HTTPException(status_code=400, detail=f"Stripe payment failed with status: {intent.status}")


# ── API endpoints ─────────────────────────────────────────────────────────────

@app.post("/api/v1/billing/usage")
async def record_usage(
    usage_data: UsageData,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Record usage data and calculate billing amount."""
    agg_billing = await fetchrow(
        """SELECT ab.*, bp.base_rate, bp.per_provider_rate, bp.per_claim_rate,
                  bp.billing_period, bp.name, bp.plan_id
           FROM aggregator_billing ab
           JOIN billing_plans bp ON ab.billing_plan_id = bp.plan_id
           WHERE ab.aggregator_id = $1""",
        usage_data.aggregator_id,
    )
    if not agg_billing:
        raise HTTPException(status_code=404, detail=f"Aggregator billing not found for {usage_data.aggregator_id}")

    plan = dict(agg_billing)
    tax_rate = Decimal(str(agg_billing["tax_rate"])) if agg_billing["tax_rate"] else None
    calc = await calculate_billing_amount(usage_data.aggregator_id, usage_data, plan, tax_rate)

    usage_id = await fetchval(
        """INSERT INTO usage_records
           (aggregator_id, billing_period_start, billing_period_end,
            providers_submitted, claims_submitted, unique_providers,
            total_dispute_amount, submission_count, calculated_amount, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
           RETURNING id""",
        usage_data.aggregator_id,
        calc.billing_period_start, calc.billing_period_end,
        usage_data.providers_submitted, usage_data.claims_submitted,
        usage_data.unique_providers, float(usage_data.total_dispute_amount),
        usage_data.submission_count, float(calc.total_amount),
    )
    return {"usage_record_id": usage_id, "calculated_amount": float(calc.total_amount), "billing_period": f"{calc.billing_period_start} to {calc.billing_period_end}"}


@app.post("/api/v1/billing/invoices/generate")
async def generate_invoice(
    aggregator_id: str,
    usage_record_id: int,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Generate an invoice from a usage record."""
    usage = await fetchrow("SELECT * FROM usage_records WHERE id = $1", usage_record_id)
    if not usage:
        raise HTTPException(status_code=404, detail="Usage record not found")

    agg_billing = await fetchrow(
        """SELECT ab.*, bp.base_rate, bp.per_provider_rate, bp.per_claim_rate,
                  bp.billing_period, bp.name, bp.plan_id
           FROM aggregator_billing ab
           JOIN billing_plans bp ON ab.billing_plan_id = bp.plan_id
           WHERE ab.aggregator_id = $1""",
        aggregator_id,
    )
    if not agg_billing:
        raise HTTPException(status_code=404, detail="Aggregator billing not found")

    usage_data = UsageData(
        aggregator_id=aggregator_id,
        providers_submitted=usage["providers_submitted"],
        claims_submitted=usage["claims_submitted"],
        unique_providers=usage["unique_providers"],
        total_dispute_amount=Decimal(str(usage["total_dispute_amount"])),
        submission_count=usage["submission_count"],
    )
    tax_rate = Decimal(str(agg_billing["tax_rate"])) if agg_billing["tax_rate"] else None
    calc = await calculate_billing_amount(aggregator_id, usage_data, dict(agg_billing), tax_rate)

    invoice_id = f"INV-{uuid.uuid4().hex[:16].upper()}"
    invoice_number = f"INV-{aggregator_id}-{datetime.utcnow().strftime('%Y%m%d')}-{invoice_id[-8:]}"
    due_date = date.today() + timedelta(days=30)

    await execute(
        """INSERT INTO invoices
           (id, invoice_number, aggregator_id, billing_period_start, billing_period_end,
            due_date, subtotal, tax_amount, total_amount, line_items, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'draft',NOW(),NOW())""",
        invoice_id, invoice_number, aggregator_id,
        calc.billing_period_start, calc.billing_period_end,
        due_date, float(calc.subtotal), float(calc.tax_amount), float(calc.total_amount),
        json.dumps([item.dict() for item in calc.line_items]),
    )
    return {"invoice_id": invoice_id, "invoice_number": invoice_number, "total_amount": float(calc.total_amount), "due_date": due_date.isoformat()}


@app.post("/api/v1/billing/payments")
async def process_payment(
    payment_request: PaymentRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Process payment for an invoice via Stripe (card) or Dwolla (ACH)."""
    invoice = await fetchrow("SELECT * FROM invoices WHERE id = $1", payment_request.invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice["status"] == InvoiceStatus.PAID:
        raise HTTPException(status_code=409, detail="Invoice is already paid")

    payment_id = f"PAY-{uuid.uuid4().hex[:16].upper()}"
    idem_key = payment_request.idempotency_key or f"{payment_id}-{payment_request.invoice_id}"
    details = payment_request.payment_method_details or {}

    # Insert payment record in processing state
    await execute(
        """INSERT INTO billing_payments
           (id, invoice_id, aggregator_id, amount, payment_method, status,
            idempotency_key, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,'processing',$6,NOW(),NOW())
           ON CONFLICT (idempotency_key) DO NOTHING""",
        payment_id, payment_request.invoice_id, invoice["aggregator_id"],
        float(payment_request.amount), payment_request.payment_method.value, idem_key,
    )

    try:
        if payment_request.payment_method == PaymentMethod.CREDIT_CARD:
            result = await _process_stripe_payment(
                payment_id, payment_request.invoice_id, invoice["aggregator_id"],
                payment_request.amount, details, idem_key,
            )
        elif payment_request.payment_method == PaymentMethod.ACH:
            result = await _process_ach_payment(
                payment_id, payment_request.invoice_id, invoice["aggregator_id"],
                payment_request.amount, details, idem_key,
            )
        elif payment_request.payment_method in (PaymentMethod.WIRE_TRANSFER, PaymentMethod.CHECK):
            # Wire and check require manual bank confirmation; mark pending
            result = {
                "transaction_id": f"{payment_request.payment_method.value.upper()}-{uuid.uuid4().hex[:12].upper()}",
                "status": PaymentStatus.PENDING,
            }
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported payment method: {payment_request.payment_method}")

        final_status = result["status"].value if hasattr(result["status"], "value") else result["status"]
        await execute(
            """UPDATE billing_payments
               SET status=$1, transaction_id=$2, stripe_payment_intent_id=$3,
                   metadata=$4::jsonb, updated_at=NOW()
               WHERE id=$5""",
            final_status,
            result.get("transaction_id"),
            result.get("stripe_intent_id"),
            json.dumps({k: v for k, v in result.items() if k not in ("transaction_id", "stripe_intent_id", "status")}),
            payment_id,
        )

        if final_status == PaymentStatus.PAID.value:
            await execute(
                "UPDATE invoices SET status='paid', paid_date=NOW(), updated_at=NOW() WHERE id=$1",
                payment_request.invoice_id,
            )

        await publish(Topics.PAYMENT_PROCESSED, {
            "payment_id": payment_id,
            "invoice_id": payment_request.invoice_id,
            "aggregator_id": invoice["aggregator_id"],
            "amount": float(payment_request.amount),
            "status": final_status,
        })

        return {
            "payment_id": payment_id,
            "status": final_status,
            "transaction_id": result.get("transaction_id"),
            **{k: v for k, v in result.items() if k not in ("transaction_id", "status")},
        }

    except HTTPException:
        await execute(
            "UPDATE billing_payments SET status='failed', updated_at=NOW() WHERE id=$1", payment_id
        )
        raise
    except Exception as exc:
        logger.error(f"Payment processing error: {exc}")
        await execute(
            "UPDATE billing_payments SET status='failed', failure_reason=$1, updated_at=NOW() WHERE id=$2",
            str(exc)[:500], payment_id,
        )
        raise HTTPException(status_code=500, detail=f"Payment failed: {str(exc)}")


@app.get("/api/v1/billing/invoices/{aggregator_id}")
async def get_aggregator_invoices(
    aggregator_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get all invoices for an aggregator."""
    rows = await fetch(
        "SELECT * FROM invoices WHERE aggregator_id = $1 ORDER BY created_at DESC",
        aggregator_id,
    )
    return [
        {
            "invoice_id": r["id"],
            "invoice_number": r["invoice_number"],
            "billing_period": f"{r['billing_period_start']} to {r['billing_period_end']}",
            "total_amount": float(r["total_amount"]),
            "status": r["status"],
            "due_date": r["due_date"].isoformat() if r["due_date"] else None,
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]


@app.get("/api/v1/billing/usage/{aggregator_id}")
async def get_aggregator_usage(
    aggregator_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get usage records for an aggregator."""
    rows = await fetch(
        "SELECT * FROM usage_records WHERE aggregator_id = $1 ORDER BY created_at DESC",
        aggregator_id,
    )
    return [
        {
            "usage_record_id": r["id"],
            "billing_period": f"{r['billing_period_start']} to {r['billing_period_end']}",
            "providers_submitted": r["providers_submitted"],
            "claims_submitted": r["claims_submitted"],
            "unique_providers": r["unique_providers"],
            "calculated_amount": float(r["calculated_amount"]),
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]


@app.post("/api/v1/billing/plans")
async def create_billing_plan(
    plan_data: BillingPlanCreate,
    current_user: TokenPayload = Depends(require_admin),
):
    """Create a new billing plan (admin only)."""
    plan_id = f"PLAN-{uuid.uuid4().hex[:8].upper()}"
    await execute(
        """INSERT INTO billing_plans
           (plan_id, name, description, base_rate, per_provider_rate, per_claim_rate,
            billing_period, max_providers, features, is_active, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,TRUE,NOW(),NOW())""",
        plan_id, plan_data.name, plan_data.description,
        float(plan_data.base_rate), float(plan_data.per_provider_rate), float(plan_data.per_claim_rate),
        plan_data.billing_period.value, plan_data.max_providers,
        json.dumps(plan_data.features),
    )
    return {"status": "success", "plan_id": plan_id, "name": plan_data.name}


@app.get("/api/v1/billing/summary/{aggregator_id}")
async def get_billing_summary(
    aggregator_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get billing summary for an aggregator."""
    agg_billing = await fetchrow(
        """SELECT ab.*, bp.name as plan_name
           FROM aggregator_billing ab
           JOIN billing_plans bp ON ab.billing_plan_id = bp.plan_id
           WHERE ab.aggregator_id = $1""",
        aggregator_id,
    )
    if not agg_billing:
        raise HTTPException(status_code=404, detail="Aggregator billing not found")

    recent_invoices = await fetch(
        "SELECT * FROM invoices WHERE aggregator_id = $1 ORDER BY created_at DESC LIMIT 5",
        aggregator_id,
    )
    usage_totals = await fetchrow(
        """SELECT COALESCE(SUM(unique_providers),0) as total_providers,
                  COALESCE(SUM(claims_submitted),0) as total_claims
           FROM usage_records WHERE aggregator_id = $1""",
        aggregator_id,
    )
    total_billed = sum(float(r["total_amount"]) for r in recent_invoices)

    return {
        "aggregator_id": aggregator_id,
        "billing_plan": agg_billing["plan_name"],
        "billing_period": agg_billing["billing_period"],
        "next_billing_date": agg_billing["next_billing_date"].isoformat() if agg_billing["next_billing_date"] else None,
        "auto_pay_enabled": agg_billing["auto_pay_enabled"],
        "summary": {
            "total_providers_submitted": usage_totals["total_providers"],
            "total_claims_submitted": usage_totals["total_claims"],
            "total_amount_billed": total_billed,
            "recent_invoices_count": len(recent_invoices),
        },
        "recent_invoices": [
            {
                "invoice_number": r["invoice_number"],
                "amount": float(r["total_amount"]),
                "status": r["status"],
                "due_date": r["due_date"].isoformat() if r["due_date"] else None,
            }
            for r in recent_invoices
        ],
    }


@app.get("/health")
async def health_check():
    pool = await get_pool()
    return {
        "status": "healthy" if pool else "degraded",
        "service": "Per-Provider Billing Service",
        "version": "2.0.0",
        "database": "connected" if pool else "unavailable",
        "timestamp": datetime.utcnow().isoformat(),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8025)
