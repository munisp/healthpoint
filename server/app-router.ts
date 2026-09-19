/**
 * server/app-router.ts
 *
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
import { payerRouter, idreRouter, orgsRouter } from "./routers/personas";
import { patientPortalRouter } from "./routers/patient-portal";
import { idreDirectoryRouter } from "./routers/idre-directory";
import { feeSchedulesRouter } from "./routers/fee-schedules";
import { featureFlagsRouter } from "./feature-flags";
import { impersonationRouter } from "./impersonation";
import { unsubscribeRouter } from "./routers/unsubscribe";
import { mergeRouters, router } from "./_core/trpc";

export const rootRouter = mergeRouters(
  appRouter,
  router({ idrCompliance: idrComplianceRouter }),
  router({ pushSubscriptions: pushSubscriptionsRouter }),
  router({ payer: payerRouter }),
  router({ patientPortal: patientPortalRouter }),
  router({ idre: idreRouter }),
  router({ orgs: orgsRouter }),
  // wave-w5 additions
  router({ idreDirectory: idreDirectoryRouter }),
  router({ feeSchedules: feeSchedulesRouter }),
  router({ featureFlags: featureFlagsRouter }),
  router({ impersonation: impersonationRouter }),
  // wave-w7 additions
  router({ unsubscribe: unsubscribeRouter })
);

export type RootRouter = typeof rootRouter;
/** Superset of the `AppRouter` type exported by server/routers. */
export type AppRouter = RootRouter;
