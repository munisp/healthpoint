/**
 * LeadsManager.tsx
 *
 * Admin-only CRM page for viewing and managing marketing leads captured
 * from the HealthPoint landing page lead-capture form.
 *
 * Route: /admin/leads
 * Access: admin role only
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Users, Mail, Building2, Phone, Tag, Search,
  ChevronDown, RefreshCw, UserCheck, ExternalLink,
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

type LeadStatus = "new" | "contacted" | "qualified" | "converted" | "disqualified";

const STATUS_COLORS: Record<LeadStatus, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-amber-100 text-amber-700",
  qualified: "bg-purple-100 text-purple-700",
  converted: "bg-green-100 text-green-700",
  disqualified: "bg-slate-100 text-slate-500",
};

const ROLE_LABELS: Record<string, string> = {
  provider: "Provider",
  facility: "Facility",
  payer: "Payer",
  idr_entity: "IDR Entity",
  other: "Other",
};

export default function LeadsManager() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedLead, setSelectedLead] = useState<string | null>(null);
  const [newStatus, setNewStatus] = useState<LeadStatus>("new");
  const [notes, setNotes] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Redirect non-admins
  if (user && user.role !== "admin") {
    navigate("/");
    return null;
  }

  const { data: leads = [], isLoading, refetch } = trpc.leads.list.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
    limit: 200,
    offset: 0,
  });

  const updateStatusMutation = trpc.leads.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("Lead status updated.");
      refetch();
      setDialogOpen(false);
    },
    onError: () => toast.error("Failed to update lead status."),
  });

  const filtered = leads.filter(l => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      l.email?.toLowerCase().includes(q) ||
      l.firstName?.toLowerCase().includes(q) ||
      l.lastName?.toLowerCase().includes(q) ||
      l.orgName?.toLowerCase().includes(q)
    );
  });

  const openUpdateDialog = (lead: typeof leads[0]) => {
    setSelectedLead(lead.id);
    setNewStatus(lead.status as LeadStatus);
    setNotes(lead.notes ?? "");
    setDialogOpen(true);
  };

  const handleUpdateStatus = () => {
    if (!selectedLead) return;
    updateStatusMutation.mutate({ id: selectedLead, status: newStatus, notes });
  };

  // Summary counts
  const counts = leads.reduce((acc, l) => {
    acc[l.status as LeadStatus] = (acc[l.status as LeadStatus] ?? 0) + 1;
    return acc;
  }, {} as Record<LeadStatus, number>);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Marketing Leads</h1>
            <p className="text-slate-500 text-sm mt-1">
              Leads captured from the HealthPoint landing page lead-capture form.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {(["new", "contacted", "qualified", "converted", "disqualified"] as LeadStatus[]).map(s => (
            <Card
              key={s}
              className={`cursor-pointer border-2 transition-all ${statusFilter === s ? "border-blue-500" : "border-transparent"}`}
              onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
            >
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-slate-900">{counts[s] ?? 0}</div>
                <Badge className={`${STATUS_COLORS[s]} border-0 text-xs mt-1 capitalize`}>{s}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search by name, email, or org..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="contacted">Contacted</SelectItem>
              <SelectItem value="qualified">Qualified</SelectItem>
              <SelectItem value="converted">Converted</SelectItem>
              <SelectItem value="disqualified">Disqualified</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Leads table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {filtered.length} lead{filtered.length !== 1 ? "s" : ""}
              {statusFilter !== "all" ? ` · ${statusFilter}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading leads...
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Users className="w-10 h-10 mb-3 opacity-40" />
                <p className="text-sm">No leads found.</p>
                <p className="text-xs mt-1">Leads appear here when visitors submit the landing page form.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filtered.map(lead => (
                  <div
                    key={lead.id}
                    className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors"
                  >
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 text-blue-700 font-bold text-sm">
                      {(lead.firstName?.[0] ?? "?").toUpperCase()}
                    </div>

                    {/* Name + email */}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900 text-sm truncate">
                        {lead.firstName} {lead.lastName}
                      </div>
                      <div className="flex items-center gap-1 text-slate-500 text-xs mt-0.5">
                        <Mail className="w-3 h-3" />
                        <a href={`mailto:${lead.email}`} className="hover:text-blue-600 truncate">{lead.email}</a>
                      </div>
                    </div>

                    {/* Org */}
                    <div className="hidden md:flex items-center gap-1 text-slate-500 text-xs min-w-[140px]">
                      <Building2 className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{lead.orgName ?? "—"}</span>
                    </div>

                    {/* Role */}
                    <div className="hidden sm:block min-w-[90px]">
                      <Badge variant="outline" className="text-xs capitalize">
                        {ROLE_LABELS[lead.stakeholderRole ?? ""] ?? lead.stakeholderRole ?? "—"}
                      </Badge>
                    </div>

                    {/* Source */}
                    <div className="hidden lg:block text-xs text-slate-400 min-w-[90px] truncate">
                      {lead.source ?? "landing_page"}
                    </div>

                    {/* Date */}
                    <div className="hidden lg:block text-xs text-slate-400 min-w-[80px]">
                      {lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : "—"}
                    </div>

                    {/* Status badge */}
                    <Badge className={`${STATUS_COLORS[lead.status as LeadStatus] ?? ""} border-0 text-xs capitalize min-w-[90px] justify-center`}>
                      {lead.status}
                    </Badge>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => openUpdateDialog(lead)}
                      >
                        <Tag className="w-3 h-3" /> Update
                      </Button>
                      <a href={`mailto:${lead.email}`}>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                          <Mail className="w-3 h-3" /> Email
                        </Button>
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Update Status Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Update Lead Status</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>Status</Label>
                <Select value={newStatus} onValueChange={v => setNewStatus(v as LeadStatus)}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="contacted">Contacted</SelectItem>
                    <SelectItem value="qualified">Qualified</SelectItem>
                    <SelectItem value="converted">Converted</SelectItem>
                    <SelectItem value="disqualified">Disqualified</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea
                  className="mt-1.5"
                  placeholder="Add notes about this lead..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={handleUpdateStatus}
                disabled={updateStatusMutation.isPending}
              >
                {updateStatusMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
