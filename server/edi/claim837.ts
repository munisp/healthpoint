/**
 * server/edi/claim837.ts
 *
 * Phase 17 (E5): X12 837P (Health Care Claim: Professional, ASC X12N 837
 * v5010, adopted at 45 CFR 162.1102) segment-level parser for NSA/IDR
 * eligibility staging. Mirrors the pragmatic, fail-closed style of
 * server/edi/remittance835.ts.
 *
 * Segments consumed:
 *  - ISA/GS/ST: envelope tolerated (element separator detected from ISA
 *    position 3, terminator from first match); ST03 is checked — the
 *    INSTITUTIONAL guide (005010X223A2, 837I) is REJECTED as unsupported
 *    (honest limitation; 837I requires UB-04 revenue-code logic we have not
 *    built or verified).
 *  - NM1 (85 billing provider, 82 rendering provider, QC patient, PR payer)
 *    + following N3/N4 (patient/facility state) and REF*EI (TIN).
 *  - CLM: claim id (CLM01 patient control number), total charge (CLM02),
 *    place of service (CLM05-1).
 *  - HI: diagnosis codes (ABK/BK qualifiers, ICD-10-CM).
 *  - SV1: HC/CPT code + modifiers (SV1-1 composite), line charge (SV1-2),
 *    units (SV1-4 quantity), diagnosis pointers (SV1-7 composite).
 *  - DTP*472: date of service (D8 or RD8).
 *
 * FAIL-CLOSED: no CLM segments → Claim837ParseError. SV2 (institutional
 * service) or ST03 005010X223A2 → Claim837ParseError naming 837I as
 * unsupported. Partially parseable files yield the claims that parse.
 *
 * Labels: EXECUTED-VERIFIED against synthetic fixtures in
 * server/edi/claim837.test.ts (no live clearinghouse file tested).
 */

import { x12AmountToCents } from "./remittance835";

export class Claim837ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Claim837ParseError";
  }
}

export interface Claim837ServiceLine {
  cptCode: string; // HC/CPT code from SV1-1
  modifiers: string[];
  chargeCents: number | null;
  units: number | null;
  /** Diagnosis pointers (SV1-7) → 1-based indexes into the claim diagnoses. */
  diagnosisPointers: number[];
  serviceDate: string | null; // ISO YYYY-MM-DD from DTP*472 at line level
}

export interface Claim837 {
  /** CLM01 — submitter's patient control number. */
  claimId: string;
  totalChargeCents: number | null;
  /** CLM05-1 — CMS place-of-service code. */
  placeOfService: string | null;
  payerId: string | null;
  payerName: string | null;
  billingNpi: string | null;
  renderingNpi: string | null;
  /** REF*EI under the billing provider. */
  tin: string | null;
  /** Subscriber/patient identifier (NM1*QC-09 or NM1*IL-09). */
  patientRef: string | null;
  /** 2-letter state from the patient N4 (NM1*QC address). */
  patientState: string | null;
  /** Facility/state hint from billing N4 when patient address absent. */
  facilityState: string | null;
  /** Claim-level ICD-10-CM diagnosis codes (HI, ABK/BK qualifiers). */
  diagnoses: string[];
  /** Claim-level date of service (first DTP*472 before any SV1). */
  serviceDate: string | null;
  serviceLines: Claim837ServiceLine[];
}

const X12_837I_GUIDES = ["005010X223A2", "005010X223A1"];

function isoFromX12Date(raw: string | undefined): string | null {
  if (!raw) return null;
  // D8: CCYYMMDD ; RD8: CCYYMMDD-CCYYMMDD (use start)
  const m = raw.match(/(\d{8})/);
  if (!m) return null;
  const s = m[1];
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/**
 * Parse an X12 837P transaction. One Claim837 per CLM segment; context
 * (billing/rendering/payer/patient) carries forward across claims per the
 * X12 hierarchical loop structure.
 */
export function parse837p(content: string): Claim837[] {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Claim837ParseError("Empty claim content");
  }
  const isaIdx = content.indexOf("ISA");
  const sep = isaIdx >= 0 && content.length > isaIdx + 3 ? content[isaIdx + 3] : "*";
  const termMatch = content.match(/~/);
  const term = termMatch ? "~" : "\n";
  const segments = content
    .split(term)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (!segments.some(s => s.startsWith("CLM" + sep))) {
    throw new Claim837ParseError("No CLM (claim) segments found — not a parseable 837");
  }

  // Envelope honesty: reject institutional guide explicitly.
  const st = segments.find(s => s.startsWith("ST" + sep));
  if (st) {
    const stParts = st.split(sep);
    const guide = stParts[3]?.trim();
    if (guide && X12_837I_GUIDES.includes(guide)) {
      throw new Claim837ParseError(
        `837I (institutional, ${guide}) is NOT supported by this parser — only 837P (professional, 005010X222A1). Institutional claims need revenue-code/UB-04 handling that has not been built or verified.`
      );
    }
  }
  if (segments.some(s => s.startsWith("SV2" + sep))) {
    throw new Claim837ParseError("SV2 (institutional service line) segments present — this looks like an 837I; unsupported.");
  }

  const claims: Claim837[] = [];
  // Loop context carried forward.
  let billingNpi: string | null = null;
  let renderingNpi: string | null = null;
  let tin: string | null = null;
  let payerId: string | null = null;
  let payerName: string | null = null;
  let patientRef: string | null = null;
  let patientState: string | null = null;
  let facilityState: string | null = null;
  let lastEntity: string | null = null; // NM1-01 of the most recent NM1
  let pendingAddressFor: string | null = null;

  let current: Claim837 | null = null;
  let currentLine: Claim837ServiceLine | null = null;

  const flush = () => {
    if (current) claims.push(current);
    current = null;
    currentLine = null;
  };

  for (const seg of segments) {
    const parts = seg.split(sep);
    const tag = parts[0];
    switch (tag) {
      case "NM1": {
        const entity = parts[1];
        lastEntity = entity;
        const idQual = parts[8];
        const id = parts[9] || null;
        if (entity === "85") {
          billingNpi = idQual === "XX" ? id : billingNpi;
        } else if (entity === "82") {
          renderingNpi = idQual === "XX" ? id : renderingNpi;
          // Rendering NM1 inside the claim loop (2310B) belongs to the
          // current claim even though it follows CLM.
          if (current && idQual === "XX" && id && !current.renderingNpi) {
            current.renderingNpi = id;
          }
        } else if (entity === "QC" || entity === "IL") {
          patientRef = id ?? patientRef;
        } else if (entity === "PR") {
          payerName = parts[3] || payerName;
          payerId = id ?? payerId;
        }
        pendingAddressFor = entity;
        break;
      }
      case "N4": {
        const state = parts[2]?.trim();
        if (state && /^[A-Za-z]{2}$/.test(state)) {
          if (pendingAddressFor === "QC" || pendingAddressFor === "IL") patientState = state.toUpperCase();
          else if (pendingAddressFor === "85") facilityState = state.toUpperCase();
        }
        break;
      }
      case "REF": {
        if (parts[1] === "EI" && lastEntity === "85") tin = parts[2] || tin;
        break;
      }
      case "CLM": {
        flush();
        current = {
          claimId: parts[1] ?? "",
          totalChargeCents: x12AmountToCents(parts[2]),
          placeOfService: (parts[5] ?? "").split(":")[0] || null,
          payerId, payerName, billingNpi, renderingNpi, tin,
          patientRef, patientState, facilityState,
          diagnoses: [],
          serviceDate: null,
          serviceLines: [],
        };
        currentLine = null;
        break;
      }
      case "HI": {
        if (!current) break;
        // HI*ABK:E11.9*BK:I10~ — each element is qualifier:code
        for (let i = 1; i < parts.length; i++) {
          const comp = parts[i].split(":");
          const qual = comp[0];
          const code = comp[1];
          if (code && (qual === "ABK" || qual === "BK" || qual === "ABF" || qual === "BF")) {
            current.diagnoses.push(code);
          }
        }
        break;
      }
      case "DTP": {
        if (parts[1] !== "472") break; // service date only
        const d = isoFromX12Date(parts[3]);
        if (!d) break;
        if (currentLine) currentLine.serviceDate = d;
        else if (current && !current.serviceDate) current.serviceDate = d;
        break;
      }
      case "SV1": {
        if (!current) break;
        const proc = (parts[1] ?? "").split(":"); // HC:99285:25 → qualifier, code, modifiers…
        const cpt = proc[1] ?? "";
        const modifiers = proc.slice(2).filter(m => m.length > 0);
        const dxPtr = (parts[7] ?? "")
          .split(":")
          .map(p => Number(p))
          .filter(n => Number.isInteger(n) && n > 0);
        currentLine = {
          cptCode: cpt,
          modifiers,
          chargeCents: x12AmountToCents(parts[2]),
          // SV1-3 = unit/basis code (e.g. UN); SV1-4 = quantity.
          units: parts[4] ? Number(parts[4]) : null,
          diagnosisPointers: dxPtr,
          serviceDate: null,
        };
        current.serviceLines.push(currentLine);
        break;
      }
      default:
        break; // envelope & other segments tolerated, not validated
    }
  }
  flush();

  // Line-level fallback: claims with no SV1 still stage (claim-level only).
  return claims.filter(c => c.claimId.length > 0);
}

/** Flatten parsed claims to one staging record per claim (service lines aggregated). */
export function claim837ToNormalized(c: Claim837): {
  claimId: string;
  billedCents: number | null;
  placeOfService: string | null;
  serviceDate: string | null;
  serviceEndDate: string | null;
  cptCodes: string[];
  modifiers: string[];
  diagnoses: string[];
  payerId: string | null;
  payerName: string | null;
  renderingNpi: string | null;
  billingNpi: string | null;
  tin: string | null;
  patientRef: string | null;
  patientState: string | null;
  facilityState: string | null;
} {
  const lineDates = c.serviceLines.map(l => l.serviceDate).filter((d): d is string => !!d).sort();
  return {
    claimId: c.claimId,
    billedCents: c.totalChargeCents ?? c.serviceLines.reduce<number | null>((acc, l) => (acc === null || l.chargeCents === null ? acc : acc + l.chargeCents), c.serviceLines.length && c.serviceLines.every(l => l.chargeCents !== null) ? 0 : null),
    placeOfService: c.placeOfService,
    serviceDate: c.serviceDate ?? lineDates[0] ?? null,
    serviceEndDate: lineDates.length > 0 ? lineDates[lineDates.length - 1] : null,
    cptCodes: Array.from(new Set(c.serviceLines.map(l => l.cptCode).filter(Boolean))),
    modifiers: Array.from(new Set(c.serviceLines.flatMap(l => l.modifiers))),
    diagnoses: c.diagnoses,
    payerId: c.payerId,
    payerName: c.payerName,
    renderingNpi: c.renderingNpi,
    billingNpi: c.billingNpi,
    tin: c.tin,
    patientRef: c.patientRef,
    patientState: c.patientState,
    facilityState: c.facilityState,
  };
}
