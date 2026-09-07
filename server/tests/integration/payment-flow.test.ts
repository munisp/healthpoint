/**
 * server/tests/integration/payment-flow.test.ts
 *
 * End-to-end integration test: payment evidence → ledger (double-entry) →
 * outbox event → outbox dispatch, against a real PostgreSQL.
 *
 * This test is SKIPPED unless RUN_INTEGRATION=1 is set. It expects a PostgreSQL
 * database (see ./docker-compose.test.yml, or the CI `integration` job, or
 * `make test-integration`) and applies the drizzle migrations itself before
 * running, so a completely empty database is sufficient.
 *
 * Run manually:
 *   docker compose -f server/tests/integration/docker-compose.test.yml up -d --wait
 *   RUN_INTEGRATION=1 DATABASE_URL=postgresql://healthpoint_test:healthpoint_test@localhost:54329/healthpoint_test \
 *     pnpm vitest run server/tests/integration
 *   docker compose -f server/tests/integration/docker-compose.test.yml down -v
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
  const migrationsDir = path.resolve(import.meta.dirname, "../../../drizzle/migrations");
  const journal = JSON.parse(
    readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8")
  ) as { entries: Array<{ tag: string }> };
  for (const entry of journal.entries) {
    const file = path.join(migrationsDir, `${entry.tag}.sql`);
    const raw = readFileSync(file, "utf8");
    const statements = raw
      .split("--> statement-breakpoint")
      .map(s => s.trim())
      .filter(s => s.length > 0);
    for (const statement of statements) {
      await sql.unsafe(statement);
    }
  }
}

describe.skipIf(!RUN_INTEGRATION)("integration: payment → ledger → outbox (real PostgreSQL)", () => {
  let sql: SqlClient;
  let recordPayment: (typeof import("../../ledger"))["recordPayment"];
  let dispatchOutboxBatch: (typeof import("../../outbox"))["dispatchOutboxBatch"];
  let getDb: (typeof import("../../db"))["getDb"];
  let schema: typeof import("../../../drizzle/schema");

  const disputeId = crypto.randomUUID();
  const idempotencyKey = crypto.randomUUID();

  beforeAll(async () => {
    // Must be set before importing server modules (getDb resolves env lazily,
    // but the pool is created once — set it first to be safe).
    process.env.DATABASE_URL = DATABASE_URL;
    delete process.env.EXTERNAL_POSTGRES_URL;
    delete process.env.KAFKA_BROKERS; // dispatch works without Kafka (producer is optional)
    delete process.env.REDIS_URL; // notification fan-out degrades to a no-op

    const postgres = (await import("postgres")).default;
    sql = postgres(DATABASE_URL, { max: 4 });

    // Wait for PostgreSQL to accept connections (compose healthcheck races CI).
    let ready = false;
    for (let attempt = 0; attempt < 30 && !ready; attempt++) {
      try {
        await sql`SELECT 1`;
        ready = true;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 1_000));
      }
    }
    if (!ready) throw new Error(`PostgreSQL not reachable at ${DATABASE_URL.replace(/\/\/.*@/, "//***@")}`);

    await applyMigrations(sql);

    ({ recordPayment } = await import("../../ledger"));
    ({ dispatchOutboxBatch } = await import("../../outbox"));
    ({ getDb } = await import("../../db"));
    schema = await import("../../../drizzle/schema");

    const db = await getDb();
    if (!db) throw new Error("getDb() returned null — database unavailable");
    await db.insert(schema.disputes).values({
      id: disputeId,
      referenceNumber: `IT-${disputeId.slice(0, 8)}`,
      initiatingPartyId: "integration-tester",
      initiatingPartyType: "provider",
      initiatingPartyName: "Integration Test Provider",
      serviceType: "emergency_medicine",
      serviceDate: new Date("2026-01-15T00:00:00.000Z"),
      patientState: "TX",
      facilityState: "TX",
      cptCodes: ["99283"],
      billedAmount: "500.00",
      determinationAmount: "100.00",
      currentStep: "STEP_14_PAYMENT_DETERMINATION",
      status: "determination_issued",
      createdBy: "integration-tester",
    });
  }, 120_000);

  afterAll(async () => {
    if (!sql) return;
    try {
      // Delete children before the dispute row.
      await sql`DELETE FROM event_log WHERE "aggregateId" = ${disputeId}`;
      await sql`DELETE FROM ledger_entries WHERE "disputeId" = ${disputeId}`;
      await sql`DELETE FROM ledger_accounts WHERE "disputeId" = ${disputeId}`;
      await sql`DELETE FROM disputes WHERE id = ${disputeId}`;
    } finally {
      await sql.end({ timeout: 5 });
      try {
        const db = await getDb();
        await ((db as unknown as { $client?: { end: () => Promise<void> } })?.$client?.end?.());
      } catch {
        /* pool already closed — nothing further to do */
      }
    }
  }, 60_000);

  it("posts verified payment evidence as a balanced double-entry and a pending outbox event", async () => {
    const entry = await recordPayment(disputeId, 4_000, "it-ref-0001", idempotencyKey, "integration-test");
    expect(entry.id).toBeTruthy();
    expect(entry.amountCents).toBe(4_000);

    const accounts = await sql`
      SELECT "accountType", "balanceCents" FROM ledger_accounts WHERE "disputeId" = ${disputeId}
    `;
    const byType = Object.fromEntries(accounts.map(a => [a.accountType, a.balanceCents]));
    // Double-entry: both legs moved by exactly the payment amount.
    expect(byType.paid).toBe(4_000);
    expect(byType.determination).toBe(4_000);

    const entries = await sql`
      SELECT * FROM ledger_entries WHERE "disputeId" = ${disputeId}
    `;
    expect(entries).toHaveLength(1);
    expect(entries[0].entryType).toBe("credit");
    expect(entries[0].referenceType).toBe("payment");
    expect(entries[0].idempotencyKey).toBe(idempotencyKey);

    const disputeRows = await sql`SELECT "paidAmount" FROM disputes WHERE id = ${disputeId}`;
    expect(Number(disputeRows[0].paidAmount)).toBeCloseTo(40.0, 2);

    const events = await sql`
      SELECT * FROM event_log WHERE "aggregateId" = ${disputeId} AND topic = 'idr.payments'
    `;
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("pending");
    expect(events[0].idempotencyKey).toBe(`payment-recorded:${idempotencyKey}`);
  });

  it("replaying the same idempotency key does not double-post ledger or outbox rows", async () => {
    const replay = await recordPayment(disputeId, 4_000, "it-ref-0001", idempotencyKey, "integration-test");

    const entries = await sql`SELECT id FROM ledger_entries WHERE "disputeId" = ${disputeId}`;
    expect(entries).toHaveLength(1);
    expect(replay.id).toBe(entries[0].id);

    const disputeRows = await sql`SELECT "paidAmount" FROM disputes WHERE id = ${disputeId}`;
    expect(Number(disputeRows[0].paidAmount)).toBeCloseTo(40.0, 2);

    const events = await sql`SELECT id FROM event_log WHERE "aggregateId" = ${disputeId}`;
    expect(events).toHaveLength(1);
  });

  it("rejects payment evidence exceeding the remaining determined amount", async () => {
    // 100.00 determined, 40.00 already paid → 60.00 remaining.
    await expect(
      recordPayment(disputeId, 6_001, "it-ref-over", crypto.randomUUID(), "integration-test")
    ).rejects.toThrow(/exceeds the remaining determined amount/);

    const entries = await sql`SELECT id FROM ledger_entries WHERE "disputeId" = ${disputeId}`;
    expect(entries).toHaveLength(1); // nothing additional posted
  });

  it("dispatches the pending outbox event to delivered", async () => {
    const result = await dispatchOutboxBatch(10);
    expect(result.claimed).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);

    const events = await sql`
      SELECT status, "publishedAt" FROM event_log WHERE "aggregateId" = ${disputeId}
    `;
    expect(events[0].status).toBe("delivered");
    expect(events[0].publishedAt).not.toBeNull();
  });

  it("never re-dispatches an exhausted (dead-lettered) outbox event", async () => {
    const terminalId = crypto.randomUUID();
    await sql`
      INSERT INTO event_log (id, topic, "eventType", "aggregateId", "aggregateType", payload, status, "retryCount", "nextAttemptAt")
      VALUES (${terminalId}, 'idr.payments', 'payment.recorded', ${disputeId}, 'dispute', '{}'::jsonb, 'failed', 8, NULL)
    `;
    const result = await dispatchOutboxBatch(25);
    expect(result.failed).toBe(0);
    const rows = await sql`SELECT status, "retryCount" FROM event_log WHERE id = ${terminalId}`;
    expect(rows[0].status).toBe("failed");
    expect(rows[0].retryCount).toBe(8);
    await sql`DELETE FROM event_log WHERE id = ${terminalId}`;
  });

  it("books balance per dispute: every journal entry debits and credits the same amount", async () => {
    const rows = await sql`
      SELECT e."amountCents",
             da."accountType" AS debit_type,
             ca."accountType" AS credit_type
      FROM ledger_entries e
      JOIN ledger_accounts da ON da.id = e."debitAccountId"
      JOIN ledger_accounts ca ON ca.id = e."creditAccountId"
      WHERE e."disputeId" = ${disputeId}
    `;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.debit_type).not.toBe(row.credit_type);
      expect(row.amountCents).toBeGreaterThan(0);
    }
  });
});
