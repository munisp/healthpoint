/**
 * /admin/idre-directory — wave W5-1.
 * Full CRUD over the certified IDR entity directory, including decertify
 * (sets active=false, audits, and notifies owners of in-flight disputes at
 * entity selection so re-selection can proceed).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Building2, Plus, Pencil, ShieldOff, RefreshCw } from "lucide-react";

type EntityForm = {
  name: string;
  certificationNumber: string;
  states: string; // comma-separated
  specialties: string; // comma-separated
  certificationExpiry: string; // yyyy-mm-dd
  feeSingleUsd: string;
  feeBatchedUsd: string;
  contactEmail: string;
  website: string;
};

const emptyForm: EntityForm = {
  name: "", certificationNumber: "", states: "", specialties: "",
  certificationExpiry: "", feeSingleUsd: "", feeBatchedUsd: "", contactEmail: "", website: "",
};

function parseForm(f: EntityForm) {
  return {
    name: f.name.trim(),
    certificationNumber: f.certificationNumber.trim(),
    states: f.states.split(",").map(s => s.trim().toUpperCase()).filter(Boolean),
    specialties: f.specialties.split(",").map(s => s.trim()).filter(Boolean),
    certificationExpiry: f.certificationExpiry ? new Date(`${f.certificationExpiry}T00:00:00Z`) : undefined,
    feeSingleUsd: f.feeSingleUsd ? Number(f.feeSingleUsd) : undefined,
    feeBatchedUsd: f.feeBatchedUsd ? Number(f.feeBatchedUsd) : undefined,
    contactEmail: f.contactEmail.trim() || undefined,
    website: f.website.trim() || undefined,
  };
}

export default function IdreDirectoryAdmin() {
  const utils = trpc.useUtils();
  const { data: entities, isLoading, refetch } = trpc.idreDirectory.list.useQuery({ includeInactive: true });

  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EntityForm>(emptyForm);
  const [decertifyTarget, setDecertifyTarget] = useState<{ id: string; name: string } | null>(null);
  const [decertifyReason, setDecertifyReason] = useState("");

  const createMut = trpc.idreDirectory.create.useMutation({
    onSuccess: () => { toast.success("IDR entity registered"); setShowEditor(false); utils.idreDirectory.list.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const updateMut = trpc.idreDirectory.update.useMutation({
    onSuccess: () => { toast.success("IDR entity updated"); setShowEditor(false); utils.idreDirectory.list.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const decertifyMut = trpc.idreDirectory.decertify.useMutation({
    onSuccess: r => {
      toast.success(`Entity decertified — ${r.notifiedDisputes} affected dispute owner(s) notified for re-selection`);
      setDecertifyTarget(null); setDecertifyReason("");
      utils.idreDirectory.list.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setShowEditor(true); };
  const openEdit = (e: any) => {
    setEditingId(e.id);
    setForm({
      name: e.name ?? "",
      certificationNumber: e.certificationNumber ?? "",
      states: (e.states ?? []).join(", "),
      specialties: (e.specialties ?? []).join(", "),
      certificationExpiry: e.certificationExpiry ? new Date(e.certificationExpiry).toISOString().slice(0, 10) : "",
      feeSingleUsd: e.feeSingleUsd ?? "",
      feeBatchedUsd: e.feeBatchedUsd ?? "",
      contactEmail: e.contactEmail ?? "",
      website: e.website ?? "",
    });
    setShowEditor(true);
  };

  const submit = () => {
    const parsed = parseForm(form);
    if (!parsed.name || !parsed.certificationNumber) { toast.error("Name and certification number are required"); return; }
    if (editingId) updateMut.mutate({ id: editingId, ...parsed } as any);
    else createMut.mutate(parsed as any);
  };

  const field = (key: keyof EntityForm, label: string, placeholder = "") => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={form[key]} placeholder={placeholder} onChange={e => setForm({ ...form, [key]: e.target.value })} />
    </div>
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold flex items-center gap-2"><Building2 className="h-5 w-5" /> IDRE Directory</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
          <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Register entity</Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Certified IDR entities ({entities?.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {(entities ?? []).map((e: any) => (
            <div key={e.id} className="flex items-start justify-between gap-4 border rounded-md p-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{e.name}</span>
                  {e.isActive
                    ? <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Active</Badge>
                    : <Badge className="bg-red-100 text-red-800 border-red-200">Decertified</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  Cert #{e.certificationNumber ?? "—"} · States: {(e.states ?? []).join(", ") || "—"} ·
                  Fees: single ${e.feeSingleUsd ?? "—"} / batched ${e.feeBatchedUsd ?? "—"} ·
                  Expiry: {e.certificationExpiry ? new Date(e.certificationExpiry).toLocaleDateString() : "—"}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => openEdit(e)}><Pencil className="h-3.5 w-3.5 mr-1" /> Edit</Button>
                {e.isActive && (
                  <Button variant="destructive" size="sm" onClick={() => setDecertifyTarget({ id: e.id, name: e.name })}>
                    <ShieldOff className="h-3.5 w-3.5 mr-1" /> Decertify
                  </Button>
                )}
              </div>
            </div>
          ))}
          {!isLoading && (entities ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No IDR entities registered. Production reads never fabricate entities — register a certified entity above.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={showEditor} onOpenChange={setShowEditor}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingId ? "Edit IDR entity" : "Register IDR entity"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {field("name", "Name")}
            {field("certificationNumber", "Certification number")}
            {field("states", "States served (comma-separated)", "CA, NY, TX")}
            {field("specialties", "Specialties (comma-separated)")}
            {field("certificationExpiry", "Certification expiry")}
            {field("contactEmail", "Contact email")}
            {field("feeSingleUsd", "Fee — single dispute (USD)")}
            {field("feeBatchedUsd", "Fee — batched dispute (USD)")}
            <div className="col-span-2">{field("website", "Website")}</div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowEditor(false)}>Cancel</Button>
            <Button onClick={submit} disabled={createMut.isPending || updateMut.isPending}>
              {editingId ? "Save changes" : "Register"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!decertifyTarget} onOpenChange={() => setDecertifyTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Decertify {decertifyTarget?.name}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This sets the entity inactive, writes an audit entry, and notifies the owner of every open dispute
            currently at IDR entity selection (STEP_06/07) with this entity so re-selection can proceed.
          </p>
          <div className="space-y-1 mt-2">
            <Label>Reason (required)</Label>
            <Textarea value={decertifyReason} onChange={e => setDecertifyReason(e.target.value)} rows={3} />
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDecertifyTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!decertifyReason.trim() || decertifyMut.isPending}
              onClick={() => decertifyTarget && decertifyMut.mutate({ id: decertifyTarget.id, reason: decertifyReason.trim() })}
            >
              Decertify
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
