/**
 * server/tests/dollars-to-cents.test.ts
 *
 * M9 unit tests: dollarsToCents must parse the decimal representation exactly
 * and round half-up (1.005 → 101 cents), and must throw — never silently
 * coerce to 0 — on non-numeric input.
 */
import { describe, expect, it } from "vitest";
import { dollarsToCents, LedgerIntegrityError } from "../ledger";

describe("dollarsToCents (M9 exact-decimal half-up)", () => {
  it("converts whole dollars and clean cents", () => {
    expect(dollarsToCents("100")).toBe(10_000);
    expect(dollarsToCents("100.00")).toBe(10_000);
    expect(dollarsToCents("19.99")).toBe(1_999);
    expect(dollarsToCents(123.45)).toBe(12_345);
    expect(dollarsToCents("0.01")).toBe(1);
    expect(dollarsToCents("0")).toBe(0);
  });

  it("rounds half-up on the decimal string (the 1.005 case)", () => {
    // 1.005 * 100 === 100.49999999999999 in binary FP; the old implementation
    // recorded 100 cents. Exact decimal parsing must produce 101.
    expect(dollarsToCents("1.005")).toBe(101);
    expect(dollarsToCents(1.005)).toBe(101);
    expect(dollarsToCents("2.675")).toBe(268);
    expect(dollarsToCents("0.125")).toBe(13);
  });

  it("truncates below the half-cent boundary (no banker drift)", () => {
    expect(dollarsToCents("1.004")).toBe(100);
    expect(dollarsToCents("1.0049")).toBe(100);
  });

  it("handles extra precision beyond the rounding digit deterministically", () => {
    expect(dollarsToCents("1.0051")).toBe(101);
    expect(dollarsToCents("1.0049999")).toBe(100);
  });

  it("supports negative amounts with half-up magnitude", () => {
    expect(dollarsToCents("-1.005")).toBe(-101);
    expect(dollarsToCents("-19.99")).toBe(-1_999);
  });

  it("maps null/undefined to 0 (absent optional amount)", () => {
    expect(dollarsToCents(null)).toBe(0);
    expect(dollarsToCents(undefined)).toBe(0);
  });

  it("throws on non-numeric input instead of coercing to 0", () => {
    expect(() => dollarsToCents("abc")).toThrow(LedgerIntegrityError);
    expect(() => dollarsToCents("")).toThrow(LedgerIntegrityError);
    expect(() => dollarsToCents("1.2.3")).toThrow(LedgerIntegrityError);
    expect(() => dollarsToCents("$100.00")).toThrow(LedgerIntegrityError);
    expect(() => dollarsToCents(Number.NaN)).toThrow(LedgerIntegrityError);
    expect(() => dollarsToCents(Number.POSITIVE_INFINITY)).toThrow(LedgerIntegrityError);
    expect(() => dollarsToCents(Number.NEGATIVE_INFINITY)).toThrow(LedgerIntegrityError);
  });
});
