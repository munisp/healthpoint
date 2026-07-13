import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ChevronRight, ChevronLeft, Check, Building2, Stethoscope, DollarSign, FileText, Rocket } from "lucide-react";
import SmartFormPanel, { type ExtractedField } from "@/components/SmartFormPanel";

const STEPS = [
  { id: 1, title: "Parties", icon: Building2, description: "Identify the initiating and responding parties" },
  { id: 2, title: "Service", icon: Stethoscope, description: "Enter service details and CPT codes" },
  { id: 3, title: "Financials", icon: DollarSign, description: "Billed amount and qualifying payment amount" },
  { id: 4, title: "Review", icon: FileText, description: "Review and submit your dispute" },
];

const SERVICE_TYPES = [
  { value: "emergency_medicine", label: "Emergency Medicine" },
  { value: "anesthesiology", label: "Anesthesiology" },
  { value: "pathology", label: "Pathology" },
  { value: "radiology", label: "Radiology" },
  { value: "neonatology", label: "Neonatology" },
  { value: "assistant_surgeon", label: "Assistant Surgeon" },
  { value: "hospitalist", label: "Hospitalist" },
  { value: "intensivist", label: "Intensivist" },
  { value: "air_ambulance", label: "Air Ambulance" },
  { value: "ground_ambulance", label: "Ground Ambulance" },
  { value: "other", label: "Other" },
];

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

interface FormData {
  initiatingPartyName: string;
  initiatingPartyType: "provider" | "facility" | "payer" | "aggregator";
  respondingPartyName: string;
  respondingPartyType: "provider" | "facility" | "payer" | "aggregator";
  serviceType: string;
  serviceDate: string;
  patientState: string;
  facilityState: string;
  cptCodes: string;
  billedAmount: string;
  qpaAmount: string;
}

export default function MobileDisputeWizard() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [form, setForm] = useState<FormData>({
    initiatingPartyName: user?.name ?? "",
    initiatingPartyType: "provider",
    respondingPartyName: "",
    respondingPartyType: "payer",
    serviceType: "emergency_medicine",
    serviceDate: "",
    patientState: "",
    facilityState: "",
    cptCodes: "",
    billedAmount: "",
    qpaAmount: "",
  });

  const createMutation = trpc.disputes.create.useMutation({
    onSuccess: (data) => {
      toast.success(`Dispute ${data.referenceNumber} created successfully`);
      navigate(`/disputes/${data.id}`);
    },
    onError: (err) => toast.error(err.message),
  });

  function update(field: keyof FormData, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function canProceed(): boolean {
    if (currentStep === 1) return !!(form.initiatingPartyName && form.respondingPartyName);
    if (currentStep === 2) return !!(form.serviceType && form.serviceDate && form.patientState && form.facilityState);
    if (currentStep === 3) return !!(form.billedAmount);
    return true;
  }

  function handleSubmit() {
    createMutation.mutate({
      initiatingPartyName: form.initiatingPartyName,
      initiatingPartyType: form.initiatingPartyType,
      respondingPartyName: form.respondingPartyName,
      respondingPartyType: form.respondingPartyType,
      serviceType: form.serviceType as any,
      serviceDate: form.serviceDate,
      patientState: form.patientState,
      facilityState: form.facilityState,
      cptCodes: form.cptCodes.split(",").map(c => c.trim()).filter(Boolean),
      billedAmount: form.billedAmount,
      notes: form.qpaAmount ? `QPA: $${form.qpaAmount}` : undefined,
    });
  }

  const progress = ((currentStep - 1) / (STEPS.length - 1)) * 100;

  return (
    <DashboardLayout>
      <div className="p-4 max-w-lg mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-100">
            <Rocket size={18} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">New Dispute Wizard</h1>
            <p className="text-xs text-slate-500">Mobile-optimized step-by-step filing</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            {STEPS.map(step => (
              <div key={step.id} className="flex flex-col items-center gap-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  step.id < currentStep ? "bg-green-500 text-white" :
                  step.id === currentStep ? "bg-blue-600 text-white" :
                  "bg-slate-200 text-slate-400"
                }`}>
                  {step.id < currentStep ? <Check size={14} /> : step.id}
                </div>
                <span className={`text-xs hidden sm:block ${step.id === currentStep ? "text-blue-600 font-medium" : "text-slate-400"}`}>
                  {step.title}
                </span>
              </div>
            ))}
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-xs text-slate-500 text-center">Step {currentStep} of {STEPS.length}: {STEPS[currentStep - 1].description}</div>
        </div>

        {/* Step Content */}
        <Card className="border-slate-200">
          <CardContent className="pt-5 space-y-4">
            {/* Step 1: Parties */}
            {currentStep === 1 && (
              <>
                <SmartFormPanel
                  targetForm="mobile_dispute"
                  triggerLabel="Auto-fill from document"
                  onApply={(fields: Record<string, ExtractedField>) => {
                    if (fields.providerName?.value) update("initiatingPartyName", String(fields.providerName.value));
                    if (fields.payerName?.value) update("respondingPartyName", String(fields.payerName.value));
                    if (fields.serviceDate?.value) update("serviceDate", String(fields.serviceDate.value));
                    if (fields.billedAmount?.value) update("billedAmount", String(fields.billedAmount.value));
                    if (fields.cptCodes?.value) update("cptCodes", String(fields.cptCodes.value));
                    toast.success("SmartForm applied fields from your document.");
                  }}
                />
                <div className="space-y-3">
                  <div className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Building2 size={14} className="text-blue-500" />Initiating Party
                  </div>
                  <Input
                    placeholder="Provider or facility name"
                    value={form.initiatingPartyName}
                    onChange={e => update("initiatingPartyName", e.target.value)}
                    className="text-sm"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    {(["provider", "facility"] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => update("initiatingPartyType", t)}
                        className={`py-2 rounded-lg text-xs font-medium border transition-colors ${form.initiatingPartyType === t ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"}`}
                      >
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-3 space-y-3">
                  <div className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Building2 size={14} className="text-red-400" />Responding Party
                  </div>
                  <Input
                    placeholder="Insurer or payer name"
                    value={form.respondingPartyName}
                    onChange={e => update("respondingPartyName", e.target.value)}
                    className="text-sm"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    {(["payer", "aggregator"] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => update("respondingPartyType", t)}
                        className={`py-2 rounded-lg text-xs font-medium border transition-colors ${form.respondingPartyType === t ? "bg-red-500 text-white border-red-500" : "bg-white text-slate-600 border-slate-200 hover:border-red-300"}`}
                      >
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Step 2: Service */}
            {currentStep === 2 && (
              <>
                <div className="space-y-3">
                  <div className="text-sm font-semibold text-slate-700">Service Type</div>
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {SERVICE_TYPES.map(st => (
                      <button
                        key={st.value}
                        onClick={() => update("serviceType", st.value)}
                        className={`py-2 px-3 rounded-lg text-xs font-medium border text-left transition-colors ${form.serviceType === st.value ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"}`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Service Date</label>
                  <Input type="date" value={form.serviceDate} onChange={e => update("serviceDate", e.target.value)} className="text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Patient State</label>
                    <select value={form.patientState} onChange={e => update("patientState", e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">Select</option>
                      {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Facility State</label>
                    <select value={form.facilityState} onChange={e => update("facilityState", e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">Select</option>
                      {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">CPT Codes (comma-separated)</label>
                  <Input placeholder="e.g. 99285, 71046" value={form.cptCodes} onChange={e => update("cptCodes", e.target.value)} className="text-sm" />
                </div>
              </>
            )}

            {/* Step 3: Financials */}
            {currentStep === 3 && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Billed Amount ($) <span className="text-red-500">*</span></label>
                  <Input type="number" step="0.01" min="0" placeholder="0.00" value={form.billedAmount} onChange={e => update("billedAmount", e.target.value)} className="text-sm text-lg h-12" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Qualifying Payment Amount ($) <span className="text-slate-400 text-xs">(optional)</span></label>
                  <Input type="number" step="0.01" min="0" placeholder="0.00" value={form.qpaAmount} onChange={e => update("qpaAmount", e.target.value)} className="text-sm text-lg h-12" />
                  <p className="text-xs text-slate-400">The median in-network rate for the same or similar service in the same geographic area.</p>
                </div>
                {form.billedAmount && form.qpaAmount && (
                  <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                    <div className="text-xs text-slate-500 mb-1">Dispute Gap</div>
                    <div className="text-lg font-bold text-blue-700">
                      ${(parseFloat(form.billedAmount) - parseFloat(form.qpaAmount)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Step 4: Review */}
            {currentStep === 4 && (
              <div className="space-y-3">
                <div className="text-sm font-semibold text-slate-700">Review Your Dispute</div>
                {[
                  { label: "Initiating Party", value: `${form.initiatingPartyName} (${form.initiatingPartyType})` },
                  { label: "Responding Party", value: `${form.respondingPartyName} (${form.respondingPartyType})` },
                  { label: "Service Type", value: SERVICE_TYPES.find(s => s.value === form.serviceType)?.label ?? form.serviceType },
                  { label: "Service Date", value: form.serviceDate },
                  { label: "Patient State", value: form.patientState },
                  { label: "Facility State", value: form.facilityState },
                  { label: "CPT Codes", value: form.cptCodes || "—" },
                  { label: "Billed Amount", value: form.billedAmount ? `$${parseFloat(form.billedAmount).toLocaleString()}` : "—" },
                  { label: "QPA Amount", value: form.qpaAmount ? `$${parseFloat(form.qpaAmount).toLocaleString()}` : "—" },
                ].map(item => (
                  <div key={item.label} className="flex items-start justify-between gap-2 py-1.5 border-b border-slate-50">
                    <span className="text-xs text-slate-400 shrink-0">{item.label}</span>
                    <span className="text-xs text-slate-700 font-medium text-right">{item.value}</span>
                  </div>
                ))}
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-700">
                  By submitting, you confirm this dispute is filed under the No Surprises Act (NSA) and all information is accurate.
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex gap-3">
          {currentStep > 1 && (
            <Button variant="outline" onClick={() => setCurrentStep(s => s - 1)} className="flex-1">
              <ChevronLeft size={14} className="mr-1" />Back
            </Button>
          )}
          {currentStep < STEPS.length ? (
            <Button onClick={() => setCurrentStep(s => s + 1)} disabled={!canProceed()} className="flex-1">
              Next<ChevronRight size={14} className="ml-1" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            >
              <Rocket size={14} className="mr-2" />
              {createMutation.isPending ? "Submitting..." : "Submit Dispute"}
            </Button>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
