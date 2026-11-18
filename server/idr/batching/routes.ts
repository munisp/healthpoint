/**
 * Batched-dispute routes — thin tRPC wrappers over the verified
 * batching-eligibility library in this directory (batching.ts).
 * No business logic is duplicated here; fail-closed behavior of the
 * underlying module passes through unchanged.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../../_core/trpc";
import { evaluateBatchEligibility } from "./batching";
import { proposeBatches } from "../auto-batch";
import { getAdminFeeFromDb } from "../../fee-schedule";
import { getEffectiveIDRParameters } from "../clocks-2026/params-2026";

const lineItemSchema = z.object({
  lineItemId: z.string().min(1).max(128),
  serviceCode: z.string().min(1).max(32),
  providerNpi: z.string().max(10).optional(),
  providerTin: z.string().max(32).optional(),
  payerId: z.string().min(1).max(128),
  qualifiedIdrItem: z.boolean(),
  dateOfService: z.coerce.date().optional(),
});

export const batchedDisputesRouter = router({
  /**
   * Evaluate 45 CFR 149.510(c)(4)(i)(A)–(D) batching eligibility and the
   * effective-dated line-item cap (25 legacy; 50 for ONPs beginning on/after
   * 2026-11-01 per CMS-9897-F). Fail-closed: a missing ONP start date
   * resolves to the legacy 25-item cap.
   */
  evaluateEligibility: protectedProcedure
    .input(z.object({
      items: z.array(lineItemSchema).max(200),
      openNegotiationNoticeDate: z.coerce.date().optional(),
    }))
    .query(({ input }) => {
      return evaluateBatchEligibility(input.items, {
        openNegotiationNoticeDate: input.openNegotiationNoticeDate,
      });
    }),

  /**
   * Phase 18: auto-batcher preview over a CALLER-SUPPLIED pool of line items
   * (org-scoped pool variant lives at submitter.autoBatch). Pure preview —
   * proposes batches with per-batch rationale and projected fee savings vs
   * single filings; no mutation.
   */
  suggestBatches: protectedProcedure
    .input(z.object({
      items: z.array(lineItemSchema).min(1).max(500),
      openNegotiationNoticeDate: z.coerce.date().optional(),
      adminFeeUsd: z.number().positive().optional(),
    }))
    .query(async ({ input }) => {
      const asOf = new Date();
      const adminFeeUsd = input.adminFeeUsd
        ?? Number((await getAdminFeeFromDb("batched", asOf))?.amountUsd ?? getEffectiveIDRParameters(asOf).adminFeeUsd);
      const result = proposeBatches(input.items, {
        openNegotiationNoticeDate: input.openNegotiationNoticeDate,
        adminFeeUsd,
      });
      return {
        ...result,
        adminFeeUsd,
        previewOnly: true,
        previewNote: "Preview only: projected savings are arithmetic on published IDRE fee ranges, not guarantees.",
      };
    }),
});

export type BatchedDisputesRouter = typeof batchedDisputesRouter;
