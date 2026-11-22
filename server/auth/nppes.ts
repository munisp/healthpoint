/**
 * server/auth/nppes.ts
 *
 * Phase13-FC (G6): identity verification.
 *
 * (a) NPI verification against the PUBLIC NPPES registry API
 *     (https://npiregistry.cms.hhs.gov/api/?version=2.1&number=<npi>).
 *     - Env flag NPPES_VERIFY_ENABLED (default ON; set to "false" to disable).
 *     - 5s timeout (NPPES_VERIFY_TIMEOUT_MS override).
 *     - FAIL-OPEN-WITH-WARNING when the registry is unreachable or disabled:
 *       the result is honestly 'unverified' with `warning` set — success is
 *       NEVER faked. Persisted on user_profiles.npiVerified as
 *       'verified' | 'unverified' | 'mismatch'.
 *     - The profile save path (routers.ts profiles.save) is owned by another
 *       workstream, so verification is exposed as a standalone procedure
 *       (identity.verifyNpi) that the onboarding UI calls after saving the
 *       NPI. Client: client/src/pages/Onboarding.tsx.
 *
 * (b) IDRE certification numbers: NO public registry exists for CMS IDR
 *     entity certification, so verification is an ADMIN WORKFLOW:
 *     submitted (default) → admin reviews evidence and calls
 *     identity.verifyIdreCertification with an evidence note (audit-logged,
 *     idr_entities.certificationStatus → 'verified').
 *
 * tRPC router merged into rootRouter in server/app-router.ts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb, createAuditEntry } from "../db";
import { userProfiles, idrEntities } from "../../drizzle/schema";

export type NpiVerificationStatus = "verified" | "unverified" | "mismatch";

export interface NpiVerificationResult {
  status: NpiVerificationStatus;
  /** Set when verification could not be completed (registry unreachable,
   *  disabled, timeout) — the caller MUST surface this honestly. */
  warning?: string;
  /** Registry-matched legal name when verified (for UI confirmation). */
  registryName?: string;
}

/** NPI Luhn checksum (ISO/IEC 7812 with the 80840 health-care prefix). */
export function isValidNpiChecksum(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;
  const digits = ("80840" + npi).split("").map(Number);
  let sum = 0;
  // Double every second digit starting from the rightmost of the 15-digit string.
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if ((digits.length - 1 - i) % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function nppesVerifyEnabled(): boolean {
  return (process.env.NPPES_VERIFY_ENABLED ?? "true").toLowerCase() !== "false";
}

interface NppesApiResponse {
  result_count?: number;
  results?: Array<{
    number?: number;
    enumeration_type?: string;
    basic?: { first_name?: string; last_name?: string; organization_name?: string };
  }>;
}

/**
 * Verify an NPI against the NPPES public registry. Never throws for registry
 * outages — returns { status: "unverified", warning } instead. Throws
 * TRPCError BAD_REQUEST only for locally-invalid input (bad checksum).
 */
export async function verifyNpiWithNppes(
  npi: string,
  opts?: { expectedName?: string; fetchFn?: typeof fetch },
): Promise<NpiVerificationResult> {
  if (!/^\d{10}$/.test(npi) || !isValidNpiChecksum(npi)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid NPI: must be 10 digits with a valid Luhn checksum" });
  }
  if (!nppesVerifyEnabled()) {
    return { status: "unverified", warning: "NPPES verification is disabled (NPPES_VERIFY_ENABLED=false)" };
  }
  const timeoutMs = Number.parseInt(process.env.NPPES_VERIFY_TIMEOUT_MS ?? "5000", 10) || 5000;
  const fetchImpl = opts?.fetchFn ?? fetch;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetchImpl(
        `https://npiregistry.cms.hhs.gov/api/?version=2.1&number=${encodeURIComponent(npi)}`,
        { signal: controller.signal, headers: { accept: "application/json" } },
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      return { status: "unverified", warning: `NPPES registry returned HTTP ${res.status}; verification not completed` };
    }
    const body = (await res.json()) as NppesApiResponse;
    if ((body.result_count ?? 0) < 1 || !body.results?.length) {
      // The registry answered authoritatively: this NPI is not registered.
      return { status: "mismatch", warning: "NPI not found in the NPPES registry" };
    }
    const record = body.results[0];
    const registryName = (
      record.basic?.organization_name ??
      [record.basic?.first_name, record.basic?.last_name].filter(Boolean).join(" ")
    ).trim();
    if (opts?.expectedName && registryName) {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
      if (!norm(registryName).includes(norm(opts.expectedName)) && !norm(opts.expectedName).includes(norm(registryName))) {
        return { status: "mismatch", registryName, warning: `NPPES registry name "${registryName}" does not match the provided name` };
      }
    }
    return { status: "verified", registryName: registryName || undefined };
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "network/error";
    return { status: "unverified", warning: `NPPES registry unreachable (${reason}); verification not completed — retry later` };
  }
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
  return db;
}

export const identityRouter = router({
  /**
   * G6(a): verify the caller's NPI against NPPES and persist the honest
   * outcome on their profile (user_profiles.npiVerified). Called by the
   * onboarding UI after profiles.save (that procedure is owned by another
   * workstream, so the hook lives here).
   */
  verifyNpi: protectedProcedure
    .input(z.object({
      npi: z.string().regex(/^\d{10}$/, "NPI must be exactly 10 digits"),
      expectedName: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await verifyNpiWithNppes(input.npi, { expectedName: input.expectedName });
      const db = await requireDb();
      await db.update(userProfiles).set({ npiVerified: result.status, updatedAt: new Date() })
        .where(eq(userProfiles.id, ctx.user.id));
      await createAuditEntry({
        userId: ctx.user.id,
        action: "identity.verifyNpi",
        entityType: "user_profile",
        entityId: ctx.user.id,
        oldValue: null,
        newValue: JSON.stringify({ npi: input.npi.slice(0, 4) + "******", status: result.status, warning: result.warning ?? null }),
        ipAddress: null,
        userAgent: null,
      });
      return result;
    }),

  /**
   * G6(b): IDRE certification admin-verify. No public registry exists, so an
   * admin reviews evidence (e.g. the CMS certification letter) and marks the
   * entity verified with an evidence note. Audit-logged.
   */
  verifyIdreCertification: protectedProcedure
    .input(z.object({
      idrEntityId: z.string().min(1).max(64),
      evidenceNote: z.string().min(20, "An evidence note of at least 20 characters is required").max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      const db = await requireDb();
      const [entity] = await db.select().from(idrEntities).where(eq(idrEntities.id, input.idrEntityId)).limit(1);
      if (!entity) throw new TRPCError({ code: "NOT_FOUND", message: "IDR entity not found" });
      await db.update(idrEntities).set({
        certificationStatus: "verified",
        certificationVerifiedAt: new Date(),
        certificationVerifiedBy: ctx.user.id,
        certificationEvidenceNote: input.evidenceNote,
      }).where(eq(idrEntities.id, input.idrEntityId));
      await createAuditEntry({
        userId: ctx.user.id,
        action: "identity.verifyIdreCertification",
        entityType: "idr_entity",
        entityId: input.idrEntityId,
        oldValue: JSON.stringify({ certificationStatus: entity.certificationStatus }),
        newValue: JSON.stringify({ certificationStatus: "verified", evidenceNote: input.evidenceNote }),
        ipAddress: null,
        userAgent: null,
      });
      return { ok: true as const, certificationStatus: "verified" as const };
    }),
});
