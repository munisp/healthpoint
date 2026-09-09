/**
 * ============================================================================
 * TEST HARNESS — NOT THE REAL PORTAL (Playwright/chromium variant)
 * ============================================================================
 * playwright-harness.ts serves the SAME synthetic static HTML pages as
 * fake-portal.ts through a real headless chromium. All portal URLs are
 * intercepted with `page.route` and fulfilled with local static HTML, so
 * selectors run against a real DOM at real-looking URLs. Navigation buttons
 * navigate via location.href and are re-fulfilled by the route. This asserts
 * NOTHING about the real nsa-idr.cms.gov — the HTML is invented for testing
 * the driver's fail-closed engine.
 * ============================================================================
 */
import type { PageLike } from "../driver";
import { FAKE_URLS, FAKE_CONFIRMATION_REFERENCE, type FakePortalOptions } from "./fake-portal";

function pageHtml(url: string, o: FakePortalOptions): string {
  const go = (id: string, target: string, prevent = true) =>
    `<script>document.getElementById(${JSON.stringify(id)}).addEventListener("click",(e)=>{${prevent ? "e.preventDefault();" : ""}location.href=${JSON.stringify(target)}})</script>`;
  switch (url) {
    case FAKE_URLS.login: {
      const target = o.mfa ? FAKE_URLS.mfa : FAKE_URLS.dashboard;
      return `<html><body>
        ${o.captcha ? `<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>` : ""}
        <input id="user_email" type="email"/><input id="password_form_password" type="password"/>
        <button type="submit" id="signin">Sign in</button>${go("signin", target)}
      </body></html>`;
    }
    case FAKE_URLS.mfa:
      return `<html><body><form class="otp-verification-form">
        <label for="code">One-time security code</label><input name="code" id="otp_code"/>
        <button type="submit" id="otpSubmit">Submit</button></form>${go("otpSubmit", FAKE_URLS.dashboard)}
      </body></html>`;
    case FAKE_URLS.dashboard:
      return `<html><body><a href="${FAKE_URLS.initiate}" id="pd">Payment disputes</a></body></html>`;
    case FAKE_URLS.initiate:
      return `<html><body><input type="checkbox" class="terms"/>
        <button class="start-dispute" id="sd">Start a dispute</button>${go("sd", FAKE_URLS.party)}
      </body></html>`;
    case FAKE_URLS.party:
      return `<html><body>
        <input id="initiatingPartyName"/><input id="initiatingPartyContactEmail"/>
        <input id="initiatingPartyContactPhone"/><input id="initiatingPartyTin"/>
        <input id="initiatingPartyNpi"/><input id="respondingPartyName"/>
        <input id="respondingPartyContactEmail"/><input id="respondingPartyContactPhone"/>
        <input id="respondingPartyTin"/>
        ${o.duplicateSelector && o.duplicateSelector.pageUrl === url ? o.duplicateSelector.html : ""}
        <button class="next" id="n1">Next</button>${go("n1", FAKE_URLS.item)}
      </body></html>`;
    case FAKE_URLS.item:
      return `<html><body>
        <input id="claimNumber"/><input id="serviceCode"/><input id="dateOfService"/>
        <input id="billedCharge"/><input id="qualifyingPaymentAmount"/>
        <input id="initialPlanPayment"/><input id="initiatingOffer"/>
        <button class="next" id="n2">Next</button>${go("n2", FAKE_URLS.negotiation)}
      </body></html>`;
    case FAKE_URLS.negotiation:
      return `<html><body>
        <input id="openNegotiationInitiationDate"/><input id="openNegotiationNoticeProofRef"/>
        <input id="certificationAttestorName"/><input id="certificationAttestedAt"/>
        <input type="checkbox" id="attestationCheckbox"/>
        <button class="next" id="n3">Next</button>${go("n3", FAKE_URLS.documents)}
      </body></html>`;
    case FAKE_URLS.documents:
      return `<html><body><input type="file" id="docUpload"/>
        <button class="next" id="n4">Next</button>${go("n4", FAKE_URLS.review)}
      </body></html>`;
    case FAKE_URLS.review:
      return `<html><body><button class="next" id="n5">Continue to submit</button>${go("n5", FAKE_URLS.submit)}
      </body></html>`;
    case FAKE_URLS.submit:
      return `<html><body><button class="final-submit" id="fs">Submit Notice of IDR Initiation</button>
        <script>document.getElementById("fs").addEventListener("click",()=>{localStorage.setItem("__submitClicks",String((+localStorage.getItem("__submitClicks")||0)+1));location.href=${JSON.stringify(FAKE_URLS.confirmation)}})</script>
      </body></html>`;
    case FAKE_URLS.confirmation:
      return `<html><body><h1>Submission received</h1>
        ${o.noConfirmationReference ? "" : `<span class="dispute-reference-number">Dispute Reference Number: ${FAKE_CONFIRMATION_REFERENCE}</span>`}
      </body></html>`;
    default:
      return `<html><body></body></html>`;
  }
}

/** Requires playwright + a chromium binary. Throws if unavailable — callers
 * (tests) must catch and skip with a STATIC-ONLY label. */
export async function createPlaywrightHarnessPage(
  opts: FakePortalOptions = {},
  /** Harness resume support: a parked MFA run restarts on the MFA page
   * (production restores parked storage state instead). */
  startUrl: string = FAKE_URLS.login
): Promise<{
  page: PageLike;
  close(): Promise<void>;
  submitClicks(): Promise<number>;
}> {
  const pw = await import("playwright");
  const browser = await pw.chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Route every request to our synthetic pages; CAPTCHA iframe assets are
  // fulfilled so the <iframe> tag exists in the DOM for checkpoint detection.
  await page.route("**/*", (route) => {
    const url = route.request().url();
    const isCaptchaAsset = /recaptcha|hcaptcha/.test(url);
    if (isCaptchaAsset) {
      return route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" });
    }
    return route.fulfill({ status: 200, contentType: "text/html", body: pageHtml(url, opts) });
  });
  await page.goto(startUrl);

  const like: PageLike = {
    url: () => page.url(),
    content: () => page.content(),
    goto: async (u) => { await page.goto(u); },
    count: (css) => page.locator(css).count(),
    countXPath: (xp) => page.locator(`xpath=${xp}`).count(),
    countByLabel: (l) => page.getByLabel(l).count(),
    fill: (css, v) => page.locator(css).fill(v),
    click: async (css) => {
      await page.locator(css).click();
      // Route-fulfilled navigation is near-instant; brief settle covers it.
      await page.waitForTimeout(100);
      await page.waitForLoadState("load").catch(() => undefined);
    },
    setFiles: async (css, paths) => { await page.locator(css).setInputFiles(paths); },
    text: async (css) => {
      // Never wait for an absent element — check count first (fail-closed fast).
      if ((await page.locator(css).count()) === 0) return null;
      return page.locator(css).first().textContent().catch(() => null);
    },
    textByLabel: async (l) => (await page.getByLabel(l).first().textContent().catch(() => null)),
    screenshot: () => page.screenshot({ fullPage: true }),
    storageState: () => ctx.storageState().then((s) => JSON.stringify(s)),
  };
  return {
    page: like,
    close: () => browser.close().then(() => undefined),
    submitClicks: () =>
      page.evaluate(() => Number(localStorage.getItem("__submitClicks") ?? "0")).catch(() => 0),
  };
}
