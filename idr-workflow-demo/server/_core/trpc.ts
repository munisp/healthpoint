import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

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
 * Protected procedure — requires auth + auto-invalidates search index on mutations.
 */
export const protectedProcedure = t.procedure
  .use(requireUser)
  .use(invalidateSearchOnMutation);
