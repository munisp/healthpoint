/**
 * NextActionsPanel — Phase 21 (S4). Next-action queue over the server's
 * read model (nextActions.list): deadline alerts, legal-next-step advance
 * cards, idle offers, quarantine repair and unposted remittances, grouped
 * by urgency. Each card links to its target and can be dismissed
 * (nextActions.dismiss; dismissals expire server-side after the TTL).
 *
 * Honesty: the queue is rule-based (modelName "next-actions-v1", no model
 * version). Empty states say exactly that — nothing is fabricated.
 */
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Bell, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";

type NextActionCardView = {
  actionKey: string;
  kind: "deadline" | "advance_step" | "idle_offer" | "quarantine_repair" | "unposted_remittance";
  title: string;
  disputeId?: string;
  href: string;
  dueAt?: string;
  severity: "critical" | "warning" | "info";
  ctaLabel: string;
  daysToDeadline: number | null;
  updatedAt?: string;
};

const SEVERITY_ORDER = ["critical", "warning", "info"] as const;
const SEVERITY_LABEL: Record<(typeof SEVERITY_ORDER)[number], string> = {
  critical: "Urgent",
  warning: "Upcoming",
  info: "For your attention",
};

function groupBySeverity(cards: NextActionCardView[]) {
  const groups = new Map<(typeof SEVERITY_ORDER)[number], NextActionCardView[]>();
  for (const s of SEVERITY_ORDER) groups.set(s, []);
  for (const c of cards) groups.get(c.severity)?.push(c);
  return groups;
}

export default function NextActionsPanel({
  orgId,
  persona,
  limit = 10,
}: {
  orgId?: string;
  persona?: "provider" | "submitter" | "payer" | "idre";
  limit?: number;
}) {
  const utils = trpc.useUtils();
  const listQ = trpc.nextActions.list.useQuery(
    { orgId, persona, limit },
    { refetchInterval: 120_000, retry: 1 },
  );
  const dismiss = trpc.nextActions.dismiss.useMutation({
    onSuccess: (_r, vars) => {
      // Optimistic-feeling refresh; the server hides the card until expiry.
      utils.nextActions.list.invalidate();
    },
    onError: e => toast.error(`Could not dismiss: ${e.message}`),
  });

  const cards = (listQ.data?.cards ?? []) as NextActionCardView[];
  const groups = groupBySeverity(cards);

  return (
    <Card className="border-slate-200">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
          <Bell size={16} className="text-blue-500" />
          Next actions
          {cards.length > 0 && <Badge variant="secondary" className="text-xs">{cards.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {listQ.isLoading && (
          <p className="text-sm text-muted-foreground">Computing your next actions…</p>
        )}
        {listQ.isError && (
          <p role="alert" className="text-sm text-destructive">
            Next actions unavailable: {listQ.error.message}
          </p>
        )}
        {listQ.data && cards.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 size={16} className="text-green-500" />
            Nothing needs your attention right now — no upcoming deadlines, idle offers, or repairs in scope.
          </div>
        )}
        {SEVERITY_ORDER.map(sev => {
          const items = groups.get(sev) ?? [];
          if (!items.length) return null;
          return (
            <div key={sev} className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                {sev === "critical" && <AlertTriangle size={12} className="text-red-500" />}
                {SEVERITY_LABEL[sev]}
              </p>
              <ul className="space-y-1.5">
                {items.map(c => (
                  <li
                    key={c.actionKey}
                    className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                      sev === "critical"
                        ? "border-red-200 bg-red-50"
                        : sev === "warning"
                          ? "border-amber-200 bg-amber-50"
                          : "border-slate-200 bg-white"
                    }`}
                  >
                    <span className="flex-1 min-w-0 text-slate-800">{c.title}</span>
                    {c.dueAt && (
                      <span className="text-xs text-muted-foreground">
                        due {new Date(c.dueAt).toLocaleDateString()}
                      </span>
                    )}
                    <Link href={c.href}>
                      <Button size="sm" variant="outline" className="h-7 text-xs">
                        {c.ctaLabel}
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      aria-label={`Dismiss: ${c.title}`}
                      disabled={dismiss.isPending}
                      onClick={() => dismiss.mutate({ actionKey: c.actionKey })}
                    >
                      <X size={14} />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
