/**
 * driver.browser.test.ts — REAL-BROWSER (headless chromium) tests against
 * the local TEST HARNESS only (test-harness/playwright-harness.ts).
 * These verify the driver against a real DOM engine, NOT the real portal.
 * If a chromium binary is unavailable the whole file is skipped and the
 * scenarios must be treated as STATIC-ONLY.
 */
import { describe, it, expect } from "vitest";
import { defaultPortalMap } from "./config";
import { PortalRpaDriver, InMemoryRunStore, type DriverDeps, type RunInput } from "./driver";
import { FAKE_PORTAL_FIELDS, FAKE_CONFIRMATION_REFERENCE } from "./test-harness/fake-portal";
import { createPlaywrightHarnessPage } from "./test-harness/playwright-harness";

const CREDS = { email: "rpa@acme.example", password: "super-secret-password-123" };
const LIVE_ENV = { RPA_LIVE_ENABLED: "true", RPA_TOS_ACKNOWLEDGED: "true" };

async function chromiumAvailable(): Promise<boolean> {
  try {
    const h = await createPlaywrightHarnessPage();
    await h.close();
    return true;
  } catch {
    return false;
  }
}

const hasBrowser = await chromiumAvailable();

function makeDeps(env: Record<string, string | undefined>, harnessOpts: Parameters<typeof createPlaywrightHarnessPage>[0] = {}) {
  let handles: Array<Awaited<ReturnType<typeof createPlaywrightHarnessPage>>> = [];
  const deps: DriverDeps = {
    portalMap: defaultPortalMap,
    credentialResolver: { resolve: async () => CREDS },
    runStore: new InMemoryRunStore(),
    env,
    pageFactory: async () => {
      // A resumed run (2nd+ page) of an MFA scenario restarts on the MFA page.
      const startUrl = harnessOpts.mfa && handles.length > 0
        ? "https://secure.login.gov/login/two_factor/authenticator"
        : undefined;
      const h = await createPlaywrightHarnessPage(harnessOpts, startUrl);
      handles.push(h);
      return h;
    },
  };
  return { deps, last: () => handles[handles.length - 1] };
}

const input: RunInput = {
  submissionId: "sub-browser-1",
  portalFields: { ...FAKE_PORTAL_FIELDS },
  credentialsRef: "TEST_CRED_REF",
  mode: "DRY_RUN",
  actorId: "user-1",
};

describe.skipIf(!hasBrowser)("portal-rpa driver (REAL chromium, fake-portal harness)", () => {
  it("DRY_RUN fills a real DOM but never clicks the final submit button", async () => {
    const { deps, last } = makeDeps({});
    const res = await new PortalRpaDriver(deps).runPortalSubmission(input);
    expect(res.status).toBe("DRY_RUN_COMPLETE");
    // Browser is closed by the driver after the run; assert via timeline.
    expect(res.timeline.filter((t) => t.action === "submit-clicked").length).toBe(0);
    expect(res.timeline.some((t) => t.action === "submit-skipped")).toBe(true);
    void last;
  }, 60_000);

  it("LIVE with both flags submits exactly once and captures the reference", async () => {
    const { deps, last } = makeDeps(LIVE_ENV);
    const res = await new PortalRpaDriver(deps).runPortalSubmission({ ...input, mode: "LIVE", submissionId: "sub-browser-2" });
    expect(res.status).toBe("COMPLETED");
    expect(res.cmsDisputeReferenceNumber).toBe(FAKE_CONFIRMATION_REFERENCE);
    expect(res.timeline.filter((t) => t.action === "submit-clicked").length).toBe(1);
    void last;
  }, 60_000);

  it("LIVE missing confirmation reference ends SUBMITTED_UNCONFIRMED", async () => {
    const { deps } = makeDeps(LIVE_ENV, { noConfirmationReference: true });
    const res = await new PortalRpaDriver(deps).runPortalSubmission({ ...input, mode: "LIVE", submissionId: "sub-browser-3" });
    expect(res.status).toBe("SUBMITTED_UNCONFIRMED");
  }, 60_000);

  it("MFA checkpoint parks; resume with code completes the flow", async () => {
    const { deps } = makeDeps({}, { mfa: true });
    const driver = new PortalRpaDriver(deps);
    const first = await driver.runPortalSubmission({ ...input, submissionId: "sub-browser-4" });
    expect(first.status).toBe("CHECKPOINT_REQUIRED");
    expect(first.checkpoint?.kind).toBe("MFA");
    const resumed = await driver.resumeRun(first.resumeToken!, { ...input, submissionId: "sub-browser-4" }, { mfaCode: "123456" });
    expect(resumed.status).toBe("DRY_RUN_COMPLETE");
  }, 60_000);
});
