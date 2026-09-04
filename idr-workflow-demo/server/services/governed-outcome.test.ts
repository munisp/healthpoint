import { afterEach, describe, expect, it, vi } from "vitest";

const authorizationMocks = vi.hoisted(() => ({
  assertDisputeAccess: vi.fn(),
}));
const databaseMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getDisputeById: vi.fn(),
}));

vi.mock("../authz", () => authorizationMocks);
vi.mock("../db", () => databaseMocks);

import {
  invokeGovernedGeorgetownRuntime,
  requireGovernedOutcomeContext,
  type GovernedOutcomeContext,
} from "./governed-outcome";

const originalEnv = { ...process.env };

const context = {
  dispute: {
    id: "dispute-1",
    referenceNumber: "HP-0001",
    serviceType: "radiology",
    cptCodes: ["71046"],
    patientState: "DC",
    currentStep: "STEP_10_OFFER_REVIEW",
    billedAmount: "1200.00",
    qpaAmount: "900.00",
    initiatingPartyOffer: "1100.00",
    respondingPartyOffer: "850.00",
  },
  modelId: "georgetown-idr",
  modelVersion: "2026.01",
  modelArtifactSha256: "a".repeat(64),
  modelValidationRunId: "validation-1",
  modelApprovalGateId: "approval-1",
  documentValidationRunId: "document-validation-1",
  governanceApprovedAt: new Date("2026-08-27T00:00:00.000Z"),
} as unknown as GovernedOutcomeContext;

function enableRuntime(): void {
  process.env.GOVERNED_OUTCOME_PREDICTIONS_ENABLED = "true";
  process.env.GOVERNED_OUTCOME_RUNTIME = "georgetown";
  process.env.GEORGETOWN_MODEL_URL = "https://model.example.test/predict";
  process.env.GEORGETOWN_MODEL_TOKEN = "unit-test-token";
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    winProbability: 62,
    confidenceScore: 71,
    confidenceInterval: [55, 69],
    keyFactors: ["QPA ratio", "service mix"],
    recommendation: "Review evidence with counsel.",
    modelId: context.modelId,
    modelVersion: context.modelVersion,
    artifactSha256: context.modelArtifactSha256,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  authorizationMocks.assertDisputeAccess.mockReset();
  databaseMocks.getDb.mockReset();
  databaseMocks.getDisputeById.mockReset();
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe("governed Georgetown outcome runtime", () => {
  it("rejects unauthorized callers before reading dispute or governance state", async () => {
    authorizationMocks.assertDisputeAccess.mockRejectedValue(
      new Error("dispute access denied")
    );
    await expect(
      requireGovernedOutcomeContext({
        userId: "unauthorized-user",
        userRole: "user",
        disputeId: "dispute-1",
      })
    ).rejects.toThrow("dispute access denied");
    expect(databaseMocks.getDb).not.toHaveBeenCalled();
    expect(databaseMocks.getDisputeById).not.toHaveBeenCalled();
  });

  it("requires a durable data-use approval before reading document evidence or invoking the runtime", async () => {
    process.env.GEORGETOWN_MODEL_ID = "georgetown-idr";
    process.env.GEORGETOWN_MODEL_VERSION = "2026.01";
    authorizationMocks.assertDisputeAccess.mockResolvedValue(undefined);
    databaseMocks.getDisputeById.mockResolvedValue(context.dispute);
    const governanceQuery = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn().mockResolvedValue([]),
    };
    governanceQuery.from.mockReturnValue(governanceQuery);
    governanceQuery.innerJoin.mockReturnValue(governanceQuery);
    governanceQuery.where.mockReturnValue(governanceQuery);
    const db = { select: vi.fn(() => governanceQuery) };
    databaseMocks.getDb.mockResolvedValue(db);

    await expect(
      requireGovernedOutcomeContext({
        userId: "authorized-user",
        userRole: "user",
        disputeId: "dispute-1",
      })
    ).rejects.toThrow(
      "approved, in-scope, unexpired data-use approval bound to the validated dataset"
    );
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("refuses live predictions unless the governed runtime is explicitly enabled", async () => {
    process.env.GOVERNED_OUTCOME_PREDICTIONS_ENABLED = "false";
    await expect(
      invokeGovernedGeorgetownRuntime(context)
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("rejects a generic LLM runtime identifier", async () => {
    enableRuntime();
    process.env.GOVERNED_OUTCOME_RUNTIME = "gpt-5";
    await expect(invokeGovernedGeorgetownRuntime(context)).rejects.toThrow(
      "general-purpose LLM outcome predictions are prohibited"
    );
  });

  it("sends pinned governance identifiers to the approved runtime and accepts an exact matching response", async () => {
    enableRuntime();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(validPayload()), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(invokeGovernedGeorgetownRuntime(context)).resolves.toEqual({
      winProbability: 62,
      confidenceScore: 71,
      confidenceInterval: [55, 69],
      keyFactors: ["QPA ratio", "service mix"],
      recommendation: "Review evidence with counsel.",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://model.example.test/predict",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer unit-test-token",
          "x-healthpoint-model-id": "georgetown-idr",
          "x-healthpoint-model-version": "2026.01",
          "x-healthpoint-model-artifact-sha256": "a".repeat(64),
        }),
      })
    );
  });

  it("rejects runtime outputs that do not match the pinned artifact", async () => {
    enableRuntime();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify(validPayload({ artifactSha256: "b".repeat(64) })),
            { status: 200 }
          )
        )
    );
    await expect(invokeGovernedGeorgetownRuntime(context)).rejects.toThrow(
      "does not match the pinned governance artifact"
    );
  });

  it("rejects an invalid runtime confidence interval", async () => {
    enableRuntime();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify(validPayload({ confidenceInterval: [70, 55] })),
            { status: 200 }
          )
        )
    );
    await expect(invokeGovernedGeorgetownRuntime(context)).rejects.toThrow(
      "invalid probability interval"
    );
  });
});
