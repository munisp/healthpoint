"""
IDR Workflow Platform — AI Microservice
========================================
FastAPI server exposing three LangGraph agent endpoints.
Runs on port 8000 (configurable via AI_SERVICE_PORT env var).

Endpoints:
  POST /analyze-document    — DocumentAnalysisAgent
  POST /cms-submission      — CMSSubmissionAgent
  POST /ask-assistant       — IDRAssistantAgent (ReAct with tool calling)
  GET  /health              — Health check
  GET  /agent-info          — Agent capabilities summary
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import BaseModel, Field

from agents import get_doc_agent, get_cms_agent, get_assistant_agent

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("idr-ai-service")

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="IDR Workflow AI Service",
    description="LangGraph + LangChain agentic AI for the NSA IDR platform",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Request / Response Models ─────────────────────────────────────────────────

class DisputeContextModel(BaseModel):
    referenceNumber: str | None = None
    serviceType: str | None = None
    serviceDate: str | None = None
    billedAmount: str | None = None
    qpaAmount: str | None = None
    patientState: str | None = None
    facilityState: str | None = None
    cptCodes: list[str] | None = None
    initiatingPartyName: str | None = None
    initiatingPartyType: str | None = None
    initiatingPartyNpi: str | None = None
    respondingPartyName: str | None = None
    respondingPartyType: str | None = None
    idrEntityName: str | None = None
    currentStep: str | None = None
    status: str | None = None
    openNegotiationDeadline: str | None = None
    idrInitiationDeadline: str | None = None


class AnalyzeDocumentRequest(BaseModel):
    documentText: str = Field(..., min_length=1, max_length=100_000)
    documentType: str | None = None
    disputeContext: dict[str, Any] | None = None


class CMSSubmissionRequest(BaseModel):
    dispute: DisputeContextModel
    additionalContext: str | None = None


class ConversationMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class AskAssistantRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    disputeContext: dict[str, Any] | None = None
    conversationHistory: list[ConversationMessage] | None = None


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "IDR AI Service",
        "agents": ["DocumentAnalysisAgent", "CMSSubmissionAgent", "IDRAssistantAgent"],
        "stack": "LangGraph + LangChain + FastAPI",
    }


@app.get("/agent-info")
async def agent_info():
    return {
        "agents": [
            {
                "name": "DocumentAnalysisAgent",
                "type": "LangGraph Sequential Graph",
                "nodes": ["classify", "validate", "summarize"],
                "description": "Extracts, validates, and classifies medical billing documents for NSA IDR compliance",
                "endpoint": "POST /analyze-document",
            },
            {
                "name": "CMSSubmissionAgent",
                "type": "LangGraph Sequential Graph",
                "nodes": ["check_eligibility", "generate_form_fields", "generate_narrative"],
                "description": "Checks IDR eligibility and generates pre-filled CMS portal submission drafts",
                "endpoint": "POST /cms-submission",
            },
            {
                "name": "IDRAssistantAgent",
                "type": "LangGraph ReAct (tool-calling)",
                "tools": [
                    "lookup_nsa_deadline",
                    "lookup_qpa_methodology",
                    "lookup_administrative_fees",
                    "lookup_batching_rules",
                    "lookup_appeal_rights",
                ],
                "description": "Answers NSA IDR questions with regulatory tool calling and citation",
                "endpoint": "POST /ask-assistant",
            },
        ]
    }


@app.post("/analyze-document")
async def analyze_document(request: AnalyzeDocumentRequest):
    """
    Run the DocumentAnalysisAgent on provided document text.
    
    The agent runs three LangGraph nodes:
    1. classify — identify document type and extract fields
    2. validate — check NSA IDR compliance and flag issues
    3. summarize — generate human-readable summary and suggested action
    """
    start = time.time()
    logger.info(f"[DocumentAnalysisAgent] Processing document ({len(request.documentText)} chars)")

    try:
        agent = get_doc_agent()
        initial_state = {
            "document_text": request.documentText,
            "document_type_hint": request.documentType,
            "dispute_context": request.disputeContext,
            "classification": None,
            "extracted_fields": None,
            "validation_issues": None,
            "eligibility_flags": None,
            "result": None,
        }

        final_state = await asyncio.get_event_loop().run_in_executor(
            None, lambda: agent.invoke(initial_state)
        )

        result = final_state.get("result") or {}
        elapsed = round(time.time() - start, 2)
        logger.info(f"[DocumentAnalysisAgent] Completed in {elapsed}s — type: {result.get('documentType')}")

        return {
            "success": True,
            "processingTimeSeconds": elapsed,
            "agentTrace": ["classify", "validate", "summarize"],
            **result,
        }

    except Exception as e:
        logger.error(f"[DocumentAnalysisAgent] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Document analysis failed: {str(e)}")


@app.post("/analyze-document-file")
async def analyze_document_file(
    file: UploadFile = File(...),
    disputeId: str | None = Form(None),
):
    """
    Accept a file upload (PDF, TXT, or image) and run DocumentAnalysisAgent.
    Extracts text from PDF using pdfplumber before analysis.
    """
    import pdfplumber
    import io

    start = time.time()
    content = await file.read()
    filename = file.filename or "unknown"
    logger.info(f"[DocumentAnalysisAgent] File upload: {filename} ({len(content)} bytes)")

    # Extract text
    text = ""
    if filename.lower().endswith(".pdf"):
        try:
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                pages = [p.extract_text() or "" for p in pdf.pages]
                text = "\n\n".join(pages)
        except Exception as e:
            logger.warning(f"PDF extraction failed: {e}")
            text = content.decode("utf-8", errors="replace")
    else:
        text = content.decode("utf-8", errors="replace")

    if not text.strip():
        raise HTTPException(status_code=422, detail="Could not extract text from the uploaded file")

    # Infer document type from filename
    doc_type_hint = None
    name_lower = filename.lower()
    if "eob" in name_lower or "explanation" in name_lower:
        doc_type_hint = "Explanation of Benefits"
    elif "qpa" in name_lower:
        doc_type_hint = "QPA Documentation"
    elif "contract" in name_lower:
        doc_type_hint = "Provider Contract"
    elif "auth" in name_lower:
        doc_type_hint = "Prior Authorization"
    elif "record" in name_lower or "medical" in name_lower:
        doc_type_hint = "Medical Records"

    try:
        agent = get_doc_agent()
        initial_state = {
            "document_text": text[:50000],
            "document_type_hint": doc_type_hint,
            "dispute_context": None,
            "classification": None,
            "extracted_fields": None,
            "validation_issues": None,
            "eligibility_flags": None,
            "result": None,
        }
        final_state = await asyncio.get_event_loop().run_in_executor(
            None, lambda: agent.invoke(initial_state)
        )
        result = final_state.get("result") or {}
        elapsed = round(time.time() - start, 2)
        return {
            "success": True,
            "filename": filename,
            "extractedTextLength": len(text),
            "processingTimeSeconds": elapsed,
            **result,
        }
    except Exception as e:
        logger.error(f"[DocumentAnalysisAgent] File error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/cms-submission")
async def cms_submission(request: CMSSubmissionRequest):
    """
    Run the CMSSubmissionAgent to generate a CMS IDR portal submission draft.
    
    The agent runs three LangGraph nodes:
    1. check_eligibility — assess NSA IDR eligibility
    2. generate_form_fields — pre-fill CMS portal form fields
    3. generate_narrative — write submission narrative and next steps
    """
    start = time.time()
    dispute_dict = request.dispute.model_dump(exclude_none=True)
    logger.info(f"[CMSSubmissionAgent] Processing dispute: {dispute_dict.get('referenceNumber', 'N/A')}")

    try:
        agent = get_cms_agent()
        initial_state = {
            "dispute": dispute_dict,
            "additional_context": request.additionalContext,
            "eligibility": None,
            "form_fields": None,
            "attachment_checklist": None,
            "narrative": None,
            "result": None,
        }
        final_state = await asyncio.get_event_loop().run_in_executor(
            None, lambda: agent.invoke(initial_state)
        )
        result = final_state.get("result") or {}
        elapsed = round(time.time() - start, 2)
        logger.info(f"[CMSSubmissionAgent] Completed in {elapsed}s")

        return {
            "success": True,
            "processingTimeSeconds": elapsed,
            "agentTrace": ["check_eligibility", "generate_form_fields", "generate_narrative"],
            **result,
        }

    except Exception as e:
        logger.error(f"[CMSSubmissionAgent] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"CMS submission generation failed: {str(e)}")


@app.post("/ask-assistant")
async def ask_assistant(request: AskAssistantRequest):
    """
    Run the IDRAssistantAgent (ReAct) to answer NSA IDR questions.
    
    The agent uses LangGraph with tool calling:
    - Calls regulatory lookup tools as needed
    - Iterates until it has a complete, cited answer
    - Returns the answer with sources and suggested actions
    """
    start = time.time()
    logger.info(f"[IDRAssistantAgent] Question: {request.question[:100]}...")

    try:
        agent = get_assistant_agent()

        # Build message history
        messages = []
        for msg in (request.conversationHistory or []):
            if msg.role == "user":
                messages.append(HumanMessage(content=msg.content))
            elif msg.role == "assistant":
                messages.append(AIMessage(content=msg.content))

        messages.append(HumanMessage(content=request.question))

        initial_state = {
            "messages": messages,
            "dispute_context": request.disputeContext,
        }

        final_state = await asyncio.get_event_loop().run_in_executor(
            None, lambda: agent.invoke(initial_state)
        )

        # Extract the final AI response
        final_messages = final_state.get("messages", [])
        answer_msg = None
        tools_used = []
        for msg in reversed(final_messages):
            if isinstance(msg, AIMessage) and msg.content:
                answer_msg = msg
                break
        # Collect tool names used
        for msg in final_messages:
            if hasattr(msg, "name") and msg.name:
                tools_used.append(msg.name)

        answer_text = answer_msg.content if answer_msg else "I was unable to generate a response."
        elapsed = round(time.time() - start, 2)
        logger.info(f"[IDRAssistantAgent] Completed in {elapsed}s — tools used: {tools_used}")

        # Try to parse structured JSON from the answer
        import json, re
        sources = []
        suggested_actions = []
        confidence = "medium"
        final_answer = answer_text

        json_match = re.search(r'\{[\s\S]*"answer"[\s\S]*\}', answer_text)
        if json_match:
            try:
                parsed = json.loads(json_match.group())
                final_answer = parsed.get("answer", answer_text)
                sources = parsed.get("sources", [])
                suggested_actions = parsed.get("suggestedActions", [])
                confidence = parsed.get("confidence", "medium")
            except Exception:
                pass

        return {
            "success": True,
            "processingTimeSeconds": elapsed,
            "toolsUsed": list(set(tools_used)),
            "answer": final_answer,
            "sources": sources,
            "confidence": confidence,
            "suggestedActions": suggested_actions,
        }

    except Exception as e:
        logger.error(f"[IDRAssistantAgent] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Assistant query failed: {str(e)}")


# ─── Entry point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("AI_SERVICE_PORT", "8000"))
    logger.info(f"Starting IDR AI Service on port {port}")
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=False,
        log_level="info",
    )
