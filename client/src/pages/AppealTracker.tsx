import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Scale, Plus, CheckCircle2, XCircle, Clock, FileText, Loader2, Filter } from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft: { label: "Draft", color: "bg-gray-100 text-gray-700", icon: <FileText className="h-3.5 w-3.5" /> },
  submitted: { label: "Submitted", color: "bg-blue-100 text-blue-700", icon: <Clock className="h-3.5 w-3.5" /> },
  under_review: { label: "Under Review", color: "bg-yellow-100 text-yellow-700", icon: <Clock className="h-3.5 w-3.5 text-yellow-500" /> },
  upheld: { label: "Upheld", color: "bg-green-100 text-green-700", icon: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> },
  denied: { label: "Denied", color: "bg-red-100 text-red-700", icon: <XCircle className="h-3.5 w-3.5 text-red-500" /> },
  withdrawn: { label: "Withdrawn", color: "bg-gray-100 text-gray-500", icon: <XCircle className="h-3.5 w-3.5" /> },
};

export default function AppealTracker() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [showDecide, setShowDecide] = useState<string | null>(null);
  const [form, setForm] = useState({ disputeId: "", groundsForAppeal: "", supportingEvidence: "", originalDetermination: "" });
  const [decideForm, setDecideForm] = useState({ decision: "upheld" as "upheld" | "denied", appealDecision: "" });
  const utils = trpc.useUtils();

  const { data: appeals = [], isLoading } = trpc.appeals.list.useQuery({});

  const createMutation = trpc.appeals.create.useMutation({
    onSuccess: () => { utils.appeals.list.invalidate(); setShowCreate(false); setForm({ disputeId: "", groundsForAppeal: "", supportingEvidence: "", originalDetermination: "" }); toast.success("Appeal submitted"); },
    onError: (e) => toast.error(e.message),
  });

  const decideMutation = trpc.appeals.decide.useMutation({
    onSuccess: () => { utils.appeals.list.invalidate(); setShowDecide(null); toast.success("Appeal decision recorded"); },
    onError: (e) => toast.error(e.message),
  });

  const filtered = statusFilter === "all" ? appeals : appeals.filter(a => a.status === statusFilter);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Scale className="h-6 w-6 text-indigo-600" />
            Appeal Tracker
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Submit and track appeals against IDR determinations</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />New Appeal
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
          const count = appeals.filter(a => a.status === key).length;
          return (
            <Card key={key} className="cursor-pointer hover:shadow-sm transition-shadow" onClick={() => setStatusFilter(key === statusFilter ? "all" : key)}>
              <CardContent className="p-3 text-center">
                <div className="text-2xl font-bold">{count}</div>
                <div className="text-xs text-muted-foreground">{cfg.label}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Button variant={statusFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setStatusFilter("all")}>All</Button>
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <Button key={key} variant={statusFilter === key ? "default" : "outline"} size="sm" onClick={() => setStatusFilter(key)}>{cfg.label}</Button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading appeals...</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Scale className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <h3 className="font-semibold">No appeals found</h3>
            <p className="text-sm text-muted-foreground mt-1">Submit an appeal to challenge an IDR determination.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(appeal => {
            const cfg = STATUS_CONFIG[appeal.status] ?? STATUS_CONFIG.draft;
            return (
              <Card key={appeal.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {cfg.icon}
                        <span className="font-semibold text-sm">Dispute: {appeal.disputeId.slice(0, 16)}...</span>
                        <Badge className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>
                      </div>
                      <p className="text-sm mt-1 line-clamp-2">{appeal.groundsForAppeal}</p>
                      {appeal.appealDecision && (
                        <div className={`mt-2 p-2 rounded text-xs ${appeal.status === "upheld" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                          <strong>Decision:</strong> {appeal.appealDecision}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        By {appeal.submittedByName} · {new Date(appeal.createdAt).toLocaleDateString()}
                        {appeal.decidedAt && ` · Decided ${new Date(appeal.decidedAt).toLocaleDateString()}`}
                      </p>
                    </div>
                    {isAdmin && appeal.status === "under_review" && (
                      <Button size="sm" variant="outline" onClick={() => setShowDecide(appeal.id)}>
                        Decide
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Appeal Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Submit Appeal</DialogTitle>
            <DialogDescription>Challenge an IDR determination with formal grounds for appeal</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Dispute ID *</label>
              <Input placeholder="Enter dispute ID" value={form.disputeId} onChange={e => setForm(f => ({ ...f, disputeId: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Original Determination</label>
              <Input placeholder="e.g. $12,500 awarded to payer" value={form.originalDetermination} onChange={e => setForm(f => ({ ...f, originalDetermination: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Grounds for Appeal * <span className="text-xs text-muted-foreground font-normal">(min 20 characters)</span></label>
              <Textarea
                placeholder="Describe the legal or factual basis for this appeal. Reference specific NSA provisions, QPA calculations, or procedural errors..."
                value={form.groundsForAppeal}
                onChange={e => setForm(f => ({ ...f, groundsForAppeal: e.target.value }))}
                className="min-h-[120px]"
                maxLength={5000}
              />
              <p className="text-xs text-muted-foreground mt-1">{form.groundsForAppeal.length}/5000</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Supporting Evidence</label>
              <Textarea
                placeholder="List supporting documents, references, or evidence..."
                value={form.supportingEvidence}
                onChange={e => setForm(f => ({ ...f, supportingEvidence: e.target.value }))}
                className="min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({ disputeId: form.disputeId, groundsForAppeal: form.groundsForAppeal, supportingEvidence: form.supportingEvidence || undefined, originalDetermination: form.originalDetermination || undefined })}
              disabled={createMutation.isPending || !form.disputeId || form.groundsForAppeal.length < 20}
            >
              {createMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Submitting...</> : "Submit Appeal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decide Dialog */}
      <Dialog open={!!showDecide} onOpenChange={open => !open && setShowDecide(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Appeal Decision</DialogTitle>
            <DialogDescription>Uphold or deny this appeal with a written decision</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Decision</label>
              <Select value={decideForm.decision} onValueChange={(v: any) => setDecideForm(f => ({ ...f, decision: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="upheld">Upheld — Appeal succeeds</SelectItem>
                  <SelectItem value="denied">Denied — Original determination stands</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Decision Rationale *</label>
              <Textarea
                placeholder="Provide the written rationale for this decision..."
                value={decideForm.appealDecision}
                onChange={e => setDecideForm(f => ({ ...f, appealDecision: e.target.value }))}
                className="min-h-[100px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDecide(null)}>Cancel</Button>
            <Button
              onClick={() => showDecide && decideMutation.mutate({ id: showDecide, decision: decideForm.decision, appealDecision: decideForm.appealDecision })}
              disabled={decideMutation.isPending || decideForm.appealDecision.length < 10}
            >
              {decideMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Saving...</> : "Record Decision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
