/**
 * server/personas/prohibited-basis.ts — 45 CFR § 149.510(c)(4)(ii) prohibited
 * determination-basis screen. A certified IDR entity must NOT consider usual
 * and customary charges (UCR), billed charges, or public-payer
 * (Medicare/Medicaid) rates as the basis for a payment determination. This is
 * a simple keyword guard over the arbitrator's stated rationale — it screens
 * the *stated basis*, not the arithmetic.
 */

const PROHIBITED_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bUCR\b/i, label: "UCR (usual and customary rates)" },
  { pattern: /usual\s+and\s+customary/i, label: "usual and customary charges" },
  { pattern: /billed\s+charge/i, label: "billed charges" },
  { pattern: /\bMedicare\b/i, label: "Medicare rates" },
  { pattern: /\bMedicaid\b/i, label: "Medicaid rates" },
];

/** Returns the matched prohibited-basis label, or null when the rationale is clean. */
export function screenProhibitedBasis(rationale: string): string | null {
  for (const { pattern, label } of PROHIBITED_PATTERNS) {
    if (pattern.test(rationale)) return label;
  }
  return null;
}
