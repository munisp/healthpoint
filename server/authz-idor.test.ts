/**
 * server/authz-idor.test.ts
 *
 * Regression tests for object-level authorization (IDOR) on disputes and
 * dispute-linked resources. The DB layer is mocked with an in-memory fake;
 * no live infrastructure (PostgreSQL, Redis, Permify, OpenSearch) is required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ── In-memory database state (hoisted so the mock factory can see it) ────────
const state = vi.hoisted(() => ({
  dbAvailable: true,
  disputes: [] as Array<{ id: string; initiatingPartyId: string; createdBy: string }>,
  grants: [] as Array<{ disputeId: string; userId: string; permission: string }>,
  documents: [] as Array<{ id: string; disputeId: string; fileName: string }>,
}));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  const schema = await vi.importActual<typeof import("../drizzle/schema")>("../drizzle/schema");

  const rowsFor = (table: unknown): unknown[] => {
    if (table === schema.disputes) return state.disputes;
    if (table === schema.disputeAccess) return state.grants;
    if (table === schema.disputeDocuments) return state.documents;
    return [];
  };

  // Minimal chainable query builder: every test seeds at most one row per
  // table, so unfiltered rows are the correct result for the queries issued
  // by the authz layer (`.where(eq(id, …)).limit(1)`).
  const makeQuery = (rows: unknown[]): any => ({
    where: () => makeQuery(rows),
    orderBy: () => makeQuery(rows),
    limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    then: (onFulfilled: any, onRejected: any) => Promise.resolve(rows).then(onFulfilled, onRejected),
  });

  const fakeDb = {
    select: () => ({ from: (table: unknown) => makeQuery(rowsFor(table)) }),
  };

  return {
    ...actual,
    getDb: async () => (state.dbAvailable ? (fakeDb as any) : null),
    getDisputeById: async (id: string) => {
      const d = state.disputes.find(x => x.id === id);
      return d ? { ...d, events: [], offers: [], documents: [] } : null;
    },
    getOutcomePrediction: async (disputeId: string) =>
      ({ id: "pred-1", disputeId, winProbability: 50 }) as any,
  };
});

import { assertDisputeAccess, canAccessDispute } from "./authz";
import { appRouter } from "./routers";

// ── Helpers ───────────────────────────────────────────────────────────────────
const OWNER = "user-owner";
const STRANGER = "user-stranger";
const REVIEWER = "user-reviewer";
const DISPUTE_ID = "dispute-1";

function seedDispute(ownerId = OWNER) {
  state.disputes = [{ id: DISPUTE_ID, initiatingPartyId: ownerId, createdBy: ownerId }];
}

function makeCaller(user: { id: string; role: "user" | "admin" }) {
  return appRouter.createCaller({
    user: { ...user, name: "Test User", email: `${user.id}@example.com` },
    req: { headers: {} },
    res: { clearCookie: () => undefined },
  } as any);
}

async function expectForbidden(p: Promise<unknown>) {
  await expect(p).rejects.toMatchObject({ code: "FORBIDDEN" });
}

beforeEach(() => {
  state.dbAvailable = true;
  state.disputes = [];
  state.grants = [];
  state.documents = [];
});

// ── Part 1: authz layer unit tests ───────────────────────────────────────────
describe("authz dispute access control", () => {
  it("allows the owner (initiating party) to read their own dispute", async () => {
    seedDispute();
    await expect(assertDisputeAccess(OWNER, "user", DISPUTE_ID, "read")).resolves.toBeUndefined();
  });

  it("denies an unrelated authenticated user with FORBIDDEN", async () => {
    seedDispute();
    await expect(assertDisputeAccess(STRANGER, "user", DISPUTE_ID, "read"))
      .rejects.toBeInstanceOf(TRPCError);
    await expect(assertDisputeAccess(STRANGER, "user", DISPUTE_ID, "read"))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows a reviewer with an explicit dispute_access grant", async () => {
    seedDispute();
    state.grants = [{ disputeId: DISPUTE_ID, userId: REVIEWER, permission: "write" }];
    await expect(assertDisputeAccess(REVIEWER, "user", DISPUTE_ID, "read")).resolves.toBeUndefined();
    await expect(assertDisputeAccess(REVIEWER, "user", DISPUTE_ID, "write")).resolves.toBeUndefined();
  });

  it("denies write when the grant is read-only", async () => {
    seedDispute();
    state.grants = [{ disputeId: DISPUTE_ID, userId: REVIEWER, permission: "read" }];
    await expect(assertDisputeAccess(REVIEWER, "user", DISPUTE_ID, "write"))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows admins regardless of ownership", async () => {
    seedDispute();
    await expect(assertDisputeAccess(STRANGER, "admin", DISPUTE_ID, "admin")).resolves.toBeUndefined();
  });

  it("fails closed when the dispute does not exist", async () => {
    expect(await canAccessDispute(OWNER, "user", "missing-dispute", "read")).toBe(false);
  });

  it("fails closed when the database is unavailable", async () => {
    state.dbAvailable = false;
    expect(await canAccessDispute(OWNER, "user", DISPUTE_ID, "read")).toBe(false);
    await expect(assertDisputeAccess(OWNER, "user", DISPUTE_ID, "read"))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ── Part 2: tRPC router object-level authorization (IDOR regression) ─────────
describe("disputes.getById object-level authorization", () => {
  it("owner can read their own dispute", async () => {
    seedDispute();
    const result = await makeCaller({ id: OWNER, role: "user" }).disputes.getById({ id: DISPUTE_ID });
    expect(result).toMatchObject({ id: DISPUTE_ID, initiatingPartyId: OWNER });
  });

  it("another authenticated user gets FORBIDDEN (IDOR regression)", async () => {
    seedDispute();
    await expectForbidden(makeCaller({ id: STRANGER, role: "user" }).disputes.getById({ id: DISPUTE_ID }));
  });

  it("an org reviewer with an explicit grant can read", async () => {
    seedDispute();
    state.grants = [{ disputeId: DISPUTE_ID, userId: REVIEWER, permission: "read" }];
    const result = await makeCaller({ id: REVIEWER, role: "user" }).disputes.getById({ id: DISPUTE_ID });
    expect(result).toMatchObject({ id: DISPUTE_ID });
  });
});

describe("documents.list object-level authorization", () => {
  it("owner can list documents on their own dispute", async () => {
    seedDispute();
    state.documents = [{ id: "doc-1", disputeId: DISPUTE_ID, fileName: "eob.pdf" }];
    const result = await makeCaller({ id: OWNER, role: "user" }).documents.list({ disputeId: DISPUTE_ID });
    expect(result).toEqual([{ id: "doc-1", disputeId: DISPUTE_ID, fileName: "eob.pdf" }]);
  });

  it("another authenticated user gets FORBIDDEN (IDOR regression)", async () => {
    seedDispute();
    state.documents = [{ id: "doc-1", disputeId: DISPUTE_ID, fileName: "eob.pdf" }];
    await expectForbidden(makeCaller({ id: STRANGER, role: "user" }).documents.list({ disputeId: DISPUTE_ID }));
  });

  it("a reviewer with a grant can list documents", async () => {
    seedDispute();
    state.grants = [{ disputeId: DISPUTE_ID, userId: REVIEWER, permission: "read" }];
    state.documents = [{ id: "doc-1", disputeId: DISPUTE_ID, fileName: "eob.pdf" }];
    const result = await makeCaller({ id: REVIEWER, role: "user" }).documents.list({ disputeId: DISPUTE_ID });
    expect(result).toHaveLength(1);
  });
});

describe("predictions.get object-level authorization", () => {
  it("owner can read the outcome prediction for their dispute", async () => {
    seedDispute();
    const result = await makeCaller({ id: OWNER, role: "user" }).predictions.get({ disputeId: DISPUTE_ID });
    expect(result).toMatchObject({ disputeId: DISPUTE_ID });
  });

  it("another authenticated user gets FORBIDDEN (IDOR regression)", async () => {
    seedDispute();
    await expectForbidden(makeCaller({ id: STRANGER, role: "user" }).predictions.get({ disputeId: DISPUTE_ID }));
  });

  it("a reviewer with a grant can read the prediction", async () => {
    seedDispute();
    state.grants = [{ disputeId: DISPUTE_ID, userId: REVIEWER, permission: "read" }];
    const result = await makeCaller({ id: REVIEWER, role: "user" }).predictions.get({ disputeId: DISPUTE_ID });
    expect(result).toMatchObject({ disputeId: DISPUTE_ID });
  });
});
