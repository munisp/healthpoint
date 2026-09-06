/**
 * server/idr/cooling-off/cooling-off.ts
 * Cooling-off (suspension) period computation for the Federal IDR process.
 *
 * Regulatory basis (verified 2026-09-07):
 *  - The cooling-off period is the 90-CALENDAR-day period FOLLOWING A
 *    PAYMENT DETERMINATION during which the initiating party may not submit
 *    a subsequent Notice of IDR Initiation involving the same other party
 *    for the same or similar item or service (45 CFR 149.510(c)(4)(vii)(B)
 *    "suspension period"; CMS Guidance for Disputing Parties, March 2023).
 *    NOTE: the cooling-off clock anchors on the prior payment DETERMINATION
 *    date — not on the date of initial payment or notice of denial.
 *    Source: https://www.cms.gov/files/document/federal-idr-guidance-disputing-parties-march-2023.pdf
 *  - Initiation after cooling-off: either party must submit the subsequent
 *    Notice of IDR Initiation within 30 business days beginning on the day
 *    after the last day of the cooling-off period (id.; DOL Notice of IDR
 *    Initiation instructions). Source: https://beta.dol.gov/policy-regulations/pay-benefits/health-plans/surprise-billing-and-price-transparency/tools-and-resources/employers-and-service-providers/federal-independent-dispute-resolution-idr-process/notice-idr-initiation
 *  - CMS-9897-F (91 FR 33900, eff. 2026-08-03): for BATCHED disputes the
 *    cooling-off period is reduced from 90 calendar days to 30 BUSINESS days.
 *    The batching provisions of the final rule apply to disputes with open
 *    negotiation periods beginning on or after 2026-11-01.
 *    Sources:
 *      https://maximus.com/health-services/clinical-services/idr/process-eligibility
 *        ("the cooling off period specifically for batched disputes will be
 *         reduced from 90 calendar days to 30 business days")
 *      https://www.cms.gov/files/document/federal-idr-operations-implementation-timeline.pdf
 *
 * FAIL-CLOSED: when the timing basis is ambiguous (missing determination
 * date; batched dispute without an ONP start date to select the applicable
 * regime), earliestInitiationDate is null and the rationale says why. Never
 * guesses a permissive date.
 */

import {
  addBusinessDays,
  addCalendarDays,
  getDeadlinePolicy,
  type IDRDeadlinePolicy,
} from "../deadlines";

export type DisputeType = "SINGLE" | "BATCHED";

export interface CoolingOffInput {
  /**
   * Date the certified IDR entity issued the payment determination on the
   * PRIOR dispute. This is the cooling-off anchor per the verified rule.
   */
  paymentDeterminationDate?: Date;
  disputeType: DisputeType;
  /**
   * Date the open negotiation period for the NEW dispute begins. Required
   * for BATCHED disputes to select the pre-/post-CMS-9897-F regime
   * (boundary 2026-11-01). Optional for SINGLE disputes.
   */
  openNegotiationInitiatedOn?: Date;
  env?: NodeJS.ProcessEnv;
}

export interface CoolingOffResult {
  coolingOffEnd: Date | null;
  earliestInitiationDate: Date | null;
  basis: string;
  citations: string[];
}

export const COOLING_OFF_CITATIONS = [
  "45 CFR 149.510(c)(4)(vii)(B) (90-calendar-day suspension period)",
  "CMS-9897-F (91 FR 33900, eff. 2026-08-03) — batched-dispute cooling-off reduced to 30 business days",
  "https://www.cms.gov/files/document/federal-idr-guidance-disputing-parties-march-2023.pdf",
  "https://www.cms.gov/files/document/federal-idr-operations-implementation-timeline.pdf",
  "https://maximus.com/health-services/clinical-services/idr/process-eligibility",
] as const;

/** ONP start date at/after which the CMS-9897-F batching regime applies. */
export const BATCHED_REGIME_EFFECTIVE = "2026-11-01";
export const SINGLE_COOLING_OFF_CALENDAR_DAYS = 90;
export const BATCHED_COOLING_OFF_BUSINESS_DAYS = 30;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

export function computeCoolingOff(input: CoolingOffInput): CoolingOffResult {
  const policy: IDRDeadlinePolicy = getDeadlinePolicy(input.env ?? process.env);

  if (!isValidDate(input.paymentDeterminationDate)) {
    return {
      coolingOffEnd: null,
      earliestInitiationDate: null,
      basis:
        "Fail-closed: no payment determination date supplied. The cooling-off period runs 90 " +
        "calendar days (single disputes) from the prior payment determination " +
        "(45 CFR 149.510(c)(4)(vii)(B)); without that anchor the cooling-off end cannot be " +
        "computed and no initiation date may be inferred.",
      citations: [...COOLING_OFF_CITATIONS],
    };
  }

  if (input.disputeType === "SINGLE") {
    const end = addCalendarDays(input.paymentDeterminationDate, SINGLE_COOLING_OFF_CALENDAR_DAYS);
    const earliest = addBusinessDays(end, 1, policy); // initiation window opens the day after
    return {
      coolingOffEnd: end,
      earliestInitiationDate: earliest,
      basis:
        `Single dispute: 90-calendar-day cooling-off from payment determination ` +
        `${isoDay(input.paymentDeterminationDate)} ends ${isoDay(end)}; the subsequent ` +
        `Notice of IDR Initiation may be submitted starting the next business day, ` +
        `${isoDay(earliest)}, within the 30-business-day post-cooling-off window ` +
        `(45 CFR 149.510(c)(4)(vii)(B)).`,
      citations: [...COOLING_OFF_CITATIONS],
    };
  }

  if (input.disputeType === "BATCHED") {
    if (!isValidDate(input.openNegotiationInitiatedOn)) {
      return {
        coolingOffEnd: null,
        earliestInitiationDate: null,
        basis:
          "Fail-closed: batched dispute without an open-negotiation start date. CMS-9897-F " +
          "reduces the batched-dispute cooling-off period to 30 business days, but only for " +
          "disputes with open negotiation periods beginning on or after 2026-11-01; absent the " +
          "ONP start date the applicable regime is ambiguous, so no date is inferred.",
        citations: [...COOLING_OFF_CITATIONS],
      };
    }
    const onp = isoDay(input.openNegotiationInitiatedOn);
    if (onp >= BATCHED_REGIME_EFFECTIVE) {
      const end = addBusinessDays(input.paymentDeterminationDate, BATCHED_COOLING_OFF_BUSINESS_DAYS, policy);
      const earliest = addBusinessDays(end, 1, policy);
      return {
        coolingOffEnd: end,
        earliestInitiationDate: earliest,
        basis:
          `Batched dispute, ONP beginning ${onp} (on/after ${BATCHED_REGIME_EFFECTIVE}): ` +
          `CMS-9897-F 30-business-day cooling-off from payment determination ` +
          `${isoDay(input.paymentDeterminationDate)} ends ${isoDay(end)}; earliest initiation ` +
          `${isoDay(earliest)}. Source: CMS IDR Operations implementation timeline.`,
        citations: [...COOLING_OFF_CITATIONS],
      };
    }
    // Pre-amendment batched disputes use the legacy 90-calendar-day suspension.
    const end = addCalendarDays(input.paymentDeterminationDate, SINGLE_COOLING_OFF_CALENDAR_DAYS);
    const earliest = addBusinessDays(end, 1, policy);
    return {
      coolingOffEnd: end,
      earliestInitiationDate: earliest,
      basis:
        `Batched dispute, ONP beginning ${onp} (before ${BATCHED_REGIME_EFFECTIVE}): legacy ` +
        `90-calendar-day suspension period applies (45 CFR 149.510(c)(4)(vii)(B)); ends ` +
        `${isoDay(end)}; earliest initiation ${isoDay(earliest)}.`,
      citations: [...COOLING_OFF_CITATIONS],
    };
  }

  return {
    coolingOffEnd: null,
    earliestInitiationDate: null,
    basis: `Fail-closed: unknown disputeType "${String(input.disputeType)}".`,
    citations: [...COOLING_OFF_CITATIONS],
  };
}
