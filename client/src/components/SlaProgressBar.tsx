import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type SlaStatus = "ok" | "warning" | "critical" | "breached";

export interface SlaProgressBarProps {
  /** 0–100 — percentage of the deadline window elapsed */
  percent: number;
  /** Human-readable deadline label, e.g. "Jun 30, 2025" */
  deadlineLabel?: string;
  /** NSA step name, e.g. "Open Negotiation" */
  stepLabel?: string;
  /** Days remaining (positive) or days overdue (negative) */
  daysRemaining?: number;
  /** Total deadline window in days */
  deadlineDays?: number;
  /** Compact single-line mode for use inside tables */
  compact?: boolean;
}

/** Thresholds */
const WARNING_PCT = 75;
const CRITICAL_PCT = 90;

export function getSlaStatus(percent: number): SlaStatus {
  if (percent >= 100) return "breached";
  if (percent >= CRITICAL_PCT) return "critical";
  if (percent >= WARNING_PCT) return "warning";
  return "ok";
}

const STATUS_CONFIG: Record<SlaStatus, {
  bar: string;
  track: string;
  text: string;
  badge: string;
  icon: React.ReactNode;
  label: string;
}> = {
  ok: {
    bar: "bg-emerald-500",
    track: "bg-emerald-100",
    text: "text-emerald-700",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    label: "On Track",
  },
  warning: {
    bar: "bg-amber-400",
    track: "bg-amber-100",
    text: "text-amber-700",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    icon: <Clock className="h-3.5 w-3.5" />,
    label: "At Risk",
  },
  critical: {
    bar: "bg-red-500",
    track: "bg-red-100",
    text: "text-red-700",
    badge: "bg-red-50 text-red-700 border-red-200",
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    label: "Critical",
  },
  breached: {
    bar: "bg-red-700",
    track: "bg-red-200",
    text: "text-red-800",
    badge: "bg-red-100 text-red-800 border-red-300",
    icon: <XCircle className="h-3.5 w-3.5" />,
    label: "Breached",
  },
};

export default function SlaProgressBar({
  percent,
  deadlineLabel,
  stepLabel,
  daysRemaining,
  deadlineDays,
  compact = false,
}: SlaProgressBarProps) {
  const clamped = Math.min(Math.max(percent, 0), 100);
  const status = getSlaStatus(clamped);
  const cfg = STATUS_CONFIG[status];

  const daysText =
    daysRemaining !== undefined
      ? daysRemaining < 0
        ? `${Math.abs(daysRemaining)}d overdue`
        : daysRemaining === 0
        ? "Due today"
        : `${daysRemaining}d left`
      : null;

  const tooltipContent = (
    <div className="text-xs space-y-0.5 max-w-[200px]">
      {stepLabel && <div className="font-semibold">{stepLabel}</div>}
      <div>{Math.round(clamped)}% of deadline elapsed</div>
      {deadlineDays && <div>Window: {deadlineDays} business days</div>}
      {deadlineLabel && <div>Deadline: {deadlineLabel}</div>}
      {daysText && <div className={cfg.text}>{daysText}</div>}
    </div>
  );

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 min-w-0 cursor-default">
            {/* Bar */}
            <div className={`flex-1 h-1.5 rounded-full ${cfg.track} overflow-hidden`}>
              <div
                className={`h-full rounded-full transition-all ${cfg.bar}`}
                style={{ width: `${clamped}%` }}
              />
            </div>
            {/* Percentage */}
            <span className={`text-xs font-medium tabular-nums shrink-0 ${cfg.text}`}>
              {Math.round(clamped)}%
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltipContent}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="space-y-1.5 cursor-default select-none">
          {/* Header row */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {stepLabel && (
                <span className="text-xs font-medium text-slate-700 truncate">{stepLabel}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Status badge */}
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border ${cfg.badge}`}>
                {cfg.icon}
                {cfg.label}
              </span>
              {/* Percentage */}
              <span className={`text-xs font-bold tabular-nums ${cfg.text}`}>
                {Math.round(clamped)}%
              </span>
            </div>
          </div>

          {/* Track + bar */}
          <div className={`h-2.5 rounded-full ${cfg.track} overflow-hidden relative`}>
            <div
              className={`h-full rounded-full transition-all duration-500 ${cfg.bar}`}
              style={{ width: `${clamped}%` }}
            />
            {/* Threshold markers */}
            <div
              className="absolute top-0 bottom-0 w-px bg-amber-400/60"
              style={{ left: `${WARNING_PCT}%` }}
              title="75% warning threshold"
            />
            <div
              className="absolute top-0 bottom-0 w-px bg-red-500/60"
              style={{ left: `${CRITICAL_PCT}%` }}
              title="90% critical threshold"
            />
          </div>

          {/* Footer row */}
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>0%</span>
            <div className="flex items-center gap-3">
              <span className="text-amber-500">▲ 75% warn</span>
              <span className="text-red-500">▲ 90% crit</span>
            </div>
            <span className={daysText ? cfg.text : ""}>
              {daysText ?? (deadlineLabel ? `Due ${deadlineLabel}` : "100%")}
            </span>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltipContent}</TooltipContent>
    </Tooltip>
  );
}

/** Compact legend for use in card headers */
export function SlaLegend() {
  return (
    <div className="flex items-center gap-3 text-xs text-slate-500">
      <span className="flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" /> On Track
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" /> At Risk (≥75%)
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" /> Critical (≥90%)
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-700" /> Breached
      </span>
    </div>
  );
}
