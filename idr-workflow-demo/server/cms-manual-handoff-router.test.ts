import { afterEach, describe, expect, it, vi } from "vitest";

const authorizationMocks = vi.hoisted(() => ({
  assertDisputeAccess: vi.fn(),
}));
const storeMocks = vi.hoisted(() => ({
  findBySubmissionId: vi.fn(),
  listPendingManualHandoffs: vi.fn(),
}));
const adapterMocks = vi.hoisted(() => ({
  prepareHandoff: vi.fn(),
  recordHumanPortalReceipt: vi.fn(),
}));
const storageMocks = vi.hoisted(() => ({ storageReadVerified: vi.fn() }));

vi.mock("./authz", () => authorizationMocks);
vi.mock("./services/cms-outbox", () => ({
  PostgresCmsSubmissionStore: class {
    findBySubmissionId = storeMocks.findBySubmissionId;
    listPendingManualHandoffs = storeMocks.listPendingManualHandoffs;
  },
}));
vi.mock("./services/cms-adapter", () => ({
  ManualCmsHandoffAdapter: class {
    prepareHandoff = adapterMocks.prepareHandoff;
    recordHumanPortalReceipt = adapterMocks.recordHumanPortalReceipt;
  },
}));
vi.mock("./storage", () => storageMocks);

import { appRouter } from "./routers";

const user = {
  id: "handoff-operator-1",
  email: "operator@example.test",
  role: "provider",
  name: "Handoff Operator",
} as any;

function caller() {
  return appRouter.createCaller({ req: {} as any, res: {} as any, user });
}

const prepareInput = {
  disputeId: "dispute-handoff-1",
  idempotencyKey: "handoff-idempotency-key-0001",
  pilotAuthorizationId: "pilot-authorization-1",
  schemaVersion: "1.0",
  openNegotiationEndedAt: "2026-08-01T00:00:00.000Z",
  submissionDeadline: "2026-09-01T00:00:00.000Z",
  claimNumbers: ["claim-1"],
  serviceCodes: ["99213"],
  serviceDates: ["2026-07-15"],
  serviceLocations: ["office"],
  serviceType: "outpatient",
  initiatingParty: { name: "Provider" },
  respondingParty: { name: "Plan" },
  eligibilityAttestation: true as const,
  totalPaymentAmountCents: 12500,
  currency: "USD" as const,
  documentIds: ["document-1"],
};

afterEach(() => {
  authorizationMocks.assertDisputeAccess.mockReset();
  storeMocks.findBySubmissionId.mockReset();
  storeMocks.listPendingManualHandoffs.mockReset();
  adapterMocks.prepareHandoff.mockReset();
  adapterMocks.recordHumanPortalReceipt.mockReset();
  storageMocks.storageReadVerified.mockReset();
});

describe("CMS manual handoff routes", () => {
  it("rejects malformed handoff input before authorization or server-side storage access", async () => {
    await expect(
      (caller().cms.prepareManualHandoff as any)({
        ...prepareInput,
        disputeId: "",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(authorizationMocks.assertDisputeAccess).not.toHaveBeenCalled();
    expect(storageMocks.storageReadVerified).not.toHaveBeenCalled();
    expect(adapterMocks.prepareHandoff).not.toHaveBeenCalled();
  });

  it("denies an unauthorized caller before loading a CMS handoff document or preparing portal work", async () => {
    authorizationMocks.assertDisputeAccess.mockRejectedValue(
      new Error("dispute write access denied")
    );

    await expect(caller().cms.prepareManualHandoff(prepareInput)).rejects.toThrow(
      "dispute write access denied"
    );
    expect(authorizationMocks.assertDisputeAccess).toHaveBeenCalledWith(
      user.id,
      user.role,
      prepareInput.disputeId,
      "write"
    );
    expect(storageMocks.storageReadVerified).not.toHaveBeenCalled();
    expect(adapterMocks.prepareHandoff).not.toHaveBeenCalled();
  });

  it("denies an unauthorized receipt-recording caller before calling the manual receipt adapter", async () => {
    storeMocks.findBySubmissionId.mockResolvedValue({
      submissionId: "handoff-1",
      disputeId: prepareInput.disputeId,
      handoffOperatorId: user.id,
    });
    authorizationMocks.assertDisputeAccess.mockRejectedValue(
      new Error("dispute write access denied")
    );

    await expect(
      caller().cms.recordManualPortalReceipt({
        submissionId: "handoff-1",
        cmsReference: "portal-receipt-1",
        receivedAt: "2026-08-31T12:00:00.000Z",
        receiptSha256: "a".repeat(64),
        outcome: "accepted",
      })
    ).rejects.toThrow("dispute write access denied");
    expect(authorizationMocks.assertDisputeAccess).toHaveBeenCalledWith(
      user.id,
      user.role,
      prepareInput.disputeId,
      "write"
    );
    expect(adapterMocks.recordHumanPortalReceipt).not.toHaveBeenCalled();
  });
});
