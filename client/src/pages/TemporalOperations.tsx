import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Database, Loader2, RefreshCw, RotateCcw, Search, ShieldCheck, WifiOff, Workflow } from "lucide-react";
import { toast } from "sonner";

function formatDate(value?: Date | string | null) {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}

function parseDrill(details: Record<string, unknown> | null | undefined) {
  return details?.transport === "mock" && details?.outcome === "verified_no_network_dispatch";
}

export default function TemporalOperations() {
  const [search, setSearch] = useState("");
  const utils = trpc.useUtils();
  const readiness = trpc.temporal.readiness.useQuery(undefined, { refetchInterval: 30_000 });
  const history = trpc.temporal.dispatchHistory.useQuery({ limit: 50 }, { refetchInterval: 15_000 });
  const alerts = trpc.temporal.connectionAlerts.useQuery(undefined, { refetchInterval: 15_000 });
  const connectionCheck = trpc.temporal.checkConnection.useMutation({
    onSuccess: result => {
      if (result.reachable) toast.success("Temporal accepted a strictly authenticated connection.");
      else toast.error(result.recovery?.message ?? "Temporal connection is unavailable.", { description: result.recovery?.guidance ?? "Verify the approved Temporal service and worker, then retry." });
    },
    onError: error => toast.error("Temporal connection check failed", { description: error.message }),
    onSettled: () => {
      void utils.temporal.connectionAlerts.invalidate();
      void utils.temporal.dispatchHistory.invalidate();
    },
  });
  const workflows = trpc.temporal.allWorkflows.useQuery({ limit: 10 }, { retry: false, refetchInterval: 30_000, enabled: connectionCheck.data?.reachable === true });
  const drill = trpc.temporal.runControlledDrill.useMutation({
    onSuccess: result => {
      toast.success("Controlled mock dispatch drill verified", { description: `Evidence ${result.drill.payloadHash.slice(0, 12)}… recorded in PostgreSQL.` });
      void utils.temporal.dispatchHistory.invalidate();
    },
    onError: error => toast.error("Controlled drill was blocked", { description: error.message }),
  });

  const refresh = () => {
    void Promise.all([
      utils.temporal.readiness.invalidate(),
      utils.temporal.dispatchHistory.invalidate(),
      utils.temporal.connectionAlerts.invalidate(),
      utils.temporal.allWorkflows.invalidate(),
    ]);
  };

  const visibleHistory = useMemo(() => (history.data ?? []).filter(event => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return [event.action, event.entityId, event.userId, JSON.stringify(event.details ?? {})].some(value => value?.toLowerCase().includes(needle));
  }), [history.data, search]);
  const controlledDrills = (history.data ?? []).filter(event => parseDrill(event.details)).length;
  const connectionRecovery = connectionCheck.data && !connectionCheck.data.reachable ? connectionCheck.data.recovery : null;

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Workflow className="h-4 w-4 text-indigo-600" /> Durable workflow control plane</div>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Temporal Dispatch Operations</h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">Monitor strict-TLS workflow connectivity, inspect PostgreSQL-backed dispatch evidence, and run a synthetic mock transport drill that cannot create a payment instruction or modify a real dispute.</p>
        {readiness.data?.verification === "unverified_default" && <Badge variant="outline" className="mt-3 border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200">Unverified default worker configuration</Badge>}
      </div>
      <div className="flex gap-2"><Button variant="outline" onClick={refresh}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button><Button onClick={() => drill.mutate()} disabled={drill.isPending}><ClipboardCheck className="mr-2 h-4 w-4" />{drill.isPending ? "Verifying drill…" : "Run controlled mock drill"}</Button></div>
    </div>

    <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20"><CardContent className="flex gap-3 p-4 text-sm"><ShieldCheck className="h-5 w-5 shrink-0 text-amber-700" /><div><strong>Safety boundary:</strong> The drill builds a synthetic workflow envelope and terminates at an in-process mock transport. It performs no Temporal network dispatch, cannot change a dispute, and requires payment execution to stay disabled.</div></CardContent></Card>

    {alerts.data?.visible && <Card className="border-destructive bg-destructive/5"><CardContent className="flex flex-col gap-3 p-4 text-sm md:flex-row md:items-center md:justify-between"><div className="flex gap-3"><AlertTriangle className="h-5 w-5 shrink-0 text-destructive" /><div><p className="font-semibold">Repeated Temporal connection failures detected</p><p className="text-muted-foreground">{alerts.data.failureCount} failed supervised checks in the last {alerts.data.windowMinutes} minutes. {alerts.data.recovery?.guidance ?? "Verify the service and approved worker configuration before retrying."}</p></div></div><Button variant="outline" onClick={() => connectionCheck.mutate()} disabled={connectionCheck.isPending}><RotateCcw className="mr-2 h-4 w-4" />Retry read-only check</Button></CardContent></Card>}

    <div className="grid gap-4 md:grid-cols-4">
      <Metric title="Configuration" value={readiness.data?.configured ? readiness.data.verification === "unverified_default" ? "Unverified" : "Ready" : "Blocked"} detail={readiness.data?.configured ? `${readiness.data.namespace} / ${readiness.data.taskQueue}` : readiness.data?.reason ?? "Loading configuration"} icon={<ShieldCheck className="h-5 w-5" />} positive={readiness.data?.verification === "operator_configured"} warning={readiness.data?.configured === false || readiness.data?.verification === "unverified_default"} />
      <Metric title="Real dispatch" value={readiness.data?.dispatchEnabled ? "Enabled" : "Disabled"} detail="Separate from the mock drill" icon={<Workflow className="h-5 w-5" />} warning={!readiness.data?.dispatchEnabled} />
      <Metric title="Controlled drills" value={controlledDrills} detail="Durable audit evidence" icon={<ClipboardCheck className="h-5 w-5" />} positive={controlledDrills > 0} />
      <Metric title="Workflow records" value={workflows.data?.length ?? "—"} detail={workflows.isError ? "Unavailable until Temporal recovers" : "Live Temporal visibility"} icon={<Database className="h-5 w-5" />} warning={workflows.isError} />
    </div>

    <Card>
      <CardHeader><CardTitle>Connection recovery</CardTitle><CardDescription>Connection establishment uses at most three short retries for transient secure transport errors. Workflow start commands are never retried implicitly.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div className="flex min-h-12 items-start gap-3 text-sm">{connectionCheck.isPending ? <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-muted-foreground" /> : connectionCheck.data?.reachable ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" /> : <WifiOff className="mt-0.5 h-5 w-5 text-amber-600" />}<div>{connectionCheck.data?.reachable ? <><p className="font-medium">Secure connection verified</p><p className="text-muted-foreground">Namespace {connectionCheck.data.namespace}; task queue {connectionCheck.data.taskQueue}.</p></> : connectionRecovery ? <><p className="font-medium">{connectionRecovery.message}</p><p className="text-muted-foreground">{connectionRecovery.guidance}</p></> : <><p className="font-medium">No active connection check</p><p className="text-muted-foreground">Run a read-only connectivity check before attempting a real dispatch.</p></>}</div></div><Button variant="outline" onClick={() => connectionCheck.mutate()} disabled={connectionCheck.isPending}><RotateCcw className="mr-2 h-4 w-4" />{connectionCheck.isPending ? "Checking…" : "Check secure connection"}</Button></CardContent>
    </Card>

    <Card className={alerts.data?.severity === "critical" ? "border-destructive" : undefined}>
      <CardHeader><CardTitle>Connection alert status</CardTitle><CardDescription>Repeated failures are calculated from durable, supervised read-only connection checks in PostgreSQL.</CardDescription></CardHeader>
      <CardContent className="flex items-center gap-3 text-sm">{alerts.data?.severity === "critical" ? <AlertTriangle className="h-5 w-5 text-destructive" /> : alerts.data?.severity === "warning" ? <AlertTriangle className="h-5 w-5 text-amber-600" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}<div><p className="font-medium">{alerts.data?.failureCount ?? 0} of {alerts.data?.threshold ?? 3} alert-threshold failures</p><p className="text-muted-foreground">Window: {alerts.data?.windowMinutes ?? 15} minutes. Last failure: {formatDate(alerts.data?.lastFailureAt)}.</p></div></CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Dispatch and drill history</CardTitle><CardDescription>Immutable PostgreSQL audit entries for controlled drills and explicitly requested workflow dispatches.</CardDescription></CardHeader>
      <CardContent className="space-y-4 overflow-x-auto"><div className="relative max-w-xl"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search dispatch ID, action, user, or evidence" aria-label="Search Temporal dispatch history" /></div><table className="w-full min-w-[760px] text-sm"><thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="pb-3">Recorded</th><th className="pb-3">Type</th><th className="pb-3">Identifier</th><th className="pb-3">Mode</th><th className="pb-3">Outcome</th><th className="pb-3">Evidence</th></tr></thead><tbody className="divide-y">{history.isLoading && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Loading durable dispatch evidence…</td></tr>}{!history.isLoading && visibleHistory.map(event => { const details = event.details; const isDrill = parseDrill(details); return <tr key={event.id} className="hover:bg-muted/40"><td className="py-3 text-muted-foreground">{formatDate(event.createdAt)}</td><td className="py-3"><Badge variant={isDrill ? "secondary" : "outline"}>{isDrill ? "Controlled drill" : "Workflow dispatch"}</Badge></td><td className="py-3 font-mono text-xs">{event.entityId}</td><td className="py-3">{typeof details?.transport === "string" ? details.transport : "Temporal"}</td><td className="py-3">{typeof details?.outcome === "string" ? details.outcome.replaceAll("_", " ") : event.action}</td><td className="py-3 font-mono text-xs text-muted-foreground">{typeof details?.payloadHash === "string" ? `${details.payloadHash.slice(0, 16)}…` : "Dispatch audit"}</td></tr>; })}{!history.isLoading && !visibleHistory.length && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No Temporal dispatch evidence matches the current search.</td></tr>}</tbody></table></CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Live workflow status</CardTitle><CardDescription>Read-only workflow visibility from Temporal. If the secure service is unavailable, the recovery panel above explains the next safe action.</CardDescription></CardHeader>
      <CardContent className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="pb-3">Workflow</th><th className="pb-3">Status</th><th className="pb-3">Task queue</th><th className="pb-3">Started</th><th className="pb-3">Closed</th></tr></thead><tbody className="divide-y">{workflows.isLoading && <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">Checking Temporal workflow visibility…</td></tr>}{workflows.isError && <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">Live workflow status is unavailable. Use the secure connection check for recovery guidance.</td></tr>}{!workflows.isLoading && !workflows.isError && (workflows.data ?? []).map(workflow => <tr key={`${workflow.workflowId}-${workflow.runId ?? "current"}`}><td className="py-3 font-mono text-xs">{workflow.workflowId}</td><td className="py-3"><Badge variant={workflow.status === "RUNNING" ? "default" : "secondary"}>{workflow.status}</Badge></td><td className="py-3 font-mono text-xs">{workflow.taskQueue ?? "—"}</td><td className="py-3 text-muted-foreground">{formatDate(workflow.startTime)}</td><td className="py-3 text-muted-foreground">{formatDate(workflow.closeTime)}</td></tr>)}{!workflows.isLoading && !workflows.isError && !(workflows.data ?? []).length && <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No Temporal workflows were returned.</td></tr>}</tbody></table></CardContent>
    </Card>
  </div>;
}

function Metric({ title, value, detail, icon, positive, warning }: { title: string; value: string | number; detail: string; icon: React.ReactNode; positive?: boolean; warning?: boolean }) {
  return <Card><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm text-muted-foreground">{title}</p><p className={`mt-1 text-2xl font-bold ${positive ? "text-emerald-600" : warning ? "text-amber-600" : ""}`}>{value}</p><p className="mt-1 truncate text-xs text-muted-foreground" title={detail}>{detail}</p></div><div className={`rounded-lg p-2 ${positive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950" : warning ? "bg-amber-100 text-amber-700 dark:bg-amber-950" : "bg-muted text-muted-foreground"}`}>{icon}</div></div></CardContent></Card>;
}
