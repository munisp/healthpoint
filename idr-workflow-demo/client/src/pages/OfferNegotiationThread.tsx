import { useState, useRef, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  MessageSquare, Send, DollarSign, ArrowLeft,
  TrendingUp, TrendingDown, Minus, CheckCircle2, XCircle,
  AlertTriangle, Loader2,
} from "lucide-react";

interface OfferMessage {
  id: string;
  role: "initiating" | "responding" | "system";
  amount?: number;
  message: string;
  timestamp: Date;
  author: string;
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
}

type ConfirmAction = "accept" | "reject" | null;

export default function OfferNegotiationThread() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [newMessage, setNewMessage] = useState("");
  const [newOffer, setNewOffer] = useState("");
  const [showOfferInput, setShowOfferInput] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [rejectReason, setRejectReason] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: dispute, isLoading, refetch } = trpc.disputes.getById.useQuery(
    { id: id! },
    { enabled: !!id }
  );

  const utils = trpc.useUtils();

  const acceptMutation = trpc.disputes.acceptOffer.useMutation({
    onSuccess: () => {
      toast.success("Offer accepted — dispute resolved!");
      addSystemMessage("✅ Offer accepted. Dispute has been resolved and determination issued.");
      setConfirmAction(null);
      refetch();
      utils.disputes.getById.invalidate({ id: id! });
    },
    onError: (err) => {
      toast.error(`Failed to accept offer: ${err.message}`);
    },
  });

  const rejectMutation = trpc.disputes.rejectOffer.useMutation({
    onSuccess: () => {
      toast.success("Offer rejected — dispute closed.");
      addSystemMessage(`❌ Offer rejected${rejectReason ? `: ${rejectReason}` : ""}. Dispute has been closed.`);
      setConfirmAction(null);
      setRejectReason("");
      refetch();
      utils.disputes.getById.invalidate({ id: id! });
    },
    onError: (err) => {
      toast.error(`Failed to reject offer: ${err.message}`);
    },
  });

  // Simulated offer thread — localStorage-backed for demo; production would use DB messages table
  const [messages, setMessages] = useState<OfferMessage[]>(() => {
    if (!id) return [];
    const stored = localStorage.getItem(`offer_thread_${id}`);
    if (stored) return JSON.parse(stored).map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
    return [];
  });

  useEffect(() => {
    if (id) localStorage.setItem(`offer_thread_${id}`, JSON.stringify(messages));
  }, [messages, id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function addSystemMessage(text: string) {
    const msg: OfferMessage = {
      id: crypto.randomUUID(),
      role: "system",
      message: text,
      timestamp: new Date(),
      author: "System",
    };
    setMessages(prev => [...prev, msg]);
  }

  function sendMessage(isOffer: boolean) {
    if (!newMessage.trim() && !isOffer) return;
    if (isOffer && !newOffer) { toast.error("Enter an offer amount"); return; }

    const msg: OfferMessage = {
      id: crypto.randomUUID(),
      role: "initiating",
      amount: isOffer ? parseFloat(newOffer.replace(/[^0-9.]/g, "")) : undefined,
      message: newMessage.trim() || (isOffer ? `Counter-offer submitted: ${formatCurrency(parseFloat(newOffer.replace(/[^0-9.]/g, "")))}` : ""),
      timestamp: new Date(),
      author: user?.name ?? "You",
    };
    setMessages(prev => [...prev, msg]);
    setNewMessage("");
    setNewOffer("");
    setShowOfferInput(false);
    toast.success(isOffer ? "Offer submitted" : "Message sent");
  }

  function handleAcceptConfirm() {
    if (!dispute) return;
    // Find the most recent responding party offer from the offers array
    const respondingOffers = (dispute as any).offers?.filter((o: any) => o.offerType === "responding") ?? [];
    const latestOffer = respondingOffers[respondingOffers.length - 1];
    const offerId = latestOffer?.id ?? dispute.id; // fallback to dispute ID
    acceptMutation.mutate({ disputeId: dispute.id, offerId });
  }

  function handleRejectConfirm() {
    if (!dispute) return;
    rejectMutation.mutate({ disputeId: dispute.id, reason: rejectReason || undefined });
  }

  if (isLoading) return <div className="p-6 text-center text-muted-foreground">Loading...</div>;
  if (!dispute) return <div className="p-6 text-center text-muted-foreground">Dispute not found</div>;

  const isResolved = dispute.status === "closed" || dispute.status === "ineligible";
  const billedAmount = parseFloat(String(dispute.billedAmount ?? 0));
  const qpaAmount = parseFloat(String(dispute.qpaAmount ?? 0));
  const initiatingOffer = parseFloat(String(dispute.initiatingPartyOffer ?? 0));
  const respondingOffer = parseFloat(String(dispute.respondingPartyOffer ?? 0));
  const gap = initiatingOffer && respondingOffer ? Math.abs(initiatingOffer - respondingOffer) : null;
  const midpoint = initiatingOffer && respondingOffer ? (initiatingOffer + respondingOffer) / 2 : null;

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/disputes/${id}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" />Back
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-blue-600" />
            Offer Negotiation Thread
          </h1>
          <p className="text-sm text-muted-foreground">{dispute.referenceNumber} · {dispute.initiatingPartyName}</p>
        </div>
        {isResolved && (
          <Badge variant={dispute.status === "closed" ? "default" : "secondary"} className="text-xs">
            {dispute.status === "closed" ? "✅ Resolved" : "❌ Closed"}
          </Badge>
        )}
      </div>

      {/* Offer summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Billed Amount", value: billedAmount, color: "text-slate-700" },
          { label: "QPA", value: qpaAmount, color: "text-blue-700" },
          { label: "Your Offer", value: initiatingOffer, color: "text-green-700" },
          { label: "Payer Offer", value: respondingOffer, color: "text-purple-700" },
        ].map(item => (
          <Card key={item.label}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className={`text-lg font-bold ${item.color}`}>
                {item.value ? formatCurrency(item.value) : "—"}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Gap analysis */}
      {gap !== null && midpoint !== null && (
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-3 flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              {gap < 500 ? <TrendingDown className="h-4 w-4 text-green-600" /> :
               gap < 2000 ? <Minus className="h-4 w-4 text-amber-600" /> :
               <TrendingUp className="h-4 w-4 text-red-600" />}
              <div>
                <p className="text-xs text-muted-foreground">Offer Gap</p>
                <p className="text-sm font-semibold text-blue-800">{formatCurrency(gap)}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Midpoint</p>
              <p className="text-sm font-semibold text-blue-800">{formatCurrency(midpoint)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">vs QPA</p>
              <p className="text-sm font-semibold text-blue-800">
                {qpaAmount ? `${((midpoint / qpaAmount) * 100).toFixed(0)}% of QPA` : "—"}
              </p>
            </div>
            {/* Accept / Reject offer buttons */}
            {!isResolved && respondingOffer > 0 && (
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-300 text-red-600 hover:bg-red-50"
                  onClick={() => setConfirmAction("reject")}
                >
                  <XCircle className="h-4 w-4 mr-1" />Reject Offer
                </Button>
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => setConfirmAction("accept")}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />Accept Offer
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Resolved banner */}
      {isResolved && (
        <div className={`rounded-lg border p-3 flex items-center gap-2 text-sm font-medium ${
          dispute.status === "closed"
            ? "bg-green-50 border-green-200 text-green-800"
            : "bg-slate-50 border-slate-200 text-slate-600"
        }`}>
          {dispute.status === "closed"
            ? <><CheckCircle2 className="h-4 w-4" />This dispute has been resolved. No further offers can be submitted.</>
            : <><XCircle className="h-4 w-4" />This dispute has been closed. No further offers can be submitted.</>
          }
        </div>
      )}

      {/* Message thread */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Negotiation History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No messages yet. Start the negotiation by sending a message or counter-offer.
              </p>
            ) : (
              messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === "initiating" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-sm rounded-lg p-3 ${
                    msg.role === "initiating"
                      ? "bg-primary text-primary-foreground"
                      : msg.role === "system"
                      ? "bg-amber-50 border border-amber-200 text-amber-800 text-xs italic w-full text-center"
                      : "bg-muted"
                  }`}>
                    {msg.amount !== undefined && (
                      <div className="flex items-center gap-1.5 mb-1">
                        <DollarSign className="h-3.5 w-3.5" />
                        <span className="font-bold text-sm">{formatCurrency(msg.amount)}</span>
                        <Badge variant="outline" className="text-xs py-0">Offer</Badge>
                      </div>
                    )}
                    <p className="text-sm">{msg.message}</p>
                    <p className={`text-xs mt-1 ${msg.role === "initiating" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {msg.author} · {msg.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input area — disabled when resolved */}
          {!isResolved && (
            <div className="mt-4 space-y-2 border-t pt-4">
              {showOfferInput && (
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Input
                    placeholder="Counter-offer amount (e.g. 1250.00)"
                    value={newOffer}
                    onChange={e => setNewOffer(e.target.value)}
                    className="w-48"
                    type="number"
                    min="0"
                    step="0.01"
                  />
                  <Button variant="outline" size="sm" onClick={() => setShowOfferInput(false)}>Cancel</Button>
                </div>
              )}
              <div className="flex gap-2">
                <Textarea
                  placeholder="Type a message..."
                  value={newMessage}
                  onChange={e => setNewMessage(e.target.value)}
                  className="min-h-[60px] resize-none"
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendMessage(false); }}
                />
                <div className="flex flex-col gap-1.5">
                  <Button size="sm" onClick={() => sendMessage(false)} disabled={!newMessage.trim() && !showOfferInput}>
                    <Send className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => showOfferInput ? sendMessage(true) : setShowOfferInput(true)}
                    title="Submit counter-offer"
                  >
                    <DollarSign className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Cmd+Enter to send · $ button to submit a counter-offer</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Accept Offer Confirmation Modal */}
      <Dialog open={confirmAction === "accept"} onOpenChange={open => !open && setConfirmAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="h-5 w-5" />Accept Offer
            </DialogTitle>
            <DialogDescription>
              You are about to accept the payer's offer of{" "}
              <strong>{respondingOffer ? formatCurrency(respondingOffer) : "the submitted amount"}</strong>.
              This will resolve the dispute and issue a final determination.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800 space-y-1">
            <p><strong>Dispute:</strong> {dispute.referenceNumber}</p>
            <p><strong>Payer Offer:</strong> {respondingOffer ? formatCurrency(respondingOffer) : "—"}</p>
            <p><strong>QPA:</strong> {qpaAmount ? formatCurrency(qpaAmount) : "—"}</p>
            {midpoint && <p><strong>vs Midpoint:</strong> {formatCurrency(midpoint)}</p>}
          </div>
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            This action is irreversible. The dispute status will be updated to Resolved and all parties will be notified.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={handleAcceptConfirm}
              disabled={acceptMutation.isPending}
            >
              {acceptMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Accepting...</> : <><CheckCircle2 className="h-4 w-4 mr-1" />Confirm Accept</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Offer Confirmation Modal */}
      <Dialog open={confirmAction === "reject"} onOpenChange={open => !open && setConfirmAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <XCircle className="h-5 w-5" />Reject Offer
            </DialogTitle>
            <DialogDescription>
              You are about to reject the payer's offer of{" "}
              <strong>{respondingOffer ? formatCurrency(respondingOffer) : "the submitted amount"}</strong>.
              The dispute will be closed as ineligible.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800 space-y-1">
              <p><strong>Dispute:</strong> {dispute.referenceNumber}</p>
              <p><strong>Payer Offer:</strong> {respondingOffer ? formatCurrency(respondingOffer) : "—"}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">
                Reason for rejection <span className="text-red-500 font-normal">*</span>
                <span className="text-xs text-muted-foreground font-normal ml-1">(required — will be shared with all parties)</span>
              </label>
              <Textarea
                placeholder="e.g. The offered amount of $X is below the applicable QPA of $Y. We are requesting independent dispute resolution arbitration to determine the appropriate out-of-network rate..."
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                className={`min-h-[100px] resize-none ${!rejectReason.trim() ? 'border-red-300 focus-visible:ring-red-400' : ''}`}
                maxLength={1000}
              />
              <div className="flex items-center justify-between mt-1">
                <span className={`text-xs ${!rejectReason.trim() ? 'text-red-500' : 'text-muted-foreground'}`}>
                  {!rejectReason.trim() ? 'A reason is required to reject an offer' : `${rejectReason.length}/1000 characters`}
                </span>
                <span className="text-xs text-muted-foreground">{rejectReason.length}/1000</span>
              </div>
            </div>
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              This action is irreversible. The dispute will be closed and all parties will be notified.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleRejectConfirm}
              disabled={rejectMutation.isPending || !rejectReason.trim()}
            >
              {rejectMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Rejecting...</> : <><XCircle className="h-4 w-4 mr-1" />Confirm Reject</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
