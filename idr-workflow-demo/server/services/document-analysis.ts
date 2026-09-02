import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { documentAnalysisJobs, documentAnalysisResults, documentReviewTasks } from "../../drizzle/schema";
import { recordTelemetryOperation, startTelemetrySpan, withTenantTelemetryScope } from "../_core/telemetry";
import { incrementDocumentAnalysisMetric } from "../metrics";

type ClaimedJob = {
  id: string;
  documentId: string;
  disputeId: string | null;
  tenantId: string;
  requestedBy: string;
  inputSha256: string;
  objectUri: string;
  mimeType: string;
  analysisProfile: string;
  pipelineVersion: string;
  attempts: number;
};

type AnalysisResponse = {
  inputSha256: string;
  outputSha256: string;
  engine: string;
  engineVersion: string;
  status: "completed" | "requires_review" | "failed";
  extractedFields?: unknown;
  findings?: unknown;
  confidence?: number;
  processingTimeMs?: number;
  provenance: Record<string, unknown>;
};

const POLL_INTERVAL_MS = 2_000;
const LEASE_SECONDS = 120;
const MAX_ATTEMPTS = 5;

function configuration(): { url: URL; token: string } | null {
  const rawUrl = process.env.DOCUMENT_ANALYSIS_URL?.trim();
  const token = process.env.DOCUMENT_ANALYSIS_SERVICE_TOKEN?.trim();
  if (!rawUrl || !token) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("DOCUMENT_ANALYSIS_URL must be a valid URL");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("DOCUMENT_ANALYSIS_URL must use HTTPS in production");
  }
  if (process.env.NODE_ENV === "production" && token.length < 32) {
    throw new Error("DOCUMENT_ANALYSIS_SERVICE_TOKEN must contain at least 32 characters in production");
  }
  return { url, token };
}

function retryDelaySeconds(attempt: number): number {
  return Math.min(60 * 30, 30 * 2 ** Math.max(0, attempt - 1));
}

async function claimNextJob(): Promise<ClaimedJob | null> {
  const db = await getDb();
  if (!db) throw new Error("PostgreSQL is unavailable for document analysis");
  const workerId = `document-analysis-${process.pid}`;
  const result = await db.execute(sql`
    WITH candidate AS (
      SELECT "id"
      FROM "document_analysis_jobs"
      WHERE "status" IN ('pending', 'retryable_failure')
        AND "availableAt" <= now()
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now())
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "document_analysis_jobs" AS job
    SET "status" = 'processing',
        "leaseOwner" = ${workerId},
        "leaseExpiresAt" = now() + (${LEASE_SECONDS} * interval '1 second'),
        "updatedAt" = now()
    FROM candidate
    WHERE job."id" = candidate."id"
    RETURNING job.*
  `);
  const rows = result as unknown as ClaimedJob[];
  return rows[0] ?? null;
}

function asAnalysisResponse(value: unknown, job: ClaimedJob): AnalysisResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Document-analysis service returned an invalid response");
  }
  const response = value as Partial<AnalysisResponse>;
  if (response.inputSha256 !== job.inputSha256) {
    throw new Error("Document-analysis response input hash does not match the leased job");
  }
  if (!/^[a-f0-9]{64}$/.test(response.outputSha256 ?? "")) {
    throw new Error("Document-analysis response must contain a SHA-256 output hash");
  }
  if (!response.engine || !response.engineVersion || !response.provenance || typeof response.provenance !== "object") {
    throw new Error("Document-analysis response lacks required provenance");
  }
  if (!['completed', 'requires_review', 'failed'].includes(response.status ?? '')) {
    throw new Error("Document-analysis response has an unsupported status");
  }
  return response as AnalysisResponse;
}

async function invokeAnalysis(job: ClaimedJob, config: { url: URL; token: string }): Promise<AnalysisResponse> {
  const url = new URL(config.url.toString());
  url.pathname = `${url.pathname.replace(/\/$/, "")}/analyze`;
  const startedAt = performance.now();
  const span = startTelemetrySpan("healthpoint.document_analysis.invoke", {
    "healthpoint.component": "document-analysis",
    "healthpoint.analysis.profile": job.analysisProfile,
    "healthpoint.mime.type": job.mimeType,
  });
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.token}`,
        "x-healthpoint-request-id": crypto.randomUUID(),
      },
      body: JSON.stringify({
        jobId: job.id,
        documentId: job.documentId,
        inputSha256: job.inputSha256,
        objectUri: job.objectUri,
        mimeType: job.mimeType,
        analysisProfile: job.analysisProfile,
        pipelineVersion: job.pipelineVersion,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error(`Document-analysis service returned HTTP ${response.status}`);
    const result = asAnalysisResponse(await response.json(), job);
    span.setStatus({ code: 1 });
    recordTelemetryOperation({ component: "document-analysis", operation: "analyze", status: "ok", durationMs: performance.now() - startedAt });
    incrementDocumentAnalysisMetric("completed");
    return result;
  } catch (error) {
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    span.setStatus({ code: 2, message: "document-analysis invocation failed" });
    recordTelemetryOperation({ component: "document-analysis", operation: "analyze", status: "error", durationMs: performance.now() - startedAt });
    incrementDocumentAnalysisMetric("failed");
    throw error;
  } finally {
    span.end();
  }
}

async function persistSuccess(job: ClaimedJob, result: AnalysisResponse): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("PostgreSQL is unavailable for document analysis persistence");
  await db.transaction(async tx => {
    await tx.insert(documentAnalysisResults).values({
      id: randomUUID(),
      jobId: job.id,
      documentId: job.documentId,
      inputSha256: job.inputSha256,
      outputSha256: result.outputSha256,
      engine: result.engine,
      engineVersion: result.engineVersion,
      status: result.status,
      extractedFields: result.extractedFields,
      findings: result.findings,
      confidence: result.confidence,
      processingTimeMs: result.processingTimeMs,
      provenance: result.provenance,
    }).onConflictDoNothing();
    if (result.status === "requires_review") {
      await tx.insert(documentReviewTasks).values({
        id: randomUUID(),
        jobId: job.id,
        tenantId: job.tenantId,
        reason: "Document-analysis service requires human review",
      }).onConflictDoNothing();
    }
    await tx.update(documentAnalysisJobs).set({
      status: result.status === "requires_review" ? "requires_review" : "completed",
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: new Date(),
      updatedAt: new Date(),
      lastError: null,
    }).where(sql`"id" = ${job.id} AND "status" = 'processing'`);
  });
}

async function persistFailure(job: ClaimedJob, error: unknown): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const message = error instanceof Error ? error.message.slice(0, 1024) : "Document-analysis failure";
  const nextStatus = job.attempts + 1 >= MAX_ATTEMPTS ? "dead_letter" : "retryable_failure";
  await db.update(documentAnalysisJobs).set({
    status: nextStatus,
    attempts: job.attempts + 1,
    availableAt: new Date(Date.now() + retryDelaySeconds(job.attempts + 1) * 1_000),
    leaseOwner: null,
    leaseExpiresAt: null,
    lastError: message,
    updatedAt: new Date(),
  }).where(sql`"id" = ${job.id} AND "status" = 'processing'`);
  incrementDocumentAnalysisMetric(nextStatus === "dead_letter" ? "dead_letter" : "retryable_failure");
}

export type DocumentAnalysisWorker = {
  start(): void;
  stop(): void;
  runOnce(): Promise<void>;
};

export function createDocumentAnalysisWorker(): DocumentAnalysisWorker | null {
  const config = configuration();
  if (!config) return null;
  let interval: NodeJS.Timeout | null = null;
  let running = false;

  const runOnce = async () => {
    if (running) return;
    running = true;
    try {
      const job = await claimNextJob();
      if (!job) return;
      await withTenantTelemetryScope(job.tenantId, async () => {
        try {
          const result = await invokeAnalysis(job, config);
          await persistSuccess(job, result);
        } catch (error) {
          await persistFailure(job, error);
        }
      });
    } finally {
      running = false;
    }
  };

  return {
    start() {
      if (interval) return;
      void runOnce();
      interval = setInterval(() => void runOnce(), POLL_INTERVAL_MS);
      interval.unref();
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
    },
    runOnce,
  };
}
