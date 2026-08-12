"""
HealthPoint CDS Hooks Service
==============================
Implements the CDS Hooks 1.0 specification for clinical decision support.
Hooks fire from EHR workflows and return cards with NSA/IDR guidance.

Supported hooks:
  patient-view        — NSA eligibility check when a provider opens a patient chart
  order-sign          — GFE trigger when a provider signs an order for a non-emergency service
  appointment-book    — Coverage verification when scheduling an appointment
  encounter-discharge — IDR initiation reminder when discharging a patient with surprise billing

Spec: https://cds-hooks.org/specification/current/
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import asyncpg
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.shared.auth import get_current_user
from backend.shared.database import get_db_pool
from backend.shared.medplum_client import MedplumClient
from backend.shared.telemetry import setup_telemetry, instrument_fastapi
from backend.shared.security_middleware import add_security_middleware

logger = logging.getLogger(__name__)

app = FastAPI(
    title="CDS Hooks Service",
    description="Clinical Decision Support hooks for NSA/IDR guidance",
    version="1.0.0",
)

setup_telemetry("cds-hooks-service")
instrument_fastapi(app)
add_security_middleware(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "").split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

# ─── CDS Hooks Data Models ────────────────────────────────────────────────────

class CDSContext(BaseModel):
    patientId: Optional[str] = None
    encounterId: Optional[str] = None
    userId: Optional[str] = None
    draftOrders: Optional[Dict[str, Any]] = None
    appointments: Optional[Dict[str, Any]] = None


class CDSRequest(BaseModel):
    hookInstance: str
    hook: str
    fhirServer: Optional[str] = None
    fhirAuthorization: Optional[Dict[str, Any]] = None
    context: CDSContext
    prefetch: Optional[Dict[str, Any]] = None


class CDSLink(BaseModel):
    label: str
    url: str
    type: str = "absolute"
    appContext: Optional[str] = None


class CDSSuggestion(BaseModel):
    label: str
    uuid: Optional[str] = None
    actions: Optional[List[Dict[str, Any]]] = None


class CDSCard(BaseModel):
    summary: str
    detail: Optional[str] = None
    indicator: str = "info"  # info | warning | critical
    source: Dict[str, Any] = Field(default_factory=lambda: {
        "label": "HealthPoint NSA/IDR Platform",
        "url": "https://healthpoint.local",
        "icon": "https://healthpoint.local/icon.png",
    })
    suggestions: Optional[List[CDSSuggestion]] = None
    selectionBehavior: Optional[str] = None
    links: Optional[List[CDSLink]] = None


class CDSResponse(BaseModel):
    cards: List[CDSCard] = Field(default_factory=list)
    systemActions: Optional[List[Dict[str, Any]]] = None


# ─── Hook Implementations ─────────────────────────────────────────────────────

async def hook_patient_view(
    req: CDSRequest,
    pool: asyncpg.Pool,
    medplum: MedplumClient,
) -> CDSResponse:
    """
    patient-view: Fires when a provider opens a patient chart.
    Returns NSA eligibility status and any open IDR disputes.
    """
    patient_id = req.context.patientId
    cards: List[CDSCard] = []

    if not patient_id:
        return CDSResponse(cards=[])

    # Check for active IDR disputes for this patient
    async with pool.acquire() as conn:
        disputes = await conn.fetch(
            """
            SELECT d.id, d.status, d.service_date, d.disputed_amount,
                   d.service_category, d.created_at
            FROM idr_disputes d
            WHERE d.patient_fhir_id = $1
              AND d.status NOT IN ('resolved', 'withdrawn', 'closed')
            ORDER BY d.created_at DESC
            LIMIT 5
            """,
            patient_id,
        )

    if disputes:
        dispute_list = "\n".join(
            f"- Case {d['id']}: {d['service_category']} on {d['service_date']} "
            f"(${d['disputed_amount']:.2f}) — Status: {d['status']}"
            for d in disputes
        )
        cards.append(CDSCard(
            summary=f"⚠️ {len(disputes)} Active NSA/IDR Dispute(s)",
            detail=(
                f"This patient has {len(disputes)} open IDR dispute(s) under the "
                f"No Surprises Act:\n\n{dispute_list}\n\n"
                "Review before providing additional services to avoid new surprise billing."
            ),
            indicator="warning",
            links=[
                CDSLink(
                    label="View IDR Disputes",
                    url=f"https://healthpoint.local/disputes?patient={patient_id}",
                    type="absolute",
                )
            ],
        ))

    # Check NSA eligibility (patient must have qualifying coverage)
    try:
        coverages = await medplum.search_resources(
            "Coverage",
            {"beneficiary": f"Patient/{patient_id}", "status": "active"},
        )
        if not coverages:
            cards.append(CDSCard(
                summary="⚠️ No Active Coverage Found",
                detail=(
                    "No active insurance coverage was found for this patient. "
                    "NSA protections apply to patients with group health plans or individual "
                    "market coverage. Verify coverage before providing services."
                ),
                indicator="warning",
            ))
        else:
            # Check if any coverage is NSA-qualifying
            nsa_qualifying = any(
                c.get("type", {}).get("coding", [{}])[0].get("code") in
                ("HMO", "PPO", "EPO", "POS", "HDHP", "group")
                for c in coverages
            )
            if nsa_qualifying:
                cards.append(CDSCard(
                    summary="✅ NSA Coverage Active",
                    detail=(
                        f"Patient has {len(coverages)} active qualifying coverage plan(s). "
                        "NSA protections apply. A Good Faith Estimate (GFE) is required "
                        "for scheduled services ≥3 business days in advance."
                    ),
                    indicator="info",
                    links=[
                        CDSLink(
                            label="Generate GFE",
                            url=f"https://healthpoint.local/gfe/new?patient={patient_id}",
                            type="absolute",
                        )
                    ],
                ))
    except Exception as e:
        logger.warning(f"Could not check coverage for patient {patient_id}: {e}")

    return CDSResponse(cards=cards)


async def hook_order_sign(
    req: CDSRequest,
    pool: asyncpg.Pool,
    medplum: MedplumClient,
) -> CDSResponse:
    """
    order-sign: Fires when a provider signs an order.
    Triggers GFE generation for non-emergency scheduled services.
    """
    cards: List[CDSCard] = []
    draft_orders = req.context.draftOrders or {}
    patient_id = req.context.patientId

    # Extract orders from the Bundle
    entries = draft_orders.get("entry", [])
    service_requests = [
        e.get("resource", {})
        for e in entries
        if e.get("resource", {}).get("resourceType") == "ServiceRequest"
    ]

    for sr in service_requests:
        # Check if this is a scheduled (non-emergency) service
        priority = sr.get("priority", "routine")
        if priority == "stat":
            continue  # Emergency — NSA GFE not required

        service_code = (
            sr.get("code", {}).get("coding", [{}])[0].get("code", "")
        )
        service_display = (
            sr.get("code", {}).get("coding", [{}])[0].get("display", "Unknown service")
        )

        # Check if a GFE already exists for this service + patient
        async with pool.acquire() as conn:
            existing_gfe = await conn.fetchrow(
                """
                SELECT id FROM gfe_records
                WHERE patient_fhir_id = $1
                  AND service_code = $2
                  AND created_at > NOW() - INTERVAL '90 days'
                  AND status = 'active'
                LIMIT 1
                """,
                patient_id, service_code,
            )

        if existing_gfe:
            cards.append(CDSCard(
                summary=f"✅ GFE Already Exists for {service_display}",
                detail=(
                    f"A Good Faith Estimate (GFE-{existing_gfe['id']}) is on file for "
                    f"{service_display}. No new GFE is required unless the service "
                    "date or scope has changed significantly."
                ),
                indicator="info",
            ))
        else:
            # GFE required — prompt provider to generate one
            cards.append(CDSCard(
                summary=f"📋 GFE Required: {service_display}",
                detail=(
                    f"Under the No Surprises Act (45 CFR §149.610), a Good Faith Estimate "
                    f"must be provided to the patient at least 3 business days before "
                    f"scheduling {service_display}. "
                    "Click 'Generate GFE' to create one now."
                ),
                indicator="warning",
                suggestions=[
                    CDSSuggestion(
                        label=f"Generate GFE for {service_display}",
                        actions=[
                            {
                                "type": "create",
                                "description": "Create GFE",
                                "resource": {
                                    "resourceType": "Task",
                                    "status": "requested",
                                    "intent": "order",
                                    "code": {
                                        "coding": [
                                            {
                                                "system": "http://healthpoint.local/fhir/CodeSystem/idr-task-type",
                                                "code": "generate-gfe",
                                            }
                                        ]
                                    },
                                    "for": {"reference": f"Patient/{patient_id}"},
                                    "focus": {"reference": f"ServiceRequest/{sr.get('id', 'unknown')}"},
                                },
                            }
                        ],
                    )
                ],
                links=[
                    CDSLink(
                        label="Generate GFE Now",
                        url=f"https://healthpoint.local/gfe/new?patient={patient_id}&service={service_code}",
                        type="absolute",
                    )
                ],
            ))

    return CDSResponse(cards=cards)


async def hook_appointment_book(
    req: CDSRequest,
    pool: asyncpg.Pool,
    medplum: MedplumClient,
) -> CDSResponse:
    """
    appointment-book: Fires when scheduling an appointment.
    Verifies coverage and checks for NSA network status.
    """
    cards: List[CDSCard] = []
    patient_id = req.context.patientId
    appointments = req.context.appointments or {}

    entries = appointments.get("entry", [])
    appt_resources = [
        e.get("resource", {})
        for e in entries
        if e.get("resource", {}).get("resourceType") == "Appointment"
    ]

    for appt in appt_resources:
        # Get the practitioner from the appointment participants
        practitioners = [
            p for p in appt.get("participant", [])
            if p.get("actor", {}).get("reference", "").startswith("Practitioner/")
        ]

        for participant in practitioners:
            practitioner_ref = participant.get("actor", {}).get("reference", "")
            practitioner_id = practitioner_ref.replace("Practitioner/", "")

            # Check network status for this practitioner
            async with pool.acquire() as conn:
                network_status = await conn.fetchrow(
                    """
                    SELECT network_status, plan_name, effective_date
                    FROM provider_network_status
                    WHERE practitioner_fhir_id = $1
                    ORDER BY effective_date DESC
                    LIMIT 1
                    """,
                    practitioner_id,
                )

            if network_status and network_status["network_status"] == "out_of_network":
                cards.append(CDSCard(
                    summary="⚠️ Out-of-Network Provider",
                    detail=(
                        f"The selected provider is **out-of-network** for the patient's "
                        f"plan ({network_status['plan_name']}). Under the No Surprises Act, "
                        "the patient's cost-sharing cannot exceed in-network rates for "
                        "emergency services and certain non-emergency services at in-network "
                        "facilities. A GFE and consent notice are required."
                    ),
                    indicator="critical",
                    links=[
                        CDSLink(
                            label="NSA Consent Notice Template",
                            url="https://healthpoint.local/templates/nsa-consent-notice",
                            type="absolute",
                        ),
                        CDSLink(
                            label="Generate GFE",
                            url=f"https://healthpoint.local/gfe/new?patient={patient_id}",
                            type="absolute",
                        ),
                    ],
                ))
            elif not network_status:
                cards.append(CDSCard(
                    summary="ℹ️ Network Status Unknown",
                    detail=(
                        "Network status for this provider could not be verified. "
                        "Please confirm with the payer before scheduling to ensure "
                        "correct patient cost-sharing under the No Surprises Act."
                    ),
                    indicator="info",
                ))

    return CDSResponse(cards=cards)


async def hook_encounter_discharge(
    req: CDSRequest,
    pool: asyncpg.Pool,
    medplum: MedplumClient,
) -> CDSResponse:
    """
    encounter-discharge: Fires when discharging a patient.
    Checks for potential surprise billing and prompts IDR initiation if needed.
    """
    cards: List[CDSCard] = []
    patient_id = req.context.patientId
    encounter_id = req.context.encounterId

    if not encounter_id:
        return CDSResponse(cards=[])

    # Check if there are any out-of-network charges for this encounter
    async with pool.acquire() as conn:
        oon_charges = await conn.fetch(
            """
            SELECT ci.procedure_code, ci.unit_price, ci.service_date
            FROM hl7_charge_items ci
            JOIN provider_network_status pns ON ci.sending_facility = pns.facility_npi
            WHERE ci.encounter_id = $1
              AND pns.network_status = 'out_of_network'
            """,
            encounter_id,
        )

    if oon_charges:
        total_oon = sum(c["unit_price"] for c in oon_charges)
        cards.append(CDSCard(
            summary=f"⚠️ Potential Surprise Bill: ${total_oon:.2f}",
            detail=(
                f"This encounter has {len(oon_charges)} out-of-network charge(s) totaling "
                f"${total_oon:.2f}. Under the No Surprises Act, the patient may be eligible "
                "for NSA protections. Initiate IDR if the payer's payment is below the QPA."
            ),
            indicator="warning",
            links=[
                CDSLink(
                    label="Initiate IDR Dispute",
                    url=f"https://healthpoint.local/disputes/new?patient={patient_id}&encounter={encounter_id}",
                    type="absolute",
                )
            ],
        ))

    return CDSResponse(cards=cards)


# ─── CDS Hooks Discovery & Dispatch ──────────────────────────────────────────

HOOK_REGISTRY = {
    "patient-view": hook_patient_view,
    "order-sign": hook_order_sign,
    "appointment-book": hook_appointment_book,
    "encounter-discharge": hook_encounter_discharge,
}


@app.on_event("startup")
async def startup() -> None:
    app.state.pool = await get_db_pool()
    app.state.medplum = MedplumClient(
        base_url=os.getenv("MEDPLUM_BASE_URL", "http://medplum:8103"),
        client_id=os.getenv("MEDPLUM_CLIENT_ID", ""),
        client_secret=os.getenv("MEDPLUM_CLIENT_SECRET", ""),
    )
    await app.state.medplum.authenticate()
    logger.info("CDS Hooks Service started.")


@app.get("/cds-services")
async def discovery() -> Dict[str, Any]:
    """CDS Hooks discovery endpoint — returns all registered hooks."""
    return {
        "services": [
            {
                "hook": "patient-view",
                "id": "healthpoint-patient-view",
                "title": "HealthPoint NSA Eligibility Check",
                "description": "Checks NSA eligibility and active IDR disputes when opening a patient chart.",
                "prefetch": {
                    "patient": "Patient/{{context.patientId}}",
                    "coverage": "Coverage?beneficiary={{context.patientId}}&status=active",
                },
            },
            {
                "hook": "order-sign",
                "id": "healthpoint-order-sign",
                "title": "HealthPoint GFE Trigger",
                "description": "Prompts GFE generation when signing orders for non-emergency scheduled services.",
                "prefetch": {
                    "patient": "Patient/{{context.patientId}}",
                },
            },
            {
                "hook": "appointment-book",
                "id": "healthpoint-appointment-book",
                "title": "HealthPoint Coverage Verification",
                "description": "Verifies network status and NSA coverage when booking an appointment.",
                "prefetch": {
                    "patient": "Patient/{{context.patientId}}",
                    "coverage": "Coverage?beneficiary={{context.patientId}}&status=active",
                },
            },
            {
                "hook": "encounter-discharge",
                "id": "healthpoint-encounter-discharge",
                "title": "HealthPoint Surprise Bill Check",
                "description": "Checks for out-of-network charges and prompts IDR initiation at discharge.",
            },
        ]
    }


@app.post("/cds-services/{hook_id}")
async def invoke_hook(hook_id: str, request: Request) -> CDSResponse:
    """Invoke a CDS Hook by ID."""
    try:
        body = await request.json()
        cds_request = CDSRequest(**body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid CDS Hooks request: {e}")

    # Map hook_id to hook name
    hook_name_map = {
        "healthpoint-patient-view": "patient-view",
        "healthpoint-order-sign": "order-sign",
        "healthpoint-appointment-book": "appointment-book",
        "healthpoint-encounter-discharge": "encounter-discharge",
    }
    hook_name = hook_name_map.get(hook_id, hook_id)
    handler = HOOK_REGISTRY.get(hook_name)

    if not handler:
        raise HTTPException(status_code=404, detail=f"Hook '{hook_id}' not found.")

    try:
        response = await handler(cds_request, app.state.pool, app.state.medplum)
        return response
    except Exception as e:
        logger.error(f"CDS Hook {hook_id} error: {e}", exc_info=True)
        # Return empty cards on error — never break the EHR workflow
        return CDSResponse(cards=[])


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok", "service": "cds-hooks-service"}
