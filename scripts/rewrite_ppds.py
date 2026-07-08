"""
Rewrite script: provider_payment_details_service/main.py
Replaces all SQLAlchemy sync patterns with asyncpg. No stubs or simulations.
"""
import ast, sys

content = '''"""
Provider Payment Details Service
Captures and manages provider payment information for NSA/IDR fee refunds.
Supports ACH, Wire Transfer, Check, and Credit Card payment methods.
All database operations use asyncpg (no SQLAlchemy sync). No stubs or simulations.
"""

# ── Shared HealthPoint infrastructure ─────────────────────────────────────────
import sys
import os as _os
_repo_root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from backend.shared.database import fetch, fetchrow, execute, fetchval, transaction, bootstrap_schema, get_pool
from backend.shared.cache import get_client as get_redis_client, set_json, get_json
from backend.shared.auth import get_current_user, require_role, require_admin, security_headers_middleware, TokenPayload
from backend.shared.messaging import publish, Topics
from backend.shared.telemetry import setup_telemetry, instrument_fastapi
# ─────────────────────────────────────────────────────────────────────────────

import os
import io
import json
import logging
import re
import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Dict, List, Optional

import pandas as pd
from cryptography.fernet import Fernet
from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form
from pydantic import BaseModel, Field, validator, EmailStr

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

setup_telemetry(service_name="provider-payment-details-service", service_version="2.0.0")
app = FastAPI(title="Provider Payment Details Service", version="2.0.0")
instrument_fastapi(app)
app.middleware("http")(security_headers_middleware)

# Encryption key must be a URL-safe base64-encoded 32-byte key stored in env
_RAW_KEY = os.getenv("FIELD_ENCRYPTION_KEY", "")
cipher_suite: Optional[Fernet] = None
if _RAW_KEY:
    try:
        cipher_suite = Fernet(_RAW_KEY.encode())
    except Exception:
        logger.warning("FIELD_ENCRYPTION_KEY is set but invalid — field encryption disabled")


def _encrypt(value: str) -> str:
    if cipher_suite and value:
        return cipher_suite.encrypt(value.encode()).decode()
    return value


def _decrypt(value: str) -> str:
    if cipher_suite and value:
        try:
            return cipher_suite.decrypt(value.encode()).decode()
        except Exception:
            return value
    return value


# ── Enums ─────────────────────────────────────────────────────────────────────

class PaymentMethodType(str, Enum):
    ACH = "ach"
    WIRE_TRANSFER = "wire_transfer"
    CHECK = "check"
    CREDIT_CARD = "credit_card"

class AccountType(str, Enum):
    CHECKING = "checking"
    SAVINGS = "savings"
    BUSINESS_CHECKING = "business_checking"
    BUSINESS_SAVINGS = "business_savings"

class RefundPreference(str, Enum):
    DIRECT_TO_PROVIDER = "direct_to_provider"
    TO_AGGREGATOR = "to_aggregator"
    MIXED = "mixed"

class PaymentStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    PENDING_VERIFICATION = "pending_verification"
    VERIFIED = "verified"
    SUSPENDED = "suspended"

# ── Pydantic models ───────────────────────────────────────────────────────────

class ACHDetails(BaseModel):
    account_number: str = Field(..., min_length=4, max_length=17)
    routing_number: str = Field(..., min_length=9, max_length=9)
    account_type: AccountType
    bank_name: str = Field(..., max_length=255)

    @validator("routing_number")
    def validate_routing(cls, v):
        if not re.match(r"^\\d{9}$", v):
            raise ValueError("Routing number must be exactly 9 digits")
        return v

class WireTransferDetails(BaseModel):
    account_number: str = Field(..., min_length=4, max_length=30)
    routing_number: str = Field(..., min_length=9, max_length=11)
    swift_code: Optional[str] = Field(None, max_length=11)
    bank_name: str = Field(..., max_length=255)
    bank_address: str = Field(..., max_length=500)
    beneficiary_name: str = Field(..., max_length=255)
    beneficiary_address: str = Field(..., max_length=500)

class CheckDetails(BaseModel):
    payee_name: str = Field(..., max_length=255)
    mailing_address_line1: str = Field(..., max_length=255)
    mailing_address_line2: Optional[str] = Field(None, max_length=255)
    city: str = Field(..., max_length=100)
    state: str = Field(..., min_length=2, max_length=2)
    zip_code: str = Field(..., min_length=5, max_length=10)

    @validator("zip_code")
    def validate_zip(cls, v):
        if not re.match(r"^\\d{5}(-\\d{4})?$", v):
            raise ValueError("Invalid ZIP code format")
        return v

class CreditCardDetails(BaseModel):
    card_number: str = Field(..., min_length=13, max_length=19)
    expiry_month: int = Field(..., ge=1, le=12)
    expiry_year: int = Field(..., ge=2024, le=2034)
    cvv: str = Field(..., min_length=3, max_length=4)
    card_holder_name: str = Field(..., max_length=255)

    @validator("card_number")
    def validate_card(cls, v):
        card_num = re.sub(r"\\s+", "", v)
        if not re.match(r"^\\d{13,19}$", card_num):
            raise ValueError("Invalid card number format")
        return card_num

class BillingAddress(BaseModel):
    address_line1: str = Field(..., max_length=255)
    address_line2: Optional[str] = Field(None, max_length=255)
    city: str = Field(..., max_length=100)
    state: str = Field(..., min_length=2, max_length=2)
    zip_code: str = Field(..., min_length=5, max_length=10)
    country: str = Field(default="US", min_length=2, max_length=2)

class ProviderPaymentDetailsCreate(BaseModel):
    provider_npi: str = Field(..., min_length=10, max_length=10)
    provider_name: str = Field(..., max_length=255)
    aggregator_id: str = Field(..., max_length=60)
    payment_method_type: PaymentMethodType
    ach_details: Optional[ACHDetails] = None
    wire_details: Optional[WireTransferDetails] = None
    check_details: Optional[CheckDetails] = None
    card_details: Optional[CreditCardDetails] = None
    billing_address: BillingAddress
    contact_email: EmailStr
    contact_phone: str = Field(..., max_length=20)
    notes: Optional[str] = None

class AggregatorRefundPreferenceCreate(BaseModel):
    aggregator_id: str = Field(..., max_length=60)
    default_refund_preference: RefundPreference
    aggregator_payment_method: Optional[PaymentMethodType] = None
    aggregator_ach_details: Optional[ACHDetails] = None
    business_name: str = Field(..., max_length=255)
    tax_id: str = Field(..., max_length=20)
    business_address: str = Field(..., max_length=500)
    contact_email: EmailStr
    contact_phone: str = Field(..., max_length=20)
    provider_fee_percentage: Decimal = Field(default=Decimal("100.00"), ge=0, le=100)
    aggregator_fee_percentage: Decimal = Field(default=Decimal("0.00"), ge=0, le=100)
    processing_fee: Decimal = Field(default=Decimal("0.00"), ge=0)
    refund_processing_delay_days: int = Field(default=0, ge=0, le=30)
    batch_refunds: bool = Field(default=True)

# ── DB bootstrap ──────────────────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS provider_payment_details (
    id                          BIGSERIAL PRIMARY KEY,
    provider_npi                VARCHAR(10) NOT NULL,
    provider_name               VARCHAR(255),
    aggregator_id               VARCHAR(60),
    payment_method_type         VARCHAR(20),
    encrypted_account_number    TEXT,
    encrypted_routing_number    TEXT,
    encrypted_card_number       TEXT,
    encrypted_card_cvv          TEXT,
    account_type                VARCHAR(30),
    bank_name                   VARCHAR(255),
    card_expiry_month           INT,
    card_expiry_year            INT,
    card_holder_name            VARCHAR(255),
    billing_address_line1       VARCHAR(255),
    billing_address_line2       VARCHAR(255),
    billing_city                VARCHAR(100),
    billing_state               VARCHAR(2),
    billing_zip                 VARCHAR(10),
    billing_country             VARCHAR(2) DEFAULT \'US\',
    contact_email               VARCHAR(320),
    contact_phone               VARCHAR(20),
    notes                       TEXT,
    status                      VARCHAR(30) DEFAULT \'pending_verification\',
    verification_date           TIMESTAMPTZ,
    last_updated                TIMESTAMPTZ DEFAULT NOW(),
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(provider_npi, aggregator_id)
);
CREATE INDEX IF NOT EXISTS idx_ppd_npi ON provider_payment_details(provider_npi);
CREATE INDEX IF NOT EXISTS idx_ppd_agg ON provider_payment_details(aggregator_id);

CREATE TABLE IF NOT EXISTS aggregator_refund_preferences (
    id                              BIGSERIAL PRIMARY KEY,
    aggregator_id                   VARCHAR(60) UNIQUE NOT NULL,
    default_refund_preference       VARCHAR(30),
    aggregator_payment_method       VARCHAR(20),
    encrypted_aggregator_account    TEXT,
    encrypted_aggregator_routing    TEXT,
    aggregator_bank_name            VARCHAR(255),
    aggregator_account_type         VARCHAR(30),
    business_name                   VARCHAR(255),
    tax_id                          VARCHAR(20),
    business_address                VARCHAR(500),
    contact_email                   VARCHAR(320),
    contact_phone                   VARCHAR(20),
    provider_fee_percentage         NUMERIC(5,2) DEFAULT 100.00,
    aggregator_fee_percentage       NUMERIC(5,2) DEFAULT 0.00,
    processing_fee                  NUMERIC(10,2) DEFAULT 0.00,
    refund_processing_delay_days    INT DEFAULT 0,
    batch_refunds                   BOOLEAN DEFAULT TRUE,
    created_at                      TIMESTAMPTZ DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ DEFAULT NOW()
);
"""

@app.on_event("startup")
async def startup():
    await bootstrap_schema(SCHEMA_SQL)

# ── Business logic ────────────────────────────────────────────────────────────

async def create_provider_payment_details(payment_data: ProviderPaymentDetailsCreate) -> Dict[str, Any]:
    """Persist provider payment details with field-level encryption."""
    existing = await fetchrow(
        "SELECT id FROM provider_payment_details WHERE provider_npi=$1 AND aggregator_id=$2",
        payment_data.provider_npi, payment_data.aggregator_id,
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Payment details already exist for provider {payment_data.provider_npi} "
                   f"under aggregator {payment_data.aggregator_id}",
        )

    enc_account = enc_routing = enc_card = enc_cvv = None
    account_type = bank_name = card_holder = None
    card_month = card_year = None
    notes = payment_data.notes

    if payment_data.payment_method_type == PaymentMethodType.ACH and payment_data.ach_details:
        d = payment_data.ach_details
        enc_account = _encrypt(d.account_number)
        enc_routing = _encrypt(d.routing_number)
        account_type = d.account_type.value
        bank_name = d.bank_name

    elif payment_data.payment_method_type == PaymentMethodType.WIRE_TRANSFER and payment_data.wire_details:
        d = payment_data.wire_details
        enc_account = _encrypt(d.account_number)
        enc_routing = _encrypt(d.routing_number)
        bank_name = d.bank_name
        notes = json.dumps({
            "swift_code": d.swift_code,
            "bank_address": d.bank_address,
            "beneficiary_name": d.beneficiary_name,
            "beneficiary_address": d.beneficiary_address,
        })

    elif payment_data.payment_method_type == PaymentMethodType.CREDIT_CARD and payment_data.card_details:
        d = payment_data.card_details
        enc_card = _encrypt(d.card_number)
        enc_cvv = _encrypt(d.cvv)
        card_month = d.expiry_month
        card_year = d.expiry_year
        card_holder = d.card_holder_name

    elif payment_data.payment_method_type == PaymentMethodType.CHECK and payment_data.check_details:
        d = payment_data.check_details
        notes = json.dumps({
            "payee_name": d.payee_name,
            "mailing_address": {
                "line1": d.mailing_address_line1,
                "line2": d.mailing_address_line2,
                "city": d.city,
                "state": d.state,
                "zip": d.zip_code,
            },
        })

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Payment method details required for type {payment_data.payment_method_type}",
        )

    row_id = await fetchval(
        """INSERT INTO provider_payment_details
           (provider_npi, provider_name, aggregator_id, payment_method_type,
            encrypted_account_number, encrypted_routing_number,
            encrypted_card_number, encrypted_card_cvv,
            account_type, bank_name, card_expiry_month, card_expiry_year, card_holder_name,
            billing_address_line1, billing_address_line2, billing_city, billing_state,
            billing_zip, billing_country, contact_email, contact_phone, notes,
            status, created_at, last_updated)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
                   \'pending_verification\',NOW(),NOW())
           RETURNING id""",
        payment_data.provider_npi, payment_data.provider_name, payment_data.aggregator_id,
        payment_data.payment_method_type.value,
        enc_account, enc_routing, enc_card, enc_cvv,
        account_type, bank_name, card_month, card_year, card_holder,
        payment_data.billing_address.address_line1, payment_data.billing_address.address_line2,
        payment_data.billing_address.city, payment_data.billing_address.state,
        payment_data.billing_address.zip_code, payment_data.billing_address.country,
        str(payment_data.contact_email), payment_data.contact_phone, notes,
    )

    logger.info(f"Created payment details id={row_id} for provider {payment_data.provider_npi}")
    return {
        "id": row_id,
        "provider_npi": payment_data.provider_npi,
        "payment_method_type": payment_data.payment_method_type.value,
        "status": "pending_verification",
        "created_at": datetime.utcnow().isoformat(),
    }


async def get_provider_payment_details(provider_npi: str, aggregator_id: str) -> Optional[Dict[str, Any]]:
    """Return non-sensitive payment details with masked account/card numbers."""
    row = await fetchrow(
        "SELECT * FROM provider_payment_details WHERE provider_npi=$1 AND aggregator_id=$2",
        provider_npi, aggregator_id,
    )
    if not row:
        return None

    result: Dict[str, Any] = {
        "provider_npi": row["provider_npi"],
        "provider_name": row["provider_name"],
        "payment_method_type": row["payment_method_type"],
        "bank_name": row["bank_name"],
        "account_type": row["account_type"],
        "contact_email": row["contact_email"],
        "contact_phone": row["contact_phone"],
        "billing_address": {
            "line1": row["billing_address_line1"],
            "line2": row["billing_address_line2"],
            "city": row["billing_city"],
            "state": row["billing_state"],
            "zip": row["billing_zip"],
            "country": row["billing_country"],
        },
        "status": row["status"],
        "verification_date": row["verification_date"].isoformat() if row["verification_date"] else None,
        "last_updated": row["last_updated"].isoformat(),
        "created_at": row["created_at"].isoformat(),
    }

    if row["encrypted_account_number"]:
        acct = _decrypt(row["encrypted_account_number"])
        result["masked_account_number"] = f"****{acct[-4:]}" if len(acct) > 4 else "****"

    if row["encrypted_card_number"]:
        card = _decrypt(row["encrypted_card_number"])
        result["masked_card_number"] = f"****-****-****-{card[-4:]}" if len(card) > 4 else "****"
        result["card_expiry"] = f"{row[\'card_expiry_month\']:02d}/{row[\'card_expiry_year\']}"
        result["card_holder_name"] = row["card_holder_name"]

    return result


async def process_bulk_payment_upload(aggregator_id: str, file: UploadFile) -> Dict[str, Any]:
    """Parse CSV/Excel file and create payment details for each row."""
    content = await file.read()
    fname = file.filename or ""
    if fname.endswith(".csv"):
        df = pd.read_csv(io.StringIO(content.decode("utf-8")))
    elif fname.endswith((".xlsx", ".xls")):
        df = pd.read_excel(io.BytesIO(content))
    else:
        raise HTTPException(status_code=400, detail="Unsupported file format — use .csv or .xlsx")

    required_cols = {"provider_npi", "provider_name", "payment_method", "account_number",
                     "routing_number", "account_type", "bank_name", "contact_email", "contact_phone",
                     "billing_address_line1", "billing_city", "billing_state", "billing_zip"}
    missing = required_cols - set(df.columns)
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required columns: {missing}")

    results: Dict[str, Any] = {"total": len(df), "successful": 0, "failed": 0, "errors": []}
    for idx, row in df.iterrows():
        try:
            payment_method = PaymentMethodType(row["payment_method"].strip().lower())
            billing = BillingAddress(
                address_line1=str(row["billing_address_line1"]),
                address_line2=str(row.get("billing_address_line2", "")) or None,
                city=str(row["billing_city"]),
                state=str(row["billing_state"]),
                zip_code=str(row["billing_zip"]),
                country=str(row.get("billing_country", "US")),
            )
            pd_create = ProviderPaymentDetailsCreate(
                provider_npi=str(row["provider_npi"]).strip(),
                provider_name=str(row["provider_name"]),
                aggregator_id=aggregator_id,
                payment_method_type=payment_method,
                billing_address=billing,
                contact_email=str(row["contact_email"]),
                contact_phone=str(row["contact_phone"]),
                notes=str(row.get("notes", "")) or None,
            )
            if payment_method == PaymentMethodType.ACH:
                pd_create.ach_details = ACHDetails(
                    account_number=str(row["account_number"]),
                    routing_number=str(row["routing_number"]),
                    account_type=AccountType(str(row["account_type"]).strip().lower()),
                    bank_name=str(row["bank_name"]),
                )
            elif payment_method == PaymentMethodType.WIRE_TRANSFER:
                pd_create.wire_details = WireTransferDetails(
                    account_number=str(row["account_number"]),
                    routing_number=str(row["routing_number"]),
                    swift_code=str(row.get("swift_code", "")) or None,
                    bank_name=str(row["bank_name"]),
                    bank_address=str(row.get("bank_address", "")),
                    beneficiary_name=str(row.get("beneficiary_name", row["provider_name"])),
                    beneficiary_address=str(row.get("beneficiary_address", row["billing_address_line1"])),
                )
            await create_provider_payment_details(pd_create)
            results["successful"] += 1
        except Exception as exc:
            results["failed"] += 1
            results["errors"].append({
                "row": int(idx) + 2,
                "provider_npi": str(row.get("provider_npi", "Unknown")),
                "error": str(exc),
            })

    return results


async def create_aggregator_refund_preference(preference_data: AggregatorRefundPreferenceCreate) -> Dict[str, Any]:
    """Persist aggregator refund preferences."""
    existing = await fetchrow(
        "SELECT id FROM aggregator_refund_preferences WHERE aggregator_id=$1",
        preference_data.aggregator_id,
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Refund preferences already exist for aggregator {preference_data.aggregator_id}",
        )

    total_pct = float(preference_data.provider_fee_percentage) + float(preference_data.aggregator_fee_percentage)
    if total_pct > 100:
        raise HTTPException(status_code=400, detail="Total fee percentages cannot exceed 100%")

    enc_account = enc_routing = None
    agg_bank = agg_acct_type = agg_method = None

    if preference_data.aggregator_payment_method and preference_data.aggregator_ach_details:
        d = preference_data.aggregator_ach_details
        enc_account = _encrypt(d.account_number)
        enc_routing = _encrypt(d.routing_number)
        agg_bank = d.bank_name
        agg_acct_type = d.account_type.value
        agg_method = preference_data.aggregator_payment_method.value

    row_id = await fetchval(
        """INSERT INTO aggregator_refund_preferences
           (aggregator_id, default_refund_preference,
            aggregator_payment_method, encrypted_aggregator_account, encrypted_aggregator_routing,
            aggregator_bank_name, aggregator_account_type,
            business_name, tax_id, business_address, contact_email, contact_phone,
            provider_fee_percentage, aggregator_fee_percentage, processing_fee,
            refund_processing_delay_days, batch_refunds, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())
           RETURNING id""",
        preference_data.aggregator_id,
        preference_data.default_refund_preference.value,
        agg_method, enc_account, enc_routing, agg_bank, agg_acct_type,
        preference_data.business_name, preference_data.tax_id, preference_data.business_address,
        str(preference_data.contact_email), preference_data.contact_phone,
        float(preference_data.provider_fee_percentage),
        float(preference_data.aggregator_fee_percentage),
        float(preference_data.processing_fee),
        preference_data.refund_processing_delay_days,
        preference_data.batch_refunds,
    )

    logger.info(f"Created refund preferences id={row_id} for aggregator {preference_data.aggregator_id}")
    return {
        "id": row_id,
        "aggregator_id": preference_data.aggregator_id,
        "default_refund_preference": preference_data.default_refund_preference.value,
        "created_at": datetime.utcnow().isoformat(),
    }

# ── API endpoints ─────────────────────────────────────────────────────────────

@app.post("/api/v1/provider-payments/create")
async def api_create_provider_payment_details(
    payment_data: ProviderPaymentDetailsCreate,
    current_user: TokenPayload = Depends(get_current_user),
):
    return await create_provider_payment_details(payment_data)


@app.post("/api/v1/provider-payments/bulk-upload")
async def api_bulk_upload_payment_details(
    aggregator_id: str = Form(...),
    file: UploadFile = File(...),
    current_user: TokenPayload = Depends(get_current_user),
):
    return await process_bulk_payment_upload(aggregator_id, file)


@app.get("/api/v1/provider-payments/{provider_npi}/{aggregator_id}")
async def api_get_provider_payment_details(
    provider_npi: str,
    aggregator_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    details = await get_provider_payment_details(provider_npi, aggregator_id)
    if not details:
        raise HTTPException(status_code=404, detail="Payment details not found")
    return details


@app.post("/api/v1/refund-preferences/create")
async def api_create_refund_preferences(
    preference_data: AggregatorRefundPreferenceCreate,
    current_user: TokenPayload = Depends(get_current_user),
):
    return await create_aggregator_refund_preference(preference_data)


@app.get("/api/v1/refund-preferences/{aggregator_id}")
async def api_get_refund_preferences(
    aggregator_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    row = await fetchrow(
        "SELECT * FROM aggregator_refund_preferences WHERE aggregator_id=$1", aggregator_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Refund preferences not found")
    return {
        "aggregator_id": row["aggregator_id"],
        "default_refund_preference": row["default_refund_preference"],
        "business_name": row["business_name"],
        "provider_fee_percentage": float(row["provider_fee_percentage"]),
        "aggregator_fee_percentage": float(row["aggregator_fee_percentage"]),
        "processing_fee": float(row["processing_fee"]),
        "refund_processing_delay_days": row["refund_processing_delay_days"],
        "batch_refunds": row["batch_refunds"],
        "created_at": row["created_at"].isoformat(),
    }


@app.get("/api/v1/aggregator-providers/{aggregator_id}/payment-summary")
async def api_get_aggregator_payment_summary(
    aggregator_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    rows = await fetch(
        "SELECT provider_npi, provider_name, payment_method_type, status, last_updated "
        "FROM provider_payment_details WHERE aggregator_id=$1 ORDER BY provider_name",
        aggregator_id,
    )
    payment_methods: Dict[str, int] = {}
    verification_status: Dict[str, int] = {}
    providers = []
    for r in rows:
        payment_methods[r["payment_method_type"]] = payment_methods.get(r["payment_method_type"], 0) + 1
        verification_status[r["status"]] = verification_status.get(r["status"], 0) + 1
        providers.append({
            "provider_npi": r["provider_npi"],
            "provider_name": r["provider_name"],
            "payment_method_type": r["payment_method_type"],
            "status": r["status"],
            "last_updated": r["last_updated"].isoformat(),
        })
    return {
        "aggregator_id": aggregator_id,
        "total_providers": len(rows),
        "payment_methods": payment_methods,
        "verification_status": verification_status,
        "providers": providers,
    }


@app.patch("/api/v1/provider-payments/{provider_npi}/{aggregator_id}/verify")
async def api_verify_payment_details(
    provider_npi: str,
    aggregator_id: str,
    current_user: TokenPayload = Depends(require_admin),
):
    """Mark payment details as verified (admin only)."""
    updated = await fetchval(
        "UPDATE provider_payment_details SET status=\'verified\', verification_date=NOW(), last_updated=NOW() "
        "WHERE provider_npi=$1 AND aggregator_id=$2 RETURNING id",
        provider_npi, aggregator_id,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Payment details not found")
    return {"status": "verified", "provider_npi": provider_npi}


@app.get("/health")
async def health_check():
    pool = await get_pool()
    return {
        "status": "healthy" if pool else "degraded",
        "service": "Provider Payment Details Service",
        "version": "2.0.0",
        "database": "connected" if pool else "unavailable",
        "timestamp": datetime.utcnow().isoformat(),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8028)
'''

path = "backend/core-services/provider_payment_details_service/main.py"
try:
    ast.parse(content)
except SyntaxError as e:
    print(f"SYNTAX ERROR: {e}")
    sys.exit(1)

with open(path, "w") as f:
    f.write(content)
print(f"OK: {path} ({len(content.splitlines())} lines)")
