"""
HealthPoint EMR Onboarding Service
====================================
Self-service onboarding for any FHIR R4-compliant EMR system.

Onboarding state machine:
  PENDING → CAPABILITY_DISCOVERY → CREDENTIAL_ENTRY → CONNECTION_TEST
  → SCOPE_CONFIGURATION → SYNC_CONFIGURATION → VALIDATION → ACTIVE
  (or FAILED at any step)

Supports:
  - Known vendors: Epic, Cerner, Allscripts, eClinicalWorks, Athenahealth,
    NextGen, Greenway, MEDITECH, Veradigm, DrChrono, Canvas Medical,
    Health Gorilla, CommonWell, Carequality
  - Generic FHIR R4: any SMART on FHIR compliant endpoint
  - Backend Services (system-level, no patient consent required)
  - EHR Launch (patient context from within the EMR)
  - Standalone Launch (patient-initiated)
"""

import asyncio
import hashlib
import json
import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional

import asyncpg
import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, HttpUrl, validator

from backend.shared.auth import get_current_user
from backend.shared.database import get_db_pool
from backend.shared.secrets import get_secret
from backend.shared.telemetry import setup_telemetry, instrument_fastapi
from backend.shared.security_middleware import add_security_middleware

logger = logging.getLogger(__name__)

app = FastAPI(
    title="HealthPoint EMR Onboarding Service",
    version="1.0.0",
    description="Self-service onboarding for any FHIR R4-compliant EMR",
)

setup_telemetry("emr-onboarding-service")
instrument_fastapi(app)
add_security_middleware(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("ALLOWED_ORIGINS", "https://app.healthpoint.io")],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)

# ── Onboarding State Machine ──────────────────────────────────────────────────

class OnboardingStatus(str, Enum):
    PENDING = "pending"
    CAPABILITY_DISCOVERY = "capability_discovery"
    CREDENTIAL_ENTRY = "credential_entry"
    CONNECTION_TEST = "connection_test"
    SCOPE_CONFIGURATION = "scope_configuration"
    SYNC_CONFIGURATION = "sync_configuration"
    VALIDATION = "validation"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    FAILED = "failed"

class AuthType(str, Enum):
    SMART_EHR_LAUNCH = "smart_ehr_launch"
    SMART_STANDALONE = "smart_standalone"
    BACKEND_SERVICES = "backend_services"   # system-level, no user consent
    BASIC_AUTH = "basic_auth"               # legacy systems only
    API_KEY = "api_key"                     # some proprietary systems

# ── Known Vendor Registry ─────────────────────────────────────────────────────

KNOWN_VENDORS: Dict[str, Dict[str, Any]] = {
    "epic": {
        "display_name": "Epic MyChart / Epic Systems",
        "logo_url": "https://app.healthpoint.io/assets/emr-logos/epic.png",
        "fhir_version": "R4",
        "auth_types": [AuthType.SMART_EHR_LAUNCH, AuthType.SMART_STANDALONE, AuthType.BACKEND_SERVICES],
        "token_endpoint_auth_method": "private_key_jwt",
        "pkce_required": True,
        "sandbox_fhir_base": "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
        "sandbox_auth_url": "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize",
        "sandbox_token_url": "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token",
        "registration_url": "https://appmarket.epic.com/Gallery",
        "documentation_url": "https://fhir.epic.com/Documentation",
        "required_scopes": ["launch", "openid", "fhirUser", "patient/Patient.read", "patient/Coverage.read"],
        "supported_resources": ["Patient", "Coverage", "Encounter", "Condition", "Procedure", "MedicationRequest", "Observation", "DiagnosticReport"],
        "notes": "Requires App Orchard registration and Epic review (2-4 weeks). Use private_key_jwt — no client_secret.",
    },
    "cerner": {
        "display_name": "Cerner Millennium (Oracle Health)",
        "logo_url": "https://app.healthpoint.io/assets/emr-logos/cerner.png",
        "fhir_version": "R4",
        "auth_types": [AuthType.SMART_EHR_LAUNCH, AuthType.SMART_STANDALONE],
        "token_endpoint_auth_method": "client_secret_basic",
        "pkce_required": False,
        "sandbox_fhir_base": "https://fhir-myrecord.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d",
        "sandbox_auth_url": "https://authorization.cerner.com/tenants/ec2458f2-1e24-41c8-b71b-0e701af7583d/protocols/oauth2/profiles/smart-v1/personas/provider/authorize",
        "sandbox_token_url": "https://authorization.cerner.com/tenants/ec2458f2-1e24-41c8-b71b-0e701af7583d/protocols/oauth2/profiles/smart-v1/personas/provider/token",
        "registration_url": "https://code.cerner.com/developer/smart-on-fhir/apps",
        "documentation_url": "https://docs.oracle.com/en/industries/health/millennium-platform-apis/",
        "required_scopes": ["launch", "openid", "fhirUser", "patient/Patient.read", "patient/Coverage.read"],
        "supported_resources": ["Patient", "Coverage", "Encounter", "Condition", "Procedure", "Observation"],
        "notes": "Each Cerner customer has a unique tenant ID in the FHIR base URL. Obtain from the health system IT team.",
    },
    "athenahealth": {
        "display_name": "Athenahealth",
        "logo_url": "https://app.healthpoint.io/assets/emr-logos/athenahealth.png",
        "fhir_version": "R4",
        "auth_types": [AuthType.SMART_EHR_LAUNCH, AuthType.SMART_STANDALONE],
        "token_endpoint_auth_method": "client_secret_post",
        "pkce_required": True,
        "sandbox_fhir_base": "https://api.preview.platform.athenahealth.com/fhir/r4",
        "sandbox_auth_url": "https://api.preview.platform.athenahealth.com/oauth2/v1/authorize",
        "sandbox_token_url": "https://api.preview.platform.athenahealth.com/oauth2/v1/token",
        "registration_url": "https://developer.athenahealth.com/",
        "documentation_url": "https://docs.athenahealth.com/api/",
        "required_scopes": ["launch", "openid", "patient/Patient.read", "patient/Coverage.read"],
        "supported_resources": ["Patient", "Coverage", "Encounter", "Condition", "Procedure"],
        "notes": "Register at Athena Developer Portal. Sandbox uses preview environment.",
    },
    "allscripts": {
        "display_name": "Allscripts / Veradigm",
        "logo_url": "https://app.healthpoint.io/assets/emr-logos/allscripts.png",
        "fhir_version": "R4",
        "auth_types": [AuthType.SMART_EHR_LAUNCH, AuthType.SMART_STANDALONE],
        "token_endpoint_auth_method": "client_secret_basic",
        "pkce_required": False,
        "sandbox_fhir_base": "https://tw171.open.allscripts.com/FHIR/R4",
        "sandbox_auth_url": "https://tw171.open.allscripts.com/Authorization/connect/authorize",
        "sandbox_token_url": "https://tw171.open.allscripts.com/Authorization/connect/token",
        "registration_url": "https://developer.allscripts.com/",
        "documentation_url": "https://developer.allscripts.com/content/fhir/",
        "required_scopes": ["launch", "openid", "patient/Patient.read"],
        "supported_resources": ["Patient", "Coverage", "Encounter"],
        "notes": "Allscripts is now Veradigm. Use the Veradigm developer portal for new registrations.",
    },
    "eclinicalworks": {
        "display_name": "eClinicalWorks",
        "logo_url": "https://app.healthpoint.io/assets/emr-logos/ecw.png",
        "fhir_version": "R4",
        "auth_types": [AuthType.SMART_EHR_LAUNCH, AuthType.SMART_STANDALONE],
        "token_endpoint_auth_method": "client_secret_basic",
        "pkce_required": True,
        "sandbox_fhir_base": "https://fhirapi.eclinicalworks.com/fhirapi/fhir/r4",
        "sandbox_auth_url": "https://fhirapi.eclinicalworks.com/oauth2/authorize",
        "sandbox_token_url": "https://fhirapi.eclinicalworks.com/oauth2/token",
        "registration_url": "https://fhir.eclinicalworks.com/",
        "documentation_url": "https://fhir.eclinicalworks.com/ecwopendev/",
        "required_scopes": ["launch", "openid", "patient/Patient.read", "patient/Coverage.read"],
        "supported_resources": ["Patient", "Coverage", "Encounter", "Condition"],
        "notes": "eCW requires a signed data sharing agreement before sandbox access is granted.",
    },
    "nextgen": {
        "display_name": "NextGen Healthcare",
        "logo_url": "https://app.healthpoint.io/assets/emr-logos/nextgen.png",
        "fhir_version": "R4",
        "auth_types": [AuthType.SMART_EHR_LAUNCH, AuthType.SMART_STANDALONE],
        "token_endpoint_auth_method": "client_secret_basic",
        "pkce_required": False,
        "sandbox_fhir_base": "https://fhir.nextgen.com/nge/prod/fhir-api-r4/fhir/r4",
        "sandbox_auth_url": "https://nativeapi.nextgen.com/nge/prod/nge-oauth/authorize",
        "sandbox_token_url": "https://nativeapi.nextgen.com/nge/prod/nge-oauth/token",
        "registration_url": "https://developer.nextgen.com/",
        "documentation_url": "https://developer.nextgen.com/docs/",
        "required_scopes": ["launch", "openid", "patient/Patient.read"],
        "supported_resources": ["Patient", "Coverage", "Encounter", "Condition"],
        "notes": "NextGen uses a single production endpoint; tenant is identified by credentials.",
    },
    "meditech": {
        "display_name": "MEDITECH Expanse",
        "logo_url": "https://app.healthpoint.io/assets/emr-logos/meditech.png",
        "fhir_version": "R4",
        "auth_types": [AuthType.SMART_EHR_LAUNCH, AuthType.BACKEND_SERVICES],
        "token_endpoint_auth_method": "client_secret_basic",
        "pkce_required": False,
        "sandbox_fhir_base": "https://fhir.meditech.com/api/fhir/r4",
        "sandbox_auth_url": "https://fhir.meditech.com/oauth2/authorize",
        "sandbox_token_url": "https://fhir.meditech.com/oauth2/token",
        "registration_url": "https://ehr.meditech.com/meditech-greenfield-developer-program",
        "documentation_url": "https://ehr.meditech.com/greenfield-developer-program",
        "required_scopes": ["launch", "openid", "patient/Patient.read"],
        "supported_resources": ["Patient", "Coverage", "Encounter"],
        "notes": "MEDITECH Greenfield Developer Program required. Contact MEDITECH for sandbox access.",
    },
    "canvas": {
        "display_name": "Canvas Medical",
        "logo_url": "https://app.healthpoint.io/assets/emr-logos/canvas.png",
        "fhir_version": "R4",
        "auth_types": [AuthType.BACKEND_SERVICES, AuthType.SMART_STANDALONE],
        "token_endpoint_auth_method": "client_secret_post",
        "pkce_required": True,
        "sandbox_fhir_base": "https://fumage-example.canvasmedical.com",
        "sandbox_auth_url": "https://fumage-example.canvasmedical.com/auth/o/authorize/",
        "sandbox_token_url": "https://fumage-example.canvasmedical.com/auth/o/token/",
        "registration_url": "https://www.canvasmedical.com/developers",
        "documentation_url": "https://docs.canvasmedical.com/",
        "required_scopes": ["patient/Patient.read", "patient/Coverage.read"],
        "supported_resources": ["Patient", "Coverage", "Encounter", "Condition", "Observation"],
        "notes": "Canvas is developer-friendly with fast sandbox access. Each customer has a subdomain.",
    },
    "generic_fhir_r4": {
        "display_name": "Generic FHIR R4 (Custom)",
        "logo_url": "https://app.healthpoint.io/assets/emr-logos/fhir.png",
        "fhir_version": "R4",
        "auth_types": [AuthType.SMART_EHR_LAUNCH, AuthType.SMART_STANDALONE, AuthType.BACKEND_SERVICES, AuthType.API_KEY],
        "token_endpoint_auth_method": "client_secret_basic",
        "pkce_required": False,
        "sandbox_fhir_base": None,
        "sandbox_auth_url": None,
        "sandbox_token_url": None,
        "registration_url": None,
        "documentation_url": "https://hl7.org/fhir/R4/",
        "required_scopes": ["patient/Patient.read"],
        "supported_resources": [],  # discovered via CapabilityStatement
        "notes": "Auto-discovers capabilities from the FHIR CapabilityStatement. Provide the FHIR base URL and credentials.",
    },
}

# ── Pydantic Models ───────────────────────────────────────────────────────────

class StartOnboardingRequest(BaseModel):
    vendor_key: str  # key from KNOWN_VENDORS or "generic_fhir_r4"
    tenant_name: str  # e.g. "Memorial Hospital System"
    tenant_fhir_base_url: Optional[str] = None  # required for generic; optional for known vendors (uses sandbox default)
    environment: str = "sandbox"  # "sandbox" or "production"
    auth_type: Optional[AuthType] = None  # defaults to vendor's first supported auth_type
    contact_email: str
    contact_name: str

    @validator("vendor_key")
    def validate_vendor(cls, v: str) -> str:
        if v not in KNOWN_VENDORS:
            raise ValueError(f"Unknown vendor '{v}'. Use GET /emr/onboarding/vendors to list supported vendors.")
        return v

    @validator("environment")
    def validate_env(cls, v: str) -> str:
        if v not in ("sandbox", "production"):
            raise ValueError("environment must be 'sandbox' or 'production'")
        return v

class SubmitCredentialsRequest(BaseModel):
    onboarding_id: str
    client_id: str
    client_secret: Optional[str] = None   # not required for private_key_jwt
    private_key_pem: Optional[str] = None  # for Epic private_key_jwt
    api_key: Optional[str] = None          # for api_key auth type
    fhir_base_url: Optional[str] = None   # override if different from discovered
    auth_url: Optional[str] = None
    token_url: Optional[str] = None
    additional_scopes: Optional[List[str]] = None

class ConfigureScopesRequest(BaseModel):
    onboarding_id: str
    scopes: List[str]
    sync_resources: List[str]  # e.g. ["Patient", "Coverage", "Encounter"]
    sync_frequency_hours: int = 24  # how often to background-sync
    sync_lookback_days: int = 365   # how far back to pull historical data
    patient_matching_enabled: bool = True
    auto_create_fhir_resources: bool = True  # auto-upsert to Medplum

class ValidateConnectionRequest(BaseModel):
    onboarding_id: str

# ── Database Helpers ──────────────────────────────────────────────────────────

async def _create_onboarding_tables(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS emr_onboarding_sessions (
                id                      VARCHAR(64) PRIMARY KEY,
                vendor_key              VARCHAR(64) NOT NULL,
                tenant_name             VARCHAR(256) NOT NULL,
                tenant_fhir_base_url    TEXT,
                environment             VARCHAR(16) NOT NULL DEFAULT 'sandbox',
                auth_type               VARCHAR(32),
                status                  VARCHAR(32) NOT NULL DEFAULT 'pending',
                contact_email           VARCHAR(320) NOT NULL,
                contact_name            VARCHAR(256) NOT NULL,
                -- credentials (encrypted at rest via PostgreSQL pgcrypto)
                client_id               TEXT,
                client_secret_encrypted TEXT,  -- AES-256 encrypted
                private_key_encrypted   TEXT,  -- AES-256 encrypted
                api_key_encrypted       TEXT,  -- AES-256 encrypted
                -- discovered configuration
                capability_statement    JSONB,
                discovered_auth_url     TEXT,
                discovered_token_url    TEXT,
                discovered_scopes       JSONB,
                discovered_resources    JSONB,
                -- configured settings
                configured_scopes       JSONB,
                sync_resources          JSONB,
                sync_frequency_hours    INTEGER DEFAULT 24,
                sync_lookback_days      INTEGER DEFAULT 365,
                patient_matching_enabled BOOLEAN DEFAULT TRUE,
                auto_create_fhir_resources BOOLEAN DEFAULT TRUE,
                -- test results
                last_test_at            TIMESTAMP WITH TIME ZONE,
                last_test_status        VARCHAR(32),
                last_test_error         TEXT,
                last_test_patient_count INTEGER,
                -- lifecycle
                activated_at            TIMESTAMP WITH TIME ZONE,
                failed_at               TIMESTAMP WITH TIME ZONE,
                failure_reason          TEXT,
                created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS emr_onboarding_events (
                id              BIGSERIAL PRIMARY KEY,
                onboarding_id   VARCHAR(64) NOT NULL REFERENCES emr_onboarding_sessions(id),
                event_type      VARCHAR(64) NOT NULL,
                from_status     VARCHAR(32),
                to_status       VARCHAR(32),
                details         JSONB,
                created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS emr_tenant_registrations (
                id                  VARCHAR(64) PRIMARY KEY,
                onboarding_id       VARCHAR(64) NOT NULL REFERENCES emr_onboarding_sessions(id),
                vendor_key          VARCHAR(64) NOT NULL,
                tenant_name         VARCHAR(256) NOT NULL,
                fhir_base_url       TEXT NOT NULL,
                environment         VARCHAR(16) NOT NULL,
                auth_type           VARCHAR(32) NOT NULL,
                client_id           TEXT NOT NULL,
                configured_scopes   JSONB NOT NULL,
                sync_resources      JSONB NOT NULL,
                sync_frequency_hours INTEGER NOT NULL DEFAULT 24,
                sync_lookback_days  INTEGER NOT NULL DEFAULT 365,
                patient_matching_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                is_active           BOOLEAN NOT NULL DEFAULT TRUE,
                activated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                last_sync_at        TIMESTAMP WITH TIME ZONE,
                total_patients_synced INTEGER DEFAULT 0,
                created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_emr_onboarding_status ON emr_onboarding_sessions(status);
            CREATE INDEX IF NOT EXISTS idx_emr_onboarding_vendor ON emr_onboarding_sessions(vendor_key);
            CREATE INDEX IF NOT EXISTS idx_emr_tenant_vendor ON emr_tenant_registrations(vendor_key);
            CREATE INDEX IF NOT EXISTS idx_emr_tenant_active ON emr_tenant_registrations(is_active);
        """)

async def _log_event(
    pool: asyncpg.Pool,
    onboarding_id: str,
    event_type: str,
    from_status: Optional[str],
    to_status: Optional[str],
    details: Optional[Dict] = None,
) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO emr_onboarding_events
               (onboarding_id, event_type, from_status, to_status, details)
               VALUES ($1, $2, $3, $4, $5)""",
            onboarding_id, event_type, from_status, to_status,
            json.dumps(details or {}),
        )

async def _update_status(
    pool: asyncpg.Pool,
    onboarding_id: str,
    new_status: OnboardingStatus,
    extra_fields: Optional[Dict[str, Any]] = None,
) -> None:
    set_clauses = ["status=$2", "updated_at=NOW()"]
    params: List[Any] = [onboarding_id, new_status.value]
    if extra_fields:
        for i, (k, v) in enumerate(extra_fields.items(), start=3):
            set_clauses.append(f"{k}=${i}")
            params.append(v)
    async with pool.acquire() as conn:
        await conn.execute(
            f"UPDATE emr_onboarding_sessions SET {', '.join(set_clauses)} WHERE id=$1",
            *params,
        )

# ── FHIR Capability Discovery ─────────────────────────────────────────────────

async def _discover_capabilities(
    fhir_base_url: str,
    client_id: Optional[str] = None,
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Fetch and parse the FHIR CapabilityStatement and SMART configuration.
    Returns discovered auth URLs, scopes, and supported resources.
    """
    headers: Dict[str, str] = {"Accept": "application/fhir+json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    base = fhir_base_url.rstrip("/")
    result: Dict[str, Any] = {
        "fhir_base_url": base,
        "fhir_version": None,
        "auth_url": None,
        "token_url": None,
        "token_endpoint_auth_methods": [],
        "scopes_supported": [],
        "supported_resources": [],
        "smart_capabilities": [],
        "errors": [],
    }

    async with httpx.AsyncClient(timeout=30.0, verify=True) as client:
        # 1. Fetch SMART configuration from well-known endpoint
        for smart_path in [
            "/.well-known/smart-configuration",
            "/metadata",
        ]:
            try:
                url = base + smart_path if smart_path.startswith("/") else f"{base}/{smart_path}"
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    if smart_path == "/.well-known/smart-configuration":
                        result["auth_url"] = data.get("authorization_endpoint")
                        result["token_url"] = data.get("token_endpoint")
                        result["scopes_supported"] = data.get("scopes_supported", [])
                        result["smart_capabilities"] = data.get("capabilities", [])
                        result["token_endpoint_auth_methods"] = data.get(
                            "token_endpoint_auth_methods_supported", ["client_secret_basic"]
                        )
                    elif smart_path == "/metadata":
                        # Parse CapabilityStatement
                        result["fhir_version"] = data.get("fhirVersion", "4.0.1")
                        # Extract SMART auth from security extension
                        rest = data.get("rest", [{}])[0]
                        security = rest.get("security", {})
                        for ext in security.get("extension", []):
                            if "smart-on-fhir" in ext.get("url", ""):
                                for inner in ext.get("extension", []):
                                    if inner.get("url") == "authorize":
                                        result["auth_url"] = result["auth_url"] or inner.get("valueUri")
                                    elif inner.get("url") == "token":
                                        result["token_url"] = result["token_url"] or inner.get("valueUri")
                        # Extract supported resources
                        for resource in rest.get("resource", []):
                            rtype = resource.get("type")
                            if rtype:
                                interactions = [i.get("code") for i in resource.get("interaction", [])]
                                result["supported_resources"].append({
                                    "type": rtype,
                                    "interactions": interactions,
                                    "searchParams": [
                                        sp.get("name") for sp in resource.get("searchParam", [])
                                    ],
                                })
            except Exception as e:
                result["errors"].append(f"{smart_path}: {str(e)}")

    return result

# ── API Endpoints ─────────────────────────────────────────────────────────────

@app.get("/emr/onboarding/vendors")
async def list_vendors() -> Dict[str, Any]:
    """List all supported EMR vendors with their capabilities and registration requirements."""
    vendors = []
    for key, info in KNOWN_VENDORS.items():
        vendors.append({
            "key": key,
            "display_name": info["display_name"],
            "logo_url": info["logo_url"],
            "fhir_version": info["fhir_version"],
            "auth_types": [a.value for a in info["auth_types"]],
            "pkce_required": info["pkce_required"],
            "registration_url": info.get("registration_url"),
            "documentation_url": info.get("documentation_url"),
            "required_scopes": info["required_scopes"],
            "supported_resources": info["supported_resources"],
            "notes": info.get("notes"),
            "has_sandbox": info.get("sandbox_fhir_base") is not None,
        })
    return {"vendors": vendors, "total": len(vendors)}

@app.post("/emr/onboarding/start")
async def start_onboarding(
    req: StartOnboardingRequest,
    background_tasks: BackgroundTasks,
    user: Dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Start the EMR onboarding process for a new vendor/tenant.
    Returns an onboarding_id to track progress through the state machine.
    """
    pool = await get_db_pool()
    await _create_onboarding_tables(pool)

    vendor = KNOWN_VENDORS[req.vendor_key]
    onboarding_id = str(uuid.uuid4())

    # Determine FHIR base URL
    if req.tenant_fhir_base_url:
        fhir_base = req.tenant_fhir_base_url
    elif req.environment == "sandbox" and vendor.get("sandbox_fhir_base"):
        fhir_base = vendor["sandbox_fhir_base"]
    else:
        fhir_base = None  # will be set during capability discovery

    # Default auth type to first supported
    auth_type = req.auth_type or vendor["auth_types"][0]

    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO emr_onboarding_sessions
               (id, vendor_key, tenant_name, tenant_fhir_base_url, environment,
                auth_type, status, contact_email, contact_name)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
            onboarding_id, req.vendor_key, req.tenant_name, fhir_base,
            req.environment, auth_type.value, OnboardingStatus.PENDING.value,
            req.contact_email, req.contact_name,
        )

    await _log_event(pool, onboarding_id, "onboarding_started", None, OnboardingStatus.PENDING.value, {
        "vendor": req.vendor_key, "environment": req.environment, "initiated_by": user.get("sub"),
    })

    # Kick off capability discovery in background if FHIR base URL is known
    if fhir_base:
        background_tasks.add_task(_run_capability_discovery, pool, onboarding_id, fhir_base)

    return {
        "onboarding_id": onboarding_id,
        "status": OnboardingStatus.PENDING.value,
        "vendor": {
            "key": req.vendor_key,
            "display_name": vendor["display_name"],
            "registration_url": vendor.get("registration_url"),
            "documentation_url": vendor.get("documentation_url"),
            "notes": vendor.get("notes"),
        },
        "next_step": "capability_discovery" if fhir_base else "provide_fhir_base_url",
        "next_step_instructions": (
            "Capability discovery is running in the background. "
            "Poll GET /emr/onboarding/{onboarding_id}/status to track progress."
        ) if fhir_base else (
            "Provide the FHIR base URL for this tenant via "
            "POST /emr/onboarding/{onboarding_id}/discover"
        ),
    }

async def _run_capability_discovery(
    pool: asyncpg.Pool,
    onboarding_id: str,
    fhir_base_url: str,
) -> None:
    """Background task: discover FHIR capabilities and update onboarding session."""
    await _update_status(pool, onboarding_id, OnboardingStatus.CAPABILITY_DISCOVERY)
    await _log_event(pool, onboarding_id, "capability_discovery_started",
                     OnboardingStatus.PENDING.value, OnboardingStatus.CAPABILITY_DISCOVERY.value)
    try:
        capabilities = await _discover_capabilities(fhir_base_url)
        async with pool.acquire() as conn:
            await conn.execute(
                """UPDATE emr_onboarding_sessions SET
                   status=$2, capability_statement=$3,
                   discovered_auth_url=$4, discovered_token_url=$5,
                   discovered_scopes=$6, discovered_resources=$7,
                   updated_at=NOW()
                   WHERE id=$1""",
                onboarding_id,
                OnboardingStatus.CREDENTIAL_ENTRY.value,
                json.dumps(capabilities),
                capabilities.get("auth_url"),
                capabilities.get("token_url"),
                json.dumps(capabilities.get("scopes_supported", [])),
                json.dumps(capabilities.get("supported_resources", [])),
            )
        await _log_event(pool, onboarding_id, "capability_discovery_complete",
                         OnboardingStatus.CAPABILITY_DISCOVERY.value,
                         OnboardingStatus.CREDENTIAL_ENTRY.value,
                         {"resources_found": len(capabilities.get("supported_resources", []))})
    except Exception as e:
        await _update_status(pool, onboarding_id, OnboardingStatus.FAILED, {
            "failure_reason": f"Capability discovery failed: {str(e)}",
            "failed_at": datetime.utcnow().isoformat(),
        })
        await _log_event(pool, onboarding_id, "capability_discovery_failed",
                         OnboardingStatus.CAPABILITY_DISCOVERY.value,
                         OnboardingStatus.FAILED.value, {"error": str(e)})

@app.post("/emr/onboarding/{onboarding_id}/discover")
async def trigger_capability_discovery(
    onboarding_id: str,
    fhir_base_url: str,
    background_tasks: BackgroundTasks,
    user: Dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Manually trigger capability discovery with a provided FHIR base URL."""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        session = await conn.fetchrow(
            "SELECT * FROM emr_onboarding_sessions WHERE id=$1", onboarding_id
        )
    if not session:
        raise HTTPException(status_code=404, detail="Onboarding session not found")

    # Update FHIR base URL and trigger discovery
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE emr_onboarding_sessions SET tenant_fhir_base_url=$2, updated_at=NOW() WHERE id=$1",
            onboarding_id, fhir_base_url,
        )
    background_tasks.add_task(_run_capability_discovery, pool, onboarding_id, fhir_base_url)
    return {"onboarding_id": onboarding_id, "status": "capability_discovery_started"}

@app.post("/emr/onboarding/{onboarding_id}/credentials")
async def submit_credentials(
    onboarding_id: str,
    req: SubmitCredentialsRequest,
    user: Dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Submit SMART on FHIR credentials for the EMR tenant.
    Credentials are AES-256 encrypted before storage.
    """
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        session = await conn.fetchrow(
            "SELECT * FROM emr_onboarding_sessions WHERE id=$1", onboarding_id
        )
    if not session:
        raise HTTPException(status_code=404, detail="Onboarding session not found")
    if session["status"] not in (
        OnboardingStatus.CREDENTIAL_ENTRY.value,
        OnboardingStatus.CONNECTION_TEST.value,
    ):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot submit credentials in status '{session['status']}'. "
                   "Session must be in 'credential_entry' status.",
        )

    # Encrypt secrets using pgcrypto (AES-256)
    encryption_key = await get_secret("CREDENTIAL_ENCRYPTION_KEY")
    async with pool.acquire() as conn:
        # Encrypt client_secret if provided
        client_secret_encrypted = None
        if req.client_secret:
            row = await conn.fetchrow(
                "SELECT pgp_sym_encrypt($1, $2) AS enc",
                req.client_secret, encryption_key,
            )
            client_secret_encrypted = row["enc"].hex() if row else None

        # Encrypt private key if provided
        private_key_encrypted = None
        if req.private_key_pem:
            row = await conn.fetchrow(
                "SELECT pgp_sym_encrypt($1, $2) AS enc",
                req.private_key_pem, encryption_key,
            )
            private_key_encrypted = row["enc"].hex() if row else None

        # Encrypt API key if provided
        api_key_encrypted = None
        if req.api_key:
            row = await conn.fetchrow(
                "SELECT pgp_sym_encrypt($1, $2) AS enc",
                req.api_key, encryption_key,
            )
            api_key_encrypted = row["enc"].hex() if row else None

        await conn.execute(
            """UPDATE emr_onboarding_sessions SET
               client_id=$2, client_secret_encrypted=$3,
               private_key_encrypted=$4, api_key_encrypted=$5,
               discovered_auth_url=COALESCE($6, discovered_auth_url),
               discovered_token_url=COALESCE($7, discovered_token_url),
               tenant_fhir_base_url=COALESCE($8, tenant_fhir_base_url),
               status=$9, updated_at=NOW()
               WHERE id=$1""",
            onboarding_id, req.client_id,
            client_secret_encrypted, private_key_encrypted, api_key_encrypted,
            req.auth_url, req.token_url, req.fhir_base_url,
            OnboardingStatus.CONNECTION_TEST.value,
        )

    await _log_event(pool, onboarding_id, "credentials_submitted",
                     session["status"], OnboardingStatus.CONNECTION_TEST.value,
                     {"client_id": req.client_id, "has_secret": bool(req.client_secret),
                      "has_private_key": bool(req.private_key_pem)})

    return {
        "onboarding_id": onboarding_id,
        "status": OnboardingStatus.CONNECTION_TEST.value,
        "next_step": "Run POST /emr/onboarding/{onboarding_id}/test to validate the connection",
    }

@app.post("/emr/onboarding/{onboarding_id}/test")
async def test_connection(
    onboarding_id: str,
    user: Dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Test the EMR connection using the submitted credentials.
    Attempts a token exchange and a test Patient search.
    """
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        session = await conn.fetchrow(
            "SELECT * FROM emr_onboarding_sessions WHERE id=$1", onboarding_id
        )
    if not session:
        raise HTTPException(status_code=404, detail="Onboarding session not found")
    if not session["client_id"]:
        raise HTTPException(status_code=400, detail="Credentials not yet submitted. Use POST /credentials first.")

    vendor = KNOWN_VENDORS.get(session["vendor_key"], KNOWN_VENDORS["generic_fhir_r4"])
    fhir_base = session["tenant_fhir_base_url"]
    token_url = session["discovered_token_url"] or vendor.get("sandbox_token_url")

    test_result: Dict[str, Any] = {
        "onboarding_id": onboarding_id,
        "tested_at": datetime.utcnow().isoformat(),
        "token_exchange": False,
        "fhir_metadata": False,
        "patient_search": False,
        "patient_count": 0,
        "errors": [],
    }

    # Decrypt client_secret
    encryption_key = await get_secret("CREDENTIAL_ENCRYPTION_KEY")
    client_secret = None
    if session["client_secret_encrypted"]:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT pgp_sym_decrypt($1::bytea, $2) AS dec",
                bytes.fromhex(session["client_secret_encrypted"]), encryption_key,
            )
            client_secret = row["dec"] if row else None

    # Test 1: Token exchange (Backend Services / client_credentials)
    if session["auth_type"] == AuthType.BACKEND_SERVICES.value and token_url:
        try:
            async with httpx.AsyncClient(timeout=15.0) as http:
                resp = await http.post(token_url, data={
                    "grant_type": "client_credentials",
                    "client_id": session["client_id"],
                    "client_secret": client_secret or "",
                    "scope": " ".join(vendor["required_scopes"]),
                })
                if resp.status_code == 200:
                    test_result["token_exchange"] = True
                    access_token = resp.json().get("access_token")
                else:
                    test_result["errors"].append(f"Token exchange failed: HTTP {resp.status_code} — {resp.text[:200]}")
        except Exception as e:
            test_result["errors"].append(f"Token exchange error: {str(e)}")
    else:
        # For SMART launch flows, we can't do a full token exchange without user interaction
        # Instead, verify the auth endpoint is reachable
        auth_url = session["discovered_auth_url"] or vendor.get("sandbox_auth_url")
        if auth_url:
            try:
                async with httpx.AsyncClient(timeout=10.0) as http:
                    resp = await http.get(auth_url, follow_redirects=False)
                    # Auth endpoints return 302 redirect or 400 (missing params) — both mean it's alive
                    if resp.status_code in (200, 302, 400, 401):
                        test_result["token_exchange"] = True
                    else:
                        test_result["errors"].append(f"Auth endpoint returned HTTP {resp.status_code}")
            except Exception as e:
                test_result["errors"].append(f"Auth endpoint unreachable: {str(e)}")

    # Test 2: FHIR metadata endpoint
    if fhir_base:
        try:
            async with httpx.AsyncClient(timeout=15.0) as http:
                resp = await http.get(
                    f"{fhir_base.rstrip('/')}/metadata",
                    headers={"Accept": "application/fhir+json"},
                )
                if resp.status_code == 200:
                    meta = resp.json()
                    if meta.get("resourceType") == "CapabilityStatement":
                        test_result["fhir_metadata"] = True
                        test_result["fhir_version"] = meta.get("fhirVersion")
                else:
                    test_result["errors"].append(f"FHIR metadata returned HTTP {resp.status_code}")
        except Exception as e:
            test_result["errors"].append(f"FHIR metadata error: {str(e)}")

    # Test 3: Patient search (only if we have a valid token)
    if test_result["token_exchange"] and test_result["fhir_metadata"] and session["auth_type"] == AuthType.BACKEND_SERVICES.value:
        try:
            async with httpx.AsyncClient(timeout=15.0) as http:
                resp = await http.get(
                    f"{fhir_base.rstrip('/')}/Patient?_count=1",
                    headers={
                        "Accept": "application/fhir+json",
                        "Authorization": f"Bearer {access_token}",  # type: ignore[name-defined]
                    },
                )
                if resp.status_code == 200:
                    bundle = resp.json()
                    test_result["patient_search"] = True
                    test_result["patient_count"] = bundle.get("total", 0)
                else:
                    test_result["errors"].append(f"Patient search returned HTTP {resp.status_code}")
        except Exception as e:
            test_result["errors"].append(f"Patient search error: {str(e)}")

    # Determine overall test status
    connection_ok = test_result["token_exchange"] and test_result["fhir_metadata"]
    new_status = OnboardingStatus.SCOPE_CONFIGURATION if connection_ok else OnboardingStatus.CONNECTION_TEST

    await _update_status(pool, onboarding_id, new_status, {
        "last_test_at": datetime.utcnow().isoformat(),
        "last_test_status": "passed" if connection_ok else "failed",
        "last_test_error": "; ".join(test_result["errors"]) if test_result["errors"] else None,
        "last_test_patient_count": test_result.get("patient_count", 0),
    })
    await _log_event(pool, onboarding_id, "connection_test_complete",
                     OnboardingStatus.CONNECTION_TEST.value, new_status.value, test_result)

    test_result["status"] = new_status.value
    test_result["passed"] = connection_ok
    if connection_ok:
        test_result["next_step"] = "POST /emr/onboarding/{onboarding_id}/scopes to configure sync settings"
    else:
        test_result["next_step"] = "Fix the errors above and retry POST /emr/onboarding/{onboarding_id}/test"

    return test_result

@app.post("/emr/onboarding/{onboarding_id}/scopes")
async def configure_scopes(
    onboarding_id: str,
    req: ConfigureScopesRequest,
    user: Dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Configure FHIR scopes and sync settings for the EMR tenant."""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        session = await conn.fetchrow(
            "SELECT * FROM emr_onboarding_sessions WHERE id=$1", onboarding_id
        )
    if not session:
        raise HTTPException(status_code=404, detail="Onboarding session not found")
    if session["status"] != OnboardingStatus.SCOPE_CONFIGURATION.value:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot configure scopes in status '{session['status']}'. "
                   "Connection test must pass first.",
        )

    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE emr_onboarding_sessions SET
               configured_scopes=$2, sync_resources=$3,
               sync_frequency_hours=$4, sync_lookback_days=$5,
               patient_matching_enabled=$6, auto_create_fhir_resources=$7,
               status=$8, updated_at=NOW()
               WHERE id=$1""",
            onboarding_id,
            json.dumps(req.scopes),
            json.dumps(req.sync_resources),
            req.sync_frequency_hours,
            req.sync_lookback_days,
            req.patient_matching_enabled,
            req.auto_create_fhir_resources,
            OnboardingStatus.VALIDATION.value,
        )

    await _log_event(pool, onboarding_id, "scopes_configured",
                     OnboardingStatus.SCOPE_CONFIGURATION.value,
                     OnboardingStatus.VALIDATION.value,
                     {"scopes": req.scopes, "resources": req.sync_resources})

    return {
        "onboarding_id": onboarding_id,
        "status": OnboardingStatus.VALIDATION.value,
        "configured_scopes": req.scopes,
        "sync_resources": req.sync_resources,
        "next_step": "POST /emr/onboarding/{onboarding_id}/activate to go live",
    }

@app.post("/emr/onboarding/{onboarding_id}/activate")
async def activate_tenant(
    onboarding_id: str,
    user: Dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Final activation step. Creates the emr_tenant_registrations record
    and marks the onboarding session as ACTIVE.
    """
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        session = await conn.fetchrow(
            "SELECT * FROM emr_onboarding_sessions WHERE id=$1", onboarding_id
        )
    if not session:
        raise HTTPException(status_code=404, detail="Onboarding session not found")
    if session["status"] != OnboardingStatus.VALIDATION.value:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot activate in status '{session['status']}'. "
                   "Scopes must be configured first.",
        )
    if not session["client_id"] or not session["tenant_fhir_base_url"]:
        raise HTTPException(
            status_code=400,
            detail="Missing client_id or FHIR base URL. Complete credential submission first.",
        )

    tenant_id = str(uuid.uuid4())
    vendor = KNOWN_VENDORS.get(session["vendor_key"], KNOWN_VENDORS["generic_fhir_r4"])

    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO emr_tenant_registrations
               (id, onboarding_id, vendor_key, tenant_name, fhir_base_url,
                environment, auth_type, client_id, configured_scopes,
                sync_resources, sync_frequency_hours, sync_lookback_days,
                patient_matching_enabled, is_active, activated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, TRUE, NOW())""",
            tenant_id, onboarding_id, session["vendor_key"], session["tenant_name"],
            session["tenant_fhir_base_url"], session["environment"],
            session["auth_type"], session["client_id"],
            session["configured_scopes"] or json.dumps(vendor["required_scopes"]),
            session["sync_resources"] or json.dumps(vendor["supported_resources"]),
            session["sync_frequency_hours"] or 24,
            session["sync_lookback_days"] or 365,
            session["patient_matching_enabled"] if session["patient_matching_enabled"] is not None else True,
        )
        await conn.execute(
            """UPDATE emr_onboarding_sessions SET
               status=$2, activated_at=NOW(), updated_at=NOW()
               WHERE id=$1""",
            onboarding_id, OnboardingStatus.ACTIVE.value,
        )

    await _log_event(pool, onboarding_id, "tenant_activated",
                     OnboardingStatus.VALIDATION.value, OnboardingStatus.ACTIVE.value,
                     {"tenant_id": tenant_id})

    return {
        "onboarding_id": onboarding_id,
        "tenant_id": tenant_id,
        "status": OnboardingStatus.ACTIVE.value,
        "vendor": session["vendor_key"],
        "tenant_name": session["tenant_name"],
        "fhir_base_url": session["tenant_fhir_base_url"],
        "environment": session["environment"],
        "message": (
            f"EMR tenant '{session['tenant_name']}' is now active. "
            "Patients can now connect via SMART on FHIR at "
            f"GET /emr/launch/{session['vendor_key']}?tenant_id={tenant_id}"
        ),
    }

@app.get("/emr/onboarding/{onboarding_id}/status")
async def get_onboarding_status(
    onboarding_id: str,
    user: Dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Poll the current status of an onboarding session."""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        session = await conn.fetchrow(
            "SELECT * FROM emr_onboarding_sessions WHERE id=$1", onboarding_id
        )
        if not session:
            raise HTTPException(status_code=404, detail="Onboarding session not found")
        events = await conn.fetch(
            """SELECT event_type, from_status, to_status, details, created_at
               FROM emr_onboarding_events WHERE onboarding_id=$1
               ORDER BY created_at DESC LIMIT 10""",
            onboarding_id,
        )

    vendor = KNOWN_VENDORS.get(session["vendor_key"], KNOWN_VENDORS["generic_fhir_r4"])

    # Determine next action based on current status
    next_actions = {
        OnboardingStatus.PENDING.value: "Waiting for capability discovery. If not started, POST /emr/onboarding/{id}/discover",
        OnboardingStatus.CAPABILITY_DISCOVERY.value: "Capability discovery in progress. Poll this endpoint.",
        OnboardingStatus.CREDENTIAL_ENTRY.value: f"Submit credentials via POST /emr/onboarding/{onboarding_id}/credentials",
        OnboardingStatus.CONNECTION_TEST.value: f"Test connection via POST /emr/onboarding/{onboarding_id}/test",
        OnboardingStatus.SCOPE_CONFIGURATION.value: f"Configure scopes via POST /emr/onboarding/{onboarding_id}/scopes",
        OnboardingStatus.VALIDATION.value: f"Activate tenant via POST /emr/onboarding/{onboarding_id}/activate",
        OnboardingStatus.ACTIVE.value: "Tenant is active. Patients can connect via SMART on FHIR.",
        OnboardingStatus.FAILED.value: f"Onboarding failed: {session['failure_reason']}. Start a new session.",
    }

    return {
        "onboarding_id": onboarding_id,
        "status": session["status"],
        "vendor": {
            "key": session["vendor_key"],
            "display_name": vendor["display_name"],
        },
        "tenant_name": session["tenant_name"],
        "environment": session["environment"],
        "fhir_base_url": session["tenant_fhir_base_url"],
        "discovered_resources": json.loads(session["discovered_resources"] or "[]"),
        "last_test_status": session["last_test_status"],
        "last_test_at": session["last_test_at"].isoformat() if session["last_test_at"] else None,
        "last_test_error": session["last_test_error"],
        "next_action": next_actions.get(session["status"], "Unknown status"),
        "recent_events": [
            {
                "event": e["event_type"],
                "from": e["from_status"],
                "to": e["to_status"],
                "at": e["created_at"].isoformat(),
            }
            for e in events
        ],
        "created_at": session["created_at"].isoformat(),
        "updated_at": session["updated_at"].isoformat(),
    }

@app.get("/emr/onboarding/sessions")
async def list_onboarding_sessions(
    status: Optional[str] = None,
    vendor_key: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    user: Dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """List all onboarding sessions with optional filtering."""
    pool = await get_db_pool()
    conditions = []
    params: List[Any] = []
    if status:
        conditions.append(f"status=${len(params)+1}")
        params.append(status)
    if vendor_key:
        conditions.append(f"vendor_key=${len(params)+1}")
        params.append(vendor_key)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.extend([limit, offset])

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""SELECT id, vendor_key, tenant_name, environment, status,
                       contact_email, last_test_status, activated_at, created_at
                FROM emr_onboarding_sessions {where}
                ORDER BY created_at DESC
                LIMIT ${len(params)-1} OFFSET ${len(params)}""",
            *params,
        )
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM emr_onboarding_sessions {where}",
            *params[:-2],
        )

    return {
        "sessions": [dict(r) for r in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }

@app.get("/emr/tenants")
async def list_active_tenants(
    vendor_key: Optional[str] = None,
    user: Dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """List all active EMR tenant registrations."""
    pool = await get_db_pool()
    conditions = ["is_active=TRUE"]
    params: List[Any] = []
    if vendor_key:
        conditions.append(f"vendor_key=${len(params)+1}")
        params.append(vendor_key)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""SELECT id, vendor_key, tenant_name, fhir_base_url, environment,
                       auth_type, sync_frequency_hours, total_patients_synced,
                       last_sync_at, activated_at
                FROM emr_tenant_registrations
                WHERE {' AND '.join(conditions)}
                ORDER BY activated_at DESC""",
            *params,
        )

    return {
        "tenants": [dict(r) for r in rows],
        "total": len(rows),
    }

@app.delete("/emr/tenants/{tenant_id}")
async def deactivate_tenant(
    tenant_id: str,
    reason: str,
    user: Dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Deactivate an EMR tenant registration."""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE emr_tenant_registrations SET is_active=FALSE, updated_at=NOW() WHERE id=$1",
            tenant_id,
        )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {"tenant_id": tenant_id, "status": "deactivated", "reason": reason}

@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "healthy", "service": "emr-onboarding-service"}

@app.on_event("startup")
async def startup() -> None:
    pool = await get_db_pool()
    await _create_onboarding_tables(pool)
    logger.info("EMR Onboarding Service started — %d vendors supported", len(KNOWN_VENDORS))
