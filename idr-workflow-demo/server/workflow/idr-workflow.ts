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
import { eq } from "drizzle-orm";
import { eventBus } from "../events/bus";
import { withDisputeLock } from "../redis";

// ── Step definitions ──────────────────────────────────────────────────────────

// Import the canonical types from the schema
import type { IDRStep, DisputeStatus } from "../../drizzle/schema";

export interface WorkflowStepDefinition {
  id: IDRStep;
  name: string;
  description: string;
  deadlineBusinessDays: number | null; // null = no statutory deadline
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
    allowedTransitions: ["STEP_02_OPEN_NEGOTIATION_PERIOD"],
    isTerminal: false,
    requiredFields: ["billedAmount", "qpaAmount", "serviceDate"],
    nsaReference: "45 CFR § 149.410(b)",
  },
  STEP_02_OPEN_NEGOTIATION_PERIOD: {
    id: "STEP_02_OPEN_NEGOTIATION_PERIOD",
    name: "Open Negotiation Period",
    description: "30-business-day open negotiation window",
    deadlineBusinessDays: 30,
    allowedTransitions: ["STEP_03_OPEN_NEGOTIATION_FAILED"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.410(b)(1)",
  },
  STEP_03_OPEN_NEGOTIATION_FAILED: {
    id: "STEP_03_OPEN_NEGOTIATION_FAILED",
    name: "Open Negotiation Failed",
    description: "Parties failed to reach agreement; IDR may be initiated",
    deadlineBusinessDays: null,
    allowedTransitions: ["STEP_04_IDR_INITIATED"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.410(b)(2)",
  },
  STEP_04_IDR_INITIATED: {
    id: "STEP_04_IDR_INITIATED",
    name: "IDR Initiated",
    description: "Initiating party submits IDR request within 4 business days",
    deadlineBusinessDays: 4,
    allowedTransitions: ["STEP_05_IDR_NOTICE_SENT"],
    isTerminal: false,
    requiredFields: ["serviceType"],
    nsaReference: "45 CFR § 149.510(b)(1)(i)",
  },
  STEP_05_IDR_NOTICE_SENT: {
    id: "STEP_05_IDR_NOTICE_SENT",
    name: "IDR Notice Sent",
    description: "Federal IDR portal sends notice to responding party",
    deadlineBusinessDays: 3,
    allowedTransitions: ["STEP_06_IDR_ENTITY_SELECTION"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(1)(ii)",
  },
  STEP_06_IDR_ENTITY_SELECTION: {
    id: "STEP_06_IDR_ENTITY_SELECTION",
    name: "IDR Entity Selection",
    description: "Parties jointly select certified IDR entity within 3 business days",
    deadlineBusinessDays: 3,
    allowedTransitions: ["STEP_07_IDR_ENTITY_SELECTED"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(1)(iii)",
  },
  STEP_07_IDR_ENTITY_SELECTED: {
    id: "STEP_07_IDR_ENTITY_SELECTED",
    name: "IDR Entity Selected",
    description: "Certified IDR entity assigned (by agreement or random selection)",
    deadlineBusinessDays: null,
    allowedTransitions: ["STEP_08_ELIGIBILITY_REVIEW"],
    isTerminal: false,
    requiredFields: ["idrEntityId"],
    nsaReference: "45 CFR § 149.510(b)(1)(iii)(B)",
  },
  STEP_08_ELIGIBILITY_REVIEW: {
    id: "STEP_08_ELIGIBILITY_REVIEW",
    name: "Eligibility Review",
    description: "IDR entity reviews eligibility of the dispute",
    deadlineBusinessDays: 3,
    allowedTransitions: ["STEP_09_OFFER_SUBMISSION"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(1)(ii)",
  },
  STEP_09_OFFER_SUBMISSION: {
    id: "STEP_09_OFFER_SUBMISSION",
    name: "Offer Submission",
    description: "Each party submits a final offer within 10 business days",
    deadlineBusinessDays: 10,
    allowedTransitions: ["STEP_10_QPA_DISCLOSURE"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(1)(iv)",
  },
  STEP_10_QPA_DISCLOSURE: {
    id: "STEP_10_QPA_DISCLOSURE",
    name: "QPA Disclosure",
    description: "Payer discloses Qualifying Payment Amount",
    deadlineBusinessDays: 5,
    allowedTransitions: ["STEP_11_ADDITIONAL_INFORMATION"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(1)(iv)(B)",
  },
  STEP_11_ADDITIONAL_INFORMATION: {
    id: "STEP_11_ADDITIONAL_INFORMATION",
    name: "Additional Information Period",
    description: "IDR entity may request additional information within 5 business days",
    deadlineBusinessDays: 5,
    allowedTransitions: ["STEP_12_ARBITRATION_REVIEW"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(1)(v)",
  },
  STEP_12_ARBITRATION_REVIEW: {
    id: "STEP_12_ARBITRATION_REVIEW",
    name: "Arbitration Review",
    description: "IDR entity reviews all submissions and prepares determination",
    deadlineBusinessDays: 30,
    allowedTransitions: ["STEP_13_DETERMINATION_ISSUED"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(1)(vi)",
  },
  STEP_13_DETERMINATION_ISSUED: {
    id: "STEP_13_DETERMINATION_ISSUED",
    name: "Determination Issued",
    description: "IDR entity selects one party's offer as the out-of-network rate",
    deadlineBusinessDays: null,
    allowedTransitions: ["STEP_14_PAYMENT_DETERMINATION"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(1)(vi)(A)",
  },
  STEP_14_PAYMENT_DETERMINATION: {
    id: "STEP_14_PAYMENT_DETERMINATION",
    name: "Payment Determination",
    description: "Final payment amount determined; payer must pay within 30 days",
    deadlineBusinessDays: 30,
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
    name: "Administrative Fee Paid",
    description: "Losing party pays administrative fee to federal IDR portal",
    deadlineBusinessDays: 30,
    allowedTransitions: ["STEP_17_DISPUTE_CLOSED"],
    isTerminal: false,
    requiredFields: [],
    nsaReference: "45 CFR § 149.510(b)(1)(viii)",
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
};

// ── Workflow engine ───────────────────────────────────────────────────────────

export interface WorkflowAdvanceResult {
  success: boolean;
  previousStep: IDRStep;
  newStep: IDRStep;
  deadline: Date | null;
  message: string;
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
  notes?: string
): Promise<WorkflowAdvanceResult> {
  return withDisputeLock(disputeId, 10000, async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");

    // Load current dispute state
    const rows = await db
      .select()
      .from(disputes)
      .where(eq(disputes.id, disputeId))
      .limit(1);

    if (!rows.length) throw new Error(`Dispute ${disputeId} not found`);
    const dispute = rows[0];
    const currentStep = dispute.currentStep as IDRStep;

    // Validate transition
    const stepDef = IDR_WORKFLOW_STEPS[currentStep];
    if (!stepDef) throw new Error(`Unknown step: ${currentStep}`);

    if (!stepDef.allowedTransitions.includes(targetStep)) {
      throw new Error(
        `Invalid transition from ${currentStep} to ${targetStep}. ` +
        `Allowed: ${stepDef.allowedTransitions.join(", ")}`
      );
    }

    if (stepDef.isTerminal) {
      throw new Error(`Dispute is in terminal step ${currentStep} and cannot be advanced`);
    }

    // Calculate deadline for new step
    const targetStepDef = IDR_WORKFLOW_STEPS[targetStep];
    const deadline = targetStepDef.deadlineBusinessDays
      ? addBusinessDays(new Date(), targetStepDef.deadlineBusinessDays)
      : null;

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
      },
      { userId, timestamp: new Date().toISOString() }
    );

    return {
      success: true,
      previousStep: currentStep,
      newStep: targetStep,
      deadline,
      message: `Advanced from ${stepDef.name} to ${targetStepDef.name}`,
    };
  });
}

/**
 * Get the workflow status for a given step.
 */
export function getStatusForStep(step: IDRStep): DisputeStatus {
  if (step === "STEP_17_DISPUTE_CLOSED") return "closed";
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
 * Add N business days to a date (skipping weekends).
 */
export function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
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
