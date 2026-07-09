import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, XCircle, AlertCircle, Database, RefreshCw, Info, TrendingUp } from "lucide-react";

const USCDI_V3_ELEMENTS = [
  { category: "Patient Demographics", elements: [
    { key: "patientName", label: "Patient Name", required: true },
    { key: "patientDob", label: "Date of Birth", required: true },
    { key: "patientAddress", label: "Address", required: true },
    { key: "patientPhone", label: "Phone Number", required: false },
    { key: "patientEmail", label: "Email Address", required: false },
    { key: "patientRace", label: "Race", required: false },
    { key: "patientEthnicity", label: "Ethnicity", required: false },
    { key: "patientLanguage", label: "Preferred Language", required: false },
  ]},
  { category: "Clinical Data", elements: [
    { key: "diagnosisCodes", label: "Diagnosis Codes (ICD-10)", required: true },
    { key: "procedureCodes", label: "Procedure Codes (CPT)", required: true },
    { key: "serviceDate", label: "Service Date", required: true },
    { key: "facilityNpi", label: "Facility NPI", required: true },
    { key: "providerNpi", label: "Rendering Provider NPI", required: true },
    { key: "providerSpecialty", label: "Provider Specialty", required: false },
    { key: "placeOfService", label: "Place of Service", required: true },
  ]},
  { category: "Financial Data", elements: [
    { key: "billedAmount", label: "Billed Amount", required: true },
    { key: "allowedAmount", label: "Allowed Amount", required: true },
    { key: "qpaAmount", label: "Qualifying Payment Amount (QPA)", required: true },
    { key: "payerName", label: "Payer Name", required: true },
    { key: "planType", label: "Plan Type", required: true },
    { key: "memberId", label: "Member ID", required: true },
    { key: "groupNumber", label: "Group Number", required: false },
    { key: "claimNumber", label: "Claim Number", required: true },
  ]},
  { category: "NSA-Specific", elements: [
    { key: "nsaApplicability", label: "NSA Applicability Determination", required: true },
    { key: "openNegotiationDate", label: "Open Negotiation Start Date", required: true },
    { key: "idrInitiationDate", label: "IDR Initiation Date", required: false },
    { key: "goodFaithEstimate", label: "Good Faith Estimate Provided", required: false },
    { key: "networkStatus", label: "Network Status at Time of Service", required: true },
    { key: "emergencyFlag", label: "Emergency Service Flag", required: false },
  ]},
];

const ALL_ELEMENTS = USCDI_V3_ELEMENTS.flatMap(c => c.elements);

export default function USCDICompleteness() {
  const [selectedDisputeId, setSelectedDisputeId] = useState("");
  const [elementValues, setElementValues] = useState<Record<string, boolean>>({});
  const [hasEdits, setHasEdits] = useState(false);

  const { data: disputes } = trpc.disputes.list.useQuery({ limit: 50, offset: 0 });
  const { data: completeness, refetch } = trpc.uscdi.getCompleteness.useQuery(
    { disputeId: selectedDisputeId },
    { enabled: !!selectedDisputeId }
  );

  useEffect(() => {
    if (completeness) {
      const vals: Record<string, boolean> = {};
      ALL_ELEMENTS.forEach(el => { vals[el.key] = !!(completeness as Record<string, unknown>)[el.key]; });
      setElementValues(vals);
      setHasEdits(false);
    }
  }, [completeness]);

  const updateMutation = trpc.uscdi.updateCompleteness.useMutation({
    onSuccess: (result) => {
      toast.success(`USCDI completeness updated — score: ${result.score}%`);
      refetch();
      setHasEdits(false);
    },
    onError: () => toast.error("Failed to update completeness"),
  });

  const toggleElement = (key: string, value: boolean) => {
    setElementValues(prev => ({ ...prev, [key]: value }));
    setHasEdits(true);
  };

  const handleSave = () => {
    if (!selectedDisputeId) return;
    updateMutation.mutate({ disputeId: selectedDisputeId, elements: elementValues });
  };

  const score = completeness?.completenessScore ?? 0;
  const missing = (completeness?.missingElements as string[]) ?? [];
  const requiredMissing = missing.filter(k => ALL_ELEMENTS.find(e => e.key === k)?.required);

  const scoreColor = score >= 90 ? "text-green-600" : score >= 70 ? "text-amber-600" : "text-red-600";
  const scoreBg = score >= 90 ? "bg-green-100" : score >= 70 ? "bg-amber-100" : "bg-red-100";

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 bg-teal-600 rounded-lg"><Database size={18} className="text-white" /></div>
              <h1 className="text-2xl font-bold text-slate-900">USCDI Data Completeness</h1>
            </div>
            <p className="text-sm text-slate-500 ml-11">Track and improve USCDI v3 data completeness for each dispute — ensures regulatory compliance and IDR submission quality</p>
            <div className="flex items-center gap-2 mt-1 ml-11">
              <Badge variant="outline" className="text-xs text-teal-700 border-teal-300">USCDI v3 (2023)</Badge>
              <Badge variant="outline" className="text-xs text-blue-700 border-blue-300">ONC Certified</Badge>
            </div>
          </div>
          {hasEdits && (
            <Button onClick={handleSave} disabled={updateMutation.isPending} className="gap-1.5">
              {updateMutation.isPending ? <RefreshCw size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
              Save Completeness
            </Button>
          )}
        </div>

        {/* Dispute Selector */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm font-medium text-slate-700">Dispute:</span>
              <select value={selectedDisputeId} onChange={e => setSelectedDisputeId(e.target.value)}
                className="text-sm border border-slate-200 rounded-md px-3 h-9 bg-white min-w-[280px]">
                <option value="">Select a dispute...</option>
                {disputes?.items?.map((d: { id: string; referenceNumber: string; patientName?: string | null }) => (
                  <option key={d.id} value={d.id}>{d.referenceNumber} — {d.patientName || "Unknown Patient"}</option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        {selectedDisputeId && (
          <>
            {/* Score Overview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className={`text-center py-3 ${scoreBg}`}>
                <p className={`text-3xl font-bold ${scoreColor}`}>{score}%</p>
                <p className="text-xs text-slate-600 mt-0.5">Overall Score</p>
              </Card>
              <Card className="text-center py-3">
                <p className="text-2xl font-bold text-slate-800">{ALL_ELEMENTS.length}</p>
                <p className="text-xs text-slate-500 mt-0.5">Total Elements</p>
              </Card>
              <Card className="text-center py-3">
                <p className="text-2xl font-bold text-red-600">{requiredMissing.length}</p>
                <p className="text-xs text-slate-500 mt-0.5">Required Missing</p>
              </Card>
              <Card className="text-center py-3">
                <p className="text-2xl font-bold text-green-600">{ALL_ELEMENTS.length - missing.length}</p>
                <p className="text-xs text-slate-500 mt-0.5">Elements Present</p>
              </Card>
            </div>

            {/* Progress Bar */}
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-700">Completeness Progress</span>
                  <span className={`text-sm font-bold ${scoreColor}`}>{score}%</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-3">
                  <div className={`h-3 rounded-full transition-all ${score >= 90 ? "bg-green-500" : score >= 70 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${score}%` }} />
                </div>
                {requiredMissing.length > 0 && (
                  <div className="flex items-start gap-2 mt-3 p-2 bg-red-50 rounded border border-red-200">
                    <AlertCircle size={13} className="text-red-600 mt-0.5 shrink-0" />
                    <p className="text-xs text-red-700"><strong>Required fields missing:</strong> {requiredMissing.map(k => ALL_ELEMENTS.find(e => e.key === k)?.label ?? k).join(", ")}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Element Checklist */}
            <div className="space-y-4">
              {USCDI_V3_ELEMENTS.map(category => (
                <Card key={category.category}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingUp size={13} className="text-teal-600" />
                      {category.category}
                      <span className="text-xs font-normal text-slate-400">
                        ({category.elements.filter(e => elementValues[e.key]).length}/{category.elements.length})
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {category.elements.map(el => {
                        const isPresent = elementValues[el.key] ?? false;
                        return (
                          <label key={el.key} className={`flex items-center justify-between p-2 rounded border cursor-pointer transition-colors ${isPresent ? "bg-green-50 border-green-200" : "bg-slate-50 border-slate-200 hover:border-teal-300"}`}>
                            <div className="flex items-center gap-2">
                              {isPresent ? <CheckCircle2 size={13} className="text-green-600 shrink-0" /> : <XCircle size={13} className="text-slate-300 shrink-0" />}
                              <span className="text-xs text-slate-700">{el.label}</span>
                              {el.required && <Badge variant="outline" className="text-xs px-1 py-0 text-red-600 border-red-300">Req</Badge>}
                            </div>
                            <input type="checkbox" checked={isPresent} onChange={e => toggleElement(el.key, e.target.checked)} className="rounded" />
                          </label>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}

        {/* USCDI Info */}
        <Card className="border-teal-200 bg-teal-50">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <Info size={14} className="text-teal-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-teal-800 mb-1">About USCDI v3</p>
                <p className="text-sm text-teal-700">The United States Core Data for Interoperability (USCDI) v3 defines the minimum set of health data classes and elements required for nationwide interoperability. For NSA/IDR disputes, complete USCDI data ensures accurate QPA calculations, reduces adjudication delays, and supports regulatory compliance with 45 CFR Part 182.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
