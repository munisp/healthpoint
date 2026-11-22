/**
 * server/db/rls-shadow.test.ts — Wave p27 audit-mode probe unit tests
 * (design §10). No database: the transaction handle is a scripted fake, so
 * sampling, role-swap sequencing and diff detection are tested deterministically.
 *
 * Fix-wave additions:
 *  - F-3a: a FAILING shadow statement must not poison the caller's
 *    transaction — the probe runs inside a nested transaction (driver-native
 *    savepoint), the fake emulates Postgres' 25P02 ("commands ignored until
 *    end of transaction block") after an error, and the tests assert the tx
 *    stays usable.
 *  - F-4/F-5: rlsGuard per-item failure isolation for the batch workers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { rlsShadow, withOrgContext, rlsMode, rlsGuard, type RlsDb } from "./rls";

type Row = Record<string, unknown>;

/** Extract printable SQL text from a drizzle SQL object (params appear as
 *  gaps — good enough to classify SAVEPOINT/ROLLBACK/RELEASE/set_config). */
function textOf(stmt: unknown): string {
  const chunks = (stmt as { queryChunks?: Array<{ value?: unknown }> }).queryChunks ?? [];
  return chunks.map(c => Array.isArray(c.value) ? c.value.join("") : String(c.value ?? "")).join("");
}

/** Scripted tx for the probe sequence (driver-native nested transaction):
 *  primary → read-role → [nested tx: savepoint] set-role(hp_app) → shadow →
 *  restore-role [release]  |  on failure: [rollback-to] and the poison
 *  clears, emulating real ROLLBACK TO SAVEPOINT semantics (which also revert
 *  the tx-local role switch). Emulates 25P02: while poisoned, statements are
 *  rejected. */
function fakeTx(opts: { primary: Row[]; shadow?: Row[]; failShadow?: boolean }) {
  const calls: string[] = [];
  let poisoned = false;
  let probeStmt: unknown = null; // the statement object: 1st execute = primary, 2nd = shadow
  let auxIdx = 0;
  const aux = ["read-role", "set-role", "restore-role"];
  const tx = {
    execute: vi.fn(async (stmt: unknown): Promise<Row[]> => {
      let label: string;
      if (probeStmt === null) { probeStmt = stmt; label = "primary"; }
      else if (stmt === probeStmt) label = "shadow";
      else if (auxIdx < aux.length) label = aux[auxIdx++];
      else label = "extra";
      if (poisoned) {
        throw new Error("25P02: current transaction is aborted, commands ignored until end of transaction block");
      }
      calls.push(label);
      switch (label) {
        case "primary": return opts.primary;
        case "read-role": return [{ r: "none" }];
        case "shadow":
          if (opts.failShadow) { poisoned = true; throw new Error("42501: permission denied for table t"); }
          return opts.shadow ?? opts.primary;
        default: return [];
      }
    }),
    transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>): Promise<unknown> => {
      calls.push("savepoint");
      try {
        const r = await cb(tx);
        calls.push("release");
        return r;
      } catch (err) {
        calls.push("rollback-to");
        poisoned = false; // ROLLBACK TO SAVEPOINT recovers the tx (and role)
        throw err;
      }
    }),
  } as unknown as RlsDb;
  return { tx, calls };
}

describe("rlsShadow (audit-mode probe, injected executor)", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved.mode = process.env.RLS_ENABLED;
    saved.pct = process.env.RLS_AUDIT_SAMPLE_PCT;
  });
  afterEach(() => {
    if (saved.mode === undefined) delete process.env.RLS_ENABLED; else process.env.RLS_ENABLED = saved.mode;
    if (saved.pct === undefined) delete process.env.RLS_AUDIT_SAMPLE_PCT; else process.env.RLS_AUDIT_SAMPLE_PCT = saved.pct;
    vi.restoreAllMocks();
  });

  it("off mode: runs the statement once, never probes", async () => {
    process.env.RLS_ENABLED = "off";
    process.env.RLS_AUDIT_SAMPLE_PCT = "100";
    const { tx } = fakeTx({ primary: [{ id: "1" }], shadow: [] });
    const rows = await rlsShadow(tx, "t", sql`SELECT 1`);
    expect(rows).toEqual([{ id: "1" }]);
    expect((tx.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("audit mode at 0% sampling: no probe", async () => {
    process.env.RLS_ENABLED = "audit";
    process.env.RLS_AUDIT_SAMPLE_PCT = "0";
    const { tx } = fakeTx({ primary: [{ id: "1" }], shadow: [{ id: "1" }] });
    await rlsShadow(tx, "t", sql`SELECT 1`);
    expect((tx.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("audit mode at 100%: probes as hp_app inside a savepoint with role restore; equal results = silent", async () => {
    process.env.RLS_ENABLED = "audit";
    process.env.RLS_AUDIT_SAMPLE_PCT = "100";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { tx, calls } = fakeTx({ primary: [{ id: "1" }, { id: "2" }], shadow: [{ id: "2" }, { id: "1" }] });
    const rows = await rlsShadow(tx, "t", sql`SELECT 1`);
    expect(rows.length).toBe(2); // primary result returned
    expect(calls).toEqual(["primary", "read-role", "savepoint", "set-role", "shadow", "restore-role", "release"]);
    expect(warn.mock.calls.filter(c => String(c[0]).includes("shadow diff")).length).toBe(0);
  });

  it("audit mode at 100%: a diff is warn-logged (audit_log write attempted, failure swallowed)", async () => {
    process.env.RLS_ENABLED = "audit";
    process.env.RLS_AUDIT_SAMPLE_PCT = "100";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { tx } = fakeTx({ primary: [{ id: "1" }, { id: "leak" }], shadow: [{ id: "1" }] });
    const rows = await rlsShadow(tx, "t.diff", sql`SELECT 1`);
    expect(rows.length).toBe(2); // caller still gets the primary rows
    const diffLogs = warn.mock.calls.filter(c => String(c[0]).includes("shadow diff"));
    expect(diffLogs.length).toBe(1);
    expect(String(diffLogs[0][1])).toContain("leak");
  });

  it("probe failure at the role read never fails the read", async () => {
    process.env.RLS_ENABLED = "audit";
    process.env.RLS_AUDIT_SAMPLE_PCT = "100";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let call = 0;
    const tx = {
      execute: vi.fn(async (): Promise<Row[]> => {
        call += 1;
        if (call === 1) return [{ id: "1" }];
        throw new Error("boom");
      }),
    } as unknown as RlsDb;
    const rows = await rlsShadow(tx, "t.err", sql`SELECT 1`);
    expect(rows).toEqual([{ id: "1" }]);
  });

  it("F-3a: a failing shadow statement rolls back the nested transaction and leaves the outer tx usable", async () => {
    process.env.RLS_ENABLED = "audit";
    process.env.RLS_AUDIT_SAMPLE_PCT = "100";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { tx, calls } = fakeTx({ primary: [{ id: "1" }], failShadow: true });
    const rows = await rlsShadow(tx, "t.fail", sql`SELECT 1`);
    // Caller still gets the primary rows; failure is logged, not thrown.
    expect(rows).toEqual([{ id: "1" }]);
    expect(warn.mock.calls.filter(c => String(c[0]).includes("shadow probe failed")).length).toBe(1);
    // Recovery: the nested tx rolls back to its savepoint (which also reverts
    // the tx-local role switch — no explicit restore needed on this path).
    expect(calls).toEqual(["primary", "read-role", "savepoint", "set-role", "shadow", "rollback-to"]);
    // The caller's transaction remains usable for subsequent statements.
    await expect(tx.execute(sql`SELECT 1`)).resolves.toBeTruthy();
  });

  it("rlsMode parsing: only audit/enforce are honored", () => {
    process.env.RLS_ENABLED = "audit"; expect(rlsMode()).toBe("audit");
    process.env.RLS_ENABLED = "enforce"; expect(rlsMode()).toBe("enforce");
    process.env.RLS_ENABLED = "yes"; expect(rlsMode()).toBe("off");
    delete process.env.RLS_ENABLED; expect(rlsMode()).toBe("off");
  });

  it("org id format validation rejects CSV-breaking / injection shapes before any DB touch", async () => {
    await expect(withOrgContext({ userId: "u", orgIds: ["a,b"] }, async () => 1)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(withOrgContext({ userId: "u", orgIds: ["x'; DROP TABLE users;--"] }, async () => 1)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(withOrgContext({ userId: "u", orgIds: [""] }, async () => 1)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(withOrgContext({ userId: "u", orgIds: ["x".repeat(65)] }, async () => 1)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

/** Tx fake for rlsGuard tests: a nested-transaction savepoint emulation with
 *  25P02 poisoning — while poisoned, statements are rejected until the
 *  nested transaction's rollback clears the poison. */
function fakeGuardTx(opts: { failWorkLabel?: string }) {
  let poisoned = false;
  let failArmed = Boolean(opts.failWorkLabel); // the injected failure fires once
  const calls: string[] = [];
  const tx: { execute: unknown; transaction: unknown } = {
    execute: vi.fn(async (stmt: unknown): Promise<Row[]> => {
      const t = textOf(stmt).toUpperCase();
      const label = t.startsWith("SAVEPOINT") || t.startsWith("ROLLBACK") || t.startsWith("RELEASE") ? "admin" : "work";
      if (poisoned) {
        throw new Error("25P02: current transaction is aborted, commands ignored until end of transaction block");
      }
      calls.push(label);
      if (label === "work" && failArmed) {
        failArmed = false;
        poisoned = true;
        throw new Error(`42P01: relation "${opts.failWorkLabel}" does not exist`);
      }
      return [];
    }),
    transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>): Promise<unknown> => {
      calls.push("savepoint");
      try {
        const r = await cb(tx);
        calls.push("release");
        return r;
      } catch (err) {
        calls.push("rollback-to");
        poisoned = false;
        throw err;
      }
    }),
  };
  return { tx: tx as unknown as RlsDb, calls };
}

describe("rlsGuard (F-4/F-5 per-item failure isolation)", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { saved.mode = process.env.RLS_ENABLED; });
  afterEach(() => {
    if (saved.mode === undefined) delete process.env.RLS_ENABLED; else process.env.RLS_ENABLED = saved.mode;
    vi.restoreAllMocks();
  });

  it("audit/enforce mode: a failing item rolls back to its savepoint, rethrows, and the tx stays usable", async () => {
    process.env.RLS_ENABLED = "audit";
    const { tx, calls } = fakeGuardTx({ failWorkLabel: "broken" });
    await expect(rlsGuard(tx, async (gtx) => { await gtx.execute(sql`DELETE FROM broken`); })).rejects.toThrow("42P01");
    expect(calls).toEqual(["savepoint", "work", "rollback-to"]);
    // Subsequent work on the same tx succeeds (siblings not poisoned):
    await expect(tx.execute(sql`DELETE FROM fine`)).resolves.toEqual([]);
  });

  it("audit/enforce mode: success path wraps fn in a nested transaction and returns its value", async () => {
    process.env.RLS_ENABLED = "audit";
    const { tx, calls } = fakeGuardTx({});
    const out = await rlsGuard(tx, async () => 7);
    expect(out).toBe(7);
    expect(calls).toEqual(["savepoint", "release"]);
  });

  it("off mode: passthrough — fn runs directly on the handle, errors propagate unguarded", async () => {
    process.env.RLS_ENABLED = "off";
    const { tx, calls } = fakeGuardTx({ failWorkLabel: "broken" });
    await expect(rlsGuard(tx, async (gtx) => { await gtx.execute(sql`DELETE FROM broken`); })).rejects.toThrow("42P01");
    // No savepoint wrapper in off mode (statements are already independent):
    expect(calls).toEqual(["work"]);
  });

  it("per-item guards: one failing item does not poison siblings and failure is counted honestly", async () => {
    process.env.RLS_ENABLED = "audit";
    // Batch loop shaped like the workers: 3 items, item 2's work fails.
    let workN = 0;
    let poisoned = false;
    const committed: number[] = [];
    const tx = {
      execute: vi.fn(async (): Promise<Row[]> => {
        if (poisoned) throw new Error("25P02");
        workN += 1;
        if (workN === 2) { poisoned = true; throw new Error("23505: duplicate key"); }
        committed.push(workN);
        return [];
      }),
      transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>): Promise<unknown> => {
        try {
          return await cb(tx);
        } catch (err) {
          poisoned = false; // rollback-to-savepoint
          throw err;
        }
      }),
    } as unknown as RlsDb;
    let done = 0;
    let failed = 0;
    for (const item of [1, 2, 3]) {
      try {
        await rlsGuard(tx, async (gtx) => { await gtx.execute(sql`DELETE item ${item}`); });
        done += 1;
      } catch {
        failed += 1;
      }
    }
    expect(done).toBe(2);
    expect(failed).toBe(1);
    expect(committed).toEqual([1, 3]);
  });
});
