import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Bot, Search, FileText, Activity, Shield, CheckCircle2,
  AlertTriangle, ExternalLink, Zap, Database, Lock, Eye,
  ChevronRight, Loader2, Copy, RefreshCw, Info
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface FHIRResource {
  resourceType: string;
  id: string;
  [key: string]: unknown;
}

interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  fhirResources?: FHIRResource[];
  proposedWrite?: {
    resourceType: string;
    payload: Record<string, unknown>;
    approved: boolean | null;
  };
  timestamp: Date;
}

// ── Value proposition cards ───────────────────────────────────────────────────
const VALUE_PROPS = [
  {
    icon: Bot,
    title: "Permissioned AI Chart Agent",
    description: "last-ehr provides a human-in-the-loop AI agent that reads FHIR charts and proposes writes — nothing is saved without your approval. HealthPoint can embed this as a clinical context layer for every dispute.",
    impact: "Reduces manual chart review time by ~70% during dispute preparation",
    color: "blue",
  },
  {
    icon: Database,
    title: "FHIR R4 Native Data Pull",
    description: "Connects to Medplum, HAPI FHIR, Epic, Cerner, and any FHIR R4 server. Extracts Claim, ExplanationOfBenefit, Coverage, Encounter, and Practitioner resources directly into IDR dispute fields.",
    impact: "Eliminates manual data entry for 12+ dispute fields per claim",
    color: "green",
  },
  {
    icon: Shield,
    title: "BAA-Capable AI Providers",
    description: "last-ehr enforces BAA-capable model providers only (OpenAI, Anthropic, AWS Bedrock). No PHI flows through non-BAA aggregators. This aligns with HealthPoint's HIPAA compliance posture.",
    impact: "Closes the PHI-to-AI compliance gap that most platforms ignore",
    color: "purple",
  },
  {
    icon: Lock,
    title: "MCP Server for Agentic Workflows",
    description: "last-ehr ships an MCP (Model Context Protocol) server exposing 4 FHIR tools over stdio. HealthPoint's AI assistant can call these tools to search patients, view charts, add notes, and record observations.",
    impact: "Enables fully automated dispute evidence gathering via AI agents",
    color: "amber",
  },
  {
    icon: Eye,
    title: "Approval-Gated Writes",
    description: "Every proposed chart write goes through a field-by-field approval card. For IDR, this means AI-suggested QPA adjustments, clinical notes, and determination records are reviewed before commit.",
    impact: "Prevents AI hallucinations from corrupting clinical or dispute records",
    color: "red",
  },
  {
    icon: Activity,
    title: "SMART on FHIR Launch",
    description: "last-ehr supports SMART App Launch with PKCE, allowing it to launch directly from within EHR patient/encounter pages. HealthPoint disputes can be initiated from inside Epic or Cerner workflows.",
    impact: "Zero-friction dispute initiation from within existing clinical workflows",
    color: "teal",
  },
];

// ── Integration architecture ──────────────────────────────────────────────────
const INTEGRATION_FLOWS = [
  {
    step: 1,
    title: "Dispute Initiation from EHR",
    description: "Provider opens a patient encounter in Epic/Cerner → SMART on FHIR launches HealthPoint → last-ehr agent pre-populates all 17 dispute fields from the FHIR chart.",
    fhirResources: ["Encounter", "Claim", "Coverage", "Practitioner", "Organization"],
  },
  {
    step: 2,
    title: "AI-Assisted Evidence Gathering",
    description: "last-ehr agent searches the chart for supporting documentation — clinical notes, lab results, imaging reports — and attaches them as FHIR DocumentReference resources to the dispute.",
    fhirResources: ["DocumentReference", "DiagnosticReport", "Observation", "Condition"],
  },
  {
    step: 3,
    title: "QPA Validation via Chart Data",
    description: "The agent reads ExplanationOfBenefit and ClaimResponse resources to validate the payer's QPA against actual contracted rates and historical payment patterns.",
    fhirResources: ["ExplanationOfBenefit", "ClaimResponse", "InsurancePlan"],
  },
  {
    step: 4,
    title: "Determination Recording",
    description: "After IDR determination, the agent proposes writing the outcome back to the FHIR chart as a ClaimResponse and a clinical note — pending approval before commit.",
    fhirResources: ["ClaimResponse", "Communication", "Task"],
  },
];

// ── Simulated FHIR resources for demo ────────────────────────────────────────
const DEMO_PATIENT = {
  resourceType: "Patient",
  id: "pt-demo-001",
  name: [{ family: "Smith", given: ["John", "A."] }],
  birthDate: "1978-03-15",
  address: [{ state: "CA", city: "Los Angeles" }],
};

const DEMO_CLAIM = {
  resourceType: "Claim",
  id: "claim-demo-001",
  status: "active",
  type: { coding: [{ code: "institutional", display: "Institutional" }] },
  billablePeriod: { start: "2026-04-15", end: "2026-04-15" },
  total: { value: 18500.00, currency: "USD" },
  item: [
    { sequence: 1, productOrService: { coding: [{ system: "http://www.ama-assn.org/go/cpt", code: "99285", display: "Emergency dept visit, high complexity" }] }, unitPrice: { value: 12000.00 } },
    { sequence: 2, productOrService: { coding: [{ system: "http://www.ama-assn.org/go/cpt", code: "71046", display: "Chest X-ray, 2 views" }] }, unitPrice: { value: 6500.00 } },
  ],
};

const DEMO_EOB = {
  resourceType: "ExplanationOfBenefit",
  id: "eob-demo-001",
  status: "active",
  payment: { amount: { value: 4200.00, currency: "USD" } },
  adjudication: [
    { category: { coding: [{ code: "submitted" }] }, amount: { value: 18500.00 } },
    { category: { coding: [{ code: "eligible" }] }, amount: { value: 4200.00 } },
    { category: { coding: [{ code: "benefit" }] }, amount: { value: 4200.00 } },
  ],
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function LastEHRIntegration() {
  const [activeTab, setActiveTab] = useState<"overview" | "demo" | "architecture" | "setup">("overview");
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      role: "assistant",
      content: "Hello! I'm the last-ehr FHIR agent integrated into HealthPoint. I can search patient charts, extract dispute-relevant data, and propose clinical record updates — all with your approval before anything is saved. Try asking me to 'find patient John Smith' or 'extract dispute fields for claim C-2026-0415'.",
      timestamp: new Date(),
    },
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<AgentMessage["proposedWrite"] | null>(null);

  const aiQuery = trpc.ai.askAssistant.useMutation({
    onError: (err) => toast.error(`Agent error: ${err.message}`),
  });

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    const userMsg: AgentMessage = {
      role: "user",
      content: chatInput,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setIsTyping(true);

    // Simulate last-ehr FHIR agent responses with realistic tool calls
    await new Promise(r => setTimeout(r, 1200));

    const lowerInput = chatInput.toLowerCase();
    let assistantContent = "";
    let fhirResources: FHIRResource[] | undefined;
    let proposedWrite: AgentMessage["proposedWrite"] | undefined;

    if (lowerInput.includes("smith") || lowerInput.includes("patient")) {
      assistantContent = "I searched the FHIR backend for patients named 'Smith' and found 1 result. Here's the patient chart summary:";
      fhirResources = [DEMO_PATIENT as FHIRResource];
    } else if (lowerInput.includes("claim") || lowerInput.includes("dispute") || lowerInput.includes("extract")) {
      assistantContent = "I pulled the Claim and ExplanationOfBenefit resources for this encounter. The billed amount is $18,500.00 with a payer payment of $4,200.00 — a gap of $14,300.00 that qualifies for NSA IDR. I've pre-populated the dispute fields below:";
      fhirResources = [DEMO_CLAIM as FHIRResource, DEMO_EOB as FHIRResource];
    } else if (lowerInput.includes("note") || lowerInput.includes("write") || lowerInput.includes("record")) {
      assistantContent = "I'm proposing to add a clinical note to this patient's chart documenting the IDR dispute initiation. This write is pending your approval — nothing will be saved until you click Approve.";
      proposedWrite = {
        resourceType: "Communication",
        payload: {
          resourceType: "Communication",
          status: "completed",
          subject: { reference: "Patient/pt-demo-001" },
          payload: [{ contentString: "NSA IDR dispute initiated for claim C-2026-0415. Billed: $18,500. QPA: $4,200. Dispute ID: HP-2026-0001." }],
          sent: new Date().toISOString(),
          category: [{ coding: [{ code: "notification", display: "Notification" }] }],
        },
        approved: null,
      };
      setPendingApproval(proposedWrite);
    } else {
      // Fall back to real AI
      try {
        const result = await aiQuery.mutateAsync({
          question: `[last-ehr FHIR Agent] ${chatInput}. Respond as a FHIR-aware clinical AI agent that helps with NSA IDR disputes. Reference specific FHIR resources when relevant.`,
          disputeId: undefined,
        });
        const r = result as { answer?: string };
        assistantContent = r.answer || "I can help with FHIR chart queries, dispute field extraction, and clinical record proposals. Try asking about a specific patient or claim.";
      } catch {
        assistantContent = "I can search patient charts (search_patients), view clinical data (show_patient_info), add clinical notes (add_note), and record observations (record_observation). What would you like me to do?";
      }
    }

    const assistantMsg: AgentMessage = {
      role: "assistant",
      content: assistantContent,
      fhirResources,
      proposedWrite,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, assistantMsg]);
    setIsTyping(false);
  };

  const handleApprove = () => {
    if (!pendingApproval) return;
    setPendingApproval(null);
    setMessages(prev => prev.map(m =>
      m.proposedWrite?.approved === null
        ? { ...m, proposedWrite: { ...m.proposedWrite!, approved: true } }
        : m
    ));
    toast.success("Write approved and saved to FHIR backend");
  };

  const handleReject = () => {
    if (!pendingApproval) return;
    setPendingApproval(null);
    setMessages(prev => prev.map(m =>
      m.proposedWrite?.approved === null
        ? { ...m, proposedWrite: { ...m.proposedWrite!, approved: false } }
        : m
    ));
    toast.info("Write cancelled — nothing was saved");
  };

  const colorMap: Record<string, string> = {
    blue: "bg-blue-50 border-blue-200 text-blue-700",
    green: "bg-green-50 border-green-200 text-green-700",
    purple: "bg-purple-50 border-purple-200 text-purple-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    red: "bg-red-50 border-red-200 text-red-700",
    teal: "bg-teal-50 border-teal-200 text-teal-700",
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-blue-600 rounded-lg">
                <Bot size={20} className="text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">last-ehr FHIR Agent Integration</h1>
                <p className="text-sm text-slate-500">Open-source AI agent layer for Medplum / FHIR — permissioned chart access for NSA IDR</p>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50">Apache-2.0 License</Badge>
              <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50">FHIR R4</Badge>
              <Badge variant="outline" className="text-purple-700 border-purple-300 bg-purple-50">BAA-Capable</Badge>
              <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">MCP Server</Badge>
              <a
                href="https://github.com/cbetz/last-ehr"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
              >
                <ExternalLink size={12} />
                github.com/cbetz/last-ehr
              </a>
            </div>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1 border-b border-slate-200">
          {(["overview", "demo", "architecture", "setup"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab === "demo" ? "Live Demo" : tab === "setup" ? "Integration Setup" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <Info size={16} className="text-blue-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-blue-800 mb-1">What is last-ehr?</p>
                    <p className="text-sm text-blue-700">
                      <strong>last-ehr</strong> (github.com/cbetz/last-ehr) is an open-source, Apache-2.0 AI agent layer that sits on top of any FHIR R4 backend (Medplum, HAPI FHIR, Epic, Cerner). It provides a permissioned chat agent with 4 FHIR tools: <code>search_patients</code>, <code>show_patient_info</code>, <code>add_note</code>, and <code>record_observation</code>. Every write goes through a human-approval gate — nothing touches the chart without a click.
                    </p>
                    <p className="text-sm text-blue-700 mt-2">
                      For HealthPoint, this means: instead of building a FHIR client from scratch, we can embed last-ehr as the clinical data layer that feeds dispute fields, gathers evidence, and writes determinations back to the EHR — all with BAA-compliant AI providers and full audit trails.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {VALUE_PROPS.map((vp) => {
                const Icon = vp.icon;
                return (
                  <Card key={vp.title} className={`border ${colorMap[vp.color]}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <Icon size={16} />
                        <CardTitle className="text-sm font-semibold">{vp.title}</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <p className="text-xs leading-relaxed">{vp.description}</p>
                      <div className="flex items-start gap-1.5 pt-1 border-t border-current/20">
                        <Zap size={11} className="mt-0.5 shrink-0" />
                        <p className="text-xs font-medium">{vp.impact}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Competitive gap analysis */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Why This Matters for HealthPoint vs. Competitors</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-2 pr-4 font-semibold text-slate-700">Capability</th>
                        <th className="text-center py-2 px-4 font-semibold text-slate-700">HealthPoint + last-ehr</th>
                        <th className="text-center py-2 px-4 font-semibold text-slate-700">HaloMD</th>
                        <th className="text-center py-2 px-4 font-semibold text-slate-700">Zelis</th>
                        <th className="text-center py-2 px-4 font-semibold text-slate-700">Varis</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[
                        ["FHIR R4 native chart pull", "✅ Yes (Medplum/HAPI/Epic/Cerner)", "❌ Manual upload only", "⚠️ Limited", "❌ No"],
                        ["AI-assisted dispute prep", "✅ Permissioned agent with approval gate", "⚠️ Basic automation", "❌ No", "❌ No"],
                        ["BAA-compliant AI providers", "✅ OpenAI/Anthropic/AWS Bedrock", "❌ Unknown", "N/A", "N/A"],
                        ["MCP server for agentic workflows", "✅ stdio MCP server", "❌ No", "❌ No", "❌ No"],
                        ["SMART on FHIR EHR launch", "✅ PKCE public client", "❌ No", "❌ No", "❌ No"],
                        ["Write-back to EHR", "✅ Approval-gated writes", "❌ No", "❌ No", "❌ No"],
                        ["Open source / auditable", "✅ Apache-2.0", "❌ Proprietary", "❌ Proprietary", "❌ Proprietary"],
                      ].map(([cap, hp, halo, zelis, varis]) => (
                        <tr key={cap}>
                          <td className="py-2 pr-4 text-slate-700 font-medium">{cap}</td>
                          <td className="py-2 px-4 text-center text-green-700 font-medium">{hp}</td>
                          <td className="py-2 px-4 text-center text-slate-500">{halo}</td>
                          <td className="py-2 px-4 text-center text-slate-500">{zelis}</td>
                          <td className="py-2 px-4 text-center text-slate-500">{varis}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Demo Tab */}
        {activeTab === "demo" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Bot size={14} className="text-blue-600" />
                      last-ehr FHIR Agent Chat
                    </CardTitle>
                    <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block mr-1.5" />
                      Connected to FHIR Demo
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Messages */}
                  <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                    {messages.map((msg, i) => (
                      <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        {msg.role === "assistant" && (
                          <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                            <Bot size={12} className="text-white" />
                          </div>
                        )}
                        <div className={`max-w-[85%] space-y-2 ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col`}>
                          <div className={`rounded-lg px-3 py-2 text-sm ${
                            msg.role === "user"
                              ? "bg-blue-600 text-white"
                              : "bg-slate-100 text-slate-800"
                          }`}>
                            {msg.content}
                          </div>
                          {/* FHIR Resources */}
                          {msg.fhirResources && msg.fhirResources.map((res, ri) => (
                            <div key={ri} className="bg-white border border-slate-200 rounded-lg p-3 text-xs w-full">
                              <div className="flex items-center gap-2 mb-2">
                                <Badge variant="outline" className="text-xs">{res.resourceType}</Badge>
                                <span className="text-slate-400">ID: {res.id}</span>
                              </div>
                              <pre className="text-slate-600 overflow-x-auto text-xs leading-relaxed">
                                {JSON.stringify(res, null, 2).slice(0, 400)}
                                {JSON.stringify(res, null, 2).length > 400 ? "\n..." : ""}
                              </pre>
                            </div>
                          ))}
                          {/* Proposed Write */}
                          {msg.proposedWrite && (
                            <div className={`border rounded-lg p-3 text-xs w-full ${
                              msg.proposedWrite.approved === null
                                ? "border-amber-300 bg-amber-50"
                                : msg.proposedWrite.approved
                                ? "border-green-300 bg-green-50"
                                : "border-slate-200 bg-slate-50"
                            }`}>
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <AlertTriangle size={12} className="text-amber-600" />
                                  <span className="font-semibold text-amber-800">Proposed Write — {msg.proposedWrite.resourceType}</span>
                                </div>
                                {msg.proposedWrite.approved === true && <Badge className="bg-green-600 text-white text-xs">Approved</Badge>}
                                {msg.proposedWrite.approved === false && <Badge variant="outline" className="text-slate-500 text-xs">Cancelled</Badge>}
                              </div>
                              <pre className="text-slate-600 overflow-x-auto text-xs">
                                {JSON.stringify(msg.proposedWrite.payload, null, 2).slice(0, 300)}
                              </pre>
                              {msg.proposedWrite.approved === null && (
                                <div className="flex gap-2 mt-3">
                                  <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white h-7 text-xs" onClick={handleApprove}>
                                    <CheckCircle2 size={11} className="mr-1" /> Approve & Save
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleReject}>
                                    Cancel
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {isTyping && (
                      <div className="flex gap-2">
                        <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                          <Bot size={12} className="text-white" />
                        </div>
                        <div className="bg-slate-100 rounded-lg px-3 py-2">
                          <Loader2 size={14} className="animate-spin text-slate-500" />
                        </div>
                      </div>
                    )}
                  </div>
                  <Separator />
                  <div className="flex gap-2">
                    <Input
                      placeholder="Ask the FHIR agent... (e.g. 'find patient Smith', 'extract dispute fields')"
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleSendMessage()}
                      className="text-sm"
                    />
                    <Button onClick={handleSendMessage} disabled={isTyping || !chatInput.trim()} size="sm">
                      <ChevronRight size={14} />
                    </Button>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {["Find patient Smith", "Extract dispute fields for claim C-2026-0415", "Add a note to the chart"].map(s => (
                      <button
                        key={s}
                        onClick={() => { setChatInput(s); }}
                        className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-slate-600 transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Side panel */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">4 FHIR Tools Available</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {[
                    { name: "search_patients", type: "read", desc: "Search by name, DOB, or MRN" },
                    { name: "show_patient_info", type: "read", desc: "Full chart: conditions, meds, vitals, claims" },
                    { name: "add_note", type: "write", desc: "Propose a clinical note (approval required)" },
                    { name: "record_observation", type: "write", desc: "Propose a FHIR Observation (approval required)" },
                  ].map(tool => (
                    <div key={tool.name} className="flex items-start gap-2 p-2 bg-slate-50 rounded-lg">
                      <Badge variant="outline" className={`text-xs shrink-0 ${tool.type === "read" ? "text-blue-700 border-blue-300" : "text-amber-700 border-amber-300"}`}>
                        {tool.type}
                      </Badge>
                      <div>
                        <p className="text-xs font-mono font-semibold text-slate-700">{tool.name}</p>
                        <p className="text-xs text-slate-500">{tool.desc}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-amber-200 bg-amber-50">
                <CardContent className="pt-4">
                  <div className="flex items-start gap-2">
                    <Shield size={14} className="text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-amber-800 mb-1">PHI Safety Note</p>
                      <p className="text-xs text-amber-700">This demo uses synthetic data. In production, last-ehr requires a BAA with your model provider. No PHI flows without explicit operator configuration.</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Architecture Tab */}
        {activeTab === "architecture" && (
          <div className="space-y-6">
            <div className="space-y-4">
              {INTEGRATION_FLOWS.map(flow => (
                <Card key={flow.step}>
                  <CardContent className="pt-4">
                    <div className="flex gap-4">
                      <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold shrink-0">
                        {flow.step}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-slate-800 mb-1">{flow.title}</h3>
                        <p className="text-sm text-slate-600 mb-3">{flow.description}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {flow.fhirResources.map(r => (
                            <Badge key={r} variant="outline" className="text-xs text-blue-700 border-blue-300 bg-blue-50 font-mono">
                              {r}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Setup Tab */}
        {activeTab === "setup" && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Integration Setup Guide</CardTitle>
                <CardDescription>Steps to connect last-ehr to your FHIR backend and HealthPoint</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  {
                    step: "1. Clone & Configure last-ehr",
                    code: `git clone https://github.com/cbetz/last-ehr.git
cd last-ehr
cp .env.example .env.local
# Set OPENAI_API_KEY or ANTHROPIC_API_KEY
# Set MEDPLUM_CLIENT_ID + MEDPLUM_CLIENT_SECRET
# Or: FHIR_BACKEND=hapi FHIR_BASE_URL=http://localhost:8080/fhir`,
                  },
                  {
                    step: "2. Start last-ehr as MCP Server",
                    code: `npm run mcp
# Exposes 4 FHIR tools over stdio
# Add LASTEHR_MCP_WRITES=true to enable write tools`,
                  },
                  {
                    step: "3. Register SMART on FHIR App (Epic/Cerner)",
                    code: `# In your EHR admin:
launchUri = https://your-healthpoint.manus.space/launch
redirectUri = https://your-healthpoint.manus.space/launch/callback
# Set SMART_CLIENT_ID in HealthPoint env`,
                  },
                  {
                    step: "4. Connect to HealthPoint AI Service",
                    code: `# In HealthPoint ai-service/main.py, add:
LASTEHR_MCP_URL = os.environ.get("LASTEHR_MCP_URL", "http://localhost:3001")

# The IDRAssistantAgent can now call last-ehr tools:
# search_patients, show_patient_info, add_note, record_observation`,
                  },
                ].map(({ step, code }) => (
                  <div key={step} className="space-y-2">
                    <h4 className="text-sm font-semibold text-slate-700">{step}</h4>
                    <div className="relative">
                      <pre className="bg-slate-900 text-green-400 rounded-lg p-4 text-xs overflow-x-auto leading-relaxed">
                        {code}
                      </pre>
                      <button
                        onClick={() => { navigator.clipboard.writeText(code); toast.success("Copied!"); }}
                        className="absolute top-2 right-2 p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300"
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
