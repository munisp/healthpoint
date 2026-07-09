/**
 * Agentic AI Layer — IDR Workflow Platform
 *
 * Two agents:
 * 1. DocumentAnalysisAgent — extracts, validates, and classifies uploaded evidence
 * 2. CMSSubmissionAgent — pre-fills CMS IDR portal form data, checks eligibility, tracks submissions
 *
 * Both use the built-in LLM via invokeLLM (server-side only).
 */

import { invokeLLM } from "./_core/llm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DocumentAnalysisResult {
  documentType: string;
  extractedFields: Record<string, string | number | null>;
  validationIssues: string[];
  eligibilityFlags: string[];
  confidenceScore: number; // 0–100
  summary: string;
  suggestedAction: string;
  rawText?: string;
}

export interface CMSEligibilityResult {
  isEligible: boolean;
  eligibilityReason: string;
  missingRequirements: string[];
  warnings: string[];
  estimatedDeadline: string | null;
}

export interface CMSSubmissionDraft {
  formFields: Record<string, string>;
  attachmentChecklist: Array<{ item: string; status: "ready" | "missing" | "optional" }>;
  submissionNarrative: string;
  regulatoryBasis: string[];
  estimatedOutcome: string;
  nextSteps: string[];
}

export interface AIAssistantResponse {
  answer: string;
  sources: string[];
  confidence: "high" | "medium" | "low";
  suggestedActions: string[];
}

// ─── 1. Document Analysis Agent ───────────────────────────────────────────────

/**
 * Analyzes a document (provided as text or base64 content) to:
 * - Identify document type (EOB, QPA documentation, contract, medical records, etc.)
 * - Extract key fields (dates, amounts, CPT codes, NPI numbers, etc.)
 * - Flag validation issues (missing required fields, inconsistencies)
 * - Assess IDR eligibility implications
 */
export async function analyzeDocument(params: {
  documentText: string;
  documentType?: string;
  disputeContext?: {
    billedAmount?: string;
    qpaAmount?: string;
    serviceType?: string;
    serviceDate?: string;
    patientState?: string;
  };
}): Promise<DocumentAnalysisResult> {
  const systemPrompt = `You are an expert NSA (No Surprises Act) IDR compliance analyst. 
Your role is to analyze medical billing documents for use in the federal Independent Dispute Resolution (IDR) process.
You must extract key information, identify compliance issues, and assess relevance to the IDR dispute.
Always respond with valid JSON matching the exact schema provided.`;

  const userPrompt = `Analyze the following document for NSA IDR compliance purposes.

Document Type Hint: ${params.documentType ?? "Unknown — please classify"}

Document Content:
${params.documentText.slice(0, 8000)}

${params.disputeContext ? `
Dispute Context:
- Billed Amount: ${params.disputeContext.billedAmount ?? "N/A"}
- QPA: ${params.disputeContext.qpaAmount ?? "N/A"}
- Service Type: ${params.disputeContext.serviceType ?? "N/A"}
- Service Date: ${params.disputeContext.serviceDate ?? "N/A"}
- Patient State: ${params.disputeContext.patientState ?? "N/A"}
` : ""}

Extract and return a JSON object with this exact structure:
{
  "documentType": "string (e.g., 'Explanation of Benefits', 'QPA Documentation', 'Provider Contract', 'Medical Records', 'Cost Sharing Information', 'Prior Authorization')",
  "extractedFields": {
    "serviceDate": "string or null",
    "billedAmount": "number or null",
    "allowedAmount": "number or null",
    "cptCodes": "string (comma-separated) or null",
    "providerNpi": "string or null",
    "payerName": "string or null",
    "patientState": "string or null",
    "claimNumber": "string or null",
    "diagnosisCodes": "string or null"
  },
  "validationIssues": ["array of strings describing any missing required fields or inconsistencies"],
  "eligibilityFlags": ["array of strings describing IDR eligibility implications"],
  "confidenceScore": "integer 0-100",
  "summary": "2-3 sentence summary of the document and its relevance to the IDR dispute",
  "suggestedAction": "string describing what the party should do next with this document"
}`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "document_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              documentType: { type: "string" },
              extractedFields: {
                type: "object",
                properties: {
                  serviceDate: { type: ["string", "null"] },
                  billedAmount: { type: ["number", "null"] },
                  allowedAmount: { type: ["number", "null"] },
                  cptCodes: { type: ["string", "null"] },
                  providerNpi: { type: ["string", "null"] },
                  payerName: { type: ["string", "null"] },
                  patientState: { type: ["string", "null"] },
                  claimNumber: { type: ["string", "null"] },
                  diagnosisCodes: { type: ["string", "null"] },
                },
                required: ["serviceDate", "billedAmount", "allowedAmount", "cptCodes", "providerNpi", "payerName", "patientState", "claimNumber", "diagnosisCodes"],
                additionalProperties: false,
              },
              validationIssues: { type: "array", items: { type: "string" } },
              eligibilityFlags: { type: "array", items: { type: "string" } },
              confidenceScore: { type: "integer" },
              summary: { type: "string" },
              suggestedAction: { type: "string" },
            },
            required: ["documentType", "extractedFields", "validationIssues", "eligibilityFlags", "confidenceScore", "summary", "suggestedAction"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0].message.content;
    const parsed = JSON.parse(content as string) as DocumentAnalysisResult;
    return parsed;
  } catch (err: any) {
    console.error("[DocumentAnalysisAgent] Error:", err.message);
    return {
      documentType: "Unknown",
      extractedFields: {},
      validationIssues: ["AI analysis failed — please review manually"],
      eligibilityFlags: [],
      confidenceScore: 0,
      summary: "Document analysis could not be completed automatically.",
      suggestedAction: "Review the document manually and consult your IDR entity.",
    };
  }
}

// ─── 2. CMS Submission Agent ──────────────────────────────────────────────────

/**
 * Checks eligibility for CMS IDR portal submission and generates a pre-filled
 * submission draft with form fields, attachment checklist, and narrative.
 */
export async function generateCMSSubmissionDraft(params: {
  dispute: {
    referenceNumber: string;
    serviceType: string;
    serviceDate?: string | null;
    billedAmount?: string | null;
    qpaAmount?: string | null;
    patientState?: string | null;
    facilityState?: string | null;
    cptCodes?: string[] | null;
    initiatingPartyName: string;
    initiatingPartyType?: string | null;
    initiatingPartyNpi?: string | null;
    respondingPartyName?: string | null;
    respondingPartyType?: string | null;
    idrEntityName?: string | null;
    currentStep: string;
    status: string;
    openNegotiationDeadline?: Date | null;
    idrInitiationDeadline?: Date | null;
  };
  additionalContext?: string;
}): Promise<{ eligibility: CMSEligibilityResult; draft: CMSSubmissionDraft }> {
  const { dispute } = params;

  const systemPrompt = `You are a CMS (Centers for Medicare & Medicaid Services) IDR portal submission specialist.
You help healthcare providers and payors prepare accurate, compliant submissions for the federal Independent Dispute Resolution process under the No Surprises Act (45 CFR §149.510).
Always respond with valid JSON matching the exact schema provided.`;

  const userPrompt = `Generate a CMS IDR portal submission draft for the following dispute:

Reference: ${dispute.referenceNumber}
Service Type: ${dispute.serviceType}
Service Date: ${dispute.serviceDate ?? "Not provided"}
Billed Amount: $${dispute.billedAmount ?? "Not provided"}
QPA: $${dispute.qpaAmount ?? "Not provided"}
Patient State: ${dispute.patientState ?? "Not provided"}
Facility State: ${dispute.facilityState ?? "Not provided"}
CPT Codes: ${dispute.cptCodes?.join(", ") ?? "Not provided"}
Initiating Party: ${dispute.initiatingPartyName} (${dispute.initiatingPartyType ?? "type unknown"})
Initiating NPI: ${dispute.initiatingPartyNpi ?? "Not provided"}
Responding Party: ${dispute.respondingPartyName ?? "Not identified"} (${dispute.respondingPartyType ?? "type unknown"})
IDR Entity: ${dispute.idrEntityName ?? "Not yet selected"}
Current Step: ${dispute.currentStep}
Status: ${dispute.status}
Open Negotiation Deadline: ${dispute.openNegotiationDeadline ? new Date(dispute.openNegotiationDeadline).toLocaleDateString() : "Not set"}
IDR Initiation Deadline: ${dispute.idrInitiationDeadline ? new Date(dispute.idrInitiationDeadline).toLocaleDateString() : "Not set"}

${params.additionalContext ? `Additional Context: ${params.additionalContext}` : ""}

Return a JSON object with this exact structure:
{
  "eligibility": {
    "isEligible": true/false,
    "eligibilityReason": "string explaining the eligibility determination",
    "missingRequirements": ["array of missing required items"],
    "warnings": ["array of compliance warnings"],
    "estimatedDeadline": "string date or null"
  },
  "draft": {
    "formFields": {
      "disputeType": "string",
      "serviceCategory": "string",
      "serviceDate": "string",
      "billedCharges": "string",
      "qpaAmount": "string",
      "initiatingPartyName": "string",
      "initiatingPartyNpi": "string",
      "respondingPartyName": "string",
      "patientState": "string",
      "cptCodes": "string",
      "openNegotiationDate": "string",
      "idrInitiationDate": "string"
    },
    "attachmentChecklist": [
      { "item": "string", "status": "ready|missing|optional" }
    ],
    "submissionNarrative": "string (2-3 paragraphs explaining the dispute for CMS)",
    "regulatoryBasis": ["array of applicable regulatory citations e.g. '45 CFR §149.510(b)(1)'"],
    "estimatedOutcome": "string describing likely outcome based on the facts",
    "nextSteps": ["array of action items the party should take"]
  }
}`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const content = response.choices[0].message.content as string;
    // Extract JSON from the response (may have markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    const parsed = JSON.parse(jsonMatch[0]) as { eligibility: CMSEligibilityResult; draft: CMSSubmissionDraft };
    return parsed;
  } catch (err: any) {
    console.error("[CMSSubmissionAgent] Error:", err.message);
    return {
      eligibility: {
        isEligible: false,
        eligibilityReason: "Unable to determine eligibility — AI analysis failed",
        missingRequirements: ["Manual review required"],
        warnings: ["Please verify all fields manually before submitting to CMS"],
        estimatedDeadline: null,
      },
      draft: {
        formFields: {
          disputeType: dispute.serviceType,
          initiatingPartyName: dispute.initiatingPartyName,
          respondingPartyName: dispute.respondingPartyName ?? "",
          patientState: dispute.patientState ?? "",
          cptCodes: dispute.cptCodes?.join(", ") ?? "",
          billedCharges: dispute.billedAmount ?? "",
          qpaAmount: dispute.qpaAmount ?? "",
          serviceDate: dispute.serviceDate ?? "",
          serviceCategory: "",
          initiatingPartyNpi: dispute.initiatingPartyNpi ?? "",
          openNegotiationDate: "",
          idrInitiationDate: "",
        },
        attachmentChecklist: [
          { item: "Explanation of Benefits (EOB)", status: "missing" },
          { item: "QPA Documentation", status: "missing" },
          { item: "Open Negotiation Notice", status: "missing" },
          { item: "Provider Contract (if applicable)", status: "optional" },
        ],
        submissionNarrative: "Please complete this narrative manually.",
        regulatoryBasis: ["45 CFR §149.510", "NSA §2799A-1"],
        estimatedOutcome: "Unable to estimate — insufficient data",
        nextSteps: ["Complete all required fields", "Attach supporting documents", "Submit to CMS IDR portal"],
      },
    };
  }
}

// ─── 3. AI Assistant (Q&A) ────────────────────────────────────────────────────

/**
 * Answers NSA IDR questions using built-in regulatory knowledge.
 * Provides citations and suggested actions.
 */
export async function askIDRAssistant(params: {
  question: string;
  disputeContext?: {
    referenceNumber?: string;
    currentStep?: string;
    status?: string;
    serviceType?: string;
    billedAmount?: string;
    qpaAmount?: string;
  };
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<AIAssistantResponse> {
  const systemPrompt = `You are an expert NSA (No Surprises Act) IDR compliance advisor with deep knowledge of:
- The No Surprises Act (NSA) and its implementing regulations (45 CFR Part 149)
- The federal Independent Dispute Resolution (IDR) process and all 19 workflow steps
- CMS guidance documents, FAQs, and interim final rules
- Qualifying Payment Amount (QPA) methodology
- IDR entity selection and arbitration procedures
- Timelines, deadlines, and administrative fee requirements
- Appeal rights and federal court review

Provide accurate, actionable guidance. Always cite specific regulatory provisions when relevant.
Be concise but thorough. If you are uncertain, say so clearly.
Format your response as JSON with the exact schema provided.`;

  const contextBlock = params.disputeContext
    ? `\nCurrent Dispute Context:
- Reference: ${params.disputeContext.referenceNumber ?? "N/A"}
- Step: ${params.disputeContext.currentStep ?? "N/A"}
- Status: ${params.disputeContext.status ?? "N/A"}
- Service Type: ${params.disputeContext.serviceType ?? "N/A"}
- Billed Amount: $${params.disputeContext.billedAmount ?? "N/A"}
- QPA: $${params.disputeContext.qpaAmount ?? "N/A"}`
    : "";

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...(params.conversationHistory ?? []),
    {
      role: "user",
      content: `${contextBlock}\n\nQuestion: ${params.question}\n\nRespond with JSON: { "answer": "...", "sources": ["..."], "confidence": "high|medium|low", "suggestedActions": ["..."] }`,
    },
  ];

  try {
    const response = await invokeLLM({ messages });
    const content = response.choices[0].message.content as string;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        answer: content,
        sources: [],
        confidence: "medium",
        suggestedActions: [],
      };
    }
    return JSON.parse(jsonMatch[0]) as AIAssistantResponse;
  } catch (err: any) {
    console.error("[AIAssistant] Error:", err.message);
    return {
      answer: "I encountered an error processing your question. Please try again.",
      sources: [],
      confidence: "low",
      suggestedActions: ["Retry your question", "Contact your IDR entity for guidance"],
    };
  }
}
