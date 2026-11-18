/**
 * Tests for the statutory QPA engine (server/idr/qpa/).
 * Regulatory citations in comments verified against eCFR 45 CFR 149.140,
 * accessed 2026-09-07.
 */
import { describe, expect, it } from "vitest";
import {
  classifyRow,
  computeMedianContractedRate,
  effectiveRateCents,
  loadCpiFactorsFromEnv,
  median,
  MIN_CONTRACTED_RATES,
  QPA_BASELINE_DATE,
  resolveCpiFactor,
  type CpiFactorTable,
  type ContractedRateRow,
} from "./methodology";
import {
  canonicalizeRow,
  createInMemoryStore,
  ingestContractedRates,
  validateRow,
  type IngestionProvenance,
} from "./ingestion";
import { computeQPA } from "./engine";

const DIM = { serviceCode: "99285", market: "SELF_INSURED" as const, region: "TX-MSA-12420" };

function rate(overrides: Partial<ContractedRateRow> = {}): ContractedRateRow {
  return {
    payerId: "PAYER-A",
    serviceCode: "99285",
    market: "SELF_INSURED",
    region: "TX-MSA-12420",
    contractedRateCents: 10000,
    arrangementType: "FEE_FOR_SERVICE",
    effectiveDate: "2019-01-01",
    ...overrides,
  };
}

// Published cumulative CPI-U multipliers are INJECTED in tests; the engine
// ships no factors (fail-closed). These are test fixtures, not regulatory data.
const CPI: CpiFactorTable = {
  baseYear: 2019,
  factors: { 2019: 1, 2020: 1.05, 2021: 1.08, 2022: 1.2, 2023: 1.3 },
};

describe("median math — 45 CFR 149.140(b)(1)", () => {
  it("odd n selects the middle number", () => {
    expect(median([100, 200, 300])).toBe(200);
    expect(median([500, 100, 300, 200, 400].sort((a, b) => a - b))).toBe(300);
  });

  it("even n averages the middle two", () => {
    expect(median([100, 200, 300, 401])).toBe(250);
  });

  it("median over 3 rates uses all three (sufficient-information minimum)", () => {
    const r = computeMedianContractedRate(
      [rate({ contractedRateCents: 9000 }), rate({ contractedRateCents: 11000 }), rate({ contractedRateCents: 10000 })],
      { ...DIM, asOfDate: QPA_BASELINE_DATE }
    );
    expect(r.computable).toBe(true);
    expect(r.medianCents).toBe(10000);
    expect(r.ratesUsed).toBe(3);
  });

  it("even population: average of middle two rounds to cents", () => {
    const r = computeMedianContractedRate(
      [10001, 10002, 10003, 10004].map(c => rate({ contractedRateCents: c })),
      { ...DIM, asOfDate: QPA_BASELINE_DATE }
    );
    expect(r.medianCents).toBe(Math.round((10002 + 10003) / 2));
    expect(r.ratesUsed).toBe(4);
  });
});

describe("eligibility exclusions — 149.140(a)(1), (b)(2)(iii), (b)(2)(iv)", () => {
  it("excludes single case agreements (a)(1)", () => {
    expect(classifyRow(rate({ arrangementType: "SINGLE_CASE_AGREEMENT" }), { ...DIM, asOfDate: QPA_BASELINE_DATE }))
      .toBe("NOT_A_CONTRACT");
  });

  it("excludes letters of agreement (a)(1)", () => {
    expect(classifyRow(rate({ arrangementType: "LETTER_OF_AGREEMENT" }), { ...DIM, asOfDate: QPA_BASELINE_DATE }))
      .toBe("NOT_A_CONTRACT");
  });

  it("excludes risk-sharing / bonus-penalty adjustment rows (b)(2)(iv)", () => {
    expect(classifyRow(rate({ arrangementType: "RISK_SHARING_ADJUSTMENT" }), { ...DIM, asOfDate: QPA_BASELINE_DATE }))
      .toBe("ADJUSTMENT_ONLY");
    expect(classifyRow(rate({ arrangementType: "BONUS_PENALTY_ADJUSTMENT" }), { ...DIM, asOfDate: QPA_BASELINE_DATE }))
      .toBe("ADJUSTMENT_ONLY");
  });

  it("excludes non-FFS rows without an underlying fee schedule or derived amount (b)(2)(iii)", () => {
    expect(classifyRow(rate({ arrangementType: "NON_FFS_CAPITATION" }), { ...DIM, asOfDate: QPA_BASELINE_DATE }))
      .toBe("NON_FFS_NO_UNDERLYING_RATE");
  });

  it("non-FFS rows substitute the underlying fee schedule rate (b)(2)(iii)", () => {
    const row = rate({ arrangementType: "NON_FFS_BUNDLED", contractedRateCents: 99999, underlyingFeeScheduleCents: 12000 });
    expect(classifyRow(row, { ...DIM, asOfDate: QPA_BASELINE_DATE })).toBeNull();
    expect(effectiveRateCents(row)).toBe(12000);
  });

  it("non-FFS rows fall back to the derived amount when no fee schedule exists (b)(2)(iii)", () => {
    const row = rate({ arrangementType: "NON_FFS_CAPITATION", contractedRateCents: 99999, derivedAmountCents: 11500 });
    expect(effectiveRateCents(row)).toBe(11500);
  });

  it("excludes rates not effective as of the baseline date", () => {
    expect(classifyRow(rate({ effectiveDate: "2019-02-01" }), { ...DIM, asOfDate: QPA_BASELINE_DATE }))
      .toBe("NOT_EFFECTIVE");
  });

  it("excludes wrong service code / market / region (dimension isolation, (a)(7)/(a)(8))", () => {
    expect(classifyRow(rate({ serviceCode: "99213" }), { ...DIM, asOfDate: QPA_BASELINE_DATE })).toBe("WRONG_DIMENSION");
    expect(classifyRow(rate({ market: "INDIVIDUAL" }), { ...DIM, asOfDate: QPA_BASELINE_DATE })).toBe("WRONG_DIMENSION");
    expect(classifyRow(rate({ region: "TX-OTHER" }), { ...DIM, asOfDate: QPA_BASELINE_DATE })).toBe("WRONG_DIMENSION");
  });
});

describe("sufficient-information fail-closed — 149.140(a)(15), (c)(3)", () => {
  it("fewer than 3 eligible rates => computable:false with eligible-database fallback", () => {
    const r = computeMedianContractedRate(
      [rate({ contractedRateCents: 9000 }), rate({ contractedRateCents: 11000 })],
      { ...DIM, asOfDate: QPA_BASELINE_DATE }
    );
    expect(r.computable).toBe(false);
    expect(r.medianCents).toBeNull();
    expect(r.ratesUsed).toBe(2);
    expect(r.fallback).toBe("ELIGIBLE_DATABASE_REQUIRED");
    expect(r.reason).toContain("149.140(a)(15)");
  });

  it("zero rates fails closed too", () => {
    const r = computeMedianContractedRate([], { ...DIM, asOfDate: QPA_BASELINE_DATE });
    expect(r.computable).toBe(false);
    expect(r.fallback).toBe("ELIGIBLE_DATABASE_REQUIRED");
  });

  it("MIN_CONTRACTED_RATES is the statutory 3", () => {
    expect(MIN_CONTRACTED_RATES).toBe(3);
  });

  it("exclusions can push a population below 3 (audit detail preserved)", () => {
    const r = computeMedianContractedRate(
      [
        rate({ contractedRateCents: 9000 }),
        rate({ contractedRateCents: 10000 }),
        rate({ contractedRateCents: 11000, arrangementType: "SINGLE_CASE_AGREEMENT" }),
      ],
      { ...DIM, asOfDate: QPA_BASELINE_DATE }
    );
    expect(r.computable).toBe(false);
    expect(r.exclusions).toEqual([{ rowIndex: 2, reason: "NOT_A_CONTRACT" }]);
  });
});

describe("CPI-U escalation — 149.140(c)(1)(i)/(ii)", () => {
  it("resolves an injected cumulative factor for a covered year", () => {
    expect(resolveCpiFactor(CPI, 2022)).toEqual({ ok: true, factor: 1.2, year: 2022 });
  });

  it("missing year fails closed (no estimation)", () => {
    const r = resolveCpiFactor(CPI, 2024);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("2024");
  });

  it("null table fails closed", () => {
    expect(resolveCpiFactor(null, 2022).ok).toBe(false);
  });

  it("base year must be exactly 1", () => {
    expect(resolveCpiFactor({ baseYear: 2019, factors: { 2019: 1.01, 2022: 1.2 } }, 2022).ok).toBe(false);
  });

  it("loadCpiFactorsFromEnv parses the JSON override and fails closed when absent/malformed", () => {
    expect(loadCpiFactorsFromEnv({})).toBeNull();
    expect(loadCpiFactorsFromEnv({ QPA_CPI_FACTORS_JSON: "{not json" })).toBeNull();
    const t = loadCpiFactorsFromEnv({ QPA_CPI_FACTORS_JSON: JSON.stringify({ baseYear: 2019, factors: { 2022: 1.2 } }) });
    expect(t).toEqual({ baseYear: 2019, factors: { 2022: 1.2 } });
  });
});

describe("computeQPA engine — end to end", () => {
  const rates = [
    rate({ contractedRateCents: 9000 }),
    rate({ contractedRateCents: 10000 }),
    rate({ contractedRateCents: 11000 }),
  ];

  it("computes QPA = 2019 median × injected cumulative CPI factor", () => {
    const r = computeQPA(
      { ...DIM, asOfDate: "2022-06-15" },
      { rates, cpiFactors: CPI }
    );
    expect(r.computable).toBe(true);
    expect(r.qpaCents).toBe(12000); // 10000 × 1.2
    expect(r.medianContractedRateCents).toBe(10000);
    expect(r.cpiFactor).toBe(1.2);
    expect(r.ratesUsed).toBe(3);
    expect(r.citations.join(" ")).toContain("149.140");
  });

  it("applies year-over-year indexing for a later service year", () => {
    const r = computeQPA({ ...DIM, asOfDate: "2023-03-01" }, { rates, cpiFactors: CPI });
    expect(r.qpaCents).toBe(13000);
  });

  it("fails closed when no rates are ingested (never an illustrative value)", () => {
    const r = computeQPA({ ...DIM, asOfDate: "2022-06-15" }, { rates: [], cpiFactors: CPI });
    expect(r.computable).toBe(false);
    expect(r.qpaCents).toBeNull();
    expect(r.fallback).toBe("ELIGIBLE_DATABASE_REQUIRED");
  });

  it("fails closed when the service year has no CPI factor", () => {
    const r = computeQPA({ ...DIM, asOfDate: "2026-01-01" }, { rates, cpiFactors: CPI });
    expect(r.computable).toBe(false);
    expect(r.reason).toContain("CPI_FACTOR_UNAVAILABLE");
  });

  it("fails closed when no CPI table is loaded at all", () => {
    const r = computeQPA({ ...DIM, asOfDate: "2022-06-15" }, { rates, cpiFactors: null, env: {} });
    expect(r.computable).toBe(false);
    expect(r.reason).toContain("CPI_FACTOR_UNAVAILABLE");
  });

  it("surfaces provenance summary", () => {
    const r = computeQPA(
      { ...DIM, asOfDate: "2022-06-15" },
      {
        rates, cpiFactors: CPI,
        provenance: [
          { sourceType: "TIC_MRF", sourceRef: "s3://mrf/payer-a.json", importedAt: "2026-09-01" },
          { sourceType: "PAYER_FILE", sourceRef: "payer-b-rates.csv", importedAt: "2026-09-02" },
        ],
      }
    );
    expect(r.provenanceSummary.batchCount).toBe(2);
    expect(r.provenanceSummary.sourceTypes).toEqual(["TIC_MRF", "PAYER_FILE"]);
  });
});

describe("ingestion — validation, idempotency, provenance", () => {
  const prov: IngestionProvenance = { sourceType: "PAYER_FILE", sourceRef: "rates-2026-09.csv", importedAt: "2026-09-05" };

  it("rejects invalid rows with field-level reasons", () => {
    const errs = validateRow({ payerId: "", serviceCode: "!!", contractedRateCents: -5, market: "WRONG" }, 0);
    const fields = errs.map(e => e.field);
    expect(fields).toContain("payerId");
    expect(fields).toContain("serviceCode");
    expect(fields).toContain("contractedRateCents");
    expect(fields).toContain("market");
  });

  it("accepts a fully valid row and canonicalizes (uppercases service code, ISO day)", async () => {
    const store = createInMemoryStore();
    const r = await ingestContractedRates(
      [{ ...rate({ serviceCode: "99285" }) }],
      prov,
      store
    );
    expect(r.rejected).toEqual([]);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].effectiveDate).toBe("2019-01-01");
    expect(r.accepted[0].rowHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is idempotent by content hash — replay returns same batchId without re-persisting", async () => {
    const store = createInMemoryStore();
    const rows = [rate(), rate({ contractedRateCents: 12000 })];
    const first = await ingestContractedRates(rows, prov, store);
    const second = await ingestContractedRates(rows, prov, store);
    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);
    expect(second.batchId).toBe(first.batchId);
    expect(store.batches.size).toBe(1);
  });

  it("different content yields a different batch", async () => {
    const store = createInMemoryStore();
    const a = await ingestContractedRates([rate()], prov, store);
    const b = await ingestContractedRates([rate({ contractedRateCents: 13000 })], prov, store);
    expect(b.batchId).not.toBe(a.batchId);
    expect(store.batches.size).toBe(2);
  });

  it("rejects invalid provenance", async () => {
    await expect(
      ingestContractedRates([rate()], { sourceType: "X" as any, sourceRef: "", importedAt: "2026-09-05" })
    ).rejects.toThrow("provenance");
  });

  it("dedupes identical rows within a batch by content hash", async () => {
    const store = createInMemoryStore();
    const r = await ingestContractedRates([rate(), rate()], prov, store);
    expect(r.accepted).toHaveLength(1);
    expect(r.totalRows).toBe(2);
  });

  it("keeps per-source provenance on the batch record", async () => {
    const store = createInMemoryStore();
    const r = await ingestContractedRates([rate()], { sourceType: "TIC_MRF", sourceRef: "https://payer.example/mrf.json", importedAt: "2026-09-05" }, store);
    expect(r.provenance.sourceType).toBe("TIC_MRF");
    expect(r.provenance.sourceRef).toBe("https://payer.example/mrf.json");
    expect(r.provenance.importedAt).toBe("2026-09-05");
  });

  it("canonicalizeRow throws on invalid input", () => {
    expect(() => canonicalizeRow({ payerId: 1 }, 0)).toThrow(/row 0 invalid/);
  });
});
