/**
 * server/tests/trpc-contract.test.ts
 *
 * Contract tests for the tRPC API surface (server/routers.ts): the zod input
 * schemas are the public contract for money-bearing endpoints. These tests prove
 * malformed money amounts, negative amounts, wrong currency precision, and
 * malformed idempotency keys are rejected with BAD_REQUEST before any business
 * logic or database call runs, and that well-formed inputs are accepted.
 *
 * Verified behavior (tRPC v11.18, @trpc/server): procedure middlewares run first,
 * then input validation, then the resolver. So these tests pass an authenticated
 * context; any BAD_REQUEST can only come from input validation (or a resolver's
 * own documented guard), never from auth. Admin-gated procedures return
 * FORBIDDEN before input parsing — that ordering is also asserted.
 *
 * Infrastructure modules are replaced at the module boundary with vi.mock so no
 * database / Kafka / Redis is required.
 */
import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { User } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";

// ── Boundary mocks (only the functions the exercised resolvers call) ─────────
// vi.hoisted runs before module imports, so these are safe to reference inside
// vi.mock factories (which are hoisted to the top of the file).

const mocks = vi.hoisted(() => ({
  createDispute: vi.fn(async (data: Record<string, unknown>) => ({
    id: "dispute-contract-1",
    referenceNumber: "IDR-2026-TST01",
    openNegotiationDeadline: new Date("2026-10-01T00:00:00.000Z"),
    ...data,
  })),
  createNotification: vi.fn(async () => undefined),
  submitOffer: vi.fn(async () => "offer-contract-1"),
  assertDisputeAccess: vi.fn(async () => undefined),
  recordPayment: vi.fn(async (disputeId: string, amountCents: number) => ({
    id: "entry-contract-1",
    amountCents,
    disputeId,
  })),
  initializeDisputeLedger: vi.fn(async () => undefined),
  dispatchOutboxBatch: vi.fn(async () => ({ claimed: 0, delivered: 0, failed: 0 })),
  createSettlementTransfer: vi.fn(async (input: Record<string, unknown>) => ({
    id: "transfer-contract-1",
    status: "requested",
    ...input,
  })),
}));

vi.mock("../db", async importOriginal => {
  const mod = await importOriginal<typeof import("../db")>();
  return {
    ...mod,
    createDispute: mocks.createDispute,
    createNotification: mocks.createNotification,
    submitOffer: mocks.submitOffer,
  };
});

vi.mock("../authz", async importOriginal => {
  const mod = await importOriginal<typeof import("../authz")>();
  return { ...mod, assertDisputeAccess: mocks.assertDisputeAccess };
});

vi.mock("../ledger", async importOriginal => {
  const mod = await importOriginal<typeof import("../ledger")>();
  return {
    ...mod,
    recordPayment: mocks.recordPayment,
    initializeDisputeLedger: mocks.initializeDisputeLedger,
  };
});

vi.mock("../outbox", async importOriginal => {
  const mod = await importOriginal<typeof import("../outbox")>();
  return { ...mod, dispatchOutboxBatch: mocks.dispatchOutboxBatch };
});

vi.mock("../settlement-lifecycle", async importOriginal => {
  const mod = await importOriginal<typeof import("../settlement-lifecycle")>();
  return { ...mod, createSettlementTransfer: mocks.createSettlementTransfer };
});

import { appRouter } from "../routers";

// ── Test context factory ─────────────────────────────────────────────────────

function makeUser(role: "user" | "admin"): User {
  return {
    id: `user-contract-${role}`,
    name: "Contract Tester",
    email: `contract-${role}@example.test`,
    passwordHash: null,
    loginMethod: "keycloak",
    role,
    createdAt: new Date(),
    lastSignedIn: new Date(),
    suspendedAt: null,
    suspendedUntil: null,
    suspendReason: null,
  } as unknown as User;
}

function makeCtx(role: "user" | "admin" = "user"): TrpcContext {
  return { req: {} as never, res: {} as never, user: makeUser(role) };
}

const userCaller = () => appRouter.createCaller(makeCtx("user"));
const adminCaller = () => appRouter.createCaller(makeCtx("admin"));

async function expectBadRequest(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (e: unknown) => e instanceof TRPCError && e.code === "BAD_REQUEST"
  );
}

const VALID_UUID = "0b965475-1a1e-4f42-9b6d-3f2f3d2b2a11";

// ── system.health (public): sanity that the harness works ────────────────────

describe("system.health contract", () => {
  it("rejects a negative timestamp and accepts a valid one", async () => {
    const caller = appRouter.createCaller({ req: {} as never, res: {} as never, user: null });
    await expectBadRequest(caller.system.health({ timestamp: -1 }));
    const ok = await caller.system.health({ timestamp: Date.now() });
    expect(ok).toMatchObject({ ok: true });
  });
});

// ── ledger.recordPayment ─────────────────────────────────────────────────────

describe("ledger.recordPayment contract", () => {
  const valid = {
    disputeId: "dispute-contract-1",
    amountDollars: 123.45,
    referenceId: "provider-ref-001",
    idempotencyKey: VALID_UUID,
  };

  it("rejects negative and zero amounts", async () => {
    await expectBadRequest(userCaller().ledger.recordPayment({ ...valid, amountDollars: -5 }));
    await expectBadRequest(userCaller().ledger.recordPayment({ ...valid, amountDollars: 0 }));
    expect(mocks.recordPayment).not.toHaveBeenCalled();
  });

  it("rejects non-numeric amounts", async () => {
    await expectBadRequest(
      userCaller().ledger.recordPayment({ ...valid, amountDollars: "100.00" as unknown as number })
    );
  });

  it("rejects malformed idempotency keys", async () => {
    await expectBadRequest(userCaller().ledger.recordPayment({ ...valid, idempotencyKey: "not-a-uuid" }));
    await expectBadRequest(userCaller().ledger.recordPayment({ ...valid, idempotencyKey: "" }));
  });

  it("rejects missing/short payment references", async () => {
    await expectBadRequest(userCaller().ledger.recordPayment({ ...valid, referenceId: "ab" }));
    await expectBadRequest(
      userCaller().ledger.recordPayment({ ...valid, referenceId: undefined as unknown as string })
    );
  });

  it("rejects sub-cent amounts that would round to zero cents (resolver guard)", async () => {
    await expectBadRequest(userCaller().ledger.recordPayment({ ...valid, amountDollars: 0.004 }));
    expect(mocks.recordPayment).not.toHaveBeenCalled();
  });

  it("accepts a valid payment and converts dollars to integer cents exactly once", async () => {
    mocks.recordPayment.mockClear();
    const result = await userCaller().ledger.recordPayment(valid);
    expect(mocks.recordPayment).toHaveBeenCalledTimes(1);
    expect(mocks.recordPayment).toHaveBeenCalledWith(
      valid.disputeId, 12345, valid.referenceId, valid.idempotencyKey, "user-contract-user"
    );
    expect(result).toMatchObject({ id: "entry-contract-1", amountCents: 12345 });
    expect(mocks.dispatchOutboxBatch).toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const anon = appRouter.createCaller({ req: {} as never, res: {} as never, user: null });
    await expect(anon.ledger.recordPayment(valid)).rejects.toSatisfy(
      (e: unknown) => e instanceof TRPCError && e.code === "UNAUTHORIZED"
    );
  });
});

// ── disputes.create money precision ──────────────────────────────────────────

describe("disputes.create contract", () => {
  const valid = {
    initiatingPartyType: "provider" as const,
    initiatingPartyName: "Contract Test Provider",
    respondingPartyType: "payer" as const,
    respondingPartyName: "Contract Test Payer",
    serviceType: "emergency_medicine" as const,
    serviceDate: "2026-01-15T00:00:00.000Z",
    patientState: "TX",
    facilityState: "TX",
    cptCodes: ["99283"],
    billedAmount: "1250.00",
  };

  it("rejects billed amounts with more than 2 decimal places (wrong currency precision)", async () => {
    await expectBadRequest(userCaller().disputes.create({ ...valid, billedAmount: "1000.005" }));
    expect(mocks.createDispute).not.toHaveBeenCalled();
  });

  it("rejects negative, thousand-separated, and non-numeric billed amounts", async () => {
    await expectBadRequest(userCaller().disputes.create({ ...valid, billedAmount: "-5" }));
    await expectBadRequest(userCaller().disputes.create({ ...valid, billedAmount: "1,000.00" }));
    await expectBadRequest(userCaller().disputes.create({ ...valid, billedAmount: "abc" }));
  });

  it("rejects an empty CPT code list", async () => {
    await expectBadRequest(userCaller().disputes.create({ ...valid, cptCodes: [] }));
  });

  it("accepts a well-formed dispute and initializes downstream records", async () => {
    mocks.createDispute.mockClear();
    const dispute = await userCaller().disputes.create(valid);
    expect(mocks.createDispute).toHaveBeenCalledTimes(1);
    expect(mocks.createDispute).toHaveBeenCalledWith(
      expect.objectContaining({
        billedAmount: "1250.00",
        initiatingPartyId: "user-contract-user",
        createdBy: "user-contract-user",
      })
    );
    // The resolver assigns the id; the DB helper generates the reference number.
    expect(dispute.id).toBeTruthy();
    expect(dispute.billedAmount).toBe("1250.00");
    expect(mocks.createNotification).toHaveBeenCalled();
    expect(mocks.initializeDisputeLedger).toHaveBeenCalledWith(dispute.id);
  });
});

// ── disputes.submitOffer ─────────────────────────────────────────────────────

describe("disputes.submitOffer contract", () => {
  const valid = {
    disputeId: "dispute-contract-1",
    offerType: "responding_party" as const,
    amount: "950.00",
    rationale: "QPA-based counter",
  };

  it("rejects offer amounts with wrong currency precision", async () => {
    await expectBadRequest(userCaller().disputes.submitOffer({ ...valid, amount: "10.999" }));
    await expectBadRequest(userCaller().disputes.submitOffer({ ...valid, amount: "-10" }));
    expect(mocks.submitOffer).not.toHaveBeenCalled();
  });

  it("rejects unknown offer types", async () => {
    await expectBadRequest(
      userCaller().disputes.submitOffer({ ...valid, offerType: "bogus" as never })
    );
  });

  it("accepts a well-formed offer after an access check", async () => {
    const result = await userCaller().disputes.submitOffer(valid);
    expect(result).toEqual({ offerId: "offer-contract-1" });
    expect(mocks.assertDisputeAccess).toHaveBeenCalledWith(
      "user-contract-user", "user", valid.disputeId, "write"
    );
  });
});

// ── settlementTransfers.request ──────────────────────────────────────────────

describe("settlementTransfers.request contract", () => {
  const valid = {
    disputeId: VALID_UUID,
    provider: "mojaloop-sandbox",
    amountCents: 25_000,
    requestReason: "IDR determination payment per award",
    idempotencyKey: "req-2026-09-05-abcdef01",
  };

  it("rejects fractional cents", async () => {
    await expectBadRequest(userCaller().settlementTransfers.request({ ...valid, amountCents: 10.5 }));
  });

  it("rejects zero, negative, and above-cap amounts", async () => {
    await expectBadRequest(userCaller().settlementTransfers.request({ ...valid, amountCents: 0 }));
    await expectBadRequest(userCaller().settlementTransfers.request({ ...valid, amountCents: -1 }));
    await expectBadRequest(userCaller().settlementTransfers.request({ ...valid, amountCents: 1_000_000_001 }));
  });

  it("rejects short idempotency keys and non-uuid dispute ids", async () => {
    await expectBadRequest(userCaller().settlementTransfers.request({ ...valid, idempotencyKey: "short" }));
    await expectBadRequest(userCaller().settlementTransfers.request({ ...valid, disputeId: "nope" }));
    expect(mocks.createSettlementTransfer).not.toHaveBeenCalled();
  });

  it("accepts a well-formed transfer request", async () => {
    const result = await userCaller().settlementTransfers.request(valid);
    expect(result).toMatchObject({ id: "transfer-contract-1", status: "requested" });
    expect(mocks.createSettlementTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 25_000, requestedBy: "user-contract-user" })
    );
  });
});

// ── settlementTransfers.decide — admin gating precedes input validation ──────

describe("admin-gated procedure contract", () => {
  it("a non-admin is FORBIDDEN even with malformed input (role check runs first)", async () => {
    await expect(
      userCaller().settlementTransfers.decide({
        transferId: "not-a-uuid",
        decision: "bogus" as never,
        reason: "x",
        expiresAt: "not-a-date",
      })
    ).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === "FORBIDDEN");
  });

  it("an admin gets BAD_REQUEST for malformed input (validation runs after role check)", async () => {
    await expectBadRequest(
      adminCaller().settlementTransfers.decide({
        transferId: "not-a-uuid",
        decision: "approved",
        reason: "valid reason text",
        expiresAt: "2026-10-01T00:00:00.000Z",
      })
    );
  });
});

// ── qpa.validate ─────────────────────────────────────────────────────────────

describe("qpa.validate contract", () => {
  const valid = { billedAmount: "398.00", cptCodes: ["99285"], facilityState: "TX" };

  it("rejects wrong-precision billed amounts", async () => {
    await expectBadRequest(userCaller().qpa.validate({ ...valid, billedAmount: "1.234" }));
  });

  it("rejects empty CPT codes and malformed state codes", async () => {
    await expectBadRequest(userCaller().qpa.validate({ ...valid, cptCodes: [] }));
    await expectBadRequest(userCaller().qpa.validate({ ...valid, facilityState: "TEX" }));
  });

  it("accepts a valid query and returns a benchmark analysis", async () => {
    const result = await userCaller().qpa.validate(valid);
    expect(result).toMatchObject({ severity: expect.any(String), percentageOfQpa: expect.any(Number) });
  });
});
