/**
 * server/remittance/check-match.ts — Phase 20-A.
 *
 * PURE reconciliation-proposal logic for manual check postings vs ingested
 * 835 remittances. PROPOSALS ONLY — nothing here persists a match; a human
 * confirms via submitter.matchCheckToRemittances (design §5.3 label 5).
 *
 * Proposal signals:
 *  - amount: ABS(fileSum − checkAmount) <= max($1.00, 1% of check amount)
 *  - payer: normalized name fuzzy match (lowercase, strip punctuation and
 *    LLC/INC/CORP suffixes); exact-normalized equality OR prefix containment
 *  - recency: |file.receivedAt − check.receivedDate| <= 10 days
 *  - exactTraceMatch: the 835 header TRN02 equals the check number (payers
 *    frequently print the check number as TRN02 for CHK payments) — the top
 *    signal, still human-confirmed.
 */

/** Normalize a payer name for fuzzy comparison. */
export function normalizePayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(llc|inc|corp|corporation|co|company|ltd|lp|llp|pllc|pc|pa)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Case-insensitive fuzzy payer match on normalized names. */
export function payerNamesMatch(a: string, b: string): boolean {
  const na = normalizePayerName(a);
  const nb = normalizePayerName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Prefix containment ("aetna health" ~ "aetna health plan").
  return na.startsWith(nb) || nb.startsWith(na);
}

/** Amount tolerance: max($1.00, 1% of the check amount), integer cents. */
export function amountToleranceCents(amountCents: number): number {
  return Math.max(100, Math.round(Math.abs(amountCents) * 0.01));
}

/** ±10-day window in ms. */
export const DATE_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

export interface CheckMatchCandidateFile {
  fileId: string;
  /** SUM(allowedCents) over the file's lines, integer cents. */
  fileSumCents: number;
  /** Payer name from the file (N1*PR). */
  payerName: string | null;
  /** remittance_835_files.receivedAt */
  fileReceivedAt: Date;
  /** 835 header TRN02 when captured. */
  paymentTraceNumber: string | null;
}

export interface CheckMatchProposal {
  checkPostingId: string;
  fileId: string;
  /** Higher = stronger proposal; exactTraceMatch always tops. */
  score: number;
  exactTraceMatch: boolean;
  amountDiscrepancyCents: number;
  reasons: string[];
}

export interface CheckSide {
  checkPostingId: string;
  checkNumber: string;
  amountCents: number;
  payerName: string;
  receivedDate: string; // YYYY-MM-DD
}

/**
 * Score one candidate 835 file against a check posting. Returns a proposal
 * when the amount and date gates pass; payer-name and trace matches raise
 * the score. A file failing amount OR date gates produces no proposal.
 */
export function scoreCandidate(check: CheckSide, file: CheckMatchCandidateFile): CheckMatchProposal | null {
  const discrepancy = Math.abs(file.fileSumCents - check.amountCents);
  const exactTraceMatch =
    file.paymentTraceNumber !== null && file.paymentTraceNumber === check.checkNumber;
  if (!exactTraceMatch && discrepancy > amountToleranceCents(check.amountCents)) return null;
  const dayDiff = Math.abs(file.fileReceivedAt.getTime() - new Date(check.receivedDate + "T00:00:00Z").getTime());
  if (!exactTraceMatch && dayDiff > DATE_WINDOW_MS) return null;
  const reasons: string[] = [];
  let score = 0;
  if (exactTraceMatch) {
    score += 1000;
    reasons.push("exactTraceMatch: TRN02 equals the check number");
  }
  if (discrepancy === 0) {
    score += 100;
    reasons.push("exact amount match");
  } else {
    score += Math.max(0, 50 - Math.round(discrepancy / 10));
    reasons.push(`amount within tolerance (Δ ${(discrepancy / 100).toFixed(2)} USD)`);
  }
  if (file.payerName && payerNamesMatch(file.payerName, check.payerName)) {
    score += 40;
    reasons.push("payer name fuzzy match");
  } else {
    score -= 20;
    reasons.push("payer name mismatch");
  }
  if (dayDiff <= DATE_WINDOW_MS) {
    score += Math.max(0, 20 - Math.floor(dayDiff / (24 * 60 * 60 * 1000)));
    reasons.push("received within ±10-day window");
  }
  return {
    checkPostingId: check.checkPostingId,
    fileId: file.fileId,
    score,
    exactTraceMatch,
    amountDiscrepancyCents: discrepancy,
    reasons,
  };
}

/** Rank proposals: highest score first (exactTraceMatch always on top). */
export function rankProposals(proposals: CheckMatchProposal[]): CheckMatchProposal[] {
  return [...proposals].sort((a, b) => b.score - a.score);
}
