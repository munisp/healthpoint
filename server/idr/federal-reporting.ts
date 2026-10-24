/**
 * server/idr/federal-reporting.ts
 * Federal IDR reporting exports — pure shaping functions.
 *
 * Produces:
 *   (a) a dispute-volume / determination summary CSV for a reporting period
 *       (counts by status, median days-to-determination, fee totals), and
 *   (b) a per-determination JSON record aligned to the fields HHS collects
 *       in federal IDR reporting (dispute type, items/services, offers, QPA,
 *       determination, certified IDRE, dates).
 *
 * Fields that HHS reporting collects but this schema does NOT capture are
 * emitted as null with an inline "// not collected" note in the builder —
 * they are honest gaps, not fabrications. All money in the JSON record is
 * emitted in dollar units (numeric strings) to match how the schema stores
 * amounts (numeric(12,2)); fee amounts are integer cents and are emitted in
 * cents with an explicit unit suffix in the field name.
 */

// ── Shared helpers ───────────────────────────────────────────────────────────

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** RFC 4180-ish CSV cell escaping: quote when containing , " or newline. */
export function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Array<Array<string | number | null>>): string {
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

// ── (a) Dispute volume / determination summary ───────────────────────────────

export interface VolumeSummaryInput {
  /** Period start/end (inclusive date granularity, UTC). */
  periodStart: Date;
  periodEnd: Date;
  disputes: Array<{
    id: string;
    status: string;
    serviceType: string;
    createdAt: Date;
    /** Timestamp the dispute reached STEP_13_DETERMINATION_ISSUED, if known. */
    determinedAt: Date | null;
    determinationAmount: string | null;
    determinationWinner: string | null;
  }>;
  /** Fee assessment totals (integer cents) for the period, pre-aggregated by caller. */
  feeTotals: Array<{ feeType: string; status: string; totalCents: number; count: number }>;
}

export interface VolumeSummary {
  periodStart: string;
  periodEnd: string;
  totalDisputes: number;
  byStatus: Record<string, number>;
  byServiceType: Record<string, number>;
  determinationCount: number;
  medianDaysToDetermination: number | null;
  prevailingOfferBreakdown: Record<string, number>;
  feeTotals: Array<{ feeType: string; status: string; totalCents: number; count: number }>;
}

export function buildVolumeSummary(input: VolumeSummaryInput): VolumeSummary {
  const byStatus: Record<string, number> = {};
  const byServiceType: Record<string, number> = {};
  const winners: Record<string, number> = {};
  const daysToDetermination: number[] = [];

  for (const d of input.disputes) {
    byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
    byServiceType[d.serviceType] = (byServiceType[d.serviceType] ?? 0) + 1;
    if (d.determinedAt) {
      const days = (d.determinedAt.getTime() - d.createdAt.getTime()) / 86400000;
      if (days >= 0) daysToDetermination.push(Math.round(days * 10) / 10);
      winners[d.determinationWinner ?? "unknown"] = (winners[d.determinationWinner ?? "unknown"] ?? 0) + 1;
    }
  }

  return {
    periodStart: input.periodStart.toISOString().slice(0, 10),
    periodEnd: input.periodEnd.toISOString().slice(0, 10),
    totalDisputes: input.disputes.length,
    byStatus,
    byServiceType,
    determinationCount: daysToDetermination.length,
    medianDaysToDetermination: median(daysToDetermination),
    prevailingOfferBreakdown: winners,
    feeTotals: input.feeTotals,
  };
}

/** Render the volume summary as a sectioned CSV document. */
export function volumeSummaryToCsv(summary: VolumeSummary): string {
  const parts: string[] = [];
  parts.push(toCsv(
    ["report", "period_start", "period_end", "generated_basis"],
    [["federal_idr_volume_summary", summary.periodStart, summary.periodEnd, "platform dispute registry (see docs/NSA-IDR-COMPLIANCE.md)"]]
  ));
  parts.push(toCsv(["metric", "value"], [
    ["total_disputes", summary.totalDisputes],
    ["determination_count", summary.determinationCount],
    ["median_days_to_determination", summary.medianDaysToDetermination],
  ]));
  parts.push(toCsv(["status", "count"], Object.entries(summary.byStatus).sort()));
  parts.push(toCsv(["service_type", "count"], Object.entries(summary.byServiceType).sort()));
  parts.push(toCsv(["prevailing_offer", "count"], Object.entries(summary.prevailingOfferBreakdown).sort()));
  parts.push(toCsv(
    ["fee_type", "fee_status", "total_cents", "count"],
    summary.feeTotals.map(f => [f.feeType, f.status, f.totalCents, f.count])
  ));
  return parts.join("\r\n");
}

// ── (b) Per-determination JSON record ────────────────────────────────────────

export interface DeterminationRecordInput {
  dispute: {
    id: string;
    referenceNumber: string;
    status: string;
    currentStep: string;
    serviceType: string;
    serviceDate: Date;
    patientState: string;
    facilityState: string;
    cptCodes: string[];
    billedAmount: string;
    qpaAmount: string | null;
    initiatingPartyOffer: string | null;
    respondingPartyOffer: string | null;
    determinationAmount: string | null;
    determinationWinner: string | null;
    determinationBasis: string | null;
    idrEntityId: string | null;
    idrEntityName: string | null;
    createdAt: Date;
    closedAt: Date | null;
  };
  /** Step-entry timestamps from dispute_events (first entry per step). */
  stepEnteredAt: Partial<Record<string, Date>>;
  fees: Array<{ feeType: string; partyRole: string; amountCents: number; status: string }>;
}

/**
 * Build the per-determination record. Fields HHS federal IDR reporting
 * collects but this schema does not capture are emitted as null (documented
 * inline) rather than guessed.
 */
export function buildDeterminationRecord(input: DeterminationRecordInput): Record<string, unknown> {
  const { dispute: d, stepEnteredAt, fees } = input;
  return {
    record_type: "federal_idr_determination",
    generated_at: new Date().toISOString(),
    dispute: {
      id: d.id,
      reference_number: d.referenceNumber,
      dispute_type: d.serviceType, // service-type category stands in for HHS dispute type
      batched: null, // not collected — schema has no batched-dispute grouping
      line_item_count: d.cptCodes.length,
      status: d.status,
      current_step: d.currentStep,
    },
    items_services: {
      service_type: d.serviceType,
      service_codes: d.cptCodes,
      service_date: d.serviceDate.toISOString().slice(0, 10),
      patient_state: d.patientState,
      facility_state: d.facilityState,
      diagnosis_codes: null, // surfaced via disputes.icd10Codes in the router; null here when not passed
    },
    amounts: {
      billed_amount: d.billedAmount,
      qpa: d.qpaAmount,
      initiating_party_offer: d.initiatingPartyOffer,
      responding_party_offer: d.respondingPartyOffer,
      determination_amount: d.determinationAmount,
      prevailing_offer: d.determinationWinner, // "initiating_party" | "responding_party" | null
      determination_basis: d.determinationBasis,
    },
    certified_idr_entity: {
      id: d.idrEntityId,
      name: d.idrEntityName,
      certification_number: null, // resolvable via idr_entities table in the router when linked
    },
    dates: {
      open_negotiation_initiated: stepEnteredAt.STEP_01_OPEN_NEGOTIATION_INITIATED?.toISOString() ?? d.createdAt.toISOString(),
      idr_initiated: stepEnteredAt.STEP_04_IDR_INITIATED?.toISOString() ?? null,
      idre_selected: stepEnteredAt.STEP_07_IDR_ENTITY_SELECTED?.toISOString() ?? null,
      determination_issued: stepEnteredAt.STEP_13_DETERMINATION_ISSUED?.toISOString() ?? null,
      dispute_closed: d.closedAt?.toISOString() ?? null,
    },
    fees: fees.map(f => ({
      fee_type: f.feeType,
      party_role: f.partyRole,
      amount_cents: f.amountCents,
      status: f.status,
    })),
    _not_collected: [
      "batched — no batching group in schema",
      "diagnosis_codes — pass disputes.icd10Codes from the router when present",
      "certified_idr_entity.certification_number — join idr_entities when idrEntityId is set",
      "air_ambulance_point_of_pickup — not collected",
      "plan_coverage_type — not collected",
    ],
  };
}
