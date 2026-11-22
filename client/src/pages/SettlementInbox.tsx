import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle, CheckCircle2, HandCoins, Landmark, Send, ShieldAlert, Stamp,
} from "lucide-react";

const fmtCents = (c: number | null | undefined) =>
  c == null ? "-" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);

const TRANSFER_VARIANT: Record<string, "secondary" | "destructive" | "outline" | "default"> = {
  requested: "default",
  authorized: "secondary",
  submitted: "secondary",
  accepted: "secondary",
  settled: "secondary",
  reconciled: "secondary",
  failed: "destructive",
  reversed: "destructive",
};

const isUuid = (v: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);

function newIdempotencyKey(): string {
  return crypto.randomUUID() + crypto.randomUUID().slice(0, 8);
}

export default function SettlementInbox() {
  const meQuery = trpc.auth.me.useQuery(undefined, { retry: false });
  const isAdmin = (meQuery.data as any)?.role === "admin";

  const [disputeId, setDisputeId] = useState("");
  const transfersQuery = trpc.settlementTransfers.listByDispute.useQuery(
    { disputeId }, { enabled: isUuid(disputeId), retry: false }
  );
  const proofsQuery = trpc.settlementProofs.list.useQuery({ limit: 30 }, { enabled: isAdmin, retry: false });
  const exceptionsQuery = trpc.settlementProofs.openExceptions.useQuery(undefined, { enabled: isAdmin, retry: false });

  // Request transfer form
  const [reqForm, setReqForm] = useState({ provider: "", amountUsd: "", reason: "" });
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const requestMutation = trpc.settlementTransfers.request.useMutation({
    onSuccess: () => {
      toast.success("Transfer requested (status: requested) - awaiting maker-checker approval");
      setReqForm({ provider: "", amountUsd: "", reason: "" });
      setIdemKey(newIdempotencyKey());
      transfersQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  // Decide dialog
  const [decideTarget, setDecideTarget] = useState<any | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [decideReason, setDecideReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const decideMutation = trpc.settlementTransfers.decide.useMutation({
    onSuccess: (t: any) => {
      toast.success(`Decision recorded - transfer now ${t.status}`);
      setDecideTarget(null);
      setDecideReason("");
      setExpiresAt("");
      transfersQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  // Mark submitted dialog
  const [submitTarget, setSubmitTarget] = useState<any | null>(null);
  const [providerTransferId, setProviderTransferId] = useState("");
  const submitMutation = trpc.settlementTransfers.markSubmitted.useMutation({
    onSuccess: () => {
      toast.success("Transfer marked submitted (pending hold posted)");
      setSubmitTarget(null);
      setProviderTransferId("");
      transfersQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  // Exception review dialog
  const [exceptionTarget, setExceptionTarget] = useState<any | null>(null);
  const [exceptionStatus, setExceptionStatus] = useState<"resolved" | "accepted_risk">("resolved");
  const [exceptionResolution, setExceptionResolution] = useState("");
  const exceptionMutation = trpc.settlementProofs.decideException.useMutation({
    onSuccess: () => {
      toast.success("Exception review recorded (immutable)");
      setExceptionTarget(null);
      setExceptionResolution("");
      exceptionsQuery.refetch();
      proofsQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  if (meQuery.isLoading) {
    return <div className="space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-40 w-full" /></div>;
  }
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Settlement Approval Inbox</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Maker-checker settlement transfer controls.</p>
        </div>
        <Card>
          <CardContent className="py-12 flex flex-col items-center text-muted-foreground">
            <ShieldAlert size={32} className="mb-3 text-destructive opacity-60" />
            <p className="text-sm font-medium text-foreground">Admin access required</p>
            <p className="text-sm mt-1 max-w-md text-center">
              Settlement approvals, provider submissions, and exception reviews are restricted to
              administrators (maker-checker control). Contact an administrator if you need a transfer reviewed.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const transfers = (transfersQuery.data ?? []) as any[];
  const pending = transfers.filter(t => t.status === "requested");
  const authorized = transfers.filter(t => t.status === "authorized");
  const others = transfers.filter(t => t.status !== "requested" && t.status !== "authorized");
  const exceptions = (exceptionsQuery.data ?? []) as any[];
  const proofs = (proofsQuery.data ?? []) as any[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settlement Approval Inbox</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Maker-checker approvals for settlement transfers (auditable intent only - no payment rail is invoked
          until an approved provider integration is deployed).
        </p>
      </div>

      <div className="space-y-1.5 max-w-md">
        <Label>Dispute ID (UUID)</Label>
        <Input value={disputeId} onChange={e => setDisputeId(e.target.value.trim())} placeholder="dispute UUID" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left panel: transfers */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <HandCoins size={16} className="text-primary" /> Pending Approvals
                {pending.length > 0 && <Badge variant="destructive" className="ml-1">{pending.length}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!isUuid(disputeId) ? (
                <p className="text-sm text-muted-foreground">Enter a dispute UUID to load transfers.</p>
              ) : transfersQuery.isLoading ? (
                <div className="space-y-2"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
              ) : pending.length === 0 ? (
                <div className="py-6 flex flex-col items-center text-muted-foreground">
                  <CheckCircle2 size={24} className="mb-2 opacity-30" />
                  <p className="text-sm">No transfers awaiting decision.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {pending.map(t => (
                    <div key={t.id} className="flex items-center justify-between py-3 gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{fmtCents(t.amountCents)} via {t.provider}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {t.requestReason} - requested by {t.requestedByName} {t.createdAt ? new Date(t.createdAt).toLocaleString() : ""}
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" variant="secondary" className="text-xs"
                          onClick={() => { setDecideTarget(t); setDecision("approved"); }}>
                          Approve
                        </Button>
                        <Button size="sm" variant="destructive" className="text-xs"
                          onClick={() => { setDecideTarget(t); setDecision("rejected"); }}>
                          Reject
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Send size={16} className="text-primary" /> Authorized - Awaiting Provider Submission
              </CardTitle>
            </CardHeader>
            <CardContent>
              {authorized.length === 0 ? (
                <p className="text-sm text-muted-foreground">No authorized transfers pending submission.</p>
              ) : (
                <div className="divide-y divide-border">
                  {authorized.map(t => (
                    <div key={t.id} className="flex items-center justify-between py-3 gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{fmtCents(t.amountCents)} via {t.provider}</p>
                        <p className="text-xs text-muted-foreground">authorized {t.authorizedAt ? new Date(t.authorizedAt).toLocaleString() : ""}</p>
                      </div>
                      <Button size="sm" variant="outline" className="text-xs shrink-0" onClick={() => setSubmitTarget(t)}>
                        Mark submitted
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">All Other Transfers</CardTitle>
            </CardHeader>
            <CardContent>
              {others.length === 0 ? (
                <p className="text-sm text-muted-foreground">None.</p>
              ) : (
                <div className="divide-y divide-border">
                  {others.map(t => (
                    <div key={t.id} className="flex items-center justify-between py-2.5 gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-foreground">{fmtCents(t.amountCents)} via {t.provider}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {t.providerTransferId ? `provider ref ${t.providerTransferId}` : ""}
                          {t.failureReason ? ` - ${t.failureReason}` : ""}
                        </p>
                      </div>
                      <Badge variant={TRANSFER_VARIANT[t.status] ?? "outline"} className="shrink-0">{t.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Request form */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Request New Transfer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Provider (2-64 chars)</Label>
                  <Input value={reqForm.provider} onChange={e => setReqForm({ ...reqForm, provider: e.target.value })} placeholder="e.g. mojaloop-switch" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Amount (USD)</Label>
                  <Input type="number" min="0.01" step="0.01" value={reqForm.amountUsd}
                    onChange={e => setReqForm({ ...reqForm, amountUsd: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Reason (min 5 chars)</Label>
                <Textarea value={reqForm.reason} onChange={e => setReqForm({ ...reqForm, reason: e.target.value })} />
              </div>
              <p className="text-xs text-muted-foreground">Idempotency key: <span className="font-mono">{idemKey}</span></p>
              <Button size="sm"
                disabled={
                  !isUuid(disputeId) || reqForm.provider.trim().length < 2 ||
                  reqForm.reason.trim().length < 5 || !reqForm.amountUsd || Number(reqForm.amountUsd) <= 0 ||
                  requestMutation.isPending
                }
                onClick={() => requestMutation.mutate({
                  disputeId,
                  provider: reqForm.provider.trim(),
                  amountCents: Math.round(Number(reqForm.amountUsd) * 100),
                  requestReason: reqForm.reason.trim(),
                  idempotencyKey: idemKey,
                })}>
                Request Transfer
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right panel: exceptions + proofs */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle size={16} className="text-primary" /> Open Exception Reviews
                {exceptions.length > 0 && <Badge variant="destructive" className="ml-1">{exceptions.length}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {exceptionsQuery.isLoading ? (
                <div className="space-y-2"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
              ) : exceptions.length === 0 ? (
                <div className="py-6 flex flex-col items-center text-muted-foreground">
                  <CheckCircle2 size={24} className="mb-2 opacity-30" />
                  <p className="text-sm">No open reconciliation exceptions.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {exceptions.map(x => (
                    <div key={x.id} className="flex items-center justify-between py-3 gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">Reconciliation {String(x.reconciliationId).slice(0, 8)}...</p>
                        <p className="text-xs text-muted-foreground">{x.reviewReason}</p>
                        <p className="text-xs text-muted-foreground">{x.createdAt ? new Date(x.createdAt).toLocaleString() : ""}</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" variant="secondary" className="text-xs"
                          onClick={() => { setExceptionTarget(x); setExceptionStatus("resolved"); }}>
                          Resolve
                        </Button>
                        <Button size="sm" variant="outline" className="text-xs"
                          onClick={() => { setExceptionTarget(x); setExceptionStatus("accepted_risk"); }}>
                          Accept risk
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Landmark size={16} className="text-primary" /> Daily Balance Proofs
              </CardTitle>
            </CardHeader>
            <CardContent>
              {proofsQuery.isLoading ? (
                <div className="space-y-2"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
              ) : proofs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No balance proofs generated yet (daily scheduled job).</p>
              ) : (
                <div className="divide-y divide-border">
                  {proofs.map(p => (
                    <div key={p.id} className="flex items-center justify-between py-2.5 gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{p.proofDate}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.transferCount} transfers, {p.reconciledTransferCount} reconciled -{" "}
                          {p.unresolvedExceptionCount} open exceptions, {p.ledgerMismatchCount} ledger mismatches
                        </p>
                        <p className="text-[11px] text-muted-foreground font-mono truncate">hash {p.evidenceHash}</p>
                      </div>
                      <Badge variant={p.status === "passed" ? "secondary" : "destructive"} className="shrink-0">{p.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Decide dialog */}
      <Dialog open={!!decideTarget} onOpenChange={(o) => !o && setDecideTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Stamp size={16} className="text-primary" />
              {decision === "approved" ? "Approve" : "Reject"} Transfer
            </DialogTitle>
            <DialogDescription>
              {decideTarget ? `${fmtCents(decideTarget.amountCents)} via ${decideTarget.provider}. ` : ""}
              The decision is immutable and requires an approver distinct from the requester (maker-checker).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Reason (min 5 chars)</Label>
              <Textarea value={decideReason} onChange={e => setDecideReason(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Approval expires at (must be in the future)</Label>
              <Input type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecideTarget(null)}>Cancel</Button>
            <Button
              variant={decision === "approved" ? "default" : "destructive"}
              disabled={decideReason.trim().length < 5 || !expiresAt || new Date(expiresAt).getTime() <= Date.now() || decideMutation.isPending}
              onClick={() => decideMutation.mutate({
                transferId: decideTarget.id,
                decision,
                reason: decideReason.trim(),
                expiresAt: new Date(expiresAt).toISOString(),
              })}>
              {decision === "approved" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark submitted dialog */}
      <Dialog open={!!submitTarget} onOpenChange={(o) => !o && setSubmitTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Transfer Submitted</DialogTitle>
            <DialogDescription>
              Records the provider-side reference. A current approved maker-checker decision is required;
              the ledger pending hold is posted before state changes (fail-closed).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Provider transfer ID (min 3 chars)</Label>
            <Input value={providerTransferId} onChange={e => setProviderTransferId(e.target.value)} placeholder="e.g. ML-2026-..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitTarget(null)}>Cancel</Button>
            <Button
              disabled={providerTransferId.trim().length < 3 || submitMutation.isPending}
              onClick={() => submitMutation.mutate({ transferId: submitTarget.id, providerTransferId: providerTransferId.trim() })}>
              Mark Submitted
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Exception review dialog */}
      <Dialog open={!!exceptionTarget} onOpenChange={(o) => !o && setExceptionTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {exceptionStatus === "resolved" ? "Resolve Exception" : "Accept Risk on Exception"}
            </DialogTitle>
            <DialogDescription>
              {exceptionTarget?.reviewReason ?? ""} The review decision is immutable once recorded.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Resolution (min 5 chars)</Label>
            <Textarea value={exceptionResolution} onChange={e => setExceptionResolution(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExceptionTarget(null)}>Cancel</Button>
            <Button
              variant={exceptionStatus === "resolved" ? "default" : "destructive"}
              disabled={exceptionResolution.trim().length < 5 || exceptionMutation.isPending}
              onClick={() => exceptionMutation.mutate({
                reconciliationId: exceptionTarget.reconciliationId,
                status: exceptionStatus,
                resolution: exceptionResolution.trim(),
              })}>
              {exceptionStatus === "resolved" ? "Mark Resolved" : "Accept Risk"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
