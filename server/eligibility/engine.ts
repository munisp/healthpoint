/**
 * server/eligibility/engine.ts
 *
 * Phase 17 (E6): deterministic NSA/IDR eligibility rule chain over normalized
 * practice claims. COMPOSES existing modules — no rule logic is duplicated:
 *  - jurisdiction / state-program routing   (server/idr/state-programs/resolver)
 *  - IDR initiation window (4 BD)           (server/idr/initiation-guards)
 *  - cooling-off (90 cal / 30 BD batched)   (server/idr/cooling-off)
 *  - notice-and-consent waiver exceptions   (server/notice-consent/waiver)
 *  - prohibited determination basis screen  (server/personas/prohibited-basis)
 * Field requirements come from the standalone dictionary
 * (server/eligibility/required-fields.ts) — missingFields[] is computed FROM
 * the dictionary, never hardcoded here.
 *
 * CRITICAL HONESTY CONSTRAINT:
 *  - The verdict is a DETERMINISTIC RULE VERDICT about eligibility for the
 *    federal IDR process, with CFR citations. It is NOT, and never claims to
 *    be, an assurance of winning an IDR determination. Outcome probabilities
 *    live in a separate, explicitly labeled statistical-estimate layer
 *    (server/routers/practice-audit.ts scoreAndSummarize).
 *  - QUALIFIES is emitted ONLY when every required field is present AND every
 *    applicable rule passes. Any missing eligibility-critical field forces
 *    NEEDS_REVIEW. Rule failures force BLOCKED.
 *
 * Labels: EXECUTED-VERIFIED via server/eligibility/engine.test.ts (pure
 * function, no DB, no network).
 */

import { resolveJurisdiction, JurisdictionInputError } from "../idr/state-programs/resolver";
import { checkIdrInitiationWindow } from "../idr/initiation-guards";
import { computeCoolingOff } from "../idr/cooling-off/cooling-off";
import { evaluateWaiverEligibility } from "../notice-consent/waiver";
import { screenProhibitedBasis } from "../personas/prohibited-basis";
import { evaluateContextCompleteness } from "./required-fields";
import type { RuleFired, EvidenceChecklistItem, PracticeClaimVerdict } from "../../drizzle/schema-practice-claims";

/** Normalized claim input (subset of practice_claims relevant to eligibility). */
export interface EligibilityClaimInput {
  claimId?: string | null;
  planType?: string | null; // FULLY_INSURED | SELF_FUNDED | FEHB
  serviceCategory?: string | null; // EMERGENCY | NON_EMERGENCY | POST_STABILIZATION | AIR_AMBULANCE
  serviceState?: string | null; // facility/patient state, 2-letter
  serviceDate?: string | null; // ISO YYYY-MM-DD
  cptCodes?: string[] | null;
  billedCents?: number | null;
  payerId?: string | null;
  renderingNpi?: string | null;
  billingNpi?: string | null;
  networkStatus?: string | null; // out_of_network | in_network
  noticeConsentStatus?: string | null; // none | signed | waived_exception
  initialPaymentDate?: string | null; // ISO date
  priorPaymentDeterminationDate?: string | null; // ISO date — cooling-off anchor
  providerSpecialty?: string | null;
  /** Optional payer/arbitrator rationale text for the prohibited-basis screen. */
  determinationRationale?: string | null;
}

export interface EligibilityResult {
  verdict: PracticeClaimVerdict;
  rulesFired: RuleFired[];
  missingFields: string[];
  evidenceChecklist: EvidenceChecklistItem[];
  completenessPct: number;
  jurisdiction: "FEDERAL" | "STATE" | "BIFURCATED_SPLIT" | null;
  /** Fail-closed explanations that drove BLOCKED. */
  blockReasons: string[];
  /** Explanations that drove NEEDS_REVIEW. */
  reviewReasons: string[];
}

const CFR_INITIATION = "45 CFR 149.510(b)(2)(i)";
const CFR_COOLING_OFF = "45 CFR 149.510(c)(4)(vii)(B)";
const CFR_JURISDICTION = "45 CFR 149.140";
const CFR_NOTICE_CONSENT = "45 CFR 149.410-149.430";
const CFR_NETWORK = "45 CFR 149.30; 45 CFR 149.110-149.130";
const CFR_PROHIBITED = "45 CFR 149.510(c)(4)(ii)";

function isoNow(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseIsoDate(v: string | null | undefined): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Evaluate one normalized claim. Pure and deterministic given `now`
 * (injectable for tests).
 */
export function evaluateClaimEligibility(
  claim: EligibilityClaimInput,
  opts: { now?: Date } = {},
): EligibilityResult {
  const now = opts.now ?? new Date();
  const rulesFired: RuleFired[] = [];
  const blockReasons: string[] = [];
  const reviewReasons: string[] = [];

  // ── Field completeness (dictionary-driven; idr_initiation context is the
  //    strictest claim-level context) ────────────────────────────────────
  const completeness = evaluateContextCompleteness("idr_initiation", {
    initialPaymentDate: claim.initialPaymentDate,
    openNegotiationEndDate: claim.initialPaymentDate, // ONP derives from initial payment/denial
    planType: claim.planType,
    serviceState: claim.serviceState,
    serviceCategory: claim.serviceCategory,
    noticeConsentStatus: claim.noticeConsentStatus,
    conflictCheck: "n/a", // conflict check is an IDR-submission artifact, not claim data — evaluated at FSM level
  });
  // Also require claim-ingestion-level fields.
  const ingestion = evaluateContextCompleteness("claim_ingestion", {
    claimId: claim.claimId,
    serviceDate: claim.serviceDate,
    cptCodes: claim.cptCodes,
    billedCents: claim.billedCents,
    serviceState: claim.serviceState,
    payerId: claim.payerId,
    renderingNpi: claim.renderingNpi ?? claim.billingNpi,
    networkStatus: claim.networkStatus,
    planType: claim.planType,
  });
  const missingFields = Array.from(new Set([...ingestion.missingFields, ...completeness.missingFields]));
  const evidenceChecklist: EvidenceChecklistItem[] = [
    ...ingestion.checklist,
    ...completeness.checklist.filter(c => !ingestion.checklist.some(i => i.key === c.key)),
  ];
  const totalItems = evidenceChecklist.length;
  const presentItems = evidenceChecklist.filter(c => c.present).length;
  const completenessPct = totalItems === 0 ? 100 : Math.round((presentItems / totalItems) * 100);
  if (missingFields.length > 0) {
    reviewReasons.push(
      `Eligibility-critical fields missing (cannot render a QUALIFIES verdict): ${missingFields.join(", ")}.`
    );
    rulesFired.push({
      rule: "field_completeness",
      citation: CFR_JURISDICTION + "; " + CFR_INITIATION,
      detail: `Missing required fields: ${missingFields.join(", ")}`,
      effect: "review",
    });
  }

  // ── Network status: in-network claims are outside NSA OON protections ──
  if (claim.networkStatus === "in_network") {
    blockReasons.push("Rendering/billing provider was IN-NETWORK at time of service; NSA out-of-network protections and federal IDR do not apply.");
    rulesFired.push({
      rule: "network_status",
      citation: CFR_NETWORK,
      detail: "networkStatus=in_network — NSA protections attach to non-participating providers/facilities only.",
      effect: "block",
    });
  } else if (claim.networkStatus === "out_of_network") {
    rulesFired.push({
      rule: "network_status",
      citation: CFR_NETWORK,
      detail: "networkStatus=out_of_network — non-participating status consistent with NSA scope.",
      effect: "pass",
    });
  }

  // ── Jurisdiction (federal vs specified state law) ──────────────────────
  let jurisdiction: EligibilityResult["jurisdiction"] = null;
  const serviceDate = parseIsoDate(claim.serviceDate);
  if (claim.planType && claim.serviceState && claim.serviceCategory && serviceDate) {
    try {
      const j = resolveJurisdiction({
        planType: claim.planType as never,
        stateCode: claim.serviceState,
        serviceCategory: claim.serviceCategory as never,
        dateOfService: claim.serviceDate!,
      });
      jurisdiction = j.regime === "FEDERAL" ? "FEDERAL" : j.regime === "STATE" ? "STATE" : "BIFURCATED_SPLIT";
      rulesFired.push({
        rule: "jurisdiction",
        citation: CFR_JURISDICTION,
        detail: j.rationale + (j.warnings.length ? ` Warnings: ${j.warnings.join("; ")}` : ""),
        effect: jurisdiction === "FEDERAL" ? "pass" : jurisdiction === "STATE" ? "block" : "review",
      });
      if (jurisdiction === "STATE") {
        blockReasons.push("A specified State law with a FULL-scope program governs this item/service; the federal IDR process is unavailable (use the state process).");
      } else if (jurisdiction === "BIFURCATED_SPLIT") {
        reviewReasons.push("State program is PARTIAL-scope (bifurcated): state regime covers in-scope items, federal IDR the remainder — manual review required to classify this item.");
      }
    } catch (err) {
      if (err instanceof JurisdictionInputError) {
        reviewReasons.push(`Jurisdiction could not be resolved (fail-closed): ${err.message}`);
        rulesFired.push({ rule: "jurisdiction", citation: CFR_JURISDICTION, detail: `Input rejected: ${err.message}`, effect: "review" });
      } else {
        throw err;
      }
    }
  }

  // ── Late initiation (§149.510(b)(2)(i) — 4-business-day window) ───────
  const initialPayment = parseIsoDate(claim.initialPaymentDate);
  if (initialPayment) {
    const late = checkIdrInitiationWindow({ initialPaymentDate: initialPayment, now });
    rulesFired.push({
      rule: "idr_initiation_window",
      citation: CFR_INITIATION,
      detail: late.detail,
      effect: late.late ? "block" : "pass",
    });
    if (late.late) {
      blockReasons.push(
        `IDR initiation window (4 business days after the open negotiation period) has lapsed by ${late.businessDaysPastDeadline} business day(s).`
      );
    }
  }

  // ── Cooling-off (§149.510(c)(4)(vii)(B)) ───────────────────────────────
  const priorDetermination = parseIsoDate(claim.priorPaymentDeterminationDate);
  if (priorDetermination) {
    const co = computeCoolingOff({
      paymentDeterminationDate: priorDetermination,
      disputeType: "SINGLE",
      openNegotiationInitiatedOn: initialPayment ?? undefined,
    });
    const active = co.coolingOffEnd !== null && now < co.coolingOffEnd;
    rulesFired.push({
      rule: "cooling_off",
      citation: CFR_COOLING_OFF,
      detail: co.basis,
      effect: active ? "block" : "pass",
    });
    if (active) {
      blockReasons.push(`Cooling-off period is in effect until ${co.coolingOffEnd!.toISOString().slice(0, 10)} (90 calendar days from the prior payment determination).`);
    }
  }

  // ── Notice & consent (§§149.410-149.430) ───────────────────────────────
  if (claim.serviceCategory && claim.noticeConsentStatus) {
    if (claim.noticeConsentStatus === "signed") {
      const waiver = evaluateWaiverEligibility({
        serviceCategory: claim.serviceCategory as never,
        providerSpecialty: claim.providerSpecialty ?? undefined,
        providerInNetwork: claim.networkStatus === "in_network" ? true : undefined,
      });
      if (waiver.waivable) {
        blockReasons.push(`A valid notice-and-consent waiver applies (${waiver.eligibility}): NSA balance-billing protections were waived; federal IDR is unavailable. ${waiver.reason}`);
        rulesFired.push({ rule: "notice_consent", citation: CFR_NOTICE_CONSENT, detail: waiver.reason, effect: "block" });
      } else {
        rulesFired.push({
          rule: "notice_consent",
          citation: CFR_NOTICE_CONSENT,
          detail: `Signed notice found but the notice-and-consent exception is NOT available for this category (${waiver.eligibility}) — the purported waiver is ineffective; NSA protections stand. ${waiver.reason}`,
          effect: "pass",
        });
      }
    } else {
      rulesFired.push({
        rule: "notice_consent",
        citation: CFR_NOTICE_CONSENT,
        detail: `noticeConsentStatus=${claim.noticeConsentStatus} — no waiver of NSA protections on file.`,
        effect: "pass",
      });
    }
  }

  // ── Prohibited determination basis screen (informational at claim stage) ─
  if (claim.determinationRationale) {
    const hit = screenProhibitedBasis(claim.determinationRationale);
    rulesFired.push({
      rule: "prohibited_basis",
      citation: CFR_PROHIBITED,
      detail: hit
        ? `Rationale references a prohibited consideration (${hit}); a determination on that basis would violate §149.510(c)(4)(ii).`
        : "No prohibited determination basis (UCR / billed charges / public-payer rates) detected in the supplied rationale.",
      effect: hit ? "review" : "pass",
    });
    if (hit) reviewReasons.push(`Payer/arbitrator rationale cites a prohibited basis (${hit}) — flag for review.`);
  }

  // ── Verdict ────────────────────────────────────────────────────────────
  // QUALIFIES requires: zero missing fields AND zero blocks AND a resolved
  // FEDERAL jurisdiction. Anything less is BLOCKED or NEEDS_REVIEW.
  let verdict: PracticeClaimVerdict;
  if (blockReasons.length > 0) {
    verdict = "BLOCKED";
  } else if (missingFields.length > 0 || reviewReasons.length > 0 || jurisdiction !== "FEDERAL") {
    verdict = "NEEDS_REVIEW";
  } else {
    verdict = "QUALIFIES";
  }

  return {
    verdict,
    rulesFired,
    missingFields,
    evidenceChecklist,
    completenessPct,
    jurisdiction,
    blockReasons,
    reviewReasons,
  };
}

/** Batch-evaluate claims; deterministic ordering preserved. */
export function evaluateClaims(
  claims: EligibilityClaimInput[],
  opts: { now?: Date } = {},
): EligibilityResult[] {
  return claims.map(c => evaluateClaimEligibility(c, opts));
}

export const ELIGIBILITY_ENGINE_META = {
  asOf: isoNow(),
  honestyNote:
    "Verdicts are deterministic eligibility rule outcomes with CFR citations. " +
    "They are NOT a guarantee of prevailing in open negotiation or IDR; any " +
    "outcome probability is a separate statistical estimate labeled as such.",
} as const;
