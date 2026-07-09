import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Download, Play, X, RefreshCw, CheckCircle2, AlertCircle,
  Clock, Database, FileText, Users, Layers, Info
} from "lucide-react";

const RESOURCE_TYPES = [
  { id: "Patient", label: "Patient", desc: "Demographics, identifiers", idrRelevant: true },
  { id: "Claim", label: "Claim", desc: "Billed services, amounts", idrRelevant: true },
  { id: "Coverage", label: "Coverage", desc: "Insurance plan details", idrRelevant: true },
  { id: "ExplanationOfBenefit", label: "ExplanationOfBenefit", desc: "Adjudication details, QPA", idrRelevant: true },
  { id: "Organization", label: "Organization", desc: "Facility, payer info", idrRelevant: true },
  { id: "Practitioner", label: "Practitioner", desc: "Provider NPI, specialty", idrRelevant: true },
  { id: "ServiceRequest", label: "ServiceRequest", desc: "Prior auth requests", idrRelevant: false },
  { id: "Encounter", label: "Encounter", desc: "Visit details", idrRelevant: false },
  { id: "Condition", label: "Condition", desc: "Diagnosis codes", idrRelevant: false },
  { id: "Procedure", label: "Procedure", desc: "Procedure codes", idrRelevant: false },
];

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  pending:     { color: "bg-amber-100 text-amber-700", icon: <Clock size={11} />, label: "Pending" },
  in_progress: { color: "bg-blue-100 text-blue-700",  icon: <RefreshCw size={11} className="animate-spin" />, label: "In Progress" },
  completed:   { color: "bg-green-100 text-green-700", icon: <CheckCircle2 size={11} />, label: "Completed" },
  failed:      { color: "bg-red-100 text-red-700",    icon: <AlertCircle size={11} />, label: "Failed" },
  cancelled:   { color: "bg-slate-100 text-slate-600", icon: <X size={11} />, label: "Cancelled" },
};

export default function BulkFHIRExport() {
  const [selectedEmrId, setSelectedEmrId] = useState("");
  const [exportType, setExportType] = useState<"Patient" | "Group" | "System">("Patient");
  const [selectedResources, setSelectedResources] = useState<string[]>(["Patient", "Claim", "Coverage", "ExplanationOfBenefit"]);
  const [since, setSince] = useState("");

  const { data: emrConnections } = trpc.emr.list.useQuery();
  const { data: jobs, refetch } = trpc.bulkFhir.listJobs.useQuery({ emrConnectionId: selectedEmrId || undefined });

  const startMutation = trpc.bulkFhir.startExport.useMutation({
    onSuccess: () => { toast.success("Bulk FHIR export job started"); refetch(); },
    onError: () => toast.error("Failed to start export job"),
  });

  const cancelMutation = trpc.bulkFhir.cancelJob.useMutation({
    onSuccess: () => { toast.success("Job cancelled"); refetch(); },
    onError: () => toast.error("Failed to cancel job"),
  });

  const toggleResource = (id: string) => {
    setSelectedResources(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]);
  };

  const handleStart = () => {
    if (!selectedEmrId) { toast.error("Please select an EMR connection"); return; }
    if (selectedResources.length === 0) { toast.error("Please select at least one resource type"); return; }
    startMutation.mutate({ emrConnectionId: selectedEmrId, exportType, resourceTypes: selectedResources, since: since || undefined });
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 bg-blue-600 rounded-lg"><Download size={18} className="text-white" /></div>
              <h1 className="text-2xl font-bold text-slate-900">Bulk FHIR Export</h1>
            </div>
            <p className="text-sm text-slate-500 ml-11">FHIR Bulk Data Access ($export) — extract large datasets from connected EMRs for batch dispute creation</p>
            <div className="flex items-center gap-2 mt-1 ml-11">
              <Badge variant="outline" className="text-xs text-blue-700 border-blue-300">FHIR R4 Bulk Data v1.0</Badge>
              <Badge variant="outline" className="text-xs text-green-700 border-green-300">NDJSON Output</Badge>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()} className="gap-1.5"><RefreshCw size={12} />Refresh</Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* New Export Job */}
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Play size={14} className="text-blue-600" />New Export Job</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">EMR Connection</label>
                  <select value={selectedEmrId} onChange={e => setSelectedEmrId(e.target.value)} className="w-full text-sm border border-slate-200 rounded-md px-2 h-9 bg-white">
                    <option value="">Select EMR...</option>
                    {emrConnections?.map((emr: { id: string; emrSystem: string; name?: string }) => (
                      <option key={emr.id} value={emr.id}>{emr.name || emr.emrSystem}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Export Level</label>
                  <div className="grid grid-cols-3 gap-1">
                    {(["Patient", "Group", "System"] as const).map(type => (
                      <button key={type} onClick={() => setExportType(type)}
                        className={`py-1.5 text-xs rounded border font-medium transition-colors ${exportType === type ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"}`}>
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Since (optional)</label>
                  <input type="date" value={since} onChange={e => setSince(e.target.value)} className="w-full text-sm border border-slate-200 rounded-md px-2 h-9 bg-white" />
                  <p className="text-xs text-slate-400 mt-0.5">Only export resources modified after this date</p>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-2">Resource Types</label>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {RESOURCE_TYPES.map(rt => (
                      <label key={rt.id} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={selectedResources.includes(rt.id)} onChange={() => toggleResource(rt.id)} className="rounded" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-slate-700">{rt.label}</span>
                            {rt.idrRelevant && <Badge variant="outline" className="text-xs px-1 py-0 text-amber-600 border-amber-300">IDR</Badge>}
                          </div>
                          <p className="text-xs text-slate-400">{rt.desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <Separator />
                <Button className="w-full gap-1.5" onClick={handleStart} disabled={startMutation.isPending}>
                  {startMutation.isPending ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}
                  Start Export Job
                </Button>
              </CardContent>
            </Card>

            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="pt-4">
                <div className="flex items-start gap-2">
                  <Info size={13} className="text-amber-600 mt-0.5 shrink-0" />
                  <div className="text-xs text-amber-700 space-y-1">
                    <p className="font-semibold">Bulk Export Notes</p>
                    <p>Bulk exports run asynchronously. Large datasets (100k+ records) may take 10–30 minutes.</p>
                    <p>Output is NDJSON format. Each completed job auto-maps resources to IDR dispute fields.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Jobs List */}
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Export Jobs ({jobs?.length ?? 0})</h2>
            </div>
            {!jobs || jobs.length === 0 ? (
              <Card className="flex items-center justify-center h-48">
                <div className="text-center text-slate-400">
                  <Database size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No export jobs yet. Start a new export above.</p>
                </div>
              </Card>
            ) : (
              jobs.map((job: { id: string; status: string; exportType: string; resourceTypes: unknown; progress: number | null; totalRecords: number | null; disputesCreated: number | null; createdAt: Date | null; completedAt?: Date | null; errorMessage?: string | null }) => {
                const statusCfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.pending;
                const resources = (job.resourceTypes as string[]) ?? [];
                return (
                  <Card key={job.id}>
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs text-slate-400">{job.id.slice(0, 8)}</span>
                            <Badge className={`text-xs gap-1 ${statusCfg.color}`}>{statusCfg.icon}{statusCfg.label}</Badge>
                            <Badge variant="outline" className="text-xs text-slate-500">{job.exportType} Export</Badge>
                          </div>
                          <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                            <span className="flex items-center gap-1"><FileText size={10} />{resources.length} resource types</span>
                            {job.totalRecords != null && job.totalRecords > 0 && <span className="flex items-center gap-1"><Users size={10} />{job.totalRecords.toLocaleString()} records</span>}
                            {job.disputesCreated != null && job.disputesCreated > 0 && <span className="flex items-center gap-1 text-green-600"><CheckCircle2 size={10} />{job.disputesCreated} disputes created</span>}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {resources.slice(0, 5).map((r: string) => <span key={r} className="text-xs px-1.5 py-0.5 bg-slate-100 rounded text-slate-600">{r}</span>)}
                            {resources.length > 5 && <span className="text-xs text-slate-400">+{resources.length - 5} more</span>}
                          </div>
                          {job.status === "in_progress" && (
                            <div className="mt-2">
                              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                                <span>Progress</span><span>{job.progress ?? 0}%</span>
                              </div>
                              <div className="w-full bg-slate-100 rounded-full h-1.5">
                                <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${job.progress ?? 0}%` }} />
                              </div>
                            </div>
                          )}
                          {job.errorMessage && <p className="text-xs text-red-600 mt-1">{job.errorMessage}</p>}
                          <p className="text-xs text-slate-400 mt-1">Started: {job.createdAt ? new Date(job.createdAt).toLocaleString() : "—"}</p>
                        </div>
                        <div className="flex flex-col gap-2">
                          {job.status === "completed" && (
                            <Button size="sm" variant="outline" className="gap-1 text-xs"><Download size={11} />Download</Button>
                          )}
                          {["pending", "in_progress"].includes(job.status) && (
                            <Button size="sm" variant="outline" className="gap-1 text-xs text-red-600 border-red-200 hover:bg-red-50"
                              onClick={() => cancelMutation.mutate({ jobId: job.id })} disabled={cancelMutation.isPending}>
                              <X size={11} />Cancel
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
