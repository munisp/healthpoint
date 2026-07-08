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
  saveCMSDraft, getCMSDraftByDispute, listCMSDraftsByUser, updateCMSDraftStatus,
} from "./db";
import { generateDisputePDF } from "./pdf-export";
import { dispatchNotification } from "./notifications";
// AI microservice proxy — delegates to Python LangGraph service
const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? "http://localhost:8000";

async function aiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${AI_SERVICE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000), // 2-min timeout for LLM calls
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `AI service error: ${text}` });
  }
  return res.json() as Promise<T>;
}
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

    exportPDF: protectedProcedure
      .input(z.object({ disputeId: z.string() }))
      .mutation(async ({ input }) => {
        const dispute = await getDisputeById(input.disputeId);
        if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });
        const pdfBuffer = await generateDisputePDF(dispute as any);
        // Return as base64 so it can be decoded client-side and downloaded
        return {
          base64: pdfBuffer.toString("base64"),
          filename: `IDR-${dispute.referenceNumber}-${new Date().toISOString().slice(0, 10)}.pdf`,
          contentType: "application/pdf",
        };
      }),

    sendNotification: protectedProcedure
      .input(z.object({
        disputeId: z.string(),
        recipientEmail: z.string().email().optional(),
        recipientPhone: z.string().optional(),
        notificationType: z.enum(["deadline_warning", "step_advanced", "determination_issued", "offer_received", "document_uploaded", "system_alert"]),
        title: z.string(),
        message: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const dispute = await getDisputeById(input.disputeId);
        if (!dispute) throw new TRPCError({ code: "NOT_FOUND" });
        // Save to DB
        await createNotification({
          disputeId: input.disputeId,
          userId: ctx.user.id,
          notificationType: input.notificationType,
          title: input.title,
          message: input.message,
          dueDate: null,
        });
        // Dispatch email/SMS
        const results = await dispatchNotification({
          type: input.notificationType,
          recipientEmail: input.recipientEmail,
          recipientPhone: input.recipientPhone,
          disputeRef: dispute.referenceNumber,
          title: input.title,
          message: input.message,
        });
        return { success: true, deliveryResults: results };
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

  // ─── Agentic AI Layer (proxied to Python LangGraph microservice) ──────────────────
  ai: router({
    // Health check for the Python AI microservice
    serviceHealth: publicProcedure.query(async () => {
      try {
        const res = await fetch(`${AI_SERVICE_URL}/health`, { signal: AbortSignal.timeout(5000) });
        const data = await res.json() as Record<string, unknown>;
        return { available: true, ...data };
      } catch {
        return { available: false, reason: "AI service unreachable" };
      }
    }),

    // Agent capabilities summary
    agentInfo: publicProcedure.query(async () => {
      try {
        const res = await fetch(`${AI_SERVICE_URL}/agent-info`, { signal: AbortSignal.timeout(5000) });
        return res.json() as Promise<Record<string, unknown>>;
      } catch {
        return { agents: [] };
      }
    }),

    // DocumentAnalysisAgent — LangGraph: classify → validate → summarize
    analyzeDocument: protectedProcedure
      .input(z.object({
        documentText: z.string().min(1).max(50000),
        documentType: z.string().optional(),
        disputeId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        let disputeContext: Record<string, unknown> | undefined;
        if (input.disputeId) {
          const dispute = await getDisputeById(input.disputeId);
          if (dispute) {
            disputeContext = {
              billedAmount: dispute.billedAmount ?? undefined,
              qpaAmount: dispute.qpaAmount ?? undefined,
              serviceType: dispute.serviceType ?? undefined,
              serviceDate: dispute.serviceDate ? new Date(dispute.serviceDate).toLocaleDateString() : undefined,
              patientState: dispute.patientState ?? undefined,
            };
          }
        }
        return aiPost("/analyze-document", {
          documentText: input.documentText,
          documentType: input.documentType,
          disputeContext,
        });
      }),

    // CMSSubmissionAgent — LangGraph: check_eligibility → generate_form_fields → generate_narrative
    generateCMSSubmission: protectedProcedure
      .input(z.object({
        disputeId: z.string(),
        additionalContext: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const dispute = await getDisputeById(input.disputeId);
        if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });

        const startTime = Date.now();
        const result = await aiPost<{
          eligibility: {
            isEligible: boolean;
            eligibilityReason: string;
            missingRequirements: string[];
            warnings: string[];
            estimatedDeadline: string | null;
            regulatoryBasis?: string[];
          };
          draft: {
            formFields: Record<string, string>;
            attachmentChecklist: Array<{ item: string; status: string; required?: boolean }>;
            submissionNarrative: string;
            regulatoryBasis: string[];
            estimatedOutcome: string;
            nextSteps: string[];
          };
          processingTimeSeconds?: number;
          agentTrace?: string[];
        }>("/cms-submission", {
          dispute: {
            referenceNumber: dispute.referenceNumber,
            serviceType: dispute.serviceType,
            serviceDate: dispute.serviceDate,
            billedAmount: dispute.billedAmount,
            qpaAmount: dispute.qpaAmount,
            patientState: dispute.patientState,
            facilityState: dispute.facilityState,
            cptCodes: dispute.cptCodes,
            initiatingPartyName: dispute.initiatingPartyName,
            initiatingPartyType: dispute.initiatingPartyType,
            initiatingPartyNpi: dispute.initiatingPartyNpi,
            respondingPartyName: dispute.respondingPartyName,
            respondingPartyType: dispute.respondingPartyType,
            idrEntityName: dispute.idrEntityName,
            currentStep: dispute.currentStep,
            status: dispute.status,
            openNegotiationDeadline: dispute.openNegotiationDeadline,
            idrInitiationDeadline: dispute.idrInitiationDeadline,
          },
          additionalContext: input.additionalContext,
        });

        // Persist the draft to the database
        const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
        const { nanoid } = await import("nanoid");
        await saveCMSDraft({
          id: nanoid(),
          disputeId: input.disputeId,
          createdBy: ctx.user.id,
          status: "draft",
          isEligible: result.eligibility.isEligible,
          eligibilityReason: result.eligibility.eligibilityReason,
          missingRequirements: result.eligibility.missingRequirements,
          warnings: result.eligibility.warnings,
          estimatedDeadline: result.eligibility.estimatedDeadline ?? null,
          regulatoryBasis: result.eligibility.regulatoryBasis ?? [],
          formFields: result.draft.formFields,
          attachmentChecklist: result.draft.attachmentChecklist,
          submissionNarrative: result.draft.submissionNarrative,
          draftRegulatoryBasis: result.draft.regulatoryBasis,
          estimatedOutcome: result.draft.estimatedOutcome,
          nextSteps: result.draft.nextSteps,
          additionalContext: input.additionalContext ?? null,
          processingTimeSeconds: processingTime,
          agentTrace: result.agentTrace ?? [],
        });

        return { ...result, processingTimeSeconds: parseFloat(processingTime) };
      }),

    // List all CMS drafts for the current user (persisted)
    listCMSDrafts: protectedProcedure.query(async ({ ctx }) => {
      return listCMSDraftsByUser(ctx.user.id);
    }),

    // Get a single CMS draft by dispute ID
    getCMSDraft: protectedProcedure
      .input(z.object({ disputeId: z.string() }))
      .query(async ({ input, ctx }) => {
        return getCMSDraftByDispute(input.disputeId, ctx.user.id);
      }),

    // Update the status of a CMS draft (draft → submitted → determined)
    updateDraftStatus: protectedProcedure
      .input(z.object({
        draftId: z.string(),
        status: z.enum(["draft", "submitted", "determined", "withdrawn"]),
      }))
      .mutation(async ({ input, ctx }) => {
        await updateCMSDraftStatus(input.draftId, input.status, ctx.user.id);
        return { success: true };
      }),

    // IDRAssistantAgent — LangGraph ReAct with NSA regulatory tool calling
    askAssistant: protectedProcedure
      .input(z.object({
        question: z.string().min(1).max(4000),
        disputeId: z.string().optional(),
        conversationHistory: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string(),
        })).optional(),
      }))
      .mutation(async ({ input }) => {
        let disputeContext: Record<string, unknown> | undefined;
        if (input.disputeId) {
          const dispute = await getDisputeById(input.disputeId);
          if (dispute) {
            disputeContext = {
              referenceNumber: dispute.referenceNumber,
              currentStep: dispute.currentStep,
              status: dispute.status,
              serviceType: dispute.serviceType ?? undefined,
              billedAmount: dispute.billedAmount ?? undefined,
              qpaAmount: dispute.qpaAmount ?? undefined,
            };
          }
        }
        return aiPost("/ask-assistant", {
          question: input.question,
          disputeContext,
          conversationHistory: input.conversationHistory,
        });
      }),
  }),
});

export type AppRouter = typeof appRouter;

