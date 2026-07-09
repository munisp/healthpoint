"""
Bulletproof CMS Submission Validation Pipeline
===============================================
A 5-layer LangGraph validation graph that ensures every CMS IDR portal
submission is complete, accurate, and regulation-compliant before it leaves
the platform.

Layers (executed in order, each can block submission):
  1. Schema Validation     — all required fields present and correctly typed
  2. Regulatory Compliance — service type, QPA methodology, timeline checks
  3. Document Completeness — required attachments present and correctly labelled
  4. Cross-Field Coherence — amounts, dates, and party data internally consistent
  5. AI Confidence Scoring — LLM-based final review with confidence score ≥ 0.85

A submission only reaches APPROVED status if all 5 layers pass.
Any BLOCKING issue halts the pipeline and returns a structured remediation plan.
"""

from __future__ import annotations
import os
import json
import re
from typing import TypedDict, Literal, Optional, List, Dict, Any
from datetime import datetime, date
from langgraph.graph import StateGraph, END

# ── Types ─────────────────────────────────────────────────────────────────────

class ValidationIssue(TypedDict):
    layer: str
    severity: Literal["blocking", "warning", "info"]
    field: Optional[str]
    code: str
    message: str
    remediation: str

class CMSSubmissionInput(TypedDict):
    # Party information
    initiating_party_name: str
    initiating_party_type: str          # provider / facility / air_ambulance
    responding_party_name: str
    responding_party_type: str          # payer / plan
    # Service details
    service_type: str                   # emergency_medicine, anesthesiology, etc.
    service_date: str                   # ISO date string
    patient_state: str                  # 2-letter state code
    facility_state: str
    # Financial
    billed_amount: float
    qpa_amount: float
    initiating_offer: float
    # Timeline
    open_negotiation_start: str         # ISO date
    open_negotiation_end: str           # ISO date
    idr_initiation_date: str            # ISO date
    # Documents
    attached_documents: List[str]       # list of document type labels
    # Narrative
    submission_narrative: str
    # Optional
    idr_entity_name: Optional[str]
    qpa_methodology: Optional[str]      # fee_schedule / median_in_network / other
    additional_information: Optional[str]

class ValidationState(TypedDict):
    submission: CMSSubmissionInput
    issues: List[ValidationIssue]
    layer_results: Dict[str, bool]      # layer_name -> passed
    confidence_score: float
    status: Literal["pending", "approved", "rejected", "needs_review"]
    summary: str
    remediation_plan: List[str]

# ── Required fields and document types ───────────────────────────────────────

REQUIRED_FIELDS = [
    "initiating_party_name", "initiating_party_type",
    "responding_party_name", "responding_party_type",
    "service_type", "service_date", "patient_state", "facility_state",
    "billed_amount", "qpa_amount", "initiating_offer",
    "open_negotiation_start", "open_negotiation_end",
    "idr_initiation_date", "attached_documents", "submission_narrative",
]

VALID_SERVICE_TYPES = [
    "emergency_medicine", "anesthesiology", "pathology", "radiology",
    "neonatology", "assistant_surgeon", "hospitalist", "intensivist",
    "air_ambulance", "ground_ambulance", "other",
]

VALID_PARTY_TYPES = ["provider", "facility", "air_ambulance", "payer", "plan"]

REQUIRED_DOCUMENTS_BY_SERVICE = {
    "air_ambulance": ["transport_record", "medical_necessity", "remittance_advice", "eob"],
    "emergency_medicine": ["remittance_advice", "eob", "medical_record"],
    "default": ["remittance_advice", "eob"],
}

US_STATES = {
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN",
    "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV",
    "NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN",
    "TX","UT","VT","VA","WA","WV","WI","WY","DC",
}

# NSA statutory timelines (business days)
OPEN_NEGOTIATION_DAYS = 30
IDR_INITIATION_WINDOW_DAYS = 4   # after failed open negotiation

# ── Layer 1: Schema Validation ────────────────────────────────────────────────

def layer_schema_validation(state: ValidationState) -> ValidationState:
    """Check all required fields are present and non-empty."""
    sub = state["submission"]
    issues = list(state["issues"])
    passed = True

    for field in REQUIRED_FIELDS:
        value = sub.get(field)
        if value is None or value == "" or value == [] or value == 0.0:
            issues.append(ValidationIssue(
                layer="schema",
                severity="blocking",
                field=field,
                code="MISSING_REQUIRED_FIELD",
                message=f"Required field '{field}' is missing or empty.",
                remediation=f"Provide a valid value for '{field}' before submitting to CMS.",
            ))
            passed = False

    # Type checks
    for amount_field in ["billed_amount", "qpa_amount", "initiating_offer"]:
        val = sub.get(amount_field)
        if val is not None and not isinstance(val, (int, float)):
            issues.append(ValidationIssue(
                layer="schema",
                severity="blocking",
                field=amount_field,
                code="INVALID_TYPE",
                message=f"'{amount_field}' must be a numeric value.",
                remediation=f"Ensure '{amount_field}' is a number (e.g., 1250.00).",
            ))
            passed = False

    # Date format checks
    for date_field in ["service_date", "open_negotiation_start", "open_negotiation_end", "idr_initiation_date"]:
        val = sub.get(date_field, "")
        if val:
            try:
                datetime.fromisoformat(str(val).replace("Z", "+00:00"))
            except ValueError:
                issues.append(ValidationIssue(
                    layer="schema",
                    severity="blocking",
                    field=date_field,
                    code="INVALID_DATE_FORMAT",
                    message=f"'{date_field}' is not a valid ISO date string.",
                    remediation=f"Use ISO 8601 format (YYYY-MM-DD) for '{date_field}'.",
                ))
                passed = False

    state["issues"] = issues
    state["layer_results"]["schema"] = passed
    return state

# ── Layer 2: Regulatory Compliance ───────────────────────────────────────────

def layer_regulatory_compliance(state: ValidationState) -> ValidationState:
    """Validate against NSA IDR regulatory requirements (45 CFR § 149.510)."""
    sub = state["submission"]
    issues = list(state["issues"])
    passed = True

    # Service type must be valid
    if sub.get("service_type") not in VALID_SERVICE_TYPES:
        issues.append(ValidationIssue(
            layer="regulatory",
            severity="blocking",
            field="service_type",
            code="INVALID_SERVICE_TYPE",
            message=f"Service type '{sub.get('service_type')}' is not a recognised NSA IDR-eligible service type.",
            remediation="Select a valid service type from the NSA-eligible list (e.g., emergency_medicine, air_ambulance).",
        ))
        passed = False

    # Party types must be valid
    for party_field in ["initiating_party_type", "responding_party_type"]:
        if sub.get(party_field) not in VALID_PARTY_TYPES:
            issues.append(ValidationIssue(
                layer="regulatory",
                severity="blocking",
                field=party_field,
                code="INVALID_PARTY_TYPE",
                message=f"'{party_field}' value '{sub.get(party_field)}' is not valid.",
                remediation="Initiating party must be provider/facility/air_ambulance; responding party must be payer/plan.",
            ))
            passed = False

    # State codes must be valid US states
    for state_field in ["patient_state", "facility_state"]:
        val = sub.get(state_field, "").upper()
        if val not in US_STATES:
            issues.append(ValidationIssue(
                layer="regulatory",
                severity="blocking",
                field=state_field,
                code="INVALID_STATE_CODE",
                message=f"'{state_field}' value '{val}' is not a valid US state code.",
                remediation="Use a 2-letter US state code (e.g., NY, CA, TX).",
            ))
            passed = False

    # Open negotiation must be ≤ 30 business days
    try:
        on_start = datetime.fromisoformat(str(sub.get("open_negotiation_start", "")).replace("Z", "+00:00"))
        on_end = datetime.fromisoformat(str(sub.get("open_negotiation_end", "")).replace("Z", "+00:00"))
        delta_days = (on_end - on_start).days
        if delta_days > 35:  # allow slight buffer for weekends
            issues.append(ValidationIssue(
                layer="regulatory",
                severity="blocking",
                field="open_negotiation_end",
                code="OPEN_NEGOTIATION_PERIOD_EXCEEDED",
                message=f"Open negotiation period is {delta_days} days, exceeding the 30-business-day statutory limit.",
                remediation="Verify the open negotiation start and end dates. The period must not exceed 30 business days per 45 CFR § 149.510(b)(1).",
            ))
            passed = False
        elif delta_days < 1:
            issues.append(ValidationIssue(
                layer="regulatory",
                severity="blocking",
                field="open_negotiation_end",
                code="OPEN_NEGOTIATION_PERIOD_INVALID",
                message="Open negotiation end date is before or equal to start date.",
                remediation="Ensure open_negotiation_end is after open_negotiation_start.",
            ))
            passed = False
    except (ValueError, TypeError):
        pass  # date format errors caught in schema layer

    # IDR initiation must be within 4 business days of failed negotiation
    try:
        on_end = datetime.fromisoformat(str(sub.get("open_negotiation_end", "")).replace("Z", "+00:00"))
        idr_init = datetime.fromisoformat(str(sub.get("idr_initiation_date", "")).replace("Z", "+00:00"))
        window = (idr_init - on_end).days
        if window < 0:
            issues.append(ValidationIssue(
                layer="regulatory",
                severity="blocking",
                field="idr_initiation_date",
                code="IDR_INITIATED_BEFORE_NEGOTIATION_END",
                message="IDR initiation date is before the open negotiation end date.",
                remediation="IDR may only be initiated after open negotiation has concluded.",
            ))
            passed = False
        elif window > 6:  # 4 business days ≈ 6 calendar days
            issues.append(ValidationIssue(
                layer="regulatory",
                severity="blocking",
                field="idr_initiation_date",
                code="IDR_INITIATION_WINDOW_EXPIRED",
                message=f"IDR was initiated {window} calendar days after open negotiation ended, potentially outside the 4-business-day window.",
                remediation="Verify the initiation date. Per 45 CFR § 149.510(b)(2), IDR must be initiated within 4 business days of failed negotiation.",
            ))
            passed = False
    except (ValueError, TypeError):
        pass

    # QPA methodology should be specified
    if not sub.get("qpa_methodology"):
        issues.append(ValidationIssue(
            layer="regulatory",
            severity="warning",
            field="qpa_methodology",
            code="QPA_METHODOLOGY_MISSING",
            message="QPA methodology is not specified. CMS arbitrators weight QPA heavily.",
            remediation="Specify the QPA methodology (fee_schedule, median_in_network, or other) to strengthen the submission.",
        ))
        # Warning only — does not block

    state["issues"] = issues
    state["layer_results"]["regulatory"] = passed
    return state

# ── Layer 3: Document Completeness ───────────────────────────────────────────

def layer_document_completeness(state: ValidationState) -> ValidationState:
    """Verify required supporting documents are attached."""
    sub = state["submission"]
    issues = list(state["issues"])
    passed = True

    service_type = sub.get("service_type", "default")
    required_docs = REQUIRED_DOCUMENTS_BY_SERVICE.get(
        service_type,
        REQUIRED_DOCUMENTS_BY_SERVICE["default"]
    )
    attached = [d.lower().replace(" ", "_") for d in sub.get("attached_documents", [])]

    for required_doc in required_docs:
        # Fuzzy match: check if any attached doc contains the required doc type
        found = any(required_doc in att or att in required_doc for att in attached)
        if not found:
            issues.append(ValidationIssue(
                layer="documents",
                severity="blocking",
                field="attached_documents",
                code="MISSING_REQUIRED_DOCUMENT",
                message=f"Required document '{required_doc}' is missing for service type '{service_type}'.",
                remediation=f"Attach a '{required_doc}' document before submitting. This is required by CMS for {service_type} disputes.",
            ))
            passed = False

    # Narrative minimum length check
    narrative = sub.get("submission_narrative", "")
    if len(narrative.strip()) < 100:
        issues.append(ValidationIssue(
            layer="documents",
            severity="blocking",
            field="submission_narrative",
            code="NARRATIVE_TOO_SHORT",
            message=f"Submission narrative is only {len(narrative.strip())} characters. CMS requires a substantive explanation.",
            remediation="Expand the narrative to at least 200 characters. Include the basis for your offer, why the QPA is appropriate/inappropriate, and any extraordinary circumstances.",
        ))
        passed = False

    state["issues"] = issues
    state["layer_results"]["documents"] = passed
    return state

# ── Layer 4: Cross-Field Coherence ───────────────────────────────────────────

def layer_cross_field_coherence(state: ValidationState) -> ValidationState:
    """Check internal consistency across amounts, dates, and party data."""
    sub = state["submission"]
    issues = list(state["issues"])
    passed = True

    billed = sub.get("billed_amount", 0)
    qpa = sub.get("qpa_amount", 0)
    offer = sub.get("initiating_offer", 0)

    # Offer must be positive
    if isinstance(offer, (int, float)) and offer <= 0:
        issues.append(ValidationIssue(
            layer="coherence",
            severity="blocking",
            field="initiating_offer",
            code="OFFER_NOT_POSITIVE",
            message="Initiating party offer must be a positive dollar amount.",
            remediation="Enter the dollar amount the initiating party is requesting as payment.",
        ))
        passed = False

    # Offer should not exceed billed amount (would be unusual)
    if isinstance(offer, (int, float)) and isinstance(billed, (int, float)) and billed > 0:
        if offer > billed * 1.1:
            issues.append(ValidationIssue(
                layer="coherence",
                severity="warning",
                field="initiating_offer",
                code="OFFER_EXCEEDS_BILLED",
                message=f"Initiating offer (${offer:,.2f}) exceeds billed amount (${billed:,.2f}) by more than 10%. This is unusual and may invite scrutiny.",
                remediation="Verify the initiating offer amount. If correct, add an explanation in the narrative.",
            ))
            # Warning only

    # QPA must be positive
    if isinstance(qpa, (int, float)) and qpa <= 0:
        issues.append(ValidationIssue(
            layer="coherence",
            severity="blocking",
            field="qpa_amount",
            code="QPA_NOT_POSITIVE",
            message="QPA amount must be a positive dollar amount.",
            remediation="Enter the applicable Qualifying Payment Amount as determined by the plan.",
        ))
        passed = False

    # Service date must be before open negotiation start
    try:
        svc_date = datetime.fromisoformat(str(sub.get("service_date", "")).replace("Z", "+00:00"))
        on_start = datetime.fromisoformat(str(sub.get("open_negotiation_start", "")).replace("Z", "+00:00"))
        if svc_date >= on_start:
            issues.append(ValidationIssue(
                layer="coherence",
                severity="blocking",
                field="service_date",
                code="SERVICE_DATE_AFTER_NEGOTIATION",
                message="Service date must be before the open negotiation start date.",
                remediation="Verify the service date. The service must have occurred before the dispute was initiated.",
            ))
            passed = False
    except (ValueError, TypeError):
        pass

    # Party names must be different
    if sub.get("initiating_party_name") and sub.get("responding_party_name"):
        if sub["initiating_party_name"].strip().lower() == sub["responding_party_name"].strip().lower():
            issues.append(ValidationIssue(
                layer="coherence",
                severity="blocking",
                field="responding_party_name",
                code="SAME_PARTY_NAMES",
                message="Initiating and responding party names are identical.",
                remediation="A dispute must be between two different parties.",
            ))
            passed = False

    state["issues"] = issues
    state["layer_results"]["coherence"] = passed
    return state

# ── Layer 5: AI Confidence Scoring ───────────────────────────────────────────

def layer_ai_confidence_scoring(state: ValidationState) -> ValidationState:
    """
    LLM-based final review. Assigns a confidence score 0.0–1.0.
    Score < 0.70 → rejected
    Score 0.70–0.84 → needs_review (human must approve)
    Score ≥ 0.85 → approved
    """
    sub = state["submission"]
    issues = list(state["issues"])

    # Build a structured prompt for the LLM
    blocking_issues = [i for i in issues if i["severity"] == "blocking"]
    warning_issues = [i for i in issues if i["severity"] == "warning"]

    # If there are blocking issues from earlier layers, skip LLM call — already rejected
    if blocking_issues:
        state["confidence_score"] = 0.0
        state["layer_results"]["ai_confidence"] = False
        state["status"] = "rejected"
        state["issues"] = issues
        return state

    ai_service_url = os.getenv("AI_SERVICE_URL", "http://localhost:8000")

    # Build submission summary for LLM review
    submission_summary = f"""
NSA IDR Submission Review Request:

Initiating Party: {sub.get('initiating_party_name')} ({sub.get('initiating_party_type')})
Responding Party: {sub.get('responding_party_name')} ({sub.get('responding_party_type')})
Service Type: {sub.get('service_type')}
Service Date: {sub.get('service_date')}
States: Patient={sub.get('patient_state')}, Facility={sub.get('facility_state')}
Billed Amount: ${sub.get('billed_amount', 0):,.2f}
QPA Amount: ${sub.get('qpa_amount', 0):,.2f}
Initiating Offer: ${sub.get('initiating_offer', 0):,.2f}
QPA Methodology: {sub.get('qpa_methodology', 'not specified')}
Open Negotiation: {sub.get('open_negotiation_start')} to {sub.get('open_negotiation_end')}
IDR Initiation: {sub.get('idr_initiation_date')}
Attached Documents: {', '.join(sub.get('attached_documents', []))}
Warnings from prior validation layers: {len(warning_issues)}

Submission Narrative (first 500 chars):
{sub.get('submission_narrative', '')[:500]}
"""

    try:
        import urllib.request
        import urllib.error

        payload = json.dumps({
            "question": f"""You are a CMS IDR submission quality reviewer. Review this NSA IDR submission and provide:
1. A confidence score from 0.0 to 1.0 (where 1.0 = perfect submission, 0.0 = clearly invalid)
2. A brief explanation of the score
3. Any additional concerns not caught by automated checks

Scoring guide:
- 0.85–1.0: Approve — submission is complete, coherent, and regulation-compliant
- 0.70–0.84: Needs human review — minor gaps or ambiguities that a reviewer should assess
- 0.0–0.69: Reject — material issues that would likely cause CMS rejection

{submission_summary}

Respond in JSON format: {{"confidence_score": 0.92, "explanation": "...", "additional_concerns": ["..."]}}""",
            "dispute_context": None,
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{ai_service_url}/ask-assistant",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            ai_response = json.loads(resp.read().decode("utf-8"))
            answer = ai_response.get("answer", "")

        # Extract JSON from the answer
        json_match = re.search(r'\{[^{}]*"confidence_score"[^{}]*\}', answer, re.DOTALL)
        if json_match:
            ai_data = json.loads(json_match.group())
            confidence = float(ai_data.get("confidence_score", 0.75))
            explanation = ai_data.get("explanation", "")
            additional_concerns = ai_data.get("additional_concerns", [])
        else:
            # Fallback: extract any float that looks like a score
            score_match = re.search(r'confidence[_\s]*score["\s:]+([0-9.]+)', answer, re.IGNORECASE)
            confidence = float(score_match.group(1)) if score_match else 0.75
            explanation = answer[:300]
            additional_concerns = []

        # Clamp to [0, 1]
        confidence = max(0.0, min(1.0, confidence))

        # Add AI concerns as issues
        for concern in additional_concerns:
            if concern.strip():
                issues.append(ValidationIssue(
                    layer="ai_confidence",
                    severity="warning",
                    field=None,
                    code="AI_CONCERN",
                    message=concern,
                    remediation="Review this concern before submission.",
                ))

        if confidence < 0.70:
            issues.append(ValidationIssue(
                layer="ai_confidence",
                severity="blocking",
                field=None,
                code="LOW_CONFIDENCE_SCORE",
                message=f"AI confidence score is {confidence:.2f} (threshold: 0.70). {explanation}",
                remediation="Address the AI reviewer's concerns and re-validate before submitting.",
            ))
            state["layer_results"]["ai_confidence"] = False
            state["status"] = "rejected"
        elif confidence < 0.85:
            issues.append(ValidationIssue(
                layer="ai_confidence",
                severity="warning",
                field=None,
                code="MODERATE_CONFIDENCE_SCORE",
                message=f"AI confidence score is {confidence:.2f}. Human review recommended before submission. {explanation}",
                remediation="A compliance officer should review this submission before it is sent to CMS.",
            ))
            state["layer_results"]["ai_confidence"] = True
            state["status"] = "needs_review"
        else:
            state["layer_results"]["ai_confidence"] = True
            state["status"] = "approved"

        state["confidence_score"] = confidence

    except Exception as e:
        # If AI service is unavailable, default to needs_review with 0.75 score
        state["confidence_score"] = 0.75
        state["layer_results"]["ai_confidence"] = True
        state["status"] = "needs_review"
        issues.append(ValidationIssue(
            layer="ai_confidence",
            severity="info",
            field=None,
            code="AI_SERVICE_UNAVAILABLE",
            message=f"AI confidence scoring unavailable ({str(e)[:100]}). Defaulting to human review.",
            remediation="Ensure the AI service is running for automated confidence scoring.",
        ))

    state["issues"] = issues
    return state

# ── Routing logic ─────────────────────────────────────────────────────────────

def should_continue_after_schema(state: ValidationState) -> str:
    """Stop pipeline if schema validation failed (blocking issues present)."""
    blocking = [i for i in state["issues"] if i["severity"] == "blocking" and i["layer"] == "schema"]
    return "regulatory" if not blocking else "finalize"

def should_continue_after_regulatory(state: ValidationState) -> str:
    blocking = [i for i in state["issues"] if i["severity"] == "blocking" and i["layer"] in ("schema", "regulatory")]
    return "documents" if not blocking else "finalize"

def should_continue_after_documents(state: ValidationState) -> str:
    blocking = [i for i in state["issues"] if i["severity"] == "blocking"]
    return "coherence" if not blocking else "finalize"

def should_continue_after_coherence(state: ValidationState) -> str:
    blocking = [i for i in state["issues"] if i["severity"] == "blocking"]
    return "ai_confidence" if not blocking else "finalize"

# ── Finalize node ─────────────────────────────────────────────────────────────

def finalize(state: ValidationState) -> ValidationState:
    """Build the final summary and remediation plan."""
    issues = state["issues"]
    blocking = [i for i in issues if i["severity"] == "blocking"]
    warnings = [i for i in issues if i["severity"] == "warning"]

    if blocking:
        state["status"] = "rejected"
        state["summary"] = (
            f"Submission REJECTED — {len(blocking)} blocking issue(s) must be resolved before CMS submission. "
            f"{len(warnings)} warning(s) also noted."
        )
    elif state["status"] == "needs_review":
        state["summary"] = (
            f"Submission requires HUMAN REVIEW — all automated checks passed but AI confidence score "
            f"({state['confidence_score']:.2f}) is below the 0.85 auto-approval threshold. "
            f"{len(warnings)} warning(s) noted."
        )
    elif state["status"] == "approved":
        state["summary"] = (
            f"Submission APPROVED — all 5 validation layers passed with confidence score "
            f"{state['confidence_score']:.2f}. {len(warnings)} advisory warning(s) noted. "
            f"Safe to submit to CMS IDR portal."
        )
    else:
        state["status"] = "rejected"
        state["summary"] = "Submission REJECTED — validation pipeline did not complete."

    state["remediation_plan"] = [
        f"[{i['layer'].upper()} / {i['code']}] {i['remediation']}"
        for i in blocking
    ]

    return state

# ── Build the LangGraph ───────────────────────────────────────────────────────

def build_cms_validation_graph():
    graph = StateGraph(ValidationState)

    graph.add_node("schema", layer_schema_validation)
    graph.add_node("regulatory", layer_regulatory_compliance)
    graph.add_node("documents", layer_document_completeness)
    graph.add_node("coherence", layer_cross_field_coherence)
    graph.add_node("ai_confidence", layer_ai_confidence_scoring)
    graph.add_node("finalize", finalize)

    graph.set_entry_point("schema")

    graph.add_conditional_edges("schema", should_continue_after_schema, {
        "regulatory": "regulatory",
        "finalize": "finalize",
    })
    graph.add_conditional_edges("regulatory", should_continue_after_regulatory, {
        "documents": "documents",
        "finalize": "finalize",
    })
    graph.add_conditional_edges("documents", should_continue_after_documents, {
        "coherence": "coherence",
        "finalize": "finalize",
    })
    graph.add_conditional_edges("coherence", should_continue_after_coherence, {
        "ai_confidence": "ai_confidence",
        "finalize": "finalize",
    })
    graph.add_edge("ai_confidence", "finalize")
    graph.add_edge("finalize", END)

    return graph.compile()

# ── Public API ────────────────────────────────────────────────────────────────

_cms_validation_graph = None

def get_cms_validation_graph():
    global _cms_validation_graph
    if _cms_validation_graph is None:
        _cms_validation_graph = build_cms_validation_graph()
    return _cms_validation_graph

def validate_cms_submission(submission: CMSSubmissionInput) -> ValidationState:
    """
    Run the full 5-layer validation pipeline on a CMS submission.
    Returns a ValidationState with status, issues, confidence_score, and remediation_plan.
    """
    graph = get_cms_validation_graph()
    initial_state: ValidationState = {
        "submission": submission,
        "issues": [],
        "layer_results": {},
        "confidence_score": 0.0,
        "status": "pending",
        "summary": "",
        "remediation_plan": [],
    }
    result = graph.invoke(initial_state)
    return result
