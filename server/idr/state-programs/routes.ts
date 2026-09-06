/**
 * state-programs routes — thin tRPC wrappers over the state IDR program
 * registry and jurisdiction resolver. The resolver's fail-closed semantics
 * (unregistered state -> FEDERAL, UNKNOWN scope -> FEDERAL, etc.) pass
 * through unchanged.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, publicProcedure } from "../../../_core/trpc";
import {
  registerStateProgram,
  getStateProgram,
  listRegisteredStates,
  REGISTRY_METADATA,
  StateProgramRegistrationError,
} from "./registry";
import { resolveJurisdiction, JurisdictionInputError } from "./resolver";

/** Local admin procedure (same pattern as routers.ts; cannot import it from there due to circularity). */
const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next();
});

const stateCodeSchema = z.string().regex(/^[A-Z]{2}$/, "Expected 2-letter uppercase USPS state code");
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected ISO date YYYY-MM-DD");
const triStateSchema = z.union([z.boolean(), z.literal("UNKNOWN")]);

const jurisdictionInputSchema = z.object({
  planType: z.enum(["FULLY_INSURED", "SELF_FUNDED"]),
  stateCode: stateCodeSchema,
  serviceCategory: z.enum(["EMERGENCY", "NON_EMERGENCY", "AIR_AMBIANCE", "POST_STABILIZATION"]),
  dateOfService: isoDateSchema,
  optedIn: z.boolean().optional(),
});

const keyDeadlineSchema = z.object({
  name: z.string().min(1),
  businessDays: z.number().int().nonnegative().optional(),
  calendarDays: z.number().int().nonnegative().optional(),
  citation: z.string(),
});

const stateProgramEntrySchema = z.object({
  stateCode: stateCodeSchema,
  programName: z.string().min(1).max(255),
  appliesToFullyInsured: triStateSchema,
  selfFundedOptIn: triStateSchema,
  scopeVsFederal: z.enum(["FULL", "PARTIAL", "UNKNOWN"]),
  paymentDeterminationMethod: z.enum(["ARBITRATION", "BENCHMARK", "HYBRID", "UNKNOWN"]),
  arbitrationStyle: z.string().max(255).optional(),
  keyDeadlines: z.array(keyDeadlineSchema),
  effectiveDates: z.array(z.object({ rule: z.string().min(1), effectiveDate: isoDateSchema })),
  authorityUrl: z.string().url().max(2048).nullable(),
  verificationStatus: z.enum(["VERIFIED", "UNVERIFIED"]),
  notes: z.string().max(5000),
});

export const stateProgramsRouter = router({
  /** Resolve which IDR regime (FEDERAL / STATE / BIFURCATED_SPLIT) governs a dispute. */
  resolveJurisdiction: publicProcedure
    .input(jurisdictionInputSchema)
    .query(({ input }) => {
      try {
        return resolveJurisdiction(input);
      } catch (err) {
        if (err instanceof JurisdictionInputError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  /** All registered state codes, sorted. */
  listStates: publicProcedure.query(() => listRegisteredStates()),

  /** Look up a registered program by state code; null if absent. */
  getStateProgram: publicProcedure
    .input(z.object({ stateCode: stateCodeSchema }))
    .query(({ input }) => {
      try {
        return getStateProgram(input.stateCode) ?? null;
      } catch (err) {
        if (err instanceof StateProgramRegistrationError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  /** Verified aggregate registry metadata (Peterson-KFF, as of 2024-07). */
  registryMetadata: publicProcedure.query(() => REGISTRY_METADATA),

  /**
   * Register a state program entry. Admin-only. Fail-closed: VERIFIED
   * entries are rejected unless every deadline citation is non-empty and
   * authorityUrl is set (enforced by the registry itself).
   */
  registerStateProgram: adminProcedure
    .input(z.object({ entry: stateProgramEntrySchema }))
    .mutation(({ input }) => {
      try {
        return registerStateProgram(input.entry);
      } catch (err) {
        if (err instanceof StateProgramRegistrationError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),
});

export type StateProgramsRouter = typeof stateProgramsRouter;
