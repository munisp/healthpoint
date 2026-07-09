import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Activity, CheckCircle2, XCircle, RefreshCw, Zap, Database,
  Shield, Download, Info, Code, Server, ChevronDown, ChevronUp
} from "lucide-react";

const FHIR_RESOURCES = [
  "Patient", "Claim", "Coverage", "Organization", "Practitioner",
  "ExplanationOfBenefit", "ServiceRequest", "Encounter", "Condition",
  "Procedure", "DiagnosticReport", "Observation", "MedicationRequest",
  "AllergyIntolerance", "DocumentReference", "Binary", "Bundle",
  "CapabilityStatement", "OperationOutcome",
];

const SMART_SCOPES = [
  { scope: "openid", desc: "OpenID Connect identity", required: true },
  { scope: "profile", desc: "User profile information", required: true },
  { scope: "launch", desc: "EHR launch context", required: true },
  { scope: "launch/patient", desc: "Patient launch context", required: false },
  { scope: "patient/*.read", desc: "Read all patient resources", required: true },
  { scope: "user/*.read", desc: "Read all user-accessible resources", required: false },
  { scope: "system/Claim.read", desc: "System-level claim access", required: false },
  { scope: "system/Coverage.read", desc: "System-level coverage access", required: false },
];

const DA_VINCI_IGs = [
  { id: "pdex", name: "PDEX — Payer Data Exchange", version: "2.0.0", status: "active", description: "Exchange payer network data and member attribution lists" },
  { id: "pas", name: "PAS — Prior Authorization Support", version: "2.0.1", status: "active", description: "Submit and track prior authorization requests via FHIR" },
  { id: "crd", name: "CRD — Coverage Requirements Discovery", version: "2.0.0", status: "active", description: "Discover coverage requirements at point of care via CDS Hooks" },
  { id: "dtr", name: "DTR — Documentation Templates & Rules", version: "2.0.0", status: "active", description: "Retrieve and complete payer-required documentation" },
  { id: "hrex", name: "HRex — Health Record Exchange", version: "1.0.0", status: "active", description: "Foundation for Da Vinci data exchange patterns" },
  { id: "pdex-plan-net", name: "PDEX Plan Net — Provider Directory", version: "1.1.0", status: "draft", description: "Standardized provider directory for network adequacy" },
];

export default function FHIRCapabilityExplorer() {
  const [selectedEmrId, setSelectedEmrId] = useState<string>("");
  const [expandedResource, setExpandedResource] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"resources" | "smart" | "davinci" | "r5">("resources");

  const { data: emrConnections } = trpc.emr.list.useQuery();
  const { data: capabilities, refetch: refetchCaps } = trpc.fhirCapability.list.useQuery(
    { emrConnectionId: selectedEmrId },
    { enabled: !!selectedEmrId }
  );

  const fetchCapMutation = trpc.fhirCapability.fetch.useMutation({
    onSuccess: () => {
      toast.success("Capability statement fetched and stored");
      refetchCaps();
    },
    onError: () => toast.error("Failed to fetch capability statement"),
  });

  const cap = capabilities?.[0];
  const supportedResources = (cap?.supportedResources as string[]) ?? [];
  const smartScopes = (cap?.smartScopes as string[]) ?? [];

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 bg-indigo-600 rounded-lg"><Activity size={18} className="text-white" /></div>
              <h1 className="text-2xl font-bold text-slate-900">FHIR Capability Explorer</h1>
            </div>
            <p className="text-sm text-slate-500 ml-11">Inspect FHIR R4/R5 CapabilityStatements, SMART scopes, Da Vinci IGs, and resource support across connected EMRs</p>
          </div>
        </div>

        {/* EMR Selector */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Server size={14} className="text-slate-500" />
                <span className="text-sm font-medium text-slate-700">Connected EMR:</span>
              </div>
              <select
                value={selectedEmrId}
                onChange={e => setSelectedEmrId(e.target.value)}
                className="text-sm border border-slate-200 rounded-md px-3 h-9 bg-white min-w-[220px]"
              >
                <option value="">Select an EMR connection...</option>
                {emrConnections?.map((emr: { id: string; emrSystem: string; name?: string }) => (
                  <option key={emr.id} value={emr.id}>{emr.name || emr.emrSystem}</option>
                ))}
              </select>
              {selectedEmrId && (
                <Button
                  size="sm"
                  onClick={() => fetchCapMutation.mutate({ emrConnectionId: selectedEmrId })}
                  disabled={fetchCapMutation.isPending}
                  className="gap-1.5"
                >
                  {fetchCapMutation.isPending ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />}
                  Fetch CapabilityStatement
                </Button>
              )}
              {cap && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <CheckCircle2 size={12} className="text-green-500" />
                  Last fetched: {new Date(cap.fetchedAt!).toLocaleString()}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* FHIR Version Banner */}
        {cap && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "FHIR Version", value: cap.fhirVersion || "R4", color: "text-indigo-700" },
              { label: "Resources", value: `${supportedResources.length}`, color: "text-blue-700" },
              { label: "SMART Scopes", value: `${smartScopes.length}`, color: "text-green-700" },
              { label: "Bulk Export", value: cap.bulkExportSupported ? "Supported" : "Not Supported", color: cap.bulkExportSupported ? "text-green-700" : "text-red-600" },
            ].map(({ label, value, color }) => (
              <Card key={label} className="text-center py-3">
                <p className={`text-xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{label}</p>
              </Card>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-200">
          {(["resources", "smart", "davinci", "r5"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${activeTab === tab ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
              {tab === "resources" ? "FHIR Resources" : tab === "smart" ? "SMART on FHIR" : tab === "davinci" ? "Da Vinci IGs" : "FHIR R5 Roadmap"}
            </button>
          ))}
        </div>

        {/* FHIR Resources Tab */}
        {activeTab === "resources" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Info size={13} className="text-slate-400" />
              <p className="text-xs text-slate-500">Resources relevant to IDR: Patient, Claim, Coverage, Organization, ExplanationOfBenefit, Practitioner</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {FHIR_RESOURCES.map(resource => {
                const isSupported = !cap || supportedResources.includes(resource);
                const isIDRCritical = ["Patient", "Claim", "Coverage", "Organization", "ExplanationOfBenefit"].includes(resource);
                return (
                  <button
                    key={resource}
                    onClick={() => setExpandedResource(expandedResource === resource ? null : resource)}
                    className={`flex items-center justify-between p-3 rounded-lg border text-sm transition-all ${isSupported ? "bg-green-50 border-green-200 text-green-800" : "bg-slate-50 border-slate-200 text-slate-400"} ${expandedResource === resource ? "ring-2 ring-indigo-300" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      {isSupported ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                      <span className="font-medium">{resource}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {isIDRCritical && <Badge variant="outline" className="text-xs px-1 py-0 text-amber-600 border-amber-300">IDR</Badge>}
                      {expandedResource === resource ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </div>
                  </button>
                );
              })}
            </div>
            {expandedResource && (
              <Card className="border-indigo-200 bg-indigo-50">
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <Code size={14} className="text-indigo-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-indigo-800 mb-2">{expandedResource} — IDR Relevance</p>
                      <div className="text-sm text-indigo-700 space-y-1">
                        {expandedResource === "Patient" && <p>Maps to: patient name, DOB, address, insurance member ID. Required for USCDI v3 completeness.</p>}
                        {expandedResource === "Claim" && <p>Maps to: billed amount, procedure codes (CPT), diagnosis codes (ICD-10), service date, billing provider NPI.</p>}
                        {expandedResource === "Coverage" && <p>Maps to: payer name, plan type, member ID, group number, coverage period.</p>}
                        {expandedResource === "Organization" && <p>Maps to: facility name, NPI, address, tax ID. Required for facility-based disputes.</p>}
                        {expandedResource === "ExplanationOfBenefit" && <p>Maps to: adjudicated amounts, QPA, allowed amount, denial reason codes. Critical for NSA IDR disputes.</p>}
                        {expandedResource === "Practitioner" && <p>Maps to: rendering provider NPI, specialty, credentials.</p>}
                        {!["Patient","Claim","Coverage","Organization","ExplanationOfBenefit","Practitioner"].includes(expandedResource) && <p>Supplementary resource — used for clinical context and documentation.</p>}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* SMART on FHIR Tab */}
        {activeTab === "smart" && (
          <div className="space-y-4">
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <Shield size={14} className="text-blue-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-blue-800 mb-1">SMART on FHIR v2 (HL7 SMART App Launch 2.0)</p>
                    <p className="text-sm text-blue-700">HealthPoint IDR uses SMART on FHIR for secure EMR authorization. OAuth 2.0 + PKCE flow with granular scope control. Tokens are stored encrypted and refreshed automatically.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <div className="space-y-2">
              {SMART_SCOPES.map(({ scope, desc, required }) => {
                const isGranted = !cap || smartScopes.includes(scope);
                return (
                  <div key={scope} className={`flex items-center justify-between p-3 rounded-lg border ${isGranted ? "bg-green-50 border-green-200" : "bg-slate-50 border-slate-200"}`}>
                    <div className="flex items-center gap-3">
                      {isGranted ? <CheckCircle2 size={13} className="text-green-600" /> : <XCircle size={13} className="text-slate-400" />}
                      <div>
                        <code className="text-xs font-mono font-semibold text-slate-800">{scope}</code>
                        <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {required && <Badge variant="outline" className="text-xs text-red-600 border-red-300">Required</Badge>}
                      {isGranted ? <Badge className="text-xs bg-green-100 text-green-700 border-green-300">Granted</Badge> : <Badge variant="outline" className="text-xs text-slate-400">Not Granted</Badge>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Da Vinci IGs Tab */}
        {activeTab === "davinci" && (
          <div className="space-y-4">
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <Info size={14} className="text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-sm text-amber-700">Da Vinci Implementation Guides extend FHIR for payer-provider interoperability. HealthPoint IDR supports PAS (Prior Auth) and CRD (Coverage Requirements) for NSA compliance workflows.</p>
                </div>
              </CardContent>
            </Card>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {DA_VINCI_IGs.map(ig => (
                <Card key={ig.id} className={`border-2 ${ig.status === "active" ? "border-green-200" : "border-slate-200"}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-sm font-semibold text-slate-800">{ig.name}</CardTitle>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-xs text-slate-500">v{ig.version}</Badge>
                        <Badge className={`text-xs ${ig.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>{ig.status}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-slate-600">{ig.description}</p>
                    {ig.id === "pas" && (
                      <div className="mt-2 p-2 bg-blue-50 rounded text-xs text-blue-700">
                        <strong>NSA Relevance:</strong> PAS enables real-time prior authorization for services subject to NSA, reducing disputes before they start.
                      </div>
                    )}
                    {ig.id === "crd" && (
                      <div className="mt-2 p-2 bg-blue-50 rounded text-xs text-blue-700">
                        <strong>NSA Relevance:</strong> CRD surfaces coverage requirements at point of care, preventing surprise billing at the source.
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* FHIR R5 Roadmap Tab */}
        {activeTab === "r5" && (
          <div className="space-y-4">
            <Card className="border-purple-200 bg-purple-50">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <Database size={14} className="text-purple-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-purple-800 mb-1">FHIR R5 Upgrade Roadmap</p>
                    <p className="text-sm text-purple-700">FHIR R5 (published 2023) introduces significant improvements for financial workflows. HealthPoint IDR is planning R5 support for 2026 Q3.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <div className="space-y-3">
              {[
                { feature: "Invoice Resource (R5)", desc: "Native financial invoice resource replaces Claim workarounds for IDR billing", impact: "High", status: "planned" },
                { feature: "ExplanationOfBenefit R5 Enhancements", desc: "Improved adjudication detail fields, QPA support, and NSA-specific extensions", impact: "High", status: "planned" },
                { feature: "Subscription R5 (Topic-Based)", desc: "Replace polling with real-time push notifications for dispute status changes", impact: "Medium", status: "in_progress" },
                { feature: "Bulk Data Export v2", desc: "Improved $export operation with patient-level and group-level granularity", impact: "Medium", status: "planned" },
                { feature: "FHIR Shorthand (FSH) Profiles", desc: "Formal IDR-specific FHIR profiles for Claim, Coverage, and ExplanationOfBenefit", impact: "High", status: "in_progress" },
                { feature: "AuditEvent R5", desc: "Enhanced audit logging with DICOM-aligned structure for regulatory compliance", impact: "Medium", status: "planned" },
                { feature: "Requirements Resource", desc: "Machine-readable NSA compliance requirements as FHIR Requirements resources", impact: "Low", status: "research" },
                { feature: "ActorDefinition Resource", desc: "Formal definition of IDR actors (Provider, Payer, IDR Entity) as FHIR ActorDefinitions", impact: "Low", status: "research" },
              ].map(({ feature, desc, impact, status }) => (
                <div key={feature} className="flex items-start justify-between p-3 rounded-lg border border-slate-200 bg-white gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-800">{feature}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className={`text-xs ${impact === "High" ? "text-red-600 border-red-300" : impact === "Medium" ? "text-amber-600 border-amber-300" : "text-slate-500"}`}>{impact} Impact</Badge>
                    <Badge className={`text-xs ${status === "in_progress" ? "bg-blue-100 text-blue-700" : status === "planned" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                      {status === "in_progress" ? "In Progress" : status === "planned" ? "Planned" : "Research"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
