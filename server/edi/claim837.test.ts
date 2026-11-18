/**
 * X12 837P parser — EXECUTED-VERIFIED against realistic minimal fixtures.
 * 837I rejection is tested explicitly (honest unsupported label).
 */
import { describe, it, expect } from "vitest";
import { parse837p, claim837ToNormalized, Claim837ParseError } from "./claim837";

function fixture837p(): string {
  return [
    "ISA*00*          *00*          *ZZ*SUBMITTER      *ZZ*CLEARINGHOUSE  *260905*1200*^*00501*000000905*1*T*:~",
    "GS*HC*SUBMITTER*CLEARINGHOUSE*20260905*1200*1*X*005010X222A1~",
    "ST*837*0001*005010X222A1~",
    "BHT*0019*00*0123*20260905*1200*CH~",
    "NM1*41*2*JOURNEY BILLING*****XX*1234567893~",
    "SUB*ED*J*SMITH~",
    "NM1*40*2*CLEARINGHOUSE*****46*987654321~",
    "HL*1**20*1~",
    "NM1*85*2*JOURNEY MEDICAL GROUP*****XX*1234567893~",
    "N3*100 MAIN ST~",
    "N4*AUSTIN*TX*78701~",
    "REF*EI*461234567~",
    "HL*2*1*22*0~",
    "SBR*P*18*******CI~",
    "NM1*IL*1*DOE*JANE****MI*MBR12345~",
    "NM1*PR*2*AETNA HEALTH*****PI*60054~",
    "HL*3*2*23*0~",
    "NM1*QC*1*DOE*JANE~",
    "N3*22 PATIENT LN~",
    "N4*AUSTIN*TX*78702~",
    "CLM*PCN-0001*4200***23:B:1*Y*A*Y*Y~",
    "HI*ABK:R07.9*BF:M25.561~",
    "NM1*82*1*SMITH*JOHN****XX*1234567893~",
    "LX*1~",
    "SV1*HC:99285:25*4200*UN*1*23**1:2~",
    "DTP*472*D8*20260814~",
    "SE*27*0001~",
    "GE*1*1~",
    "IEA*1*000000905~",
  ].join("\n");
}

describe("claim837 (EXECUTED-VERIFIED fixtures)", () => {
  it("parses a realistic minimal 837P claim", () => {
    const claims = parse837p(fixture837p());
    expect(claims).toHaveLength(1);
    const c = claims[0];
    expect(c.claimId).toBe("PCN-0001");
    expect(c.totalChargeCents).toBe(420000);
    expect(c.placeOfService).toBe("23");
    expect(c.payerId).toBe("60054");
    expect(c.payerName).toBe("AETNA HEALTH");
    expect(c.billingNpi).toBe("1234567893");
    expect(c.renderingNpi).toBe("1234567893");
    expect(c.tin).toBe("461234567");
    expect(c.patientState).toBe("TX");
    expect(c.diagnoses).toEqual(["R07.9", "M25.561"]);
    expect(c.serviceLines).toHaveLength(1);
    expect(c.serviceLines[0].cptCode).toBe("99285");
    expect(c.serviceLines[0].modifiers).toEqual(["25"]);
    expect(c.serviceLines[0].chargeCents).toBe(420000);
    expect(c.serviceLines[0].diagnosisPointers).toEqual([1, 2]);
    expect(c.serviceLines[0].serviceDate).toBe("2026-08-14");
  });

  it("flattens to the normalized staging shape", () => {
    const n = claim837ToNormalized(parse837p(fixture837p())[0]);
    expect(n.claimId).toBe("PCN-0001");
    expect(n.billedCents).toBe(420000);
    expect(n.cptCodes).toEqual(["99285"]);
    expect(n.serviceDate).toBe("2026-08-14");
    expect(n.tin).toBe("461234567");
  });

  it("fails closed on empty or claim-less content", () => {
    expect(() => parse837p("")).toThrow(Claim837ParseError);
    expect(() => parse837p("ISA*00*~\nGS*HC~")).toThrow(/No CLM/);
  });

  it("rejects 837I explicitly (unsupported, honest)", () => {
    const i837 = fixture837p().replaceAll("005010X222A1", "005010X223A2");
    expect(() => parse837p(i837)).toThrow(/837I .* NOT supported/i);
  });

  it("rejects institutional SV2 service lines", () => {
    const withSv2 = fixture837p().replace("SV1*HC:99285:25*4200*UN*1*23**1:2~", "SV2*0450*HC:99285*4200*UN*1~");
    expect(() => parse837p(withSv2)).toThrow(/837I/);
  });

  it("parses multiple CLM segments into multiple claims sharing loop context", () => {
    const two = fixture837p().replace(
      "SE*27*0001~",
      [
        "CLM*PCN-0002*1500***11:B:1*Y*A*Y*Y~",
        "HI*ABK:M25.561~",
        "LX*1~",
        "SV1*HC:99213*1500*UN*1*11**1~",
        "DTP*472*D8*20260820~",
        "SE*32*0001~",
      ].join("\n")
    );
    const claims = parse837p(two);
    expect(claims).toHaveLength(2);
    expect(claims[1].claimId).toBe("PCN-0002");
    expect(claims[1].billingNpi).toBe("1234567893"); // context carried forward
    expect(claims[1].serviceLines[0].cptCode).toBe("99213");
    expect(claims[1].serviceLines[0].serviceDate).toBe("2026-08-20");
  });
});
