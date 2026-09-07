/**
 * Shared visual language for the mobile app.
 *
 * Palette mirrors the web client's calm, low-saturation healthcare aesthetic
 * (Tailwind 100/700 badge pairs) translated to hex for React Native.
 */

export const colors = {
  bg: "#f8fafc", // slate-50 app background
  card: "#ffffff",
  border: "#e5e7eb", // gray-200
  text: "#111827", // gray-900
  textMuted: "#6b7280", // gray-500
  textFaint: "#9ca3af", // gray-400
  primary: "#0f766e", // teal-700 — clinical, calm
  primarySoft: "#ccfbf1", // teal-100
  danger: "#b91c1c", // red-700
  white: "#ffffff",
};

export interface BadgeTone {
  bg: string;
  text: string;
}

/**
 * Dispute-status badge tones. Mirrors client/src/pages/DisputesList.tsx and
 * Dashboard.tsx (`bg-*-100 text-*-700`) — muted green/amber/red family.
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
