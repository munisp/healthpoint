import { createHash, randomUUID } from "node:crypto";

export type CmsSubmissionStatus =
  | "pending"
  | "submitted"
  | "acknowledged"
  | "rejected_validation"
  | "accepted_pending_reconciliation"
  | "failed";

export type CmsFeedbackType =
  | "eligibility_requested"
  | "additional_information_requested"
  | "entity_assigned"
  | "determination"
  | "closed"
  | "withdrawn";

export interface CmsDocumentInput {
  documentId: string;
  fileName: string;
  mimeType: string;
  content: Buffer;
}

/**
 * Prepared material for a human operator to enter in the CMS portal. This is
 * deliberately not an API-submission contract: CMS portal activity must be
 * performed by an authorized human and recorded afterwards with a receipt.
 */
export interface CmsNoticeSubmission {
  disputeId: string;
  idempotencyKey: string;
  pilotAuthorizationId: string;
  handoffOperatorId: string;
  schemaVersion: string;
  initiatedBy: string;
  openNegotiationEndedAt: string;
  submissionDeadline: string;
  claimNumbers: string[];
  serviceCodes: string[];
  serviceDates: string[];
  serviceLocations: string[];
  serviceType: string;
  initiatingParty: Record<string, unknown>;
  respondingParty: Record<string, unknown>;
  eligibilityAttestation: boolean;
  preferredIdrEntity?: string;
  totalPaymentAmountCents: number;
  currency: string;
  documents: CmsDocumentInput[];
  metadata?: Record<string, unknown>;
}

export interface CmsSubmissionReceipt {
  cmsReference: string;
  submissionId: string;
  status: "accepted" | "rejected" | "duplicate";
  receivedAt: string;
  payloadHash: string;
  receiptSha256: string;
  recordedBy: string;
}

export interface CmsFeedbackEnvelope {
  eventId: string;
  cmsReference: string;
  disputeId: string;
  type: CmsFeedbackType;
  occurredAt: string;
  keyId: string;
  signature: string;
  payload: Record<string, unknown>;
}

export interface VerifiedCmsFeedback {
  eventId: string;
  cmsReference: string;
  disputeId: string;
  type: CmsFeedbackType;
  occurredAt: string;
  payload: Record<string, unknown>;
  payloadHash: string;
}

export interface CmsSubmissionRecord {
  submissionId: string;
  disputeId: string;
  idempotencyKey: string;
  payloadHash: string;
  pilotAuthorizationId: string;
  handoffOperatorId: string;
  status: CmsSubmissionStatus;
  cmsReference?: string;
  portalReceiptSha256?: string;
  portalReceiptRecordedBy?: string;
  portalReceiptReceivedAt?: Date;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  payload?: CmsNoticeSubmission;
}

export interface CmsSubmissionStore {
  findByIdempotency(
    disputeId: string,
    idempotencyKey: string
  ): Promise<CmsSubmissionRecord | null>;
  findBySubmissionId(submissionId: string): Promise<CmsSubmissionRecord | null>;
  insert(record: CmsSubmissionRecord): Promise<CmsSubmissionRecord>;
  update(
    submissionId: string,
    patch: Partial<CmsSubmissionRecord>
  ): Promise<CmsSubmissionRecord>;
  appendFeedback(
    feedback: VerifiedCmsFeedback
  ): Promise<"inserted" | "duplicate">;
}

export type ManualPortalReceiptInput = {
  submissionId: string;
  cmsReference: string;
  receivedAt: string;
  receiptSha256: string;
  recordedBy: string;
  outcome: "accepted" | "rejected";
  rejectionReason?: string;
};

/**
 * Creates auditable preparation records for manual portal work. It never
 * performs an HTTP request to CMS and deliberately cannot manufacture a
 * receipt. The human operator records the receipt after portal completion.
 */
export class ManualCmsHandoffAdapter {
  constructor(private readonly store: CmsSubmissionStore) {}

  async prepareHandoff(input: CmsNoticeSubmission): Promise<CmsSubmissionRecord> {
    validateSubmissionOrThrow(input);
    const existing = await this.store.findByIdempotency(
      input.disputeId,
      input.idempotencyKey
    );
    if (existing) return existing;

    const now = new Date().toISOString();
    return this.store.insert({
      submissionId: `hp-cms-${randomUUID()}`,
      disputeId: input.disputeId,
      idempotencyKey: input.idempotencyKey,
      payloadHash: hashPayload(serializeSubmission(input)),
      pilotAuthorizationId: input.pilotAuthorizationId,
      handoffOperatorId: input.handoffOperatorId,
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      payload: deserializeStoredSubmission(serializeSubmissionForStorage(input)),
    });
  }

  async recordHumanPortalReceipt(
    input: ManualPortalReceiptInput
  ): Promise<CmsSubmissionReceipt> {
    if (!input.submissionId || !input.cmsReference || !input.recordedBy) {
      throw new Error(
        "Manual CMS receipt requires submission ID, CMS reference, and authorized operator identity"
      );
    }
    if (!/^[a-f0-9]{64}$/i.test(input.receiptSha256)) {
      throw new Error("Manual CMS receipt requires a SHA-256 receipt digest");
    }
    if (Number.isNaN(Date.parse(input.receivedAt))) {
      throw new Error("Manual CMS receipt requires a valid receipt timestamp");
    }

    const record = await this.store.findBySubmissionId(input.submissionId);
    if (!record) throw new Error("CMS handoff record was not found");
    if (record.handoffOperatorId !== input.recordedBy) {
      throw new Error("CMS portal receipt must be recorded by the authorized handoff operator");
    }
    if (record.cmsReference) {
      if (record.cmsReference !== input.cmsReference) {
        throw new Error("CMS reference conflicts with the immutable recorded receipt");
      }
      return {
        cmsReference: record.cmsReference,
        submissionId: record.submissionId,
        status: "duplicate",
        receivedAt: record.updatedAt,
        payloadHash: record.payloadHash,
        receiptSha256: input.receiptSha256,
        recordedBy: input.recordedBy,
      };
    }

    const status: CmsSubmissionStatus =
      input.outcome === "accepted" ? "acknowledged" : "rejected_validation";
    const updated = await this.store.update(record.submissionId, {
      status,
      cmsReference: input.cmsReference,
      portalReceiptSha256: input.receiptSha256.toLowerCase(),
      portalReceiptRecordedBy: input.recordedBy,
      portalReceiptReceivedAt: new Date(input.receivedAt),
      attempts: record.attempts + 1,
      lastError: input.rejectionReason,
    });
    return {
      cmsReference: input.cmsReference,
      submissionId: updated.submissionId,
      status: input.outcome,
      receivedAt: input.receivedAt,
      payloadHash: updated.payloadHash,
      receiptSha256: input.receiptSha256,
      recordedBy: input.recordedBy,
    };
  }

  async verifyFeedback(_input: CmsFeedbackEnvelope): Promise<VerifiedCmsFeedback> {
    throw new Error(
      "CMS feedback must be cryptographically verified by an approved gateway or manually verified under an approved operational procedure before persistence"
    );
  }
}

export function serializeSubmission(
  input: CmsNoticeSubmission
): Record<string, unknown> {
  return {
    ...input,
    documents: input.documents.map(document => ({
      documentId: document.documentId,
      fileName: document.fileName,
      mimeType: document.mimeType,
      contentSha256: hashBuffer(document.content),
      sizeBytes: document.content.byteLength,
    })),
  };
}

function validateSubmission(
  input: CmsNoticeSubmission
): Array<{ code: string; field?: string; message: string }> {
  const errors: Array<{ code: string; field?: string; message: string }> = [];
  if (!input.disputeId)
    errors.push({
      code: "REQUIRED",
      field: "disputeId",
      message: "disputeId is required",
    });
  if (!input.idempotencyKey)
    errors.push({
      code: "REQUIRED",
      field: "idempotencyKey",
      message: "idempotencyKey is required",
    });
  if (!input.pilotAuthorizationId)
    errors.push({
      code: "PILOT_AUTHORIZATION_REQUIRED",
      field: "pilotAuthorizationId",
      message: "an active CMS pilot authorization is required",
    });
  if (!input.handoffOperatorId)
    errors.push({
      code: "HANDOFF_OPERATOR_REQUIRED",
      field: "handoffOperatorId",
      message: "an authorized human handoff operator is required",
    });
  if (!input.eligibilityAttestation)
    errors.push({
      code: "ATTESTATION_REQUIRED",
      field: "eligibilityAttestation",
      message: "eligibility attestation is required",
    });
  if (!input.claimNumbers.length)
    errors.push({
      code: "REQUIRED",
      field: "claimNumbers",
      message: "at least one claim number is required",
    });
  if (!input.serviceCodes.length)
    errors.push({
      code: "REQUIRED",
      field: "serviceCodes",
      message: "at least one service code is required",
    });
  if (
    !Number.isSafeInteger(input.totalPaymentAmountCents) ||
    input.totalPaymentAmountCents <= 0
  )
    errors.push({
      code: "INVALID_AMOUNT",
      field: "totalPaymentAmountCents",
      message: "amount must be a positive integer number of cents",
    });
  if (input.documents.some(document => document.content.byteLength === 0))
    errors.push({
      code: "INVALID_DOCUMENT",
      field: "documents",
      message: "documents must contain bytes",
    });
  return errors;
}

export function validateManualCmsHandoff(input: CmsNoticeSubmission): void {
  const errors = validateSubmission(input);
  if (errors.length > 0) {
    throw new Error(
      `CMS handoff validation failed: ${errors.map(error => error.code).join(",")}`
    );
  }
}

function validateSubmissionOrThrow(input: CmsNoticeSubmission): void {
  validateManualCmsHandoff(input);
}

export function serializeSubmissionForStorage(
  input: CmsNoticeSubmission
): Record<string, unknown> {
  return {
    ...input,
    documents: input.documents.map(document => ({
      documentId: document.documentId,
      fileName: document.fileName,
      mimeType: document.mimeType,
      contentBase64: document.content.toString("base64"),
    })),
  };
}

export function deserializeStoredSubmission(
  input: Record<string, unknown>
): CmsNoticeSubmission {
  const documents = Array.isArray(input.documents)
    ? input.documents.map(document => {
        const value = document as Record<string, unknown>;
        return {
          documentId: String(value.documentId),
          fileName: String(value.fileName),
          mimeType: String(value.mimeType),
          content: Buffer.from(String(value.contentBase64 ?? ""), "base64"),
        };
      })
    : [];
  return { ...input, documents } as CmsNoticeSubmission;
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
