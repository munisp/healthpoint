import { describe, expect, it } from "vitest";
import { buildOpenNegotiationNotice, type OnNoticeInput } from "./notice";

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);

const contact = { name: "Pat Doe", email: "p@example.com", phone: "555-0100", mailingAddress: "1 Main St" };

function completeInput(overrides: Partial<OnNoticeInput> = {}): OnNoticeInput {
  return {
    noticeDate: D("2026-09-08"), // Tuesday
    datesOfService: [D("2026-08-10")],
    serviceCode: "99285",
    itemServiceType: "EMERGENCY",
    serviceSetting: "PROFESSIONAL",
    planIssuerRegistrationNumber: "REG-12345",
    planIssuerLegalBusinessName: "Acme Health Plan",
    planIssuerContact: contact,
    initialPaymentAmountUsd: 320,
    qpaUsd: 500,
    oonRateOffersUsd: [900],
    requestingPartyNonparticipating: true,
    senderContact: contact,
    ...overrides,
  };
}

describe("complete notice", () => {
  it("complete=true with all elements present; ON period = 30 business days", () => {
    const r = buildOpenNegotiationNotice(completeInput());
    expect(r.complete).toBe(true);
    expect(r.missingElements).toEqual([]);
    expect(r.notice?.openNegotiationPeriodEnd).toBe("2026-10-21");
    expect(r.notice?.openNegotiationBusinessDays).toBe(30);
    expect(r.citations.join(" ")).toContain("149.510(b)(1)");
  });

  it("accepts the denial-date alternative to an initial payment amount", () => {
    const r = buildOpenNegotiationNotice(
      completeInput({ initialPaymentAmountUsd: undefined, noticeOfDenialDate: D("2026-08-20") })
    );
    expect(r.complete).toBe(true);
  });

  it("accepts the registration-number attestation alternative", () => {
    const r = buildOpenNegotiationNotice(
      completeInput({ planIssuerRegistrationNumber: undefined, registrationNumberNotOnRemittanceAttestation: true })
    );
    expect(r.complete).toBe(true);
  });

  it("accepts plan sponsor legal name for a self-insured plan without a legal business name", () => {
    const r = buildOpenNegotiationNotice(
      completeInput({
        planIssuerLegalBusinessName: undefined,
        planSponsorLegalBusinessName: "Acme Corp Plan Sponsor",
        submitterIsPlanOrIssuer: true,
        planType: "SELF_INSURED",
      })
    );
    expect(r.complete).toBe(true);
  });
});

describe("missing elements are flagged (fail closed)", () => {
  it.each<[string, Partial<OnNoticeInput>, string]>([
    ["dates of service", { datesOfService: [] }, "(1) date(s)"],
    ["service code", { serviceCode: "" }, "(1) service code"],
    ["item/service type", { itemServiceType: undefined }, "(1) item/service type"],
    ["service setting", { serviceSetting: undefined }, "(1) service setting"],
    [
      "registration number and attestation",
      { planIssuerRegistrationNumber: undefined, registrationNumberNotOnRemittanceAttestation: undefined },
      "(2) plan/issuer Federal IDR registration number",
    ],
    [
      "plan/issuer legal name",
      { planIssuerLegalBusinessName: undefined, planSponsorLegalBusinessName: undefined },
      "(2) legal business name",
    ],
    ["plan/issuer contact", { planIssuerContact: undefined }, "(2) current contact information"],
    ["initial payment / denial date", { initialPaymentAmountUsd: undefined }, "(4) initial payment amount"],
    ["QPA", { qpaUsd: undefined }, "(5) qualifying payment amount"],
    ["OON rate offer", { oonRateOffersUsd: undefined }, "(6) offer of an out-of-network rate"],
    ["nonparticipating flag", { requestingPartyNonparticipating: undefined }, "(7) nonparticipating"],
    ["sender contact", { senderContact: undefined }, "(8) contact information of the party sending"],
  ])("flags missing %s", (_label, overrides, expectedFragment) => {
    const r = buildOpenNegotiationNotice(completeInput(overrides));
    expect(r.complete).toBe(false);
    expect(r.missingElements.some(m => m.includes(expectedFragment))).toBe(true);
  });

  it("requires plan type when the submitter is a plan or issuer", () => {
    const r = buildOpenNegotiationNotice(completeInput({ submitterIsPlanOrIssuer: true }));
    expect(r.complete).toBe(false);
    expect(r.missingElements.some(m => m.includes("plan type"))).toBe(true);
  });

  it("requires the authority attestation when a third-party representative is used", () => {
    const r = buildOpenNegotiationNotice(completeInput({ thirdPartyRepresentative: contact }));
    expect(r.complete).toBe(false);
    expect(r.missingElements.some(m => m.includes("(3) attestation"))).toBe(true);
  });

  it("returns notice=null when the notice date is invalid", () => {
    const r = buildOpenNegotiationNotice(completeInput({ noticeDate: new Date("nope") }));
    expect(r.complete).toBe(false);
    expect(r.notice).toBeNull();
  });
});

describe("deadline math via the canonical engine", () => {
  it("ON period starting on Labor Day still counts 30 business days", () => {
    const r = buildOpenNegotiationNotice(completeInput({ noticeDate: D("2026-09-07") }));
    expect(r.notice?.openNegotiationPeriodEnd).toBe("2026-10-20");
  });

  it("honors env override of the ON period length", () => {
    const r = buildOpenNegotiationNotice(
      completeInput({ env: { IDR_OPEN_NEGOTIATION_BUSINESS_DAYS: "10" } })
    );
    expect(r.notice?.openNegotiationBusinessDays).toBe(10);
  });
});
