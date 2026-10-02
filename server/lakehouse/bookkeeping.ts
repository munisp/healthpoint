/**
 * server/lakehouse/bookkeeping.ts
 *
 * Internal bookkeeping for the lakehouse export pipeline: per-dataset
 * incremental watermarks + export-run history.
 *
 * DELIBERATE DESIGN CHOICE — no Drizzle migration:
 *   drizzle/ (and its migration journal) is owned by other workstreams on
 *   this branch; adding a migration would race their journal entries. These
 *   tables are therefore created IDEMPOTENTLY AT RUNTIME via raw SQL
 *   (CREATE TABLE IF NOT EXISTS) on first use. They are internal ops
 *   bookkeeping only — no PHI, no business entities. Documented in
 *   docs/LAKEHOUSE.md.
 *
 * Tables (both created by ensureLakehouseBookkeeping()):
 *   lakehouse_export_watermarks(dataset PK, last_exported_at, updated_at)
 *   lakehouse_export_runs(id PK, run_id, dataset, started_at, finished_at,
 *                        row_count, status, detail)
 */
import { getDb } from "../db";

let ensured = false;

/** Idempotently create the bookkeeping tables. Safe to call on every run. */
export async function ensureLakehouseBookkeeping(): Promise<boolean> {
  if (ensured) return true;
  const db = await getDb();
  if (!db) return false;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS lakehouse_export_watermarks (
      dataset text PRIMARY KEY,
      last_exported_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS lakehouse_export_runs (
      id bigserial PRIMARY KEY,
      run_id text NOT NULL,
      dataset text NOT NULL,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz,
      row_count integer NOT NULL DEFAULT 0,
      status text NOT NULL,
      detail text
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS lakehouse_export_runs_run_id_idx
      ON lakehouse_export_runs (run_id)
  `);
  ensured = true;
  return true;
}

/** Test hook: reset the idempotence latch (does NOT drop tables). */
export function resetBookkeepingLatch(): void {
  ensured = false;
}

/** Read the persisted watermark for a dataset as full-precision Postgres
 *  timestamp text (null = never exported). Text, not Date: JS Date truncates
 *  to ms and would re-export boundary rows. */
export async function getWatermark(dataset: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  if (!(await ensureLakehouseBookkeeping())) return null;
  const { sql } = await import("drizzle-orm");
  const res = await db.execute(sql`
    SELECT last_exported_at::text AS wm FROM lakehouse_export_watermarks WHERE dataset = ${dataset}
  `);
  const rows: any[] = Array.isArray(res) ? (res as any) : ((res as any)?.rows ?? []);
  const v = rows[0]?.wm;
  return v != null ? String(v) : null;
}

/** Upsert the watermark for a dataset. Accepts a Date or a full-precision
 *  Postgres timestamp string (preferred — JS Date truncates to ms). */
export async function setWatermark(dataset: string, lastExportedAt: Date | string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  if (!(await ensureLakehouseBookkeeping())) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    INSERT INTO lakehouse_export_watermarks (dataset, last_exported_at, updated_at)
    VALUES (${dataset}, ${typeof lastExportedAt === "string" ? lastExportedAt : lastExportedAt.toISOString()}, now())
    ON CONFLICT (dataset) DO UPDATE
      SET last_exported_at = EXCLUDED.last_exported_at, updated_at = now()
  `);
}

export type ExportRunStatus = "started" | "succeeded" | "failed";

/** Append an export-run status row. Returns the row id (null if no DB). */
export async function recordExportRun(run: {
  runId: string;
  dataset: string;
  status: ExportRunStatus;
  rowCount?: number;
  detail?: string;
  finished?: boolean;
}): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  if (!(await ensureLakehouseBookkeeping())) return null;
  const { sql } = await import("drizzle-orm");
  const res = await db.execute(sql`
    INSERT INTO lakehouse_export_runs (run_id, dataset, status, row_count, detail, finished_at)
    VALUES (${run.runId}, ${run.dataset}, ${run.status}, ${run.rowCount ?? 0},
            ${run.detail ?? null}, ${run.finished === false ? null : sql`now()`})
    RETURNING id
  `);
  const rows: any[] = Array.isArray(res) ? (res as any) : ((res as any)?.rows ?? []);
  return rows[0]?.id != null ? Number(rows[0].id) : null;
}

/** Read back run rows for a runId (used by tests and the status activity). */
export async function listExportRuns(runId: string): Promise<Array<Record<string, unknown>>> {
  const db = await getDb();
  if (!db) return [];
  if (!(await ensureLakehouseBookkeeping())) return [];
  const { sql } = await import("drizzle-orm");
  const res = await db.execute(sql`
    SELECT * FROM lakehouse_export_runs WHERE run_id = ${runId} ORDER BY id
  `);
  return Array.isArray(res) ? (res as any) : ((res as any)?.rows ?? []);
}
