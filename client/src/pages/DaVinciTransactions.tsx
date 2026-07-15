import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { GitBranch, Plus, RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";

const TX_TYPE_LABELS: Record<string, string> = {
  PAS: "Prior Auth Support (PAS)",
  CDex: "Clinical Data Exchange (CDex)",
  DTR: "Documentation Templates & Rules",
  CRD: "Coverage Requirements Discovery",
};

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode }> = {
  submitted: { color: "bg-blue-100 text-blue-800", icon: <Clock className="h-3 w-3" /> },
  approved: { color: "bg-emerald-100 text-emerald-800", icon: <CheckCircle2 className="h-3 w-3" /> },
  denied: { color: "bg-red-100 text-red-800", icon: <XCircle className="h-3 w-3" /> },
  pending: { color: "bg-amber-100 text-amber-800", icon: <AlertTriangle className="h-3 w-3" /> },
  error: { color: "bg-slate-100 text-slate-700", icon: <XCircle className="h-3 w-3" /> },
};

export default function DaVinciTransactions() {
  const [disputeFilter, setDisputeFilter] = useState("");
  const [txTypeFilter, setTxTypeFilter] = useState("all");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [form, setForm] = useState({ disputeId: "", txType: "PAS", payload: "" });

  const { data: transactions = [], refetch, isLoading } = trpc.daVinci.list.useQuery({
    disputeId: disputeFilter || undefined,
    txType: txTypeFilter !== "all" ? txTypeFilter : undefined,
  });

  const submitMutation = trpc.daVinci.submitPAS.useMutation({
    onSuccess: () => {
      toast.success("Da Vinci transaction submitted successfully.");
      setSubmitOpen(false);
      setForm({ disputeId: "", txType: "PAS", payload: "" });
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const filtered = transactions.filter(tx =>
    !disputeFilter || tx.disputeId?.includes(disputeFilter)
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <GitBranch className="h-6 w-6 text-blue-600" />
              Da Vinci Transactions
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              HL7 Da Vinci implementation guide transactions — PAS, CDex, DTR, and CRD exchanges
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" /> Submit Transaction
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Submit Da Vinci Transaction</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div>
                    <Label>Dispute ID (optional)</Label>
                    <Input
                      placeholder="Link to a dispute..."
                      value={form.disputeId}
                      onChange={e => setForm(f => ({ ...f, disputeId: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Transaction Type</Label>
                    <Select value={form.txType} onValueChange={v => setForm(f => ({ ...f, txType: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(TX_TYPE_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>FHIR Payload (JSON)</Label>
                    <Textarea
                      rows={6}
                      placeholder='{"resourceType": "Bundle", ...}'
                      value={form.payload}
                      onChange={e => setForm(f => ({ ...f, payload: e.target.value }))}
                      className="font-mono text-xs"
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => {
                      let parsed: Record<string, unknown> = {};
                      try { parsed = form.payload ? JSON.parse(form.payload) : {}; } catch { toast.error("Invalid JSON payload"); return; }
                      submitMutation.mutate({
                        disputeId: form.disputeId || undefined,
                        requestPayload: { txType: form.txType, ...parsed },
                      });
                    }}
                    disabled={submitMutation.isPending}
                  >
                    {submitMutation.isPending ? "Submitting..." : "Submit"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 items-end">
          <div className="flex-1 max-w-xs">
            <Label className="text-xs">Filter by Dispute ID</Label>
            <Input
              placeholder="Search dispute..."
              value={disputeFilter}
              onChange={e => setDisputeFilter(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Transaction Type</Label>
            <Select value={txTypeFilter} onValueChange={setTxTypeFilter}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {Object.entries(TX_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transaction Log</CardTitle>
            <CardDescription>{filtered.length} transaction{filtered.length !== 1 ? "s" : ""}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading transactions...</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <GitBranch className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No Da Vinci transactions found</p>
                <p className="text-sm">Submit a PAS, CDex, DTR, or CRD transaction to get started.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-left py-2 pr-4">Type</th>
                      <th className="text-left py-2 pr-4">Dispute</th>
                      <th className="text-left py-2 pr-4">Status</th>
                      <th className="text-left py-2 pr-4">Submitted</th>
                      <th className="text-left py-2">Response</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(tx => {
                      const statusCfg = STATUS_CONFIG[tx.status ?? "pending"] ?? STATUS_CONFIG.pending;
                      return (
                        <tr key={tx.id} className="border-b hover:bg-muted/30">
                          <td className="py-2 pr-4 font-medium">
                            <Badge variant="outline">{tx.txType ?? "—"}</Badge>
                          </td>
                          <td className="py-2 pr-4 text-muted-foreground font-mono text-xs">
                            {tx.disputeId ?? "—"}
                          </td>
                          <td className="py-2 pr-4">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${statusCfg.color}`}>
                              {statusCfg.icon}
                              {tx.status ?? "pending"}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-muted-foreground text-xs">
                            {tx.createdAt ? new Date(tx.createdAt).toLocaleString() : "—"}
                          </td>
                          <td className="py-2 text-xs text-muted-foreground max-w-xs truncate">
                            {tx.responsePayload
                              ? JSON.stringify(tx.responsePayload).slice(0, 80) + "..."
                              : "Awaiting response"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
