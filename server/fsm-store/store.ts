/**
 * server/fsm-store/store.ts
 *
 * Generic persisted FSM case store. Makes the per-module lifecycle FSMs
 * (notice-consent, priorauth, gfe-ppdr) SERVER-AUTHORITATIVE: clients address
 * a case by (tenantId, caseType, caseId) and never round-trip case state. The
 * store performs load → guard/apply (the owning module's pure transition
 * function, supplied by the caller) → compare-and-swap persist → append
 * hash-chained event. Mirrors the submission-automation pattern
 * (server/idr/submission-automation/store.ts).
 *
 * - Optimistic locking: every case carries a `version`; updates are
 *   conditional on the expected version. Conflict → FsmVersionConflictError.
 * - Idempotency: createCase/transitionCase accept an optional idempotencyKey;
 *   replays return the prior result without double-applying.
 * - Uniqueness: at most one case per (tenantId, caseType, caseId); a second
 *   create → FsmDuplicateCaseError.
 * - Tamper-evident event log: each event row stores
 *   eventHash = sha256_hex(prevEventHash || canonical(event));
 *   verifyEventChain recomputes the chain and fails closed on any mismatch.
 *
 * InMemoryFsmCaseStore is for tests/dev. PostgresFsmCaseStore uses the house
 * drizzle pattern (lazy getDb from server/db.ts, tables in
 * drizzle/schema-fsm-cases.ts) so in-memory tests never pull in the
 * database/env dependency graph.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  fsmCases,
  fsmCaseEvents,
  fsmCaseIdempotency,
} from "../../drizzle/schema-fsm-cases";

// ─── Errors ──────────────────────────────────────────────────────────────────

export class FsmVersionConflictError extends Error {
  constructor(
    public readonly caseRowId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number
  ) {
    super(
      `Version conflict on FSM case ${caseRowId}: expected version ${expectedVersion}, found ${actualVersion}`
    );
    this.name = "FsmVersionConflictError";
  }
}

export class FsmDuplicateCaseError extends Error {
  constructor(
    public readonly existingRowId: string,
    tenantId: string,
    caseType: string,
    caseId: string
  ) {
    super(
      `FSM case already exists for (tenantId=${tenantId}, caseType=${caseType}, caseId=${caseId}): ${existingRowId}`
    );
    this.name = "FsmDuplicateCaseError";
  }
}

export class FsmCaseNotFoundError extends Error {
  constructor(tenantId: string, caseType: string, caseId: string) {
    super(`No FSM case found for (tenantId=${tenantId}, caseType=${caseType}, caseId=${caseId})`);
    this.name = "FsmCaseNotFoundError";
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** Minimal shape every persisted FSM case must satisfy. */
export interface FsmCaseLike {
  id: string;
  state: string;
  events: readonly FsmEventLike[];
}

export interface FsmEventLike {
  type?: string;
  at: Date | string;
  from?: string;
  to?: string;
  detail?: string;
}

export interface FsmStoredCase<T extends FsmCaseLike = FsmCaseLike> {
  /** Store row id (internal). */
  rowId: string;
  tenantId: string;
  caseType: string;
  caseId: string;
  state: string;
  version: number;
  /** Parsed module-specific case object (server-authoritative). */
  data: T;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface FsmChainedEvent {
  caseRowId: string;
  seq: number;
  eventType: string | null;
  fromState: string | null;
  toState: string | null;
  at: string;
  detail: string | null;
  /** Canonical JSON of the module-specific event (hash input). */
  eventJson: string;
  prevEventHash: string;
  eventHash: string;
}

export interface CreateFsmCaseInput<T extends FsmCaseLike> {
  tenantId: string;
  caseType: string;
  caseId: string;
  /** Owning module's pure factory (e.g. createNoticeConsentCase). */
  create: () => T;
  /** States considered terminal; sets closedAt when reached. */
  terminalStates?: readonly string[];
  idempotencyKey?: string;
  now?: Date;
}

export interface TransitionFsmCaseInput<T extends FsmCaseLike> {
  /**
   * Owning module's pure guard+apply (e.g. notice-consent fsm.transition).
   * Receives the SERVER-LOADED case (never client-supplied state) and returns
   * the next case with events appended. Must throw on guard rejection.
   */
  apply: (current: T) => T;
  terminalStates?: readonly string[];
  idempotencyKey?: string;
  now?: Date;
}

export interface FsmEventChainVerification {
  ok: boolean;
  eventCount: number;
  reason?: string;
}

export const FSM_GENESIS_HASH = "0".repeat(64);

// ─── Hash chaining ───────────────────────────────────────────────────────────

/** Stable JSON with recursively sorted keys — canonical form for hashing. */
export function fsmCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(fsmCanonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${fsmCanonicalJson(obj[k])}`).join(",")}}`;
}

/** Canonical JSON for an event; Dates serialize to ISO strings. */
export function canonicalEventJson(event: FsmEventLike): string {
  const normalized: Record<string, unknown> = { ...event };
  if (normalized.at instanceof Date) normalized.at = normalized.at.toISOString();
  return fsmCanonicalJson(normalized);
}

export function hashFsmEvent(prevEventHash: string, canonicalEventJsonStr: string): string {
  return createHash("sha256").update(prevEventHash + canonicalEventJsonStr).digest("hex");
}

// ─── Store interface ─────────────────────────────────────────────────────────

export interface FsmCaseStore {
  createCase<T extends FsmCaseLike>(input: CreateFsmCaseInput<T>): Promise<FsmStoredCase<T>>;
  getCase<T extends FsmCaseLike = FsmCaseLike>(
    tenantId: string,
    caseType: string,
    caseId: string
  ): Promise<FsmStoredCase<T> | null>;
  /**
   * Load → caller-supplied pure guard/apply → CAS persist → append chained
   * events. Replayed idempotencyKeys return the prior result without
   * re-applying.
   */
  transitionCase<T extends FsmCaseLike>(
    tenantId: string,
    caseType: string,
    caseId: string,
    input: TransitionFsmCaseInput<T>
  ): Promise<FsmStoredCase<T>>;
  getEventLog(tenantId: string, caseType: string, caseId: string): Promise<FsmChainedEvent[]>;
  verifyEventChain(
    tenantId: string,
    caseType: string,
    caseId: string
  ): Promise<FsmEventChainVerification>;
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

function toChainedEvent(
  caseRowId: string,
  seq: number,
  event: FsmEventLike,
  prevEventHash: string
): FsmChainedEvent {
  const eventJson = canonicalEventJson(event);
  const at =
    event.at instanceof Date
      ? event.at.toISOString()
      : new Date(event.at).toISOString();
  return {
    caseRowId,
    seq,
    eventType: event.type ?? null,
    fromState: event.from ?? null,
    toState: event.to ?? null,
    at,
    detail: event.detail ?? null,
    eventJson,
    prevEventHash,
    eventHash: hashFsmEvent(prevEventHash, eventJson),
  };
}

/** Recompute the hash chain; fail closed on any mismatch. */
export function verifyFsmChain(chain: FsmChainedEvent[]): FsmEventChainVerification {
  let prev = FSM_GENESIS_HASH;
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i];
    if (e.seq !== i) {
      return { ok: false, eventCount: chain.length, reason: `seq gap at index ${i}: expected ${i}, found ${e.seq}` };
    }
    if (e.prevEventHash !== prev) {
      return { ok: false, eventCount: chain.length, reason: `prevEventHash mismatch at seq ${e.seq}` };
    }
    const recomputed = hashFsmEvent(prev, e.eventJson);
    if (recomputed !== e.eventHash) {
      return { ok: false, eventCount: chain.length, reason: `eventHash mismatch at seq ${e.seq} (tampering suspected)` };
    }
    prev = e.eventHash;
  }
  return { ok: true, eventCount: chain.length };
}

// ─── In-memory implementation (tests / dev) ─────────────────────────────────

interface FsmIdemRecord {
  operation: string;
  resultJson: string;
}

interface MemoryRow {
  rowId: string;
  tenantId: string;
  caseType: string;
  caseId: string;
  state: string;
  version: number;
  caseJson: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export class InMemoryFsmCaseStore implements FsmCaseStore {
  private rows = new Map<string, MemoryRow>();
  private events = new Map<string, FsmChainedEvent[]>();
  private idem = new Map<string, FsmIdemRecord>();

  private key(tenantId: string, caseType: string, caseId: string): string {
    return JSON.stringify([tenantId, caseType, caseId]);
  }

  private idemKey(tenantId: string, caseType: string, caseId: string, key: string): string {
    return JSON.stringify([tenantId, caseType, caseId, key]);
  }

  private clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v));
  }

  private rowToStored<T extends FsmCaseLike>(row: MemoryRow): FsmStoredCase<T> {
    return {
      rowId: row.rowId,
      tenantId: row.tenantId,
      caseType: row.caseType,
      caseId: row.caseId,
      state: row.state,
      version: row.version,
      data: JSON.parse(row.caseJson) as T,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      closedAt: row.closedAt,
    };
  }

  async createCase<T extends FsmCaseLike>(input: CreateFsmCaseInput<T>): Promise<FsmStoredCase<T>> {
    const key = this.key(input.tenantId, input.caseType, input.caseId);
    if (input.idempotencyKey) {
      const prior = this.idem.get(this.idemKey(input.tenantId, input.caseType, input.caseId, input.idempotencyKey));
      if (prior) return this.clone(JSON.parse(prior.resultJson));
    }
    const existing = this.rows.get(key);
    if (existing) {
      throw new FsmDuplicateCaseError(existing.rowId, input.tenantId, input.caseType, input.caseId);
    }

    const created = input.create();
    if (created.id !== input.caseId) {
      throw new Error(`FSM factory produced id '${created.id}' but caseId is '${input.caseId}'`);
    }
    const at = (input.now ?? new Date()).toISOString();
    const row: MemoryRow = {
      rowId: `fsm_${randomUUID()}`,
      tenantId: input.tenantId,
      caseType: input.caseType,
      caseId: input.caseId,
      state: created.state,
      version: 1,
      caseJson: JSON.stringify(created),
      createdAt: at,
      updatedAt: at,
      closedAt: input.terminalStates?.includes(created.state) ? at : undefined,
    };
    this.rows.set(key, row);
    // Chain any events the factory emitted (usually none).
    const chain: FsmChainedEvent[] = [];
    let prev = FSM_GENESIS_HASH;
    created.events.forEach((e, i) => {
      const chained = toChainedEvent(row.rowId, i, e, prev);
      chain.push(chained);
      prev = chained.eventHash;
    });
    this.events.set(row.rowId, chain);

    const stored = this.rowToStored<T>(row);
    if (input.idempotencyKey) {
      this.idem.set(this.idemKey(input.tenantId, input.caseType, input.caseId, input.idempotencyKey), {
        operation: "create",
        resultJson: JSON.stringify(stored),
      });
    }
    return this.clone(stored);
  }

  async getCase<T extends FsmCaseLike = FsmCaseLike>(
    tenantId: string,
    caseType: string,
    caseId: string
  ): Promise<FsmStoredCase<T> | null> {
    const row = this.rows.get(this.key(tenantId, caseType, caseId));
    if (!row) return null;
    return this.rowToStored<T>(this.clone(row));
  }

  /**
   * Optimistic-locking transition. The in-memory load-and-update is atomic,
   * but the CAS check is still performed so concurrent handles holding a stale
   * copy fail with FsmVersionConflictError exactly as the Postgres store does.
   */
  async transitionCase<T extends FsmCaseLike>(
    tenantId: string,
    caseType: string,
    caseId: string,
    input: TransitionFsmCaseInput<T>
  ): Promise<FsmStoredCase<T>> {
    if (input.idempotencyKey) {
      const prior = this.idem.get(this.idemKey(tenantId, caseType, caseId, input.idempotencyKey));
      if (prior) return this.clone(JSON.parse(prior.resultJson));
    }
    const row = this.rows.get(this.key(tenantId, caseType, caseId));
    if (!row) throw new FsmCaseNotFoundError(tenantId, caseType, caseId);
    const expectedVersion = row.version;

    // Load the SERVER-SIDE case (client state is never consulted).
    const current = JSON.parse(row.caseJson) as T;
    // Pure guard + apply (fail-closed on invalid transitions).
    const next = input.apply(current);
    if (next.events.length < current.events.length) {
      throw new Error("FSM apply must be append-only: events shrank");
    }
    const newEvents = next.events.slice(current.events.length);

    const at = (input.now ?? new Date()).toISOString();
    // Compare-and-swap.
    if (row.version !== expectedVersion) {
      throw new FsmVersionConflictError(row.rowId, expectedVersion, row.version);
    }
    row.state = next.state;
    row.version = expectedVersion + 1;
    row.caseJson = JSON.stringify(next);
    row.updatedAt = at;
    if (input.terminalStates?.includes(next.state)) row.closedAt = at;

    // Append chained events.
    const chain = this.events.get(row.rowId)!;
    let prev = chain.length > 0 ? chain[chain.length - 1].eventHash : FSM_GENESIS_HASH;
    newEvents.forEach((e) => {
      const chained = toChainedEvent(row.rowId, chain.length, e, prev);
      chain.push(chained);
      prev = chained.eventHash;
    });

    const stored = this.rowToStored<T>(row);
    if (input.idempotencyKey) {
      this.idem.set(this.idemKey(tenantId, caseType, caseId, input.idempotencyKey), {
        operation: "transition",
        resultJson: JSON.stringify(stored),
      });
    }
    return this.clone(stored);
  }

  async getEventLog(tenantId: string, caseType: string, caseId: string): Promise<FsmChainedEvent[]> {
    const row = this.rows.get(this.key(tenantId, caseType, caseId));
    if (!row) return [];
    return this.clone(this.events.get(row.rowId) ?? []);
  }

  async verifyEventChain(
    tenantId: string,
    caseType: string,
    caseId: string
  ): Promise<FsmEventChainVerification> {
    return verifyFsmChain(await this.getEventLog(tenantId, caseType, caseId));
  }
}

// ─── Postgres implementation (drizzle, house pattern) ────────────────────────

function pgRowToStored<T extends FsmCaseLike>(row: typeof fsmCases.$inferSelect): FsmStoredCase<T> {
  return {
    rowId: row.id,
    tenantId: row.tenantId,
    caseType: row.caseType,
    caseId: row.caseId,
    state: row.state,
    version: row.version,
    data: row.caseJson as T,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : undefined,
  };
}

export class PostgresFsmCaseStore implements FsmCaseStore {
  private async db() {
    const mod = await import("../db");
    const db = await mod.getDb();
    if (!db) throw new Error("Database not available");
    return db;
  }

  private async loadRow(tenantId: string, caseType: string, caseId: string) {
    const db = await this.db();
    const rows = await db
      .select()
      .from(fsmCases)
      .where(
        and(
          eq(fsmCases.tenantId, tenantId),
          eq(fsmCases.caseType, caseType),
          eq(fsmCases.caseId, caseId)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async loadEvents(caseRowId: string): Promise<FsmChainedEvent[]> {
    const db = await this.db();
    const rows = await db
      .select()
      .from(fsmCaseEvents)
      .where(eq(fsmCaseEvents.caseRowId, caseRowId))
      .orderBy(asc(fsmCaseEvents.seq));
    return rows.map((r) => ({
      caseRowId: r.caseRowId,
      seq: r.seq,
      eventType: r.eventType ?? null,
      fromState: r.fromState ?? null,
      toState: r.toState ?? null,
      at: r.at.toISOString(),
      detail: r.detail ?? null,
      eventJson: r.eventJson,
      prevEventHash: r.prevEventHash,
      eventHash: r.eventHash,
    }));
  }

  private async lookupIdem(tenantId: string, caseType: string, caseId: string, key: string) {
    const db = await this.db();
    const rows = await db
      .select()
      .from(fsmCaseIdempotency)
      .where(
        and(
          eq(fsmCaseIdempotency.tenantId, tenantId),
          eq(fsmCaseIdempotency.caseType, caseType),
          eq(fsmCaseIdempotency.caseId, caseId),
          eq(fsmCaseIdempotency.idempotencyKey, key)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async saveIdem(
    tenantId: string,
    caseType: string,
    caseId: string,
    key: string,
    operation: string,
    result: unknown
  ) {
    const db = await this.db();
    await db.insert(fsmCaseIdempotency).values({
      id: `idem_${randomUUID()}`,
      tenantId,
      caseType,
      caseId,
      idempotencyKey: key,
      operation,
      resultJson: JSON.stringify(result),
    });
  }

  async createCase<T extends FsmCaseLike>(input: CreateFsmCaseInput<T>): Promise<FsmStoredCase<T>> {
    const db = await this.db();
    if (input.idempotencyKey) {
      const prior = await this.lookupIdem(input.tenantId, input.caseType, input.caseId, input.idempotencyKey);
      if (prior) return JSON.parse(prior.resultJson) as FsmStoredCase<T>;
    }
    const existing = await this.loadRow(input.tenantId, input.caseType, input.caseId);
    if (existing) {
      throw new FsmDuplicateCaseError(existing.id, input.tenantId, input.caseType, input.caseId);
    }

    const created = input.create();
    if (created.id !== input.caseId) {
      throw new Error(`FSM factory produced id '${created.id}' but caseId is '${input.caseId}'`);
    }
    const at = input.now ?? new Date();
    const rowId = `fsm_${randomUUID()}`;
    await db.insert(fsmCases).values({
      id: rowId,
      tenantId: input.tenantId,
      caseType: input.caseType,
      caseId: input.caseId,
      state: created.state,
      version: 1,
      caseJson: created as object,
      createdAt: at,
      updatedAt: at,
      closedAt: input.terminalStates?.includes(created.state) ? at : null,
    });
    let prev = FSM_GENESIS_HASH;
    for (let i = 0; i < created.events.length; i++) {
      const chained = toChainedEvent(rowId, i, created.events[i], prev);
      await db.insert(fsmCaseEvents).values({
        id: `ev_${randomUUID()}`,
        caseRowId: rowId,
        tenantId: input.tenantId,
        caseType: input.caseType,
        caseId: input.caseId,
        seq: chained.seq,
        eventType: chained.eventType,
        fromState: chained.fromState,
        toState: chained.toState,
        at: new Date(chained.at),
        detail: chained.detail,
        eventJson: chained.eventJson,
        prevEventHash: chained.prevEventHash,
        eventHash: chained.eventHash,
      });
      prev = chained.eventHash;
    }
    const stored = pgRowToStored<T>((await this.loadRow(input.tenantId, input.caseType, input.caseId))!);
    if (input.idempotencyKey) {
      await this.saveIdem(input.tenantId, input.caseType, input.caseId, input.idempotencyKey, "create", stored);
    }
    return stored;
  }

  async getCase<T extends FsmCaseLike = FsmCaseLike>(
    tenantId: string,
    caseType: string,
    caseId: string
  ): Promise<FsmStoredCase<T> | null> {
    const row = await this.loadRow(tenantId, caseType, caseId);
    if (!row) return null;
    return pgRowToStored<T>(row);
  }

  async transitionCase<T extends FsmCaseLike>(
    tenantId: string,
    caseType: string,
    caseId: string,
    input: TransitionFsmCaseInput<T>
  ): Promise<FsmStoredCase<T>> {
    const db = await this.db();
    if (input.idempotencyKey) {
      const prior = await this.lookupIdem(tenantId, caseType, caseId, input.idempotencyKey);
      if (prior) return JSON.parse(prior.resultJson) as FsmStoredCase<T>;
    }

    const row = await this.loadRow(tenantId, caseType, caseId);
    if (!row) throw new FsmCaseNotFoundError(tenantId, caseType, caseId);
    const expectedVersion = row.version;

    // Load the SERVER-SIDE case (client state is never consulted).
    const current = row.caseJson as T;
    // Pure guard + apply (fail-closed on invalid transitions).
    const next = input.apply(current);
    if (next.events.length < current.events.length) {
      throw new Error("FSM apply must be append-only: events shrank");
    }
    const newEvents = next.events.slice(current.events.length);

    const at = input.now ?? new Date();
    // Compare-and-swap: conditional update on the expected version.
    const updated = await db
      .update(fsmCases)
      .set({
        state: next.state,
        version: expectedVersion + 1,
        caseJson: next as object,
        updatedAt: at,
        closedAt: input.terminalStates?.includes(next.state) ? at : row.closedAt,
      })
      .where(and(eq(fsmCases.id, row.id), eq(fsmCases.version, expectedVersion)))
      .returning({ id: fsmCases.id });
    if (updated.length === 0) {
      const currentRow = await this.loadRow(tenantId, caseType, caseId);
      throw new FsmVersionConflictError(row.id, expectedVersion, currentRow?.version ?? -1);
    }

    const events = await this.loadEvents(row.id);
    let prev = events.length > 0 ? events[events.length - 1].eventHash : FSM_GENESIS_HASH;
    let seq = events.length;
    for (const e of newEvents) {
      const chained = toChainedEvent(row.id, seq, e, prev);
      await db.insert(fsmCaseEvents).values({
        id: `ev_${randomUUID()}`,
        caseRowId: row.id,
        tenantId,
        caseType,
        caseId,
        seq: chained.seq,
        eventType: chained.eventType,
        fromState: chained.fromState,
        toState: chained.toState,
        at: new Date(chained.at),
        detail: chained.detail,
        eventJson: chained.eventJson,
        prevEventHash: chained.prevEventHash,
        eventHash: chained.eventHash,
      });
      prev = chained.eventHash;
      seq += 1;
    }

    const stored: FsmStoredCase<T> = {
      ...pgRowToStored<T>(row),
      state: next.state,
      version: expectedVersion + 1,
      data: next,
      updatedAt: at.toISOString(),
      closedAt: input.terminalStates?.includes(next.state)
        ? at.toISOString()
        : row.closedAt
          ? row.closedAt.toISOString()
          : undefined,
    };
    if (input.idempotencyKey) {
      await this.saveIdem(tenantId, caseType, caseId, input.idempotencyKey, "transition", stored);
    }
    return stored;
  }

  async getEventLog(tenantId: string, caseType: string, caseId: string): Promise<FsmChainedEvent[]> {
    const row = await this.loadRow(tenantId, caseType, caseId);
    if (!row) return [];
    return this.loadEvents(row.id);
  }

  async verifyEventChain(
    tenantId: string,
    caseType: string,
    caseId: string
  ): Promise<FsmEventChainVerification> {
    return verifyFsmChain(await this.getEventLog(tenantId, caseType, caseId));
  }
}

// ─── Singleton accessor (routes inject the store; tests override) ───────────

let _store: FsmCaseStore | null = null;

export function getFsmCaseStore(): FsmCaseStore {
  if (!_store) _store = new PostgresFsmCaseStore();
  return _store;
}

/** Test hook: install an InMemoryFsmCaseStore (or a spy). */
export function setFsmCaseStoreForTests(store: FsmCaseStore | null): void {
  _store = store;
}
