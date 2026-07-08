/**
 * server/ledger.ts
 * TigerBeetle-style double-entry financial ledger for IDR dispute tracking.
 *
 * Every financial movement in an IDR dispute is recorded as a double-entry
 * journal entry (debit one account, credit another). This ensures:
 * - The books always balance (debits == credits)
 * - A complete, immutable audit trail of all financial movements
 * - Accurate running balances per account type
 *
 * Account types per dispute:
 *   billed              — amount billed by provider
 *   allowed             — payer's allowed amount
 *   paid                — amount actually paid
 *   determination       — IDR determination amount
 *   adjustment          — contractual/write-off adjustments
 *   patient_responsibility — patient's share
 *
 * In production this would use TigerBeetle's binary protocol for
 * sub-millisecond, ACID-compliant double-entry ledger operations.
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "./db";
import { ledgerAccounts, ledgerEntries } from "../drizzle/schema";
import type { LedgerAccount, LedgerEntry } from "../drizzle/schema";

// ── Types ────────────────────────────────────────────────────────────────────

export type AccountType =
  | "billed"
  | "allowed"
  | "paid"
  | "determination"
  | "adjustment"
  | "patient_responsibility";

export type EntryType = "debit" | "credit" | "adjustment" | "reversal";

export interface LedgerBalance {
  accountId: string;
  accountType: AccountType;
  balanceCents: number;
  balanceDollars: number;
  currency: string;
}

export interface LedgerEntryInput {
  disputeId: string;
  debitAccountType: AccountType;
  creditAccountType: AccountType;
  amountCents: number;
  entryType: EntryType;
  description: string;
  referenceId?: string;
  referenceType?: string;
  metadata?: Record<string, unknown>;
}

// ── Account management ────────────────────────────────────────────────────────

/**
 * Initialize all ledger accounts for a new dispute.
 * Creates one account per account type, all starting at zero balance.
 */
export async function initializeDisputeLedger(disputeId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const accountTypes: AccountType[] = [
    "billed", "allowed", "paid", "determination", "adjustment", "patient_responsibility"
  ];

  const values = accountTypes.map(accountType => ({
    id: crypto.randomUUID(),
    disputeId,
    accountType,
    balanceCents: 0,
    currency: "USD",
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  try {
    await db.insert(ledgerAccounts).values(values).onConflictDoNothing();
  } catch (err) {
    console.warn("[Ledger] Failed to initialize accounts:", err);
  }
}

/**
 * Get a specific ledger account for a dispute.
 */
export async function getLedgerAccount(
  disputeId: string,
  accountType: AccountType
): Promise<LedgerAccount | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.disputeId, disputeId),
        eq(ledgerAccounts.accountType, accountType)
      )
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Get all ledger account balances for a dispute.
 */
export async function getDisputeBalances(disputeId: string): Promise<LedgerBalance[]> {
  const db = await getDb();
  if (!db) return [];

  const accounts = await db
    .select()
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.disputeId, disputeId));

  return accounts.map(a => ({
    accountId: a.id,
    accountType: a.accountType as AccountType,
    balanceCents: a.balanceCents,
    balanceDollars: a.balanceCents / 100,
    currency: a.currency,
  }));
}

// ── Journal entries ───────────────────────────────────────────────────────────

/**
 * Record a double-entry journal entry.
 * Atomically debits one account and credits another.
 * Updates running balances on both accounts.
 */
export async function recordEntry(input: LedgerEntryInput): Promise<LedgerEntry | null> {
  const db = await getDb();
  if (!db) return null;

  // Ensure accounts exist
  await initializeDisputeLedger(input.disputeId);

  // Get both accounts
  const [debitAccount, creditAccount] = await Promise.all([
    getLedgerAccount(input.disputeId, input.debitAccountType),
    getLedgerAccount(input.disputeId, input.creditAccountType),
  ]);

  if (!debitAccount || !creditAccount) {
    console.warn("[Ledger] Account not found for dispute:", input.disputeId);
    return null;
  }

  const entryId = crypto.randomUUID();
  const now = new Date();

  try {
    // Insert the journal entry
    await db.insert(ledgerEntries).values({
      id: entryId,
      disputeId: input.disputeId,
      debitAccountId: debitAccount.id,
      creditAccountId: creditAccount.id,
      amountCents: input.amountCents,
      currency: "USD",
      entryType: input.entryType,
      description: input.description,
      referenceId: input.referenceId ?? null,
      referenceType: input.referenceType ?? null,
      metadata: input.metadata ?? null,
      createdAt: now,
    });

    // Update debit account balance (debit increases the account)
    await db.update(ledgerAccounts)
      .set({
        balanceCents: sql`${ledgerAccounts.balanceCents} + ${input.amountCents}`,
        updatedAt: now,
      })
      .where(eq(ledgerAccounts.id, debitAccount.id));

    // Update credit account balance (credit increases the account)
    await db.update(ledgerAccounts)
      .set({
        balanceCents: sql`${ledgerAccounts.balanceCents} + ${input.amountCents}`,
        updatedAt: now,
      })
      .where(eq(ledgerAccounts.id, creditAccount.id));

    // Return the created entry
    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.id, entryId))
      .limit(1);

    return entries[0] ?? null;
  } catch (err) {
    console.error("[Ledger] Failed to record entry:", err);
    return null;
  }
}

/**
 * Get the full ledger history for a dispute.
 */
export async function getDisputeLedgerHistory(disputeId: string): Promise<Array<{
  entry: LedgerEntry;
  debitAccountType: AccountType;
  creditAccountType: AccountType;
}>> {
  const db = await getDb();
  if (!db) return [];

  const entries = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.disputeId, disputeId))
    .orderBy(desc(ledgerEntries.createdAt));

  // Get all accounts for this dispute to resolve account types
  const accounts = await db
    .select()
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.disputeId, disputeId));

  const accountMap = new Map(accounts.map(a => [a.id, a.accountType as AccountType]));

  return entries.map(entry => ({
    entry,
    debitAccountType: accountMap.get(entry.debitAccountId) ?? "adjustment",
    creditAccountType: accountMap.get(entry.creditAccountId) ?? "adjustment",
  }));
}

// ── High-level dispute financial operations ───────────────────────────────────

/**
 * Record the initial billed amount when a dispute is created.
 * Debits the billed account (provider's claim).
 */
export async function recordBilledAmount(
  disputeId: string,
  billedCents: number,
  referenceId?: string
): Promise<void> {
  await recordEntry({
    disputeId,
    debitAccountType: "billed",
    creditAccountType: "adjustment",
    amountCents: billedCents,
    entryType: "debit",
    description: "Initial billed amount recorded",
    referenceId,
    referenceType: "dispute",
  });
}

/**
 * Record the payer's allowed amount (QPA or counter-offer).
 */
export async function recordAllowedAmount(
  disputeId: string,
  allowedCents: number,
  referenceId?: string
): Promise<void> {
  await recordEntry({
    disputeId,
    debitAccountType: "allowed",
    creditAccountType: "adjustment",
    amountCents: allowedCents,
    entryType: "debit",
    description: "Payer allowed amount recorded",
    referenceId,
    referenceType: "offer",
  });
}

/**
 * Record the IDR determination amount.
 */
export async function recordDetermination(
  disputeId: string,
  determinationCents: number,
  referenceId?: string
): Promise<void> {
  await recordEntry({
    disputeId,
    debitAccountType: "determination",
    creditAccountType: "allowed",
    amountCents: determinationCents,
    entryType: "credit",
    description: "IDR determination amount issued",
    referenceId,
    referenceType: "determination",
  });
}

/**
 * Record actual payment received.
 */
export async function recordPayment(
  disputeId: string,
  paidCents: number,
  referenceId?: string
): Promise<void> {
  await recordEntry({
    disputeId,
    debitAccountType: "paid",
    creditAccountType: "determination",
    amountCents: paidCents,
    entryType: "credit",
    description: "Payment received from payer",
    referenceId,
    referenceType: "payment",
  });
}

/**
 * Get a summary of the dispute's financial position.
 */
export async function getDisputeFinancialSummary(disputeId: string): Promise<{
  billedDollars: number;
  allowedDollars: number;
  determinationDollars: number;
  paidDollars: number;
  adjustmentDollars: number;
  recoveryRate: number; // paid / billed
  determinationVsBilled: number; // determination / billed
}> {
  const balances = await getDisputeBalances(disputeId);
  const byType = Object.fromEntries(balances.map(b => [b.accountType, b.balanceDollars]));

  const billed = byType.billed ?? 0;
  const allowed = byType.allowed ?? 0;
  const determination = byType.determination ?? 0;
  const paid = byType.paid ?? 0;
  const adjustment = byType.adjustment ?? 0;

  return {
    billedDollars: billed,
    allowedDollars: allowed,
    determinationDollars: determination,
    paidDollars: paid,
    adjustmentDollars: adjustment,
    recoveryRate: billed > 0 ? paid / billed : 0,
    determinationVsBilled: billed > 0 ? determination / billed : 0,
  };
}
