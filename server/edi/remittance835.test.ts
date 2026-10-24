/**
 * Phase 16: X12 835 remittance parser tests (realistic fixture).
 * CARC/RARC extraction incl. RARC N830 → idrEligibleFlag.
 */
import { describe, expect, it } from "vitest";
import { parse835, hashRemittanceContent, x12AmountToCents, Remittance835ParseError } from "./remittance835";

const FIXTURE_835 = [
  "ISA*00*          *00*          *ZZ*AETNA          *ZZ*MERIDIANRCM    *260901*1200*^*00501*000000905*1*T*:~",
  "GS*HP*AETNA*MERIDIANRCM*20260901*1200*1*X*005010X221A1~",
  "ST*835*0001*005010X221A1~",
  "BPR*I*1010.00*C*ACH*CCP*01*999999999*DA*123456*1999999999**01*111111111*DA*987654*20260901~",
  "TRN*1*835TRACE001*1999999999~",
  "N1*PR*AETNA HEALTH~",
  "N3*151 FARMINGTON AVENUE~",
  "N4*HARTFORD*CT*06156~",
  "N1*PE*LAKESHORE EMERGENCY PHYSICIANS*XX*1234567893~",
  "LX*1~",
  // Claim 1: OON ER visit, N830 NSA remark → IDR-eligible
  "CLP*CLM-1001*2*4200.00*900.00**MB*PAYERCTRL001*11*1~",
  "NM1*QC*1*DOE*JANE****MI*MBR12345~",
  "NM1*82*2*LAKESHORE EMERGENCY PHYSICIANS*****XX*1234567893~",
  "REF*1L*GROUPNPI1~",
  "SVC*HC:99285*4200.00*900.00**1~",
  "DTM*472*20260810~",
  "CAS*CO*45*3300.00~",
  "LQ*HE*N830~",
  "LX*2~",
  // Claim 2: in-network contractual adjustment, no NSA signal → not eligible
  "CLP*CLM-1002*1*2600.00*1100.00**MB*PAYERCTRL002*11*1~",
  "NM1*82*2*LAKESHORE EMERGENCY PHYSICIANS*****XX*1234567893~",
  "SVC*HC:99284*2600.00*1100.00**1~",
  "CAS*CO*131*1500.00~",
  "SE*22*0001~",
  "GE*1*1~",
  "IEA*1*000000905~",
].join("\n");

describe("parse835", () => {
  it("parses CLP/SVC/CAS/LQ segments and extracts CARC/RARC codes", () => {
    const lines = parse835(FIXTURE_835);
    expect(lines).toHaveLength(2);
    const [l1, l2] = lines;
    expect(l1.claimId).toBe("CLM-1001");
    expect(l1.payerId).toBe("AETNA HEALTH");
    expect(l1.npi).toBe("1234567893");
    expect(l1.cptCode).toBe("99285");
    expect(l1.billedCents).toBe(420000);
    expect(l1.allowedCents).toBe(90000);
    expect(l1.carcCodes).toContain("45");
    expect(l1.rarcCodes).toContain("N830");
    expect(l1.idrEligibleFlag).toBe(true);
    expect(l2.claimId).toBe("CLM-1002");
    expect(l2.idrEligibleFlag).toBe(false);
    expect(l2.rarcCodes).not.toContain("N830");
  });

  it("flags eligibility on eligible CARC (45) even without N830", () => {
    const content = FIXTURE_835.replace("LQ*HE*N830~\n", "");
    const lines = parse835(content);
    expect(lines[0].carcCodes).toContain("45");
    expect(lines[0].idrEligibleFlag).toBe(true);
  });

  it("fails closed on unparseable content", () => {
    expect(() => parse835("")).toThrow(Remittance835ParseError);
    expect(() => parse835("ISA*00*garbage~GS*HP~ST*837*0001~")).toThrow(Remittance835ParseError);
  });

  it("hashes content deterministically for dedupe", () => {
    expect(hashRemittanceContent(FIXTURE_835)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRemittanceContent(FIXTURE_835)).toBe(hashRemittanceContent(FIXTURE_835));
    expect(hashRemittanceContent(FIXTURE_835)).not.toBe(hashRemittanceContent(FIXTURE_835 + " "));
  });

  it("converts X12 amounts to cents", () => {
    expect(x12AmountToCents("4200.00")).toBe(420000);
    expect(x12AmountToCents("0.5")).toBe(50);
    expect(x12AmountToCents("")).toBeNull();
    expect(x12AmountToCents("abc")).toBeNull();
  });
});

// ── Phase 20: BPR/TRN payment-instrument header capture ─────────────────────
import { parse835Full } from "./remittance835";

const CLP_BLOCK = [
  "N1*PR*AETNA HEALTH~",
  "CLP*CLM-1*2*4200.00*900.00**MB*PCN1*11*1~",
  "SVC*HC:99285*4200.00*900.00**1~",
  "SE*10*0001~",
].join("\n");

function withHeader(...headerSegs: string[]): string {
  return ["ISA*00*          *00*          *ZZ*A*ZZ*B*260901*1200*^*00501*000000905*1*T*:~",
    "ST*835*0001*005010X221A1~", ...headerSegs, CLP_BLOCK].join("\n");
}

describe("parse835Full (Phase 20 header)", () => {
  it("captures BPR CHK + TRN and propagates trace/method to lines", () => {
    const r = parse835Full(withHeader(
      "BPR*I*900.00*C*CHK*CCP*01*999999999*DA*123456*1999999999**01*111111111*DA*987654*20260905~",
      "TRN*1*CHK-778812*1999999999~",
    ));
    expect(r.header.totalPaymentCents).toBe(90000);
    expect(r.header.paymentMethodCode).toBe("CHK");
    expect(r.header.paymentMethod).toBe("check");
    expect(r.header.paymentEffectiveDate).toBe("2026-09-05");
    expect(r.header.paymentTraceNumber).toBe("CHK-778812");
    expect(r.header.traceOriginatorId).toBe("1999999999");
    expect(r.lines[0].paymentTraceNumber).toBe("CHK-778812");
    expect(r.lines[0].paymentMethodCode).toBe("CHK");
  });

  it("maps ACH → ach, NON → nonpayment, unknown (FWT) → other", () => {
    const ach = parse835Full(withHeader("BPR*I*10.00*C*ACH*CCP*01*1*DA*1*1**01*1*DA*1*20260901~"));
    expect(ach.header.paymentMethod).toBe("ach");
    const non = parse835Full(withHeader("BPR*I*0*C*NON*CCP*01*1*DA*1*1**01*1*DA*1*20260901~"));
    expect(non.header.paymentMethod).toBe("nonpayment");
    expect(non.header.totalPaymentCents).toBe(0);
    const fwt = parse835Full(withHeader("BPR*I*10.00*C*FWT*CCP*01*1*DA*1*1**01*1*DA*1*20260901~"));
    expect(fwt.header.paymentMethodCode).toBe("FWT");
    expect(fwt.header.paymentMethod).toBe("other");
  });

  it("returns all-null header when BPR/TRN absent; lines still parse", () => {
    const r = parse835Full(withHeader());
    expect(r.header.totalPaymentCents).toBeNull();
    expect(r.header.paymentMethodCode).toBeNull();
    expect(r.header.paymentMethod).toBeNull();
    expect(r.header.paymentTraceNumber).toBeNull();
    expect(r.header.paymentEffectiveDate).toBeNull();
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].paymentTraceNumber).toBeNull();
    expect(r.lines[0].paymentMethodCode).toBeNull();
  });

  it("malformed BPR02 ('ABC') → null total, no throw", () => {
    const r = parse835Full(withHeader("BPR*I*ABC*C*CHK*CCP*01*1*DA*1*1**01*1*DA*1*20260901~"));
    expect(r.header.totalPaymentCents).toBeNull();
    expect(r.header.paymentMethod).toBe("check");
    expect(r.lines).toHaveLength(1);
  });

  it("multiple BPR segments → first wins, later tolerated-ignored", () => {
    const r = parse835Full(withHeader(
      "BPR*I*100.00*C*CHK*CCP*01*1*DA*1*1**01*1*DA*1*20260901~",
      "BPR*I*999.00*C*ACH*CCP*01*1*DA*1*1**01*1*DA*1*20260902~",
    ));
    expect(r.header.totalPaymentCents).toBe(10000);
    expect(r.header.paymentMethod).toBe("check");
    expect(r.header.paymentEffectiveDate).toBe("2026-09-01");
  });

  it("TRN with empty TRN02 → trace null, parse continues", () => {
    const r = parse835Full(withHeader("TRN*1~"));
    expect(r.header.paymentTraceNumber).toBeNull();
    expect(r.lines).toHaveLength(1);
  });

  it("invalid BPR16 date → null (never throws)", () => {
    const r = parse835Full(withHeader("BPR*I*100.00*C*CHK*CCP*01*1*DA*1*1**01*1*DA*1*NOTADATE~"));
    expect(r.header.paymentEffectiveDate).toBeNull();
  });

  it("fuzz: random BPR/TRN element content never throws on otherwise-valid 835", () => {
    const junk = ["", "*", "~~~", "ABC!@#", "9".repeat(500), "20261399", "0.0.0.0"];
    for (let i = 0; i < 40; i++) {
      const a = junk[i % junk.length], b = junk[(i * 3 + 1) % junk.length], c = junk[(i * 7 + 2) % junk.length];
      const r = parse835Full(withHeader(`BPR*I*${a}*C*${b}*CCP*01*1*DA*1*1**01*1*DA*1*${c}~`, `TRN*1*${a}*${b}~`));
      expect(r.lines.length).toBeGreaterThan(0);
    }
  });

  it("parse835 delegates to parse835Full().lines (backward compat)", () => {
    const viaFull = parse835Full(FIXTURE_835);
    expect(parse835(FIXTURE_835)).toEqual(viaFull.lines);
    expect(viaFull.header.paymentMethod).toBe("ach");
    expect(viaFull.header.paymentTraceNumber).toBe("835TRACE001");
  });
});
