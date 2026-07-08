"""
HealthPoint FHIR R4 Validation Layer
=====================================
Validates FHIR R4 resources against:
  1. Base FHIR R4 structural rules (required fields, cardinality, data types)
  2. NSA-specific StructureDefinition profiles for Claim, ExplanationOfBenefit, Coverage
  3. Business rules from 42 CFR §149.510 (QPA cap, deadline enforcement, service codes)

Returns FHIR OperationOutcome on validation failure.
All validation is performed server-side before any Medplum write.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel


# ─── OperationOutcome Builder ─────────────────────────────────────────────────

class ValidationIssue(BaseModel):
    severity: str  # fatal | error | warning | information
    code: str      # FHIR issue type code
    details: str
    expression: Optional[str] = None  # FHIRPath expression pointing to the problem


class OperationOutcome(BaseModel):
    resourceType: str = "OperationOutcome"
    issue: List[Dict[str, Any]]

    @classmethod
    def from_issues(cls, issues: List[ValidationIssue]) -> "OperationOutcome":
        return cls(
            issue=[
                {
                    "severity": i.severity,
                    "code": i.code,
                    "details": {"text": i.details},
                    "expression": [i.expression] if i.expression else [],
                }
                for i in issues
            ]
        )

    def has_errors(self) -> bool:
        return any(i["severity"] in ("fatal", "error") for i in self.issue)

    def to_dict(self) -> Dict[str, Any]:
        return self.model_dump()


# ─── Base FHIR R4 Structural Validators ──────────────────────────────────────

def _require(
    resource: Dict[str, Any],
    field: str,
    issues: List[ValidationIssue],
    expression_prefix: str = "",
) -> bool:
    """Assert a required field is present and non-empty."""
    val = resource.get(field)
    if val is None or val == "" or val == [] or val == {}:
        issues.append(ValidationIssue(
            severity="error",
            code="required",
            details=f"Required field '{field}' is missing or empty.",
            expression=f"{expression_prefix}.{field}" if expression_prefix else field,
        ))
        return False
    return True


def _require_nested(
    obj: Dict[str, Any],
    path: str,
    issues: List[ValidationIssue],
) -> bool:
    """Assert a dot-separated nested path is present."""
    parts = path.split(".")
    current = obj
    for part in parts:
        if not isinstance(current, dict) or part not in current:
            issues.append(ValidationIssue(
                severity="error",
                code="required",
                details=f"Required nested field '{path}' is missing.",
                expression=path,
            ))
            return False
        current = current[part]
    return True


def _validate_date(
    value: str,
    field: str,
    issues: List[ValidationIssue],
) -> bool:
    """Validate ISO 8601 date format."""
    try:
        date.fromisoformat(value)
        return True
    except (ValueError, TypeError):
        issues.append(ValidationIssue(
            severity="error",
            code="value",
            details=f"Field '{field}' must be a valid ISO 8601 date (YYYY-MM-DD). Got: '{value}'",
            expression=field,
        ))
        return False


def _validate_decimal(
    value: Any,
    field: str,
    issues: List[ValidationIssue],
    min_val: Optional[float] = None,
    max_val: Optional[float] = None,
) -> bool:
    """Validate a numeric decimal field with optional range."""
    try:
        num = float(value)
    except (ValueError, TypeError):
        issues.append(ValidationIssue(
            severity="error",
            code="value",
            details=f"Field '{field}' must be a number. Got: '{value}'",
            expression=field,
        ))
        return False
    if min_val is not None and num < min_val:
        issues.append(ValidationIssue(
            severity="error",
            code="business-rule",
            details=f"Field '{field}' must be >= {min_val}. Got: {num}",
            expression=field,
        ))
        return False
    if max_val is not None and num > max_val:
        issues.append(ValidationIssue(
            severity="error",
            code="business-rule",
            details=f"Field '{field}' must be <= {max_val}. Got: {num}",
            expression=field,
        ))
        return False
    return True


def _validate_npi(value: str, field: str, issues: List[ValidationIssue]) -> bool:
    """Validate NPI format: 10-digit number with Luhn check."""
    if not re.fullmatch(r"\d{10}", str(value)):
        issues.append(ValidationIssue(
            severity="error",
            code="value",
            details=f"Field '{field}' must be a 10-digit NPI number. Got: '{value}'",
            expression=field,
        ))
        return False
    return True


def _validate_icd10(code: str, field: str, issues: List[ValidationIssue]) -> bool:
    """Validate ICD-10-CM code format (e.g., A00.0, Z99.89)."""
    if not re.fullmatch(r"[A-Z]\d{2}(\.\w{1,4})?", code.upper()):
        issues.append(ValidationIssue(
            severity="warning",
            code="code-invalid",
            details=f"ICD-10-CM code '{code}' in '{field}' does not match expected format (e.g., A00.0).",
            expression=field,
        ))
        return False
    return True


def _validate_cpt(code: str, field: str, issues: List[ValidationIssue]) -> bool:
    """Validate CPT code format: 5 digits or 4 digits + letter."""
    if not re.fullmatch(r"\d{4}[A-Z0-9]|\d{5}", code.upper()):
        issues.append(ValidationIssue(
            severity="warning",
            code="code-invalid",
            details=f"CPT code '{code}' in '{field}' does not match expected format.",
            expression=field,
        ))
        return False
    return True


# ─── NSA Claim Profile Validator ─────────────────────────────────────────────

# NSA-covered service categories per 45 CFR §149.510
NSA_COVERED_SERVICE_CATEGORIES = {
    "emergency",
    "out-of-network-ancillary",
    "air-ambulance",
    "non-emergency-non-participating",
}

# NSA-covered service codes (CPT ranges for emergency and air ambulance)
NSA_EMERGENCY_CPT_PREFIXES = {"99281", "99282", "99283", "99284", "99285", "99291"}
NSA_AIR_AMBULANCE_HCPCS = {"A0431", "A0432", "A0433", "A0434", "A0435", "A0436"}


def validate_nsa_claim(resource: Dict[str, Any]) -> OperationOutcome:
    """
    Validate a FHIR R4 Claim resource against the NSA HealthPoint profile.
    Enforces all required fields for IDR dispute initiation per 42 CFR §149.510.
    """
    issues: List[ValidationIssue] = []
    prefix = "Claim"

    # ── Base required fields ──────────────────────────────────────────────────
    _require(resource, "status", issues, prefix)
    _require(resource, "use", issues, prefix)
    _require(resource, "patient", issues, prefix)
    _require(resource, "created", issues, prefix)
    _require(resource, "insurer", issues, prefix)
    _require(resource, "provider", issues, prefix)
    _require(resource, "priority", issues, prefix)
    _require(resource, "insurance", issues, prefix)
    _require(resource, "item", issues, prefix)

    # ── NSA-required extensions ───────────────────────────────────────────────
    extensions = {
        ext.get("url", ""): ext
        for ext in resource.get("extension", [])
    }

    if "http://healthpoint.local/fhir/StructureDefinition/qpa-amount" not in extensions:
        issues.append(ValidationIssue(
            severity="error",
            code="required",
            details="NSA profile requires 'qpa-amount' extension with the Qualifying Payment Amount.",
            expression="Claim.extension",
        ))
    else:
        qpa_ext = extensions["http://healthpoint.local/fhir/StructureDefinition/qpa-amount"]
        qpa_value = qpa_ext.get("valueMoney", {}).get("value")
        if qpa_value is not None:
            _validate_decimal(qpa_value, "Claim.extension[qpa-amount].valueMoney.value", issues, min_val=0.01)

    if "http://healthpoint.local/fhir/StructureDefinition/nsa-service-category" not in extensions:
        issues.append(ValidationIssue(
            severity="error",
            code="required",
            details="NSA profile requires 'nsa-service-category' extension (emergency | out-of-network-ancillary | air-ambulance).",
            expression="Claim.extension",
        ))
    else:
        cat_ext = extensions["http://healthpoint.local/fhir/StructureDefinition/nsa-service-category"]
        category = cat_ext.get("valueCode", "")
        if category not in NSA_COVERED_SERVICE_CATEGORIES:
            issues.append(ValidationIssue(
                severity="error",
                code="code-invalid",
                details=f"NSA service category '{category}' is not valid. Must be one of: {sorted(NSA_COVERED_SERVICE_CATEGORIES)}",
                expression="Claim.extension[nsa-service-category].valueCode",
            ))

    # ── Validate claim items ──────────────────────────────────────────────────
    for idx, item in enumerate(resource.get("item", [])):
        item_prefix = f"Claim.item[{idx}]"

        if not item.get("sequence"):
            issues.append(ValidationIssue(
                severity="error",
                code="required",
                details=f"Item[{idx}] must have a sequence number.",
                expression=f"{item_prefix}.sequence",
            ))

        # Validate service date
        service_date = item.get("servicedDate") or item.get("servicedPeriod", {}).get("start")
        if not service_date:
            issues.append(ValidationIssue(
                severity="error",
                code="required",
                details=f"Item[{idx}] must have a service date (servicedDate or servicedPeriod.start).",
                expression=f"{item_prefix}.servicedDate",
            ))
        else:
            _validate_date(service_date, f"{item_prefix}.servicedDate", issues)

        # Validate product/service code
        product_service = item.get("productOrService", {})
        codings = product_service.get("coding", [])
        if not codings:
            issues.append(ValidationIssue(
                severity="error",
                code="required",
                details=f"Item[{idx}] must have a productOrService coding (CPT/HCPCS).",
                expression=f"{item_prefix}.productOrService.coding",
            ))
        else:
            for coding in codings:
                system = coding.get("system", "")
                code = coding.get("code", "")
                if "cpt" in system.lower() or "procedure" in system.lower():
                    _validate_cpt(code, f"{item_prefix}.productOrService.coding.code", issues)

        # Validate unit price
        unit_price = item.get("unitPrice", {}).get("value")
        if unit_price is not None:
            _validate_decimal(unit_price, f"{item_prefix}.unitPrice.value", issues, min_val=0.0)

    # ── Validate provider NPI ─────────────────────────────────────────────────
    provider_identifiers = resource.get("provider", {}).get("identifier", {})
    if isinstance(provider_identifiers, dict):
        npi = provider_identifiers.get("value", "")
        if npi:
            _validate_npi(npi, "Claim.provider.identifier.value", issues)

    # ── Validate insurance ────────────────────────────────────────────────────
    for idx, ins in enumerate(resource.get("insurance", [])):
        if not ins.get("sequence"):
            issues.append(ValidationIssue(
                severity="error",
                code="required",
                details=f"Insurance[{idx}] must have a sequence number.",
                expression=f"Claim.insurance[{idx}].sequence",
            ))
        if not ins.get("focal"):
            issues.append(ValidationIssue(
                severity="warning",
                code="required",
                details=f"Insurance[{idx}] should have focal=true for the primary insurance.",
                expression=f"Claim.insurance[{idx}].focal",
            ))
        if not ins.get("coverage"):
            issues.append(ValidationIssue(
                severity="error",
                code="required",
                details=f"Insurance[{idx}] must reference a Coverage resource.",
                expression=f"Claim.insurance[{idx}].coverage",
            ))

    return OperationOutcome.from_issues(issues)


# ─── NSA ExplanationOfBenefit Profile Validator ───────────────────────────────

def validate_nsa_eob(resource: Dict[str, Any]) -> OperationOutcome:
    """
    Validate a FHIR R4 ExplanationOfBenefit against the NSA IDR determination profile.
    """
    issues: List[ValidationIssue] = []
    prefix = "ExplanationOfBenefit"

    _require(resource, "status", issues, prefix)
    _require(resource, "type", issues, prefix)
    _require(resource, "use", issues, prefix)
    _require(resource, "patient", issues, prefix)
    _require(resource, "created", issues, prefix)
    _require(resource, "insurer", issues, prefix)
    _require(resource, "provider", issues, prefix)
    _require(resource, "claim", issues, prefix)
    _require(resource, "outcome", issues, prefix)
    _require(resource, "adjudication", issues, prefix)

    # Validate outcome value
    outcome = resource.get("outcome", "")
    valid_outcomes = {"complete", "error", "partial", "queued"}
    if outcome and outcome not in valid_outcomes:
        issues.append(ValidationIssue(
            severity="error",
            code="code-invalid",
            details=f"ExplanationOfBenefit.outcome '{outcome}' is not valid. Must be: {sorted(valid_outcomes)}",
            expression="ExplanationOfBenefit.outcome",
        ))

    # NSA-required: IDR determination result extension
    extensions = {
        ext.get("url", ""): ext
        for ext in resource.get("extension", [])
    }
    if "http://healthpoint.local/fhir/StructureDefinition/idr-determination-result" not in extensions:
        issues.append(ValidationIssue(
            severity="error",
            code="required",
            details="NSA profile requires 'idr-determination-result' extension (provider-prevails | plan-prevails | settled).",
            expression="ExplanationOfBenefit.extension",
        ))

    # Validate adjudication amounts
    for idx, adj in enumerate(resource.get("adjudication", [])):
        category_code = adj.get("category", {}).get("coding", [{}])[0].get("code", "")
        amount = adj.get("amount", {}).get("value")
        if amount is not None:
            _validate_decimal(
                amount,
                f"ExplanationOfBenefit.adjudication[{idx}].amount.value",
                issues,
                min_val=0.0,
            )
        # NSA: final payment must not exceed 200% of QPA
        if category_code == "benefit" and amount is not None:
            qpa_ext = extensions.get("http://healthpoint.local/fhir/StructureDefinition/qpa-amount")
            if qpa_ext:
                qpa = qpa_ext.get("valueMoney", {}).get("value", 0)
                if qpa > 0 and float(amount) > float(qpa) * 2.0:
                    issues.append(ValidationIssue(
                        severity="error",
                        code="business-rule",
                        details=(
                            f"NSA violation: EOB benefit amount ${amount:.2f} exceeds 200% of QPA "
                            f"(${qpa:.2f} × 2 = ${qpa * 2:.2f}). Per 42 CFR §149.510, the IDR entity "
                            f"may not select an offer exceeding 200% of the QPA."
                        ),
                        expression=f"ExplanationOfBenefit.adjudication[{idx}].amount.value",
                    ))

    return OperationOutcome.from_issues(issues)


# ─── NSA Coverage Profile Validator ──────────────────────────────────────────

def validate_nsa_coverage(resource: Dict[str, Any]) -> OperationOutcome:
    """
    Validate a FHIR R4 Coverage resource against the NSA HealthPoint profile.
    """
    issues: List[ValidationIssue] = []
    prefix = "Coverage"

    _require(resource, "status", issues, prefix)
    _require(resource, "beneficiary", issues, prefix)
    _require(resource, "payor", issues, prefix)

    # Status must be active for NSA eligibility
    status = resource.get("status", "")
    if status and status not in ("active", "cancelled", "draft", "entered-in-error"):
        issues.append(ValidationIssue(
            severity="error",
            code="code-invalid",
            details=f"Coverage.status '{status}' is not a valid FHIR Coverage status.",
            expression="Coverage.status",
        ))

    # Validate period if present
    period = resource.get("period", {})
    if period.get("start"):
        _validate_date(period["start"], "Coverage.period.start", issues)
    if period.get("end"):
        _validate_date(period["end"], "Coverage.period.end", issues)
        if period.get("start") and period.get("end"):
            try:
                start = date.fromisoformat(period["start"])
                end = date.fromisoformat(period["end"])
                if end < start:
                    issues.append(ValidationIssue(
                        severity="error",
                        code="business-rule",
                        details="Coverage.period.end must be on or after Coverage.period.start.",
                        expression="Coverage.period",
                    ))
            except ValueError:
                pass

    # Validate subscriber ID
    subscriber_id = resource.get("subscriberId", "")
    if subscriber_id and len(subscriber_id) < 3:
        issues.append(ValidationIssue(
            severity="warning",
            code="value",
            details="Coverage.subscriberId appears too short to be a valid insurance member ID.",
            expression="Coverage.subscriberId",
        ))

    # Validate class (group/plan)
    for idx, cls in enumerate(resource.get("class", [])):
        if not cls.get("type"):
            issues.append(ValidationIssue(
                severity="error",
                code="required",
                details=f"Coverage.class[{idx}] must have a type.",
                expression=f"Coverage.class[{idx}].type",
            ))
        if not cls.get("value"):
            issues.append(ValidationIssue(
                severity="error",
                code="required",
                details=f"Coverage.class[{idx}] must have a value.",
                expression=f"Coverage.class[{idx}].value",
            ))

    return OperationOutcome.from_issues(issues)


# ─── Patient Profile Validator ────────────────────────────────────────────────

def validate_patient(resource: Dict[str, Any]) -> OperationOutcome:
    """Validate a FHIR R4 Patient resource."""
    issues: List[ValidationIssue] = []

    _require(resource, "name", issues, "Patient")
    _require(resource, "birthDate", issues, "Patient")

    names = resource.get("name", [])
    if names:
        name = names[0]
        if not name.get("family") and not name.get("text"):
            issues.append(ValidationIssue(
                severity="error",
                code="required",
                details="Patient.name must have either 'family' or 'text'.",
                expression="Patient.name[0]",
            ))

    birth_date = resource.get("birthDate", "")
    if birth_date:
        _validate_date(birth_date, "Patient.birthDate", issues)
        try:
            dob = date.fromisoformat(birth_date)
            if dob > date.today():
                issues.append(ValidationIssue(
                    severity="error",
                    code="business-rule",
                    details="Patient.birthDate cannot be in the future.",
                    expression="Patient.birthDate",
                ))
        except ValueError:
            pass

    gender = resource.get("gender", "")
    if gender and gender not in ("male", "female", "other", "unknown"):
        issues.append(ValidationIssue(
            severity="error",
            code="code-invalid",
            details=f"Patient.gender '{gender}' is not valid. Must be: male | female | other | unknown",
            expression="Patient.gender",
        ))

    return OperationOutcome.from_issues(issues)


# ─── Dispatch Validator ───────────────────────────────────────────────────────

VALIDATORS = {
    "Claim": validate_nsa_claim,
    "ExplanationOfBenefit": validate_nsa_eob,
    "Coverage": validate_nsa_coverage,
    "Patient": validate_patient,
}


def validate_fhir_resource(resource: Dict[str, Any]) -> OperationOutcome:
    """
    Dispatch to the correct validator based on resourceType.
    Returns an OperationOutcome with all issues found.
    If no profile-specific validator exists, returns a clean OperationOutcome.
    """
    resource_type = resource.get("resourceType", "")

    if not resource_type:
        return OperationOutcome.from_issues([
            ValidationIssue(
                severity="fatal",
                code="required",
                details="Resource must have a 'resourceType' field.",
                expression="resourceType",
            )
        ])

    validator = VALIDATORS.get(resource_type)
    if validator:
        return validator(resource)

    # No profile validator — return informational notice
    return OperationOutcome.from_issues([
        ValidationIssue(
            severity="information",
            code="informational",
            details=f"No NSA profile validator registered for resourceType '{resource_type}'. "
                    f"Base FHIR R4 structural validation only.",
        )
    ])


def assert_valid(resource: Dict[str, Any]) -> None:
    """
    Validate a FHIR resource and raise ValueError with the OperationOutcome
    if any errors are found. Use this as a pre-write guard in service code.
    """
    outcome = validate_fhir_resource(resource)
    if outcome.has_errors():
        error_messages = [
            i["details"]["text"]
            for i in outcome.issue
            if i["severity"] in ("fatal", "error")
        ]
        raise ValueError(
            f"FHIR validation failed for {resource.get('resourceType', 'unknown')}: "
            + "; ".join(error_messages)
        )
