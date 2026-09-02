import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Layers, Search, CheckSquare, Square, RefreshCw, AlertTriangle, ChevronDown } from "lucide-react";

const STATUSES = ["open_negotiation", "idr_initiated", "idr_entity_selection", "eligibility_review", "offer_submission", "under_arbitration", "determination_issued", "payment_pending", "closed", "appealed", "ineligible"] as const;
type DisputeStatus = typeof STATUSES[number];
const STATUS_COLORS: Record<string, string> = {
  open_negotiation: "bg-blue-100 text-blue-700",
  idr_initiated: "bg-purple-100 text-purple-700",
  idr_entity_selection: "bg-violet-100 text-violet-700",
  eligibility_review: "bg-yellow-100 text-yellow-700",
  offer_submission: "bg-orange-100 text-orange-700",
  under_arbitration: "bg-red-100 text-red-700",
  determination_issued: "bg-teal-100 text-teal-700",
  payment_pending: "bg-amber-100 text-amber-700",
  closed: "bg-green-100 text-green-700",
  appealed: "bg-pink-100 text-pink-700",
  ineligible: "bg-gray-100 text-gray-700",
};

export default function BulkStatusChange() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetStatus, setTargetStatus] = useState<DisputeStatus | "">("")
  const [showConfirm, setShowConfirm] = useState(false);

  const { data: disputes, isLoading, refetch } = trpc.disputes.list.useQuery({ limit: 200 });
  const bulkMutation = trpc.bulkActions.changeStatus.useMutation({
    onSuccess: (data) => {
      toast.success(`Updated ${data.updated} disputes to "${targetStatus}"`);
      setSelected(new Set());
      setShowConfirm(false);
      setTargetStatus("");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const items = disputes?.items ?? [];

  const filtered = useMemo(() => {
    return items.filter((d: any) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return d.id.toLowerCase().includes(q) || (d.respondingPartyName ?? "").toLowerCase().includes(q) || (d.referenceNumber ?? "").toLowerCase().includes(q);
      }
      return true;
    });
  }, [items, search, statusFilter]);

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((d: any) => d.id)));
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allSelected = filtered.length > 0 && selected.size === filtered.length;
  const someSelected = selected.size > 0 && selected.size < filtered.length;

  const handleBulkUpdate = () => {
    if (!targetStatus || selected.size === 0) return;
    bulkMutation.mutate({ ids: Array.from(selected), status: targetStatus as DisputeStatus });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="h-6 w-6 text-teal-600" />
            Bulk Status Change
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Select multiple disputes and update their status in one action</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <span className="text-sm font-medium">{selected.size} dispute{selected.size !== 1 ? "s" : ""} selected</span>
          <Select value={targetStatus} onValueChange={(v) => setTargetStatus(v as DisputeStatus)}>
            <SelectTrigger className="w-52 h-8 text-sm">
              <SelectValue placeholder="Change status to..." />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={!targetStatus || bulkMutation.isPending} onClick={() => setShowConfirm(true)}>
            Apply to {selected.size} disputes
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear selection</Button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search disputes..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground self-center">{filtered.length} disputes</span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <Checkbox
                      checked={allSelected}
                      ref={(el: any) => { if (el) el.indeterminate = someSelected; }}
                      onCheckedChange={toggleAll}
                    />
                  </th>
                  {["Reference", "Payer", "Status", "Billed Amount", "Created"].map(h => (
                    <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Loading disputes...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No disputes match the current filters</td></tr>
                ) : (
                  filtered.map((d: any) => (
                    <tr key={d.id} className={`hover:bg-muted/30 cursor-pointer ${selected.has(d.id) ? "bg-primary/5" : ""}`} onClick={() => toggleOne(d.id)}>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <Checkbox checked={selected.has(d.id)} onCheckedChange={() => toggleOne(d.id)} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{d.referenceNumber ?? d.id.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-xs max-w-32 truncate">{d.respondingPartyName ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[d.status] ?? "bg-gray-100 text-gray-700"}`}>
                          {(d.status ?? "").replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono">
                        {d.billedAmount ? `$${parseFloat(d.billedAmount).toLocaleString()}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(d.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Confirm dialog */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirm Bulk Status Change
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            You are about to change the status of <strong>{selected.size} dispute{selected.size !== 1 ? "s" : ""}</strong> to{" "}
            <strong className="text-foreground">"{targetStatus?.replace(/_/g, " ")}"</strong>. This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>Cancel</Button>
            <Button onClick={handleBulkUpdate} disabled={bulkMutation.isPending}>
              {bulkMutation.isPending ? "Updating..." : `Update ${selected.size} disputes`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
