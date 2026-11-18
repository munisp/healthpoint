/**
 * Postgres-backed portal RPA store/queue tests (audit wave A) — require a live
 * DATABASE_URL with migration 0055 applied; skip when unset (CI-safe).
 *
 * Covers: restart-persistence (write → new store instance → read back),
 * checkpoint claim/resolve + expiry sweep, CAS version conflict, owner
 * persistence fail-closed lookup, and settlement nonce replay rejection
 * (duplicate-accept window semantics: same transmission rejected, re-signed
 * retry accepted).
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  PostgresRunStore,
  PostgresCheckpointQueue,
  RunVersionConflictError,
  hashResumeToken,
} from "./store";
import {
  deriveSettlementCallbackNonce,
  claimSettlementCallbackNonce,
  purgeExpiredSettlementCallbackNonces,
} from "../../settlement-auth";
import {
  recordRunOwner,
  getRunOwner,
  recordCheckpointOwner,
  getCheckpointOwner,
  resetRunOwnersForTests,
} from "./run-owners";
import { setPortalRpaStoresForTests } from "./store";
import type { RunRecord } from "./driver";
import type { RunResult } from "./driver";

const RUN = Date.now().toString(36);
let n = 0;
function nextId(p: string) {
  n++;
  return `${p}-${RUN}-${n}`;
}

function makeRecord(over: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: nextId("run"),
    submissionId: nextId("sub"),
    mode: "DRY_RUN",
    status: "CHECKPOINT_REQUIRED",
    attestation: { actorId: "user-a", attestedAt: "2026-09-05T00:00:00.000Z" },
    filledFields: [],
    evidence: [],
    timeline: [],
    resumeToken: `tok-${Math.random().toString(36).slice(2)}`,
    parkedStorageState: "{\"cookies\":[]}",
    nextStepIndex: 3,
    startedAt: "2026-09-05T00:00:00.000Z",
    ...over,
  } as RunRecord;
}

function makeParkedRun(record: RunRecord, kind: "MFA" | "CAPTCHA" = "MFA"): RunResult {
  return {
    ...record,
    checkpoint: { kind, stepId: "step-login", detail: "test interrupt" },
  } as RunResult;
}

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("portal-rpa Postgres persistence (live PG)", () => {
  beforeAll(async () => {
    const { getDb } = await import("../../db");
    const db = await getDb();
    expect(db, "DATABASE_URL must point at the migrated scratch DB").toBeTruthy();
  });

  it("persists runs across store instances (restart simulation), hashed token lookup", async () => {
    const rec = makeRecord();
    const storeA = new PostgresRunStore();
    await storeA.put(rec);
    // simulate process restart: brand-new store instance, no shared memory
    const storeB = new PostgresRunStore();
    const back = await storeB.get(rec.runId);
    expect(back?.submissionId).toBe(rec.submissionId);
    expect(back?.status).toBe("CHECKPOINT_REQUIRED");
    expect(back?.parkedStorageState).toBe(rec.parkedStorageState);
    expect(back?.nextStepIndex).toBe(3);
    // plaintext token never persisted; lookup by token works via sha256 hash
    const byToken = await storeB.getByResumeToken(rec.resumeToken as string);
    expect(byToken?.runId).toBe(rec.runId);
    expect(byToken?.resumeToken).toBeUndefined();
    const { getDb } = await import("../../db");
    const db = await getDb();
    const { idrPortalRpaRuns } = await import("../../../drizzle/schema-portal-rpa");
    const { eq } = await import("drizzle-orm");
    const rows = await db!.select().from(idrPortalRpaRuns).where(eq(idrPortalRpaRuns.runId, rec.runId));
    expect(JSON.stringify(rows[0].payload)).not.toContain(rec.resumeToken as string);
    expect(rows[0].resumeTokenHash).toBe(hashResumeToken(rec.resumeToken as string));
    await expect(storeB.getBySubmission(rec.submissionId)).resolves.toMatchObject({ runId: rec.runId });
  });

  it("CAS: stale-copy put throws RunVersionConflictError", async () => {
    const rec = makeRecord();
    const store = new PostgresRunStore();
    await store.put(rec); // v1
    const copy = (await store.get(rec.runId))!;
    await store.put({ ...copy, status: "COMPLETED" }); // v1 → v2 ok
    await expect(store.put({ ...copy, status: "FAILED" })).rejects.toBeInstanceOf(RunVersionConflictError);
  });

  it("checkpoint claim/resolve/expiry survive across queue instances", async () => {
    const rec = makeRecord();
    const runStore = new PostgresRunStore();
    await runStore.put(rec);
    const queueA = new PostgresCheckpointQueue();
    const entry = await queueA.enqueue(makeParkedRun(rec));
    expect(entry.checkpointId).toMatch(/^cp-/);
    // restart simulation
    const queueB = new PostgresCheckpointQueue();
    const listed = await queueB.list();
    expect(listed.map((e) => e.checkpointId)).toContain(entry.checkpointId);
    const claimed = await queueB.claim(entry.checkpointId, "user-a");
    expect(claimed.claimedBy).toBe("user-a");
    // second claimer rejected; owner re-claim idempotent
    await expect(queueB.claim(entry.checkpointId, "user-b")).rejects.toThrow(/already claimed/);
    await expect(queueB.claim(entry.checkpointId, "user-a")).resolves.toMatchObject({ claimedBy: "user-a" });
    // MFA resolve without code rejected; with code resolves
    await expect(queueB.resolve(entry.checkpointId, {})).rejects.toThrow(/mfaCode/);
    const resolved = await queueB.resolve(entry.checkpointId, { mfaCode: "123456" });
    expect(resolved.resolution).toEqual({ mfaCodeProvided: true, humanCompleted: false });
    // internal capability token carries the hash prefix (no plaintext at rest)
    expect(resolved.resumeToken).toMatch(/^sha256:[0-9a-f]{64}$/);
    await expect(queueB.resolve(entry.checkpointId, { mfaCode: "123456" })).rejects.toThrow(/already resolved/);
  });

  it("sweepExpired resolves expired checkpoints once", async () => {
    const rec = makeRecord();
    await new PostgresRunStore().put(rec);
    const queue = new PostgresCheckpointQueue({ ttlMs: -1000 }); // already expired
    const entry = await queue.enqueue(makeParkedRun(rec, "CAPTCHA"));
    const swept = await new PostgresCheckpointQueue().sweepExpired();
    expect(swept).toBeGreaterThanOrEqual(1);
    // Expired entries are excluded from list() unless includeExpired is set
    // (same contract as the in-memory queue), so ask for both here.
    const after = await queue.list({ includeResolved: true, includeExpired: true });
    expect(after.find((e) => e.checkpointId === entry.checkpointId)?.resolvedAt).toBeTruthy();
    await expect(queue.claim(entry.checkpointId, "user-a")).rejects.toThrow(/expired/);
  });

  it("ownership persists across restart; unknown ids stay fail-closed", async () => {
    resetRunOwnersForTests();
    const rec = makeRecord();
    const runStore = new PostgresRunStore();
    await runStore.put(rec);
    setPortalRpaStoresForTests({ runStore, checkpointQueue: new PostgresCheckpointQueue() });
    recordRunOwner(rec.runId, "user-owner");
    await new Promise((r) => setTimeout(r, 50)); // flush fire-and-forget persist
    resetRunOwnersForTests(); // drop the process-local overlay (restart)
    await expect(getRunOwner(rec.runId)).resolves.toBe("user-owner");
    await expect(getRunOwner("run-never-existed")).resolves.toBeUndefined();
    const queue = new PostgresCheckpointQueue();
    const entry = await queue.enqueue(makeParkedRun(rec));
    recordCheckpointOwner(entry.checkpointId, "user-owner");
    await new Promise((r) => setTimeout(r, 50));
    resetRunOwnersForTests();
    await expect(getCheckpointOwner(entry.checkpointId)).resolves.toBe("user-owner");
  });

  it("settlement nonce: identical transmission rejected as replay, re-signed retry accepted", async () => {
    const { signSettlementCallback } = await import("../../settlement-auth");
    const secret = "s".repeat(40);
    const body = JSON.stringify({ eventId: `evt-${RUN}-${n}`, provider: "mojaloop" });
    const ts = Date.now().toString();
    const sig = signSettlementCallback(secret, ts, body);
    const nonce = deriveSettlementCallbackNonce({ signature: sig, timestamp: ts, rawBody: body });
    expect(await claimSettlementCallbackNonce(nonce)).toBe(true);
    // byte-identical replay → rejected
    expect(await claimSettlementCallbackNonce(nonce)).toBe(false);
    // provider retry with a fresh timestamp/signature → distinct nonce → accepted
    const ts2 = (Date.now() + 1).toString();
    const sig2 = signSettlementCallback(secret, ts2, body);
    const nonce2 = deriveSettlementCallbackNonce({ signature: sig2, timestamp: ts2, rawBody: body });
    expect(nonce2).not.toBe(nonce);
    expect(await claimSettlementCallbackNonce(nonce2)).toBe(true);
    // expiry purge removes the rows
    await purgeExpiredSettlementCallbackNonces(new Date(Date.now() + 25 * 60 * 60 * 1000));
    expect(await claimSettlementCallbackNonce(nonce)).toBe(true);
  });
});
