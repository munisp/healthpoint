import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { summarizeProviderDisputes } from "@shared/disputeManagement";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import DisputeComments from "@/components/DisputeComments";
import { AlertTriangle, ArrowRight, BriefcaseBusiness, CheckCircle2, CircleDollarSign, Download, Search } from "lucide-react";
import { toast } from "sonner";

const STATUS_OPTIONS = ["all", "open_negotiation", "idr_initiated", "offer_submission", "under_arbitration", "determination_issued", "payment_pending", "closed"];
const STATUS_LABEL: Record<string, string> = { open_negotiation: "Open negotiation", idr_initiated: "IDR initiated", offer_submission: "Offer submission", under_arbitration: "Under arbitration", determination_issued: "Determination issued", payment_pending: "Payment pending", closed: "Closed" };

export default function ProviderDisputeManagement() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<any>(null);
  const query = trpc.disputes.list.useQuery({ status: status === "all" ? undefined : status as any, search: search || undefined, limit: 100, offset: 0 });
  const exportQuery = trpc.disputes.exportCSV.useQuery({ status: status === "all" ? undefined : status as any, search: search || undefined }, { enabled: false });
  const rows = query.data?.items ?? [];
  const summary = useMemo(() => summarizeProviderDisputes(rows), [rows]);
  const exportFilteredDisputes = async () => {
    const result = await exportQuery.refetch();
    if (!result.data) {
      toast.error("The filtered dispute export could not be prepared.");
      return;
    }
    const blob = new Blob([result.data.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = result.data.filename;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${result.data.rowCount} persisted dispute record${result.data.rowCount === 1 ? "" : "s"}.`);
  };

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><div className="flex items-center gap-2 text-sm text-muted-foreground"><BriefcaseBusiness className="h-4 w-4 text-sky-600" /> Provider workspace</div><h1 className="mt-1 text-3xl font-bold tracking-tight">My Disputes</h1><p className="mt-1 max-w-2xl text-muted-foreground">Track every dispute you can access, focus on approaching payment deadlines, and continue only through the validated IDR workflow.</p></div><div className="flex gap-2"><Button variant="outline" onClick={exportFilteredDisputes} disabled={exportQuery.isFetching}><Download className="mr-2 h-4 w-4" />{exportQuery.isFetching ? "Preparing…" : "Export CSV"}</Button><Button onClick={() => navigate("/disputes/new")}>Initiate dispute</Button></div></div>
    <div className="grid gap-4 md:grid-cols-4"><Metric title="Total tracked" value={summary.total} icon={<BriefcaseBusiness className="h-5 w-5" />} /><Metric title="Active" value={summary.active} icon={<CheckCircle2 className="h-5 w-5" />} /><Metric title="Payment pending" value={summary.pendingPayment} icon={<CircleDollarSign className="h-5 w-5" />} /><Metric title="Attention window" value={summary.attention} icon={<AlertTriangle className="h-5 w-5" />} warning /></div>
    <Card><CardHeader><CardTitle>Find and resolve work</CardTitle><CardDescription>Filters query persisted disputes only. Workflow actions open the underlying dispute record, where authorization and canonical transition rules remain enforced.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex flex-col gap-3 md:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search reference number or party" value={search} onChange={e => setSearch(e.target.value)} /></div><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full md:w-52"><SelectValue /></SelectTrigger><SelectContent>{STATUS_OPTIONS.map(value => <SelectItem value={value} key={value}>{value === "all" ? "All statuses" : STATUS_LABEL[value] ?? value}</SelectItem>)}</SelectContent></Select></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="pb-3">Reference</th><th className="pb-3">Payer</th><th className="pb-3">Stage</th><th className="pb-3">Payment deadline</th><th className="pb-3">Amount</th><th className="pb-3" /></tr></thead><tbody className="divide-y">{query.isLoading && <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">Loading your persisted disputes…</td></tr>}{!query.isLoading && rows.map((dispute: any) => <tr key={dispute.id} className="hover:bg-muted/40"><td className="py-3 font-mono font-medium">{dispute.referenceNumber}</td><td className="py-3">{dispute.respondingPartyName ?? "Not recorded"}</td><td className="py-3"><Badge variant="secondary">{STATUS_LABEL[dispute.status] ?? dispute.status?.replace(/_/g, " ")}</Badge></td><td className="py-3 text-muted-foreground">{dispute.paymentDeadline ? new Date(dispute.paymentDeadline).toLocaleDateString() : "—"}</td><td className="py-3 font-medium">${Number(dispute.billedAmount ?? 0).toLocaleString()}</td><td className="py-3 text-right"><Button variant="outline" size="sm" onClick={() => setSelected(dispute)}>Review action <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button></td></tr>)}{!query.isLoading && !rows.length && <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">No persisted disputes match this filter.</td></tr>}</tbody></table></div></CardContent></Card>
    <Dialog open={Boolean(selected)} onOpenChange={open => !open && setSelected(null)}><DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Coordinate resolution: {selected?.referenceNumber}</DialogTitle><DialogDescription>Discuss the issue with administrators here, then open the controlled workflow for the next validated IDR action. Comments are persisted to the selected dispute and retain author, edit, and reply controls.</DialogDescription></DialogHeader>{selected && <div className="rounded-lg border bg-muted/20 p-4"><DisputeComments disputeId={selected.id} /></div>}<DialogFooter><Button variant="outline" onClick={() => setSelected(null)}>Close discussion</Button><Button onClick={() => selected && navigate(`/disputes/${selected.id}`)}>Open controlled workflow <ArrowRight className="ml-2 h-4 w-4" /></Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function Metric({ title, value, icon, warning }: { title: string; value: number; icon: React.ReactNode; warning?: boolean }) { return <Card><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-muted-foreground">{title}</p><p className={`mt-1 text-3xl font-bold ${warning && value ? "text-amber-600" : ""}`}>{value}</p></div><div className={`rounded-lg p-2 ${warning && value ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700"}`}>{icon}</div></div></CardContent></Card>; }
