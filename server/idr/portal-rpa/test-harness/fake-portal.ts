/**
 * ============================================================================
 * TEST HARNESS — NOT THE REAL PORTAL
 * ============================================================================
 * fake-portal.ts models a tiny synthetic 10-page flow (login -> dashboard ->
 * initiate -> party info -> item/service -> negotiation/attestation ->
 * documents -> review -> submit -> confirmation) as static HTML strings.
 * It implements the driver's PageLike interface with a deliberately minimal
 * selector engine (supports '#id', '.class', 'tag', 'tag[attr=...]',
 * 'iframe[src*=...]', 'button[type=...]', 'input[type=...]') sufficient for
 * unit tests of driver FAIL-CLOSED logic. It asserts NOTHING about the real
 * nsa-idr.cms.gov DOM — all live-portal selectors remain UNVERIFIED.
 *
 * When Playwright is available, the same HTML strings can be served via
 * page.setContent for a real-browser round-trip; that path is labeled
 * STATIC-ONLY unless executed in CI with a chromium binary.
 * ============================================================================
 */
import type { PageLike } from "../driver";

export interface FakePortalOptions {
  /** Insert an MFA challenge page after LOGIN submit. */
  mfa?: boolean;
  /** Insert a CAPTCHA widget on the login page. */
  captcha?: boolean;
  /** Omit the confirmation reference element (failure mode). */
  noConfirmationReference?: boolean;
  /** Duplicate an element matching this CSS selector (ambiguity failure mode). */
  duplicateSelector?: { pageUrl: string; html: string };
}

const REF = "IDR-2026-987654";

function loginPage(o: FakePortalOptions): string {
  return `<html><body>
    ${o.captcha ? `<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>` : ""}
    <input id="user_email" type="email"/>
    <input id="password_form_password" type="password"/>
    <button type="submit">Sign in</button>
  </body></html>`;
}

const MFA_PAGE = `<html><body>
  <form class="otp-verification-form">
    <label for="code">One-time security code</label>
    <input name="code" id="otp_code"/>
    <button type="submit">Submit</button>
  </form>
</body></html>`;

const DASHBOARD = `<html><body>
  <a href="/paymentdisputes/s/">Payment disputes</a>
</body></html>`;

const INITIATE = `<html><body>
  <input type="checkbox" class="terms"/>
  <button class="start-dispute">Start a dispute</button>
</body></html>`;

const PARTY = `<html><body>
  <input id="initiatingPartyName"/><input id="initiatingPartyContactEmail"/>
  <input id="initiatingPartyContactPhone"/><input id="initiatingPartyTin"/>
  <input id="initiatingPartyNpi"/><input id="respondingPartyName"/>
  <input id="respondingPartyContactEmail"/><input id="respondingPartyContactPhone"/>
  <input id="respondingPartyTin"/>
  <button class="next">Next</button>
</body></html>`;

const ITEM = `<html><body>
  <input id="claimNumber"/><input id="serviceCode"/><input id="dateOfService"/>
  <input id="billedCharge"/><input id="qualifyingPaymentAmount"/>
  <input id="initialPlanPayment"/><input id="initiatingOffer"/>
  <button class="next">Next</button>
</body></html>`;

const NEGOTIATION = `<html><body>
  <input id="openNegotiationInitiationDate"/><input id="openNegotiationNoticeProofRef"/>
  <input id="certificationAttestorName"/><input id="certificationAttestedAt"/>
  <input type="checkbox" id="attestationCheckbox"/>
  <button class="next">Next</button>
</body></html>`;

const DOCUMENTS = `<html><body>
  <input type="file" id="docUpload"/>
  <button class="next">Next</button>
</body></html>`;

const REVIEW = `<html><body>
  <button class="next">Continue to submit</button>
</body></html>`;

const SUBMIT = `<html><body>
  <button class="final-submit">Submit Notice of IDR Initiation</button>
</body></html>`;

function confirmationPage(o: FakePortalOptions): string {
  return `<html><body>
    <h1>Submission received</h1>
    ${o.noConfirmationReference ? "" : `<span class="dispute-reference-number">Dispute Reference Number: ${REF}</span>`}
  </body></html>`;
}

export const FAKE_URLS = {
  login: "https://secure.login.gov/",
  mfa: "https://secure.login.gov/login/two_factor/authenticator",
  dashboard: "https://nsa-idr.cms.gov/",
  initiate: "https://nsa-idr.cms.gov/paymentdisputes/s/initiate",
  party: "https://nsa-idr.cms.gov/paymentdisputes/s/party-info",
  item: "https://nsa-idr.cms.gov/paymentdisputes/s/item-service",
  negotiation: "https://nsa-idr.cms.gov/paymentdisputes/s/negotiation-attest",
  documents: "https://nsa-idr.cms.gov/paymentdisputes/s/document-upload",
  review: "https://nsa-idr.cms.gov/paymentdisputes/s/review",
  submit: "https://nsa-idr.cms.gov/paymentdisputes/s/submit",
  confirmation: "https://nsa-idr.cms.gov/paymentdisputes/s/confirmation",
} as const;

export const FAKE_CONFIRMATION_REFERENCE = REF;

/**
 * Fake page for tests. `goto` and navigation clicks move through FAKE_URLS.
 * Tracks fill/click calls so tests can assert "never submitted" in DRY_RUN.
 */
export function createFakePortalPage(opts: FakePortalOptions = {}): {
  page: PageLike;
  close(): Promise<void>;
  calls: Array<{ op: string; selector?: string; value?: string }>;
} {
  const calls: Array<{ op: string; selector?: string; value?: string }> = [];
  let currentUrl = FAKE_URLS.login;
  let mfaCleared = false; // one-shot: a completed MFA challenge is not re-issued

  function htmlFor(url: string): string {
    let html: string;
    switch (url) {
      case FAKE_URLS.login: html = loginPage(opts); break;
      case FAKE_URLS.mfa: html = MFA_PAGE; break;
      case FAKE_URLS.dashboard: html = DASHBOARD; break;
      case FAKE_URLS.initiate: html = INITIATE; break;
      case FAKE_URLS.party: html = PARTY; break;
      case FAKE_URLS.item: html = ITEM; break;
      case FAKE_URLS.negotiation: html = NEGOTIATION; break;
      case FAKE_URLS.documents: html = DOCUMENTS; break;
      case FAKE_URLS.review: html = REVIEW; break;
      case FAKE_URLS.submit: html = SUBMIT; break;
      case FAKE_URLS.confirmation: html = confirmationPage(opts); break;
      default: html = `<html><body></body></html>`;
    }
    if (opts.duplicateSelector && opts.duplicateSelector.pageUrl === url) {
      html = html.replace("</body>", `${opts.duplicateSelector.html}</body>`);
    }
    return html;
  }

  /** Minimal CSS matcher against the current page's HTML. */
  function matches(css: string, html: string): number {
    const tags = html.match(/<(?:input|button|a|iframe|form|span|label)[^>]*>/g) ?? [];
    let n = 0;
    for (const tag of tags) {
      if (tagMatches(tag, css)) n++;
    }
    return n;
  }

  function tagMatches(tag: string, css: string): boolean {
    // Optional trailing '.class' (handles compounds like input[type='x'].cls)
    let cls: string | null = null;
    const clsSuffix = css.match(/\.([\w-]+)$/);
    let head = css;
    if (clsSuffix && !css.startsWith(".")) {
      cls = clsSuffix[1];
      head = css.slice(0, css.length - clsSuffix[0].length);
    }
    if (cls && !new RegExp(`class="[^"]*\\b${cls}\\b`).test(tag)) return false;
    // '#id'
    const idM = head.match(/^#([\w-]+)$/);
    if (idM) return new RegExp(`id="${idM[1]}"`).test(tag);
    // '.class' alone
    const clsOnlyM = css.match(/^\.([\w-]+)$/);
    if (clsOnlyM) return new RegExp(`class="[^"]*\\b${clsOnlyM[1]}\\b`).test(tag);
    // 'tag[attr='val']' with optional * substring match
    const attrM = head.match(/^(\w+)\[([\w-]+)(\*)?='([^']+)'\]$/);
    if (attrM) {
      const [, tagName, attr, substr, val] = attrM;
      if (!tag.startsWith(`<${tagName}`)) return false;
      const m = tag.match(new RegExp(`${attr}="([^"]*)"`));
      if (!m) return false;
      return substr ? m[1].includes(val) : m[1] === val;
    }
    // bare 'tag'
    const bareM = head.match(/^(\w+)$/);
    if (bareM) return tag.startsWith(`<${bareM[1]}`);
    return false;
  }

  /** Navigation table: clicking a control on a page moves to the next URL. */
  function navTarget(url: string, css: string): string | null {
    if (url === FAKE_URLS.login && css === "button[type='submit']") {
      return opts.mfa && !mfaCleared ? FAKE_URLS.mfa : FAKE_URLS.dashboard;
    }
    if (url === FAKE_URLS.mfa && css === "button[type='submit']") {
      mfaCleared = true;
      return FAKE_URLS.dashboard;
    }
    if (url === FAKE_URLS.dashboard) return FAKE_URLS.initiate;
    if (url === FAKE_URLS.initiate && css.includes("start-dispute")) return FAKE_URLS.party;
    if (url === FAKE_URLS.party && css.includes("next")) return FAKE_URLS.item;
    if (url === FAKE_URLS.item && css.includes("next")) return FAKE_URLS.negotiation;
    if (url === FAKE_URLS.negotiation && css.includes("next")) return FAKE_URLS.documents;
    if (url === FAKE_URLS.documents && css.includes("next")) return FAKE_URLS.review;
    if (url === FAKE_URLS.review && css.includes("next")) return FAKE_URLS.submit;
    if (url === FAKE_URLS.submit && css.includes("final-submit")) return FAKE_URLS.confirmation;
    return null;
  }

  const page: PageLike = {
    url: () => currentUrl,
    content: async () => htmlFor(currentUrl),
    goto: async (u) => { currentUrl = u; },
    count: async (css) => matches(css, htmlFor(currentUrl)),
    fill: async (css, value) => { calls.push({ op: "fill", selector: css, value }); },
    click: async (css) => {
      calls.push({ op: "click", selector: css });
      const next = navTarget(currentUrl, css);
      if (next) currentUrl = next;
    },
    setFiles: async (css, paths) => { calls.push({ op: "setFiles", selector: css, value: paths.join(",") }); },
    text: async (css) => {
      const html = htmlFor(currentUrl);
      const m = html.match(new RegExp(`<span class="${css.replace(/^\./, "")}">([^<]*)</span>`));
      return m ? m[1] : null;
    },
    textByLabel: async () => null,
    screenshot: async () => Buffer.from(`FAKE-SCREENSHOT:${currentUrl}`),
    storageState: async () => JSON.stringify({ fake: true, url: currentUrl }),
  };

  return { page, calls, close: async () => undefined };
}

/** portalFields fixture covering every non-credential key in the default map. */
export const FAKE_PORTAL_FIELDS: Record<string, string> = {
  initiatingPartyName: "Acme Emergency Physicians",
  initiatingPartyContactEmail: "idr@acme.example",
  initiatingPartyContactPhone: "555-0100",
  initiatingPartyTin: "12-3456789",
  initiatingPartyNpi: "1234567890",
  respondingPartyName: "Example Health Plan",
  respondingPartyContactEmail: "idr@plan.example",
  respondingPartyContactPhone: "555-0199",
  respondingPartyTin: "98-7654321",
  claimNumber: "CLM-000123",
  serviceCode: "99285",
  dateOfService: "2026-08-01",
  billedCharge: "1850.00",
  qualifyingPaymentAmount: "490.00",
  initialPlanPayment: "380.00",
  initiatingOffer: "1500.00",
  openNegotiationInitiationDate: "2026-07-01",
  openNegotiationNoticeProofRef: "storage://proof/on-notice.pdf",
  certificationAttestorName: "J. Smith",
  certificationAttestedAt: "2026-09-05",
};
