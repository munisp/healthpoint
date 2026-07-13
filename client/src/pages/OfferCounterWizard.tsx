import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Handshake, ChevronRight, ChevronLeft, CheckCircle2, DollarSign, FileText, Send, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import SmartFormPanel, { type ExtractedField } from "@/components/SmartFormPanel";

const STEPS = [
  { id: 1, label: "Select Dispute", icon: FileText },
  { id: 2, label: "Offer Details", icon: DollarSign },
  { id: 3, label: "Justification", icon: FileText },
  { id: 4, label: "Review & Submit", icon: Send },
];

const JUSTIFICATION_TEMPLATES = {
  qpa_above: "Our billed rate of ${amount} is consistent with the Qualifying Payment Amount for {serviceType} services in this geographic area. The QPA for this service type reflects the median contracted rate, which our charge represents.",
  complexity: "This case involved exceptional medical complexity requiring specialized expertise. The billed amount reflects the additional resources and expertise required beyond standard {serviceType} services.",
  market_rate: "Our proposed amount of ${amount} is consistent with market rates for {serviceType} services in this region, as evidenced by comparable contracted rates with other payers.",
  documentation: "We have provided comprehensive documentation supporting our billed charges, including itemized service records, clinical notes, and supporting medical literature demonstrating the medical necessity and appropriate billing for these services.",
};

export default function OfferCounterWizard() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);
  const [disputeId, setDisputeId] = useState("");
  const [offerAmount, setOfferAmount] = useState("");
  const [justificationTemplate, setJustificationTemplate] = useState("qpa_above");
  const [justification, setJustification] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("5");

  const utils = trpc.useUtils();
  const { data } = trpc.disputes.list.useQuery({ limit: 100, offset: 0 });
  const disputes = data?.items ?? [];
  const selectedDispute = disputes.find(d => d.id === disputeId);

  const makeOfferMutation = trpc.disputes.submitOffer.useMutation({
    onSuccess: () => {
      utils.disputes.getById.invalidate({ id: disputeId });
      toast.success("Counter-offer submitted successfully");
      navigate(`/disputes/${disputeId}`);
    },
    onError: (e: { message: string }) => toast.error("Failed to submit offer: " + e.message),
  });

  const applyTemplate = () => {
    const template = JUSTIFICATION_TEMPLATES[justificationTemplate as keyof typeof JUSTIFICATION_TEMPLATES] ?? "";
    const filled = template
      .replace("{amount}", offerAmount)
      .replace("{serviceType}", (selectedDispute?.serviceType ?? "medical").replace(/_/g, " "));
    setJustification(filled);
  };

  const canProceed = () => {
    if (step === 1) return !!disputeId;
    if (step === 2) return !!offerAmount && Number(offerAmount) > 0;
    if (step === 3) return justification.length >= 50;
    return true;
  };

  const handleSubmit = () => {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + parseInt(expiresInDays));
    makeOfferMutation.mutate({
      disputeId,
      amount: offerAmount,
      rationale: justification,
      offerType: "initiating_party" as const,
    });
  };

  const formatCurrency = (v: number | string | null | undefined) => {
    if (!v) return "—";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v));
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Handshake className="h-6 w-6 text-indigo-600" />
          Counter-Offer Wizard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Guided workflow for crafting and submitting a counter-offer</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${step === s.id ? "bg-indigo-600 text-white" : step > s.id ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
              {step > s.id ? <CheckCircle2 className="h-3.5 w-3.5" /> : <s.icon className="h-3.5 w-3.5" />}
              {s.label}
            </div>
            {i < STEPS.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* Step content */}
      <Card>
        <CardContent className="p-6">
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="font-semibold">Select the dispute to counter-offer on</h2>
              <Select value={disputeId} onValueChange={setDisputeId}>
                <SelectTrigger><SelectValue placeholder="Choose a dispute..." /></SelectTrigger>
                <SelectContent>
                  {disputes.filter(d => ["offer_submission", "open_negotiation", "idr_initiated"].includes(d.status ?? "")).map(d => (
                    <SelectItem key={d.id} value={d.id}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{d.referenceNumber}</span>
                        <span className="text-muted-foreground text-xs">— {d.respondingPartyName}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedDispute && (
                <div className="p-3 bg-muted/50 rounded-lg space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Billed Amount</span><span className="font-medium">{formatCurrency(selectedDispute.billedAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Service Type</span><Badge variant="outline" className="text-xs capitalize">{(selectedDispute.serviceType ?? "—").replace(/_/g, " ")}</Badge></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Status</span><Badge variant="outline" className="text-xs capitalize">{(selectedDispute.status ?? "—").replace(/_/g, " ")}</Badge></div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="font-semibold">Set your counter-offer amount</h2>
              <SmartFormPanel
                targetForm="offer"
                onApply={(fields: Record<string, ExtractedField>) => {
                  if (fields.offerAmount?.value) setOfferAmount(String(fields.offerAmount.value));
                  if (fields.rationale?.value) setJustification(String(fields.rationale.value));
                  toast.success("SmartForm applied offer fields from your document.");
                }}
              />
              {selectedDispute && (
                <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg text-sm">
                  <div><span className="text-muted-foreground">Billed: </span><span className="font-medium">{formatCurrency(selectedDispute.billedAmount)}</span></div>
                </div>
              )}
              <div>
                <label className="text-sm font-medium mb-1.5 block">Counter-Offer Amount ($) *</label>
                <Input
                  type="number"
                  placeholder="Enter your proposed payment amount"
                  value={offerAmount}
                  onChange={e => setOfferAmount(e.target.value)}
                  className="text-lg"
                />
                {selectedDispute?.billedAmount && offerAmount && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {((Number(offerAmount) / Number(selectedDispute.billedAmount)) * 100).toFixed(0)}% of billed amount
                  </p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Offer Expires In</label>
                <Select value={expiresInDays} onValueChange={setExpiresInDays}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">3 business days</SelectItem>
                    <SelectItem value="5">5 business days</SelectItem>
                    <SelectItem value="10">10 business days</SelectItem>
                    <SelectItem value="15">15 business days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="font-semibold">Provide justification for your offer</h2>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Start with a template</label>
                <div className="flex gap-2">
                  <Select value={justificationTemplate} onValueChange={setJustificationTemplate}>
                    <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="qpa_above">QPA Alignment</SelectItem>
                      <SelectItem value="complexity">Medical Complexity</SelectItem>
                      <SelectItem value="market_rate">Market Rate</SelectItem>
                      <SelectItem value="documentation">Documentation Strength</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={applyTemplate}>Apply</Button>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Justification * <span className="text-muted-foreground font-normal">(min 50 characters)</span></label>
                <Textarea
                  value={justification}
                  onChange={e => setJustification(e.target.value)}
                  className="min-h-[160px]"
                  placeholder="Explain why your counter-offer amount is appropriate..."
                  maxLength={3000}
                />
                <p className="text-xs text-muted-foreground mt-1">{justification.length}/3000</p>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="font-semibold">Review your counter-offer</h2>
              <div className="space-y-3 text-sm">
                <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                  <div className="flex justify-between"><span className="text-muted-foreground">Dispute</span><span className="font-mono text-primary">{selectedDispute?.referenceNumber}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Payer</span><span>{selectedDispute?.respondingPartyName}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Original Billed</span><span>{formatCurrency(selectedDispute?.billedAmount)}</span></div>
                  <div className="flex justify-between font-semibold text-base"><span>Counter-Offer Amount</span><span className="text-green-600">{formatCurrency(Number(offerAmount))}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Expires In</span><span>{expiresInDays} business days</span></div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Justification</p>
                  <p className="text-sm bg-muted/30 rounded p-3 leading-relaxed">{justification}</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => step > 1 ? setStep(s => s - 1) : navigate("/disputes")} disabled={makeOfferMutation.isPending}>
          <ChevronLeft className="h-4 w-4 mr-1" />{step === 1 ? "Cancel" : "Back"}
        </Button>
        {step < 4 ? (
          <Button onClick={() => setStep(s => s + 1)} disabled={!canProceed()}>
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={makeOfferMutation.isPending || !canProceed()}>
            {makeOfferMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Submitting...</> : <><Send className="h-4 w-4 mr-2" />Submit Counter-Offer</>}
          </Button>
        )}
      </div>
    </div>
  );
}
