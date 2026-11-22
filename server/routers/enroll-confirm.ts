/**
 * server/routers/enroll-confirm.ts
 *
 * Wave P26 (adversarial finding O6): first-factor enrollment email
 * confirmation + subsequent-enrollment alert. Mounted in
 * server/app-router.ts as `mfaConfirm` (server/routers.ts is frozen).
 *
 * Procedures:
 *  - confirm       PUBLIC, token-only. The confirmation token exists only in
 *                  the account owner's mailbox, so an attacker's mfa-pending
 *                  session cannot self-confirm. Every failure (unknown /
 *                  expired / consumed / factor-changed) returns the SAME
 *                  generic error — no account-existence or state leak.
 *  - finalizeTotp  protected (mfa-pending allowed). Called by the client
 *                  after routers.ts's frozen totp.verify activates a TOTP
 *                  secret. Decides first-factor (issue email confirmation)
 *                  vs subsequent (auto-confirm + alert email). Without this
 *                  call the factor simply stays inert (fail-safe) — the
 *                  security gate lives in server/auth/mfa.ts, not here.
 *  - resend        protected (mfa-pending allowed). Fresh token for the
 *                  caller's pending factor; prior pending tokens for that
 *                  factor are burned inside issueConfirmation.
 *
 * Rate limits reuse the webauthn-challenge.ts limiter (INCR fixed windows,
 * fail-closed in production) — §7.1-style limits, no new infrastructure.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { getDb, createAuditEntry } from "../db";
import { totpSecrets } from "../../drizzle/schema";
import { ENV } from "../_core/env";
import { webauthnRateLimit, clientIpOf } from "../auth/webauthn-challenge";
import {
  consumeConfirmationToken,
  countConfirmedFactors,
  findPendingFactor,
  isTotpConfirmed,
  issueConfirmation,
  recordConfirmedTotpCompanion,
  totpFingerprint,
  type FactorType,
} from "../auth/enroll-confirm";

// §7.1-style limits
const CONFIRM_IP_MAX = 10;
const CONFIRM_WINDOW_SECONDS = 15 * 60;
const RESEND_USER_MAX = 3;
const RESEND_WINDOW_SECONDS = 60 * 60;
const FINALIZE_USER_MAX = 20;
const FINALIZE_WINDOW_SECONDS = 60 * 60;

/** IP/UA extraction copied from server/routers/webauthn.ts (§5.6 convention). */
function auditSource(ctx: { req?: unknown }): { ipAddress: string | null; userAgent: string | null } {
  const headers = ((ctx.req as { headers?: Record<string, unknown> } | undefined)?.headers ?? {}) as Record<string, unknown>;
  const fwd = headers["x-forwarded-for"];
  const ip = (Array.isArray(fwd) ? fwd[0] : (fwd as string | undefined))?.split(",")[0]?.trim()
    ?? (ctx.req as { ip?: string } | undefined)?.ip ?? null;
  return { ipAddress: ip, userAgent: (headers["user-agent"] as string | undefined) ?? null };
}

/** Fire-and-forget audit — auditing never blocks the request. */
function audit(entry: Parameters<typeof createAuditEntry>[0]): void {
  createAuditEntry(entry).catch(err =>
    console.warn("[mfaConfirm] audit write failed:", err instanceof Error ? err.message : err));
}

function requireDb(db: Awaited<ReturnType<typeof getDb>>): NonNullable<typeof db> {
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
  return db;
}

const INVALID_LINK = "This confirmation link is invalid or has expired.";

/** Send the confirmation email; returns whether it was delivered. */
async function sendConfirmEmail(input: {
  to: string;
  factorLabel: string;
  token: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<boolean> {
  try {
    const { sendFactorEnrollmentConfirmEmail } = await import("../email");
    await sendFactorEnrollmentConfirmEmail(input.to, {
      factorLabel: input.factorLabel,
      confirmUrl: `${ENV.appUrl}/confirm-enrollment?token=${input.token}`,
      expiresMinutes: Math.round(ENV.factorConfirmTtlSeconds / 60),
      requestedAt: new Date(),
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return true;
  } catch (err) {
    console.error("[mfaConfirm] confirmation email failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Fire-and-forget subsequent-factor alert; audits delivery failure. */
function sendAlertEmail(input: {
  userId: string;
  to: string;
  factorLabel: string;
  factorType: FactorType;
  factorId: string;
  ip: string | null;
  userAgent: string | null;
}): void {
  void (async () => {
    const { sendFactorAddedAlertEmail } = await import("../email");
    const sent = await sendFactorAddedAlertEmail(input.to, {
      factorLabel: input.factorLabel,
      addedAt: new Date(),
      ip: input.ip,
      userAgent: input.userAgent,
      manageUrl: `${ENV.appUrl}/two-factor-auth`,
    });
    if (!sent) {
      audit({
        userId: input.userId,
        action: "mfaConfirm.alertEmailFailed",
        entityType: "factor_enrollment_confirmation",
        entityId: input.factorId,
        oldValue: null,
        newValue: JSON.stringify({ factorType: input.factorType }),
        ipAddress: input.ip,
        userAgent: input.userAgent,
      });
    }
  })().catch(err => console.warn("[mfaConfirm] factor-added alert failed:", err instanceof Error ? err.message : err));
}

export const enrollConfirmRouter = router({
  /**
   * Confirm a pending first-factor enrollment from the emailed token.
   * Token-only by design (see module header).
   */
  confirm: publicProcedure
    .input(z.object({ token: z.string().min(32).max(128) }))
    .mutation(async ({ ctx, input }) => {
      await webauthnRateLimit(`confirm-ip:${clientIpOf(ctx.req)}`, CONFIRM_IP_MAX, CONFIRM_WINDOW_SECONDS);
      const src = auditSource(ctx);
      const result = await consumeConfirmationToken(input.token);
      if (result.status !== "confirmed") {
        audit({
          userId: "anonymous",
          action: "mfaConfirm.confirmFailed",
          entityType: "factor_enrollment_confirmation",
          entityId: input.token.slice(0, 8), // prefix only — never the full token
          oldValue: null,
          newValue: null,
          ...src,
        });
        throw new TRPCError({ code: "BAD_REQUEST", message: INVALID_LINK });
      }
      audit({
        userId: result.userId,
        action: "mfaConfirm.confirmed",
        entityType: "factor_enrollment_confirmation",
        entityId: result.factorId,
        oldValue: null,
        newValue: JSON.stringify({ factorType: result.factorType }),
        ...src,
      });
      return { success: true as const, factorType: result.factorType };
    }),

  /**
   * Post-totp.verify hook (the frozen routers.ts enrollment path cannot
   * call us). Idempotent. First-factor → email confirmation; subsequent →
   * auto-confirm + alert.
   */
  finalizeTotp: protectedProcedure.mutation(async ({ ctx }) => {
    await webauthnRateLimit(`finalize-user:${ctx.user.id}`, FINALIZE_USER_MAX, FINALIZE_WINDOW_SECONDS);
    const db = requireDb(await getDb());
    const src = auditSource(ctx);
    const rows = await db
      .select({ id: totpSecrets.id, secret: totpSecrets.secret })
      .from(totpSecrets)
      .where(and(eq(totpSecrets.userId, ctx.user.id), eq(totpSecrets.status, "active")))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No active TOTP enrollment found" });
    }
    if (await isTotpConfirmed(row.id, row.secret)) {
      return { status: "confirmed" as const };
    }

    const otherConfirmed = await countConfirmedFactors(ctx.user.id);
    if (otherConfirmed > 0) {
      // Subsequent-factor enrollment: step-up already happened at login;
      // activate immediately + alert the account owner out-of-band.
      const companionId = await recordConfirmedTotpCompanion({
        userId: ctx.user.id,
        totpRowId: row.id,
        secretEnvelope: row.secret,
        label: "Authenticator app (TOTP)",
        requestIp: src.ipAddress,
        requestUserAgent: src.userAgent,
      });
      audit({
        userId: ctx.user.id,
        action: "mfaConfirm.totpAutoConfirmed",
        entityType: "factor_enrollment_confirmation",
        entityId: companionId,
        oldValue: null,
        newValue: JSON.stringify({ totpRowId: row.id, otherConfirmedFactors: otherConfirmed }),
        ...src,
      });
      if (ctx.user.email) {
        sendAlertEmail({
          userId: ctx.user.id,
          to: ctx.user.email,
          factorLabel: "Authenticator app (TOTP)",
          factorType: "totp",
          factorId: row.id,
          ip: src.ipAddress,
          userAgent: src.userAgent,
        });
      }
      return { status: "confirmed" as const };
    }

    // First-factor enrollment: out-of-band email confirmation required.
    const issued = await issueConfirmation({
      userId: ctx.user.id,
      factorType: "totp",
      factorId: row.id,
      factorFingerprint: totpFingerprint(row.secret),
      label: "Authenticator app (TOTP)",
      requestIp: src.ipAddress,
      requestUserAgent: src.userAgent,
    });
    const emailSent = ctx.user.email
      ? await sendConfirmEmail({
          to: ctx.user.email,
          factorLabel: "Authenticator app (TOTP)",
          token: issued.token,
          ip: src.ipAddress,
          userAgent: src.userAgent,
        })
      : false;
    audit({
      userId: ctx.user.id,
      action: "mfaConfirm.issued",
      entityType: "factor_enrollment_confirmation",
      entityId: issued.rowId,
      oldValue: null,
      newValue: JSON.stringify({ factorType: "totp", totpRowId: row.id, emailSent }),
      ...src,
    });
    return { status: "confirmation_required" as const, emailSent };
  }),

  /** Fresh confirmation email for the caller's pending factor. */
  resend: protectedProcedure
    .input(z.object({ factorType: z.enum(["totp", "passkey"]) }))
    .mutation(async ({ ctx, input }) => {
      await webauthnRateLimit(`resend-user:${ctx.user.id}`, RESEND_USER_MAX, RESEND_WINDOW_SECONDS);
      const src = auditSource(ctx);
      const pending = await findPendingFactor(ctx.user.id, input.factorType);
      if (!pending) {
        // Own-account query — no cross-account leak; the caller simply has
        // nothing awaiting confirmation.
        return { status: "no_pending" as const };
      }
      const issued = await issueConfirmation({
        userId: ctx.user.id,
        factorType: input.factorType,
        factorId: pending.factorId,
        factorFingerprint: pending.factorFingerprint,
        label: pending.label,
        requestIp: src.ipAddress,
        requestUserAgent: src.userAgent,
      });
      const label = input.factorType === "passkey" ? `Passkey · ${pending.label}` : pending.label;
      const emailSent = ctx.user.email
        ? await sendConfirmEmail({
            to: ctx.user.email,
            factorLabel: label,
            token: issued.token,
            ip: src.ipAddress,
            userAgent: src.userAgent,
          })
        : false;
      audit({
        userId: ctx.user.id,
        action: "mfaConfirm.resent",
        entityType: "factor_enrollment_confirmation",
        entityId: issued.rowId,
        oldValue: null,
        newValue: JSON.stringify({ factorType: input.factorType, factorId: pending.factorId, emailSent }),
        ...src,
      });
      return { status: "sent" as const, emailSent };
    }),
});
