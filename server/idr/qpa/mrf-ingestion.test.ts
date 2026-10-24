/**
 * Tests for the TiC MRF streaming ingestion fallback parser
 * (server/idr/qpa/mrf-ingestion.ts). Fixture MRF JSON follows the TiC
 * in-network schema v1.0 (CMSgov/price-transparency-guide), miniaturized.
 */
import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import {
  extractRatesFromMrf,
  ingestMrfSource,
  MrfParseError,
  runMrfIngestionFromEnv,
  streamParseTicMrf,
  type MrfSourceDescriptor,
} from "./mrf-ingestion";
import { createInMemoryStore } from "./ingestion";
import { computeMedianContractedRate, QPA_BASELINE_DATE } from "./methodology";

function streamOf(s: string, chunkSize = 16): Readable {
  const chunks: string[] = [];
  for (let i = 0; i < s.length; i += chunkSize) chunks.push(s.slice(i, i + chunkSize));
  return Readable.from(chunks);
}

/** Build a fixture MRF with `nProviders` provider groups for one code/rate. */
function fixtureMrf(opts: {
  billingCode?: string;
  rate?: number;
  nProviders?: number;
  version?: string;
  extraItems?: string[];
  includeProviderRefs?: boolean;
} = {}): string {
  const n = opts.nProviders ?? 2;
  const refs = Array.from({ length: n }, (_, i) => i + 1);
  const inNet = {
    negotiated_arrangement: "ffs",
    name: "Emergency department visit, level 5",
    billing_code_type: "CPT",
    billing_code_type_version: "2025",
    billing_code: opts.billingCode ?? "99285",
    description: "ED E/M level 5",
    negotiated_rates: [
      {
        negotiated_prices: [
          {
            negotiated_type: "negotiated",
            negotiated_rate: opts.rate ?? 450.0,
            expiration_date: "2026-12-31",
            billing_class: "professional",
            service_code: ["23"],
          },
        ],
        provider_references: refs,
      },
    ],
  };
  const items = [JSON.stringify(inNet), ...(opts.extraItems ?? [])].join(",");
  const providerRefs = refs
    .map(
      (id) =>
        `{"provider_group_id":${id},"provider_groups":[{"npi":[100000000${id}],"tin":{"type":"ein","value":"7500000${id}"}}]}`
    )
    .join(",");
  return (
    `{"reporting_entity_name":"Fixture Payer","reporting_entity_type":"Issuer",` +
    `"last_updated_on":"2026-08-01","version":"${opts.version ?? "1.0.0"}",` +
    `"in_network":[${items}]` +
    (opts.includeProviderRefs === false ? "" : `,"provider_references":[${providerRefs}]`) +
    `}`
  );
}

const OPTS = {
  payerId: "PAYER-A",
  market: "SELF_INSURED" as const,
  region: "TX-MSA-12420",
  effectiveDate: "2019-01-15",
};

describe("streamParseTicMrf — chunked tokenizer", () => {
  it("parses a fixture MRF across small chunks (multi-GB streaming path)", async () => {
    const items: any[] = [];
    const refs: any[] = [];
    await streamParseTicMrf(streamOf(fixtureMrf({ nProviders: 3 }), 7), {
      onInNetworkItem: (i) => items.push(i),
      onProviderReference: (r) => refs.push(r),
    });
    expect(items).toHaveLength(1);
    expect(items[0].billing_code).toBe("99285");
    expect(refs).toHaveLength(3);
    expect(refs[0].provider_groups[0].tin.type).toBe("ein");
  });

  it("fails closed on an unsupported schema version", async () => {
    await expect(
      (async () => {
        const it1: any[] = [];
        await streamParseTicMrf(streamOf(fixtureMrf({ version: "9.9.9" })), {
          onInNetworkItem: (i) => it1.push(i),
          onProviderReference: () => {},
        });
      })()
    ).rejects.toThrow(/unsupported TiC schema version/);
  });

  it("fails closed on a truncated stream", async () => {
    const s = fixtureMrf();
    await expect(
      streamParseTicMrf(streamOf(s.slice(0, s.length - 40)), {
        onInNetworkItem: () => {},
        onProviderReference: () => {},
      })
    ).rejects.toThrow(MrfParseError);
  });

  it("fails closed when there is no in_network array", async () => {
    await expect(
      streamParseTicMrf(streamOf('{"version":"1.0.0","foo":[]}'), {
        onInNetworkItem: () => {},
        onProviderReference: () => {},
      })
    ).rejects.toThrow(/in_network/);
  });
});

describe("extractRatesFromMrf — normalization and extraction", () => {
  it("extracts negotiated in-network rates and normalizes dollars to integer cents", async () => {
    const { records, rows, stats } = await extractRatesFromMrf(streamOf(fixtureMrf({ rate: 450.5 })), OPTS);
    expect(stats.inNetworkItemsScanned).toBe(1);
    expect(stats.negotiatedPriceRowsScanned).toBe(1);
    expect(records[0].negotiatedRateCents).toBe(45050);
    expect(records[0].billingClass).toBe("professional");
    expect(rows[0].contractedRateCents).toBe(45050);
    expect(rows[0].arrangementType).toBe("FEE_FOR_SERVICE");
    expect(rows[0].market).toBe("SELF_INSURED");
    expect(rows[0].region).toBe("TX-MSA-12420");
  });

  it("resolves provider_references to NPIs and TINs", async () => {
    const { records } = await extractRatesFromMrf(streamOf(fixtureMrf({ nProviders: 2 })), OPTS);
    expect(records).toHaveLength(2);
    expect(records[0].npis[0]).toMatch(/^100000000/);
    expect(records[0].tinType).toBe("ein");
  });

  it("filters to target service codes when provided", async () => {
    const other = JSON.stringify({
      negotiated_arrangement: "ffs",
      name: "Office visit",
      billing_code_type: "CPT",
      billing_code_type_version: "2025",
      billing_code: "99213",
      description: "OV",
      negotiated_rates: [
        { negotiated_prices: [{ negotiated_type: "negotiated", negotiated_rate: 120.0, expiration_date: "2026-12-31", billing_class: "professional" }], provider_references: [1] },
      ],
    });
    const mrf = fixtureMrf({ extraItems: [other] });
    const all = await extractRatesFromMrf(streamOf(mrf), OPTS);
    expect(all.stats.inNetworkItemsScanned).toBe(2);
    expect(all.rows.map((r) => r.serviceCode).sort()).toEqual(["99213", "99285"]);
    const filtered = await extractRatesFromMrf(streamOf(mrf), { ...OPTS, serviceCodes: new Set(["99285"]) });
    expect(filtered.rows.map((r) => r.serviceCode)).toEqual(["99285"]);
  });

  it("skips derived/percentage negotiated types (not contracted dollar rates)", async () => {
    const item = JSON.stringify({
      negotiated_arrangement: "ffs",
      name: "X",
      billing_code_type: "CPT",
      billing_code_type_version: "2025",
      billing_code: "99285",
      description: "X",
      negotiated_rates: [
        { negotiated_prices: [{ negotiated_type: "percentage", negotiated_rate: 140.0, expiration_date: "2026-12-31", billing_class: "professional" }], provider_references: [1] },
      ],
    });
    const { stats, rows } = await extractRatesFromMrf(streamOf(fixtureMrf({ extraItems: [item], billingCode: "99286" })), OPTS);
    // One negotiated row kept (99286), percentage row skipped.
    expect(stats.negotiatedPriceRowsScanned).toBe(2);
    expect(rows).toHaveLength(1);
  });

  it("dedupes repeated contract rates across provider groups (one rate per contract, 149.140(b)(1))", async () => {
    const { records, rows } = await extractRatesFromMrf(streamOf(fixtureMrf({ nProviders: 5 })), OPTS);
    expect(records).toHaveLength(5);
    expect(rows).toHaveLength(1); // same payer/code/rate/arrangement => one contracted-rate observation
  });

  it("flags a dominant template rate as a suspected ghost rate and excludes it by default", async () => {
    // 25 provider groups share one rate for 99285 => heuristic flags it.
    const { rows, stats } = await extractRatesFromMrf(streamOf(fixtureMrf({ nProviders: 25 })), OPTS);
    expect(stats.ghostFlaggedPairs).toHaveLength(1);
    expect(stats.ghostFlaggedPairs[0]).toMatchObject({ serviceCode: "99285", negotiatedRateCents: 45000, providerGroups: 25, shareOfCode: 1 });
    expect(stats.ghostFlaggedRows).toBe(25);
    expect(rows).toHaveLength(0); // excluded by default
  });

  it("includeGhostFlagged retains flagged rows for documented review", async () => {
    const { rows, stats } = await extractRatesFromMrf(streamOf(fixtureMrf({ nProviders: 25 })), { ...OPTS, includeGhostFlagged: true });
    expect(stats.ghostFlaggedRows).toBe(25);
    expect(rows).toHaveLength(1); // deduped observation retained
  });

  it("does not flag when no single rate dominates a code", async () => {
    const alt = JSON.stringify({
      negotiated_arrangement: "ffs",
      name: "ED",
      billing_code_type: "CPT",
      billing_code_type_version: "2025",
      billing_code: "99285",
      description: "ED",
      negotiated_rates: [
        { negotiated_prices: [{ negotiated_type: "negotiated", negotiated_rate: 500.0, expiration_date: "2026-12-31", billing_class: "professional" }], provider_references: [3, 4] },
      ],
    });
    // 2 groups at 450.00, 2 at 500.00 => 50/50 split, no dominant share.
    const { stats, rows } = await extractRatesFromMrf(streamOf(fixtureMrf({ nProviders: 2, extraItems: [alt] })), OPTS);
    expect(stats.ghostFlaggedPairs).toHaveLength(0);
    expect(rows).toHaveLength(2);
  });

  it("rejects a malformed effectiveDate option", async () => {
    await expect(extractRatesFromMrf(streamOf(fixtureMrf()), { ...OPTS, effectiveDate: "01/15/2019" })).rejects.toThrow(
      /effectiveDate/
    );
  });
});

describe("ingestMrfSource / runMrfIngestionFromEnv — batching, idempotency, env gating", () => {
  const src: MrfSourceDescriptor = {
    url: "file:///tmp/nonexistent.json",
    payerId: "PAYER-A",
    market: "SELF_INSURED",
    region: "TX-MSA-12420",
    effectiveDate: "2019-01-15",
  };

  it("refuses to run unless QPA_INGEST_ENABLED is exactly 'true' (fail-closed)", async () => {
    const store = createInMemoryStore();
    await expect(runMrfIngestionFromEnv(store, {})).rejects.toThrow(/QPA_INGEST_ENABLED/);
    await expect(runMrfIngestionFromEnv(store, { QPA_INGEST_ENABLED: "1" })).rejects.toThrow(/QPA_INGEST_ENABLED/);
  });

  it("refuses when QPA_MRF_SOURCES is missing or malformed", async () => {
    const store = createInMemoryStore();
    await expect(runMrfIngestionFromEnv(store, { QPA_INGEST_ENABLED: "true" })).rejects.toThrow(/QPA_MRF_SOURCES/);
    await expect(
      runMrfIngestionFromEnv(store, { QPA_INGEST_ENABLED: "true", QPA_MRF_SOURCES: "{nope" })
    ).rejects.toThrow(/not valid JSON/);
    await expect(
      runMrfIngestionFromEnv(store, { QPA_INGEST_ENABLED: "true", QPA_MRF_SOURCES: "[]" })
    ).rejects.toThrow(/non-empty/);
  });

  it("ingests a fixture file end-to-end and replays idempotently by content hash", async () => {
    const fs = await import("node:fs/promises");
    const path = "/tmp/fixture-mrf.json";
    await fs.writeFile(path, fixtureMrf({ nProviders: 3 }));
    const store = createInMemoryStore();
    const s = { ...src, url: `file://${path}` };
    const first = await ingestMrfSource(s, store);
    expect(first.batch.idempotentReplay).toBe(false);
    expect(first.batch.accepted).toHaveLength(1);
    expect(first.stats.sourceRef).toBe(`file://${path}`);
    const second = await ingestMrfSource(s, store);
    expect(second.batch.idempotentReplay).toBe(true);
    expect(second.batch.batchId).toBe(first.batch.batchId);
    expect(store.batches.size).toBe(1); // resumable: re-run short-circuits
  });

  it("ingested MRF rows feed the statutory median directly", async () => {
    const fs = await import("node:fs/promises");
    const path = "/tmp/fixture-mrf-2.json";
    // Three distinct rates via three items => median computable.
    const items = [420.0, 450.0, 510.0].map((rate) =>
      JSON.stringify({
        negotiated_arrangement: "ffs",
        name: "ED",
        billing_code_type: "CPT",
        billing_code_type_version: "2025",
        billing_code: "99285",
        description: "ED",
        negotiated_rates: [
          { negotiated_prices: [{ negotiated_type: "negotiated", negotiated_rate: rate, expiration_date: "2026-12-31", billing_class: "professional" }], provider_references: [1] },
        ],
      })
    );
    await fs.writeFile(path, fixtureMrf({ extraItems: items.slice(1), billingCode: "99285", rate: 420.0, nProviders: 1 }));
    const store = createInMemoryStore();
    const res = await ingestMrfSource({ ...src, url: `file://${path}` }, store);
    expect(res.batch.accepted).toHaveLength(3);
    const med = computeMedianContractedRate(res.batch.accepted, {
      serviceCode: "99285",
      market: "SELF_INSURED",
      region: "TX-MSA-12420",
      asOfDate: QPA_BASELINE_DATE,
    });
    expect(med.computable).toBe(true);
    expect(med.medianCents).toBe(45000);
  });
});
