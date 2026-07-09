import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AlertTriangle, AlertCircle, CheckCircle2, RefreshCw, Clock, TrendingUp, Zap } from "lucide-react";

const SEVERITY_CONFIG = {
  critical: { label: "Critical", color: "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400", icon: AlertCircle, border: "border-l-red-500" },
  warning: { label: "Warning", color: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400", icon: AlertTriangle, border: "border-l-amber-500" },
};

export default function SLABreachMonitor() {
  const [severityFilter, setSeverityFilter] = useState<"all" | "critical" | "warning">("all");

  const { data: summary } = trpc.sla.summary.useQuery();
  const { data: breaches, isLoading, refetch } = trpc.sla.breaches.useQuery({
    severity: severityFilter === "all" ? undefined : severityFilter,
    limit: 100,
  });

  const checkMutation = trpc.sla.check.useMutation({
    onSuccess: (data) => {
      if (data.breached) {
        toast.error(`SLA breach detected: ${data.breachDays} days overdue (${data.severity})`);
      } else {
        toast.success("No SLA breach detected for this dispute");
      }
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
            SLA Breach Monitor
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track statutory deadline compliance across all active IDR disputes
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />Refresh
        </Button>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Total Breaches</span>
              </div>
              <div className="text-3xl font-bold mt-1">{summary.total}</div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-red-500">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-500" />
                <span className="text-sm text-muted-foreground">Critical</span>
              </div>
              <div className="text-3xl font-bold mt-1 text-red-600">{summary.critical}</div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-amber-500">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span className="text-sm text-muted-foreground">Warning</span>
              </div>
              <div className="text-3xl font-bold mt-1 text-amber-600">{summary.warning}</div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-green-500">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm text-muted-foreground">Resolved</span>
              </div>
              <div className="text-3xl font-bold mt-1 text-green-600">{summary.resolved}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Select value={severityFilter} onValueChange={(v: any) => setSeverityFilter(v)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="critical">Critical Only</SelectItem>
            <SelectItem value="warning">Warning Only</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {breaches?.length ?? 0} breach{(breaches?.length ?? 0) !== 1 ? "es" : ""} shown
        </span>
      </div>

      {/* Breach list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !breaches || breaches.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-500 mb-3" />
          <h3 className="font-semibold text-lg">No SLA Breaches</h3>
          <p className="text-sm text-muted-foreground mt-1">All disputes are within their statutory deadlines.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {breaches.map((breach: any) => {
            const cfg = SEVERITY_CONFIG[breach.severity as keyof typeof SEVERITY_CONFIG] ?? SEVERITY_CONFIG.warning;
            const Icon = cfg.icon;
            return (
              <div key={breach.id} className={`flex items-start gap-4 p-4 rounded-lg border border-l-4 ${cfg.border} bg-card`}>
                <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${breach.severity === "critical" ? "text-red-500" : "text-amber-500"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">Dispute {breach.disputeId.slice(0, 8)}...</span>
                    <Badge className={cfg.color}>{cfg.label}</Badge>
                    <span className="text-xs text-muted-foreground">Step: {breach.step?.replace(/_/g, " ")}</span>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-sm">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      Deadline: {breach.deadlineDays}d
                    </span>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <TrendingUp className="h-3.5 w-3.5" />
                      Actual: {breach.actualDays}d
                    </span>
                    <span className={`font-semibold ${breach.severity === "critical" ? "text-red-600" : "text-amber-600"}`}>
                      +{breach.breachDays}d overdue
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Detected {new Date(breach.detectedAt).toLocaleString()}
                    {breach.resolvedAt && <span className="text-green-600 ml-2">✓ Resolved {new Date(breach.resolvedAt).toLocaleDateString()}</span>}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs shrink-0"
                  onClick={() => window.open(`/disputes/${breach.disputeId}`, "_blank")}
                >
                  View Dispute
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
