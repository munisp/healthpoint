/**
 * Postgres-backed store test — EXECUTED against a live PostgreSQL 16.2
 * (pgserver embedded instance, TCP-forwarded unix socket). Applies the real
 * PostgresSubmissionStore (verbatim from server/idr/submission-automation/
 * store.ts) against tables created by migration 0029.
 *
 * Requires DATABASE_URL to point at a database with migration 0029 applied;
 * skips when unset (CI-safe).
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  PostgresSubmissionStore,
  DuplicateSubmissionError,
  SubmissionNotFoundError,
  GENESIS_HASH,
} from "./store";
import { InvalidTransitionError } from "./submission-fsm";

const NOW = new Date("2026-09-05T12:00:00.000Z");
const ATTEST = { actorId: "user-42", attestedAt: "2026-09-05T12:00:00.000Z" };

const RUN = Date.now().toString(36);
let n = 0;
function ids() {
  n++;
  return { tenantId: "T-PG", disputeId: `D-PG-${RUN}-${n}` };
}

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("PostgresSubmissionStore against live PG 16.2", () => {
  beforeAll(async () => {
    const { getDb } = await import("../../db");
    const db = await getDb();
    expect(db, "DATABASE_URL must point at the live scratch DB").toBeTruthy();
  });

  it("creates a DRAFT submission at version 1 with genesis-chained event in Postgres", async () => {
    const store = new PostgresSubmissionStore();
    const { tenantId, disputeId } = ids();
    const s = await store.createSubmission({ tenantId, disputeId, now: NOW });
    expect(s.state).toBe("DRAFT");
    expect(s.version).toBe(1);
    const log = await store.getEventLog(tenantId, disputeId);
    expect(log).toHaveLength(1);
    expect(log[0].prevEventHash).toBe(GENESIS_HASH);
  });

  it("rejects a second ACTIVE submission with DuplicateSubmissionError", async () => {
    const store = new PostgresSubmissionStore();
    const { tenantId, disputeId } = ids();
    const first = await store.createSubmission({ tenantId, disputeId });
    await expect(store.createSubmission({ tenantId, disputeId })).rejects.toMatchObject({
      name: "DuplicateSubmissionError",
      existingSubmissionId: first.id,
    });
    await expect(store.createSubmission({ tenantId, disputeId })).rejects.toBeInstanceOf(DuplicateSubmissionError);
  });

  it("replayed createSubmission idempotencyKey returns the same submission", async () => {
    const store = new PostgresSubmissionStore();
    const { tenantId, disputeId } = ids();
    const a = await store.createSubmission({ tenantId, disputeId, idempotencyKey: "K-PG-1" });
    const b = await store.createSubmission({ tenantId, disputeId, idempotencyKey: "K-PG-1" });
    expect(b.id).toBe(a.id);
    expect(b.version).toBe(a.version);
  });

  it("transitions with CAS version bumps and appends chained events", async () => {
    const store = new PostgresSubmissionStore();
    const { tenantId, disputeId } = ids();
    await store.createSubmission({ tenantId, disputeId, now: NOW });
    const s1 = await store.transitionSubmission(tenantId, disputeId, { to: "PACKAGE_READY", now: NOW });
    expect(s1.version).toBe(2);
    const s2 = await store.transitionSubmission(tenantId, disputeId, { to: "SUBMITTED", attestation: ATTEST, now: NOW });
    expect(s2.version).toBe(3);
    const log = await store.getEventLog(tenantId, disputeId);
    expect(log.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(log[2].prevEventHash).toBe(log[1].eventHash);
    const v = await store.verifyEventChain(tenantId, disputeId);
    expect(v).toEqual({ ok: true, eventCount: 3 });
  });

  it("rejects invalid transitions fail-closed in Postgres", async () => {
    const store = new PostgresSubmissionStore();
    const { tenantId, disputeId } = ids();
    await store.createSubmission({ tenantId, disputeId });
    await expect(store.transitionSubmission(tenantId, disputeId, { to: "CLOSED" })).rejects.toBeInstanceOf(
      InvalidTransitionError
    );
  });

  it("replayed transition idempotencyKey does not double-apply", async () => {
    const store = new PostgresSubmissionStore();
    const { tenantId, disputeId } = ids();
    await store.createSubmission({ tenantId, disputeId });
    const a = await store.transitionSubmission(tenantId, disputeId, { to: "PACKAGE_READY", idempotencyKey: "T-PG-K" });
    const b = await store.transitionSubmission(tenantId, disputeId, { to: "PACKAGE_READY", idempotencyKey: "T-PG-K" });
    expect(b.version).toBe(a.version);
    const log = await store.getEventLog(tenantId, disputeId);
    expect(log).toHaveLength(2);
  });

  it("throws SubmissionNotFoundError for unknown dispute", async () => {
    const store = new PostgresSubmissionStore();
    await expect(store.transitionSubmission("T-PG", "D-PG-NOPE", { to: "PACKAGE_READY" })).rejects.toBeInstanceOf(
      SubmissionNotFoundError
    );
  });

  it("allows a new submission after WITHDRAWN (partial unique index semantics)", async () => {
    const store = new PostgresSubmissionStore();
    const { tenantId, disputeId } = ids();
    await store.createSubmission({ tenantId, disputeId });
    await store.transitionSubmission(tenantId, disputeId, { to: "PACKAGE_READY" });
    await store.transitionSubmission(tenantId, disputeId, { to: "WITHDRAWN" });
    const second = await store.createSubmission({ tenantId, disputeId });
    expect(second.state).toBe("DRAFT");
  });
});
