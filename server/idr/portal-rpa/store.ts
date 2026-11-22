/**
 * server/idr/portal-rpa/store.ts — Postgres persistence for the portal RPA driver.
 *
 * Replaces the module-scope `new InMemoryRunStore()` / `new InMemoryCheckpointQueue()`
 * in routes.ts (audit wave: runs/checkpoints/ownership must survive restarts).
 * Mirrors the lazy-getDb + setForTests pattern of PostgresSubmissionStore in
 * server/idr/submission-automation/store.ts.
 *
 * Security notes:
 *   - resume tokens are persisted ONLY as sha256 hashes (see hashResumeToken).
 *   - runs carry a `version` column; put() performs CAS optimistic concurrency
 *     and throws RunVersionConflictError on a stale write.
 *   - ownership (owner_user_id columns) is fail-closed: unknown run/checkpoint
 *     ids deny non-admin callers (see run-owners.ts + server/authz-registry.ts).
 */
import { createHash } from "crypto";
import { and, eq, isNull, lte } from "drizzle-orm";
import {
  idrPortalRpaRuns,
  idrPortalRpaCheckpoints,
} from "../../../drizzle/schema-portal-rpa";
import type { CheckpointInfo, RunRecord, RunResult, RunStore } from "./driver";
import type {
  CheckpointEmitter,
  CheckpointEntry,
  CheckpointQueue,
} from "./checkpoint-queue";

export function hashResumeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Internal capability form: the checkpoint-resolve path never had plaintext. */
const HASH_PREFIX = "sha256:";

export class RunVersionConflictError extends Error {
  constructor(runId: string) {
    super(`portal RPA run ${runId} version conflict (concurrent update)`);
    this.name = "RunVersionConflictError";
  }
}

type Db = NonNullable<Awaited<ReturnType<typeof import("../../db").getDb>>>;
async function requireDb(): Promise<Db> {
  const { getDb } = await import("../../db");
  const db = await getDb();
  if (!db) throw new Error("portal RPA store: database not available");
  return db;
}

function toRow(record: RunRecord): typeof idrPortalRpaRuns.$inferInsert {
  const { resumeToken, ownerUserId, version, ...payload } = record as RunRecord & {
    ownerUserId?: string | null;
    version?: number;
  };
  return {
    runId: record.runId,
    submissionId: record.submissionId,
    ownerUserId: ownerUserId ?? null,
    status: record.status,
    mode: record.mode,
    resumeTokenHash: resumeToken ? hashResumeToken(resumeToken) : null,
    payload,
    version: version ?? 1,
    updatedAt: new Date(),
  };
}

function fromRow(row: typeof idrPortalRpaRuns.$inferSelect): RunRecord {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  return {
    ...(payload as Omit<RunRecord, "runId" | "submissionId" | "status" | "mode">),
    runId: row.runId,
    submissionId: row.submissionId,
    status: row.status as RunRecord["status"],
    mode: row.mode as RunRecord["mode"],
    ownerUserId: row.ownerUserId ?? undefined,
    version: row.version,
    // resumeToken intentionally NOT restored (only the hash is stored).
  } as RunRecord;
}

export class PostgresRunStore implements RunStore {
  async get(runId: string): Promise<RunRecord | undefined> {
    const db = await requireDb();
    const rows = await db
      .select()
      .from(idrPortalRpaRuns)
      .where(eq(idrPortalRpaRuns.runId, runId))
      .limit(1);
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async getBySubmission(submissionId: string): Promise<RunRecord | undefined> {
    const db = await requireDb();
    const rows = await db
      .select()
      .from(idrPortalRpaRuns)
      .where(eq(idrPortalRpaRuns.submissionId, submissionId))
      .limit(1);
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async getByResumeToken(resumeToken: string): Promise<RunRecord | undefined> {
    const db = await requireDb();
    // Internal resolve path may carry the hash directly (sha256:<hex>); the
    // public API always passes the plaintext bearer token, hashed here.
    const hash = resumeToken.startsWith(HASH_PREFIX)
      ? resumeToken.slice(HASH_PREFIX.length)
      : hashResumeToken(resumeToken);
    const rows = await db
      .select()
      .from(idrPortalRpaRuns)
      .where(eq(idrPortalRpaRuns.resumeTokenHash, hash))
      .limit(1);
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async put(record: RunRecord): Promise<void> {
    const db = await requireDb();
    const existing = await db
      .select({ version: idrPortalRpaRuns.version })
      .from(idrPortalRpaRuns)
      .where(eq(idrPortalRpaRuns.runId, record.runId))
      .limit(1);
    const current = existing[0]?.version;
    const rec = record as RunRecord & { version?: number };
    if (current === undefined) {
      const row = toRow(rec);
      row.version = 1;
      row.createdAt = new Date();
      await db.insert(idrPortalRpaRuns).values(row);
      rec.version = 1;
      return;
    }
    // CAS: if the caller carried an explicit version it must match the stored
    // one; otherwise (driver's live record) CAS on the freshly read version.
    const expected = typeof rec.version === "number" ? rec.version : current;
    const next = expected + 1;
    const updated = await db
      .update(idrPortalRpaRuns)
      .set({ ...toRow({ ...rec, version: next } as RunRecord), version: next, updatedAt: new Date() })
      .where(
        and(
          eq(idrPortalRpaRuns.runId, rec.runId),
          eq(idrPortalRpaRuns.version, expected)
        )
      )
      .returning({ runId: idrPortalRpaRuns.runId });
    if (updated.length === 0) throw new RunVersionConflictError(rec.runId);
    rec.version = next;
  }

  /** Fold of run-owners.ts: persist run ownership (owner is immutable once set). */
  async setOwner(runId: string, ownerUserId: string): Promise<void> {
    const db = await requireDb();
    await db
      .update(idrPortalRpaRuns)
      .set({ ownerUserId })
      .where(and(eq(idrPortalRpaRuns.runId, runId), isNull(idrPortalRpaRuns.ownerUserId)));
  }

  async getOwner(runId: string): Promise<string | undefined> {
    const db = await requireDb();
    const rows = await db
      .select({ ownerUserId: idrPortalRpaRuns.ownerUserId })
      .from(idrPortalRpaRuns)
      .where(eq(idrPortalRpaRuns.runId, runId))
      .limit(1);
    return rows[0]?.ownerUserId ?? undefined;
  }

  async setForTests(): Promise<void> {
    const db = await requireDb();
    await db.delete(idrPortalRpaCheckpoints);
    await db.delete(idrPortalRpaRuns);
  }
}

function checkpointFromRow(row: typeof idrPortalRpaCheckpoints.$inferSelect): CheckpointEntry {
  return {
    checkpointId: row.checkpointId,
    runId: row.runId,
    submissionId: row.submissionId,
    checkpoint: row.checkpoint as CheckpointInfo,
    enqueuedAt: new Date(row.createdAt).toISOString(),
    expiresAtMs: new Date(row.expiresAt).getTime(),
    claimedBy: row.claimedBy ?? undefined,
    resolvedAt: row.resolvedAt ? new Date(row.resolvedAt).toISOString() : undefined,
    resolution: (row.resolution ?? undefined) as CheckpointEntry["resolution"],
    // Internal capability: the resolve path passes this to driver.resumeRun,
    // which resolves it against idr_portal_rpa_runs.resume_token_hash.
    resumeToken: row.resumeTokenHash ? `${HASH_PREFIX}${row.resumeTokenHash}` : "",
  };
}

type CheckpointRow = typeof idrPortalRpaCheckpoints.$inferSelect;

/** Reproduce InMemoryCheckpointQueue's liveEntry() failure taxonomy/order. */
function liveCheck(row: CheckpointRow | undefined, checkpointId: string): CheckpointRow {
  if (!row) throw new Error(`unknown checkpoint ${checkpointId}`);
  if (new Date(row.expiresAt).getTime() <= Date.now()) throw new Error(`checkpoint ${checkpointId} expired`);
  if (row.resolvedAt) throw new Error(`checkpoint ${checkpointId} already resolved`);
  return row;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;

export class PostgresCheckpointQueue implements CheckpointQueue {
  constructor(
    private readonly opts: {
      ttlMs?: number;
      emit?: CheckpointEmitter;
      idGen?: () => string;
    } = {}
  ) {}

  private publish(type: Parameters<CheckpointEmitter>[0], entry: CheckpointEntry): void {
    try {
      this.opts.emit?.(type, { ...entry });
    } catch {
      // Emitter failure must never mutate queue state.
    }
  }

  async enqueue(run: RunResult): Promise<CheckpointEntry> {
    if (run.status !== "CHECKPOINT_REQUIRED" || !run.checkpoint || !run.resumeToken) {
      throw new Error("only CHECKPOINT_REQUIRED runs with a resume token can be enqueued");
    }
    const db = await requireDb();
    const entry: CheckpointEntry = {
      checkpointId: this.opts.idGen?.() ?? `cp-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
      runId: run.runId,
      submissionId: run.submissionId,
      resumeToken: run.resumeToken,
      checkpoint: run.checkpoint,
      enqueuedAt: new Date().toISOString(),
      expiresAtMs: Date.now() + (this.opts.ttlMs ?? DEFAULT_TTL_MS),
    };
    await db.transaction(async (tx) => {
      // One live entry per run — re-enqueue replaces (driver re-parks on resume).
      await tx
        .delete(idrPortalRpaCheckpoints)
        .where(
          and(
            eq(idrPortalRpaCheckpoints.runId, run.runId),
            isNull(idrPortalRpaCheckpoints.resolvedAt)
          )
        );
      await tx.insert(idrPortalRpaCheckpoints).values({
        checkpointId: entry.checkpointId,
        runId: entry.runId,
        submissionId: entry.submissionId,
        checkpoint: entry.checkpoint,
        resumeTokenHash: hashResumeToken(run.resumeToken as string),
        expiresAt: new Date(entry.expiresAtMs),
      });
    });
    this.publish("rpa.checkpoint.enqueued", entry);
    return { ...entry };
  }

  async list(opts: { includeExpired?: boolean; includeResolved?: boolean } = {}): Promise<CheckpointEntry[]> {
    const db = await requireDb();
    const rows = await db.select().from(idrPortalRpaCheckpoints);
    const now = Date.now();
    return rows
      .filter((r) => opts.includeResolved || !r.resolvedAt)
      .filter((r) => opts.includeExpired || new Date(r.expiresAt).getTime() > now)
      .map(checkpointFromRow);
  }

  async claim(checkpointId: string, actorId: string): Promise<CheckpointEntry> {
    const db = await requireDb();
    const rows = await db
      .select()
      .from(idrPortalRpaCheckpoints)
      .where(eq(idrPortalRpaCheckpoints.checkpointId, checkpointId))
      .limit(1);
    const row = liveCheck(rows[0], checkpointId);
    if (row.claimedBy && row.claimedBy !== actorId) {
      throw new Error(`checkpoint ${checkpointId} already claimed by another actor`);
    }
    if (!row.claimedBy) {
      // Atomic claim: only succeed if still unclaimed.
      const updated = await db
        .update(idrPortalRpaCheckpoints)
        .set({ claimedBy: actorId })
        .where(
          and(
            eq(idrPortalRpaCheckpoints.checkpointId, checkpointId),
            isNull(idrPortalRpaCheckpoints.claimedBy),
            isNull(idrPortalRpaCheckpoints.resolvedAt)
          )
        )
        .returning();
      if (!updated[0]) throw new Error(`checkpoint ${checkpointId} already claimed by another actor`);
      const entry = checkpointFromRow(updated[0]);
      this.publish("rpa.checkpoint.claimed", entry);
      return entry;
    }
    const entry = checkpointFromRow(row);
    this.publish("rpa.checkpoint.claimed", entry);
    return entry;
  }

  async resolve(
    checkpointId: string,
    resolution: { mfaCode?: string; humanCompleted?: boolean }
  ): Promise<CheckpointEntry> {
    const db = await requireDb();
    const rows = await db
      .select()
      .from(idrPortalRpaCheckpoints)
      .where(eq(idrPortalRpaCheckpoints.checkpointId, checkpointId))
      .limit(1);
    const row = liveCheck(rows[0], checkpointId);
    if ((row.checkpoint as CheckpointInfo).kind === "MFA" && !resolution.mfaCode) {
      throw new Error("MFA checkpoint resolution requires an mfaCode");
    }
    const updated = await db
      .update(idrPortalRpaCheckpoints)
      .set({
        resolvedAt: new Date(),
        // Store only that a code was provided — never the code itself.
        resolution: {
          mfaCodeProvided: Boolean(resolution.mfaCode),
          humanCompleted: Boolean(resolution.humanCompleted),
        },
      })
      .where(
        and(
          eq(idrPortalRpaCheckpoints.checkpointId, checkpointId),
          isNull(idrPortalRpaCheckpoints.resolvedAt)
        )
      )
      .returning();
    if (!updated[0]) throw new Error(`checkpoint ${checkpointId} already resolved`);
    const entry = checkpointFromRow(updated[0]);
    this.publish("rpa.checkpoint.resolved", entry);
    return entry;
  }

  async sweepExpired(nowMs?: number): Promise<number> {
    const db = await requireDb();
    const now = nowMs ?? Date.now();
    const rows = await db
      .update(idrPortalRpaCheckpoints)
      .set({
        resolvedAt: new Date(now),
        resolution: { mfaCodeProvided: false, humanCompleted: false },
      })
      .where(
        and(
          isNull(idrPortalRpaCheckpoints.resolvedAt),
          lte(idrPortalRpaCheckpoints.expiresAt, new Date(now))
        )
      )
      .returning();
    for (const row of rows) this.publish("rpa.checkpoint.expired", checkpointFromRow(row));
    return rows.length;
  }

  /** Fold of run-owners.ts: checkpoint ownership column (immutable once set). */
  async setOwner(checkpointId: string, ownerUserId: string): Promise<void> {
    const db = await requireDb();
    await db
      .update(idrPortalRpaCheckpoints)
      .set({ ownerUserId })
      .where(
        and(
          eq(idrPortalRpaCheckpoints.checkpointId, checkpointId),
          isNull(idrPortalRpaCheckpoints.ownerUserId)
        )
      );
  }

  async getOwner(checkpointId: string): Promise<string | undefined> {
    const db = await requireDb();
    const rows = await db
      .select({ ownerUserId: idrPortalRpaCheckpoints.ownerUserId })
      .from(idrPortalRpaCheckpoints)
      .where(eq(idrPortalRpaCheckpoints.checkpointId, checkpointId))
      .limit(1);
    return rows[0]?.ownerUserId ?? undefined;
  }

  async setForTests(): Promise<void> {
    const db = await requireDb();
    await db.delete(idrPortalRpaCheckpoints);
  }
}

// ── Singletons (Postgres default; in-memory implementations stay injectable
// for tests — mirrors PostgresSubmissionStore's setForTests pattern) ──────────
let _runStore: RunStore | null = null;
let _checkpointQueue: CheckpointQueue | null = null;

/** Default checkpoint emitter: rpa.checkpoint.* via the repo event bus
 * (persisted to event_log; never throws into queue state transitions). */
function defaultCheckpointEmit(
  type: Parameters<CheckpointEmitter>[0],
  entry: CheckpointEntry
): void {
  void import("../../events/bus")
    .then(({ eventBus }) =>
      eventBus.publish(type, entry.checkpointId, "portal_rpa_checkpoint", {
        runId: entry.runId,
        submissionId: entry.submissionId,
        checkpointKind: entry.checkpoint?.kind,
      })
    )
    .catch((err) => console.warn("[portal-rpa] checkpoint event publish failed:", err));
}

/** Default run-event emitter for the driver (rpa.run.* via the event bus). */
export function publishRunEvent(event: {
  type: string;
  runId: string;
  submissionId: string;
  detail?: Record<string, unknown>;
}): void {
  void import("../../events/bus")
    .then(({ eventBus }) =>
      eventBus.publish(event.type as never, event.runId, "portal_rpa_run", {
        submissionId: event.submissionId,
        ...(event.detail ?? {}),
      })
    )
    .catch((err) => console.warn("[portal-rpa] run event publish failed:", err));
}

export function getPortalRpaRunStore(): RunStore {
  if (!_runStore) _runStore = new PostgresRunStore();
  return _runStore;
}

export function getPortalRpaCheckpointQueue(): CheckpointQueue {
  if (!_checkpointQueue) _checkpointQueue = new PostgresCheckpointQueue({ emit: defaultCheckpointEmit });
  return _checkpointQueue;
}

export function setPortalRpaStoresForTests(deps: {
  runStore?: RunStore;
  checkpointQueue?: CheckpointQueue;
}): void {
  if (deps.runStore !== undefined) _runStore = deps.runStore;
  if (deps.checkpointQueue !== undefined) _checkpointQueue = deps.checkpointQueue;
}
