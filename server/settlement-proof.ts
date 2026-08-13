import { createHash } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  disputes,
  ledgerEntries,
  notifications,
  settlementBalanceProofs,
  settlementExceptionReviews,
  settlementJobConfigs,
  settlementReconciliations,
  settlementTransfers,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { LedgerIntegrityError } from "./ledger";
import { createHeartbeatJob, updateHeartbeatJob } from "./_core/heartbeat";

const DAILY_BALANCE_PROOF_JOB_ID = "daily-settlement-balance-proof";
const DAILY_BALANCE_PROOF_PATH = "/api/scheduled/settlement-balance-proof";

function cents(value: string | number | null): number {
  if (value === null || value === undefined) return 0;
  return Math.round(Number(value) * 100);
}

function utcProofDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function deriveProofStatus(unresolvedExceptionCount: number, ledgerMismatchCount: number): "passed" | "failed" {
  return unresolvedExceptionCount === 0 && ledgerMismatchCount === 0 ? "passed" : "failed";
}

export async function runDailySettlementBalanceProof(proofDate = utcProofDate()) {
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; settlement balance proof was not generated");
  return db.transaction(async tx => {
    const existing = await tx.select().from(settlementBalanceProofs).where(eq(settlementBalanceProofs.proofDate, proofDate)).limit(1);
    if (existing[0]) return { duplicate: true, proof: existing[0] };

    const [transfers, entries, disputeRows, exceptions] = await Promise.all([
      tx.select().from(settlementTransfers),
      tx.select({ disputeId: ledgerEntries.disputeId, amountCents: ledgerEntries.amountCents, entryType: ledgerEntries.entryType, referenceType: ledgerEntries.referenceType }).from(ledgerEntries),
      tx.select({ id: disputes.id, paidAmount: disputes.paidAmount }).from(disputes),
      tx.select().from(settlementReconciliations).where(eq(settlementReconciliations.status, "exception")),
    ]);

    const exceptionIds = exceptions.map(exception => exception.id);
    const reviews = exceptionIds.length
      ? await tx.select().from(settlementExceptionReviews).where(inArray(settlementExceptionReviews.reconciliationId, exceptionIds))
      : [];
    const reviewByReconciliation = new Map(reviews.map(review => [review.reconciliationId, review]));
    const unresolvedExceptions = exceptions.filter(exception => {
      const review = reviewByReconciliation.get(exception.id);
      return !review || review.status === "open";
    });

    const netLedgerByDispute = new Map<string, number>();
    let ledgerPaymentCents = 0;
    let ledgerReversalCents = 0;
    for (const entry of entries) {
      if (entry.referenceType === "payment" && entry.entryType === "credit") {
        ledgerPaymentCents += entry.amountCents;
        netLedgerByDispute.set(entry.disputeId, (netLedgerByDispute.get(entry.disputeId) ?? 0) + entry.amountCents);
      }
      if (entry.referenceType === "settlement_reversal" && entry.entryType === "reversal") {
        ledgerReversalCents += entry.amountCents;
        netLedgerByDispute.set(entry.disputeId, (netLedgerByDispute.get(entry.disputeId) ?? 0) - entry.amountCents);
      }
    }
    const ledgerMismatches = disputeRows
      .map(dispute => ({ disputeId: dispute.id, expectedPaidCents: cents(dispute.paidAmount), ledgerNetCents: netLedgerByDispute.get(dispute.id) ?? 0 }))
      .filter(item => item.expectedPaidCents !== item.ledgerNetCents);
    const status = deriveProofStatus(unresolvedExceptions.length, ledgerMismatches.length);
    const summary = {
      proofDate,
      transferCount: transfers.length,
      reconciledTransferCount: transfers.filter(transfer => transfer.status === "reconciled").length,
      unresolvedExceptionIds: unresolvedExceptions.map(exception => exception.id).sort(),
      ledgerMismatches,
      ledgerPaymentCents,
      ledgerReversalCents,
    };
    const evidenceHash = createHash("sha256").update(JSON.stringify(summary)).digest("hex");
    const now = new Date();
    const proof = {
      id: crypto.randomUUID(), proofDate, status,
      transferCount: summary.transferCount,
      reconciledTransferCount: summary.reconciledTransferCount,
      ledgerPaymentCents,
      ledgerReversalCents,
      unresolvedExceptionCount: unresolvedExceptions.length,
      ledgerMismatchCount: ledgerMismatches.length,
      evidenceHash,
      summary,
      createdAt: now,
    };
    await tx.insert(settlementBalanceProofs).values(proof);

    if (status === "failed") {
      const administrators = await tx.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
      const alertDisputeId = ledgerMismatches[0]?.disputeId ?? transfers[0]?.disputeId;
      if (alertDisputeId && administrators.length > 0) {
        await tx.insert(notifications).values(administrators.map(admin => ({
          id: crypto.randomUUID(),
          disputeId: alertDisputeId,
          userId: admin.id,
          notificationType: "system_alert",
          title: `Settlement balance proof failed — ${proofDate}`,
          message: `Unresolved exceptions: ${unresolvedExceptions.length}; ledger mismatches: ${ledgerMismatches.length}; evidence hash: ${evidenceHash}.`,
          dueDate: now,
          isRead: false,
          createdAt: now,
        })));
      }
    }
    return { duplicate: false, proof };
  });
}

export async function reviewSettlementException(input: {
  reconciliationId: string;
  status: "resolved" | "accepted_risk";
  resolution: string;
  reviewedBy: string;
  reviewedByName: string;
}) {
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; settlement exception review was not recorded");
  return db.transaction(async tx => {
    const reviewRows = await tx.select().from(settlementExceptionReviews).where(eq(settlementExceptionReviews.reconciliationId, input.reconciliationId)).limit(1);
    const review = reviewRows[0];
    if (!review) throw new LedgerIntegrityError("Settlement exception review not found");
    if (review.status !== "open") throw new LedgerIntegrityError("Settlement exception review already has an immutable decision");
    const reconciliationRows = await tx.select().from(settlementReconciliations).where(eq(settlementReconciliations.id, input.reconciliationId)).limit(1);
    if (!reconciliationRows[0] || reconciliationRows[0].status !== "exception") throw new LedgerIntegrityError("Only a reconciliation exception may be reviewed");
    const updated = await tx.update(settlementExceptionReviews).set({
      status: input.status,
      resolution: input.resolution,
      reviewedBy: input.reviewedBy,
      reviewedByName: input.reviewedByName,
      reviewedAt: new Date(),
    }).where(and(eq(settlementExceptionReviews.id, review.id), eq(settlementExceptionReviews.status, "open"))).returning();
    if (!updated[0]) throw new LedgerIntegrityError("Settlement exception review decision was not persisted");
    return updated[0];
  });
}

export async function listSettlementExceptionReviews(openOnly = false) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(settlementExceptionReviews).where(openOnly ? eq(settlementExceptionReviews.status, "open") : undefined).orderBy(sql`${settlementExceptionReviews.createdAt} DESC`);
}

export async function listSettlementBalanceProofs(limit = 30) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(settlementBalanceProofs).orderBy(sql`${settlementBalanceProofs.proofDate} DESC`).limit(limit);
}

export async function configureDailyBalanceProofSchedule(input: { cron: string; userSession: string }) {
  const cron = input.cron.trim();
  if (cron.split(/\s+/).length !== 6) throw new LedgerIntegrityError("Heartbeat cron must have six UTC fields");
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; Heartbeat schedule was not configured");
  const existing = (await db.select().from(settlementJobConfigs).where(eq(settlementJobConfigs.id, DAILY_BALANCE_PROOF_JOB_ID)).limit(1))[0];
  let taskUid = existing?.scheduleCronTaskUid ?? null;
  let nextExecutionAt: string | null | undefined;
  if (taskUid) {
    const updated = await updateHeartbeatJob(taskUid, {
      cron,
      path: DAILY_BALANCE_PROOF_PATH,
      method: "POST",
      payload: {},
      description: "Daily PostgreSQL settlement balance proof and exception alert review",
      enable: true,
    }, input.userSession);
    nextExecutionAt = updated.nextExecutionAt;
  } else {
    const created = await createHeartbeatJob({
      name: DAILY_BALANCE_PROOF_JOB_ID,
      cron,
      path: DAILY_BALANCE_PROOF_PATH,
      method: "POST",
      payload: {},
      description: "Daily PostgreSQL settlement balance proof and exception alert review",
    }, input.userSession);
    taskUid = created.taskUid;
    nextExecutionAt = created.nextExecutionAt;
  }
  const now = new Date();
  await db.insert(settlementJobConfigs).values({
    id: DAILY_BALANCE_PROOF_JOB_ID,
    name: DAILY_BALANCE_PROOF_JOB_ID,
    cronExpression: cron,
    scheduleCronTaskUid: taskUid,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: settlementJobConfigs.id,
    set: { cronExpression: cron, scheduleCronTaskUid: taskUid, isEnabled: true, updatedAt: now },
  });
  return { taskUid, nextExecutionAt };
}

export async function getEnabledDailyBalanceProofJob(taskUid: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(settlementJobConfigs).where(and(
    eq(settlementJobConfigs.id, DAILY_BALANCE_PROOF_JOB_ID),
    eq(settlementJobConfigs.scheduleCronTaskUid, taskUid),
    eq(settlementJobConfigs.isEnabled, true),
  )).limit(1);
  return rows[0];
}
