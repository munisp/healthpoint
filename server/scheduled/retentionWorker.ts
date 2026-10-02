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
  /** Expired settlement-callback replay-protection nonces (G1). */
  settlementNoncesPurged: number;
}

/** Delete rows older than the retention cutoff. Returns per-table counts. */
export async function runRetentionPurge(days?: number): Promise<RetentionResult> {
  const n = days ?? retentionDays();
  const cutoff = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  const result: RetentionResult = { retentionDays: n, cutoff, fhirCachePurged: 0, smartFormExtractionsPurged: 0, settlementNoncesPurged: 0 };
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
  // G1: replay-protection nonces expire on their own clock (24h TTL), not the
  // retention window — purge rows whose expiresAt has passed.
  try {
    const { purgeExpiredSettlementCallbackNonces } = await import("../settlement-auth");
    result.settlementNoncesPurged = await purgeExpiredSettlementCallbackNonces();
  } catch (err) { console.warn("[retention] settlement_callback_nonces purge failed:", err); }
  console.info(`[retention] purge complete (>${n}d): fhirCache=${result.fhirCachePurged} smartFormExtractions=${result.smartFormExtractionsPurged} settlementNonces=${result.settlementNoncesPurged}`);
  return result;
}

/** Start the daily purge interval. Returns a stop function. */
export function startRetentionWorker(intervalMs = 24 * 60 * 60 * 1000): () => void {
  const timer = setInterval(() => { void runRetentionPurge(); }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * HTTP handler for POST /api/scheduled/retention-purge (mounted behind
 * `scheduledAuth` in server/_core/index.ts like the other heartbeat workers).
 */
export async function retentionWorkerHandler(_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void }; json: (b: unknown) => void }) {
  try {
    const result = await runRetentionPurge();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[retention] scheduled purge failed:", err);
    res.status(500).json({ ok: false, error: "retention purge failed" });
  }
}
