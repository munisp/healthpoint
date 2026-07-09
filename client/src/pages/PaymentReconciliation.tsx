import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { DollarSign, CheckCircle2, AlertTriangle, RefreshCw, Search, Download, TrendingUp, Clock } from "lucide-react";

type ReconciliationStatus = "matched" | "unmatched" | "partial" | "overpaid";

interface ReconciliationRow {
  disputeId: string;
  claimId: string;
  billedAmount: number;
  determinedAmount: number | null;
  paidAmount: number | null;
  status: ReconciliationStatus;
  variance: number;
  payerName: string;
  closedAt: string | null;
}

const STATUS_CONFIG: Record<ReconciliationStatus, { label: string; color: string; icon: any }> = {
  matched: { label: "Matched", color: "bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400", icon: CheckCircle2 },
  unmatched: { label: "Unmatched", color: "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400", icon: AlertTriangle },
  partial: { label: "Partial", color: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400", icon: Clock },
  overpaid: { label: "Overpaid", color: "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400", icon: TrendingUp },
};

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function PaymentReconciliation() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ReconciliationStatus>("all");

  const { data: disputes, isLoading, refetch } = trpc.disputes.list.useQuery({ limit: 200, status: "closed" });

  const rows: ReconciliationRow[] = useMemo(() => {
    if (!disputes?.items) return [];
    return disputes.items.map((d: any) => {
      const billed = parseFloat(d.billedAmount ?? "0") || 0;
      const determined = d.determinedAmount ? parseFloat(d.determinedAmount) : null;
      const paid = d.paidAmount ? parseFloat(d.paidAmount) : null;

      let status: ReconciliationStatus = "unmatched";
      let variance = 0;

      if (determined !== null && paid !== null) {
        variance = paid - determined;
        if (Math.abs(variance) < 0.01) status = "matched";
        else if (variance > 0) status = "overpaid";
        else status = "partial";
      } else if (paid !== null && determined === null) {
        variance = paid - billed;
        status = Math.abs(variance) < 0.01 ? "matched" : variance > 0 ? "overpaid" : "partial";
      }

      return {
        disputeId: d.id,
        claimId: d.claimId ?? d.id.slice(0, 8),
        billedAmount: billed,
        determinedAmount: determined,
        paidAmount: paid,
        status,
        variance,
        payerName: d.respondingPartyName ?? "Unknown Payer",
        closedAt: d.closedAt ?? d.updatedAt,
      };
    });
  }, [disputes]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return r.disputeId.toLowerCase().includes(q) || r.claimId.toLowerCase().includes(q) || r.payerName.toLowerCase().includes(q);
      }
      return true;
    });
  }, [rows, search, statusFilter]);

  const summary = useMemo(() => ({
    total: rows.length,
    matched: rows.filter(r => r.status === "matched").length,
    unmatched: rows.filter(r => r.status === "unmatched").length,
    partial: rows.filter(r => r.status === "partial").length,
    overpaid: rows.filter(r => r.status === "overpaid").length,
    totalBilled: rows.reduce((s, r) => s + r.billedAmount, 0),
    totalPaid: rows.reduce((s, r) => s + (r.paidAmount ?? 0), 0),
    totalVariance: rows.reduce((s, r) => s + r.variance, 0),
  }), [rows]);

  const exportCSV = () => {
    const headers = ["Dispute ID", "Claim ID", "Payer", "Billed", "Determined", "Paid", "Variance", "Status", "Closed At"];
    const csvRows = [headers, ...filtered.map(r => [r.disputeId, r.claimId, r.payerName, r.billedAmount, r.determinedAmount ?? "", r.paidAmount ?? "", r.variance, r.status, r.closedAt ?? ""])];
    const csv = csvRows.map(row => row.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `reconciliation-${new Date().toISOString().split("T")[0]}.csv`; a.click(); URL.revokeObjectURL(url);
    toast.success("Reconciliation report exported");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <DollarSign className="h-6 w-6 text-green-600" />
            Payment Reconciliation
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Match payments to dispute determinations and identify variances</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={filtered.length === 0}><Download className="h-4 w-4 mr-2" />Export CSV ({filtered.length})</Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(["matched", "partial", "unmatched", "overpaid"] as ReconciliationStatus[]).map(s => {
          const cfg = STATUS_CONFIG[s];
          const Icon = cfg.icon;
          return (
            <Card key={s} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{cfg.label}</span>
                </div>
                <div className="text-3xl font-bold mt-1">{summary[s]}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Financial summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Total Billed</p><p className="text-2xl font-bold">{fmt(summary.totalBilled)}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Total Paid</p><p className="text-2xl font-bold text-green-600">{fmt(summary.totalPaid)}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Net Variance</p><p className={`text-2xl font-bold ${summary.totalVariance >= 0 ? "text-blue-600" : "text-red-600"}`}>{fmt(summary.totalVariance)}</p></CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search dispute, claim, payer..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {(Object.keys(STATUS_CONFIG) as ReconciliationStatus[]).map(s => (
              <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {["Dispute ID", "Payer", "Billed", "Determined", "Paid", "Variance", "Status", "Closed"].map(h => (
                    <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">Loading...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">No records match the current filters</td></tr>
                ) : (
                  filtered.map(r => {
                    const cfg = STATUS_CONFIG[r.status];
                    return (
                      <tr key={r.disputeId} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-mono text-xs">{r.disputeId.slice(0, 8)}...</td>
                        <td className="px-4 py-3 text-xs max-w-32 truncate">{r.payerName}</td>
                        <td className="px-4 py-3 font-mono text-xs">{fmt(r.billedAmount)}</td>
                        <td className="px-4 py-3 font-mono text-xs">{fmt(r.determinedAmount)}</td>
                        <td className="px-4 py-3 font-mono text-xs">{fmt(r.paidAmount)}</td>
                        <td className={`px-4 py-3 font-mono text-xs font-semibold ${r.variance > 0 ? "text-blue-600" : r.variance < 0 ? "text-red-600" : "text-green-600"}`}>
                          {r.variance !== 0 ? (r.variance > 0 ? "+" : "") + fmt(r.variance) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {r.closedAt ? new Date(r.closedAt).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot className="bg-muted/30 border-t-2 font-semibold">
                  <tr>
                    <td colSpan={2} className="px-4 py-3 text-xs">{filtered.length} records</td>
                    <td className="px-4 py-3 font-mono text-xs">{fmt(filtered.reduce((s, r) => s + r.billedAmount, 0))}</td>
                    <td className="px-4 py-3 text-xs">—</td>
                    <td className="px-4 py-3 font-mono text-xs text-green-600">{fmt(filtered.reduce((s, r) => s + (r.paidAmount ?? 0), 0))}</td>
                    <td className={`px-4 py-3 font-mono text-xs font-bold ${filtered.reduce((s, r) => s + r.variance, 0) >= 0 ? "text-blue-600" : "text-red-600"}`}>
                      {fmt(filtered.reduce((s, r) => s + r.variance, 0))}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
