/**
 * /disputes/new — Phase9-FE complete new-dispute wizard (5 steps).
 * Carried forward intact from the dashboard module — see git history for
 * pre-restructure context.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import DisputeCompleteness, { parseGateMissingFields } from "@/components/DisputeCompleteness";
import SmartFormPanel from "@/components/SmartFormPanel";
import PrefillReviewBanner from "@/components/PrefillReviewBanner";
import {
  KeystrokeTracker,
  buildPrefillTerminalEvents,
  type PrefilledField,
} from "@/lib/feedback";
import {
  CheckCircle2, ChevronRight, ChevronLeft, Plus, Trash2,
  AlertTriangle, DollarSign, FileText, User, MapPin, Zap, Database
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVICE_TYPES = [
  { value: "EMERGENCY", label: "Emergency Services" },
  { value: "NON_EMERGENCY_ANCILLARY", label: "Non-Emergency Ancillary" },
  { value: "NON_EMERGENCY_NON_ANCILLARY", label: "Non-Emergency Non-Ancillary" },
  { value: "AIR_AMBULANCE", label: "Air Ambulance" },
] as const;

/** Phase 21 (S2a): EMR extracted field (snake_case) → form field key. Shared
 *  by the eager prefill path and the manual "Extract & Populate" button. */
const EMR_FIELD_MAP: Record<string, keyof FormData> = {
  initiating_party_name: "initiatingPartyName",
  initiating_party_type: "initiatingPartyType",
  responding_party_name: "respondingPartyName",
  responding_party_type: "respondingPartyType",
  service_type: "serviceType",
  service_date: "serviceDate",
  patient_state: "patientState",
  facility_state: "facilityState",
  billed_amount: "billedAmount",
  cpt_codes: "cptCodes",
  icd10_codes: "icd10Codes",
  initiating_party_npi: "initiatingPartyNpi",
};

const PARTY_TYPES = [
  { value: "provider", label: "Provider / Facility" },
  { value: "provider_group", label: "Provider Group" },
  { value: "health_plan", label: "Health Plan / Issuer" },
  { value: "tpa", label: "Third-Party Administrator" },
] as const;

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY",
];

const STEPS = [
  { id: 1, label: "Parties", icon: User },
  { id: 2, label: "Service Details", icon: MapPin },
  { id: 3, label: "Line Items", icon: DollarSign },
  { id: 4, label: "Documents & Negotiation", icon: FileText },
  { id: 5, label: "Review & Submit", icon: CheckCircle2 },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type LineItem = { cptCode: string; icd10Codes: string; billedAmount: string; quantity: string };

type FormData = {
  initiatingPartyName: string;
  initiatingPartyType: string;
  respondingPartyName: string;
  respondingPartyType: string;
  patientFirstName: string;
  patientLastName: string;
  serviceType: string;
  serviceDate: string;
  facilityName: string;
  patientState: string;
  facilityState: string;
  billedAmount: string;
  cptCodes: string;
  icd10Codes: string;
  initiatingPartyNpi: string;
  initiatingPartyTin: string;
  priorNegotiationNotes: string;
  openNegotiationStartDate: string;
  openNegotiationEndDate: string;
  lineItems: LineItem[];
};

const EMPTY: FormData = {
  initiatingPartyName: "", initiatingPartyType: "provider",
  respondingPartyName: "", respondingPartyType: "health_plan",
  patientFirstName: "", patientLastName: "",
  serviceType: "EMERGENCY", serviceDate: "",
  facilityName: "", patientState: "", facilityState: "",
  billedAmount: "", cptCodes: "", icd10Codes: "",
  initiatingPartyNpi: "", initiatingPartyTin: "",
  priorNegotiationNotes: "",
  openNegotiationStartDate: "", openNegotiationEndDate: "",
  lineItems: [{ cptCode: "", icd10Codes: "", billedAmount: "", quantity: "1" }],
};

// ─── Draft persistence hook ───────────────────────────────────────────────────

function useDraft() {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Phase 21: keystroke/prefill tracking refs (declared before `update`).
  const keystrokeTrackerRef = useRef(new KeystrokeTracker());
  const prefilledFieldsRef = useRef<PrefilledField[]>([]);
  const utils = trpc.useUtils();
  const { data: draftData } = trpc.disputes.getDraft.useQuery();
  const saveMutation = trpc.disputes.saveDraft.useMutation();
  const deleteDraftMutation = trpc.disputes.deleteDraft.useMutation();
  const draftId = draftData?.draft?.id ?? null;

  const scheduleSave = useCallback((currentStep: number, formData: FormData) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveMutation.mutate({ step: currentStep, data: formData });
    }, 1500);
  }, [saveMutation]);

  return { draftData, draftId, scheduleSave, deleteDraftMutation };
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-between mb-8">
      {STEPS.map((s, idx) => (
        <div key={s.id} className="flex items-center flex-1">
          <div className="flex flex-col items-center flex-shrink-0">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors ${
              current > s.id ? "bg-blue-600 border-blue-600 text-white" :
              current === s.id ? "border-blue-600 text-blue-600 bg-blue-50" :
              "border-slate-300 text-slate-400"
            }`}>
              {current > s.id ? <CheckCircle2 size={18} /> : s.id}
            </div>
            <span className={`text-xs mt-1 font-medium hidden sm:block ${
              current === s.id ? "text-blue-600" : current > s.id ? "text-slate-600" : "text-slate-400"
            }`}>{s.label}</span>
          </div>
          {idx < STEPS.length - 1 && (
            <div className={`flex-1 h-0.5 mx-1 mb-4 sm:mb-4 ${current > s.id ? "bg-blue-600" : "bg-slate-200"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Field component ──────────────────────────────────────────────────────────

function Field({ label, required, error, children, hint, emrConfidence, emrSource }: {
  label: string; required?: boolean; error?: string; children: React.ReactNode; hint?: string;
  emrConfidence?: number; emrSource?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-sm font-medium text-slate-700">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        {emrConfidence !== undefined && (
          <span
            className="ml-2 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700"
            title={emrSource ? `Extracted from ${emrSource}` : "Extracted from EMR"}
          >
            EMR {Math.round(emrConfidence * 100)}%
          </span>
        )}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-slate-400">{hint}</p>}
      {error && <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle size={12} />{error}</p>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NewDispute() {
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [showEMRPull, setShowEMRPull] = useState(false);
  const [emrPullResult, setEMRPullResult] = useState<{
    patient?: { firstName?: string; lastName?: string } | null;
    extractedData: Record<string, string | null>;
    fieldConfidence: Record<string, number>;
    fieldSource?: Record<string, string>;
    summary: { fieldsExtracted: number; fieldsEmpty: number };
    message: string;
  } | null>(null);
  const [selectedEMRId, setSelectedEMRId] = useState("");
  const [emrPatientId, setEMRPatientId] = useState("");
  const [emrClaimId, setEMRClaimId] = useState("");
  const { draftData, draftId, scheduleSave, deleteDraftMutation } = useDraft();

  // Restore draft on mount
  useEffect(() => {
    if (draftData?.draft && !draftRestored) {
      const { step, data } = draftData.draft;
      if (step > 0 && Object.keys(data as object).length > 0) {
        setForm(data as FormData);
        setCurrentStep(Math.min(step, 5));
        toast.info(`Draft restored from step ${step}`, { duration: 3000 });
      }
      setDraftRestored(true);
    }
  }, [draftData, draftRestored]);

  const update = useCallback((field: keyof FormData, value: string) => {
    // Phase 21: count keystrokes on prefilled fields (presented→terminal).
    if (prefilledFieldsRef.current.some(f => f.formKey === field)) {
      keystrokeTrackerRef.current.increment(field);
    }
    setForm(prev => {
      const next = { ...prev, [field]: value };
      scheduleSave(currentStep, next);
      return next;
    });
  }, [currentStep, scheduleSave]);

  const updateLineItem = useCallback((idx: number, field: keyof LineItem, value: string) => {
    setForm(prev => {
      const items = [...prev.lineItems];
      items[idx] = { ...items[idx], [field]: value };
      scheduleSave(currentStep, { ...prev, lineItems: items });
      return { ...prev, lineItems: items };
    });
  }, [currentStep, scheduleSave]);

  const addLineItem = () => setForm(prev => ({
    ...prev,
    lineItems: [...prev.lineItems, { cptCode: "", icd10Codes: "", billedAmount: "", quantity: "1" }],
  }));

  const removeLineItem = (idx: number) => setForm(prev => ({
    ...prev,
    lineItems: prev.lineItems.filter((_, i) => i !== idx),
  }));

  // ─── Validation ─────────────────────────────────────────────────────────────

  const validate = (step: number): boolean => {
    const e: Record<string, string> = {};
    if (step === 1) {
      if (!form.initiatingPartyName.trim()) e.initiatingPartyName = "Initiating party name is required";
      if (!form.respondingPartyName.trim()) e.respondingPartyName = "Responding party (health plan) name is required";
    }
    if (step === 2) {
      if (!form.serviceType) e.serviceType = "Service type is required";
      if (!form.serviceDate) e.serviceDate = "Service date is required";
      if (!form.patientState) e.patientState = "Patient state is required";
      if (!form.facilityState) e.facilityState = "Facility state is required";
    }
    if (step === 3) {
      if (!form.billedAmount || isNaN(Number(form.billedAmount)) || Number(form.billedAmount) <= 0)
        e.billedAmount = "Valid billed amount is required";
      if (!form.cptCodes.trim()) e.cptCodes = "At least one CPT/HCPCS code is required";
      form.lineItems.forEach((li, i) => {
        if (li.cptCode && (!li.billedAmount || isNaN(Number(li.billedAmount))))
          e[`li_${i}_amount`] = "Line item amount required";
      });
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ─── EMR Data Pull ──────────────────────────────────────────────────────────

  const { data: emrConnections } = trpc.emr.listConnections.useQuery(undefined, { enabled: isAuthenticated });
  const { data: emrPatients } = trpc.emr.queryPatients.useQuery(
    { connectionId: selectedEMRId },
    { enabled: !!selectedEMRId }
  );

  const emrPullMutation = trpc.ai.pullDisputeData.useMutation({
    onSuccess: (result) => {
      setEMRPullResult(result);
      // Auto-populate form fields from extracted data
      const d = result.extractedData;
      if (d.initiating_party_name) update("initiatingPartyName", d.initiating_party_name);
      if (d.initiating_party_type) update("initiatingPartyType", d.initiating_party_type);
      if (d.responding_party_name) update("respondingPartyName", d.responding_party_name);
      if (d.responding_party_type) update("respondingPartyType", d.responding_party_type);
      if (d.service_type) update("serviceType", d.service_type);
      if (d.service_date) update("serviceDate", d.service_date);
      if (d.patient_state) update("patientState", d.patient_state);
      if (d.facility_state) update("facilityState", d.facility_state);
      if (d.billed_amount) update("billedAmount", d.billed_amount);
      if (d.cpt_codes) update("cptCodes", d.cpt_codes);
      if (d.icd10_codes) update("icd10Codes", d.icd10_codes);
      if (d.initiating_party_npi) update("initiatingPartyNpi", d.initiating_party_npi);
      if (result.patient?.firstName) update("patientFirstName", result.patient.firstName);
      if (result.patient?.lastName) update("patientLastName", result.patient.lastName);
      toast.success(`Extracted ${result.summary.fieldsExtracted} fields from EMR — review and adjust before submitting.`, { duration: 4000 });
    },
    onError: (err) => {
      toast.error(`EMR pull failed: ${err.message}`);
    },
  });

  const activeEMRConnections = (emrConnections ?? []).filter((c: any) => c.status === "active");

  // ─── Phase 21 (S2a): eager prefill ────────────────────────────────────────
  // On entering the wizard with EMR context (single active connection is
  // auto-selected; patient/claim selection triggers a re-prefill), call
  // prefill.dispute EAGERLY. The server records `presented` suggestion
  // events; the client records terminal accepted/edited events on submit.
  // The manual "Extract & Populate Fields" button below remains as fallback.
  const { data: myOrgs } = trpc.orgs.listMine.useQuery(undefined, { staleTime: 60_000 });
  const prefillOrgId = myOrgs?.[0]?.orgId ?? null;
  const [prefillAppliedKey, setPrefillAppliedKey] = useState<string | null>(null);
  const [prefilledFields, setPrefilledFields] = useState<PrefilledField[]>([]);
  const [prefillMeta, setPrefillMeta] = useState<{ suggestionId: string; modelName: string } | null>(null);

  const setPrefilled = (fields: PrefilledField[]) => {
    prefilledFieldsRef.current = fields;
    setPrefilledFields(fields);
  };

  // Auto-select when exactly one active EMR connection exists (eager entry).
  useEffect(() => {
    if (!selectedEMRId && activeEMRConnections.length === 1) {
      setSelectedEMRId(activeEMRConnections[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emrConnections]);

  const selectedEMRConn = activeEMRConnections.find((c: any) => c.id === selectedEMRId);
  const prefillQueryKey = prefillOrgId && selectedEMRConn
    ? `${prefillOrgId}|${selectedEMRId}|${emrPatientId}|${emrClaimId}`
    : null;
  const prefillQ = trpc.prefill.dispute.useQuery(
    {
      orgId: prefillOrgId!,
      connectionId: selectedEMRId,
      emrSystem: (selectedEMRConn as any)?.emrSystem ?? "",
      patientId: emrPatientId || undefined,
      claimId: emrClaimId || undefined,
      dateOfService: form.serviceDate || undefined,
    },
    {
      enabled: !!prefillQueryKey && prefillAppliedKey !== prefillQueryKey,
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
    },
  );

  useEffect(() => {
    const result = prefillQ.data;
    if (!result || !prefillQueryKey || prefillAppliedKey === prefillQueryKey) return;
    setPrefillAppliedKey(prefillQueryKey);
    setEMRPullResult(result);
    const d = (result.extractedData ?? {}) as Record<string, unknown>;
    const applied: PrefilledField[] = [];
    for (const [sourceField, formKey] of Object.entries(EMR_FIELD_MAP)) {
      const v = d[sourceField];
      if (v === null || v === undefined || v === "") continue;
      const sv = String(v);
      update(formKey, sv);
      applied.push({
        formKey,
        sourceField,
        suggestedValue: sv,
        suggestedValueHash: result.suggestedValueHashes?.[sourceField] ?? null,
        confidence: result.fieldConfidence?.[sourceField] ?? null,
      });
    }
    if (applied.length > 0) {
      keystrokeTrackerRef.current = new KeystrokeTracker();
      setPrefilled(applied);
      setPrefillMeta({ suggestionId: result.suggestionId, modelName: result.modelName });
      toast.info(`Prefilled ${applied.length} fields from EMR — please review before submitting.`, { duration: 4000 });
    } else if (result.fieldsExtracted === 0) {
      // Honest no-prefill state: nothing extracted for this context.
      setPrefilled([]);
      setPrefillMeta(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillQ.data, prefillQueryKey]);

  const feedbackRecord = trpc.feedback.record.useMutation();

  // ─── Submit ──────────────────────────────────────────────────────────────────

  const createMutation = trpc.disputes.create.useMutation({
    onSuccess: async (dispute) => {
      // Phase 21 (S1): terminal suggestion events for prefilled fields.
      // Untouched-confirmed => "accepted"; user-changed => "edited". Values
      // are hashed client-side; fire-and-forget (never blocks navigation).
      const pf = prefilledFieldsRef.current;
      if (pf.length > 0 && prefillMeta && prefillOrgId) {
        const latencyMs = keystrokeTrackerRef.current.dwellMs();
        void buildPrefillTerminalEvents(pf, form as unknown as Record<string, string>, keystrokeTrackerRef.current)
          .then(events => {
            for (const ev of events) {
              feedbackRecord.mutate({
                orgId: prefillOrgId,
                suggestionId: prefillMeta.suggestionId,
                surface: "new_dispute_prefill",
                action: ev.action,
                modelName: prefillMeta.modelName,
                confidence: ev.confidence ?? undefined,
                fieldName: ev.fieldName,
                suggestedValueHash: ev.suggestedValueHash ?? undefined,
                finalValueHash: ev.finalValueHash ?? undefined,
                keystrokeCount: ev.keystrokeCount,
                latencyMs,
                metadata: { disputeId: dispute.id },
              });
            }
          })
          .catch(() => { /* telemetry must never block submission */ });
      }
      // Delete the draft after successful submission
      await deleteDraftMutation.mutateAsync();
      setSubmitted(true);
      toast.success("Dispute created — entering open negotiation (30 business days per NSA)", { duration: 4000 });
      setTimeout(() => navigate(`/disputes/${dispute.id}`), 1200);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const handleSubmit = () => {
    if (!validate(3)) { setCurrentStep(3); return; }
    createMutation.mutate({
      initiatingPartyName: form.initiatingPartyName,
      initiatingPartyType: form.initiatingPartyType as "provider" | "provider_group" | "health_plan" | "tpa",
      respondingPartyName: form.respondingPartyName,
      respondingPartyType: form.respondingPartyType as "provider" | "provider_group" | "health_plan" | "tpa",
      patientFirstName: form.patientFirstName || undefined,
      patientLastName: form.patientLastName || undefined,
      serviceType: form.serviceType as "EMERGENCY" | "NON_EMERGENCY_ANCILLARY" | "NON_EMERGENCY_NON_ANCILLARY" | "AIR_AMBULANCE",
      serviceDate: form.serviceDate,
      facilityName: form.facilityName || undefined,
      patientState: form.patientState,
      facilityState: form.facilityState,
      billedAmount: form.billedAmount,
      cptCodes: form.cptCodes.split(",").map(c => c.trim()).filter(Boolean),
      icd10Codes: form.icd10Codes ? form.icd10Codes.split(",").map(c => c.trim()).filter(Boolean) : undefined,
      initiatingPartyNpi: form.initiatingPartyNpi || undefined,
      initiatingPartyTin: form.initiatingPartyTin || undefined,
      priorNegotiationNotes: form.priorNegotiationNotes || undefined,
      openNegotiationStartDate: form.openNegotiationStartDate || undefined,
      openNegotiationEndDate: form.openNegotiationEndDate || undefined,
      lineItems: form.lineItems
        .filter(li => li.cptCode && li.billedAmount)
        .map(li => ({
          cptCode: li.cptCode,
          icd10Codes: li.icd10Codes ? li.icd10Codes.split(",").map(c => c.trim()).filter(Boolean) : undefined,
          billedAmount: li.billedAmount,
          quantity: li.quantity ? parseInt(li.quantity) : 1,
        })),
    });
  };

  const totalBilled = form.lineItems.reduce((s, li) => s + (parseFloat(li.billedAmount) || 0) * (parseInt(li.quantity) || 1), 0);

  // Gate missing fields from the last create failure — drives DisputeCompleteness
  // deep links without inventing any field list client-side.
  const gateMissingFields = parseGateMissingFields(createMutation.error?.message);

  if (submitted) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
      <CheckCircle2 size={48} className="text-green-500" />
      <h2 className="text-xl font-bold text-slate-800">Dispute Submitted</h2>
      <p className="text-slate-500">Open negotiation period started (30 business days per NSA §2799A-1)</p>
      <p className="text-sm text-slate-400">Redirecting to dispute detail…</p>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Initiate IDR Dispute</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Federal No Surprises Act — 45 CFR §149.510 · Open negotiation must precede IDR
          </p>
        </div>
        {draftId && (
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <CheckCircle2 size={12} className="text-green-500" />Draft saved
          </span>
        )}
      </div>

      <StepIndicator current={currentStep} />

      {/* Smart Form Panel — adaptive assistance */}
      <SmartFormPanel
        formData={{
          serviceType: form.serviceType,
          patientState: form.patientState,
          facilityState: form.facilityState,
          serviceDate: form.serviceDate,
          billedAmount: form.billedAmount,
          cptCodes: form.cptCodes,
          openNegotiationStartDate: form.openNegotiationStartDate,
          openNegotiationEndDate: form.openNegotiationEndDate,
        }}
      />

      {/* Server-side completeness (authoritative field list) */}
      <div className="flex justify-end">
        <DisputeCompleteness
          mode="new"
          fields={{
            initiatingPartyName: form.initiatingPartyName,
            respondingPartyName: form.respondingPartyName,
            serviceType: form.serviceType,
            serviceDate: form.serviceDate,
            patientState: form.patientState,
            facilityState: form.facilityState,
            billedAmount: form.billedAmount,
            cptCodes: form.cptCodes.split(",").map(c => c.trim()).filter(Boolean),
            icd10Codes: form.icd10Codes ? form.icd10Codes.split(",").map(c => c.trim()).filter(Boolean) : undefined,
            initiatingPartyNpi: form.initiatingPartyNpi || undefined,
            initiatingPartyTin: form.initiatingPartyTin || undefined,
            openNegotiationStartDate: form.openNegotiationStartDate || undefined,
            openNegotiationEndDate: form.openNegotiationEndDate || undefined,
          }}
          serverMissingFields={gateMissingFields}
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        {/* Phase 21 (S2a): eager-prefill review banner */}
        <PrefillReviewBanner fields={prefilledFields} modelName={prefillMeta?.modelName ?? null} />
        {/* EMR Pull Panel */}
        <div className="mb-6 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 overflow-hidden">
          <button
            onClick={() => setShowEMRPull(p => !p)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <div className="flex items-center gap-2">
              <Database size={16} className="text-blue-600" />
              <span className="text-sm font-semibold text-blue-800">Pull from EMR</span>
              {emrPullResult && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                  {emrPullResult.summary.fieldsExtracted} fields extracted
                </span>
              )}
            </div>
            <span className="text-xs text-blue-600">{showEMRPull ? "Hide" : "Show"}</span>
          </button>

          {showEMRPull && (
            <div className="px-4 pb-4 space-y-3 border-t border-blue-100">
              {activeEMRConnections.length === 0 ? (
                <p className="text-sm text-blue-700 pt-3">
                  No active EMR connections.{" "}
                  <button className="underline font-medium" onClick={() => navigate("/emr/connect")}>Connect an EMR system</button>
                  {" "}to auto-populate dispute data.
                </p>
              ) : (
                <div className="pt-3 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs text-blue-700">EMR Connection</Label>
                      <select
                        value={selectedEMRId}
                        onChange={e => { setSelectedEMRId(e.target.value); setEMRPatientId(""); }}
                        className="w-full mt-1 px-2 py-1.5 text-sm border border-blue-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Select connection…</option>
                        {activeEMRConnections.map((c: any) => (
                          <option key={c.id} value={c.id}>{c.emrSystem} — {c.facilityName || c.id}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs text-blue-700">Patient</Label>
                      <select
                        value={emrPatientId}
                        onChange={e => setEMRPatientId(e.target.value)}
                        disabled={!selectedEMRId}
                        className="w-full mt-1 px-2 py-1.5 text-sm border border-blue-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                      >
                        <option value="">Select patient…</option>
                        {(emrPatients ?? []).map((p: any) => (
                          <option key={p.id} value={p.id}>{p.firstName} {p.lastName} {p.mrn ? `(MRN: ${p.mrn})` : ""}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs text-blue-700">Claim ID (optional)</Label>
                      <Input
                        value={emrClaimId}
                        onChange={e => setEMRClaimId(e.target.value)}
                        placeholder="e.g. CLM-001"
                        className="mt-1 text-sm border-blue-200 bg-white"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        if (!selectedEMRId) { toast.error("Select an EMR connection first"); return; }
                        emrPullMutation.mutate({
                          connectionId: selectedEMRId,
                          emrSystem: activeEMRConnections.find((c: any) => c.id === selectedEMRId)?.emrSystem ?? "",
                          patientId: emrPatientId || undefined,
                          claimId: emrClaimId || undefined,
                        });
                      }}
                      disabled={emrPullMutation.isPending || !selectedEMRId}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      <Zap size={14} className="mr-1" />
                      {emrPullMutation.isPending ? "Extracting…" : "Extract & Populate Fields"}
                    </Button>
                    <p className="text-xs text-blue-600">
                      Fields with a blue <span className="px-1 py-0.5 rounded bg-blue-100 font-medium">EMR %</span> badge were auto-extracted. Always review before submitting.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Step 1: Parties ── */}
        {currentStep === 1 && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-slate-800">Parties to the Dispute</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Initiating Party Name" required error={errors.initiatingPartyName}
                hint="Your practice, facility, or organization name"
                emrConfidence={emrPullResult?.fieldConfidence?.initiating_party_name}
                emrSource={emrPullResult?.fieldSource?.initiating_party_name}>
                <Input value={form.initiatingPartyName} onChange={e => update("initiatingPartyName", e.target.value)}
                  placeholder="e.g., Riverside Emergency Physicians LLC" />
              </Field>
              <Field label="Initiating Party Type" required>
                <select value={form.initiatingPartyType} onChange={e => update("initiatingPartyType", e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {PARTY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Responding Party (Health Plan) Name" required error={errors.respondingPartyName}
                hint="The insurance company or health plan"
                emrConfidence={emrPullResult?.fieldConfidence?.responding_party_name}
                emrSource={emrPullResult?.fieldSource?.responding_party_name}>
                <Input value={form.respondingPartyName} onChange={e => update("respondingPartyName", e.target.value)}
                  placeholder="e.g., Aetna Health Inc." />
              </Field>
              <Field label="Responding Party Type" required>
                <select value={form.respondingPartyType} onChange={e => update("respondingPartyType", e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {PARTY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="NPI (Initiating Party)" hint="10-digit National Provider Identifier (optional)"
                emrConfidence={emrPullResult?.fieldConfidence?.initiating_party_npi}
                emrSource={emrPullResult?.fieldSource?.initiating_party_npi}>
                <Input value={form.initiatingPartyNpi} onChange={e => update("initiatingPartyNpi", e.target.value)}
                  placeholder="1234567890" maxLength={10} />
              </Field>
              <Field label="TIN (Initiating Party)" hint="Tax ID — required for certified IDR entity payment processing">
                <Input value={form.initiatingPartyTin} onChange={e => update("initiatingPartyTin", e.target.value)}
                  placeholder="12-3456789" maxLength={10} />
              </Field>
            </div>
          </div>
        )}

        {/* ── Step 2: Service Details ── */}
        {currentStep === 2 && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-slate-800">Service Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Service Type" required error={errors.serviceType}>
                <select value={form.serviceType} onChange={e => update("serviceType", e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {SERVICE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Service Date" required error={errors.serviceDate}
                emrConfidence={emrPullResult?.fieldConfidence?.service_date}
                emrSource={emrPullResult?.fieldSource?.service_date}>
                <Input type="date" value={form.serviceDate} onChange={e => update("serviceDate", e.target.value)} />
              </Field>
              <Field label="Patient First Name" hint="PHI — stored encrypted at rest">
                <Input value={form.patientFirstName} onChange={e => update("patientFirstName", e.target.value)} placeholder="Jane" />
              </Field>
              <Field label="Patient Last Name" hint="PHI — stored encrypted at rest">
                <Input value={form.patientLastName} onChange={e => update("patientLastName", e.target.value)} placeholder="Doe" />
              </Field>
              <Field label="Facility Name" hint="Where the service was rendered">
                <Input value={form.facilityName} onChange={e => update("facilityName", e.target.value)}
                  placeholder="e.g., Riverside General Hospital" />
              </Field>
              <Field label="Patient State" required error={errors.patientState}
                emrConfidence={emrPullResult?.fieldConfidence?.patient_state}
                emrSource={emrPullResult?.fieldSource?.patient_state}>
                <select value={form.patientState} onChange={e => update("patientState", e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select state…</option>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Facility State" required error={errors.facilityState}
                hint="Determines federal vs. state IDR process jurisdiction"
                emrConfidence={emrPullResult?.fieldConfidence?.facility_state}
                emrSource={emrPullResult?.fieldSource?.facility_state}>
                <select value={form.facilityState} onChange={e => update("facilityState", e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select state…</option>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
          </div>
        )}

        {/* ── Step 3: Line Items ── */}
        {currentStep === 3 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">Billing Information</h2>
              <div className="text-sm text-slate-600">
                Total billed: <span className="font-bold text-slate-800">${totalBilled.toFixed(2)}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Total Billed Amount ($)" required error={errors.billedAmount}
                hint="The full amount billed to the health plan"
                emrConfidence={emrPullResult?.fieldConfidence?.billed_amount}
                emrSource={emrPullResult?.fieldSource?.billed_amount}>
                <Input type="number" min="0" step="0.01" value={form.billedAmount}
                  onChange={e => update("billedAmount", e.target.value)} placeholder="0.00" />
              </Field>
              <Field label="CPT / HCPCS Codes" required error={errors.cptCodes}
                hint="Comma-separated, e.g., 99285, 99291"
                emrConfidence={emrPullResult?.fieldConfidence?.cpt_codes}
                emrSource={emrPullResult?.fieldSource?.cpt_codes}>
                <Input value={form.cptCodes} onChange={e => update("cptCodes", e.target.value)}
                  placeholder="99285, 99291" />
              </Field>
              <Field label="ICD-10 Diagnosis Codes" hint="Comma-separated (optional)"
                emrConfidence={emrPullResult?.fieldConfidence?.icd10_codes}
                emrSource={emrPullResult?.fieldSource?.icd10_codes}>
                <Input value={form.icd10Codes} onChange={e => update("icd10Codes", e.target.value)}
                  placeholder="R07.9, I10" />
              </Field>
            </div>

            {/* Line Items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">Line Items (optional)</h3>
                <Button type="button" variant="outline" size="sm" onClick={addLineItem}
                  className="flex items-center gap-1 text-xs">
                  <Plus size={12} />Add Line Item
                </Button>
              </div>
              {form.lineItems.map((li, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end p-3 bg-slate-50 rounded-lg">
                  <div className="col-span-3">
                    <Label className="text-xs text-slate-500">CPT Code</Label>
                    <Input value={li.cptCode} onChange={e => updateLineItem(idx, "cptCode", e.target.value)}
                      placeholder="99285" className="h-8 text-xs mt-1" />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs text-slate-500">ICD-10</Label>
                    <Input value={li.icd10Codes} onChange={e => updateLineItem(idx, "icd10Codes", e.target.value)}
                      placeholder="R07.9" className="h-8 text-xs mt-1" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs text-slate-500">Amount ($)</Label>
                    <Input type="number" min="0" step="0.01" value={li.billedAmount}
                      onChange={e => updateLineItem(idx, "billedAmount", e.target.value)}
                      placeholder="0.00" className={`h-8 text-xs mt-1 ${errors[`li_${idx}_amount`] ? "border-red-400" : ""}`} />
                    {errors[`li_${idx}_amount`] && <p className="text-xs text-red-500 mt-0.5">{errors[`li_${idx}_amount`]}</p>}
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs text-slate-500">Qty</Label>
                    <Input type="number" min="1" value={li.quantity}
                      onChange={e => updateLineItem(idx, "quantity", e.target.value)}
                      className="h-8 text-xs mt-1" />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    {form.lineItems.length > 1 && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeLineItem(idx)}
                        className="h-8 w-8 p-0 text-slate-400 hover:text-red-500">
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Step 4: Documents & Negotiation ── */}
        {currentStep === 4 && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-slate-800">Open Negotiation Period</h2>
            <div className="p-4 bg-blue-50 rounded-lg text-sm text-blue-700 border border-blue-100">
              <p className="font-semibold mb-1">Federal NSA Requirement</p>
              <p>Parties must engage in a 30-business-day open negotiation period before initiating IDR.
                 Document your good-faith negotiation attempt below — this is required for IDR eligibility.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Negotiation Start Date" hint="When you first contacted the health plan">
                <Input type="date" value={form.openNegotiationStartDate}
                  onChange={e => update("openNegotiationStartDate", e.target.value)} />
              </Field>
              <Field label="Negotiation End Date" hint="30 business days from start">
                <Input type="date" value={form.openNegotiationEndDate}
                  onChange={e => update("openNegotiationEndDate", e.target.value)} />
              </Field>
            </div>
            <Field label="Negotiation Notes" hint="Summarize your negotiation attempt — dates, contacts, offers made">
              <textarea
                value={form.priorNegotiationNotes}
                onChange={e => update("priorNegotiationNotes", e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="e.g., Contacted Aetna claims dept. on 2024-01-15; offered $2,500 settlement; plan countered $800; negotiation failed on 2024-02-28."
              />
            </Field>
          </div>
        )}

        {/* ── Step 5: Review ── */}
        {currentStep === 5 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-800">Review & Submit</h2>
            {[
              {
                title: "Parties",
                items: [
                  ["Initiating Party", form.initiatingPartyName],
                  ["Type", PARTY_TYPES.find(t => t.value === form.initiatingPartyType)?.label ?? form.initiatingPartyType],
                  ["Responding Party", form.respondingPartyName],
                  ["Type", PARTY_TYPES.find(t => t.value === form.respondingPartyType)?.label ?? form.respondingPartyType],
                  ["NPI", form.initiatingPartyNpi || "—"],
                ],
              },
              {
                title: "Service Details",
                items: [
                  ["Service Type", SERVICE_TYPES.find(t => t.value === form.serviceType)?.label ?? form.serviceType],
                  ["Service Date", form.serviceDate],
                  ["Patient", [form.patientFirstName, form.patientLastName].filter(Boolean).join(" ") || "—"],
                  ["Facility", form.facilityName || "—"],
                  ["Patient State", form.patientState],
                  ["Facility State", form.facilityState],
                ],
              },
              {
                title: "Billing",
                items: [
                  ["Total Billed", `$${form.billedAmount}`],
                  ["CPT Codes", form.cptCodes],
                  ["ICD-10", form.icd10Codes || "—"],
                  ["Line Items", `${form.lineItems.filter(li => li.cptCode).length} item(s)`],
                ],
              },
              {
                title: "Negotiation",
                items: [
                  ["Start Date", form.openNegotiationStartDate || "—"],
                  ["End Date", form.openNegotiationEndDate || "—"],
                  ["Notes", form.priorNegotiationNotes ? `${form.priorNegotiationNotes.slice(0, 100)}${form.priorNegotiationNotes.length > 100 ? "…" : ""}` : "—"],
                ],
              },
            ].map(section => (
              <div key={section.title} className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">{section.title}</div>
                <div className="divide-y divide-slate-100">
                  {section.items.map(([k, v]) => (
                    <div key={k} className="flex justify-between px-4 py-2 text-sm">
                      <span className="text-slate-500">{k}</span>
                      <span className="text-slate-800 font-medium text-right max-w-xs truncate">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              <p className="font-semibold">Before you submit</p>
              <p className="mt-1">By submitting you attest that: (1) the information is accurate, (2) the open negotiation
                 period has been exhausted or initiated in good faith, and (3) this dispute is eligible for the
                 Federal IDR process under the No Surprises Act.</p>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-100">
          <Button variant="outline" onClick={() => currentStep > 1 ? setCurrentStep(s => s - 1) : navigate("/disputes")}
            className="flex items-center gap-1">
            <ChevronLeft size={16} />{currentStep === 1 ? "Cancel" : "Back"}
          </Button>
          <div className="flex items-center gap-2">
            {currentStep < 5 ? (
              <Button onClick={() => { if (validate(currentStep)) setCurrentStep(s => s + 1); }}
                className="flex items-center gap-1">
                Continue<ChevronRight size={16} />
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={createMutation.isPending}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700">
                {createMutation.isPending ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Submitting…</>
                ) : (
                  <><CheckCircle2 size={16} />Submit Dispute</>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
