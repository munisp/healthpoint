import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { Users2, Plus, ExternalLink, Search, CheckCircle2, Clock, AlertCircle } from "lucide-react";

// Party roles in a multi-party IDR dispute
const PARTY_ROLES = [
  { value: "initiating_provider", label: "Initiating Provider" },
  { value: "responding_payer", label: "Responding Payer" },
  { value: "facility", label: "Facility" },
  { value: "aggregator", label: "Aggregator" },
  { value: "legal_representative", label: "Legal Representative" },
  { value: "idr_entity", label: "IDR Entity" },
  { value: "observer", label: "Observer" },
];

const PARTY_STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  active: { color: "bg-green-100 text-green-700", icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "Active" },
  pending: { color: "bg-yellow-100 text-yellow-700", icon: <Clock className="h-3.5 w-3.5" />, label: "Pending" },
  withdrawn: { color: "bg-red-100 text-red-700", icon: <AlertCircle className="h-3.5 w-3.5" />, label: "Withdrawn" },
};

interface Party {
  id: string;
  name: string;
  role: string;
  email: string;
  status: "active" | "pending" | "withdrawn";
  addedAt: string;
}

export default function MultiPartyCoordinator() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [selectedDisputeId, setSelectedDisputeId] = useState("");
  const [showAddParty, setShowAddParty] = useState(false);
  const [newParty, setNewParty] = useState({ name: "", role: "responding_payer", email: "" });

  // Local state for demo parties (in production, this would be a DB table)
  const [parties, setParties] = useState<Record<string, Party[]>>({});

  const { data } = trpc.disputes.list.useQuery({ limit: 100, offset: 0 });
  const disputes = (data?.items ?? []).filter(d =>
    !search || d.referenceNumber?.toLowerCase().includes(search.toLowerCase()) ||
    d.respondingPartyName?.toLowerCase().includes(search.toLowerCase())
  );

  const selectedDispute = disputes.find(d => d.id === selectedDisputeId);
  const disputeParties = parties[selectedDisputeId] ?? [];

  const handleAddParty = () => {
    if (!newParty.name || !newParty.email) {
      toast.error("Name and email are required");
      return;
    }
    const party: Party = {
      id: crypto.randomUUID(),
      name: newParty.name,
      role: newParty.role,
      email: newParty.email,
      status: "pending",
      addedAt: new Date().toISOString(),
    };
    setParties(prev => ({
      ...prev,
      [selectedDisputeId]: [...(prev[selectedDisputeId] ?? []), party],
    }));
    setNewParty({ name: "", role: "responding_payer", email: "" });
    setShowAddParty(false);
    toast.success(`${party.name} added as ${PARTY_ROLES.find(r => r.value === party.role)?.label}`);
  };

  const updatePartyStatus = (partyId: string, status: "active" | "pending" | "withdrawn") => {
    setParties(prev => ({
      ...prev,
      [selectedDisputeId]: (prev[selectedDisputeId] ?? []).map(p =>
        p.id === partyId ? { ...p, status } : p
      ),
    }));
    toast.success("Party status updated");
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users2 className="h-6 w-6 text-violet-600" />
          Multi-Party Coordinator
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Manage disputes involving multiple parties, aggregators, and legal representatives</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Dispute selector */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Select Dispute</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {disputes.map(d => {
                const partyCount = (parties[d.id] ?? []).length;
                return (
                  <div
                    key={d.id}
                    className={`p-2 rounded cursor-pointer hover:bg-muted transition-colors ${selectedDisputeId === d.id ? "bg-primary/10 border border-primary/20" : ""}`}
                    onClick={() => setSelectedDisputeId(d.id)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-primary">{d.referenceNumber}</span>
                      {partyCount > 0 && <Badge variant="outline" className="text-xs">{partyCount} parties</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{d.respondingPartyName}</p>
                    <Badge variant="outline" className="text-xs mt-1 capitalize">{d.status?.replace(/_/g, " ")}</Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Party management */}
        <Card className="lg:col-span-2">
          {!selectedDisputeId ? (
            <CardContent className="py-16 text-center text-muted-foreground">
              <Users2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Select a dispute to manage its parties</p>
            </CardContent>
          ) : (
            <>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm">{selectedDispute?.referenceNumber} — Parties</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">{selectedDispute?.respondingPartyName}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => navigate(`/disputes/${selectedDisputeId}`)}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1" />View Dispute
                    </Button>
                    <Button size="sm" onClick={() => setShowAddParty(true)}>
                      <Plus className="h-3.5 w-3.5 mr-1" />Add Party
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {disputeParties.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Users2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No additional parties added yet</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowAddParty(true)}>
                      <Plus className="h-3.5 w-3.5 mr-1" />Add First Party
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {disputeParties.map(party => {
                      const statusCfg = PARTY_STATUS_CONFIG[party.status] ?? PARTY_STATUS_CONFIG.pending;
                      const roleCfg = PARTY_ROLES.find(r => r.value === party.role);
                      return (
                        <div key={party.id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{party.name}</span>
                              <Badge className={`text-xs flex items-center gap-1 ${statusCfg.color}`}>
                                {statusCfg.icon}{statusCfg.label}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{roleCfg?.label ?? party.role} · {party.email}</p>
                            <p className="text-xs text-muted-foreground">Added {new Date(party.addedAt).toLocaleDateString()}</p>
                          </div>
                          <Select value={party.status} onValueChange={(v) => updatePartyStatus(party.id, v as "active" | "pending" | "withdrawn")}>
                            <SelectTrigger className="w-32 h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="withdrawn">Withdrawn</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </>
          )}
        </Card>
      </div>

      {/* Add party dialog */}
      <Dialog open={showAddParty} onOpenChange={setShowAddParty}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Party to Dispute</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Party Name *</label>
              <Input value={newParty.name} onChange={e => setNewParty(p => ({ ...p, name: e.target.value }))} placeholder="Organization or individual name" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Role *</label>
              <Select value={newParty.role} onValueChange={v => setNewParty(p => ({ ...p, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PARTY_ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Email *</label>
              <Input type="email" value={newParty.email} onChange={e => setNewParty(p => ({ ...p, email: e.target.value }))} placeholder="contact@organization.com" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddParty(false)}>Cancel</Button>
            <Button onClick={handleAddParty}>Add Party</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
