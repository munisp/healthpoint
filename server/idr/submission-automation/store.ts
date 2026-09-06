/**
 * store.ts
 *
 * Persistence layer for the submission-automation FSM. The FSM entity is
 * server-authoritative: clients never round-trip the entity; they address a
 * submission by (tenantId, disputeId) and the store performs
 * load → guard → apply → compare-and-swap persist → append hash-chained event.
 *
 * - Optimistic locking: every submission carries a `version`; updates are
 *   conditional on the expected version. Conflict → VersionConflictError.
 * - Idempotency: createSubmission and persistedTransition accept an optional
 *   idempotencyKey; replays return the prior result without double-applying.
 * - Duplicate guard: at most one ACTIVE (non-WITHDRAWN, non-CLOSED)
 *   submission per (tenantId, disputeId). Second active create →
 *   DuplicateSubmissionError carrying the existing submission id.
 * - Tamper-evident event log: each event row stores
 *   eventHash = sha256_hex(prevEventHash || canonical(event)); verifyEventChain
 *   recomputes the chain and fails closed on any mismatch.
 *
 * InMemorySubmissionStore is for tests/dev. PostgresSubmissionStore uses the
 * house drizzle pattern (getDb from server/db.ts, tables in
 * drizzle/schema-submission-automation.ts). The db module is imported lazily
 * so that in-memory tests never pull in the database/env dependency graph.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, notInArray } from "drizzle-orm";
import {
  submissionAutomationSubmissions,
  submissionAutomationEvents,
  submissionAutomationIdempotency,
} from "../../../drizzle/schema-submission-automation";
import {
  SubmissionEntity,
  SubmissionEvent,
  SubmissionState,
  AttestationPayload,
  assertGuard,
  applyTransition,
} from "./submission-fsm";

// ─── Errors ──────────────────────────────────────────────────────────────────

export class VersionConflictError extends Error {
  constructor(
    public readonly submissionId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number
  ) {
    super(
      `Version conflict on submission ${submissionId}: expected version ${expectedVersion}, found ${actualVersion}`
    );
    this.name = "VersionConflictError";
  }
}

export class DuplicateSubmissionError extends Error {
  constructor(
    public readonly existingSubmissionId: string,
    tenantId: string,
    disputeId: string
  ) {
    super(
      `Active submission already exists for (tenantId=${tenantId}, disputeId=${disputeId}): ${existingSubmissionId}`
    );
    this.name = "DuplicateSubmissionError";
  }
}

export class SubmissionNotFoundError extends Error {
  constructor(tenantId: string, disputeId: string) {
    super(`No submission found for (tenantId=${tenantId}, disputeId=${disputeId})`);
    this.name = "SubmissionNotFoundError";
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StoredSubmission extends SubmissionEntity {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface ChainedEvent extends SubmissionEvent {
  submissionId: string;
  prevEventHash: string;
  eventHash: string;
}

export interface CreateSubmissionInput {
  tenantId: string;
  disputeId: string;
  idempotencyKey?: string;
  now?: Date;
}

export interface TransitionSubmissionInput {
  to: SubmissionState;
  actorId?: string;
  attestation?: AttestationPayload;
  cmsDisputeReferenceNumber?: string;
  detail?: string;
  idempotencyKey?: string;
  now?: Date;
}

export interface EventChainVerification {
  ok: boolean;
  eventCount: number;
  reason?: string;
}

const TERMINAL_STATES: SubmissionState[] = ["WITHDRAWN", "CLOSED"];
export const GENESIS_HASH = "0".repeat(64);

// ─── Hash chaining ───────────────────────────────────────────────────────────

/** Stable JSON with recursively sorted keys — canonical form for hashing. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function hashEvent(prevEventHash: string, event: SubmissionEvent): string {
  return createHash("sha256")
    .update(prevEventHash + canonicalJson(event))
    .digest("hex");
}

// ─── Store interface ─────────────────────────────────────────────────────────

export interface SubmissionStore {
  createSubmission(input: CreateSubmissionInput): Promise<StoredSubmission>;
  getSubmission(tenantId: string, disputeId: string, id?: string): Promise<StoredSubmission | null>;
  getActiveSubmission(tenantId: string, disputeId: string): Promise<StoredSubmission | null>;
  /**
   * Load → pure guard → apply → CAS persist → append chained event.
   * Replayed idempotencyKeys return the prior result without re-applying.
   */
  transitionSubmission(
    tenantId: string,
    disputeId: string,
    input: TransitionSubmissionInput
  ): Promise<StoredSubmission>;
  getEventLog(tenantId: string, disputeId: string): Promise<ChainedEvent[]>;
  verifyEventChain(tenantId: string, disputeId: string): Promise<EventChainVerification>;
}

// ─── In-memory implementation (tests / dev) ─────────────────────────────────

interface IdemRecord {
  operation: string;
  submissionId: string;
  resultJson: string;
}

export class InMemorySubmissionStore implements SubmissionStore {
  private submissions = new Map<string, StoredSubmission>();
  private events = new Map<string, ChainedEvent[]>();
  private idem = new Map<string, IdemRecord>();

  private idemKey(tenantId: string, disputeId: string, key: string): string {
    return `${tenantId} ${disputeId} ${key}`;
  }

  private clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v));
  }

  async createSubmission(input: CreateSubmissionInput): Promise<StoredSubmission> {
    if (input.idempotencyKey) {
      const prior = this.idem.get(this.idemKey(input.tenantId, input.disputeId, input.idempotencyKey));
      if (prior) return this.clone(JSON.parse(prior.resultJson));
    }
    const existing = await this.getActiveSubmission(input.tenantId, input.disputeId);
    if (existing) throw new DuplicateSubmissionError(existing.id, input.tenantId, input.disputeId);

    const at = (input.now ?? new Date()).toISOString();
    const id = `sub_${randomUUID()}`;
    const creationEvent: SubmissionEvent = {
      seq: 0,
      from: null,
      to: "DRAFT",
      at,
      detail: "submission created",
    };
    const chained: ChainedEvent = {
      ...creationEvent,
      submissionId: id,
      prevEventHash: GENESIS_HASH,
      eventHash: hashEvent(GENESIS_HASH, creationEvent),
    };
    const stored: StoredSubmission = {
      id,
      tenantId: input.tenantId,
      disputeId: input.disputeId,
      state: "DRAFT",
      version: 1,
      events: [creationEvent],
      createdAt: at,
      updatedAt: at,
    };
    this.submissions.set(id, stored);
    this.events.set(id, [chained]);
    if (input.idempotencyKey) {
      this.idem.set(this.idemKey(input.tenantId, input.disputeId, input.idempotencyKey), {
        operation: "create",
        submissionId: id,
        resultJson: JSON.stringify(stored),
      });
    }
    return this.clone(stored);
  }

  async getSubmission(tenantId: string, disputeId: string, id?: string): Promise<StoredSubmission | null> {
    for (const s of Array.from(this.submissions.values())) {
      if (s.tenantId === tenantId && s.disputeId === disputeId && (!id || s.id === id)) {
        return this.clone(s);
      }
    }
    return null;
  }

  async getActiveSubmission(tenantId: string, disputeId: string): Promise<StoredSubmission | null> {
    for (const s of Array.from(this.submissions.values())) {
      if (s.tenantId === tenantId && s.disputeId === disputeId && !TERMINAL_STATES.includes(s.state)) {
        return this.clone(s);
      }
    }
    return null;
  }

  /**
   * Optimistic-locking transition. `expectedVersion` is the version observed
   * at load; in the in-memory store the load-and-update are atomic, but the
   * CAS check is still performed so concurrent handles holding a stale copy
   * fail with VersionConflictError exactly as the Postgres store does.
   */
  async transitionSubmission(
    tenantId: string,
    disputeId: string,
    input: TransitionSubmissionInput
  ): Promise<StoredSubmission> {
    if (input.idempotencyKey) {
      const prior = this.idem.get(this.idemKey(tenantId, disputeId, input.idempotencyKey));
      if (prior) return this.clone(JSON.parse(prior.resultJson));
    }
    const current = await this.getActiveSubmission(tenantId, disputeId);
    if (!current) throw new SubmissionNotFoundError(tenantId, disputeId);
    const expectedVersion = current.version;

    const working = this.clone(current);
    // Pure guard + apply (fail-closed on invalid transitions).
    assertGuard(working, input.to);
    applyTransition(working, input.to, {
      actorId: input.actorId,
      now: input.now,
      attestation: input.attestation,
      cmsDisputeReferenceNumber: input.cmsDisputeReferenceNumber,
      detail: input.detail,
    });
    working.version = expectedVersion + 1;
    working.updatedAt = (input.now ?? new Date()).toISOString();
    if (TERMINAL_STATES.includes(working.state)) working.closedAt = working.updatedAt;

    // Compare-and-swap.
    const stored = this.submissions.get(current.id)!;
    if (stored.version !== expectedVersion) {
      throw new VersionConflictError(current.id, expectedVersion, stored.version);
    }
    this.submissions.set(current.id, this.clone(working));

    // Append chained event (the event just appended by applyTransition).
    const newEvent = working.events[working.events.length - 1];
    const chain = this.events.get(current.id)!;
    const prevEventHash = chain[chain.length - 1].eventHash;
    chain.push({
      ...newEvent,
      submissionId: current.id,
      prevEventHash,
      eventHash: hashEvent(prevEventHash, newEvent),
    });

    if (input.idempotencyKey) {
      this.idem.set(this.idemKey(tenantId, disputeId, input.idempotencyKey), {
        operation: "transition",
        submissionId: current.id,
        resultJson: JSON.stringify(working),
      });
    }
    return this.clone(working);
  }

  async getEventLog(tenantId: string, disputeId: string): Promise<ChainedEvent[]> {
    const s = await this.getSubmission(tenantId, disputeId);
    if (!s) return [];
    return this.clone(this.events.get(s.id) ?? []);
  }

  async verifyEventChain(tenantId: string, disputeId: string): Promise<EventChainVerification> {
    const chain = await this.getEventLog(tenantId, disputeId);
    return verifyChain(chain);
  }
}

/** Recompute the hash chain; fail closed on any mismatch. */
export function verifyChain(chain: ChainedEvent[]): EventChainVerification {
  let prev = GENESIS_HASH;
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i];
    if (e.seq !== i) {
      return { ok: false, eventCount: chain.length, reason: `seq gap at index ${i}: expected ${i}, found ${e.seq}` };
    }
    if (e.prevEventHash !== prev) {
      return { ok: false, eventCount: chain.length, reason: `prevEventHash mismatch at seq ${e.seq}` };
    }
    const recomputed = hashEvent(prev, {
      seq: e.seq,
      from: e.from,
      to: e.to,
      at: e.at,
      actorId: e.actorId,
      detail: e.detail,
    });
    if (recomputed !== e.eventHash) {
      return { ok: false, eventCount: chain.length, reason: `eventHash mismatch at seq ${e.seq} (tampering suspected)` };
    }
    prev = e.eventHash;
  }
  return { ok: true, eventCount: chain.length };
}

// ─── Postgres implementation (drizzle, house pattern) ────────────────────────

function rowToStored(
  row: typeof submissionAutomationSubmissions.$inferSelect,
  events: SubmissionEvent[]
): StoredSubmission {
  return {
    id: row.id,
    tenantId: row.tenantId,
    disputeId: row.disputeId,
    state: row.state as SubmissionState,
    version: row.version,
    events,
    cmsDisputeReferenceNumber: row.cmsDisputeReferenceNumber ?? undefined,
    attestation: (row.attestation as AttestationPayload | null) ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : undefined,
  };
}

export class PostgresSubmissionStore implements SubmissionStore {
  private async db() {
    const mod = await import("../../db");
    const db = await mod.getDb();
    if (!db) throw new Error("Database not available");
    return db;
  }

  private async loadEvents(submissionId: string): Promise<ChainedEvent[]> {
    const db = await this.db();
    const rows = await db
      .select()
      .from(submissionAutomationEvents)
      .where(eq(submissionAutomationEvents.submissionId, submissionId))
      .orderBy(asc(submissionAutomationEvents.seq));
    return rows.map((r) => ({
      submissionId: r.submissionId,
      seq: r.seq,
      from: (r.fromState as SubmissionState | null) ?? null,
      to: r.toState as SubmissionState,
      at: r.at.toISOString(),
      actorId: r.actorId ?? undefined,
      detail: r.detail ?? undefined,
      prevEventHash: r.prevEventHash,
      eventHash: r.eventHash,
    }));
  }

  private async loadRow(
    tenantId: string,
    disputeId: string,
    id?: string
  ): Promise<typeof submissionAutomationSubmissions.$inferSelect | null> {
    const db = await this.db();
    const conds = [
      eq(submissionAutomationSubmissions.tenantId, tenantId),
      eq(submissionAutomationSubmissions.disputeId, disputeId),
    ];
    if (id) conds.push(eq(submissionAutomationSubmissions.id, id));
    const rows = await db
      .select()
      .from(submissionAutomationSubmissions)
      .where(and(...conds))
      .limit(1);
    return rows[0] ?? null;
  }

  async createSubmission(input: CreateSubmissionInput): Promise<StoredSubmission> {
    const db = await this.db();
    if (input.idempotencyKey) {
      const prior = await db
        .select()
        .from(submissionAutomationIdempotency)
        .where(
          and(
            eq(submissionAutomationIdempotency.tenantId, input.tenantId),
            eq(submissionAutomationIdempotency.disputeId, input.disputeId),
            eq(submissionAutomationIdempotency.idempotencyKey, input.idempotencyKey)
          )
        )
        .limit(1);
      if (prior[0]) return JSON.parse(prior[0].resultJson) as StoredSubmission;
    }
    const existing = await this.getActiveSubmission(input.tenantId, input.disputeId);
    if (existing) throw new DuplicateSubmissionError(existing.id, input.tenantId, input.disputeId);

    const at = input.now ?? new Date();
    const id = `sub_${randomUUID()}`;
    const creationEvent: SubmissionEvent = {
      seq: 0,
      from: null,
      to: "DRAFT",
      at: at.toISOString(),
      detail: "submission created",
    };
    await db.insert(submissionAutomationSubmissions).values({
      id,
      tenantId: input.tenantId,
      disputeId: input.disputeId,
      state: "DRAFT",
      version: 1,
      createdAt: at,
      updatedAt: at,
    });
    await db.insert(submissionAutomationEvents).values({
      id: `ev_${randomUUID()}`,
      submissionId: id,
      tenantId: input.tenantId,
      disputeId: input.disputeId,
      seq: 0,
      fromState: null,
      toState: "DRAFT",
      at,
      detail: "submission created",
      prevEventHash: GENESIS_HASH,
      eventHash: hashEvent(GENESIS_HASH, creationEvent),
    });
    const events = await this.loadEvents(id);
    const stored = rowToStored((await this.loadRow(input.tenantId, input.disputeId, id))!, events);
    if (input.idempotencyKey) {
      await db.insert(submissionAutomationIdempotency).values({
        id: `idem_${randomUUID()}`,
        tenantId: input.tenantId,
        disputeId: input.disputeId,
        idempotencyKey: input.idempotencyKey,
        operation: "create",
        submissionId: id,
        resultJson: JSON.stringify(stored),
      });
    }
    return stored;
  }

  async getSubmission(tenantId: string, disputeId: string, id?: string): Promise<StoredSubmission | null> {
    const row = await this.loadRow(tenantId, disputeId, id);
    if (!row) return null;
    const events = await this.loadEvents(row.id);
    return rowToStored(row, events);
  }

  async getActiveSubmission(tenantId: string, disputeId: string): Promise<StoredSubmission | null> {
    const db = await this.db();
    const rows = await db
      .select()
      .from(submissionAutomationSubmissions)
      .where(
        and(
          eq(submissionAutomationSubmissions.tenantId, tenantId),
          eq(submissionAutomationSubmissions.disputeId, disputeId),
          notInArray(submissionAutomationSubmissions.state, TERMINAL_STATES)
        )
      )
      .limit(1);
    if (!rows[0]) return null;
    const events = await this.loadEvents(rows[0].id);
    return rowToStored(rows[0], events);
  }

  async transitionSubmission(
    tenantId: string,
    disputeId: string,
    input: TransitionSubmissionInput
  ): Promise<StoredSubmission> {
    const db = await this.db();
    if (input.idempotencyKey) {
      const prior = await db
        .select()
        .from(submissionAutomationIdempotency)
        .where(
          and(
            eq(submissionAutomationIdempotency.tenantId, tenantId),
            eq(submissionAutomationIdempotency.disputeId, disputeId),
            eq(submissionAutomationIdempotency.idempotencyKey, input.idempotencyKey)
          )
        )
        .limit(1);
      if (prior[0]) return JSON.parse(prior[0].resultJson) as StoredSubmission;
    }

    const row = (
      await db
        .select()
        .from(submissionAutomationSubmissions)
        .where(
          and(
            eq(submissionAutomationSubmissions.tenantId, tenantId),
            eq(submissionAutomationSubmissions.disputeId, disputeId),
            notInArray(submissionAutomationSubmissions.state, TERMINAL_STATES)
          )
        )
        .limit(1)
    )[0];
    if (!row) throw new SubmissionNotFoundError(tenantId, disputeId);
    const expectedVersion = row.version;

    const events = await this.loadEvents(row.id);
    const working = rowToStored(row, events);
    assertGuard(working, input.to);
    const at = input.now ?? new Date();
    applyTransition(working, input.to, {
      actorId: input.actorId,
      now: at,
      attestation: input.attestation,
      cmsDisputeReferenceNumber: input.cmsDisputeReferenceNumber,
      detail: input.detail,
    });

    // Compare-and-swap: conditional update on the expected version.
    const updated = await db
      .update(submissionAutomationSubmissions)
      .set({
        state: working.state,
        version: expectedVersion + 1,
        cmsDisputeReferenceNumber: working.cmsDisputeReferenceNumber ?? row.cmsDisputeReferenceNumber,
        attestation: (working.attestation as object | undefined) ?? row.attestation,
        updatedAt: at,
        closedAt: TERMINAL_STATES.includes(working.state) ? at : row.closedAt,
      })
      .where(
        and(
          eq(submissionAutomationSubmissions.id, row.id),
          eq(submissionAutomationSubmissions.version, expectedVersion)
        )
      )
      .returning({ id: submissionAutomationSubmissions.id });
    if (updated.length === 0) {
      const current = await this.loadRow(tenantId, disputeId, row.id);
      throw new VersionConflictError(row.id, expectedVersion, current?.version ?? -1);
    }

    const newEvent = working.events[working.events.length - 1];
    const prevEventHash = events.length > 0 ? events[events.length - 1].eventHash : GENESIS_HASH;
    await db.insert(submissionAutomationEvents).values({
      id: `ev_${randomUUID()}`,
      submissionId: row.id,
      tenantId,
      disputeId,
      seq: newEvent.seq,
      fromState: newEvent.from,
      toState: newEvent.to,
      at: new Date(newEvent.at),
      actorId: newEvent.actorId ?? null,
      detail: newEvent.detail ?? null,
      prevEventHash,
      eventHash: hashEvent(prevEventHash, newEvent),
    });

    working.version = expectedVersion + 1;
    working.updatedAt = at.toISOString();
    if (input.idempotencyKey) {
      await db.insert(submissionAutomationIdempotency).values({
        id: `idem_${randomUUID()}`,
        tenantId,
        disputeId,
        idempotencyKey: input.idempotencyKey,
        operation: "transition",
        submissionId: row.id,
        resultJson: JSON.stringify(working),
      });
    }
    return working;
  }

  async getEventLog(tenantId: string, disputeId: string): Promise<ChainedEvent[]> {
    const row = await this.loadRow(tenantId, disputeId);
    if (!row) return [];
    return this.loadEvents(row.id);
  }

  async verifyEventChain(tenantId: string, disputeId: string): Promise<EventChainVerification> {
    const chain = await this.getEventLog(tenantId, disputeId);
    return verifyChain(chain);
  }
}

// ─── Singleton accessor (routes inject the store; tests override) ───────────

let _store: SubmissionStore | null = null;

export function getSubmissionStore(): SubmissionStore {
  if (!_store) _store = new PostgresSubmissionStore();
  return _store;
}

/** Test hook: install an InMemorySubmissionStore (or a spy). */
export function setSubmissionStoreForTests(store: SubmissionStore | null): void {
  _store = store;
}
