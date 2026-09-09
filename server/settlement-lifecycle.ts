import { createHash } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  eventLog,
  settlementApprovals,
  settlementExceptionReviews,
  settlementProviderReports,
  settlementReconciliations,
  settlementTransfers,
} from "../drizzle/schema";
import type { SettlementTransfer } from "../drizzle/schema";
import { getDb } from "./db";
import { LedgerIntegrityError, recordPaymentInTransaction, reversePaymentInTransaction } from "./ledger";
import {
  commitSettlementTransfer,
  postPendingSettlementHold,
  reverseSettledFunds,
  submitPendingSettlementHold,
  voidPendingSettlementHold,
  withTigerBeetleLedger,
} from "./tigerbeetle-ledger";
import { dispatchOutboxBatch } from "./outbox";

export const settlementTransferStatusSchema = z.enum([
  "requested", "authorized", "submitted", "accepted", "settled", "failed", "reversed", "reconciled",
]);
export type SettlementTransferStatus = z.infer<typeof settlementTransferStatusSchema>;

export const providerSettlementReportSchema = z.object({
  provider: z.string().trim().min(2).max(64),
  reportId: z.string().trim().min(8).max(128),
  transferId: z.string().uuid(),
  providerTransferId: z.string().trim().min(3).max(128),
  status: z.enum(["accepted", "settled", "failed", "reversed"]),
  amountCents: z.number().int().positive().max(1_000_000_000),
  currency: z.literal("USD"),
  reportedAt: z.string().datetime({ offset: true }),
});
export type ProviderSettlementReportInput = z.infer<typeof providerSettlementReportSchema>;

const transitionMap: Record<SettlementTransferStatus, SettlementTransferStatus[]> = {
  requested: ["authorized", "failed"],
  authorized: ["submitted", "failed"],
  submitted: ["accepted", "settled", "failed"],
  accepted: ["settled", "failed"],
  settled: ["reversed", "reconciled"],
  failed: [],
  reversed: ["reconciled"],
  reconciled: ["reversed"],
};

export function canTransitionSettlementTransfer(from: SettlementTransferStatus, to: SettlementTransferStatus): boolean {
  return transitionMap[from].includes(to);
}

export type SettlementSagaAction = "post_hold" | "commit_settlement" | "void_hold" | "reverse_settled" | "none";

/**
 * Pure saga planner for provider settlement reports, driven by the transfer's
 * recorded TigerBeetle mirror state (settlement_transfers.metadata):
 *   settled  — post the pending hold when one was mirrored at submission,
 *              otherwise mirror the settlement as a one-shot committed transfer
 *   failed   — void the mirrored hold (no hold → nothing to release)
 *   reversed — compensating committed reversal, but only when a posting exists
 *   accepted — no funds movement
 */
export function planSettlementSagaAction(
  reportedStatus: "accepted" | "settled" | "failed" | "reversed",
  metadata: Record<string, unknown> | null,
): SettlementSagaAction {
  const meta = metadata ?? {};
  switch (reportedStatus) {
    case "settled":
      return typeof meta.tbPendingHoldId === "string" ? "post_hold" : "commit_settlement";
    case "failed":
      return typeof meta.tbPendingHoldId === "string" ? "void_hold" : "none";
    case "reversed":
      return typeof meta.tbSettledTransferId === "string" ? "reverse_settled" : "none";
    default:
      return "none";
  }
}

export function assertMakerChecker(requestedBy: string, decidedBy: string): void {
  if (!requestedBy || !decidedBy || requestedBy === decidedBy) {
    throw new LedgerIntegrityError("Maker-checker control requires an approver distinct from the transfer requester");
  }
}

function lifecycleOutboxKey(transferId: string, eventType: string): string {
  return `transfer:${createHash("sha256").update(`${transferId}:${eventType}`).digest("hex")}`;
}

function lifecycleLedgerKey(transferId: string, eventType: string): string {
  return `life:${createHash("sha256").update(`${transferId}:${eventType}`).digest("hex").slice(0, 59)}`;
}

async function enqueueLifecycleEvent(tx: any, transfer: SettlementTransfer, eventType: string, payload: Record<string, unknown>, actorId: string) {
  const now = new Date();
  await tx.insert(eventLog).values({
    id: crypto.randomUUID(),
    topic: "idr.payments",
    eventType,
    aggregateId: transfer.disputeId,
    aggregateType: "settlement_transfer",
    payload: { transferId: transfer.id, provider: transfer.provider, ...payload },
    metadata: { userId: actorId, source: "settlement_lifecycle", timestamp: now.toISOString() },
    idempotencyKey: lifecycleOutboxKey(transfer.id, eventType),
    status: "pending",
    retryCount: 0,
    nextAttemptAt: now,
    createdAt: now,
  }).onConflictDoNothing();
}

export async function createSettlementTransfer(input: {
  disputeId: string;
  provider: string;
  amountCents: number;
  requestReason: string;
  idempotencyKey: string;
  requestedBy: string;
  requestedByName: string;
}): Promise<SettlementTransfer> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new LedgerIntegrityError("Transfer amount must be positive cents");
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; transfer request was not recorded");
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.disputeId}))`);
    const duplicate = await tx.select().from(settlementTransfers).where(eq(settlementTransfers.idempotencyKey, input.idempotencyKey)).limit(1);
    if (duplicate[0]) return duplicate[0];
    const now = new Date();
    const transfer: typeof settlementTransfers.$inferInsert = {
      id: crypto.randomUUID(),
      disputeId: input.disputeId,
      provider: input.provider,
      amountCents: input.amountCents,
      currency: "USD",
      status: "requested",
      requestedBy: input.requestedBy,
      requestedByName: input.requestedByName,
      requestReason: input.requestReason,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      updatedAt: now,
    };
    await tx.insert(settlementTransfers).values(transfer);
    await enqueueLifecycleEvent(tx, transfer as SettlementTransfer, "transfer.requested", { amountCents: input.amountCents, reason: input.requestReason }, input.requestedBy);
    return transfer as SettlementTransfer;
  });
  await dispatchOutboxBatch(1);
  return result;
}

export async function decideSettlementTransfer(input: {
  transferId: string;
  decision: "approved" | "rejected";
  reason: string;
  decidedBy: string;
  decidedByName: string;
  expiresAt: Date;
}): Promise<SettlementTransfer> {
  if (input.expiresAt <= new Date()) throw new LedgerIntegrityError("Approval expiration must be in the future");
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; approval decision was not recorded");
  const result = await db.transaction(async tx => {
    const rows = await tx.select().from(settlementTransfers).where(eq(settlementTransfers.id, input.transferId)).limit(1);
    const transfer = rows[0];
    if (!transfer) throw new LedgerIntegrityError("Settlement transfer not found");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${transfer.disputeId}))`);
    if (transfer.status !== "requested") throw new LedgerIntegrityError("Only requested transfers may receive an approval decision");
    assertMakerChecker(transfer.requestedBy, input.decidedBy);
    const priorDecision = await tx.select().from(settlementApprovals).where(eq(settlementApprovals.transferId, transfer.id)).limit(1);
    if (priorDecision[0]) throw new LedgerIntegrityError("Settlement transfer already has an immutable approval decision");
    const now = new Date();
    await tx.insert(settlementApprovals).values({
      id: crypto.randomUUID(), transferId: transfer.id, decision: input.decision,
      decidedBy: input.decidedBy, decidedByName: input.decidedByName,
      decisionReason: input.reason, expiresAt: input.expiresAt, decidedAt: now, createdAt: now,
    });
    const nextStatus: SettlementTransferStatus = input.decision === "approved" ? "authorized" : "failed";
    const updatedRows = await tx.update(settlementTransfers).set({
      status: nextStatus,
      authorizedAt: input.decision === "approved" ? now : null,
      failedAt: input.decision === "rejected" ? now : null,
      failureCode: input.decision === "rejected" ? "approval_rejected" : null,
      failureReason: input.decision === "rejected" ? input.reason : null,
      updatedAt: now,
    }).where(eq(settlementTransfers.id, transfer.id)).returning();
    const updated = updatedRows[0];
    if (!updated) throw new LedgerIntegrityError("Settlement approval state was not persisted");
    await enqueueLifecycleEvent(tx, updated, input.decision === "approved" ? "transfer.authorized" : "transfer.rejected", { decisionReason: input.reason }, input.decidedBy);
    return updated;
  });
  await dispatchOutboxBatch(1);
  return result;
}

export async function markSettlementTransferSubmitted(input: { transferId: string; providerTransferId: string; actorId: string }): Promise<SettlementTransfer> {
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; transfer submission was not recorded");
  // Phase 1 of the TigerBeetle two-phase transfer: reserve the funds as a
  // pending hold BEFORE any Postgres state changes, so a required-ledger
  // outage aborts the submission before it is recorded (fail closed). The hold
  // is idempotent: its transfer ID derives from the transfer.submitted outbox
  // idempotency key. The transaction below re-validates authoritatively; this
  // probe only avoids redundant sidecar calls on retries of already-decided
  // transfers.
  const prior = await getSettlementTransfer(input.transferId);
  let tbPendingHoldId: string | null = null;
  if (prior && prior.status === "authorized") {
    const hold = await withTigerBeetleLedger(
      () => submitPendingSettlementHold({
        disputeId: prior.disputeId,
        amountCents: prior.amountCents,
        holdIdempotencyKey: lifecycleOutboxKey(prior.id, "transfer.submitted"),
      }),
      { aggregateId: prior.id, aggregateType: "settlement_transfer", action: "transfer.hold" },
    );
    if (hold.mode === "applied" && hold.result) tbPendingHoldId = hold.result.pendingTransferId;
  }
  const result = await db.transaction(async tx => {
    const rows = await tx.select().from(settlementTransfers).where(eq(settlementTransfers.id, input.transferId)).limit(1);
    const transfer = rows[0];
    if (!transfer) throw new LedgerIntegrityError("Settlement transfer not found");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${transfer.disputeId}))`);
    if (transfer.status !== "authorized") throw new LedgerIntegrityError("Only an authorized transfer may be marked submitted");
    const approval = await tx.select().from(settlementApprovals).where(eq(settlementApprovals.transferId, transfer.id)).limit(1);
    if (!approval[0] || approval[0].decision !== "approved" || approval[0].expiresAt <= new Date()) {
      throw new LedgerIntegrityError("A current approved maker-checker decision is required before submission");
    }
    const now = new Date();
    const submittedMetadata = tbPendingHoldId
      ? { ...((transfer.metadata as Record<string, unknown> | null) ?? {}), tbPendingHoldId }
      : transfer.metadata;
    const updatedRows = await tx.update(settlementTransfers).set({ status: "submitted", providerTransferId: input.providerTransferId, submittedAt: now, metadata: submittedMetadata, updatedAt: now }).where(eq(settlementTransfers.id, transfer.id)).returning();
    const updated = updatedRows[0];
    if (!updated) throw new LedgerIntegrityError("Settlement submission state was not persisted");
    await enqueueLifecycleEvent(tx, updated, "transfer.submitted", { providerTransferId: input.providerTransferId }, input.actorId);
    return updated;
  });
  await dispatchOutboxBatch(1);
  return result;
}

export async function reconcileProviderSettlementReport(input: ProviderSettlementReportInput, rawPayload: Record<string, unknown>) {
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; provider report was not reconciled");
  // TigerBeetle saga step, executed BEFORE the Postgres transaction so a
  // required-ledger outage aborts reconciliation before anything is recorded
  // (fail closed; the provider can redeliver the signed report). All sidecar
  // operations are idempotent — their transfer IDs derive from the lifecycle
  // outbox idempotency keys — so redelivery after a Postgres failure never
  // double-posts. The transaction below re-validates authoritatively under
  // the dispute advisory lock; this read only plans the saga step.
  const prior = await getSettlementTransfer(input.transferId);
  let tbSettledTransferId: string | null = null;
  let tbVoidTransferId: string | null = null;
  let tbReversalTransferId: string | null = null;
  if (prior && canTransitionSettlementTransfer(prior.status as SettlementTransferStatus, input.status === "accepted" ? "accepted" : input.status === "settled" ? "settled" : input.status === "failed" ? "failed" : "reversed")) {
    const sagaAction = planSettlementSagaAction(input.status, (prior.metadata as Record<string, unknown> | null) ?? null);
    const holdKey = lifecycleOutboxKey(prior.id, "transfer.submitted");
    if (sagaAction === "post_hold") {
      // Phase 2 (success): post the pending hold recorded at submission.
      const posted = await withTigerBeetleLedger(
        () => postPendingSettlementHold({ holdIdempotencyKey: holdKey, postIdempotencyKey: lifecycleOutboxKey(prior.id, "transfer.settled") }),
        { aggregateId: prior.id, aggregateType: "settlement_transfer", action: "transfer.post" },
      );
      if (posted.mode === "applied" && posted.result) tbSettledTransferId = posted.result.transferId;
    } else if (sagaAction === "commit_settlement") {
      // No mirrored hold (ledger was disabled/degraded at submission):
      // mirror the settlement as a one-shot committed transfer instead.
      const committed = await withTigerBeetleLedger(
        () => commitSettlementTransfer({ disputeId: prior.disputeId, amountCents: prior.amountCents, idempotencyKey: lifecycleOutboxKey(prior.id, "transfer.settled") }),
        { aggregateId: prior.id, aggregateType: "settlement_transfer", action: "transfer.commit" },
      );
      if (committed.mode === "applied" && committed.result) tbSettledTransferId = committed.result.transferId;
    } else if (sagaAction === "void_hold") {
      // Phase 2 (failure): release the hold. A missing hold is a no-op.
      const voided = await withTigerBeetleLedger(
        () => voidPendingSettlementHold({ holdIdempotencyKey: holdKey, voidIdempotencyKey: lifecycleOutboxKey(prior.id, "transfer.failed") }),
        { aggregateId: prior.id, aggregateType: "settlement_transfer", action: "transfer.void" },
      );
      if (voided.mode === "applied" && voided.result) tbVoidTransferId = voided.result.transferId;
    } else if (sagaAction === "reverse_settled") {
      // Saga compensation: the settlement was posted to TigerBeetle and the
      // provider later reported a reversal. Entries are immutable, so a
      // committed compensating transfer moves the funds back.
      const reversed = await withTigerBeetleLedger(
        () => reverseSettledFunds({ disputeId: prior.disputeId, amountCents: prior.amountCents, idempotencyKey: lifecycleOutboxKey(prior.id, "transfer.reversed") }),
        { aggregateId: prior.id, aggregateType: "settlement_transfer", action: "transfer.reverse" },
      );
      if (reversed.mode === "applied" && reversed.result) tbReversalTransferId = reversed.result.transferId;
    }
  }
  const result = await db.transaction(async tx => {
    const duplicate = await tx.select().from(settlementProviderReports).where(and(eq(settlementProviderReports.provider, input.provider), eq(settlementProviderReports.providerReportId, input.reportId))).limit(1);
    if (duplicate[0]) return { duplicate: true, reconciliationStatus: "matched" as const, transferStatus: null as SettlementTransferStatus | null };
    const transfers = await tx.select().from(settlementTransfers).where(eq(settlementTransfers.id, input.transferId)).limit(1);
    const transfer = transfers[0];
    if (!transfer) throw new LedgerIntegrityError("Provider report references an unknown settlement transfer");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${transfer.disputeId}))`);
    const now = new Date();
    const reportId = crypto.randomUUID();
    await tx.insert(settlementProviderReports).values({
      id: reportId, provider: input.provider, providerReportId: input.reportId, transferId: transfer.id,
      providerTransferId: input.providerTransferId, reportedStatus: input.status, amountCents: input.amountCents,
      currency: input.currency, reportedAt: new Date(input.reportedAt), rawPayload, createdAt: now,
    });
    const amountMatches = input.amountCents === transfer.amountCents;
    const providerMatches = input.provider === transfer.provider && input.providerTransferId === transfer.providerTransferId;
    const target: SettlementTransferStatus = input.status === "accepted" ? "accepted" : input.status === "settled" ? "settled" : input.status === "failed" ? "failed" : "reversed";
    const transitionAllowed = canTransitionSettlementTransfer(transfer.status, target);
    const expectedStatus = target;
    if (!amountMatches || !providerMatches || !transitionAllowed) {
      const reason = !amountMatches ? "Provider report amount does not match the approved transfer" : !providerMatches ? "Provider report does not match the transfer provider reference" : `Provider report transition ${transfer.status} -> ${target} is not permitted`;
      await tx.insert(settlementReconciliations).values({
        id: crypto.randomUUID(), transferId: transfer.id, providerReportId: reportId, status: "exception",
        expectedAmountCents: transfer.amountCents, reportedAmountCents: input.amountCents,
        expectedStatus, reportedStatus: target, exceptionReason: reason, reconciledBy: "settlement-provider", reconciledAt: now, createdAt: now,
      });
      const createdException = await tx.select({ id: settlementReconciliations.id }).from(settlementReconciliations).where(and(
        eq(settlementReconciliations.transferId, transfer.id),
        eq(settlementReconciliations.providerReportId, reportId),
      )).limit(1);
      if (!createdException[0]) throw new LedgerIntegrityError("Settlement reconciliation exception was not persisted");
      await tx.insert(settlementExceptionReviews).values({
        id: crypto.randomUUID(),
        reconciliationId: createdException[0].id,
        status: "open",
        reviewReason: reason,
        createdAt: now,
      }).onConflictDoNothing();
      await enqueueLifecycleEvent(tx, transfer, "transfer.reconciliation_exception", { providerReportId: input.reportId, reason }, "settlement-provider");
      return { duplicate: false, reconciliationStatus: "exception" as const, transferStatus: transfer.status as SettlementTransferStatus };
    }
    let ledgerEntryId: string | null = null;
    let persistedStatus: SettlementTransferStatus = target;
    const timestamps: Record<string, Date> = {};
    if (target === "accepted") timestamps.acceptedAt = now;
    if (target === "failed") timestamps.failedAt = now;
    if (target === "settled") {
      const entry = await recordPaymentInTransaction(tx, transfer.disputeId, transfer.amountCents, transfer.providerTransferId!, lifecycleLedgerKey(transfer.id, "settled"));
      ledgerEntryId = entry.id;
      timestamps.settledAt = now;
      timestamps.reconciledAt = now;
      persistedStatus = "reconciled";
    }
    if (target === "reversed") {
      const entry = await reversePaymentInTransaction(tx, transfer.disputeId, transfer.amountCents, transfer.providerTransferId!, lifecycleLedgerKey(transfer.id, "reversed"));
      ledgerEntryId = entry.id;
      timestamps.reversedAt = now;
      timestamps.reconciledAt = now;
      persistedStatus = "reconciled";
    }
    const reconciledMetadata = {
      ...((transfer.metadata as Record<string, unknown> | null) ?? {}),
      ...(tbSettledTransferId ? { tbSettledTransferId } : {}),
      ...(tbVoidTransferId ? { tbVoidTransferId } : {}),
      ...(tbReversalTransferId ? { tbReversalTransferId } : {}),
    };
    const updatedRows = await tx.update(settlementTransfers).set({
      status: persistedStatus, ...timestamps,
      failureCode: target === "failed" ? "provider_reported_failure" : transfer.failureCode,
      failureReason: target === "failed" ? "Authenticated provider report marked transfer failed" : transfer.failureReason,
      metadata: reconciledMetadata,
      updatedAt: now,
    }).where(eq(settlementTransfers.id, transfer.id)).returning();
    const updated = updatedRows[0];
    if (!updated) throw new LedgerIntegrityError("Transfer reconciliation state was not persisted");
    await tx.insert(settlementReconciliations).values({
      id: crypto.randomUUID(), transferId: transfer.id, providerReportId: reportId, status: "matched",
      expectedAmountCents: transfer.amountCents, reportedAmountCents: input.amountCents,
      expectedStatus, reportedStatus: target, reconciledBy: "settlement-provider", reconciledAt: now, createdAt: now,
    });
    await enqueueLifecycleEvent(tx, updated, target === "settled" ? "transfer.reconciled" : `transfer.${target}`, { providerReportId: input.reportId, ledgerEntryId }, "settlement-provider");
    return { duplicate: false, reconciliationStatus: "matched" as const, transferStatus: updated.status as SettlementTransferStatus, ledgerEntryId };
  });
  if (!result.duplicate) await dispatchOutboxBatch(1);
  return result;
}

export async function listSettlementTransfers(disputeId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(settlementTransfers).where(eq(settlementTransfers.disputeId, disputeId)).orderBy(sql`${settlementTransfers.createdAt} DESC`);
}

export async function getSettlementTransfer(transferId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(settlementTransfers).where(eq(settlementTransfers.id, transferId)).limit(1);
  return rows[0];
}
