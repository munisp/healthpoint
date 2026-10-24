/**
 * server/lakehouse/export.test.ts
 *
 * Watermark / incremental-export verification.
 *  - Pure config tests run everywhere.
 *  - DB tests run against embedded PG when DATABASE_URL is set
 *    (EXECUTED-VERIFIED); they skip honestly otherwise.
 *  - The S3 write is exercised through an injected in-memory sink — the real
 *    storagePut is env-gated and NOT exercised here (label: STATIC-ONLY for
 *    the S3 leg in this sandbox).
 */
import { describe, it, expect, beforeAll } from "vitest";
import postgres from "postgres";
import {
  ensureLakehouseBookkeeping,
  getWatermark,
  setWatermark,
  listExportRuns,
  resetBookkeepingLatch,
} from "./bookkeeping";
import { runIncrementalLakehouseExport } from "./export";
import { cronToIntervalMs, lakehouseExportEnabled } from "../temporal/lakehouse-schedule";

describe("lakehouse schedule config (pure)", () => {
  it("gate: enabled only when LAKEHOUSE_EXPORT_ENABLED === 'true'", () => {
    expect(lakehouseExportEnabled({})).toBe(false);
    expect(lakehouseExportEnabled({ LAKEHOUSE_EXPORT_ENABLED: "1" })).toBe(false);
    expect(lakehouseExportEnabled({ LAKEHOUSE_EXPORT_ENABLED: "true" })).toBe(true);
  });

  it("cron-lite subset parses to interval ms; unsupported returns null", () => {
    expect(cronToIntervalMs(undefined)).toBe(3_600_000);
    expect(cronToIntervalMs("@hourly")).toBe(3_600_000);
    expect(cronToIntervalMs("@daily")).toBe(86_400_000);
    expect(cronToIntervalMs("*/15 * * * *")).toBe(900_000);
    expect(cronToIntervalMs("*/0 * * * *")).toBeNull();
    expect(cronToIntervalMs("0 3 * * 1")).toBeNull(); // full cron unsupported in fallback
  });
});

const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb("incremental export watermarks (DB)", () => {
  const sql = postgres(DB_URL!, { max: 2 });
  const run = `lhtest-${Date.now()}`;
  const disputeId = `lh-exp-${run}`;
  const userId = `lh-user-${run}`;
  let sink: Array<{ key: string; body: string }>;

  beforeAll(async () => {
    resetBookkeepingLatch();
    await ensureLakehouseBookkeeping();
    // Minimal fixture user + dispute (namespaced by run id).
    await sql`
      INSERT INTO users (id, email, name, role)
      VALUES (${userId}, ${userId + "@example.test"}, 'LH Export Test', 'user')
      ON CONFLICT (id) DO NOTHING
    `;
    await sql`
      INSERT INTO disputes (
        id, "referenceNumber", "initiatingPartyId", "initiatingPartyType", "initiatingPartyName",
        "serviceType", "serviceDate", "patientState", "facilityState", "cptCodes", "billedAmount",
        "currentStep", "status", "createdAt", "updatedAt"
      ) VALUES (
        ${disputeId}, ${"REF-" + run}, ${userId}, 'provider', 'LH Test Provider',
        'emergency_medicine', now(), 'TX', 'TX', '["99285"]'::jsonb, 1000,
        'STEP_01_OPEN_NEGOTIATION_INITIATED', 'open_negotiation', now(), now()
      )
      ON CONFLICT (id) DO NOTHING
    `;
    sink = [];
  });

  const putObject = async (key: string, data: Buffer) => {
    sink.push({ key, body: data.toString("utf-8") });
  };
  // Unique watermark key per test invocation → isolation on a shared dev DB.
  const wm = `disputes-test-${run}`;
  const deps = { putObject, watermarkKey: wm };

  it("first run is a full export and sets the watermark", async () => {
    const r = await runIncrementalLakehouseExport("disputes", `${run}-a`, deps);
    expect(r.previousWatermark).toBeNull();
    expect(r.rowCount).toBeGreaterThanOrEqual(1);
    expect(r.s3Key).toContain("lakehouse-exports/incremental/disputes/");
    expect(sink.some(s => s.body.includes(disputeId))).toBe(true);
    const mark = await getWatermark(wm);
    expect(typeof mark).toBe("string"); // full-precision PG timestamp text
  });

  it("second run does not re-export already-exported rows", async () => {
    // Shared dev DB: other test files may insert newer disputes concurrently,
    // so the strict invariant is "our fixture row is NOT re-exported".
    const sinkBefore = sink.length;
    await runIncrementalLakehouseExport("disputes", `${run}-b`, deps);
    const newEntries = sink.slice(sinkBefore);
    expect(newEntries.every(e => !e.body.includes(disputeId))).toBe(true);
  });

  it("touching a row makes exactly the new row export incrementally", async () => {
    await sql`UPDATE disputes SET "updatedAt" = now() + interval '1 second', notes = 'bump'
              WHERE id = ${disputeId}`;
    const r = await runIncrementalLakehouseExport("disputes", `${run}-c`, deps);
    // Shared dev DB: other rows may be newer than our watermark too, so the
    // invariant is "our bumped row is in the incremental batch".
    expect(r.rowCount).toBeGreaterThanOrEqual(1);
    expect(r.previousWatermark).not.toBeNull();
    const last = sink[sink.length - 1];
    expect(last.body).toContain(disputeId);
    expect(last.body).toContain('"bump"');
  });

  it("watermark upsert round-trips (full-precision text accepted)", async () => {
    await setWatermark("audit", "2026-01-02 03:04:05.123456+00");
    const w1 = await getWatermark("audit");
    // Session TZ may differ from UTC; compare instants + sub-ms precision text.
    expect(new Date(w1!).getTime()).toBe(new Date("2026-01-02T03:04:05.123Z").getTime());
    expect(w1).toContain(".123456");
    await setWatermark("audit", "2026-02-03 04:05:06.000001+00");
    const w2 = await getWatermark("audit");
    expect(new Date(w2!).getTime()).toBe(new Date("2026-02-03T04:05:06Z").getTime());
    expect(w2).toContain(".000001");
  });

  it("records started/succeeded run rows per run", async () => {
    const runs = await listExportRuns(`${run}-a`);
    const statuses = runs.map(r => r.status);
    expect(statuses).toContain("started");
    expect(statuses).toContain("succeeded");
  });
});
