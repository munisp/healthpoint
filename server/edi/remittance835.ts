/**
 * server/edi/remittance835.ts
 *
 * X12 835 (Health Care Claim Payment/Advice, ASC X12N 835 v5010, adopted at
 * 45 CFR 162.1602) remittance parser for NSA/IDR eligibility flagging.
 *
 * CMS-9897-F (Federal IDR Operations Final Rule, June 2026) mandates specific
 * CARC/RARC codes on out-of-network remittances to signal federal NSA/IDR
 * eligibility — notably RARC N830 ("Alert: The charge(s) for this service
 * were processed in accordance with Federal No Surprises Act...") and
 * eligible CARC adjustments (e.g. CARC 45 in an OON context).
 *
 * Scope (honest limits): this is a segment-level parser for the 835 claim
 * payment loop (CLP), service lines (SVC), adjustments (CAS with CARC/RARC
 * pairs), claim/service reference numbers (REF, incl. *LQ when present),
 * and provider identifiers (NM1*82 NPI). It is NOT a full X12 validation
 * engine; envelope segments (ISA/GS/ST/SE) are tolerated but not validated.
 * FAIL-CLOSED: a structurally unusable file throws Remittance835ParseError;
 * partially parseable files parse the claims that are present.
 */

import { createHash } from "node:crypto";

export interface Remittance835Line {
  /** CLP01 — payer-assigned claim id / patient control number. */
  claimId: string;
  /** Payer identifier from CLP-level context (N1*PR ref when present). */
  payerId: string | null;
  npi: string | null;
  cptCode: string | null;
  billedCents: number | null;
  allowedCents: number | null;
  carcCodes: string[];
  rarcCodes: string[];
  /** RARC N830 present OR eligible CARC present → NSA/IDR-eligible signal. */
  idrEligibleFlag: boolean;
  /** TRN02 propagated from the 835 header (Phase 20) — payment trace number. */
  paymentTraceNumber?: string | null;
  /** BPR04 propagated from the 835 header (Phase 20) — raw payment method code. */
  paymentMethodCode?: string | null;
}

/**
 * Phase 20: 835 file-level payment header (BPR/TRN). These segments were
 * previously tolerated-but-ignored; they carry the payment instrument
 * (check vs ACH) and the payer's trace number used for check reconciliation.
 */
export interface Remittance835Header {
  /** BPR02 — total actual provider payment for this 835, integer cents. */
  totalPaymentCents: number | null;
  /** BPR04 — payment method code: CHK | ACH | BOP | FWT | NON | etc. */
  paymentMethodCode: string | null;
  /** Normalized method bucket for storage/analytics. */
  paymentMethod: "check" | "ach" | "other" | "nonpayment" | null;
  /** TRN02 — check or EFT trace number (the payer's payment reference). */
  paymentTraceNumber: string | null;
  /** TRN03 — payer identifier on the trace (e.g. originating company id). */
  traceOriginatorId: string | null;
  /** BPR16 — payment effective date (CCYYMMDD → YYYY-MM-DD). */
  paymentEffectiveDate: string | null;
}

export interface Remittance835 {
  header: Remittance835Header;
  lines: Remittance835Line[];
}

/** BPR04 → normalized bucket. CHK→check, ACH→ach, NON→nonpayment, else other. */
export const BPR_METHOD_MAP: Record<string, Remittance835Header["paymentMethod"]> = {
  CHK: "check",
  ACH: "ach",
  NON: "nonpayment",
};

/** BPR16 CCYYMMDD → YYYY-MM-DD; null when not a valid 8-digit date. */
function x12DateToIso(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  if (!/^\d{8}$/.test(s)) return null;
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 10) !== iso) return null; // e.g. 20261340
  return iso;
}

export class Remittance835ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Remittance835ParseError";
  }
}

/** RARC code mandated on OON remittances to signal NSA federal IDR applicability. */
export const NSA_RARC_CODES = ["N830"] as const;
/**
 * CARC codes treated as NSA/IDR-eligibility signals in an OON remittance
 * context (underpayment/denial adjustments subject to the federal process).
 * Conservative: only codes CMS guidance associates with OON claim processing.
 */
export const NSA_ELIGIBLE_CARC_CODES = ["45"] as const;

/** Parse a decimal X12 amount ("123.45") into integer cents; null when empty/unparseable. */
export function x12AmountToCents(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Parse an X12 835 transaction into claim/service payment lines.
 * One line per service (SVC) when services exist under a CLP; otherwise one
 * line per CLP. Claim-level adjustments (CAS) and remark codes (LQ*HE)
 * received before the first SVC are merged into every service line of the
 * claim (they apply to the claim as a whole); adjustments after an SVC
 * attach to that service line.
 */
/**
 * Parse an X12 835 transaction into claim/service payment lines.
 * Backward-compatible: returns only the lines (delegates to parse835Full).
 */
export function parse835(content: string): Remittance835Line[] {
  return parse835Full(content).lines;
}

/**
 * Phase 20: full parse — header (BPR/TRN payment instrument data) + lines.
 * BPR/TRN absence or malformation NEVER throws; only the structural rules
 * (empty content / no CLP / CLP without CLP01 / zero parseable lines) throw.
 * Multiple BPR segments: FIRST BPR wins (multi-ST batching is out of scope;
 * the parser is single-transaction-oriented — documented limitation).
 */
export function parse835Full(content: string): Remittance835 {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Remittance835ParseError("Empty remittance content");
  }
  // Detect element separator from ISA (fixed position 103) or from the first
  // segment terminator heuristics; default to X12 standard '*' / '~'.
  const isaIdx = content.indexOf("ISA");
  const sep = isaIdx >= 0 && content.length > isaIdx + 3 ? content[isaIdx + 3] : "*";
  const termMatch = content.match(/[~!\n]/);
  const term = termMatch ? termMatch[0] : "~";
  const segments = content
    .split(term)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  if (!segments.some(s => s.startsWith("CLP" + sep))) {
    throw new Remittance835ParseError("No CLP (claim payment) segments found — not a parseable 835");
  }

  interface ClaimCtx {
    claimId: string;
    payerId: string | null;
    npi: string | null;
    billedCents: number | null;
    allowedCents: number | null;
    carcCodes: string[];
    rarcCodes: string[];
  }

  const lines: Remittance835Line[] = [];
  const header: Remittance835Header = {
    totalPaymentCents: null,
    paymentMethodCode: null,
    paymentMethod: null,
    paymentTraceNumber: null,
    traceOriginatorId: null,
    paymentEffectiveDate: null,
  };
  let bprSeen = false;
  let trnSeen = false;
  let payerId: string | null = null;
  let npi: string | null = null;
  let claim: ClaimCtx | null = null;
  let svcLines: Remittance835Line[] = [];
  let curSvc: Remittance835Line | null = null;

  const finalize = (l: Remittance835Line): Remittance835Line => {
    // Phase 20: propagate header payment context so each stored line is
    // self-describing (same pattern as payerId/npi context flow).
    l.paymentTraceNumber = header.paymentTraceNumber;
    l.paymentMethodCode = header.paymentMethodCode;
    l.carcCodes = [...new Set(l.carcCodes)];
    l.rarcCodes = [...new Set(l.rarcCodes)];
    l.idrEligibleFlag =
      l.rarcCodes.some(c => (NSA_RARC_CODES as readonly string[]).includes(c)) ||
      l.carcCodes.some(c => (NSA_ELIGIBLE_CARC_CODES as readonly string[]).includes(c));
    return l;
  };

  const flushClaim = () => {
    if (!claim) return;
    if (svcLines.length > 0) {
      // Merge claim-level adjustments/remarks into each service line.
      for (const l of svcLines) {
        l.carcCodes.push(...claim.carcCodes);
        l.rarcCodes.push(...claim.rarcCodes);
        lines.push(finalize(l));
      }
    } else {
      lines.push(finalize({
        claimId: claim.claimId,
        payerId: claim.payerId,
        npi: claim.npi,
        cptCode: null,
        billedCents: claim.billedCents,
        allowedCents: claim.allowedCents,
        carcCodes: claim.carcCodes,
        rarcCodes: claim.rarcCodes,
        idrEligibleFlag: false,
      }));
    }
    claim = null;
    svcLines = [];
    curSvc = null;
  };

  for (const seg of segments) {
    const el = seg.split(sep);
    switch (el[0]) {
      case "BPR": {
        // Phase 20: financial information segment. First BPR wins; later BPRs
        // tolerated-ignored (same policy as REF). Malformed fields → null,
        // never throw (payment capture is informational, not structural).
        if (bprSeen) break;
        bprSeen = true;
        header.totalPaymentCents = x12AmountToCents(el[2]); // BPR02
        const code = (el[4] ?? "").trim().toUpperCase();    // BPR04
        header.paymentMethodCode = code || null;
        header.paymentMethod = code ? (BPR_METHOD_MAP[code] ?? "other") : null;
        header.paymentEffectiveDate = x12DateToIso(el[16]); // BPR16
        break;
      }
      case "TRN": {
        // Phase 20: trace segment. TRN*1*<trace>*<originator>. TRN02 required
        // for capture; empty TRN02 → trace stays null (informational only).
        if (trnSeen) break;
        trnSeen = true;
        header.paymentTraceNumber = (el[2] ?? "").trim() || null;
        header.traceOriginatorId = (el[3] ?? "").trim() || null;
        break;
      }
      case "N1":
        // N1*PR = payer name; N102 is the payer name (used as payerId fallback).
        if (el[1] === "PR") payerId = (el[2] ?? "").trim() || payerId;
        break;
      case "NM1":
        // NM1*82 = rendering provider; NM109 with qualifier XX = NPI.
        if (el[1] === "82" && el[8] === "XX") {
          npi = (el[9] ?? "").trim() || npi;
          if (claim) claim.npi = npi;
        }
        break;
      case "CLP": {
        flushClaim();
        const claimId = (el[1] ?? "").trim();
        if (!claimId) {
          throw new Remittance835ParseError("CLP segment without CLP01 claim identifier");
        }
        claim = {
          claimId,
          payerId,
          npi,
          billedCents: x12AmountToCents(el[3]), // CLP03 total claim charge
          allowedCents: x12AmountToCents(el[4]), // CLP04 claim payment amount
          carcCodes: [],
          rarcCodes: [],
        };
        break;
      }
      case "SVC": {
        if (!claim) break; // service outside claim — ignore (fail-closed above covers bad files)
        const svc = el[1] ?? ""; // e.g. "HC:99285:25"
        const parts = svc.split(":");
        curSvc = {
          claimId: claim.claimId,
          payerId: claim.payerId,
          npi: claim.npi,
          cptCode: parts.length >= 2 ? parts[1] : null,
          billedCents: x12AmountToCents(el[2]), // SVC02 charge
          allowedCents: x12AmountToCents(el[3]), // SVC03 payment
          carcCodes: [],
          rarcCodes: [],
          idrEligibleFlag: false,
        };
        svcLines.push(curSvc);
        break;
      }
      case "CAS": {
        if (!claim) break;
        // CARCs at positions 2,5,8,11,14,17 (triplets: code, amount, qty).
        const target = curSvc ?? claim;
        for (let i = 2; i < el.length; i += 3) {
          const carc = (el[i] ?? "").trim();
          if (carc) target.carcCodes.push(carc);
        }
        break;
      }
      case "LQ": {
        // LQ*HE (health care remark codes) carries RARC codes.
        if (!claim) break;
        if ((el[1] ?? "").trim() === "HE") {
          const target = curSvc ?? claim;
          for (let i = 2; i < el.length; i++) {
            const rarc = (el[i] ?? "").trim();
            if (rarc) target.rarcCodes.push(rarc);
          }
        }
        break;
      }
      case "REF":
        // Reference numbers are tolerated (claim ids come from CLP01);
        // nothing to extract for the eligibility flag.
        break;
      default:
        break;
    }
  }
  flushClaim();

  if (lines.length === 0) {
    throw new Remittance835ParseError("835 contained CLP segments but yielded no parseable lines");
  }
  return { header, lines };
}

/** sha256 hex of raw remittance content — dedupe key (same pattern as CSV/QPA ingestion). */
export function hashRemittanceContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
