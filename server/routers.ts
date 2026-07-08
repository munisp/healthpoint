import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { ENV } from "./_core/env";

import {
  createDispute, getDisputeById, listDisputes, advanceDisputeStep,
  submitOffer, acceptOffer, addDocument, listIDREntities, seedIDREntities,
  getDashboardStats, listNotifications, markNotificationRead,
  createNotification,
  upsertDisputeDraft, getDisputeDraft, deleteDisputeDraft,
  calculateQPA,
  getIDREntityCaseload, listAllIDREntityCaseloads,
} from "./db";
import { IDR_STEP, DISPUTE_STATUS, SERVICE_TYPE, PARTY_TYPE } from "../drizzle/schema";

// Admin-only middleware
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const createDisputeSchema = z.object({
  initiatingPartyType: z.enum(PARTY_TYPE),
  initiatingPartyName: z.string().min(1),
  initiatingPartyNpi: z.string().optional(),
  respondingPartyType: z.enum(PARTY_TYPE).optional(),
  respondingPartyName: z.string().optional(),
  respondingPartyNpi: z.string().optional(),
  serviceType: z.enum(SERVICE_TYPE),
  serviceDate: z.string().datetime(),
  patientState: z.string().length(2),
  facilityState: z.string().length(2),
  cptCodes: z.array(z.string()).min(1),
  icd10Codes: z.array(z.string()).optional(),
  billedAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  notes: z.string().optional(),
});

const advanceStepSchema = z.object({
  disputeId: z.string(),
  newStep: z.enum(IDR_STEP),
  newStatus: z.enum(DISPUTE_STATUS),
  description: z.string().min(1),
  idrEntityId: z.string().optional(),
  idrEntityName: z.string().optional(),
  isEligible: z.boolean().optional(),
  ineligibilityReason: z.string().optional(),
  determinationBasis: z.string().optional(),
});

const submitOfferSchema = z.object({
  disputeId: z.string(),
  offerType: z.enum(["initiating_party", "responding_party", "qpa", "determination"]),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  rationale: z.string().optional(),
});

export const appRouter = router({
  system: router({
    health: publicProcedure
      .input(z.object({ timestamp: z.number().min(0) }))
      .query(() => ({ ok: true })),
  }),

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: protectedProcedure.mutation(opts => {
      const { ctx } = opts;
      ctx.res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        sameSite: "lax",
        secure: ENV.isProduction,
        path: "/",
      });
      return { success: true } as const;
    }),
  }),

  // ─── Dashboard ──────────────────────────────────────────────────────────────
  dashboard: router({
    stats: protectedProcedure.query(async ({ ctx }) => {
      const stats = await getDashboardStats(ctx.user.id);
      if (!stats) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to load dashboard stats" });
      return stats;
    }),
  }),

  // ─── Disputes ───────────────────────────────────────────────────────────────
  disputes: router({
    list: protectedProcedure
      .input(z.object({
        status: z.enum(DISPUTE_STATUS).optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      }))
      .query(async ({ ctx, input }) => {
        return listDisputes({ userId: ctx.user.id, ...input });
      }),

    getById: protectedProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        const dispute = await getDisputeById(input.id);
        if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });
        return dispute;
      }),

    create: protectedProcedure
      .input(createDisputeSchema)
      .mutation(async ({ ctx, input }) => {
        const dispute = await createDispute({
          ...input,
          id: crypto.randomUUID(),
          referenceNumber: "", // will be generated in createDispute
          serviceDate: new Date(input.serviceDate),
          cptCodes: input.cptCodes,
          icd10Codes: input.icd10Codes ?? null,
          billedAmount: input.billedAmount,
          createdBy: ctx.user.id,
          initiatingPartyId: ctx.user.id,
        });
        // Create deadline notification
        await createNotification({
          disputeId: dispute.id,
          userId: ctx.user.id,
          notificationType: "deadline_warning",
          title: `Open Negotiation Deadline — ${dispute.referenceNumber}`,
          message: `You have 30 business days to complete open negotiation for dispute ${dispute.referenceNumber}. Deadline: ${dispute.openNegotiationDeadline?.toLocaleDateString()}.`,
          dueDate: dispute.openNegotiationDeadline ?? null,
        });
        return dispute;
      }),

    advance: protectedProcedure
      .input(advanceStepSchema)
      .mutation(async ({ ctx, input }) => {
        const { disputeId, newStep, newStatus, description, ...additionalData } = input;
        const dispute = await advanceDisputeStep(
          disputeId, newStep, newStatus,
          ctx.user.id, ctx.user.name ?? "Unknown",
          description,
          {
            idrEntityId: additionalData.idrEntityId ?? undefined,
            idrEntityName: additionalData.idrEntityName ?? undefined,
            isEligible: additionalData.isEligible ?? undefined,
            ineligibilityReason: additionalData.ineligibilityReason ?? undefined,
            determinationBasis: additionalData.determinationBasis ?? undefined,
          }
        );
        // Create step-specific notifications
        if (newStep === "STEP_04_IDR_INITIATED") {
          await createNotification({
            disputeId,
            userId: ctx.user.id,
            notificationType: "step_advanced",
            title: `IDR Initiated — ${dispute.referenceNumber}`,
            message: `Federal IDR has been initiated. You have 4 business days to select a certified IDR entity.`,
            dueDate: dispute.idrInitiationDeadline ?? null,
          });
        } else if (newStep === "STEP_09_OFFER_SUBMISSION") {
          await createNotification({
            disputeId,
            userId: ctx.user.id,
            notificationType: "deadline_warning",
            title: `Offer Submission Due — ${dispute.referenceNumber}`,
            message: `Both parties must submit their offers within 10 business days. Deadline: ${dispute.offerSubmissionDeadline?.toLocaleDateString()}.`,
            dueDate: dispute.offerSubmissionDeadline ?? null,
          });
        } else if (newStep === "STEP_13_DETERMINATION_ISSUED") {
          await createNotification({
            disputeId,
            userId: ctx.user.id,
            notificationType: "determination_issued",
            title: `Determination Issued — ${dispute.referenceNumber}`,
            message: `The IDR entity has issued a payment determination. Payment is due within 30 days.`,
            dueDate: dispute.paymentDeadline ?? null,
          });
        }
        return dispute;
      }),

    submitOffer: protectedProcedure
      .input(submitOfferSchema)
      .mutation(async ({ ctx, input }) => {
        const offerId = await submitOffer({
          disputeId: input.disputeId,
          offerType: input.offerType,
          amount: input.amount,
          rationale: input.rationale ?? null,
          supportingDocIds: null,
          submittedBy: ctx.user.id,
        });
        return { offerId };
      }),

    acceptOffer: protectedProcedure
      .input(z.object({
        disputeId: z.string(),
        offerId: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dispute = await acceptOffer(
          input.disputeId,
          input.offerId,
          ctx.user.id,
          ctx.user.name ?? "Unknown"
        );
        await createNotification({
          disputeId: input.disputeId,
          userId: ctx.user.id,
          notificationType: "determination_issued",
          title: `Determination Issued — ${dispute.referenceNumber}`,
          message: `An offer has been accepted and the dispute has been resolved. Determination amount: $${Number(dispute.determinationAmount).toLocaleString()}.`,
          dueDate: null,
        });
        return { success: true, dispute };
      }),

    selectArbitrator: protectedProcedure
      .input(z.object({
        disputeId: z.string(),
        idrEntityId: z.string(),
        idrEntityName: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        return advanceDisputeStep(
          input.disputeId,
          "STEP_07_IDR_ENTITY_SELECTED",
          "eligibility_review",
          ctx.user.id,
          ctx.user.name ?? "Unknown",
          `IDR entity selected: ${input.idrEntityName}`,
          { idrEntityId: input.idrEntityId, idrEntityName: input.idrEntityName }
        );
      }),

    uploadDocument: protectedProcedure
      .input(z.object({
        disputeId: z.string(),
        documentType: z.string(),
        fileName: z.string(),
        fileSize: z.number().optional(),
        mimeType: z.string().optional(),
        s3Key: z.string().optional(),
        description: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const docId = await addDocument({
          ...input,
          fileSize: input.fileSize ?? null,
          mimeType: input.mimeType ?? null,
          s3Key: input.s3Key ?? null,
          description: input.description ?? null,
          uploadedBy: ctx.user.id,
        });
        return { docId };
      }),

    getTimeline: protectedProcedure
      .input(z.object({ disputeId: z.string() }))
      .query(async ({ input }) => {
        const dispute = await getDisputeById(input.disputeId);
        if (!dispute) throw new TRPCError({ code: "NOT_FOUND" });
        // Build step-by-step timeline with completion status
        const completedSteps = new Set(dispute.events.map(e => e.step));
        const currentStepIndex = IDR_STEP.indexOf(dispute.currentStep as typeof IDR_STEP[number]);
        const timeline = IDR_STEP.map((step, index) => ({
          step,
          stepNumber: index + 1,
          label: step.replace(/^STEP_\d+_/, '').replace(/_/g, ' '),
          isCompleted: index < currentStepIndex,
          isCurrent: step === dispute.currentStep,
          isPending: index > currentStepIndex,
          event: dispute.events.find(e => e.step === step) ?? null,
        }));
        return { timeline, dispute, offers: dispute.offers ?? [] };
      }),
  }),

  // ─── IDR Entities ────────────────────────────────────────────────────────────
  arbitrators: router({
    list: protectedProcedure
      .input(z.object({
        state: z.string().optional(),
        specialty: z.string().optional(),
      }))
      .query(async ({ input }) => {
        await seedIDREntities(); // Seed on first call
        return listIDREntities(input);
      }),

    caseload: protectedProcedure
      .input(z.object({ entityId: z.string() }))
      .query(async ({ input }) => {
        await seedIDREntities();
        const result = await getIDREntityCaseload(input.entityId);
        if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "IDR entity not found" });
        return result;
      }),

    allCaseloads: protectedProcedure
      .query(async () => {
        await seedIDREntities();
        return listAllIDREntityCaseloads();
      }),
  }),

  // ─── Draft disputes ───────────────────────────────────────────────────────────
  drafts: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      return getDisputeDraft(ctx.user.id);
    }),

    save: protectedProcedure
      .input(z.object({
        wizardStep: z.number().min(1).max(5),
        formData: z.record(z.string(), z.unknown()),
      }))
      .mutation(async ({ ctx, input }) => {
        return upsertDisputeDraft(ctx.user.id, input.wizardStep, input.formData);
      }),

    delete: protectedProcedure.mutation(async ({ ctx }) => {
      await deleteDisputeDraft(ctx.user.id);
      return { success: true };
    }),
  }),

  // ─── QPA validation ───────────────────────────────────────────────────────────
  qpa: router({
    validate: protectedProcedure
      .input(z.object({
        billedAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
        cptCodes: z.array(z.string()).min(1),
        facilityState: z.string().length(2),
      }))
      .query(async ({ input }) => {
        const amount = parseFloat(input.billedAmount);
        return calculateQPA(amount, input.cptCodes, input.facilityState);
      }),
  }),

  // ─── Notifications ───────────────────────────────────────────────────────────
  notifications: router({
    list: protectedProcedure
      .input(z.object({ unreadOnly: z.boolean().default(false) }))
      .query(async ({ ctx, input }) => {
        return listNotifications(ctx.user.id, input.unreadOnly);
      }),

    markRead: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        await markNotificationRead(input.id);
        return { success: true };
      }),

    markAllRead: protectedProcedure
      .mutation(async ({ ctx }) => {
        const notifs = await listNotifications(ctx.user.id, true);
        await Promise.all(notifs.map(n => markNotificationRead(n.id)));
        return { count: notifs.length };
      }),
  }),

  // ─── Document upload ──────────────────────────────────────────────────────────
  documents: router({
    upload: protectedProcedure
      .input(z.object({
        disputeId: z.string(),
        fileName: z.string().min(1),
        fileType: z.string().min(1),
        documentType: z.enum([
          "qpa_documentation", "eob", "contract", "medical_records",
          "cost_sharing_info", "prior_authorization", "other",
        ]),
        fileSize: z.number().min(1),
        storageKey: z.string().min(1),
        storageUrl: z.string().url(),
        description: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return addDocument({
          disputeId: input.disputeId,
          uploadedBy: ctx.user.id,
          fileName: input.fileName,
          mimeType: input.fileType,
          documentType: input.documentType,
          fileSize: input.fileSize,
          s3Key: input.storageKey,
          description: input.description ?? null,
        });
      }),
    list: protectedProcedure
      .input(z.object({ disputeId: z.string() }))
      .query(async ({ input }) => {
        const db = await (await import("./db")).getDb();
        if (!db) return [];
        const { disputeDocuments } = await import("../drizzle/schema");
        const { eq, desc } = await import("drizzle-orm");
        return db.select().from(disputeDocuments)
          .where(eq(disputeDocuments.disputeId, input.disputeId))
          .orderBy(desc(disputeDocuments.uploadedAt));
      }),
  }),

  // ─── Admin ────────────────────────────────────────────────────────────────────
  admin: router({
    allDisputes: adminProcedure
      .input(z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(25),
        status: z.string().optional(),
        search: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const limit = input.pageSize;
        const offset = (input.page - 1) * input.pageSize;
        return listDisputes({
          status: input.status as any,
          search: input.search,
          limit,
          offset,
        });
      }),

    stats: adminProcedure.query(async () => {
      return getDashboardStats(undefined);
    }),
  }),
});

export type AppRouter = typeof appRouter;

