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
  tigerbeetleFinalityIntents,
} from "../drizzle/schema";
import type { SettlementTransfer } from "../drizzle/schema";
import { getDb } from "./db";
import { LedgerIntegrityError, parseCentsString, recordPaymentInTransaction, reversePaymentInTransaction } from "./ledger";
import { dispatchOutboxBatch } from "./outbox";
import { isTigerBeetleFinalityRequired, queueTigerBeetleFinalityIntentInTransaction, TigerBeetleFinalityError } from "./tigerbeetle-finality";

export const settlementTransferStatusSchema = z.enum([
  "requested", "authorized", "submitted", "accepted", "settled", "failed", "reversed", "reconciled",
]);
export type SettlementTransferStatus = z.infer<typeof settlementTransferStatusSchema>;

const canonicalCentsSchema = z.string().regex(/^[1-9]\d{0,18}$/, "amountCents must be a canonical positive cents string").transform(value => parseCentsString(value));

export const providerSettlementReportSchema = z.object({
  provider: z.string().trim().min(2).max(64),
  reportId: z.string().trim().min(8).max(128),
  transferId: z.string().uuid(),
  providerTransferId: z.string().trim().min(3).max(128),
  status: z.enum(["accepted", "settled", "failed", "reversed"]),
  amountCents: canonicalCentsSchema,
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
  amountCents: bigint;
  requestReason: string;
  idempotencyKey: string;
  requestedBy: string;
  requestedByName: string;
}): Promise<SettlementTransfer> {
  if (typeof input.amountCents !== "bigint" || input.amountCents <= 0n) throw new LedgerIntegrityError("Transfer amount must be positive native bigint cents");
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
    await enqueueLifecycleEvent(tx, transfer as SettlementTransfer, "transfer.requested", { amountCents: input.amountCents.toString(), reason: input.requestReason }, input.requestedBy);
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
    const updatedRows = await tx.update(settlementTransfers).set({ status: "submitted", providerTransferId: input.providerTransferId, submittedAt: now, updatedAt: now }).where(eq(settlementTransfers.id, transfer.id)).returning();
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
  const result = await db.transaction(async tx => {
    const duplicate = await tx.select().from(settlementProviderReports).where(and(eq(settlementProviderReports.provider, input.provider), eq(settlementProviderReports.providerReportId, input.reportId))).limit(1);
    if (duplicate[0]) {
      const finality = await tx.select().from(tigerbeetleFinalityIntents).where(eq(tigerbeetleFinalityIntents.providerReportId, duplicate[0].id)).limit(1);
      if (finality[0] && finality[0].status !== "committed") {
        return { duplicate: true, reconciliationStatus: "pending_finality" as const, transferStatus: null as SettlementTransferStatus | null, finalityIntentId: finality[0].id };
      }
      return { duplicate: true, reconciliationStatus: "matched" as const, transferStatus: null as SettlementTransferStatus | null };
    }
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
    // When explicitly enabled for this environment, a settled provider report is
    // durable evidence that must first be mirrored by the approved TigerBeetle
    // finality worker. PostgreSQL payment posting occurs only after that worker
    // has observed a created or identical-existing TigerBeetle transfer.
    if (target === "settled" && isTigerBeetleFinalityRequired()) {
      try {
        const finalityIntent = await queueTigerBeetleFinalityIntentInTransaction(tx, {
          transfer,
          providerReportId: reportId,
          disputeId: transfer.disputeId,
        });
        return {
          duplicate: false,
          reconciliationStatus: "pending_finality" as const,
          transferStatus: transfer.status as SettlementTransferStatus,
          finalityIntentId: finalityIntent.id,
        };
      } catch (error) {
        const reason = error instanceof TigerBeetleFinalityError
          ? `TigerBeetle finality queue rejected authenticated settlement: ${error.message}`
          : "TigerBeetle finality queue failed before durable submission";
        await tx.insert(settlementReconciliations).values({
          id: crypto.randomUUID(), transferId: transfer.id, providerReportId: reportId, status: "exception",
          expectedAmountCents: transfer.amountCents, reportedAmountCents: input.amountCents,
          expectedStatus: "settled", reportedStatus: "settled", exceptionReason: reason,
          reconciledBy: "settlement-provider", reconciledAt: now, createdAt: now,
        });
        const createdException = await tx.select({ id: settlementReconciliations.id }).from(settlementReconciliations).where(and(
          eq(settlementReconciliations.transferId, transfer.id),
          eq(settlementReconciliations.providerReportId, reportId),
        )).limit(1);
        if (!createdException[0]) throw new LedgerIntegrityError("TigerBeetle finality exception was not persisted");
        await tx.insert(settlementExceptionReviews).values({
          id: crypto.randomUUID(), reconciliationId: createdException[0].id, status: "open", reviewReason: reason, createdAt: now,
        }).onConflictDoNothing();
        await enqueueLifecycleEvent(tx, transfer, "transfer.finality_configuration_exception", { providerReportId: input.reportId }, "settlement-provider");
        return { duplicate: false, reconciliationStatus: "exception" as const, transferStatus: transfer.status as SettlementTransferStatus };
      }
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
    const updatedRows = await tx.update(settlementTransfers).set({
      status: persistedStatus, ...timestamps,
      failureCode: target === "failed" ? "provider_reported_failure" : transfer.failureCode,
      failureReason: target === "failed" ? "Authenticated provider report marked transfer failed" : transfer.failureReason,
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
