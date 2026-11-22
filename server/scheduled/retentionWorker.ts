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
  /** Phase 21: PHI-free suggestion-feedback events past their window. */
  suggestionEventsPurged: number;
  /** Phase 21: expired next-action dismissals (purged on expiresAt). */
  nextActionDismissalsPurged: number;
}

/** Phase 21: suggestion_events retention (default 365d; PHI-free by construction). */
export const DEFAULT_SUGGESTION_EVENTS_RETENTION_DAYS = 365;

export function suggestionEventsRetentionDays(env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): number {
  const n = Number(env.SUGGESTION_EVENTS_RETENTION_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_SUGGESTION_EVENTS_RETENTION_DAYS;
}

/** Delete rows older than the retention cutoff. Returns per-table counts. */
export async function runRetentionPurge(days?: number): Promise<RetentionResult> {
  // Wave p27 (RLS design R1): the Phase-21 deletes below are GLOBAL (no org
  // filter). Under enforced RLS without service mode they would silently
  // match 0 rows and report success — a PHI-retention failure mode. Service
  // context is mandatory before batch C is enforced; in the default off mode
  // withServiceContext is a pure passthrough.
  const { withServiceContext } = await import("../db/rls");
  const db = await getDb();
  if (!db) {
    return { retentionDays: days ?? retentionDays(), cutoff: new Date(), fhirCachePurged: 0, smartFormExtractionsPurged: 0, settlementNoncesPurged: 0, suggestionEventsPurged: 0, nextActionDismissalsPurged: 0 };
  }
  return withServiceContext({ service: true, label: "retention" }, (tx) => runRetentionPurgeInner(days, tx), db);
}

/** Exported for the F-5 worker-poisoning unit test (scripted fake db). */
export async function runRetentionPurgeInner(days: number | undefined, db: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<RetentionResult> {
  const n = days ?? retentionDays();
  const cutoff = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  const result: RetentionResult = { retentionDays: n, cutoff, fhirCachePurged: 0, smartFormExtractionsPurged: 0, settlementNoncesPurged: 0, suggestionEventsPurged: 0, nextActionDismissalsPurged: 0 };
  const { lt } = await import("drizzle-orm");
  const { rlsGuard } = await import("../db/rls");
  const { fhirResourceCache, smartFormExtractions } = await import("../../drizzle/schema");
  // Fix F-5: each purge runs inside rlsGuard (nested-transaction savepoint
  // per table when the service-mode wrap has a transaction open; direct in
  // off-mode). A failing delete previously aborted the shared tx (25P02),
  // silently zeroing every LATER purge while the completion log claimed
  // success. Counts now reflect actual commits per table.
  try {
    result.fhirCachePurged = await rlsGuard(db, async (gtx) =>
      (await gtx.delete(fhirResourceCache).where(lt(fhirResourceCache.fetchedAt, cutoff)).returning({ id: fhirResourceCache.id })).length);
  } catch (err) { console.warn("[retention] fhir_resource_cache purge failed:", err); }
  try {
    result.smartFormExtractionsPurged = await rlsGuard(db, async (gtx) =>
      (await gtx.delete(smartFormExtractions).where(lt(smartFormExtractions.createdAt, cutoff)).returning({ id: smartFormExtractions.id })).length);
  } catch (err) { console.warn("[retention] smart_form_extractions purge failed:", err); }
  // G1: replay-protection nonces expire on their own clock (24h TTL), not the
  // retention window — purge rows whose expiresAt has passed.
  try {
    const { purgeExpiredSettlementCallbackNonces } = await import("../settlement-auth");
    result.settlementNoncesPurged = await rlsGuard(db, () => purgeExpiredSettlementCallbackNonces());
  } catch (err) { console.warn("[retention] settlement_callback_nonces purge failed:", err); }
  // Phase 21: suggestion_events on its own (longer) window — rows are the
  // metrics substrate and PHI-free by construction.
  try {
    const { suggestionEvents } = await import("../../drizzle/schema-intelligence");
    const seDays = suggestionEventsRetentionDays();
    const seCutoff = new Date(Date.now() - seDays * 24 * 60 * 60 * 1000);
    result.suggestionEventsPurged = await rlsGuard(db, async (gtx) =>
      (await gtx.delete(suggestionEvents).where(lt(suggestionEvents.createdAt, seCutoff)).returning({ id: suggestionEvents.id })).length);
  } catch (err) { console.warn("[retention] suggestion_events purge failed:", err); }
  // Phase 21: expired next-action dismissals (purged on expiresAt).
  try {
    const { nextActionDismissals } = await import("../../drizzle/schema-intelligence");
    result.nextActionDismissalsPurged = await rlsGuard(db, async (gtx) =>
      (await gtx.delete(nextActionDismissals).where(lt(nextActionDismissals.expiresAt, new Date())).returning({ id: nextActionDismissals.id })).length);
  } catch (err) { console.warn("[retention] next_action_dismissals purge failed:", err); }
  console.info(`[retention] purge complete (>${n}d): fhirCache=${result.fhirCachePurged} smartFormExtractions=${result.smartFormExtractionsPurged} settlementNonces=${result.settlementNoncesPurged} suggestionEvents=${result.suggestionEventsPurged} nextActionDismissals=${result.nextActionDismissalsPurged}`);
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
