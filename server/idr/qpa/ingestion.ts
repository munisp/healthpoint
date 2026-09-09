/**
 * server/idr/qpa/ingestion.ts
 *
 * Contracted-rate ingestion interface for the statutory QPA engine.
 *
 * Canonical validated schema: every contracted-rate source — Transparency-in-
 * Coverage machine-readable files (TiC MRF), direct payer files, or manual
 * entry — MUST land in the validated shape defined here before the QPA
 * engine will consider it. NOTE: real TiC MRF ingestion (multi-GB JSON
 * streaming, in-network negotiated-rates extraction) is a separate large
 * pipeline; this module defines the canonical validated target schema and the
 * provenance/idempotency contract both that pipeline and payer-file/manual
 * ingestion must satisfy.
 *
 * Validation rules mirror 45 CFR 149.140 definitions (see methodology.ts
 * header; eCFR accessed 2026-09-07).
 *
 * Idempotency: a batch is idempotent by content hash — re-submitting the same
 * canonical rows under the same provenance yields the same batchId and does
 * not duplicate rows (content-addressed dedupe, like the sibling
 * submission-automation store pattern).
 */

import { createHash } from "node:crypto";
import {
  ARRANGEMENT_TYPES,
  INSURANCE_MARKETS,
  type ArrangementType,
  type ContractedRateRow,
  type InsuranceMarket,
} from "./methodology";

export type ProvenanceSourceType = "TIC_MRF" | "PAYER_FILE" | "MANUAL";

export interface IngestionProvenance {
  sourceType: ProvenanceSourceType;
  /** Source reference: MRF URL/object key, payer file identifier, or manual ticket. */
  sourceRef: string;
  /** When the source data was imported (server time of ingestion). */
  importedAt: Date | string;
}

export interface RowValidationError {
  rowIndex: number;
  field: string;
  reason: string;
}

export interface ValidatedRate extends ContractedRateRow {
  effectiveDate: string; // ISO day
  /** sha256 of the canonical row — per-row dedupe key. */
  rowHash: string;
}

export interface IngestionBatch {
  batchId: string;
  contentHash: string;
  provenance: IngestionProvenance;
  totalRows: number;
  accepted: ValidatedRate[];
  rejected: RowValidationError[];
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function toIsoDay(d: Date | string): string | null {
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  const s = String(d).slice(0, 10);
  return ISO_DAY.test(s) ? s : null;
}

function isPositiveIntCents(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/** Validate one raw row; returns null when valid, else an error list. */
export function validateRow(raw: unknown, rowIndex: number): RowValidationError[] {
  const errs: RowValidationError[] = [];
  const err = (field: string, reason: string) => errs.push({ rowIndex, field, reason });
  if (typeof raw !== "object" || raw === null) {
    err("row", "row must be an object");
    return errs;
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.payerId !== "string" || r.payerId.trim().length === 0) err("payerId", "required non-empty string");
  if (typeof r.serviceCode !== "string" || !/^[A-Z0-9]{3,7}$/i.test(r.serviceCode.trim()))
    err("serviceCode", "required CPT/HCPCS/DRG-style code (149.140(a)(14))");
  if (typeof r.market !== "string" || !INSURANCE_MARKETS.includes(r.market as InsuranceMarket))
    err("market", `must be one of ${INSURANCE_MARKETS.join(", ")} (149.140(a)(8))`);
  if (typeof r.region !== "string" || r.region.trim().length === 0)
    err("region", "required geographic region key (149.140(a)(7))");
  if (!isPositiveIntCents(r.contractedRateCents))
    err("contractedRateCents", "required positive integer cents (149.140(a)(1) total amount incl. cost sharing)");
  if (typeof r.arrangementType !== "string" || !ARRANGEMENT_TYPES.includes(r.arrangementType as ArrangementType))
    err("arrangementType", `must be one of ${ARRANGEMENT_TYPES.join(", ")}`);
  if (toIsoDay(r.effectiveDate as Date | string) === null)
    err("effectiveDate", "required valid date (ISO day)");

  for (const f of ["underlyingFeeScheduleCents", "derivedAmountCents"] as const) {
    if (r[f] != null && !isPositiveIntCents(r[f]))
      err(f, "when present must be positive integer cents (149.140(b)(2)(iii))");
  }
  if (r.claimsSharePercent != null) {
    const v = r.claimsSharePercent;
    if (typeof v !== "number" || v < 0 || v > 100)
      err("claimsSharePercent", "when present must be 0–100 (149.140(a)(15)(ii)(B) / ghost-rate documentation)");
  }
  return errs;
}

/** Canonicalize a raw row after validation. Throws if invalid. */
export function canonicalizeRow(raw: unknown, rowIndex: number): ValidatedRate {
  const errs = validateRow(raw, rowIndex);
  if (errs.length) throw new Error(`row ${rowIndex} invalid: ${errs.map(e => `${e.field}: ${e.reason}`).join("; ")}`);
  const r = raw as Record<string, unknown>;
  const out: ValidatedRate = {
    payerId: String(r.payerId).trim(),
    serviceCode: String(r.serviceCode).trim().toUpperCase(),
    market: r.market as InsuranceMarket,
    region: String(r.region).trim(),
    contractedRateCents: r.contractedRateCents as number,
    arrangementType: r.arrangementType as ArrangementType,
    effectiveDate: toIsoDay(r.effectiveDate as Date | string)!,
    ...(r.underlyingFeeScheduleCents != null ? { underlyingFeeScheduleCents: r.underlyingFeeScheduleCents as number } : {}),
    ...(r.derivedAmountCents != null ? { derivedAmountCents: r.derivedAmountCents as number } : {}),
    ...(r.claimsSharePercent != null ? { claimsSharePercent: r.claimsSharePercent as number } : {}),
    rowHash: "",
  };
  out.rowHash = sha256(canonicalRowString(out));
  return out;
}

function canonicalRowString(r: ValidatedRate): string {
  return [
    r.payerId, r.serviceCode, r.market, r.region, r.contractedRateCents,
    r.arrangementType, r.effectiveDate,
    r.underlyingFeeScheduleCents ?? "", r.derivedAmountCents ?? "", r.claimsSharePercent ?? "",
  ].join("|");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function validateProvenance(p: IngestionProvenance): string[] {
  const errs: string[] = [];
  if (!p || typeof p !== "object") return ["provenance required"];
  if (!["TIC_MRF", "PAYER_FILE", "MANUAL"].includes(p.sourceType)) errs.push("provenance.sourceType must be TIC_MRF | PAYER_FILE | MANUAL");
  if (typeof p.sourceRef !== "string" || !p.sourceRef.trim()) errs.push("provenance.sourceRef required");
  if (toIsoDay(p.importedAt) === null) errs.push("provenance.importedAt must be a valid date");
  return errs;
}

/**
 * Pluggable persistence interface. The Postgres implementation is provided
 * separately (drizzle/schema-qpa.ts + migration 0031); tests and the tRPC
 * layer may inject any implementation. Methods must be idempotent as
 * documented on ingestContractedRates.
 */
export interface ContractedRateStore {
  /** Returns existing batch id for a contentHash, or null. */
  findBatchByContentHash(contentHash: string): Promise<string | null>;
  /** Persist batch + rows (must dedupe rows by rowHash within the store). */
  persistBatch(batch: IngestionBatch): Promise<void>;
}

/**
 * Validate and canonicalize a batch of contracted-rate rows with provenance.
 * - Invalid rows are rejected WITH REASONS; the batch still carries the valid
 *   subset (rejection is recorded, never silently dropped).
 * - Idempotent by content hash: contentHash = sha256(sorted rowHashes +
 *   provenance). Re-ingesting identical content returns the same batchId.
 */
export async function ingestContractedRates(
  rows: unknown[],
  provenance: IngestionProvenance,
  store?: ContractedRateStore
): Promise<IngestionBatch & { idempotentReplay: boolean }> {
  const provErrs = validateProvenance(provenance);
  if (provErrs.length) throw new Error(`invalid provenance: ${provErrs.join("; ")}`);

  const accepted: ValidatedRate[] = [];
  const rejected: RowValidationError[] = [];
  (rows ?? []).forEach((raw, i) => {
    const errs = validateRow(raw, i);
    if (errs.length) rejected.push(...errs);
    else accepted.push(canonicalizeRow(raw, i));
  });

  // Dedupe identical rows within the batch by rowHash (keep first).
  const seen = new Set<string>();
  const deduped = accepted.filter(r => (seen.has(r.rowHash) ? false : (seen.add(r.rowHash), true)));

  const contentHash = sha256(
    deduped.map(r => r.rowHash).sort().join(",") +
    `#${provenance.sourceType}|${provenance.sourceRef}|${toIsoDay(provenance.importedAt)}`
  );

  if (store) {
    const existing = await store.findBatchByContentHash(contentHash);
    if (existing) {
      return {
        batchId: existing, contentHash, provenance,
        totalRows: rows?.length ?? 0, accepted: deduped, rejected,
        idempotentReplay: true,
      };
    }
  }

  const batch: IngestionBatch = {
    batchId: `qpa_${contentHash.slice(0, 24)}`,
    contentHash,
    provenance: { ...provenance, importedAt: toIsoDay(provenance.importedAt)! },
    totalRows: rows?.length ?? 0,
    accepted: deduped,
    rejected,
  };
  if (store) await store.persistBatch(batch);
  return { ...batch, idempotentReplay: false };
}

/** In-memory store for tests and for deployments pending migration 0031. */
export function createInMemoryStore(): ContractedRateStore & {
  batches: Map<string, IngestionBatch>;
  byHash: Map<string, string>;
} {
  const batches = new Map<string, IngestionBatch>();
  const byHash = new Map<string, string>();
  return {
    batches,
    byHash,
    async findBatchByContentHash(contentHash) {
      return byHash.get(contentHash) ?? null;
    },
    async persistBatch(batch) {
      batches.set(batch.batchId, batch);
      byHash.set(batch.contentHash, batch.batchId);
    },
  };
}
