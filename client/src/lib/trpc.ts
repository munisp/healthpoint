import { createTRPCReact } from "@trpc/react-query";
// Root router type from server/app-router.ts — a superset of the
// server/routers AppRouter that includes the idrCompliance merge,
// unlocking typed trpc.idrCompliance for later waves.
import type { AppRouter } from "../../../server/app-router";

export const trpc = createTRPCReact<AppRouter>();
