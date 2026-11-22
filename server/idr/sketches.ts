/**
 * server/idr/sketches.ts
 *
 * Phase 23: Apache DataSketches (KLL/HLL) adoption — capability probe, env
 * gate, volume threshold, and the SINGLE SOURCE OF TRUTH for the extension's
 * SQL function names.
 *
 * Function names verified against apache/datasketches-postgresql master
 * (sql/datasketches_kll_double_sketch.sql, sql/datasketches_hll_sketch.sql):
 *   kll_double_sketch_build(double precision)           AGGREGATE over values
 *   kll_double_sketch_merge(kll_double_sketch)          AGGREGATE over sketches
 *   kll_double_sketch_get_quantile(kll_double_sketch, double precision)
 *   hll_sketch_build(anyelement)                        AGGREGATE over values
 *   hll_sketch_union(hll_sketch)                        AGGREGATE over sketches
 *   hll_sketch_union(hll_sketch, hll_sketch)            scalar 2-arg union
 *   hll_sketch_get_estimate(hll_sketch)                 scalar -> double
 * Both sketch types cast to/from bytea (CREATE CAST ... AS ASSIGNMENT), so
 * persisted bytea is read back with an explicit ::kll_double_sketch cast.
 * NOTE: kll merge exists ONLY as an aggregate — merging a stored sketch with
 * a batch sketch requires an aggregate subquery, not a scalar call.
 *
 * Gate: SKETCHES_ENABLED = auto (default; use the extension iff the runtime
 * probe finds it) | on (require; fail CLOSED to exact with a logged warning
 * when absent) | off (never use). SKETCH_MIN_ROWS (default 10000) gates the
 * sketch path by volume; below it every read is exact.
 *
 * SQL discipline (aggregateOutcomeSegments precedent): builders compose
 * CONSTANT SQL text only — column/table expressions are fixed literals
 * defined in this repo, and the only interpolated scalars are validated
 * finite numbers (quantile fractions, the integer row threshold). User/org
 * data (segment keys, org ids) NEVER flows through these builders; callers
 * bind those as sql`` parameters.
 */

import { sql } from "drizzle-orm";
import type { getDb } from "../db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export const SKETCH_EXTENSION_NAME = "datasketches";
export const DEFAULT_SKETCH_MIN_ROWS = 10000;

export type SketchGate = "auto" | "on" | "off";
export type EstimateProvenance = "kll_sketch" | "hll_sketch" | "exact";

// ────────────────────────────────────────────────────────────────────────────
// Env gate + volume threshold (offer-bandit.ts per-module env pattern)
// ────────────────────────────────────────────────────────────────────────────

export function sketchGate(env: NodeJS.ProcessEnv = process.env): SketchGate {
  const v = (env.SKETCHES_ENABLED ?? "auto").trim().toLowerCase();
  return v === "on" || v === "off" ? v : "auto";
}

export function sketchMinRows(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.SKETCH_MIN_ROWS);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_SKETCH_MIN_ROWS;
}

/** Pure gate resolution: extension use requires the gate to allow it AND the
 *  probe to have found the extension. Unit-tested without a DB. */
export function shouldUseSketches(gate: SketchGate, capable: boolean): boolean {
  return gate !== "off" && capable;
}

/** Pure volume gate: below SKETCH_MIN_ROWS every read stays exact. */
export function sketchEligible(rowCount: number, minRows: number): boolean {
  return rowCount >= minRows;
}

// ────────────────────────────────────────────────────────────────────────────
// Runtime capability probe (cached per process; NO CREATE EXTENSION anywhere)
// ────────────────────────────────────────────────────────────────────────────

let probeCache: boolean | null = null;
let warnedOnMissing = false;

/** Test-only reset (the live DB's extension set is fixed per process). */
export function resetSketchProbeCacheForTests(): void {
  probeCache = null;
  warnedOnMissing = false;
}

/** Cached pg_extension lookup. Never throws: a probe error fails closed. */
export async function probeSketchCapability(db: Db): Promise<boolean> {
  if (probeCache !== null) return probeCache;
  try {
    const result = await db.execute(
      sql`SELECT 1 AS found FROM pg_extension WHERE extname = ${SKETCH_EXTENSION_NAME} LIMIT 1`
    );
    const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as unknown[];
    probeCache = rows.length > 0;
  } catch {
    probeCache = false;
  }
  return probeCache;
}

/** Resolved gate: should sketch paths run against this DB right now? */
export async function sketchesActive(db: Db, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const gate = sketchGate(env);
  if (gate === "off") return false;
  const capable = await probeSketchCapability(db);
  if (gate === "on" && !capable && !warnedOnMissing) {
    warnedOnMissing = true;
    console.warn(
      `[sketches] SKETCHES_ENABLED=on but extension "${SKETCH_EXTENSION_NAME}" is not installed; ` +
      `failing CLOSED to exact aggregates (managed Postgres does not offer datasketches).`
    );
  }
  return shouldUseSketches(gate, capable);
}

// ────────────────────────────────────────────────────────────────────────────
// SQL builders — constants in, SQL text out. The ONLY dynamic scalar allowed
// is a validated quantile fraction (finite, 0..1), rendered as a number.
// ────────────────────────────────────────────────────────────────────────────

function assertQuantileFraction(q: number): void {
  if (typeof q !== "number" || !Number.isFinite(q) || q < 0 || q > 1) {
    throw new Error(`quantile fraction must be a finite number in [0,1], got ${q}`);
  }
}

/** Batch KLL build over a value expression (aggregate). */
export function kllBuildSql(valueExpr: string): string {
  return `kll_double_sketch_build(${valueExpr})`;
}

/**
 * Batch KLL build cast to bytea SERVER-SIDE (assignment cast), for
 * persistence. Without the cast the SELECT yields the kll_double_sketch type,
 * whose text output function emits base64 and which postgres-js (unknown OID)
 * returns as a TEXT string — storing that into a bytea column would persist
 * ASCII-of-base64 (corrupt). With ::bytea postgres-js decodes to a Buffer,
 * and the read-side ::kll_double_sketch cast round-trips it.
 */
export function kllBuildByteaSql(valueExpr: string): string {
  return `${kllBuildSql(valueExpr)}::bytea`;
}

/** Merge a column/subquery of KLL sketches (aggregate — the only merge form). */
export function kllMergeSql(sketchExpr: string): string {
  return `kll_double_sketch_merge(${sketchExpr})`;
}

/** Scalar quantile read from a KLL sketch expression. */
export function kllQuantileSql(sketchExpr: string, q: number): string {
  assertQuantileFraction(q);
  return `kll_double_sketch_get_quantile(${sketchExpr}, ${q})`;
}

/** Batch HLL build over a value expression (aggregate). */
export function hllBuildSql(valueExpr: string): string {
  return `hll_sketch_build(${valueExpr})`;
}

/** Union a column of HLL sketches (aggregate). */
export function hllUnionSql(sketchExpr: string): string {
  return `hll_sketch_union(${sketchExpr})`;
}

/** Scalar distinct-count estimate from an HLL sketch expression. */
export function hllEstimateSql(sketchExpr: string): string {
  return `hll_sketch_get_estimate(${sketchExpr})`;
}

// ── Exact fallbacks — same call sites, no extension required. ───────────────

/** Exact quantile counterpart (percentile_cont), matching OUTCOME_STATS_SQL. */
export function exactQuantileSql(valueExpr: string, q: number): string {
  assertQuantileFraction(q);
  return `percentile_cont(${q}) WITHIN GROUP (ORDER BY ${valueExpr})`;
}

/** Exact distinct-count counterpart. */
export function exactDistinctSql(valueExpr: string): string {
  return `COUNT(DISTINCT ${valueExpr})`;
}
