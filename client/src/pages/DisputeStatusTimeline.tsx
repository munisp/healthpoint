import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, Clock, ExternalLink, GitBranch } from "lucide-react";

const STATUS_SEQUENCE = [
  { status: "open_negotiation", label: "Open Negotiation", description: "Parties negotiate payment directly" },
  { status: "idr_initiated", label: "IDR Initiated", description: "IDR process formally started" },
  { status: "idr_entity_selection", label: "Entity Selection", description: "Selecting a certified IDR entity" },
  { status: "eligibility_review", label: "Eligibility Review", description: "IDR entity reviews eligibility" },
  { status: "offer_submission", label: "Offer Submission", description: "Both parties submit payment offers" },
  { status: "under_arbitration", label: "Under Arbitration", description: "IDR entity deliberating" },
  { status: "determination_issued", label: "Determination Issued", description: "IDR entity issues final determination" },
  { status: "payment_pending", label: "Payment Pending", description: "Awaiting payment execution" },
  { status: "closed", label: "Closed", description: "Dispute fully resolved" },
];

const TERMINAL_STATUSES = ["appealed", "ineligible"];

export default function DisputeStatusTimeline() {
  const [, navigate] = useLocation();
  const { data, isLoading } = trpc.disputes.list.useQuery({ limit: 100, offset: 0 });
  const disputes = data?.items ?? [];

  // Group disputes by their current status position
  const statusGroups = useMemo(() => {
    const groups: Record<string, typeof disputes> = {};
    STATUS_SEQUENCE.forEach(s => { groups[s.status] = []; });
    TERMINAL_STATUSES.forEach(s => { groups[s] = []; });
    disputes.forEach(d => {
      const s = d.status ?? "open_negotiation";
      if (!groups[s]) groups[s] = [];
      groups[s].push(d);
    });
    return groups;
  }, [disputes]);

  const totalActive = disputes.filter(d => d.status !== "closed" && d.status !== "ineligible").length;

  const formatCurrency = (v: number | string | null | undefined) => {
    if (!v) return "—";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitBranch className="h-6 w-6 text-blue-600" />
            Dispute Status Timeline
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Visual pipeline showing all disputes across IDR workflow stages</p>
        </div>
        <Badge variant="outline" className="text-sm">{totalActive} active disputes</Badge>
      </div>

      {/* Pipeline */}
      <div className="space-y-4">
        {STATUS_SEQUENCE.map((stage, idx) => {
          const stagDisputes = statusGroups[stage.status] ?? [];
          const isCompleted = false; // Could track based on dispute history
          return (
            <div key={stage.status} className="flex gap-4">
              {/* Stage indicator */}
              <div className="flex flex-col items-center w-8 shrink-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${stagDisputes.length > 0 ? "border-blue-500 bg-blue-50" : "border-muted bg-muted/30"}`}>
                  {stagDisputes.length > 0 ? (
                    <span className="text-xs font-bold text-blue-600">{stagDisputes.length}</span>
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                {idx < STATUS_SEQUENCE.length - 1 && (
                  <div className="w-0.5 flex-1 bg-border mt-1 min-h-[16px]" />
                )}
              </div>

              {/* Stage content */}
              <div className="flex-1 pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium text-sm">{stage.label}</span>
                  <span className="text-xs text-muted-foreground">{stage.description}</span>
                  {stagDisputes.length > 0 && (
                    <Badge className="bg-blue-100 text-blue-700 text-xs ml-auto">{stagDisputes.length} dispute{stagDisputes.length !== 1 ? "s" : ""}</Badge>
                  )}
                </div>
                {stagDisputes.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {stagDisputes.map(d => (
                      <div
                        key={d.id}
                        className="flex items-center gap-2 px-3 py-1.5 bg-card border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => navigate(`/disputes/${d.id}`)}
                      >
                        <span className="font-mono text-xs text-primary">{d.referenceNumber}</span>
                        <span className="text-xs text-muted-foreground hidden sm:inline">{formatCurrency(d.billedAmount)}</span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Terminal statuses */}
        <div className="border-t pt-4">
          <p className="text-xs text-muted-foreground mb-3 font-medium">Terminal States</p>
          <div className="flex gap-4">
            {TERMINAL_STATUSES.map(status => {
              const items = statusGroups[status] ?? [];
              return (
                <div key={status} className="flex items-center gap-2">
                  <Badge className={`${status === "appealed" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"} text-xs capitalize`}>
                    {status.replace(/_/g, " ")}: {items.length}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
