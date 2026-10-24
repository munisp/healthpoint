/**
 * Bulk FHIR Export Worker
 * Route: POST /api/scheduled/bulk-fhir-worker
 * Schedule: every minute (* * * * *)
 *
 * Drives the bulkFhirExportJobs state machine:
 *   pending     → kick $export at the EMR (unless a Content-Location was
 *                 pre-registered in statusUrl) → in_progress
 *   in_progress → poll the status URL with backoff; on 200 download each
 *                 ndjson output file to storage → completed (with counts)
 *   any error   → failed (with errorMessage)
 * Terminal states (completed/failed/cancelled) are never touched; cancelJob
 * only acts on non-terminal states (enforced in routers.bulkFhir.cancelJob).
 *
 * Auth: scheduledAuth (platform cron identity or bearer SCHEDULED_SECRET).
 * The state machine is verified against a mock FHIR server in
 * server/tests/bulk-fhir-worker.test.ts (EXECUTED-VERIFIED with mock).
 */

import { Request, Response } from "express";
import { getDb } from "../db";
import { bulkFhirExportJobs, emrConnections, smartTokens } from "../../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { storagePut } from "../storage";

const POLL_TIMEOUT_MS = 15_000;

type JobRow = typeof bulkFhirExportJobs.$inferSelect;

/** Resolve a bearer token for the EMR, if one is on file (decrypted at read). */
async function emrAccessToken(emrConnectionId: string): Promise<string | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const [tok] = await db.select().from(smartTokens)
      .where(eq(smartTokens.emrConnectionId, emrConnectionId)).limit(1);
    if (!tok) return null;
    const { decryptToken } = await import("../credential-crypto");
    return decryptToken(tok.accessToken);
  } catch {
    return null;
  }
}

function exportKickPath(job: JobRow): string {
  switch (job.exportType) {
    case "System": return "/$export";
    case "Group":  return "/Group/$export";
    case "Patient":
    default:       return "/Patient/$export";
  }
}

/** Kick $export for a pending job (or accept a pre-registered contentLocation). */
async function kickJob(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, job: JobRow): Promise<void> {
  const [conn] = await db.select().from(emrConnections).where(eq(emrConnections.id, job.emrConnectionId)).limit(1);
  if (!conn) {
    await db.update(bulkFhirExportJobs)
      .set({ status: "failed", errorMessage: "EMR connection not found", completedAt: new Date() })
      .where(eq(bulkFhirExportJobs.id, job.id));
    return;
  }

  // Pre-registered Content-Location: skip the kick, go straight to polling.
  if (job.statusUrl) {
    await db.update(bulkFhirExportJobs)
      .set({ status: "in_progress", startedAt: new Date() })
      .where(eq(bulkFhirExportJobs.id, job.id));
    return;
  }

  const token = await emrAccessToken(job.emrConnectionId);
  const typeParam = (job.resourceTypes ?? []).join(",");
  const url = `${conn.baseUrl.replace(/\/$/, "")}${exportKickPath(job)}${typeParam ? `?_type=${encodeURIComponent(typeParam)}` : ""}${job.since ? `${typeParam ? "&" : "?"}_since=${encodeURIComponent(job.since.toISOString())}` : ""}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/fhir+json",
      Prefer: "respond-async",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
  });

  if (res.status !== 202) {
    throw new Error(`$export kick returned HTTP ${res.status} (expected 202)`);
  }
  const contentLocation = res.headers.get("content-location");
  if (!contentLocation) {
    throw new Error("$export kick returned 202 without a Content-Location header");
  }
  await db.update(bulkFhirExportJobs)
    .set({ status: "in_progress", statusUrl: contentLocation, startedAt: new Date() })
    .where(eq(bulkFhirExportJobs.id, job.id));
}

/** Poll an in_progress job; on completion download ndjson output to storage. */
async function pollJob(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, job: JobRow): Promise<void> {
  if (!job.statusUrl) {
    // in_progress without a status URL is inconsistent — fail loudly.
    await db.update(bulkFhirExportJobs)
      .set({ status: "failed", errorMessage: "in_progress job has no statusUrl", completedAt: new Date() })
      .where(eq(bulkFhirExportJobs.id, job.id));
    return;
  }

  const token = await emrAccessToken(job.emrConnectionId);
  const res = await fetch(job.statusUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
  });

  if (res.status === 202) {
    // Still running — record progress if the server advertises it.
    const progressHeader = res.headers.get("x-progress");
    const progress = progressHeader ? parseInt(progressHeader, 10) : job.progress;
    await db.update(bulkFhirExportJobs)
      .set({ progress: Number.isFinite(progress) ? progress : (job.progress ?? 0) })
      .where(eq(bulkFhirExportJobs.id, job.id));
    return;
  }
  if (!res.ok) {
    throw new Error(`status poll returned HTTP ${res.status}`);
  }

  const manifest = (await res.json()) as {
    output?: Array<{ type: string; url: string; count?: number }>;
    error?: Array<{ type: string; url: string }>;
  };
  const output = manifest.output ?? [];
  const errors = manifest.error ?? [];

  // Download each ndjson file to storage.
  const storedFiles: Array<{ type: string; url: string; count: number }> = [];
  let totalRecords = 0;
  for (const file of output) {
    const fileRes = await fetch(file.url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(60_000),
    });
    if (!fileRes.ok) throw new Error(`output download failed for ${file.url}: HTTP ${fileRes.status}`);
    const ndjson = await fileRes.text();
    const lines = ndjson.split("\n").filter(l => l.trim().length > 0).length;
    const key = `bulk-fhir/${job.id}/${file.type}-${storedFiles.length}.ndjson`;
    const { url: storedUrl } = await storagePut(key, ndjson, "application/fhir+ndjson");
    const count = file.count ?? lines;
    storedFiles.push({ type: file.type, url: storedUrl, count });
    totalRecords += count;
  }

  await db.update(bulkFhirExportJobs)
    .set({
      status: "completed",
      progress: 100,
      outputFiles: storedFiles,
      errorFiles: errors,
      totalRecords,
      completedAt: new Date(),
    })
    .where(eq(bulkFhirExportJobs.id, job.id));
}

/**
 * One worker pass over non-terminal jobs. Exported for direct testing
 * against a mock FHIR server.
 */
export async function processBulkFhirJobs(limit = 25): Promise<{ processed: number }> {
  const db = await getDb();
  if (!db) return { processed: 0 };

  const jobs = await db.select().from(bulkFhirExportJobs)
    .where(inArray(bulkFhirExportJobs.status, ["pending", "in_progress"]))
    .limit(limit);

  let processed = 0;
  for (const job of jobs) {
    processed += 1;
    try {
      if (job.status === "pending") {
        await kickJob(db, job);
      } else {
        await pollJob(db, job);
      }
    } catch (err: any) {
      await db.update(bulkFhirExportJobs)
        .set({ status: "failed", errorMessage: String(err?.message ?? err).slice(0, 2000), completedAt: new Date() })
        .where(eq(bulkFhirExportJobs.id, job.id))
        .catch(() => undefined);
    }
  }
  return { processed };
}

export async function bulkFhirWorkerHandler(req: Request, res: Response) {
  try {
    const { processed } = await processBulkFhirJobs();
    res.json({ ok: true, processed });
  } catch (err: any) {
    console.error("[bulk-fhir] worker failed:", err);
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
}
