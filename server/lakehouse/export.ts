/**
 * server/lakehouse/export.ts
 *
 * Incremental PG→S3 lakehouse export. Extends the one-shot
 * `generateLakehouseExport` (server/search.ts, owned by another workstream —
 * NOT modified) with per-dataset watermarks persisted in the internal
 * bookkeeping tables (bookkeeping.ts — runtime-created, no migration).
 *
 * Incremental semantics:
 *   - Each dataset has a cursor column (disputes.updatedAt,
 *     dispute_documents.createdAt, audit_log.createdAt).
 *   - On each run we select rows where cursor > watermark, export them as
 *     NDJSON to S3, then advance the watermark to the max cursor seen.
 *   - First run (no watermark) is a bounded full export (ROW_LIMIT cap).
 *
 * Labels: the Postgres read path is EXECUTED-VERIFIED against embedded PG
 * (vitest). The S3 write is EXECUTED-VERIFIED only when storage env is
 * configured; otherwise it fails closed with an honest error (never fakes
 * an upload).
 */
import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { storagePut } from "../storage";
import {
  ensureLakehouseBookkeeping,
  getWatermark,
  recordExportRun,
  setWatermark,
} from "./bookkeeping";

export const LAKEHOUSE_DATASETS = ["disputes", "documents", "audit"] as const;
export type LakehouseDataset = (typeof LAKEHOUSE_DATASETS)[number];

/** Per-table safety cap, mirroring generateLakehouseExport's limits. */
const ROW_LIMIT: Record<LakehouseDataset, number> = {
  disputes: 50_000,
  documents: 50_000,
  audit: 100_000,
};

export interface IncrementalExportResult {
  runId: string;
  dataset: LakehouseDataset;
  /** Number of rows exported in this run (0 for a no-op incremental run). */
  rowCount: number;
  /** S3 key written, or null when there was nothing new to export. */
  s3Key: string | null;
  /** Watermark BEFORE this run (null = first/full export). */
  previousWatermark: string | null;
  /** Watermark AFTER this run (null when no rows and no prior watermark). */
  newWatermark: string | null;
}

/** Fetch rows newer than the watermark for one dataset. */
async function fetchIncrementalRows(
  dataset: LakehouseDataset,
  since: string | null,
): Promise<Array<Record<string, unknown>>> {
  const db = await getDb();
  if (!db) return [];
  const { sql } = await import("drizzle-orm");
  const limit = ROW_LIMIT[dataset];
  const res =
    dataset === "disputes"
      ? since
        ? await db.execute(sql`SELECT * FROM disputes WHERE "updatedAt" > ${since} ORDER BY "updatedAt" ASC LIMIT ${limit}`)
        : await db.execute(sql`SELECT * FROM disputes ORDER BY "updatedAt" ASC NULLS FIRST LIMIT ${limit}`)
      : dataset === "documents"
        ? since
          ? await db.execute(sql`SELECT * FROM dispute_documents WHERE "createdAt" > ${since} ORDER BY "createdAt" ASC LIMIT ${limit}`)
          : await db.execute(sql`SELECT * FROM dispute_documents ORDER BY "createdAt" ASC NULLS FIRST LIMIT ${limit}`)
        : since
          ? await db.execute(sql`SELECT * FROM audit_log WHERE "createdAt" > ${since} ORDER BY "createdAt" ASC LIMIT ${limit}`)
          : await db.execute(sql`SELECT * FROM audit_log ORDER BY "createdAt" ASC NULLS FIRST LIMIT ${limit}`);
  return Array.isArray(res) ? (res as any) : (((res as any)?.rows ?? []) as any);
}


/**
 * Run one incremental export for a dataset:
 * read watermark → query new rows → NDJSON to S3 → advance watermark →
 * record run rows. Throws (after recording a 'failed' run row) on storage
 * failure so Temporal's retry policy can classify it.
 */
export interface ExportDeps {
  /** Storage write seam — defaults to the real storagePut (fails closed when
   *  BUILT_IN_STORAGE_API_URL/KEY are unset). Tests inject an in-memory sink. */
  putObject?: (key: string, data: Buffer, contentType: string) => Promise<unknown>;
  /** Watermark bookkeeping key — defaults to the dataset name. Tests use a
   *  unique key per run for isolation against a shared dev database. */
  watermarkKey?: string;
}

export async function runIncrementalLakehouseExport(
  dataset: LakehouseDataset,
  runId: string = randomUUID(),
  deps: ExportDeps = {},
): Promise<IncrementalExportResult> {
  const putObject = deps.putObject ?? ((key: string, data: Buffer, contentType: string) => storagePut(key, data, contentType));
  await ensureLakehouseBookkeeping();
  const wmKey = deps.watermarkKey ?? dataset;
  await recordExportRun({ runId, dataset: wmKey, status: "started", finished: false });

  const previous = await getWatermark(wmKey); // full-precision text or null
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await fetchIncrementalRows(dataset, previous);
  } catch (err) {
    await recordExportRun({
      runId, dataset: wmKey, status: "failed",
      detail: `query failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    throw err;
  }

  // Watermark advance must preserve Postgres microsecond precision — a JS
  // Date truncates to ms, which would re-export boundary rows on the next
  // run. Compute the max cursor IN SQL and keep it as full-precision text.
  let maxCursorIso: string | null = null;
  if (rows.length > 0 && rows.length < ROW_LIMIT[dataset]) {
    // Full page exported → SQL MAX over the pending set is exactly the last
    // exported cursor. (If the page were FULL, unexported rows could share
    // the tail; in that case we keep the JS-side max of exported rows, which
    // may re-export a few boundary rows but NEVER skips rows.)
    const db = await getDb();
    if (db) {
      const { sql } = await import("drizzle-orm");
      const col = dataset === "disputes" ? "updatedAt" : "createdAt";
      const tbl = dataset === "disputes" ? "disputes"
        : dataset === "documents" ? "dispute_documents" : "audit_log";
      const res = await db.execute(sql.raw(
        `SELECT MAX("${col}")::text AS m FROM ${tbl} ` +
        (previous ? `WHERE "${col}" > '${previous}'` : "")
      ));
      const r: any[] = Array.isArray(res) ? (res as any) : ((res as any)?.rows ?? []);
      maxCursorIso = r[0]?.m ?? null;
    }
  } else if (rows.length > 0) {
    let max: Date | null = null;
    for (const row of rows) {
      const v = dataset === "disputes" ? row.updatedAt : row.createdAt;
      const d = v instanceof Date ? v : v == null ? null : new Date(String(v));
      if (d && !Number.isNaN(d.getTime()) && (!max || d > max)) max = d;
    }
    maxCursorIso = max ? max.toISOString() : null;
  }

  let s3Key: string | null = null;
  if (rows.length > 0) {
    const exportedAt = new Date().toISOString();
    const lines = rows.map(row =>
      JSON.stringify({ _table: dataset, _exported_at: exportedAt, ...row }));
    s3Key = `lakehouse-exports/incremental/${dataset}/${runId}.ndjson`;
    try {
      await putObject(s3Key, Buffer.from(lines.join("\n"), "utf-8"), "application/x-ndjson");
    } catch (err) {
      await recordExportRun({
        runId, dataset: wmKey, status: "failed", rowCount: rows.length,
        detail: `storage put failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  }

  // Advance the watermark only when rows were seen; otherwise keep the prior
  // watermark so a later run re-scans from the same point.
  if (maxCursorIso) await setWatermark(wmKey, maxCursorIso);
  await recordExportRun({ runId, dataset: wmKey, status: "succeeded", rowCount: rows.length, detail: s3Key ?? undefined });

  return {
    runId,
    dataset,
    rowCount: rows.length,
    s3Key,
    previousWatermark: previous,
    newWatermark: maxCursorIso ?? previous,
  };
}
