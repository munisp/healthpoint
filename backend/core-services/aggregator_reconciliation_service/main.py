"""
Aggregator Reconciliation Service
Handles aggregator mapping, bulk submission reconciliation, and provider assignment validation.
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

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import asyncio
import json
import logging
from decimal import Decimal, ROUND_HALF_UP
from collections import defaultdict

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

setup_telemetry(service_name="aggregator-reconciliation-service", service_version="2.0.0")
app = FastAPI(title="Aggregator Reconciliation Service", version="2.0.0")
instrument_fastapi(app)
app.middleware("http")(security_headers_middleware)

# ── Enums ─────────────────────────────────────────────────────────────────────

class ReconciliationStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL = "partial"

class ValidationResult(str, Enum):
    VALID = "valid"
    INVALID = "invalid"
    WARNING = "warning"

# ── Pydantic models ───────────────────────────────────────────────────────────

class AggregatorInfo(BaseModel):
    aggregator_id: str
    name: str
    contact_email: str
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    tax_id: str
    billing_plan_id: str

class ProviderMapping(BaseModel):
    provider_npi: str
    provider_name: str
    provider_tax_id: str
    specialty: str
    billing_rate: Decimal

class ClaimValidation(BaseModel):
    claim_id: str
    provider_npi: str
    aggregator_id: str
    validation_status: ValidationResult
    errors: List[str] = []
    warnings: List[str] = []

class ReconciliationRequest(BaseModel):
    batch_id: str
    aggregator_id: str
    claims_data: List[Dict[str, Any]]
    force_reconciliation: bool = False

class ReconciliationResult(BaseModel):
    batch_id: str
    aggregator_id: str
    total_claims: int
    valid_claims: int
    invalid_claims: int
    warnings: int
    total_amount: Decimal
    billing_amount: Decimal
    reconciliation_status: ReconciliationStatus
    details: Dict[str, Any]

# ── DB bootstrap ──────────────────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS aggregators (
    id              BIGSERIAL PRIMARY KEY,
    aggregator_id   VARCHAR(60) UNIQUE NOT NULL,
    name            VARCHAR(255) NOT NULL,
    contact_email   VARCHAR(320),
    contact_phone   VARCHAR(50),
    address         TEXT,
    tax_id          VARCHAR(30),
    billing_plan_id VARCHAR(60),
    status          VARCHAR(20) DEFAULT 'active',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aggregators_status ON aggregators(status);

CREATE TABLE IF NOT EXISTS aggregator_providers (
    id              BIGSERIAL PRIMARY KEY,
    aggregator_id   VARCHAR(60) NOT NULL,
    provider_npi    VARCHAR(10) NOT NULL,
    provider_name   VARCHAR(255),
    provider_tax_id VARCHAR(30),
    specialty       VARCHAR(100),
    billing_rate    NUMERIC(10,2),
    assignment_date TIMESTAMPTZ DEFAULT NOW(),
    status          VARCHAR(20) DEFAULT 'active',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(aggregator_id, provider_npi)
);
CREATE INDEX IF NOT EXISTS idx_agg_providers_npi ON aggregator_providers(provider_npi);
CREATE INDEX IF NOT EXISTS idx_agg_providers_agg ON aggregator_providers(aggregator_id);

CREATE TABLE IF NOT EXISTS bulk_submissions (
    id                      BIGSERIAL PRIMARY KEY,
    batch_id                VARCHAR(120) UNIQUE NOT NULL,
    aggregator_id           VARCHAR(60) NOT NULL,
    total_claims            INT,
    valid_claims            INT DEFAULT 0,
    invalid_claims          INT DEFAULT 0,
    total_amount            NUMERIC(15,2),
    reconciliation_status   VARCHAR(20) DEFAULT 'pending',
    submission_date         TIMESTAMPTZ DEFAULT NOW(),
    reconciliation_date     TIMESTAMPTZ,
    reconciliation_details  JSONB,
    billing_amount          NUMERIC(10,2)
);
CREATE INDEX IF NOT EXISTS idx_bulk_submissions_agg ON bulk_submissions(aggregator_id);
CREATE INDEX IF NOT EXISTS idx_bulk_submissions_status ON bulk_submissions(reconciliation_status);

CREATE TABLE IF NOT EXISTS claim_mappings (
    id                  BIGSERIAL PRIMARY KEY,
    batch_id            VARCHAR(120) NOT NULL,
    claim_id            VARCHAR(60) NOT NULL,
    provider_npi        VARCHAR(10),
    aggregator_id       VARCHAR(60),
    validation_status   VARCHAR(20),
    validation_errors   JSONB,
    dispute_amount      NUMERIC(15,2),
    billing_charge      NUMERIC(10,2),
    created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_claim_mappings_batch ON claim_mappings(batch_id);
CREATE INDEX IF NOT EXISTS idx_claim_mappings_claim ON claim_mappings(claim_id);

CREATE TABLE IF NOT EXISTS reconciliation_logs (
    id              BIGSERIAL PRIMARY KEY,
    batch_id        VARCHAR(120),
    aggregator_id   VARCHAR(60),
    action          VARCHAR(100) NOT NULL,
    details         JSONB,
    user_id         VARCHAR(60),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recon_logs_batch ON reconciliation_logs(batch_id);
"""

@app.on_event("startup")
async def startup():
    await bootstrap_schema(SCHEMA_SQL)

# ── In-memory cache (refreshed from DB) ──────────────────────────────────────

_provider_cache: Dict[str, List[Dict[str, Any]]] = {}
_aggregator_cache: Dict[str, Dict[str, Any]] = {}

async def refresh_cache():
    """Reload provider-aggregator mappings from DB into memory."""
    global _provider_cache, _aggregator_cache
    aggregators = await fetch(
        "SELECT aggregator_id, name, billing_plan_id, contact_email FROM aggregators WHERE status='active'"
    )
    _aggregator_cache = {
        r["aggregator_id"]: {
            "name": r["name"],
            "billing_plan_id": r["billing_plan_id"],
            "contact_email": r["contact_email"],
        }
        for r in aggregators
    }
    mappings = await fetch(
        "SELECT aggregator_id, provider_npi, provider_name, specialty, billing_rate "
        "FROM aggregator_providers WHERE status='active'"
    )
    new_cache: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for m in mappings:
        new_cache[m["provider_npi"]].append({
            "aggregator_id": m["aggregator_id"],
            "provider_name": m["provider_name"],
            "specialty": m["specialty"],
            "billing_rate": float(m["billing_rate"]) if m["billing_rate"] else 0.0,
        })
    _provider_cache = dict(new_cache)
    logger.info(
        f"Cache refreshed: {len(_aggregator_cache)} aggregators, {len(_provider_cache)} providers"
    )

# ── Business logic ────────────────────────────────────────────────────────────

REQUIRED_CLAIM_FIELDS = ["claim_id", "provider_npi", "dispute_amount", "service_date", "dispute_type"]


async def validate_claim_mapping(
    claim: Dict[str, Any], expected_aggregator_id: str
) -> ClaimValidation:
    """Validate that a claim is properly mapped to the correct aggregator."""
    claim_id = claim.get("claim_id", "")
    provider_npi = claim.get("provider_npi", "")
    errors: List[str] = []
    warnings: List[str] = []

    for field in REQUIRED_CLAIM_FIELDS:
        if not claim.get(field):
            errors.append(f"Missing required field: {field}")

    if errors:
        return ClaimValidation(
            claim_id=claim_id, provider_npi=provider_npi,
            aggregator_id=expected_aggregator_id,
            validation_status=ValidationResult.INVALID, errors=errors,
        )

    if provider_npi not in _provider_cache:
        errors.append(f"Provider NPI {provider_npi} not found in system")
        return ClaimValidation(
            claim_id=claim_id, provider_npi=provider_npi,
            aggregator_id=expected_aggregator_id,
            validation_status=ValidationResult.INVALID, errors=errors,
        )

    provider_aggregators = [m["aggregator_id"] for m in _provider_cache[provider_npi]]
    if expected_aggregator_id not in provider_aggregators:
        errors.append(
            f"Provider NPI {provider_npi} is not assigned to aggregator {expected_aggregator_id}"
        )
        return ClaimValidation(
            claim_id=claim_id, provider_npi=provider_npi,
            aggregator_id=expected_aggregator_id,
            validation_status=ValidationResult.INVALID, errors=errors,
        )

    dispute_amount = Decimal(str(claim.get("dispute_amount", 0)))
    if dispute_amount <= 0:
        errors.append("dispute_amount must be greater than zero")
    if dispute_amount > 100000:
        warnings.append(f"High-value claim: ${dispute_amount} — requires manual review")

    status = (
        ValidationResult.INVALID if errors
        else ValidationResult.WARNING if warnings
        else ValidationResult.VALID
    )
    return ClaimValidation(
        claim_id=claim_id, provider_npi=provider_npi,
        aggregator_id=expected_aggregator_id,
        validation_status=status, errors=errors, warnings=warnings,
    )


def _calculate_claim_billing_charge(
    claim: Dict[str, Any], provider_npi: str, aggregator_id: str
) -> Decimal:
    """Calculate billing charge for a single claim using provider billing rate + modifiers."""
    base_rate = Decimal("0.00")
    for mapping in _provider_cache.get(provider_npi, []):
        if mapping["aggregator_id"] == aggregator_id:
            base_rate = Decimal(str(mapping["billing_rate"]))
            break

    dispute_amount = Decimal(str(claim.get("dispute_amount", 0)))
    if dispute_amount > 10000:
        base_rate *= Decimal("1.5")
    elif dispute_amount > 5000:
        base_rate *= Decimal("1.25")
    if claim.get("emergency_indicator"):
        base_rate *= Decimal("1.2")
    if claim.get("dispute_type") in ("AIR_AMBULANCE", "ANCILLARY_SERVICES"):
        base_rate *= Decimal("1.3")

    return base_rate.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


async def _log_reconciliation(
    batch_id: str, aggregator_id: str, action: str, details: Dict[str, Any]
):
    try:
        await execute(
            "INSERT INTO reconciliation_logs (batch_id, aggregator_id, action, details, user_id, created_at) "
            "VALUES ($1,$2,$3,$4::jsonb,'system',NOW())",
            batch_id, aggregator_id, action, json.dumps(details),
        )
    except Exception as exc:
        logger.error(f"Reconciliation log write failed: {exc}")


async def reconcile_bulk_submission(
    batch_id: str,
    aggregator_id: str,
    claims_data: List[Dict[str, Any]],
) -> ReconciliationResult:
    """Reconcile a bulk submission — validate all claims and compute billing charges."""
    if not _aggregator_cache:
        await refresh_cache()

    if aggregator_id not in _aggregator_cache:
        raise HTTPException(
            status_code=404, detail=f"Aggregator {aggregator_id} not found or inactive"
        )

    await execute(
        "INSERT INTO bulk_submissions (batch_id, aggregator_id, total_claims, reconciliation_status, submission_date) "
        "VALUES ($1,$2,$3,'in_progress',NOW()) "
        "ON CONFLICT (batch_id) DO UPDATE SET reconciliation_status='in_progress'",
        batch_id, aggregator_id, len(claims_data),
    )

    valid_claims = 0
    invalid_claims = 0
    warning_count = 0
    total_amount = Decimal("0.00")
    billing_amount = Decimal("0.00")
    provider_summary: Dict[str, int] = defaultdict(int)
    dispute_type_summary: Dict[str, int] = defaultdict(int)
    validation_details: Dict[str, Any] = {
        "valid_claims": [], "invalid_claims": [], "warnings": [],
        "provider_summary": {}, "dispute_type_summary": {},
    }

    for claim in claims_data:
        validation = await validate_claim_mapping(claim, aggregator_id)
        billing_charge = _calculate_claim_billing_charge(
            claim, validation.provider_npi, aggregator_id
        )

        await execute(
            "INSERT INTO claim_mappings "
            "(batch_id, claim_id, provider_npi, aggregator_id, validation_status, "
            "validation_errors, dispute_amount, billing_charge, created_at) "
            "VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,NOW())",
            batch_id, validation.claim_id, validation.provider_npi, aggregator_id,
            validation.validation_status.value,
            json.dumps(validation.errors + validation.warnings),
            float(Decimal(str(claim.get("dispute_amount", 0)))),
            float(billing_charge),
        )

        if validation.validation_status == ValidationResult.VALID:
            valid_claims += 1
            total_amount += Decimal(str(claim.get("dispute_amount", 0)))
            billing_amount += billing_charge
            validation_details["valid_claims"].append(validation.dict())
        elif validation.validation_status == ValidationResult.WARNING:
            valid_claims += 1
            warning_count += 1
            total_amount += Decimal(str(claim.get("dispute_amount", 0)))
            billing_amount += billing_charge
            validation_details["warnings"].append(validation.dict())
        else:
            invalid_claims += 1
            validation_details["invalid_claims"].append(validation.dict())

        provider_summary[validation.provider_npi] += 1
        dispute_type_summary[claim.get("dispute_type", "unknown")] += 1

    validation_details["provider_summary"] = dict(provider_summary)
    validation_details["dispute_type_summary"] = dict(dispute_type_summary)

    if invalid_claims == 0:
        final_status = ReconciliationStatus.COMPLETED
    elif valid_claims > 0:
        final_status = ReconciliationStatus.PARTIAL
    else:
        final_status = ReconciliationStatus.FAILED

    await execute(
        "UPDATE bulk_submissions "
        "SET valid_claims=$1, invalid_claims=$2, total_amount=$3, billing_amount=$4, "
        "reconciliation_status=$5, reconciliation_date=NOW(), reconciliation_details=$6::jsonb "
        "WHERE batch_id=$7",
        valid_claims, invalid_claims, float(total_amount), float(billing_amount),
        final_status.value, json.dumps(validation_details, default=str), batch_id,
    )

    await _log_reconciliation(batch_id, aggregator_id, "BULK_RECONCILIATION", {
        "total_claims": len(claims_data),
        "valid_claims": valid_claims,
        "invalid_claims": invalid_claims,
        "billing_amount": float(billing_amount),
    })

    await publish(Topics.RECONCILIATION_COMPLETED, {
        "batch_id": batch_id,
        "aggregator_id": aggregator_id,
        "status": final_status.value,
        "valid_claims": valid_claims,
        "invalid_claims": invalid_claims,
    })

    return ReconciliationResult(
        batch_id=batch_id,
        aggregator_id=aggregator_id,
        total_claims=len(claims_data),
        valid_claims=valid_claims,
        invalid_claims=invalid_claims,
        warnings=warning_count,
        total_amount=total_amount,
        billing_amount=billing_amount,
        reconciliation_status=final_status,
        details=validation_details,
    )

# ── API endpoints ─────────────────────────────────────────────────────────────

@app.post("/api/v1/reconciliation/bulk-submit", response_model=ReconciliationResult)
async def api_bulk_reconcile(
    request: ReconciliationRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    result = await reconcile_bulk_submission(
        request.batch_id, request.aggregator_id, request.claims_data
    )
    redis = await get_redis_client()
    if redis:
        await redis.setex(
            f"reconciliation:{request.batch_id}", 3600,
            json.dumps(result.dict(), default=str),
        )
    return result


@app.get("/api/v1/reconciliation/status/{batch_id}")
async def api_get_reconciliation_status(
    batch_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    redis = await get_redis_client()
    if redis:
        cached = await redis.get(f"reconciliation:{batch_id}")
        if cached:
            return json.loads(cached)

    submission = await fetchrow(
        "SELECT * FROM bulk_submissions WHERE batch_id = $1", batch_id
    )
    if not submission:
        raise HTTPException(status_code=404, detail="Batch not found")
    return {
        "batch_id": submission["batch_id"],
        "aggregator_id": submission["aggregator_id"],
        "total_claims": submission["total_claims"],
        "valid_claims": submission["valid_claims"],
        "invalid_claims": submission["invalid_claims"],
        "reconciliation_status": submission["reconciliation_status"],
        "billing_amount": float(submission["billing_amount"]) if submission["billing_amount"] else 0.0,
        "details": submission["reconciliation_details"],
    }


@app.post("/api/v1/aggregators/{aggregator_id}/providers")
async def api_assign_provider(
    aggregator_id: str,
    provider_info: ProviderMapping,
    current_user: TokenPayload = Depends(get_current_user),
):
    agg = await fetchrow(
        "SELECT aggregator_id FROM aggregators WHERE aggregator_id=$1 AND status='active'",
        aggregator_id,
    )
    if not agg:
        raise HTTPException(status_code=404, detail=f"Aggregator {aggregator_id} not found")

    try:
        await execute(
            "INSERT INTO aggregator_providers "
            "(aggregator_id, provider_npi, provider_name, provider_tax_id, specialty, billing_rate, assignment_date, status) "
            "VALUES ($1,$2,$3,$4,$5,$6,NOW(),'active')",
            aggregator_id, provider_info.provider_npi, provider_info.provider_name,
            provider_info.provider_tax_id, provider_info.specialty,
            float(provider_info.billing_rate),
        )
    except Exception as exc:
        if "unique" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Provider already assigned to this aggregator")
        raise HTTPException(status_code=500, detail=f"Assignment failed: {exc}")

    await refresh_cache()
    return {
        "status": "success",
        "message": f"Provider {provider_info.provider_npi} assigned to aggregator {aggregator_id}",
        "billing_rate": float(provider_info.billing_rate),
    }


@app.get("/api/v1/aggregators/{aggregator_id}/providers")
async def api_get_aggregator_providers(
    aggregator_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    rows = await fetch(
        "SELECT provider_npi, provider_name, specialty, billing_rate, assignment_date "
        "FROM aggregator_providers WHERE aggregator_id=$1 AND status='active' ORDER BY provider_name",
        aggregator_id,
    )
    return [
        {
            "provider_npi": r["provider_npi"],
            "provider_name": r["provider_name"],
            "specialty": r["specialty"],
            "billing_rate": float(r["billing_rate"]) if r["billing_rate"] else 0.0,
            "assignment_date": r["assignment_date"].isoformat(),
        }
        for r in rows
    ]


@app.post("/api/v1/reconciliation/validate-claim")
async def api_validate_single_claim(
    claim_data: Dict[str, Any],
    aggregator_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    if not _provider_cache:
        await refresh_cache()
    return await validate_claim_mapping(claim_data, aggregator_id)


@app.post("/api/v1/reconciliation/refresh-cache")
async def api_refresh_cache(
    current_user: TokenPayload = Depends(require_admin),
):
    await refresh_cache()
    return {
        "status": "cache refreshed",
        "aggregators": len(_aggregator_cache),
        "providers": len(_provider_cache),
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.get("/api/v1/reconciliation/aggregator-summary/{aggregator_id}")
async def api_get_aggregator_summary(
    aggregator_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    rows = await fetch(
        "SELECT batch_id, submission_date, total_claims, valid_claims, billing_amount, reconciliation_status "
        "FROM bulk_submissions WHERE aggregator_id=$1 ORDER BY submission_date DESC",
        aggregator_id,
    )
    total_claims = sum(r["total_claims"] or 0 for r in rows)
    total_billing = sum(float(r["billing_amount"] or 0) for r in rows)
    return {
        "aggregator_id": aggregator_id,
        "total_submissions": len(rows),
        "total_claims": total_claims,
        "total_billing": total_billing,
        "recent_submissions": [
            {
                "batch_id": r["batch_id"],
                "submission_date": r["submission_date"].isoformat(),
                "total_claims": r["total_claims"],
                "valid_claims": r["valid_claims"],
                "billing_amount": float(r["billing_amount"] or 0),
                "status": r["reconciliation_status"],
            }
            for r in rows[:10]
        ],
    }


@app.post("/api/v1/aggregators")
async def api_register_aggregator(
    info: AggregatorInfo,
    current_user: TokenPayload = Depends(require_admin),
):
    try:
        await execute(
            "INSERT INTO aggregators "
            "(aggregator_id, name, contact_email, contact_phone, address, tax_id, billing_plan_id, status, created_at, updated_at) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7,'active',NOW(),NOW())",
            info.aggregator_id, info.name, info.contact_email, info.contact_phone,
            info.address, info.tax_id, info.billing_plan_id,
        )
    except Exception as exc:
        if "unique" in str(exc).lower():
            raise HTTPException(status_code=409, detail=f"Aggregator {info.aggregator_id} already exists")
        raise HTTPException(status_code=500, detail=str(exc))
    await refresh_cache()
    return {"status": "success", "aggregator_id": info.aggregator_id}


@app.get("/health")
async def health_check():
    pool = await get_pool()
    return {
        "status": "healthy" if pool else "degraded",
        "service": "Aggregator Reconciliation Service",
        "version": "2.0.0",
        "database": "connected" if pool else "unavailable",
        "cache_status": {
            "aggregators": len(_aggregator_cache),
            "providers": len(_provider_cache),
        },
        "timestamp": datetime.utcnow().isoformat(),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8026)
