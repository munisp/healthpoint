import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_LOGO, APP_TITLE } from "@/const";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CheckCircle2, LogOut, Scale } from "lucide-react";

const SERVICE_TYPES = [
  { value: "emergency_medicine", label: "Emergency Medicine" },
  { value: "anesthesiology", label: "Anesthesiology" },
  { value: "pathology", label: "Pathology" },
  { value: "radiology", label: "Radiology" },
  { value: "neonatology", label: "Neonatology" },
  { value: "surgery", label: "Surgery" },
  { value: "hospitalist", label: "Hospitalist" },
  { value: "air_ambulance", label: "Air Ambulance" },
  { value: "ground_ambulance", label: "Ground Ambulance" },
  { value: "other", label: "Other" },
];

const PARTY_TYPES = [
  { value: "provider", label: "Provider / Physician" },
  { value: "facility", label: "Facility / Hospital" },
  { value: "payer", label: "Health Plan / Payer" },
  { value: "aggregator", label: "Aggregator" },
];

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

const STEPS = [
  { id: 1, title: "Initiating Party", description: "Who is initiating this IDR dispute?" },
  { id: 2, title: "Responding Party", description: "Who is the responding party (payer or provider)?" },
  { id: 3, title: "Service Details", description: "Describe the healthcare service in dispute" },
  { id: 4, title: "Financial Information", description: "Enter the billed amount and CPT codes" },
  { id: 5, title: "Review & Submit", description: "Review all information before initiating the dispute" },
];

type FormData = {
  initiatingPartyType: string;
  initiatingPartyName: string;
  initiatingPartyNpi: string;
  respondingPartyType: string;
  respondingPartyName: string;
  respondingPartyNpi: string;
  serviceType: string;
  serviceDate: string;
  patientState: string;
  facilityState: string;
  cptCodes: string;
  icd10Codes: string;
  billedAmount: string;
  notes: string;
};

export default function NewDispute() {
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [form, setForm] = useState<FormData>({
    initiatingPartyType: "provider",
    initiatingPartyName: "",
    initiatingPartyNpi: "",
    respondingPartyType: "payer",
    respondingPartyName: "",
    respondingPartyNpi: "",
    serviceType: "emergency_medicine",
    serviceDate: "",
    patientState: "CA",
    facilityState: "CA",
    cptCodes: "",
    icd10Codes: "",
    billedAmount: "",
    notes: "",
  });

  const createMutation = trpc.disputes.create.useMutation({
    onSuccess: (dispute) => {
      toast.success(`Dispute ${dispute.referenceNumber} initiated successfully`);
      navigate(`/disputes/${dispute.id}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const update = (field: keyof FormData, value: string) => setForm(f => ({ ...f, [field]: value }));

  const canProceed = () => {
    if (currentStep === 1) return form.initiatingPartyName.trim().length > 0;
    if (currentStep === 2) return form.respondingPartyName.trim().length > 0;
    if (currentStep === 3) return form.serviceDate && form.patientState && form.facilityState;
    if (currentStep === 4) return form.billedAmount && form.cptCodes.trim().length > 0;
    return true;
  };

  const handleSubmit = () => {
    const cptArray = form.cptCodes.split(",").map(c => c.trim()).filter(Boolean);
    const icd10Array = form.icd10Codes.split(",").map(c => c.trim()).filter(Boolean);
    createMutation.mutate({
      initiatingPartyType: form.initiatingPartyType as any,
      initiatingPartyName: form.initiatingPartyName,
      initiatingPartyNpi: form.initiatingPartyNpi || undefined,
      respondingPartyType: form.respondingPartyType as any,
      respondingPartyName: form.respondingPartyName || undefined,
      respondingPartyNpi: form.respondingPartyNpi || undefined,
      serviceType: form.serviceType as any,
      serviceDate: new Date(form.serviceDate).toISOString(),
      patientState: form.patientState,
      facilityState: form.facilityState,
      cptCodes: cptArray,
      icd10Codes: icd10Array.length > 0 ? icd10Array : undefined,
      billedAmount: form.billedAmount,
      notes: form.notes || undefined,
    });
  };

  const Field = ({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) => (
    <div>
      <label className="block text-sm font-medium text-slate-600 mb-1.5">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      {children}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 h-14 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <img src={APP_LOGO} className="h-8 w-8 rounded-lg object-cover" alt="logo" />
          <span className="text-lg font-bold text-slate-800">{APP_TITLE}</span>
        </div>
        <nav className="flex items-center gap-4">
          <button onClick={() => navigate("/disputes")} className="text-sm text-slate-600 hover:text-blue-600">← Disputes</button>
          <span className="text-sm text-slate-600">{user?.name}</span>
          <Button variant="outline" size="sm" onClick={logout}><LogOut size={14} /></Button>
        </nav>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {/* Page title */}
        <div className="flex items-center gap-3 mb-8">
          <button onClick={() => navigate("/disputes")} className="text-slate-400 hover:text-slate-600">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Initiate IDR Dispute</h1>
            <p className="text-sm text-slate-500">NSA Federal Independent Dispute Resolution Process</p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center gap-2 flex-1">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold shrink-0 transition-colors ${
                step.id < currentStep ? "bg-green-500 text-white" :
                step.id === currentStep ? "bg-blue-600 text-white" :
                "bg-slate-200 text-slate-500"
              }`}>
                {step.id < currentStep ? <CheckCircle2 size={16} /> : step.id}
              </div>
              <span className={`text-xs font-medium hidden sm:block ${step.id === currentStep ? "text-blue-600" : step.id < currentStep ? "text-green-600" : "text-slate-400"}`}>
                {step.title}
              </span>
              {index < STEPS.length - 1 && <div className="flex-1 h-0.5 bg-slate-200 mx-1" />}
            </div>
          ))}
        </div>

        <Card className="border-slate-200">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold text-slate-800">
              Step {currentStep}: {STEPS[currentStep - 1].title}
            </CardTitle>
            <p className="text-sm text-slate-500">{STEPS[currentStep - 1].description}</p>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Step 1: Initiating Party */}
            {currentStep === 1 && (
              <>
                <Field label="Party Type" required>
                  <select value={form.initiatingPartyType} onChange={e => update("initiatingPartyType", e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {PARTY_TYPES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </Field>
                <Field label="Party Name" required>
                  <Input value={form.initiatingPartyName} onChange={e => update("initiatingPartyName", e.target.value)}
                    placeholder="e.g., Acme Emergency Medicine Group" />
                </Field>
                <Field label="NPI Number (if applicable)">
                  <Input value={form.initiatingPartyNpi} onChange={e => update("initiatingPartyNpi", e.target.value)}
                    placeholder="10-digit NPI" maxLength={10} />
                </Field>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
                  <strong>NSA Requirement:</strong> The initiating party must have previously attempted open negotiation with the responding party before filing for federal IDR.
                </div>
              </>
            )}

            {/* Step 2: Responding Party */}
            {currentStep === 2 && (
              <>
                <Field label="Party Type" required>
                  <select value={form.respondingPartyType} onChange={e => update("respondingPartyType", e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {PARTY_TYPES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </Field>
                <Field label="Party Name" required>
                  <Input value={form.respondingPartyName} onChange={e => update("respondingPartyName", e.target.value)}
                    placeholder="e.g., BlueCross BlueShield of Texas" />
                </Field>
                <Field label="NPI Number (if applicable)">
                  <Input value={form.respondingPartyNpi} onChange={e => update("respondingPartyNpi", e.target.value)}
                    placeholder="10-digit NPI" maxLength={10} />
                </Field>
              </>
            )}

            {/* Step 3: Service Details */}
            {currentStep === 3 && (
              <>
                <Field label="Service Type" required>
                  <select value={form.serviceType} onChange={e => update("serviceType", e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {SERVICE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </Field>
                <Field label="Date of Service" required>
                  <Input type="date" value={form.serviceDate} onChange={e => update("serviceDate", e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Patient State" required>
                    <select value={form.patientState} onChange={e => update("patientState", e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Field>
                  <Field label="Facility State" required>
                    <select value={form.facilityState} onChange={e => update("facilityState", e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Field>
                </div>
              </>
            )}

            {/* Step 4: Financial */}
            {currentStep === 4 && (
              <>
                <Field label="Billed Amount ($)" required>
                  <Input type="number" step="0.01" min="0" value={form.billedAmount} onChange={e => update("billedAmount", e.target.value)}
                    placeholder="0.00" />
                </Field>
                <Field label="CPT Codes (comma-separated)" required>
                  <Input value={form.cptCodes} onChange={e => update("cptCodes", e.target.value)}
                    placeholder="e.g., 99285, 99291, 36556" />
                  <p className="text-xs text-slate-400 mt-1">Enter all CPT codes associated with the disputed service</p>
                </Field>
                <Field label="ICD-10 Codes (comma-separated)">
                  <Input value={form.icd10Codes} onChange={e => update("icd10Codes", e.target.value)}
                    placeholder="e.g., I21.9, J18.9" />
                </Field>
                <Field label="Notes">
                  <textarea value={form.notes} onChange={e => update("notes", e.target.value)} rows={3}
                    placeholder="Any additional context about this dispute..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                </Field>
              </>
            )}

            {/* Step 5: Review */}
            {currentStep === 5 && (
              <div className="space-y-4">
                <div className="bg-slate-50 rounded-lg p-4 space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Initiating Party", value: `${form.initiatingPartyName} (${form.initiatingPartyType})` },
                      { label: "Responding Party", value: `${form.respondingPartyName} (${form.respondingPartyType})` },
                      { label: "Service Type", value: SERVICE_TYPES.find(s => s.value === form.serviceType)?.label },
                      { label: "Date of Service", value: form.serviceDate ? new Date(form.serviceDate).toLocaleDateString() : "—" },
                      { label: "Patient State", value: form.patientState },
                      { label: "Facility State", value: form.facilityState },
                      { label: "Billed Amount", value: `$${Number(form.billedAmount).toLocaleString()}` },
                      { label: "CPT Codes", value: form.cptCodes },
                    ].map(item => (
                      <div key={item.label}>
                        <div className="text-xs text-slate-400">{item.label}</div>
                        <div className="font-medium text-slate-700">{item.value || "—"}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                  <strong>Important:</strong> By submitting this dispute, you certify that open negotiation was attempted and failed within the required 30-business-day period per 45 CFR §149.510. Submitting a false IDR request may result in penalties.
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => currentStep === 1 ? navigate("/disputes") : setCurrentStep(s => s - 1)}
                className="flex items-center gap-2">
                <ArrowLeft size={14} />{currentStep === 1 ? "Cancel" : "Back"}
              </Button>
              {currentStep < 5 ? (
                <Button onClick={() => setCurrentStep(s => s + 1)} disabled={!canProceed()} className="flex items-center gap-2">
                  Next <ArrowRight size={14} />
                </Button>
              ) : (
                <Button onClick={handleSubmit} disabled={createMutation.isPending} className="flex items-center gap-2 bg-green-600 hover:bg-green-700">
                  <Scale size={14} />
                  {createMutation.isPending ? "Initiating..." : "Initiate IDR Dispute"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
