/**
 * server/fee-schedule.ts
 *
 * Wave W5-4: DB-backed administrative fee schedule.
 *
 * Table `fee_schedules` (migration 0041_wave_w5.sql, seeded from the verified
 * effective-dated tiers in server/idr/clocks-2026/params-2026.ts) is read
 * FIRST by the clocks-2026 fee routes; when no matching row exists (e.g. the
 * table is empty in a dev database) the hardcoded params remain the fallback,
 * preserving fail-closed behavior.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";

export interface FeeScheduleRow {
  id: string;
  effectiveYear: number;
  tier: "single" | "batched";
  effectiveFrom: string; // ISO yyyy-mm-dd, inclusive
  effectiveTo: string | null; // exclusive; null = open-ended
  amountUsd: string;
  citation: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Latest tier row applicable on `asOf` — most specific (latest effectiveFrom)
 * wins. Returns null when the table is missing/empty/unreachable so callers
 * can fall back to params-2026.
 */
export async function getAdminFeeFromDb(tier: "single" | "batched", asOf: Date): Promise<FeeScheduleRow | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const day = isoDay(asOf);
    const result = await db.execute(sql`
      SELECT id, "effectiveYear", tier, "effectiveFrom", "effectiveTo", "amountUsd", citation, "updatedBy", "updatedAt"
      FROM fee_schedules
      WHERE tier = ${tier}
        AND "effectiveFrom" <= ${day}
        AND ("effectiveTo" IS NULL OR "effectiveTo" > ${day})
      ORDER BY "effectiveFrom" DESC
      LIMIT 1
    `);
    const rows = ((result as any).rows ?? result) as FeeScheduleRow[];
    return rows[0] ?? null;
  } catch (err) {
    // Table may not exist yet pre-migration — fall back to params.
    console.warn("[fee-schedule] DB lookup failed, using params fallback:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function listFeeSchedules(): Promise<FeeScheduleRow[]> {
  const db = await getDb();
  if (!db) return [];
  const result = await db.execute(sql`
    SELECT id, "effectiveYear", tier, "effectiveFrom", "effectiveTo", "amountUsd", citation, "updatedBy", "updatedAt"
    FROM fee_schedules ORDER BY tier, "effectiveFrom"
  `);
  return ((result as any).rows ?? result) as FeeScheduleRow[];
}
