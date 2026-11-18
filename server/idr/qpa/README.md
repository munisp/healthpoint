# server/idr/qpa — statutory QPA engine (45 CFR 149.140)

## What this replaces

`calculateQPA` in `server/db.ts` reads the hand-written `qpaBenchmarks` seed
table (~18 illustrative CPT rows) and applies `qpaStateModifiers`. Those rows
are illustrative demo data — they are not contracted rates, were not computed
per the §149.140 methodology, and must not be represented as statutory QPAs
in production. This directory is the real foundation:

- `methodology.ts` — the §149.140 median-of-contracted-rates methodology with
  per-rule eCFR citations: insurance-market and geographic-region grouping
  ((a)(7)/(a)(8)), single-case-agreement exclusion ((a)(1)), non-FFS
  underlying-fee-schedule/derived-amount substitution ((b)(2)(iii)),
  incentive/retrospective-adjustment exclusion ((b)(2)(iv)), the ≥3-rate /
  ≥25%-of-claims sufficient-information tests ((a)(15)), Jan 31, 2019 baseline
  and CPI-U indexing ((c)(1)(i)/(ii); annual percentage increases published by
  Treasury/IRS — e.g., Rev. Proc. 2022-11 combined 2019–2021 factor
  1.0648523983; Notice 2025-12 series for later years).
- `engine.ts` — `computeQPA(...)`: median at the 2019 baseline × cumulative
  CPI-U factor to the service year. **Fail-closed**: insufficient rates or a
  missing CPI factor returns `computable:false, qpaCents:null` with the
  §149.140(c)(3) `ELIGIBLE_DATABASE_REQUIRED` marker. It never returns an
  illustrative or default number.
- `ingestion.ts` — canonical validated contracted-rate schema + provenance +
  content-hash-idempotent batches (all sources land here: TiC MRF, payer
  file, manual).
- `mrf-ingestion.ts` — Transparency-in-Coverage in-network MRF streaming
  pipeline (see below).
- `routes.ts` — `qpaEngineRouter` (registered in `server/routers.ts` as
  `qpaEngine`): `compute` (fail-closed), `ingest` (admin, idempotent),
  `ingestionStatus` (admin), `methodology` (public statement + citations).
- `drizzle/schema-qpa.ts` + `drizzle/migrations/0031_qpa_tables.sql` —
  `qpa_contracted_rates`, `qpa_ingestion_batches` (contentHash UNIQUE),
  `qpa_cpi_factors`.

## Data acquisition reality

There is no shortcut to real QPAs — the statutory inputs are **the plan's own
contracted rates**. Realistic sources, in order of fidelity:

1. **Payer/TPA contracted-rate extracts** (the actual statutory input). For a
   provider-facing product these arrive as client-specific data feeds, not
   public data.
2. **Transparency-in-Coverage in-network MRFs.** Public and payer-published
   (CMS enforcement of TiC is ongoing; files must be posted monthly), but
   they are enormous (national payers: tens to hundreds of GB of JSON per
   file), schema-drift-prone, and carry known data-quality problems —
   including "ghost rates" (rates on paper for providers who never render the
   service; a TMA III litigation subject). `mrf-ingestion.ts` streams these
   files, extracts target service codes, normalizes NPI/TIN/code/rate/
   billing-class, dedupes, applies a documented ghost-rate heuristic, and
   lands rows through the idempotent ingestion path. Note TiC MRFs do not
   carry the §149.140 insurance-market or geographic-region keys — those are
   operator-supplied per-file metadata (`market`, `region` on the source
   descriptor), and the engine refuses to guess them.
3. **Purchased rate datasets / eligible databases** (e.g., state APCDs —
   categorically eligible under (c)(3) — or commercial benchmarks). Land via
   the same `ingestContractedRates` path with `PAYER_FILE` provenance.

CPI-U factors are **not shipped**. They must be loaded into
`qpa_cpi_factors` (or injected via `QPA_CPI_FACTORS_JSON`) from the published
Treasury/IRS annual guidance (Rev. Proc. 2022-11; Notices 2024-1, 2025-12,
and successors). A year without a loaded factor is a hard failure,
never an estimate.

## MRF ingestion operations

```
QPA_INGEST_ENABLED=true   # exactly "true"; anything else refuses to run
QPA_MRF_SOURCES=[{
  "url": "file:///data/mrf/payer-a_in-network.json",   # or https://
  "payerId": "PAYER-A",
  "market": "SELF_INSURED",                            # 149.140(a)(8) market
  "region": "TX-MSA-12420",                            # 149.140(a)(7) region key
  "serviceCodes": ["99285", "99284"],                  # optional filter
  "effectiveDate": "2019-01-15"                        # contract effective date
}]
```

Runner: `runMrfIngestionFromEnv(store)` in `mrf-ingestion.ts`. Batches are
content-addressed, so resume = re-run (identical file → idempotent replay, no
duplicate rows). The parser fails closed on unsupported TiC schema versions,
schema drift, and truncated streams.

## Go-live checklist (before any statutory reliance)

- [ ] Apply `drizzle/migrations/0031_qpa_tables.sql` (validated against
      PostgreSQL 16.2 during remediation; table/column/index introspection
      confirmed).
- [ ] Load `qpa_cpi_factors` from the current IRS annual QPA guidance for
      every service year in scope; verify base-year row is exactly 1.
- [ ] Ingest the plan's contracted rates (client feed) or TiC MRFs with
      operator-verified market/region metadata; record provenance.
- [ ] Review ghost-rate heuristic flags before retaining any flagged rows.
- [ ] Confirm `qpaEngine.compute` returns `computable:true` for the target
      (serviceCode, market, region) universe; confirm fail-closed behavior on
      a known-empty dimension.
- [ ] Switch consumers off the illustrative `qpaBenchmarks` path; retain the
      demo router only behind an explicit non-production flag.
- [ ] Retain this README's citations with any QPA output surfaced to users or
      IDR entities.
