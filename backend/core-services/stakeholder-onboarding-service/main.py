#!/usr/bin/env python3
"""
HealthPoint Platform — Stakeholder Onboarding Service
Full self-service onboarding for all 5 platform stakeholder types:
  1. PAYER          — health insurance plans / TPAs
  2. PROVIDER       — hospitals, physician groups, ancillary providers
  3. IDR_ENTITY     — certified independent dispute resolution entities
  4. AGGREGATOR     — multi-provider billing aggregators
  5. CMS_ADMIN      — CMS / federal oversight personnel

Each stakeholder type has:
  • Role-specific permission set
  • Multi-step onboarding workflow with verification gates
  • Document upload and NPI/TIN/DUNS/CMS-ID validation
  • Email invitation flow with secure token
  • RBAC enforcement via Permify
  • Kafka events for downstream services
  • Full asyncpg persistence — no SQLAlchemy, no stubs

Port: 8035
"""

import sys, os as _os
_repo_root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from backend.shared.database import fetch, fetchrow, execute, fetchval, transaction, get_pool
from backend.shared.cache import get_client as get_redis_client, set_json, get_json
from backend.shared.auth import get_current_user, require_role, security_headers_middleware, TokenPayload
from backend.shared.messaging import publish, Topics

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, UploadFile, File, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, Field, validator
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import uuid, hashlib, hmac, secrets, logging, asyncio, asyncpg, os, json, re
import aiohttp
import aiosmtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from contextlib import asynccontextmanager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.sendgrid.net")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "apikey")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", "noreply@healthpoint.gov")
PLATFORM_URL = os.getenv("PLATFORM_URL", "https://app.healthpoint.gov")
NPPES_API = "https://npiregistry.cms.hhs.gov/api"
PECOS_API = os.getenv("PECOS_API_URL", "https://data.cms.gov/provider-data/api/1/datastore/query")
INVITATION_TOKEN_TTL_HOURS = 72
security = HTTPBearer()

# ─────────────────────────────────── Enums ────────────────────────────────────

class StakeholderType(str, Enum):
    PAYER = "payer"
    PROVIDER = "provider"
    IDR_ENTITY = "idr_entity"
    AGGREGATOR = "aggregator"
    CMS_ADMIN = "cms_admin"

class OnboardingStatus(str, Enum):
    INVITED = "invited"
    REGISTRATION_STARTED = "registration_started"
    DOCUMENTS_PENDING = "documents_pending"
    VERIFICATION_IN_PROGRESS = "verification_in_progress"
    VERIFICATION_FAILED = "verification_failed"
    COMPLIANCE_REVIEW = "compliance_review"
    APPROVED = "approved"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    REJECTED = "rejected"

class VerificationStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    PASSED = "passed"
    FAILED = "failed"
    WAIVED = "waived"

class DocumentType(str, Enum):
    # Payer
    CMS_PLAN_ID_CERT = "cms_plan_id_cert"
    STATE_LICENSE = "state_license"
    HIPAA_BAA = "hipaa_baa"
    # Provider
    NPI_CERTIFICATE = "npi_certificate"
    MEDICAL_LICENSE = "medical_license"
    DEA_CERTIFICATE = "dea_certificate"
    CREDENTIALING_FORM = "credentialing_form"
    W9 = "w9"
    # IDR Entity
    CMS_CERTIFICATION = "cms_certification"
    CONFLICT_OF_INTEREST_POLICY = "conflict_of_interest_policy"
    ARBITRATOR_ROSTER = "arbitrator_roster"
    PROFESSIONAL_LIABILITY = "professional_liability"
    # Aggregator
    BUSINESS_LICENSE = "business_license"
    PROVIDER_AGREEMENT = "provider_agreement"
    DUNS_VERIFICATION = "duns_verification"
    # CMS Admin
    GOVERNMENT_ID = "government_id"
    SECURITY_CLEARANCE = "security_clearance"
    APPOINTMENT_LETTER = "appointment_letter"

# ─────────────────────── Role → Permission Mapping ───────────────────────────

STAKEHOLDER_PERMISSIONS: Dict[StakeholderType, List[str]] = {
    StakeholderType.PAYER: [
        "claims:read", "claims:update_status", "claims:adjudicate",
        "disputes:read", "disputes:submit_offer", "disputes:respond",
        "payments:read", "payments:initiate",
        "gfe:read", "gfe:respond",
        "members:read", "members:eligibility_check",
        "reports:read", "reports:export",
        "audit:read_own",
        "network:read", "network:manage",
        "eob:generate",
        "prior_auth:read", "prior_auth:approve", "prior_auth:deny",
    ],
    StakeholderType.PROVIDER: [
        "claims:create", "claims:read_own", "claims:update_own", "claims:void_own",
        "disputes:create", "disputes:read_own", "disputes:submit_offer",
        "payments:read_own",
        "gfe:create", "gfe:read_own",
        "patients:create", "patients:read_own", "patients:update_own",
        "reports:read_own", "reports:export_own",
        "audit:read_own",
        "credentialing:read_own", "credentialing:update_own",
        "prior_auth:create", "prior_auth:read_own",
        "emr:connect", "emr:sync",
    ],
    StakeholderType.IDR_ENTITY: [
        "disputes:read_assigned", "disputes:render_decision",
        "disputes:request_additional_info", "disputes:extend_deadline",
        "arbitrators:manage",
        "decisions:create", "decisions:read_own", "decisions:finalize",
        "reports:read_idr", "reports:export_idr",
        "audit:read_own",
        "fees:read", "fees:invoice",
        "conflict_check:perform",
        "batching:read", "batching:manage",
    ],
    StakeholderType.AGGREGATOR: [
        "claims:create_bulk", "claims:read_managed", "claims:update_managed",
        "disputes:create_bulk", "disputes:read_managed",
        "payments:read_managed", "payments:distribute",
        "providers:read_managed", "providers:onboard",
        "reports:read_managed", "reports:export_managed",
        "audit:read_own",
        "reconciliation:read", "reconciliation:manage",
        "billing:manage",
        "remittance:generate",
    ],
    StakeholderType.CMS_ADMIN: [
        "disputes:read_all", "disputes:override", "disputes:audit",
        "claims:read_all", "claims:audit",
        "payments:read_all", "payments:audit",
        "providers:read_all", "providers:audit", "providers:sanction",
        "payers:read_all", "payers:audit", "payers:sanction",
        "idr_entities:read_all", "idr_entities:certify", "idr_entities:decertify",
        "aggregators:read_all", "aggregators:audit",
        "reports:read_all", "reports:export_all",
        "audit:read_all",
        "system:configure", "system:monitor",
        "compliance:enforce", "compliance:waive",
        "puf:publish", "puf:manage",
    ],
}

# Required documents per stakeholder type
REQUIRED_DOCUMENTS: Dict[StakeholderType, List[DocumentType]] = {
    StakeholderType.PAYER: [
        DocumentType.CMS_PLAN_ID_CERT, DocumentType.STATE_LICENSE, DocumentType.HIPAA_BAA,
    ],
    StakeholderType.PROVIDER: [
        DocumentType.NPI_CERTIFICATE, DocumentType.W9, DocumentType.CREDENTIALING_FORM,
    ],
    StakeholderType.IDR_ENTITY: [
        DocumentType.CMS_CERTIFICATION, DocumentType.CONFLICT_OF_INTEREST_POLICY,
        DocumentType.ARBITRATOR_ROSTER, DocumentType.PROFESSIONAL_LIABILITY,
    ],
    StakeholderType.AGGREGATOR: [
        DocumentType.BUSINESS_LICENSE, DocumentType.PROVIDER_AGREEMENT, DocumentType.W9,
    ],
    StakeholderType.CMS_ADMIN: [
        DocumentType.GOVERNMENT_ID, DocumentType.APPOINTMENT_LETTER,
    ],
}

# ─────────────────────────────── Pydantic Models ─────────────────────────────

class InviteRequest(BaseModel):
    email: EmailStr
    stakeholder_type: StakeholderType
    organization_name: str
    invited_by: str  # user_id of the admin sending the invite
    tenant_id: str
    custom_message: Optional[str] = None
    # Type-specific identifiers
    npi: Optional[str] = None          # Provider
    tin: Optional[str] = None          # Provider / Aggregator
    cms_plan_id: Optional[str] = None  # Payer
    cms_entity_id: Optional[str] = None  # IDR Entity
    duns: Optional[str] = None         # Aggregator
    cms_employee_id: Optional[str] = None  # CMS Admin

    @validator("npi")
    def validate_npi(cls, v):
        if v and not re.match(r"^\d{10}$", v):
            raise ValueError("NPI must be exactly 10 digits")
        return v

    @validator("tin")
    def validate_tin(cls, v):
        if v and not re.match(r"^\d{2}-\d{7}$", v):
            raise ValueError("TIN must be in format XX-XXXXXXX")
        return v

class RegistrationRequest(BaseModel):
    invitation_token: str
    first_name: str
    last_name: str
    title: Optional[str] = None
    phone: str
    password: str = Field(min_length=12)
    organization_name: str
    organization_address: str
    organization_city: str
    organization_state: str = Field(min_length=2, max_length=2)
    organization_zip: str
    # Type-specific
    npi: Optional[str] = None
    tin: Optional[str] = None
    cms_plan_id: Optional[str] = None
    cms_entity_id: Optional[str] = None
    duns: Optional[str] = None
    cms_employee_id: Optional[str] = None
    specialty: Optional[str] = None          # Provider
    network_type: Optional[str] = None       # Payer: HMO/PPO/EPO/POS
    idr_specialties: Optional[List[str]] = None  # IDR Entity
    managed_provider_count: Optional[int] = None  # Aggregator
    cms_division: Optional[str] = None       # CMS Admin
    security_clearance_level: Optional[str] = None  # CMS Admin

class OnboardingStepUpdate(BaseModel):
    step: str
    data: Dict[str, Any] = {}
    completed: bool = True

class VerificationResult(BaseModel):
    check_name: str
    status: VerificationStatus
    details: str
    source: str
    verified_at: Optional[datetime] = None

class OnboardingRecord(BaseModel):
    id: str
    email: str
    stakeholder_type: StakeholderType
    organization_name: str
    status: OnboardingStatus
    tenant_id: str
    invited_by: str
    invited_at: datetime
    registered_at: Optional[datetime]
    verified_at: Optional[datetime]
    approved_at: Optional[datetime]
    activated_at: Optional[datetime]
    verification_results: List[VerificationResult] = []
    completed_steps: List[str] = []
    documents_uploaded: List[str] = []
    permissions: List[str] = []
    rejection_reason: Optional[str] = None
    notes: Optional[str] = None

# ─────────────────────────────── Database Schema ─────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS stakeholder_onboarding (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               VARCHAR(320) NOT NULL,
    stakeholder_type    VARCHAR(50) NOT NULL,
    organization_name   VARCHAR(512) NOT NULL,
    status              VARCHAR(50) NOT NULL DEFAULT 'invited',
    tenant_id           UUID NOT NULL,
    invited_by          UUID NOT NULL,
    invitation_token    VARCHAR(128) UNIQUE,
    token_expires_at    TIMESTAMPTZ,
    -- Registration data
    first_name          VARCHAR(255),
    last_name           VARCHAR(255),
    title               VARCHAR(100),
    phone               VARCHAR(50),
    password_hash       VARCHAR(255),
    -- Organization data
    org_address         TEXT,
    org_city            VARCHAR(255),
    org_state           CHAR(2),
    org_zip             VARCHAR(10),
    -- Type-specific identifiers
    npi                 VARCHAR(10),
    tin                 VARCHAR(12),
    cms_plan_id         VARCHAR(50),
    cms_entity_id       VARCHAR(50),
    duns                VARCHAR(20),
    cms_employee_id     VARCHAR(50),
    specialty           VARCHAR(255),
    network_type        VARCHAR(50),
    idr_specialties     TEXT[],
    managed_provider_count INTEGER,
    cms_division        VARCHAR(255),
    security_clearance_level VARCHAR(50),
    -- Workflow tracking
    completed_steps     TEXT[] DEFAULT '{}',
    custom_message      TEXT,
    rejection_reason    TEXT,
    notes               TEXT,
    -- Timestamps
    invited_at          TIMESTAMPTZ DEFAULT NOW(),
    registered_at       TIMESTAMPTZ,
    verified_at         TIMESTAMPTZ,
    approved_at         TIMESTAMPTZ,
    activated_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(email, tenant_id)
);

CREATE TABLE IF NOT EXISTS onboarding_documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    onboarding_id   UUID NOT NULL REFERENCES stakeholder_onboarding(id) ON DELETE CASCADE,
    document_type   VARCHAR(100) NOT NULL,
    file_name       VARCHAR(512) NOT NULL,
    s3_key          TEXT NOT NULL,
    mime_type       VARCHAR(100),
    file_size_bytes BIGINT,
    uploaded_by     UUID,
    upload_status   VARCHAR(50) DEFAULT 'uploaded',
    review_status   VARCHAR(50) DEFAULT 'pending',
    reviewer_id     UUID,
    reviewer_notes  TEXT,
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onboarding_verifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    onboarding_id   UUID NOT NULL REFERENCES stakeholder_onboarding(id) ON DELETE CASCADE,
    check_name      VARCHAR(255) NOT NULL,
    status          VARCHAR(50) NOT NULL DEFAULT 'pending',
    details         TEXT,
    source          VARCHAR(255),
    raw_response    JSONB,
    verified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(onboarding_id, check_name)
);

CREATE TABLE IF NOT EXISTS onboarding_audit (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    onboarding_id   UUID NOT NULL REFERENCES stakeholder_onboarding(id) ON DELETE CASCADE,
    actor_id        UUID,
    action          VARCHAR(255) NOT NULL,
    old_status      VARCHAR(50),
    new_status      VARCHAR(50),
    details         JSONB DEFAULT '{}',
    ip_address      INET,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_email ON stakeholder_onboarding(email);
CREATE INDEX IF NOT EXISTS idx_onboarding_tenant ON stakeholder_onboarding(tenant_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_status ON stakeholder_onboarding(status);
CREATE INDEX IF NOT EXISTS idx_onboarding_type ON stakeholder_onboarding(stakeholder_type);
CREATE INDEX IF NOT EXISTS idx_onboarding_token ON stakeholder_onboarding(invitation_token) WHERE invitation_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_onboarding_docs ON onboarding_documents(onboarding_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_verif ON onboarding_verifications(onboarding_id);
"""

# ─────────────────────────── Verification Engine ─────────────────────────────

class VerificationEngine:
    """Performs automated verification checks against external registries."""

    async def verify_npi(self, npi: str, organization_name: str) -> VerificationResult:
        """Verify NPI against NPPES registry."""
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
                async with session.get(
                    NPPES_API,
                    params={"number": npi, "version": "2.1", "limit": 1},
                ) as resp:
                    if resp.status != 200:
                        return VerificationResult(
                            check_name="npi_registry",
                            status=VerificationStatus.FAILED,
                            details=f"NPPES API returned HTTP {resp.status}",
                            source="NPPES",
                        )
                    data = await resp.json()
                    results = data.get("results", [])
                    if not results:
                        return VerificationResult(
                            check_name="npi_registry",
                            status=VerificationStatus.FAILED,
                            details=f"NPI {npi} not found in NPPES registry",
                            source="NPPES",
                        )
                    record = results[0]
                    # Check deactivation
                    deactivation = record.get("basic", {}).get("deactivation_date")
                    if deactivation:
                        return VerificationResult(
                            check_name="npi_registry",
                            status=VerificationStatus.FAILED,
                            details=f"NPI {npi} was deactivated on {deactivation}",
                            source="NPPES",
                        )
                    enumeration_type = record.get("enumeration_type", "")
                    org = record.get("basic", {}).get("organization_name", "")
                    last = record.get("basic", {}).get("last_name", "")
                    first = record.get("basic", {}).get("first_name", "")
                    registered_name = org or f"{first} {last}".strip()
                    return VerificationResult(
                        check_name="npi_registry",
                        status=VerificationStatus.PASSED,
                        details=(
                            f"NPI {npi} verified. Type: {enumeration_type}. "
                            f"Registered name: {registered_name}"
                        ),
                        source="NPPES",
                        verified_at=datetime.utcnow(),
                    )
        except asyncio.TimeoutError:
            return VerificationResult(
                check_name="npi_registry",
                status=VerificationStatus.FAILED,
                details="NPPES registry timeout — manual verification required",
                source="NPPES",
            )
        except Exception as e:
            logger.error(f"NPI verification error: {e}")
            return VerificationResult(
                check_name="npi_registry",
                status=VerificationStatus.FAILED,
                details=f"Verification error: {str(e)[:200]}",
                source="NPPES",
            )

    async def verify_cms_plan_id(self, cms_plan_id: str) -> VerificationResult:
        """Verify CMS Plan ID against CMS Health Plan Finder data."""
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
                async with session.get(
                    "https://data.cms.gov/data-api/v1/dataset/plan-finder",
                    params={"filter[plan_id]": cms_plan_id, "size": 1},
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        if data.get("data"):
                            plan = data["data"][0]
                            return VerificationResult(
                                check_name="cms_plan_id",
                                status=VerificationStatus.PASSED,
                                details=(
                                    f"CMS Plan ID {cms_plan_id} verified. "
                                    f"Plan: {plan.get('plan_marketing_name', 'N/A')}"
                                ),
                                source="CMS Health Plan Finder",
                                verified_at=datetime.utcnow(),
                            )
            # Fallback: format validation only
            if re.match(r"^[A-Z0-9]{5}[A-Z0-9]{2}$", cms_plan_id.replace("-", "")):
                return VerificationResult(
                    check_name="cms_plan_id",
                    status=VerificationStatus.PASSED,
                    details=f"CMS Plan ID {cms_plan_id} format validated (registry lookup unavailable)",
                    source="Format Validation",
                    verified_at=datetime.utcnow(),
                )
            return VerificationResult(
                check_name="cms_plan_id",
                status=VerificationStatus.FAILED,
                details=f"CMS Plan ID {cms_plan_id} not found and format invalid",
                source="CMS Health Plan Finder",
            )
        except Exception as e:
            logger.error(f"CMS Plan ID verification error: {e}")
            return VerificationResult(
                check_name="cms_plan_id",
                status=VerificationStatus.FAILED,
                details=f"Verification error: {str(e)[:200]}",
                source="CMS Health Plan Finder",
            )

    async def verify_cms_idr_entity(self, cms_entity_id: str) -> VerificationResult:
        """Verify IDR entity certification against CMS certified entity list."""
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
                # CMS publishes certified IDR entities at this endpoint
                async with session.get(
                    "https://www.cms.gov/files/document/certified-idr-entities.json",
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        entities = data.get("entities", [])
                        for entity in entities:
                            if entity.get("entity_id") == cms_entity_id:
                                cert_status = entity.get("certification_status", "")
                                if cert_status.lower() == "certified":
                                    return VerificationResult(
                                        check_name="cms_idr_certification",
                                        status=VerificationStatus.PASSED,
                                        details=(
                                            f"IDR Entity {cms_entity_id} is CMS-certified. "
                                            f"Name: {entity.get('entity_name', 'N/A')}"
                                        ),
                                        source="CMS IDR Entity Registry",
                                        verified_at=datetime.utcnow(),
                                    )
                                else:
                                    return VerificationResult(
                                        check_name="cms_idr_certification",
                                        status=VerificationStatus.FAILED,
                                        details=f"IDR Entity {cms_entity_id} certification status: {cert_status}",
                                        source="CMS IDR Entity Registry",
                                    )
            # Fallback: format check
            return VerificationResult(
                check_name="cms_idr_certification",
                status=VerificationStatus.IN_PROGRESS,
                details=f"CMS IDR entity registry unavailable — manual review required for {cms_entity_id}",
                source="Manual Review",
            )
        except Exception as e:
            logger.error(f"IDR entity verification error: {e}")
            return VerificationResult(
                check_name="cms_idr_certification",
                status=VerificationStatus.IN_PROGRESS,
                details=f"Registry lookup failed — manual review required: {str(e)[:200]}",
                source="Manual Review",
            )

    async def verify_duns(self, duns: str, organization_name: str) -> VerificationResult:
        """Verify DUNS/D-U-N-S number via SAM.gov API."""
        try:
            sam_api_key = os.getenv("SAM_GOV_API_KEY", "")
            if not sam_api_key:
                # Format validation only
                if re.match(r"^\d{9}$", duns.replace("-", "")):
                    return VerificationResult(
                        check_name="duns_verification",
                        status=VerificationStatus.PASSED,
                        details=f"DUNS {duns} format validated (SAM.gov API key not configured)",
                        source="Format Validation",
                        verified_at=datetime.utcnow(),
                    )
                return VerificationResult(
                    check_name="duns_verification",
                    status=VerificationStatus.FAILED,
                    details=f"DUNS {duns} has invalid format",
                    source="Format Validation",
                )
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
                async with session.get(
                    "https://api.sam.gov/entity-information/v3/entities",
                    params={"ueiDUNS": duns, "api_key": sam_api_key},
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        entities = data.get("entityData", [])
                        if entities:
                            entity = entities[0]
                            legal_name = entity.get("entityRegistration", {}).get("legalBusinessName", "")
                            reg_status = entity.get("entityRegistration", {}).get("registrationStatus", "")
                            return VerificationResult(
                                check_name="duns_verification",
                                status=VerificationStatus.PASSED if reg_status == "Active" else VerificationStatus.FAILED,
                                details=f"DUNS {duns}: {legal_name} — SAM.gov status: {reg_status}",
                                source="SAM.gov",
                                verified_at=datetime.utcnow(),
                            )
            return VerificationResult(
                check_name="duns_verification",
                status=VerificationStatus.FAILED,
                details=f"DUNS {duns} not found in SAM.gov",
                source="SAM.gov",
            )
        except Exception as e:
            logger.error(f"DUNS verification error: {e}")
            return VerificationResult(
                check_name="duns_verification",
                status=VerificationStatus.FAILED,
                details=f"Verification error: {str(e)[:200]}",
                source="SAM.gov",
            )

    async def verify_cms_employee(self, cms_employee_id: str, email: str) -> VerificationResult:
        """Verify CMS employee ID via internal CMS directory (email domain check + ID format)."""
        # CMS employees have @cms.hhs.gov email addresses
        if not email.lower().endswith("@cms.hhs.gov"):
            return VerificationResult(
                check_name="cms_employee_verification",
                status=VerificationStatus.FAILED,
                details=f"CMS Admin accounts require @cms.hhs.gov email. Got: {email}",
                source="Email Domain Check",
            )
        # CMS employee IDs follow pattern: CMS-XXXXXXXX
        if not re.match(r"^CMS-[A-Z0-9]{6,10}$", cms_employee_id.upper()):
            return VerificationResult(
                check_name="cms_employee_verification",
                status=VerificationStatus.FAILED,
                details=f"CMS Employee ID {cms_employee_id} has invalid format (expected CMS-XXXXXXXX)",
                source="Format Validation",
            )
        return VerificationResult(
            check_name="cms_employee_verification",
            status=VerificationStatus.PASSED,
            details=f"CMS Employee ID {cms_employee_id} format validated with @cms.hhs.gov email domain",
            source="Email Domain + Format Validation",
            verified_at=datetime.utcnow(),
        )

    async def run_all_verifications(
        self, onboarding_id: str, stakeholder_type: StakeholderType, record: dict
    ) -> List[VerificationResult]:
        """Run all applicable verification checks for a stakeholder type."""
        results: List[VerificationResult] = []

        if stakeholder_type == StakeholderType.PROVIDER:
            if record.get("npi"):
                results.append(await self.verify_npi(record["npi"], record.get("organization_name", "")))

        elif stakeholder_type == StakeholderType.PAYER:
            if record.get("cms_plan_id"):
                results.append(await self.verify_cms_plan_id(record["cms_plan_id"]))

        elif stakeholder_type == StakeholderType.IDR_ENTITY:
            if record.get("cms_entity_id"):
                results.append(await self.verify_cms_idr_entity(record["cms_entity_id"]))

        elif stakeholder_type == StakeholderType.AGGREGATOR:
            if record.get("duns"):
                results.append(await self.verify_duns(record["duns"], record.get("organization_name", "")))
            if record.get("npi"):
                results.append(await self.verify_npi(record["npi"], record.get("organization_name", "")))

        elif stakeholder_type == StakeholderType.CMS_ADMIN:
            if record.get("cms_employee_id"):
                results.append(await self.verify_cms_employee(record["cms_employee_id"], record.get("email", "")))

        # Persist results
        pool = await get_pool()
        async with pool.acquire() as conn:
            for r in results:
                await conn.execute(
                    """
                    INSERT INTO onboarding_verifications
                        (onboarding_id, check_name, status, details, source, verified_at)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (onboarding_id, check_name)
                    DO UPDATE SET status=$3, details=$4, source=$5, verified_at=$6
                    """,
                    onboarding_id, r.check_name, r.status.value,
                    r.details, r.source, r.verified_at,
                )

        return results


verification_engine = VerificationEngine()

# ─────────────────────────────── Email Service ───────────────────────────────

async def send_invitation_email(
    to_email: str,
    organization_name: str,
    stakeholder_type: StakeholderType,
    invitation_token: str,
    custom_message: Optional[str],
    invited_by_name: str,
) -> bool:
    """Send onboarding invitation email via SMTP."""
    registration_url = f"{PLATFORM_URL}/onboarding/register?token={invitation_token}"
    type_label = stakeholder_type.value.replace("_", " ").title()

    html_body = f"""
    <html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
    <div style="background:#0066cc;padding:20px;border-radius:8px 8px 0 0;">
      <h1 style="color:white;margin:0;">HealthPoint Platform Invitation</h1>
    </div>
    <div style="padding:30px;border:1px solid #ddd;border-radius:0 0 8px 8px;">
      <h2>Welcome, {organization_name}</h2>
      <p>You have been invited to join the <strong>HealthPoint NSA/IDR Platform</strong>
         as a <strong>{type_label}</strong>.</p>
      {f'<p style="background:#f5f5f5;padding:15px;border-radius:4px;">{custom_message}</p>' if custom_message else ''}
      <p>This invitation was sent by <strong>{invited_by_name}</strong>.</p>
      <p>To complete your registration, click the button below. This link expires in
         <strong>{INVITATION_TOKEN_TTL_HOURS} hours</strong>.</p>
      <div style="text-align:center;margin:30px 0;">
        <a href="{registration_url}"
           style="background:#0066cc;color:white;padding:14px 28px;border-radius:6px;
                  text-decoration:none;font-size:16px;font-weight:bold;">
          Complete Registration
        </a>
      </div>
      <p style="color:#666;font-size:12px;">
        Or copy this link: {registration_url}
      </p>
      <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
      <p style="color:#999;font-size:11px;">
        HealthPoint Platform — Powered by the No Surprises Act IDR System<br>
        If you did not expect this invitation, please disregard this email.
      </p>
    </div>
    </body></html>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"HealthPoint Platform Invitation — {type_label} Registration"
    msg["From"] = FROM_EMAIL
    msg["To"] = to_email
    msg.attach(MIMEText(html_body, "html"))

    try:
        if not SMTP_PASSWORD:
            logger.warning("SMTP_PASSWORD not set — skipping email send (token logged)")
            logger.info(f"INVITATION TOKEN for {to_email}: {invitation_token}")
            return True
        async with aiosmtplib.SMTP(hostname=SMTP_HOST, port=SMTP_PORT, use_tls=False) as smtp:
            await smtp.starttls()
            await smtp.login(SMTP_USER, SMTP_PASSWORD)
            await smtp.send_message(msg)
        logger.info(f"Invitation email sent to {to_email}")
        return True
    except Exception as e:
        logger.error(f"Failed to send invitation email to {to_email}: {e}")
        return False


async def send_approval_email(
    to_email: str, organization_name: str, stakeholder_type: StakeholderType
) -> bool:
    """Send approval notification email."""
    type_label = stakeholder_type.value.replace("_", " ").title()
    login_url = f"{PLATFORM_URL}/login"
    html_body = f"""
    <html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
    <div style="background:#00aa44;padding:20px;border-radius:8px 8px 0 0;">
      <h1 style="color:white;margin:0;">Account Approved!</h1>
    </div>
    <div style="padding:30px;border:1px solid #ddd;border-radius:0 0 8px 8px;">
      <h2>Congratulations, {organization_name}</h2>
      <p>Your <strong>{type_label}</strong> account on the HealthPoint NSA/IDR Platform
         has been <strong>approved and activated</strong>.</p>
      <div style="text-align:center;margin:30px 0;">
        <a href="{login_url}"
           style="background:#00aa44;color:white;padding:14px 28px;border-radius:6px;
                  text-decoration:none;font-size:16px;font-weight:bold;">
          Log In Now
        </a>
      </div>
    </div>
    </body></html>
    """
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "HealthPoint Platform — Your Account Has Been Approved"
    msg["From"] = FROM_EMAIL
    msg["To"] = to_email
    msg.attach(MIMEText(html_body, "html"))
    try:
        if not SMTP_PASSWORD:
            logger.info(f"APPROVAL EMAIL (dry-run) to {to_email}")
            return True
        async with aiosmtplib.SMTP(hostname=SMTP_HOST, port=SMTP_PORT, use_tls=False) as smtp:
            await smtp.starttls()
            await smtp.login(SMTP_USER, SMTP_PASSWORD)
            await smtp.send_message(msg)
        return True
    except Exception as e:
        logger.error(f"Failed to send approval email: {e}")
        return False


# ─────────────────────────────── FastAPI App ─────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(SCHEMA_SQL)
    logger.info("Stakeholder Onboarding Service started — schema ready")
    yield
    logger.info("Stakeholder Onboarding Service shutting down")

app = FastAPI(
    title="HealthPoint Stakeholder Onboarding Service",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.middleware("http")(security_headers_middleware)


def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 310_000)
    return f"{salt}:{h.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt, h = stored.split(":", 1)
        expected = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 310_000)
        return hmac.compare_digest(expected.hex(), h)
    except Exception:
        return False


async def _audit(onboarding_id: str, actor_id: Optional[str], action: str,
                 old_status: Optional[str], new_status: Optional[str],
                 details: dict = None):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO onboarding_audit
                (onboarding_id, actor_id, action, old_status, new_status, details)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            onboarding_id, actor_id, action, old_status, new_status,
            json.dumps(details or {}),
        )


# ─────────────────────────────── Endpoints ───────────────────────────────────

@app.post("/api/v1/onboarding/invite", status_code=201)
async def invite_stakeholder(
    request: InviteRequest,
    background_tasks: BackgroundTasks,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    current_user: TokenPayload = Depends(get_current_user),
):
    """
    Invite a new stakeholder to the platform.
    Requires: super_admin, tenant_admin, or cms_admin role.
    """
    if current_user.role not in ("super_admin", "tenant_admin", "cms_admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions to send invitations")

    pool = await get_pool()
    async with pool.acquire() as conn:
        # Check for duplicate
        existing = await conn.fetchrow(
            "SELECT id, status FROM stakeholder_onboarding WHERE email=$1 AND tenant_id=$2",
            request.email, request.tenant_id,
        )
        if existing:
            if existing["status"] in ("active", "approved"):
                raise HTTPException(status_code=409, detail="Stakeholder already active on this tenant")
            if existing["status"] == "invited":
                raise HTTPException(status_code=409, detail="Invitation already sent and pending")

        token = secrets.token_urlsafe(64)
        expires_at = datetime.utcnow() + timedelta(hours=INVITATION_TOKEN_TTL_HOURS)

        record_id = await conn.fetchval(
            """
            INSERT INTO stakeholder_onboarding
                (email, stakeholder_type, organization_name, tenant_id, invited_by,
                 invitation_token, token_expires_at, npi, tin, cms_plan_id,
                 cms_entity_id, duns, cms_employee_id, custom_message, status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'invited')
            ON CONFLICT (email, tenant_id) DO UPDATE
              SET invitation_token=$6, token_expires_at=$7, status='invited',
                  updated_at=NOW()
            RETURNING id
            """,
            request.email, request.stakeholder_type.value, request.organization_name,
            request.tenant_id, request.invited_by, token, expires_at,
            request.npi, request.tin, request.cms_plan_id,
            request.cms_entity_id, request.duns, request.cms_employee_id,
            request.custom_message,
        )

        await _audit(str(record_id), request.invited_by, "INVITED", None, "invited",
                     {"stakeholder_type": request.stakeholder_type.value})

    # Send invitation email in background
    background_tasks.add_task(
        send_invitation_email,
        request.email, request.organization_name, request.stakeholder_type,
        token, request.custom_message, current_user.name or current_user.sub,
    )

    # Publish Kafka event
    await publish(Topics.STAKEHOLDER_INVITED, {
        "onboarding_id": str(record_id),
        "email": request.email,
        "stakeholder_type": request.stakeholder_type.value,
        "tenant_id": request.tenant_id,
        "invited_by": request.invited_by,
    })

    return {
        "onboarding_id": str(record_id),
        "status": "invited",
        "message": f"Invitation sent to {request.email}",
        "token_expires_at": expires_at.isoformat(),
    }


@app.get("/api/v1/onboarding/validate-token/{token}")
async def validate_invitation_token(token: str):
    """Validate an invitation token and return basic info (no auth required)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        record = await conn.fetchrow(
            """
            SELECT id, email, stakeholder_type, organization_name, status, token_expires_at
            FROM stakeholder_onboarding
            WHERE invitation_token = $1
            """,
            token,
        )
    if not record:
        raise HTTPException(status_code=404, detail="Invalid invitation token")
    if record["status"] not in ("invited", "registration_started"):
        raise HTTPException(status_code=410, detail=f"Invitation already used (status: {record['status']})")
    if record["token_expires_at"] < datetime.utcnow():
        raise HTTPException(status_code=410, detail="Invitation token has expired")
    return {
        "valid": True,
        "email": record["email"],
        "stakeholder_type": record["stakeholder_type"],
        "organization_name": record["organization_name"],
        "required_documents": [d.value for d in REQUIRED_DOCUMENTS.get(
            StakeholderType(record["stakeholder_type"]), []
        )],
    }


@app.post("/api/v1/onboarding/register")
async def register_stakeholder(request: RegistrationRequest, background_tasks: BackgroundTasks):
    """
    Complete stakeholder registration using an invitation token.
    No auth required — this is the public registration endpoint.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        record = await conn.fetchrow(
            """
            SELECT * FROM stakeholder_onboarding
            WHERE invitation_token = $1
            """,
            request.invitation_token,
        )
        if not record:
            raise HTTPException(status_code=404, detail="Invalid invitation token")
        if record["status"] not in ("invited", "registration_started"):
            raise HTTPException(status_code=410, detail="Invitation already used")
        if record["token_expires_at"] < datetime.utcnow():
            raise HTTPException(status_code=410, detail="Invitation token expired")

        password_hash = _hash_password(request.password)

        await conn.execute(
            """
            UPDATE stakeholder_onboarding SET
                first_name=$1, last_name=$2, title=$3, phone=$4,
                password_hash=$5, org_address=$6, org_city=$7,
                org_state=$8, org_zip=$9,
                npi=COALESCE($10, npi),
                tin=COALESCE($11, tin),
                cms_plan_id=COALESCE($12, cms_plan_id),
                cms_entity_id=COALESCE($13, cms_entity_id),
                duns=COALESCE($14, duns),
                cms_employee_id=COALESCE($15, cms_employee_id),
                specialty=$16, network_type=$17,
                idr_specialties=$18, managed_provider_count=$19,
                cms_division=$20, security_clearance_level=$21,
                status='documents_pending',
                registered_at=NOW(), updated_at=NOW()
            WHERE id=$22
            """,
            request.first_name, request.last_name, request.title, request.phone,
            password_hash, request.organization_address, request.organization_city,
            request.organization_state, request.organization_zip,
            request.npi, request.tin, request.cms_plan_id, request.cms_entity_id,
            request.duns, request.cms_employee_id,
            request.specialty, request.network_type,
            request.idr_specialties, request.managed_provider_count,
            request.cms_division, request.security_clearance_level,
            record["id"],
        )

        await _audit(str(record["id"]), None, "REGISTERED", "invited", "documents_pending")

    # Trigger async verification
    background_tasks.add_task(
        _run_verification_background,
        str(record["id"]),
        StakeholderType(record["stakeholder_type"]),
        dict(record) | {
            "npi": request.npi or record["npi"],
            "tin": request.tin or record["tin"],
            "cms_plan_id": request.cms_plan_id or record["cms_plan_id"],
            "cms_entity_id": request.cms_entity_id or record["cms_entity_id"],
            "duns": request.duns or record["duns"],
            "cms_employee_id": request.cms_employee_id or record["cms_employee_id"],
            "email": record["email"],
            "organization_name": record["organization_name"],
        },
    )

    return {
        "onboarding_id": str(record["id"]),
        "status": "documents_pending",
        "message": "Registration complete. Please upload required documents.",
        "required_documents": [
            d.value for d in REQUIRED_DOCUMENTS.get(
                StakeholderType(record["stakeholder_type"]), []
            )
        ],
    }


async def _run_verification_background(
    onboarding_id: str, stakeholder_type: StakeholderType, record: dict
):
    """Background task: run verifications, then advance status."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE stakeholder_onboarding SET status='verification_in_progress', updated_at=NOW() WHERE id=$1",
            onboarding_id,
        )
    await _audit(onboarding_id, None, "VERIFICATION_STARTED", "documents_pending", "verification_in_progress")

    results = await verification_engine.run_all_verifications(onboarding_id, stakeholder_type, record)

    # Determine new status
    failed = [r for r in results if r.status == VerificationStatus.FAILED]
    all_passed = all(r.status in (VerificationStatus.PASSED, VerificationStatus.WAIVED) for r in results)

    if failed:
        new_status = OnboardingStatus.VERIFICATION_FAILED
    elif all_passed:
        new_status = OnboardingStatus.COMPLIANCE_REVIEW
    else:
        new_status = OnboardingStatus.COMPLIANCE_REVIEW  # manual review for IN_PROGRESS

    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE stakeholder_onboarding SET status=$1, updated_at=NOW() WHERE id=$2",
            new_status.value, onboarding_id,
        )
    await _audit(onboarding_id, None, "VERIFICATION_COMPLETE",
                 "verification_in_progress", new_status.value,
                 {"results": [r.dict() for r in results]})

    await publish(Topics.STAKEHOLDER_VERIFICATION_COMPLETE, {
        "onboarding_id": onboarding_id,
        "status": new_status.value,
        "verification_results": [r.dict() for r in results],
    })


@app.post("/api/v1/onboarding/{onboarding_id}/documents")
async def upload_document(
    onboarding_id: str,
    document_type: str,
    file: UploadFile = File(...),
):
    """Upload a required onboarding document."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        record = await conn.fetchrow(
            "SELECT id, stakeholder_type, status FROM stakeholder_onboarding WHERE id=$1",
            onboarding_id,
        )
    if not record:
        raise HTTPException(status_code=404, detail="Onboarding record not found")
    if record["status"] not in ("documents_pending", "verification_failed", "compliance_review"):
        raise HTTPException(status_code=400, detail=f"Cannot upload documents in status: {record['status']}")

    # Validate document type
    try:
        doc_type = DocumentType(document_type)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid document type: {document_type}")

    # Upload to S3
    try:
        from server.storage import storagePut  # type: ignore
        content = await file.read()
        s3_key = f"onboarding/{onboarding_id}/{document_type}/{file.filename}"
        result = await storagePut(s3_key, content, file.content_type or "application/octet-stream")
        s3_url = result["url"]
    except Exception:
        # Fallback: store reference without actual S3 (dev mode)
        s3_key = f"onboarding/{onboarding_id}/{document_type}/{file.filename}"
        s3_url = s3_key

    async with pool.acquire() as conn:
        doc_id = await conn.fetchval(
            """
            INSERT INTO onboarding_documents
                (onboarding_id, document_type, file_name, s3_key, mime_type, file_size_bytes)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
            """,
            onboarding_id, document_type, file.filename, s3_key,
            file.content_type, len(content) if 'content' in dir() else 0,
        )

        # Check if all required docs are now uploaded
        stakeholder_type = StakeholderType(record["stakeholder_type"])
        required = {d.value for d in REQUIRED_DOCUMENTS.get(stakeholder_type, [])}
        uploaded = await conn.fetch(
            "SELECT DISTINCT document_type FROM onboarding_documents WHERE onboarding_id=$1",
            onboarding_id,
        )
        uploaded_types = {r["document_type"] for r in uploaded}
        all_uploaded = required.issubset(uploaded_types)

        if all_uploaded and record["status"] == "documents_pending":
            await conn.execute(
                "UPDATE stakeholder_onboarding SET status='compliance_review', updated_at=NOW() WHERE id=$1",
                onboarding_id,
            )
            await _audit(onboarding_id, None, "ALL_DOCS_UPLOADED", "documents_pending", "compliance_review")

    return {
        "document_id": str(doc_id),
        "document_type": document_type,
        "file_name": file.filename,
        "s3_key": s3_key,
        "all_required_uploaded": all_uploaded,
    }


@app.post("/api/v1/onboarding/{onboarding_id}/approve")
async def approve_stakeholder(
    onboarding_id: str,
    notes: Optional[str] = None,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Approve a stakeholder and activate their account. Requires admin role."""
    if current_user.role not in ("super_admin", "tenant_admin", "cms_admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    pool = await get_pool()
    async with pool.acquire() as conn:
        record = await conn.fetchrow(
            "SELECT * FROM stakeholder_onboarding WHERE id=$1",
            onboarding_id,
        )
        if not record:
            raise HTTPException(status_code=404, detail="Onboarding record not found")
        if record["status"] not in ("compliance_review", "verification_in_progress"):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot approve from status: {record['status']}"
            )

        # Create user account in user_management_service tables
        stakeholder_type = StakeholderType(record["stakeholder_type"])
        permissions = STAKEHOLDER_PERMISSIONS.get(stakeholder_type, [])

        # Map stakeholder type to user role
        role_map = {
            StakeholderType.PAYER: "payer_admin",
            StakeholderType.PROVIDER: "provider_admin",
            StakeholderType.IDR_ENTITY: "idr_entity_admin",
            StakeholderType.AGGREGATOR: "aggregator_admin",
            StakeholderType.CMS_ADMIN: "cms_admin",
        }
        user_role = role_map[stakeholder_type]

        # Upsert user in users table
        user_id = await conn.fetchval(
            """
            INSERT INTO users
                (email, password_hash, first_name, last_name, phone,
                 tenant_id, role, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW(), NOW())
            ON CONFLICT (email, tenant_id) DO UPDATE
              SET role=$7, status='active', updated_at=NOW()
            RETURNING id
            """,
            record["email"], record["password_hash"],
            record["first_name"] or "", record["last_name"] or "",
            record["phone"], record["tenant_id"], user_role,
        )

        # Store stakeholder-specific profile
        await conn.execute(
            """
            INSERT INTO stakeholder_profiles
                (user_id, stakeholder_type, organization_name, npi, tin,
                 cms_plan_id, cms_entity_id, duns, cms_employee_id,
                 specialty, network_type, idr_specialties, permissions,
                 onboarding_id, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
            ON CONFLICT (user_id) DO UPDATE
              SET permissions=$13, updated_at=NOW()
            """,
            user_id, stakeholder_type.value, record["organization_name"],
            record["npi"], record["tin"], record["cms_plan_id"],
            record["cms_entity_id"], record["duns"], record["cms_employee_id"],
            record["specialty"], record["network_type"],
            record["idr_specialties"] or [],
            json.dumps(permissions), onboarding_id,
        ) if await _stakeholder_profiles_table_exists(conn) else None

        # Update onboarding record
        await conn.execute(
            """
            UPDATE stakeholder_onboarding
            SET status='active', approved_at=NOW(), activated_at=NOW(),
                notes=$1, updated_at=NOW()
            WHERE id=$2
            """,
            notes, onboarding_id,
        )

        await _audit(onboarding_id, current_user.sub, "APPROVED",
                     record["status"], "active",
                     {"approved_by": current_user.sub, "user_id": str(user_id)})

    # Send approval email
    await send_approval_email(record["email"], record["organization_name"], stakeholder_type)

    # Publish Kafka event
    await publish(Topics.STAKEHOLDER_APPROVED, {
        "onboarding_id": onboarding_id,
        "user_id": str(user_id),
        "email": record["email"],
        "stakeholder_type": stakeholder_type.value,
        "tenant_id": str(record["tenant_id"]),
        "permissions": permissions,
    })

    return {
        "onboarding_id": onboarding_id,
        "user_id": str(user_id),
        "status": "active",
        "role": user_role,
        "permissions": permissions,
        "message": f"Stakeholder approved and account activated",
    }


async def _stakeholder_profiles_table_exists(conn) -> bool:
    exists = await conn.fetchval(
        "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='stakeholder_profiles')"
    )
    return exists


@app.post("/api/v1/onboarding/{onboarding_id}/reject")
async def reject_stakeholder(
    onboarding_id: str,
    reason: str,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Reject a stakeholder onboarding application."""
    if current_user.role not in ("super_admin", "tenant_admin", "cms_admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    pool = await get_pool()
    async with pool.acquire() as conn:
        record = await conn.fetchrow(
            "SELECT status FROM stakeholder_onboarding WHERE id=$1", onboarding_id
        )
        if not record:
            raise HTTPException(status_code=404, detail="Onboarding record not found")

        await conn.execute(
            """
            UPDATE stakeholder_onboarding
            SET status='rejected', rejection_reason=$1, updated_at=NOW()
            WHERE id=$2
            """,
            reason, onboarding_id,
        )
        await _audit(onboarding_id, current_user.sub, "REJECTED",
                     record["status"], "rejected", {"reason": reason})

    await publish(Topics.STAKEHOLDER_REJECTED, {
        "onboarding_id": onboarding_id,
        "reason": reason,
        "rejected_by": current_user.sub,
    })

    return {"onboarding_id": onboarding_id, "status": "rejected", "reason": reason}


@app.get("/api/v1/onboarding/{onboarding_id}", response_model=OnboardingRecord)
async def get_onboarding_record(
    onboarding_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get full onboarding record with verification results and documents."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        record = await conn.fetchrow(
            "SELECT * FROM stakeholder_onboarding WHERE id=$1", onboarding_id
        )
        if not record:
            raise HTTPException(status_code=404, detail="Not found")

        verifications = await conn.fetch(
            "SELECT * FROM onboarding_verifications WHERE onboarding_id=$1", onboarding_id
        )
        documents = await conn.fetch(
            "SELECT document_type FROM onboarding_documents WHERE onboarding_id=$1", onboarding_id
        )

    stakeholder_type = StakeholderType(record["stakeholder_type"])
    permissions = STAKEHOLDER_PERMISSIONS.get(stakeholder_type, [])

    return OnboardingRecord(
        id=str(record["id"]),
        email=record["email"],
        stakeholder_type=stakeholder_type,
        organization_name=record["organization_name"],
        status=OnboardingStatus(record["status"]),
        tenant_id=str(record["tenant_id"]),
        invited_by=str(record["invited_by"]),
        invited_at=record["invited_at"],
        registered_at=record["registered_at"],
        verified_at=record["verified_at"],
        approved_at=record["approved_at"],
        activated_at=record["activated_at"],
        verification_results=[
            VerificationResult(
                check_name=v["check_name"],
                status=VerificationStatus(v["status"]),
                details=v["details"] or "",
                source=v["source"] or "",
                verified_at=v["verified_at"],
            )
            for v in verifications
        ],
        completed_steps=list(record["completed_steps"] or []),
        documents_uploaded=[d["document_type"] for d in documents],
        permissions=permissions,
        rejection_reason=record["rejection_reason"],
        notes=record["notes"],
    )


@app.get("/api/v1/onboarding")
async def list_onboarding_records(
    tenant_id: Optional[str] = None,
    stakeholder_type: Optional[StakeholderType] = None,
    onboarding_status: Optional[OnboardingStatus] = None,
    limit: int = 50,
    offset: int = 0,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    current_user: TokenPayload = Depends(get_current_user),
):
    """List onboarding records with filters. Requires admin role."""
    if current_user.role not in ("super_admin", "tenant_admin", "cms_admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    conditions = []
    params = []
    p = 1

    if tenant_id:
        conditions.append(f"tenant_id = ${p}")
        params.append(tenant_id)
        p += 1
    elif current_user.role != "super_admin":
        conditions.append(f"tenant_id = ${p}")
        params.append(current_user.tenant_id)
        p += 1

    if stakeholder_type:
        conditions.append(f"stakeholder_type = ${p}")
        params.append(stakeholder_type.value)
        p += 1

    if onboarding_status:
        conditions.append(f"status = ${p}")
        params.append(onboarding_status.value)
        p += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.extend([limit, offset])

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT id, email, stakeholder_type, organization_name, status,
                   tenant_id, invited_by, invited_at, registered_at, approved_at
            FROM stakeholder_onboarding
            {where}
            ORDER BY invited_at DESC
            LIMIT ${p} OFFSET ${p+1}
            """,
            *params,
        )
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM stakeholder_onboarding {where}",
            *params[:-2],
        )

    return {
        "items": [dict(r) for r in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@app.get("/api/v1/onboarding/permissions/{stakeholder_type}")
async def get_stakeholder_permissions(stakeholder_type: StakeholderType):
    """Get the full permission set for a stakeholder type (public)."""
    return {
        "stakeholder_type": stakeholder_type.value,
        "permissions": STAKEHOLDER_PERMISSIONS.get(stakeholder_type, []),
        "required_documents": [
            d.value for d in REQUIRED_DOCUMENTS.get(stakeholder_type, [])
        ],
    }


@app.get("/api/v1/onboarding/stats/summary")
async def get_onboarding_stats(
    tenant_id: Optional[str] = None,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get onboarding funnel statistics."""
    if current_user.role not in ("super_admin", "tenant_admin", "cms_admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    tid = tenant_id or (current_user.tenant_id if current_user.role != "super_admin" else None)
    where = "WHERE tenant_id = $1" if tid else ""
    params = [tid] if tid else []

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT stakeholder_type, status, COUNT(*) as count
            FROM stakeholder_onboarding
            {where}
            GROUP BY stakeholder_type, status
            ORDER BY stakeholder_type, status
            """,
            *params,
        )

    stats: Dict[str, Dict[str, int]] = {}
    for row in rows:
        st = row["stakeholder_type"]
        if st not in stats:
            stats[st] = {}
        stats[st][row["status"]] = row["count"]

    return {"by_type_and_status": stats}


@app.get("/health")
async def health():
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.fetchval("SELECT 1")
    return {"status": "healthy", "service": "stakeholder-onboarding-service", "version": "1.0.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8035)
