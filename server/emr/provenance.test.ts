/**
 * Provenance merge-rule tests. DB-backed cases run only when DATABASE_URL is
 * set (embedded PG in CI/sandbox); pure merge-policy cases always run.
 */
import { describe, it, expect, beforeAll } from "vitest";
import postgres from "postgres";
import {
  readFieldProvenance,
  markFieldsManual,
  applyEmrExtractedFields,
  EMR_FILLABLE_FIELDS,
} from "./provenance";

const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describe("provenance constants", () => {
  it("only allowlists real dispute columns as EMR-fillable", () => {
    expect(EMR_FILLABLE_FIELDS).toContain("patientState");
    expect(EMR_FILLABLE_FIELDS).toContain("billedAmount");
    expect(EMR_FILLABLE_FIELDS).not.toContain("status");
    expect(EMR_FILLABLE_FIELDS).not.toContain("referenceNumber");
  });
});

describeDb("field provenance merge rule (DB)", () => {
  const sql = postgres(DB_URL!, { max: 1 });
  const disputeId = `prov-test-${Date.now()}`;

  beforeAll(async () => {
    // Apply migration 0042 idempotently and insert a minimal dispute row.
    await sql.unsafe(`ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "fieldProvenance" jsonb`);
    await sql.unsafe(
      `INSERT INTO disputes (id, "referenceNumber", "initiatingPartyId", "initiatingPartyType", "initiatingPartyName", "serviceType", "serviceDate", "patientState", "facilityState", "cptCodes", "billedAmount", "currentStep", "status")
       VALUES ($1, $2, 'u1', 'provider', 'Prov', 'emergency_medicine', now(), 'TX', 'TX', '[]', '100', 'STEP_01_OPEN_NEGOTIATION_INITIATED', 'open_negotiation')
       ON CONFLICT (id) DO NOTHING`,
      [disputeId, `PROV-${Date.now()}`],
    );
    return async () => { await sql.unsafe(`DELETE FROM disputes WHERE id = $1`, [disputeId]); await sql.end(); };
  });

  it("first pull stamps fields 'emr' and fills values", async () => {
    const r = await applyEmrExtractedFields(disputeId, { patientState: "CA", billedAmount: "250.00", unknownField: "x" });
    expect(r.applied.sort()).toEqual(["billedAmount", "patientState"]);
    expect(r.skippedManual).toEqual([]);
    const prov = await readFieldProvenance(disputeId);
    expect(prov.fields.patientState).toBe("emr");
    expect(prov.lastEmrPullAt).toBeTruthy();
    const [row] = await sql.unsafe(`SELECT "patientState", "billedAmount" FROM disputes WHERE id = $1`, [disputeId]);
    expect(row.patientState).toBe("CA");
    expect(String(row.billedAmount)).toBe("250.00");
  });

  it("manual edits are NOT overwritten by a re-pull", async () => {
    await markFieldsManual(disputeId, ["patientState"]);
    const r = await applyEmrExtractedFields(disputeId, { patientState: "NY", billedAmount: "999.00" });
    expect(r.skippedManual).toEqual(["patientState"]);
    expect(r.applied).toEqual(["billedAmount"]); // emr-sourced field still refreshes
    const [row] = await sql.unsafe(`SELECT "patientState", "billedAmount" FROM disputes WHERE id = $1`, [disputeId]);
    expect(row.patientState).toBe("CA");   // manual value preserved
    expect(String(row.billedAmount)).toBe("999.00"); // re-pull fills non-manual field
  });

  it("empty extraction is a no-op", async () => {
    const r = await applyEmrExtractedFields(disputeId, { patientState: "", qpaAmount: null });
    expect(r.applied).toEqual([]);
  });
});
