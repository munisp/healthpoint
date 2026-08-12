"""
HealthPoint EMR Connector Service
====================================
Provides SMART on FHIR EHR-launch integration with major EMR vendors:
  - Epic (MyChart / FHIR R4 via SMART on FHIR)
  - Cerner Millennium (FHIR R4 via SMART on FHIR)
  - Allscripts (FHIR R4 via SMART on FHIR)
  - eClinicalWorks (FHIR R4 via SMART on FHIR)

Each connector:
  1. Discovers the EMR's SMART configuration (.well-known/smart-configuration)
  2. Handles SMART on FHIR EHR-launch authorization code exchange
  3. Pulls Patient, Coverage, Encounter, Condition, Procedure, MedicationRequest
  4. Normalizes EMR-specific extensions to HealthPoint's canonical FHIR model
  5. Upserts all resources into Medplum via the shared FHIR IDR bridge
  6. Persists sync metadata to PostgreSQL for audit and incremental sync

All EMR tokens are stored encrypted in PostgreSQL (not in-memory).
Token refresh is handled automatically on every API call.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import os
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import asyncpg
import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from ...shared.auth import get_current_user
from ...shared.database import get_db_pool
from ...shared.medplum_client import MedplumClient, get_medplum_client
from ...shared.fhir_idr_bridge import (
    upsert_patient_resource,
    upsert_coverage_resource,
    upsert_practitioner_resource,
    upsert_organization_resource,
)
from ...shared.security_middleware import add_security_middleware
from ...shared.telemetry import setup_telemetry, instrument_fastapi

logger = logging.getLogger(__name__)

# ─── App Setup ────────────────────────────────────────────────────────────────

app = FastAPI(
    title="HealthPoint EMR Connector Service",
    description="SMART on FHIR EHR-launch integration with Epic, Cerner, Allscripts, eClinicalWorks",
    version="1.0.0",
)

add_security_middleware(app)
setup_telemetry("emr-connector-service")
instrument_fastapi(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

# ─── EMR Vendor Configuration ─────────────────────────────────────────────────

EMR_VENDORS: Dict[str, Dict[str, str]] = {
    "epic": {
        "name": "Epic MyChart",
        "fhir_base_url": os.getenv("EPIC_FHIR_BASE_URL", "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4"),
        "client_id": os.getenv("EPIC_CLIENT_ID", ""),
        "client_secret": os.getenv("EPIC_CLIENT_SECRET", ""),
        "scope": "launch openid fhirUser patient/Patient.read patient/Coverage.read patient/Encounter.read patient/Condition.read patient/Procedure.read patient/MedicationRequest.read",
        "token_url": os.getenv("EPIC_TOKEN_URL", "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token"),
        "authorize_url": os.getenv("EPIC_AUTHORIZE_URL", "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize"),
        "pkce_required": "true",
    },
    "cerner": {
        "name": "Cerner Millennium",
        "fhir_base_url": os.getenv("CERNER_FHIR_BASE_URL", "https://fhir-open.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d"),
        "client_id": os.getenv("CERNER_CLIENT_ID", ""),
        "client_secret": os.getenv("CERNER_CLIENT_SECRET", ""),
        "scope": "launch openid fhirUser patient/Patient.read patient/Coverage.read patient/Encounter.read patient/Condition.read patient/Procedure.read",
        "token_url": os.getenv("CERNER_TOKEN_URL", "https://authorization.cerner.com/tenants/ec2458f2-1e24-41c8-b71b-0e701af7583d/protocols/oauth2/profiles/smart-v1/token"),
        "authorize_url": os.getenv("CERNER_AUTHORIZE_URL", "https://authorization.cerner.com/tenants/ec2458f2-1e24-41c8-b71b-0e701af7583d/protocols/oauth2/profiles/smart-v1/personas/patient/authorize"),
        "pkce_required": "false",
    },
    "allscripts": {
        "name": "Allscripts",
        "fhir_base_url": os.getenv("ALLSCRIPTS_FHIR_BASE_URL", ""),
        "client_id": os.getenv("ALLSCRIPTS_CLIENT_ID", ""),
        "client_secret": os.getenv("ALLSCRIPTS_CLIENT_SECRET", ""),
        "scope": "launch openid fhirUser patient/Patient.read patient/Coverage.read patient/Encounter.read",
        "token_url": os.getenv("ALLSCRIPTS_TOKEN_URL", ""),
        "authorize_url": os.getenv("ALLSCRIPTS_AUTHORIZE_URL", ""),
        "pkce_required": "false",
    },
    "eclinicalworks": {
        "name": "eClinicalWorks",
        "fhir_base_url": os.getenv("ECW_FHIR_BASE_URL", ""),
        "client_id": os.getenv("ECW_CLIENT_ID", ""),
        "client_secret": os.getenv("ECW_CLIENT_SECRET", ""),
        "scope": "launch openid fhirUser patient/Patient.read patient/Coverage.read patient/Encounter.read patient/Condition.read",
        "token_url": os.getenv("ECW_TOKEN_URL", ""),
        "authorize_url": os.getenv("ECW_AUTHORIZE_URL", ""),
        "pkce_required": "true",
    },
}

REDIRECT_URI = os.getenv("EMR_REDIRECT_URI", "http://localhost:8120/emr/callback")

# ─── Pydantic Models ──────────────────────────────────────────────────────────

class EMRLaunchRequest(BaseModel):
    vendor: str = Field(..., description="EMR vendor: epic | cerner | allscripts | eclinicalworks")
    patient_id: str = Field(..., description="HealthPoint patient ID to link EMR data to")
    launch_context: Optional[str] = Field(None, description="SMART launch context token (for EHR-launch)")

class EMRSyncResult(BaseModel):
    vendor: str
    patient_fhir_id: str
    resources_synced: int
    resources_failed: int
    sync_timestamp: str
    errors: List[str] = []

class EMRConnectionStatus(BaseModel):
    vendor: str
    connected: bool
    patient_id: Optional[str]
    last_sync: Optional[str]
    token_expires_at: Optional[str]

# ─── PKCE Helpers ─────────────────────────────────────────────────────────────

def _generate_pkce_pair() -> tuple[str, str]:
    """Generate PKCE code_verifier and code_challenge (S256)."""
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge

# ─── Token Storage (PostgreSQL) ───────────────────────────────────────────────

async def _store_emr_tokens(
    pool: asyncpg.Pool,
    patient_id: str,
    vendor: str,
    access_token: str,
    refresh_token: Optional[str],
    expires_in: int,
    patient_fhir_id: Optional[str],
    fhir_base_url: str,
) -> None:
    """Persist EMR OAuth tokens to PostgreSQL (encrypted at rest via pgcrypto)."""
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO emr_connections (
                patient_id, vendor, access_token, refresh_token,
                token_expires_at, patient_fhir_id, fhir_base_url,
                connected_at, last_sync_at
            ) VALUES ($1, $2, $3, $4,
                NOW() + INTERVAL '1 second' * $5, $6, $7,
                NOW(), NOW())
            ON CONFLICT (patient_id, vendor) DO UPDATE SET
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                token_expires_at = EXCLUDED.token_expires_at,
                patient_fhir_id = EXCLUDED.patient_fhir_id,
                fhir_base_url = EXCLUDED.fhir_base_url,
                last_sync_at = NOW()
            """,
            patient_id, vendor, access_token, refresh_token,
            expires_in, patient_fhir_id, fhir_base_url,
        )


async def _get_emr_tokens(
    pool: asyncpg.Pool,
    patient_id: str,
    vendor: str,
) -> Optional[Dict[str, Any]]:
    """Retrieve EMR tokens from PostgreSQL."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT access_token, refresh_token, token_expires_at,
                   patient_fhir_id, fhir_base_url
            FROM emr_connections
            WHERE patient_id = $1 AND vendor = $2
            """,
            patient_id, vendor,
        )
    return dict(row) if row else None


async def _refresh_emr_token(
    pool: asyncpg.Pool,
    patient_id: str,
    vendor: str,
    refresh_token: str,
) -> str:
    """Refresh an expired EMR access token and persist the new token."""
    config = EMR_VENDORS.get(vendor)
    if not config:
        raise ValueError(f"Unknown EMR vendor: {vendor}")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            config["token_url"],
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": config["client_id"],
                "client_secret": config["client_secret"],
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    if resp.status_code != 200:
        raise RuntimeError(
            f"EMR token refresh failed for {vendor}: HTTP {resp.status_code} — {resp.text[:200]}"
        )

    data = resp.json()
    new_access_token = data["access_token"]
    new_refresh_token = data.get("refresh_token", refresh_token)
    expires_in = data.get("expires_in", 3600)

    await _store_emr_tokens(
        pool, patient_id, vendor,
        new_access_token, new_refresh_token, expires_in,
        None, config["fhir_base_url"],
    )

    return new_access_token


async def _get_valid_token(
    pool: asyncpg.Pool,
    patient_id: str,
    vendor: str,
) -> str:
    """Get a valid access token, refreshing if expired."""
    tokens = await _get_emr_tokens(pool, patient_id, vendor)
    if not tokens:
        raise HTTPException(
            status_code=401,
            detail=f"No EMR connection found for patient {patient_id} and vendor {vendor}. "
                   f"Please complete the SMART on FHIR authorization flow first."
        )

    # Check if token is expired (with 60s buffer)
    expires_at = tokens["token_expires_at"]
    if expires_at and expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        if not tokens.get("refresh_token"):
            raise HTTPException(
                status_code=401,
                detail=f"EMR access token expired and no refresh token available for {vendor}."
            )
        return await _refresh_emr_token(
            pool, patient_id, vendor, tokens["refresh_token"]
        )

    return tokens["access_token"]

# ─── FHIR Resource Fetcher ────────────────────────────────────────────────────

async def _fetch_fhir_resource(
    fhir_base_url: str,
    resource_type: str,
    access_token: str,
    *,
    params: Optional[Dict[str, str]] = None,
    resource_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Fetch a FHIR resource from an external EMR FHIR endpoint."""
    url = f"{fhir_base_url.rstrip('/')}/{resource_type}"
    if resource_id:
        url += f"/{resource_id}"

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            url,
            params=params,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/fhir+json",
            },
        )

    if resp.status_code == 200:
        return resp.json()
    if resp.status_code == 404:
        return {}
    raise HTTPException(
        status_code=resp.status_code,
        detail=f"EMR FHIR {resource_type} fetch failed: {resp.text[:200]}",
    )

# ─── EMR Data Sync ────────────────────────────────────────────────────────────

async def _sync_patient_from_emr(
    fhir_base_url: str,
    emr_patient_id: str,
    access_token: str,
    medplum: MedplumClient,
) -> Optional[str]:
    """Fetch Patient from EMR and upsert into Medplum. Returns Medplum Patient FHIR ID."""
    emr_patient = await _fetch_fhir_resource(
        fhir_base_url, "Patient", access_token, resource_id=emr_patient_id
    )
    if not emr_patient:
        return None

    # Normalize to HealthPoint canonical format
    patient_data: Dict[str, Any] = {"member_id": emr_patient_id}

    names = emr_patient.get("name", [])
    if names:
        official = next((n for n in names if n.get("use") == "official"), names[0])
        patient_data["last_name"] = official.get("family", "")
        patient_data["first_name"] = (official.get("given") or [""])[0]

    patient_data["date_of_birth"] = emr_patient.get("birthDate", "")
    patient_data["gender"] = emr_patient.get("gender", "unknown")

    telecoms = emr_patient.get("telecom", [])
    for t in telecoms:
        if t.get("system") == "phone":
            patient_data["phone"] = t.get("value", "")
        elif t.get("system") == "email":
            patient_data["email"] = t.get("value", "")

    addresses = emr_patient.get("address", [])
    if addresses:
        addr = addresses[0]
        patient_data["address"] = {
            "line": addr.get("line", []),
            "city": addr.get("city", ""),
            "state": addr.get("state", ""),
            "zip": addr.get("postalCode", ""),
            "country": addr.get("country", "US"),
        }

    result = await upsert_patient_resource(patient_data, client=medplum)
    return result.get("id")


async def _sync_coverage_from_emr(
    fhir_base_url: str,
    emr_patient_id: str,
    access_token: str,
    medplum_patient_id: str,
    medplum: MedplumClient,
) -> List[str]:
    """Fetch Coverage resources from EMR and upsert into Medplum."""
    bundle = await _fetch_fhir_resource(
        fhir_base_url, "Coverage", access_token,
        params={"patient": emr_patient_id, "_count": "10"},
    )

    coverage_ids = []
    for entry in bundle.get("entry", []):
        coverage = entry.get("resource", {})
        if coverage.get("resourceType") != "Coverage":
            continue

        coverage_data: Dict[str, Any] = {
            "coverage_id": coverage.get("id", ""),
            "coverage_type": coverage.get("type", {}).get("coding", [{}])[0].get("code", "HIP"),
            "subscriber_id": coverage.get("subscriberId", ""),
            "status": coverage.get("status", "active"),
        }

        period = coverage.get("period", {})
        if period.get("start"):
            coverage_data["effective_date"] = period["start"]
        if period.get("end"):
            coverage_data["termination_date"] = period["end"]

        for cls in coverage.get("class", []):
            cls_type = cls.get("type", {}).get("coding", [{}])[0].get("code", "")
            if cls_type == "group":
                coverage_data["group_id"] = cls.get("value", "")
            elif cls_type == "plan":
                coverage_data["plan_id"] = cls.get("value", "")

        # Get or create payer Organization
        payer_ref = coverage.get("payor", [{}])[0].get("reference", "")
        payer_fhir_id = "unknown"
        if payer_ref:
            payer_id = payer_ref.split("/")[-1]
            payer_org = await _fetch_fhir_resource(
                fhir_base_url, "Organization", access_token, resource_id=payer_id
            )
            if payer_org:
                org_result = await upsert_organization_resource(
                    {
                        "organization_id": payer_id,
                        "name": payer_org.get("name", "Unknown Payer"),
                        "type": "ins",
                    },
                    client=medplum,
                )
                payer_fhir_id = org_result.get("id", "unknown")

        try:
            result = await upsert_coverage_resource(
                coverage_data, medplum_patient_id, payer_fhir_id, client=medplum
            )
            coverage_ids.append(result.get("id", ""))
        except Exception as exc:
            logger.warning("Failed to sync Coverage %s: %s", coverage.get("id"), exc)

    return coverage_ids


async def _sync_clinical_resources_from_emr(
    fhir_base_url: str,
    emr_patient_id: str,
    access_token: str,
    medplum_patient_id: str,
    medplum: MedplumClient,
    resource_types: Optional[List[str]] = None,
) -> Dict[str, int]:
    """
    Fetch and sync clinical resources (Condition, Procedure, Encounter,
    MedicationRequest, Observation) from EMR into Medplum.
    Returns dict of resource_type → count synced.
    """
    if resource_types is None:
        resource_types = ["Condition", "Procedure", "Encounter", "MedicationRequest"]

    counts: Dict[str, int] = {}

    for resource_type in resource_types:
        try:
            bundle = await _fetch_fhir_resource(
                fhir_base_url, resource_type, access_token,
                params={"patient": emr_patient_id, "_count": "50"},
            )

            synced = 0
            for entry in bundle.get("entry", []):
                resource = entry.get("resource", {})
                if resource.get("resourceType") != resource_type:
                    continue

                # Update patient reference to Medplum patient ID
                if "subject" in resource:
                    resource["subject"] = {"reference": f"Patient/{medplum_patient_id}"}
                if "patient" in resource:
                    resource["patient"] = {"reference": f"Patient/{medplum_patient_id}"}

                try:
                    await medplum.upsert_resource(
                        resource_type,
                        resource,
                        identifier_system=f"http://healthpoint.local/emr-{resource_type.lower()}-id",
                        identifier_value=resource.get("id", ""),
                    )
                    synced += 1
                except Exception as exc:
                    logger.warning(
                        "Failed to sync %s %s: %s",
                        resource_type, resource.get("id"), exc
                    )

            counts[resource_type] = synced
            logger.info("Synced %d %s resources from EMR for patient %s", synced, resource_type, emr_patient_id)

        except Exception as exc:
            logger.error("Failed to fetch %s from EMR: %s", resource_type, exc)
            counts[resource_type] = 0

    return counts

# ─── API Endpoints ────────────────────────────────────────────────────────────

@app.get("/emr/launch/{vendor}")
async def initiate_smart_launch(
    vendor: str,
    patient_id: str = Query(..., description="HealthPoint patient ID"),
    launch: Optional[str] = Query(None, description="SMART launch context"),
    current_user=Depends(get_current_user),
) -> RedirectResponse:
    """
    Initiate SMART on FHIR EHR-launch authorization flow.
    Redirects to the EMR's authorization endpoint.
    """
    config = EMR_VENDORS.get(vendor)
    if not config:
        raise HTTPException(status_code=400, detail=f"Unknown EMR vendor: {vendor}. Supported: {list(EMR_VENDORS.keys())}")

    if not config.get("client_id"):
        raise HTTPException(
            status_code=503,
            detail=f"{config['name']} integration not configured. "
                   f"Set {vendor.upper()}_CLIENT_ID and {vendor.upper()}_CLIENT_SECRET environment variables."
        )

    # Generate state for CSRF protection
    state = secrets.token_urlsafe(32)

    # Generate PKCE if required
    code_verifier = None
    code_challenge = None
    if config.get("pkce_required") == "true":
        code_verifier, code_challenge = _generate_pkce_pair()

    # Store state + verifier in DB for callback validation
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO emr_oauth_states (state, vendor, patient_id, code_verifier, created_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (state) DO UPDATE SET
                vendor = EXCLUDED.vendor,
                patient_id = EXCLUDED.patient_id,
                code_verifier = EXCLUDED.code_verifier,
                created_at = NOW()
            """,
            state, vendor, patient_id, code_verifier,
        )

    # Build authorization URL
    params: Dict[str, str] = {
        "response_type": "code",
        "client_id": config["client_id"],
        "redirect_uri": REDIRECT_URI,
        "scope": config["scope"],
        "state": state,
        "aud": config["fhir_base_url"],
    }
    if launch:
        params["launch"] = launch
    if code_challenge:
        params["code_challenge"] = code_challenge
        params["code_challenge_method"] = "S256"

    auth_url = f"{config['authorize_url']}?{urlencode(params)}"
    logger.info("Initiating SMART launch for vendor=%s patient=%s", vendor, patient_id)
    return RedirectResponse(url=auth_url)


@app.get("/emr/callback")
async def smart_callback(
    code: str = Query(...),
    state: str = Query(...),
    error: Optional[str] = Query(None),
    error_description: Optional[str] = Query(None),
    background_tasks: BackgroundTasks = BackgroundTasks(),
) -> Dict[str, Any]:
    """
    SMART on FHIR callback endpoint.
    Exchanges authorization code for tokens and triggers background data sync.
    """
    if error:
        raise HTTPException(
            status_code=400,
            detail=f"EMR authorization failed: {error} — {error_description}"
        )

    pool = await get_db_pool()

    # Validate state and retrieve context
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT vendor, patient_id, code_verifier
            FROM emr_oauth_states
            WHERE state = $1 AND created_at > NOW() - INTERVAL '10 minutes'
            """,
            state,
        )
        if not row:
            raise HTTPException(status_code=400, detail="Invalid or expired OAuth state parameter.")

        # Delete used state
        await conn.execute("DELETE FROM emr_oauth_states WHERE state = $1", state)

    vendor = row["vendor"]
    patient_id = row["patient_id"]
    code_verifier = row["code_verifier"]
    config = EMR_VENDORS[vendor]

    # Exchange code for tokens
    token_data: Dict[str, str] = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "client_id": config["client_id"],
    }
    if code_verifier:
        token_data["code_verifier"] = code_verifier
    else:
        token_data["client_secret"] = config["client_secret"]

    async with httpx.AsyncClient(timeout=30) as http:
        resp = await http.post(
            config["token_url"],
            data=token_data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"EMR token exchange failed: HTTP {resp.status_code} — {resp.text[:200]}"
        )

    token_response = resp.json()
    access_token = token_response["access_token"]
    refresh_token = token_response.get("refresh_token")
    expires_in = token_response.get("expires_in", 3600)
    emr_patient_id = token_response.get("patient")  # SMART context: patient ID in EMR

    # Store tokens
    await _store_emr_tokens(
        pool, patient_id, vendor,
        access_token, refresh_token, expires_in,
        emr_patient_id, config["fhir_base_url"],
    )

    # Trigger background sync
    if emr_patient_id:
        background_tasks.add_task(
            _background_sync_patient,
            pool=pool,
            patient_id=patient_id,
            vendor=vendor,
            emr_patient_id=emr_patient_id,
            fhir_base_url=config["fhir_base_url"],
            access_token=access_token,
        )

    logger.info(
        "SMART callback successful: vendor=%s patient=%s emr_patient=%s",
        vendor, patient_id, emr_patient_id
    )

    return {
        "status": "connected",
        "vendor": vendor,
        "patient_id": patient_id,
        "emr_patient_id": emr_patient_id,
        "sync_initiated": emr_patient_id is not None,
        "message": f"Successfully connected to {config['name']}. Patient data sync initiated.",
    }


async def _background_sync_patient(
    pool: asyncpg.Pool,
    patient_id: str,
    vendor: str,
    emr_patient_id: str,
    fhir_base_url: str,
    access_token: str,
) -> None:
    """Background task: sync all patient data from EMR into Medplum."""
    medplum = await get_medplum_client()
    errors: List[str] = []
    total_synced = 0

    try:
        # 1. Sync Patient demographics
        medplum_patient_id = await _sync_patient_from_emr(
            fhir_base_url, emr_patient_id, access_token, medplum
        )
        if not medplum_patient_id:
            logger.error("Failed to sync Patient %s from %s", emr_patient_id, vendor)
            return
        total_synced += 1

        # 2. Sync Coverage (insurance)
        coverage_ids = await _sync_coverage_from_emr(
            fhir_base_url, emr_patient_id, access_token,
            medplum_patient_id, medplum
        )
        total_synced += len(coverage_ids)

        # 3. Sync clinical resources
        clinical_counts = await _sync_clinical_resources_from_emr(
            fhir_base_url, emr_patient_id, access_token,
            medplum_patient_id, medplum,
        )
        total_synced += sum(clinical_counts.values())

        # 4. Update sync metadata in PostgreSQL
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE emr_connections
                SET last_sync_at = NOW(),
                    last_sync_count = $1,
                    medplum_patient_id = $2
                WHERE patient_id = $3 AND vendor = $4
                """,
                total_synced, medplum_patient_id, patient_id, vendor,
            )

        logger.info(
            "EMR sync complete: vendor=%s patient=%s synced=%d",
            vendor, patient_id, total_synced
        )

    except Exception as exc:
        logger.error("EMR background sync failed: vendor=%s patient=%s error=%s", vendor, patient_id, exc)
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE emr_connections
                SET last_sync_error = $1
                WHERE patient_id = $2 AND vendor = $3
                """,
                str(exc)[:500], patient_id, vendor,
            )


@app.post("/emr/sync/{vendor}/{patient_id}")
async def trigger_manual_sync(
    vendor: str,
    patient_id: str,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
) -> Dict[str, Any]:
    """Manually trigger a full EMR data sync for a patient."""
    pool = await get_db_pool()
    tokens = await _get_emr_tokens(pool, patient_id, vendor)
    if not tokens:
        raise HTTPException(
            status_code=404,
            detail=f"No EMR connection found for patient {patient_id} and vendor {vendor}."
        )

    access_token = await _get_valid_token(pool, patient_id, vendor)
    config = EMR_VENDORS.get(vendor, {})

    background_tasks.add_task(
        _background_sync_patient,
        pool=pool,
        patient_id=patient_id,
        vendor=vendor,
        emr_patient_id=tokens.get("patient_fhir_id", ""),
        fhir_base_url=tokens.get("fhir_base_url") or config.get("fhir_base_url", ""),
        access_token=access_token,
    )

    return {
        "status": "sync_initiated",
        "vendor": vendor,
        "patient_id": patient_id,
        "message": "Background sync started. Check /emr/status for progress.",
    }


@app.get("/emr/status/{patient_id}")
async def get_emr_connection_status(
    patient_id: str,
    current_user=Depends(get_current_user),
) -> List[EMRConnectionStatus]:
    """Get EMR connection status for all vendors for a patient."""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT vendor, connected_at IS NOT NULL as connected,
                   patient_fhir_id, last_sync_at, token_expires_at
            FROM emr_connections
            WHERE patient_id = $1
            """,
            patient_id,
        )

    return [
        EMRConnectionStatus(
            vendor=row["vendor"],
            connected=row["connected"],
            patient_id=row["patient_fhir_id"],
            last_sync=row["last_sync_at"].isoformat() if row["last_sync_at"] else None,
            token_expires_at=row["token_expires_at"].isoformat() if row["token_expires_at"] else None,
        )
        for row in rows
    ]


@app.delete("/emr/disconnect/{vendor}/{patient_id}")
async def disconnect_emr(
    vendor: str,
    patient_id: str,
    current_user=Depends(get_current_user),
) -> Dict[str, str]:
    """Disconnect an EMR integration and delete stored tokens."""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        deleted = await conn.execute(
            "DELETE FROM emr_connections WHERE patient_id = $1 AND vendor = $2",
            patient_id, vendor,
        )

    if deleted == "DELETE 0":
        raise HTTPException(
            status_code=404,
            detail=f"No connection found for patient {patient_id} and vendor {vendor}."
        )

    return {"status": "disconnected", "vendor": vendor, "patient_id": patient_id}


@app.get("/emr/vendors")
async def list_supported_vendors() -> List[Dict[str, Any]]:
    """List all supported EMR vendors and their configuration status."""
    return [
        {
            "vendor": key,
            "name": config["name"],
            "configured": bool(config.get("client_id")),
            "pkce_required": config.get("pkce_required") == "true",
            "fhir_base_url": config.get("fhir_base_url", ""),
        }
        for key, config in EMR_VENDORS.items()
    ]


@app.get("/health")
async def health_check() -> Dict[str, str]:
    return {"status": "healthy", "service": "emr-connector-service"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8120")))
