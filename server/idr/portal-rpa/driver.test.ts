/**
 * driver.test.ts — EXECUTED against the local TEST HARNESS
 * (test-harness/fake-portal.ts). These tests verify the driver's fail-closed
 * engine logic ONLY. They assert nothing about the real nsa-idr.cms.gov
 * portal; all live-portal selectors remain UNVERIFIED.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultPortalMap } from "./config";
import {
  PortalRpaDriver,
  InMemoryRunStore,
  createFilesystemEvidenceSink,
  redactValue,
  type DriverDeps,
  type RunInput,
} from "./driver";
import { createFakePortalPage, FAKE_PORTAL_FIELDS, FAKE_CONFIRMATION_REFERENCE, type FakePortalOptions } from "./test-harness/fake-portal";
import { createSubmission, transition } from "../submission-automation/submission-fsm";
import { buildSubmissionPackage } from "../submission-automation/package-builder";

const CREDS = { email: "rpa@acme.example", password: "super-secret-password-123" };
const resolver = { resolve: async () => CREDS };
const LIVE_ENV = { RPA_LIVE_ENABLED: "true", RPA_TOS_ACKNOWLEDGED: "true" };

function makeDeps(fakeOpts: FakePortalOptions = {}, env: Record<string, string | undefined> = {}) {
  const store = new InMemoryRunStore();
  let factoryCalls = 0;
  let fake = createFakePortalPage(fakeOpts);
  const deps: DriverDeps = {
    portalMap: defaultPortalMap,
    credentialResolver: resolver,
    evidenceSink: createFilesystemEvidenceSink(mkdtempSync(join(tmpdir(), "rpa-ev-"))),
    runStore: store,
    env,
    pageFactory: async () => {
      factoryCalls++;
      // Fresh page per run; only a RESUMED run lands back on the MFA page.
      fake = createFakePortalPage(fakeOpts);
      if (fakeOpts.mfa && factoryCalls > 1) {
        await fake.page.goto("https://secure.login.gov/login/two_factor/authenticator");
      }
      return fake;
    },
  };
  return { deps, store, getFake: () => fake, factoryCalls: () => factoryCalls };
}

const input: RunInput = {
  submissionId: "sub-1",
  portalFields: { ...FAKE_PORTAL_FIELDS },
  documents: ["/tmp/eob.pdf"],
  credentialsRef: "TEST_CRED_REF",
  mode: "DRY_RUN",
  actorId: "user-1",
};

describe("portal-rpa driver (harness-backed)", () => {
  it("DRY_RUN executes all steps but NEVER clicks the final submit button", async () => {
    const { deps, getFake } = makeDeps();
    const res = await new PortalRpaDriver(deps).runPortalSubmission(input);
    expect(res.status).toBe("DRY_RUN_COMPLETE");
    expect(getFake().calls.some((c) => c.selector === "button.final-submit")).toBe(false);
    expect(res.timeline.some((t) => t.action === "submit-skipped")).toBe(true);
    expect(res.cmsDisputeReferenceNumber).toBeUndefined();
  });

  it("DRY_RUN fills every mapped portal field and collects evidence artifacts", async () => {
    const { deps } = makeDeps();
    const res = await new PortalRpaDriver(deps).runPortalSubmission(input);
    const filledKeys = res.filledFields.map((f) => f.portalFieldKey);
    for (const k of ["initiatingPartyName", "claimNumber", "qualifyingPaymentAmount", "openNegotiationInitiationDate"]) {
      expect(filledKeys).toContain(k);
    }
    expect(res.evidence.filter((e) => e.kind === "screenshot").length).toBeGreaterThanOrEqual(8);
    // DRY_RUN skips post-submit steps (CONFIRMATION), so one fewer snapshot.
    expect(res.evidence.filter((e) => e.kind === "dom-snapshot-hash").length).toBe(defaultPortalMap.steps.length - 1);
    expect(res.evidence.some((e) => e.kind === "timeline")).toBe(true);
  });

  it("LIVE is BLOCKED without both env flags", async () => {
    const d1 = makeDeps({}, {});
    expect((await new PortalRpaDriver(d1.deps).runPortalSubmission({ ...input, mode: "LIVE" })).status).toBe("BLOCKED");
    const d2 = makeDeps({}, { RPA_LIVE_ENABLED: "true" });
    expect((await new PortalRpaDriver(d2.deps).runPortalSubmission({ ...input, mode: "LIVE" })).status).toBe("BLOCKED");
    const d3 = makeDeps({}, { RPA_TOS_ACKNOWLEDGED: "true" });
    expect((await new PortalRpaDriver(d3.deps).runPortalSubmission({ ...input, mode: "LIVE" })).status).toBe("BLOCKED");
    expect(d3.factoryCalls()).toBe(0); // never launched a browser
  });

  it("LIVE with both flags submits exactly once, captures reference, yields FSM attestation", async () => {
    const { deps, getFake } = makeDeps({}, LIVE_ENV);
    const res = await new PortalRpaDriver(deps).runPortalSubmission({ ...input, mode: "LIVE" });
    expect(res.status).toBe("COMPLETED");
    expect(getFake().calls.filter((c) => c.selector === "button.final-submit").length).toBe(1);
    expect(res.cmsDisputeReferenceNumber).toBe(FAKE_CONFIRMATION_REFERENCE);
    expect(res.attestation?.actorId).toBe("user-1");
    expect(res.attestation?.attestedAt).toBeTruthy();
  });

  it("COMPLETED result feeds submission-fsm SUBMITTED -> ACKNOWLEDGED (integration)", async () => {
    const { deps } = makeDeps({}, LIVE_ENV);
    const res = await new PortalRpaDriver(deps).runPortalSubmission({ ...input, mode: "LIVE" });
    const entity = createSubmission("D-1", "T-1");
    transition(entity, "PACKAGE_READY");
    transition(entity, "SUBMITTED", { attestation: res.attestation! });
    transition(entity, "ACKNOWLEDGED", { cmsDisputeReferenceNumber: res.cmsDisputeReferenceNumber });
    expect(entity.state).toBe("ACKNOWLEDGED");
    expect(entity.cmsDisputeReferenceNumber).toBe(FAKE_CONFIRMATION_REFERENCE);
  });

  it("LIVE without a captured confirmation reference ends SUBMITTED_UNCONFIRMED (fail-closed)", async () => {
    const { deps } = makeDeps({ noConfirmationReference: true }, LIVE_ENV);
    const res = await new PortalRpaDriver(deps).runPortalSubmission({ ...input, mode: "LIVE" });
    expect(res.status).toBe("SUBMITTED_UNCONFIRMED");
    expect(res.cmsDisputeReferenceNumber).toBeUndefined();
    expect(res.attestation).toBeUndefined();
  });

  it("missing selector HALTs with CHECKPOINT_REQUIRED + screenshot evidence + resume token", async () => {
    const fields = { ...FAKE_PORTAL_FIELDS };
    // Force a DOM mismatch: point one PARTY_INFO selector at an absent element.
    const { deps } = makeDeps();
    const map = JSON.parse(JSON.stringify(defaultPortalMap));
    map.steps[3].fields[0].selectorStrategy.css = "#doesNotExist";
    const res = await new PortalRpaDriver({ ...deps, portalMap: map }).runPortalSubmission(input);
    expect(res.status).toBe("CHECKPOINT_REQUIRED");
    expect(res.checkpoint?.kind).toBe("SELECTOR_MISSING");
    expect(res.checkpoint?.stepId).toBe("PARTY_INFO");
    expect(res.checkpoint?.screenshotRef).toMatch(/^file:\/\//);
    expect(res.resumeToken).toBeTruthy();
    void fields;
  });

  it("ambiguous selector (resolves >1 element) HALTs with SELECTOR_AMBIGUOUS", async () => {
    const { deps } = makeDeps({
      duplicateSelector: { pageUrl: "https://nsa-idr.cms.gov/paymentdisputes/s/party-info", html: `<input id="initiatingPartyName"/>` },
    });
    const res = await new PortalRpaDriver(deps).runPortalSubmission(input);
    expect(res.status).toBe("CHECKPOINT_REQUIRED");
    expect(res.checkpoint?.kind).toBe("SELECTOR_AMBIGUOUS");
  });

  it("MFA challenge parks the run with kind MFA; resume with code completes", async () => {
    const { deps } = makeDeps({ mfa: true });
    const driver = new PortalRpaDriver(deps);
    const first = await driver.runPortalSubmission(input);
    expect(first.status).toBe("CHECKPOINT_REQUIRED");
    expect(first.checkpoint?.kind).toBe("MFA");
    // Resume without a code is rejected.
    await expect(driver.resumeRun(first.resumeToken!, input)).rejects.toThrow(/mfaCode/);
    // Resume with a code: MFA page -> dashboard -> full flow completes.
    const resumed = await driver.resumeRun(first.resumeToken!, input, { mfaCode: "000000" });
    expect(resumed.status).toBe("DRY_RUN_COMPLETE");
    // The MFA code itself must never appear in the timeline or result.
    expect(JSON.stringify(resumed)).not.toContain("000000");
  });

  it("CAPTCHA challenge parks the run with kind CAPTCHA", async () => {
    const { deps } = makeDeps({ captcha: true });
    const res = await new PortalRpaDriver(deps).runPortalSubmission(input);
    expect(res.status).toBe("CHECKPOINT_REQUIRED");
    expect(res.checkpoint?.kind).toBe("CAPTCHA");
  });

  it("idempotent: re-running a completed submission returns the prior result without a browser", async () => {
    const { deps, factoryCalls } = makeDeps();
    const driver = new PortalRpaDriver(deps);
    const first = await driver.runPortalSubmission(input);
    expect(first.status).toBe("DRY_RUN_COMPLETE");
    const second = await driver.runPortalSubmission(input);
    expect(second.runId).toBe(first.runId);
    expect(second.status).toBe("DRY_RUN_COMPLETE");
    expect(factoryCalls()).toBe(1);
  });

  it("credential resolution failure ends FAILED without launching the browser", async () => {
    const { deps, factoryCalls } = makeDeps();
    const failing = new PortalRpaDriver({
      ...deps,
      credentialResolver: { resolve: async () => { throw new Error("vault unavailable"); } },
    });
    const res = await failing.runPortalSubmission(input);
    expect(res.status).toBe("FAILED");
    expect(factoryCalls()).toBe(0);
  });

  it("sensitive values (TIN, password) are redacted in logs and results", async () => {
    const { deps } = makeDeps({}, LIVE_ENV);
    const res = await new PortalRpaDriver(deps).runPortalSubmission({ ...input, mode: "LIVE" });
    const blob = JSON.stringify(res);
    expect(blob).not.toContain(CREDS.password);
    expect(blob).not.toContain("12-3456789"); // initiatingPartyTin
    expect(blob).not.toContain("98-7654321"); // respondingPartyTin
    const tinEntry = res.filledFields.find((f) => f.portalFieldKey === "initiatingPartyTin");
    expect(tinEntry?.value).toBe("[REDACTED]");
    // Non-sensitive values are visible for auditability.
    const nameEntry = res.filledFields.find((f) => f.portalFieldKey === "initiatingPartyName");
    expect(nameEntry?.value).toBe("Acme Emergency Physicians");
  });

  it("redactValue honors explicit sensitive flag and key patterns", () => {
    expect(redactValue({ portalFieldKey: "initiatingPartyTin" }, "x")).toBe("[REDACTED]");
    expect(redactValue({ portalFieldKey: "claimNumber" }, "CLM-1")).toBe("CLM-1");
    expect(redactValue({ portalFieldKey: "whatever", sensitive: true }, "x")).toBe("[REDACTED]");
  });

  it("unknown resume token throws", async () => {
    const { deps } = makeDeps();
    await expect(new PortalRpaDriver(deps).resumeRun("nope", input, { mfaCode: "1" })).rejects.toThrow(/resume token/);
  });

  it("portalFields come straight from the package-builder output (seam check)", () => {
    const pkg = buildSubmissionPackage({
      initiatingPartyName: "Acme Emergency Physicians",
      initiatingPartyContactEmail: "idr@acme.example",
      initiatingPartyContactPhone: "555-0100",
      respondingPartyName: "Example Health Plan",
      respondingPartyContactEmail: "idr@plan.example",
      respondingPartyContactPhone: "555-0199",
      initiatingPartyTin: "12-3456789",
      claimNumber: "CLM-000123",
      serviceCode: "99285",
      dateOfService: "2026-08-01",
      billedCharge: 1850,
      qualifyingPaymentAmount: 490,
      initialPlanPayment: 380,
      openNegotiationInitiationDate: "2026-07-01",
      openNegotiationNoticeProofRef: "storage://proof/on-notice.pdf",
      certificationAttestedAt: "2026-09-05",
      certificationAttestorName: "J. Smith",
      supportingDocuments: ["storage://proof/on-notice.pdf"],
    });
    expect(pkg.complete).toBe(true);
    // Every required element key is present in portalFields — the exact flat
    // map shape the driver consumes.
    for (const k of ["initiatingPartyTin", "claimNumber", "qualifyingPaymentAmount"]) {
      expect(typeof pkg.portalFields[k]).toBe("string");
    }
  });
});
