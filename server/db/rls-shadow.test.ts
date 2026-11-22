/**
 * server/db/rls-shadow.test.ts — Wave p27 audit-mode probe unit tests
 * (design §10). No database: the transaction handle is a scripted fake, so
 * sampling, role-swap sequencing and diff detection are tested deterministically.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { rlsShadow, withOrgContext, rlsMode, type RlsDb } from "./rls";

type Row = Record<string, unknown>;

/** Scripted tx: call 1 = primary SELECT; then role probe sequence
 *  (current_setting, set_config hp_app, shadow SELECT, set_config restore). */
function fakeTx(opts: { primary: Row[]; shadow: Row[] }) {
  const calls: string[] = [];
  let call = 0;
  const tx = {
    execute: vi.fn(async (_stmt: unknown): Promise<Row[]> => {
      call += 1;
      if (call === 1) { calls.push("primary"); return opts.primary; }
      if (call === 2) { calls.push("read-role"); return [{ r: "none" }]; }
      if (call === 3) { calls.push("set-role"); return []; }
      if (call === 4) { calls.push("shadow"); return opts.shadow; }
      calls.push("restore-role");
      return [];
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

  it("audit mode at 100%: probes as hp_app with role restore; equal results = silent", async () => {
    process.env.RLS_ENABLED = "audit";
    process.env.RLS_AUDIT_SAMPLE_PCT = "100";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { tx, calls } = fakeTx({ primary: [{ id: "1" }, { id: "2" }], shadow: [{ id: "2" }, { id: "1" }] });
    const rows = await rlsShadow(tx, "t", sql`SELECT 1`);
    expect(rows.length).toBe(2); // primary result returned
    expect(calls).toEqual(["primary", "read-role", "set-role", "shadow", "restore-role"]);
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

  it("probe failure never fails the read", async () => {
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
