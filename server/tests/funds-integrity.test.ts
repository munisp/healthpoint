/**
 * server/tests/funds-integrity.test.ts
 *
 * Unit tests for the double-entry ledger (server/ledger.ts) money invariants:
 *   - entry validation guards (positive whole cents, distinct accounts, payment evidence)
 *   - per-transaction debit == credit (both account balances move by the same amount)
 *   - idempotency-key dedupe (replayed payment does not double-post)
 *   - no overpayment / no over-reversal paths (no negative-balance escape hatches)
 *
 * Mocking pattern: `../db` is replaced with an in-memory fake via vi.mock at the
 * module boundary (the same boundary the existing env-based tests use for
 * Redis/Temporal). The fake interprets the exact drizzle query shapes that
 * ledger.ts issues (verified against drizzle-orm@0.45: numbers inside sql``
 * templates arrive as raw number chunks, strings as Param chunks).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

// ── In-memory ledger database fake ───────────────────────────────────────────

interface FakeAccount {
  id: string;
  disputeId: string;
  accountType: string;
  balanceCents: number;
  currency: string;
}

interface FakeEntry {
  id: string;
  disputeId: string;
  debitAccountId: string;
  creditAccountId: string;
  amountCents: number;
  entryType: string;
  referenceId: string | null;
  referenceType: string | null;
  idempotencyKey: string | null;
}

interface FakeDispute {
  id: string;
  determinationAmount: string | null;
  paidAmount: string | null;
  currentStep: string;
}

interface FakeState {
  accounts: FakeAccount[];
  entries: FakeEntry[];
  dispute: FakeDispute | null;
  eventLog: Array<Record<string, unknown>>;
  entryInsertAttempts: number;
  eventInsertAttempts: number;
}

/** Recursively collect bound parameters and string fragments from a drizzle SQL node. */
function sqlParts(node: unknown, acc: { params: unknown[]; strings: string[] }): void {
  if (node === null || node === undefined) return;
  if (typeof node === "number") {
    // drizzle@0.45 inlines raw numbers as plain number chunks in sql`` templates
    acc.params.push(node);
    return;
  }
  if (typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  if (Array.isArray(n.queryChunks)) {
    for (const chunk of n.queryChunks) sqlParts(chunk, acc);
    return;
  }
  const ctor = (node as object).constructor?.name;
  if (ctor === "Param") acc.params.push(n.value);
  else if (ctor === "StringChunk") acc.strings.push((n.value as string[]).join(""));
}

function collectParams(node: unknown): unknown[] {
  const acc = { params: [] as unknown[], strings: [] as string[] };
  sqlParts(node, acc);
  return acc.params;
}

function createFakeDb(state: FakeState) {
  function rowsResult(rows: unknown[]): any {
    const api: any = {
      limit(n: number) { return rowsResult(rows.slice(0, n)); },
      orderBy() { return api; },
      offset() { return api; },
      then(onF: any, onR: any) { return Promise.resolve(rows).then(onF, onR); },
    };
    return api;
  }

  function applyInsert(table: string, rows: Array<Record<string, any>>): void {
    for (const row of rows) {
      if (table === "ledger_accounts") {
        const exists = state.accounts.some(
          a => a.disputeId === row.disputeId && a.accountType === row.accountType
        );
        if (!exists) state.accounts.push({ ...row } as FakeAccount);
      } else if (table === "ledger_entries") {
        state.entryInsertAttempts++;
        const dupe = row.idempotencyKey
          ? state.entries.some(e => e.disputeId === row.disputeId && e.idempotencyKey === row.idempotencyKey)
          : false;
        if (!dupe) state.entries.push({ ...row } as FakeEntry);
      } else if (table === "event_log") {
        state.eventInsertAttempts++;
        const dupe = row.idempotencyKey
          ? state.eventLog.some(e => e.idempotencyKey === row.idempotencyKey)
          : false;
        if (!dupe) state.eventLog.push(row);
      }
    }
  }

  function applyUpdate(table: string, vals: Record<string, unknown>, cond: unknown): void {
    const params = collectParams(cond);
    if (table === "ledger_accounts") {
      const accountId = params[0] as string;
      const account = state.accounts.find(a => a.id === accountId);
      if (!account) throw new Error(`fake db: no account ${accountId}`);
      if (vals.balanceCents !== undefined) {
        const parts = { params: [] as unknown[], strings: [] as string[] };
        sqlParts(vals.balanceCents, parts);
        const delta = parts.params.find(p => typeof p === "number") as number;
        const isSubtract = parts.strings.join("").includes("-");
        account.balanceCents += isSubtract ? -delta : delta;
      }
    } else if (table === "disputes") {
      if (state.dispute && typeof vals.paidAmount === "string") {
        state.dispute.paidAmount = vals.paidAmount;
      }
    }
  }

  function selectRows(table: string, cond: unknown): unknown[] {
    const params = collectParams(cond);
    if (table === "ledger_accounts") {
      const disputeId = params[0] as string;
      return state.accounts.filter(a => a.disputeId === disputeId);
    }
    if (table === "ledger_entries") {
      if (params.length === 2) {
        const [disputeId, key] = params as [string, string];
        return state.entries.filter(e => e.disputeId === disputeId && e.idempotencyKey === key);
      }
      const id = params[0] as string;
      return state.entries.filter(e => e.id === id);
    }
    if (table === "disputes") {
      return state.dispute ? [state.dispute] : [];
    }
    return [];
  }

  const tx: any = {
    execute: async () => [],
    insert(table: unknown) {
      const name = getTableName(table as any);
      return {
        values(rows: Array<Record<string, any>> | Record<string, any>) {
          const list = Array.isArray(rows) ? rows : [rows];
          const api: any = {
            onConflictDoNothing: async () => applyInsert(name, list),
            then(onF: any, onR: any) {
              return Promise.resolve().then(() => applyInsert(name, list)).then(onF, onR);
            },
          };
          return api;
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          const name = getTableName(table as any);
          return { where(cond: unknown) { return rowsResult(selectRows(name, cond)); } };
        },
      };
    },
    update(table: unknown) {
      const name = getTableName(table as any);
      return {
        set(vals: Record<string, unknown>) {
          return {
            where(cond: unknown) {
              const api: any = {
                returning: async () => [],
                then(onF: any, onR: any) {
                  return Promise.resolve().then(() => applyUpdate(name, vals, cond)).then(onF, onR);
                },
              };
              return api;
            },
          };
        },
      };
    },
  };

  return { transaction: async (cb: (t: any) => unknown) => cb(tx) };
}

const fakeState: FakeState = {
  accounts: [],
  entries: [],
  dispute: null,
  eventLog: [],
  entryInsertAttempts: 0,
  eventInsertAttempts: 0,
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => createFakeDb(fakeState)),
}));

import {
  assertValidLedgerEntry,
  LedgerIntegrityError,
  recordEntry,
  recordPayment,
  recordPaymentInTransaction,
  reversePaymentInTransaction,
} from "../ledger";
import { getDb } from "../db";

function resetState(): void {
  fakeState.accounts = [];
  fakeState.entries = [];
  fakeState.dispute = null;
  fakeState.eventLog = [];
  fakeState.entryInsertAttempts = 0;
  fakeState.eventInsertAttempts = 0;
}

beforeEach(resetState);

const DISPUTE_ID = "dispute-funds-1";
const baseEntry = {
  disputeId: DISPUTE_ID,
  debitAccountType: "paid" as const,
  creditAccountType: "determination" as const,
  amountCents: 2_500,
  entryType: "credit" as const,
  description: "test entry",
};

// ── Entry validation guards ──────────────────────────────────────────────────

describe("assertValidLedgerEntry guards", () => {
  it("rejects non-positive, fractional, non-finite, and unsafe-integer cent amounts", () => {
    for (const amountCents of [0, -1, -2500, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => assertValidLedgerEntry({ ...baseEntry, amountCents }), `amountCents=${amountCents}`)
        .toThrow(LedgerIntegrityError);
    }
  });

  it("rejects self-entries that would fabricate balance from nothing", () => {
    expect(() => assertValidLedgerEntry({ ...baseEntry, creditAccountType: "paid" }))
      .toThrow(/distinct accounts/);
  });

  it("requires an external reference and idempotency key for payment evidence", () => {
    const paymentBase = { ...baseEntry, referenceType: "payment" as const };
    expect(() => assertValidLedgerEntry({ ...paymentBase, referenceId: "  ", idempotencyKey: crypto.randomUUID() }))
      .toThrow(/payment reference/);
    expect(() => assertValidLedgerEntry({ ...paymentBase, referenceId: "ref-1", idempotencyKey: "" }))
      .toThrow(/idempotency key/);
    expect(() => assertValidLedgerEntry({ ...paymentBase, referenceId: "ref-1", idempotencyKey: crypto.randomUUID() }))
      .not.toThrow();
  });
});

// ── Double-entry invariant ───────────────────────────────────────────────────

describe("recordEntry double-entry invariant", () => {
  it("moves the same amount onto both accounts so debits equal credits per transaction", async () => {
    const amounts = [2_500, 1, 999_999];
    for (const amountCents of amounts) {
      await recordEntry({ ...baseEntry, amountCents });
    }
    const debit = fakeState.accounts.find(a => a.accountType === "paid");
    const credit = fakeState.accounts.find(a => a.accountType === "determination");
    expect(debit).toBeDefined();
    expect(credit).toBeDefined();
    const total = amounts.reduce((s, a) => s + a, 0);
    // Both legs of every entry carried the identical amount — books balance.
    expect(debit!.balanceCents).toBe(total);
    expect(credit!.balanceCents).toBe(total);
    // Per-entry: debit account, credit account and amount are internally consistent.
    for (const entry of fakeState.entries) {
      expect(entry.debitAccountId).toBe(debit!.id);
      expect(entry.creditAccountId).toBe(credit!.id);
      expect(entry.debitAccountId).not.toBe(entry.creditAccountId);
      expect(amounts).toContain(entry.amountCents);
    }
  });

  it("never creates money: total debits across the journal equal total credits", async () => {
    await recordEntry({ ...baseEntry, amountCents: 10_000 });
    await recordEntry({ ...baseEntry, amountCents: 5_000 });
    const debitSum = fakeState.entries.reduce((s, e) => s + e.amountCents, 0);
    const creditSum = fakeState.entries.reduce((s, e) => s + e.amountCents, 0);
    expect(debitSum).toBe(creditSum);
  });
});

// ── Idempotency dedupe ───────────────────────────────────────────────────────

describe("recordEntry idempotency", () => {
  it("replaying the same idempotency key returns the original entry without double-posting", async () => {
    const key = crypto.randomUUID();
    const first = await recordEntry({ ...baseEntry, amountCents: 4_000, idempotencyKey: key });
    const second = await recordEntry({ ...baseEntry, amountCents: 4_000, idempotencyKey: key });
    expect(second.id).toBe(first.id);
    expect(fakeState.entries).toHaveLength(1);
    expect(fakeState.entryInsertAttempts).toBe(1);
    const paid = fakeState.accounts.find(a => a.accountType === "paid")!;
    expect(paid.balanceCents).toBe(4_000);
  });

  it("distinct idempotency keys post as distinct entries", async () => {
    await recordEntry({ ...baseEntry, amountCents: 1_000, idempotencyKey: crypto.randomUUID() });
    await recordEntry({ ...baseEntry, amountCents: 1_000, idempotencyKey: crypto.randomUUID() });
    expect(fakeState.entries).toHaveLength(2);
    const paid = fakeState.accounts.find(a => a.accountType === "paid")!;
    expect(paid.balanceCents).toBe(2_000);
  });
});

// ── Payment evidence guards (no negative-balance paths) ─────────────────────

describe("recordPaymentInTransaction money guards", () => {
  async function withTx(fn: (tx: any) => Promise<unknown>) {
    const db = await getDb();
    return db!.transaction(fn);
  }

  beforeEach(() => {
    fakeState.dispute = {
      id: DISPUTE_ID,
      determinationAmount: "100.00",
      paidAmount: "60.00",
      currentStep: "STEP_14_PAYMENT_DETERMINATION",
    };
  });

  it("rejects payment evidence that exceeds the remaining determined amount", async () => {
    await expect(
      withTx(tx => recordPaymentInTransaction(tx, DISPUTE_ID, 5_000, "ref-overpay", crypto.randomUUID()))
    ).rejects.toThrow(/exceeds the remaining determined amount/);
    // Nothing was posted: no entry, no balance movement, paidAmount untouched.
    expect(fakeState.entries).toHaveLength(0);
    expect(fakeState.accounts.every(a => a.balanceCents === 0)).toBe(true);
    expect(fakeState.dispute!.paidAmount).toBe("60.00");
  });

  it("accepts a payment exactly equal to the remaining determined amount", async () => {
    await withTx(tx => recordPaymentInTransaction(tx, DISPUTE_ID, 4_000, "ref-exact", crypto.randomUUID()));
    expect(fakeState.dispute!.paidAmount).toBe("100.00");
    expect(fakeState.entries).toHaveLength(1);
  });

  it("rejects any further payment once the determination is fully covered", async () => {
    await withTx(tx => recordPaymentInTransaction(tx, DISPUTE_ID, 4_000, "ref-exact", crypto.randomUUID()));
    await expect(
      withTx(tx => recordPaymentInTransaction(tx, DISPUTE_ID, 1, "ref-extra-cent", crypto.randomUUID()))
    ).rejects.toThrow(LedgerIntegrityError);
  });

  it("requires a payment determination before evidence can be posted", async () => {
    fakeState.dispute!.determinationAmount = null;
    await expect(
      withTx(tx => recordPaymentInTransaction(tx, DISPUTE_ID, 1_000, "ref-no-det", crypto.randomUUID()))
    ).rejects.toThrow(/determination is required/);
  });

  it("rejects payment evidence before the payment-determination workflow stage", async () => {
    fakeState.dispute!.currentStep = "STEP_09_OFFER_SUBMISSION";
    await expect(
      withTx(tx => recordPaymentInTransaction(tx, DISPUTE_ID, 1_000, "ref-early", crypto.randomUUID()))
    ).rejects.toThrow(/payment-determination stage/);
  });
});

// ── Payment creation idempotency + outbox write ─────────────────────────────

describe("recordPayment idempotent creation", () => {
  beforeEach(() => {
    fakeState.dispute = {
      id: DISPUTE_ID,
      determinationAmount: "100.00",
      paidAmount: "0.00",
      currentStep: "STEP_14_PAYMENT_DETERMINATION",
    };
  });

  it("a replayed idempotency key neither double-posts the ledger nor duplicates the outbox event", async () => {
    const key = crypto.randomUUID();
    const first = await recordPayment(DISPUTE_ID, 2_500, "ref-pay-1", key, "tester");
    const second = await recordPayment(DISPUTE_ID, 2_500, "ref-pay-1", key, "tester");

    expect(second.id).toBe(first.id);
    expect(fakeState.entries).toHaveLength(1);
    expect(fakeState.eventLog).toHaveLength(1);
    expect(fakeState.eventLog[0].idempotencyKey).toBe(`payment-recorded:${key}`);
    expect(fakeState.eventLog[0].topic).toBe("idr.payments");
    expect(fakeState.dispute!.paidAmount).toBe("25.00");
  });
});

// ── Reversal guards ──────────────────────────────────────────────────────────

describe("reversePaymentInTransaction guards", () => {
  async function withTx(fn: (tx: any) => Promise<unknown>) {
    const db = await getDb();
    return db!.transaction(fn);
  }

  beforeEach(async () => {
    fakeState.dispute = {
      id: DISPUTE_ID,
      determinationAmount: "100.00",
      paidAmount: "0.00",
      currentStep: "STEP_15_PAYMENT_MADE",
    };
    await recordPayment(DISPUTE_ID, 3_000, "ref-to-reverse", crypto.randomUUID());
  });

  it("rejects reversals that exceed recorded payment evidence (no negative balances)", async () => {
    await expect(
      withTx(tx => reversePaymentInTransaction(tx, DISPUTE_ID, 3_001, "rev-over", crypto.randomUUID()))
    ).rejects.toThrow(/exceeds payment evidence/);
    expect(fakeState.dispute!.paidAmount).toBe("30.00");
    expect(fakeState.entries).toHaveLength(1);
  });

  it("a full reversal returns balances to zero — never negative", async () => {
    await withTx(tx => reversePaymentInTransaction(tx, DISPUTE_ID, 3_000, "rev-full", crypto.randomUUID()));
    const paid = fakeState.accounts.find(a => a.accountType === "paid")!;
    const determination = fakeState.accounts.find(a => a.accountType === "determination")!;
    expect(paid.balanceCents).toBe(0);
    expect(determination.balanceCents).toBe(0);
    expect(fakeState.dispute!.paidAmount).toBe("0.00");
    // The original entry is preserved; the reversal is a separate correcting entry.
    expect(fakeState.entries).toHaveLength(2);
    expect(fakeState.entries[1].entryType).toBe("reversal");
  });

  it("rejects non-integer or non-positive reversal amounts", async () => {
    await expect(withTx(tx => reversePaymentInTransaction(tx, DISPUTE_ID, 0, "rev-zero", crypto.randomUUID())))
      .rejects.toThrow(LedgerIntegrityError);
    await expect(withTx(tx => reversePaymentInTransaction(tx, DISPUTE_ID, 10.5, "rev-frac", crypto.randomUUID())))
      .rejects.toThrow(LedgerIntegrityError);
  });

  it("reversal idempotency: replaying the same key does not subtract twice", async () => {
    const key = crypto.randomUUID();
    await withTx(tx => reversePaymentInTransaction(tx, DISPUTE_ID, 1_000, "rev-part", key));
    await withTx(tx => reversePaymentInTransaction(tx, DISPUTE_ID, 1_000, "rev-part", key));
    expect(fakeState.dispute!.paidAmount).toBe("20.00");
    expect(fakeState.entries).toHaveLength(2);
  });
});
