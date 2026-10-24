/**
 * server/tigerbeetle-ledger.ts
 * Client for the Go TigerBeetle sidecar (services/go), which is the
 * authoritative internal ledger for funds movement. PostgreSQL ledger tables
 * remain the operational record the UI reads; TigerBeetle is the authoritative
 * double-entry store that the reconciliation job (server/reconciliation.ts)
 * compares against.
 *
 * Fail-closed contract:
 *   - TB_LEDGER_ENABLED=true turns the integration on (default: false/off).
 *   - TB_LEDGER_REQUIRED=true makes TigerBeetle part of the critical path:
 *     when the sidecar is unreachable the caller's operation aborts BEFORE any
 *     Postgres state is written. When false (default), a degraded run logs a
 *     warning and emits a durable `ledger.degraded` outbox event while the
 *     Postgres operation proceeds (drift is caught by reconciliation).
 *   - Business-rule conflicts (HTTP 409 from the sidecar — e.g. posting a
 *     voided hold) ALWAYS throw, regardless of TB_LEDGER_REQUIRED.
 *
 * Idempotency:
 *   - TigerBeetle account IDs are derived deterministically from the dispute ID
 *     and account role, so account creation is idempotent by external ID.
 *   - TigerBeetle transfer IDs are derived from the platform outbox event
 *     idempotency key, so a retried submission maps to the same 128-bit
 *     transfer ID and TigerBeetle deduplicates it (TransferExists).
 */

import { createHash } from "crypto";
import { eventLog } from "../drizzle/schema";
import { getDb } from "./db";

/** TigerBeetle ledger partition. 1 = USD cents, the platform's only currency. */
export const TB_LEDGER_USD_CENTS = 1;
/** Transfer code for settlement holds/posts and one-shot committed settlements. */
export const TB_CODE_SETTLEMENT = 7200;
/** Transfer code for compensating reversals of posted settlements. */
export const TB_CODE_SETTLEMENT_REVERSAL = 7201;
/** Account code for per-dispute payer/provider mirror accounts. */
export const TB_CODE_SETTLEMENT_ACCOUNT = 720;

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;

export type TigerBeetleLedgerConfig = {
  enabled: boolean;
  required: boolean;
  baseUrl: string;
  internalToken: string;
  timeoutMs: number;
  /** Pending-hold timeout in seconds; 0 = hold never expires (operator-controlled). */
  pendingHoldTimeoutSeconds: number;
};

export function getTigerBeetleLedgerConfig(): TigerBeetleLedgerConfig {
  const rawTimeout = Number(process.env.TB_LEDGER_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return {
    enabled: process.env.TB_LEDGER_ENABLED === "true",
    required: process.env.TB_LEDGER_REQUIRED === "true",
    baseUrl: (process.env.GO_SERVICES_URL?.trim() || "http://localhost:8001").replace(/\/+$/, ""),
    internalToken: process.env.INTERNAL_SERVICE_TOKEN ?? "",
    timeoutMs: Number.isFinite(rawTimeout) && rawTimeout > 0 ? Math.min(rawTimeout, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
    pendingHoldTimeoutSeconds: Math.max(0, Number(process.env.TB_LEDGER_PENDING_HOLD_TIMEOUT_SECONDS ?? 0) || 0),
  };
}

export class TigerBeetleLedgerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TigerBeetleLedgerUnavailableError";
  }
}

/** Non-retryable business-rule conflict reported by the ledger (HTTP 400/409). */
export class TigerBeetleLedgerConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TigerBeetleLedgerConflictError";
  }
}

export type TigerBeetleAccountRole = "payer_clearing" | "provider_settlement";

/**
 * Derives a deterministic, non-zero 128-bit hex identifier from an external
 * key by taking the leading 128 bits of its SHA-256 digest. Deterministic
 * derivation is what makes account creation and transfer submission idempotent
 * by external identifier.
 */
function deriveUint128Hex(namespace: string, externalId: string): string {
  const hex = createHash("sha256").update(`${namespace}:${externalId}`).digest("hex").slice(0, 32);
  // TigerBeetle forbids the zero identifier.
  return /^0+$/.test(hex) ? `1${hex.slice(1)}` : hex;
}

export function deriveTigerBeetleAccountId(disputeId: string, role: TigerBeetleAccountRole): string {
  return deriveUint128Hex("healthpoint/tb-account", `${disputeId}:${role}`);
}

/** Transfer ID derived from the outbox event idempotency key for the action. */
export function deriveTigerBeetleTransferId(outboxIdempotencyKey: string): string {
  return deriveUint128Hex("healthpoint/tb-transfer", outboxIdempotencyKey);
}

// ── Sidecar HTTP transport ───────────────────────────────────────────────────

type SidecarConfig = TigerBeetleLedgerConfig;

async function postSidecar<T>(config: SidecarConfig, path: string, body: unknown): Promise<T> {
  if (!config.internalToken) {
    // The sidecar refuses every request without INTERNAL_SERVICE_TOKEN; fail
    // before the network hop so the reason is unambiguous.
    throw new TigerBeetleLedgerUnavailableError("INTERNAL_SERVICE_TOKEN is not configured for the TigerBeetle sidecar");
  }
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Auth": config.internalToken,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    throw new TigerBeetleLedgerUnavailableError(
      `TigerBeetle sidecar unreachable at ${path}: ${error instanceof Error ? error.message : "network error"}`,
    );
  }
  if (response.status === 400 || response.status === 409) {
    const message = await response.text().catch(() => "");
    throw new TigerBeetleLedgerConflictError(`TigerBeetle rejected ${path} (${response.status}): ${message.slice(0, 300)}`);
  }
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new TigerBeetleLedgerUnavailableError(`TigerBeetle sidecar ${path} returned HTTP ${response.status}: ${message.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

// ── Ledger operations ────────────────────────────────────────────────────────

type EnsureAccountsResponse = { accounts: Array<{ accountId: string; status: "created" | "existing" }> };

/** Creates the two per-dispute settlement mirror accounts if absent. Idempotent. */
export async function ensureDisputeSettlementAccounts(
  disputeId: string,
  config: SidecarConfig = getTigerBeetleLedgerConfig(),
): Promise<{ payerAccountId: string; providerAccountId: string }> {
  const payerAccountId = deriveTigerBeetleAccountId(disputeId, "payer_clearing");
  const providerAccountId = deriveTigerBeetleAccountId(disputeId, "provider_settlement");
  await postSidecar<EnsureAccountsResponse>(config, "/internal/ledger/accounts", {
    accounts: [
      { accountId: payerAccountId, ledger: TB_LEDGER_USD_CENTS, code: TB_CODE_SETTLEMENT_ACCOUNT, history: true },
      { accountId: providerAccountId, ledger: TB_LEDGER_USD_CENTS, code: TB_CODE_SETTLEMENT_ACCOUNT, history: true },
    ],
  });
  return { payerAccountId, providerAccountId };
}

type TransferResponse = { transferId: string; status: string; timestamp: number };

const TRANSFER_SUCCESS_STATUSES = new Set(["committed", "pending", "posted", "voided", "exists", "already_posted", "already_voided"]);

async function submitTransfer(config: SidecarConfig, body: Record<string, unknown>): Promise<TransferResponse> {
  const response = await postSidecar<TransferResponse>(config, "/internal/ledger/transfer", body);
  if (!TRANSFER_SUCCESS_STATUSES.has(response.status)) {
    // "error: ..." results from the sidecar are state conflicts (e.g. the hold
    // expired), not transport failures — they will never succeed on retry.
    throw new TigerBeetleLedgerConflictError(`TigerBeetle transfer ${body.transferId} failed: ${response.status}`);
  }
  return response;
}

export type PendingHoldResult = { pendingTransferId: string; status: string };

/**
 * Phase 1 of the settlement two-phase transfer: reserve `amountCents` as a
 * pending hold from the payer clearing account to the provider settlement
 * account. Idempotent by `holdIdempotencyKey` (the transfer.submitted outbox
 * key).
 */
export async function submitPendingSettlementHold(input: {
  disputeId: string;
  amountCents: number;
  holdIdempotencyKey: string;
}, config: SidecarConfig = getTigerBeetleLedgerConfig()): Promise<PendingHoldResult> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new TigerBeetleLedgerConflictError("Hold amount must be a positive integer number of cents");
  }
  const { payerAccountId, providerAccountId } = await ensureDisputeSettlementAccounts(input.disputeId, config);
  const pendingTransferId = deriveTigerBeetleTransferId(input.holdIdempotencyKey);
  const response = await submitTransfer(config, {
    transferId: pendingTransferId,
    debitAccountId: payerAccountId,
    creditAccountId: providerAccountId,
    amount: input.amountCents,
    ledger: TB_LEDGER_USD_CENTS,
    code: TB_CODE_SETTLEMENT,
    phase: "pending",
    timeoutSeconds: config.pendingHoldTimeoutSeconds,
  });
  return { pendingTransferId, status: response.status };
}

/**
 * Phase 2 (success): post a pending hold. Idempotent — a retry after a
 * successful post reports "exists"/"already_posted". A missing hold is a hard
 * conflict: funds must never be posted without a recorded hold.
 */
export async function postPendingSettlementHold(input: {
  holdIdempotencyKey: string;
  postIdempotencyKey: string;
}, config: SidecarConfig = getTigerBeetleLedgerConfig()): Promise<{ transferId: string; status: string }> {
  const transferId = deriveTigerBeetleTransferId(input.postIdempotencyKey);
  const response = await postSidecar<TransferResponse>(config, "/internal/ledger/transfer", {
    transferId,
    pendingId: deriveTigerBeetleTransferId(input.holdIdempotencyKey),
    phase: "post",
  });
  if (response.status === "pending_not_found") {
    throw new TigerBeetleLedgerConflictError("Pending settlement hold not found; refusing to post funds without a hold");
  }
  if (!TRANSFER_SUCCESS_STATUSES.has(response.status)) {
    throw new TigerBeetleLedgerConflictError(`TigerBeetle hold post failed: ${response.status}`);
  }
  return { transferId, status: response.status };
}

/**
 * Phase 2 (failure): void a pending hold. Idempotent; a missing hold is a
 * no-op because it means the hold was never mirrored (e.g. ledger was
 * temporarily disabled at submission time) — there is nothing to release.
 */
export async function voidPendingSettlementHold(input: {
  holdIdempotencyKey: string;
  voidIdempotencyKey: string;
}, config: SidecarConfig = getTigerBeetleLedgerConfig()): Promise<{ transferId: string; status: string }> {
  const transferId = deriveTigerBeetleTransferId(input.voidIdempotencyKey);
  const response = await postSidecar<TransferResponse>(config, "/internal/ledger/transfer", {
    transferId,
    pendingId: deriveTigerBeetleTransferId(input.holdIdempotencyKey),
    phase: "void",
  });
  if (response.status === "pending_not_found") {
    return { transferId, status: "noop_no_pending" };
  }
  if (!TRANSFER_SUCCESS_STATUSES.has(response.status)) {
    throw new TigerBeetleLedgerConflictError(`TigerBeetle hold void failed: ${response.status}`);
  }
  return { transferId, status: response.status };
}

/**
 * One-shot committed settlement (used when a settlement succeeds but no
 * pending hold was mirrored, e.g. the ledger was enabled after submission).
 * Idempotent by `idempotencyKey`.
 */
export async function commitSettlementTransfer(input: {
  disputeId: string;
  amountCents: number;
  idempotencyKey: string;
}, config: SidecarConfig = getTigerBeetleLedgerConfig()): Promise<{ transferId: string; status: string }> {
  const { payerAccountId, providerAccountId } = await ensureDisputeSettlementAccounts(input.disputeId, config);
  const transferId = deriveTigerBeetleTransferId(input.idempotencyKey);
  const response = await submitTransfer(config, {
    transferId,
    debitAccountId: payerAccountId,
    creditAccountId: providerAccountId,
    amount: input.amountCents,
    ledger: TB_LEDGER_USD_CENTS,
    code: TB_CODE_SETTLEMENT,
    phase: "committed",
  });
  return { transferId, status: response.status };
}

/**
 * Saga compensation for a settlement that was posted to TigerBeetle and later
 * reported reversed by the provider: a committed compensating transfer moving
 * the funds back from the provider settlement account to the payer clearing
 * account. TigerBeetle entries are immutable, so reversal is always a new
 * transfer — the original posting is never mutated. Idempotent by key.
 */
export async function reverseSettledFunds(input: {
  disputeId: string;
  amountCents: number;
  idempotencyKey: string;
}, config: SidecarConfig = getTigerBeetleLedgerConfig()): Promise<{ transferId: string; status: string }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new TigerBeetleLedgerConflictError("Reversal amount must be a positive integer number of cents");
  }
  const { payerAccountId, providerAccountId } = await ensureDisputeSettlementAccounts(input.disputeId, config);
  const transferId = deriveTigerBeetleTransferId(input.idempotencyKey);
  const response = await submitTransfer(config, {
    transferId,
    debitAccountId: providerAccountId,
    creditAccountId: payerAccountId,
    amount: input.amountCents,
    ledger: TB_LEDGER_USD_CENTS,
    code: TB_CODE_SETTLEMENT_REVERSAL,
    phase: "committed",
  });
  return { transferId, status: response.status };
}

// ── Balance lookup (used by the reconciliation job) ──────────────────────────

export type TigerBeetleAccountBalance = {
  accountId: string;
  found: boolean;
  ledger?: number;
  code?: number;
  debitsPosted: string;
  creditsPosted: string;
  debitsPending: string;
  creditsPending: string;
};

/** Looks up account balances. Throws on transport failure — callers decide policy. */
export async function lookupLedgerBalances(
  accountIds: string[],
  config: SidecarConfig = getTigerBeetleLedgerConfig(),
): Promise<TigerBeetleAccountBalance[]> {
  if (accountIds.length === 0) return [];
  const response = await postSidecar<{ balances: TigerBeetleAccountBalance[] }>(config, "/internal/ledger/balances", {
    accountIds,
  });
  return response.balances;
}

// ── Degradation wrapper ──────────────────────────────────────────────────────

export type LedgerExecution<T> =
  | { mode: "disabled"; result: null }
  | { mode: "applied"; result: T }
  | { mode: "degraded"; result: null; reason: string };

async function emitLedgerDegradedEvent(context: { aggregateId: string; aggregateType: string; action: string }, reason: string): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const now = new Date();
    await db.insert(eventLog).values({
      id: crypto.randomUUID(),
      topic: "idr.payments",
      eventType: "ledger.degraded",
      aggregateId: context.aggregateId,
      aggregateType: context.aggregateType,
      payload: { action: context.action, reason: reason.slice(0, 1000), required: false },
      metadata: { userId: "system", source: "tigerbeetle_ledger", timestamp: now.toISOString() },
      idempotencyKey: `ledger-degraded:${deriveUint128Hex("healthpoint/ledger-degraded", `${context.action}:${context.aggregateId}:${reason.slice(0, 64)}`)}`,
      status: "pending",
      retryCount: 0,
      nextAttemptAt: now,
      createdAt: now,
    }).onConflictDoNothing();
  } catch (error) {
    console.warn("[TigerBeetleLedger] failed to persist ledger.degraded outbox event:", error instanceof Error ? error.message : error);
  }
}

/**
 * Runs a TigerBeetle ledger operation under the fail-closed contract:
 *   - disabled           → skipped entirely ("disabled")
 *   - success            → "applied"
 *   - transport failure  → throws when TB_LEDGER_REQUIRED=true (caller aborts
 *                          before writing Postgres state); otherwise logs and
 *                          emits a durable `ledger.degraded` outbox event
 *   - business conflict  → ALWAYS throws (retrying can never succeed)
 */
export async function withTigerBeetleLedger<T>(
  operation: () => Promise<T>,
  context: { aggregateId: string; aggregateType: string; action: string },
  config: SidecarConfig = getTigerBeetleLedgerConfig(),
): Promise<LedgerExecution<T>> {
  if (!config.enabled) return { mode: "disabled", result: null };
  try {
    return { mode: "applied", result: await operation() };
  } catch (error) {
    if (error instanceof TigerBeetleLedgerConflictError) throw error;
    const reason = error instanceof Error ? error.message : "TigerBeetle ledger operation failed";
    if (config.required) {
      throw error instanceof Error ? error : new TigerBeetleLedgerUnavailableError(reason);
    }
    console.warn(`[TigerBeetleLedger] degraded during ${context.action} for ${context.aggregateId}: ${reason}`);
    await emitLedgerDegradedEvent(context, reason);
    return { mode: "degraded", result: null, reason };
  }
}
