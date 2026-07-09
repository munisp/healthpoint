import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Clock, AlertTriangle, CheckCircle2, Plus, X, Loader2, CalendarDays } from "lucide-react";

function getDaysUntil(date: string | Date) {
  const d = new Date(date);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function getUrgencyColor(days: number) {
  if (days < 0) return "border-l-red-600 bg-red-50/50";
  if (days <= 7) return "border-l-red-400 bg-red-50/30";
  if (days <= 30) return "border-l-amber-400 bg-amber-50/30";
  return "border-l-green-400";
}

function getUrgencyBadge(days: number) {
  if (days < 0) return <Badge className="bg-red-100 text-red-700 text-xs">Expired</Badge>;
  if (days === 0) return <Badge className="bg-red-100 text-red-700 text-xs">Expires Today</Badge>;
  if (days <= 7) return <Badge className="bg-red-100 text-red-700 text-xs">{days}d left</Badge>;
  if (days <= 30) return <Badge className="bg-amber-100 text-amber-700 text-xs">{days}d left</Badge>;
  return <Badge className="bg-green-100 text-green-700 text-xs">{days}d left</Badge>;
}

export default function DocumentExpiryTracker() {
  const [showAdd, setShowAdd] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [form, setForm] = useState({ disputeId: "", documentId: "", documentName: "", expiresAt: "" });
  const utils = trpc.useUtils();

  const { data: alerts = [], isLoading } = trpc.docExpiry.list.useQuery({ showDismissed });

  const addMutation = trpc.docExpiry.add.useMutation({
    onSuccess: () => { utils.docExpiry.list.invalidate(); setShowAdd(false); setForm({ disputeId: "", documentId: "", documentName: "", expiresAt: "" }); toast.success("Expiry alert added"); },
    onError: (e) => toast.error(e.message),
  });

  const dismissMutation = trpc.docExpiry.dismiss.useMutation({
    onSuccess: () => { utils.docExpiry.list.invalidate(); toast.success("Alert dismissed"); },
    onError: (e) => toast.error(e.message),
  });

  const expiredCount = alerts.filter(a => getDaysUntil(a.expiresAt) < 0).length;
  const urgentCount = alerts.filter(a => { const d = getDaysUntil(a.expiresAt); return d >= 0 && d <= 7; }).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-amber-500" />
            Document Expiry Tracker
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Monitor document expiration dates and receive timely alerts</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowDismissed(!showDismissed)}>
            {showDismissed ? "Hide Dismissed" : "Show Dismissed"}
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-1" />Add Alert
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-red-200">
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-red-600">{expiredCount}</div>
            <div className="text-xs text-muted-foreground mt-1">Expired</div>
          </CardContent>
        </Card>
        <Card className="border-amber-200">
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-amber-600">{urgentCount}</div>
            <div className="text-xs text-muted-foreground mt-1">Expiring within 7 days</div>
          </CardContent>
        </Card>
        <Card className="border-green-200">
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-green-600">{alerts.filter(a => getDaysUntil(a.expiresAt) > 30).length}</div>
            <div className="text-xs text-muted-foreground mt-1">Healthy (30+ days)</div>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading alerts...</div>
      ) : alerts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="h-12 w-12 mx-auto text-green-400 mb-3" />
            <h3 className="font-semibold">No expiry alerts</h3>
            <p className="text-sm text-muted-foreground mt-1">Add document expiry alerts to track important deadlines.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {alerts
            .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime())
            .map(alert => {
              const days = getDaysUntil(alert.expiresAt);
              return (
                <Card key={alert.id} className={`border-l-4 ${getUrgencyColor(days)}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {days < 0 ? <AlertTriangle className="h-4 w-4 text-red-500" /> : days <= 7 ? <Clock className="h-4 w-4 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 text-green-500" />}
                          <span className="font-semibold text-sm">{alert.documentName}</span>
                          {getUrgencyBadge(days)}
                          {alert.dismissed && <Badge variant="outline" className="text-xs text-muted-foreground">Dismissed</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          <p>Dispute: {alert.disputeId.slice(0, 16)}...</p>
                          <p>Expires: {new Date(alert.expiresAt).toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" })}</p>
                        </div>
                      </div>
                      {!alert.dismissed && (
                        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => dismissMutation.mutate({ id: alert.id })}>
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        </div>
      )}

      {/* Add Alert Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Expiry Alert</DialogTitle>
            <DialogDescription>Track when a document expires so you get notified in advance</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Document Name *</label>
              <Input placeholder="e.g. Authorization Letter, Medical Records" value={form.documentName} onChange={e => setForm(f => ({ ...f, documentName: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Dispute ID *</label>
              <Input placeholder="Enter dispute ID" value={form.disputeId} onChange={e => setForm(f => ({ ...f, disputeId: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Document ID</label>
              <Input placeholder="Optional document reference ID" value={form.documentId} onChange={e => setForm(f => ({ ...f, documentId: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Expiry Date *</label>
              <Input type="date" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button
              onClick={() => addMutation.mutate({ disputeId: form.disputeId, documentId: form.documentId || form.documentName, documentName: form.documentName, expiresAt: new Date(form.expiresAt).toISOString() })}
              disabled={addMutation.isPending || !form.documentName || !form.disputeId || !form.expiresAt}
            >
              {addMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Adding...</> : "Add Alert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
