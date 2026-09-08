/**
 * Root tRPC router barrel.
 *
 * server/routers.ts is owned by another workstream on this branch (and too
 * large to edit through API-based merges), so the idr-compliance router
 * (server/routers/idr-compliance.ts) and the push-subscriptions router
 * (server/routers/push-subscriptions.ts) are merged into the app router HERE
 * instead of inside routers.ts. server/_core/index.ts mounts `rootRouter`
 * at /api/trpc; `mergeRouters` is re-exported from server/_core/trpc.ts.
 *
 * Type compatibility: the client keeps importing
 * `import type { AppRouter } from "../../../server/routers"` — that type
 * remains valid because rootRouter is a superset of appRouter. The superset
 * type is additionally exported here for any consumer that needs the
 * idrCompliance / pushSubscriptions paths.
 */
import { appRouter } from "./routers";
import { idrComplianceRouter } from "./routers/idr-compliance";
import { pushSubscriptionsRouter } from "./routers/push-subscriptions";
import { mergeRouters, router } from "./_core/trpc";

export const rootRouter = mergeRouters(
  appRouter,
  router({ idrCompliance: idrComplianceRouter }),
  router({ pushSubscriptions: pushSubscriptionsRouter })
);

export type RootRouter = typeof rootRouter;
/** Superset of the `AppRouter` type exported by server/routers. */
export type AppRouter = RootRouter;
