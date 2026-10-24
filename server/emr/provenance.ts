/**
 * server/emr/provenance.ts
 *
 * Field-level provenance for dispute records.
 *
 * A `fieldProvenance` jsonb column on `disputes` (migration
 * drizzle/migrations/0042_wave_w6.sql, accessed via raw SQL because
 * drizzle/schema.ts is owned by another wave) records, per dispute field,
 * whether the current value originated from an EMR pull ("emr") or a manual
 * edit ("manual"), plus the timestamp of the last EMR pull.
 *
 * MERGE RULE (re-pull safety):
 *   An EMR re-pull only fills fields whose provenance is NOT "manual".
 *   Fields a user has edited by hand are never silently overwritten by a
 *   subsequent pull. Fields never touched manually (provenance absent or
 *   "emr") are refreshed and (re-)stamped "emr".
 *
 * `markFieldsManual` is exported for the dispute-update procedures (owned by
 * another wave) to call whenever a user edits a dispute field by hand.
 */

import { getDb } from "../db";

export type FieldSource = "emr" | "manual";

export interface FieldProvenance {
  /** fieldName -> source of the current value. */
  fields: Record<string, FieldSource>;
  /** ISO timestamp of the last EMR pull that touched this dispute. */
  lastEmrPullAt?: string;
}

/** Dispute columns an EMR pull is allowed to fill. */
export const EMR_FILLABLE_FIELDS = [
  "patientState",
  "facilityState",
  "billedAmount",
  "qpaAmount",
  "serviceDate",
  "serviceType",
  "cptCodes",
  "icd10Codes",
  "respondingPartyName",
  "initiatingPartyNpi",
  "respondingPartyNpi",
] as const;

export type EmrFillableField = (typeof EMR_FILLABLE_FIELDS)[number];

export async function readFieldProvenance(disputeId: string): Promise<FieldProvenance> {
  const db = await getDb();
  if (!db) return { fields: {} };
  const { sql } = await import("drizzle-orm");
  try {
    const r: any = await db.execute(sql`SELECT "fieldProvenance" FROM disputes WHERE id = ${disputeId} LIMIT 1`);
    const rows = Array.isArray(r) ? r : (r?.rows ?? []);
    const raw = rows[0]?.fieldProvenance;
    if (!raw) return { fields: {} };
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { fields: parsed.fields ?? {}, lastEmrPullAt: parsed.lastEmrPullAt };
  } catch {
    return { fields: {} }; // column not yet migrated
  }
}

async function writeFieldProvenance(disputeId: string, prov: FieldProvenance): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`UPDATE disputes SET "fieldProvenance" = ${JSON.stringify(prov)}::jsonb WHERE id = ${disputeId}`);
}

/** Stamp fields as manually edited; called by dispute-update paths. */
export async function markFieldsManual(disputeId: string, fields: string[]): Promise<void> {
  if (!fields.length) return;
  const prov = await readFieldProvenance(disputeId);
  for (const f of fields) prov.fields[f] = "manual";
  await writeFieldProvenance(disputeId, prov);
}

/**
 * Merge EMR-extracted fields into a dispute, respecting the merge rule.
 * Returns the list of fields applied and the list skipped (manually edited).
 */
export async function applyEmrExtractedFields(
  disputeId: string,
  extracted: Record<string, unknown>,
): Promise<{ applied: string[]; skippedManual: string[] }> {
  const db = await getDb();
  if (!db) return { applied: [], skippedManual: [] };
  const prov = await readFieldProvenance(disputeId);

  const applied: string[] = [];
  const skippedManual: string[] = [];
  const sets: Record<string, unknown> = {};

  for (const field of EMR_FILLABLE_FIELDS) {
    const value = extracted[field];
    if (value === undefined || value === null || value === "") continue;
    if (prov.fields[field] === "manual") {
      skippedManual.push(field);
      continue;
    }
    sets[field] = value;
    applied.push(field);
  }
  if (!applied.length) return { applied, skippedManual };

  const { sql } = await import("drizzle-orm");
  const JSONB_FIELDS = new Set(["cptCodes", "icd10Codes"]);
  // Identifiers come from the fixed EMR_FILLABLE_FIELDS allowlist; values are
  // always parameterized.
  const setSql = sql.join(applied.map(f => {
    const v = sets[f];
    if (JSONB_FIELDS.has(f)) {
      return sql`${sql.raw(`"${f}"`)} = ${JSON.stringify(v ?? [])}::jsonb`;
    }
    const bound = v instanceof Date ? v.toISOString() : v;
    return sql`${sql.raw(`"${f}"`)} = ${bound}`;
  }), sql`, `);
  await db.execute(sql`UPDATE disputes SET ${setSql} WHERE id = ${disputeId}`);

  for (const f of applied) prov.fields[f] = "emr";
  prov.lastEmrPullAt = new Date().toISOString();
  await writeFieldProvenance(disputeId, prov);
  return { applied, skippedManual };
}
