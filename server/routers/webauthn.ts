/**
 * server/routers/webauthn.ts
 *
 * Phase 25: WebAuthn / passkeys for staff authentication (binding design
 * contract: phase-25-webauthn-design.md).
 *
 *  - Second-factor ceremonies that satisfy the existing two-stage login
 *    (mfa-pending → full session) using the SAME session-issuance path as
 *    auth.verifyLoginTotp (createSessionToken + getSessionDurationMsForUser,
 *    server/_core/keycloak.ts) — NOT legacy sdk.createSessionToken.
 *  - Attestation: "none" (design §3.3); origin + RP ID verified server-side;
 *    challenges single-use (atomic GETDEL) and short-lived (300s default);
 *    UV required for staff and admin alike (§4.3); counter anomalies are
 *    warn-and-audit, never reject (§4.4 — synced passkeys legitimately
 *    report static counters).
 *  - Master gate WEBAUTHN_ENABLED (default false) → every ceremony and
 *    management procedure fails PRECONDITION_FAILED (§5.1). `status` is the
 *    single exception: it ANSWERS with { enabled: false, ... } so the
 *    settings UI can hide passkey controls (§6.3 requires a readable
 *    status.enabled) — no credential data is returned while disabled.
 *
 * Mounted in server/app-router.ts (server/routers.ts is frozen).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createHash, randomUUID } from "node:crypto";
import { eq, and, ne, isNotNull } from "drizzle-orm";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { getDb, createAuditEntry } from "../db";
import { users } from "../../drizzle/schema";
import { webauthnCredentials, type WebauthnCredential } from "../../drizzle/schema-webauthn";
import { ENV } from "../_core/env";
import { COOKIE_NAME } from "@shared/const";
import {
  assertWebauthnEnabled,
  hasActivePasskey,
  passkeyRequiredForRole,
  resolveWebauthnRpConfig,
} from "../auth/webauthn-policy";
import {
  storeChallenge,
  consumeChallenge,
  storeStepupMarker,
  consumeStepupMarker,
  webauthnRateLimit,
  clientIpOf,
} from "../auth/webauthn-challenge";
import { hasActiveTotp, orgRequiresMfa, verifyLoginCode } from "../auth/mfa";
import { checkTotpLoginAttempt, resetTotpLoginAttempts } from "../auth/totpLockout";

const REG_TIMEOUT_MS = 60_000;   // §4.3 — congested networks + older devices
const AUTH_TIMEOUT_MS = 60_000;
const STEPUP_TTL_SECONDS = 600;  // §3.6 — deleteCredential passkey-only step-up

// §7.1 limits
const OPTS_USER_MAX = 20;
const VERIFY_MAX_FAILURES = 5;
const VERIFY_WINDOW_SECONDS = 15 * 60;
const REG_SUCCESS_MAX = 10;
const REG_SUCCESS_WINDOW_SECONDS = 24 * 60 * 60;

/** IP/UA extraction copied from server/_core/trpc.ts:100-101 (§5.6). */
function auditSource(ctx: { req?: unknown }): { ipAddress: string | null; userAgent: string | null } {
  const headers = ((ctx.req as { headers?: Record<string, unknown> } | undefined)?.headers ?? {}) as Record<string, unknown>;
  const fwd = headers["x-forwarded-for"];
  const ip = (Array.isArray(fwd) ? fwd[0] : (fwd as string | undefined))?.split(",")[0]?.trim()
    ?? (ctx.req as { ip?: string } | undefined)?.ip ?? null;
  return { ipAddress: ip, userAgent: (headers["user-agent"] as string | undefined) ?? null };
}

/** §5.6 — audit payloads carry the sha256[:16] of the credential ID, never raw key material. */
function credHash(credentialId: Buffer): string {
  return createHash("sha256").update(credentialId).digest("hex").slice(0, 16);
}

/** Fire-and-forget audit — auditing never blocks the request (§5.6). */
function audit(entry: Parameters<typeof createAuditEntry>[0]): void {
  createAuditEntry(entry).catch(err =>
    console.warn("[webauthn] audit write failed:", err instanceof Error ? err.message : err));
}

function requireDb(db: Awaited<ReturnType<typeof getDb>>): NonNullable<typeof db> {
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
  return db;
}

function rowTransports(row: WebauthnCredential): string[] {
  try {
    return row.transports ? (JSON.parse(row.transports) as string[]) : [];
  } catch {
    return [];
  }
}

const b64urlToBuf = (s: string) => Buffer.from(s, "base64url");

/**
 * §3.6 step 4 / status.canDeleteLast — is deleting one credential permitted
 * with respect to the last-factor guard?
 */
async function lastFactorGuardBlocks(userId: string, otherCredCount: number, hasTotp: boolean): Promise<boolean> {
  const remaining = otherCredCount + (hasTotp ? 1 : 0);
  if (remaining > 0) return false;
  return (await orgRequiresMfa(userId)) || (await passkeyRequiredForRole(userId));
}

export const webauthnRouter = router({
  /**
   * Settings UI status (§3.2). The ONLY procedure that answers while the
   * feature is disabled (returns enabled:false so the client can hide
   * passkey UI) — see module header.
   */
  status: protectedProcedure.query(async ({ ctx }) => {
    if (!ENV.webauthnEnabled) {
      return {
        enabled: false as const,
        enforcement: ENV.webauthnEnforcement,
        credentials: [] as never[],
        hasTotp: false,
        canDeleteLast: false,
      };
    }
    const db = requireDb(await getDb());
    const rows = await db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, ctx.user.id));
    const totp = await hasActiveTotp(ctx.user.id);
    const canDeleteLast = !(await lastFactorGuardBlocks(ctx.user.id, rows.length - 1, totp));
    return {
      enabled: true as const,
      enforcement: ENV.webauthnEnforcement,
      credentials: rows.map(r => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt,
        backedUp: r.backedUp,
        deviceType: r.deviceType,
        // Wave P26 (O6): false = pending email confirmation (inert).
        confirmed: r.confirmedAt != null,
      })),
      hasTotp: totp,
      canDeleteLast,
    };
  }),

  /** §3.2 — begin registration (full session voluntary / mfa-pending forced enroll). */
  registrationOptions: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(128).optional() }).optional())
    .mutation(async ({ ctx }) => {
      assertWebauthnEnabled();
      const ip = clientIpOf(ctx.req);
      await webauthnRateLimit(`opts-ip:${ip}`, ENV.webauthnRateLimitMax, ENV.webauthnRateLimitWindowSeconds);
      await webauthnRateLimit(`opts-user:${ctx.user.id}`, OPTS_USER_MAX, ENV.webauthnRateLimitWindowSeconds);
      const db = requireDb(await getDb());
      const { rpId, rpName } = resolveWebauthnRpConfig();
      const existing = await db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, ctx.user.id));
      const { generateRegistrationOptions } = await import("@simplewebauthn/server");
      const options = await generateRegistrationOptions({
        rpName,
        rpID: rpId,
        userName: ctx.user.email ?? ctx.user.id,
        userID: new TextEncoder().encode(ctx.user.id),
        userDisplayName: ctx.user.name ?? "",
        timeout: REG_TIMEOUT_MS,
        attestationType: "none", // §3.3 (binding)
        excludeCredentials: existing.map(r => ({
          id: r.credentialId.toString("base64url"),
          transports: rowTransports(r) as never,
        })),
        authenticatorSelection: {
          residentKey: "preferred",       // §4.3
          userVerification: "required",   // §4.3 — staff and admin alike
        },
      });
      const ceremonyId = randomUUID();
      await storeChallenge(ceremonyId, { challenge: options.challenge, userId: ctx.user.id, mode: "registration" });
      return { ceremonyId, options };
    }),

  /** §3.2 — complete registration; inserts the credential row. */
  verifyRegistration: protectedProcedure
    .input(z.object({
      ceremonyId: z.string().uuid(),
      name: z.string().min(1).max(128).optional(),
      response: z.record(z.string(), z.any()), // RegistrationResponseJSON
    }))
    .mutation(async ({ ctx, input }) => {
      assertWebauthnEnabled();
      const stored = await consumeChallenge(input.ceremonyId);
      if (!stored || stored.mode !== "registration" || stored.userId !== ctx.user.id) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "ceremony_expired" });
      }
      const { origins, rpId } = resolveWebauthnRpConfig();
      const response = input.response as unknown as import("@simplewebauthn/server").RegistrationResponseJSON;
      // R8: credential IDs are ≤1023 bytes per spec — guard before insert.
      if (!response.id || b64urlToBuf(response.id).length > 1023) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "invalid_credential_id" });
      }
      const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response,
          expectedChallenge: stored.challenge,
          expectedOrigin: origins,
          expectedRPID: rpId,
          requireUserVerification: true, // §4.3
        });
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `registration_verification_failed: ${err instanceof Error ? err.message : "unknown"}`,
        });
      }
      if (!verification.verified || !verification.registrationInfo) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "registration_verification_failed" });
      }
      // §7.1 — cap credential-table growth at 10 successful registrations / 24h.
      await webauthnRateLimit(`reg-user:${ctx.user.id}`, REG_SUCCESS_MAX, REG_SUCCESS_WINDOW_SECONDS);
      const db = requireDb(await getDb());
      const info = verification.registrationInfo;
      const credIdBuf = Buffer.from(info.credential.id, "base64url");
      const id = randomUUID();

      // Wave P26 (O6): FIRST-factor enrollment (account has zero confirmed
      // factors — covers both forced-enrollment tiers) must be confirmed
      // out-of-band via email BEFORE the credential activates; subsequent
      // enrollments activate immediately and trigger an alert email.
      const { countConfirmedFactors } = await import("../auth/enroll-confirm");
      const isFirstFactor = (await countConfirmedFactors(ctx.user.id)) === 0;
      try {
        await db.insert(webauthnCredentials).values({
          id,
          userId: ctx.user.id,
          credentialId: credIdBuf,
          publicKey: Buffer.from(info.credential.publicKey),
          counter: info.credential.counter,
          transports: JSON.stringify(info.credential.transports ?? []),
          aaguid: info.aaguid ?? null,
          name: input.name ?? "Passkey",
          backedUp: info.credentialBackedUp,
          deviceType: info.credentialDeviceType,
          confirmedAt: isFirstFactor ? null : new Date(),
        });
      } catch (err) {
        // Unique-index race: same authenticator registered twice concurrently.
        throw new TRPCError({ code: "CONFLICT", message: "credential_already_registered" });
      }
      const src = auditSource(ctx);

      if (isFirstFactor) {
        // Pending confirmation: issue the single-use token and email it to
        // the ACCOUNT address (the attacker's session cannot redirect it).
        // Email failure never activates the factor — it stays pending and
        // the user can resend (mfaConfirm.resend).
        const { issueConfirmation } = await import("../auth/enroll-confirm");
        const issued = await issueConfirmation({
          userId: ctx.user.id,
          factorType: "passkey",
          factorId: id,
          label: input.name ?? "Passkey",
          requestIp: src.ipAddress,
          requestUserAgent: src.userAgent,
        });
        let emailSent = false;
        if (ctx.user.email) {
          try {
            const { sendFactorEnrollmentConfirmEmail } = await import("../email");
            await sendFactorEnrollmentConfirmEmail(ctx.user.email, {
              factorLabel: `Passkey · ${input.name ?? "Passkey"}`,
              confirmUrl: `${ENV.appUrl}/confirm-enrollment?token=${issued.token}`,
              expiresMinutes: Math.round(ENV.factorConfirmTtlSeconds / 60),
              requestedAt: new Date(),
              ip: src.ipAddress,
              userAgent: src.userAgent,
            });
            emailSent = true;
          } catch (err) {
            console.error("[webauthn] confirmation email failed (factor stays pending):", err instanceof Error ? err.message : err);
          }
        }
        audit({
          userId: ctx.user.id,
          action: "webauthn.register",
          entityType: "webauthn_credential",
          entityId: id,
          oldValue: null,
          newValue: JSON.stringify({
            credentialId: credHash(credIdBuf),
            name: input.name ?? "Passkey",
            deviceType: info.credentialDeviceType,
            backedUp: info.credentialBackedUp,
            requiresConfirmation: true,
            confirmationEmailSent: emailSent,
          }),
          ...src,
        });
        return { success: true as const, credentialId: id, requiresConfirmation: true as const, emailSent };
      }

      audit({
        userId: ctx.user.id,
        action: "webauthn.register",
        entityType: "webauthn_credential",
        entityId: id,
        oldValue: null,
        newValue: JSON.stringify({
          credentialId: credHash(credIdBuf),
          name: input.name ?? "Passkey",
          deviceType: info.credentialDeviceType,
          backedUp: info.credentialBackedUp,
          requiresConfirmation: false,
        }),
        ...src,
      });
      // Subsequent-factor alert (O6): fire-and-forget — delivery failure
      // must NOT fail the enrollment; log + audit instead.
      if (ctx.user.email) {
        const email = ctx.user.email;
        void (async () => {
          const { sendFactorAddedAlertEmail } = await import("../email");
          const sent = await sendFactorAddedAlertEmail(email, {
            factorLabel: `Passkey · ${input.name ?? "Passkey"}`,
            addedAt: new Date(),
            ip: src.ipAddress,
            userAgent: src.userAgent,
            manageUrl: `${ENV.appUrl}/two-factor-auth`,
          });
          if (!sent) {
            audit({
              userId: ctx.user.id,
              action: "webauthn.alertEmailFailed",
              entityType: "webauthn_credential",
              entityId: id,
              oldValue: null,
              newValue: JSON.stringify({ credentialId: credHash(credIdBuf) }),
              ...src,
            });
          }
        })().catch(err => console.warn("[webauthn] factor-added alert failed:", err instanceof Error ? err.message : err));
      }
      return { success: true as const, credentialId: id, requiresConfirmation: false as const };
    }),

  /**
   * §3.4 — begin authentication. PUBLIC, rate-limited, anti-enumeration:
   * no user identifier is accepted as input and none is returned beyond the
   * opaque ceremonyId.
   */
  authenticationOptions: publicProcedure
    .input(z.object({ ceremony: z.enum(["mfa", "discoverable"]).default("mfa") }))
    .mutation(async ({ ctx, input }) => {
      assertWebauthnEnabled();
      const ip = clientIpOf(ctx.req);
      await webauthnRateLimit(`opts-ip:${ip}`, ENV.webauthnRateLimitMax, ENV.webauthnRateLimitWindowSeconds);
      const { rpId } = resolveWebauthnRpConfig();
      const { generateAuthenticationOptions } = await import("@simplewebauthn/server");

      if (input.ceremony === "discoverable") {
        // §5.4 — discoverable (resident-key) ceremonies are gated off by default.
        if (!ENV.webauthnPasswordlessEnabled) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "webauthn_passwordless_disabled" });
        }
        const options = await generateAuthenticationOptions({
          rpID: rpId,
          timeout: AUTH_TIMEOUT_MS,
          userVerification: "required",
          allowCredentials: [],
        });
        const ceremonyId = randomUUID();
        await storeChallenge(ceremonyId, { challenge: options.challenge, userId: null, mode: "discoverable" });
        return { ceremonyId, options };
      }

      // mfa mode: the caller must be authenticated (mfa-pending login upgrade
      // OR a full session performing a step-up proof, §3.6). The ceremony is
      // bound to THIS user — verifyAuthentication enforces the binding.
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication_required" });
      }
      await webauthnRateLimit(`opts-user:${ctx.user.id}`, OPTS_USER_MAX, ENV.webauthnRateLimitWindowSeconds);
      const db = requireDb(await getDb());
      const rows = await db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, ctx.user.id));
      const options = await generateAuthenticationOptions({
        rpID: rpId,
        timeout: AUTH_TIMEOUT_MS,
        userVerification: "required",
        allowCredentials: rows.map(r => ({
          id: r.credentialId.toString("base64url"),
          transports: rowTransports(r) as never,
        })),
      });
      const ceremonyId = randomUUID();
      await storeChallenge(ceremonyId, { challenge: options.challenge, userId: ctx.user.id, mode: "mfa" });
      return { ceremonyId, options };
    }),

  /**
   * §3.5 — verify an assertion; issues the full session via the EXACT
   * TOTP-login issuance path (server/routers.ts verifyLoginTotp).
   */
  verifyAuthentication: publicProcedure
    .input(z.object({
      ceremonyId: z.string().uuid(),
      response: z.record(z.string(), z.any()), // AuthenticationResponseJSON
    }))
    .mutation(async ({ ctx, input }) => {
      assertWebauthnEnabled();

      // Step 1 — consume the challenge atomically (single-use, replay-proof).
      const stored = await consumeChallenge(input.ceremonyId);
      if (!stored) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "ceremony_expired" });
      }

      // §7.1 — per-user (or per-ceremony-hash for discoverable) failure
      // counter, mirroring TOTP_MAX_ATTEMPTS=5 / 15 min (totpLockout.ts).
      // Failures here NEVER consume TOTP attempts (§5.4).
      const limitKey = stored.userId ?? createHash("sha256").update(input.ceremonyId).digest("hex").slice(0, 16);
      await webauthnRateLimit(`verify-user:${limitKey}`, VERIFY_MAX_FAILURES, VERIFY_WINDOW_SECONDS);

      const db = requireDb(await getDb());
      const response = input.response as unknown as import("@simplewebauthn/server").AuthenticationResponseJSON;

      // Step 2 — resolve the credential row by rawId via the unique index.
      const rawId = typeof response.id === "string" ? response.id : "";
      let credBuf: Buffer;
      try {
        credBuf = b64urlToBuf(rawId);
      } catch {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication_failed" });
      }
      const rows = await db.select().from(webauthnCredentials).where(eq(webauthnCredentials.credentialId, credBuf)).limit(1);
      const cred = rows[0];
      // Wave P26 (O6): an UNCONFIRMED credential (confirmed_at NULL — first
      // factor pending email confirmation) is inert and rejected exactly
      // like an unknown one. The audit reason distinguishes the cases for
      // incident review; the client-visible error is identical.
      if (!cred || !cred.confirmedAt) {
        audit({
          userId: stored.userId ?? "anonymous",
          action: "webauthn.authenticateFailed",
          entityType: "webauthn_credential",
          entityId: input.ceremonyId,
          oldValue: null,
          newValue: JSON.stringify({ reason: !cred ? "unknown_credential" : "unconfirmed_credential" }),
          ...auditSource(ctx),
        });
        throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication_failed" });
      }

      // Step 3 — mfa-mode user binding: the credential must belong to the
      // challenged user AND the request must carry that user's session
      // (mfa-pending login upgrade or full-session step-up). This prevents
      // swapping a ceremony between users.
      if (stored.mode === "mfa") {
        if (!stored.userId || cred.userId !== stored.userId || ctx.user?.id !== stored.userId) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication_failed" });
        }
      } else {
        // Discoverable mode requires the passwordless gate at verify time
        // too (fail-closed if the flag was flipped mid-ceremony, §3.5 step 8).
        if (!ENV.webauthnPasswordlessEnabled) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication_failed" });
        }
      }

      // Step 4 — verify the assertion (real crypto; nothing mocked).
      const { origins, rpId } = resolveWebauthnRpConfig();
      const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
      const credentialArg = {
        id: cred.credentialId.toString("base64url"),
        publicKey: new Uint8Array(cred.publicKey),
        counter: cred.counter,
        transports: rowTransports(cred) as never,
      };
      let verification;
      try {
        try {
          verification = await verifyAuthenticationResponse({
            response,
            expectedChallenge: stored.challenge,
            expectedOrigin: origins,
            expectedRPID: rpId,
            requireUserVerification: true, // §4.3 — staff and admin alike
            credential: credentialArg,
          });
        } catch (err) {
          // §4.4 (binding): counter regression is warn-and-audit, NEVER
          // reject. SimpleWebAuthn v13 hard-fails regressions BEFORE
          // signature verification, so on that specific error re-verify once
          // with a zero stored counter — the signature/origin/RP/UV checks
          // still run in full — and let step 5 flag the anomaly. Any other
          // error is a genuine failure.
          const msg = err instanceof Error ? err.message : "";
          if (!/Response counter value .* was lower than expected/.test(msg)) throw err;
          verification = await verifyAuthenticationResponse({
            response,
            expectedChallenge: stored.challenge,
            expectedOrigin: origins,
            expectedRPID: rpId,
            requireUserVerification: true,
            credential: { ...credentialArg, counter: 0 },
          });
        }
      } catch (err) {
        audit({
          userId: cred.userId,
          action: "webauthn.authenticateFailed",
          entityType: "webauthn_credential",
          entityId: cred.id,
          oldValue: null,
          newValue: JSON.stringify({ reason: "bad_signature" }),
          ...auditSource(ctx),
        });
        throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication_failed" });
      }
      if (!verification.verified) {
        audit({
          userId: cred.userId,
          action: "webauthn.authenticateFailed",
          entityType: "webauthn_credential",
          entityId: cred.id,
          oldValue: null,
          newValue: JSON.stringify({ reason: "bad_signature" }),
          ...auditSource(ctx),
        });
        throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication_failed" });
      }

      // Step 5 — counter / clone detection (§4.4): warn-and-audit, NEVER
      // reject. Synced passkeys legitimately report static counters; strict
      // rejection would lock out exactly the users the rollout depends on.
      const newCounter = verification.authenticationInfo.newCounter;
      const counterAnomaly = newCounter <= cred.counter && !(newCounter === 0 && cred.counter === 0);

      // Step 6 — persist counter + usage timestamps.
      await db.update(webauthnCredentials).set({
        counter: newCounter,
        lastUsedAt: new Date(),
        ...(counterAnomaly ? { lastCounterAnomalyAt: new Date() } : {}),
      }).where(eq(webauthnCredentials.id, cred.id));

      if (counterAnomaly) {
        console.error(`[security][webauthn] counter anomaly on credential ${credHash(cred.credentialId)}: old=${cred.counter} new=${newCounter}`);
        // R1: 1/hour per-credential dedup on the anomaly audit write.
        const { getRedisClient } = await import("../redis");
        const redis = getRedisClient();
        let deduped = false;
        if (redis) {
          try {
            const marker = await redis.set(`webauthn-anomaly:${cred.id}`, "1", "EX", 3600, "NX");
            deduped = marker !== "OK";
          } catch { deduped = false; }
        }
        if (!deduped) {
          audit({
            userId: cred.userId,
            action: "webauthn.counterAnomaly",
            entityType: "webauthn_credential",
            entityId: cred.id,
            oldValue: JSON.stringify({ counter: cred.counter }),
            newValue: JSON.stringify({ credentialId: credHash(cred.credentialId), oldCounter: cred.counter, newCounter }),
            ...auditSource(ctx),
          });
        }
      }

      // Step 7 — session issuance, the SAME path as auth.verifyLoginTotp
      // (server/routers.ts:328-337). Issued when this ceremony upgrades an
      // mfa-pending login (mfa mode) or completes a gated discoverable login.
      const userId = cred.userId;
      const isUpgrade = stored.mode === "mfa" && ctx.mfaPending === true;
      const isDiscoverableLogin = stored.mode === "discoverable";
      if (isUpgrade || isDiscoverableLogin) {
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication_failed" });
        const { createSessionToken, getSessionDurationMsForUser } = await import("../_core/keycloak");
        const durationMs = await getSessionDurationMsForUser(userId);
        const token = await createSessionToken(userId, user.name ?? "", user.email ?? "", durationMs);
        ctx.res.cookie(COOKIE_NAME, token, {
          httpOnly: true,
          sameSite: "lax",
          secure: ENV.isProduction,
          maxAge: durationMs,
          path: "/",
        });
        // §5.4 — a legitimate second-factor success clears the TOTP failure
        // window regardless of factor.
        await resetTotpLoginAttempts(userId);
      }

      // §3.6 — record the step-up marker consumed by deleteCredential for
      // passkey-only users (TTL 600, single-use via sessionDel).
      if (stored.mode === "mfa" && stored.userId) {
        await storeStepupMarker(stored.userId, input.ceremonyId, STEPUP_TTL_SECONDS);
      }

      // Step 9 — audit success (§5.6).
      audit({
        userId,
        action: "webauthn.authenticate",
        entityType: "webauthn_credential",
        entityId: cred.id,
        oldValue: null,
        newValue: JSON.stringify({ credentialId: credHash(cred.credentialId), mode: stored.mode, counterAnomaly }),
        ...auditSource(ctx),
      });

      return { success: true as const, sessionIssued: isUpgrade || isDiscoverableLogin };
    }),

  /** §3.2 — list own credentials. */
  listCredentials: protectedProcedure.query(async ({ ctx }) => {
    assertWebauthnEnabled();
    const db = requireDb(await getDb());
    const rows = await db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, ctx.user.id));
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
      backedUp: r.backedUp,
      deviceType: r.deviceType,
      // Wave P26 (O6): false = pending email confirmation (inert).
      confirmed: r.confirmedAt != null,
    }));
  }),

  /** §3.2 — rename own credential (low-risk; no step-up; impersonation-blocked at middleware). */
  renameCredential: protectedProcedure
    .input(z.object({
      credentialId: z.string().min(1),
      name: z.string().min(1).max(128),
    }))
    .mutation(async ({ ctx, input }) => {
      assertWebauthnEnabled();
      const db = requireDb(await getDb());
      const rows = await db.select().from(webauthnCredentials)
        .where(and(eq(webauthnCredentials.id, input.credentialId), eq(webauthnCredentials.userId, ctx.user.id)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Credential not found" });
      await db.update(webauthnCredentials).set({ name: input.name }).where(eq(webauthnCredentials.id, row.id));
      audit({
        userId: ctx.user.id,
        action: "webauthn.rename",
        entityType: "webauthn_credential",
        entityId: row.id,
        oldValue: JSON.stringify({ name: row.name }),
        newValue: JSON.stringify({ name: input.name }),
        ...auditSource(ctx),
      });
      return { success: true as const };
    }),

  /**
   * §3.6 — delete own credential: ownership + step-up proof + last-factor
   * guard. Impersonation-blocked at the middleware (§5.5).
   */
  deleteCredential: protectedProcedure
    .input(z.object({
      credentialId: z.string().min(1),
      totpCode: z.string().min(6).max(16).optional(), // re-auth proof
      // §3.6 step-up proof transport: the x-webauthn-stepup HEADER is the
      // canonical carrier (API clients); the input field is the additive
      // equivalent for the tRPC web client, which cannot set per-call
      // headers through React hooks. Header wins when both are present.
      stepupCeremonyId: z.string().uuid().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertWebauthnEnabled();
      const db = requireDb(await getDb());
      const rows = await db.select().from(webauthnCredentials)
        .where(and(eq(webauthnCredentials.id, input.credentialId), eq(webauthnCredentials.userId, ctx.user.id)))
        .limit(1);
      const row = rows[0];
      // Ownership: NOT_FOUND either way — no cross-user existence leak.
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Credential not found" });

      // Wave P26 (O6): an UNCONFIRMED credential is inert — deleting it is
      // cancel/cleanup, not a security-sensitive removal. Skip the step-up
      // proof and the last-factor guard (a pending credential is not a
      // factor; a user in the forced-enrollment flow could not produce a
      // step-up proof anyway).
      if (!row.confirmedAt) {
        await db.delete(webauthnCredentials).where(eq(webauthnCredentials.id, row.id));
        audit({
          userId: ctx.user.id,
          action: "webauthn.deletePending",
          entityType: "webauthn_credential",
          entityId: row.id,
          oldValue: JSON.stringify({ name: row.name, deviceType: row.deviceType }),
          newValue: null,
          ...auditSource(ctx),
        });
        return { success: true as const };
      }

      // Re-auth proof (exactly one path, §3.6 step 3).
      const totp = await hasActiveTotp(ctx.user.id);
      if (totp) {
        if (!input.totpCode) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "totp_required" });
        }
        // Gate through the TOTP lockout so this endpoint cannot become an
        // unbounded TOTP oracle (§3.6).
        const gate = await checkTotpLoginAttempt(ctx.user.id);
        if (gate === "locked") {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "too_many_attempts" });
        }
        const ok = await verifyLoginCode(ctx.user.id, input.totpCode).catch(() => false);
        if (!ok) throw new TRPCError({ code: "UNAUTHORIZED", message: "invalid_totp_code" });
        await resetTotpLoginAttempts(ctx.user.id);
      } else {
        // Passkey-only: require a separately completed mfa-mode ceremony
        // within the last 10 minutes (single-use marker written by
        // verifyAuthentication).
        const headers = ((ctx.req as { headers?: Record<string, unknown> } | undefined)?.headers ?? {}) as Record<string, unknown>;
        const raw = headers["x-webauthn-stepup"];
        const ceremonyId = (Array.isArray(raw) ? raw[0] : (raw as string | undefined)) ?? input.stepupCeremonyId ?? "";
        // Single-use: GETDEL consumes the marker as it is read.
        const expected = ceremonyId ? await consumeStepupMarker(ctx.user.id) : null;
        if (!ceremonyId || !expected || expected !== ceremonyId) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "stepup_required" });
        }
      }

      // Last-factor guard (§3.6 step 4). Wave P26 (O6): only CONFIRMED
      // credentials count as remaining factors — pending ones are inert.
      const others = await db.select({ id: webauthnCredentials.id }).from(webauthnCredentials)
        .where(and(
          eq(webauthnCredentials.userId, ctx.user.id),
          ne(webauthnCredentials.id, row.id),
          isNotNull(webauthnCredentials.confirmedAt),
        ));
      const blocked = await lastFactorGuardBlocks(ctx.user.id, others.length, totp);
      if (blocked) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "cannot_remove_last_mfa_method" });
      }
      const removesLastFactor = others.length === 0 && !totp;

      await db.delete(webauthnCredentials).where(eq(webauthnCredentials.id, row.id));
      audit({
        userId: ctx.user.id,
        action: "webauthn.delete",
        entityType: "webauthn_credential",
        entityId: row.id,
        oldValue: JSON.stringify({ name: row.name, deviceType: row.deviceType, backedUp: row.backedUp }),
        newValue: removesLastFactor ? JSON.stringify({ lastFactorRemoved: true }) : null,
        ...auditSource(ctx),
      });
      return { success: true as const };
    }),
});
