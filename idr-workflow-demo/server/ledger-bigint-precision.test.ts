import { describe, expect, it } from "vitest";
import {
  centsToDecimal,
  parseCentsString,
  parseDecimalToCents,
} from "./ledger";
import { settlementCallbackSchema } from "./settlement";

const ABOVE_SAFE_INTEGER_CENTS = "9007199254740993";
const POSTGRES_INT8_MAX_CENTS = "9223372036854775807";

describe("native bigint monetary contract", () => {
  it("round-trips cents above Number.MAX_SAFE_INTEGER without number coercion", () => {
    const cents = parseCentsString(ABOVE_SAFE_INTEGER_CENTS);
    expect(typeof cents).toBe("bigint");
    expect(cents).toBe(9_007_199_254_740_993n);
    expect(centsToDecimal(cents)).toBe("90071992547409.93");
    expect(JSON.parse(JSON.stringify({ amountCents: cents.toString() }))).toEqual({
      amountCents: ABOVE_SAFE_INTEGER_CENTS,
    });
  });

  it("preserves the PostgreSQL int8 maximum exactly", () => {
    const cents = parseCentsString(POSTGRES_INT8_MAX_CENTS);
    expect(cents).toBe(9_223_372_036_854_775_807n);
    expect(centsToDecimal(cents)).toBe("92233720368547758.07");
    expect(() => parseCentsString("9223372036854775808")).toThrow(/PostgreSQL bigint range/);
  });

  it("parses persisted USD decimal values using integer arithmetic only", () => {
    expect(parseDecimalToCents("90071992547409.93")).toBe(9_007_199_254_740_993n);
    expect(parseDecimalToCents("0.01")).toBe(1n);
    expect(() => parseDecimalToCents("90071992547409.931")).toThrow(/at most two fraction digits/);
  });

  it("converts provider callback cents from canonical JSON strings to bigint", () => {
    const parsed = settlementCallbackSchema.parse({
      provider: "provider-a",
      eventId: "provider-event-0001",
      transferId: "transfer-0001",
      disputeId: "2f8357b6-0d7d-4d95-9d17-4aea624376cb",
      status: "settled",
      amountCents: ABOVE_SAFE_INTEGER_CENTS,
      currency: "USD",
      occurredAt: "2026-09-01T00:00:00.000Z",
    });
    expect(parsed.amountCents).toBe(9_007_199_254_740_993n);
    expect(settlementCallbackSchema.safeParse({ ...parsed, amountCents: 9007199254740993 }).success).toBe(false);
  });
});
