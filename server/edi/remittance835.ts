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
export function parse835(content: string): Remittance835Line[] {
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
  let payerId: string | null = null;
  let npi: string | null = null;
  let claim: ClaimCtx | null = null;
  let svcLines: Remittance835Line[] = [];
  let curSvc: Remittance835Line | null = null;

  const finalize = (l: Remittance835Line): Remittance835Line => {
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
  return lines;
}

/** sha256 hex of raw remittance content — dedupe key (same pattern as CSV/QPA ingestion). */
export function hashRemittanceContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
