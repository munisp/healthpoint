import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AlarmClock, FileJson, Plus, Send, ShieldCheck, Timer } from "lucide-react";

type PayerType = "MA" | "MEDICAID_FFS" | "MEDICAID_MCO" | "CHIP_FFS" | "CHIP_MCO" | "QHP_FFE";
type Urgency = "STANDARD" | "EXPEDITED";
type PaState = "DRAFT" | "SUBMITTED" | "PENDED_INFO" | "APPROVED" | "DENIED" | "APPEAL_ROUTED" | "CLOSED" | "CANCELLED";

const PAYER_TYPES: PayerType[] = ["MA", "MEDICAID_FFS", "MEDICAID_MCO", "CHIP_FFS", "CHIP_MCO", "QHP_FFE"];

// Client-side mirror of the FSM's allowed transitions for button rendering only;
// the server remains authoritative and rejects invalid transitions.
const ALLOWED: Record<PaState, PaState[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["PENDED_INFO", "APPROVED", "DENIED", "CANCELLED"],
  PENDED_INFO: ["SUBMITTED", "DENIED", "CANCELLED"],
  APPROVED: ["CLOSED"],
  DENIED: ["APPEAL_ROUTED", "CLOSED"],
  APPEAL_ROUTED: ["APPROVED", "DENIED", "CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

const RECENT_KEY = "healthpoint:pa-recent-requests";

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "BREACHED";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function loadRecent(): { requestId: string; tenantId: string }[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export default function PriorAuthClocks() {
  const now = useNow();
  const [tenantId, setTenantId] = useState("default");
  const [requestId, setRequestId] = useState("");
  const [payerType, setPayerType] = useState<PayerType>("MA");
  const [urgency, setUrgency] = useState<Urgency>("STANDARD");
  const [denyOpen, setDenyOpen] = useState(false);
  const [denialReason, setDenialReason] = useState("");
  const [pasOpen, setPasOpen] = useState(false);
  const [recent, setRecent] = useState(loadRecent);

  const utils = trpc.useUtils();
  const configQuery = trpc.priorAuth.getPaConfig.useQuery();

  const requestQuery = trpc.priorAuth.getRequest.useQuery(
    { tenantId, requestId },
    { enabled: !!requestId, retry: false }
  );
  const request = requestQuery.data as any;

  // Live decision deadline (72h / 7-day per CMS-0057-F).
  const deadlineQuery = trpc.priorAuth.computeDeadline.useQuery(
    {
      urgency: (request?.urgency ?? urgency) as Urgency,
      payerType: (request?.payerType ?? payerType) as PayerType,
      submittedAt: request?.submittedAt ?? new Date().toISOString(),
    },
    { enabled: !!requestId && !!request?.submittedAt, retry: false }
  );
  const deadline = deadlineQuery.data as any;
  const deadlineMs = deadline?.deadline ? new Date(deadline.deadline).getTime() : null;
  const breached = deadlineMs !== null && now >= deadlineMs;
  const undecided = request && !request.decidedAt && !["APPROVED", "DENIED", "CLOSED", "CANCELLED"].includes(request.state);

  const denialRequiredQuery = trpc.priorAuth.denialReasonRequired.useQuery(
    { request: request as any },
    { enabled: !!request, retry: false }
  );

  const createMutation = trpc.priorAuth.createRequest.useMutation({
    onSuccess: (_r, vars) => {
      toast.success("PA request created (DRAFT)");
      const next = [{ requestId: vars.requestId, tenantId: vars.tenantId ?? tenantId }, ...recent.filter(r => r.requestId !== vars.requestId)].slice(0, 10);
      setRecent(next);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      requestQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const transitionMutation = trpc.priorAuth.transition.useMutation({
    onSuccess: () => {
      toast.success("Transition applied");
      setDenyOpen(false);
      setDenialReason("");
      utils.priorAuth.getRequest.invalidate();
      utils.priorAuth.denialReasonRequired.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const pasBundleQuery = trpc.priorAuth.buildPasBundle.useQuery(
    { id: requestId, urgency },
    { enabled: pasOpen && !!requestId, retry: false }
  );
  const submitPasMutation = trpc.priorAuth.submitViaPas.useMutation({
    onSuccess: (r: any) => {
      if (r.status === "BLOCKED") toast.error(`PAS submission blocked: ${r.reason}`);
      else toast.success("PAS submission accepted");
    },
    onError: (e) => toast.error(e.message),
  });

  const doTransition = (to: PaState) => {
    if (to === "DENIED") { setDenyOpen(true); return; }
    transitionMutation.mutate({ tenantId, requestId, to });
  };

  const pasBundle = useMemo(() => (pasBundleQuery.data ? JSON.stringify(pasBundleQuery.data, null, 2) : ""), [pasBundleQuery.data]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Prior Authorization Clocks</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            CMS-0057-F decision timeframes: 72 hours expedited / 7 calendar days standard (impacted payers, effective 2026-01-01).
          </p>
        </div>
        <div className="flex gap-2">
          {configQuery.isLoading ? (
            <Skeleton className="h-6 w-40" />
          ) : (
            <>
              <Badge variant={configQuery.data?.enabled ? "secondary" : "outline"}>
                PA API {configQuery.data?.enabled ? "enabled" : "disabled"}
              </Badge>
              <Badge variant={configQuery.data?.endpointConfigured ? "secondary" : "outline"}>
                Endpoint {configQuery.data?.endpointConfigured ? "configured" : "not configured"}
              </Badge>
            </>
          )}
        </div>
      </div>

      {/* Create request */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus size={16} className="text-primary" /> New PA Request
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
          <div className="space-y-1.5">
            <Label>Tenant ID</Label>
            <Input value={tenantId} onChange={e => setTenantId(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Request ID</Label>
            <Input value={requestId} onChange={e => setRequestId(e.target.value)} placeholder="e.g. PA-2026-0001" />
          </div>
          <div className="space-y-1.5">
            <Label>Payer type</Label>
            <Select value={payerType} onValueChange={v => setPayerType(v as PayerType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYER_TYPES.map(p => <SelectItem key={p} value={p}>{p.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Urgency</Label>
            <Select value={urgency} onValueChange={v => setUrgency(v as Urgency)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="STANDARD">Standard (7 days)</SelectItem>
                <SelectItem value="EXPEDITED">Expedited (72 hours)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={!requestId || createMutation.isPending}
            onClick={() => createMutation.mutate({ tenantId, requestId, payerType, urgency })}
          >
            Create Request
          </Button>
        </CardContent>
        {recent.length > 0 && (
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground mb-1.5">Recent on this device:</p>
            <div className="flex flex-wrap gap-1.5">
              {recent.map(r => (
                <Button key={r.requestId} size="sm" variant="outline" className="text-xs"
                  onClick={() => { setTenantId(r.tenantId); setRequestId(r.requestId); }}>
                  {r.requestId}
                </Button>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      {requestId && (
        <>
          {/* Clock */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Timer size={16} className="text-primary" /> Decision Clock
              </CardTitle>
            </CardHeader>
            <CardContent>
              {requestQuery.isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : requestQuery.isError ? (
                <p className="text-sm text-muted-foreground">{requestQuery.error.message}</p>
              ) : !request ? (
                <div className="py-6 flex flex-col items-center text-muted-foreground">
                  <AlarmClock size={28} className="mb-2 opacity-30" />
                  <p className="text-sm">Request not found - create it above.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{request.state}</Badge>
                    <Badge variant="outline">{String(request.payerType).replace(/_/g, " ")}</Badge>
                    <Badge variant="outline">{request.urgency}</Badge>
                    {request.submittedAt && (
                      <span className="text-xs text-muted-foreground">
                        Submitted {new Date(request.submittedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {deadlineQuery.isLoading ? (
                    <Skeleton className="h-10 w-64" />
                  ) : deadline?.basis === "NOT_SUBJECT" || !deadline?.deadline ? (
                    <p className="text-sm text-muted-foreground">{deadline?.notes ?? "No decision deadline computed yet - submit the request first."}</p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Deadline ({deadline.basis})</p>
                        <p className="text-lg font-semibold text-foreground">{new Date(deadline.deadline).toLocaleString()}</p>
                      </div>
                      {undecided && (
                        <div>
                          <p className="text-xs text-muted-foreground">{breached ? "Escalation overdue" : "Time remaining (escalate at deadline)"}</p>
                          <p className={`text-lg font-mono font-bold ${breached ? "text-destructive" : "text-foreground"}`}>
                            {formatRemaining(deadlineMs! - now)}
                          </p>
                        </div>
                      )}
                      {breached && undecided && (
                        <Badge variant="destructive">DEADLINE BREACHED - escalate now</Badge>
                      )}
                      {request.decidedAt && (
                        <Badge variant="secondary" className="flex items-center gap-1">
                          <ShieldCheck size={12} /> Decided {new Date(request.decidedAt).toLocaleString()}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* FSM actions */}
          {request && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">State Transitions</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {(ALLOWED[request.state as PaState] ?? []).map(to => (
                  <Button key={to} size="sm" variant="outline" disabled={transitionMutation.isPending}
                    onClick={() => doTransition(to)}>
                    {"\u2192 "}{to.replace(/_/g, " ")}
                  </Button>
                ))}
                {(ALLOWED[request.state as PaState] ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">Terminal state - no further transitions.</p>
                )}
                <div className="flex gap-2 ml-auto">
                  <Button size="sm" variant="outline" onClick={() => setPasOpen(true)}>
                    <FileJson size={14} className="mr-1" /> PAS Bundle
                  </Button>
                  <Button size="sm" variant="outline" disabled={submitPasMutation.isPending}
                    onClick={() => submitPasMutation.mutate({ id: requestId, urgency })}>
                    <Send size={14} className="mr-1" /> Submit via PAS
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Deny dialog */}
      <Dialog open={denyOpen} onOpenChange={setDenyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deny PA Request</DialogTitle>
            <DialogDescription>
              {denialRequiredQuery.data === true
                ? "CMS-0057-F requires a specific denial reason for this request."
                : "Provide a denial reason (required when CMS-0057-F applies)."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Denial reason</Label>
            <Input value={denialReason} onChange={e => setDenialReason(e.target.value)} placeholder="Specific clinical/administrative reason" />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={!denialReason.trim() || transitionMutation.isPending}
              onClick={() => transitionMutation.mutate({ tenantId, requestId, to: "DENIED", denialReason })}
            >
              Deny Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PAS bundle viewer */}
      <Dialog open={pasOpen} onOpenChange={setPasOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Da Vinci PAS Bundle (FHIR R4 skeleton)</DialogTitle>
            <DialogDescription>Static bundle preview - no transmission occurs here.</DialogDescription>
          </DialogHeader>
          {pasBundleQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : pasBundleQuery.isError ? (
            <p className="text-sm text-destructive">{pasBundleQuery.error.message}</p>
          ) : (
            <pre className="text-xs bg-muted rounded-md p-3 overflow-auto max-h-96">{pasBundle}</pre>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
