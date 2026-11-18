/**
 * Phase 21 (S2b) unit tests: quarantine-row reparse suggestions.
 * Org-prior n>=5 gating and the end-to-end repair flow are DB-backed and
 * covered in server/routers/wave-p21.test.ts.
 */
import { describe, it, expect } from "vitest";
import { reparseQuarantineRow, ORG_PRIOR_MIN_ACCEPTS } from "./intelligence";

function claimNdjson(): string {
  return JSON.stringify({
    resourceType: "Claim",
    id: "clm-1",
    identifier: [{ value: "CLM-1" }],
    status: "active",
    patient: { reference: "Patient/pat-1" },
    billablePeriod: { start: "2026-08-01", end: "2026-08-01" },
    insurer: { reference: "Organization/payer", display: "AETNA HEALTH" },
    item: [{ sequence: 1, productOrService: { coding: [{ system: "http://www.ama-assn.org/go/cpt", code: "99285" }] }, servicedDate: "2026-08-01" }],
    total: { value: 4200.0, currency: "USD" },
  });
}

describe("reparseQuarantineRow", () => {
  it("suggests normalized values for missing fields from ndjson", async () => {
    const out = await reparseQuarantineRow("ndjson", claimNdjson(), ["claimId", "patientState"]);
    const byField = new Map(out.map(s => [s.field, s]));
    expect(byField.get("claimId")?.source).toBe("reparse");
    expect(byField.get("claimId")?.suggestedValue).toBe("CLM-1");
    // patientState is absent from the payload → honestly omitted
    expect(byField.has("patientState")).toBe(false);
  });

  it("returns no suggestions for csv rows (headers are not in raw_payload)", async () => {
    const out = await reparseQuarantineRow("csv", "CLM-1,tx,2026-08-01", ["claimId"]);
    expect(out).toEqual([]);
  });

  it("returns no suggestions for unparseable payloads (fail-quiet, no fabrication)", async () => {
    const out = await reparseQuarantineRow("ndjson", '{"resourceType":"Claim","id":"broken"', ["claimId"]);
    expect(out).toEqual([]);
  });

  it("returns no suggestions when nothing is missing", async () => {
    expect(await reparseQuarantineRow("ndjson", claimNdjson(), [])).toEqual([]);
  });

  it("org-prior gate is 5 accepts", () => {
    expect(ORG_PRIOR_MIN_ACCEPTS).toBe(5);
  });
});
