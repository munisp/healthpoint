import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  BookTemplate, Plus, Trash2, Edit3, ArrowRight, Copy, Star,
  FileText, Stethoscope, DollarSign, User, Hash, X, CheckCircle2
} from "lucide-react";
import { toast } from "sonner";

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

const PARTY_TYPES = [
  { value: "provider", label: "Provider" },
  { value: "facility", label: "Facility" },
  { value: "payer", label: "Payer" },
  { value: "aggregator", label: "Aggregator" },
];

type TemplateForm = {
  name: string;
  description: string;
  serviceType: string;
  initiatingPartyName: string;
  initiatingPartyType: string;
  respondingPartyName: string;
  respondingPartyType: string;
  billedAmount: string;
  qpaAmount: string;
  dateOfService: string;
  patientName: string;
  claimNumber: string;
  cptCodes: string; // comma-separated
  icdCodes: string; // comma-separated
  notes: string;
};

const EMPTY_FORM: TemplateForm = {
  name: "",
  description: "",
  serviceType: "",
  initiatingPartyName: "",
  initiatingPartyType: "",
  respondingPartyName: "",
  respondingPartyType: "",
  billedAmount: "",
  qpaAmount: "",
  dateOfService: "",
  patientName: "",
  claimNumber: "",
  cptCodes: "",
  icdCodes: "",
  notes: "",
};

export default function DisputeTemplates() {
  const [, navigate] = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any | null>(null);
  const [form, setForm] = useState<TemplateForm>(EMPTY_FORM);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [useConfirmId, setUseConfirmId] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const { data: templates = [], isLoading } = trpc.templates.list.useQuery(undefined, { enabled: isAuthenticated });

  const createMutation = trpc.templates.create.useMutation({
    onSuccess: () => {
      utils.templates.list.invalidate();
      setShowCreateDialog(false);
      setForm(EMPTY_FORM);
      toast.success("Template created successfully");
    },
    onError: (e) => toast.error(`Failed to create template: ${e.message}`),
  });

  const updateMutation = trpc.templates.update.useMutation({
    onSuccess: () => {
      utils.templates.list.invalidate();
      setEditingTemplate(null);
      setForm(EMPTY_FORM);
      toast.success("Template updated");
    },
    onError: (e) => toast.error(`Failed to update template: ${e.message}`),
  });

  const deleteMutation = trpc.templates.delete.useMutation({
    onSuccess: () => {
      utils.templates.list.invalidate();
      setDeleteConfirmId(null);
      toast.success("Template deleted");
    },
    onError: (e) => toast.error(`Failed to delete: ${e.message}`),
  });

  const useMutation = trpc.templates.use.useMutation({
    onSuccess: (template) => {
      // Navigate to new dispute with template data pre-filled via URL params
      const params = new URLSearchParams();
      if (template.serviceType) params.set("serviceType", template.serviceType);
      if (template.initiatingPartyName) params.set("initiatingPartyName", template.initiatingPartyName);
      if (template.initiatingPartyType) params.set("initiatingPartyType", template.initiatingPartyType);
      if (template.respondingPartyName) params.set("respondingPartyName", template.respondingPartyName);
      if (template.respondingPartyType) params.set("respondingPartyType", template.respondingPartyType);
      if (template.billedAmount) params.set("billedAmount", template.billedAmount);
      if (template.qpaAmount) params.set("qpaAmount", template.qpaAmount);
      if (template.patientName) params.set("patientName", template.patientName);
      if (template.claimNumber) params.set("claimNumber", template.claimNumber);
      if (template.notes) params.set("notes", template.notes);
      setUseConfirmId(null);
      navigate(`/disputes/new?${params.toString()}`);
    },
    onError: (e) => toast.error(`Failed to use template: ${e.message}`),
  });

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setShowCreateDialog(true);
  };

  const openEdit = (t: any) => {
    setForm({
      name: t.name ?? "",
      description: t.description ?? "",
      serviceType: t.serviceType ?? "",
      initiatingPartyName: t.initiatingPartyName ?? "",
      initiatingPartyType: t.initiatingPartyType ?? "",
      respondingPartyName: t.respondingPartyName ?? "",
      respondingPartyType: t.respondingPartyType ?? "",
      billedAmount: t.billedAmount ?? "",
      qpaAmount: t.qpaAmount ?? "",
      dateOfService: t.dateOfService ?? "",
      patientName: t.patientName ?? "",
      claimNumber: t.claimNumber ?? "",
      cptCodes: (t.cptCodes ?? []).join(", "),
      icdCodes: (t.icdCodes ?? []).join(", "),
      notes: t.notes ?? "",
    });
    setEditingTemplate(t);
  };

  const handleSubmit = () => {
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      serviceType: form.serviceType || undefined,
      initiatingPartyName: form.initiatingPartyName.trim() || undefined,
      initiatingPartyType: form.initiatingPartyType || undefined,
      respondingPartyName: form.respondingPartyName.trim() || undefined,
      respondingPartyType: form.respondingPartyType || undefined,
      billedAmount: form.billedAmount.trim() || undefined,
      qpaAmount: form.qpaAmount.trim() || undefined,
      dateOfService: form.dateOfService.trim() || undefined,
      patientName: form.patientName.trim() || undefined,
      claimNumber: form.claimNumber.trim() || undefined,
      cptCodes: form.cptCodes ? form.cptCodes.split(",").map(s => s.trim()).filter(Boolean) : [],
      icdCodes: form.icdCodes ? form.icdCodes.split(",").map(s => s.trim()).filter(Boolean) : [],
      notes: form.notes.trim() || undefined,
    };
    if (!payload.name) { toast.error("Template name is required"); return; }
    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const f = (key: keyof TemplateForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }));

  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>
  );

  const filledFieldCount = (t: any) => [
    t.serviceType, t.initiatingPartyName, t.respondingPartyName,
    t.billedAmount, t.qpaAmount, t.patientName, t.claimNumber,
  ].filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <BookTemplate className="text-blue-600" size={24} />
            Dispute Templates
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Save reusable dispute configurations to speed up new dispute creation
          </p>
        </div>
        <Button onClick={openCreate} className="flex items-center gap-2">
          <Plus size={16} />Create Template
        </Button>
      </div>

      {/* Empty state */}
      {!isLoading && templates.length === 0 && (
        <Card className="border-dashed border-2 border-slate-200">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <BookTemplate size={48} className="text-slate-300 mb-4" />
            <h3 className="text-lg font-semibold text-slate-600 mb-2">No templates yet</h3>
            <p className="text-sm text-slate-400 max-w-sm mb-6">
              Create a template to pre-fill common dispute fields and save time when initiating new disputes.
            </p>
            <Button onClick={openCreate} className="flex items-center gap-2">
              <Plus size={16} />Create Your First Template
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
        </div>
      )}

      {/* Templates grid */}
      {!isLoading && templates.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {templates.map((t: any) => (
            <Card key={t.id} className="border-slate-200 hover:border-blue-300 hover:shadow-md transition-all">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base font-semibold text-slate-800 truncate">{t.name}</CardTitle>
                    {t.description && (
                      <CardDescription className="text-xs mt-0.5 line-clamp-2">{t.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openEdit(t)}
                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                      title="Edit template"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(t.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                      title="Delete template"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                {/* Service type badge */}
                {t.serviceType && (
                  <Badge variant="secondary" className="text-xs capitalize">
                    <Stethoscope size={10} className="mr-1" />
                    {t.serviceType.replace(/_/g, " ")}
                  </Badge>
                )}

                {/* Key fields summary */}
                <div className="space-y-1.5 text-xs text-slate-600">
                  {t.initiatingPartyName && (
                    <div className="flex items-center gap-1.5">
                      <User size={11} className="text-slate-400 shrink-0" />
                      <span className="truncate">{t.initiatingPartyName}</span>
                      {t.initiatingPartyType && <span className="text-slate-400">({t.initiatingPartyType})</span>}
                    </div>
                  )}
                  {t.billedAmount && (
                    <div className="flex items-center gap-1.5">
                      <DollarSign size={11} className="text-slate-400 shrink-0" />
                      <span>Billed: ${Number(t.billedAmount).toLocaleString()}</span>
                      {t.qpaAmount && <span className="text-slate-400">· QPA: ${Number(t.qpaAmount).toLocaleString()}</span>}
                    </div>
                  )}
                  {t.claimNumber && (
                    <div className="flex items-center gap-1.5">
                      <Hash size={11} className="text-slate-400 shrink-0" />
                      <span className="truncate">Claim: {t.claimNumber}</span>
                    </div>
                  )}
                  {(t.cptCodes?.length > 0 || t.icdCodes?.length > 0) && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <FileText size={11} className="text-slate-400 shrink-0" />
                      {t.cptCodes?.slice(0, 3).map((c: string) => (
                        <span key={c} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-mono">{c}</span>
                      ))}
                      {t.icdCodes?.slice(0, 2).map((c: string) => (
                        <span key={c} className="px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded text-[10px] font-mono">{c}</span>
                      ))}
                    </div>
                  )}
                </div>

                <Separator />

                {/* Footer: usage count + use button */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <CheckCircle2 size={11} />
                    <span>{t.usageCount ?? 0} use{(t.usageCount ?? 0) !== 1 ? "s" : ""}</span>
                    <span>·</span>
                    <span>{filledFieldCount(t)}/7 fields</span>
                  </div>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setUseConfirmId(t.id)}
                  >
                    <ArrowRight size={12} className="mr-1" />
                    Use Template
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={showCreateDialog || !!editingTemplate} onOpenChange={(open) => {
        if (!open) { setShowCreateDialog(false); setEditingTemplate(null); setForm(EMPTY_FORM); }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookTemplate size={18} className="text-blue-600" />
              {editingTemplate ? "Edit Template" : "Create Dispute Template"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Template metadata */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <Star size={14} className="text-amber-500" />Template Info
              </h3>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <Label className="text-xs font-medium text-slate-600">Template Name *</Label>
                  <Input value={form.name} onChange={f("name")} placeholder="e.g., Emergency Medicine - Standard" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-600">Description</Label>
                  <Textarea value={form.description} onChange={f("description")} placeholder="Brief description of when to use this template..." className="mt-1 h-16 resize-none" />
                </div>
              </div>
            </div>

            <Separator />

            {/* Service & Parties */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <Stethoscope size={14} className="text-blue-500" />Service & Parties
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs font-medium text-slate-600">Service Type</Label>
                  <Select value={form.serviceType} onValueChange={v => setForm(p => ({ ...p, serviceType: v }))}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select service type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {SERVICE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-600">Initiating Party Name</Label>
                  <Input value={form.initiatingPartyName} onChange={f("initiatingPartyName")} placeholder="Provider / Facility name" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-600">Initiating Party Type</Label>
                  <Select value={form.initiatingPartyType} onValueChange={v => setForm(p => ({ ...p, initiatingPartyType: v }))}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {PARTY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-600">Responding Party Name</Label>
                  <Input value={form.respondingPartyName} onChange={f("respondingPartyName")} placeholder="Payer / Insurer name" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-600">Responding Party Type</Label>
                  <Select value={form.respondingPartyType} onValueChange={v => setForm(p => ({ ...p, respondingPartyType: v }))}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {PARTY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator />

            {/* Financial */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <DollarSign size={14} className="text-green-500" />Financial Defaults
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium text-slate-600">Default Billed Amount ($)</Label>
                  <Input value={form.billedAmount} onChange={f("billedAmount")} placeholder="e.g., 5000" type="number" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-600">Default QPA ($)</Label>
                  <Input value={form.qpaAmount} onChange={f("qpaAmount")} placeholder="e.g., 2500" type="number" className="mt-1" />
                </div>
              </div>
            </div>

            <Separator />

            {/* Clinical */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <FileText size={14} className="text-purple-500" />Clinical Codes
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium text-slate-600">CPT Codes (comma-separated)</Label>
                  <Input value={form.cptCodes} onChange={f("cptCodes")} placeholder="e.g., 99285, 99291" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-600">ICD-10 Codes (comma-separated)</Label>
                  <Input value={form.icdCodes} onChange={f("icdCodes")} placeholder="e.g., I21.9, J18.9" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-600">Default Claim Number</Label>
                  <Input value={form.claimNumber} onChange={f("claimNumber")} placeholder="Claim #" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-slate-600">Default Patient Name</Label>
                  <Input value={form.patientName} onChange={f("patientName")} placeholder="Patient name" className="mt-1" />
                </div>
              </div>
              <div>
                <Label className="text-xs font-medium text-slate-600">Notes / Instructions</Label>
                <Textarea value={form.notes} onChange={f("notes")} placeholder="Any notes or instructions for this template..." className="mt-1 h-20 resize-none" />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowCreateDialog(false); setEditingTemplate(null); setForm(EMPTY_FORM); }}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingTemplate ? "Save Changes" : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 size={18} />Delete Template
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            Are you sure you want to delete this template? This action cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && deleteMutation.mutate({ id: deleteConfirmId })}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Use Template Confirm Dialog */}
      <Dialog open={!!useConfirmId} onOpenChange={(open) => { if (!open) setUseConfirmId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-blue-600">
              <ArrowRight size={18} />Use Template
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            This will open the New Dispute wizard with the template fields pre-filled. You can review and modify any field before submitting.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setUseConfirmId(null)}>Cancel</Button>
            <Button
              onClick={() => useConfirmId && useMutation.mutate({ id: useConfirmId })}
              disabled={useMutation.isPending}
            >
              {useMutation.isPending ? "Loading..." : "Continue to New Dispute"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
