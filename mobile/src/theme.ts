/**
 * Shared visual language for the mobile app.
 *
 * Palette mirrors the web client's calm, low-saturation healthcare aesthetic
 * (Tailwind 100/700 badge pairs) translated to hex for React Native.
 *
 * Dark mode: `useColors()` returns the palette for the active color scheme
 * (light or dark). Screens should call the hook and build styles from the
 * returned palette instead of importing `colors` directly. The static
 * `colors` export remains for non-reactive contexts.
 */
import { useColorScheme } from "react-native";

export interface Palette {
  bg: string;
  card: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  /** Platform teal primary (#0e6e5d). */
  primary: string;
  primarySoft: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  white: string;
}

export const lightColors: Palette = {
  bg: "#f8fafc", // slate-50 app background
  card: "#ffffff",
  border: "#e5e7eb", // gray-200
  text: "#111827", // gray-900
  textMuted: "#6b7280", // gray-500
  textFaint: "#9ca3af", // gray-400
  primary: "#0e6e5d", // platform teal
  primarySoft: "#ccfbf1", // teal-100
  danger: "#b91c1c", // red-700
  dangerSoft: "#fef2f2", // red-50
  warning: "#b45309", // amber-700
  warningSoft: "#fef3c7", // amber-100
  white: "#ffffff",
};

export const darkColors: Palette = {
  bg: "#020617", // slate-950
  card: "#0f172a", // slate-900
  border: "#1e293b", // slate-800
  text: "#f1f5f9", // slate-100
  textMuted: "#94a3b8", // slate-400
  textFaint: "#64748b", // slate-500
  primary: "#2bbfa7", // brighter teal for contrast on dark surfaces
  primarySoft: "#134e4a", // teal-900
  danger: "#f87171", // red-400
  dangerSoft: "#450a0a", // red-950
  warning: "#fbbf24", // amber-400
  warningSoft: "#451a03", // amber-950
  white: "#ffffff",
};

/** Back-compat static palette (light). Prefer `useColors()` in components. */
export const colors: Palette = lightColors;

/** Reactive palette: re-renders when the OS color scheme changes. */
export function useColors(): Palette {
  return useColorScheme() === "dark" ? darkColors : lightColors;
}

/** Consistent spacing scale (pt). */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Typography hierarchy. */
export const fontSize = {
  caption: 11,
  small: 12,
  body: 14,
  subtitle: 15,
  title: 20,
  hero: 28,
} as const;

/** Minimum touch target (Apple HIG / Material a11y). */
export const MIN_TOUCH_TARGET = 44;

export interface BadgeTone {
  bg: string;
  text: string;
}

/**
 * Dispute-status badge tones. Mirrors client/src/pages/DisputesList.tsx and
 * Dashboard.tsx (`bg-*-100 text-*-700`) — muted green/amber/red family.
 * Light badge chips stay legible on both light and dark surfaces.
 */
export const statusTones: Record<string, BadgeTone> = {
  open_negotiation: { bg: "#dbeafe", text: "#1d4ed8" }, // blue
  idr_initiated: { bg: "#f3e8ff", text: "#7e22ce" }, // purple
  idr_entity_selection: { bg: "#f3e8ff", text: "#7e22ce" },
  eligibility_review: { bg: "#fef3c7", text: "#b45309" }, // amber
  offer_submission: { bg: "#ffedd5", text: "#c2410c" }, // orange
  under_arbitration: { bg: "#fee2e2", text: "#b91c1c" }, // red
  determination_issued: { bg: "#ccfbf1", text: "#0f766e" }, // teal
  payment_pending: { bg: "#fef3c7", text: "#b45309" }, // amber
  closed: { bg: "#dcfce7", text: "#15803d" }, // green
  appealed: { bg: "#ffe4e6", text: "#be123c" }, // rose
  ineligible: { bg: "#f1f5f9", text: "#475569" }, // slate
};

/** Notification-type badge tones (mirrors web DisputeActivityFeed tones). */
export const notificationTones: Record<string, BadgeTone> = {
  deadline_warning: { bg: "#fef3c7", text: "#b45309" },
  step_advanced: { bg: "#dbeafe", text: "#1d4ed8" },
  determination_issued: { bg: "#ccfbf1", text: "#0f766e" },
  offer_received: { bg: "#f3e8ff", text: "#7e22ce" },
  document_uploaded: { bg: "#f3e8ff", text: "#7e22ce" },
  expert_review: { bg: "#e0e7ff", text: "#4338ca" },
  system_alert: { bg: "#f1f5f9", text: "#475569" },
};

export function toneFor(map: Record<string, BadgeTone>, key: string): BadgeTone {
  return map[key] ?? { bg: "#f1f5f9", text: "#475569" };
}
