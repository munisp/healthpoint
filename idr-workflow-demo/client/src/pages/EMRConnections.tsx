import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus, Database, CheckCircle2, XCircle, AlertCircle,
  Clock, Zap, Trash2, Power, Activity, History, RefreshCw,
  ChevronDown, ChevronUp, Download,
} from "lucide-react";

const STATUS_CONFIG = {
  active: { label: "Active", icon: CheckCircle2, color: "text-green-600", badge: "default" as const },
  inactive: { label: "Inactive", icon: Power, color: "text-muted-foreground", badge: "secondary" as const },
  error: { label: "Error", icon: XCircle, color: "text-destructive", badge: "destructive" as const },
  testing: { label: "Testing", icon: Activity, color: "text-blue-600", badge: "secondary" as const },
};

const SYNC_STATUS_CONFIG = {
  success: { label: "Success", color: "text-green-700", bg: "bg-green-50 border-green-200", dot: "bg-green-500" },
  partial: { label: "Partial", color: "text-amber-700", bg: "bg-amber-50 border-amber-200", dot: "bg-amber-500" },
  failed: { label: "Failed", color: "text-red-700", bg: "bg-red-50 border-red-200", dot: "bg-red-500" },
  timeout: { label: "Timeout", color: "text-orange-700", bg: "bg-orange-50 border-orange-200", dot: "bg-orange-500" },
};

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual Pull",
  dispute_pull: "Dispute Form Pull",
  heartbeat: "Scheduled Sync",
  test: "Connection Test",
};

const EMR_LOGOS: Record<string, string> = {
  epic: "🏥", cerner: "🔵", meditech: "🟢", allscripts: "🟠",
  athenahealth: "🔷", nextgen: "🟣", eclinicalworks: "🔶", custom_fhir: "⚙️",
};

function SyncHistoryModal({
  connectionId,
  connectionName,
  open,
  onClose,
}: {
  connectionId: string;
  connectionName: string;
  open: boolean;
  onClose: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: logs, isLoading, refetch, isFetching } = trpc.emr.syncHistory.useQuery(
    { connectionId, limit: 100 },
    { enabled: open }
  );

  const totalSyncs = logs?.length ?? 0;
  const successCount = logs?.filter(l => l.status === "success").length ?? 0;
  const failedCount = logs?.filter(l => l.status === "failed" || l.status === "timeout").length ?? 0;
  const avgFields = logs && logs.length > 0
    ? Math.round(logs.reduce((s, l) => s + (l.fieldsExtracted ?? 0), 0) / logs.length)
    : 0;
  const avgDuration = logs && logs.length > 0
    ? Math.round(logs.reduce((s, l) => s + (l.durationMs ?? 0), 0) / logs.length)
    : 0;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-blue-600" />
            Sync History — {connectionName}
          </DialogTitle>
          <DialogDescription>
            Detailed log of all data pulls and connection tests for this EMR integration.
          </DialogDescription>
        </DialogHeader>

        {/* Summary metrics */}
        <div className="grid grid-cols-4 gap-3 py-2 border-b">
          {[
            { label: "Total Syncs", value: totalSyncs, color: "text-slate-800" },
            { label: "Successful", value: successCount, color: "text-green-700" },
            { label: "Failed", value: failedCount, color: failedCount > 0 ? "text-red-700" : "text-slate-800" },
            { label: "Avg Fields", value: avgFields, color: "text-blue-700" },
          ].map(m => (
            <div key={m.label} className="text-center">
              <div className={`text-2xl font-bold ${m.color}`}>{m.value}</div>
              <div className="text-xs text-muted-foreground">{m.label}</div>
            </div>
          ))}
        </div>

        {avgDuration > 0 && (
          <div className="text-xs text-muted-foreground text-center -mt-1 pb-1">
            Average duration: {avgDuration < 1000 ? `${avgDuration}ms` : `${(avgDuration / 1000).toFixed(1)}s`}
          </div>
        )}

        {/* Refresh button */}
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Log list */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {isLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Activity className="h-5 w-5 animate-pulse mr-2" />
              Loading sync history…
            </div>
          )}

          {!isLoading && (!logs || logs.length === 0) && (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <Clock className="h-10 w-10 text-muted-foreground/30" />
              <div>
                <p className="font-medium text-muted-foreground">No sync history yet</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  Sync logs will appear here after the first data pull or connection test.
                </p>
              </div>
            </div>
          )}

          {logs && logs.map(log => {
            const sc = SYNC_STATUS_CONFIG[log.status] ?? SYNC_STATUS_CONFIG.failed;
            const isExpanded = expandedId === log.id;
            const confidence = log.fieldConfidence as Record<string, number> | null;
            const warnings = log.warnings as string[] | null;
            const fhirResources = log.fhirResourcesAccessed as string[] | null;

            return (
              <div
                key={log.id}
                className={`rounded-lg border text-sm ${sc.bg} transition-all`}
              >
                {/* Row header */}
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  onClick={() => setExpandedId(isExpanded ? null : log.id)}
                >
                  <span className={`h-2 w-2 rounded-full shrink-0 ${sc.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-semibold text-xs ${sc.color}`}>{sc.label}</span>
                      <Badge variant="outline" className="text-xs py-0">
                        {TRIGGER_LABELS[log.triggerType] ?? log.triggerType}
                      </Badge>
                      {log.fieldsExtracted != null && log.fieldsExtracted > 0 && (
                        <span className="text-xs text-slate-600">
                          {log.fieldsExtracted} fields extracted
                        </span>
                      )}
                      {fhirResources && fhirResources.length > 0 && (
                        <span className="text-xs text-slate-500">
                          via {fhirResources.slice(0, 3).join(", ")}{fhirResources.length > 3 ? ` +${fhirResources.length - 3}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3">
                      <span>{log.createdAt ? new Date(log.createdAt).toLocaleString() : "—"}</span>
                      {log.durationMs != null && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {log.durationMs < 1000 ? `${log.durationMs}ms` : `${(log.durationMs / 1000).toFixed(1)}s`}
                        </span>
                      )}
                      {log.patientId && <span>Patient: {log.patientId}</span>}
                      {log.claimId && <span>Claim: {log.claimId}</span>}
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-current/10 pt-3">
                    {log.summary && (
                      <p className="text-xs text-slate-700">{log.summary}</p>
                    )}

                    {log.errorMessage && (
                      <Alert variant="destructive" className="py-2">
                        <XCircle className="h-3.5 w-3.5" />
                        <AlertDescription className="text-xs">{log.errorMessage}</AlertDescription>
                      </Alert>
                    )}

                    {confidence && Object.keys(confidence).length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-slate-600 mb-1.5">Field Confidence Scores</p>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(confidence).map(([field, score]) => (
                            <span
                              key={field}
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                score >= 0.9 ? "bg-green-100 text-green-700" :
                                score >= 0.7 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                              }`}
                            >
                              {field}: {Math.round(score * 100)}%
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {warnings && warnings.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-amber-700 mb-1">Warnings</p>
                        <ul className="space-y-0.5">
                          {warnings.map((w, i) => (
                            <li key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
                              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                              {w}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {fhirResources && fhirResources.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-slate-600 mb-1">FHIR Resources Accessed</p>
                        <div className="flex flex-wrap gap-1">
                          {fhirResources.map(r => (
                            <Badge key={r} variant="outline" className="text-xs">{r}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-3 text-xs text-muted-foreground">
                      {log.triggeredBy && <span>Triggered by: {log.triggeredBy}</span>}
                      {log.disputeId && <span>Dispute: {log.disputeId.slice(0, 8)}…</span>}
                      <span>Log ID: {log.id.slice(0, 8)}…</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function EMRConnections() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [historyConn, setHistoryConn] = useState<{ id: string; name: string } | null>(null);
  const [retestingId, setRetestingId] = useState<string | null>(null);

  const { data: connections, isLoading } = trpc.emr.list.useQuery();

  const retest = trpc.emr.testById.useMutation({
    onSuccess: (result, vars) => {
      setRetestingId(null);
      utils.emr.list.invalidate();
      utils.emr.syncHistory.invalidate({ connectionId: vars.connectionId });
      if (result.success) {
        toast.success(`Re-test passed — confidence ${Math.round((result.confidence ?? 0) * 100)}%`);
      } else {
        toast.warning("Re-test completed with warnings. Check sync history.");
      }
    },
    onError: (err: { message: string }) => {
      setRetestingId(null);
      toast.error(`Re-test failed: ${err.message}`);
    },
  });

  const deactivate = trpc.emr.deactivate.useMutation({
    onSuccess: () => {
      toast.success("EMR connection deactivated");
      utils.emr.list.invalidate();
    },
    onError: (err: { message: string }) => toast.error(`Failed: ${err.message}`),
  });

  const deleteConn = trpc.emr.delete.useMutation({
    onSuccess: () => {
      toast.success("EMR connection deleted");
      utils.emr.list.invalidate();
    },
    onError: (err: { message: string }) => toast.error(`Failed: ${err.message}`),
  });

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">EMR Connections</h1>
          <p className="text-muted-foreground mt-1">
            Manage FHIR-based EMR integrations for AI-assisted dispute pre-population.
          </p>
        </div>
        <Button onClick={() => navigate("/emr-onboarding")}>
          <Plus className="mr-2 h-4 w-4" />
          Add EMR Connection
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Activity className="h-5 w-5 animate-pulse mr-2" />
          Loading connections…
        </div>
      )}

      {!isLoading && (!connections || connections.length === 0) && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <Database className="h-12 w-12 text-muted-foreground/40" />
            <div className="text-center">
              <p className="font-medium">No EMR connections yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Connect your EMR system to enable AI-assisted dispute pre-population and document validation.
              </p>
            </div>
            <Button onClick={() => navigate("/emr-onboarding")}>
              <Plus className="mr-2 h-4 w-4" />
              Add Your First EMR Connection
            </Button>
          </CardContent>
        </Card>
      )}

      {connections && connections.length > 0 && (
        <div className="space-y-4">
          {connections.map(conn => {
            const statusCfg = STATUS_CONFIG[conn.status] ?? STATUS_CONFIG.inactive;
            const StatusIcon = statusCfg.icon;
            const logo = EMR_LOGOS[conn.emrSystem] ?? "🔌";
            const confidence = conn.aiConfidenceScore ? Math.round(Number(conn.aiConfidenceScore) * 100) : null;

            return (
              <Card key={conn.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{logo}</span>
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          {conn.name}
                          <Badge variant={statusCfg.badge} className="text-xs">
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {statusCfg.label}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="mt-0.5">
                          {conn.emrSystem.charAt(0).toUpperCase() + conn.emrSystem.slice(1)} · FHIR {conn.fhirVersion} · {conn.authType.toUpperCase()}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Re-test button */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRetestingId(conn.id);
                          retest.mutate({ connectionId: conn.id });
                        }}
                        disabled={retestingId === conn.id}
                      >
                        <RefreshCw className={`h-3.5 w-3.5 mr-1 ${retestingId === conn.id ? "animate-spin" : ""}`} />
                        {retestingId === conn.id ? "Testing…" : "Re-test"}
                      </Button>
                      {/* Sync History button */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setHistoryConn({ id: conn.id, name: conn.name })}
                      >
                        <History className="h-3.5 w-3.5 mr-1" />
                        Sync History
                      </Button>
                      {conn.status === "active" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deactivate.mutate({ id: conn.id })}
                          disabled={deactivate.isPending}
                        >
                          <Power className="h-3.5 w-3.5 mr-1" />
                          Deactivate
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm("Delete this EMR connection? This cannot be undone.")) {
                            deleteConn.mutate({ id: conn.id });
                          }
                        }}
                        disabled={deleteConn.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">Base URL</p>
                      <p className="font-mono text-xs truncate">{conn.baseUrl}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Field Mappings</p>
                      <p className="font-medium">{conn.fieldMappings ? Object.keys(conn.fieldMappings).length : 0} configured</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">AI Confidence</p>
                      <p className={`font-medium ${confidence && confidence >= 80 ? "text-green-600" : "text-amber-600"}`}>
                        {confidence !== null ? `${confidence}%` : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Last Tested</p>
                      <p className="font-medium">
                        {conn.lastTestAt
                          ? new Date(conn.lastTestAt).toLocaleDateString()
                          : "Never"}
                      </p>
                    </div>
                  </div>

                  {conn.lastTestMessage && (
                    <Alert
                      variant={conn.lastTestSuccess ? "default" : "destructive"}
                      className={`mt-3 py-2 ${conn.lastTestSuccess ? "border-green-200 bg-green-50 dark:bg-green-950/20" : ""}`}
                    >
                      {conn.lastTestSuccess
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                        : <AlertCircle className="h-3.5 w-3.5" />}
                      <AlertDescription className={`text-xs ${conn.lastTestSuccess ? "text-green-800 dark:text-green-200" : ""}`}>
                        {conn.lastTestMessage}
                      </AlertDescription>
                    </Alert>
                  )}

                  {conn.resourcesFound && (conn.resourcesFound as string[]).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {(conn.resourcesFound as string[]).map(r => (
                        <Badge key={r} variant="outline" className="text-xs">{r}</Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <strong>How EMR integration works:</strong> Once connected, the AI agent reads FHIR resources from your EMR in real time to auto-populate dispute forms, cross-validate uploaded documents, and enrich CMS submission drafts with clinical context — reducing manual data entry by up to 88%. Every data pull is logged with field-level confidence scores and FHIR resource audit trails.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sync History Modal */}
      {historyConn && (
        <SyncHistoryModal
          connectionId={historyConn.id}
          connectionName={historyConn.name}
          open={!!historyConn}
          onClose={() => setHistoryConn(null)}
        />
      )}
    </div>
  );
}
