/**
 * server/idr/open-negotiation/notice.ts
 * Open negotiation notice builder/completeness checker — 45 CFR § 149.510(b)(1),
 * as amended by CMS-9897-F (91 FR 33900, eff. 2026-08-03).
 *
 * Regulatory basis (verified 2026-09-07):
 *  - The open negotiation notice content requirements are at
 *    45 CFR § 149.510(b)(1)(ii)(A); the amended rule expands them to 12
 *    elements. Element (2) as finalized requires "information sufficient to
 *    identify the plan or issuer, including the plan's or issuer's
 *    registration number … or an attestation from the party submitting the
 *    open negotiation notice that the plan or issuer's registration number
 *    was not provided on any remittance advice associated with the initial
 *    payment or notice of denial of payment for the item or service; the
 *    legal business name of the plan or issuer (or, in the case of a
 *    self-insured group health plan that does not have a legal business
 *    name, the legal business name of the plan sponsor), as well as the
 *    current contact information (name, email address, phone number, and
 *    mailing address) of the plan or issuer …; and if the party submitting
 *    the open negotiation notice is a plan or issuer, the plan type."
 *    Element (3) requires "the name and contact information … for any third
 *    party representing the party submitting the open negotiation notice,
 *    and an attestation that the third party has the authority to act on
 *    behalf of the party it represents in the open negotiation."
 *    Source: https://www.cms.gov/files/document/federal-independent-dispute-resolution-operations-final-rule.pdf
 *  - Remaining elements (per the Holland & Hart summary of the final rule):
 *    detailed claim and service information (date furnished; type of item or
 *    service; emergency / non-emergency / air ambulance; professional vs
 *    facility-based); initial payment amount; qualifying payment amount
 *    (QPA); an offer of an out-of-network rate for each item or service;
 *    and identification of whether the requesting party was
 *    nonparticipating.
 *    Source: https://www.hollandhart.com/revamp-of-the-no-surprises-act-federal-independent-dispute-resolution-process
 *  - The 30-business-day open negotiation period is computed with the
 *    canonical deadline engine (../deadlines; § 149.510(b)(1)).
 *
 * NOTE ON FIDELITY: element descriptions above are short quotes or
 * attorney-summarized descriptions; confirm against the current eCFR text of
 * 45 CFR 149.510(b)(1)(ii)(A) before relying on element wording in production.
 * The checker is FAIL-CLOSED: any absent required element → complete=false
 * with the element named in missingElements.
 */

import { addBusinessDays, getDeadlinePolicy } from "../deadlines";

export interface ContactInfo {
  name: string;
  email: string;
  phone: string;
  mailingAddress: string;
}

export interface OnNoticeInput {
  /** Date the notice is sent (start of the 30-business-day ON period). */
  noticeDate: Date;
  /** (1) Item/service identification. */
  datesOfService: Date[];
  serviceCode: string;
  itemServiceType?: "EMERGENCY" | "NON_EMERGENCY" | "AIR_AMBULANCE";
  serviceSetting?: "PROFESSIONAL" | "FACILITY";
  /** (2) Plan/issuer identification. */
  planIssuerRegistrationNumber?: string;
  registrationNumberNotOnRemittanceAttestation?: boolean;
  planIssuerLegalBusinessName?: string;
  planSponsorLegalBusinessName?: string;
  planIssuerContact?: ContactInfo;
  submitterIsPlanOrIssuer?: boolean;
  planType?: "SELF_INSURED" | "FULLY_INSURED";
  /** (3) Third-party representative (conditional). */
  thirdPartyRepresentative?: ContactInfo;
  thirdPartyAuthorityAttestation?: boolean;
  /** (4) Initial payment amount OR notice-of-denial date. */
  initialPaymentAmountUsd?: number;
  noticeOfDenialDate?: Date;
  /** (5) Qualifying payment amount. */
  qpaUsd?: number;
  /** (6) Offer of an out-of-network rate for each item or service. */
  oonRateOffersUsd?: number[];
  /** (7) Whether the requesting party was nonparticipating. */
  requestingPartyNonparticipating?: boolean;
  /** (8) Contact information of the party sending the notice. */
  senderContact?: ContactInfo;
  env?: NodeJS.ProcessEnv;
}

export interface OnNoticeResult {
  complete: boolean;
  missingElements: string[];
  notice: {
    noticeDate: string;
    openNegotiationPeriodEnd: string;
    openNegotiationBusinessDays: number;
    elements: Record<string, unknown>;
  } | null;
  citations: string[];
}

export const ON_NOTICE_CITATIONS = [
  "45 CFR 149.510(b)(1) (30-business-day open negotiation period)",
  "45 CFR 149.510(b)(1)(ii)(A) (notice content elements, as amended by CMS-9897-F)",
  "https://www.cms.gov/files/document/federal-independent-dispute-resolution-operations-final-rule.pdf",
  "https://www.hollandhart.com/revamp-of-the-no-surprises-act-federal-independent-dispute-resolution-process",
] as const;

function valid(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function contactComplete(c?: ContactInfo): boolean {
  return !!c && !!c.name && !!c.email && !!c.phone && !!c.mailingAddress;
}

function positive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

export function buildOpenNegotiationNotice(input: OnNoticeInput): OnNoticeResult {
  const missing: string[] = [];

  if (!valid(input.noticeDate)) {
    return {
      complete: false,
      missingElements: ["noticeDate (valid date the notice is sent)"],
      notice: null,
      citations: [...ON_NOTICE_CITATIONS],
    };
  }

  // (1) Item/service identification
  if (!Array.isArray(input.datesOfService) || input.datesOfService.length === 0 || !input.datesOfService.every(valid)) {
    missing.push("(1) date(s) the item or service was furnished");
  }
  if (!input.serviceCode || !input.serviceCode.trim()) {
    missing.push("(1) service code");
  }
  if (!input.itemServiceType) {
    missing.push("(1) item/service type (emergency, non-emergency, or air ambulance)");
  }
  if (!input.serviceSetting) {
    missing.push("(1) service setting (professional or facility-based)");
  }

  // (2) Plan/issuer identification: registration number OR attestation; legal
  // business name (or plan sponsor name); contact info; plan type when the
  // submitter is a plan/issuer.
  const hasRegNumber = !!input.planIssuerRegistrationNumber?.trim();
  if (!hasRegNumber && input.registrationNumberNotOnRemittanceAttestation !== true) {
    missing.push(
      "(2) plan/issuer Federal IDR registration number OR attestation that it was not provided on any remittance advice"
    );
  }
  if (!input.planIssuerLegalBusinessName?.trim() && !input.planSponsorLegalBusinessName?.trim()) {
    missing.push("(2) legal business name of the plan or issuer (or of the plan sponsor)");
  }
  if (!contactComplete(input.planIssuerContact)) {
    missing.push("(2) current contact information of the plan or issuer (name, email, phone, mailing address)");
  }
  if (input.submitterIsPlanOrIssuer && !input.planType) {
    missing.push("(2) plan type (self-insured or fully-insured) — required when the submitter is a plan or issuer");
  }

  // (3) Third-party representative (conditional: if a representative acts,
  // contact info and authority attestation are both required).
  if (input.thirdPartyRepresentative !== undefined || input.thirdPartyAuthorityAttestation !== undefined) {
    if (!contactComplete(input.thirdPartyRepresentative)) {
      missing.push("(3) third-party representative name and contact information");
    }
    if (input.thirdPartyAuthorityAttestation !== true) {
      missing.push("(3) attestation that the third party has authority to act on the party's behalf");
    }
  }

  // (4) Initial payment amount OR notice-of-denial date
  if (!positive(input.initialPaymentAmountUsd) && !valid(input.noticeOfDenialDate)) {
    missing.push("(4) initial payment amount or date of the notice of denial of payment");
  }

  // (5) QPA
  if (!positive(input.qpaUsd)) {
    missing.push("(5) qualifying payment amount (QPA)");
  }

  // (6) OON rate offer for each item or service
  if (!Array.isArray(input.oonRateOffersUsd) || input.oonRateOffersUsd.length === 0 || !input.oonRateOffersUsd.every(positive)) {
    missing.push("(6) offer of an out-of-network rate for each item or service");
  }

  // (7) Nonparticipating status
  if (typeof input.requestingPartyNonparticipating !== "boolean") {
    missing.push("(7) whether the party requesting open negotiation was nonparticipating");
  }

  // (8) Sender contact information
  if (!contactComplete(input.senderContact)) {
    missing.push("(8) contact information of the party sending the notice (name, email, phone, mailing address)");
  }

  const policy = getDeadlinePolicy(input.env ?? process.env);
  const onEnd = addBusinessDays(input.noticeDate, policy.openNegotiationBusinessDays, policy);

  const complete = missing.length === 0;
  return {
    complete,
    missingElements: missing,
    notice: {
      noticeDate: input.noticeDate.toISOString().slice(0, 10),
      openNegotiationPeriodEnd: onEnd.toISOString().slice(0, 10),
      openNegotiationBusinessDays: policy.openNegotiationBusinessDays,
      elements: {
        datesOfService: input.datesOfService?.map(d => d.toISOString().slice(0, 10)),
        serviceCode: input.serviceCode,
        itemServiceType: input.itemServiceType,
        serviceSetting: input.serviceSetting,
        planIssuerRegistrationNumber: input.planIssuerRegistrationNumber,
        registrationNumberNotOnRemittanceAttestation: input.registrationNumberNotOnRemittanceAttestation,
        planIssuerLegalBusinessName: input.planIssuerLegalBusinessName,
        planSponsorLegalBusinessName: input.planSponsorLegalBusinessName,
        planIssuerContact: input.planIssuerContact,
        planType: input.planType,
        thirdPartyRepresentative: input.thirdPartyRepresentative,
        thirdPartyAuthorityAttestation: input.thirdPartyAuthorityAttestation,
        initialPaymentAmountUsd: input.initialPaymentAmountUsd,
        noticeOfDenialDate: valid(input.noticeOfDenialDate)
          ? input.noticeOfDenialDate!.toISOString().slice(0, 10)
          : undefined,
        qpaUsd: input.qpaUsd,
        oonRateOffersUsd: input.oonRateOffersUsd,
        requestingPartyNonparticipating: input.requestingPartyNonparticipating,
        senderContact: input.senderContact,
      },
    },
    citations: [...ON_NOTICE_CITATIONS],
  };
}
