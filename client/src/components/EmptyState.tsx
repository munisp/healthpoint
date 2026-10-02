import { Button } from "@/components/ui/button";
import {
  LucideIcon,
  Scale,
  FileText,
  Activity,
  BookOpen,
  Search,
  Webhook,
  BarChart2,
  Database,
  Bell,
  Wallet,
} from "lucide-react";

type EmptyVariant =
  | "disputes"
  | "documents"
  | "audit"
  | "ledger"
  | "search"
  | "webhooks"
  | "reports"
  | "notifications"
  | "payments"
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

/**
 * Illustration-free, typographic empty states. Colors come from the semantic
 * design tokens (success/warning/danger/info) so every tone stays inside the
 * low-saturation trust palette and meets WCAG AA on its background.
 */
const VARIANTS: Record<
  EmptyVariant,
  { icon: LucideIcon; tone: string; defaultTitle: string; defaultDescription: string }
> = {
  disputes: {
    icon: Scale,
    tone: "bg-accent text-accent-foreground",
    defaultTitle: "No disputes yet",
    defaultDescription:
      "Create your first IDR dispute to start the No Surprises Act workflow. Track deadlines, manage documents, and monitor outcomes.",
  },
  documents: {
    icon: FileText,
    tone: "bg-info text-info-foreground",
    defaultTitle: "No documents uploaded",
    defaultDescription:
      "Upload EOBs, Remittance Advices, or CMS-1500 forms. Fields are extracted automatically to speed up your dispute filing.",
  },
  audit: {
    icon: Activity,
    tone: "bg-warning text-warning-foreground",
    defaultTitle: "No audit events found",
    defaultDescription:
      "Audit events are recorded automatically as disputes progress. Try adjusting your date range or search filters.",
  },
  ledger: {
    icon: BookOpen,
    tone: "bg-success text-success-foreground",
    defaultTitle: "No ledger entries",
    defaultDescription:
      "Financial entries are recorded when disputes are created and payments are processed. Select a dispute to view its ledger.",
  },
  search: {
    icon: Search,
    tone: "bg-muted text-muted-foreground",
    defaultTitle: "No results found",
    defaultDescription:
      "Try different keywords, broaden your date range, or check your category filters.",
  },
  webhooks: {
    icon: Webhook,
    tone: "bg-info text-info-foreground",
    defaultTitle: "No webhooks configured",
    defaultDescription:
      "Add an outbound webhook to receive real-time notifications in your EHR or billing system when disputes change state.",
  },
  reports: {
    icon: BarChart2,
    tone: "bg-accent text-accent-foreground",
    defaultTitle: "No report data",
    defaultDescription:
      "Reports populate as disputes are filed and resolved. Check back after your first dispute closes.",
  },
  notifications: {
    icon: Bell,
    tone: "bg-info text-info-foreground",
    defaultTitle: "No notifications",
    defaultDescription:
      "You're all caught up. Deadline reminders, status changes, and payment events will appear here.",
  },
  payments: {
    icon: Wallet,
    tone: "bg-success text-success-foreground",
    defaultTitle: "No payments yet",
    defaultDescription:
      "Payments and settlements are recorded here once a dispute resolves. Reconcile them against your remittance advice.",
  },
  generic: {
    icon: Database,
    tone: "bg-muted text-muted-foreground",
    defaultTitle: "Nothing here yet",
    defaultDescription:
      "There's nothing to display right now. Try again later or adjust your filters.",
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
    <div
      className={`flex flex-col items-center justify-center py-16 px-6 text-center ${className}`}
    >
      {/* Icon circle */}
      <div
        className={`flex items-center justify-center h-20 w-20 rounded-full mb-5 ${v.tone}`}
      >
        <Icon className="h-9 w-9" aria-hidden="true" />
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
