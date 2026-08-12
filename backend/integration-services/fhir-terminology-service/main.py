"""
HealthPoint FHIR Terminology Service
=====================================
Validates and resolves FHIR CodeSystem and ValueSet codes used across
GFE generation, claims processing, and IDR dispute submissions.

Supported code systems:
  - ICD-10-CM (diagnosis codes, 2024 edition)
  - CPT (procedure codes, AMA — loaded from CMS PUF)
  - SNOMED CT (clinical terms)
  - LOINC (lab/observation codes)
  - NDC (National Drug Codes)
  - NUBC Revenue Codes
  - Place of Service (POS) codes
  - NSA Qualifying Payment Amount (QPA) service categories

All code lookups are backed by PostgreSQL with Redis caching.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

import asyncpg
import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.shared.database import get_db_pool
from backend.shared.cache import get_redis_client
from backend.shared.auth import get_current_user
from backend.shared.telemetry import setup_telemetry, instrument_fastapi
from backend.shared.security_middleware import add_security_middleware

logger = logging.getLogger(__name__)

app = FastAPI(
    title="FHIR Terminology Service",
    description="CodeSystem and ValueSet validation for ICD-10, CPT, SNOMED, LOINC, NDC",
    version="1.0.0",
)

setup_telemetry("fhir-terminology-service")
instrument_fastapi(app)
add_security_middleware(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "").split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

CACHE_TTL_SECONDS = 3600  # 1 hour

# ─── Code System Definitions ──────────────────────────────────────────────────

CODE_SYSTEMS: Dict[str, Dict[str, Any]] = {
    "icd10cm": {
        "url": "http://hl7.org/fhir/sid/icd-10-cm",
        "name": "ICD-10-CM",
        "table": "terminology_icd10cm",
        "code_col": "code",
        "display_col": "description",
    },
    "cpt": {
        "url": "http://www.ama-assn.org/go/cpt",
        "name": "CPT",
        "table": "terminology_cpt",
        "code_col": "code",
        "display_col": "description",
    },
    "snomed": {
        "url": "http://snomed.info/sct",
        "name": "SNOMED CT",
        "table": "terminology_snomed",
        "code_col": "concept_id",
        "display_col": "fsn",
    },
    "loinc": {
        "url": "http://loinc.org",
        "name": "LOINC",
        "table": "terminology_loinc",
        "code_col": "loinc_num",
        "display_col": "long_common_name",
    },
    "ndc": {
        "url": "http://hl7.org/fhir/sid/ndc",
        "name": "NDC",
        "table": "terminology_ndc",
        "code_col": "product_ndc",
        "display_col": "brand_name",
    },
    "nubc-revenue": {
        "url": "https://www.nubc.org/CodeSystem/RevenueCodes",
        "name": "NUBC Revenue Codes",
        "table": "terminology_revenue_codes",
        "code_col": "code",
        "display_col": "description",
    },
    "pos": {
        "url": "https://www.cms.gov/Medicare/Coding/place-of-service-codes",
        "name": "Place of Service",
        "table": "terminology_pos_codes",
        "code_col": "code",
        "display_col": "name",
    },
    "nsa-service-category": {
        "url": "https://www.cms.gov/healthplan/nsa/service-categories",
        "name": "NSA Service Categories",
        "table": "terminology_nsa_service_categories",
        "code_col": "code",
        "display_col": "description",
    },
}

# NSA-specific service categories (loaded into terminology_nsa_service_categories)
NSA_SERVICE_CATEGORIES = [
    {"code": "emergency", "description": "Emergency services"},
    {"code": "non-emergency-transport", "description": "Non-emergency transport"},
    {"code": "air-ambulance", "description": "Air ambulance"},
    {"code": "anesthesiology", "description": "Anesthesiology"},
    {"code": "radiology", "description": "Radiology"},
    {"code": "pathology", "description": "Pathology"},
    {"code": "neonatology", "description": "Neonatology"},
    {"code": "assistant-surgeon", "description": "Assistant surgeon"},
    {"code": "hospitalist", "description": "Hospitalist"},
    {"code": "intensivist", "description": "Intensivist"},
]

# POS codes (CMS-defined)
POS_CODES = [
    {"code": "11", "name": "Office"},
    {"code": "21", "name": "Inpatient Hospital"},
    {"code": "22", "name": "On Campus-Outpatient Hospital"},
    {"code": "23", "name": "Emergency Room - Hospital"},
    {"code": "24", "name": "Ambulatory Surgical Center"},
    {"code": "31", "name": "Skilled Nursing Facility"},
    {"code": "41", "name": "Ambulance - Land"},
    {"code": "42", "name": "Ambulance - Air or Water"},
    {"code": "51", "name": "Inpatient Psychiatric Facility"},
    {"code": "65", "name": "End-Stage Renal Disease Treatment Facility"},
    {"code": "71", "name": "Public Health Clinic"},
    {"code": "72", "name": "Rural Health Clinic"},
    {"code": "81", "name": "Independent Laboratory"},
    {"code": "99", "name": "Other Place of Service"},
]


# ─── Pydantic Models ──────────────────────────────────────────────────────────

class CodeValidationRequest(BaseModel):
    system: str = Field(..., description="Code system key: icd10cm, cpt, snomed, loinc, ndc, etc.")
    code: str
    display: Optional[str] = None


class CodeValidationResult(BaseModel):
    valid: bool
    code: str
    system: str
    system_url: str
    display: Optional[str]
    canonical_display: Optional[str]
    issues: List[str]


class BatchValidationRequest(BaseModel):
    codes: List[CodeValidationRequest]


class ValueSetExpansionRequest(BaseModel):
    value_set_id: str
    filter: Optional[str] = None
    offset: int = 0
    count: int = 100


# ─── Cache Helpers ────────────────────────────────────────────────────────────

async def cache_get(key: str) -> Optional[Any]:
    try:
        client = await get_redis_client()
        value = await client.get(key)
        return json.loads(value) if value else None
    except Exception:
        return None


async def cache_set(key: str, value: Any, ttl: int = CACHE_TTL_SECONDS) -> None:
    try:
        client = await get_redis_client()
        await client.setex(key, ttl, json.dumps(value))
    except Exception:
        pass


# ─── Core Validation Logic ────────────────────────────────────────────────────

async def validate_code(
    pool: asyncpg.Pool,
    system_key: str,
    code: str,
    display: Optional[str] = None,
) -> CodeValidationResult:
    """Validate a single code against a code system in PostgreSQL."""
    system_config = CODE_SYSTEMS.get(system_key)
    if not system_config:
        return CodeValidationResult(
            valid=False,
            code=code,
            system=system_key,
            system_url="",
            display=display,
            canonical_display=None,
            issues=[f"Unknown code system: {system_key}"],
        )

    cache_key = f"terminology:{system_key}:{code}"
    cached = await cache_get(cache_key)
    if cached:
        result = CodeValidationResult(**cached)
        # Update display mismatch check with provided display
        if display and result.canonical_display and display != result.canonical_display:
            result.issues.append(
                f"Display mismatch: provided '{display}', canonical '{result.canonical_display}'"
            )
        return result

    table = system_config["table"]
    code_col = system_config["code_col"]
    display_col = system_config["display_col"]

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT {code_col}, {display_col} FROM {table} WHERE {code_col} = $1",
            code,
        )

    issues: List[str] = []
    if not row:
        result = CodeValidationResult(
            valid=False,
            code=code,
            system=system_config["name"],
            system_url=system_config["url"],
            display=display,
            canonical_display=None,
            issues=[f"Code '{code}' not found in {system_config['name']}"],
        )
    else:
        canonical_display = row[display_col]
        if display and canonical_display and display.strip() != canonical_display.strip():
            issues.append(
                f"Display mismatch: provided '{display}', canonical '{canonical_display}'"
            )
        result = CodeValidationResult(
            valid=True,
            code=code,
            system=system_config["name"],
            system_url=system_config["url"],
            display=display,
            canonical_display=canonical_display,
            issues=issues,
        )

    # Cache valid results only
    if result.valid:
        await cache_set(cache_key, result.dict())

    return result


# ─── API Endpoints ────────────────────────────────────────────────────────────

@app.post("/validate", response_model=CodeValidationResult)
async def validate_single_code(
    request: CodeValidationRequest,
    current_user: Dict = Depends(get_current_user),
) -> CodeValidationResult:
    """Validate a single FHIR code against its code system."""
    return await validate_code(
        app.state.pool,
        request.system,
        request.code,
        request.display,
    )


@app.post("/validate/batch", response_model=List[CodeValidationResult])
async def validate_batch(
    request: BatchValidationRequest,
    current_user: Dict = Depends(get_current_user),
) -> List[CodeValidationResult]:
    """Validate multiple codes in a single request (used by GFE and claims services)."""
    if len(request.codes) > 200:
        raise HTTPException(
            status_code=400,
            detail="Batch validation is limited to 200 codes per request.",
        )
    results = []
    for item in request.codes:
        result = await validate_code(
            app.state.pool, item.system, item.code, item.display
        )
        results.append(result)
    return results


@app.get("/lookup/{system}/{code}", response_model=CodeValidationResult)
async def lookup_code(
    system: str,
    code: str,
    current_user: Dict = Depends(get_current_user),
) -> CodeValidationResult:
    """Look up a code and return its canonical display name."""
    return await validate_code(app.state.pool, system, code)


@app.get("/systems", response_model=List[Dict[str, str]])
async def list_code_systems() -> List[Dict[str, str]]:
    """List all supported code systems."""
    return [
        {"key": k, "name": v["name"], "url": v["url"]}
        for k, v in CODE_SYSTEMS.items()
    ]


@app.get("/valuesets/nsa-service-categories")
async def get_nsa_service_categories() -> List[Dict[str, str]]:
    """Return all NSA service categories (used by GFE and IDR dispute services)."""
    return NSA_SERVICE_CATEGORIES


@app.get("/valuesets/pos-codes")
async def get_pos_codes() -> List[Dict[str, str]]:
    """Return all Place of Service codes."""
    return POS_CODES


@app.get("/search/{system}")
async def search_codes(
    system: str,
    q: str = Query(..., min_length=2, description="Search term"),
    limit: int = Query(20, ge=1, le=100),
    current_user: Dict = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    """Full-text search within a code system (used by GFE UI code picker)."""
    system_config = CODE_SYSTEMS.get(system)
    if not system_config:
        raise HTTPException(status_code=400, detail=f"Unknown code system: {system}")

    table = system_config["table"]
    code_col = system_config["code_col"]
    display_col = system_config["display_col"]

    async with app.state.pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT {code_col} AS code, {display_col} AS display
            FROM {table}
            WHERE {code_col} ILIKE $1 OR {display_col} ILIKE $1
            ORDER BY
                CASE WHEN {code_col} ILIKE $2 THEN 0 ELSE 1 END,
                {code_col}
            LIMIT $3
            """,
            f"%{q}%",
            f"{q}%",
            limit,
        )

    return [{"code": r["code"], "display": r["display"]} for r in rows]


@app.get("/validate/idr-claim")
async def validate_idr_claim_codes(
    service_code: str = Query(...),
    diagnosis_code: Optional[str] = Query(None),
    place_of_service: Optional[str] = Query(None),
    revenue_code: Optional[str] = Query(None),
    current_user: Dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Validate all codes on an IDR claim in one call.
    Used by the GFE service and NSA IDR dispute service before submission.
    """
    results: Dict[str, Any] = {}
    all_valid = True

    # Validate CPT/service code
    cpt_result = await validate_code(app.state.pool, "cpt", service_code)
    results["service_code"] = cpt_result.dict()
    if not cpt_result.valid:
        all_valid = False

    # Validate diagnosis code (ICD-10-CM)
    if diagnosis_code:
        dx_result = await validate_code(app.state.pool, "icd10cm", diagnosis_code)
        results["diagnosis_code"] = dx_result.dict()
        if not dx_result.valid:
            all_valid = False

    # Validate place of service
    if place_of_service:
        pos_result = await validate_code(app.state.pool, "pos", place_of_service)
        results["place_of_service"] = pos_result.dict()
        if not pos_result.valid:
            all_valid = False

    # Validate revenue code
    if revenue_code:
        rev_result = await validate_code(app.state.pool, "nubc-revenue", revenue_code)
        results["revenue_code"] = rev_result.dict()
        if not rev_result.valid:
            all_valid = False

    return {
        "all_valid": all_valid,
        "results": results,
        "issues": [
            issue
            for r in results.values()
            for issue in r.get("issues", [])
        ],
    }


# ─── Startup ──────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup() -> None:
    app.state.pool = await get_db_pool()

    async with app.state.pool.acquire() as conn:
        # Create terminology tables (populated by separate ETL jobs)
        for system_key, config in CODE_SYSTEMS.items():
            table = config["table"]
            code_col = config["code_col"]
            display_col = config["display_col"]
            await conn.execute(f"""
                CREATE TABLE IF NOT EXISTS {table} (
                    {code_col} TEXT PRIMARY KEY,
                    {display_col} TEXT NOT NULL,
                    active BOOLEAN DEFAULT TRUE,
                    effective_date DATE,
                    expiry_date DATE,
                    additional_data JSONB
                );
                CREATE INDEX IF NOT EXISTS idx_{table}_{code_col}
                    ON {table} ({code_col});
                CREATE INDEX IF NOT EXISTS idx_{table}_display
                    ON {table} USING gin(to_tsvector('english', {display_col}));
            """)

        # Seed NSA service categories and POS codes (idempotent)
        for cat in NSA_SERVICE_CATEGORIES:
            await conn.execute(
                """
                INSERT INTO terminology_nsa_service_categories (code, description)
                VALUES ($1, $2)
                ON CONFLICT (code) DO NOTHING
                """,
                cat["code"], cat["description"],
            )
        for pos in POS_CODES:
            await conn.execute(
                """
                INSERT INTO terminology_pos_codes (code, name)
                VALUES ($1, $2)
                ON CONFLICT (code) DO NOTHING
                """,
                pos["code"], pos["name"],
            )

    logger.info("FHIR Terminology Service started.")


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok", "service": "fhir-terminology-service"}
