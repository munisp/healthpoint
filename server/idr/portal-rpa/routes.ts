/**
 * routes.ts — tRPC surface for the CMS federal IDR portal RPA driver.
 *
 * Thin wrappers only: all fail-closed behavior lives in driver.ts /
 * config.ts / checkpoint-queue.ts. This router never returns credential
 * values or full sensitive field values; filledFields are already redacted
 * by the driver, and parked storage state / internal indices are stripped.
 *
 * INTEGRATION SEAM: `startRun` accepts `portalFields` directly for now.
 * The persistence/submission wave should replace this with a server-side
 * load of the submission package (buildSubmissionPackage output keyed by
 * submissionId) so clients never supply portal content. Tracked as a seam;
 * input validation still fail-closes on non-object portalFields.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../../_core/trpc";
import {
  PORTAL_MAP_VERSION,
  countUnverifiedSelectors,
  loadPortalMap,
  PortalMapError,
} from "./config";
import {
  PortalRpaDriver,
  InMemoryRunStore,
  createEnvCredentialResolver,
  createStorageEvidenceSink,
  type RunInput,
  type RunResult,
} from "./driver";
import { InMemoryCheckpointQueue, type CheckpointEntry } from "./checkpoint-queue";
import {
  recordRunOwner,
  getRunOwner,
  recordCheckpointOwner,
  getCheckpointOwner,
} from "./run-owners";

/** X4: only the run's owner (or an admin) may read/act on a run. */
function assertRunAccess(ctx: { user: { id: string; role: string } }, runId: string): void {
  if (ctx.user.role === "admin") return;
  const owner = getRunOwner(runId);
  // Fail closed: unknown owner (e.g. pre-fix run) denies non-admin callers.
  if (!owner || owner !== ctx.user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not own this portal run" });
  }
}

function entryVisibleTo(ctx: { user: { id: string; role: string } }, entry: CheckpointEntry): boolean {
  if (ctx.user.role === "admin") return true;
  const owner = getCheckpointOwner(entry.checkpointId) ?? getRunOwner(entry.runId);
  return owner === ctx.user.id;
}

/** Local admin procedure (same pattern as sibling route files; cannot import
 * the one in routers.ts due to circularity). */
const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next();
});

// --- Module-scope singletons (in-memory until the persistence wave lands) ---
const runStore = new InMemoryRunStore();
const checkpointQueue = new InMemoryCheckpointQueue({
  emit: (type, entry) => {
    // Event bus taxonomy (server/events/bus.ts IDREventType) has no RPA
    // events yet; emit a console breadcrumb instead of forcing a bad type.
    // Persistence wave: add "rpa.*" to IDREventType and wire eventBus here.
    console.info(`[portal-rpa] ${type} run=${entry.runId} checkpoint=${entry.checkpoint.kind}`);
  },
});

let cachedDriver: PortalRpaDriver | null = null;
async function getDriver(): Promise<PortalRpaDriver> {
  if (cachedDriver) return cachedDriver;
  const portalMap = loadPortalMap(process.env); // throws (fail-closed) on mismatch
  const credentialResolver = await createEnvCredentialResolver();
  cachedDriver = new PortalRpaDriver({
    portalMap,
    credentialResolver,
    evidenceSink: createStorageEvidenceSink(),
    runStore,
    pageFactory: () =>
      import("./driver").then((m) => m.createPlaywrightPage(portalMap.baseUrl)),
    onEvent: (e) => console.info(`[portal-rpa] ${e.type} run=${e.runId} submission=${e.submissionId}`),
  });
  return cachedDriver;
}

const runInputSchema = z.object({
  submissionId: z.string().min(1).max(128),
  portalFields: z.record(z.string(), z.string()),
  documents: z.array(z.string().max(2048)).max(100).optional(),
  credentialsRef: z.string().min(1).max(256),
  mode: z.enum(["DRY_RUN", "LIVE"]).default("DRY_RUN"),
});

/** Strip anything that must never cross the API boundary. */
function publicRun(run: RunResult) {
  return {
    runId: run.runId,
    submissionId: run.submissionId,
    mode: run.mode,
    status: run.status,
    attestation: run.attestation,
    cmsDisputeReferenceNumber: run.cmsDisputeReferenceNumber,
    checkpoint: run.checkpoint,
    resumeToken: run.resumeToken,
    evidence: run.evidence,
    filledFields: run.filledFields, // values already "[REDACTED]" for sensitive keys
    timeline: run.timeline,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

export const portalRpaRouter = router({
  /** Start a portal submission run (default DRY_RUN). Checkpoints raised
   * during the run are enqueued for human resolution. */
  startRun: protectedProcedure
    .input(runInputSchema)
    .mutation(async ({ input, ctx }) => {
      const driver = await getDriver();
      const runInput: RunInput = { ...input, actorId: ctx.user.id };
      const result = await driver.runPortalSubmission(runInput);
      // X4: bind the run (and any parked checkpoint) to the calling user.
      recordRunOwner(result.runId, ctx.user.id);
      if (result.status === "CHECKPOINT_REQUIRED") {
        const entry = await checkpointQueue.enqueue(result);
        recordCheckpointOwner(entry.checkpointId, ctx.user.id);
      }
      return publicRun(result);
    }),

  getRun: protectedProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const record = await runStore.get(input.runId);
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
      assertRunAccess(ctx, input.runId);
      return publicRun(record);
    }),

  listCheckpoints: protectedProcedure.query(async ({ ctx }) => {
    // X4: callers only see checkpoints for their own runs; admins see all.
    const entries = await checkpointQueue.list();
    return entries.filter((e) => entryVisibleTo(ctx, e));
  }),

  /** Resolve a checkpoint (supply MFA code / human-completed flag) and
   * resume the run in one call. The MFA code is consumed in-memory and
   * never stored or returned. */
  resolveCheckpoint: protectedProcedure
    .input(runInputSchema.extend({
      checkpointId: z.string().min(1),
      mfaCode: z.string().min(1).max(64).optional(),
      humanCompleted: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { checkpointId, mfaCode, humanCompleted, ...runInputRaw } = input;
      // X4: the checkpoint must belong to one of the caller's runs.
      const pending = await checkpointQueue.list({ includeResolved: true });
      const target = pending.find((e) => e.checkpointId === checkpointId);
      if (target && !entryVisibleTo(ctx, target)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not own this checkpoint" });
      }
      const entry = await checkpointQueue.resolve(checkpointId, { mfaCode, humanCompleted }).catch((err) => {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : String(err) });
      });
      const driver = await getDriver();
      const result = await driver.resumeRun(
        entry.resumeToken,
        { ...runInputRaw, actorId: ctx.user.id },
        { mfaCode }
      );
      if (result.status === "CHECKPOINT_REQUIRED") {
        recordRunOwner(result.runId, ctx.user.id);
        const parked = await checkpointQueue.enqueue(result); // re-parked (e.g. CAPTCHA still present)
        recordCheckpointOwner(parked.checkpointId, ctx.user.id);
      }
      return publicRun(result);
    }),

  resumeRun: protectedProcedure
    .input(runInputSchema.extend({
      resumeToken: z.string().min(1),
      mfaCode: z.string().min(1).max(64).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { resumeToken, mfaCode, ...runInputRaw } = input;
      const driver = await getDriver();
      try {
        const result = await driver.resumeRun(resumeToken, { ...runInputRaw, actorId: ctx.user.id }, { mfaCode });
        recordRunOwner(result.runId, ctx.user.id);
        if (result.status === "CHECKPOINT_REQUIRED") {
          const parked = await checkpointQueue.enqueue(result);
          recordCheckpointOwner(parked.checkpointId, ctx.user.id);
        }
        return publicRun(result);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : String(err) });
      }
    }),

  /** Portal map metadata for operators: version + verification status. */
  portalMapInfo: adminProcedure.query(() => {
    try {
      const map = loadPortalMap(process.env);
      return {
        loaded: true as const,
        version: PORTAL_MAP_VERSION,
        baseUrl: map.baseUrl,
        stepCount: map.steps.length,
        stepIds: map.steps.map((s) => s.stepId),
        unverifiedSelectors: countUnverifiedSelectors(map),
        liveEnabled: process.env.RPA_LIVE_ENABLED === "true",
        tosAcknowledged: process.env.RPA_TOS_ACKNOWLEDGED === "true",
      };
    } catch (err) {
      if (err instanceof PortalMapError) {
        return { loaded: false as const, error: err.message, version: PORTAL_MAP_VERSION };
      }
      throw err;
    }
  }),
});

export type PortalRpaRouter = typeof portalRpaRouter;
