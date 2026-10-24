/**
 * server/tests/security-wave-fb.test.ts
 *
 * Tests for the FIX WAVE F-B security remediations:
 *   X1 — tenantId bound server-side in priorAuth / noticeConsent / gfePpdr
 *   X2 — suspended accounts rejected (403 account_suspended)
 *   X3 — webhookReplay ownership scoping (registry checker)
 *   X4 — portalRpa run/checkpoint ownership (registry checker)
 *   X7 — bulkActions.changeStatus workflow-guarded + capped at 100
 *   X8 — submissionAutomation.recordDetermination admin/dispute-admin only
 *
 * DB is replaced with a chainable in-memory fake; the FSM case store uses its
 * built-in in-memory implementation. No live infrastructure required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import type { User } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";

// ── Chainable fake DB (hoisted) ──────────────────────────────────────────────
const state = vi.hoisted(() => ({
  dbAvailable: true,
  rows: [] as Array<Record<string, unknown>>,
  updates: [] as unknown[],
  inserts: [] as unknown[],
}));

vi.mock("../db", async importOriginal => {
  const mod = await importOriginal<typeof import("../db")>();
  const makeChain = (): any => {
    const chain: any = new Proxy({}, {
      get: (_t, prop) => {
        if (prop === "then") {
          return (f: any, r: any) => Promise.resolve(state.rows).then(f, r);
        }
        if (prop === "limit") return (n: number) => Promise.resolve(state.rows.slice(0, n));
        if (prop === "set") return (v: unknown) => { state.updates.push(v); return chain; };
        if (prop === "values") return (v: unknown) => { state.inserts.push(v); return Promise.resolve(undefined); };
        return () => chain;
      },
    });
    return chain;
  };
  const fakeDb = {
    select: () => makeChain(),
    update: () => makeChain(),
    insert: () => makeChain(),
  };
  return {
    ...mod,
    getDb: async () => (state.dbAvailable ? (fakeDb as any) : null),
  };
});

import { appRouter } from "../routers";
import { priorAuthRouter } from "../priorauth/routes";
import { noticeConsentRouter } from "../notice-consent/routes";
import { gfePpdrRouter } from "../gfe-ppdr/routes";
import { InMemoryFsmCaseStore, setFsmCaseStoreForTests } from "../fsm-store/store";
import { assertNotSuspended } from "../_core/keycloak";
import { enforcePathAuthz, type AuthzRequestContext } from "../authz-registry";
import { recordRunOwner, recordCheckpointOwner, resetRunOwnersForTests } from "../idr/portal-rpa/run-owners";

// ── Context factory ──────────────────────────────────────────────────────────
function makeUser(id: string, role: "user" | "admin" = "user"): User {
  return {
    id, name: "Wave FB Tester", email: `${id}@example.test`,
    passwordHash: null, loginMethod: "keycloak", role,
    createdAt: new Date(), lastSignedIn: new Date(),
    suspendedAt: null, suspendedUntil: null, suspendReason: null,
  } as unknown as User;
}
const ctxFor = (id: string, role: "user" | "admin" = "user"): TrpcContext =>
  ({ req: {} as never, res: {} as never, user: makeUser(id, role) });
const asAuthz = (id: string, role: "user" | "admin" = "user"): AuthzRequestContext => ({ user: { id, role } });

const expectTrpc = async (p: Promise<unknown>, code: string) =>
  expect(p).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === code);

beforeEach(() => {
  state.dbAvailable = true;
  state.rows = [];
  state.updates = [];
  state.inserts = [];
  resetRunOwnersForTests();
});

// ── X1: server-side tenant binding (cross-user isolation) ────────────────────
describe("X1 tenant binding (priorAuth / noticeConsent / gfePpdr)", () => {
  beforeEach(() => setFsmCaseStoreForTests(new InMemoryFsmCaseStore()));

  it("priorAuth: user B cannot read or transition user A's request (tenant derived from ctx.user)", async () => {
    const a = priorAuthRouter.createCaller(ctxFor("user-a"));
    const b = priorAuthRouter.createCaller(ctxFor("user-b"));
    // A malicious client-supplied tenantId is accepted-but-ignored.
    await a.createRequest({ tenantId: "tenant-victim", requestId: "pa-1", payerType: "MA", urgency: "STANDARD" });
    const ownRead = await a.getRequest({ requestId: "pa-1" });
    expect((ownRead as any)?.caseId ?? (ownRead as any)?.id).toBe("pa-1");
    const crossRead = await b.getRequest({ tenantId: "tenant:user-a", requestId: "pa-1" });
    expect(crossRead).toBeNull();
    await expectTrpc(b.transition({ requestId: "pa-1", to: "SUBMITTED" }), "NOT_FOUND");
  });

  it("noticeConsent: cross-user case read returns null", async () => {
    const a = noticeConsentRouter.createCaller(ctxFor("user-a"));
    const b = noticeConsentRouter.createCaller(ctxFor("user-b"));
    const timing = {
      scheduledAt: new Date("2026-09-10T00:00:00Z"),
      serviceAt: new Date("2026-09-12T00:00:00Z"),
      noticeDeliveredAt: new Date("2026-09-08T00:00:00Z"),
    };
    await a.createCase({
      tenantId: "tenant-attacker", caseId: "nc-1",
      waiverInput: { serviceCategory: "EMERGENCY" },
      timing, noticeElements: [],
    });
    expect(((await a.getCase({ caseId: "nc-1" })) as any)?.caseId).toBe("nc-1");
    expect(await b.getCase({ tenantId: "tenant:user-a", caseId: "nc-1" })).toBeNull();
  });

  it("gfePpdr: cross-user dispute read returns null", async () => {
    const a = gfePpdrRouter.createCaller(ctxFor("user-a"));
    const b = gfePpdrRouter.createCaller(ctxFor("user-b"));
    await a.createDispute({
      tenantId: "tenant-victim", disputeId: "ppdr-1",
      gfeTotalUsd: 1000, billedTotalUsd: 2000,
      billedAt: new Date("2026-08-01T00:00:00Z"), insuranceBilled: false,
    });
    expect(((await a.getDispute({ disputeId: "ppdr-1" })) as any)?.caseId).toBe("ppdr-1");
    expect(await b.getDispute({ tenantId: "tenant:user-a", disputeId: "ppdr-1" })).toBeNull();
  });
});

// ── X2: suspension enforcement ───────────────────────────────────────────────
describe("X2 account suspension", () => {
  it("rejects a user suspended indefinitely", () => {
    const u = { ...makeUser("u1"), suspendedAt: new Date(), suspendedUntil: null } as User;
    expect(() => assertNotSuspended(u)).toThrowError(/account_suspended/);
    try { assertNotSuspended(u); } catch (e: any) { expect(e.statusCode ?? e.status).toBe(403); }
  });
  it("rejects a user suspended until a future date", () => {
    const u = { ...makeUser("u1"), suspendedAt: new Date(), suspendedUntil: new Date(Date.now() + 86400_000) } as User;
    expect(() => assertNotSuspended(u)).toThrowError(/account_suspended/);
  });
  it("allows a user whose suspension has expired, and one never suspended", () => {
    const expired = { ...makeUser("u1"), suspendedAt: new Date(Date.now() - 2 * 86400_000), suspendedUntil: new Date(Date.now() - 86400_000) } as User;
    expect(() => assertNotSuspended(expired)).not.toThrow();
    expect(() => assertNotSuspended(makeUser("u2"))).not.toThrow();
  });
});

// ── X3: webhookReplay ownership ─────────────────────────────────────────────
describe("X3 webhookReplay scoping", () => {
  it("registry: replay denied for non-owner, allowed for owner/admin", async () => {
    state.rows = [{ userId: "user-a" }]; // joined webhook owner row
    await expect(enforcePathAuthz("webhookReplay.replay", asAuthz("user-a"), { id: "del-1" })).resolves.toBeUndefined();
    await expect(enforcePathAuthz("webhookReplay.replay", asAuthz("user-a", "admin"), { id: "del-1" })).resolves.toBeUndefined();
    await expect(enforcePathAuthz("webhookReplay.replay", asAuthz("user-b"), { id: "del-1" }))
      .rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === "FORBIDDEN");
  });
  it("registry: replay fails closed when the authorization store is unavailable", async () => {
    state.dbAvailable = false;
    await expect(enforcePathAuthz("webhookReplay.replay", asAuthz("user-b"), { id: "del-1" }))
      .rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === "FORBIDDEN");
  });
});

// ── X4: portalRpa run ownership ─────────────────────────────────────────────
describe("X4 portalRpa ownership", () => {
  it("getRun: owner and admin pass, stranger and unowned runs are denied (fail closed)", async () => {
    recordRunOwner("run-1", "user-a");
    await expect(enforcePathAuthz("portalRpa.getRun", asAuthz("user-a"), { runId: "run-1" })).resolves.toBeUndefined();
    await expect(enforcePathAuthz("portalRpa.getRun", asAuthz("admin-1", "admin"), { runId: "run-1" })).resolves.toBeUndefined();
    await expect(enforcePathAuthz("portalRpa.getRun", asAuthz("user-b"), { runId: "run-1" }))
      .rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === "FORBIDDEN");
    await expect(enforcePathAuthz("portalRpa.getRun", asAuthz("user-b"), { runId: "run-unknown" }))
      .rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === "FORBIDDEN");
  });
  it("resolveCheckpoint: non-owner denied; unknown ids fall through to the queue's own rejection", async () => {
    recordCheckpointOwner("cp-1", "user-a");
    await expect(enforcePathAuthz("portalRpa.resolveCheckpoint", asAuthz("user-b"), { checkpointId: "cp-1" }))
      .rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === "FORBIDDEN");
    await expect(enforcePathAuthz("portalRpa.resolveCheckpoint", asAuthz("user-b"), { checkpointId: "cp-unknown" })).resolves.toBeUndefined();
  });
});

// ── X7: bulkActions.changeStatus workflow guard ─────────────────────────────
describe("X7 bulkActions.changeStatus", () => {
  const dispute = {
    id: "d-1",
    initiatingPartyId: "user-a",
    status: "eligibility_review",
    currentStep: "STEP_08_ELIGIBILITY_REVIEW",
    billedAmount: "1000", qpaAmount: "900", serviceDate: new Date(),
  };
  it("rejects an illegal jump (eligibility_review → closed) and writes nothing", async () => {
    state.rows = [dispute];
    const caller = appRouter.createCaller(ctxFor("user-a"));
    await expectTrpc(caller.bulkActions.changeStatus({ ids: ["d-1"], status: "closed" }), "BAD_REQUEST");
    expect(state.updates.length).toBe(0);
    expect(state.inserts.length).toBe(0);
  });
  it("applies a legal transition, updates step+status, and writes a timeline event", async () => {
    state.rows = [dispute];
    const caller = appRouter.createCaller(ctxFor("user-a"));
    const res = await caller.bulkActions.changeStatus({ ids: ["d-1"], status: "offer_submission" });
    expect(res.updated).toBe(1);
    expect(state.updates[0]).toMatchObject({ status: "offer_submission", currentStep: "STEP_09_OFFER_SUBMISSION" });
    expect(state.inserts[0]).toMatchObject({ disputeId: "d-1", eventType: "bulk_status_change", performedBy: "user-a" });
  });
  it("treats a same-status request as an idempotent no-op", async () => {
    state.rows = [dispute];
    const caller = appRouter.createCaller(ctxFor("user-a"));
    const res = await caller.bulkActions.changeStatus({ ids: ["d-1"], status: "eligibility_review" });
    expect(res.updated).toBe(1);
    expect(state.updates.length).toBe(0);
  });
  it("caps the batch at 100 ids (schema rejection)", async () => {
    const caller = appRouter.createCaller(ctxFor("user-a", "admin"));
    const ids = Array.from({ length: 101 }, (_, i) => `d-${i}`);
    await expectTrpc(caller.bulkActions.changeStatus({ ids, status: "closed" }), "BAD_REQUEST");
  });
});

// ── X8: recordDetermination restricted to admin / dispute admin ─────────────
describe("X8 submissionAutomation.recordDetermination", () => {
  const determination = {
    idreId: "idre-1",
    determinationDate: "2026-09-05",
    prevailingParty: "initiating" as const,
    prevailingOffer: 4200,
    qpa: 2600,
    otherOffer: 2400,
    rationaleFactors: ["QPA proximity"],
    adminFeeAmount: 50,
    idreFeeAmount: 400,
  };
  it("rejects a non-admin without the dispute admin permission", async () => {
    state.rows = []; // dispute not found / no grant → canAccessDispute false
    const caller = appRouter.createCaller(ctxFor("user-a"));
    await expectTrpc(
      caller.submissionAutomation.recordDetermination({ tenantId: "tenant:user-a", disputeId: "d-x", determination }),
      "FORBIDDEN"
    );
  });
});
