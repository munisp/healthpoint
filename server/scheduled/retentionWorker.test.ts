import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { retentionDays, runRetentionPurge, retentionWorkerHandler, DEFAULT_RETENTION_DAYS } from "./retentionWorker";

describe("retentionDays config", () => {
  it("defaults to 90 and honors RETENTION_DAYS", () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(90);
    expect(retentionDays({})).toBe(90);
    expect(retentionDays({ RETENTION_DAYS: "30" })).toBe(30);
    expect(retentionDays({ RETENTION_DAYS: "garbage" })).toBe(90);
    expect(retentionDays({ RETENTION_DAYS: "-5" })).toBe(90);
  });
});

const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describe("retentionWorkerHandler (HTTP mount)", () => {
  it("responds ok with purge counts (no DB → zero counts)", async () => {
    const calls: Array<{ status?: number; body: unknown }> = [];
    const res = {
      status(n: number) { return { json(body: unknown) { calls.push({ status: n, body }); } }; },
      json(body: unknown) { calls.push({ body }); },
    };
    await retentionWorkerHandler({}, res);
    expect(calls).toHaveLength(1);
    const body = calls[0].body as { ok: boolean; retentionDays: number; fhirCachePurged: number; smartFormExtractionsPurged: number };
    expect(body.ok).toBe(true);
    expect(body.retentionDays).toBe(DEFAULT_RETENTION_DAYS);
    expect(body.fhirCachePurged).toBe(0);
    expect(body.smartFormExtractionsPurged).toBe(0);
  });
});

describeDb("runRetentionPurge (DB)", () => {
  const sql = postgres(DB_URL!, { max: 1 });
  const run = Date.now();
  const oldCache = `w6ret-old-${run}`;
  const newCache = `w6ret-new-${run}`;
  const oldSfe = `w6ret-sfe-old-${run}`;
  const newSfe = `w6ret-sfe-new-${run}`;

  beforeAll(async () => {
    await sql.unsafe(
      `INSERT INTO fhir_resource_cache (id, "emrConnectionId", "resourceType", "resourceId", "resourceData", "fetchedAt")
       VALUES ($1, 'conn-ret', 'Claim', 'c1', '{}', now() - interval '120 days'), ($2, 'conn-ret', 'Claim', 'c2', '{}', now())`,
      [oldCache, newCache],
    );
    await sql.unsafe(
      `INSERT INTO smart_form_extractions (id, "userId", "targetForm", "inputType", "extractedFields", status, "createdAt")
       VALUES ($1, 'u1', 'generic', 'text', '{}', 'complete', now() - interval '120 days'), ($2, 'u1', 'generic', 'text', '{}', 'complete', now())`,
      [oldSfe, newSfe],
    );
  });

  afterAll(async () => {
    await sql.unsafe(`DELETE FROM fhir_resource_cache WHERE id IN ($1, $2)`, [oldCache, newCache]);
    await sql.unsafe(`DELETE FROM smart_form_extractions WHERE id IN ($1, $2)`, [oldSfe, newSfe]);
    await sql.end();
  });

  it("deletes rows older than the retention window only", async () => {
    const r = await runRetentionPurge(90);
    expect(r.fhirCachePurged).toBeGreaterThanOrEqual(1);
    expect(r.smartFormExtractionsPurged).toBeGreaterThanOrEqual(1);
    const remaining = await sql.unsafe(
      `SELECT (SELECT count(*) FROM fhir_resource_cache WHERE id = $1)::int AS old_cache,
              (SELECT count(*) FROM fhir_resource_cache WHERE id = $2)::int AS new_cache,
              (SELECT count(*) FROM smart_form_extractions WHERE id = $3)::int AS old_sfe,
              (SELECT count(*) FROM smart_form_extractions WHERE id = $4)::int AS new_sfe`,
      [oldCache, newCache, oldSfe, newSfe],
    );
    expect(remaining[0]).toEqual({ old_cache: 0, new_cache: 1, old_sfe: 0, new_sfe: 1 });
  });
});
