/**
 * server/reconciliation-diff.test.ts
 * Unit tests for the pure Postgres ↔ TigerBeetle comparison rules used by the
 * scheduled reconciliation job: balanced books, every drift kind, and the
 * missing-account cases.
 */
import { describe, expect, it } from "vitest";
import {
  diffLedgerAccount,
  expectedPendingCents,
  expectedPostedCents,
  toNonNegativeInt,
  type SettlementTransferMirror,
} from "./reconciliation-diff";
import type { TigerBeetleAccountBalance } from "./tigerbeetle-ledger";

function settledTransfer(amountCents: number, reversed = false): SettlementTransferMirror {
  return {
    status: "settled",
    amountCents,
    metadata: {
      tbSettledTransferId: `tb-settled-${amountCents}`,
      ...(reversed ? { tbReversalTransferId: `tb-reversal-${amountCents}` } : {}),
    },
  };
}

function openHold(amountCents: number): SettlementTransferMirror {
  return { status: "submitted", amountCents, metadata: { tbPendingHoldId: "tb-hold" } };
}

function closedHold(amountCents: number): SettlementTransferMirror {
  // Hold was posted/voided: the pending id remains in metadata but the status
  // is terminal, so it must not count towards expected pending.
  return { status: "settled", amountCents, metadata: { tbPendingHoldId: "tb-hold" } };
}

function balance(posted: number, pending: number, found = true): TigerBeetleAccountBalance {
  return {
    accountId: "acct-1",
    found,
    debitsPosted: "0",
    creditsPosted: String(posted),
    debitsPending: "0",
    creditsPending: String(pending),
  };
}

describe("toNonNegativeInt", () => {
  it("parses base-10 strings and floors", () => {
    expect(toNonNegativeInt("1250")).toBe(1250);
    expect(toNonNegativeInt("99.9")).toBe(99);
  });
  it("clamps garbage and negatives to zero", () => {
    expect(toNonNegativeInt(undefined)).toBe(0);
    expect(toNonNegativeInt("")).toBe(0);
    expect(toNonNegativeInt("abc")).toBe(0);
    expect(toNonNegativeInt("-50")).toBe(0);
  });
});

describe("expectedPostedCents / expectedPendingCents", () => {
  it("sums settled transfers; reversed transfers net to zero", () => {
    const transfers = [
      settledTransfer(10_000),
      settledTransfer(2_500, true), // credited then debited by its reversal
      { status: "submitted", amountCents: 700, metadata: {} }, // no settled id
    ];
    expect(expectedPostedCents(transfers)).toBe(10_000);
  });

  it("counts only open mirrored holds towards pending", () => {
    const transfers = [openHold(4_000), closedHold(9_000), settledTransfer(1_000)];
    expect(expectedPendingCents(transfers)).toBe(4_000);
  });
});

describe("diffLedgerAccount", () => {
  it("returns null when Postgres, the mirror and TigerBeetle all agree", () => {
    const drift = diffLedgerAccount({
      disputeId: "d-1",
      accountId: "acct-1",
      balance: balance(12_500, 4_000),
      postgresPaidCents: 12_500,
      transfers: [settledTransfer(12_500), openHold(4_000)],
    });
    expect(drift).toBeNull();
  });

  it("flags posted_mismatch when TigerBeetle posted disagrees with the mirror", () => {
    const drift = diffLedgerAccount({
      disputeId: "d-1",
      accountId: "acct-1",
      balance: balance(10_000, 0),
      postgresPaidCents: 12_500,
      transfers: [settledTransfer(12_500)],
    });
    expect(drift).not.toBeNull();
    expect(drift?.kind).toBe("posted_mismatch");
    expect(drift?.tigerBeetlePostedCents).toBe(10_000);
    expect(drift?.expectedPostedCents).toBe(12_500);
  });

  it("flags pending_mismatch when an open hold is missing in TigerBeetle", () => {
    const drift = diffLedgerAccount({
      disputeId: "d-1",
      accountId: "acct-1",
      balance: balance(12_500, 0),
      postgresPaidCents: 12_500,
      transfers: [settledTransfer(12_500), openHold(4_000)],
    });
    expect(drift?.kind).toBe("pending_mismatch");
    expect(drift?.expectedPendingCents).toBe(4_000);
    expect(drift?.tigerBeetlePendingCents).toBe(0);
  });

  it("flags postgres_mismatch when only the Postgres paid balance disagrees", () => {
    const drift = diffLedgerAccount({
      disputeId: "d-1",
      accountId: "acct-1",
      balance: balance(12_500, 0),
      postgresPaidCents: 12_000,
      transfers: [settledTransfer(12_500)],
    });
    expect(drift?.kind).toBe("postgres_mismatch");
    expect(drift?.postgresCents).toBe(12_000);
  });

  it("flags missing_account when the account is absent but funds are expected", () => {
    const drift = diffLedgerAccount({
      disputeId: "d-1",
      accountId: "acct-1",
      balance: balance(0, 0, false),
      postgresPaidCents: 12_500,
      transfers: [settledTransfer(12_500)],
    });
    expect(drift?.kind).toBe("missing_account");
    expect(drift?.tigerBeetlePostedCents).toBe(0);
  });

  it("flags missing_account for an absent account with only an open hold", () => {
    const drift = diffLedgerAccount({
      disputeId: "d-1",
      accountId: "acct-1",
      balance: balance(0, 0, false),
      postgresPaidCents: 0,
      transfers: [openHold(4_000)],
    });
    expect(drift?.kind).toBe("missing_account");
    expect(drift?.expectedPendingCents).toBe(4_000);
  });

  it("ignores an absent account when nothing is expected", () => {
    const drift = diffLedgerAccount({
      disputeId: "d-1",
      accountId: "acct-1",
      balance: balance(0, 0, false),
      postgresPaidCents: 0,
      transfers: [{ status: "failed", amountCents: 5_000, metadata: {} }],
    });
    expect(drift).toBeNull();
  });

  it("treats a fully reversed settlement as zero expected posted", () => {
    const drift = diffLedgerAccount({
      disputeId: "d-1",
      accountId: "acct-1",
      balance: balance(0, 0),
      postgresPaidCents: 0,
      transfers: [settledTransfer(10_000, true)],
    });
    expect(drift).toBeNull();
  });
});
