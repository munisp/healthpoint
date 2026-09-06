/**
 * Batched-dispute routes — thin tRPC wrappers over the verified
 * batching-eligibility library in this directory (batching.ts).
 * No business logic is duplicated here; fail-closed behavior of the
 * underlying module passes through unchanged.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../../../_core/trpc";
import { evaluateBatchEligibility } from "./batching";

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
});

export type BatchedDisputesRouter = typeof batchedDisputesRouter;
