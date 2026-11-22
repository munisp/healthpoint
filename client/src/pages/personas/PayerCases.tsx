/**
 * /payer/cases — payer queue (v1). Shows disputes linked to the caller's
 * payer account with actions: respond to ON notice, counter-offer, accept,
 * record payment intent.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import PersonaTour from "@/components/PersonaTour";

/** W7-3 first-run hints (dismissal persisted in localStorage). */
const TOUR_STEPS = [
  { title: "Your payer queue", body: "Every dispute linked to your payer account lands here with its current workflow step and status." },
  { title: "Respond to open negotiation", body: "Use the response box to reply to an open-negotiation notice — your response is written to the dispute timeline." },
  { title: "Counter-offer or accept", body: "Enter a dollar amount with a rationale to submit a counter-offer, or accept the current offer to issue a determination." },
  { title: "Record payment intent", body: "After a determination, record a payment intent to create a settlement transfer draft." },
];

export default function PayerCases() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.payer.listCases.useQuery();
  const [response, setResponse] = useState<Record<string, string>>({});
  const [offer, setOffer] = useState<Record<string, string>>({});
  const [offerRationale, setOfferRationale] = useState<Record<string, string>>({});

  const invalidate = () => utils.payer.listCases.invalidate();
  const respond = trpc.payer.respondToOnNotice.useMutation({
    onSuccess: () => { toast.success("Response recorded on the dispute timeline"); invalidate(); },
    onError: e => toast.error(e.message),
  });
  const counter = trpc.payer.submitCounterOffer.useMutation({
    onSuccess: () => { toast.success("Counter-offer submitted"); invalidate(); },
    onError: e => toast.error(e.message),
  });
  const accept = trpc.payer.acceptOffer.useMutation({
    onSuccess: () => { toast.success("Offer accepted — determination issued"); invalidate(); },
    onError: e => toast.error(e.message),
  });
  const pay = trpc.payer.recordPaymentIntent.useMutation({
    onSuccess: () => { toast.success("Payment intent recorded (transfer draft)"); invalidate(); },
    onError: e => toast.error(e.message),
  });

  return (
    <DashboardLayout>
      <PersonaTour tourId="payer-cases" steps={TOUR_STEPS} />
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Payer Cases</h1>
        {data?.account && (
          <p className="text-sm text-muted-foreground">
            Payer account: <span className="font-medium">{data.account.payerName}</span> ({data.account.contactEmail})
          </p>
        )}
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && !data?.cases.length && (
          <p className="text-sm text-muted-foreground">No disputes are linked to your payer account yet.</p>
        )}
        {data?.cases.map(c => (
          <Card key={c.linkId}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {c.referenceNumber}
                <Badge variant="outline">{c.status}</Badge>
                <Badge variant="secondary">{c.currentStep}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm grid grid-cols-2 md:grid-cols-4 gap-2">
                <div>Billed: <b>${c.billedAmount}</b></div>
                <div>QPA: <b>{c.qpaAmount ? `$${c.qpaAmount}` : "—"}</b></div>
                <div>Your offer: <b>{c.respondingPartyOffer ? `$${c.respondingPartyOffer}` : "—"}</b></div>
                <div>Determination: <b>{c.determinationAmount ? `$${c.determinationAmount}` : "—"}</b></div>
              </div>
              <Textarea
                aria-label={`Response to open-negotiation notice for ${c.referenceNumber}`}
                placeholder="Response to open-negotiation notice…"
                value={response[c.disputeId] ?? ""}
                onChange={e => setResponse(s => ({ ...s, [c.disputeId]: e.target.value }))}
              />
              <div className="flex flex-wrap gap-2 items-center">
                <Button
                  size="sm"
                  disabled={respond.isPending || !(response[c.disputeId] ?? "").trim()}
                  onClick={() => respond.mutate({ disputeId: c.disputeId, response: response[c.disputeId] })}
                >
                  Respond to ON Notice
                </Button>
                <Input
                  className="w-32"
                  aria-label={`Counter-offer amount in dollars for ${c.referenceNumber}`}
                  inputMode="decimal"
                  placeholder="2100.00"
                  value={offer[c.disputeId] ?? ""}
                  onChange={e => setOffer(s => ({ ...s, [c.disputeId]: e.target.value }))}
                />
                <Input
                  className="w-64"
                  aria-label={`Counter-offer rationale for ${c.referenceNumber}`}
                  placeholder="Counter-offer rationale"
                  value={offerRationale[c.disputeId] ?? ""}
                  onChange={e => setOfferRationale(s => ({ ...s, [c.disputeId]: e.target.value }))}
                />
                <Button
                  size="sm" variant="secondary"
                  disabled={counter.isPending || !(offer[c.disputeId] ?? "").trim()}
                  onClick={() => counter.mutate({
                    disputeId: c.disputeId,
                    amount: offer[c.disputeId],
                    rationale: offerRationale[c.disputeId] || "Payer counter-offer",
                  })}
                >
                  Submit Counter-Offer
                </Button>
                <Button
                  size="sm" variant="outline"
                  disabled={accept.isPending}
                  onClick={() => accept.mutate({ disputeId: c.disputeId })}
                >
                  Accept Current Offer
                </Button>
                <Button
                  size="sm" variant="outline"
                  disabled={pay.isPending || !c.determinationAmount}
                  onClick={() => pay.mutate({
                    disputeId: c.disputeId,
                    idempotencyKey: `payer-pay-${c.disputeId}`,
                    reason: "Payment intent for determination",
                  })}
                >
                  Record Payment Intent
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </DashboardLayout>
  );
}
