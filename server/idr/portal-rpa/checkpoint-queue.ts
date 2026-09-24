/**
 * checkpoint-queue.ts — queue of CHECKPOINT_REQUIRED portal RPA runs
 * awaiting human action (login.gov MFA code, out-of-band CAPTCHA solve,
 * unrecognized portal DOM review).
 *
 * In-memory with an interface seam: the persistence wave replaces
 * InMemoryCheckpointQueue with a DB-backed implementation without touching
 * callers. Events go out through an injected emitter callback; the routes
 * layer wires it to the existing eventBus where the event taxonomy allows.
 */
import type { CheckpointInfo, RunResult } from "./driver";

export interface CheckpointEntry {
  checkpointId: string;
  runId: string;
  submissionId: string;
  resumeToken: string;
  checkpoint: CheckpointInfo;
  enqueuedAt: string;
  /** Epoch ms after which the entry is expired (default 30 min). */
  expiresAtMs: number;
  claimedBy?: string;
  resolvedAt?: string;
  resolution?: { mfaCodeProvided: boolean; humanCompleted: boolean };
}

export interface CheckpointQueue {
  enqueue(run: RunResult): Promise<CheckpointEntry>;
  list(opts?: { includeExpired?: boolean; includeResolved?: boolean }): Promise<CheckpointEntry[]>;
  claim(checkpointId: string, actorId: string): Promise<CheckpointEntry>;
  /** Resolve a checkpoint; returns the entry plus the resumeToken to pass to
   * resumeRun. mfaCode is consumed by the caller and NEVER stored. */
  resolve(checkpointId: string, resolution: { mfaCode?: string; humanCompleted?: boolean }): Promise<CheckpointEntry>;
  /** Mark all expired entries; returns count expired. */
  sweepExpired(nowMs?: number): Promise<number>;
}

export type CheckpointEventType =
  | "rpa.checkpoint.enqueued"
  | "rpa.checkpoint.claimed"
  | "rpa.checkpoint.resolved"
  | "rpa.checkpoint.expired";

export type CheckpointEmitter = (type: CheckpointEventType, entry: CheckpointEntry) => void;

const DEFAULT_TTL_MS = 30 * 60 * 1000;

export class InMemoryCheckpointQueue implements CheckpointQueue {
  private entries = new Map<string, CheckpointEntry>();

  constructor(
    private readonly opts: {
      ttlMs?: number;
      emit?: CheckpointEmitter;
      now?: () => number;
      idGen?: () => string;
    } = {}
  ) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  private publish(type: CheckpointEventType, entry: CheckpointEntry): void {
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
    // One live entry per run — re-enqueue replaces (driver re-parks on resume).
    for (const [id, e] of this.entries) {
      if (e.runId === run.runId && !e.resolvedAt) this.entries.delete(id);
    }
    const entry: CheckpointEntry = {
      checkpointId: this.opts.idGen?.() ?? `cp-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
      runId: run.runId,
      submissionId: run.submissionId,
      resumeToken: run.resumeToken,
      checkpoint: run.checkpoint,
      enqueuedAt: new Date(this.now()).toISOString(),
      expiresAtMs: this.now() + (this.opts.ttlMs ?? DEFAULT_TTL_MS),
    };
    this.entries.set(entry.checkpointId, entry);
    this.publish("rpa.checkpoint.enqueued", entry);
    return { ...entry };
  }

  async list(opts: { includeExpired?: boolean; includeResolved?: boolean } = {}): Promise<CheckpointEntry[]> {
    const now = this.now();
    return [...this.entries.values()]
      .filter((e) => (opts.includeResolved || !e.resolvedAt))
      .filter((e) => (opts.includeExpired || e.expiresAtMs > now))
      .map((e) => ({ ...e }));
  }

  private liveEntry(checkpointId: string): CheckpointEntry {
    const e = this.entries.get(checkpointId);
    if (!e) throw new Error(`unknown checkpoint ${checkpointId}`);
    if (e.expiresAtMs <= this.now()) {
      this.publish("rpa.checkpoint.expired", e);
      throw new Error(`checkpoint ${checkpointId} expired`);
    }
    if (e.resolvedAt) throw new Error(`checkpoint ${checkpointId} already resolved`);
    return e;
  }

  async claim(checkpointId: string, actorId: string): Promise<CheckpointEntry> {
    const e = this.liveEntry(checkpointId);
    if (e.claimedBy && e.claimedBy !== actorId) {
      throw new Error(`checkpoint ${checkpointId} already claimed by another actor`);
    }
    e.claimedBy = actorId;
    this.publish("rpa.checkpoint.claimed", e);
    return { ...e };
  }

  async resolve(
    checkpointId: string,
    resolution: { mfaCode?: string; humanCompleted?: boolean }
  ): Promise<CheckpointEntry> {
    const e = this.liveEntry(checkpointId);
    if (e.checkpoint.kind === "MFA" && !resolution.mfaCode) {
      throw new Error("MFA checkpoint resolution requires an mfaCode");
    }
    e.resolvedAt = new Date(this.now()).toISOString();
    // Store only that a code was provided — never the code itself.
    e.resolution = {
      mfaCodeProvided: Boolean(resolution.mfaCode),
      humanCompleted: Boolean(resolution.humanCompleted),
    };
    this.publish("rpa.checkpoint.resolved", e);
    return { ...e };
  }

  async sweepExpired(nowMs?: number): Promise<number> {
    const now = nowMs ?? this.now();
    let n = 0;
    for (const e of this.entries.values()) {
      if (!e.resolvedAt && e.expiresAtMs <= now) {
        e.resolvedAt = new Date(now).toISOString();
        e.resolution = { mfaCodeProvided: false, humanCompleted: false };
        this.publish("rpa.checkpoint.expired", e);
        n++;
      }
    }
    return n;
  }
}
