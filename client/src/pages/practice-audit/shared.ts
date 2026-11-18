/**
 * Shared types + helpers for the /practice-audit console (Phase 17-FE).
 *
 * HONESTY LABELS:
 *  - Verdicts/rulesFired/missingFields/evidenceChecklist/completenessPct all
 *    come from the deterministic server-side eligibility engine
 *    (server/eligibility/engine.ts) — EXECUTED-VERIFIED.
 *  - Win probability / projected recovery are STATISTICAL ESTIMATES
 *    (OutcomeNet, trained on synthetic data) — never labeled as guarantees.
 *  - Retrospective lane assignment (A/B/C) is CLIENT-COMPUTED from verdict +
 *    service/payment dates using the 30-business-day open-negotiation rule
 *    (45 CFR 149.510(a)(2)(viii)(B)) because the backend does not yet expose
 *    a per-claim deadline projection (phase17-ce scope). Every lane UI is
 *    labeled "client-computed".
 */

export type Verdict = "QUALIFIES" | "BLOCKED" | "NEEDS_REVIEW";

export interface RuleFired {
  rule: string;
  citation: string;
  detail: string;
  effect: "block" | "review" | "info" | "pass";
}

export interface EvidenceChecklistItem {
  key: string;
  label: string;
  present: boolean;
  citation: string;
}

export interface ClaimScore {
  id: string;
  claimId: string;
  verdict: Verdict;
  rulesFired: RuleFired[];
  missingFields: string[];
  evidenceChecklist: EvidenceChecklistItem[];
  completenessPct: number;
  jurisdiction: string | null;
  winProbabilityStatisticalEstimate: string | null;
  scoredAt: string | Date;
}

export interface PracticeClaim {
  id: string;
  orgId: string;
  source: string;
  sourceRef: string | null;
  claimId: string | null;
  planType: string | null;
  serviceCategory: string | null;
  patientState: string | null;
  facilityState: string | null;
  serviceDate: string | null;
  networkStatus: string | null;
  noticeConsentStatus: string | null;
  initialPaymentDate: string | null;
  denialDate: string | null;
  cptCodes: string[];
  payerId: string | null;
  payerName: string | null;
  renderingNpi: string | null;
  billedCents: number | null;
  allowedCents: number | null;
  paidCents: number | null;
  createdAt: string | Date;
  score: ClaimScore | null;
}

export function centsToUsd(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function parseIsoDay(v: string | null | undefined): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Add N business days (Mon–Fri) to a date. Mirrors the statutory 30-
 * business-day open negotiation window; statutory holiday calendars are NOT
 * applied — the UI labels results as client-computed approximations.
 */
export function addBusinessDays(start: Date, days: number): Date {
  const d = new Date(start.getTime());
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

export type Lane = "A" | "B" | "C";

export interface LaneAssignment {
  lane: Lane;
  /** Client-computed basis for the assignment. */
  basis: string;
  /** Business days remaining in the ON window when computable, else null. */
  windowRemainingDays: number | null;
}

/**
 * CLIENT-COMPUTED three-lane retrospective classification. The server does
 * not (yet) expose a per-claim deadline projection, so we derive from the
 * claim's initial payment/denial date + the 30-business-day rule and label
 * the result accordingly.
 */
export function classifyLane(claim: PracticeClaim, now = new Date()): LaneAssignment {
  const verdict = claim.score?.verdict;
  if (verdict !== "QUALIFIES") {
    // Non-qualifying claims still carry intelligence value.
    return { lane: "C", basis: `Verdict ${verdict ?? "UNSCORED"} — not IDR-actionable; retained for payer-behavior intelligence.`, windowRemainingDays: null };
  }
  const anchor = parseIsoDay(claim.initialPaymentDate) ?? parseIsoDay(claim.denialDate) ?? parseIsoDay(claim.serviceDate);
  if (!anchor) {
    return { lane: "C", basis: "QUALIFIES but no payment/denial/service date available to compute a deadline — intelligence lane pending dates.", windowRemainingDays: null };
  }
  const windowEnd = addBusinessDays(anchor, 30);
  const remainingMs = windowEnd.getTime() - now.getTime();
  const remainingDays = Math.ceil(remainingMs / 86_400_000);
  if (remainingDays >= 0) {
    return { lane: "A", basis: `QUALIFIES and inside the client-computed 30-business-day negotiation window (anchor ${anchor.toISOString().slice(0, 10)}).`, windowRemainingDays: remainingDays };
  }
  return { lane: "B", basis: `QUALIFIES but the client-computed 30-business-day window closed ${windowEnd.toISOString().slice(0, 10)} — time-barred for IDR; appeal/contract lane.`, windowRemainingDays: remainingDays };
}

export const VERDICT_STYLES: Record<Verdict | "UNSCORED", { label: string; className: string }> = {
  QUALIFIES: { label: "QUALIFIES", className: "bg-green-100 text-green-800 border-green-300" },
  BLOCKED: { label: "BLOCKED", className: "bg-red-100 text-red-800 border-red-300" },
  NEEDS_REVIEW: { label: "NEEDS_REVIEW", className: "bg-amber-100 text-amber-800 border-amber-300" },
  UNSCORED: { label: "UNSCORED", className: "bg-slate-100 text-slate-600 border-slate-300" },
};
