/**
 * Phase 19 unit tests: bulk-ingest mappers + line-splitting (pure; no DB).
 * DB-backed session lifecycle lives in server/routers/bulk-upload.test.ts
 * (live PG, skips without DATABASE_URL).
 */
import { describe, it, expect } from "vitest";
import {
  csvClaimRowToNormalized,
  remittance835ToNormalized,
  splitCompleteLines,
  sha256Hex,
  INGEST_BATCH_SIZE,
} from "./bulk-ingest";
import { BulkImportError } from "../emr/bulk-import";

describe("splitCompleteLines", () => {
  it("splits on newline boundaries and carries the partial tail", () => {
    const { lines, remainder } = splitCompleteLines('{"a":1}\n{"b":2}\n{"c"');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(remainder).toBe('{"c"');
  });
  it("returns everything as remainder when no newline exists", () => {
    const { lines, remainder } = splitCompleteLines("partial");
    expect(lines).toEqual([]);
    expect(remainder).toBe("partial");
  });
  it("handles chunk-boundary joins across two calls", () => {
    const a = splitCompleteLines("line1\nlin");
    const b = splitCompleteLines(a.remainder + "e2\nline3\n");
    expect(b.lines).toEqual(["line2", "line3"]);
    expect(b.remainder).toBe("");
  });
});

describe("csvClaimRowToNormalized", () => {
  const headers = ["claim_id", "patient_ref", "service_date", "cpt_codes", "billed_cents", "payer_id"];
  it("maps a well-formed row", () => {
    const c = csvClaimRowToNormalized(headers, ["C-1", "Patient/p1", "2026-08-14", "99285|99284", "420000", "60054"]);
    expect(c.claimId).toBe("C-1");
    expect(c.patientRef).toBe("Patient/p1");
    expect(c.cptCodes).toEqual(["99285", "99284"]);
    expect(c.billedCents).toBe(420000);
    expect(c.payerId).toBe("60054");
  });
  it("accepts billed_amount in dollars when billed_cents absent", () => {
    const c = csvClaimRowToNormalized(["claim_id", "billed_amount"], ["C-2", "4200.00"]);
    expect(c.billedCents).toBe(420000);
  });
  it("throws BulkImportError when claim_id missing", () => {
    expect(() => csvClaimRowToNormalized(headers, ["", "Patient/p1", "2026-08-14", "99285", "100", "60054"]))
      .toThrow(BulkImportError);
  });
});

describe("remittance835ToNormalized", () => {
  it("maps CLP fields; paidCents is honestly null (parser exposes billed/allowed only)", () => {
    const c = remittance835ToNormalized({
      claimId: "PCN-9", payerId: "60054", npi: "1234567893", cptCode: "99285",
      billedCents: 420000, allowedCents: 80000, carcCodes: ["45"], rarcCodes: [], idrEligibleFlag: true,
    });
    expect(c.claimId).toBe("PCN-9");
    expect(c.allowedCents).toBe(80000);
    expect(c.paidCents).toBeNull();
    expect(c.cptCodes).toEqual(["99285"]);
    expect(c.sourceResourceRefs).toEqual(["x12-835:PCN-9"]);
  });
});

describe("constants", () => {
  it("uses the design-mandated 500-row stage batch", () => {
    expect(INGEST_BATCH_SIZE).toBe(500);
  });
  it("sha256Hex hashes bytes deterministically", () => {
    expect(sha256Hex(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
