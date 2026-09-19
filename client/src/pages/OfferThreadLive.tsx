import { useMemo, useState } from "react";
import { useParams } from "wouter";
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2, Gavel, Handshake, MessageSquare, Scale, Send, ShieldAlert, XCircle,
} from "lucide-react";

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

const fmtUsd = (v: string | number | null | undefined) => {
  if (v == null || v === "") return "-";
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return String(v);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
};

const OFFER_TYPE_LABEL: Record<string, string> = {
  initiating_party: "Initiating party",
  responding_party: "Responding party",
  qpa: "QPA",
  determination: "Determination",
};

type TimelineItem =
  | { kind: "offer"; at: string; offer: any }
  | { kind: "comment"; at: string; comment: any };

export default function OfferThreadLive() {
  const { id = "" } = useParams<{ id?: string }>();

  const meQuery = trpc.auth.me.useQuery(undefined, { retry: false });
  const disputeQuery = trpc.disputes.getById.useQuery({ id }, { enabled: !!id, retry: false });
  const timelineQuery = trpc.disputes.getTimeline.useQuery({ disputeId: id }, { enabled: !!id, retry: false });
  const commentsQuery = trpc.comments.list.useQuery({ disputeId: id }, { enabled: !!id, retry: false });

  const refetchAll = () => {
    disputeQuery.refetch();
    timelineQuery.refetch();
    commentsQuery.refetch();
  };

  // Offer form
  const [offerType, setOfferType] = useState<"initiating_party" | "responding_party">("initiating_party");
  const [amount, setAmount] = useState("");
  const [rationale, setRationale] = useState("");
  const submitOfferMutation = trpc.disputes.submitOffer.useMutation({
    onSuccess: () => {
      toast.success("Offer submitted");
      setAmount("");
      setRationale("");
      refetchAll();
    },
    onError: (e) => toast.error(e.message),
  });

  // Comment form
  const [comment, setComment] = useState("");
  const addCommentMutation = trpc.comments.add.useMutation({
    onSuccess: () => {
      toast.success("Comment posted");
      setComment("");
      commentsQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  // Accept / reject confirmation dialogs
  const [acceptTarget, setAcceptTarget] = useState<any | null>(null);
  const acceptMutation = trpc.disputes.acceptOffer.useMutation({
    onSuccess: () => {
      toast.success("Offer accepted - dispute resolved");
      setAcceptTarget(null);
      refetchAll();
    },
    onError: (e) => toast.error(e.message),
  });
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const rejectMutation = trpc.disputes.rejectOffer.useMutation({
    onSuccess: () => {
      toast.success("Offer rejected - appeal filed (STEP_18)");
      setRejectOpen(false);
      setRejectReason("");
      refetchAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const dispute = (timelineQuery.data as any)?.dispute ?? (disputeQuery.data as any) ?? null;
  const offers: any[] = (timelineQuery.data as any)?.offers ?? [];
  const comments: any[] = (commentsQuery.data ?? []) as any[];

  const items = useMemo<TimelineItem[]>(() => {
    const merged: TimelineItem[] = [
      ...offers.map(o => ({ kind: "offer" as const, at: String(o.createdAt ?? o.submittedAt ?? ""), offer: o })),
      ...comments.map(c => ({ kind: "comment" as const, at: String(c.createdAt ?? ""), comment: c })),
    ];
    return merged.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [offers, comments]);

  const myId = (meQuery.data as any)?.id;
  const isResolved = dispute?.status === "closed" || dispute?.status === "determination_issued" || !!dispute?.determinationAmount;
  const latestCounterpartyOffer = [...offers]
    .reverse()
    .find(o => o.offerType !== "qpa" && o.offerType !== "determination" && o.submittedBy !== myId);

  if (!id) {
    return <p className="text-sm text-destructive">No dispute id in route.</p>;
  }
  if (timelineQuery.isLoading || disputeQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }
  if (timelineQuery.isError || disputeQuery.isError) {
    return (
      <Card>
        <CardContent className="py-10 flex flex-col items-center text-muted-foreground">
          <ShieldAlert size={28} className="mb-2 text-destructive opacity-60" />
          <p className="text-sm">
            {(timelineQuery.error ?? disputeQuery.error)?.message ?? "Failed to load dispute."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2 flex-wrap">
          <Handshake size={22} className="text-primary" />
          Offer Negotiation - {dispute?.referenceNumber ?? id}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Real two-party offer thread. Server-persisted offers and comments; accept resolves the dispute,
          reject files an appeal (45 CFR 149.510(b)(2)).
        </p>
      </div>

      {/* Determination / winner banner */}
      {isResolved && (
        <Card>
          <CardContent className="py-4 flex flex-wrap items-center gap-3">
            <Gavel size={18} className="text-primary" />
            <p className="text-sm text-foreground font-medium">Determination on record</p>
            <Badge variant="secondary">
              {dispute?.determinationAmount != null ? fmtUsd(dispute.determinationAmount) : "Amount n/a"}
            </Badge>
            {dispute?.determinationWinner && (
              <Badge variant="outline">
                Winner: {String(dispute.determinationWinner).replace(/_/g, " ")}
              </Badge>
            )}
            <Badge variant="outline">{String(dispute?.status ?? "").replace(/_/g, " ")}</Badge>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Scale size={16} className="text-primary" /> Offer and Comment Timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <div className="py-10 flex flex-col items-center text-muted-foreground">
                  <Handshake size={28} className="mb-2 opacity-30" />
                  <p className="text-sm">No offers or comments yet. Submit the first offer below.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {items.map((item, i) =>
                    item.kind === "offer" ? (
                      <div key={item.offer.id ?? i} className="rounded-md border border-border p-3 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={item.offer.offerType === "qpa" || item.offer.offerType === "determination" ? "outline" : "secondary"}>
                            {OFFER_TYPE_LABEL[item.offer.offerType] ?? item.offer.offerType}
                          </Badge>
                          <span className="text-lg font-bold text-foreground">{fmtUsd(item.offer.amount)}</span>
                          <span className="text-xs text-muted-foreground ml-auto">
                            {item.at ? new Date(item.at).toLocaleString() : ""}
                          </span>
                        </div>
                        {item.offer.rationale && (
                          <p className="text-xs text-muted-foreground">{item.offer.rationale}</p>
                        )}
                        {item.offer.submittedBy === myId && (
                          <Badge variant="outline" className="text-xs font-normal">submitted by you</Badge>
                        )}
                      </div>
                    ) : (
                      <div key={item.comment.id ?? i} className="rounded-md bg-muted p-3 space-y-1">
                        <div className="flex items-center gap-2">
                          <MessageSquare size={12} className="text-muted-foreground" />
                          <span className="text-xs font-medium text-foreground">{item.comment.authorName ?? "Unknown"}</span>
                          <span className="text-xs text-muted-foreground ml-auto">
                            {item.at ? new Date(item.at).toLocaleString() : ""}
                          </span>
                        </div>
                        <p className="text-xs text-foreground whitespace-pre-wrap">{item.comment.content}</p>
                      </div>
                    )
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Comment composer */}
          <Card>
            <CardContent className="pt-4 space-y-3">
              <Label className="text-xs">Add a comment to the thread</Label>
              <Textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={5000}
                placeholder="Negotiation note visible to both parties..." />
              <Button size="sm" disabled={comment.trim().length === 0 || addCommentMutation.isPending}
                onClick={() => addCommentMutation.mutate({ disputeId: id, content: comment.trim() })}>
                <MessageSquare size={13} className="mr-1.5" /> Post Comment
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Offer composer + decisions */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Send size={16} className="text-primary" /> Submit an Offer
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {isResolved ? (
                <p className="text-sm text-muted-foreground">
                  This dispute already has a determination; the offer window is closed.
                </p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Party</Label>
                    <Select value={offerType} onValueChange={v => setOfferType(v as typeof offerType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="initiating_party">Initiating party</SelectItem>
                        <SelectItem value="responding_party">Responding party</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Amount (USD, e.g. 1250.00)</Label>
                    <Input value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
                    {amount && !AMOUNT_RE.test(amount.trim()) && (
                      <p className="text-xs text-destructive">Enter a positive amount with at most 2 decimals.</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Rationale (optional)</Label>
                    <Textarea value={rationale} onChange={e => setRationale(e.target.value)} />
                  </div>
                  <Button size="sm" className="w-full"
                    disabled={!AMOUNT_RE.test(amount.trim()) || submitOfferMutation.isPending}
                    onClick={() => submitOfferMutation.mutate({
                      disputeId: id,
                      offerType,
                      amount: amount.trim(),
                      rationale: rationale.trim() || undefined,
                    })}>
                    Submit Offer
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {!isResolved && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Respond to Latest Counter-Offer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!latestCounterpartyOffer ? (
                  <p className="text-sm text-muted-foreground">No counterparty offer on record yet.</p>
                ) : (
                  <>
                    <p className="text-sm text-foreground">
                      Latest {OFFER_TYPE_LABEL[latestCounterpartyOffer.offerType] ?? latestCounterpartyOffer.offerType} offer:{" "}
                      <span className="font-bold">{fmtUsd(latestCounterpartyOffer.amount)}</span>
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" className="flex-1"
                        onClick={() => setAcceptTarget(latestCounterpartyOffer)}>
                        <CheckCircle2 size={13} className="mr-1.5" /> Accept
                      </Button>
                      <Button size="sm" variant="destructive" className="flex-1" onClick={() => setRejectOpen(true)}>
                        <XCircle size={13} className="mr-1.5" /> Reject
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Accept confirmation */}
      <Dialog open={!!acceptTarget} onOpenChange={(o) => !o && setAcceptTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept Offer</DialogTitle>
            <DialogDescription>
              Accepting {acceptTarget ? fmtUsd(acceptTarget.amount) : ""} resolves this dispute and records the
              determination amount. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAcceptTarget(null)}>Cancel</Button>
            <Button disabled={acceptMutation.isPending}
              onClick={() => acceptMutation.mutate({ disputeId: id, offerId: acceptTarget.id })}>
              Confirm Acceptance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject confirmation */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Offer</DialogTitle>
            <DialogDescription>
              Rejecting the offer files an appeal (STEP_18_APPEAL_FILED, 45 CFR 149.510(b)(2)).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Reason (optional, max 1000 chars)</Label>
            <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} maxLength={1000} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={rejectMutation.isPending}
              onClick={() => rejectMutation.mutate({ disputeId: id, reason: rejectReason.trim() || undefined })}>
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
