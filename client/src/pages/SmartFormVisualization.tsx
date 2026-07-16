import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Upload, FileText, Brain, CheckCircle2, ArrowRight, Sparkles,
  Shield, Clock, Edit3, History, Download, RotateCcw, SplitSquareVertical,
  ChevronDown, ChevronRight as ChevronRightIcon, Zap, Target, AlertTriangle,
  Info, Eye, GitCompare
} from "lucide-react";

// ─── Flow Step Data ───────────────────────────────────────────────────────────

const FLOW_STEPS = [
  {
    id: 1,
    icon: Upload,
    title: "Document Ingestion",
    subtitle: "Multi-format input",
    color: "bg-blue-500",
    lightBg: "bg-blue-50",
    border: "border-blue-200",
    textColor: "text-blue-700",
    description:
      "Users upload an EOB, CMS-1500, FHIR Bundle, or plain text paste. The SmartFormPanel accepts drag-and-drop or file picker input and validates the MIME type before sending.",
    details: [
      "PDF, PNG, JPEG, DOCX, TXT, JSON (FHIR)",
      "Drag-and-drop or file picker",
      "MIME-type validation before upload",
      "Max 10 MB per document",
    ],
    badge: "Input",
  },
  {
    id: 2,
    icon: Brain,
    title: "LLM Extraction",
    subtitle: "Hermes AI engine",
    color: "bg-purple-500",
    lightBg: "bg-purple-50",
    border: "border-purple-200",
    textColor: "text-purple-700",
    description:
      "The document content is sent to the Hermes AI engine via trpc.smartForm.extract. The LLM uses a structured JSON schema to extract every field with a value, confidence score (0–100), and source citation.",
    details: [
      "Structured JSON schema output — no hallucinated fields",
      "Per-field confidence score (0–100)",
      "Source citation (e.g. 'header section', 'claim line 3')",
      "Supports 4 form targets: dispute, offer, mobile_dispute, emr_onboarding",
    ],
    badge: "AI",
  },
  {
    id: 3,
    icon: Eye,
    title: "Confidence Preview",
    subtitle: "Color-coded review",
    color: "bg-emerald-500",
    lightBg: "bg-emerald-50",
    border: "border-emerald-200",
    textColor: "text-emerald-700",
    description:
      "Every extracted field is shown with a color-coded confidence badge. Users can see at a glance which fields the AI is certain about and which need review.",
    details: [
      "Green badge: ≥ 85% confidence — high certainty",
      "Amber badge: 60–84% — review recommended",
      "Red badge: < 60% — manual verification required",
      "Source citation shown below each value",
    ],
    badge: "Review",
  },
  {
    id: 4,
    icon: Edit3,
    title: "Inline Editing",
    subtitle: "Manual correction",
    color: "bg-orange-500",
    lightBg: "bg-orange-50",
    border: "border-orange-200",
    textColor: "text-orange-700",
    description:
      "Any field can be clicked to enter edit mode. The original AI value is preserved and shown as a strikethrough below the edited value. A blue 'Edited' badge replaces the confidence badge.",
    details: [
      "Click pencil icon to enter edit mode",
      "Enter or ✓ to commit, Escape or ✗ to discard",
      "Original AI value shown with strikethrough",
      "Per-field Revert button restores AI value",
    ],
    badge: "Edit",
  },
  {
    id: 5,
    icon: GitCompare,
    title: "Compare View",
    subtitle: "Side-by-side diff",
    color: "bg-indigo-500",
    lightBg: "bg-indigo-50",
    border: "border-indigo-200",
    textColor: "text-indigo-700",
    description:
      "When edits exist, a Compare toggle reveals a side-by-side diff table showing the original AI value next to the manual edit for every changed field.",
    details: [
      "Compare toggle appears when ≥ 1 field is edited",
      "3-column layout: AI value → arrow → your edit",
      "Per-row Revert button in the diff table",
      "Revert All with confirmation dialog",
    ],
    badge: "Compare",
  },
  {
    id: 6,
    icon: CheckCircle2,
    title: "Selective Apply",
    subtitle: "Field-level control",
    color: "bg-teal-500",
    lightBg: "bg-teal-50",
    border: "border-teal-200",
    textColor: "text-teal-700",
    description:
      "Users choose exactly which fields to apply using checkboxes. Select All / Deselect All shortcuts are available. The Apply button populates the parent form with only the selected fields.",
    details: [
      "Per-field checkbox selection",
      "Select All / Deselect All shortcuts",
      "Apply toast reports count + manual edit count",
      "Extraction ID stored for audit trail",
    ],
    badge: "Apply",
  },
  {
    id: 7,
    icon: History,
    title: "History & Reuse",
    subtitle: "Past extractions",
    color: "bg-rose-500",
    lightBg: "bg-rose-50",
    border: "border-rose-200",
    textColor: "text-rose-700",
    description:
      "The View History modal shows the last 50 extractions with search and date filters. Any past extraction can be reused — loading it back into the preview panel for re-review and re-apply.",
    details: [
      "Search by document name",
      "Date From / Date To range filter",
      "Expandable field preview per entry",
      "Reuse button loads extraction back into panel",
    ],
    badge: "History",
  },
  {
    id: 8,
    icon: Download,
    title: "Export",
    subtitle: "JSON or CSV",
    color: "bg-slate-600",
    lightBg: "bg-slate-50",
    border: "border-slate-200",
    textColor: "text-slate-700",
    description:
      "The final reviewed data — including AI values overridden by manual edits — can be downloaded as a structured JSON file or a flat CSV, with edited and selected flags on every field.",
    details: [
      "JSON: nested structure with metadata + fields array",
      "CSV: Field, Value, Confidence, Source, Edited, Selected",
      "Filename includes form type and timestamp",
      "Reflects final state after all edits",
    ],
    badge: "Export",
  },
];

// ─── Feature Cards ────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: Zap,
    title: "10-Second Auto-Fill",
    description: "From raw EOB PDF to fully pre-populated dispute form in under 10 seconds. No manual data entry.",
    color: "text-yellow-600",
    bg: "bg-yellow-50",
  },
  {
    icon: Shield,
    title: "Confidence Scoring",
    description: "Every field carries a 0–100 confidence score so reviewers know exactly where to focus attention.",
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    icon: Target,
    title: "4 Form Targets",
    description: "Dispute initiation, offer/counter, mobile wizard, and EMR onboarding — each with tailored field mappings.",
    color: "text-purple-600",
    bg: "bg-purple-50",
  },
  {
    icon: Edit3,
    title: "Inline Correction",
    description: "Edit any AI value in-place. Original preserved as strikethrough. Per-field and bulk revert available.",
    color: "text-orange-600",
    bg: "bg-orange-50",
  },
  {
    icon: SplitSquareVertical,
    title: "Side-by-Side Compare",
    description: "Toggle a diff view to see original AI values vs. manual edits across all changed fields at once.",
    color: "text-indigo-600",
    bg: "bg-indigo-50",
  },
  {
    icon: History,
    title: "Extraction History",
    description: "Search and filter past extractions. Reuse any previous result without re-uploading the document.",
    color: "text-rose-600",
    bg: "bg-rose-50",
  },
  {
    icon: Clock,
    title: "Audit Trail",
    description: "Every extraction is persisted with job ID, model, latency, and which fields were applied.",
    color: "text-teal-600",
    bg: "bg-teal-50",
  },
  {
    icon: Download,
    title: "JSON / CSV Export",
    description: "Download the final reviewed data with edited and selected flags for downstream processing.",
    color: "text-slate-600",
    bg: "bg-slate-50",
  },
];

// ─── Simulation Data ──────────────────────────────────────────────────────────

const SAMPLE_EOB = `Patient Name: Jane Doe
Date of Birth: 1985-03-22
Member ID: HP-2024-88821
Provider Name: Mountain View Emergency Physicians
NPI: 1234567890
Payer: BlueCross BlueShield of Texas
Claim Number: CLM-2024-00441
Service Date: 2024-11-14
Billed Amount: $12,450.00
CPT Codes: 99285, 36415
Diagnosis: R07.9 (Chest pain, unspecified)`;

const SIMULATED_FIELDS = [
  { key: "Patient Name", value: "Jane Doe", confidence: 98, source: "header section" },
  { key: "Date of Birth", value: "1985-03-22", confidence: 95, source: "patient demographics" },
  { key: "Member ID", value: "HP-2024-88821", confidence: 97, source: "insurance section" },
  { key: "Provider Name", value: "Mountain View Emergency Physicians", confidence: 94, source: "provider block" },
  { key: "NPI", value: "1234567890", confidence: 99, source: "provider block" },
  { key: "Payer Name", value: "BlueCross BlueShield of Texas", confidence: 96, source: "payer section" },
  { key: "Claim Number", value: "CLM-2024-00441", confidence: 99, source: "claim header" },
  { key: "Service Date", value: "2024-11-14", confidence: 97, source: "service line 1" },
  { key: "Billed Amount", value: "$12,450.00", confidence: 98, source: "totals section" },
  { key: "CPT Codes", value: "99285, 36415", confidence: 91, source: "procedure codes" },
  { key: "Diagnosis Codes", value: "R07.9", confidence: 88, source: "diagnosis section" },
];

function confidenceColor(c: number) {
  if (c >= 85) return "bg-green-100 text-green-700 border-green-300";
  if (c >= 60) return "bg-amber-100 text-amber-700 border-amber-300";
  return "bg-red-100 text-red-700 border-red-300";
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SmartFormVisualization() {
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [simulationState, setSimulationState] = useState<"idle" | "extracting" | "done">("idle");
  const [docText, setDocText] = useState(SAMPLE_EOB);
  const [selectedFields, setSelectedFields] = useState<Set<number>>(new Set(SIMULATED_FIELDS.map((_, i) => i)));
  const [editedFields, setEditedFields] = useState<Record<number, string>>({});
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [progress, setProgress] = useState(0);

  const runSimulation = () => {
    if (simulationState === "extracting") return;
    setSimulationState("extracting");
    setProgress(0);
    setEditedFields({});
    setSelectedFields(new Set(SIMULATED_FIELDS.map((_, i) => i)));
    let p = 0;
    const interval = setInterval(() => {
      p += Math.random() * 18 + 5;
      if (p >= 100) {
        p = 100;
        clearInterval(interval);
        setTimeout(() => setSimulationState("done"), 300);
      }
      setProgress(Math.min(p, 100));
    }, 120);
  };

  const toggleField = (i: number) => {
    setSelectedFields(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const startEdit = (i: number) => {
    setEditingIdx(i);
    setEditValue(editedFields[i] ?? SIMULATED_FIELDS[i].value);
  };

  const commitEdit = (i: number) => {
    if (editValue !== SIMULATED_FIELDS[i].value) {
      setEditedFields(prev => ({ ...prev, [i]: editValue }));
    }
    setEditingIdx(null);
  };

  const revertField = (i: number) => {
    setEditedFields(prev => { const n = { ...prev }; delete n[i]; return n; });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-8 py-10">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <Badge className="bg-white/20 text-white border-white/30 text-xs">Hermes AI · SmartForm</Badge>
          </div>
          <h1 className="text-3xl font-bold mb-2">SmartForm AI Extraction</h1>
          <p className="text-blue-100 text-lg max-w-2xl">
            How Hermes transforms unstructured medical documents into structured, validated dispute data in under 10 seconds.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-8 py-10 space-y-12">
        <Tabs defaultValue="flow">
          <TabsList className="mb-6">
            <TabsTrigger value="flow">Pipeline Flow</TabsTrigger>
            <TabsTrigger value="features">Feature Guide</TabsTrigger>
            <TabsTrigger value="simulation">Live Simulation</TabsTrigger>
          </TabsList>

          {/* ── Flow Tab ── */}
          <TabsContent value="flow" className="space-y-6">
            <div className="text-center mb-2">
              <p className="text-slate-500 text-sm">Click any step to expand its details</p>
            </div>

            {/* Flow diagram */}
            <div className="space-y-2">
              {FLOW_STEPS.map((step, idx) => {
                const Icon = step.icon;
                const isOpen = activeStep === step.id;
                return (
                  <div key={step.id}>
                    <button
                      className={`w-full text-left rounded-xl border transition-all ${isOpen ? `${step.lightBg} ${step.border} shadow-sm` : "bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm"}`}
                      onClick={() => setActiveStep(isOpen ? null : step.id)}
                    >
                      <div className="flex items-center gap-4 px-5 py-4">
                        {/* Step number + icon */}
                        <div className={`w-10 h-10 rounded-xl ${step.color} flex items-center justify-center flex-shrink-0`}>
                          <Icon className="w-5 h-5 text-white" />
                        </div>
                        {/* Labels */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-slate-400">Step {step.id}</span>
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${step.textColor} border-current`}>{step.badge}</Badge>
                          </div>
                          <p className="font-semibold text-slate-800">{step.title}</p>
                          <p className="text-sm text-slate-500">{step.subtitle}</p>
                        </div>
                        {/* Expand toggle */}
                        <div className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>
                          <ChevronRightIcon className="w-4 h-4 text-slate-400" />
                        </div>
                      </div>

                      {isOpen && (
                        <div className={`px-5 pb-5 border-t ${step.border}`}>
                          <p className="text-sm text-slate-700 mt-4 mb-3">{step.description}</p>
                          <ul className="space-y-1.5">
                            {step.details.map(d => (
                              <li key={d} className="flex items-start gap-2 text-sm text-slate-600">
                                <CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${step.textColor}`} />
                                {d}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </button>

                    {/* Arrow connector */}
                    {idx < FLOW_STEPS.length - 1 && (
                      <div className="flex justify-center py-1">
                        <ArrowRight className="w-4 h-4 text-slate-300 rotate-90" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Summary callout */}
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="p-5 flex gap-4">
                <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-blue-800 mb-1">End-to-end in under 10 seconds</p>
                  <p className="text-sm text-blue-700">
                    From document upload to populated form fields, the entire pipeline — ingestion, LLM extraction, confidence scoring, and field preview — completes in under 10 seconds on average. Manual review and editing add only the time the user needs.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Features Tab ── */}
          <TabsContent value="features">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {FEATURES.map(f => {
                const Icon = f.icon;
                return (
                  <Card key={f.title} className="border-slate-200 hover:shadow-md transition-shadow">
                    <CardContent className="p-5">
                      <div className={`w-10 h-10 rounded-xl ${f.bg} flex items-center justify-center mb-3`}>
                        <Icon className={`w-5 h-5 ${f.color}`} />
                      </div>
                      <p className="font-semibold text-slate-800 mb-1">{f.title}</p>
                      <p className="text-sm text-slate-500">{f.description}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Form target matrix */}
            <Card className="mt-6 border-slate-200">
              <CardHeader>
                <CardTitle className="text-base">Form Target Coverage</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-2 pr-4 font-semibold text-slate-600">Target Form</th>
                        <th className="text-left py-2 pr-4 font-semibold text-slate-600">Page</th>
                        <th className="text-left py-2 font-semibold text-slate-600">Fields Mapped</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[
                        { target: "dispute", page: "New Dispute", fields: "patientName, DOB, memberId, providerName, NPI, payerName, claimNumber, serviceDate, billedAmount, CPT codes" },
                        { target: "offer", page: "Offer / Counter Wizard", fields: "offerAmount, rationale" },
                        { target: "mobile_dispute", page: "Mobile Dispute Wizard", fields: "providerName, payerName, serviceDate, billedAmount, cptCodes" },
                        { target: "emr_onboarding", page: "EMR Onboarding", fields: "fhirBaseUrl, clientId, facilityId" },
                      ].map(r => (
                        <tr key={r.target}>
                          <td className="py-2 pr-4 font-mono text-xs text-purple-700 bg-purple-50 px-2 rounded">{r.target}</td>
                          <td className="py-2 pr-4 text-slate-700">{r.page}</td>
                          <td className="py-2 text-slate-500 text-xs">{r.fields}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Simulation Tab ── */}
          <TabsContent value="simulation" className="space-y-6">
            <Card className="border-slate-200">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  Interactive Simulation — paste a document and watch Hermes extract it
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  value={docText}
                  onChange={e => { setDocText(e.target.value); setSimulationState("idle"); }}
                  rows={8}
                  className="font-mono text-xs"
                  placeholder="Paste an EOB, FHIR JSON, or plain text claim here..."
                />
                <div className="flex items-center gap-3">
                  <Button
                    onClick={runSimulation}
                    disabled={simulationState === "extracting" || !docText.trim()}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    <Brain className="w-4 h-4 mr-2" />
                    {simulationState === "extracting" ? "Extracting..." : simulationState === "done" ? "Re-run Extraction" : "Run AI Extraction"}
                  </Button>
                  {simulationState === "done" && (
                    <span className="text-sm text-emerald-600 font-medium flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" /> {SIMULATED_FIELDS.length} fields extracted
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                {simulationState === "extracting" && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>Hermes is reading your document...</span>
                      <span>{Math.round(progress)}%</span>
                    </div>
                    <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-150 rounded-full"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Extracted fields preview */}
            {simulationState === "done" && (
              <Card className="border-slate-200">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Extracted Fields Preview</CardTitle>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <button
                        onClick={() => setSelectedFields(new Set(SIMULATED_FIELDS.map((_, i) => i)))}
                        className="text-blue-600 hover:underline"
                      >Select All</button>
                      <span>·</span>
                      <button
                        onClick={() => setSelectedFields(new Set())}
                        className="text-slate-500 hover:underline"
                      >Deselect All</button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {SIMULATED_FIELDS.map((f, i) => {
                      const isEdited = i in editedFields;
                      const isEditing = editingIdx === i;
                      const displayValue = editedFields[i] ?? f.value;
                      return (
                        <div
                          key={f.key}
                          className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                            isEdited
                              ? "bg-blue-50 border-blue-300 border-l-4 border-l-blue-500"
                              : selectedFields.has(i)
                              ? "bg-white border-slate-200"
                              : "bg-slate-50 border-slate-200 opacity-60"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedFields.has(i)}
                            onChange={() => toggleField(i)}
                            className="mt-1 accent-blue-600"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-xs font-semibold text-slate-600">{f.key}</span>
                              {isEdited ? (
                                <Badge className="bg-blue-100 text-blue-700 border-blue-300 text-[10px] px-1.5 py-0 flex items-center gap-0.5">
                                  <Edit3 className="w-2.5 h-2.5" /> Edited
                                </Badge>
                              ) : (
                                <span className={`text-[10px] px-1.5 py-0 rounded-full border font-medium ${confidenceColor(f.confidence)}`}>
                                  {f.confidence}%
                                </span>
                              )}
                            </div>
                            {isEditing ? (
                              <div className="flex items-center gap-2">
                                <input
                                  autoFocus
                                  value={editValue}
                                  onChange={e => setEditValue(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") commitEdit(i);
                                    if (e.key === "Escape") setEditingIdx(null);
                                  }}
                                  className="flex-1 text-sm border border-blue-400 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                />
                                <button onClick={() => commitEdit(i)} className="text-blue-600 hover:text-blue-800 text-xs">✓</button>
                                <button onClick={() => setEditingIdx(null)} className="text-slate-400 hover:text-slate-600 text-xs">✗</button>
                              </div>
                            ) : (
                              <div>
                                <span className={`text-sm font-medium ${isEdited ? "text-blue-700" : "text-slate-800"}`}>{displayValue}</span>
                                {isEdited && (
                                  <div className="text-xs text-slate-400 line-through mt-0.5">AI: {f.value}</div>
                                )}
                              </div>
                            )}
                            <p className="text-[10px] text-slate-400 mt-0.5">Source: {f.source}</p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {!isEditing && (
                              <button
                                onClick={() => startEdit(i)}
                                className="p-1 rounded hover:bg-blue-100 text-slate-400 hover:text-blue-600 transition-colors"
                                title="Edit this field"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {isEdited && (
                              <button
                                onClick={() => revertField(i)}
                                className="p-1 rounded hover:bg-slate-100 text-blue-400 hover:text-blue-600 transition-colors"
                                title="Revert to AI value"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Apply button */}
                  <div className="mt-4 pt-4 border-t border-slate-200 flex items-center justify-between">
                    <p className="text-sm text-slate-500">
                      {selectedFields.size} of {SIMULATED_FIELDS.length} fields selected
                      {Object.keys(editedFields).length > 0 && (
                        <span className="ml-2 text-blue-600">· {Object.keys(editedFields).length} manually edited</span>
                      )}
                    </p>
                    <Button
                      disabled={selectedFields.size === 0}
                      className="bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => {
                        const editCount = Object.keys(editedFields).length;
                        alert(`✓ Applied ${selectedFields.size} fields to form${editCount > 0 ? ` (${editCount} manually edited)` : ""}.`);
                      }}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Apply {selectedFields.size} Fields
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Warning callout */}
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="p-4 flex gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">
                  This is a <strong>client-side simulation</strong> using pre-defined sample data to demonstrate the UI flow. In production, the extraction is performed by the Hermes LLM engine via <code className="text-xs bg-amber-100 px-1 rounded">trpc.smartForm.extract</code> and returns real AI-generated values with live confidence scores.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
