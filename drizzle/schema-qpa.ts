/**
 * drizzle/schema-qpa.ts
 *
 * Persistence tables for the statutory QPA engine (server/idr/qpa/):
 *
 * - qpa_contracted_rates: validated contracted-rate rows landed by
 *   ingestContractedRates (TiC MRF, payer file, or manual provenance). This is
 *   the canonical storage both the future Transparency-in-Coverage MRF
 *   pipeline and payer-file/manual ingestion must write into.
 * - qpa_ingestion_batches: one row per ingestion batch; contentHash is UNIQUE
 *   which makes batch ingestion idempotent (replays short-circuit).
 * - qpa_cpi_factors: effective-dated cumulative CPI-U factors from the 2019
 *   baseline (published Treasury/IRS increases per 45 CFR 149.140(c)(1)),
 *   stored as NUMERIC(20,10) to avoid float drift. The engine fails closed
 *   when a requested year has no row.
 *
 * House style follows drizzle/schema-submission-automation.ts: separate
 * module to avoid concurrent-edit conflicts on the shared schema.ts; the
 * one-line re-export is intentionally NOT added to drizzle/schema.ts in this
 * wave. Applied by hand-written migration
 * drizzle/migrations/0031_qpa_tables.sql.
 */

import {
  pgTable,
  varchar,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const qpaContractedRates = pgTable(
  "qpa_contracted_rates",
  {
    id: varchar("id", { length: 80 }).primaryKey(), // batchId:rowHash
    batchId: varchar("batchId", { length: 64 }).notNull(),
    payerId: varchar("payerId", { length: 128 }).notNull(),
    serviceCode: varchar("serviceCode", { length: 16 }).notNull(),
    // 45 CFR 149.140(a)(8) insurance market.
    market: varchar("market", { length: 32 }).notNull(),
    // 45 CFR 149.140(a)(7) geographic region key (MSA-in-state / remainder / Census-division fallback).
    region: varchar("region", { length: 128 }).notNull(),
    // 45 CFR 149.140(a)(1) total amount (including cost sharing), integer cents.
    contractedRateCents: integer("contractedRateCents").notNull(),
    arrangementType: varchar("arrangementType", { length: 32 }).notNull(),
    // ISO day (YYYY-MM-DD) — contract effective date.
    effectiveDate: varchar("effectiveDate", { length: 10 }).notNull(),
    // 45 CFR 149.140(b)(2)(iii) non-FFS substitution rates.
    underlyingFeeScheduleCents: integer("underlyingFeeScheduleCents"),
    derivedAmountCents: integer("derivedAmountCents"),
    // 45 CFR 149.140(a)(15)(ii)(B) claims share / ghost-rate documentation hook.
    claimsSharePercent: numeric("claimsSharePercent", { precision: 5, scale: 2 }),
    // sha256 of the canonical row (per-row dedupe key).
    rowHash: varchar("rowHash", { length: 64 }).notNull(),
    provenance: jsonb("provenance").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("qpa_rates_dimension_idx").on(t.serviceCode, t.market, t.region, t.effectiveDate),
    index("qpa_rates_batch_idx").on(t.batchId),
    uniqueIndex("qpa_rates_rowhash_idx").on(t.rowHash),
  ]
);

export const qpaIngestionBatches = pgTable(
  "qpa_ingestion_batches",
  {
    batchId: varchar("batchId", { length: 64 }).primaryKey(),
    // UNIQUE — content-addressed idempotency.
    contentHash: varchar("contentHash", { length: 64 }).notNull(),
    sourceType: varchar("sourceType", { length: 16 }).notNull(), // TIC_MRF | PAYER_FILE | MANUAL
    sourceRef: text("sourceRef").notNull(),
    importedAt: varchar("importedAt", { length: 10 }).notNull(), // ISO day
    totalRows: integer("totalRows").notNull(),
    acceptedRows: integer("acceptedRows").notNull(),
    rejectedRows: integer("rejectedRows").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("qpa_batches_content_hash_idx").on(t.contentHash)]
);

export const qpaCpiFactors = pgTable(
  "qpa_cpi_factors",
  {
    // Calendar year; factor is the cumulative CPI-U multiplier from the 2019
    // baseline (2019 => exactly 1), per 45 CFR 149.140(c)(1)(i)/(ii).
    year: integer("year").primaryKey(),
    factor: numeric("factor", { precision: 20, scale: 10 }).notNull(),
    // Publication reference (e.g., IRS guidance / Federal Register cite).
    publicationRef: text("publicationRef"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  }
);
