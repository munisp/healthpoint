import { cn } from "@/lib/utils";

/**
 * StatusBadge
 *
 * Consistent status pill for dispute / payment / settlement states.
 * Tones map to the semantic design tokens (muted green = success,
 * amber = warning, muted red = danger, slate = neutral/info) with
 * WCAG-AA-verified foreground/background pairs in light and dark mode.
 */

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  danger: "bg-danger text-danger-foreground",
  info: "bg-info text-info-foreground",
  neutral: "bg-muted text-muted-foreground",
};

const DOT_CLASSES: Record<StatusTone, string> = {
  success: "bg-success-foreground",
  warning: "bg-warning-foreground",
  danger: "bg-danger-foreground",
  info: "bg-info-foreground",
  neutral: "bg-muted-foreground",
};

/** Known statuses → tone. Unknown statuses fall back to neutral. */
const STATUS_TONES: Record<string, StatusTone> = {
  // Dispute lifecycle
  closed: "success",
  resolved: "success",
  completed: "success",
  approved: "success",
  eligible: "success",
  determination_issued: "success",
  submitted: "info",
  idr_initiated: "info",
  idr_active: "info",
  idr_entity_selection: "info",
  in_progress: "info",
  processing: "info",
  offer_submission: "info",
  open_negotiation: "warning",
  eligibility_review: "warning",
  under_arbitration: "warning",
  pending: "warning",
  payment_pending: "warning",
  pending_payment: "warning",
  awaiting_response: "warning",
  under_review: "warning",
  appealed: "warning",
  draft: "neutral",
  ineligible: "danger",
  denied: "danger",
  rejected: "danger",
  cancelled: "danger",
  expired: "danger",
  escalated: "danger",
  // Payment / settlement / reconciliation
  paid: "success",
  settled: "success",
  matched: "success",
  authorized: "success",
  captured: "success",
  reconciled: "success",
  partial: "warning",
  partially_paid: "warning",
  overpaid: "info",
  refunded: "info",
  unmatched: "danger",
  underpaid: "danger",
  failed: "danger",
  overdue: "danger",
  breached: "danger",
  disputed: "danger",
};

export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  return STATUS_TONES[status.toLowerCase().replace(/[\s-]+/g, "_")] ?? "neutral";
}

/** "open_negotiation" → "Open negotiation" */
function humanize(status: string): string {
  const s = status.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface StatusBadgeProps {
  status: string | null | undefined;
  /** Override the humanized label. */
  label?: string;
  size?: "xs" | "sm";
  className?: string;
}

export function StatusBadge({
  status,
  label,
  size = "sm",
  className,
}: StatusBadgeProps) {
  const tone = statusTone(status);
  const text = label ?? (status ? humanize(status) : "Unknown");

  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full font-medium",
        size === "xs" ? "px-1.5 py-px text-[10px]" : "px-2.5 py-0.5 text-xs",
        TONE_CLASSES[tone],
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "rounded-full",
          size === "xs" ? "h-1 w-1" : "h-1.5 w-1.5",
          DOT_CLASSES[tone]
        )}
      />
      {text}
    </span>
  );
}

export default StatusBadge;
