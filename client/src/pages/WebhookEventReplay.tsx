import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { RefreshCw, RotateCcw, CheckCircle2, AlertCircle, Clock, Zap, ChevronDown, ChevronRight } from "lucide-react";

const STATUS_CONFIG = {
  delivered: { label: "Delivered", color: "bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400", icon: CheckCircle2 },
  failed: { label: "Failed", color: "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400", icon: AlertCircle },
  pending: { label: "Pending", color: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400", icon: Clock },
};

export default function WebhookEventReplay() {
  const [statusFilter, setStatusFilter] = useState<"failed" | "pending" | "delivered" | "all">("failed");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replayAllConfirm, setReplayAllConfirm] = useState(false);

  const { data: deliveries, isLoading, refetch } = trpc.webhookReplay.list.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
    limit: 100,
  });

  const replayMutation = trpc.webhookReplay.replay.useMutation({
    onSuccess: () => { toast.success("Webhook queued for replay"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const replayAllMutation = trpc.webhookReplay.replayAll.useMutation({
    onSuccess: () => { toast.success("All failed webhooks queued for replay"); setReplayAllConfirm(false); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const failedCount = (deliveries as any[])?.filter((d: any) => d.status === "failed").length ?? 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <RotateCcw className="h-6 w-6 text-orange-600" />
            Webhook Event Replay
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Inspect and replay failed or pending webhook deliveries</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
          {failedCount > 0 && (
            <Button variant="destructive" size="sm" onClick={() => setReplayAllConfirm(true)}>
              <RotateCcw className="h-4 w-4 mr-2" />Replay All Failed ({failedCount})
            </Button>
          )}
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {(deliveries as any[])?.length ?? 0} deliveries
        </span>
      </div>

      {/* Deliveries list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !deliveries || (deliveries as any[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-500 mb-3" />
          <h3 className="font-semibold">No deliveries found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {statusFilter === "failed" ? "No failed webhook deliveries — all webhooks are healthy!" : "No deliveries match the current filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {(deliveries as any[]).map((d: any) => {
            const cfg = STATUS_CONFIG[d.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
            const Icon = cfg.icon;
            const isExpanded = expandedId === d.id;
            let payload: any = null;
            try { payload = JSON.parse(d.payload); } catch {}

            return (
              <Card key={d.id} className="overflow-hidden">
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/30"
                  onClick={() => setExpandedId(isExpanded ? null : d.id)}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${d.status === "delivered" ? "text-green-500" : d.status === "failed" ? "text-red-500" : "text-amber-500"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-medium">{d.eventType}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span>
                      <span className="text-xs text-muted-foreground">Attempts: {d.attempts}</span>
                      {d.responseStatus && (
                        <span className={`text-xs font-mono ${d.responseStatus >= 200 && d.responseStatus < 300 ? "text-green-600" : "text-red-600"}`}>
                          HTTP {d.responseStatus}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Webhook {d.webhookId.slice(0, 8)}... · {new Date(d.createdAt).toLocaleString()}
                      {d.lastAttemptAt && <span className="ml-2">Last attempt: {new Date(d.lastAttemptAt).toLocaleString()}</span>}
                    </div>
                    {d.errorMessage && (
                      <div className="text-xs text-red-500 mt-0.5 truncate max-w-lg">{d.errorMessage}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(d.status === "failed" || d.status === "pending") && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7"
                        onClick={e => { e.stopPropagation(); replayMutation.mutate({ id: d.id }); }}
                        disabled={replayMutation.isPending}
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />Replay
                      </Button>
                    )}
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t bg-muted/20 p-4">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Payload</p>
                    <pre className="text-xs bg-background border rounded p-3 overflow-x-auto max-h-48">
                      {payload ? JSON.stringify(payload, null, 2) : d.payload}
                    </pre>
                    {d.responseBody && (
                      <>
                        <p className="text-xs font-medium text-muted-foreground mt-3 mb-2">Response Body</p>
                        <pre className="text-xs bg-background border rounded p-3 overflow-x-auto max-h-32">{d.responseBody}</pre>
                      </>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Replay all confirm */}
      <Dialog open={replayAllConfirm} onOpenChange={setReplayAllConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-orange-500" />
              Replay All Failed Webhooks
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will queue <strong>{failedCount} failed webhook deliveries</strong> for immediate retry. Are you sure?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplayAllConfirm(false)}>Cancel</Button>
            <Button onClick={() => replayAllMutation.mutate({ status: "failed" })} disabled={replayAllMutation.isPending}>
              {replayAllMutation.isPending ? "Queuing..." : `Replay ${failedCount} webhooks`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
