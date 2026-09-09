/**
 * Fee-schedule routes — thin tRPC wrappers over the verified effective-dated
 * 2026/2027 IDR parameter library in this directory (params-2026.ts,
 * CMS-9897-F). No business logic is duplicated here; fail-closed behavior of
 * the underlying module passes through unchanged.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../../_core/trpc";
import { getEffectiveIDRParameters } from "./params-2026";

const asOfSchema = z.object({ asOf: z.coerce.date() });

export const feeScheduleRouter = router({
  /**
   * Full effective-dated IDR parameter set as of a date: admin fee tier
   * ($50/$115/$15), batch cap, CARC/RARC requirement, IDR registry flag,
   * batched cooling-off, and QPA enforcement discretion.
   */
  effectiveParameters: protectedProcedure
    .input(asOfSchema)
    .query(({ input }) => {
      try {
        return getEffectiveIDRParameters(input.asOf);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Invalid asOf date",
        });
      }
    }),

  /**
   * Administrative fee tier applicable as of a date (disputes initiated
   * on/after 2026-06-11: $15; 2024-01-22 through 2026-06-10: $115;
   * earlier: $50) with its regulatory citation.
   */
  adminFeeAt: protectedProcedure
    .input(asOfSchema)
    .query(({ input }) => {
      let params;
      try {
        params = getEffectiveIDRParameters(input.asOf);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Invalid asOf date",
        });
      }
      return {
        feeUsd: params.adminFeeUsd,
        tier:
          params.adminFeeUsd === 15
            ? "CMS-9897-F (disputes initiated on/after 2026-06-11)"
            : params.adminFeeUsd === 115
              ? "December 2023 fee notice (2024-01-22 through 2026-06-10)"
              : "Pre-2024-01-22 tier",
        citation: "45 CFR 149.510(d)(2)(ii)(B)",
      };
    }),
});

export type FeeScheduleRouter = typeof feeScheduleRouter;
