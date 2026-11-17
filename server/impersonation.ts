/**
 * server/impersonation.ts
 *
 * Audited admin impersonation (wave W5-6).
 *
 * Flow:
 *  1. Admin calls `impersonation.start({ userId, reason })` (reason ≥ 20
 *     chars). A 15-minute HS256 JWT is issued with claims
 *     { impersonatorId, targetId, purpose: "impersonation" } and an
 *     audit_log row action='impersonate.start' is written.
 *  2. The client stores the token (sessionStorage) and sends it as the
 *     `x-impersonation-token` header. The tRPC client attaches it (see
 *     client/src/main.tsx); the banner (client/src/components/ImpersonationBanner.tsx)
 *     shows whose session is being impersonated and offers "End".
 *  3. Every request carrying a valid token is audited by
 *     `impersonationMiddleware` (action='impersonate.access', entityId=tRPC
 *     path). The middleware also exposes the claims on ctx.impersonation.
 *  4. Guard: while impersonating ANOTHER ADMIN, write-only admin procedures
 *     (mutations) are blocked — read-only queries are allowed. Enforced in
 *     the middleware for admin.* mutation paths.
 *  5. `impersonation.end` writes audit_log action='impersonate.end' and
 *     revokes the token's jti; `impersonation.endActive` lets an admin
 *     revoke a live token server-side (action='impersonate.revoke').
 *     Revocation reuses the same Redis jti blocklist as session tokens
 *     (server/redis.ts revokeToken/isTokenRevoked, fail-closed in
 *     production); tokens also remain time-boxed to 15 minutes.
 *     Phase 24 (F4): previously there was no server-side revocation list.
 *
 * Integration: `impersonationMiddleware` is applied to the admin procedure
 * chain in server/routers.ts (and to this module's router). The token is a
 * companion credential — it does NOT replace the session cookie, so the
 * caller's identity (ctx.user) remains the impersonating admin; the claims
 * indicate the target whose perspective is being exercised.
 */
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { getDb, createAuditEntry } from "./db";
import { users } from "../drizzle/schema";
import { router, protectedProcedure } from "./_core/trpc";
import { revokeToken, isTokenRevoked } from "./redis";

export const IMPERSONATION_HEADER = "x-impersonation-token";
export const IMPERSONATION_TTL_MS = 15 * 60 * 1000; // 15 minutes, hard cap

export interface ImpersonationClaims {
  impersonatorId: string;
  targetId: string;
  purpose: "impersonation";
  /** Unique token id (phase 24, F4) — the revocation-list key. */
  jti?: string;
  /** Expiry (seconds since epoch) — used to size the revocation TTL. */
  exp?: number;
}

/** Context extension: the global impersonation middleware in
 * server/_core/trpc.ts attaches verified claims under this key. */
export type ImpersonationAwareContext = { impersonation?: ImpersonationClaims };

function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? "";
  if (!secret) throw new Error("JWT_SECRET is required for impersonation tokens");
  return new TextEncoder().encode(secret);
}

export async function issueImpersonationToken(claims: ImpersonationClaims, ttlMs = IMPERSONATION_TTL_MS): Promise<string> {
  const ttl = Math.min(ttlMs, IMPERSONATION_TTL_MS);
  return new SignJWT({ impersonatorId: claims.impersonatorId, targetId: claims.targetId, purpose: claims.purpose })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.impersonatorId)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + ttl) / 1000))
    .sign(secretKey());
}

export async function verifyImpersonationToken(token: string): Promise<ImpersonationClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    const p = payload as Record<string, unknown>;
    if (p.purpose !== "impersonation") return null;
    if (typeof p.impersonatorId !== "string" || typeof p.targetId !== "string") return null;
    const jti = typeof p.jti === "string" ? p.jti : undefined;
    const exp = typeof p.exp === "number" ? p.exp : undefined;
    // Phase 24 (F4): server-side revocation. isTokenRevoked fails CLOSED in
    // production (Redis down ⇒ treated as revoked), same as session tokens.
    if (jti && (await isTokenRevoked(jti))) return null;
    return { impersonatorId: p.impersonatorId, targetId: p.targetId, purpose: "impersonation", jti, exp };
  } catch {
    return null; // expired or invalid — treated as no impersonation
  }
}

/**
 * Revoke a live impersonation token by jti (phase 24, F4). TTL = the token's
 * remaining lifetime so the blocklist entry never outlives the token.
 */
export async function revokeImpersonationToken(claims: ImpersonationClaims): Promise<void> {
  if (!claims.jti) return; // pre-F4 tokens have no jti; they expire within 15 min
  const remainingSeconds = claims.exp ? Math.max(1, Math.ceil(claims.exp - Date.now() / 1000)) : Math.ceil(IMPERSONATION_TTL_MS / 1000);
  await revokeToken(claims.jti, remainingSeconds);
}

// NOTE: per-request auditing ('impersonate.access') and the
// impersonating-another-admin mutation guard live in
// `auditImpersonatedRequest` in server/_core/trpc.ts, applied globally to
// every protected procedure.

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

export const impersonationRouter = router({
  start: adminProcedure
    .input(z.object({
      userId: z.string().min(1),
      reason: z.string().min(20, "An impersonation reason of at least 20 characters is required").max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [target] = await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Target user not found" });
      if (target.id === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot impersonate yourself" });

      const token = await issueImpersonationToken({
        impersonatorId: ctx.user.id,
        targetId: target.id,
        purpose: "impersonation",
      });

      await createAuditEntry({
        userId: ctx.user.id,
        action: "impersonate.start",
        entityType: "user",
        entityId: target.id,
        oldValue: null,
        newValue: JSON.stringify({ reason: input.reason, targetRole: target.role, ttlMs: IMPERSONATION_TTL_MS }),
        ipAddress: null,
        userAgent: null,
      });

      return {
        token,
        expiresAt: new Date(Date.now() + IMPERSONATION_TTL_MS).toISOString(),
        target: { id: target.id, name: target.name, role: target.role },
      };
    }),

  end: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const claims = await verifyImpersonationToken(input.token);
      // Phase 24 (F4): actually revoke the token, not just log the end.
      if (claims) await revokeImpersonationToken(claims);
      await createAuditEntry({
        userId: claims?.impersonatorId ?? ctx.user.id,
        action: "impersonate.end",
        entityType: "user",
        entityId: claims?.targetId ?? null,
        oldValue: null,
        newValue: claims ? null : JSON.stringify({ note: "token already expired/invalid" }),
        ipAddress: null,
        userAgent: null,
      });
      return { success: true };
    }),

  /**
   * Phase 24 (F4): admin-initiated server-side revocation of a live
   * impersonation token (e.g. on suspected misuse). The token's jti is added
   * to the same Redis blocklist used for session tokens, so the very next
   * request carrying it is rejected by auditImpersonatedRequest.
   */
  endActive: adminProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const claims = await verifyImpersonationToken(input.token);
      if (!claims) throw new TRPCError({ code: "NOT_FOUND", message: "Token is expired, invalid, or already revoked" });
      await revokeImpersonationToken(claims);
      await createAuditEntry({
        userId: ctx.user.id,
        action: "impersonate.revoke",
        entityType: "user",
        entityId: claims.targetId,
        oldValue: null,
        newValue: JSON.stringify({ impersonatorId: claims.impersonatorId, revokedBy: ctx.user.id }),
        ipAddress: null,
        userAgent: null,
      });
      return { success: true };
    }),
});
