import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Zap, Plus, CheckCircle2, XCircle, Info, Code, RefreshCw, ToggleLeft, ToggleRight } from "lucide-react";

const STANDARD_HOOKS = [
  { hookId: "patient-view", title: "Patient View", desc: "Fires when a clinician opens a patient record. Use to surface IDR eligibility and balance billing risk.", nsa: true },
  { hookId: "order-sign", title: "Order Sign", desc: "Fires when a clinician signs an order. Use to check NSA coverage requirements before service.", nsa: true },
  { hookId: "order-select", title: "Order Select", desc: "Fires when a clinician selects an order. Use to surface QPA benchmarks for the selected CPT code.", nsa: true },
  { hookId: "appointment-book", title: "Appointment Book", desc: "Fires when scheduling a patient appointment. Use to warn about out-of-network providers.", nsa: false },
  { hookId: "encounter-start", title: "Encounter Start", desc: "Fires at encounter start. Use to verify coverage and pre-authorize services.", nsa: false },
  { hookId: "encounter-discharge", title: "Encounter Discharge", desc: "Fires at discharge. Use to trigger NSA good-faith estimate generation.", nsa: true },
];

export default function CDSHooksManager() {
  const [selectedEmrId, setSelectedEmrId] = useState("");
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [newHook, setNewHook] = useState({ hookId: "", title: "", description: "" });

  const { data: emrConnections } = trpc.emr.list.useQuery();
  const { data: hooks, refetch } = trpc.cdsHooksRouter.list.useQuery(
    { emrConnectionId: selectedEmrId },
    { enabled: !!selectedEmrId }
  );

  const registerMutation = trpc.cdsHooksRouter.register.useMutation({
    onSuccess: () => { toast.success("CDS Hook registered"); refetch(); setShowRegisterForm(false); setNewHook({ hookId: "", title: "", description: "" }); },
    onError: () => toast.error("Failed to register hook"),
  });

  const toggleMutation = trpc.cdsHooksRouter.toggleStatus.useMutation({
    onSuccess: () => { toast.success("Hook status updated"); refetch(); },
    onError: () => toast.error("Failed to update hook status"),
  });

  const handleRegisterStandard = (hook: typeof STANDARD_HOOKS[0]) => {
    if (!selectedEmrId) { toast.error("Please select an EMR connection first"); return; }
    registerMutation.mutate({ emrConnectionId: selectedEmrId, hookId: hook.hookId, title: hook.title, description: hook.desc });
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 bg-violet-600 rounded-lg"><Zap size={18} className="text-white" /></div>
              <h1 className="text-2xl font-bold text-slate-900">CDS Hooks Manager</h1>
            </div>
            <p className="text-sm text-slate-500 ml-11">Clinical Decision Support Hooks — inject IDR intelligence into EHR workflows at the point of care</p>
            <div className="flex items-center gap-2 mt-1 ml-11">
              <Badge variant="outline" className="text-xs text-violet-700 border-violet-300">CDS Hooks 2.0</Badge>
              <Badge variant="outline" className="text-xs text-blue-700 border-blue-300">SMART on FHIR</Badge>
            </div>
          </div>
        </div>

        {/* EMR Selector */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm font-medium text-slate-700">EMR Connection:</span>
              <select value={selectedEmrId} onChange={e => setSelectedEmrId(e.target.value)}
                className="text-sm border border-slate-200 rounded-md px-3 h-9 bg-white min-w-[220px]">
                <option value="">Select an EMR...</option>
                {emrConnections?.map((emr: { id: string; emrSystem: string; name?: string }) => (
                  <option key={emr.id} value={emr.id}>{emr.name || emr.emrSystem}</option>
                ))}
              </select>
              {selectedEmrId && (
                <Button size="sm" onClick={() => setShowRegisterForm(!showRegisterForm)} className="gap-1.5">
                  <Plus size={12} />Register Custom Hook
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Register Custom Hook Form */}
        {showRegisterForm && (
          <Card className="border-violet-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2"><Code size={13} className="text-violet-600" />Register Custom CDS Hook</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Hook ID</label>
                  <Input placeholder="e.g. patient-view" value={newHook.hookId} onChange={e => setNewHook(p => ({ ...p, hookId: e.target.value }))} className="text-sm h-9" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Title</label>
                  <Input placeholder="Human-readable name" value={newHook.title} onChange={e => setNewHook(p => ({ ...p, title: e.target.value }))} className="text-sm h-9" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Description</label>
                <Input placeholder="What does this hook do?" value={newHook.description} onChange={e => setNewHook(p => ({ ...p, description: e.target.value }))} className="text-sm h-9" />
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => registerMutation.mutate({ emrConnectionId: selectedEmrId, hookId: newHook.hookId, title: newHook.title, description: newHook.description })} disabled={!newHook.hookId || !newHook.title || registerMutation.isPending} className="gap-1.5">
                  {registerMutation.isPending ? <RefreshCw size={11} className="animate-spin" /> : <Plus size={11} />}Register
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowRegisterForm(false)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Standard NSA Hooks */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2"><Info size={13} className="text-violet-600" />Standard CDS Hooks for NSA/IDR</h2>
            {STANDARD_HOOKS.map(hook => {
              const isRegistered = hooks?.some((h: { hookId: string }) => h.hookId === hook.hookId);
              return (
                <Card key={hook.hookId} className={`border-2 ${isRegistered ? "border-green-200 bg-green-50" : "border-slate-200"}`}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="text-xs font-mono font-semibold text-slate-700">{hook.hookId}</code>
                          <span className="text-sm font-medium text-slate-800">{hook.title}</span>
                          {hook.nsa && <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">NSA Relevant</Badge>}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">{hook.desc}</p>
                      </div>
                      <div>
                        {isRegistered ? (
                          <Badge className="text-xs bg-green-100 text-green-700 gap-1"><CheckCircle2 size={10} />Registered</Badge>
                        ) : (
                          <Button size="sm" variant="outline" className="text-xs h-7 gap-1"
                            onClick={() => handleRegisterStandard(hook)} disabled={!selectedEmrId || registerMutation.isPending}>
                            <Plus size={10} />Register
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Registered Hooks */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-700">Registered Hooks {hooks ? `(${hooks.length})` : ""}</h2>
            {!selectedEmrId ? (
              <Card className="flex items-center justify-center h-32">
                <p className="text-sm text-slate-400">Select an EMR connection to view registered hooks</p>
              </Card>
            ) : !hooks || hooks.length === 0 ? (
              <Card className="flex items-center justify-center h-32">
                <div className="text-center text-slate-400">
                  <Zap size={24} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No hooks registered yet</p>
                </div>
              </Card>
            ) : (
              hooks.map((hook: { id: string; hookId: string; title: string; description?: string | null; status: string; lastInvokedAt?: Date | null; invocationCount?: number | null }) => (
                <Card key={hook.id} className={`border ${hook.status === "active" ? "border-green-200" : "border-slate-200 opacity-60"}`}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="text-xs font-mono text-slate-600">{hook.hookId}</code>
                          <span className="text-sm font-medium text-slate-800">{hook.title}</span>
                          <Badge className={`text-xs ${hook.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>{hook.status}</Badge>
                        </div>
                        {hook.description && <p className="text-xs text-slate-500 mt-1">{hook.description}</p>}
                        <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                          {hook.invocationCount != null && <span>{hook.invocationCount} invocations</span>}
                          {hook.lastInvokedAt && <span>Last: {new Date(hook.lastInvokedAt).toLocaleDateString()}</span>}
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                        onClick={() => toggleMutation.mutate({ id: hook.id, status: hook.status === "active" ? "inactive" : "active" })}
                        disabled={toggleMutation.isPending}>
                        {hook.status === "active" ? <ToggleRight size={16} className="text-green-600" /> : <ToggleLeft size={16} className="text-slate-400" />}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>

        {/* Architecture Note */}
        <Card className="border-violet-200 bg-violet-50">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <Code size={14} className="text-violet-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-violet-800 mb-2">CDS Hooks Architecture for NSA Compliance</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-violet-700">
                  <div className="p-2 bg-white rounded border border-violet-200">
                    <p className="font-semibold mb-1">1. Hook Trigger</p>
                    <p>EHR fires hook at clinical event (e.g., order-sign). HealthPoint receives prefetch FHIR resources.</p>
                  </div>
                  <div className="p-2 bg-white rounded border border-violet-200">
                    <p className="font-semibold mb-1">2. IDR Intelligence</p>
                    <p>HealthPoint checks NSA applicability, QPA benchmarks, and network status in real time.</p>
                  </div>
                  <div className="p-2 bg-white rounded border border-violet-200">
                    <p className="font-semibold mb-1">3. CDS Cards</p>
                    <p>Returns CDS Cards with actionable guidance: "This service is subject to NSA — estimated QPA: $X".</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
