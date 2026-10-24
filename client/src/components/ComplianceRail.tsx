import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarClock, CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

/**
 * ComplianceRail - compact statutory deadline rail for a dispute.
 * Embeddable (e.g. into DisputeDetail by the wiring agent).
 * Data: idrCompliance["deadlines.listForDispute"] (+ computeForDispute refresh).
 */
export function ComplianceRail({ disputeId }: { disputeId: string }) {
  const listQuery = trpc.idrCompliance["deadlines.listForDispute"].useQuery(
    { disputeId },
    { enabled: !!disputeId, retry: false }
  );
  const computeMutation = trpc.idrCompliance["deadlines.computeForDispute"].useMutation({
    onSuccess: () => {
      toast.success("Statutory deadlines recomputed");
      listQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = (listQuery.data ?? []) as any[];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
          <CalendarClock size={13} className="text-primary" /> Statutory Deadlines
        </p>
        <Button
          size="sm" variant="ghost" className="h-7 px-2 text-xs"
          disabled={computeMutation.isPending}
          title="Recompute and persist the statutory deadline ledger (45 CFR 149.510)"
          onClick={() => computeMutation.mutate({ disputeId })}
        >
          <RefreshCw size={12} className={computeMutation.isPending ? "animate-spin" : ""} />
        </Button>
      </div>
      {listQuery.isLoading ? (
        <div className="space-y-1.5"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-full" /></div>
      ) : listQuery.isError ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <ShieldAlert size={12} className="text-destructive" /> {listQuery.error.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No deadline ledger yet. Press refresh to compute the statutory deadline set for this dispute.
        </p>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {rows.map((r, i) => {
            const remaining = daysUntil(r.computedDeadline);
            const met = r.status === "met";
            const overdue = !met && remaining != null && remaining < 0;
            return (
              <div key={r.id ?? i} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">
                    {String(r.deadlineType ?? "").replace(/_/g, " ")}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {r.computedDeadline ? new Date(r.computedDeadline).toLocaleDateString() : "-"}{" "}
                    ({r.dayCount} {r.dayKind} days) {r.cfrReference ? `- ${r.cfrReference}` : ""}
                  </p>
                </div>
                {met ? (
                  <Badge variant="secondary" className="flex items-center gap-1 shrink-0">
                    <CheckCircle2 size={11} /> met
                  </Badge>
                ) : overdue ? (
                  <Badge variant="destructive" className="shrink-0">{Math.abs(remaining!)}d overdue</Badge>
                ) : (
                  <Badge variant={remaining != null && remaining <= 3 ? "destructive" : "outline"} className="shrink-0">
                    {remaining}d left
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ComplianceRail;
