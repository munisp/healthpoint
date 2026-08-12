"""
HealthPoint Master Patient Index (MPI) — Probabilistic Patient Matching Service
================================================================================
Implements probabilistic patient matching across multiple EMR sources using
a weighted Fellegi-Sunter model with Jaro-Winkler string similarity.

Matching dimensions:
  - First name (Jaro-Winkler, weight 0.20)
  - Last name  (Jaro-Winkler, weight 0.25)
  - Date of birth (exact / year-only, weight 0.25)
  - Gender (exact, weight 0.05)
  - SSN last-4 (exact, weight 0.15)
  - MRN (exact per source, weight 0.10)

Thresholds:
  - Score >= 0.90: auto-link (definite match)
  - Score 0.70–0.89: probable match (human review queue)
  - Score < 0.70: no match

All patient records and match decisions are persisted to PostgreSQL.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import unicodedata
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

import asyncpg
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.shared.database import get_db_pool
from backend.shared.auth import get_current_user
from backend.shared.telemetry import setup_telemetry, instrument_fastapi
from backend.shared.security_middleware import add_security_middleware

logger = logging.getLogger(__name__)

app = FastAPI(
    title="MPI Patient Matching Service",
    description="Probabilistic patient matching across EMR sources",
    version="1.0.0",
)

setup_telemetry("mpi-patient-matching-service")
instrument_fastapi(app)
add_security_middleware(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "").split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Authorization", "Content-Type"],
)

# ─── Pydantic Models ──────────────────────────────────────────────────────────

class PatientIdentity(BaseModel):
    """Canonical patient identity record."""
    first_name: str
    last_name: str
    date_of_birth: str = Field(..., description="ISO 8601 date: YYYY-MM-DD")
    gender: Optional[str] = None
    ssn_last4: Optional[str] = Field(None, min_length=4, max_length=4)
    mrn: Optional[str] = None
    emr_source: Optional[str] = None
    address_line1: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    fhir_patient_id: Optional[str] = None
    medplum_patient_id: Optional[str] = None


class MatchRequest(BaseModel):
    patient: PatientIdentity
    threshold: float = Field(0.70, ge=0.0, le=1.0)
    max_candidates: int = Field(20, ge=1, le=100)
    auto_link: bool = Field(True, description="Auto-link if score >= 0.90")


class MatchCandidate(BaseModel):
    mpi_id: int
    score: float
    match_type: str  # "definite", "probable", "no_match"
    matched_fields: List[str]
    patient: Dict[str, Any]


class MatchResponse(BaseModel):
    query_patient: PatientIdentity
    candidates: List[MatchCandidate]
    best_score: float
    auto_linked: bool
    linked_mpi_id: Optional[int]
    review_required: bool


# ─── String Similarity ────────────────────────────────────────────────────────

def normalize_name(name: str) -> str:
    """Normalize a name for comparison: lowercase, strip accents, remove punctuation."""
    name = unicodedata.normalize("NFD", name)
    name = "".join(c for c in name if unicodedata.category(c) != "Mn")
    name = re.sub(r"[^a-z0-9 ]", "", name.lower().strip())
    return name


def jaro_winkler(s1: str, s2: str, p: float = 0.1) -> float:
    """Compute Jaro-Winkler similarity between two strings."""
    if s1 == s2:
        return 1.0
    if not s1 or not s2:
        return 0.0

    len1, len2 = len(s1), len(s2)
    match_distance = max(len1, len2) // 2 - 1

    s1_matches = [False] * len1
    s2_matches = [False] * len2
    matches = 0
    transpositions = 0

    for i in range(len1):
        start = max(0, i - match_distance)
        end = min(i + match_distance + 1, len2)
        for j in range(start, end):
            if s2_matches[j] or s1[i] != s2[j]:
                continue
            s1_matches[i] = True
            s2_matches[j] = True
            matches += 1
            break

    if matches == 0:
        return 0.0

    k = 0
    for i in range(len1):
        if not s1_matches[i]:
            continue
        while not s2_matches[k]:
            k += 1
        if s1[i] != s2[k]:
            transpositions += 1
        k += 1

    jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3

    # Winkler prefix bonus (up to 4 chars)
    prefix = 0
    for i in range(min(4, len1, len2)):
        if s1[i] == s2[i]:
            prefix += 1
        else:
            break

    return jaro + prefix * p * (1 - jaro)


def dob_similarity(dob1: str, dob2: str) -> Tuple[float, str]:
    """Compare two ISO dates. Returns (score, match_type)."""
    try:
        d1 = date.fromisoformat(dob1)
        d2 = date.fromisoformat(dob2)
    except ValueError:
        return 0.0, "invalid"

    if d1 == d2:
        return 1.0, "exact"
    if d1.year == d2.year and d1.month == d2.month:
        return 0.8, "year_month"
    if d1.year == d2.year:
        return 0.5, "year_only"
    # Transposition check: month/day swapped
    if d1.year == d2.year and d1.month == d2.day and d1.day == d2.month:
        return 0.7, "transposition"
    return 0.0, "no_match"


# ─── Scoring Engine ───────────────────────────────────────────────────────────

FIELD_WEIGHTS = {
    "last_name": 0.25,
    "first_name": 0.20,
    "date_of_birth": 0.25,
    "ssn_last4": 0.15,
    "mrn": 0.10,
    "gender": 0.05,
}


def compute_match_score(
    query: PatientIdentity,
    candidate: Dict[str, Any],
) -> Tuple[float, List[str]]:
    """
    Compute a weighted Fellegi-Sunter match score between query and candidate.
    Returns (score 0.0–1.0, list of matched field names).
    """
    score = 0.0
    matched_fields: List[str] = []

    # Last name
    ln_sim = jaro_winkler(
        normalize_name(query.last_name),
        normalize_name(candidate.get("last_name", "")),
    )
    if ln_sim >= 0.85:
        score += FIELD_WEIGHTS["last_name"] * ln_sim
        matched_fields.append("last_name")

    # First name
    fn_sim = jaro_winkler(
        normalize_name(query.first_name),
        normalize_name(candidate.get("first_name", "")),
    )
    if fn_sim >= 0.80:
        score += FIELD_WEIGHTS["first_name"] * fn_sim
        matched_fields.append("first_name")

    # Date of birth
    dob_sim, dob_type = dob_similarity(
        query.date_of_birth,
        candidate.get("date_of_birth", ""),
    )
    if dob_sim > 0:
        score += FIELD_WEIGHTS["date_of_birth"] * dob_sim
        matched_fields.append(f"date_of_birth:{dob_type}")

    # SSN last 4
    if query.ssn_last4 and candidate.get("ssn_last4_hash"):
        query_hash = hashlib.sha256(query.ssn_last4.encode()).hexdigest()
        if query_hash == candidate["ssn_last4_hash"]:
            score += FIELD_WEIGHTS["ssn_last4"]
            matched_fields.append("ssn_last4")

    # MRN (source-specific)
    if query.mrn and query.emr_source and candidate.get("mrn") and candidate.get("emr_source"):
        if (
            query.mrn == candidate["mrn"]
            and query.emr_source == candidate["emr_source"]
        ):
            score += FIELD_WEIGHTS["mrn"]
            matched_fields.append("mrn")

    # Gender
    if query.gender and candidate.get("gender"):
        if query.gender.lower() == candidate["gender"].lower():
            score += FIELD_WEIGHTS["gender"]
            matched_fields.append("gender")

    # Normalize to [0, 1]
    max_possible = sum(FIELD_WEIGHTS.values())
    normalized = min(score / max_possible, 1.0)
    return normalized, matched_fields


def classify_match(score: float) -> str:
    if score >= 0.90:
        return "definite"
    if score >= 0.70:
        return "probable"
    return "no_match"


# ─── API Endpoints ────────────────────────────────────────────────────────────

@app.post("/match", response_model=MatchResponse)
async def match_patient(
    request: MatchRequest,
    current_user: Dict = Depends(get_current_user),
) -> MatchResponse:
    """
    Find matching patients in the MPI for the given patient identity.
    Auto-links definite matches (score >= 0.90) if auto_link=True.
    """
    query = request.patient

    # Fetch candidates from PostgreSQL using blocking filters
    # (last name first letter + birth year) to limit comparison set
    async with app.state.pool.acquire() as conn:
        candidates_raw = await conn.fetch(
            """
            SELECT id, first_name, last_name, date_of_birth, gender,
                   ssn_last4_hash, mrn, emr_source, fhir_patient_id,
                   medplum_patient_id, address_line1, city, state, zip_code
            FROM mpi_patients
            WHERE
                (LOWER(last_name) LIKE $1 OR LOWER(first_name) LIKE $2)
                AND (
                    EXTRACT(YEAR FROM date_of_birth::date) = $3
                    OR EXTRACT(YEAR FROM date_of_birth::date) BETWEEN $3 - 1 AND $3 + 1
                )
            LIMIT $4
            """,
            normalize_name(query.last_name)[:1] + "%",
            normalize_name(query.first_name)[:1] + "%",
            int(query.date_of_birth[:4]) if len(query.date_of_birth) >= 4 else 0,
            request.max_candidates * 5,  # over-fetch for scoring
        )

    # Score all candidates
    scored: List[Tuple[float, List[str], Dict[str, Any]]] = []
    for row in candidates_raw:
        candidate = dict(row)
        score, matched_fields = compute_match_score(query, candidate)
        if score >= request.threshold:
            scored.append((score, matched_fields, candidate))

    # Sort by score descending, take top N
    scored.sort(key=lambda x: x[0], reverse=True)
    top_candidates = scored[:request.max_candidates]

    best_score = top_candidates[0][0] if top_candidates else 0.0
    best_candidate = top_candidates[0][2] if top_candidates else None
    auto_linked = False
    linked_mpi_id: Optional[int] = None

    # Auto-link if definite match
    if request.auto_link and best_score >= 0.90 and best_candidate:
        linked_mpi_id = best_candidate["id"]
        auto_linked = True

        async with app.state.pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO mpi_match_log
                  (query_patient_json, matched_mpi_id, score, match_type,
                   matched_fields, auto_linked, created_at)
                VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
                """,
                json.dumps(query.dict()),
                linked_mpi_id,
                best_score,
                "definite",
                json.dumps(top_candidates[0][1]),
            )
        logger.info(
            f"Auto-linked patient to MPI ID {linked_mpi_id} (score={best_score:.3f})"
        )

    # Queue probable matches for human review
    review_required = (
        not auto_linked
        and best_score >= 0.70
        and best_score < 0.90
        and best_candidate is not None
    )
    if review_required:
        async with app.state.pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO mpi_review_queue
                  (query_patient_json, candidate_mpi_id, score, matched_fields,
                   status, created_at)
                VALUES ($1, $2, $3, $4, 'pending', NOW())
                """,
                json.dumps(query.dict()),
                best_candidate["id"],
                best_score,
                json.dumps(top_candidates[0][1]),
            )
        logger.info(
            f"Queued probable match for review: MPI ID {best_candidate['id']} "
            f"(score={best_score:.3f})"
        )

    candidates_out = [
        MatchCandidate(
            mpi_id=c["id"],
            score=round(s, 4),
            match_type=classify_match(s),
            matched_fields=mf,
            patient={
                k: v for k, v in c.items()
                if k not in ("ssn_last4_hash",)  # never return hashed SSN
            },
        )
        for s, mf, c in top_candidates
    ]

    return MatchResponse(
        query_patient=query,
        candidates=candidates_out,
        best_score=round(best_score, 4),
        auto_linked=auto_linked,
        linked_mpi_id=linked_mpi_id,
        review_required=review_required,
    )


@app.post("/patients", response_model=Dict[str, Any])
async def create_patient(
    patient: PatientIdentity,
    current_user: Dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Register a new patient in the MPI."""
    ssn_hash = (
        hashlib.sha256(patient.ssn_last4.encode()).hexdigest()
        if patient.ssn_last4
        else None
    )

    async with app.state.pool.acquire() as conn:
        mpi_id = await conn.fetchval(
            """
            INSERT INTO mpi_patients
              (first_name, last_name, date_of_birth, gender, ssn_last4_hash,
               mrn, emr_source, fhir_patient_id, medplum_patient_id,
               address_line1, city, state, zip_code, phone, email, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                    $14, $15, NOW())
            RETURNING id
            """,
            patient.first_name,
            patient.last_name,
            patient.date_of_birth,
            patient.gender,
            ssn_hash,
            patient.mrn,
            patient.emr_source,
            patient.fhir_patient_id,
            patient.medplum_patient_id,
            patient.address_line1,
            patient.city,
            patient.state,
            patient.zip_code,
            patient.phone,
            patient.email,
        )

    logger.info(f"Created MPI patient record: ID={mpi_id}")
    return {"mpi_id": mpi_id, "status": "created"}


@app.get("/patients/{mpi_id}", response_model=Dict[str, Any])
async def get_patient(
    mpi_id: int,
    current_user: Dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Retrieve a patient record from the MPI by MPI ID."""
    async with app.state.pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, first_name, last_name, date_of_birth, gender,
                   mrn, emr_source, fhir_patient_id, medplum_patient_id,
                   address_line1, city, state, zip_code, phone, email, created_at
            FROM mpi_patients WHERE id = $1
            """,
            mpi_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail=f"MPI patient {mpi_id} not found.")
    return dict(row)


@app.get("/review-queue", response_model=List[Dict[str, Any]])
async def get_review_queue(
    status: str = "pending",
    limit: int = 50,
    current_user: Dict = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    """Retrieve probable matches awaiting human review."""
    async with app.state.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, query_patient_json, candidate_mpi_id, score,
                   matched_fields, status, created_at
            FROM mpi_review_queue
            WHERE status = $1
            ORDER BY score DESC, created_at ASC
            LIMIT $2
            """,
            status, limit,
        )
    return [dict(r) for r in rows]


@app.put("/review-queue/{review_id}/decision")
async def resolve_review(
    review_id: int,
    decision: str,  # "link" or "reject"
    current_user: Dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Resolve a human review decision: link or reject the probable match."""
    if decision not in ("link", "reject"):
        raise HTTPException(status_code=400, detail="Decision must be 'link' or 'reject'.")

    async with app.state.pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE mpi_review_queue
            SET status = $1,
                resolved_by = $2,
                resolved_at = NOW()
            WHERE id = $3
            """,
            decision + "ed",
            current_user.get("sub"),
            review_id,
        )

    return {"review_id": review_id, "decision": decision, "status": "resolved"}


# ─── Startup / Shutdown ───────────────────────────────────────────────────────

@app.on_event("startup")
async def startup() -> None:
    app.state.pool = await get_db_pool()

    async with app.state.pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS mpi_patients (
                id BIGSERIAL PRIMARY KEY,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                date_of_birth TEXT NOT NULL,
                gender TEXT,
                ssn_last4_hash TEXT,
                mrn TEXT,
                emr_source TEXT,
                fhir_patient_id TEXT,
                medplum_patient_id TEXT,
                address_line1 TEXT,
                city TEXT,
                state TEXT,
                zip_code TEXT,
                phone TEXT,
                email TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_mpi_last_name ON mpi_patients (LOWER(last_name));
            CREATE INDEX IF NOT EXISTS idx_mpi_dob ON mpi_patients (date_of_birth);
            CREATE INDEX IF NOT EXISTS idx_mpi_fhir ON mpi_patients (fhir_patient_id);
            CREATE INDEX IF NOT EXISTS idx_mpi_mrn ON mpi_patients (mrn, emr_source);

            CREATE TABLE IF NOT EXISTS mpi_match_log (
                id BIGSERIAL PRIMARY KEY,
                query_patient_json JSONB NOT NULL,
                matched_mpi_id BIGINT REFERENCES mpi_patients(id),
                score FLOAT NOT NULL,
                match_type TEXT NOT NULL,
                matched_fields JSONB,
                auto_linked BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS mpi_review_queue (
                id BIGSERIAL PRIMARY KEY,
                query_patient_json JSONB NOT NULL,
                candidate_mpi_id BIGINT REFERENCES mpi_patients(id),
                score FLOAT NOT NULL,
                matched_fields JSONB,
                status TEXT NOT NULL DEFAULT 'pending',
                resolved_by TEXT,
                resolved_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_mpi_review_status
                ON mpi_review_queue (status, created_at);
        """)

    logger.info("MPI Patient Matching Service started.")


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok", "service": "mpi-patient-matching-service"}
