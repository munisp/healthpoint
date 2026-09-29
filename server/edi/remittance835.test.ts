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
