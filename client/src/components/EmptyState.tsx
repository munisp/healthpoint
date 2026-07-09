import { Button } from "@/components/ui/button";
import { LucideIcon, Scale, FileText, Activity, BookOpen, Search, Webhook, BarChart2, Database } from "lucide-react";

type EmptyVariant =
  | "disputes"
  | "documents"
  | "audit"
  | "ledger"
  | "search"
  | "webhooks"
  | "reports"
  | "generic";

interface EmptyStateProps {
  variant?: EmptyVariant;
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  className?: string;
}

const VARIANTS: Record<
  EmptyVariant,
  { icon: LucideIcon; color: string; bg: string; defaultTitle: string; defaultDescription: string }
> = {
  disputes: {
    icon: Scale,
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    defaultTitle: "No disputes yet",
    defaultDescription:
      "Create your first IDR dispute to start the 19-step No Surprises Act workflow. Track deadlines, manage documents, and monitor outcomes.",
  },
  documents: {
    icon: FileText,
    color: "text-violet-500",
    bg: "bg-violet-50 dark:bg-violet-950/30",
    defaultTitle: "No documents uploaded",
    defaultDescription:
      "Upload EOBs, Remittance Advices, or CMS-1500 forms. Our AI will extract fields automatically to speed up your dispute filing.",
  },
  audit: {
    icon: Activity,
    color: "text-amber-500",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    defaultTitle: "No audit events found",
    defaultDescription:
      "Audit events are recorded automatically as disputes progress. Try adjusting your date range or search filters.",
  },
  ledger: {
    icon: BookOpen,
    color: "text-green-500",
    bg: "bg-green-50 dark:bg-green-950/30",
    defaultTitle: "No ledger entries",
    defaultDescription:
      "Financial entries are recorded when disputes are created and payments are processed. Select a dispute to view its ledger.",
  },
  search: {
    icon: Search,
    color: "text-slate-500",
    bg: "bg-slate-50 dark:bg-slate-900/50",
    defaultTitle: "No results found",
    defaultDescription:
      "Try different keywords, broaden your date range, or check your category filters.",
  },
  webhooks: {
    icon: Webhook,
    color: "text-rose-500",
    bg: "bg-rose-50 dark:bg-rose-950/30",
    defaultTitle: "No webhooks configured",
    defaultDescription:
      "Add an outbound webhook to receive real-time notifications in your EHR or billing system when disputes change state.",
  },
  reports: {
    icon: BarChart2,
    color: "text-indigo-500",
    bg: "bg-indigo-50 dark:bg-indigo-950/30",
    defaultTitle: "No report data",
    defaultDescription:
      "Reports populate as disputes are filed and resolved. Check back after your first dispute closes.",
  },
  generic: {
    icon: Database,
    color: "text-muted-foreground",
    bg: "bg-muted/40",
    defaultTitle: "Nothing here yet",
    defaultDescription: "There's nothing to display right now. Try again later or adjust your filters.",
  },
};

export default function EmptyState({
  variant = "generic",
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  className = "",
}: EmptyStateProps) {
  const v = VARIANTS[variant];
  const Icon = v.icon;

  return (
    <div className={`flex flex-col items-center justify-center py-16 px-6 text-center ${className}`}>
      {/* Icon circle */}
      <div className={`flex items-center justify-center h-20 w-20 rounded-full ${v.bg} mb-5`}>
        <Icon className={`h-9 w-9 ${v.color}`} />
      </div>

      {/* Text */}
      <h3 className="text-base font-semibold text-foreground mb-2">
        {title ?? v.defaultTitle}
      </h3>
      <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
        {description ?? v.defaultDescription}
      </p>

      {/* Actions */}
      {(actionLabel || secondaryActionLabel) && (
        <div className="flex items-center gap-3 mt-6">
          {secondaryActionLabel && onSecondaryAction && (
            <Button variant="outline" size="sm" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </Button>
          )}
          {actionLabel && onAction && (
            <Button size="sm" onClick={onAction}>
              {actionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
