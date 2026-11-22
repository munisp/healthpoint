/**
 * server/auth/totp-admin.ts
 *
 * Phase13-FC (G14b): TOTP recovery.
 *
 * Self-service path (existing, wave W2): single-use backup codes via
 * auth.verifyLoginTotp (see server/auth/mfa.ts#verifyLoginCode).
 *
 * Admin path (this module): when a user has lost BOTH their TOTP device and
 * their backup codes, an admin calls adminTotp.resetUserTotp with a reason.
 * The user's totp_secrets row is marked disabled and all backup codes are
 * cleared; at next login getMfaRequirement() no longer returns "verify", so
 * the user can sign in and is FORCED to re-enroll when their org mandates
 * MFA (orgSettings.requireMFA=true → "enroll") or may re-enroll voluntarily
 * otherwise. The reset is audit-logged (action 'totp.adminReset').
 *
 * Password recovery (G14a) is NOT handled here — passwords live solely in
 * Keycloak; the platform never sees them. LoginPage links "Forgot password"
 * to /api/auth/forgot-password (server/_core/keycloak.ts), which redirects
 * to the Keycloak account console / reset-credentials flow.
 *
 * Merged into rootRouter in server/app-router.ts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb, createAuditEntry } from "../db";
import { totpSecrets, users } from "../../drizzle/schema";

export const adminTotpRouter = router({
  /**
   * Admin-initiated TOTP reset. Requires admin role + reason (>= 20 chars).
   * Audit-logged; forces re-enrollment at next login when MFA is mandated.
   */
  resetUserTotp: protectedProcedure
    .input(z.object({
      userId: z.string().min(1),
      reason: z.string().min(20, "A reason of at least 20 characters is required").max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [target] = await db.select({ id: users.id, suspendedAt: users.suspendedAt }).from(users)
        .where(eq(users.id, input.userId)).limit(1);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Target user not found" });

      const [secretRow] = await db.select().from(totpSecrets).where(eq(totpSecrets.userId, input.userId)).limit(1);
      if (!secretRow || secretRow.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "User does not have an active TOTP enrollment to reset" });
      }

      await db.update(totpSecrets).set({
        status: "disabled",
        disabledAt: new Date(),
        backupCodes: "[]",
        usedBackupCodes: "[]",
        updatedAt: new Date(),
      }).where(eq(totpSecrets.userId, input.userId));

      await createAuditEntry({
        userId: ctx.user.id,
        action: "totp.adminReset",
        entityType: "user",
        entityId: input.userId,
        oldValue: JSON.stringify({ totpStatus: "active" }),
        newValue: JSON.stringify({ totpStatus: "disabled", reason: input.reason, reEnrollment: "forced at next login when org requires MFA" }),
        ipAddress: null,
        userAgent: null,
      });

      return { ok: true as const, totpStatus: "disabled" as const };
    }),
});
