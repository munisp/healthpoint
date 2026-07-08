"""
IDR Workflow Platform — Agentic AI Layer
=========================================
Best-of-breed open-source stack:
  • LangGraph  — stateful multi-step agent orchestration (graph-based)
  • LangChain  — LLM abstraction, tool calling, prompt templates, chains
  • OpenAI API — via OPENAI_API_BASE / OPENAI_API_KEY env vars (Manus proxy)

Three agents:
  1. DocumentAnalysisAgent  — extract, validate, classify uploaded evidence
  2. CMSSubmissionAgent     — eligibility check, form pre-fill, narrative
  3. IDRAssistantAgent      — ReAct Q&A with NSA regulatory tool calling
"""

from __future__ import annotations

import json
import os
import re
from typing import Annotated, Any, Literal, TypedDict

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

# ─── LLM Setup ────────────────────────────────────────────────────────────────
# Manus proxy is OpenAI-compatible; reads OPENAI_API_BASE + OPENAI_API_KEY
_BASE_URL = os.environ.get("OPENAI_API_BASE", "https://api.openai.com/v1")
_API_KEY = os.environ.get("OPENAI_API_KEY", "")

def _llm(model: str = "gpt-5-mini", temperature: float = 0.1, **kwargs) -> ChatOpenAI:
    return ChatOpenAI(
        model=model,
        temperature=temperature,
        base_url=_BASE_URL,
        api_key=_API_KEY,
        **kwargs,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# AGENT 1 — Document Analysis Agent
# ═══════════════════════════════════════════════════════════════════════════════

class DocAnalysisState(TypedDict):
    document_text: str
    document_type_hint: str | None
    dispute_context: dict[str, Any] | None
    # Intermediate outputs
    classification: dict[str, Any] | None
    extracted_fields: dict[str, Any] | None
    validation_issues: list[str] | None
    eligibility_flags: list[str] | None
    # Final
    result: dict[str, Any] | None


def _classify_document(state: DocAnalysisState) -> DocAnalysisState:
    """Node: classify document type and extract raw fields."""
    llm = _llm("gpt-5-mini")
    text_snippet = state["document_text"][:6000]
    hint = state.get("document_type_hint") or "unknown"

    prompt = f"""You are an NSA IDR compliance analyst. Classify this medical billing document and extract key fields.

Document type hint: {hint}

Document (first 6000 chars):
{text_snippet}

Respond with ONLY valid JSON (no markdown):
{{
  "documentType": "one of: Explanation of Benefits | QPA Documentation | Provider Contract | Medical Records | Cost Sharing Information | Prior Authorization | Open Negotiation Notice | IDR Initiation Notice | Other",
  "confidence": 0-100,
  "serviceDate": "YYYY-MM-DD or null",
  "billedAmount": number_or_null,
  "allowedAmount": number_or_null,
  "cptCodes": "comma-separated string or null",
  "providerNpi": "string or null",
  "payerName": "string or null",
  "patientState": "2-letter state code or null",
  "claimNumber": "string or null",
  "diagnosisCodes": "comma-separated ICD codes or null",
  "networkStatus": "in-network | out-of-network | unknown"
}}"""

    response = llm.invoke([HumanMessage(content=prompt)])
    try:
        raw = response.content
        # Strip markdown fences if present
        raw = re.sub(r"```(?:json)?", "", raw).strip().strip("`")
        parsed = json.loads(raw)
    except Exception:
        parsed = {"documentType": "Other", "confidence": 0}

    return {**state, "classification": parsed, "extracted_fields": parsed}


def _validate_document(state: DocAnalysisState) -> DocAnalysisState:
    """Node: validate extracted fields for NSA IDR compliance."""
    llm = _llm("gpt-5-mini")
    fields = state.get("extracted_fields") or {}
    ctx = state.get("dispute_context") or {}
    doc_type = fields.get("documentType", "Unknown")

    prompt = f"""You are an NSA IDR compliance validator. Check these extracted document fields for completeness and consistency.

Document Type: {doc_type}
Extracted Fields: {json.dumps(fields, indent=2)}
Dispute Context: {json.dumps(ctx, indent=2)}

Identify:
1. Missing required fields for this document type in an IDR proceeding
2. Data inconsistencies (e.g., billed > allowed by unusual margin, missing NPI for provider docs)
3. NSA eligibility implications (e.g., out-of-network status, emergency services, surprise billing)

Respond with ONLY valid JSON:
{{
  "validationIssues": ["list of specific issues found, empty if none"],
  "eligibilityFlags": ["list of NSA/IDR eligibility implications"],
  "isReadyForIDR": true/false,
  "missingCriticalFields": ["list of field names that are null but required"]
}}"""

    response = llm.invoke([HumanMessage(content=prompt)])
    try:
        raw = re.sub(r"```(?:json)?", "", response.content).strip().strip("`")
        parsed = json.loads(raw)
    except Exception:
        parsed = {"validationIssues": [], "eligibilityFlags": [], "isReadyForIDR": False, "missingCriticalFields": []}

    return {
        **state,
        "validation_issues": parsed.get("validationIssues", []),
        "eligibility_flags": parsed.get("eligibilityFlags", []),
    }


def _summarize_document(state: DocAnalysisState) -> DocAnalysisState:
    """Node: generate human-readable summary and suggested action."""
    llm = _llm("gpt-5-mini")
    fields = state.get("extracted_fields") or {}
    issues = state.get("validation_issues") or []
    flags = state.get("eligibility_flags") or []

    prompt = f"""Summarize this NSA IDR document analysis result in plain English for a healthcare billing specialist.

Document Type: {fields.get('documentType', 'Unknown')}
Extracted Fields: {json.dumps(fields, indent=2)}
Validation Issues: {issues}
Eligibility Flags: {flags}

Respond with ONLY valid JSON:
{{
  "summary": "2-3 sentence plain English summary of the document and its IDR relevance",
  "suggestedAction": "specific next step the party should take with this document",
  "confidenceScore": 0-100
}}"""

    response = llm.invoke([HumanMessage(content=prompt)])
    try:
        raw = re.sub(r"```(?:json)?", "", response.content).strip().strip("`")
        parsed = json.loads(raw)
    except Exception:
        parsed = {
            "summary": "Document analyzed. Please review extracted fields manually.",
            "suggestedAction": "Review and verify all extracted fields before submitting to IDR entity.",
            "confidenceScore": 50,
        }

    fields_clean = {k: v for k, v in (state.get("extracted_fields") or {}).items()
                    if k not in ("documentType", "confidence", "networkStatus")}

    result = {
        "documentType": fields.get("documentType", "Unknown"),
        "extractedFields": fields_clean,
        "validationIssues": state.get("validation_issues") or [],
        "eligibilityFlags": state.get("eligibility_flags") or [],
        "confidenceScore": parsed.get("confidenceScore", 50),
        "summary": parsed.get("summary", ""),
        "suggestedAction": parsed.get("suggestedAction", ""),
        "networkStatus": fields.get("networkStatus", "unknown"),
    }
    return {**state, "result": result}


def build_document_analysis_agent() -> Any:
    """Build and compile the LangGraph DocumentAnalysisAgent."""
    g = StateGraph(DocAnalysisState)
    g.add_node("classify", _classify_document)
    g.add_node("validate", _validate_document)
    g.add_node("summarize", _summarize_document)
    g.add_edge(START, "classify")
    g.add_edge("classify", "validate")
    g.add_edge("validate", "summarize")
    g.add_edge("summarize", END)
    return g.compile()


# ═══════════════════════════════════════════════════════════════════════════════
# AGENT 2 — CMS Submission Agent
# ═══════════════════════════════════════════════════════════════════════════════

class CMSSubmissionState(TypedDict):
    dispute: dict[str, Any]
    additional_context: str | None
    eligibility: dict[str, Any] | None
    form_fields: dict[str, Any] | None
    attachment_checklist: list[dict[str, Any]] | None
    narrative: str | None
    result: dict[str, Any] | None


def _check_eligibility(state: CMSSubmissionState) -> CMSSubmissionState:
    """Node: check NSA IDR eligibility for the dispute."""
    llm = _llm("gpt-5-mini")
    d = state["dispute"]

    prompt = f"""You are an NSA IDR eligibility specialist. Assess whether this dispute qualifies for federal IDR under 45 CFR §149.510.

Dispute Details:
- Service Type: {d.get('serviceType', 'N/A')}
- Service Date: {d.get('serviceDate', 'N/A')}
- Billed Amount: ${d.get('billedAmount', 'N/A')}
- QPA: ${d.get('qpaAmount', 'N/A')}
- Patient State: {d.get('patientState', 'N/A')}
- Facility State: {d.get('facilityState', 'N/A')}
- CPT Codes: {', '.join(d.get('cptCodes') or []) or 'N/A'}
- Initiating Party: {d.get('initiatingPartyName', 'N/A')} ({d.get('initiatingPartyType', 'N/A')})
- Responding Party: {d.get('respondingPartyName', 'N/A')} ({d.get('respondingPartyType', 'N/A')})
- Current Step: {d.get('currentStep', 'N/A')}
- Status: {d.get('status', 'N/A')}
- Open Negotiation Deadline: {d.get('openNegotiationDeadline', 'N/A')}
- IDR Initiation Deadline: {d.get('idrInitiationDeadline', 'N/A')}

NSA IDR eligibility criteria:
1. The item/service must be an emergency service, non-emergency service at an out-of-network facility, or air ambulance service
2. The open negotiation period (30 business days) must have been completed
3. IDR must be initiated within 4 business days of failed open negotiation
4. The dispute must involve a group health plan or health insurance issuer
5. The billed amount must exceed the QPA (otherwise IDR is unlikely to succeed)

Respond with ONLY valid JSON:
{{
  "isEligible": true/false,
  "eligibilityReason": "clear explanation of the eligibility determination",
  "missingRequirements": ["list of unmet requirements"],
  "warnings": ["list of compliance warnings or risk factors"],
  "estimatedDeadline": "YYYY-MM-DD or null",
  "regulatoryBasis": ["list of applicable CFR citations"]
}}"""

    response = llm.invoke([HumanMessage(content=prompt)])
    try:
        raw = re.sub(r"```(?:json)?", "", response.content).strip().strip("`")
        parsed = json.loads(raw)
    except Exception:
        parsed = {
            "isEligible": False,
            "eligibilityReason": "Unable to determine eligibility automatically",
            "missingRequirements": ["Manual review required"],
            "warnings": [],
            "estimatedDeadline": None,
            "regulatoryBasis": ["45 CFR §149.510"],
        }
    return {**state, "eligibility": parsed}


def _generate_form_fields(state: CMSSubmissionState) -> CMSSubmissionState:
    """Node: pre-fill CMS IDR portal form fields."""
    d = state["dispute"]
    import datetime

    # Deterministic field mapping — no LLM needed for structured data
    service_category_map = {
        "emergency": "Emergency Services",
        "non_emergency": "Non-Emergency Services at Out-of-Network Facility",
        "air_ambulance": "Air Ambulance Services",
        "ancillary": "Ancillary Services",
    }
    service_type = d.get("serviceType", "")
    category = next(
        (v for k, v in service_category_map.items() if k in service_type.lower()),
        "Non-Emergency Services at Out-of-Network Facility",
    )

    form_fields = {
        "disputeType": "Federal IDR",
        "serviceCategory": category,
        "serviceDate": str(d.get("serviceDate") or ""),
        "billedCharges": f"${float(d.get('billedAmount') or 0):,.2f}",
        "qpaAmount": f"${float(d.get('qpaAmount') or 0):,.2f}",
        "initiatingPartyName": d.get("initiatingPartyName", ""),
        "initiatingPartyNpi": d.get("initiatingPartyNpi", ""),
        "initiatingPartyType": (d.get("initiatingPartyType") or "").replace("_", " ").title(),
        "respondingPartyName": d.get("respondingPartyName", ""),
        "respondingPartyType": (d.get("respondingPartyType") or "").replace("_", " ").title(),
        "patientState": d.get("patientState", ""),
        "facilityState": d.get("facilityState", ""),
        "cptCodes": ", ".join(d.get("cptCodes") or []),
        "idrEntityName": d.get("idrEntityName", ""),
        "referenceNumber": d.get("referenceNumber", ""),
        "submissionDate": datetime.date.today().isoformat(),
    }

    # Attachment checklist
    checklist = [
        {"item": "Explanation of Benefits (EOB)", "status": "missing", "required": True},
        {"item": "QPA Documentation from Plan/Issuer", "status": "missing", "required": True},
        {"item": "Open Negotiation Notice (sent by initiating party)", "status": "missing", "required": True},
        {"item": "Open Negotiation Response (from responding party)", "status": "missing", "required": True},
        {"item": "IDR Initiation Notice", "status": "missing", "required": True},
        {"item": "Provider Contract (if applicable)", "status": "optional", "required": False},
        {"item": "Prior Authorization Documentation", "status": "optional", "required": False},
        {"item": "Medical Records (if clinical dispute)", "status": "optional", "required": False},
        {"item": "Cost Sharing Information", "status": "optional", "required": False},
        {"item": "Administrative Fee Payment Confirmation", "status": "missing", "required": True},
    ]

    return {**state, "form_fields": form_fields, "attachment_checklist": checklist}


def _generate_narrative(state: CMSSubmissionState) -> CMSSubmissionState:
    """Node: generate the CMS submission narrative and next steps."""
    llm = _llm("gpt-5-mini")
    d = state["dispute"]
    eligibility = state.get("eligibility") or {}
    ctx = state.get("additional_context") or ""

    prompt = f"""You are a CMS IDR submission specialist. Write a professional submission narrative for the CMS IDR portal.

Dispute: {d.get('referenceNumber', 'N/A')}
Service: {d.get('serviceType', 'N/A')} on {d.get('serviceDate', 'N/A')}
Billed: ${d.get('billedAmount', 'N/A')} | QPA: ${d.get('qpaAmount', 'N/A')}
Initiating Party: {d.get('initiatingPartyName', 'N/A')} ({d.get('initiatingPartyType', 'N/A')})
Responding Party: {d.get('respondingPartyName', 'N/A')}
Eligibility: {eligibility.get('eligibilityReason', 'N/A')}
Regulatory Basis: {', '.join(eligibility.get('regulatoryBasis', ['45 CFR §149.510']))}
Additional Context: {ctx or 'None provided'}

Write a 3-paragraph narrative explaining:
1. Nature of the dispute and why open negotiation failed
2. Why the initiating party's offer is appropriate (referencing QPA and supporting factors)
3. Relief requested and regulatory basis

Also provide 5 specific next steps the party should take.

Respond with ONLY valid JSON:
{{
  "submissionNarrative": "3-paragraph narrative text",
  "estimatedOutcome": "brief prediction of likely IDR outcome based on the facts",
  "nextSteps": ["step 1", "step 2", "step 3", "step 4", "step 5"]
}}"""

    response = llm.invoke([HumanMessage(content=prompt)])
    try:
        raw = re.sub(r"```(?:json)?", "", response.content).strip().strip("`")
        parsed = json.loads(raw)
    except Exception:
        parsed = {
            "submissionNarrative": "Please complete this narrative manually based on the dispute facts.",
            "estimatedOutcome": "Unable to estimate outcome without complete information.",
            "nextSteps": [
                "Complete all required form fields",
                "Gather and attach all required documents",
                "Pay the CMS administrative fee",
                "Submit to the CMS IDR portal at nsa-idr.cms.gov",
                "Monitor for IDR entity determination within 30 business days",
            ],
        }

    result = {
        "eligibility": state.get("eligibility"),
        "draft": {
            "formFields": state.get("form_fields") or {},
            "attachmentChecklist": state.get("attachment_checklist") or [],
            "submissionNarrative": parsed.get("submissionNarrative", ""),
            "regulatoryBasis": (state.get("eligibility") or {}).get("regulatoryBasis", ["45 CFR §149.510"]),
            "estimatedOutcome": parsed.get("estimatedOutcome", ""),
            "nextSteps": parsed.get("nextSteps", []),
        },
    }
    return {**state, "narrative": parsed.get("submissionNarrative"), "result": result}


def build_cms_submission_agent() -> Any:
    """Build and compile the LangGraph CMSSubmissionAgent."""
    g = StateGraph(CMSSubmissionState)
    g.add_node("check_eligibility", _check_eligibility)
    g.add_node("generate_form_fields", _generate_form_fields)
    g.add_node("generate_narrative", _generate_narrative)
    g.add_edge(START, "check_eligibility")
    g.add_edge("check_eligibility", "generate_form_fields")
    g.add_edge("generate_form_fields", "generate_narrative")
    g.add_edge("generate_narrative", END)
    return g.compile()


# ═══════════════════════════════════════════════════════════════════════════════
# AGENT 3 — IDR Assistant (ReAct with Tool Calling)
# ═══════════════════════════════════════════════════════════════════════════════

# ── NSA Regulatory Tools ──────────────────────────────────────────────────────

@tool
def lookup_nsa_deadline(step: str) -> str:
    """Look up the NSA regulatory deadline for a given IDR workflow step.
    
    Args:
        step: The IDR workflow step name (e.g., 'open_negotiation', 'idr_initiation', 'offer_submission')
    """
    deadlines = {
        "open_negotiation": "30 business days from the open negotiation notice (45 CFR §149.510(b)(1)(i))",
        "idr_initiation": "4 business days after open negotiation period ends (45 CFR §149.510(b)(1)(ii))",
        "idr_entity_selection": "3 business days for joint selection; 6 business days for CMS assignment (45 CFR §149.510(c)(1))",
        "eligibility_review": "3 business days from IDR entity selection (45 CFR §149.510(c)(4))",
        "offer_submission": "10 business days from eligibility determination (45 CFR §149.510(c)(4)(ii))",
        "additional_information": "5 business days after offer submission deadline (45 CFR §149.510(c)(4)(iii))",
        "determination": "30 business days from offer submission deadline (45 CFR §149.510(c)(5))",
        "payment": "30 calendar days from determination notice (45 CFR §149.510(c)(6))",
        "administrative_fee": "Same deadline as payment; $50–$350 per dispute (CMS Fee Schedule)",
        "appeal": "Must be filed in federal district court; no statutory deadline but prompt filing recommended",
    }
    step_lower = step.lower().replace(" ", "_").replace("-", "_")
    for key, value in deadlines.items():
        if key in step_lower or step_lower in key:
            return f"Deadline for {step}: {value}"
    return f"No specific deadline found for '{step}'. Refer to 45 CFR §149.510 for the complete timeline."


@tool
def lookup_qpa_methodology() -> str:
    """Explain the Qualifying Payment Amount (QPA) methodology under the NSA."""
    return """
QPA Methodology (45 CFR §149.140):

The Qualifying Payment Amount (QPA) is the median contracted rate for the same/similar item or service in the same geographic region, as of January 31, 2019, adjusted for inflation.

Key rules:
1. CALCULATION: Median of contracted rates for the same service code in the same geographic region (state or metropolitan statistical area)
2. INFLATION ADJUSTMENT: Updated annually using the Consumer Price Index for All Urban Consumers (CPI-U)
3. IDR PRESUMPTION: The IDR entity must select the offer closest to the QPA unless the non-QPA party demonstrates that credible information clearly shows the QPA is materially different from the appropriate out-of-network rate
4. PERMITTED FACTORS: IDR entities may consider: (a) provider training/experience/quality, (b) market share, (c) patient acuity/complexity, (d) teaching hospital status, (e) demonstrations of good faith efforts
5. PROHIBITED FACTORS: Usual and customary charges, billed charges, or rates paid by public payers (Medicare/Medicaid) are NOT permitted factors
6. DISCLOSURE: Plans must disclose the QPA to the provider and IDR entity

Regulatory basis: 45 CFR §149.140; NSA §2799A-1(c)
"""


@tool
def lookup_administrative_fees() -> str:
    """Look up current CMS IDR administrative fee schedule."""
    return """
CMS IDR Administrative Fee Schedule (2024-2025):

- Standard disputes: $115 per party per dispute (effective 2024)
- Batched disputes (same service code, same payer-provider pair): $115 per batch
- Fee payment deadline: Same as payment deadline (30 calendar days from determination)
- Who pays: The non-prevailing party pays both parties' administrative fees
- Waiver: CMS may waive fees in cases of financial hardship (rare)
- Portal: Fees paid through the federal IDR portal at nsa-idr.cms.gov

Note: Administrative fees are separate from the IDR entity's processing fees, which are set by the certified IDR entity and disclosed upfront.

Regulatory basis: 45 CFR §149.510(e); CMS Fee Schedule Notice (2024)
"""


@tool
def lookup_batching_rules() -> str:
    """Explain the NSA IDR batching rules for consolidating multiple disputes."""
    return """
NSA IDR Batching Rules (45 CFR §149.510(b)(2)):

Disputes may be batched (submitted together) if ALL of the following apply:
1. SAME PAYER-PROVIDER PAIR: Same plan/issuer and same provider/facility
2. SAME SERVICE CODE: Same CPT/HCPCS code (or same service category for air ambulance)
3. SAME IDR ENTITY: Same certified IDR entity selected for all batched disputes
4. TIME WINDOW: All disputes initiated within 30 business days of each other
5. SAME PLAN TYPE: All disputes must be the same type (group health plan OR individual market)

Benefits of batching:
- Single administrative fee covers the entire batch
- Faster resolution (one determination covers all batched disputes)
- Consistent outcomes for similar services

Limitations:
- Cannot batch disputes involving different service types
- Cannot batch if different IDR entities were selected
- Batching is optional — parties may choose to proceed individually

Regulatory basis: 45 CFR §149.510(b)(2); CMS Batching Guidance (2022)
"""


@tool
def lookup_appeal_rights() -> str:
    """Explain the appeal rights available after an IDR determination."""
    return """
NSA IDR Appeal Rights:

After an IDR determination, parties have limited appeal options:

1. FEDERAL COURT REVIEW (45 CFR §149.510(c)(5)(E)):
   - Either party may seek review in federal district court
   - Standard: Arbitrary and capricious (highly deferential to IDR entity)
   - Must show the IDR entity failed to follow the required process or considered prohibited factors
   - No automatic stay of payment obligation during appeal

2. RECONSIDERATION REQUEST:
   - Not formally established in the NSA; contact CMS for guidance
   - May request reconsideration if IDR entity made a clear procedural error

3. ELIGIBILITY CHALLENGE:
   - If the IDR entity finds the dispute ineligible, the initiating party may appeal that finding
   - Must be raised promptly — do not wait for the full determination

4. PRACTICAL CONSIDERATIONS:
   - Federal court appeals are expensive and rarely succeed
   - Most parties accept the determination and pay within the 30-day window
   - Consider whether the disputed amount justifies the cost of litigation

Regulatory basis: 45 CFR §149.510(c)(5)(E); NSA §2799A-1(c)(5)(E)
"""


# ── ReAct Agent Graph ─────────────────────────────────────────────────────────

class AssistantState(TypedDict):
    messages: Annotated[list, add_messages]
    dispute_context: dict[str, Any] | None


_ASSISTANT_TOOLS = [
    lookup_nsa_deadline,
    lookup_qpa_methodology,
    lookup_administrative_fees,
    lookup_batching_rules,
    lookup_appeal_rights,
]

_SYSTEM_PROMPT = """You are an expert NSA (No Surprises Act) IDR compliance advisor with deep knowledge of:
- The No Surprises Act and its implementing regulations (45 CFR Part 149)
- The federal Independent Dispute Resolution (IDR) process and all 19 workflow steps
- QPA methodology, IDR entity selection, arbitration procedures
- CMS guidance, interim final rules, and FAQs
- Timelines, deadlines, administrative fees, and appeal rights

You have access to specialized tools for looking up regulatory details. Use them when answering questions about deadlines, QPA, fees, batching, or appeals.

Always:
1. Cite specific regulatory provisions (e.g., "45 CFR §149.510(b)(1)")
2. Be precise about deadlines — errors can cause parties to lose their IDR rights
3. Distinguish between business days and calendar days
4. Flag when a question requires legal advice beyond your scope
5. Provide actionable next steps

When dispute context is provided, tailor your answer to that specific dispute."""


def _should_continue(state: AssistantState) -> Literal["tools", "end"]:
    """Route: use tools if the last message has tool calls, else end."""
    last = state["messages"][-1]
    if hasattr(last, "tool_calls") and last.tool_calls:
        return "tools"
    return "end"


def _call_model(state: AssistantState) -> AssistantState:
    """Node: call the LLM with tool-calling capability."""
    llm = _llm("gpt-5-mini").bind_tools(_ASSISTANT_TOOLS)

    ctx = state.get("dispute_context")
    system_content = _SYSTEM_PROMPT
    if ctx:
        system_content += f"\n\nCurrent Dispute Context:\n{json.dumps(ctx, indent=2)}"

    messages = [SystemMessage(content=system_content)] + state["messages"]
    response = llm.invoke(messages)
    return {**state, "messages": [response]}


def build_idr_assistant_agent() -> Any:
    """Build and compile the LangGraph IDRAssistantAgent (ReAct)."""
    tool_node = ToolNode(_ASSISTANT_TOOLS)

    g = StateGraph(AssistantState)
    g.add_node("agent", _call_model)
    g.add_node("tools", tool_node)
    g.add_edge(START, "agent")
    g.add_conditional_edges("agent", _should_continue, {"tools": "tools", "end": END})
    g.add_edge("tools", "agent")
    return g.compile()


# ─── Singleton instances (compiled once, reused across requests) ──────────────
_doc_agent = None
_cms_agent = None
_assistant_agent = None


def get_doc_agent():
    global _doc_agent
    if _doc_agent is None:
        _doc_agent = build_document_analysis_agent()
    return _doc_agent


def get_cms_agent():
    global _cms_agent
    if _cms_agent is None:
        _cms_agent = build_cms_submission_agent()
    return _cms_agent


def get_assistant_agent():
    global _assistant_agent
    if _assistant_agent is None:
        _assistant_agent = build_idr_assistant_agent()
    return _assistant_agent
