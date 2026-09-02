import { createHash } from "node:crypto";
import { z } from "zod";

export const governedPredictionSchema = z.object({
  caseId: z.string().min(1).max(128),
  probability: z.number().finite().min(0).max(1),
  ensemble: z.array(z.number().finite().min(0).max(1)).min(3).max(101),
  subgroup: z.string().min(1).max(128).optional(),
});

export const validationDatasetSchema = z.object({
  datasetId: z.string().min(1).max(128),
  sourceUrl: z.string().url(),
  sourceDescription: z.string().min(20).max(2000),
  datasetSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  rowCount: z.number().int().min(100),
  positiveCount: z.number().int().min(1),
  negativeCount: z.number().int().min(1),
  asOf: z.string().datetime({ offset: true }),
  licenseConfirmed: z.literal(true),
  externalValidation: z.literal(true),
});

export const modelArtifactSchema = z.object({
  modelId: z.string().min(1).max(128),
  version: z.string().min(1).max(64),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  featureSchemaVersion: z.string().min(1).max(64),
  trainingDatasetId: z.string().min(1).max(128),
  owner: z.string().min(1).max(256),
});

export type GovernedPrediction = z.infer<typeof governedPredictionSchema>;
export type ValidationDataset = z.infer<typeof validationDatasetSchema>;
export type ModelArtifact = z.infer<typeof modelArtifactSchema>;

export type CalibrationThresholds = {
  maxBrierScore: number;
  maxExpectedCalibrationError: number;
  minAuc: number;
  maxSubgroupCalibrationGap: number;
  minCoverage: number;
  maxIntervalWidth: number;
};

export type GovernanceInput = {
  model: ModelArtifact;
  dataset: ValidationDataset;
  predictions: Array<GovernedPrediction & { actual: 0 | 1 }>;
  thresholds: CalibrationThresholds;
};

export type GovernanceResult = {
  runId: string;
  model: ModelArtifact;
  dataset: ValidationDataset;
  metrics: {
    brierScore: number;
    logLoss: number;
    expectedCalibrationError: number;
    auc: number;
    accuracy: number;
    accuracyInterval: [number, number];
    uncertaintyCoverage: number;
    meanIntervalWidth: number;
    subgroupCalibrationGap: number;
  };
  checks: Record<string, boolean>;
  approved: boolean;
  rejectionReasons: string[];
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function round(value: number): number {
  return Number(value.toFixed(8));
}

function wilsonInterval(successes: number, total: number): [number, number] {
  if (total === 0) return [0, 0];
  const z = 1.959963984540054;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return [
    Math.max(0, (centre - margin) / denominator),
    Math.min(1, (centre + margin) / denominator),
  ];
}

function auc(
  predictions: Array<{ probability: number; actual: 0 | 1 }>
): number {
  const positives = predictions.filter(p => p.actual === 1).length;
  const negatives = predictions.length - positives;
  if (positives === 0 || negatives === 0) return 0;
  const sorted = [...predictions].sort((a, b) => a.probability - b.probability);
  let rankSum = 0;
  sorted.forEach((p, index) => {
    if (p.actual === 1) rankSum += index + 1;
  });
  return (
    (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives)
  );
}

function ece(
  predictions: Array<{ probability: number; actual: 0 | 1 }>,
  bins = 10
): number {
  let weightedError = 0;
  for (let i = 0; i < bins; i += 1) {
    const lower = i / bins;
    const upper = (i + 1) / bins;
    const bucket = predictions.filter(
      p =>
        p.probability >= lower &&
        (i === bins - 1 ? p.probability <= upper : p.probability < upper)
    );
    if (!bucket.length) continue;
    const meanProbability =
      bucket.reduce((sum, p) => sum + p.probability, 0) / bucket.length;
    const observedRate =
      bucket.reduce((sum, p) => sum + p.actual, 0) / bucket.length;
    weightedError +=
      (bucket.length / predictions.length) *
      Math.abs(meanProbability - observedRate);
  }
  return weightedError;
}

function intervalForPrediction(
  prediction: GovernedPrediction
): [number, number] {
  const mean =
    prediction.ensemble.reduce((sum, value) => sum + value, 0) /
    prediction.ensemble.length;
  const variance =
    prediction.ensemble.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (prediction.ensemble.length - 1);
  const standardError = Math.sqrt(variance / prediction.ensemble.length);
  return [
    Math.max(0, mean - 1.96 * standardError),
    Math.min(1, mean + 1.96 * standardError),
  ];
}

export function validateGeorgetownProbability(
  input: GovernanceInput
): GovernanceResult {
  const model = modelArtifactSchema.parse(input.model);
  const dataset = validationDatasetSchema.parse(input.dataset);
  if (input.predictions.length !== dataset.rowCount)
    throw new Error(
      "Prediction count must exactly match the externally validated dataset row count"
    );
  const predictions = input.predictions.map(prediction =>
    governedPredictionSchema
      .extend({ actual: z.union([z.literal(0), z.literal(1)]) })
      .parse(prediction)
  );
  if (dataset.positiveCount + dataset.negativeCount !== dataset.rowCount)
    throw new Error("Dataset class counts must equal row count");
  const observedPositives = predictions.reduce((sum, p) => sum + p.actual, 0);
  if (observedPositives !== dataset.positiveCount)
    throw new Error("Observed labels do not match dataset metadata");

  const brierScore =
    predictions.reduce((sum, p) => sum + (p.probability - p.actual) ** 2, 0) /
    predictions.length;
  const logLoss =
    predictions.reduce((sum, p) => {
      const probability = Math.min(1 - 1e-15, Math.max(1e-15, p.probability));
      return (
        sum -
        (p.actual * Math.log(probability) +
          (1 - p.actual) * Math.log(1 - probability))
      );
    }, 0) / predictions.length;
  const expectedCalibrationError = ece(predictions);
  const aucScore = auc(predictions);
  const correct = predictions.filter(
    p => (p.probability >= 0.5 ? 1 : 0) === p.actual
  ).length;
  const accuracy = correct / predictions.length;
  const accuracyInterval = wilsonInterval(correct, predictions.length);
  const intervals = predictions.map(intervalForPrediction);
  const uncertaintyCoverage =
    predictions.reduce(
      (sum, p, index) =>
        sum +
        (p.probability >= intervals[index][0] &&
        p.probability <= intervals[index][1]
          ? 1
          : 0),
      0
    ) / predictions.length;
  const meanIntervalWidth =
    intervals.reduce((sum, interval) => sum + interval[1] - interval[0], 0) /
    intervals.length;

  const subgroupErrors = new Map<string, number>();
  new Set(
    predictions.map(p => p.subgroup).filter((v): v is string => Boolean(v))
  ).forEach(subgroup => {
    const group = predictions.filter(p => p.subgroup === subgroup);
    subgroupErrors.set(subgroup, ece(group));
  });
  const subgroupValues: number[] = [];
  subgroupErrors.forEach(value => subgroupValues.push(value));
  const subgroupCalibrationGap =
    subgroupValues.length > 1
      ? Math.max(...subgroupValues) - Math.min(...subgroupValues)
      : 0;
  const thresholds = input.thresholds;
  const checks = {
    datasetIsExternalAndLicensed:
      dataset.externalValidation && dataset.licenseConfirmed,
    datasetIntegrity:
      dataset.positiveCount + dataset.negativeCount === dataset.rowCount,
    modelArtifactPinned: /^[a-f0-9]{64}$/i.test(model.artifactSha256),
    featureSchemaPinned: model.featureSchemaVersion.length > 0,
    brierWithinThreshold: brierScore <= thresholds.maxBrierScore,
    calibrationWithinThreshold:
      expectedCalibrationError <= thresholds.maxExpectedCalibrationError,
    aucAboveThreshold: aucScore >= thresholds.minAuc,
    subgroupGapWithinThreshold:
      subgroupCalibrationGap <= thresholds.maxSubgroupCalibrationGap,
    uncertaintyCoverageWithinThreshold:
      uncertaintyCoverage >= thresholds.minCoverage,
    uncertaintyWidthWithinThreshold:
      meanIntervalWidth <= thresholds.maxIntervalWidth,
  };
  const rejectionReasons = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const canonical = JSON.stringify({
    model,
    dataset,
    metrics: {
      brierScore,
      logLoss,
      expectedCalibrationError,
      aucScore,
      accuracy,
      accuracyInterval,
      uncertaintyCoverage,
      meanIntervalWidth,
      subgroupCalibrationGap,
    },
    checks,
  });
  return {
    runId: sha256(canonical),
    model,
    dataset,
    metrics: {
      brierScore: round(brierScore),
      logLoss: round(logLoss),
      expectedCalibrationError: round(expectedCalibrationError),
      auc: round(aucScore),
      accuracy: round(accuracy),
      accuracyInterval: accuracyInterval.map(round) as [number, number],
      uncertaintyCoverage: round(uncertaintyCoverage),
      meanIntervalWidth: round(meanIntervalWidth),
      subgroupCalibrationGap: round(subgroupCalibrationGap),
    },
    checks,
    approved: rejectionReasons.length === 0,
    rejectionReasons,
  };
}

export function assertProbabilityIsDecisionSupportOnly(
  result: GovernanceResult
): void {
  if (!result.approved)
    throw new Error(
      `Model governance gate failed: ${result.rejectionReasons.join(", ")}`
    );
}

export const DOCUMENT_VALIDATION_STEPS = [
  "intake_integrity",
  "malware_quarantine",
  "file_quality",
  "ocr_extraction",
  "structured_parsing",
  "document_classification",
  "phi_privacy_review",
  "evidence_completeness",
  "feature_derivation",
  "model_version_eligibility",
  "probability_uncertainty_calibration",
  "human_approval_audit",
] as const;
export type DocumentValidationStep = (typeof DOCUMENT_VALIDATION_STEPS)[number];

export type DocumentValidationEvidence = {
  validationRunId: string;
  documentId: string;
  inputSha256: string;
  pipelineVersion: string;
  completedSteps: DocumentValidationStep[];
  stepEvidence: Record<
    DocumentValidationStep,
    { evidenceSha256: string; completedAt: string; actor: string }
  >;
  modelGovernanceRunId: string;
  humanApprovalId: string;
  approvedAt: string;
};

export function assertCompleteDocumentValidationEvidence(
  evidence: DocumentValidationEvidence
): void {
  if (
    !evidence.validationRunId ||
    !evidence.documentId ||
    !/^[a-f0-9]{64}$/i.test(evidence.inputSha256)
  ) {
    throw new Error(
      "Document validation evidence requires a validation ID, document ID, and valid input SHA-256"
    );
  }
  if (
    !evidence.pipelineVersion ||
    !evidence.modelGovernanceRunId ||
    !evidence.humanApprovalId
  ) {
    throw new Error(
      "Document validation evidence requires pinned pipeline/model governance and human approval IDs"
    );
  }
  const completed = new Set(evidence.completedSteps);
  const hasExactStepSet =
    evidence.completedSteps.length === DOCUMENT_VALIDATION_STEPS.length &&
    completed.size === DOCUMENT_VALIDATION_STEPS.length &&
    DOCUMENT_VALIDATION_STEPS.every(step => completed.has(step));
  const missing = DOCUMENT_VALIDATION_STEPS.filter(
    step => !completed.has(step) || !evidence.stepEvidence[step]
  );
  if (!hasExactStepSet) {
    throw new Error(
      "Document validation evidence is incomplete or invalid; it must contain each of the twelve required steps exactly once"
    );
  }
  if (missing.length)
    throw new Error(
      `Document validation gate incomplete; missing step(s): ${missing.join(", ")}`
    );
  for (const step of DOCUMENT_VALIDATION_STEPS) {
    const item = evidence.stepEvidence[step];
    if (
      !/^[a-f0-9]{64}$/i.test(item.evidenceSha256) ||
      !item.actor ||
      !item.completedAt
    ) {
      throw new Error(`Document validation evidence for ${step} is incomplete`);
    }
  }
}

export function assertIdrProbabilityApproval(
  dispute: Record<string, unknown>
): void {
  if (dispute.modelGovernanceRequired !== true) return;
  if (dispute.modelGovernanceApprovalStatus !== "approved") {
    throw new Error(
      "IDR transition requires an approved model-governance and document-validation gate"
    );
  }
  if (!dispute.documentValidationEvidence) {
    throw new Error(
      "IDR transition requires complete twelve-step document-validation evidence"
    );
  }
  assertCompleteDocumentValidationEvidence(
    dispute.documentValidationEvidence as DocumentValidationEvidence
  );
}

import { readFile } from "node:fs/promises";

export async function loadPinnedModelArtifact(
  artifactPath: string,
  expectedSha256: string
): Promise<{ artifactSha256: string; bytes: number }> {
  if (!artifactPath || artifactPath.includes(".."))
    throw new Error("A safe model artifact path is required");
  const artifact = await readFile(artifactPath);
  const artifactSha256 = createHash("sha256").update(artifact).digest("hex");
  if (
    !/^[a-f0-9]{64}$/i.test(expectedSha256) ||
    artifactSha256.toLowerCase() !== expectedSha256.toLowerCase()
  ) {
    throw new Error(
      "Model artifact hash does not match the pinned governance record"
    );
  }
  return { artifactSha256, bytes: artifact.byteLength };
}

export async function loadExternalValidationCsv(csvPath: string): Promise<{
  datasetHash: string;
  rowCount: number;
  positiveCount: number;
  negativeCount: number;
  labels: Array<{ caseId: string; actual: 0 | 1; subgroup?: string }>;
}> {
  if (!csvPath || csvPath.includes(".."))
    throw new Error("A safe validation dataset path is required");
  const raw = await readFile(csvPath, "utf8");
  const lines = raw.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 101)
    throw new Error(
      "External validation dataset must contain at least 100 data rows"
    );
  const header = lines[0].split(",").map(value => value.trim());
  const caseIndex = header.indexOf("case_id");
  const actualIndex = header.indexOf("actual");
  const subgroupIndex = header.indexOf("subgroup");
  if (caseIndex < 0 || actualIndex < 0)
    throw new Error("Validation CSV requires case_id and actual columns");
  const labels = lines.slice(1).map((line, index) => {
    const values = line.split(",").map(value => value.trim());
    const actual = values[actualIndex];
    if (actual !== "0" && actual !== "1")
      throw new Error(
        `Validation CSV row ${index + 2} has an invalid actual label`
      );
    return {
      caseId: values[caseIndex],
      actual: Number(actual) as 0 | 1,
      subgroup:
        subgroupIndex >= 0 ? values[subgroupIndex] || undefined : undefined,
    };
  });
  const positiveCount = labels.filter(label => label.actual === 1).length;
  return {
    datasetHash: sha256(raw),
    rowCount: labels.length,
    positiveCount,
    negativeCount: labels.length - positiveCount,
    labels,
  };
}
