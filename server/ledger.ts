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
import { disputes, eventLog, ledgerAccounts, ledgerEntries, settlementTransfers } from "../drizzle/schema";
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

/**
 * Extended account types that exist in the database enum
 * (ledger_account_type) via migration 0034_wave_fc.sql but are intentionally
 * NOT added to drizzle/schema.ts (schema is owned by another wave). The cast
 * helper keeps the drizzle enum happy while the runtime value is the real
 * database enum label.
 */
export type ExtendedAccountType = AccountType | "overpayment_credit";
export const asDbAccountType = (t: ExtendedAccountType): AccountType => t as AccountType;

/** All account types initialized per dispute (base set + overpayment credit). */
const ALL_ACCOUNT_TYPES: ExtendedAccountType[] = [
  "billed", "allowed", "paid", "determination", "adjustment", "patient_responsibility", "overpayment_credit",
];

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
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export class LedgerIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerIntegrityError";
  }
}

/**
 * M9: exact-decimal, half-up dollars→cents conversion.
 *
 * The previous implementation (Math.round(parsed * 100)) suffered binary
 * floating-point error: 1.005 * 100 === 100.49999999999999, so $1.005 was
 * recorded as 100 cents instead of 101. This parser works on the decimal
 * string representation, so "1.005" → 101 cents, exactly.
 *
 * Throws LedgerIntegrityError on non-numeric input ("abc", NaN, ±Infinity) —
 * silently coercing invalid money to 0 corrupts the books.
 * null/undefined still map to 0 (absent optional amount).
 */
export function dollarsToCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new LedgerIntegrityError(`Invalid dollar amount: ${value}`);
    }
    if (Number.isInteger(value * 100)) return value * 100;
  }
  const text = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    throw new LedgerIntegrityError(`Invalid dollar amount: ${JSON.stringify(text)}`);
  }
  const [, sign, intPart, fracPart = ""] = match;
  // Half-up rounding to two fraction digits, computed on the digit string so
  // no binary floating-point error is introduced.
  let frac = fracPart.padEnd(2, "0");
  let cents = parseInt(frac.slice(0, 2) || "0", 10);
  if (fracPart.length > 2 && parseInt(fracPart[2], 10) >= 5) {
    cents += 1; // round half up; digits beyond the third cannot change half-up outcome
  }
  let total = parseInt(intPart, 10) * 100 + cents;
  if (sign === "-") total = -total;
  if (!Number.isSafeInteger(total)) {
    throw new LedgerIntegrityError(`Dollar amount out of range: ${JSON.stringify(text)}`);
  }
  return total;
}

function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function assertValidLedgerEntry(input: LedgerEntryInput): void {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new LedgerIntegrityError("Ledger amount must be a positive whole number of cents");
  }
  if (input.debitAccountType === input.creditAccountType) {
    throw new LedgerIntegrityError("A ledger entry must use two distinct accounts");
  }
  if (input.referenceType === "payment") {
    if (!input.referenceId?.trim()) {
      throw new LedgerIntegrityError("Verified payment evidence requires an external payment reference");
    }
    if (!input.idempotencyKey?.trim()) {
      throw new LedgerIntegrityError("Verified payment evidence requires an idempotency key");
    }
  }
}

// ── Account management ────────────────────────────────────────────────────────

/**
 * Initialize all ledger accounts for a new dispute.
 * Creates one account per account type, all starting at zero balance.
 */
export async function initializeDisputeLedger(disputeId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const values = ALL_ACCOUNT_TYPES.map(accountType => ({
    id: crypto.randomUUID(),
    disputeId,
    accountType: asDbAccountType(accountType),
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
export async function recordEntry(input: LedgerEntryInput): Promise<LedgerEntry> {
  assertValidLedgerEntry(input);
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; ledger entry was not recorded");

  return db.transaction(async (tx) => {
    // Serialize all writes for the dispute without relying on an optional Redis lock.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.disputeId}))`);
    const now = new Date();
    await tx.insert(ledgerAccounts).values(ALL_ACCOUNT_TYPES.map(accountType => ({
      id: crypto.randomUUID(), disputeId: input.disputeId, accountType: asDbAccountType(accountType), balanceCents: 0,
      currency: "USD", createdAt: now, updatedAt: now,
    }))).onConflictDoNothing();

    if (input.idempotencyKey) {
      const existing = await tx.select().from(ledgerEntries).where(and(
        eq(ledgerEntries.disputeId, input.disputeId),
        eq(ledgerEntries.idempotencyKey, input.idempotencyKey)
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
    // Double-entry balance convention (schema: single signed balanceCents per
    // account, drizzle/schema.ts ledger_accounts): the DEBIT account increases
    // by +amount and the CREDIT account decreases by −amount, so the sum of
    // all account balances for a dispute is always 0 (books balance). The
    // previous implementation incremented BOTH accounts by +amount, which
    // fabricated value on every entry.
    await tx.update(ledgerAccounts).set({
      balanceCents: sql`${ledgerAccounts.balanceCents} + ${input.amountCents}`, updatedAt: now,
    }).where(eq(ledgerAccounts.id, debitAccount.id));
    await tx.update(ledgerAccounts).set({
      balanceCents: sql`${ledgerAccounts.balanceCents} - ${input.amountCents}`, updatedAt: now,
    }).where(eq(ledgerAccounts.id, creditAccount.id));
    const entries = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.id, entryId)).limit(1);
    if (!entries[0]) throw new LedgerIntegrityError("Ledger entry was not persisted");
    return entries[0];
  });
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
  if (!Number.isSafeInteger(determinationCents) || determinationCents <= 0) {
    throw new LedgerIntegrityError("Determination amount must be a positive whole number of cents");
  }
  // Delta-based posting: sum prior determination postings and only book the
  // difference, so re-issuing the same determination is a no-op and a REDUCED
  // determination books a reversal for the delta (entries are immutable).
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; determination was not recorded");
  const priorNetCents = await db
    .select({ total: sql<number>`COALESCE(SUM(CASE WHEN ${ledgerEntries.entryType} = 'credit' THEN ${ledgerEntries.amountCents} ELSE -${ledgerEntries.amountCents} END), 0)::int` })
    .from(ledgerEntries)
    .where(and(
      eq(ledgerEntries.disputeId, disputeId),
      eq(ledgerEntries.referenceType, "determination"),
      sql`${ledgerEntries.entryType} IN ('credit', 'reversal')`,
    ));
  const net = Number(priorNetCents[0]?.total ?? 0);
  const delta = determinationCents - net;
  if (delta > 0) {
    await recordEntry({
      disputeId,
      debitAccountType: "determination",
      creditAccountType: "allowed",
      amountCents: delta,
      entryType: "credit",
      description: "IDR determination amount issued",
      referenceId,
      referenceType: "determination",
      idempotencyKey: `determination:${disputeId}:${determinationCents}`,
    });
  } else if (delta < 0) {
    await recordEntry({
      disputeId,
      debitAccountType: "allowed",
      creditAccountType: "determination",
      amountCents: -delta,
      entryType: "reversal",
      description: "IDR determination reduced (reversal of prior determination)",
      referenceId,
      referenceType: "determination",
      idempotencyKey: `determination-reduction:${disputeId}:${determinationCents}`,
    });
  }
  // M3: if the determination was REDUCED below the amount already paid (e.g.
  // a corrected determination after a partial payment), the excess is now an
  // overpayment owed back — book the credit memo immediately so the books
  // reflect the liability instead of silently holding corrupt state.
  await bookOverpaymentCreditIfNeeded(disputeId);
}

/**
 * M3: book an overpayment credit memo when cumulative recorded payments
 * exceed the current determination amount.
 *
 * Entry: debit `determination` (+excess, zeroing the remaining-owed account),
 *        credit `overpayment_credit` (−excess → credit-balance liability).
 * The books stay balanced and the liability is explicit on the trial balance.
 *
 * Idempotent: the credit is keyed by the current excess amount; if a further
 * reduction increases the excess, an additional memo is booked for the delta.
 * Returns the booked credit in cents (0 when no credit was needed).
 */
export async function bookOverpaymentCreditIfNeeded(disputeId: string): Promise<number> {
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; overpayment credit check was not performed");
  return db.transaction(async (tx) => bookOverpaymentCreditIfNeededInTransaction(tx, disputeId));
}

export async function bookOverpaymentCreditIfNeededInTransaction(tx: any, disputeId: string): Promise<number> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${disputeId}))`);
  const disputeRows = await tx.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  const dispute = disputeRows[0];
  if (!dispute) throw new LedgerIntegrityError("Dispute not found");
  if (!dispute.determinationAmount) return 0; // no determination → nothing to be overpaid against
  const determinationCents = dollarsToCents(dispute.determinationAmount);
  const paidCents = dollarsToCents(dispute.paidAmount);
  const excessCents = paidCents - determinationCents;
  if (excessCents <= 0) return 0;

  // Credit already booked for this dispute (sum of overpayment credit memos).
  const accounts = await tx.select().from(ledgerAccounts).where(eq(ledgerAccounts.disputeId, disputeId));
  const creditAccount = accounts.find((a: LedgerAccount) => a.accountType === asDbAccountType("overpayment_credit"));
  const alreadyBookedCents = creditAccount ? -creditAccount.balanceCents : 0;
  const deltaCents = excessCents - alreadyBookedCents;
  if (deltaCents <= 0) return 0;

  const now = new Date();
  await tx.insert(ledgerAccounts).values(ALL_ACCOUNT_TYPES.map(accountType => ({
    id: crypto.randomUUID(), disputeId, accountType: asDbAccountType(accountType), balanceCents: 0, currency: "USD", createdAt: now, updatedAt: now,
  }))).onConflictDoNothing();
  const refreshed = await tx.select().from(ledgerAccounts).where(eq(ledgerAccounts.disputeId, disputeId));
  const determinationAccount = refreshed.find((a: LedgerAccount) => a.accountType === "determination");
  const overpaymentAccount = refreshed.find((a: LedgerAccount) => a.accountType === asDbAccountType("overpayment_credit"));
  if (!determinationAccount || !overpaymentAccount) throw new LedgerIntegrityError("Ledger accounts are unavailable for the overpayment credit");

  const memoKey = `overpayment-credit:${disputeId}:${excessCents}`;
  const existingMemo = await tx.select().from(ledgerEntries).where(and(
    eq(ledgerEntries.disputeId, disputeId), eq(ledgerEntries.idempotencyKey, memoKey),
  )).limit(1);
  if (existingMemo[0]) return 0; // this exact excess level was already booked

  const entryId = crypto.randomUUID();
  await tx.insert(ledgerEntries).values({
    id: entryId,
    disputeId,
    debitAccountId: determinationAccount.id,
    creditAccountId: overpaymentAccount.id,
    amountCents: deltaCents,
    currency: "USD",
    entryType: "credit",
    description: "Overpayment credit memo — recorded payments exceed the current determination amount",
    referenceId: null,
    referenceType: "overpayment_credit",
    idempotencyKey: memoKey,
    metadata: { overpaymentCredit: true, excessCents, determinationCents, paidCents },
    createdAt: now,
  });
  // Debit determination (+) / credit overpayment_credit (−) — see recordEntry convention.
  await tx.update(ledgerAccounts).set({ balanceCents: sql`${ledgerAccounts.balanceCents} + ${deltaCents}`, updatedAt: now }).where(eq(ledgerAccounts.id, determinationAccount.id));
  await tx.update(ledgerAccounts).set({ balanceCents: sql`${ledgerAccounts.balanceCents} - ${deltaCents}`, updatedAt: now }).where(eq(ledgerAccounts.id, overpaymentAccount.id));
  return deltaCents;
}

/**
 * M3/M5b: the PG-side business-rule pre-check for accepting a payment of
 * `paidCents` against a dispute row. Throws LedgerIntegrityError with a clear,
 * operator-readable message whenever the payment must NOT be accepted:
 *   - no determination on file yet
 *   - nothing left to pay (remaining ≤ 0 — e.g. fully paid, or determination
 *     reduced below the amount already paid)
 *   - payment exceeds the remaining determined amount
 * This is the single source of truth shared by recordPaymentInTransaction and
 * the settlement reconciliation pre-check (M5b), so TigerBeetle can never post
 * a settlement that Postgres would reject.
 */
export function assertPaymentAcceptable(
  dispute: { determinationAmount: string | null; paidAmount: string | null },
  paidCents: number,
): void {
  if (!dispute.determinationAmount) {
    throw new LedgerIntegrityError("A payment determination is required before payment evidence can be posted");
  }
  const determinationCents = dollarsToCents(dispute.determinationAmount);
  const paidToDateCents = dollarsToCents(dispute.paidAmount);
  const remainingCents = determinationCents - paidToDateCents;
  if (remainingCents <= 0) {
    throw new LedgerIntegrityError(
      `No remaining determined amount to pay: determination ${centsToDecimal(determinationCents)} USD is already ` +
      `covered by recorded payments of ${centsToDecimal(paidToDateCents)} USD. Any excess is handled as an ` +
      `overpayment credit, not as new payment evidence.`,
    );
  }
  if (paidCents > remainingCents) {
    throw new LedgerIntegrityError("Payment evidence exceeds the remaining determined amount");
  }
}

/**
 * Record actual payment received.
 */
export async function recordPaymentInTransaction(
  tx: any,
  disputeId: string,
  paidCents: number,
  referenceId: string,
  idempotencyKey: string
): Promise<LedgerEntry> {
  assertValidLedgerEntry({
    disputeId, debitAccountType: "paid", creditAccountType: "determination", amountCents: paidCents,
    entryType: "credit", description: "Verified external payment evidence recorded", referenceId, referenceType: "payment", idempotencyKey,
  });
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${disputeId}))`);
  const disputeRows = await tx.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  const dispute = disputeRows[0];
  if (!dispute) throw new LedgerIntegrityError("Dispute not found");
  if (!["STEP_14_PAYMENT_DETERMINATION", "STEP_15_PAYMENT_MADE", "STEP_16_ADMINISTRATIVE_FEE_PAID", "STEP_17_DISPUTE_CLOSED"].includes(dispute.currentStep)) {
    throw new LedgerIntegrityError("Payment evidence can only be posted after the payment-determination stage");
  }
  assertPaymentAcceptable(dispute, paidCents);
  const paidToDateCents = dollarsToCents(dispute.paidAmount);
  const existing = await tx.select().from(ledgerEntries).where(and(
    eq(ledgerEntries.disputeId, disputeId), eq(ledgerEntries.idempotencyKey, idempotencyKey)
  )).limit(1);
  if (existing[0]) return existing[0];

  const now = new Date();
  await tx.insert(ledgerAccounts).values(ALL_ACCOUNT_TYPES.map(accountType => ({
    id: crypto.randomUUID(), disputeId, accountType: asDbAccountType(accountType), balanceCents: 0, currency: "USD", createdAt: now, updatedAt: now,
  }))).onConflictDoNothing();
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
  // Debit paid (+) / credit determination (−) — see recordEntry convention.
  await tx.update(ledgerAccounts).set({ balanceCents: sql`${ledgerAccounts.balanceCents} + ${paidCents}`, updatedAt: now }).where(eq(ledgerAccounts.id, paidAccount.id));
  await tx.update(ledgerAccounts).set({ balanceCents: sql`${ledgerAccounts.balanceCents} - ${paidCents}`, updatedAt: now }).where(eq(ledgerAccounts.id, determinationAccount.id));
  await tx.update(disputes).set({ paidAmount: centsToDecimal(paidToDateCents + paidCents), updatedAt: now }).where(eq(disputes.id, disputeId));
  const entries = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.id, entryId)).limit(1);
  if (!entries[0]) throw new LedgerIntegrityError("Payment evidence was not persisted");
  return entries[0];
}

/**
 * Reverse previously recorded external payment evidence after a signed provider
 * report confirms that a settlement was reversed. This is an immutable correcting
 * entry; it never mutates or deletes the original payment evidence.
 */
export async function reversePaymentInTransaction(
  tx: any,
  disputeId: string,
  reversedCents: number,
  referenceId: string,
  idempotencyKey: string,
): Promise<LedgerEntry> {
  if (!Number.isInteger(reversedCents) || reversedCents <= 0) {
    throw new LedgerIntegrityError("Reversal amount must be a positive integer number of cents");
  }
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${disputeId}))`);
  const existing = await tx.select().from(ledgerEntries).where(and(
    eq(ledgerEntries.disputeId, disputeId), eq(ledgerEntries.idempotencyKey, idempotencyKey),
  )).limit(1);
  if (existing[0]) return existing[0];

  const disputeRows = await tx.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  const dispute = disputeRows[0];
  if (!dispute) throw new LedgerIntegrityError("Dispute not found");
  const paidToDateCents = dollarsToCents(dispute.paidAmount);
  if (reversedCents > paidToDateCents) {
    throw new LedgerIntegrityError("Reversal exceeds payment evidence recorded for the dispute");
  }

  const accounts = await tx.select().from(ledgerAccounts).where(eq(ledgerAccounts.disputeId, disputeId));
  const paidAccount = accounts.find((account: LedgerAccount) => account.accountType === "paid");
  const determinationAccount = accounts.find((account: LedgerAccount) => account.accountType === "determination");
  if (!paidAccount || !determinationAccount) throw new LedgerIntegrityError("Ledger accounts are unavailable for this reversal");

  const now = new Date();
  const entryId = crypto.randomUUID();
  await tx.insert(ledgerEntries).values({
    id: entryId,
    disputeId,
    debitAccountId: determinationAccount.id,
    creditAccountId: paidAccount.id,
    amountCents: reversedCents,
    currency: "USD",
    entryType: "reversal",
    description: "Provider-confirmed settlement reversal recorded",
    referenceId,
    referenceType: "settlement_reversal",
    idempotencyKey,
    metadata: { paymentEvidenceReversal: true, settlementExecution: "external" },
    createdAt: now,
  });
  // Reversal entry: debit determination (+) / credit paid (−) — the exact
  // inverse of the payment entry, restoring both balances.
  await tx.update(ledgerAccounts).set({ balanceCents: sql`${ledgerAccounts.balanceCents} - ${reversedCents}`, updatedAt: now }).where(eq(ledgerAccounts.id, paidAccount.id));
  await tx.update(ledgerAccounts).set({ balanceCents: sql`${ledgerAccounts.balanceCents} + ${reversedCents}`, updatedAt: now }).where(eq(ledgerAccounts.id, determinationAccount.id));
  await tx.update(disputes).set({ paidAmount: centsToDecimal(paidToDateCents - reversedCents), updatedAt: now }).where(eq(disputes.id, disputeId));
  const entries = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.id, entryId)).limit(1);
  if (!entries[0]) throw new LedgerIntegrityError("Settlement reversal was not persisted");
  return entries[0];
}

export async function recordPayment(
  disputeId: string,
  paidCents: number,
  referenceId: string,
  idempotencyKey: string,
  actorId = "system"
): Promise<LedgerEntry> {
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; payment evidence was not recorded");
  return db.transaction(async tx => {
    const entry = await recordPaymentInTransaction(tx, disputeId, paidCents, referenceId, idempotencyKey);
    const now = new Date();
    await tx.insert(eventLog).values({
      id: crypto.randomUUID(),
      topic: "idr.payments",
      eventType: "payment.recorded",
      aggregateId: disputeId,
      aggregateType: "dispute",
      payload: { type: "payment_evidence", amountCents: paidCents, referenceId, ledgerEntryId: entry.id },
      metadata: { userId: actorId, timestamp: now.toISOString(), source: "manual_payment_evidence" },
      idempotencyKey: `payment-recorded:${idempotencyKey}`,
      status: "pending",
      retryCount: 0,
      nextAttemptAt: now,
      createdAt: now,
    }).onConflictDoNothing();
    return entry;
  });
}

/**
 * M2: record an UNVERIFIED payment report from a non-admin dispute writer.
 *
 * No ledger balances move and `disputes.paidAmount` is untouched — unverified
 * money must never change the books. The report is a durable outbox event
 * (event_log, eventType "payment.reported", payload.paymentEvidence === false)
 * that an admin can later confirm via confirmPaymentReport, which posts the
 * verified double-entry. Idempotent by the caller's idempotency key.
 */
export async function recordUnverifiedPaymentReport(
  disputeId: string,
  paidCents: number,
  referenceId: string,
  idempotencyKey: string,
  actorId: string,
): Promise<{ reportId: string; verified: false; duplicate: boolean }> {
  if (!Number.isSafeInteger(paidCents) || paidCents <= 0) {
    throw new LedgerIntegrityError("Reported payment amount must be a positive whole number of cents");
  }
  if (!referenceId.trim()) throw new LedgerIntegrityError("A payment report requires an external payment reference");
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; payment report was not recorded");
  const disputeRows = await db.select({ id: disputes.id }).from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  if (!disputeRows[0]) throw new LedgerIntegrityError("Dispute not found");
  const reportKey = `payment-reported:${idempotencyKey}`;
  const existing = await db.select().from(eventLog).where(eq(eventLog.idempotencyKey, reportKey)).limit(1);
  if (existing[0]) return { reportId: existing[0].id, verified: false, duplicate: true };
  const now = new Date();
  const reportId = crypto.randomUUID();
  await db.insert(eventLog).values({
    id: reportId,
    topic: "idr.payments",
    eventType: "payment.reported",
    aggregateId: disputeId,
    aggregateType: "dispute",
    payload: { type: "payment_report", amountCents: paidCents, referenceId, paymentEvidence: false, verified: false },
    metadata: { userId: actorId, timestamp: now.toISOString(), source: "manual_payment_report" },
    idempotencyKey: reportKey,
    status: "pending",
    retryCount: 0,
    nextAttemptAt: now,
    createdAt: now,
  }).onConflictDoNothing();
  return { reportId, verified: false, duplicate: false };
}

/**
 * M2: does `referenceId` match an approved (or further-along) settlement
 * transfer for this dispute? Such a reference is settlement-linked payment
 * evidence and may be posted as verified without admin involvement.
 */
export async function hasApprovedSettlementEvidence(disputeId: string, referenceId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: settlementTransfers.id }).from(settlementTransfers).where(and(
    eq(settlementTransfers.disputeId, disputeId),
    sql`${settlementTransfers.status} IN ('authorized','submitted','accepted','settled','reconciled')`,
    sql`(${settlementTransfers.providerTransferId} = ${referenceId} OR ${settlementTransfers.id} = ${referenceId})`,
  )).limit(1);
  return Boolean(rows[0]);
}

/**
 * M2: admin confirmation of an unverified payment report.
 *
 * Design: the report event itself is never mutated into "verified evidence"
 * (immutability of the original report is preserved — its payload keeps
 * paymentEvidence:false, only metadata gains verifiedBy/verifiedAt). The
 * verified financial movement is posted as a SEPARATE verified ledger entry
 * via recordPaymentInTransaction, keyed `payment-confirmed:<reportKey>`, so
 * confirmation is itself idempotent and fully auditable.
 */
export async function confirmPaymentReport(
  disputeId: string,
  referenceId: string,
  adminId: string,
): Promise<{ entry: LedgerEntry; reportId: string; alreadyConfirmed: boolean }> {
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; payment confirmation was not recorded");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${disputeId}))`);
    const reports = await tx.select().from(eventLog).where(and(
      eq(eventLog.eventType, "payment.reported"),
      eq(eventLog.aggregateId, disputeId),
      sql`${eventLog.payload} ->> 'referenceId' = ${referenceId}`,
    )).limit(1);
    const report = reports[0];
    if (!report) throw new LedgerIntegrityError("No unverified payment report found for this dispute and reference");
    const payload = (report.payload ?? {}) as Record<string, unknown>;
    const amountCents = Number(payload.amountCents);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new LedgerIntegrityError("The payment report carries an invalid amount and cannot be confirmed");
    }
    const reportKey = report.idempotencyKey ?? report.id;
    const alreadyConfirmed = Boolean((report.metadata as Record<string, unknown> | null)?.verifiedAt);
    const entry = await recordPaymentInTransaction(
      tx, disputeId, amountCents, referenceId, `payment-confirmed:${reportKey}`,
    );
    const now = new Date();
    await tx.update(eventLog).set({
      metadata: {
        ...((report.metadata as Record<string, unknown> | null) ?? {}),
        verifiedBy: adminId,
        verifiedAt: now.toISOString(),
        ledgerEntryId: entry.id,
      },
    }).where(eq(eventLog.id, report.id));
    await tx.insert(eventLog).values({
      id: crypto.randomUUID(),
      topic: "idr.payments",
      eventType: "payment.confirmed",
      aggregateId: disputeId,
      aggregateType: "dispute",
      payload: { type: "payment_evidence", amountCents, referenceId, ledgerEntryId: entry.id, sourceReportId: report.id, paymentEvidence: true },
      metadata: { userId: adminId, timestamp: now.toISOString(), source: "admin_payment_confirmation" },
      idempotencyKey: `payment-confirm-event:${reportKey}`,
      status: "pending",
      retryCount: 0,
      nextAttemptAt: now,
      createdAt: now,
    }).onConflictDoNothing();
    return { entry, reportId: report.id, alreadyConfirmed };
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
  overpaymentCreditDollars: number; // booked overpayment credit liability (M3)
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
  // Liability accounts carry a negative (credit) balance in our convention.
  const overpaymentCredit = -(byType.overpayment_credit ?? 0);

  return {
    billedDollars: billed,
    allowedDollars: allowed,
    determinationDollars: determination,
    paidDollars: paid,
    adjustmentDollars: adjustment,
    overpaymentCreditDollars: overpaymentCredit,
    recoveryRate: billed > 0 ? paid / billed : 0,
    determinationVsBilled: billed > 0 ? determination / billed : 0,
  };
}
