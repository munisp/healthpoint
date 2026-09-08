import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle, Bot, CheckCircle2, KeyRound, MapPin, Play, RefreshCw, ShieldAlert,
} from "lucide-react";

const STATUS_VARIANT: Record<string, "secondary" | "destructive" | "outline" | "default"> = {
  COMPLETED: "secondary",
  SUBMITTED: "secondary",
  CHECKPOINT_REQUIRED: "outline",
  FAILED: "destructive",
  RUNNING: "default",
};

export default function PortalOps() {
  const [submissionId, setSubmissionId] = useState("");
  const [credentialsRef, setCredentialsRef] = useState("");
  const [mode, setMode] = useState<"DRY_RUN" | "LIVE">("DRY_RUN");
  const [portalFieldsJson, setPortalFieldsJson] = useState("{}");
  const [documents, setDocuments] = useState("");
  const [runId, setRunId] = useState("");
  const [resolveTarget, setResolveTarget] = useState<any | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  // portalMapInfo is admin-only; non-admin users see a FORBIDDEN error.
  const mapInfo = trpc.portalRpa.portalMapInfo.useQuery(undefined, { retry: false });
  const liveAllowed =
    (mapInfo.data as any)?.loaded === true &&
    (mapInfo.data as any)?.liveEnabled === true &&
    (mapInfo.data as any)?.tosAcknowledged === true;

  const runQuery = trpc.portalRpa.getRun.useQuery(
    { runId },
    { enabled: !!runId, refetchInterval: (q) => (q.state.data?.status === "COMPLETED" || q.state.data?.status === "FAILED" ? false : 5000), retry: false }
  );
  const checkpointsQuery = trpc.portalRpa.listCheckpoints.useQuery(undefined, { refetchInterval: 10_000 });

  const startRunMutation = trpc.portalRpa.startRun.useMutation({
    onSuccess: (r) => {
      toast.success(`Run started (${r.status})`);
      setRunId(r.runId);
      checkpointsQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const resolveMutation = trpc.portalRpa.resolveCheckpoint.useMutation({
    onSuccess: (r) => {
      toast.success(`Checkpoint resolved - run ${r.status}`);
      setRunId(r.runId);
      setResolveTarget(null);
      setMfaCode("");
      checkpointsQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const resumeMutation = trpc.portalRpa.resumeRun.useMutation({
    onSuccess: (r) => {
      toast.success(`Run resumed (${r.status})`);
      checkpointsQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const parseFields = (): Record<string, string> | null => {
    try {
      const v = JSON.parse(portalFieldsJson || "{}");
      if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("must be an object");
      return v as Record<string, string>;
    } catch (e: any) {
      toast.error(`Invalid portal fields JSON: ${e.message}`);
      return null;
    }
  };

  const runInputBase = () => {
    const portalFields = parseFields();
    if (!portalFields) return null;
    return {
      submissionId,
      portalFields,
      documents: documents.split("\n").map(s => s.trim()).filter(Boolean),
      credentialsRef,
      mode,
    };
  };

  const startRun = () => {
    const base = runInputBase();
    if (!base) return;
    if (base.mode === "LIVE" && !liveAllowed) {
      toast.error("LIVE mode requires RPA_LIVE_ENABLED and RPA_TOS_ACKNOWLEDGED flags (verified by server).");
      return;
    }
    startRunMutation.mutate(base);
  };

  const checkpoints = (checkpointsQuery.data ?? []) as any[];
  const run = runQuery.data as any;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Portal RPA Operations</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Federal IDR portal automation console (idr.cms.gov). DRY_RUN by default; LIVE is fail-closed behind flags.
        </p>
      </div>

      {/* Portal map status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin size={16} className="text-primary" /> Portal Map
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mapInfo.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-5 w-48" /><Skeleton className="h-5 w-72" /></div>
          ) : mapInfo.isError ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <ShieldAlert size={14} className="text-destructive" />
              Portal map info is admin-only or unavailable: {mapInfo.error.message}
            </p>
          ) : (mapInfo.data as any)?.loaded === false ? (
            <p className="text-sm text-destructive">Portal map failed to load: {(mapInfo.data as any).error}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">v{(mapInfo.data as any).version}</Badge>
              <Badge variant="outline">{(mapInfo.data as any).stepCount} steps</Badge>
              {(mapInfo.data as any).unverifiedSelectors > 0 && (
                <Badge variant="destructive" className="flex items-center gap-1">
                  <AlertTriangle size={12} /> {(mapInfo.data as any).unverifiedSelectors} unverified selectors
                </Badge>
              )}
              <Badge variant={(mapInfo.data as any).liveEnabled ? "secondary" : "outline"}>
                LIVE {(mapInfo.data as any).liveEnabled ? "enabled" : "disabled"}
              </Badge>
              <Badge variant={(mapInfo.data as any).tosAcknowledged ? "secondary" : "outline"}>
                ToS {(mapInfo.data as any).tosAcknowledged ? "acknowledged" : "not acknowledged"}
              </Badge>
              <span className="text-xs text-muted-foreground">{(mapInfo.data as any).baseUrl}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Start run */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Play size={16} className="text-primary" /> Start Run
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Submission ID</Label>
              <Input value={submissionId} onChange={e => setSubmissionId(e.target.value)} placeholder="submission id" />
            </div>
            <div className="space-y-1.5">
              <Label>Credentials reference</Label>
              <Input value={credentialsRef} onChange={e => setCredentialsRef(e.target.value)} placeholder="env credential ref (never a secret value)" />
            </div>
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <div className="flex gap-2">
                <Button
                  type="button" size="sm" variant={mode === "DRY_RUN" ? "default" : "outline"}
                  onClick={() => setMode("DRY_RUN")}
                >
                  Dry run
                </Button>
                <Button
                  type="button" size="sm" variant={mode === "LIVE" ? "default" : "outline"}
                  disabled={!liveAllowed}
                  title={liveAllowed ? "Live portal submission" : "LIVE requires RPA_LIVE_ENABLED and RPA_TOS_ACKNOWLEDGED flags (server-verified)"}
                  onClick={() => setMode("LIVE")}
                >
                  Live {!liveAllowed && <ShieldAlert size={12} className="ml-1" />}
                </Button>
              </div>
              {!liveAllowed && (
                <p className="text-xs text-muted-foreground">LIVE requires flags: RPA_LIVE_ENABLED=true and RPA_TOS_ACKNOWLEDGED=true.</p>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Portal fields (JSON object)</Label>
            <Textarea
              className="font-mono text-xs min-h-28"
              value={portalFieldsJson}
              onChange={e => setPortalFieldsJson(e.target.value)}
              placeholder='{"initiatingPartyName": "...", "claimNumber": "..."}'
            />
          </div>
          <div className="space-y-1.5">
            <Label>Document references (one per line)</Label>
            <Textarea
              className="font-mono text-xs min-h-16"
              value={documents}
              onChange={e => setDocuments(e.target.value)}
            />
          </div>
          <Button onClick={startRun} disabled={!submissionId || !credentialsRef || startRunMutation.isPending}>
            <Play size={14} className="mr-1.5" /> Start {mode === "LIVE" ? "Live" : "Dry"} Run
          </Button>
        </CardContent>
      </Card>

      {/* Run status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot size={16} className="text-primary" /> Run Status
          </CardTitle>
          <div className="flex gap-2 items-center">
            <Input className="w-64 h-8 text-xs" value={runId} onChange={e => setRunId(e.target.value)} placeholder="run id" />
            <Button size="sm" variant="ghost" onClick={() => runQuery.refetch()} disabled={!runId}>
              <RefreshCw size={14} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!runId ? (
            <p className="text-sm text-muted-foreground">Start a run or paste a run ID to poll its status.</p>
          ) : runQuery.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-5 w-64" /></div>
          ) : runQuery.isError ? (
            <p className="text-sm text-destructive">{runQuery.error.message}</p>
          ) : run ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_VARIANT[run.status] ?? "outline"}>{run.status}</Badge>
                <Badge variant="outline">{run.mode}</Badge>
                {run.cmsDisputeReferenceNumber && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <CheckCircle2 size={12} /> CMS ref {run.cmsDisputeReferenceNumber}
                  </Badge>
                )}
              </div>
              {run.status === "CHECKPOINT_REQUIRED" && run.resumeToken && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Run parked at checkpoint: {run.checkpoint?.kind ?? "unknown"}</span>
                  <Button size="sm" variant="outline" disabled={resumeMutation.isPending}
                    onClick={() => {
                      const base = runInputBase();
                      if (!base) return;
                      resumeMutation.mutate({ ...base, resumeToken: run.resumeToken });
                    }}>
                    Resume
                  </Button>
                </div>
              )}
              {run.timeline && (
                <pre className="text-xs bg-muted rounded-md p-3 overflow-auto max-h-64">
                  {JSON.stringify(run.timeline, null, 2)}
                </pre>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Checkpoint inbox */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound size={16} className="text-primary" /> Checkpoint Inbox
            {checkpoints.length > 0 && <Badge variant="destructive" className="ml-1">{checkpoints.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {checkpointsQuery.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
          ) : checkpoints.length === 0 ? (
            <div className="py-8 flex flex-col items-center text-muted-foreground">
              <CheckCircle2 size={28} className="mb-2 opacity-30" />
              <p className="text-sm">No pending checkpoints.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {checkpoints.map((c: any, i: number) => (
                <div key={c.checkpointId ?? c.id ?? i} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {c.checkpoint?.kind ?? "CHECKPOINT"}{" - run "}{c.runId}
                    </p>
                    <p className="text-xs text-muted-foreground">{c.checkpoint?.prompt ?? c.checkpoint?.detail ?? ""}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setResolveTarget(c)}>Resolve</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resolve dialog */}
      <Dialog open={!!resolveTarget} onOpenChange={(o) => !o && setResolveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Checkpoint</DialogTitle>
            <DialogDescription>
              {resolveTarget?.checkpoint?.kind === "MFA"
                ? "Enter the MFA code from your authenticator. The code is consumed in memory and never stored."
                : "Mark the checkpoint as human-completed to resume the run."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>MFA code (if required)</Label>
            <Input value={mfaCode} onChange={e => setMfaCode(e.target.value)} placeholder="6-digit code" />
          </div>
          <DialogFooter>
            <Button
              disabled={resolveMutation.isPending}
              onClick={() => {
                const base = runInputBase();
                if (!base) return;
                resolveMutation.mutate({
                  ...base,
                  checkpointId: resolveTarget?.checkpointId ?? resolveTarget?.id,
                  mfaCode: mfaCode || undefined,
                  humanCompleted: !mfaCode,
                });
              }}
            >
              Resolve &amp; Resume
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
