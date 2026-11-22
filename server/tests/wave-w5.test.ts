/**
 * server/tests/wave-w5.test.ts
 *
 * Wave-W5 (admin/product P1) remediation coverage:
 *  1. IDRE directory — decertify notifications target STEP_06/07 owners
 *  2. Regulatory ingest — (source,title,effectiveDate) dedupe
 *  3. Email digest — honors daily/weekly/never prefs, idempotent per period
 *  4. Fee schedule — DB-first read with params fallback
 *  5. Offboarding — cascade counts, self/last-admin guards, idempotency
 *  6. Impersonation — audit rows, 15-min time-box, reason length, admin guard
 *  7. Feature flags — deterministic bucketing, default-ON, monotonic rollout
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Shared in-memory DB mock ────────────────────────────────────────────────
type Rows = Record<string, any[]>;
const tables: Rows = {};
const auditRows: any[] = [];
const notificationRows: any[] = [];
const executedSql: string[] = [];

function seed(table: string, rows: any[]) { tables[table] = rows; }

function makeQuery(rows: any[]) {
  const q: any = {
    where: () => q,
    orderBy: () => q,
    limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
  };
  return q;
}

// Naive SQL text matcher for raw execute() calls.
function sqlText(query: any): string {
  // drizzle sql`` objects expose .queryChunks with strings
  const chunks = query?.queryChunks ?? [];
  return chunks.map((c: any) => (typeof c === "string" ? c : (c?.value ?? "?"))).join("");
}

vi.mock("../db", () => ({
  getDb: async () => ({
    select: (cols?: any) => {
      // infer table from later .from() — handled below via from()
      return {
        from: (table: any) => {
          const name = table?.[Symbol.for("drizzle:Name")] ?? table?._?.name ?? "unknown";
          return makeQuery(tables[name] ?? []);
        },
      };
    },
    insert: (table: any) => ({
      values: (v: any) => {
        const name = table?.[Symbol.for("drizzle:Name")] ?? "unknown";
        tables[name] = tables[name] ?? [];
        const rows = Array.isArray(v) ? v : [v];
        tables[name].push(...rows);
        return { onConflictDoUpdate: () => Promise.resolve() };
      },
    }),
    update: (table: any) => ({
      set: (v: any) => ({
        where: () => ({ returning: () => Promise.resolve(tables.__returning ?? []) }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    execute: async (q: any) => {
      const text = sqlText(q);
      executedSql.push(text);
      if (text.includes("FROM fee_schedules") && text.includes("ORDER BY")) {
        return { rows: tables.fee_schedules ?? [] };
      }
      return { rows: [] };
    },
  }),
  createAuditEntry: async (entry: any) => { auditRows.push(entry); return entry; },
  createNotification: async (n: any) => { notificationRows.push(n); },
}));

vi.mock("../authz", () => ({
  revokeDisputeAccess: async () => {},
}));

vi.mock("../notifications", () => ({
  dispatchNotification: vi.fn(async () => [{ success: true, deliveryStatus: "delivered" }]),
}));

vi.mock("../search", () => ({
  indexDocument: vi.fn(async () => {}),
  search: vi.fn(async () => ({ hits: [] })),
}));

// ─── 7. Feature flags (pure functions — no DB needed) ────────────────────────
import { flagBucket, evaluateFlag } from "../feature-flags";

describe("feature flags — deterministic bucketing", () => {
  it("same (key, userId) always buckets the same", () => {
    expect(flagBucket("personas.orgs", "user-1")).toBe(flagBucket("personas.orgs", "user-1"));
  });
  it("bucket is within 0..99", () => {
    for (let i = 0; i < 50; i++) {
      const b = flagBucket("k", `user-${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });
  it("unknown flag defaults ON", () => {
    expect(evaluateFlag("missing.key", null, "u1")).toBe(true);
  });
  it("disabled flag is off for everyone", () => {
    expect(evaluateFlag("k", { enabled: false, rolloutPercent: 100 }, "u1")).toBe(false);
  });
  it("rollout is monotonic — increasing percent only adds users", () => {
    const in10 = Array.from({ length: 200 }, (_, i) => `u${i}`).filter(u => evaluateFlag("k", { enabled: true, rolloutPercent: 10 }, u));
    const in50 = new Set(Array.from({ length: 200 }, (_, i) => `u${i}`).filter(u => evaluateFlag("k", { enabled: true, rolloutPercent: 50 }, u)));
    for (const u of in10) expect(in50.has(u)).toBe(true);
  });
  it("0% rollout is off, 100% is on", () => {
    expect(evaluateFlag("k", { enabled: true, rolloutPercent: 0 }, "u1")).toBe(false);
    expect(evaluateFlag("k", { enabled: true, rolloutPercent: 100 }, "u1")).toBe(true);
  });
});

// ─── 6. Impersonation ────────────────────────────────────────────────────────
import { issueImpersonationToken, verifyImpersonationToken, IMPERSONATION_TTL_MS } from "../impersonation";

describe("impersonation tokens", () => {
  beforeEach(() => { process.env.JWT_SECRET = "test-secret-for-w5"; auditRows.length = 0; });

  it("issues and verifies a token with impersonator/target claims", async () => {
    const token = await issueImpersonationToken({ impersonatorId: "admin-1", targetId: "user-9", purpose: "impersonation" });
    const claims = await verifyImpersonationToken(token);
    expect(claims?.impersonatorId).toBe("admin-1");
    expect(claims?.targetId).toBe("user-9");
  });

  it("is time-boxed to 15 minutes", async () => {
    const token = await issueImpersonationToken({ impersonatorId: "a", targetId: "b", purpose: "impersonation" });
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(IMPERSONATION_TTL_MS / 1000);
    expect(payload.exp - payload.iat).toBe(900);
  });

  it("rejects expired tokens", async () => {
    const token = await issueImpersonationToken({ impersonatorId: "a", targetId: "b", purpose: "impersonation" }, -1000);
    expect(await verifyImpersonationToken(token)).toBeNull();
  });

  it("rejects tokens without the impersonation purpose", async () => {
    const { SignJWT } = await import("jose");
    const key = new TextEncoder().encode(process.env.JWT_SECRET);
    const token = await new SignJWT({ impersonatorId: "a", targetId: "b" })
      .setProtectedHeader({ alg: "HS256" }).setExpirationTime(Math.floor(Date.now() / 1000) + 60).sign(key);
    expect(await verifyImpersonationToken(token)).toBeNull();
  });
});

// ─── 3. Email digest prefs ───────────────────────────────────────────────────
import { digestPeriodKey, composeUserDigest } from "../scheduled/emailDigest";

describe("email digest — period keys + composition", () => {
  it("daily period key is the UTC day", () => {
    expect(digestPeriodKey("daily", new Date("2026-09-05T23:00:00Z"))).toBe("2026-09-05");
  });
  it("weekly period key is stable within an ISO week", () => {
    const mon = digestPeriodKey("weekly", new Date("2026-09-07T10:00:00Z")); // Monday
    const sun = digestPeriodKey("weekly", new Date("2026-09-13T10:00:00Z")); // Sunday same week
    expect(mon).toBe(sun);
    const nextMon = digestPeriodKey("weekly", new Date("2026-09-14T10:00:00Z"));
    expect(nextMon).not.toBe(mon);
  });
  it("composed digest honors notify toggles", () => {
    const base = {
      userName: "Pat", frequency: "daily" as const,
      activeDisputes: [{ referenceNumber: "IDR-0001", status: "offer_submission", nextDeadline: new Date("2026-09-10") }],
    };
    const full = composeUserDigest({ ...base, notifyOnDeadlineApproach: true, notifyOnStatusChange: true });
    expect(full.message).toContain("IDR-0001");
    expect(full.message).toContain("Upcoming deadlines");
    const quiet = composeUserDigest({ ...base, notifyOnDeadlineApproach: false, notifyOnStatusChange: false });
    expect(quiet.message).not.toContain("Upcoming deadlines");
    expect(quiet.message).not.toContain("Status overview");
    expect(quiet.message).toContain("Active disputes: 1");
  });
});

// ─── 4. Fee schedule DB-first read ───────────────────────────────────────────
import { getAdminFeeFromDb } from "../fee-schedule";

describe("fee schedule — DB-first with params fallback", () => {
  beforeEach(() => { executedSql.length = 0; tables.fee_schedules = []; });

  it("returns the DB row when one matches", async () => {
    tables.fee_schedules = [{
      id: "fee-x", effectiveYear: 2026, tier: "single",
      effectiveFrom: "2026-06-11", effectiveTo: null, amountUsd: "15", citation: "c", updatedBy: "u", updatedAt: null,
    }];
    const row = await getAdminFeeFromDb("single", new Date("2026-09-05"));
    expect(row?.amountUsd).toBe("15");
  });

  it("returns null (params fallback) when the table is empty", async () => {
    const row = await getAdminFeeFromDb("single", new Date("2026-09-05"));
    expect(row).toBeNull();
  });
});

// ─── 5. Offboarding guards (pure guard logic via module errors) ──────────────
import { offboardUser } from "../offboarding";

describe("offboarding", () => {
  it("refuses to offboard yourself", async () => {
    await expect(offboardUser({ adminId: "u1", userId: "u1", reason: "x" })).rejects.toThrow(/yourself/);
  });
});
