/**
 * PostgreSQL-backed immutable double-entry ledger.
 *
 * Monetary integers use native bigint end to end. API callers must send decimal
 * strings at JSON boundaries; ledger events stringify cents because JSON cannot
 * represent bigint. PostgreSQL applies derived account balances through triggers.
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "./db";
import { disputes, eventLog, ledgerAccounts, ledgerEntries } from "../drizzle/schema";
import type { LedgerAccount, LedgerEntry } from "../drizzle/schema";

export type AccountType =
  | "billed"
  | "allowed"
  | "paid"
  | "determination"
  | "adjustment"
  | "patient_responsibility";

export type EntryType = "debit" | "credit" | "adjustment" | "reversal";
export type MoneyCents = bigint;

export interface LedgerBalance {
  accountId: string;
  accountType: AccountType;
  balanceCents: MoneyCents;
  balanceDecimal: string;
  currency: string;
}

export interface LedgerEntryInput {
  disputeId: string;
  debitAccountType: AccountType;
  creditAccountType: AccountType;
  amountCents: MoneyCents;
  entryType: EntryType;
  description: string;
  referenceId?: string;
  referenceType?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface DisputeFinancialSummary {
  billedCents: MoneyCents;
  allowedCents: MoneyCents;
  determinationCents: MoneyCents;
  paidCents: MoneyCents;
  adjustmentCents: MoneyCents;
  billedDecimal: string;
  allowedDecimal: string;
  determinationDecimal: string;
  paidDecimal: string;
  adjustmentDecimal: string;
  recoveryRateBasisPoints: MoneyCents;
  determinationVsBilledBasisPoints: MoneyCents;
}

export class LedgerIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerIntegrityError";
  }
}

/** Parses a non-negative USD-style decimal without floating point. */
export function parseDecimalToCents(value: string | null | undefined): MoneyCents {
  if (value === null || value === undefined) return 0n;
  const normalized = value.trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new LedgerIntegrityError("Amount must be a non-negative decimal with at most two fraction digits");
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return whole * 100n + fraction;
}

/** Formats signed cents exactly as a decimal string without number coercion. */
export function centsToDecimal(cents: MoneyCents): string {
  const sign = cents < 0n ? "-" : "";
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

export function parseCentsString(value: string): MoneyCents {
  if (!/^(0|[1-9]\d{0,18})$/.test(value)) {
    throw new LedgerIntegrityError("Cents must be a canonical non-negative integer string within PostgreSQL bigint range");
  }
  const cents = BigInt(value);
  if (cents > 9_223_372_036_854_775_807n) {
    throw new LedgerIntegrityError("Cents exceeds PostgreSQL bigint range");
  }
  return cents;
}

export function assertValidLedgerEntry(input: LedgerEntryInput): void {
  if (typeof input.amountCents !== "bigint" || input.amountCents <= 0n) {
    throw new LedgerIntegrityError("Ledger amount must be a positive native bigint number of cents");
  }
  if (input.debitAccountType === input.creditAccountType) {
    throw new LedgerIntegrityError("A ledger entry must use two distinct accounts");
  }
  if (input.referenceType === "payment") {
    if (!input.referenceId?.trim()) throw new LedgerIntegrityError("Verified payment evidence requires an external payment reference");
    if (!input.idempotencyKey?.trim()) throw new LedgerIntegrityError("Verified payment evidence requires an idempotency key");
  }
}

const accountTypes: AccountType[] = [
  "billed", "allowed", "paid", "determination", "adjustment", "patient_responsibility",
];

function ledgerAccountValues(disputeId: string, now: Date) {
  return accountTypes.map(accountType => ({
    id: crypto.randomUUID(), disputeId, accountType, balanceCents: 0n,
    currency: "USD", createdAt: now, updatedAt: now,
  }));
}

export async function initializeDisputeLedger(disputeId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; ledger accounts were not initialized");
  await db.insert(ledgerAccounts).values(ledgerAccountValues(disputeId, new Date())).onConflictDoNothing();
}

export async function getLedgerAccount(disputeId: string, accountType: AccountType): Promise<LedgerAccount | null> {
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; ledger account was not read");
  const rows = await db.select().from(ledgerAccounts).where(and(
    eq(ledgerAccounts.disputeId, disputeId), eq(ledgerAccounts.accountType, accountType),
  )).limit(1);
  return rows[0] ?? null;
}

export async function getDisputeBalances(disputeId: string): Promise<LedgerBalance[]> {
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; ledger balances were not read");
  const accounts = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.disputeId, disputeId));
  return accounts.map(account => ({
    accountId: account.id,
    accountType: account.accountType as AccountType,
    balanceCents: account.balanceCents,
    balanceDecimal: centsToDecimal(account.balanceCents),
    currency: account.currency,
  }));
}

export async function recordEntry(input: LedgerEntryInput): Promise<LedgerEntry> {
  assertValidLedgerEntry(input);
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; ledger entry was not recorded");

  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.disputeId}))`);
    const now = new Date();
    await tx.insert(ledgerAccounts).values(ledgerAccountValues(input.disputeId, now)).onConflictDoNothing();

    if (input.idempotencyKey) {
      const existing = await tx.select().from(ledgerEntries).where(and(
        eq(ledgerEntries.disputeId, input.disputeId),
        eq(ledgerEntries.idempotencyKey, input.idempotencyKey),
      )).limit(1);
      if (existing[0]) return existing[0];
    }

    const accounts = await tx.select().from(ledgerAccounts).where(eq(ledgerAccounts.disputeId, input.disputeId));
    const debitAccount = accounts.find(account => account.accountType === input.debitAccountType);
    const creditAccount = accounts.find(account => account.accountType === input.creditAccountType);
    if (!debitAccount || !creditAccount) throw new LedgerIntegrityError("Ledger accounts are unavailable for this dispute");

    const entryId = crypto.randomUUID();
    await tx.insert(ledgerEntries).values({
      id: entryId, disputeId: input.disputeId, debitAccountId: debitAccount.id, creditAccountId: creditAccount.id,
      amountCents: input.amountCents, currency: "USD", entryType: input.entryType, description: input.description,
      referenceId: input.referenceId ?? null, referenceType: input.referenceType ?? null,
      idempotencyKey: input.idempotencyKey ?? null, metadata: input.metadata ?? null, createdAt: now,
    });
    const entries = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.id, entryId)).limit(1);
    if (!entries[0]) throw new LedgerIntegrityError("Ledger entry was not persisted");
    return entries[0];
  });
}

export async function getDisputeLedgerHistory(disputeId: string): Promise<Array<{
  entry: LedgerEntry;
  debitAccountType: AccountType;
  creditAccountType: AccountType;
}>> {
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; ledger history was not read");
  const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.disputeId, disputeId)).orderBy(desc(ledgerEntries.createdAt));
  const accounts = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.disputeId, disputeId));
  const accountMap = new Map(accounts.map(account => [account.id, account.accountType as AccountType]));
  return entries.map(entry => ({
    entry,
    debitAccountType: accountMap.get(entry.debitAccountId) ?? "adjustment",
    creditAccountType: accountMap.get(entry.creditAccountId) ?? "adjustment",
  }));
}

export async function recordBilledAmount(disputeId: string, billedCents: MoneyCents, referenceId?: string): Promise<void> {
  await recordEntry({ disputeId, debitAccountType: "billed", creditAccountType: "adjustment", amountCents: billedCents,
    entryType: "debit", description: "Initial billed amount recorded", referenceId, referenceType: "dispute" });
}

export async function recordAllowedAmount(disputeId: string, allowedCents: MoneyCents, referenceId?: string): Promise<void> {
  await recordEntry({ disputeId, debitAccountType: "allowed", creditAccountType: "adjustment", amountCents: allowedCents,
    entryType: "debit", description: "Payer allowed amount recorded", referenceId, referenceType: "offer" });
}

export async function recordDetermination(disputeId: string, determinationCents: MoneyCents, referenceId?: string): Promise<void> {
  await recordEntry({ disputeId, debitAccountType: "determination", creditAccountType: "allowed", amountCents: determinationCents,
    entryType: "credit", description: "IDR determination amount issued", referenceId, referenceType: "determination" });
}

export async function recordPaymentInTransaction(
  tx: any, disputeId: string, paidCents: MoneyCents, referenceId: string, idempotencyKey: string,
): Promise<LedgerEntry> {
  assertValidLedgerEntry({ disputeId, debitAccountType: "paid", creditAccountType: "determination", amountCents: paidCents,
    entryType: "credit", description: "Verified external payment evidence recorded", referenceId, referenceType: "payment", idempotencyKey });
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${disputeId}))`);
  const disputeRows = await tx.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  const dispute = disputeRows[0];
  if (!dispute) throw new LedgerIntegrityError("Dispute not found");
  if (!dispute.determinationAmount) throw new LedgerIntegrityError("A payment determination is required before payment evidence can be posted");
  if (!["STEP_14_PAYMENT_DETERMINATION", "STEP_15_PAYMENT_MADE", "STEP_16_ADMINISTRATIVE_FEE_PAID", "STEP_17_DISPUTE_CLOSED"].includes(dispute.currentStep)) {
    throw new LedgerIntegrityError("Payment evidence can only be posted after the payment-determination stage");
  }
  const determinationCents = parseDecimalToCents(dispute.determinationAmount);
  const paidToDateCents = parseDecimalToCents(dispute.paidAmount);
  if (paidCents > determinationCents - paidToDateCents) throw new LedgerIntegrityError("Payment evidence exceeds the remaining determined amount");
  const existing = await tx.select().from(ledgerEntries).where(and(
    eq(ledgerEntries.disputeId, disputeId), eq(ledgerEntries.idempotencyKey, idempotencyKey),
  )).limit(1);
  if (existing[0]) return existing[0];

  const now = new Date();
  await tx.insert(ledgerAccounts).values(ledgerAccountValues(disputeId, now)).onConflictDoNothing();
  const accounts = await tx.select().from(ledgerAccounts).where(eq(ledgerAccounts.disputeId, disputeId));
  const paidAccount = accounts.find((account: LedgerAccount) => account.accountType === "paid");
  const determinationAccount = accounts.find((account: LedgerAccount) => account.accountType === "determination");
  if (!paidAccount || !determinationAccount) throw new LedgerIntegrityError("Ledger accounts are unavailable for this payment");

  const entryId = crypto.randomUUID();
  await tx.insert(ledgerEntries).values({
    id: entryId, disputeId, debitAccountId: paidAccount.id, creditAccountId: determinationAccount.id,
    amountCents: paidCents, currency: "USD", entryType: "credit", description: "Verified external payment evidence recorded",
    referenceId, referenceType: "payment", idempotencyKey,
    metadata: { paymentEvidence: true, settlementExecution: "external" }, createdAt: now,
  });
  await tx.update(disputes).set({ paidAmount: centsToDecimal(paidToDateCents + paidCents), updatedAt: now }).where(eq(disputes.id, disputeId));
  const entries = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.id, entryId)).limit(1);
  if (!entries[0]) throw new LedgerIntegrityError("Payment evidence was not persisted");
  return entries[0];
}

export async function reversePaymentInTransaction(
  tx: any, disputeId: string, reversedCents: MoneyCents, referenceId: string, idempotencyKey: string,
): Promise<LedgerEntry> {
  if (typeof reversedCents !== "bigint" || reversedCents <= 0n) throw new LedgerIntegrityError("Reversal amount must be positive native bigint cents");
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${disputeId}))`);
  const existing = await tx.select().from(ledgerEntries).where(and(
    eq(ledgerEntries.disputeId, disputeId), eq(ledgerEntries.idempotencyKey, idempotencyKey),
  )).limit(1);
  if (existing[0]) return existing[0];

  const disputeRows = await tx.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  const dispute = disputeRows[0];
  if (!dispute) throw new LedgerIntegrityError("Dispute not found");
  const paidToDateCents = parseDecimalToCents(dispute.paidAmount);
  if (reversedCents > paidToDateCents) throw new LedgerIntegrityError("Reversal exceeds payment evidence recorded for the dispute");

  const accounts = await tx.select().from(ledgerAccounts).where(eq(ledgerAccounts.disputeId, disputeId));
  const paidAccount = accounts.find((account: LedgerAccount) => account.accountType === "paid");
  const determinationAccount = accounts.find((account: LedgerAccount) => account.accountType === "determination");
  if (!paidAccount || !determinationAccount) throw new LedgerIntegrityError("Ledger accounts are unavailable for this reversal");

  const now = new Date();
  const entryId = crypto.randomUUID();
  await tx.insert(ledgerEntries).values({
    id: entryId, disputeId, debitAccountId: determinationAccount.id, creditAccountId: paidAccount.id,
    amountCents: reversedCents, currency: "USD", entryType: "reversal", description: "Provider-confirmed settlement reversal recorded",
    referenceId, referenceType: "settlement_reversal", idempotencyKey,
    metadata: { paymentEvidenceReversal: true, settlementExecution: "external" }, createdAt: now,
  });
  await tx.update(disputes).set({ paidAmount: centsToDecimal(paidToDateCents - reversedCents), updatedAt: now }).where(eq(disputes.id, disputeId));
  const entries = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.id, entryId)).limit(1);
  if (!entries[0]) throw new LedgerIntegrityError("Settlement reversal was not persisted");
  return entries[0];
}

export async function recordPayment(
  disputeId: string, paidCents: MoneyCents, referenceId: string, idempotencyKey: string, actorId = "system",
): Promise<LedgerEntry> {
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; payment evidence was not recorded");
  return db.transaction(async tx => {
    const entry = await recordPaymentInTransaction(tx, disputeId, paidCents, referenceId, idempotencyKey);
    const now = new Date();
    await tx.insert(eventLog).values({
      id: crypto.randomUUID(), topic: "idr.payments", eventType: "payment.recorded", aggregateId: disputeId, aggregateType: "dispute",
      payload: { type: "payment_evidence", amountCents: paidCents.toString(), referenceId, ledgerEntryId: entry.id },
      metadata: { userId: actorId, timestamp: now.toISOString(), source: "manual_payment_evidence" },
      idempotencyKey: `payment-recorded:${idempotencyKey}`, status: "pending", retryCount: 0, nextAttemptAt: now, createdAt: now,
    }).onConflictDoNothing();
    return entry;
  });
}

function ratioBasisPoints(numerator: MoneyCents, denominator: MoneyCents): MoneyCents {
  if (denominator <= 0n) return 0n;
  return (numerator * 10_000n) / denominator;
}

export async function getDisputeFinancialSummary(disputeId: string): Promise<DisputeFinancialSummary> {
  const balances = await getDisputeBalances(disputeId);
  const byType = new Map(balances.map(balance => [balance.accountType, balance.balanceCents]));
  const billed = byType.get("billed") ?? 0n;
  const allowed = byType.get("allowed") ?? 0n;
  const determination = byType.get("determination") ?? 0n;
  const paid = byType.get("paid") ?? 0n;
  const adjustment = byType.get("adjustment") ?? 0n;
  return {
    billedCents: billed, allowedCents: allowed, determinationCents: determination, paidCents: paid, adjustmentCents: adjustment,
    billedDecimal: centsToDecimal(billed), allowedDecimal: centsToDecimal(allowed), determinationDecimal: centsToDecimal(determination),
    paidDecimal: centsToDecimal(paid), adjustmentDecimal: centsToDecimal(adjustment),
    recoveryRateBasisPoints: ratioBasisPoints(paid, billed), determinationVsBilledBasisPoints: ratioBasisPoints(determination, billed),
  };
}
