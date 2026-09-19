/**
 * server/workflow/idr-workflow.ts
 * Temporal-style durable workflow state machine for the 19-step IDR process.
 *
 * Each step has:
 * - A unique ID and human-readable name
 * - Allowed transitions (next steps)
 * - Statutory deadline (business days from step entry)
 * - Guard conditions that must be met before advancing
 * - Side effects published via the event bus
 *
 * In production this would be backed by Temporal.io workflows.
 * Here we implement the same semantics in-process against PostgreSQL,
 * providing a drop-in interface that can be swapped for Temporal without
 * changing callers.
 */

import { getDb } from "../db";
import { disputes, disputeEvents } from "../../drizzle/schema";
import { idrFeeAssessments } from "../../drizzle/schema-idr-compliance";
import { and, eq } from "drizzle-orm";
import { eventBus } from "../events/bus";
import { withDisputeLock } from "../redis";
// W1-F9: shared prohibited determination-basis screen (45 CFR §
// 149.510(c)(4)(ii)) — same keyword list the personas/IDRE UI module uses.
import { screenProhibitedBasis } from "../personas/prohibited-basis";

/** Steps from which a party may withdraw the dispute (pre-determination). */
export const WITHDRAWABLE_STEPS: readonly IDRStep[] = [
  "STEP_01_OPEN_NEGOTIATION_INITIATED",
  "STEP_02_OPEN_NEGOTIATION_PERIOD",
  "STEP_03_OPEN_NEGOTIATION_FAILED",
  "STEP_04_IDR_INITIATED",
  "STEP_05_IDR_NOTICE_SENT",
  "STEP_06_IDR_ENTITY_SELECTION",
  "STEP_07_IDR_ENTITY_SELECTED",
  "STEP_08_ELIGIBILITY_REVIEW",
  "STEP_09_OFFER_SUBMISSION",
  "STEP_10_QPA_DISCLOSURE",
  "STEP_11_ADDITIONAL_INFORMATION",
  "STEP_12_ARBITRATION_REVIEW",
];

// ── Step definitions ──────────────────────────────────────────────────────────

// Import the canonical types from the schema
import type { IDRStep, DisputeStatus } from "../../drizzle/schema";

// Canonical business-day arithmetic (algorithmic US federal holidays,
// 5 U.S.C. § 6103) lives in server/idr/deadlines.ts. This module previously
// maintained its own weekend-only addBusinessDays; it now delegates so every
// workflow deadline honors federal holidays identically. Re-exported so
// existing importers (e.g. server/routers.ts) keep working.
import { addBusinessDays, addCalendarDays } from "../idr/deadlines";
export { addBusinessDays } from "../idr/deadlines";

/** End-of-day (UTC 23:59:59.999) for calendar-day statutory deadlines. */
function endOfDayUtc(d: Date): Date {
  const r = new Date(d.getTime());
  r.setUTCHours(23, 59, 59, 999);
  return r;
}

export interface WorkflowStepDefinition {
  id: IDRStep;
  name: string;
  description: string;
  deadlineBusinessDays: number | null; // null = no statutory business-day deadline
  /**
   * Statutory deadline in CALENDAR days (end-of-day UTC), for steps whose
   * governing rule is calendar-day based — e.g. STEP_14 payment within
   * 30 calendar days of the determination (PHSA § 2799A-1(c)(6)).
   * Mutually exclusive with deadlineBusinessDays.
   */
  deadlineCalendarDays?: number | null;
  allowedTransitions: IDRStep[];
  isTerminal: boolean;
  requiredFields: string[]; // fields that must be present on the dispute before advancing
  nsaReference: string; // 45 CFR section or CMS guidance reference
}

export const IDR_WORKFLOW_STEPS: Record<IDRStep, WorkflowStepDefinition> = {
  STEP_01_OPEN_NEGOTIATION_INITIATED: {
    id: "STEP_01_OPEN_NEGOTIATION_INITIATED",
    name: "Open Negotiation Initiated",
    description: "Provider sends open negotiation notice to payer",
    deadlineBusinessDays: null,
    allowedTransitions: ["STEP_02_OPEN_NEGOTIATION_PERIOD", "STEP_20_DISPUTE_WITHDRAWN"],
    isTerminal: false,
    requiredFields: ["billedAmount", "qpaAmount", "serviceDate"],
    nsaReference: "45 CFR § 149.410(b)",
  },
  STEP_02_OPEN_NEGOTIATION_PERIOD: {
    id: "STEP_02_OPEN_NEGOTIATION_PERIOD",
    name: "Open Negotiation Period",
    description: "30-business-day open negotiation window",
    deadlineBusinessDays: 30,
    allowedTransitions: ["STEP_03_OPEN_NEGOTIATION_FAILED", "STEP_20_DISPUTE_WITHDRAWN"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.410(b)(1)",
  },
  STEP_03_OPEN_NEGOTIATION_FAILED: {
    id: "STEP_03_OPEN_NEGOTIATION_FAILED",
    name: "Open Negotiation Failed",
    description: "Parties failed to reach agreement; IDR may be initiated",
    deadlineBusinessDays: null,
    allowedTransitions: ["STEP_04_IDR_INITIATED", "STEP_20_DISPUTE_WITHDRAWN"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.410(b)(2)",
  },
  STEP_04_IDR_INITIATED: {
    id: "STEP_04_IDR_INITIATED",
    name: "IDR Initiated",
    description: "Initiating party submits IDR request within 4 business days",
    deadlineBusinessDays: 4,
    allowedTransitions: ["STEP_05_IDR_NOTICE_SENT", "STEP_20_DISPUTE_WITHDRAWN"],
    isTerminal: false,
    requiredFields: ["serviceType"],
    nsaReference: "45 CFR § 149.510(b)(1)(i)",
  },
  STEP_05_IDR_NOTICE_SENT: {
    id: "STEP_05_IDR_NOTICE_SENT",
    name: "IDR Notice Sent",
    description: "Federal IDR portal sends notice to responding party",
    deadlineBusinessDays: 3,
    allowedTransitions: ["STEP_06_IDR_ENTITY_SELECTION", "STEP_20_DISPUTE_WITHDRAWN"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(1)(ii)",
  },
  STEP_06_IDR_ENTITY_SELECTION: {
    id: "STEP_06_IDR_ENTITY_SELECTION",
    name: "IDR Entity Selection",
    description: "Parties jointly select certified IDR entity within 3 business days",
    deadlineBusinessDays: 3,
    allowedTransitions: ["STEP_07_IDR_ENTITY_SELECTED", "STEP_20_DISPUTE_WITHDRAWN"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(1)(iii)",
  },
  STEP_07_IDR_ENTITY_SELECTED: {
    id: "STEP_07_IDR_ENTITY_SELECTED",
    name: "IDR Entity Selected",
    description: "Certified IDR entity assigned (by agreement or random selection)",
    deadlineBusinessDays: null,
    allowedTransitions: ["STEP_08_ELIGIBILITY_REVIEW", "STEP_20_DISPUTE_WITHDRAWN"],
    isTerminal: false,
    requiredFields: ["idrEntityId"],
    nsaReference: "45 CFR § 149.510(b)(1)(iii)(B)",
  },
  STEP_08_ELIGIBILITY_REVIEW: {
    id: "STEP_08_ELIGIBILITY_REVIEW",
    name: "Eligibility Review",
    description: "IDR entity reviews eligibility of the dispute",
    deadlineBusinessDays: 3,
    // W1-F2: backward transitions out of eligibility review —
    //  → STEP_06: certified IDRE declined / has a conflict / was decertified
    //    after selection; parties (or the Departments) must re-select
    //    (45 CFR § 149.510(b)(1)(iii); § 149.510(e)(2) conflict-of-interest
    //    decertification). Guarded: requires a reason AND either admin actor
    //    or a documented IDRE-declination event.
    //  → STEP_01: open-negotiation restart on remand (e.g. dispute returned
    //    after eligibility mis-review). Same guard.
    allowedTransitions: [
      "STEP_09_OFFER_SUBMISSION",
      "STEP_06_IDR_ENTITY_SELECTION",
      "STEP_01_OPEN_NEGOTIATION_INITIATED",
      "STEP_20_DISPUTE_WITHDRAWN",
    ],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(1)(ii)",
  },
  STEP_09_OFFER_SUBMISSION: {
    id: "STEP_09_OFFER_SUBMISSION",
    name: "Offer Submission",
    description: "Each party submits a final offer within 10 business days",
    deadlineBusinessDays: 10,
    allowedTransitions: ["STEP_10_QPA_DISCLOSURE", "STEP_20_DISPUTE_WITHDRAWN"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(1)(iv)",
  },
  STEP_10_QPA_DISCLOSURE: {
    id: "STEP_10_QPA_DISCLOSURE",
    name: "QPA Disclosure",
    description: "Payer discloses Qualifying Payment Amount",
    deadlineBusinessDays: 5,
    allowedTransitions: ["STEP_11_ADDITIONAL_INFORMATION", "STEP_20_DISPUTE_WITHDRAWN"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(1)(iv)(B)",
  },
  STEP_11_ADDITIONAL_INFORMATION: {
    id: "STEP_11_ADDITIONAL_INFORMATION",
    name: "Additional Information Period",
    description: "IDR entity may request additional information within 5 business days",
    deadlineBusinessDays: 5,
    allowedTransitions: ["STEP_12_ARBITRATION_REVIEW", "STEP_20_DISPUTE_WITHDRAWN"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(1)(v)",
  },
  STEP_12_ARBITRATION_REVIEW: {
    id: "STEP_12_ARBITRATION_REVIEW",
    name: "Arbitration Review",
    description: "IDR entity reviews all submissions and prepares determination",
    deadlineBusinessDays: 30,
    allowedTransitions: ["STEP_13_DETERMINATION_ISSUED", "STEP_20_DISPUTE_WITHDRAWN"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(1)(vi)",
  },
  STEP_13_DETERMINATION_ISSUED: {
    id: "STEP_13_DETERMINATION_ISSUED",
    name: "Determination Issued",
    description: "IDR entity selects one party's offer as the out-of-network rate",
    deadlineBusinessDays: null,
    // Appeal path: a party may seek judicial review of the determination
    // (45 CFR § 149.510(b)(2)) — STEP_18_APPEAL_FILED must be reachable
    // from the determination step, otherwise the appeal steps are dead.
    // W1-F3 (45 CFR § 149.510(c)(4)(viii)): correction of a determination
    // issued on the basis of misinformation — reopens to STEP_12 arbitration
    // review. Guarded in advanceWorkflow: admin-only, requires
    // {correctionReason, misinformationBy}; the prior determination is voided
    // (flagged, history preserved in disputeEvents) and the determination
    // deadline re-runs from re-entry into STEP_12.
    allowedTransitions: ["STEP_14_PAYMENT_DETERMINATION", "STEP_18_APPEAL_FILED", "STEP_12_ARBITRATION_REVIEW"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(1)(vi)(A)",
  },
  STEP_14_PAYMENT_DETERMINATION: {
    id: "STEP_14_PAYMENT_DETERMINATION",
    name: "Payment Determination",
    description: "Final payment amount determined; payer must pay within 30 calendar days",
    // PHSA § 2799A-1(c)(6): payment is due within 30 CALENDAR days of the
    // determination (end-of-day), not business days.
    deadlineBusinessDays: null,
    deadlineCalendarDays: 30,
    allowedTransitions: ["STEP_15_PAYMENT_MADE"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(1)(vii)",
  },
  STEP_15_PAYMENT_MADE: {
    id: "STEP_15_PAYMENT_MADE",
    name: "Payment Made",
    description: "Payment remitted by payer",
    deadlineBusinessDays: null,
    allowedTransitions: ["STEP_16_ADMINISTRATIVE_FEE_PAID"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(1)(vii)",
  },
  STEP_16_ADMINISTRATIVE_FEE_PAID: {
    id: "STEP_16_ADMINISTRATIVE_FEE_PAID",
    name: "Administrative Fee Reconciliation",
    // W1-F4: the administrative fee is DUE AT IDR INITIATION by both parties
    // (45 CFR § 149.510(d)(1)-(2); assessed at STEP_04 via
    // fees.assessOnIdrInitiation). This step is a confirmation/reconciliation
    // checkpoint — it verifies the initiation assessments were collected (or
    // waived for hardship), it does not mark the moment payment becomes due.
    description:
      "Confirmation/reconciliation that both parties' non-refundable administrative fees — due and assessed at IDR initiation (STEP_04) — were collected or hardship-waived",
    deadlineBusinessDays: null,
    allowedTransitions: ["STEP_17_DISPUTE_CLOSED"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(d)(1) (fee due at IDR initiation; collection tracked since STEP_04 assessment)",
  },
  STEP_17_DISPUTE_CLOSED: {
    id: "STEP_17_DISPUTE_CLOSED",
    name: "Dispute Closed",
    description: "Dispute fully resolved and closed",
    deadlineBusinessDays: null,
    allowedTransitions: [],
    isTerminal: true,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510",
  },
  STEP_18_APPEAL_FILED: {
    id: "STEP_18_APPEAL_FILED",
    name: "Appeal Filed",
    description: "Party initiates judicial review of IDR determination",
    deadlineBusinessDays: null,
    allowedTransitions: ["STEP_19_APPEAL_RESOLVED"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(2)",
  },
  STEP_19_APPEAL_RESOLVED: {
    id: "STEP_19_APPEAL_RESOLVED",
    name: "Appeal Resolved",
    description: "Final appeal determination issued",
    deadlineBusinessDays: null,
    allowedTransitions: ["STEP_17_DISPUTE_CLOSED"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(2)",
  },
  STEP_20_DISPUTE_WITHDRAWN: {
    id: "STEP_20_DISPUTE_WITHDRAWN",
    name: "Dispute Withdrawn",
    // W1-F1: either party may withdraw before a determination issues; the
    // dispute becomes terminal with status 'withdrawn', is excluded from
    // cooling-off keys and analytics, and never re-enters the FSM.
    description:
      "Dispute withdrawn by a party before determination (terminal); requires a documented withdrawalReason",
    deadlineBusinessDays: null,
    allowedTransitions: [],
    isTerminal: true,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b) (pre-determination withdrawal); CMS Federal IDR Guidance for Disputing Parties",
  },
};

// ── Workflow engine ───────────────────────────────────────────────────────────

/**
 * Compute the entry deadline for a step from its definition. Calendar-day
 * steps (STEP_14 payment, PHSA § 2799A-1(c)(6)) run 30 calendar days to
 * end-of-day UTC; business-day steps delegate to the canonical deadlines
 * engine (server/idr/deadlines.ts).
 */
export function computeStepDeadline(
  stepDef: WorkflowStepDefinition,
  from: Date = new Date()
): Date | null {
  if (stepDef.deadlineCalendarDays) {
    return endOfDayUtc(addCalendarDays(from, stepDef.deadlineCalendarDays));
  }
  if (stepDef.deadlineBusinessDays) {
    return addBusinessDays(from, stepDef.deadlineBusinessDays);
  }
  return null;
}


export interface WorkflowAdvanceResult {
  success: boolean;
  previousStep: IDRStep;
  newStep: IDRStep;
  deadline: Date | null;
  message: string;
  /** Non-fatal advisories (e.g. assessed-but-unpaid initiation admin fees). */
  warnings: string[];
}

/** Optional statutory inputs for guarded transitions (W1 fixes). */
export interface WorkflowAdvanceOptions {
  /** Actor role from the auth context; required for admin-only transitions. */
  actorRole?: string;
  /** W1-F1: mandatory when withdrawing (target STEP_20_DISPUTE_WITHDRAWN). */
  withdrawalReason?: string;
  /** W1-F2: mandatory reason for STEP_08 backward transitions. */
  reason?: string;
  /** W1-F3 (§ 149.510(c)(4)(viii)): determination-correction inputs. */
  correctionReason?: string;
  misinformationBy?: string;
  /** W1-F9: stated basis when issuing a determination (screened). */
  determinationBasis?: string;
}

/** disputeEvents event types used by the guarded transitions. */
export const IDRE_DECLINATION_EVENT_TYPES = [
  "idre_declination",
  "idre_declined",
  "idre_conflicted",
  "idre_decertified",
] as const;

export function validateWorkflowTransition(
  currentStep: IDRStep,
  targetStep: IDRStep,
  dispute: Record<string, unknown>
): void {
  const stepDef = IDR_WORKFLOW_STEPS[currentStep];
  if (!stepDef) throw new Error(`Unknown step: ${currentStep}`);
  if (stepDef.isTerminal) throw new Error(`Dispute is in terminal step ${currentStep} and cannot be advanced`);
  if (!stepDef.allowedTransitions.includes(targetStep)) {
    throw new Error(`Invalid transition from ${currentStep} to ${targetStep}. Allowed: ${stepDef.allowedTransitions.join(", ")}`);
  }

  const missing = stepDef.requiredFields.filter(field => {
    const value = dispute[field];
    return value === undefined || value === null || value === "";
  });
  if (missing.length) {
    throw new Error(`Cannot advance from ${currentStep}; missing required field(s): ${missing.join(", ")}`);
  }
}

/**
 * Advance a dispute to the next workflow step.
 * Acquires a distributed lock to prevent concurrent state transitions.
 * Validates the transition is allowed and guard conditions are met.
 * Publishes a dispute.advanced event on success.
 */
export async function advanceWorkflow(
  disputeId: string,
  targetStep: IDRStep,
  userId: string,
  notes?: string,
  options: WorkflowAdvanceOptions = {}
): Promise<WorkflowAdvanceResult> {
  return withDisputeLock(disputeId, 10000, async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const warnings: string[] = [];
    const isAdmin = options.actorRole === "admin";

    // Load current dispute state
    const rows = await db
      .select()
      .from(disputes)
      .where(eq(disputes.id, disputeId))
      .limit(1);

    if (!rows.length) throw new Error(`Dispute ${disputeId} not found`);
    const dispute = rows[0];
    const currentStep = dispute.currentStep as IDRStep;

    validateWorkflowTransition(currentStep, targetStep, dispute as Record<string, unknown>);
    const stepDef = IDR_WORKFLOW_STEPS[currentStep];

    // ── W1-F1: withdrawal guard — mandatory documented reason ──────────────
    if (targetStep === "STEP_20_DISPUTE_WITHDRAWN") {
      if (!WITHDRAWABLE_STEPS.includes(currentStep)) {
        throw new Error(
          `Dispute cannot be withdrawn from ${currentStep}; withdrawal is only available pre-determination (STEP_01–STEP_12)`
        );
      }
      if (!options.withdrawalReason || options.withdrawalReason.trim().length === 0) {
        throw new Error("withdrawalReason is required to withdraw a dispute");
      }
    }

    // ── W1-F2: backward transitions out of STEP_08 (IDRE re-selection / ON
    // restart on remand) — reason required; admin OR documented IDRE
    // declination/conflict/decertification event. ────────────────────────────
    if (
      currentStep === "STEP_08_ELIGIBILITY_REVIEW" &&
      (targetStep === "STEP_06_IDR_ENTITY_SELECTION" || targetStep === "STEP_01_OPEN_NEGOTIATION_INITIATED")
    ) {
      if (!options.reason || options.reason.trim().length === 0) {
        throw new Error(`A reason is required for the backward transition ${currentStep} → ${targetStep}`);
      }
      if (!isAdmin) {
        const priorEvents = await db
          .select()
          .from(disputeEvents)
          .where(eq(disputeEvents.disputeId, disputeId));
        const documented = priorEvents.some(e =>
          (IDRE_DECLINATION_EVENT_TYPES as readonly string[]).includes(e.eventType as string)
        );
        if (!documented) {
          throw new Error(
            `Backward transition ${currentStep} → ${targetStep} requires an admin actor or a documented IDRE declination/conflict/decertification event`
          );
        }
      }
    }

    // ── W1-F3 (§ 149.510(c)(4)(viii)): determination correction for
    // misinformation — admin-only, mandatory correction inputs. ─────────────
    if (currentStep === "STEP_13_DETERMINATION_ISSUED" && targetStep === "STEP_12_ARBITRATION_REVIEW") {
      if (!isAdmin) {
        throw new Error("Determination correction (§ 149.510(c)(4)(viii)) is admin-only");
      }
      if (!options.correctionReason || options.correctionReason.trim().length === 0) {
        throw new Error("correctionReason is required to reopen a determination for misinformation");
      }
      if (!options.misinformationBy || options.misinformationBy.trim().length === 0) {
        throw new Error("misinformationBy (which party supplied the misinformation) is required");
      }
    }

    // ── W1-F9 (§ 149.510(c)(4)(ii)): prohibited determination basis screen ──
    if (targetStep === "STEP_13_DETERMINATION_ISSUED" && options.determinationBasis) {
      const hit = screenProhibitedBasis(options.determinationBasis);
      if (hit) {
        throw new Error(
          `Determination basis rejected (45 CFR § 149.510(c)(4)(ii)): ${hit} may not be considered as the basis for a payment determination`
        );
      }
    }

    // ── W1-F4: initiation admin-fee assessment must exist before the dispute
    // advances past entity selection (STEP_06 → STEP_07). The fee is due at
    // IDR initiation (assessed at STEP_04 via fees.assessOnIdrInitiation);
    // the assessment ROWS are a hard requirement, payment itself is
    // warning-level (collection is reconciled at STEP_16). ──────────────────
    if (currentStep === "STEP_06_IDR_ENTITY_SELECTION" && targetStep === "STEP_07_IDR_ENTITY_SELECTED") {
      const feeRows = await db
        .select()
        .from(idrFeeAssessments)
        .where(and(eq(idrFeeAssessments.disputeId, disputeId), eq(idrFeeAssessments.feeType, "administrative")));
      const roles = new Set(feeRows.map(r => r.partyRole as string));
      const missing = (["initiating_party", "responding_party"] as const).filter(r => !roles.has(r));
      if (missing.length) {
        throw new Error(
          `Administrative fee assessment missing for ${missing.join(", ")}. The admin fee is due at IDR initiation ` +
          `(45 CFR § 149.510(d)(1)); call fees.assessOnIdrInitiation before completing IDR entity selection.`
        );
      }
      const unsettled = feeRows.filter(r => r.status !== "paid" && r.status !== "waived");
      if (unsettled.length) {
        warnings.push(
          `Administrative fee assessed at initiation but not yet collected/waived for: ` +
          `${unsettled.map(r => r.partyRole).join(", ")} — reconcile at STEP_16.`
        );
      }
    }

    // Calculate deadline for new step — business-day steps use the canonical
    // business-day engine; calendar-day steps (e.g. STEP_14 payment) use
    // addCalendarDays and run to end-of-day UTC.
    const targetStepDef = IDR_WORKFLOW_STEPS[targetStep];
    const deadline = computeStepDeadline(targetStepDef, new Date());

    // Determine new status
    const newStatus = getStatusForStep(targetStep);

    // Update dispute
    await db.update(disputes)
      .set({
        currentStep: targetStep,
        status: newStatus,
        determinationDeadline: deadline ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(disputes.id, disputeId));

    // Record timeline event
    await db.insert(disputeEvents).values({
      id: crypto.randomUUID(),
      disputeId,
      step: targetStep,
      previousStep: currentStep,
      eventType: "step_advanced",
      description: `Advanced to ${targetStepDef.name}${notes ? `: ${notes}` : ""}`,
      performedBy: userId,
      createdAt: new Date(),
    });

    // ── Guarded-transition side-effect events (history is append-only) ─────
    if (targetStep === "STEP_20_DISPUTE_WITHDRAWN") {
      await db.insert(disputeEvents).values({
        id: crypto.randomUUID(),
        disputeId,
        step: targetStep,
        previousStep: currentStep,
        eventType: "dispute_withdrawn",
        description: `Dispute withdrawn: ${options.withdrawalReason}`,
        performedBy: userId,
        createdAt: new Date(),
      });
    }
    if (
      currentStep === "STEP_08_ELIGIBILITY_REVIEW" &&
      (targetStep === "STEP_06_IDR_ENTITY_SELECTION" || targetStep === "STEP_01_OPEN_NEGOTIATION_INITIATED")
    ) {
      await db.insert(disputeEvents).values({
        id: crypto.randomUUID(),
        disputeId,
        step: targetStep,
        previousStep: currentStep,
        eventType: "workflow_backward_transition",
        description:
          (targetStep === "STEP_06_IDR_ENTITY_SELECTION"
            ? "IDRE re-selection (declined/conflicted/decertified)"
            : "Open-negotiation restart on remand") + `: ${options.reason}`,
        performedBy: userId,
        createdAt: new Date(),
      });
    }
    if (currentStep === "STEP_13_DETERMINATION_ISSUED" && targetStep === "STEP_12_ARBITRATION_REVIEW") {
      // Void/flag the prior determination; the determination record itself is
      // retained (append-only history) and the STEP_12 re-entry above already
      // re-triggered the 30-business-day determination deadline.
      await db.insert(disputeEvents).values({
        id: crypto.randomUUID(),
        disputeId,
        step: currentStep,
        previousStep: currentStep,
        eventType: "determination_voided",
        description:
          `Prior determination VOIDED — reopened for misinformation (45 CFR § 149.510(c)(4)(viii)). ` +
          `Misinformation by: ${options.misinformationBy}. Correction reason: ${options.correctionReason}`,
        performedBy: userId,
        createdAt: new Date(),
      });
    }

    // Publish event
    await eventBus.publish(
      "dispute.advanced",
      disputeId,
      "dispute",
      {
        previousStep: currentStep,
        newStep: targetStep,
        newStatus,
        deadline: deadline?.toISOString() ?? null,
        userId,
        notes,
        warnings,
        ...(options.withdrawalReason ? { withdrawalReason: options.withdrawalReason } : {}),
        ...(options.correctionReason ? { correctionReason: options.correctionReason, misinformationBy: options.misinformationBy } : {}),
      },
      { userId, timestamp: new Date().toISOString() }
    );

    return {
      success: true,
      previousStep: currentStep,
      newStep: targetStep,
      deadline,
      message: `Advanced from ${stepDef.name} to ${targetStepDef.name}`,
      warnings,
    };
  });
}

/**
 * Get the workflow status for a given step.
 */
export function getStatusForStep(step: IDRStep): DisputeStatus {
  if (step === "STEP_17_DISPUTE_CLOSED") return "closed";
  if (step === "STEP_20_DISPUTE_WITHDRAWN") return "withdrawn";
  if (step === "STEP_18_APPEAL_FILED" || step === "STEP_19_APPEAL_RESOLVED") return "appealed";
  if (step === "STEP_13_DETERMINATION_ISSUED") return "determination_issued";
  if (step === "STEP_14_PAYMENT_DETERMINATION" || step === "STEP_15_PAYMENT_MADE" || step === "STEP_16_ADMINISTRATIVE_FEE_PAID") return "payment_pending";
  if (step === "STEP_12_ARBITRATION_REVIEW" || step === "STEP_11_ADDITIONAL_INFORMATION" || step === "STEP_10_QPA_DISCLOSURE" || step === "STEP_09_OFFER_SUBMISSION") return "under_arbitration";
  if (step === "STEP_08_ELIGIBILITY_REVIEW") return "eligibility_review";
  if (step === "STEP_07_IDR_ENTITY_SELECTED" || step === "STEP_06_IDR_ENTITY_SELECTION") return "idr_entity_selection";
  if (step === "STEP_04_IDR_INITIATED" || step === "STEP_05_IDR_NOTICE_SENT") return "idr_initiated";
  return "open_negotiation";
}

/**
 * Get the 1-based step number from a step ID.
 */
export function getStepNumber(step: IDRStep): number {
  const match = step.match(/^STEP_(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Check if a dispute's deadline has passed.
 */
export function isDeadlinePassed(deadline: Date | null): boolean {
  if (!deadline) return false;
  return new Date() > deadline;
}

/**
 * Get days remaining until deadline (negative if passed).
 */
export function daysUntilDeadline(deadline: Date | null): number | null {
  if (!deadline) return null;
  const ms = deadline.getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/**
 * Get all valid next steps for a given current step.
 */
export function getValidTransitions(currentStep: IDRStep): WorkflowStepDefinition[] {
  const stepDef = IDR_WORKFLOW_STEPS[currentStep];
  if (!stepDef) return [];
  return stepDef.allowedTransitions.map(s => IDR_WORKFLOW_STEPS[s]);
}

/**
 * Get the full workflow progress as an ordered list of steps with status.
 */
export function getWorkflowProgress(currentStep: IDRStep): Array<{
  step: WorkflowStepDefinition;
  status: "completed" | "current" | "pending";
}> {
  const mainPath: IDRStep[] = [
    "STEP_01_OPEN_NEGOTIATION_INITIATED",
    "STEP_02_OPEN_NEGOTIATION_PERIOD",
    "STEP_03_OPEN_NEGOTIATION_FAILED",
    "STEP_04_IDR_INITIATED",
    "STEP_05_IDR_NOTICE_SENT",
    "STEP_06_IDR_ENTITY_SELECTION",
    "STEP_07_IDR_ENTITY_SELECTED",
    "STEP_08_ELIGIBILITY_REVIEW",
    "STEP_09_OFFER_SUBMISSION",
    "STEP_10_QPA_DISCLOSURE",
    "STEP_11_ADDITIONAL_INFORMATION",
    "STEP_12_ARBITRATION_REVIEW",
    "STEP_13_DETERMINATION_ISSUED",
    "STEP_14_PAYMENT_DETERMINATION",
    "STEP_15_PAYMENT_MADE",
    "STEP_16_ADMINISTRATIVE_FEE_PAID",
    "STEP_17_DISPUTE_CLOSED",
  ];

  const currentIndex = mainPath.indexOf(currentStep);

  return mainPath.map((stepId, index) => ({
    step: IDR_WORKFLOW_STEPS[stepId],
    status: index < currentIndex ? "completed" : index === currentIndex ? "current" : "pending",
  }));
}
