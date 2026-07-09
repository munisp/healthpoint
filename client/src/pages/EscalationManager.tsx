import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, XCircle, Clock, Filter, Plus, Loader2 } from "lucide-react";

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-blue-100 text-blue-700",
  medium: "bg-yellow-100 text-yellow-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};
const STATUS_ICONS: Record<string, React.ReactNode> = {
  open: <Clock className="h-3.5 w-3.5 text-yellow-500" />,
  in_review: <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />,
  resolved: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
  dismissed: <XCircle className="h-3.5 w-3.5 text-gray-400" />,
};

export default function EscalationManager() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [showResolve, setShowResolve] = useState<string | null>(null);
  const [form, setForm] = useState({ disputeId: "", priority: "medium" as const, reason: "" });
  const [resolveForm, setResolveForm] = useState({ resolution: "", status: "resolved" as "resolved" | "dismissed" });
  const utils = trpc.useUtils();

  const { data: escalations = [], isLoading } = trpc.escalations.list.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const createMutation = trpc.escalations.create.useMutation({
    onSuccess: () => {
      utils.escalations.list.invalidate();
      setShowCreate(false);
      setForm({ disputeId: "", priority: "medium", reason: "" });
      toast.success("Escalation created");
    },
    onError: (e) => toast.error(e.message),
  });

  const resolveMutation = trpc.escalations.resolve.useMutation({
    onSuccess: () => {
      utils.escalations.list.invalidate();
      setShowResolve(null);
      setResolveForm({ resolution: "", status: "resolved" });
      toast.success("Escalation resolved");
    },
    onError: (e) => toast.error(e.message),
  });

  const openCount = escalations.filter(e => e.status === "open" || e.status === "in_review").length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-orange-500" />
            Escalation Manager
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Raise and track dispute escalations requiring urgent attention</p>
        </div>
        <div className="flex items-center gap-2">
          {openCount > 0 && <Badge className="bg-red-100 text-red-700">{openCount} open</Badge>}
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />New Escalation
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {["all", "open", "in_review", "resolved", "dismissed"].map(s => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            className="capitalize"
            onClick={() => setStatusFilter(s)}
          >
            {s.replace("_", " ")}
          </Button>
        ))}
      </div>

      {/* Escalation list */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading escalations...</div>
      ) : escalations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="h-12 w-12 mx-auto text-green-400 mb-3" />
            <h3 className="font-semibold">No escalations found</h3>
            <p className="text-sm text-muted-foreground mt-1">No escalations match the current filter.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {escalations.map(esc => (
            <Card key={esc.id} className={`border-l-4 ${esc.priority === "critical" ? "border-l-red-500" : esc.priority === "high" ? "border-l-orange-400" : esc.priority === "medium" ? "border-l-yellow-400" : "border-l-blue-300"}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {STATUS_ICONS[esc.status]}
                      <span className="font-semibold text-sm">Dispute: {esc.disputeId.slice(0, 12)}...</span>
                      <Badge className={`text-xs ${PRIORITY_COLORS[esc.priority]}`}>{esc.priority}</Badge>
                      <Badge variant="outline" className="text-xs capitalize">{esc.status.replace("_", " ")}</Badge>
                    </div>
                    <p className="text-sm text-foreground mt-1">{esc.reason}</p>
                    {esc.resolution && (
                      <div className="mt-2 p-2 bg-green-50 dark:bg-green-950/20 rounded text-xs text-green-700">
                        <strong>Resolution:</strong> {esc.resolution}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      Raised by {esc.raisedByName} · {new Date(esc.createdAt).toLocaleDateString()}
                      {esc.resolvedAt && ` · Resolved ${new Date(esc.resolvedAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  {isAdmin && (esc.status === "open" || esc.status === "in_review") && (
                    <Button size="sm" variant="outline" onClick={() => setShowResolve(esc.id)}>
                      Resolve
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Raise Escalation</DialogTitle>
            <DialogDescription>Flag a dispute for urgent attention</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Dispute ID *</label>
              <Input placeholder="Enter dispute ID" value={form.disputeId} onChange={e => setForm(f => ({ ...f, disputeId: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Priority</label>
              <Select value={form.priority} onValueChange={(v: any) => setForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["low", "medium", "high", "critical"].map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Reason *</label>
              <Textarea
                placeholder="Describe why this dispute needs escalation..."
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                className="min-h-[100px]"
                maxLength={2000}
              />
              <p className="text-xs text-muted-foreground mt-1">{form.reason.length}/2000</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({ disputeId: form.disputeId, priority: form.priority, reason: form.reason })}
              disabled={createMutation.isPending || !form.disputeId || form.reason.length < 10}
            >
              {createMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Creating...</> : "Raise Escalation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve Dialog */}
      <Dialog open={!!showResolve} onOpenChange={open => !open && setShowResolve(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Resolve Escalation</DialogTitle>
            <DialogDescription>Provide a resolution or dismiss this escalation</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Outcome</label>
              <Select value={resolveForm.status} onValueChange={(v: any) => setResolveForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="dismissed">Dismissed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Resolution Notes *</label>
              <Textarea
                placeholder="Describe how this was resolved..."
                value={resolveForm.resolution}
                onChange={e => setResolveForm(f => ({ ...f, resolution: e.target.value }))}
                className="min-h-[100px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResolve(null)}>Cancel</Button>
            <Button
              onClick={() => showResolve && resolveMutation.mutate({ id: showResolve, resolution: resolveForm.resolution, status: resolveForm.status })}
              disabled={resolveMutation.isPending || resolveForm.resolution.length < 5}
            >
              {resolveMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Saving...</> : "Confirm Resolution"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
