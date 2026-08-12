import { useState, useRef, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { MessageSquare, Send, DollarSign, ArrowLeft, TrendingUp, TrendingDown, Minus } from "lucide-react";

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

export default function OfferNegotiationThread() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [newMessage, setNewMessage] = useState("");
  const [newOffer, setNewOffer] = useState("");
  const [showOfferInput, setShowOfferInput] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: dispute, isLoading } = trpc.disputes.getById.useQuery(
    { id: id! },
    { enabled: !!id }
  );

  const utils = trpc.useUtils();

  // Simulated offer thread — in production this would be a DB-backed messages table
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

  if (isLoading) return <div className="p-6 text-center text-muted-foreground">Loading...</div>;
  if (!dispute) return <div className="p-6 text-center text-muted-foreground">Dispute not found</div>;

  const billedAmount = parseFloat(String(dispute.billedAmount ?? 0));
  const qpaAmount = parseFloat(String(dispute.qpaAmount ?? 0));
  const initiatingOffer = parseFloat(String(dispute.initiatingPartyOffer ?? 0));
  const respondingOffer = parseFloat(String(dispute.respondingPartyOffer ?? 0));

  const gap = initiatingOffer && respondingOffer ? Math.abs(initiatingOffer - respondingOffer) : null;
  const midpoint = initiatingOffer && respondingOffer ? (initiatingOffer + respondingOffer) / 2 : null;

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/disputes/${id}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" />Back
        </Button>
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-blue-600" />
            Offer Negotiation Thread
          </h1>
          <p className="text-sm text-muted-foreground">{dispute.referenceNumber} · {dispute.initiatingPartyName}</p>
        </div>
      </div>

      {/* Offer summary */}
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
          </CardContent>
        </Card>
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
                      ? "bg-muted text-muted-foreground text-xs italic"
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

          {/* Input area */}
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
        </CardContent>
      </Card>
    </div>
  );
}
