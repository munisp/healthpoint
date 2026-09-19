/**
 * /admin/fee-schedules — wave W5-4.
 * Admin editor for the DB-backed IDR administrative fee schedule. The
 * clocks-2026 fee routes read these rows first and fall back to the
 * hardcoded CMS-9897-F params when no row matches.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { DollarSign, Plus, Pencil, Trash2 } from "lucide-react";

type FeeForm = {
  effectiveYear: string;
  tier: "single" | "batched";
  effectiveFrom: string;
  effectiveTo: string;
  amountUsd: string;
  citation: string;
};

const emptyForm: FeeForm = { effectiveYear: "2026", tier: "single", effectiveFrom: "", effectiveTo: "", amountUsd: "", citation: "" };

export default function FeeSchedulesAdmin() {
  const utils = trpc.useUtils();
  const { data: rows, isLoading } = trpc.feeSchedules.list.useQuery();

  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FeeForm>(emptyForm);

  const upsertMut = trpc.feeSchedules.upsert.useMutation({
    onSuccess: () => { toast.success("Fee tier saved"); setShowEditor(false); utils.feeSchedules.list.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const removeMut = trpc.feeSchedules.remove.useMutation({
    onSuccess: () => { toast.success("Fee tier deleted"); utils.feeSchedules.list.invalidate(); },
    onError: e => toast.error(e.message),
  });

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setShowEditor(true); };
  const openEdit = (r: any) => {
    setEditingId(r.id);
    setForm({
      effectiveYear: String(r.effectiveYear),
      tier: r.tier,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo ?? "",
      amountUsd: String(r.amountUsd),
      citation: r.citation ?? "",
    });
    setShowEditor(true);
  };

  const submit = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.effectiveFrom)) { toast.error("effectiveFrom must be yyyy-mm-dd"); return; }
    if (form.effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(form.effectiveTo)) { toast.error("effectiveTo must be yyyy-mm-dd"); return; }
    const amount = Number(form.amountUsd);
    if (!(amount >= 0)) { toast.error("Amount must be a non-negative number"); return; }
    upsertMut.mutate({
      id: editingId ?? undefined,
      effectiveYear: Number(form.effectiveYear),
      tier: form.tier,
      effectiveFrom: form.effectiveFrom,
      effectiveTo: form.effectiveTo || null,
      amountUsd: amount,
      citation: form.citation || undefined,
    });
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold flex items-center gap-2"><DollarSign className="h-5 w-5" /> Administrative Fee Schedules</h1>
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> New tier</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Effective-dated fee tiers ({rows?.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {(rows ?? []).map((r: any) => (
            <div key={r.id} className="flex items-center justify-between gap-4 border rounded-md p-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">${r.amountUsd}</span>
                  <Badge variant="outline">{r.tier}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {r.effectiveFrom} → {r.effectiveTo ?? "open-ended"} · year {r.effectiveYear}
                  </span>
                </div>
                {r.citation && <p className="text-xs text-muted-foreground mt-1">{r.citation}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5 mr-1" /> Edit</Button>
                <Button variant="destructive" size="sm" onClick={() => removeMut.mutate({ id: r.id })}><Trash2 className="h-3.5 w-3.5 mr-1" /> Delete</Button>
              </div>
            </div>
          ))}
          {!isLoading && (rows ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No fee tiers in the database — the hardcoded CMS-9897-F params are used as fallback.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={showEditor} onOpenChange={setShowEditor}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? "Edit fee tier" : "New fee tier"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Effective year</Label>
              <Input value={form.effectiveYear} onChange={e => setForm({ ...form, effectiveYear: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Tier</Label>
              <Select value={form.tier} onValueChange={v => setForm({ ...form, tier: v as "single" | "batched" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single dispute</SelectItem>
                  <SelectItem value="batched">Batched dispute</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Effective from (yyyy-mm-dd)</Label>
              <Input value={form.effectiveFrom} placeholder="2026-06-11" onChange={e => setForm({ ...form, effectiveFrom: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Effective to (optional, exclusive)</Label>
              <Input value={form.effectiveTo} placeholder="—" onChange={e => setForm({ ...form, effectiveTo: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Amount (USD)</Label>
              <Input value={form.amountUsd} placeholder="15" onChange={e => setForm({ ...form, amountUsd: e.target.value })} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Citation</Label>
              <Input value={form.citation} placeholder="45 CFR 149.510(d)(2)(ii)(B)" onChange={e => setForm({ ...form, citation: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowEditor(false)}>Cancel</Button>
            <Button onClick={submit} disabled={upsertMut.isPending}>{editingId ? "Save" : "Create"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
