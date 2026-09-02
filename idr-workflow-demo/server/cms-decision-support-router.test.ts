import { afterEach, describe, expect, it, vi } from "vitest";

const authorizationMocks = vi.hoisted(() => ({
  assertDisputeAccess: vi.fn(),
}));

const environment = vi.hoisted(() => ({
  isProduction: false,
}));

vi.mock("./authz", () => authorizationMocks);
vi.mock("./_core/env", () => ({ ENV: environment }));

import { appRouter } from "./routers";

const user = {
  id: "cms-decision-support-user",
  email: "reviewer@example.test",
  role: "provider",
  name: "CMS Reviewer",
} as any;

const cmsSubmission = {
  initiating_party_name: "Example Provider",
  initiating_party_type: "provider",
  responding_party_name: "Example Plan",
  responding_party_type: "payer",
  service_type: "emergency",
  service_date: "2026-08-01",
  patient_state: "DC",
  facility_state: "DC",
  billed_amount: 1200,
  qpa_amount: 900,
  initiating_offer: 1100,
  open_negotiation_start: "2026-08-01",
  open_negotiation_end: "2026-08-31",
  idr_initiation_date: "2026-09-01",
  attached_documents: ["eob.pdf"],
  submission_narrative: "A complete human-reviewed dispute narrative.",
};

function caller() {
  return appRouter.createCaller({
    req: {} as any,
    res: {} as any,
    user,
  });
}

function approvedValidationResponse() {
  return {
    status: "needs_review",
    confidence_score: 0.8,
    blocking_count: 0,
    warning_count: 1,
    issues: [],
    layer_results: {
      schema: true,
      regulatory: true,
      documents: true,
      coherence: true,
      ai_confidence: true,
    },
    remediation_plan: ["Obtain authorized human approval before portal handoff."],
    summary: "Decision-support review completed; CMS portal submission remains manual.",
  };
}

afterEach(() => {
  authorizationMocks.assertDisputeAccess.mockReset();
  environment.isProduction = false;
  vi.unstubAllGlobals();
});

describe("CMS decision-support routes", () => {
  it("rejects a missing disputeId before authorization or AI transport", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      (caller().ai.validateCMSSubmission as any)({
        submission: cmsSubmission,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(authorizationMocks.assertDisputeAccess).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("denies an unauthorized dispute before an AI validation request", async () => {
    authorizationMocks.assertDisputeAccess.mockRejectedValue(
      new Error("dispute write access denied")
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      caller().ai.validateCMSSubmission({
        disputeId: "dispute-denied",
        submission: cmsSubmission,
      })
    ).rejects.toThrow("dispute write access denied");

    expect(authorizationMocks.assertDisputeAccess).toHaveBeenCalledWith(
      user.id,
      user.role,
      "dispute-denied",
      "write"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("permits an authorized validation request but only returns decision support, never a CMS submission", async () => {
    authorizationMocks.assertDisputeAccess.mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(approvedValidationResponse()), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await caller().ai.validateCMSSubmission({
      disputeId: "dispute-authorized",
      submission: cmsSubmission,
    });

    expect(authorizationMocks.assertDisputeAccess).toHaveBeenCalledWith(
      user.id,
      user.role,
      "dispute-authorized",
      "write"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/validate-cms-submission$/),
      expect.objectContaining({ method: "POST" })
    );
    expect(result).toMatchObject({
      status: "needs_review",
      blocking_count: 0,
      summary: expect.stringContaining("manual"),
    });
    expect(result).not.toHaveProperty("portalReceipt");
    expect(result).not.toHaveProperty("cmsSubmissionId");
  });

  it("fails closed with SERVICE_UNAVAILABLE in production when validation or autofix AI is unavailable", async () => {
    environment.isProduction = true;
    authorizationMocks.assertDisputeAccess.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("AI transport offline")));

    await expect(
      caller().ai.validateCMSSubmission({
        disputeId: "dispute-production-outage",
        submission: cmsSubmission,
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });

    await expect(
      caller().ai.autoFixCMSSubmission({
        disputeId: "dispute-production-outage",
        submission: cmsSubmission,
        issues: [
          {
            code: "MISSING_REQUIRED_FIELD",
            field: "provider_tin",
            severity: "blocking",
            message: "Provider TIN is required.",
            remediation: "Enter a valid provider TIN.",
          },
        ],
        remediation_plan: ["Enter the missing provider TIN."],
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("returns an explicit blocking manual-review fallback outside production without claiming validation passed", async () => {
    authorizationMocks.assertDisputeAccess.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("AI transport offline")));

    const validation = await caller().ai.validateCMSSubmission({
      disputeId: "dispute-nonproduction-outage",
      submission: cmsSubmission,
    });
    const autofix = await caller().ai.autoFixCMSSubmission({
      disputeId: "dispute-nonproduction-outage",
      submission: cmsSubmission,
      issues: [
        {
          code: "MISSING_REQUIRED_FIELD",
          field: "provider_tin",
          severity: "blocking",
          message: "Provider TIN is required.",
          remediation: "Enter a valid provider TIN.",
        },
      ],
      remediation_plan: ["Enter the missing provider TIN."],
    });

    expect(validation).toEqual(
      expect.objectContaining({
        status: "needs_review",
        confidence_score: 0,
        blocking_count: 1,
        warning_count: 0,
        layer_results: {
          schema: false,
          regulatory: false,
          documents: false,
          coherence: false,
          ai_confidence: false,
        },
      })
    );
    expect(validation.issues).toEqual([
      expect.objectContaining({
        severity: "blocking",
        code: "AI_SERVICE_UNAVAILABLE",
      }),
    ]);
    expect(autofix).toMatchObject({
      success: false,
      fixesApplied: [],
      fixCount: 0,
      unfixableCount: 1,
    });
    expect(autofix).not.toHaveProperty("submitted");
  });

  it("denies an unauthorized auto-fix before its AI request", async () => {
    authorizationMocks.assertDisputeAccess.mockRejectedValue(
      new Error("dispute write access denied")
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      caller().ai.autoFixCMSSubmission({
        disputeId: "dispute-denied",
        submission: cmsSubmission,
        issues: [],
        remediation_plan: [],
      })
    ).rejects.toThrow("dispute write access denied");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("denies unapproved access to CMS draft generation and draft retrieval before downstream work", async () => {
    authorizationMocks.assertDisputeAccess.mockRejectedValue(
      new Error("dispute access denied")
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      caller().ai.generateCMSSubmission({
        disputeId: "dispute-denied",
      })
    ).rejects.toThrow("dispute access denied");
    await expect(
      caller().ai.getCMSDraft({
        disputeId: "dispute-denied",
      })
    ).rejects.toThrow("dispute access denied");

    expect(authorizationMocks.assertDisputeAccess).toHaveBeenNthCalledWith(
      1,
      user.id,
      user.role,
      "dispute-denied",
      "write"
    );
    expect(authorizationMocks.assertDisputeAccess).toHaveBeenNthCalledWith(
      2,
      user.id,
      user.role,
      "dispute-denied",
      "read"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
