import { AlertTriangle, Clock, X, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

interface DeadlineBannerProps {
  disputeId: string;
  claimNumber?: string | null;
  currentStep?: string | null;
  deadlineDays: number; // business days remaining (negative = overdue)
  deadlineDate?: Date | string | null;
}

export default function DeadlineCountdownBanner({
  disputeId,
  claimNumber,
  currentStep,
  deadlineDays,
  deadlineDate,
}: DeadlineBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [, navigate] = useLocation();

  if (dismissed) return null;
  // Only show when ≤ 3 business days remaining
  if (deadlineDays > 3) return null;

  const isOverdue = deadlineDays < 0;
  const isToday = deadlineDays === 0;

  const bgColor = isOverdue
    ? "bg-red-600 dark:bg-red-700"
    : isToday
    ? "bg-red-500 dark:bg-red-600"
    : deadlineDays === 1
    ? "bg-orange-500 dark:bg-orange-600"
    : "bg-amber-500 dark:bg-amber-600";

  const label = isOverdue
    ? `OVERDUE — ${Math.abs(deadlineDays)} business day${Math.abs(deadlineDays) !== 1 ? "s" : ""} past deadline`
    : isToday
    ? "DUE TODAY — Deadline is today"
    : `${deadlineDays} business day${deadlineDays !== 1 ? "s" : ""} remaining`;

  const formattedDate = deadlineDate
    ? new Date(deadlineDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div
      className={`${bgColor} text-white px-4 py-2.5 flex items-center justify-between gap-4 no-print`}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-center gap-3 min-w-0">
        {isOverdue ? (
          <AlertTriangle className="h-4 w-4 shrink-0 animate-pulse" />
        ) : (
          <Clock className="h-4 w-4 shrink-0" />
        )}
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="font-semibold text-sm">{label}</span>
          {claimNumber && (
            <span className="text-white/80 text-xs">
              · Claim {claimNumber}
            </span>
          )}
          {currentStep && (
            <span className="text-white/80 text-xs">
              · Step: {currentStep.replace(/_/g, " ")}
            </span>
          )}
          {formattedDate && (
            <span className="text-white/80 text-xs">
              · Due {formattedDate}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          className="flex items-center gap-1 text-xs text-white/90 hover:text-white underline underline-offset-2 transition-colors"
          onClick={() => navigate(`/disputes/${disputeId}`)}
        >
          View dispute
          <ExternalLink className="h-3 w-3" />
        </button>
        <button
          className="p-1 rounded hover:bg-white/20 transition-colors"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss deadline banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
