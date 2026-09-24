/**
 * Currency / number formatting helpers (en-US, USD).
 *
 * The API represents money in integer cents. Always render money through
 * these helpers so every view shows consistent, locale-correct amounts.
 */

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const usdNoCentsFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Format integer cents as USD, e.g. 123456 → "$1,234.56". */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return "—";
  return usdFormatter.format(cents / 100);
}

/** Format a dollar amount as USD, e.g. 1234.56 → "$1,234.56". */
export function formatUSD(dollars: number | null | undefined): string {
  if (dollars === null || dollars === undefined || Number.isNaN(dollars))
    return "—";
  return usdFormatter.format(dollars);
}

/**
 * Format cents as whole dollars when the amount has no cents,
 * e.g. 123400 → "$1,234" but 123456 → "$1,234.56".
 */
export function formatCentsCompact(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return "—";
  return cents % 100 === 0
    ? usdNoCentsFormatter.format(cents / 100)
    : usdFormatter.format(cents / 100);
}

/** Parse a user-entered dollar string ("1,234.56") into integer cents. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}
