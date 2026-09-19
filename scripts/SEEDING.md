# Seeding: `scripts/seed-all.mts`

Comprehensive synthetic-data seeder for the HealthPoint NSA/Federal IDR platform.
Seeds **all 79 tables** (everything in `drizzle/schema.ts` plus the auxiliary
schema modules: `schema-idr-compliance`, `schema-fsm-cases`, `schema-qpa`,
`schema-push`, `schema-reconciliation`, `schema-submission-automation`) with
realistic, relationally coherent data.

## Usage

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55433/healthpoint \
  npx tsx scripts/seed-all.mts [--scale small|medium|large] [--seed 42] [--reset] [--allow-remote]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scale` | `medium` | Number of disputes: small=12, medium=60, large=300 (all child data scales with it). |
| `--seed` | `42` | Seed for the internal mulberry32 PRNG. Same seed + same scale => byte-identical rows (IDs, timestamps, amounts). |
| `--reset` | off | Truncates every seeded table in FK-safe (children-first) order before inserting. |
| `--allow-remote` | off | Required if the DB host is not localhost/127.0.0.1/::1. |

`DATABASE_URL` (or `EXTERNAL_POSTGRES_URL`) is read from the environment;
credentials are never hardcoded. The script refuses to run against a
non-localhost host without `--allow-remote`.

## Properties

- **Deterministic** — a single mulberry32 PRNG seeded by `--seed` drives every
  random choice; timestamps anchor to a fixed epoch (2026-09-05T12:00Z), never
  wall-clock time. Re-running with the same flags reproduces identical data.
- **Idempotent** — every insert is `ON CONFLICT ... DO NOTHING` against the
  primary key or a natural unique key (reference numbers, idempotency keys,
  hash-chain `(caseRowId, seq)`, etc.). Re-running is a no-op (`+0` rows).
  Use `--reset` for a clean reseed.
- **FSM-consistent** — dispute `currentStep`/`status` pairs follow
  `server/workflow/idr-workflow.ts` (`getStatusForStep`), with a full
  `dispute_events` timeline per dispute, offers inside the offer-submission
  window, determination fields for determined disputes, and appeals on a
  subset (STEP_18/19, `appealed` status, `dispute_appeals` rows).
- **Financially coherent** — determined disputes get double-entry ledger rows
  (`ledger_accounts` balances equal summed debits-minus-credits from
  `ledger_entries`); paid disputes get settlement transfers with approvals,
  HMAC-shaped callbacks, provider reports, reconciliations, and at least one
  exception review; `paidAmount` matches the determination.
- **Hash-chained logs** — `fsm_case_events` and
  `submission_automation_events` chains satisfy
  `eventHash = sha256(prevEventHash || canonicalEventJson)` per case,
  verifiable with the modules' `verifyEventChain()`.
- **Realistic reference data** — real payer names (Aetna, Cigna,
  UnitedHealthcare, BCBS of TX/FL/CA, Humana, Kaiser, Elevance, ...),
  plausible provider orgs (hospitals, ASCs, anesthesia/radiology/emergency
  groups), Luhn-valid NPIs (80840-prefixed), 9-digit TINs, real ICD-10/CPT
  codes, QPA benchmarks per CPT with state modifiers, CPI-U factors
  2019–2026, and statutory deadlines per 45 CFR 149.510 (30 BD open
  negotiation, 4 BD IDR initiation, 3 BD entity selection, 10 BD offers,
  30 BD determination, 30 calendar-day payment), computed with US federal
  holidays.

## Prerequisites

Apply migrations first (`drizzle/migrations/0000..0032`). Note the journal's
canonical 0017 is `0017_striped_molten_man.sql`; `0017_orange_marauders.sql`
is a byte-identical duplicate left in the folder — applying both fails on the
second (`type "changelog_category" already exists`). Apply one of them.

The legacy `scripts/seed.mjs` (28-dispute demo against `idr_demo`) is
unaffected and remains a valid small demo seed.

## Verification

Executed-verified against a local Postgres 16 (pgserver + TCP forwarder) at
`--scale medium`: 4,574 rows across 79 tables; second run inserted `+0` rows
(idempotent); `--reset` cleanly truncated and reseeded. Post-seed checks:
0 illegal step/status pairs, 0 unbalanced ledger accounts, 0 orphan
settlement transfers, 0 broken hash-chain links, 0 invalid NPI check digits.
