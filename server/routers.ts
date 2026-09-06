import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, publicProcedure } from "./_core/trpc";
import { systemRouter } from "./_core/systemRouter";
import * as db from "./db";
import { EXCLUDED_NPI_IDS, isExcludedProvider } from "./npi-exclusions";
import { IDR_STEP, type IDRStep, type DisputeStatus } from "../drizzle/schema";
import { getLogger } from "./_core/logger";
import { redisGet, redisSet, redisDel, CacheTTL, CachePrefix, cacheKey } from "./redis";
import { env } from "./_core/env";
import { invokeLLM } from "./_core/llm";
import { notifyOwner } from "./_core/notification";
import { advanceWorkflow, getWorkflowProgress, getValidTransitions, IDR_WORKFLOW_STEPS } from "./workflow/idr-workflow";
import { eventBus } from "./events/bus";
import { registerWebhookHandlers, dispatchWebhookEvent } from "./events/webhook-consumer";
import { registerNotificationHandlers } from "./events/notification-consumer";
import { authRouter } from "./auth.routes";
import { memberRouter } from "./member.routes";
import { authzRouter } from "./authz.routes";
import { financialRouter } from "./financial.routes";
import { submissionAutomationRouter } from "./idr/submission-automation/routes";
import { stateProgramsRouter } from "./idr/state-programs/routes";
import { priorAuthRouter } from "./priorauth/routes";
import { batchedDisputesRouter } from "./idr/batching/routes";
import { feeScheduleRouter } from "./idr/clocks-2026/routes";
import { noticeConsentRouter } from "./notice-consent/routes";
import { gfePpdrRouter } from "./gfe-ppdr/routes";
import { auditMiddleware } from "./_core/audit-middleware";
import {
  checkStepTransition,
  checkCaseOwnership,
  checkSelfSelection,
  checkCertification,
  checkQPAConsistency,
  checkAmountThresholds,
  checkCPTBenchmarks,
  checkTimelineIntegrity,
  checkDocumentationRequired,
  checkJurisdictionRules,
  checkContactInfo,
  checkNPIDuplicate,
  checkSignatureRequired,
  checkDeadlineAlerts,
  checkConfidentialityConflict,
  checkMissingAddressee,
  checkMissingServiceLine,
  checkOfferAmountFormatting,
  checkConcurrentCases,
} from "./guards";

const logger = getLogger("routers");

/**
 * Admin-only procedure. Defined locally (not imported from ./_core/trpc,
 * which does not export it) using the standard role-check pattern.
 */
const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next();
});

// ─── Validation schemas ───────────────────────────────────────────────────────
const npiSchema = z.string().regex(/^\d{10}$/, "NPI must be exactly 10 digits");
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");
const idSchema = z.string().min(1).max(128);
const amountSchema = z.number().positive().max(9999999999);
const serviceTypeSchema = z.enum([
  "emergency_medicine",
  "anesthesiology",
  "radiology",
  "pathology",
  "neonatology",
  "hospitalist",
  "surgery",
  "air_ambulance",
  "ground_ambulance",
  "other",
]);

const cptCodeSchema = z
  .string()
  .regex(/^(?:\d{5}|[A-Z]\d{4}|[A-Z]{2}\d{4})$/i, "Invalid CPT/HCPCS code format")
  .transform(v => v.toUpperCase());

const createDisputeSchema = z.object({
  initiatingPartyId: idSchema,
  initiatingPartyType: z.enum(["provider", "facility", "air_ambulance"]),
  initiatingPartyName: z.string().min(1).max(255),
  initiatingPartyNPI: npiSchema.optional(),
  respondingPartyId: idSchema.optional(),
  respondingPartyName: z.string().max(255).optional(),
  respondingPartyType: z.enum(["health_plan", "issuer", "fehb_carrier"]).optional(),
  serviceType: serviceTypeSchema,
  serviceCode: z.string().max(20).optional(),
  cptCodes: z.array(cptCodeSchema).max(200).optional(),
  serviceDate: isoDateSchema,
  serviceLocation: z.string().max(255).optional(),
  facilityState: z.string().length(2).toUpperCase().optional(),
  billedAmount: amountSchema,
  qpaAmount: z.number().nonnegative().max(9999999999).optional(),
  initialPaymentAmount: z.number().nonnegative().max(9999999999).optional(),
  patientCostShare: z.number().nonnegative().max(9999999999).optional(),
});

const submitOfferSchema = z.object({
  disputeId: idSchema,
  offerType: z.enum(["initiating_party", "responding_party", "qpa", "final_determination"]),
  amount: amountSchema,
  submittedBy: z.string().max(255).optional(),
  justification: z.string().max(5000).optional(),
});

// ─── Step metadata (NSA statutory process) ────────────────────────────────────
export const STEP_METADATA: Record<IDRStep, { name: string; description: string; nsaReference: string; deadlineDays: number | null }> = {
  STEP_01_OPEN_NEGOTIATION_INITIATED: { name: "Open Negotiation Initiated", description: "Provider initiates 30-business-day open negotiation period", nsaReference: "45 CFR §149.410(b)", deadlineDays: null },
  STEP_02_OPEN_NEGOTIATION_PERIOD: { name: "Open Negotiation Period", description: "30-business-day period for parties to negotiate", nsaReference: "45 CFR §149.410(b)(1)", deadlineDays: 30 },
  STEP_03_OPEN_NEGOTIATION_FAILED: { name: "Open Negotiation Failed", description: "Parties failed to reach agreement within negotiation period", nsaReference: "45 CFR §149.410(b)(2)", deadlineDays: null },
  STEP_04_IDR_INITIATED: { name: "IDR Initiated", description: "Initiating party submits IDR initiation form within 4 business days", nsaReference: "45 CFR §149.510(b)(1)(i)", deadlineDays: 4 },
  STEP_05_IDR_NOTICE_SENT: { name: "IDR Notice Sent", description: "IDR initiation notice sent to responding party", nsaReference: "45 CFR §149.510(b)(1)(ii)", deadlineDays: 3 },
  STEP_06_IDR_ENTITY_SELECTION: { name: "IDR Entity Selection", description: "Parties jointly select certified IDR entity within 3 business days", nsaReference: "45 CFR §149.510(b)(1)(iii)", deadlineDays: 3 },
  STEP_07_IDR_ENTITY_SELECTED: { name: "IDR Entity Selected", description: "Certified IDR entity confirmed and assigned", nsaReference: "45 CFR §149.510(b)(1)(iii)(B)", deadlineDays: null },
  STEP_08_ELIGIBILITY_REVIEW: { name: "Eligibility Review", description: "IDR entity reviews dispute eligibility", nsaReference: "45 CFR §149.510(b)(1)(ii)", deadlineDays: 3 },
  STEP_09_OFFER_SUBMISSION: { name: "Offer Submission", description: "Each party submits final offer within 10 business days", nsaReference: "45 CFR §149.510(b)(1)(iv)", deadlineDays: 10 },
  STEP_10_QPA_DISCLOSURE: { name: "QPA Disclosure", description: "Payer discloses Qualifying Payment Amount", nsaReference: "45 CFR §149.510(b)(1)(iv)(B)", deadlineDays: 5 },
  STEP_11_ADDITIONAL_INFORMATION: { name: "Additional Information Period", description: "IDR entity may request additional information", nsaReference: "45 CFR §149.510(b)(1)(v)", deadlineDays: 5 },
  STEP_12_ARBITRATION_REVIEW: { name: "Arbitration Review", description: "IDR entity reviews submissions and prepares determination", nsaReference: "45 CFR §149.510(b)(1)(vi)", deadlineDays: 30 },
  STEP_13_DETERMINATION_ISSUED: { name: "Determination Issued", description: "IDR entity selects one party's offer as the out-of-network rate", nsaReference: "45 CFR §149.510(b)(1)(vi)(A)", deadlineDays: null },
  STEP_14_PAYMENT_DETERMINATION: { name: "Payment Determination", description: "Final payment amount determined; payer must pay within 30 calendar days", nsaReference: "45 CFR §149.510(b)(1)(vii)", deadlineDays: 30 },
  STEP_15_PAYMENT_MADE: { name: "Payment Made", description: "Payment remitted by payer", nsaReference: "45 CFR §149.510(b)(1)(vii)", deadlineDays: null },
  STEP_16_ADMINISTRATIVE_FEE_PAID: { name: "Administrative Fee Paid", description: "Each party pays the non-refundable administrative fee per 45 CFR §149.510(d)(1)", nsaReference: "45 CFR §149.510(d)(1)", deadlineDays: 30 },
  STEP_17_DISPUTE_CLOSED: { name: "Dispute Closed", description: "Dispute fully resolved and closed", nsaReference: "45 CFR §149.510", deadlineDays: null },
  STEP_18_APPEAL_FILED: { name: "Appeal Filed", description: "Party initiates judicial review", nsaReference: "45 CFR §149.510(b)(2)", deadlineDays: null },
  STEP_19_APPEAL_RESOLVED: { name: "Appeal Resolved", description: "Final appeal determination issued", nsaReference: "45 CFR §149.510(b)(2)", deadlineDays: null },
};

// ─── Statutory transition map ─────────────────────────────────────────────────
const VALID_TRANSITIONS: Record<IDRStep, IDRStep[]> = {
  STEP_01_OPEN_NEGOTIATION_INITIATED: ["STEP_02_OPEN_NEGOTIATION_PERIOD"],
  STEP_02_OPEN_NEGOTIATION_PERIOD: ["STEP_03_OPEN_NEGOTIATION_FAILED"],
  STEP_03_OPEN_NEGOTIATION_FAILED: ["STEP_04_IDR_INITIATED"],
  STEP_04_IDR_INITIATED: ["STEP_05_IDR_NOTICE_SENT"],
  STEP_05_IDR_NOTICE_SENT: ["STEP_06_IDR_ENTITY_SELECTION"],
  STEP_06_IDR_ENTITY_SELECTION: ["STEP_07_IDR_ENTITY_SELECTED"],
  STEP_07_IDR_ENTITY_SELECTED: ["STEP_08_ELIGIBILITY_REVIEW"],
  STEP_08_ELIGIBILITY_REVIEW: ["STEP_09_OFFER_SUBMISSION"],
  STEP_09_OFFER_SUBMISSION: ["STEP_10_QPA_DISCLOSURE"],
  STEP_10_QPA_DISCLOSURE: ["STEP_11_ADDITIONAL_INFORMATION"],
  STEP_11_ADDITIONAL_INFORMATION: ["STEP_12_ARBITRATION_REVIEW"],
  STEP_12_ARBITRATION_REVIEW: ["STEP_13_DETERMINATION_ISSUED"],
  STEP_13_DETERMINATION_ISSUED: ["STEP_14_PAYMENT_DETERMINATION"],
  STEP_14_PAYMENT_DETERMINATION: ["STEP_15_PAYMENT_MADE"],
  STEP_15_PAYMENT_MADE: ["STEP_16_ADMINISTRATIVE_FEE_PAID"],
  STEP_16_ADMINISTRATIVE_FEE_PAID: ["STEP_17_DISPUTE_CLOSED"],
  STEP_17_DISPUTE_CLOSED: [],
  STEP_18_APPEAL_FILED: ["STEP_19_APPEAL_RESOLVED"],
  STEP_19_APPEAL_RESOLVED: ["STEP_17_DISPUTE_CLOSED"],
};

const STEP_TO_STATUS: Partial<Record<IDRStep, DisputeStatus>> = {
  STEP_02_OPEN_NEGOTIATION_PERIOD: "open_negotiation",
  STEP_03_OPEN_NEGOTIATION_FAILED: "open_negotiation",
  STEP_04_IDR_INITIATED: "idr_initiated",
  STEP_05_IDR_NOTICE_SENT: "idr_initiated",
  STEP_06_IDR_ENTITY_SELECTION: "idr_entity_selection",
  STEP_07_IDR_ENTITY_SELECTED: "idr_entity_selection",
  STEP_08_ELIGIBILITY_REVIEW: "eligibility_review",
  STEP_09_OFFER_SUBMISSION: "offer_submission",
  STEP_10_QPA_DISCLOSURE: "under_arbitration",
  STEP_11_ADDITIONAL_INFORMATION: "under_arbitration",
  STEP_12_ARBITRATION_REVIEW: "under_arbitration",
  STEP_13_DETERMINATION_ISSUED: "determination_issued",
  STEP_14_PAYMENT_DETERMINATION: "payment_pending",
  STEP_15_PAYMENT_MADE: "payment_pending",
  STEP_16_ADMINISTRATIVE_FEE_PAID: "payment_pending",
  STEP_17_DISPUTE_CLOSED: "closed",
  STEP_18_APPEAL_FILED: "appealed",
  STEP_19_APPEAL_RESOLVED: "appealed",
};

// ─── Helper: get step number from step ID ─────────────────────────────────────
function getStepNumber(step: IDRStep): number {
  const match = step.match(/^STEP_(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

// ─── Helper: check deadline alerts for a dispute ──────────────────────────────
async function checkAndNotifyDeadlines(disputeId: string, dispute: { referenceNumber: string; initiatingPartyId: string; [key: string]: unknown }) {
  const now = new Date();
  const deadlines = [
    { field: "openNegotiationDeadline", label: "Open Negotiation Period", step: "STEP_02_OPEN_NEGOTIATION_PERIOD" },
    { field: "idrInitiationDeadline", label: "IDR Initiation Window", step: "STEP_04_IDR_INITIATED" },
    { field: "entitySelectionDeadline", label: "IDR Entity Selection", step: "STEP_06_IDR_ENTITY_SELECTION" },
    { field: "eligibilityDeadline", label: "Eligibility Review", step: "STEP_08_ELIGIBILITY_REVIEW" },
    { field: "offerSubmissionDeadline", label: "Offer Submission", step: "STEP_09_OFFER_SUBMISSION" },
    { field: "additionalInfoDeadline", label: "Additional Information", step: "STEP_11_ADDITIONAL_INFORMATION" },
    { field: "determinationDeadline", label: "Determination", step: "STEP_12_ARBITRATION_REVIEW" },
    { field: "paymentDeadline", label: "Payment", step: "STEP_14_PAYMENT_DETERMINATION" },
  ];

  for (const dl of deadlines) {
    const deadline = dispute[dl.field] as Date | null;
    if (!deadline) continue;
    const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysRemaining <= 5 && daysRemaining >= 0) {
      await db.createNotification({
        userId: dispute.initiatingPartyId,
        disputeId,
        type: daysRemaining <= 1 ? "deadline_warning" : "deadline_approaching",
        title: `${dl.label} deadline ${daysRemaining <= 1 ? "imminent" : "approaching"}`,
        message: `${dl.label} deadline for dispute ${dispute.referenceNumber} is in ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""}`,
      });
    }
  }
}

// ─── Regulatory text excerpts (for dashboard display) ─────────────────────────
export const REGULATORY_REFERENCES = [
  {
    id: "reg-001",
    citation: "45 CFR § 149.510",
    title: "Federal IDR Process",
    category: "IDR",
    summary: "Establishes the Federal IDR process for determining out-of-network payment amounts between providers and health plans.",
    fullText: "The Federal IDR process provides a mechanism for providers, facilities, and health plans to resolve payment disputes for out-of-network services covered under the No Surprises Act.",
  },
  {
    id: "reg-002",
    citation: "45 CFR § 149.410",
    title: "Open Negotiation Requirements",
    category: "Negotiation",
    summary: "Requires a 30-business-day open negotiation period before initiating the Federal IDR process.",
    fullText: "Before initiating the Federal IDR process, the initiating party must provide written notice of open negotiation to the other party. The open negotiation period is 30 business days.",
  },
  {
    id: "reg-003",
    citation: "PHSA § 2799A-1",
    title: "No Surprises Act - Balance Billing Prohibition",
    category: "Patient Protection",
    summary: "Prohibits balance billing for emergency services and certain non-emergency services at in-network facilities.",
    fullText: "Group health plans and health insurance issuers must cover emergency services without prior authorization and regardless of network status, and cannot impose cost-sharing greater than in-network amounts.",
  },
  {
    id: "reg-004",
    citation: "45 CFR § 149.510(c)(4)",
    title: "Payment Determination Standards",
    category: "IDR",
    summary: "Certified IDR entities must select the offer that best represents the value of the item or service, with the QPA as the presumptive factor.",
    fullText: "The certified IDR entity must select one of the offers submitted and notify both parties. The determination is binding unless fraud or misrepresentation is shown.",
  },
  {
    id: "reg-005",
    citation: "45 CFR § 149.510(d)",
    title: "IDR Administrative Fees",
    category: "Fees",
    summary: "Fee amounts are set annually by Departments guidance (not fixed in the CFR): each party must pay the non-refundable administrative fee, and the prevailing party's certified IDR entity fee is refunded. Amounts differ between single and batched disputes.",
    fullText: "Each party to a determination must pay an administrative fee for participating in the Federal IDR process. The administrative fee amount and certified IDR entity fee ranges are established annually by Departments guidance and are not fixed in the regulation text. In HealthPoint these amounts are stored in the effective-dated IDR fee schedule (see Admin Fee Management) rather than hardcoded.",
  },
  {
    id: "reg-006",
    citation: "26 CFR § 54.9816-6T",
    title: "IRS Implementation of NSA",
    category: "Tax",
    summary: "IRS regulations implementing No Surprises Act requirements for group health plans.",
    fullText: "These temporary regulations implement protections against balance billing under the No Surprises Act for group health plans and health insurance coverage.",
  },
  {
    id: "reg-007",
    citation: "29 CFR § 2590.716-6",
    title: "DOL Implementation of NSA",
    category: "Labor",
    summary: "Department of Labor regulations implementing NSA requirements for employer-sponsored health plans.",
    fullText: "These regulations apply No Surprises Act protections to group health plans and health insurance issuers offering group health insurance coverage.",
  },
  {
    id: "reg-008",
    citation: "45 CFR § 149.30",
    title: "Calculation of Cost-Sharing",
    category: "Cost Sharing",
    summary: "Specifies how the qualifying payment amount (QPA) is calculated for patient cost-sharing purposes.",
    fullText: "The QPA is generally the median of contracted rates for the same or similar item or service in the same geographic region.",
  },
];

// ─── tRPC Routers ─────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  member: memberRouter,
  authz: authzRouter,
  financial: financialRouter,
  submissionAutomation: submissionAutomationRouter,
  statePrograms: stateProgramsRouter,
  priorAuth: priorAuthRouter,
  batchedDisputes: batchedDisputesRouter,
  feeSchedule: feeScheduleRouter,
  noticeConsent: noticeConsentRouter,
  gfePpdr: gfePpdrRouter,

  // ── Disputes ────────────────────────────────────────────────────────────────
  disputes: router({
    list: protectedProcedure
      .input(z.object({
        status: z.string().optional(),
        serviceType: z.string().optional(),
        search: z.string().max(255).optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      }).optional())
      .query(async ({ input, ctx }) => {
        const cacheK = cacheKey(CachePrefix.DISPUTES, ctx.user.id, JSON.stringify(input ?? {}));
        const cached = await redisGet<{ items: unknown[]; total: number }>(cacheK);
        if (cached) return cached;
        const result = await db.listDisputes({
          // Object-level authorization: non-admin users only see disputes they
          // initiated or created (defense-in-depth alongside the Permify guard
          // in authz-registry). Admins see all.
          userId: ctx.user.role === "admin" ? undefined : ctx.user.id,
          status: input?.status as DisputeStatus | undefined,
          serviceType: input?.serviceType,
          search: input?.search,
          limit: input?.limit,
          offset: input?.offset,
        });
        await redisSet(cacheK, result, CacheTTL.MEDIUM);
        return result;
      }),

    get: protectedProcedure
      .input(z.object({ id: idSchema }))
      .query(async ({ input, ctx }) => {
        const cacheK = cacheKey(CachePrefix.DISPUTES, ctx.user.id, input.id);
        const cached = await redisGet(cacheK);
        if (cached) return cached;
        const dispute = await db.getDisputeById(input.id);
        if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });
        // Object-level authorization: only the initiating party, responding
        // party, creator, or an admin may read a dispute's full record.
        const isParty =
          ctx.user.role === "admin" ||
          dispute.initiatingPartyId === ctx.user.id ||
          dispute.createdBy === ctx.user.id ||
          dispute.respondingPartyId === ctx.user.id;
        if (!isParty) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this dispute" });
        }
        // Check deadline alerts
        await checkAndNotifyDeadlines(input.id, dispute);
        const progress = getWorkflowProgress(dispute.currentStep as IDRStep);
        const validTransitions = getValidTransitions(dispute.currentStep as IDRStep);
        const result = { ...dispute, progress, validTransitions };
        await redisSet(cacheK, result, CacheTTL.SHORT);
        return result;
      }),

    create: protectedProcedure
      .input(createDisputeSchema)
      .mutation(async ({ input, ctx }) => {
        // Validate QPA benchmark
        const qpaResult = input.cptCodes && input.cptCodes.length > 0 && input.facilityState
          ? db.calculateQPA(input.billedAmount, input.cptCodes, input.facilityState)
          : undefined;

        // Guard checks
        await Promise.all([
          checkQPAConsistency(input.billedAmount, input.qpaAmount),
          checkAmountThresholds(input.billedAmount),
          checkCPTBenchmarks(input.billedAmount, input.cptCodes ?? [], input.facilityState),
          checkNPIDuplicate(input.initiatingPartyNPI),
          checkJurisdictionRules(input.facilityState),
        ]);

        if (input.initiatingPartyNPI && isExcludedProvider(input.initiatingPartyNPI)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This NPI is on the OIG exclusion list and cannot initiate disputes",
          });
        }

        const dispute = await db.createDispute({
          ...input,
          createdBy: ctx.user.id,
          cptCodes: input.cptCodes ?? [],
          qpaValidationResult: qpaResult ?? undefined,
        });

        // Publish event
        await eventBus.publish("dispute.created", dispute.id, "dispute", {
          referenceNumber: dispute.referenceNumber,
          initiatingPartyName: dispute.initiatingPartyName,
          serviceType: dispute.serviceType,
          billedAmount: dispute.billedAmount,
          createdBy: ctx.user.id,
        }, { userId: ctx.user.id, timestamp: new Date().toISOString() });

        // Dispatch webhook
        await dispatchWebhookEvent("dispute.created", {
          disputeId: dispute.id,
          referenceNumber: dispute.referenceNumber,
          serviceType: dispute.serviceType,
          billedAmount: dispute.billedAmount,
        }, ctx.user.id);

        // Invalidate cache
        await redisDel(cacheKey(CachePrefix.DISPUTES, ctx.user.id));

        logger.info({ disputeId: dispute.id, referenceNumber: dispute.referenceNumber }, "Dispute created");
        return dispute;
      }),

    advance: protectedProcedure
      .input(z.object({
        disputeId: idSchema,
        targetStep: z.enum(IDR_STEP),
        notes: z.string().max(2000).optional(),
        additionalData: z.object({
          idrEntityId: idSchema.optional(),
          idrEntityName: z.string().max(255).optional(),
          determinationAmount: z.number().positive().optional(),
          qpaAmount: z.number().nonnegative().optional(),
        }).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const dispute = await db.getDisputeById(input.disputeId);
        if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });

        // Object-level authorization: only the initiating party, creator, or
        // an admin may advance a dispute through the workflow.
        const isParty =
          ctx.user.role === "admin" ||
          dispute.initiatingPartyId === ctx.user.id ||
          dispute.createdBy === ctx.user.id;
        if (!isParty) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to advance this dispute" });
        }

        const currentStep = dispute.currentStep as IDRStep;
        checkStepTransition(currentStep, input.targetStep);
        checkCaseOwnership(dispute, ctx.user.id, ctx.user.role);
        if (input.targetStep === "STEP_07_IDR_ENTITY_SELECTED" && input.additionalData?.idrEntityId) {
          await checkCertification(input.additionalData.idrEntityId);
          checkSelfSelection(dispute, input.additionalData.idrEntityId);
          await checkConcurrentCases(input.additionalData.idrEntityId);
        }

        const newStatus = STEP_TO_STATUS[input.targetStep] ?? (dispute.status as DisputeStatus);
        const stepMeta = STEP_METADATA[input.targetStep];

        const updated = await db.advanceDisputeStep(
          input.disputeId,
          input.targetStep,
          newStatus,
          ctx.user.id,
          ctx.user.name ?? ctx.user.email ?? "Unknown",
          `Advanced to ${stepMeta.name}${input.notes ? `: ${input.notes}` : ""}`,
          input.additionalData
        );

        // Send notification
        const notificationMessages: Partial<Record<IDRStep, string>> = {
          STEP_04_IDR_INITIATED: `IDR initiated for dispute ${dispute.referenceNumber}. The parties have 3 business days to jointly select a certified IDR entity (45 CFR § 149.510(c)(1)).`,
          STEP_06_IDR_ENTITY_SELECTION: `IDR entity selection required for ${dispute.referenceNumber}. Deadline: 3 business days.`,
          STEP_09_OFFER_SUBMISSION: `Offer submission period opened for ${dispute.referenceNumber}. Submit your final offer within 10 business days.`,
          STEP_13_DETERMINATION_ISSUED: `Determination issued for ${dispute.referenceNumber}. View the selected offer amount.`,
          STEP_14_PAYMENT_DETERMINATION: `Payment determination finalized for ${dispute.referenceNumber}. Payment due within 30 calendar days.`,
          STEP_17_DISPUTE_CLOSED: `Dispute ${dispute.referenceNumber} has been closed.`,
        };

        const notifMsg = notificationMessages[input.targetStep];
        if (notifMsg) {
          await db.createNotification({
            userId: dispute.initiatingPartyId,
            disputeId: input.disputeId,
            type: "step_advanced",
            title: stepMeta.name,
            message: notifMsg,
          });
        }

        // Publish event
        await eventBus.publish("dispute.advanced", input.disputeId, "dispute", {
          previousStep: currentStep,
          newStep: input.targetStep,
          newStatus,
          referenceNumber: dispute.referenceNumber,
        }, { userId: ctx.user.id, timestamp: new Date().toISOString() });

        await redisDel(cacheKey(CachePrefix.DISPUTES, ctx.user.id));
        return updated;
      }),

    submitOffer: protectedProcedure
      .input(submitOfferSchema)
      .mutation(async ({ input, ctx }) => {
        const dispute = await db.getDisputeById(input.disputeId);
        if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });

        // Object-level authorization: only parties to the dispute may submit offers.
        const isParty =
          ctx.user.role === "admin" ||
          dispute.initiatingPartyId === ctx.user.id ||
          dispute.createdBy === ctx.user.id ||
          dispute.respondingPartyId === ctx.user.id;
        if (!isParty) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to submit offers on this dispute" });
        }

        checkOfferAmountFormatting(input.amount);
        checkSignatureRequired(input.offerType, ctx.user);

        const offerId = await db.submitOffer({
          disputeId: input.disputeId,
          offerType: input.offerType,
          amount: input.amount,
          submittedBy: input.submittedBy ?? ctx.user.name ?? ctx.user.email ?? ctx.user.id,
          justification: input.justification,
        });

        await eventBus.publish("dispute.offer_submitted", input.disputeId, "dispute", {
          offerId,
          offerType: input.offerType,
          amount: input.amount,
          referenceNumber: dispute.referenceNumber,
        }, { userId: ctx.user.id, timestamp: new Date().toISOString() });

        await redisDel(cacheKey(CachePrefix.DISPUTES, ctx.user.id));
        return { offerId };
      }),

    acceptOffer: protectedProcedure
      .input(z.object({ disputeId: idSchema, offerId: idSchema }))
      .mutation(async ({ input, ctx }) => {
        const dispute = await db.getDisputeById(input.disputeId);
        if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });

        // Object-level authorization: only the initiating party, creator, or
        // an admin may accept an offer (accepting the counterparty's offer
        // resolves the dispute against your own position).
        const isParty =
          ctx.user.role === "admin" ||
          dispute.initiatingPartyId === ctx.user.id ||
          dispute.createdBy === ctx.user.id;
        if (!isParty) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to accept offers on this dispute" });
        }

        const updated = await db.acceptOffer(
          input.disputeId,
          input.offerId,
          ctx.user.id,
          ctx.user.name ?? ctx.user.email ?? "Unknown"
        );
        await redisDel(cacheKey(CachePrefix.DISPUTES, ctx.user.id));
        return updated;
      }),

    addDocument: protectedProcedure
      .input(z.object({
        disputeId: idSchema,
        documentType: z.string().max(100),
        fileName: z.string().max(255),
        fileUrl: z.string().url().max(2048),
        fileSize: z.number().nonnegative().max(500 * 1024 * 1024),
        mimeType: z.string().max(100).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const dispute = await db.getDisputeById(input.disputeId);
        if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });

        // Object-level authorization: only parties to the dispute may attach documents.
        const isParty =
          ctx.user.role === "admin" ||
          dispute.initiatingPartyId === ctx.user.id ||
          dispute.createdBy === ctx.user.id ||
          dispute.respondingPartyId === ctx.user.id;
        if (!isParty) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to add documents to this dispute" });
        }

        checkDocumentationRequired(dispute.currentStep as IDRStep, input.documentType);

        const documentId = await db.addDocument({
          ...input,
          uploadedBy: ctx.user.id,
          uploadedByName: ctx.user.name ?? ctx.user.email ?? undefined,
        });
        await redisDel(cacheKey(CachePrefix.DISPUTES, ctx.user.id));
        return { documentId };
      }),

    getSteps: protectedProcedure.query(() => {
      return Object.entries(STEP_METADATA).map(([step, meta]) => ({
        step: step as IDRStep,
        ...meta,
        stepNumber: getStepNumber(step as IDRStep),
        validTransitions: VALID_TRANSITIONS[step as IDRStep],
      }));
    }),

    getRegulatoryReferences: publicProcedure.query(() => REGULATORY_REFERENCES),

    getDashboardStats: protectedProcedure.query(async ({ ctx }) => {
      const cacheK = cacheKey(CachePrefix.ANALYTICS, ctx.user.id, "dashboard");
      const cached = await redisGet(cacheK);
      if (cached) return cached;
      const stats = await db.getDashboardStats(ctx.user.id);
      await redisSet(cacheK, stats, CacheTTL.SHORT);
      return stats;
    }),
  }),

  // ── IDR Entities ────────────────────────────────────────────────────────────
  idrEntitiesAdmin: router({
    list: protectedProcedure
      .input(z.object({ state: z.string().length(2).optional(), specialty: z.string().optional() }).optional())
      .query(async ({ input }) => {
        return db.listIDREntities(input ?? {});
      }),

    getCaseload: protectedProcedure
      .input(z.object({ entityId: idSchema }))
      .query(async ({ input }) => {
        const caseload = await db.getIDREntityCaseload(input.entityId);
        if (!caseload) throw new TRPCError({ code: "NOT_FOUND", message: "IDR entity not found" });
        return caseload;
      }),

    listAllCaseloads: adminProcedure.query(async () => {
      return db.listAllIDREntityCaseloads();
    }),
  }),

  // ── Notifications ───────────────────────────────────────────────────────────
  notifications: router({
    list: protectedProcedure
      .input(z.object({ unreadOnly: z.boolean().default(false) }).optional())
      .query(async ({ input, ctx }) => {
        return db.listNotifications(ctx.user.id, input?.unreadOnly ?? false);
      }),

    markRead: protectedProcedure
      .input(z.object({ id: idSchema }))
      .mutation(async ({ input, ctx }) => {
        await db.markNotificationRead(input.id, ctx.user.id);
        return { success: true };
      }),

    markAllRead: protectedProcedure
      .mutation(async ({ ctx }) => {
        const unread = await db.listNotifications(ctx.user.id, true);
        for (const n of unread) {
          await db.markNotificationRead(n.id, ctx.user.id);
        }
        return { success: true, count: unread.length };
      }),
  }),

  // ── Analytics ───────────────────────────────────────────────────────────────
  analytics: router({
    disputesByMonth: protectedProcedure
      .input(z.object({ months: z.number().min(1).max(36).default(12) }).optional())
      .query(async ({ input }) => {
        return db.getDisputesByMonth(input?.months ?? 12);
      }),
  }),

  // ── QPA ─────────────────────────────────────────────────────────────────────
  qpa: router({
    calculate: protectedProcedure
      .input(z.object({
        billedAmount: z.number().positive(),
        cptCodes: z.array(z.string().max(10)).max(50),
        facilityState: z.string().length(2).toUpperCase(),
      }))
      .mutation(async ({ input }) => {
        return db.calculateQPA(input.billedAmount, input.cptCodes, input.facilityState);
      }),
  }),

  // ── NPI ─────────────────────────────────────────────────────────────────────
  npi: router({
    checkExclusion: publicProcedure
      .input(z.object({ npi: npiSchema }))
      .query(({ input }) => {
        return { npi: input.npi, excluded: isExcludedProvider(input.npi), exclusionList: EXCLUDED_NPI_IDS.length };
      }),
  }),

  // ── AI Assistant ────────────────────────────────────────────────────────────
  ai: router({
    chat: protectedProcedure
      .input(z.object({
        messages: z.array(z.object({
          role: z.enum(["user", "assistant", "system"]),
          content: z.string().max(10000),
        })).max(50),
        context: z.object({
          disputeId: idSchema.optional(),
          disputeData: z.record(z.unknown()).optional(),
        }).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const systemPrompt = `You are an expert assistant for the No Surprises Act (NSA) Independent Dispute Resolution (IDR) process.
You help users understand:
- The 19-step Federal IDR process (45 CFR §149.510)
- Open negotiation requirements (45 CFR §149.410)
- Qualifying Payment Amount (QPA) calculations
- Deadline management and statutory timelines
- Required documentation at each step
- Offer submission strategy

Be precise, cite regulations, and always note that this is not legal advice.
${input.context?.disputeData ? `\nCurrent dispute context:\n${JSON.stringify(input.context.disputeData, null, 2)}` : ""}`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            ...input.messages,
          ],
        });

        const choice = response.choices[0];
        return {
          message: choice.message.content ?? "",
          usage: response.usage,
        };
      }),

    analyzeDispute: protectedProcedure
      .input(z.object({
        disputeId: idSchema,
        analysisType: z.enum(["qpa_review", "offer_strategy", "deadline_risk", "document_checklist", "eligibility_check"]),
      }))
      .mutation(async ({ input, ctx }) => {
        const dispute = await db.getDisputeById(input.disputeId);
        if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });

        const isParty =
          ctx.user.role === "admin" ||
          dispute.initiatingPartyId === ctx.user.id ||
          dispute.createdBy === ctx.user.id ||
          dispute.respondingPartyId === ctx.user.id;
        if (!isParty) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this dispute" });
        }

        const promptTemplates: Record<string, string> = {
          qpa_review: `Analyze the QPA for this dispute. Billed amount: $${dispute.billedAmount}, QPA: $${dispute.qpaAmount ?? "not provided"}. CPT codes: ${(dispute.cptCodes as string[] ?? []).join(", ") || "not provided"}. State: ${dispute.facilityState ?? "not provided"}. Assess whether the billed amount is reasonable relative to the QPA and suggest documentation needed.`,
          offer_strategy: `Recommend an offer strategy for this dispute at step ${dispute.currentStep}. Billed amount: $${dispute.billedAmount}, QPA: $${dispute.qpaAmount ?? "unknown"}. Service type: ${dispute.serviceType}. Consider statutory factors in 45 CFR §149.510(c)(4).`,
          deadline_risk: `Assess deadline risks for this dispute. Current step: ${dispute.currentStep}. Deadlines: ON deadline ${dispute.openNegotiationDeadline}, offer deadline ${dispute.offerSubmissionDeadline}, determination deadline ${dispute.determinationDeadline}, payment deadline ${dispute.paymentDeadline}. Current date: ${new Date().toISOString()}.`,
          document_checklist: `List the required documents for this dispute at step ${dispute.currentStep} (${STEP_METADATA[dispute.currentStep as IDRStep]?.name}). Service type: ${dispute.serviceType}. Reference 45 CFR §149.510 requirements.`,
          eligibility_check: `Check IDR eligibility for this dispute. Service type: ${dispute.serviceType}, state: ${dispute.facilityState}, billed: $${dispute.billedAmount}, QPA: $${dispute.qpaAmount ?? "unknown"}. Assess NSA applicability and any state-specific considerations.`,
        };

        const response = await invokeLLM({
          messages: [
            { role: "system", content: "You are an NSA IDR expert. Provide structured, actionable analysis with regulatory citations. Note that this is not legal advice." },
            { role: "user", content: promptTemplates[input.analysisType] },
          ],
        });

        return {
          analysis: response.choices[0].message.content ?? "",
          analysisType: input.analysisType,
          disputeId: input.disputeId,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
