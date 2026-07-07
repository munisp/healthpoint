"""
HealthPoint FHIR IDR Workflow Bridge
======================================
Maps every IDR workflow step to the corresponding FHIR R4 resource and
persists it to Medplum. This module is the single integration point between
HealthPoint's PostgreSQL-backed IDR workflow and the Medplum FHIR R4 server.

Resource Mapping:
  IDR Concept                  → FHIR R4 Resource
  ─────────────────────────────────────────────────
  Patient / Member             → Patient
  Provider / Facility          → Practitioner + Organization
  Insurance Plan               → Coverage + InsurancePlan
  GFE (Good Faith Estimate)    → Claim (type: predetermination)
  NSA IDR Dispute              → Claim (type: institutional/professional)
  IDR Determination            → ExplanationOfBenefit
  Payment                      → PaymentReconciliation + PaymentNotice
  Appeal                       → Task (intent: order, code: appeal)
  Admin Fee                    → Invoice + ChargeItem
  Supporting Document          → DocumentReference + Binary
  Negotiation Offer            → Communication
  CMS Submission               → Task (intent: proposal, code: cms-submission)
  Audit Event                  → AuditEvent
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from .medplum_client import FHIROperationError, MedplumClient, get_medplum_client

logger = logging.getLogger(__name__)

HEALTHPOINT_SYSTEM = "http://healthpoint.local"
NSA_SYSTEM = "http://cms.gov/nsa"
NPI_SYSTEM = "http://hl7.org/fhir/sid/us-npi"
TAXONOMY_SYSTEM = "http://nucc.org/provider-taxonomy"
CPT_SYSTEM = "http://www.ama-assn.org/go/cpt"
ICD10_SYSTEM = "http://hl7.org/fhir/sid/icd-10-cm"
HCPCS_SYSTEM = "https://www.cms.gov/Medicare/Coding/HCPCSReleaseCodeSets"


# ─── Patient Resource ─────────────────────────────────────────────────────────

async def upsert_patient_resource(
    patient_data: Dict[str, Any],
    *,
    client: Optional[MedplumClient] = None,
) -> Dict[str, Any]:
    """
    Create or update a FHIR Patient resource from HealthPoint patient data.
    Uses member_id as the identifier for idempotent upsert.
    """
    c = client or await get_medplum_client()

    member_id = patient_data.get("member_id") or patient_data.get("id")
    if not member_id:
        raise ValueError("patient_data must include member_id or id")

    # Build FHIR R4 Patient resource
    resource: Dict[str, Any] = {
        "resourceType": "Patient",
        "identifier": [
            {
                "system": f"{HEALTHPOINT_SYSTEM}/member-id",
                "value": str(member_id),
            }
        ],
        "active": True,
        "name": [],
        "telecom": [],
        "address": [],
        "communication": [],
    }

    # Name
    family = patient_data.get("last_name") or patient_data.get("family_name")
    given = patient_data.get("first_name") or patient_data.get("given_name")
    if family or given:
        name_entry: Dict[str, Any] = {"use": "official"}
        if family:
            name_entry["family"] = family
        if given:
            name_entry["given"] = [given]
        middle = patient_data.get("middle_name")
        if middle:
            name_entry.setdefault("given", []).append(middle)
        resource["name"].append(name_entry)

    # Birth date
    dob = patient_data.get("date_of_birth") or patient_data.get("dob")
    if dob:
        resource["birthDate"] = str(dob)[:10]

    # Gender
    gender_map = {"M": "male", "F": "female", "male": "male", "female": "female", "other": "other", "unknown": "unknown"}
    gender = patient_data.get("gender") or patient_data.get("sex")
    if gender:
        resource["gender"] = gender_map.get(str(gender).upper(), gender_map.get(str(gender).lower(), "unknown"))

    # Phone
    phone = patient_data.get("phone") or patient_data.get("phone_number")
    if phone:
        resource["telecom"].append({"system": "phone", "value": str(phone), "use": "home"})

    # Email
    email = patient_data.get("email")
    if email:
        resource["telecom"].append({"system": "email", "value": str(email)})

    # Address
    addr = patient_data.get("address") or {}
    if isinstance(addr, str):
        addr = {"line": [addr]}
    if addr:
        address_entry: Dict[str, Any] = {"use": "home", "type": "physical"}
        if addr.get("line") or addr.get("address_line1"):
            lines = addr.get("line") or [addr.get("address_line1", "")]
            if addr.get("address_line2"):
                lines.append(addr["address_line2"])
            address_entry["line"] = lines
        if addr.get("city"):
            address_entry["city"] = addr["city"]
        if addr.get("state"):
            address_entry["state"] = addr["state"]
        if addr.get("zip") or addr.get("postal_code"):
            address_entry["postalCode"] = addr.get("zip") or addr.get("postal_code")
        if addr.get("country"):
            address_entry["country"] = addr["country"]
        resource["address"].append(address_entry)

    # Additional identifiers (SSN, insurance ID)
    ssn = patient_data.get("ssn")
    if ssn:
        resource["identifier"].append({
            "system": "http://hl7.org/fhir/sid/us-ssn",
            "value": ssn,
        })

    insurance_id = patient_data.get("insurance_id") or patient_data.get("subscriber_id")
    if insurance_id:
        resource["identifier"].append({
            "system": f"{HEALTHPOINT_SYSTEM}/insurance-id",
            "value": str(insurance_id),
        })

    return await c.upsert_resource(
        "Patient",
        resource,
        identifier_system=f"{HEALTHPOINT_SYSTEM}/member-id",
        identifier_value=str(member_id),
    )


# ─── Practitioner Resource ────────────────────────────────────────────────────

async def upsert_practitioner_resource(
    provider_data: Dict[str, Any],
    *,
    client: Optional[MedplumClient] = None,
) -> Dict[str, Any]:
    """Create or update a FHIR Practitioner from HealthPoint provider data."""
    c = client or await get_medplum_client()

    npi = provider_data.get("npi") or provider_data.get("provider_npi")
    if not npi:
        raise ValueError("provider_data must include npi")

    resource: Dict[str, Any] = {
        "resourceType": "Practitioner",
        "identifier": [{"system": NPI_SYSTEM, "value": str(npi)}],
        "active": True,
        "name": [],
        "qualification": [],
    }

    # Name
    family = provider_data.get("last_name") or provider_data.get("provider_last_name")
    given = provider_data.get("first_name") or provider_data.get("provider_first_name")
    if family or given:
        name_entry: Dict[str, Any] = {"use": "official"}
        if family:
            name_entry["family"] = family
        if given:
            name_entry["given"] = [given]
        resource["name"].append(name_entry)

    # Specialty / taxonomy
    taxonomy = provider_data.get("taxonomy_code") or provider_data.get("specialty_code")
    if taxonomy:
        resource["qualification"].append({
            "code": {
                "coding": [{"system": TAXONOMY_SYSTEM, "code": taxonomy}]
            }
        })

    return await c.upsert_resource(
        "Practitioner",
        resource,
        identifier_system=NPI_SYSTEM,
        identifier_value=str(npi),
    )


# ─── Organization Resource ────────────────────────────────────────────────────

async def upsert_organization_resource(
    org_data: Dict[str, Any],
    *,
    client: Optional[MedplumClient] = None,
) -> Dict[str, Any]:
    """Create or update a FHIR Organization from HealthPoint payer/facility data."""
    c = client or await get_medplum_client()

    org_id = org_data.get("organization_id") or org_data.get("payer_id") or org_data.get("facility_id")
    if not org_id:
        raise ValueError("org_data must include organization_id, payer_id, or facility_id")

    resource: Dict[str, Any] = {
        "resourceType": "Organization",
        "identifier": [
            {"system": f"{HEALTHPOINT_SYSTEM}/org-id", "value": str(org_id)}
        ],
        "active": True,
        "name": org_data.get("name") or org_data.get("organization_name") or "Unknown Organization",
        "type": [],
        "telecom": [],
        "address": [],
    }

    # NPI for facilities
    npi = org_data.get("npi") or org_data.get("facility_npi")
    if npi:
        resource["identifier"].append({"system": NPI_SYSTEM, "value": str(npi)})

    # Type (payer vs provider organization)
    org_type = org_data.get("type", "prov")
    resource["type"].append({
        "coding": [{
            "system": "http://terminology.hl7.org/CodeSystem/organization-type",
            "code": org_type,
        }]
    })

    return await c.upsert_resource(
        "Organization",
        resource,
        identifier_system=f"{HEALTHPOINT_SYSTEM}/org-id",
        identifier_value=str(org_id),
    )


# ─── Coverage Resource ────────────────────────────────────────────────────────

async def upsert_coverage_resource(
    coverage_data: Dict[str, Any],
    patient_fhir_id: str,
    payer_fhir_id: str,
    *,
    client: Optional[MedplumClient] = None,
) -> Dict[str, Any]:
    """Create or update a FHIR Coverage resource."""
    c = client or await get_medplum_client()

    coverage_id = coverage_data.get("coverage_id") or coverage_data.get("policy_id")
    if not coverage_id:
        raise ValueError("coverage_data must include coverage_id or policy_id")

    resource: Dict[str, Any] = {
        "resourceType": "Coverage",
        "identifier": [
            {"system": f"{HEALTHPOINT_SYSTEM}/coverage-id", "value": str(coverage_id)}
        ],
        "status": "active",
        "type": {
            "coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                "code": coverage_data.get("coverage_type", "HIP"),
                "display": coverage_data.get("plan_type", "Health Insurance Plan Policy"),
            }]
        },
        "subscriber": {"reference": f"Patient/{patient_fhir_id}"},
        "beneficiary": {"reference": f"Patient/{patient_fhir_id}"},
        "payor": [{"reference": f"Organization/{payer_fhir_id}"}],
        "subscriberId": coverage_data.get("subscriber_id") or coverage_data.get("member_id", ""),
    }

    # Plan period
    start = coverage_data.get("effective_date") or coverage_data.get("start_date")
    end = coverage_data.get("termination_date") or coverage_data.get("end_date")
    if start or end:
        period: Dict[str, Any] = {}
        if start:
            period["start"] = str(start)[:10]
        if end:
            period["end"] = str(end)[:10]
        resource["period"] = period

    # Group / plan info
    group_id = coverage_data.get("group_id") or coverage_data.get("group_number")
    plan_id = coverage_data.get("plan_id") or coverage_data.get("plan_number")
    if group_id or plan_id:
        class_list = []
        if group_id:
            class_list.append({
                "type": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/coverage-class", "code": "group"}]},
                "value": str(group_id),
            })
        if plan_id:
            class_list.append({
                "type": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/coverage-class", "code": "plan"}]},
                "value": str(plan_id),
            })
        resource["class"] = class_list

    return await c.upsert_resource(
        "Coverage",
        resource,
        identifier_system=f"{HEALTHPOINT_SYSTEM}/coverage-id",
        identifier_value=str(coverage_id),
    )


# ─── GFE → FHIR Claim (predetermination) ─────────────────────────────────────

async def create_gfe_claim(
    gfe_data: Dict[str, Any],
    patient_fhir_id: str,
    provider_fhir_id: str,
    coverage_fhir_id: str,
    *,
    client: Optional[MedplumClient] = None,
) -> Dict[str, Any]:
    """
    Map a Good Faith Estimate to a FHIR Claim resource (use: predetermination).
    Per 45 CFR §149.610, GFEs must be provided before scheduled services.
    """
    c = client or await get_medplum_client()

    gfe_id = gfe_data.get("gfe_id") or str(uuid4())
    service_date = gfe_data.get("service_date") or datetime.now(timezone.utc).date().isoformat()

    claim: Dict[str, Any] = {
        "resourceType": "Claim",
        "identifier": [
            {"system": f"{HEALTHPOINT_SYSTEM}/gfe-id", "value": str(gfe_id)}
        ],
        "status": "active",
        "type": {
            "coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/claim-type",
                "code": gfe_data.get("claim_type", "professional"),
            }]
        },
        "use": "predetermination",
        "patient": {"reference": f"Patient/{patient_fhir_id}"},
        "created": datetime.now(timezone.utc).isoformat(),
        "provider": {"reference": f"Practitioner/{provider_fhir_id}"},
        "priority": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/processpriority", "code": "normal"}]},
        "insurance": [{
            "sequence": 1,
            "focal": True,
            "coverage": {"reference": f"Coverage/{coverage_fhir_id}"},
        }],
        "item": [],
        "total": {
            "value": float(gfe_data.get("total_estimated_cost", 0)),
            "currency": "USD",
        },
    }

    # Service line items
    for idx, item in enumerate(gfe_data.get("service_items", []), start=1):
        line_item: Dict[str, Any] = {
            "sequence": idx,
            "productOrService": {
                "coding": [{
                    "system": CPT_SYSTEM if item.get("code_type", "CPT") == "CPT" else HCPCS_SYSTEM,
                    "code": item.get("procedure_code") or item.get("service_code", ""),
                    "display": item.get("description", ""),
                }]
            },
            "servicedDate": str(item.get("service_date", service_date))[:10],
            "unitPrice": {
                "value": float(item.get("unit_cost", 0)),
                "currency": "USD",
            },
            "quantity": {"value": float(item.get("quantity", 1))},
            "net": {
                "value": float(item.get("total_cost", 0)),
                "currency": "USD",
            },
        }

        # Diagnosis codes
        if item.get("diagnosis_code"):
            line_item["diagnosisSequence"] = [1]

        claim["item"].append(line_item)

    # Diagnosis
    if gfe_data.get("diagnosis_codes"):
        claim["diagnosis"] = [
            {
                "sequence": idx,
                "diagnosisCodeableConcept": {
                    "coding": [{"system": ICD10_SYSTEM, "code": code}]
                },
            }
            for idx, code in enumerate(gfe_data["diagnosis_codes"], start=1)
        ]

    return await c.create_resource("Claim", claim)


# ─── IDR Dispute → FHIR Claim ─────────────────────────────────────────────────

async def create_idr_dispute_claim(
    dispute_data: Dict[str, Any],
    patient_fhir_id: str,
    provider_fhir_id: str,
    coverage_fhir_id: str,
    *,
    client: Optional[MedplumClient] = None,
) -> Dict[str, Any]:
    """
    Map an NSA IDR dispute to a FHIR Claim resource (use: claim).
    This represents the billed claim that triggered the IDR process.
    """
    c = client or await get_medplum_client()

    dispute_id = dispute_data.get("dispute_id") or str(uuid4())

    claim: Dict[str, Any] = {
        "resourceType": "Claim",
        "identifier": [
            {"system": f"{HEALTHPOINT_SYSTEM}/dispute-id", "value": str(dispute_id)},
            {"system": f"{NSA_SYSTEM}/idr-case-id", "value": dispute_data.get("idr_case_id", "")},
        ],
        "status": "active",
        "type": {
            "coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/claim-type",
                "code": dispute_data.get("claim_type", "professional"),
            }]
        },
        "use": "claim",
        "patient": {"reference": f"Patient/{patient_fhir_id}"},
        "created": datetime.now(timezone.utc).isoformat(),
        "provider": {"reference": f"Practitioner/{provider_fhir_id}"},
        "priority": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/processpriority", "code": "normal"}]},
        "insurance": [{
            "sequence": 1,
            "focal": True,
            "coverage": {"reference": f"Coverage/{coverage_fhir_id}"},
        }],
        "item": [],
        "total": {
            "value": float(dispute_data.get("billed_amount", 0)),
            "currency": "USD",
        },
        "extension": [
            {
                "url": f"{HEALTHPOINT_SYSTEM}/fhir/extension/nsa-qpa",
                "valueMoney": {
                    "value": float(dispute_data.get("qpa_amount", 0)),
                    "currency": "USD",
                },
            },
            {
                "url": f"{HEALTHPOINT_SYSTEM}/fhir/extension/idr-status",
                "valueString": dispute_data.get("status", "initiated"),
            },
        ],
    }

    # Service items
    for idx, item in enumerate(dispute_data.get("service_items", []), start=1):
        claim["item"].append({
            "sequence": idx,
            "productOrService": {
                "coding": [{
                    "system": CPT_SYSTEM,
                    "code": item.get("procedure_code", ""),
                    "display": item.get("description", ""),
                }]
            },
            "servicedDate": str(item.get("service_date", ""))[:10] or datetime.now(timezone.utc).date().isoformat(),
            "unitPrice": {"value": float(item.get("billed_amount", 0)), "currency": "USD"},
            "quantity": {"value": float(item.get("quantity", 1))},
            "net": {"value": float(item.get("total_billed", 0)), "currency": "USD"},
        })

    return await c.create_resource("Claim", claim)


# ─── IDR Determination → ExplanationOfBenefit ────────────────────────────────

async def create_determination_eob(
    determination_data: Dict[str, Any],
    claim_fhir_id: str,
    patient_fhir_id: str,
    provider_fhir_id: str,
    coverage_fhir_id: str,
    *,
    client: Optional[MedplumClient] = None,
) -> Dict[str, Any]:
    """
    Map an IDR determination to a FHIR ExplanationOfBenefit resource.
    The EOB represents the final adjudication result per 42 CFR §149.510(e).
    """
    c = client or await get_medplum_client()

    eob: Dict[str, Any] = {
        "resourceType": "ExplanationOfBenefit",
        "identifier": [
            {
                "system": f"{HEALTHPOINT_SYSTEM}/determination-id",
                "value": str(determination_data.get("determination_id", uuid4())),
            }
        ],
        "status": "active",
        "type": {
            "coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/claim-type",
                "code": determination_data.get("claim_type", "professional"),
            }]
        },
        "use": "claim",
        "patient": {"reference": f"Patient/{patient_fhir_id}"},
        "created": datetime.now(timezone.utc).isoformat(),
        "insurer": {"reference": f"Organization/{determination_data.get('payer_fhir_id', 'unknown')}"},
        "provider": {"reference": f"Practitioner/{provider_fhir_id}"},
        "claim": {"reference": f"Claim/{claim_fhir_id}"},
        "outcome": "complete",
        "insurance": [{
            "focal": True,
            "coverage": {"reference": f"Coverage/{coverage_fhir_id}"},
        }],
        "item": [],
        "total": [
            {
                "category": {
                    "coding": [{"system": "http://terminology.hl7.org/CodeSystem/adjudication", "code": "submitted"}]
                },
                "amount": {"value": float(determination_data.get("billed_amount", 0)), "currency": "USD"},
            },
            {
                "category": {
                    "coding": [{"system": "http://terminology.hl7.org/CodeSystem/adjudication", "code": "benefit"}]
                },
                "amount": {"value": float(determination_data.get("determined_amount", 0)), "currency": "USD"},
            },
        ],
        "payment": {
            "type": {
                "coding": [{"system": "http://terminology.hl7.org/CodeSystem/ex-paymenttype", "code": "complete"}]
            },
            "amount": {"value": float(determination_data.get("determined_amount", 0)), "currency": "USD"},
            "date": str(determination_data.get("payment_due_date", ""))[:10] or datetime.now(timezone.utc).date().isoformat(),
        },
        "extension": [
            {
                "url": f"{HEALTHPOINT_SYSTEM}/fhir/extension/idr-winner",
                "valueString": determination_data.get("winner", ""),
            },
            {
                "url": f"{HEALTHPOINT_SYSTEM}/fhir/extension/qpa-amount",
                "valueMoney": {
                    "value": float(determination_data.get("qpa_amount", 0)),
                    "currency": "USD",
                },
            },
            {
                "url": f"{HEALTHPOINT_SYSTEM}/fhir/extension/idr-entity-id",
                "valueString": determination_data.get("idr_entity_id", ""),
            },
        ],
    }

    return await c.create_resource("ExplanationOfBenefit", eob)


# ─── Payment → PaymentReconciliation ─────────────────────────────────────────

async def create_payment_reconciliation(
    payment_data: Dict[str, Any],
    eob_fhir_id: str,
    *,
    client: Optional[MedplumClient] = None,
) -> Dict[str, Any]:
    """
    Map an IDR payment to a FHIR PaymentReconciliation resource.
    Represents the actual payment made after determination.
    """
    c = client or await get_medplum_client()

    recon: Dict[str, Any] = {
        "resourceType": "PaymentReconciliation",
        "identifier": [
            {
                "system": f"{HEALTHPOINT_SYSTEM}/payment-id",
                "value": str(payment_data.get("payment_id", uuid4())),
            }
        ],
        "status": "active",
        "period": {
            "start": str(payment_data.get("payment_date", ""))[:10] or datetime.now(timezone.utc).date().isoformat(),
            "end": str(payment_data.get("payment_date", ""))[:10] or datetime.now(timezone.utc).date().isoformat(),
        },
        "created": datetime.now(timezone.utc).isoformat(),
        "paymentIssuer": {
            "reference": f"Organization/{payment_data.get('payer_fhir_id', 'unknown')}"
        },
        "request": {"reference": f"ExplanationOfBenefit/{eob_fhir_id}"},
        "outcome": "complete",
        "paymentDate": str(payment_data.get("payment_date", ""))[:10] or datetime.now(timezone.utc).date().isoformat(),
        "paymentAmount": {
            "value": float(payment_data.get("amount", 0)),
            "currency": "USD",
        },
        "detail": [
            {
                "type": {
                    "coding": [{"system": "http://terminology.hl7.org/CodeSystem/payment-type", "code": "payment"}]
                },
                "request": {"reference": f"ExplanationOfBenefit/{eob_fhir_id}"},
                "amount": {"value": float(payment_data.get("amount", 0)), "currency": "USD"},
                "date": str(payment_data.get("payment_date", ""))[:10] or datetime.now(timezone.utc).date().isoformat(),
            }
        ],
        "extension": [
            {
                "url": f"{HEALTHPOINT_SYSTEM}/fhir/extension/payment-method",
                "valueString": payment_data.get("payment_method", "ach"),
            },
            {
                "url": f"{HEALTHPOINT_SYSTEM}/fhir/extension/tigerbeetle-transfer-id",
                "valueString": str(payment_data.get("tigerbeetle_transfer_id", "")),
            },
        ],
    }

    return await c.create_resource("PaymentReconciliation", recon)


# ─── Appeal → FHIR Task ───────────────────────────────────────────────────────

async def create_appeal_task(
    appeal_data: Dict[str, Any],
    eob_fhir_id: str,
    patient_fhir_id: str,
    *,
    client: Optional[MedplumClient] = None,
) -> Dict[str, Any]:
    """
    Map an IDR appeal to a FHIR Task resource.
    Task.code = appeal, Task.intent = order, Task.basedOn = ExplanationOfBenefit
    """
    c = client or await get_medplum_client()

    status_map = {
        "submitted": "requested",
        "under_review": "in-progress",
        "resolved": "completed",
        "denied": "rejected",
        "withdrawn": "cancelled",
    }

    task: Dict[str, Any] = {
        "resourceType": "Task",
        "identifier": [
            {
                "system": f"{HEALTHPOINT_SYSTEM}/appeal-id",
                "value": str(appeal_data.get("appeal_id", uuid4())),
            }
        ],
        "status": status_map.get(appeal_data.get("status", "submitted"), "requested"),
        "intent": "order",
        "code": {
            "coding": [{
                "system": f"{HEALTHPOINT_SYSTEM}/fhir/CodeSystem/task-type",
                "code": "idr-appeal",
                "display": "IDR Appeal",
            }]
        },
        "description": appeal_data.get("reason", "NSA IDR appeal"),
        "for": {"reference": f"Patient/{patient_fhir_id}"},
        "basedOn": [{"reference": f"ExplanationOfBenefit/{eob_fhir_id}"}],
        "authoredOn": datetime.now(timezone.utc).isoformat(),
        "lastModified": datetime.now(timezone.utc).isoformat(),
        "input": [
            {
                "type": {"coding": [{"system": f"{HEALTHPOINT_SYSTEM}/fhir/CodeSystem/task-input", "code": "appeal-grounds"}]},
                "valueString": appeal_data.get("grounds", ""),
            },
            {
                "type": {"coding": [{"system": f"{HEALTHPOINT_SYSTEM}/fhir/CodeSystem/task-input", "code": "appeal-type"}]},
                "valueString": appeal_data.get("appeal_type", "standard"),
            },
        ],
    }

    # Deadline
    deadline = appeal_data.get("deadline") or appeal_data.get("response_deadline")
    if deadline:
        task["restriction"] = {
            "period": {"end": str(deadline)[:10]}
        }

    return await c.create_resource("Task", task)


# ─── CMS Submission → FHIR Task ───────────────────────────────────────────────

async def create_cms_submission_task(
    submission_data: Dict[str, Any],
    claim_fhir_id: str,
    *,
    client: Optional[MedplumClient] = None,
) -> Dict[str, Any]:
    """Map a CMS IDR portal submission to a FHIR Task resource."""
    c = client or await get_medplum_client()

    status_map = {
        "pending": "requested",
        "submitted": "in-progress",
        "accepted": "completed",
        "rejected": "rejected",
        "withdrawn": "cancelled",
    }

    task: Dict[str, Any] = {
        "resourceType": "Task",
        "identifier": [
            {
                "system": f"{HEALTHPOINT_SYSTEM}/cms-submission-id",
                "value": str(submission_data.get("submission_id", uuid4())),
            }
        ],
        "status": status_map.get(submission_data.get("status", "pending"), "requested"),
        "intent": "proposal",
        "code": {
            "coding": [{
                "system": f"{HEALTHPOINT_SYSTEM}/fhir/CodeSystem/task-type",
                "code": "cms-idr-submission",
                "display": "CMS IDR Portal Submission",
            }]
        },
        "description": f"CMS IDR submission for dispute {submission_data.get('dispute_id', '')}",
        "basedOn": [{"reference": f"Claim/{claim_fhir_id}"}],
        "authoredOn": datetime.now(timezone.utc).isoformat(),
        "lastModified": datetime.now(timezone.utc).isoformat(),
        "input": [
            {
                "type": {"coding": [{"system": f"{HEALTHPOINT_SYSTEM}/fhir/CodeSystem/task-input", "code": "cms-case-id"}]},
                "valueString": submission_data.get("cms_case_id", ""),
            },
            {
                "type": {"coding": [{"system": f"{HEALTHPOINT_SYSTEM}/fhir/CodeSystem/task-input", "code": "submission-deadline"}]},
                "valueDate": str(submission_data.get("deadline", ""))[:10],
            },
        ],
    }

    return await c.create_resource("Task", task)


# ─── Document → DocumentReference ────────────────────────────────────────────

async def create_document_reference(
    doc_data: Dict[str, Any],
    binary_fhir_id: str,
    patient_fhir_id: str,
    *,
    client: Optional[MedplumClient] = None,
) -> Dict[str, Any]:
    """Map a supporting document to a FHIR DocumentReference."""
    c = client or await get_medplum_client()

    doc_type_map = {
        "eob": {"code": "18842-5", "display": "Discharge summary"},
        "medical_record": {"code": "34133-9", "display": "Summarization of episode note"},
        "gfe": {"code": "64299-1", "display": "Good Faith Estimate"},
        "itemized_bill": {"code": "55188-7", "display": "Patient data Document"},
        "qpa_calculation": {"code": "55188-7", "display": "Patient data Document"},
        "appeal": {"code": "57016-8", "display": "Privacy policy acknowledgement Document"},
    }

    doc_type = doc_type_map.get(
        doc_data.get("document_type", ""),
        {"code": "55188-7", "display": "Patient data Document"},
    )

    doc_ref: Dict[str, Any] = {
        "resourceType": "DocumentReference",
        "identifier": [
            {
                "system": f"{HEALTHPOINT_SYSTEM}/document-id",
                "value": str(doc_data.get("document_id", uuid4())),
            }
        ],
        "status": "current",
        "type": {
            "coding": [{
                "system": "http://loinc.org",
                "code": doc_type["code"],
                "display": doc_type["display"],
            }]
        },
        "subject": {"reference": f"Patient/{patient_fhir_id}"},
        "date": datetime.now(timezone.utc).isoformat(),
        "description": doc_data.get("description") or doc_data.get("file_name", ""),
        "content": [{
            "attachment": {
                "contentType": doc_data.get("content_type", "application/pdf"),
                "url": f"Binary/{binary_fhir_id}",
                "title": doc_data.get("file_name", "document"),
                "creation": datetime.now(timezone.utc).isoformat(),
            }
        }],
    }

    return await c.create_resource("DocumentReference", doc_ref)


# ─── Negotiation Offer → Communication ───────────────────────────────────────

async def create_negotiation_communication(
    offer_data: Dict[str, Any],
    patient_fhir_id: str,
    sender_fhir_ref: str,
    *,
    client: Optional[MedplumClient] = None,
) -> Dict[str, Any]:
    """Map a negotiation offer to a FHIR Communication resource."""
    c = client or await get_medplum_client()

    comm: Dict[str, Any] = {
        "resourceType": "Communication",
        "identifier": [
            {
                "system": f"{HEALTHPOINT_SYSTEM}/offer-id",
                "value": str(offer_data.get("offer_id", uuid4())),
            }
        ],
        "status": "completed",
        "category": [{
            "coding": [{
                "system": f"{HEALTHPOINT_SYSTEM}/fhir/CodeSystem/communication-category",
                "code": "idr-negotiation-offer",
                "display": "IDR Negotiation Offer",
            }]
        }],
        "subject": {"reference": f"Patient/{patient_fhir_id}"},
        "sender": {"reference": sender_fhir_ref},
        "sent": datetime.now(timezone.utc).isoformat(),
        "payload": [
            {
                "contentString": (
                    f"Offer amount: ${offer_data.get('offer_amount', 0):.2f} USD. "
                    f"Offer type: {offer_data.get('offer_type', 'counter')}. "
                    f"Rationale: {offer_data.get('rationale', '')}"
                )
            }
        ],
        "extension": [
            {
                "url": f"{HEALTHPOINT_SYSTEM}/fhir/extension/offer-amount",
                "valueMoney": {
                    "value": float(offer_data.get("offer_amount", 0)),
                    "currency": "USD",
                },
            },
            {
                "url": f"{HEALTHPOINT_SYSTEM}/fhir/extension/offer-type",
                "valueString": offer_data.get("offer_type", "counter"),
            },
        ],
    }

    return await c.create_resource("Communication", comm)
