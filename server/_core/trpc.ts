import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { enforcePathAuthz } from "../authz-registry";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

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

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
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
  .use(invalidateSearchOnMutation);
