/**
 * server/scheduled/retentionWorker.ts
 *
 * W6 retention purge: deletes aged rows from ephemeral interop stores so PHI
 * and FHIR payloads don't accumulate indefinitely:
 *   - fhir_resource_cache     (rows whose fetchedAt is older than N days)
 *   - smart_form_extractions  (rows whose createdAt is older than N days)
 *
 * Retention window: RETENTION_DAYS env (default 90 days).
 * `runRetentionPurge` is the unit of work (directly testable); the interval
 * wiring lives in the scheduler bootstrap like the other workers.
 */
import { getDb } from "../db";

export const DEFAULT_RETENTION_DAYS = 90;

export function retentionDays(env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): number {
  const n = Number(env.RETENTION_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_RETENTION_DAYS;
}

export interface RetentionResult {
  retentionDays: number;
  cutoff: Date;
  fhirCachePurged: number;
  smartFormExtractionsPurged: number;
}

/** Delete rows older than the retention cutoff. Returns per-table counts. */
export async function runRetentionPurge(days?: number): Promise<RetentionResult> {
  const n = days ?? retentionDays();
  const cutoff = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  const result: RetentionResult = { retentionDays: n, cutoff, fhirCachePurged: 0, smartFormExtractionsPurged: 0 };
  const db = await getDb();
  if (!db) return result;
  const { lt } = await import("drizzle-orm");
  const { fhirResourceCache, smartFormExtractions } = await import("../../drizzle/schema");
  try {
    const r = await db.delete(fhirResourceCache).where(lt(fhirResourceCache.fetchedAt, cutoff)).returning({ id: fhirResourceCache.id });
    result.fhirCachePurged = r.length;
  } catch (err) { console.warn("[retention] fhir_resource_cache purge failed:", err); }
  try {
    const r = await db.delete(smartFormExtractions).where(lt(smartFormExtractions.createdAt, cutoff)).returning({ id: smartFormExtractions.id });
    result.smartFormExtractionsPurged = r.length;
  } catch (err) { console.warn("[retention] smart_form_extractions purge failed:", err); }
  console.info(`[retention] purge complete (>${n}d): fhirCache=${result.fhirCachePurged} smartFormExtractions=${result.smartFormExtractionsPurged}`);
  return result;
}

/** Start the daily purge interval. Returns a stop function. */
export function startRetentionWorker(intervalMs = 24 * 60 * 60 * 1000): () => void {
  const timer = setInterval(() => { void runRetentionPurge(); }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
