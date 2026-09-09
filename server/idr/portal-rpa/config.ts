/**
 * config.ts — externalized, versioned map of the federal IDR portal
 * dispute-initiation flow for the portal RPA driver.
 *
 * FAIL-CLOSED contract: `loadPortalMap` throws PortalMapError for any
 * unknown, malformed, or version-mismatched map. The driver refuses to run
 * against a map it does not recognize.
 *
 * PROVENANCE / VERIFICATION STATUS
 * --------------------------------
 * The default map below is derived ONLY from publicly documented portal
 * structure. It has NOT been validated against the live portal; every
 * selector is stamped `unverified: true` and the driver reports this.
 * Sources (all accessed 2026-09-05):
 *   1. CMS, "Notice of Independent Dispute Resolution (IDR) Initiation Web
 *      Form User Guide / Job Aid":
 *      https://www.cms.gov/files/document/idr-notice-initiation-job-aid.pdf
 *   2. CMS, "Federal Independent Dispute Resolution (IDR) Process Guidance
 *      for Disputing Parties" (portal submission requirement, ref display):
 *      https://www.cms.gov/files/document/federal-idr-guidance-disputing-parties-march-2023.pdf
 *   3. CMS, "About Independent Dispute Resolution — Start A Dispute"
 *      (required data elements):
 *      https://www.cms.gov/initiatives/no-surprise-billing/overview/engaging-idr/about-independent-dispute-resolution
 *   4. Public initiation form entry point (Salesforce community):
 *      https://nsa-idr.cms.gov/paymentdisputes/s/
 *   5. login.gov authentication help (MFA methods):
 *      https://www.login.gov/help/
 * None of these documents publish DOM selectors; selector strategies below
 * are best-effort placeholders that MUST be validated against the live
 * portal during a supervised dry-run shadow period before any LIVE enable.
 */

export const PORTAL_MAP_VERSION = "1.0.0";

export class PortalMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortalMapError";
  }
}

export type PortalInputType =
  | "text"
  | "email"
  | "tel"
  | "date"
  | "currency"
  | "select"
  | "checkbox"
  | "textarea"
  | "file"
  | "button";

export interface SelectorStrategy {
  /** CSS selector (preferred). */
  css?: string;
  /** XPath fallback. */
  xpath?: string;
  /** Accessible label text fallback. */
  labelText?: string;
}

export interface PortalFieldDef {
  /** Key into `portalFields` produced by package-builder (or a control key). */
  portalFieldKey: string;
  selectorStrategy: SelectorStrategy;
  inputType: PortalInputType;
  /** True when the value is sensitive (TIN etc.) and must be redacted in logs. */
  sensitive?: boolean;
  /** Navigation/submission control: clicking it advances the flow. */
  action?: "navigate" | "submit";
  /** Always true for the shipped map — selector not validated against live portal. */
  unverified: boolean;
}

export interface PortalStepDef {
  stepId: string;
  /** Regex source; the page URL must match before the step executes. */
  urlPattern: string;
  /** Optional URL to navigate to before asserting urlPattern. */
  entryUrl?: string;
  fields: PortalFieldDef[];
  evidenceRequired: boolean;
  /** Per-step timeout override (ms); default applied by driver. */
  timeoutMs?: number;
}

export interface PortalMap {
  version: string;
  baseUrl: string;
  steps: PortalStepDef[];
  checkpoints: {
    /** login.gov MFA / OTP challenge indicators. */
    mfa: SelectorStrategy[];
    /** Selector to fill when resuming an MFA checkpoint with a code. */
    mfaCodeInput?: SelectorStrategy;
    /** CAPTCHA iframe / widget indicators. */
    captcha: SelectorStrategy[];
  };
  confirmation: {
    /** Selectors scanned for the CMS dispute reference number after submit. */
    referenceSelectors: SelectorStrategy[];
    /** Regex source the extracted confirmation text must match. */
    referencePattern: string;
  };
}

// ---------------------------------------------------------------------------
// Default portal map — STATIC-ONLY, selectors unverified (see header).
// ---------------------------------------------------------------------------

const field = (
  portalFieldKey: string,
  css: string,
  inputType: PortalInputType,
  extra: Partial<PortalFieldDef> = {}
): PortalFieldDef => ({
  portalFieldKey,
  selectorStrategy: { css },
  inputType,
  unverified: true,
  ...extra,
});

export const defaultPortalMap: PortalMap = {
  version: PORTAL_MAP_VERSION,
  baseUrl: "https://nsa-idr.cms.gov",
  steps: [
    {
      stepId: "LOGIN",
      urlPattern: "^https://(secure\\.)?login\\.gov/",
      entryUrl: "https://secure.login.gov/",
      evidenceRequired: true,
      fields: [
        field("credential:email", "#user_email", "email", { sensitive: true }),
        field("credential:password", "#password_form_password", "text", { sensitive: true }),
        field("control:signIn", "button[type='submit']", "button", { action: "navigate" }),
      ],
    },
    {
      stepId: "DASHBOARD",
      urlPattern: "^https://nsa-idr\\.cms\\.gov/(s/)?$",
      evidenceRequired: true,
      fields: [
        field("control:paymentDisputes", "a[href*='/paymentdisputes/s/']", "button", { action: "navigate" }),
      ],
    },
    {
      stepId: "INITIATE_DISPUTE",
      urlPattern: "^https://nsa-idr\\.cms\\.gov/paymentdisputes/s/",
      evidenceRequired: true,
      fields: [
        field("control:acceptTerms", "input[type='checkbox'].terms", "checkbox"),
        field("control:startDispute", "button.start-dispute", "button", { action: "navigate" }),
      ],
    },
    {
      stepId: "PARTY_INFO",
      urlPattern: "^https://nsa-idr\\.cms\\.gov/paymentdisputes/s/.*(party|initiat)",
      evidenceRequired: true,
      fields: [
        field("initiatingPartyName", "#initiatingPartyName", "text"),
        field("initiatingPartyContactEmail", "#initiatingPartyContactEmail", "email"),
        field("initiatingPartyContactPhone", "#initiatingPartyContactPhone", "tel"),
        field("initiatingPartyTin", "#initiatingPartyTin", "text", { sensitive: true }),
        field("initiatingPartyNpi", "#initiatingPartyNpi", "text"),
        field("respondingPartyName", "#respondingPartyName", "text"),
        field("respondingPartyContactEmail", "#respondingPartyContactEmail", "email"),
        field("respondingPartyContactPhone", "#respondingPartyContactPhone", "tel"),
        field("respondingPartyTin", "#respondingPartyTin", "text", { sensitive: true }),
        field("control:next", "button.next", "button", { action: "navigate" }),
      ],
    },
    {
      stepId: "ITEM_SERVICE_INFO",
      urlPattern: "^https://nsa-idr\\.cms\\.gov/paymentdisputes/s/.*(item|service)",
      evidenceRequired: true,
      fields: [
        field("claimNumber", "#claimNumber", "text"),
        field("serviceCode", "#serviceCode", "text"),
        field("dateOfService", "#dateOfService", "date"),
        field("billedCharge", "#billedCharge", "currency"),
        field("qualifyingPaymentAmount", "#qualifyingPaymentAmount", "currency"),
        field("initialPlanPayment", "#initialPlanPayment", "currency"),
        field("initiatingOffer", "#initiatingOffer", "currency"),
        field("control:next", "button.next", "button", { action: "navigate" }),
      ],
    },
    {
      stepId: "OPEN_NEGOTIATION_INFO",
      urlPattern: "^https://nsa-idr\\.cms\\.gov/paymentdisputes/s/.*(negotiation|attest)",
      evidenceRequired: true,
      fields: [
        field("openNegotiationInitiationDate", "#openNegotiationInitiationDate", "date"),
        field("openNegotiationNoticeProofRef", "#openNegotiationNoticeProofRef", "text"),
        field("certificationAttestorName", "#certificationAttestorName", "text"),
        field("certificationAttestedAt", "#certificationAttestedAt", "date"),
        field("control:attestation", "#attestationCheckbox", "checkbox"),
        field("control:next", "button.next", "button", { action: "navigate" }),
      ],
    },
    {
      stepId: "DOCUMENT_UPLOAD",
      urlPattern: "^https://nsa-idr\\.cms\\.gov/paymentdisputes/s/.*(document|upload)",
      evidenceRequired: true,
      fields: [
        field("supportingDocuments", "input[type='file']", "file"),
        field("control:next", "button.next", "button", { action: "navigate" }),
      ],
    },
    {
      stepId: "REVIEW",
      urlPattern: "^https://nsa-idr\\.cms\\.gov/paymentdisputes/s/.*(review)",
      evidenceRequired: true,
      fields: [
        field("control:next", "button.next", "button", { action: "navigate" }),
      ],
    },
    {
      stepId: "SUBMIT",
      urlPattern: "^https://nsa-idr\\.cms\\.gov/paymentdisputes/s/.*(submit|review)",
      evidenceRequired: true,
      fields: [
        // The ONLY field with action "submit". DRY_RUN never clicks it;
        // LIVE clicks it exactly once (no retries — never double-file).
        field("control:finalSubmit", "button.final-submit", "button", { action: "submit" }),
      ],
    },
    {
      stepId: "CONFIRMATION",
      urlPattern: "^https://nsa-idr\\.cms\\.gov/paymentdisputes/s/.*(confirm|thank)",
      evidenceRequired: true,
      fields: [],
    },
  ],
  checkpoints: {
    mfa: [
      { css: "form.otp-verification-form" },
      { css: "input[name='code']" },
      { labelText: "One-time security code" },
    ],
    mfaCodeInput: { css: "input[name='code']" },
    captcha: [
      { css: "iframe[src*='recaptcha']" },
      { css: "iframe[src*='hcaptcha']" },
      { css: ".g-recaptcha" },
    ],
  },
  confirmation: {
    referenceSelectors: [
      { css: ".dispute-reference-number" },
      { css: "#confirmationReference" },
      { labelText: "Dispute Reference Number" },
    ],
    // CMS dispute reference numbers are displayed on the confirmation screen;
    // exact format is unverified — pattern intentionally permissive.
    referencePattern: "\\b[A-Z]{2,5}-?\\d{4}-?\\d{4,}\\b",
  },
};

// ---------------------------------------------------------------------------
// Loading & validation — fail-closed.
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function assertSelectorStrategy(v: unknown, where: string): asserts v is SelectorStrategy {
  if (!isRecord(v)) throw new PortalMapError(`${where}: selectorStrategy must be an object`);
  if (typeof v.css !== "string" && typeof v.xpath !== "string" && typeof v.labelText !== "string") {
    throw new PortalMapError(`${where}: selectorStrategy requires at least one of css/xpath/labelText`);
  }
}

const INPUT_TYPES: ReadonlySet<string> = new Set([
  "text", "email", "tel", "date", "currency", "select", "checkbox", "textarea", "file", "button",
]);

function validateStep(v: unknown, idx: number): PortalStepDef {
  const where = `steps[${idx}]`;
  if (!isRecord(v)) throw new PortalMapError(`${where}: must be an object`);
  if (typeof v.stepId !== "string" || v.stepId.length === 0) throw new PortalMapError(`${where}.stepId required`);
  if (typeof v.urlPattern !== "string" || v.urlPattern.length === 0) throw new PortalMapError(`${where}.urlPattern required`);
  try { new RegExp(v.urlPattern); } catch { throw new PortalMapError(`${where}.urlPattern is not a valid regex`); }
  if (v.entryUrl !== undefined && typeof v.entryUrl !== "string") throw new PortalMapError(`${where}.entryUrl must be a string`);
  if (!Array.isArray(v.fields)) throw new PortalMapError(`${where}.fields must be an array`);
  if (typeof v.evidenceRequired !== "boolean") throw new PortalMapError(`${where}.evidenceRequired must be boolean`);
  if (v.timeoutMs !== undefined && (typeof v.timeoutMs !== "number" || v.timeoutMs <= 0)) {
    throw new PortalMapError(`${where}.timeoutMs must be a positive number`);
  }
  v.fields.forEach((f: unknown, i: number) => {
    const fw = `${where}.fields[${i}]`;
    if (!isRecord(f)) throw new PortalMapError(`${fw}: must be an object`);
    if (typeof f.portalFieldKey !== "string" || f.portalFieldKey.length === 0) {
      throw new PortalMapError(`${fw}.portalFieldKey required`);
    }
    if (!INPUT_TYPES.has(String(f.inputType))) throw new PortalMapError(`${fw}.inputType invalid`);
    if (f.action !== undefined && f.action !== "navigate" && f.action !== "submit") {
      throw new PortalMapError(`${fw}.action must be "navigate" | "submit"`);
    }
    if (f.unverified !== true) {
      throw new PortalMapError(`${fw}.unverified must be true (no selector may claim live validation)`);
    }
    assertSelectorStrategy(f.selectorStrategy, fw);
  });
  return v as unknown as PortalStepDef;
}

export function validatePortalMap(raw: unknown): PortalMap {
  if (!isRecord(raw)) throw new PortalMapError("portal map must be an object");
  if (raw.version !== PORTAL_MAP_VERSION) {
    throw new PortalMapError(
      `portal map version mismatch: expected ${PORTAL_MAP_VERSION}, got ${String(raw.version)}`
    );
  }
  if (typeof raw.baseUrl !== "string" || !/^https:\/\//.test(raw.baseUrl)) {
    throw new PortalMapError("baseUrl must be an https URL");
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    throw new PortalMapError("steps must be a non-empty array");
  }
  const steps = raw.steps.map(validateStep);
  const submitSteps = steps.filter((s) => s.fields.some((f) => f.action === "submit"));
  if (submitSteps.length !== 1) {
    throw new PortalMapError("exactly one step may contain a submit action (never double-file)");
  }
  if (!isRecord(raw.checkpoints)) throw new PortalMapError("checkpoints required");
  if (!Array.isArray(raw.checkpoints.mfa)) throw new PortalMapError("checkpoints.mfa must be an array");
  if (!Array.isArray(raw.checkpoints.captcha)) throw new PortalMapError("checkpoints.captcha must be an array");
  raw.checkpoints.mfa.forEach((s: unknown, i: number) => assertSelectorStrategy(s, `checkpoints.mfa[${i}]`));
  raw.checkpoints.captcha.forEach((s: unknown, i: number) => assertSelectorStrategy(s, `checkpoints.captcha[${i}]`));
  if (raw.checkpoints.mfaCodeInput !== undefined) assertSelectorStrategy(raw.checkpoints.mfaCodeInput, "checkpoints.mfaCodeInput");
  if (!isRecord(raw.confirmation)) throw new PortalMapError("confirmation required");
  if (!Array.isArray(raw.confirmation.referenceSelectors) || raw.confirmation.referenceSelectors.length === 0) {
    throw new PortalMapError("confirmation.referenceSelectors must be a non-empty array");
  }
  raw.confirmation.referenceSelectors.forEach((s: unknown, i: number) =>
    assertSelectorStrategy(s, `confirmation.referenceSelectors[${i}]`)
  );
  if (typeof raw.confirmation.referencePattern !== "string") {
    throw new PortalMapError("confirmation.referencePattern required");
  }
  try { new RegExp(raw.confirmation.referencePattern); } catch {
    throw new PortalMapError("confirmation.referencePattern is not a valid regex");
  }
  return { ...(raw as unknown as PortalMap), steps };
}

export interface PortalMapEnv {
  /** Inline JSON map, or a filesystem path to a JSON map file. */
  PORTAL_MAP_JSON?: string;
}

/**
 * Load the portal map. Without PORTAL_MAP_JSON the built-in default is
 * returned (it is itself validated). With it, the value is treated as inline
 * JSON when it starts with "{", otherwise as a path. Any failure throws
 * PortalMapError — the caller must not fall back silently.
 */
export function loadPortalMap(env: PortalMapEnv = process.env): PortalMap {
  const override = env.PORTAL_MAP_JSON?.trim();
  if (!override) return validatePortalMap(defaultPortalMap);
  let rawText: string;
  if (override.startsWith("{")) {
    rawText = override;
  } else {
    // Node-only path branch (dynamic require to keep this file runtime-agnostic).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("node:fs") as typeof import("node:fs");
    try {
      rawText = fs.readFileSync(override, "utf8");
    } catch (err) {
      throw new PortalMapError(
        `PORTAL_MAP_JSON path unreadable: ${override} (${err instanceof Error ? err.message : String(err)})`
      );
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new PortalMapError("PORTAL_MAP_JSON is not valid JSON");
  }
  return validatePortalMap(parsed);
}

/** Count of selectors that have never been validated against the live portal. */
export function countUnverifiedSelectors(map: PortalMap): number {
  let n = 0;
  for (const s of map.steps) for (const f of s.fields) if (f.unverified) n++;
  // Checkpoint and confirmation selectors are likewise live-portal selectors.
  n += map.checkpoints.mfa.length + map.checkpoints.captcha.length;
  n += map.checkpoints.mfaCodeInput ? 1 : 0;
  n += map.confirmation.referenceSelectors.length;
  return n;
}
