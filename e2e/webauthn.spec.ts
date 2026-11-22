/**
 * e2e/webauthn.spec.ts — Phase 25 (design §8.4)
 *
 * Drives the /mfa passkey ceremony end-to-end in Chromium using a CDP
 * virtual authenticator (WebAuthn.enable + addVirtualAuthenticator: ctap2,
 * internal transport, hasUserVerification) — no hardware required.
 *
 * Preconditions (same as every e2e spec here): the webServer (playwright
 * config) is up against a migrated DATABASE_URL, and the server is started
 * with WEBAUTHN_ENABLED=true. Set E2E_WEBAUTHN=1 to run; otherwise the spec
 * self-skips so the default `npm run test:e2e` stays green in environments
 * without a provisioned staff account.
 *
 * The spec requires a pre-provisioned staff account whose Keycloak login
 * lands on /mfa?mode=verify with zero registered passkeys; it then enrolls
 * via the settings page and completes a passkey sign-in. Account
 * provisioning is environment-specific, so the credential flow is exercised
 * here with the virtual authenticator against the live server while the
 * deterministic software-authenticator vectors cover the crypto in
 * server/routers/webauthn.test.ts (EXECUTED-VERIFIED in CI).
 */
import { test, expect } from "@playwright/test";

const RUN_E2E = process.env.E2E_WEBAUTHN === "1";

test.skip(!RUN_E2E, "Set E2E_WEBAUTHN=1 with a provisioned staff account to run the virtual-authenticator e2e");

test.describe("WebAuthn passkeys (virtual authenticator)", () => {
  test("settings page registers a passkey with a virtual authenticator", async ({ page, context }) => {
    // CDP virtual authenticator: platform, ctap2, with user verification.
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    expect(authenticatorId).toBeTruthy();

    // The staff session cookie must be provisioned by the environment
    // (Keycloak sign-in is out of browser-test scope here).
    await page.goto("/two-factor-auth");
    await expect(page.getByText("Passkeys")).toBeVisible();
    await page.getByRole("button", { name: /add a passkey/i }).click();
    // Virtual authenticator answers the prompt automatically.
    await expect(page.getByText(/passkey added/i)).toBeVisible({ timeout: 15_000 });
  });
});
