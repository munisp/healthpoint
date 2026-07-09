import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { BookOpen, Search, Plus, Pencil, Trash2, Phone, Mail, Globe, Building2, RefreshCw, ExternalLink } from "lucide-react";
import EmptyState from "@/components/EmptyState";

const EMPTY_FORM = {
  payerName: "", payerId: "", contactName: "", contactTitle: "",
  email: "", phone: "", fax: "", address: "", idrPortalUrl: "", notes: "",
};

export default function PayerContactBook() {
  const [search, setSearch] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: contacts, isLoading, refetch } = trpc.payerContacts.list.useQuery({ search: search || undefined });

  const createMutation = trpc.payerContacts.create.useMutation({
    onSuccess: () => { toast.success("Contact created"); setShowDialog(false); setForm(EMPTY_FORM); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.payerContacts.update.useMutation({
    onSuccess: () => { toast.success("Contact updated"); setShowDialog(false); setEditing(null); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.payerContacts.delete.useMutation({
    onSuccess: () => { toast.success("Contact deleted"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setShowDialog(true); };
  const openEdit = (c: any) => {
    setEditing(c);
    setForm({ payerName: c.payerName ?? "", payerId: c.payerId ?? "", contactName: c.contactName ?? "", contactTitle: c.contactTitle ?? "", email: c.email ?? "", phone: c.phone ?? "", fax: c.fax ?? "", address: c.address ?? "", idrPortalUrl: c.idrPortalUrl ?? "", notes: c.notes ?? "" });
    setShowDialog(true);
  };

  const handleSubmit = () => {
    if (!form.payerName.trim()) { toast.error("Payer name is required"); return; }
    if (editing) {
      updateMutation.mutate({ id: editing.id, ...form });
    } else {
      createMutation.mutate(form);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-blue-600" />
            Payer Contact Book
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Centralized directory of payer contacts, IDR portals, and escalation paths
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />Add Contact
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by payer name, contact, or email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Contact grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !contacts || contacts.length === 0 ? (
        <EmptyState variant="disputes" title="No contacts yet" description="Add your first payer contact to get started." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {contacts.map((c: any) => (
            <Card key={c.id} className="group hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="h-5 w-5 text-blue-500 shrink-0" />
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{c.payerName}</CardTitle>
                      {c.payerId && <p className="text-xs text-muted-foreground">ID: {c.payerId}</p>}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => deleteMutation.mutate({ id: c.id })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {c.contactName && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.contactName}</span>
                    {c.contactTitle && <Badge variant="secondary" className="text-xs">{c.contactTitle}</Badge>}
                  </div>
                )}
                {c.email && (
                  <a href={`mailto:${c.email}`} className="flex items-center gap-2 text-blue-600 hover:underline">
                    <Mail className="h-3.5 w-3.5" />{c.email}
                  </a>
                )}
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
                    <Phone className="h-3.5 w-3.5" />{c.phone}
                    {c.fax && <span className="text-xs">(Fax: {c.fax})</span>}
                  </a>
                )}
                {c.idrPortalUrl && (
                  <a href={c.idrPortalUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-blue-600 hover:underline truncate">
                    <Globe className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">IDR Portal</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                )}
                {c.notes && <p className="text-xs text-muted-foreground italic border-t pt-2">{c.notes}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Contact" : "Add Payer Contact"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label>Payer Name *</Label>
                <Input value={form.payerName} onChange={e => setForm(f => ({ ...f, payerName: e.target.value }))} placeholder="Aetna, UnitedHealthcare, etc." />
              </div>
              <div className="space-y-1">
                <Label>Payer ID</Label>
                <Input value={form.payerId} onChange={e => setForm(f => ({ ...f, payerId: e.target.value }))} placeholder="Optional" />
              </div>
              <div className="space-y-1">
                <Label>Contact Name</Label>
                <Input value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Title</Label>
                <Input value={form.contactTitle} onChange={e => setForm(f => ({ ...f, contactTitle: e.target.value }))} placeholder="IDR Coordinator" />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Fax</Label>
                <Input value={form.fax} onChange={e => setForm(f => ({ ...f, fax: e.target.value }))} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>IDR Portal URL</Label>
                <Input type="url" value={form.idrPortalUrl} onChange={e => setForm(f => ({ ...f, idrPortalUrl: e.target.value }))} placeholder="https://..." />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Address</Label>
                <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} maxLength={1000} />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button className="flex-1" onClick={handleSubmit} disabled={isPending}>
                {isPending ? "Saving..." : editing ? "Save Changes" : "Add Contact"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
