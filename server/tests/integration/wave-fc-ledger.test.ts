/**
 * server/tests/integration/wave-fc-ledger.test.ts
 *
 * Wave F-C integration tests (real PostgreSQL, RUN_INTEGRATION=1 gated):
 *   (a) create dispute → billed amount + determination recorded on the ledger →
 *       getDisputeFinancialSummary shows non-zero billed, determination and a
 *       recovery rate consistent with payments.
 *   (b) partial payment → determination reduced below the paid amount →
 *       overpayment credit memo is booked (M3) and any further payment is
 *       rejected cleanly (assertPaymentAcceptable, M5b).
 *
 * Run manually:
 *   RUN_INTEGRATION=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres \
 *     pnpm vitest run server/tests/integration/wave-fc-ledger.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://healthpoint_test:healthpoint_test@localhost:54329/healthpoint_test";

type SqlClient = ReturnType<typeof import("postgres")>;

async function applyMigrations(sql: SqlClient): Promise<void> {
  // Idempotency: if the schema is already present (shared dev database),
  // skip re-applying migrations — they are not re-runnable by design.
  const existing = await sql`
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'disputes'
  `;
  if (existing.length > 0) return;
  const migrationsDir = path.resolve(import.meta.dirname, "../../../drizzle/migrations");
  const journal = JSON.parse(
    readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8")
  ) as { entries: Array<{ tag: string }> };
  for (const entry of journal.entries) {
    const raw = readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8");
    for (const statement of raw.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean)) {
      await sql.unsafe(statement);
    }
  }
}

describe.skipIf(!RUN_INTEGRATION)("integration: wave-fc ledger wiring (real PostgreSQL)", () => {
  let sql: SqlClient;
  let ledger: typeof import("../../ledger");
  let getDb: (typeof import("../../db"))["getDb"];
  let schema: typeof import("../../../drizzle/schema");

  const disputeId = crypto.randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    delete process.env.EXTERNAL_POSTGRES_URL;
    delete process.env.KAFKA_BROKERS;
    delete process.env.REDIS_URL;

    const postgres = (await import("postgres")).default;
    sql = postgres(DATABASE_URL, { max: 4 });
    await sql`SELECT 1`;
    await applyMigrations(sql);

    ledger = await import("../../ledger");
    ({ getDb } = await import("../../db"));
    schema = await import("../../../drizzle/schema");

    const db = await getDb();
    if (!db) throw new Error("getDb() returned null — database unavailable");
    await db.insert(schema.disputes).values({
      id: disputeId,
      referenceNumber: `IT-FC-${disputeId.slice(0, 8)}`,
      initiatingPartyId: "integration-tester",
      initiatingPartyType: "provider",
      initiatingPartyName: "Wave FC Integration Provider",
      serviceType: "emergency_medicine",
      serviceDate: new Date("2026-01-15T00:00:00.000Z"),
      patientState: "TX",
      facilityState: "TX",
      cptCodes: ["99283"],
      billedAmount: "5000.00",
      determinationAmount: null,
      paidAmount: null,
      currentStep: "STEP_02_OPEN_NEGOTIATION_PERIOD",
      status: "open_negotiation",
      createdBy: "integration-tester",
    });
    await ledger.initializeDisputeLedger(disputeId);
  }, 120_000);

  afterAll(async () => {
    if (!sql) return;
    try {
      await sql`DELETE FROM event_log WHERE "aggregateId" = ${disputeId}`;
      await sql`DELETE FROM ledger_entries WHERE "disputeId" = ${disputeId}`;
      await sql`DELETE FROM ledger_accounts WHERE "disputeId" = ${disputeId}`;
      await sql`DELETE FROM disputes WHERE id = ${disputeId}`;
    } finally {
      await sql.end({ timeout: 5 });
      try {
        const db = await getDb();
        await ((db as unknown as { $client?: { end: () => Promise<void> } })?.$client?.end?.());
      } catch { /* pool already closed */ }
    }
  }, 60_000);

  it("(a) billed + determination flow into getDisputeFinancialSummary", async () => {
    // Mirrors routers.create (M1): billed amount recorded at creation.
    await ledger.recordBilledAmount(disputeId, 500_000, disputeId);
    // Mirrors routers.advance → STEP_13 (M1): determination recorded, delta-based.
    await ledger.recordDetermination(disputeId, 260_000, disputeId);
    // Idempotent re-issue of the same determination is a no-op.
    await ledger.recordDetermination(disputeId, 260_000, disputeId);

    const summary = await ledger.getDisputeFinancialSummary(disputeId);
    expect(summary.billedDollars).toBe(5000);
    expect(summary.determinationDollars).toBe(2600);
    expect(summary.paidDollars).toBe(0);
    expect(summary.recoveryRate).toBe(0);
    expect(summary.determinationVsBilled).toBeCloseTo(0.52, 5);

    // Determination posted exactly once (no double-post on re-issue).
    const entries = await sql`
      SELECT COUNT(*)::int AS n FROM ledger_entries
      WHERE "disputeId" = ${disputeId} AND "referenceType" = 'determination' AND "entryType" = 'credit'
    `;
    expect(entries[0].n).toBe(1);
  });

  it("(b) partial payment → reduced determination → overpayment credit + clean rejection", async () => {
    const db = await getDb();
    if (!db) throw new Error("db unavailable");

    // Determination issued on the dispute row, then a partial verified payment.
    const { eq } = await import("drizzle-orm");
    await db.update(schema.disputes)
      .set({
        determinationAmount: "2600.00",
        currentStep: "STEP_14_PAYMENT_DETERMINATION",
        status: "determination_issued",
      })
      .where(eq(schema.disputes.id, disputeId));
    await ledger.recordPayment(disputeId, 200_000, "it-fc-ref-0001", crypto.randomUUID(), "integration-test");

    let summary = await ledger.getDisputeFinancialSummary(disputeId);
    expect(summary.paidDollars).toBe(2000);
    expect(summary.recoveryRate).toBeCloseTo(0.4, 5);

    // Determination REDUCED below the amount already paid: 2600 → 1500.
    await db.update(schema.disputes)
      .set({ determinationAmount: "1500.00" })
      .where(eq(schema.disputes.id, disputeId));
    await ledger.recordDetermination(disputeId, 150_000, disputeId);

    summary = await ledger.getDisputeFinancialSummary(disputeId);
    // The determination account tracks the OUTSTANDING determined balance:
    // 1500 determined − 2000 paid = −500, of which 500 is reclassified to the
    // overpayment-credit liability account, leaving 0 outstanding.
    expect(summary.determinationDollars).toBe(0);
    // M3: the $500 excess is booked as an overpayment credit liability.
    expect(summary.overpaymentCreditDollars).toBe(500);

    // M5b: nothing left to pay — any further payment is rejected cleanly.
    await expect(
      ledger.recordPayment(disputeId, 1_000, "it-fc-ref-0002", crypto.randomUUID(), "integration-test")
    ).rejects.toThrow(/No remaining determined amount to pay/);

    // Rejected payment left no trace: paid balance unchanged.
    summary = await ledger.getDisputeFinancialSummary(disputeId);
    expect(summary.paidDollars).toBe(2000);
  });
});
