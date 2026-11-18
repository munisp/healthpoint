/**
 * server/reconciliation-diff.ts
 * Pure Postgres-vs-TigerBeetle balance comparison used by the scheduled
 * reconciliation job (server/reconciliation.ts). Extracted so the drift rules
 * are unit-testable without a database or the Go sidecar
 * (see server/reconciliation-diff.test.ts).
 *
 * Semantics (must stay in lockstep with runLedgerReconciliation):
 *   expectedPosted  — sum of amounts for settlement_transfers whose metadata
 *     carries a TigerBeetle settled-transfer id (tbSettledTransferId);
 *     reversed transfers (tbReversalTransferId) net to zero because the
 *     compensating reversal debits what the settlement credited.
 *   expectedPending — sum of amounts for transfers with an open mirrored hold
 *     (status submitted|accepted AND metadata.tbPendingHoldId present).
 *   drift kinds: missing_account (account absent in TigerBeetle with a
 *     non-zero expectation), posted_mismatch, pending_mismatch, and
 *     postgres_mismatch (TigerBeetle disagrees with the Postgres "paid"
 *     ledger balance while the transfer mirror agrees).
 */
import type { TigerBeetleAccountBalance } from "./tigerbeetle-ledger";

export type SettlementTransferMirror = {
  status: string;
  amountCents: number;
  metadata: unknown;
};

export type LedgerDriftKind =
  | "missing_account"
  | "posted_mismatch"
  | "pending_mismatch"
  | "postgres_mismatch";

export type LedgerAccountDrift = {
  disputeId: string;
  accountId: string;
  kind: LedgerDriftKind;
  postgresCents: number;
  tigerBeetlePostedCents: number;
  tigerBeetlePendingCents: number;
  expectedPostedCents: number;
  expectedPendingCents: number;
};

/** TigerBeetle balance fields arrive as base-10 strings; clamp garbage to 0. */
export function toNonNegativeInt(value: string | undefined): number {
  const parsed = Number(value ?? "0");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function metadataOf(transfer: SettlementTransferMirror): Record<string, unknown> {
  return (transfer.metadata as Record<string, unknown> | null) ?? {};
}

export function expectedPostedCents(transfers: SettlementTransferMirror[]): number {
  return transfers.reduce((total, transfer) => {
    const metadata = metadataOf(transfer);
    if (typeof metadata.tbSettledTransferId !== "string") return total;
    // A reversed settlement nets to zero on the provider_settlement account:
    // the committed transfer credited it and the compensating reversal debited
    // the same amount, so the expected posted contribution is 0 (not -amount).
    return typeof metadata.tbReversalTransferId === "string" ? total : total + transfer.amountCents;
  }, 0);
}

export function expectedPendingCents(transfers: SettlementTransferMirror[]): number {
  return transfers.reduce((total, transfer) => {
    const metadata = metadataOf(transfer);
    const holdOpen =
      (transfer.status === "submitted" || transfer.status === "accepted") &&
      typeof metadata.tbPendingHoldId === "string";
    return holdOpen ? total + transfer.amountCents : total;
  }, 0);
}

/**
 * Compares one dispute's provider_settlement account. Returns null when the
 * books agree, otherwise the drift record persisted on the run row.
 */
export function diffLedgerAccount(input: {
  disputeId: string;
  accountId: string;
  balance: TigerBeetleAccountBalance;
  postgresPaidCents: number;
  transfers: SettlementTransferMirror[];
}): LedgerAccountDrift | null {
  const expectedPosted = expectedPostedCents(input.transfers);
  const expectedPending = expectedPendingCents(input.transfers);

  if (!input.balance.found) {
    if (expectedPosted === 0 && expectedPending === 0) return null;
    return {
      disputeId: input.disputeId,
      accountId: input.accountId,
      kind: "missing_account",
      postgresCents: input.postgresPaidCents,
      tigerBeetlePostedCents: 0,
      tigerBeetlePendingCents: 0,
      expectedPostedCents: expectedPosted,
      expectedPendingCents: expectedPending,
    };
  }

  const tigerBeetlePostedCents =
    toNonNegativeInt(input.balance.creditsPosted) - toNonNegativeInt(input.balance.debitsPosted);
  const tigerBeetlePendingCents = toNonNegativeInt(input.balance.creditsPending);
  if (
    tigerBeetlePostedCents === expectedPosted &&
    tigerBeetlePostedCents === input.postgresPaidCents &&
    tigerBeetlePendingCents === expectedPending
  ) {
    return null;
  }
  return {
    disputeId: input.disputeId,
    accountId: input.accountId,
    kind:
      tigerBeetlePostedCents !== expectedPosted
        ? "posted_mismatch"
        : tigerBeetlePendingCents !== expectedPending
          ? "pending_mismatch"
          : "postgres_mismatch",
    postgresCents: input.postgresPaidCents,
    tigerBeetlePostedCents,
    tigerBeetlePendingCents,
    expectedPostedCents: expectedPosted,
    expectedPendingCents: expectedPending,
  };
}
