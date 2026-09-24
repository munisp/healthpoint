/**
 * server/csv-import.ts
 *
 * RFC-4180-compliant CSV parsing and dispute-import row validation.
 *
 * Replaces the naive `line.split(",")` import path which silently corrupted
 * any field containing a comma, quote, or embedded newline.
 *
 * RFC-4180 rules implemented:
 *  - Fields may be enclosed in double quotes; quotes are stripped.
 *  - Inside a quoted field, "" is an escaped literal double quote.
 *  - Quoted fields may contain commas, CR, and LF (embedded newlines).
 *  - Records are separated by CRLF (LF-only and CR-only tolerated).
 *  - A field containing a quote char anywhere except a properly quoted
 *    field is treated literally (lenient mode, matching common parsers).
 */

export interface CsvParseResult {
  /** All rows including the header row. */
  rows: string[][];
  /** 1-based CSV line numbers (in the original content) for each row start. */
  rowLines: number[];
  /** Non-fatal parse diagnostics. */
  warnings: string[];
}

/** Parse CSV content into rows of string fields (RFC-4180). */
export function parseCsv(content: string): CsvParseResult {
  const rows: string[][] = [];
  const rowLines: number[] = [];
  const warnings: string[] = [];

  let field = "";
  let row: string[] = [];
  let rowStartLine = 1;
  let line = 1;
  let i = 0;
  let inQuotes = false;
  let fieldWasQuoted = false;
  const n = content.length;

  const pushField = () => {
    row.push(field);
    field = "";
    fieldWasQuoted = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    rowLines.push(rowStartLine);
    row = [];
    rowStartLine = line;
  };

  while (i < n) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < n && content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (ch === "\n") line++;
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "" && !fieldWasQuoted) {
      inQuotes = true;
      fieldWasQuoted = true;
      i++;
      continue;
    }
    if (ch === ",") {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r") {
      // CRLF or lone CR terminates the record.
      if (i + 1 < n && content[i + 1] === "\n") i++;
      line++;
      pushRow();
      i++;
      continue;
    }
    if (ch === "\n") {
      line++;
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (inQuotes) {
    warnings.push(`Unterminated quoted field starting near line ${rowStartLine}`);
  }
  // Flush the final record if any content was seen.
  if (field !== "" || row.length > 0) {
    pushRow();
  }
  return { rows, rowLines, warnings };
}

// ── Dispute-import validation ───────────────────────────────────────────────

/** Maximum data rows accepted per import (excludes the header row). */
export const CSV_IMPORT_ROW_CAP = 1000;
/** Rows are committed in batches of this size. */
export const CSV_IMPORT_BATCH_SIZE = 500;

export interface DisputeImportRow {
  referenceNumber?: string;
  initiatingPartyType?: string;
  initiatingPartyName?: string;
  respondingPartyType?: string;
  respondingPartyName: string;
  billedAmount: string;
  qpaAmount: string | null;
  serviceType: string;
  /** Validated ISO calendar date. */
  serviceDate: Date;
  /** Required, 2-letter state code — never defaulted/fabricated. */
  patientState: string;
  /** Required, 2-letter state code — never defaulted/fabricated. */
  facilityState: string;
  cptCodes: string[];
}

export interface RowError {
  /** 1-based data-row number (row 1 = first row after the header). */
  row: number;
  message: string;
  /** Original raw fields for error-CSV reconstruction. */
  raw: string[];
}

export interface ValidatedImport {
  valid: DisputeImportRow[];
  errors: RowError[];
  /** CSV document containing only the failed rows plus an `error` column. */
  errorCsv: string | null;
  truncated: boolean;
}

const STATE_RE = /^[A-Za-z]{2}$/;

/** Strict ISO calendar date (YYYY-MM-DD or full ISO-8601 timestamp). */
export function parseIsoDate(value: string): Date | null {
  const v = value.trim();
  if (!v) return null;
  // Date-only form must be a real calendar date (reject 2026-02-30).
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(v);
  if (!m) return null;
  const d = new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v);
  if (Number.isNaN(d.getTime())) return null;
  if (v.length === 10) {
    const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (d.getUTCFullYear() !== y || d.getUTCMonth() + 1 !== mo || d.getUTCDate() !== da) return null;
  }
  return d;
}

/** Escape one field for CSV output (RFC-4180). */
export function csvEscape(field: string): string {
  if (/[",\r\n]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

/**
 * Validate parsed CSV rows into dispute-import records.
 *
 * Required columns: serviceDate (ISO date), patientState, facilityState, and
 * one of respondingPartyName|payer. No state values are ever fabricated —
 * rows missing them are rejected with per-row errors.
 */
export function validateDisputeRows(parsed: CsvParseResult): ValidatedImport {
  const { rows } = parsed;
  if (rows.length === 0) {
    return { valid: [], errors: [{ row: 0, message: "CSV must have a header row", raw: [] }], errorCsv: null, truncated: false };
  }
  const headers = rows[0].map(h => h.trim().replace(/^﻿/, ""));
  const col = (name: string) => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const pick = (r: string[], ...names: string[]) => {
    for (const nm of names) {
      const idx = col(nm);
      if (idx >= 0 && r[idx] !== undefined && r[idx].trim() !== "") return r[idx].trim();
    }
    return "";
  };

  let dataRows = rows.slice(1).map((r, i) => ({ r, n: i + 1 }));
  // Drop fully-blank trailing/embedded lines.
  dataRows = dataRows.filter(({ r }) => r.some(f => f.trim() !== ""));
  const truncated = dataRows.length > CSV_IMPORT_ROW_CAP;
  if (truncated) dataRows = dataRows.slice(0, CSV_IMPORT_ROW_CAP);

  const valid: DisputeImportRow[] = [];
  const errors: RowError[] = [];

  for (const { r, n } of dataRows) {
    const rowErrors: string[] = [];
    const respondingPartyName = pick(r, "respondingPartyName", "payer");
    if (!respondingPartyName) rowErrors.push("missing respondingPartyName/payer");

    const serviceDateRaw = pick(r, "serviceDate", "dateOfService", "service_date");
    const serviceDate = serviceDateRaw ? parseIsoDate(serviceDateRaw) : null;
    if (!serviceDateRaw) rowErrors.push("missing required column serviceDate");
    else if (!serviceDate) rowErrors.push(`invalid serviceDate "${serviceDateRaw}" (expected ISO date YYYY-MM-DD)`);

    const patientState = pick(r, "patientState");
    if (!patientState) rowErrors.push("missing required column patientState");
    else if (!STATE_RE.test(patientState)) rowErrors.push(`invalid patientState "${patientState}" (expected 2-letter code)`);

    const facilityState = pick(r, "facilityState");
    if (!facilityState) rowErrors.push("missing required column facilityState");
    else if (!STATE_RE.test(facilityState)) rowErrors.push(`invalid facilityState "${facilityState}" (expected 2-letter code)`);

    const billedAmount = pick(r, "billedAmount", "billed");
    if (billedAmount && Number.isNaN(Number(billedAmount))) rowErrors.push(`invalid billedAmount "${billedAmount}"`);

    if (rowErrors.length) {
      errors.push({ row: n, message: rowErrors.join("; "), raw: r });
      continue;
    }
    valid.push({
      referenceNumber: pick(r, "referenceNumber", "reference") || undefined,
      initiatingPartyType: pick(r, "initiatingPartyType") || undefined,
      initiatingPartyName: pick(r, "initiatingPartyName", "provider") || undefined,
      respondingPartyType: pick(r, "respondingPartyType") || undefined,
      respondingPartyName,
      billedAmount: billedAmount || "0",
      qpaAmount: pick(r, "qpaAmount", "qpa") || null,
      serviceType: pick(r, "serviceType", "service") || "emergency_medicine",
      serviceDate: serviceDate!,
      patientState: patientState.toUpperCase(),
      facilityState: facilityState.toUpperCase(),
      cptCodes: pick(r, "cptCodes") ? pick(r, "cptCodes").split(";").map(s => s.trim()).filter(Boolean) : [],
    });
  }

  const errorCsv = errors.length
    ? [headers.concat(["error"]).map(csvEscape).join(","),
       ...errors.map(e => e.raw.concat([e.message]).map(csvEscape).join(","))].join("\r\n")
    : null;

  return { valid, errors, errorCsv, truncated };
}
