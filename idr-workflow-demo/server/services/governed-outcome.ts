import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  documentValidationRuns,
  documentValidationStepEvidence,
  modelApprovalGates,
  modelDataUseApprovals,
  modelGovernanceModels,
  modelValidationDatasets,
  modelValidationRuns,
  outcomePredictions,
} from "../../drizzle/schema";
import { assertDisputeAccess } from "../authz";
import { getDb, getDisputeById } from "../db";
import {
  assertCompleteDocumentValidationEvidence,
  assertIdrProbabilityApproval,
  DOCUMENT_VALIDATION_STEPS,
  type DocumentValidationEvidence,
} from "./model-governance";

export type GovernedOutcomeContext = {
  dispute: NonNullable<Awaited<ReturnType<typeof getDisputeById>>>;
  modelId: string;
  modelVersion: string;
  modelArtifactSha256: string;
  modelValidationRunId: string;
  modelApprovalGateId: string;
  dataUseApprovalId: string;
  documentValidationRunId: string;
  governanceApprovedAt: Date;
};

export type GovernedOutcomePredictionInput = {
  winProbability: number;
  confidenceScore: number;
  confidenceInterval: [number, number];
  keyFactors: string[];
  recommendation: string;
};

function unavailable(message: string): TRPCError {
  return new TRPCError({ code: "PRECONDITION_FAILED", message });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw unavailable(`${name} is required for governed outcome predictions`);
  return value;
}

function requireApprovedOutcomeRuntime(): { url: string; token: string } {
  if (process.env.GOVERNED_OUTCOME_PREDICTIONS_ENABLED !== "true") {
    throw unavailable(
      "Governed outcome predictions are disabled until an approved Georgetown runtime is configured"
    );
  }
  if (process.env.GOVERNED_OUTCOME_RUNTIME !== "georgetown") {
    throw unavailable(
      "GOVERNED_OUTCOME_RUNTIME must be set to georgetown; general-purpose LLM outcome predictions are prohibited"
    );
  }
  const url = requiredEnvironment("GEORGETOWN_MODEL_URL");
  const token = requiredEnvironment("GEORGETOWN_MODEL_TOKEN");
  if (process.env.NODE_ENV === "production" && !/^https:\/\//i.test(url)) {
    throw unavailable("GEORGETOWN_MODEL_URL must use HTTPS in production");
  }
  return { url, token };
}

function asApprovedDocumentEvidence(input: {
  run: typeof documentValidationRuns.$inferSelect;
  steps: Array<typeof documentValidationStepEvidence.$inferSelect>;
}): DocumentValidationEvidence {
  const stepEvidence = Object.fromEntries(
    input.steps.map(step => [
      step.step,
      {
        evidenceSha256: step.evidenceSha256,
        completedAt: step.completedAt.toISOString(),
        actor: step.actor,
      },
    ])
  ) as DocumentValidationEvidence["stepEvidence"];

  return {
    validationRunId: input.run.id,
    documentId: input.run.documentId,
    inputSha256: input.run.inputSha256,
    pipelineVersion: input.run.pipelineVersion,
    completedSteps: input.steps.map(
      step => step.step
    ) as DocumentValidationEvidence["completedSteps"],
    stepEvidence,
    modelGovernanceRunId: input.run.modelGovernanceRunId,
    humanApprovalId: input.run.humanApprovalId,
    approvedAt: input.run.approvedAt?.toISOString() ?? "",
  };
}

/**
 * Resolves only a governed, authorized decision-support context. This function
 * deliberately does not invoke a general-purpose LLM: no model result may be
 * created until the named Georgetown runtime is explicitly integrated.
 */
export async function requireGovernedOutcomeContext(input: {
  userId: string;
  userRole: string;
  disputeId: string;
}): Promise<GovernedOutcomeContext> {
  const authorizationRole = input.userRole === "admin" ? "admin" : "user";
  await assertDisputeAccess(
    input.userId,
    authorizationRole,
    input.disputeId,
    "read"
  );

  const [db, dispute] = await Promise.all([
    getDb(),
    getDisputeById(input.disputeId),
  ]);
  if (!db)
    throw unavailable("Database is required for governed outcome predictions");
  if (!dispute)
    throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });

  const modelId = requiredEnvironment("GEORGETOWN_MODEL_ID");
  const modelVersion = requiredEnvironment("GEORGETOWN_MODEL_VERSION");
  const [approved] = await db
    .select({
      gateId: modelApprovalGates.id,
      gateStatus: modelApprovalGates.status,
      validationRunId: modelValidationRuns.id,
      validationStatus: modelValidationRuns.status,
      modelId: modelGovernanceModels.id,
      modelVersion: modelGovernanceModels.version,
      artifactSha256: modelGovernanceModels.artifactSha256,
      dataUseApprovalId: modelDataUseApprovals.id,
      dataUseApprovalStatus: modelDataUseApprovals.status,
      dataUseApprovalPurpose: modelDataUseApprovals.approvedPurpose,
      dataUseApprovalStopDecision: modelDataUseApprovals.stopDecision,
      dataUseApprovalExpiresAt: modelDataUseApprovals.expiresAt,
      validatedDatasetSha256: modelValidationDatasets.datasetSha256,
      approvedDatasetSha256: modelDataUseApprovals.datasetSha256,
    })
    .from(modelApprovalGates)
    .innerJoin(
      modelValidationRuns,
      eq(modelValidationRuns.id, modelApprovalGates.validationRunId)
    )
    .innerJoin(
      modelGovernanceModels,
      and(
        eq(modelGovernanceModels.id, modelApprovalGates.modelId),
        eq(modelGovernanceModels.version, modelApprovalGates.modelVersion)
      )
    )
    .innerJoin(
      modelValidationDatasets,
      eq(modelValidationDatasets.id, modelValidationRuns.datasetId)
    )
    .innerJoin(
      modelDataUseApprovals,
      and(
        eq(modelDataUseApprovals.datasetId, modelValidationDatasets.id),
        eq(
          modelDataUseApprovals.datasetSha256,
          modelValidationDatasets.datasetSha256
        )
      )
    )
    .where(
      and(
        eq(modelApprovalGates.modelId, modelId),
        eq(modelApprovalGates.modelVersion, modelVersion),
        eq(modelApprovalGates.status, "approved"),
        eq(modelValidationRuns.status, "passed")
      )
    )
    .limit(1);

  if (
    !approved ||
    approved.gateStatus !== "approved" ||
    approved.validationStatus !== "passed" ||
    approved.dataUseApprovalStatus !== "approved" ||
    approved.dataUseApprovalPurpose !== "model_validation" ||
    approved.dataUseApprovalStopDecision !== "proceed" ||
    !approved.dataUseApprovalExpiresAt ||
    approved.dataUseApprovalExpiresAt <= new Date() ||
    approved.validatedDatasetSha256.toLowerCase() !==
      approved.approvedDatasetSha256.toLowerCase()
  ) {
    throw unavailable(
      "IDR outcome prediction requires an approved, in-scope, unexpired data-use approval bound to the validated dataset"
    );
  }

  const [documentRun] = await db
    .select()
    .from(documentValidationRuns)
    .where(
      and(
        eq(documentValidationRuns.disputeId, input.disputeId),
        eq(
          documentValidationRuns.modelGovernanceRunId,
          approved.validationRunId
        ),
        eq(documentValidationRuns.status, "approved")
      )
    )
    .orderBy(desc(documentValidationRuns.approvedAt))
    .limit(1);
  if (!documentRun) {
    throw unavailable(
      "IDR outcome prediction requires approved twelve-step document-validation evidence for this dispute"
    );
  }

  const steps = await db
    .select()
    .from(documentValidationStepEvidence)
    .where(eq(documentValidationStepEvidence.validationRunId, documentRun.id));
  const documentEvidence = asApprovedDocumentEvidence({
    run: documentRun,
    steps,
  });
  assertCompleteDocumentValidationEvidence(documentEvidence);
  if (steps.length !== DOCUMENT_VALIDATION_STEPS.length) {
    throw unavailable(
      "IDR outcome prediction requires exactly twelve persisted document-validation evidence steps"
    );
  }
  assertIdrProbabilityApproval({
    modelGovernanceRequired: true,
    modelGovernanceApprovalStatus: approved.gateStatus,
    documentValidationEvidence: documentEvidence,
  });

  requireApprovedOutcomeRuntime();
  return {
    dispute,
    modelId: approved.modelId,
    modelVersion: approved.modelVersion,
    modelArtifactSha256: approved.artifactSha256,
    modelValidationRunId: approved.validationRunId,
    modelApprovalGateId: approved.gateId,
    dataUseApprovalId: approved.dataUseApprovalId,
    documentValidationRunId: documentRun.id,
    governanceApprovedAt: documentRun.approvedAt ?? new Date(),
  };
}

/**
 * Persists an already produced result from the approved Georgetown runtime.
 * The result is explicitly marked as decision support and cannot be persisted
 * without the governance context returned by requireGovernedOutcomeContext.
 */
const governedRuntimeResponseSchema = z
  .object({
    winProbability: z.number().int().min(0).max(100),
    confidenceScore: z.number().int().min(0).max(100),
    confidenceInterval: z.tuple([
      z.number().min(0).max(100),
      z.number().min(0).max(100),
    ]),
    keyFactors: z.array(z.string().min(1)).min(1).max(5),
    recommendation: z.string().min(1).max(4_000),
    modelId: z.string().min(1),
    modelVersion: z.string().min(1),
    artifactSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .strict();

/**
 * Invokes the configured HTTPS Georgetown inference endpoint only after the
 * persisted authorization, validation-run, approval-gate, and document-evidence
 * checks have passed. No provider response can override the pinned identifiers.
 */
export async function invokeGovernedGeorgetownRuntime(
  context: GovernedOutcomeContext
): Promise<GovernedOutcomePredictionInput> {
  const runtime = requireApprovedOutcomeRuntime();
  let response: Response;
  try {
    response = await fetch(runtime.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${runtime.token}`,
        "content-type": "application/json",
        "x-healthpoint-model-id": context.modelId,
        "x-healthpoint-model-version": context.modelVersion,
        "x-healthpoint-model-artifact-sha256": context.modelArtifactSha256,
      },
      body: JSON.stringify({
        dispute: {
          id: context.dispute.id,
          referenceNumber: context.dispute.referenceNumber,
          serviceType: context.dispute.serviceType,
          cptCodes: context.dispute.cptCodes,
          patientState: context.dispute.patientState,
          currentStep: context.dispute.currentStep,
          billedAmount: context.dispute.billedAmount,
          qpaAmount: context.dispute.qpaAmount,
          initiatingPartyOffer: context.dispute.initiatingPartyOffer,
          respondingPartyOffer: context.dispute.respondingPartyOffer,
        },
        governance: {
          modelId: context.modelId,
          modelVersion: context.modelVersion,
          modelArtifactSha256: context.modelArtifactSha256,
          modelValidationRunId: context.modelValidationRunId,
          modelApprovalGateId: context.modelApprovalGateId,
          dataUseApprovalId: context.dataUseApprovalId,
          documentValidationRunId: context.documentValidationRunId,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw unavailable("Approved Georgetown runtime is unavailable");
  }
  if (!response.ok) {
    throw unavailable(
      `Approved Georgetown runtime rejected the prediction request with status ${response.status}`
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw unavailable(
      "Approved Georgetown runtime returned a non-JSON response"
    );
  }
  const parsed = governedRuntimeResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw unavailable(
      "Approved Georgetown runtime returned an invalid governed prediction response"
    );
  }
  if (
    parsed.data.modelId !== context.modelId ||
    parsed.data.modelVersion !== context.modelVersion ||
    parsed.data.artifactSha256.toLowerCase() !==
      context.modelArtifactSha256.toLowerCase()
  ) {
    throw unavailable(
      "Approved Georgetown runtime response does not match the pinned governance artifact"
    );
  }
  const [lower, upper] = parsed.data.confidenceInterval;
  if (
    lower > upper ||
    parsed.data.winProbability < lower ||
    parsed.data.winProbability > upper
  ) {
    throw unavailable(
      "Approved Georgetown runtime returned an invalid probability interval"
    );
  }
  return {
    winProbability: parsed.data.winProbability,
    confidenceScore: parsed.data.confidenceScore,
    confidenceInterval: parsed.data.confidenceInterval,
    keyFactors: parsed.data.keyFactors,
    recommendation: parsed.data.recommendation,
  };
}

export async function persistGovernedOutcomePrediction(
  context: GovernedOutcomeContext,
  input: GovernedOutcomePredictionInput
): Promise<typeof outcomePredictions.$inferSelect> {
  if (
    !Number.isInteger(input.winProbability) ||
    input.winProbability < 0 ||
    input.winProbability > 100
  ) {
    throw unavailable(
      "Governed outcome prediction must contain an integer win probability from 0 through 100"
    );
  }
  if (
    !Number.isInteger(input.confidenceScore) ||
    input.confidenceScore < 0 ||
    input.confidenceScore > 100
  ) {
    throw unavailable(
      "Governed outcome prediction must contain an integer confidence score from 0 through 100"
    );
  }
  const [lower, upper] = input.confidenceInterval;
  if (
    !Number.isFinite(lower) ||
    !Number.isFinite(upper) ||
    lower < 0 ||
    upper > 100 ||
    lower > upper
  ) {
    throw unavailable(
      "Governed outcome prediction confidence interval is invalid"
    );
  }

  const db = await getDb();
  if (!db)
    throw unavailable(
      "Database is required to persist governed outcome predictions"
    );
  await db
    .delete(outcomePredictions)
    .where(eq(outcomePredictions.disputeId, context.dispute.id));
  const id = `gpred_${crypto.randomUUID()}`;
  await db.insert(outcomePredictions).values({
    id,
    disputeId: context.dispute.id,
    winProbability: input.winProbability,
    confidenceScore: input.confidenceScore,
    confidenceInterval: input.confidenceInterval,
    keyFactors: JSON.stringify(input.keyFactors),
    recommendation: input.recommendation,
    modelId: context.modelId,
    modelVersion: context.modelVersion,
    modelArtifactSha256: context.modelArtifactSha256,
    modelValidationRunId: context.modelValidationRunId,
    modelApprovalGateId: context.modelApprovalGateId,
    documentValidationRunId: context.documentValidationRunId,
    decisionSupportOnly: true,
    governanceApprovedAt: context.governanceApprovedAt,
  });
  const [prediction] = await db
    .select()
    .from(outcomePredictions)
    .where(eq(outcomePredictions.id, id))
    .limit(1);
  if (!prediction)
    throw unavailable("Governed outcome prediction persistence failed");
  return prediction;
}

export async function getGovernedOutcomePrediction(input: {
  userId: string;
  userRole: string;
  disputeId: string;
}): Promise<typeof outcomePredictions.$inferSelect | undefined> {
  const authorizationRole = input.userRole === "admin" ? "admin" : "user";
  await assertDisputeAccess(
    input.userId,
    authorizationRole,
    input.disputeId,
    "read"
  );
  const db = await getDb();
  if (!db)
    throw unavailable("Database is required for governed outcome predictions");
  const [prediction] = await db
    .select()
    .from(outcomePredictions)
    .where(
      and(
        eq(outcomePredictions.disputeId, input.disputeId),
        eq(outcomePredictions.decisionSupportOnly, true)
      )
    )
    .orderBy(desc(outcomePredictions.createdAt))
    .limit(1);
  if (!prediction) return undefined;
  if (
    !prediction.modelId ||
    !prediction.modelArtifactSha256 ||
    !prediction.modelValidationRunId ||
    !prediction.modelApprovalGateId ||
    !prediction.documentValidationRunId ||
    !prediction.governanceApprovedAt
  ) {
    throw unavailable(
      "Stored outcome prediction lacks mandatory governance provenance"
    );
  }
  return prediction;
}
