import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, ShieldCheck, TimerReset } from "lucide-react";

function formatDate(value?: Date | string | null) {
  return value ? new Date(value).toLocaleString() : "Not scheduled";
}

export default function HeartbeatOperations() {
  const jobs = trpc.heartbeatOperations.list.useQuery(undefined, { refetchInterval: 30_000 });
  const proofs = trpc.settlementProofs.list.useQuery({ limit: 30 }, { refetchInterval: 30_000 });
  const exceptions = trpc.settlementProofs.openExceptions.useQuery(undefined, { refetchInterval: 30_000 });
  const utils = trpc.useUtils();
  const refresh = () => {
    void Promise.all([
      utils.heartbeatOperations.list.invalidate(),
      utils.settlementProofs.list.invalidate(),
      utils.settlementProofs.openExceptions.invalidate(),
    ]);
  };

  const rows = jobs.data?.jobs ?? [];
  const enabled = rows.filter(job => job.isEnable).length;
  const latestProof = proofs.data?.[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Operations control plane</div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Heartbeat & Balance Proofs</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">Live schedule state from the project owner’s Heartbeat jobs and durable, PostgreSQL-backed daily settlement proof evidence.</p>
        </div>
        <Button variant="outline" onClick={refresh}><RefreshCw className="mr-2 h-4 w-4" />Refresh data</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Metric title="Heartbeat jobs" value={rows.length} detail={`${enabled} enabled`} icon={<Clock3 className="h-5 w-5" />} />
        <Metric title="Latest proof" value={latestProof?.status === "passed" ? "Passed" : latestProof?.status ?? "None"} detail={latestProof ? `Proof date ${latestProof.proofDate}` : "No durable proof yet"} icon={<CheckCircle2 className="h-5 w-5" />} positive={latestProof?.status === "passed"} />
        <Metric title="Open exceptions" value={exceptions.data?.length ?? 0} detail="Needs administrator review" icon={<AlertTriangle className="h-5 w-5" />} warning={(exceptions.data?.length ?? 0) > 0} />
        <Metric title="Latest evidence hash" value={latestProof?.evidenceHash ? "Recorded" : "Pending"} detail={latestProof?.evidenceHash ? `${latestProof.evidenceHash.slice(0, 14)}…` : "Generated with each proof"} icon={<TimerReset className="h-5 w-5" />} />
      </div>

      <Card>
        <CardHeader><CardTitle>Heartbeat execution state</CardTitle><CardDescription>Each row is live project schedule metadata, including the last and next platform execution timestamps.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="pb-3">Schedule</th><th className="pb-3">Cadence</th><th className="pb-3">State</th><th className="pb-3">Last execution</th><th className="pb-3">Next execution</th><th className="pb-3">Callback</th></tr></thead>
            <tbody className="divide-y">
              {jobs.isLoading && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Loading platform schedule state…</td></tr>}
              {!jobs.isLoading && rows.map(job => <tr key={job.taskUid} className="hover:bg-muted/40"><td className="py-3 font-medium">{job.name}<div className="mt-0.5 font-mono text-xs text-muted-foreground">{job.taskUid}</div></td><td className="py-3 font-mono text-xs">{job.cronExpression}</td><td className="py-3"><Badge variant={job.isEnable ? "default" : "secondary"}>{job.isEnable ? "Enabled" : "Paused"}</Badge></td><td className="py-3 text-muted-foreground">{formatDate(job.lastExecutedAt)}</td><td className="py-3 text-muted-foreground">{formatDate(job.nextExecutionAt)}</td><td className="py-3 font-mono text-xs">{job.callbackPath}</td></tr>)}
              {!jobs.isLoading && rows.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No project Heartbeat jobs are available.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Durable balance-proof evidence</CardTitle><CardDescription>Immutable daily proof rows persisted to PostgreSQL. A failed status or unresolved exception requires operational review.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm"><thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="pb-3">Proof date</th><th className="pb-3">Status</th><th className="pb-3">Transfers</th><th className="pb-3">Exceptions</th><th className="pb-3">Ledger mismatches</th><th className="pb-3">Evidence hash</th></tr></thead><tbody className="divide-y">
            {proofs.isLoading && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Loading balance proofs…</td></tr>}
            {!proofs.isLoading && (proofs.data ?? []).map(proof => <tr key={proof.id} className="hover:bg-muted/40"><td className="py-3 font-medium">{proof.proofDate}</td><td className="py-3"><Badge variant={proof.status === "passed" ? "default" : "destructive"}>{proof.status}</Badge></td><td className="py-3">{proof.transferCount} / {proof.reconciledTransferCount} reconciled</td><td className="py-3">{proof.unresolvedExceptionCount}</td><td className="py-3">{proof.ledgerMismatchCount}</td><td className="py-3 font-mono text-xs text-muted-foreground">{proof.evidenceHash}</td></tr>)}
            {!proofs.isLoading && !(proofs.data ?? []).length && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No balance proofs are available.</td></tr>}
          </tbody></table>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ title, value, detail, icon, positive, warning }: { title: string; value: string | number; detail: string; icon: React.ReactNode; positive?: boolean; warning?: boolean }) {
  return <Card><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-muted-foreground">{title}</p><p className={`mt-1 text-2xl font-bold ${positive ? "text-emerald-600" : warning ? "text-amber-600" : ""}`}>{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div><div className={`rounded-lg p-2 ${positive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950" : warning ? "bg-amber-100 text-amber-700 dark:bg-amber-950" : "bg-muted text-muted-foreground"}`}>{icon}</div></div></CardContent></Card>;
}
