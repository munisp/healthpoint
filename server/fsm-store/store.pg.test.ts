/**
 * Postgres-backed FSM case store test — EXECUTED against live PostgreSQL 16.2
 * (tables from migration 0030). Uses the verbatim PostgresFsmCaseStore.
 * Requires DATABASE_URL; skips when unset (CI-safe).
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  PostgresFsmCaseStore,
  FsmDuplicateCaseError,
  FsmCaseNotFoundError,
  FSM_GENESIS_HASH,
  type FsmCaseLike,
} from "./store";

interface ToyCase extends FsmCaseLike {
  id: string;
  state: string;
  events: Array<{ type?: string; at: string; from?: string; to?: string; detail?: string }>;
}

const RUN = Date.now().toString(36);
let n = 0;
function mk() {
  n++;
  return { tenantId: "T-FSM", caseType: "toy", caseId: `C-${RUN}-${n}` };
}

function createToy(caseId = "toy"): ToyCase {
  return { id: caseId, state: "OPEN", events: [{ type: "created", at: new Date("2026-09-05T12:00:00Z").toISOString(), to: "OPEN" }] };
}

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("PostgresFsmCaseStore against live PG 16.2", () => {
  beforeAll(async () => {
    const { getDb } = await import("../db");
    expect(await getDb()).toBeTruthy();
  });

  it("creates a case at version 1 with a genesis-chained event", async () => {
    const store = new PostgresFsmCaseStore();
    const { tenantId, caseType, caseId } = mk();
    const c = await store.createCase<ToyCase>({ tenantId, caseType, caseId, create: () => createToy(caseId), now: new Date("2026-09-05T12:00:00Z") });
    expect(c.state).toBe("OPEN");
    expect(c.version).toBe(1);
    const log = await store.getEventLog(tenantId, caseType, caseId);
    expect(log).toHaveLength(1);
    expect(log[0].prevEventHash).toBe(FSM_GENESIS_HASH);
  });

  it("rejects a duplicate (tenantId, caseType, caseId) via the unique index", async () => {
    const store = new PostgresFsmCaseStore();
    const { tenantId, caseType, caseId } = mk();
    await store.createCase<ToyCase>({ tenantId, caseType, caseId, create: () => createToy(caseId) });
    await expect(
      store.createCase<ToyCase>({ tenantId, caseType, caseId, create: () => createToy(caseId) })
    ).rejects.toBeInstanceOf(FsmDuplicateCaseError);
  });

  it("replayed createCase idempotencyKey returns the same case", async () => {
    const store = new PostgresFsmCaseStore();
    const { tenantId, caseType, caseId } = mk();
    const a = await store.createCase<ToyCase>({ tenantId, caseType, caseId, create: () => createToy(caseId), idempotencyKey: `FK-${RUN}` });
    const b = await store.createCase<ToyCase>({ tenantId, caseType, caseId, create: () => createToy(caseId), idempotencyKey: `FK-${RUN}` });
    expect(b.rowId).toBe(a.rowId);
    expect(b.version).toBe(1);
  });

  it("transitions with server-loaded state, CAS bump, and chained events", async () => {
    const store = new PostgresFsmCaseStore();
    const { tenantId, caseType, caseId } = mk();
    await store.createCase<ToyCase>({ tenantId, caseType, caseId, create: () => createToy(caseId) });
    const c2 = await store.transitionCase<ToyCase>(tenantId, caseType, caseId, {
      apply: (cur) => {
        if (cur.state !== "OPEN") throw new Error("guard");
        return { ...cur, state: "IN_PROGRESS", events: [...cur.events, { type: "advance", at: "2026-09-05T13:00:00.000Z", from: "OPEN", to: "IN_PROGRESS" }] };
      },
    });
    expect(c2.version).toBe(2);
    expect(c2.state).toBe("IN_PROGRESS");
    const log = await store.getEventLog(tenantId, caseType, caseId);
    expect(log.map((e) => e.seq)).toEqual([0, 1]);
    expect(log[1].prevEventHash).toBe(log[0].eventHash);
    const v = await store.verifyEventChain(tenantId, caseType, caseId);
    expect(v).toEqual({ ok: true, eventCount: 2 });
  });

  it("guard rejection leaves the persisted case untouched (fail-closed)", async () => {
    const store = new PostgresFsmCaseStore();
    const { tenantId, caseType, caseId } = mk();
    await store.createCase<ToyCase>({ tenantId, caseType, caseId, create: () => createToy(caseId) });
    await expect(
      store.transitionCase<ToyCase>(tenantId, caseType, caseId, {
        apply: () => { throw new Error("invalid transition"); },
      })
    ).rejects.toThrow("invalid transition");
    const after = await store.getCase<ToyCase>(tenantId, caseType, caseId);
    expect(after!.state).toBe("OPEN");
    expect(after!.version).toBe(1);
  });

  it("replayed transition idempotencyKey does not double-apply", async () => {
    const store = new PostgresFsmCaseStore();
    const { tenantId, caseType, caseId } = mk();
    await store.createCase<ToyCase>({ tenantId, caseType, caseId, create: () => createToy(caseId) });
    const apply = (cur: ToyCase): ToyCase => ({ ...cur, state: "IN_PROGRESS", events: [...cur.events, { type: "advance", at: "2026-09-05T13:00:00.000Z", from: "OPEN", to: "IN_PROGRESS" }] });
    const a = await store.transitionCase<ToyCase>(tenantId, caseType, caseId, { apply, idempotencyKey: `FT-${RUN}` });
    const b = await store.transitionCase<ToyCase>(tenantId, caseType, caseId, { apply, idempotencyKey: `FT-${RUN}` });
    expect(b.version).toBe(a.version);
    const log = await store.getEventLog(tenantId, caseType, caseId);
    expect(log).toHaveLength(2);
  });

  it("throws FsmCaseNotFoundError for unknown case", async () => {
    const store = new PostgresFsmCaseStore();
    await expect(
      store.transitionCase<ToyCase>("T-FSM", "toy", "C-NOPE", { apply: (c) => c })
    ).rejects.toBeInstanceOf(FsmCaseNotFoundError);
  });

  it("terminal state sets closedAt", async () => {
    const store = new PostgresFsmCaseStore();
    const { tenantId, caseType, caseId } = mk();
    await store.createCase<ToyCase>({ tenantId, caseType, caseId, create: () => createToy(caseId), terminalStates: ["CLOSED"] });
    const c = await store.transitionCase<ToyCase>(tenantId, caseType, caseId, {
      terminalStates: ["CLOSED"],
      apply: (cur) => ({ ...cur, state: "CLOSED", events: [...cur.events, { type: "close", at: "2026-09-05T14:00:00.000Z", from: "OPEN", to: "CLOSED" }] }),
    });
    expect(c.state).toBe("CLOSED");
    expect(c.closedAt).toBeTruthy();
  });
});
