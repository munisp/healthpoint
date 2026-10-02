/**
 * Formatting helpers shared by the mobile screens.
 *
 * Amount note: dispute rows in the API store money as decimal-dollar strings
 * (e.g. "1234.56" — see server/routers.ts createDisputeSchema), while the
 * ledger/settlement endpoints use integer cents. `formatUsd` handles the
 * dispute-style values; `formatCentsToUsd` is for cent-typed values.
 */

/** Decimal-dollar string/number → "$1,234.56". */
export function formatUsd(value: string | number | null | undefined): string {
  if (value == null || value === "") return "\u2014";
  const n = Number(value);
  if (!Number.isFinite(n)) return "\u2014";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/** Integer cents → "$1,234.56". */
export function formatCentsToUsd(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "\u2014";
  return formatUsd(cents / 100);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "\u2014";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "\u2014";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "\u2014";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "\u2014";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "offer_submission" \u2192 "Offer submission". */
export function humanize(value: string | null | undefined): string {
  if (!value) return "\u2014";
  const words = value.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "STEP_09_OFFER_SUBMISSION" \u2192 "Offer submission". */
export function stepLabel(step: string | null | undefined): string {
  if (!step) return "\u2014";
  return humanize(step.replace(/^STEP_\d+_/, ""));
}

/** Relative-ish staleness label for cached data ("3m ago", "2h ago"). */
export function timeAgo(epochMs: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - epochMs) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
