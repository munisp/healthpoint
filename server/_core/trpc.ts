import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { enforcePathAuthz } from "../authz-registry";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
// Re-exported so server/app-router.ts can merge the idr-compliance router
// into the app router without editing the (workstream-owned) routers.ts.
export const mergeRouters = t.mergeRouters;

/**
 * Middleware that automatically invalidates the Fuse.js / OpenSearch search
 * index cache after any successful mutation so subsequent searches reflect the
 * latest data without a manual cache-bust call in every procedure.
 */
const invalidateSearchOnMutation = t.middleware(async opts => {
  const result = await opts.next();
  if (opts.type === "mutation" && result.ok) {
    // Lazy import to avoid circular deps at module load time
    import("../search").then(m => m.invalidateSearchIndex()).catch(() => {});
  }
  return result;
});

/**
 * Procedures a pre-MFA ("mfa-pending") session may call: the login-upgrade
 * endpoint plus the TOTP enrollment procs (forced-enrollment flow when
 * orgSettings.requireMFA=true). Everything else gets 403 mfa_required.
 */
export const MFA_PENDING_ALLOWED_PATHS = new Set([
  "auth.verifyLoginTotp",
  "auth.me",
  "totp.status",
  "totp.generateSecret",
  "totp.setup",
  "totp.verify",
  "totp.getBackupCodes",
]);

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  if (ctx.mfaPending && !MFA_PENDING_ALLOWED_PATHS.has(opts.path)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "mfa_required" });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

/**
 * orgSettings.auditAllActions — when enabled for the calling user, every
 * successful mutation is recorded in audit_log. Fire-and-forget: audit
 * failures never fail the request (warn-logged).
 */
const auditAllActionsOnMutation = t.middleware(async opts => {
  const result = await opts.next();
  if (opts.type === "mutation" && result.ok && opts.ctx.user) {
    const user = opts.ctx.user;
    const path = opts.path;
    void (async () => {
      const { getDb, createAuditEntry } = await import("../db");
      const { orgSettings } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return;
      const rows = await db.select({ a: orgSettings.auditAllActions }).from(orgSettings).where(eq(orgSettings.userId, user.id)).limit(1);
      if (rows[0]?.a !== true) return;
      const headers = (opts.ctx.req?.headers ?? {}) as Record<string, unknown>;
      const ip = (headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? opts.ctx.req?.ip ?? null;
      await createAuditEntry({
        userId: user.id,
        action: "mutation",
        entityType: "trpc",
        entityId: path,
        oldValue: null,
        newValue: null,
        ipAddress: ip,
        userAgent: (headers["user-agent"] as string | undefined) ?? null,
      });
    })().catch(err => console.warn("[audit] auditAllActions write failed:", err instanceof Error ? err.message : err));
  }
  return result;
});

/**
 * Central object-level authorization (IDOR protection). Runs AFTER `requireUser`
 * and consults the path→checker registry in server/authz-registry.ts. Mapped
 * paths must pass their checker (fail closed: checker errors deny the request);
 * unmapped paths default-allow with a once-per-path audit log line.
 *
 * In @trpc/server v11 the input is zod-validated BEFORE middlewares run, so
 * checkers receive the parsed, schema-validated input object.
 */
const enforceObjectLevelAuthz = t.middleware(async opts => {
  const { ctx, next, path } = opts;
  // ctx.user is guaranteed non-null because requireUser runs first.
  const user = ctx.user!;
  // @trpc/server v11 middlewares receive the PARSED input as `input` (zod has
  // already validated it) plus `getRawInput()` for the unparsed value; there
  // is no `rawInput` property on middleware opts in v11.
  const parsed = (opts as { input?: unknown }).input;
  const input = parsed !== undefined ? parsed : await opts.getRawInput();
  await enforcePathAuthz(path, {
    user: { id: user.id, role: user.role === "admin" ? "admin" : "user" },
  }, input);
  return next();
});

/**
 * Protected procedure — requires auth + object-level authz +
 * auto-invalidates search index on mutations.
 */
export const protectedProcedure = t.procedure
  .use(requireUser)
  .use(enforceObjectLevelAuthz)
  .use(invalidateSearchOnMutation)
  .use(auditAllActionsOnMutation);
