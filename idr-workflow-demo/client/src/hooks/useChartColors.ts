/**
 * useChartColors — returns a palette of theme-aware colors for Recharts.
 *
 * Colors are derived from the CSS custom properties defined in index.css so
 * they automatically adapt when the user switches between light and dark mode.
 *
 * Usage:
 *   const { primary, success, warning, danger, muted, palette } = useChartColors();
 *   <Bar fill={primary} />
 *   <Pie data={data.map((d, i) => ({ ...d, fill: palette[i % palette.length] }))} />
 */

import { useEffect, useState } from "react";

function getCSSVar(name: string): string {
  if (typeof window === "undefined") return "#6366f1";
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  // CSS variables in the template use OKLCH format, e.g. "0.637 0.237 264.376"
  // Convert to oklch() for use in SVG fill/stroke attributes.
  if (raw && !raw.startsWith("#") && !raw.startsWith("rgb") && !raw.startsWith("oklch")) {
    return `oklch(${raw})`;
  }
  return raw || "#6366f1";
}

// Semantic chart colours — map to the design-system tokens
const SEMANTIC = {
  primary:   "--primary",
  success:   "--chart-2",   // green-ish
  warning:   "--chart-4",   // amber-ish
  danger:    "--destructive",
  info:      "--chart-1",
  muted:     "--muted-foreground",
  chart1:    "--chart-1",
  chart2:    "--chart-2",
  chart3:    "--chart-3",
  chart4:    "--chart-4",
  chart5:    "--chart-5",
} as const;

type SemanticKey = keyof typeof SEMANTIC;
type ChartColors = Record<SemanticKey, string> & { palette: string[] };

function resolveColors(): ChartColors {
  const resolved = {} as Record<SemanticKey, string>;
  for (const [key, varName] of Object.entries(SEMANTIC) as [SemanticKey, string][]) {
    resolved[key] = getCSSVar(varName);
  }
  return {
    ...resolved,
    palette: [
      resolved.chart1,
      resolved.chart2,
      resolved.chart3,
      resolved.chart4,
      resolved.chart5,
      resolved.primary,
      resolved.info,
    ],
  };
}

export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(resolveColors);

  useEffect(() => {
    // Re-resolve whenever the .dark class is toggled on <html>
    const observer = new MutationObserver(() => setColors(resolveColors()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return colors;
}

// Static fallback palette for components that can't use hooks (e.g. custom tooltips)
export const CHART_PALETTE_LIGHT = [
  "oklch(0.637 0.237 264.376)",  // chart-1 (blue)
  "oklch(0.696 0.17 162.48)",    // chart-2 (green)
  "oklch(0.769 0.188 70.08)",    // chart-3 (amber)
  "oklch(0.627 0.265 303.9)",    // chart-4 (purple)
  "oklch(0.645 0.246 16.439)",   // chart-5 (red)
];
