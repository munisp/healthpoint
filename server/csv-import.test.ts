import { describe, it, expect } from "vitest";
import {
  parseCsv,
  parseIsoDate,
  validateDisputeRows,
  csvEscape,
  CSV_IMPORT_ROW_CAP,
  CSV_IMPORT_BATCH_SIZE,
} from "./csv-import";

describe("parseCsv (RFC-4180)", () => {
  it("parses simple unquoted rows", () => {
    const { rows } = parseCsv("a,b,c\n1,2,3\n4,5,6");
    expect(rows).toEqual([["a", "b", "c"], ["1", "2", "3"], ["4", "5", "6"]]);
  });

  it("handles quoted fields containing commas", () => {
    const { rows } = parseCsv('name,note\n"Smith, John","paid, in full"');
    expect(rows[1]).toEqual(["Smith, John", "paid, in full"]);
  });

  it("handles escaped double quotes inside quoted fields", () => {
    const { rows } = parseCsv('q\n"He said ""hello"""');
    expect(rows[1]).toEqual(['He said "hello"']);
  });

  it("handles CRLF line endings", () => {
    const { rows } = parseCsv("a,b\r\n1,2\r\n3,4\r\n");
    expect(rows).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  it("handles embedded newlines inside quoted fields", () => {
    const { rows } = parseCsv('a,b\n"x\ny",2');
    expect(rows[1]).toEqual(["x\ny", "2"]);
  });

  it("handles mixed quoted/unquoted and empty fields", () => {
    const { rows } = parseCsv('a,b,c\n,"two",\n1,,3');
    expect(rows[1]).toEqual(["", "two", ""]);
    expect(rows[2]).toEqual(["1", "", "3"]);
  });

  it("handles lone CR line endings", () => {
    const { rows } = parseCsv("a,b\r1,2");
    expect(rows).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("warns on unterminated quoted field but recovers", () => {
    const { rows, warnings } = parseCsv('a\n"unclosed');
    expect(rows[1]).toEqual(["unclosed"]);
    expect(warnings.length).toBe(1);
  });

  it("handles a file ending without a trailing newline", () => {
    const { rows } = parseCsv("a,b\n1,2");
    expect(rows).toHaveLength(2);
  });

  it("round-trips through csvEscape", () => {
    const tricky = ['plain', 'with,comma', 'with"quote', "with\nnewline"];
    const line = tricky.map(csvEscape).join(",");
    expect(parseCsv(line).rows[0]).toEqual(tricky);
  });
});

describe("parseIsoDate", () => {
  it("accepts ISO date-only", () => {
    expect(parseIsoDate("2026-03-15")?.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });
  it("accepts full ISO timestamps", () => {
    expect(parseIsoDate("2026-03-15T10:30:00Z")).not.toBeNull();
  });
  it("rejects impossible calendar dates", () => {
    expect(parseIsoDate("2026-02-30")).toBeNull();
    expect(parseIsoDate("2026-13-01")).toBeNull();
  });
  it("rejects non-ISO formats", () => {
    expect(parseIsoDate("03/15/2026")).toBeNull();
    expect(parseIsoDate("March 15 2026")).toBeNull();
    expect(parseIsoDate("")).toBeNull();
    expect(parseIsoDate("not-a-date")).toBeNull();
  });
});

describe("validateDisputeRows", () => {
  const header = "referenceNumber,payer,serviceDate,patientState,facilityState,billedAmount";
  const goodRow = "REF-1,Aetna,2026-03-15,TX,TX,1200.00";

  it("validates a clean file", () => {
    const r = validateDisputeRows(parseCsv(`${header}\n${goodRow}`));
    expect(r.valid).toHaveLength(1);
    expect(r.errors).toHaveLength(0);
    expect(r.errorCsv).toBeNull();
    expect(r.valid[0].serviceDate.toISOString()).toBe("2026-03-15T00:00:00.000Z");
    expect(r.valid[0].patientState).toBe("TX");
  });

  it("rejects rows with bad serviceDate and reports per-row errors + errorCsv", () => {
    const r = validateDisputeRows(parseCsv(`${header}\nREF-2,Aetna,not-a-date,TX,TX,100`));
    expect(r.valid).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].row).toBe(1);
    expect(r.errors[0].message).toContain("serviceDate");
    expect(r.errorCsv).toContain("error");
    expect(r.errorCsv).toContain("not-a-date");
  });

  it("rejects rows missing patientState/facilityState (no fabricated defaults)", () => {
    const r = validateDisputeRows(parseCsv(
      "payer,serviceDate\nAetna,2026-03-15",
    ));
    expect(r.valid).toHaveLength(0);
    expect(r.errors[0].message).toContain("patientState");
    expect(r.errors[0].message).toContain("facilityState");
  });

  it("partial import: mixed-valid file yields valid rows plus error CSV for bad rows", () => {
    const csv = [
      header,
      goodRow,
      "REF-3,UHC,2026-02-30,CA,CA,900",       // bad date
      '"REF-4, contested",BCBS,2026-04-01,NY,NY,2500.50', // quoted comma
      "REF-5,,2026-04-02,FL,FL,100",          // missing payer
    ].join("\r\n");
    const r = validateDisputeRows(parseCsv(csv));
    expect(r.valid).toHaveLength(2);
    expect(r.valid[1].referenceNumber).toBe("REF-4, contested");
    expect(r.errors).toHaveLength(2);
    expect(r.errors.map(e => e.row)).toEqual([2, 4]);
    // errorCsv is itself parseable and contains only the failing rows.
    const reparsed = parseCsv(r.errorCsv!);
    expect(reparsed.rows).toHaveLength(3); // header + 2 errors
    expect(reparsed.rows[0].at(-1)).toBe("error");
  });

  it("enforces the 1000-row cap", () => {
    const lines = [header];
    for (let i = 0; i < CSV_IMPORT_ROW_CAP + 50; i++) lines.push(`REF-${i},Aetna,2026-03-15,TX,TX,1`);
    const r = validateDisputeRows(parseCsv(lines.join("\n")));
    expect(r.truncated).toBe(true);
    expect(r.valid).toHaveLength(CSV_IMPORT_ROW_CAP);
    expect(CSV_IMPORT_BATCH_SIZE).toBe(500);
  });

  it("ignores fully blank lines", () => {
    const r = validateDisputeRows(parseCsv(`${header}\n${goodRow}\n\n\n`));
    expect(r.valid).toHaveLength(1);
  });
});
