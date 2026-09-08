import { useMemo, useState } from "react";
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle, CheckCircle2, FileCheck2, ListChecks, PackageCheck,
  Send, ShieldCheck, XCircle,
} from "lucide-react";

const STATES = [
  "DRAFT", "PACKAGE_READY", "SUBMITTED", "ACKNOWLEDGED", "IDRE_ASSIGNED",
  "OFFER_SUBMITTED", "DETERMINATION_RECEIVED", "PAYMENT_TRACKING", "CLOSED", "WITHDRAWN",
] as const;
type SubmissionState = (typeof STATES)[number];

const GUARD_HINTS: Record<SubmissionState, string> = {
  DRAFT: "Initial state; build a complete package before advancing.",
  PACKAGE_READY: "Requires a complete 17-element package (buildPackage complete=true).",
  SUBMITTED: "Requires portal attestation; the server forces the attestation actor to you.",
  ACKNOWLEDGED: "Acknowledgment requires a CMS dispute reference number in the configured format.",
  IDRE_ASSIGNED: "CMS assigns the certified IDR entity after acknowledgment.",
  OFFER_SUBMITTED: "Offers submitted through the portal.",
  DETERMINATION_RECEIVED: "Record the certified IDRE determination (recordDetermination).",
  PAYMENT_TRACKING: "30-calendar-day payment clock runs from the determination.",
  CLOSED: "Terminal state.",
  WITHDRAWN: "Terminal state; withdrawal is permitted from most pre-determination states.",
};

function initialDisputeId(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("disputeId") ?? "";
}

export default function SubmissionTimeline() {
  const [tenantId, setTenantId] = useState("default");
  const [disputeId, setDisputeId] = useState(initialDisputeId);
  const [ackOpen, setAckOpen] = useState(false);
  const [cmsRef, setCmsRef] = useState("");
  const [detOpen, setDetOpen] = useState(false);
  const [det, setDet] = useState({
    idreId: "", determinationDate: "", prevailingParty: "initiating" as "initiating" | "responding",
    prevailingOffer: "", qpa: "", otherOffer: "", rationaleFactors: "", adminFeeAmount: "15",
    idreFeeAmount: "", determinationDocumentRef: "",
  });
  const [lastState, setLastState] = useState<SubmissionState | null>(null);

  const utils = trpc.useUtils();
  const { data: disputesData, isLoading: disputesLoading } = trpc.disputes.list.useQuery({ limit: 100, offset: 0 });
  const disputes = (disputesData?.items ?? []) as any[];
  const selected = disputes.find(d => String(d.id) === disputeId);

  const eventLogQuery = trpc.submissionAutomation.eventLog.useQuery(
    { tenantId, disputeId },
    { enabled: !!tenantId && !!disputeId, retry: false }
  );

  // There is no "get submission" procedure; infer the current state from the
  // hash-chained event log (last transition's `to`).
  const inferredState: SubmissionState | null = useMemo(() => {
    const events: any[] = (eventLogQuery.data as any)?.events ?? [];
    for (let i = events.length - 1; i >= 0; i--) {
      const to = events[i]?.to ?? events[i]?.payload?.to;
      if (STATES.includes(to)) return to as SubmissionState;
    }
    return lastState;
  }, [eventLogQuery.data, lastState]);

  const buildPackageMutation = trpc.submissionAutomation.buildPackage.useMutation({
    onError: (e) => toast.error(e.message),
  });
  const createMutation = trpc.submissionAutomation.create.useMutation({
    onSuccess: (r: any) => {
      toast.success("Submission created in DRAFT");
      if (r?.state) setLastState(r.state);
      utils.submissionAutomation.eventLog.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const transitionMutation = trpc.submissionAutomation.transition.useMutation({
    onSuccess: (r: any) => {
      toast.success(`Transitioned to ${r?.state ?? "next state"}`);
      if (r?.state) setLastState(r.state);
      utils.submissionAutomation.eventLog.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const recordDeterminationMutation = trpc.submissionAutomation.recordDetermination.useMutation({
    onSuccess: () => {
      toast.success("Determination recorded");
      setDetOpen(false);
      utils.submissionAutomation.eventLog.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const remittanceQuery = trpc.submissionAutomation.remittanceReconciliation.useQuery(
    undefined,
    { enabled: false, retry: false }
  );

  const buildPackage = () => {
    buildPackageMutation.mutate({
      disputeId,
      tenantId,
      initiatingPartyName: selected?.initiatingPartyName ?? undefined,
      respondingPartyName: selected?.respondingPartyName ?? undefined,
      claimNumber: selected?.claimNumber ?? undefined,
      serviceCode: selected?.serviceCode ?? undefined,
      billedCharge: selected?.billedAmount != null ? Number(selected.billedAmount) : undefined,
      qualifyingPaymentAmount: selected?.qpa != null ? Number(selected.qpa) : undefined,
      strictMode: false,
    });
  };
  const pkg = buildPackageMutation.data as any;

  const doTransition = (to: SubmissionState) => {
    if (to === "ACKNOWLEDGED") { setAckOpen(true); return; }
    transitionMutation.mutate({ tenantId, disputeId, to });
  };

  const submitDetermination = () => {
    try {
      recordDeterminationMutation.mutate({
        tenantId,
        disputeId,
        determination: {
          idreId: det.idreId,
          determinationDate: det.determinationDate,
          prevailingParty: det.prevailingParty,
          prevailingOffer: Number(det.prevailingOffer),
          qpa: Number(det.qpa),
          otherOffer: Number(det.otherOffer),
          rationaleFactors: det.rationaleFactors.split(",").map(s => s.trim()).filter(Boolean),
          adminFeeAmount: Number(det.adminFeeAmount),
          idreFeeAmount: Number(det.idreFeeAmount),
          determinationDocumentRef: det.determinationDocumentRef || undefined,
        },
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Invalid determination input");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">CMS Submission Automation</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Per-dispute submission package, state machine, and determination recording (45 CFR 149.510).
        </p>
      </div>

      {/* Dispute picker */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecks size={16} className="text-primary" /> Select Dispute
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Tenant ID</Label>
            <Input value={tenantId} onChange={e => setTenantId(e.target.value)} placeholder="default" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Dispute</Label>
            {disputesLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={disputeId} onValueChange={setDisputeId}>
                <SelectTrigger><SelectValue placeholder="Choose a dispute\u2026" /></SelectTrigger>
                <SelectContent>
                  {disputes.map(d => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.referenceNumber ?? d.id} \u2014 {d.initiatingPartyName ?? "Unknown party"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              Or enter manually:{" "}
              <Input
                className="inline-block w-40 h-7 text-xs mt-1"
                value={disputeId}
                onChange={e => setDisputeId(e.target.value)}
                placeholder="dispute id"
              />
            </p>
          </div>
        </CardContent>
      </Card>

      {!disputeId ? (
        <Card>
          <CardContent className="py-12 flex flex-col items-center text-muted-foreground">
            <PackageCheck size={32} className="mb-2 opacity-30" />
            <p className="text-sm">Select a dispute to view its submission package and timeline.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* FSM stepper */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Send size={16} className="text-primary" /> Submission State
              </CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={createMutation.isPending}
                  onClick={() => createMutation.mutate({ tenantId, disputeId })}>
                  Create Submission
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDetOpen(true)}>
                  Record Determination
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Current state is inferred from the server event log (no get-by-id procedure exists for submissions).
              </p>
              <div className="flex flex-wrap gap-1.5">
                {STATES.map((s, i) => {
                  const currentIdx = inferredState ? STATES.indexOf(inferredState) : -1;
                  const active = s === inferredState;
                  const done = currentIdx >= 0 && i < currentIdx;
                  return (
                    <button
                      key={s}
                      title={GUARD_HINTS[s]}
                      disabled={transitionMutation.isPending}
                      onClick={() => doTransition(s)}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : done
                            ? "bg-accent text-accent-foreground border-border"
                            : "bg-card text-muted-foreground border-border hover:bg-accent"
                      }`}
                    >
                      {s.replace(/_/g, " ")}
                    </button>
                  );
                })}
              </div>
              {inferredState && (
                <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
                  <ShieldCheck size={13} className="text-primary" /> {GUARD_HINTS[inferredState]}
                </p>
              )}
              {eventLogQuery.data && (
                <div className="mt-3">
                  <Badge variant={(eventLogQuery.data as any).verification?.valid ? "secondary" : "destructive"}>
                    Event chain {(eventLogQuery.data as any).verification?.valid ? "verified" : "FAILED verification"}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Package completeness */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileCheck2 size={16} className="text-primary" /> Package Completeness (17 elements)
              </CardTitle>
              <Button size="sm" onClick={buildPackage} disabled={buildPackageMutation.isPending}>
                Build Package
              </Button>
            </CardHeader>
            <CardContent>
              {!pkg ? (
                <p className="text-sm text-muted-foreground">
                  Build the package to see the portal-ready field set and the completeness checklist.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    {pkg.complete ? (
                      <Badge variant="secondary" className="flex items-center gap-1">
                        <CheckCircle2 size={12} /> Complete \u2014 portal-ready
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="flex items-center gap-1">
                        <XCircle size={12} /> Incomplete \u2014 {pkg.missing?.length ?? 0} missing
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">Generated {new Date(pkg.generatedAt).toLocaleString()}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                    {(pkg.checklist ?? []).map((c: any) => (
                      <div
                        key={c.key}
                        className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
                          c.present ? "border-border bg-card" : "border-destructive/50 bg-destructive/10"
                        }`}
                      >
                        {c.present ? (
                          <CheckCircle2 size={13} className="text-primary mt-0.5 shrink-0" />
                        ) : (
                          <AlertTriangle size={13} className="text-destructive mt-0.5 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">{c.label}</p>
                          <p className="text-muted-foreground truncate">{c.present ? c.value : "Missing"}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {(pkg.warnings ?? []).length > 0 && (
                    <div className="rounded-md border border-border bg-accent/50 p-3 space-y-1">
                      <p className="text-xs font-semibold text-foreground">Warnings (non-blocking unless strict mode)</p>
                      {pkg.warnings.map((w: string, i: number) => (
                        <p key={i} className="text-xs text-muted-foreground flex gap-1.5">
                          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Event log */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Event Log (hash-chained, append-only)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {eventLogQuery.isLoading ? (
                <div className="p-6 space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                </div>
              ) : eventLogQuery.isError ? (
                <div className="p-6 text-sm text-muted-foreground">
                  No event log yet \u2014 create the submission first. ({eventLogQuery.error.message})
                </div>
              ) : ((eventLogQuery.data as any)?.events ?? []).length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">No events recorded yet.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {((eventLogQuery.data as any).events as any[]).map((e, i) => (
                      <TableRow key={e.id ?? i}>
                        <TableCell className="text-xs">{e.at ? new Date(e.at).toLocaleString() : "\u2014"}</TableCell>
                        <TableCell className="text-xs">{e.from ?? "\u2014"}</TableCell>
                        <TableCell className="text-xs font-medium">{e.to ?? e.type ?? "\u2014"}</TableCell>
                        <TableCell className="text-xs">{e.actorId ?? "\u2014"}</TableCell>
                        <TableCell className="text-xs max-w-64 truncate">{e.detail ?? "\u2014"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Admin: remittance reconciliation */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Remittance Reconciliation (admin, CMS-9897-F 2027)</CardTitle>
              <Button size="sm" variant="outline" onClick={() => remittanceQuery.refetch()}>
                Load status
              </Button>
            </CardHeader>
            <CardContent>
              {!remittanceQuery.data && !remittanceQuery.isError ? (
                <p className="text-sm text-muted-foreground">Blocked until 2027-01-01 and the REMITTANCE_2027_ENABLED flag. Admin-only.</p>
              ) : remittanceQuery.isError ? (
                <p className="text-sm text-destructive">{remittanceQuery.error.message}</p>
              ) : (
                <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
                  {JSON.stringify(remittanceQuery.data, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ACKNOWLEDGED dialog */}
      <Dialog open={ackOpen} onOpenChange={setAckOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Acknowledge Submission</DialogTitle>
            <DialogDescription>
              Acknowledgment requires the CMS dispute reference number in the configured format (fail-closed server-side).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>CMS Dispute Reference Number</Label>
            <Input value={cmsRef} onChange={e => setCmsRef(e.target.value)} placeholder="e.g. CMS reference" />
          </div>
          <DialogFooter>
            <Button
              disabled={!cmsRef || transitionMutation.isPending}
              onClick={() => {
                transitionMutation.mutate(
                  { tenantId, disputeId, to: "ACKNOWLEDGED", cmsDisputeReferenceNumber: cmsRef },
                  { onSuccess: () => setAckOpen(false) }
                );
              }}
            >
              Acknowledge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record determination dialog */}
      <Dialog open={detOpen} onOpenChange={setDetOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record IDRE Determination</DialogTitle>
            <DialogDescription>
              Requires the submission to be in OFFER_SUBMITTED or DETERMINATION_RECEIVED; starts the 30-calendar-day payment clock.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label>IDRE Entity ID</Label>
              <Input value={det.idreId} onChange={e => setDet({ ...det, idreId: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Determination date (YYYY-MM-DD)</Label>
              <Input type="date" value={det.determinationDate} onChange={e => setDet({ ...det, determinationDate: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Prevailing party</Label>
              <Select value={det.prevailingParty} onValueChange={v => setDet({ ...det, prevailingParty: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="initiating">Initiating</SelectItem>
                  <SelectItem value="responding">Responding</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Prevailing offer ($)</Label>
              <Input type="number" value={det.prevailingOffer} onChange={e => setDet({ ...det, prevailingOffer: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>QPA ($)</Label>
              <Input type="number" value={det.qpa} onChange={e => setDet({ ...det, qpa: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Other offer ($)</Label>
              <Input type="number" value={det.otherOffer} onChange={e => setDet({ ...det, otherOffer: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Admin fee ($)</Label>
              <Input type="number" value={det.adminFeeAmount} onChange={e => setDet({ ...det, adminFeeAmount: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>IDRE fee ($)</Label>
              <Input type="number" value={det.idreFeeAmount} onChange={e => setDet({ ...det, idreFeeAmount: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Document ref (optional)</Label>
              <Input value={det.determinationDocumentRef} onChange={e => setDet({ ...det, determinationDocumentRef: e.target.value })} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Rationale factors (comma-separated)</Label>
              <Input value={det.rationaleFactors} onChange={e => setDet({ ...det, rationaleFactors: e.target.value })} placeholder="e.g. QPA proximity, provider training" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submitDetermination} disabled={recordDeterminationMutation.isPending}>
              Record Determination
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
