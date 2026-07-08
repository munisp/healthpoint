import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import DashboardLayout from "@/components/DashboardLayout";
import { toast } from "sonner";
import {
  UserCheck, Clock, AlertTriangle, CheckCircle2, FileText,
  Gavel, Star, Phone, Mail, ChevronDown, ChevronUp, Sparkles
} from "lucide-react";

const EXPERT_PANEL = [
  {
    id: "exp-001",
    name: "Dr. Sarah Chen, MD, JD",
    specialty: "Emergency Medicine / NSA Compliance",
    credentials: ["Board Certified Emergency Medicine", "Healthcare Law LLM", "ACEP NSA Task Force Member"],
    successRate: 94,
    avgDays: 12,
    casesHandled: 847,
    bio: "Former CMS advisor with 15 years of NSA/balance billing dispute resolution experience. Specialises in emergency medicine and air ambulance cases.",
    availability: "available",
    email: "s.chen@idr-experts.example",
    phone: "+1 (202) 555-0147",
  },
  {
    id: "exp-002",
    name: "James Whitfield, Esq.",
    specialty: "Health Plan / ERISA Disputes",
    credentials: ["Healthcare Attorney", "ERISA Specialist", "Former DOL Investigator"],
    successRate: 89,
    avgDays: 15,
    casesHandled: 612,
    bio: "Specialises in self-funded ERISA plan disputes and complex multi-payer cases. Deep expertise in QPA methodology challenges.",
    availability: "available",
    email: "j.whitfield@idr-experts.example",
    phone: "+1 (202) 555-0198",
  },
  {
    id: "exp-003",
    name: "Dr. Maria Santos, PhD",
    specialty: "Air Ambulance / Ground Transport",
    credentials: ["Health Economics PhD", "Air Medical Transport Specialist", "CAMTS Certified"],
    successRate: 91,
    avgDays: 10,
    casesHandled: 423,
    bio: "Leading expert in air and ground ambulance IDR cases. Published researcher on QPA benchmarking for transport services.",
    availability: "busy",
    email: "m.santos@idr-experts.example",
    phone: "+1 (202) 555-0231",
  },
  {
    id: "exp-004",
    name: "Robert Kim, CPA, CHC",
    specialty: "Facility / Anesthesiology Billing",
    credentials: ["Certified Healthcare Compliance", "CPA", "HFMA Fellow"],
    successRate: 87,
    avgDays: 18,
    casesHandled: 389,
    bio: "Specialises in facility billing disputes, anesthesiology cases, and complex multi-service claims. Expert in cost-based QPA challenges.",
    availability: "available",
    email: "r.kim@idr-experts.example",
    phone: "+1 (202) 555-0312",
  },
];

const AVAILABILITY_COLORS: Record<string, string> = {
  available: "bg-green-100 text-green-700",
  busy: "bg-amber-100 text-amber-700",
  unavailable: "bg-slate-100 text-slate-500",
};

export default function ExpertReview() {
  const { isAuthenticated } = useAuth();
  const [selectedExpert, setSelectedExpert] = useState<string | null>(null);
  const [selectedDispute, setSelectedDispute] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [expandedExpert, setExpandedExpert] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [aiRecommendation, setAIRecommendation] = useState<string | null>(null);
  const [aiLoading, setAILoading] = useState(false);

  const { data: disputes } = trpc.disputes.list.useQuery({ limit: 50 }, { enabled: isAuthenticated });
  const askAssistant = trpc.ai.askAssistant.useMutation({
    onSuccess: (result: any) => {
      setAIRecommendation(result?.answer ?? "");
      setAILoading(false);
    },
    onError: () => setAILoading(false),
  });

  // Wire expertReview.request — persists request to DB + creates notification
  const requestReviewMutation = trpc.expertReview.request.useMutation({
    onSuccess: (data) => {
      setSubmitted(true);
      toast.success(`Expert review submitted. Estimated response: ${data.estimatedResponse}`);
    },
    onError: (err) => toast.error(err.message),
  });

  // Wire expertReview.getAnalysis — AI-powered dispute analysis pre-fetched when dispute selected
  const analysisQuery = trpc.expertReview.getAnalysis.useQuery(
    { disputeId: selectedDispute },
    { enabled: !!selectedDispute && selectedDispute.length > 0, staleTime: 5 * 60 * 1000 }
  );

  const handleGetRecommendation = () => {
    if (!selectedDispute) { toast.error("Select a dispute first"); return; }
    // Use pre-fetched analysis if available
    if (analysisQuery.data?.analysis) {
      setAIRecommendation(analysisQuery.data.analysis);
      return;
    }
    const dispute = disputes?.items?.find((d: any) => d.id === selectedDispute);
    if (!dispute) return;
    setAILoading(true);
    setAIRecommendation(null);
    askAssistant.mutate({
      question: `For a ${(dispute as any).serviceType?.replace(/_/g, " ")} IDR dispute (billed: $${Number((dispute as any).billedAmount).toLocaleString()}, status: ${(dispute as any).status?.replace(/_/g, " ")}), which expert from our panel would be most appropriate, and what is the recommended escalation strategy? Consider the dispute complexity, service type, and current step in the IDR process.`,
      disputeId: selectedDispute,
      conversationHistory: [],
    });
  };

  const handleSubmit = () => {
    if (!selectedExpert || !selectedDispute) {
      toast.error("Please select both a dispute and an expert");
      return;
    }
    // Persist to DB via tRPC
    requestReviewMutation.mutate({
      disputeId: selectedDispute,
      reason: notes.trim() || `Expert review requested — expert: ${selectedExpert}`,
      urgency: "standard",
    });
  };

  if (!isAuthenticated) return null;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <UserCheck size={24} className="text-indigo-600" />
              Expert Review Panel
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Escalate complex disputes to certified NSA/IDR specialists for expert negotiation and review
            </p>
          </div>
          <Badge className="bg-indigo-600 text-white text-xs">
            {EXPERT_PANEL.filter(e => e.availability === "available").length} Experts Available
          </Badge>
        </div>

        {submitted ? (
          <Card className="border-green-200 bg-green-50">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <CheckCircle2 size={48} className="text-green-500 mb-4" />
              <h2 className="text-xl font-bold text-green-800 mb-2">Expert Review Request Submitted</h2>
              <p className="text-sm text-green-700 max-w-md">
                Your request has been sent to the selected expert. You will receive a confirmation email within 2 business hours. The expert will review the dispute and contact you within 1 business day.
              </p>
              <Button className="mt-6" variant="outline" onClick={() => setSubmitted(false)}>
                Submit Another Request
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Expert Panel */}
            <div className="lg:col-span-2 space-y-4">
              <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Select an Expert</h2>
              {EXPERT_PANEL.map(expert => (
                <Card
                  key={expert.id}
                  className={`border cursor-pointer transition-all ${
                    selectedExpert === expert.id
                      ? "border-indigo-400 shadow-md bg-indigo-50"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                  onClick={() => setSelectedExpert(expert.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 ${
                          selectedExpert === expert.id ? "bg-indigo-600" : "bg-slate-400"
                        }`}>
                          {expert.name.split(" ").map(n => n[0]).slice(0, 2).join("")}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-slate-800 text-sm">{expert.name}</h3>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${AVAILABILITY_COLORS[expert.availability]}`}>
                              {expert.availability}
                            </span>
                            {selectedExpert === expert.id && (
                              <CheckCircle2 size={14} className="text-indigo-600" />
                            )}
                          </div>
                          <p className="text-xs text-indigo-600 font-medium mt-0.5">{expert.specialty}</p>
                          <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                            <span className="flex items-center gap-1">
                              <Star size={11} className="text-amber-400 fill-amber-400" />
                              {expert.successRate}% success rate
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock size={11} />
                              Avg. {expert.avgDays} days
                            </span>
                            <span className="flex items-center gap-1">
                              <Gavel size={11} />
                              {expert.casesHandled.toLocaleString()} cases
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="text-slate-400 hover:text-slate-600 shrink-0"
                        onClick={e => { e.stopPropagation(); setExpandedExpert(expandedExpert === expert.id ? null : expert.id); }}
                      >
                        {expandedExpert === expert.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>

                    {expandedExpert === expert.id && (
                      <div className="mt-3 pt-3 border-t border-slate-200 space-y-3">
                        <p className="text-sm text-slate-600">{expert.bio}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {expert.credentials.map(c => (
                            <span key={c} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{c}</span>
                          ))}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-slate-500">
                          <a href={`mailto:${expert.email}`} className="flex items-center gap-1 hover:text-blue-600">
                            <Mail size={11} />{expert.email}
                          </a>
                          <a href={`tel:${expert.phone}`} className="flex items-center gap-1 hover:text-blue-600">
                            <Phone size={11} />{expert.phone}
                          </a>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Request Form */}
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Escalation Request</h2>

              <Card className="border-slate-200">
                <CardContent className="p-4 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Select Dispute</label>
                    <select
                      value={selectedDispute}
                      onChange={e => setSelectedDispute(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">Choose a dispute…</option>
                      {disputes?.items?.map((d: any) => (
                        <option key={d.id} value={d.id}>
                          {d.referenceNumber} — ${Number(d.billedAmount).toLocaleString()}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Notes for Expert</label>
                    <Textarea
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      placeholder="Describe the complexity, key issues, or specific questions for the expert…"
                      className="text-sm min-h-[100px] resize-none"
                    />
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full text-purple-600 border-purple-200 hover:bg-purple-50"
                    onClick={handleGetRecommendation}
                    disabled={!selectedDispute || aiLoading}
                  >
                    {aiLoading ? (
                      <><span className="animate-spin mr-1.5">⧗</span>Analysing…</>
                    ) : (
                      <><Sparkles size={13} className="mr-1.5" />AI Expert Recommendation</>
                    )}
                  </Button>

                  {aiRecommendation && (
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs text-purple-800">
                      <p className="font-semibold mb-1 flex items-center gap-1">
                        <Sparkles size={11} />AI Recommendation
                      </p>
                      <p className="leading-relaxed">{aiRecommendation}</p>
                    </div>
                  )}

                  <Button
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                    onClick={handleSubmit}
                    disabled={!selectedExpert || !selectedDispute || requestReviewMutation.isPending}
                  >
                    <UserCheck size={14} className="mr-1.5" />
                    Submit Expert Review Request
                  </Button>

                  {(!selectedExpert || !selectedDispute) && (
                    <p className="text-xs text-slate-400 text-center">
                      Select a dispute and an expert to continue
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Info Card */}
              <Card className="border-blue-200 bg-blue-50">
                <CardContent className="p-4 space-y-2">
                  <h4 className="text-xs font-semibold text-blue-800 flex items-center gap-1.5">
                    <FileText size={12} />What Happens Next
                  </h4>
                  {[
                    "Expert reviews dispute within 1 business day",
                    "Detailed strategy memo delivered within 3 days",
                    "Expert available for direct consultation calls",
                    "Expert can represent you in IDR proceedings",
                  ].map((step, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-blue-700">
                      <span className="w-4 h-4 rounded-full bg-blue-200 text-blue-800 flex items-center justify-center font-bold shrink-0 text-[10px]">{i + 1}</span>
                      {step}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
