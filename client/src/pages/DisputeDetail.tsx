import { useState, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { APP_LOGO, APP_TITLE } from "@/const";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, Clock,
  DollarSign, FileText, Gavel, LogOut, Scale, Upload, Users,
  TrendingUp, CheckCircle, XCircle, RefreshCw, Download, Bell,
  Brain, Sparkles, AlertCircle, ChevronDown, ChevronUp
} from "lucide-react";
import WorkflowTimeline from "@/components/WorkflowTimeline";
import DeadlineCountdownBanner from "@/components/DeadlineCountdownBanner";
import OutcomePredictionGauge from "@/components/OutcomePredictionGauge";
import DisputeComments from "@/components/DisputeComments";

const IDR_STEPS = [
  { key: "STEP_01_OPEN_NEGOTIATION_INITIATED", label: "Open Negotiation Initiated", description: "Party sends open negotiation notice per NSA §2799A-1", days: "Day 0" },
  { key: "STEP_02_OPEN_NEGOTIATION_PERIOD", label: "Open Negotiation Period", description: "30-business-day window for parties to reach agreement", days: "Days 1–30" },
  { key: "STEP_03_OPEN_NEGOTIATION_FAILED", label: "Open Negotiation Failed", description: "Parties failed to reach agreement within 30 business days", days: "Day 30+" },
  { key: "STEP_04_IDR_INITIATED", label: "IDR Initiated", description: "Either party initiates federal IDR within 4 business days", days: "+4 bd" },
  { key: "STEP_05_IDR_NOTICE_SENT", label: "IDR Notice Sent", description: "CMS notified; certified IDR entity selection process begins", days: "+1 bd" },
  { key: "STEP_06_IDR_ENTITY_SELECTION", label: "IDR Entity Selection", description: "Parties jointly select a certified IDR entity", days: "+4 bd" },
  { key: "STEP_07_IDR_ENTITY_SELECTED", label: "IDR Entity Selected", description: "Certified IDR entity confirmed and assigned", days: "Day 0 of IDR" },
  { key: "STEP_08_ELIGIBILITY_REVIEW", label: "Eligibility Review", description: "IDR entity reviews dispute eligibility per 45 CFR §149.510", days: "+3 bd" },
  { key: "STEP_09_OFFER_SUBMISSION", label: "Offer Submission", description: "Both parties submit payment offers to IDR entity", days: "+10 bd" },
  { key: "STEP_10_QPA_DISCLOSURE", label: "QPA Disclosure", description: "Qualifying Payment Amount (QPA) disclosed to IDR entity", days: "Concurrent" },
  { key: "STEP_11_ADDITIONAL_INFORMATION", label: "Additional Information", description: "Parties may submit additional supporting information", days: "+5 bd" },
  { key: "STEP_12_ARBITRATION_REVIEW", label: "Arbitration Review", description: "IDR entity reviews all offers and supporting information", days: "Active review" },
  { key: "STEP_13_DETERMINATION_ISSUED", label: "Determination Issued", description: "IDR entity selects one party's offer as the payment amount", days: "+30 bd" },
  { key: "STEP_14_PAYMENT_DETERMINATION", label: "Payment Determination", description: "Losing party notified; payment obligation established", days: "Day 0 of payment" },
  { key: "STEP_15_PAYMENT_MADE", label: "Payment Made", description: "Determined payment amount transmitted to winning party", days: "+30 days" },
  { key: "STEP_16_ADMINISTRATIVE_FEE_PAID", label: "Administrative Fee Paid", description: "Losing party pays IDR administrative fee to CMS", days: "Concurrent" },
  { key: "STEP_17_DISPUTE_CLOSED", label: "Dispute Closed", description: "Dispute formally closed in the federal IDR portal", days: "Final" },
  { key: "STEP_18_APPEAL_FILED", label: "Appeal Filed (Optional)", description: "Party files appeal in federal district court", days: "Optional" },
  { key: "STEP_19_APPEAL_RESOLVED", label: "Appeal Resolved (Optional)", description: "Federal court issues final ruling on appeal", days: "Optional" },
];

const NEXT_STEP_MAP: Record<string, { step: string; status: string; label: string }> = {
  STEP_01_OPEN_NEGOTIATION_INITIATED: { step: "STEP_02_OPEN_NEGOTIATION_PERIOD", status: "open_negotiation", label: "Begin Negotiation Period" },
  STEP_02_OPEN_NEGOTIATION_PERIOD: { step: "STEP_03_OPEN_NEGOTIATION_FAILED", status: "open_negotiation", label: "Mark Negotiation Failed" },
  STEP_03_OPEN_NEGOTIATION_FAILED: { step: "STEP_04_IDR_INITIATED", status: "idr_initiated", label: "Initiate Federal IDR" },
  STEP_04_IDR_INITIATED: { step: "STEP_05_IDR_NOTICE_SENT", status: "idr_initiated", label: "Send IDR Notice to CMS" },
  STEP_05_IDR_NOTICE_SENT: { step: "STEP_06_IDR_ENTITY_SELECTION", status: "idr_entity_selection", label: "Begin Entity Selection" },
  STEP_06_IDR_ENTITY_SELECTION: { step: "STEP_07_IDR_ENTITY_SELECTED", status: "idr_entity_selection", label: "Confirm Entity Selected" },
  STEP_07_IDR_ENTITY_SELECTED: { step: "STEP_08_ELIGIBILITY_REVIEW", status: "eligibility_review", label: "Begin Eligibility Review" },
  STEP_08_ELIGIBILITY_REVIEW: { step: "STEP_09_OFFER_SUBMISSION", status: "offer_submission", label: "Open Offer Submission" },
  STEP_09_OFFER_SUBMISSION: { step: "STEP_10_QPA_DISCLOSURE", status: "offer_submission", label: "Disclose QPA" },
  STEP_10_QPA_DISCLOSURE: { step: "STEP_11_ADDITIONAL_INFORMATION", status: "offer_submission", label: "Open Additional Info Period" },
  STEP_11_ADDITIONAL_INFORMATION: { step: "STEP_12_ARBITRATION_REVIEW", status: "under_arbitration", label: "Begin Arbitration Review" },
  STEP_12_ARBITRATION_REVIEW: { step: "STEP_13_DETERMINATION_ISSUED", status: "determination_issued", label: "Issue Determination" },
  STEP_13_DETERMINATION_ISSUED: { step: "STEP_14_PAYMENT_DETERMINATION", status: "payment_pending", label: "Notify Losing Party" },
  STEP_14_PAYMENT_DETERMINATION: { step: "STEP_15_PAYMENT_MADE", status: "payment_pending", label: "Confirm Payment Made" },
  STEP_15_PAYMENT_MADE: { step: "STEP_16_ADMINISTRATIVE_FEE_PAID", status: "payment_pending", label: "Confirm Admin Fee Paid" },
  STEP_16_ADMINISTRATIVE_FEE_PAID: { step: "STEP_17_DISPUTE_CLOSED", status: "closed", label: "Close Dispute" },
};

const OFFER_TYPE_LABELS: Record<string, string> = {
  initiating_party: "Initiating Party",
  responding_party: "Responding Party",
  qpa: "QPA",
  determination: "Determination",
};

const OFFER_TYPE_COLORS: Record<string, string> = {
  initiating_party: "bg-blue-50 border-blue-200 text-blue-700",
  responding_party: "bg-purple-50 border-purple-200 text-purple-700",
  qpa: "bg-amber-50 border-amber-200 text-amber-700",
  determination: "bg-green-50 border-green-200 text-green-700",
};

export default function DisputeDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();
  const utils = trpc.useUtils();

  // Modal states
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [showCounterOfferModal, setShowCounterOfferModal] = useState(false);
  const [showArbitratorModal, setShowArbitratorModal] = useState(false);
  const [showDocModal, setShowDocModal] = useState(false);

  // Offer form state
  const [offerAmount, setOfferAmount] = useState("");
  const [offerRationale, setOfferRationale] = useState("");
  const [offerType, setOfferType] = useState<"initiating_party" | "responding_party" | "qpa">("initiating_party");
  const [counterOfferAmount, setCounterOfferAmount] = useState("");
  const [counterOfferRationale, setCounterOfferRationale] = useState("");
  const [acceptingOfferId, setAcceptingOfferId] = useState<string | null>(null);

  // Document form state
  const [docTitle, setDocTitle] = useState("");
  const [docType, setDocType] = useState<"qpa_documentation" | "eob" | "contract" | "medical_records" | "cost_sharing_info" | "prior_authorization" | "other">("other");
  const [docDescription, setDocDescription] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docFileName, setDocFileName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Arbitrator state
  const [selectedArbitratorId, setSelectedArbitratorId] = useState("");
  const [selectedArbitratorName, setSelectedArbitratorName] = useState("");

  // AI Summary state
  const [aiSummary, setAiSummary] = useState<{
    answer: string;
    sources?: string[];
    suggestedActions?: string[];
    confidence?: string;
    toolsUsed?: string[];
    processingTimeSeconds?: number;
  } | null>(null);
  const [showAiSummary, setShowAiSummary] = useState(false);

  // Advance state
  const [advanceDescription, setAdvanceDescription] = useState("");
  const [determinationBasis, setDeterminationBasis] = useState("");
  const [showAdvanceConfirm, setShowAdvanceConfirm] = useState(false);

  // Queries
  const { data: timelineData, isLoading } = trpc.disputes.getTimeline.useQuery({ disputeId: id! });
  // Fallback: load basic dispute data when getTimeline returns nothing (e.g. newly created dispute)
  const { data: basicDispute } = trpc.disputes.getById.useQuery(
    { id: id! },
    { enabled: !!id && !isLoading && !timelineData }
  );
  const { data: documentList, refetch: refetchDocs } = trpc.documents.list.useQuery(
    { disputeId: id! },
    { enabled: !!id }
  );
  const { data: arbitrators } = trpc.arbitrators.list.useQuery({}, { enabled: showArbitratorModal });

  // Mutations
  const advanceMutation = trpc.disputes.advance.useMutation({
    onSuccess: () => { utils.disputes.getTimeline.invalidate(); utils.dashboard.stats.invalidate(); toast.success("Dispute advanced to next step"); },
    onError: (err) => toast.error(err.message),
  });

  const submitOfferMutation = trpc.disputes.submitOffer.useMutation({
    onSuccess: () => {
      utils.disputes.getTimeline.invalidate();
      setShowOfferModal(false);
      setOfferAmount(""); setOfferRationale("");
      toast.success("Offer submitted successfully");
    },
    onError: (err) => toast.error(err.message),
  });

  const submitCounterOfferMutation = trpc.disputes.submitOffer.useMutation({
    onSuccess: () => {
      utils.disputes.getTimeline.invalidate();
      setShowCounterOfferModal(false);
      setCounterOfferAmount(""); setCounterOfferRationale("");
      toast.success("Counter-offer submitted");
    },
    onError: (err) => toast.error(err.message),
  });

  const exportPDFMutation = trpc.disputes.exportPDF.useMutation({
    onSuccess: (data) => {
      const bytes = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: data.contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = data.filename; a.click();
      URL.revokeObjectURL(url);
      toast.success("PDF exported successfully");
    },
    onError: (err) => toast.error(err.message),
  });

  const acceptOfferMutation = trpc.disputes.acceptOffer.useMutation({
    onSuccess: () => {
      utils.disputes.getTimeline.invalidate();
      utils.dashboard.stats.invalidate();
      setAcceptingOfferId(null);
      toast.success("Offer accepted — dispute resolved");
    },
    onError: (err) => toast.error(err.message),
  });

  const selectArbitratorMutation = trpc.disputes.selectArbitrator.useMutation({
    onSuccess: () => { utils.disputes.getTimeline.invalidate(); setShowArbitratorModal(false); toast.success("IDR entity selected"); },
    onError: (err) => toast.error(err.message),
  });

  const aiSummaryMutation = trpc.ai.askAssistant.useMutation({
    onSuccess: (data) => {
      setAiSummary(data as any);
      setShowAiSummary(true);
    },
    onError: (err) => toast.error(`AI summary failed: ${err.message}`),
  });

  const handleAISummary = () => {
    if (!dispute) return;
    aiSummaryMutation.mutate({
      question: `Provide a concise plain-English summary of this NSA IDR dispute. Include: (1) the current step and what it means, (2) outstanding deadlines, (3) the recommended next action the initiating party should take, and (4) any regulatory risks or compliance concerns.`,
      disputeId: dispute.id,
    });
  };

  const uploadDocMutation = trpc.documents.upload.useMutation({
    onSuccess: () => {
      utils.disputes.getTimeline.invalidate();
      refetchDocs();
      setShowDocModal(false);
      setDocTitle(""); setDocDescription(""); setDocFileName(""); setSelectedFile(null); setDocType("other");
      toast.success("Document attached successfully");
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>
  );

  if (!timelineData && !basicDispute) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <AlertTriangle size={40} className="text-red-500 mx-auto mb-3" />
        <p className="text-slate-600">Dispute not found</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/disputes")}>Back to Disputes</Button>
      </div>
    </div>
  );

  // Use full timeline data if available, fall back to basic dispute data
  const dispute = timelineData?.dispute ?? basicDispute!;
  const timeline = timelineData?.timeline ?? [];
  const { dispute: _d, timeline: _t, ...timelineRest } = timelineData ?? {}; // keep offers etc.
  const offers = (timelineData as any).offers ?? [];
  const nextStep = NEXT_STEP_MAP[dispute.currentStep];
  const currentStepIndex = IDR_STEPS.findIndex(s => s.key === dispute.currentStep);
  const isOfferPhase = ["offer_submission", "under_arbitration"].includes(dispute.status);

  const handleAdvance = () => {
    if (!nextStep) return;
    setShowAdvanceConfirm(true);
  };

  const confirmAdvance = () => {
    if (!nextStep) return;
    const desc = advanceDescription || `Advanced to ${nextStep.step.replace(/^STEP_\d+_/, "").replace(/_/g, " ")}`;
    advanceMutation.mutate(
      {
        disputeId: dispute.id,
        newStep: nextStep.step as any,
        newStatus: nextStep.status as any,
        description: desc,
        ...(determinationBasis ? { determinationBasis } : {}),
      },
      { onSuccess: () => setShowAdvanceConfirm(false) }
    );
  };

  return (
    <div className="space-y-6">
      {/* Deadline countdown banner — shows when ≤ 3 business days remain */}
      {dispute && (dispute as any).deadlineDays !== undefined && (
        <DeadlineCountdownBanner
          disputeId={dispute.id}
          claimNumber={(dispute as any).claimNumber}
          currentStep={dispute.currentStep}
          deadlineDays={(dispute as any).deadlineDays ?? 99}
          deadlineDate={(dispute as any).deadlineDate}
        />
      )}
        {/* Page header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <button onClick={() => navigate("/disputes")} className="text-slate-400 hover:text-slate-600">
                <ArrowLeft size={18} />
              </button>
              <h1 className="text-2xl font-bold text-slate-800">{dispute.referenceNumber}</h1>
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                dispute.status === "closed" ? "bg-green-100 text-green-700" :
                dispute.status === "under_arbitration" ? "bg-red-100 text-red-700" :
                dispute.status === "determination_issued" ? "bg-teal-100 text-teal-700" :
                "bg-blue-100 text-blue-700"
              }`}>
                {{
                  open_negotiation: "Open Negotiation",
                  idr_initiated: "IDR Initiated",
                  idr_entity_selection: "IDR Entity Selection",
                  eligibility_review: "Eligibility Review",
                  offer_submission: "Offer Submission",
                  under_arbitration: "Under Arbitration",
                  determination_issued: "Determination Issued",
                  payment_pending: "Payment Pending",
                  closed: "Closed",
                  appealed: "Appealed",
                  ineligible: "Ineligible",
                }[dispute.status] ?? dispute.status?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
              </span>
            </div>
            <p className="text-sm text-slate-500 ml-7">
              {dispute.initiatingPartyName} vs {dispute.respondingPartyName ?? "TBD"} ·{" "}
              {dispute.serviceType?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())} · Filed {dispute.createdAt ? new Date(dispute.createdAt as unknown as string).toLocaleDateString() : "—"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button variant="outline" onClick={handleAISummary} disabled={aiSummaryMutation.isPending} className="flex items-center gap-2 border-violet-300 text-violet-700 hover:bg-violet-50">
              <Brain size={14} />{aiSummaryMutation.isPending ? "Analysing..." : "AI Summary"}
            </Button>
            <Button variant="outline" onClick={() => exportPDFMutation.mutate({ disputeId: dispute.id })} disabled={exportPDFMutation.isPending} className="flex items-center gap-2">
              <Download size={14} />{exportPDFMutation.isPending ? "Generating..." : "Export PDF"}
            </Button>
            <Button variant="outline" onClick={() => setShowDocModal(true)} className="flex items-center gap-2">
              <Upload size={14} />Attach Evidence
            </Button>
            {dispute.currentStep === "STEP_06_IDR_ENTITY_SELECTION" && (
              <Button variant="outline" onClick={() => setShowArbitratorModal(true)} className="flex items-center gap-2">
                <Gavel size={14} />Select IDR Entity
              </Button>
            )}
            {["STEP_09_OFFER_SUBMISSION", "STEP_10_QPA_DISCLOSURE"].includes(dispute.currentStep) && (
              <Button variant="outline" onClick={() => setShowOfferModal(true)} className="flex items-center gap-2">
                <DollarSign size={14} />Submit Offer
              </Button>
            )}
            {isOfferPhase && offers.length > 0 && (
              <Button variant="outline" onClick={() => setShowCounterOfferModal(true)} className="flex items-center gap-2 border-purple-300 text-purple-700 hover:bg-purple-50">
                <RefreshCw size={14} />Counter-Offer
              </Button>
            )}
            {nextStep && !["STEP_06_IDR_ENTITY_SELECTION"].includes(dispute.currentStep) && dispute.status !== "closed" && (
              <Button onClick={handleAdvance} disabled={advanceMutation.isPending} className="flex items-center gap-2">
                <ChevronRight size={14} />
                {advanceMutation.isPending ? "Advancing..." : nextStep.label}
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 19-Step Timeline */}
          <div className="lg:col-span-2 space-y-4">
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
                  <Scale size={16} className="text-blue-500" />NSA IDR 19-Step Workflow
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <WorkflowTimeline
                  steps={timeline}
                  currentStep={dispute.currentStep}
                  disputeId={dispute.id}
                  disputeCreatedAt={dispute.createdAt}
                />
              </CardContent>
            </Card>

            {/* Offer Negotiation History — full-width card below timeline */}
            {offers.length > 0 && (
              <Card className="border-slate-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold text-slate-800 flex items-center justify-between">
                    <span className="flex items-center gap-2"><TrendingUp size={16} className="text-green-500" />Offer Negotiation History</span>
                    <span className="text-xs text-slate-400 font-normal">{offers.length} offer{offers.length !== 1 ? "s" : ""} submitted</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {offers.map((offer: any) => (
                      <div key={offer.id} className={`p-4 rounded-xl border-2 ${offer.isAccepted ? "bg-green-50 border-green-300" : `${OFFER_TYPE_COLORS[offer.offerType] ?? "bg-slate-50 border-slate-200"}`}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${OFFER_TYPE_COLORS[offer.offerType] ?? "bg-slate-100 border-slate-200 text-slate-600"}`}>
                            {OFFER_TYPE_LABELS[offer.offerType] ?? offer.offerType}
                          </span>
                          {offer.isAccepted && (
                            <span className="flex items-center gap-1 text-xs font-semibold text-green-700">
                              <CheckCircle size={12} />Accepted
                            </span>
                          )}
                        </div>
                        <div className="text-2xl font-bold text-slate-800 mb-1">
                          ${Number(offer.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </div>
                        {offer.rationale && (
                          <p className="text-xs text-slate-600 leading-relaxed mb-2 line-clamp-3">{offer.rationale}</p>
                        )}
                        <div className="text-xs text-slate-400">
                          {offer.submittedAt ? new Date(offer.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
                        </div>
                        {!offer.isAccepted && isOfferPhase && (
                          <button
                            onClick={() => { setAcceptingOfferId(offer.id); acceptOfferMutation.mutate({ disputeId: dispute.id, offerId: offer.id }); }}
                            disabled={acceptOfferMutation.isPending && acceptingOfferId === offer.id}
                            className="mt-3 w-full py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5">
                            {acceptOfferMutation.isPending && acceptingOfferId === offer.id
                              ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Accepting...</>
                              : <><CheckCircle size={12} />Accept This Offer</>}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {isOfferPhase && (
                    <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                      <strong>NSA §2799A-2(b):</strong> The IDR entity must select one party's offer as the payment amount. Accepting an offer here records agreement — the IDR entity makes the binding determination.
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right sidebar */}
          <div className="space-y-4">
            {/* Outcome Prediction */}
            <OutcomePredictionGauge
              disputeId={dispute.id}
              billedAmount={String(dispute.billedAmount ?? "")}
              qpaAmount={String(dispute.qpaAmount ?? "")}
              currentStep={dispute.currentStep ?? undefined}
              payerName={dispute.respondingPartyName ?? undefined}
            />

            {/* Financial Summary */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <DollarSign size={14} className="text-green-500" />Financial Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {[
                  { label: "Billed Amount", value: dispute.billedAmount },
                  { label: "QPA", value: dispute.qpaAmount },
                  { label: "Initiating Party Offer", value: dispute.initiatingPartyOffer },
                  { label: "Responding Party Offer", value: dispute.respondingPartyOffer },
                  { label: "Determination Amount", value: dispute.determinationAmount, highlight: true },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">{item.label}</span>
                    <span className={`font-semibold ${(item as any).highlight ? "text-blue-700" : "text-slate-700"}`}>
                      {item.value ? `$${Number(item.value).toLocaleString()}` : <span className="text-slate-300 font-normal">—</span>}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* NSA Deadlines */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Clock size={14} className="text-amber-500" />NSA Deadlines
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {[
                  { label: "Open Negotiation", date: dispute.openNegotiationDeadline },
                  { label: "IDR Initiation", date: dispute.idrInitiationDeadline },
                  { label: "Entity Selection", date: dispute.entitySelectionDeadline },
                  { label: "Eligibility Review", date: dispute.eligibilityDeadline },
                  { label: "Offer Submission", date: dispute.offerSubmissionDeadline },
                  { label: "Additional Info", date: dispute.additionalInfoDeadline },
                  { label: "Determination", date: dispute.determinationDeadline },
                  { label: "Payment Due", date: dispute.paymentDeadline },
                ].filter(d => d.date != null).map(item => {
                  const due = new Date(item.date as unknown as string);
                  const isOverdue = due < new Date() && dispute.status !== "closed";
                  return (
                    <div key={item.label} className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">{item.label}</span>
                      <span className={`font-medium ${isOverdue ? "text-red-600" : "text-slate-600"}`}>
                        {due.toLocaleDateString()}
                        {isOverdue && <span className="ml-1 text-red-500">⚠</span>}
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Parties */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Users size={14} className="text-blue-500" />Parties
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0 text-sm">
                <div>
                  <div className="text-xs text-slate-400 mb-0.5">Initiating Party</div>
                  <div className="font-medium text-slate-700">{dispute.initiatingPartyName}</div>
                  <div className="text-xs text-slate-500 capitalize">{dispute.initiatingPartyType?.replace(/_/g, " ")} {dispute.initiatingPartyNpi ? `· NPI: ${dispute.initiatingPartyNpi}` : ""}</div>
                </div>
                <Separator />
                <div>
                  <div className="text-xs text-slate-400 mb-0.5">Responding Party</div>
                  <div className="font-medium text-slate-700">{dispute.respondingPartyName ?? <span className="text-slate-400">Not yet identified</span>}</div>
                  {dispute.respondingPartyType && <div className="text-xs text-slate-500 capitalize">{dispute.respondingPartyType?.replace(/_/g, " ")}</div>}
                </div>
                {dispute.idrEntityName && (
                  <>
                    <Separator />
                    <div>
                      <div className="text-xs text-slate-400 mb-0.5">Certified IDR Entity</div>
                      <div className="font-medium text-slate-700">{dispute.idrEntityName}</div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* AI Dispute Summary Card */}
            <Card className={`border-violet-200 bg-violet-50 transition-all duration-300 ${showAiSummary ? "" : "opacity-80"}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-violet-800 flex items-center justify-between">
                  <span className="flex items-center gap-2"><Brain size={14} className="text-violet-600" />AI Dispute Summary</span>
                  <div className="flex items-center gap-2">
                    {aiSummary && (
                      <button onClick={() => setShowAiSummary(v => !v)} className="text-violet-500 hover:text-violet-700">
                        {showAiSummary ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {aiSummaryMutation.isPending && (
                  <div className="flex items-center gap-2 py-4 justify-center">
                    <div className="animate-spin w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full" />
                    <span className="text-xs text-violet-600">IDR Assistant analysing dispute...</span>
                  </div>
                )}
                {!aiSummaryMutation.isPending && !aiSummary && (
                  <div className="text-center py-4">
                    <Sparkles size={24} className="text-violet-300 mx-auto mb-2" />
                    <p className="text-xs text-violet-500 mb-3">Get an AI-generated plain-English summary of the current dispute status, deadlines, and recommended next action.</p>
                    <Button size="sm" variant="outline" onClick={handleAISummary} className="border-violet-300 text-violet-700 hover:bg-violet-100 text-xs">
                      <Brain size={12} className="mr-1" />Generate Summary
                    </Button>
                  </div>
                )}
                {aiSummary && showAiSummary && (
                  <div className="space-y-3">
                    <p className="text-xs text-violet-900 leading-relaxed whitespace-pre-wrap">{aiSummary.answer}</p>
                    {aiSummary.suggestedActions && aiSummary.suggestedActions.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-violet-700 mb-1 flex items-center gap-1"><CheckCircle size={11} />Suggested Actions</div>
                        <ul className="space-y-1">
                          {aiSummary.suggestedActions.map((action, i) => (
                            <li key={i} className="text-xs text-violet-800 flex items-start gap-1.5">
                              <span className="text-violet-400 shrink-0 mt-0.5">›</span>{action}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {aiSummary.sources && aiSummary.sources.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-violet-700 mb-1">Regulatory Sources</div>
                        <div className="flex flex-wrap gap-1">
                          {aiSummary.sources.map((src, i) => (
                            <span key={i} className="text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">{src}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-1 border-t border-violet-200">
                      {aiSummary.confidence && (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          aiSummary.confidence === "high" ? "bg-green-100 text-green-700" :
                          aiSummary.confidence === "medium" ? "bg-amber-100 text-amber-700" :
                          "bg-red-100 text-red-700"
                        }`}>{aiSummary.confidence} confidence</span>
                      )}
                      <button onClick={handleAISummary} disabled={aiSummaryMutation.isPending} className="text-xs text-violet-500 hover:text-violet-700 flex items-center gap-1">
                        <RefreshCw size={10} />Refresh
                      </button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Service Details */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <FileText size={14} className="text-purple-500" />Service Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0 text-sm">
                {[
                  { label: "Service Type", value: dispute.serviceType?.replace(/_/g, " ") },
                  { label: "Service Date", value: dispute.serviceDate ? new Date(dispute.serviceDate).toLocaleDateString() : null },
                  { label: "Patient State", value: dispute.patientState },
                  { label: "Facility State", value: dispute.facilityState },
                  { label: "CPT Codes", value: Array.isArray(dispute.cptCodes) ? dispute.cptCodes.join(", ") : dispute.cptCodes },
                ].map(item => (
                  <div key={item.label} className="flex items-start justify-between gap-2">
                    <span className="text-slate-400 shrink-0">{item.label}</span>
                    <span className="text-slate-700 font-medium text-right capitalize">{item.value ?? "—"}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Evidence Documents */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-700 flex items-center justify-between">
                  <span className="flex items-center gap-2"><FileText size={14} className="text-orange-500" />Evidence Documents</span>
                  <button onClick={() => setShowDocModal(true)} className="text-xs text-blue-600 hover:underline font-normal">+ Attach</button>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {!documentList || documentList.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-3">No documents attached yet</p>
                ) : (
                  <div className="space-y-2">
                    {documentList.map((doc: any) => (
                      <div key={doc.id} className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
                        <FileText size={14} className="text-slate-400 mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-slate-700 truncate">{doc.title}</div>
                          <div className="text-xs text-slate-400 capitalize">{doc.documentType?.replace(/_/g, " ")}</div>
                          {doc.fileSize && doc.fileSize > 0 && (
                            <div className="text-xs text-slate-400">{(doc.fileSize / 1024).toFixed(1)} KB</div>
                          )}
                          <div className="text-xs text-slate-400">{doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString() : ""}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Comments Thread */}
            <DisputeComments disputeId={dispute.id} />
          </div>
        </div>

      {/* ── Offer Submission Modal ─────────────────────────────────────── */}
      {showOfferModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">Submit Payment Offer</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Offer Type</label>
                <select value={offerType} onChange={e => setOfferType(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="initiating_party">Initiating Party Offer</option>
                  <option value="responding_party">Responding Party Offer</option>
                  <option value="qpa">Qualifying Payment Amount (QPA)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Amount ($)</label>
                <input type="number" step="0.01" min="0" value={offerAmount} onChange={e => setOfferAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Rationale (optional)</label>
                <textarea value={offerRationale} onChange={e => setOfferRationale(e.target.value)} rows={3}
                  placeholder="Explain the basis for this offer amount..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <Button variant="outline" className="flex-1" onClick={() => setShowOfferModal(false)}>Cancel</Button>
              <Button className="flex-1" disabled={!offerAmount || submitOfferMutation.isPending}
                onClick={() => submitOfferMutation.mutate({ disputeId: dispute.id, offerType, amount: offerAmount, rationale: offerRationale || undefined })}>
                {submitOfferMutation.isPending ? "Submitting..." : "Submit Offer"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Counter-Offer Modal ────────────────────────────────────────── */}
      {showCounterOfferModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-1">Submit Counter-Offer</h3>
            <p className="text-xs text-slate-500 mb-4">
              Submit a counter-offer in response to the opposing party's offer. The certified IDR entity will consider all offers when making their binding determination under NSA §2799A-2.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Counter-Offer Amount ($)</label>
                <input type="number" step="0.01" min="0" value={counterOfferAmount} onChange={e => setCounterOfferAmount(e.target.value)}
                  placeholder="0.00" autoFocus
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {dispute.qpaAmount && (
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                  <strong>QPA Reference:</strong> ${Number(dispute.qpaAmount).toLocaleString()} — The IDR entity must begin with a presumption that the QPA is the appropriate out-of-network rate.
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Supporting Rationale</label>
                <textarea value={counterOfferRationale} onChange={e => setCounterOfferRationale(e.target.value)} rows={4}
                  placeholder="Cite QPA benchmarks, comparable rates, clinical complexity, prior authorization status, or other NSA-recognized factors (45 CFR §149.510(c)(4))..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <Button variant="outline" className="flex-1" onClick={() => setShowCounterOfferModal(false)}>Cancel</Button>
              <Button className="flex-1 bg-purple-600 hover:bg-purple-700" disabled={!counterOfferAmount || submitCounterOfferMutation.isPending}
                onClick={() => submitCounterOfferMutation.mutate({ disputeId: dispute.id, offerType: "responding_party", amount: counterOfferAmount, rationale: counterOfferRationale || undefined })}>
                {submitCounterOfferMutation.isPending ? "Submitting..." : "Submit Counter-Offer"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Document Upload Modal ──────────────────────────────────────── */}
      {showDocModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-1">Attach Supporting Evidence</h3>
            <p className="text-xs text-slate-500 mb-4">Attach documents such as QPA evidence, EOBs, operative notes, or contracts to this dispute record.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Document Type</label>
                <select value={docType} onChange={e => setDocType(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="qpa_documentation">QPA Documentation</option>
                  <option value="eob">Explanation of Benefits (EOB)</option>
                  <option value="contract">Contract / Fee Schedule</option>
                  <option value="medical_records">Medical Records / Operative Notes</option>
                  <option value="cost_sharing_info">Cost Sharing Information</option>
                  <option value="prior_authorization">Prior Authorization</option>
                  <option value="other">Other Supporting Document</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Document Title</label>
                <input type="text" value={docTitle} onChange={e => setDocTitle(e.target.value)}
                  placeholder="e.g., QPA Calculation Worksheet Q3 2025"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">File</label>
                <div className="flex gap-2">
                  <input type="text" value={docFileName} onChange={e => setDocFileName(e.target.value)}
                    placeholder="filename.pdf"
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.docx,.xlsx,.png,.jpg"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) { setDocFileName(f.name); setSelectedFile(f); }
                    }} />
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>Browse</Button>
                </div>
                <p className="text-xs text-slate-400 mt-1">Accepted: PDF, DOCX, XLSX, PNG, JPG</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Description (optional)</label>
                <textarea value={docDescription} onChange={e => setDocDescription(e.target.value)} rows={2}
                  placeholder="Brief description of what this document demonstrates..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <Button variant="outline" className="flex-1" onClick={() => setShowDocModal(false)}>Cancel</Button>
              <Button className="flex-1" disabled={!docTitle || !docFileName || uploadDocMutation.isPending}
                onClick={() => uploadDocMutation.mutate({
                  disputeId: dispute.id,
                  documentType: docType,
                  fileName: docFileName,
                  fileType: docFileName.endsWith(".pdf") ? "application/pdf" :
                    docFileName.endsWith(".docx") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" :
                    docFileName.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :
                    "application/octet-stream",
                  fileSize: selectedFile?.size ?? 0,
                  storageKey: `disputes/${dispute.id}/${Date.now()}-${docFileName}`,
                  storageUrl: `disputes/${dispute.id}/${Date.now()}-${docFileName}`,
                  description: docDescription || undefined,
                })}>
                {uploadDocMutation.isPending ? "Attaching..." : "Attach Document"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Arbitrator Selection Modal ─────────────────────────────────── */}
      {showArbitratorModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">Select Certified IDR Entity</h3>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {arbitrators?.map(a => (
                <div key={a.id} onClick={() => { setSelectedArbitratorId(a.id); setSelectedArbitratorName(a.name); }}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedArbitratorId === a.id ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300"}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-800 text-sm">{a.name}</span>
                    <span className="text-xs text-slate-500">Cert: {a.certificationNumber}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Avg. {a.avgResolutionDays} days · {a.totalCasesHandled?.toLocaleString()} cases handled
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    States: {Array.isArray(a.states) ? a.states.join(", ") : a.states}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-5">
              <Button variant="outline" className="flex-1" onClick={() => setShowArbitratorModal(false)}>Cancel</Button>
              <Button className="flex-1" disabled={!selectedArbitratorId || selectArbitratorMutation.isPending}
                onClick={() => selectArbitratorMutation.mutate({ disputeId: dispute.id, idrEntityId: selectedArbitratorId, idrEntityName: selectedArbitratorName })}>
                {selectArbitratorMutation.isPending ? "Selecting..." : "Confirm Selection"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step Advance Confirmation Dialog ──────────────────────────── */}
      <Dialog open={showAdvanceConfirm} onOpenChange={setShowAdvanceConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ChevronRight size={18} className="text-blue-600" />
              Confirm Step Advancement
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-slate-600 space-y-3">
            <p>You are about to advance this dispute from:</p>
            <div className="bg-slate-50 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-500 w-16">FROM</span>
                <span className="font-medium text-slate-700">{dispute?.currentStep?.replace(/^STEP_\d+_/, "").replace(/_/g, " ")}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-500 w-16">TO</span>
                <span className="font-semibold text-blue-700">{nextStep?.label}</span>
              </div>
            </div>
            <p className="text-slate-500 text-xs">This action will be recorded in the dispute timeline and cannot be reversed without admin intervention.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdvanceConfirm(false)}>Cancel</Button>
            <Button
              onClick={confirmAdvance}
              disabled={advanceMutation.isPending}
              className="flex items-center gap-2"
            >
              {advanceMutation.isPending
                ? <><span className="animate-spin">⟳</span> Advancing...</>
                : <><ChevronRight size={14} /> {nextStep?.label}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
