import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Webhook, Plus, Trash2, Play, Pause, Copy, Eye, EyeOff,
  CheckCircle2, XCircle, Clock, AlertTriangle, Zap,
} from "lucide-react";

const AVAILABLE_EVENTS = [
  { id: "dispute.created", label: "Dispute Created" },
  { id: "dispute.advanced", label: "Dispute Step Advanced" },
  { id: "dispute.closed", label: "Dispute Closed" },
  { id: "document.uploaded", label: "Document Uploaded" },
  { id: "offer.submitted", label: "Offer Submitted" },
  { id: "determination.issued", label: "Determination Issued" },
  { id: "notification.sent", label: "Notification Sent" },
];

function StatusBadge({ status }: { status: string }) {
  if (status === "active") return <Badge className="bg-green-500/15 text-green-700 border-green-500/30">Active</Badge>;
  if (status === "paused") return <Badge variant="secondary">Paused</Badge>;
  return <Badge variant="destructive">Failed</Badge>;
}

export default function WebhookManager() {
  const [createOpen, setCreateOpen] = useState(false);
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["dispute.created", "dispute.advanced"]);

  const utils = trpc.useUtils();
  const { data: webhooks, isLoading } = trpc.webhooks.list.useQuery();

  const createMutation = trpc.webhooks.create.useMutation({
    onSuccess: () => {
      utils.webhooks.list.invalidate();
      setCreateOpen(false);
      setNewName("");
      setNewUrl("");
      setSelectedEvents(["dispute.created", "dispute.advanced"]);
      toast.success("Webhook created", { description: "Your webhook endpoint is now active" });
    },
    onError: (err) => toast.error("Failed to create webhook", { description: err.message }),
  });

  const updateMutation = trpc.webhooks.update.useMutation({
    onSuccess: () => {
      utils.webhooks.list.invalidate();
      toast.success("Webhook updated");
    },
  });

  const deleteMutation = trpc.webhooks.delete.useMutation({
    onSuccess: () => {
      utils.webhooks.list.invalidate();
      toast.success("Webhook deleted");
    },
  });

  const testMutation = trpc.webhooks.test.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Test ping sent!", { description: `HTTP ${data.statusCode} response received` });
      } else {
        toast.error("Test ping failed", { description: `HTTP ${data.statusCode || "timeout"}` });
      }
      utils.webhooks.list.invalidate();
    },
    onError: (err) => toast.error("Test failed", { description: err.message }),
  });

  const toggleEvent = (eventId: string) => {
    setSelectedEvents(prev =>
      prev.includes(eventId) ? prev.filter(e => e !== eventId) : [...prev, eventId]
    );
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Webhook className="h-6 w-6 text-primary" />
              Webhook Manager
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Configure outbound webhooks to integrate HealthPoint IDR with your systems
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Webhook
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Total Webhooks", value: webhooks?.length ?? 0, icon: Webhook },
            { label: "Active", value: webhooks?.filter(w => w.status === "active").length ?? 0, icon: CheckCircle2 },
            { label: "Failed", value: webhooks?.filter(w => w.status === "failed").length ?? 0, icon: XCircle },
          ].map(stat => {
            const Icon = stat.icon;
            return (
              <Card key={stat.label}>
                <CardContent className="py-4 flex items-center gap-3">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-xl font-bold">{stat.value}</p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Webhooks List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Configured Webhooks</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-8 text-center text-muted-foreground">
                <Webhook className="h-8 w-8 mx-auto mb-2 animate-pulse" />
                Loading webhooks...
              </div>
            ) : !webhooks?.length ? (
              <div className="py-12 text-center text-muted-foreground">
                <Webhook className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No webhooks configured</p>
                <p className="text-sm mt-1">Add a webhook to receive real-time event notifications</p>
                <Button variant="outline" className="mt-4" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create your first webhook
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {webhooks.map(hook => {
                  const events: string[] = (() => {
                    try { return JSON.parse(hook.events); } catch { return []; }
                  })();
                  return (
                    <div key={hook.id} className="border rounded-lg p-4 hover:bg-muted/20 transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{hook.name}</span>
                            <StatusBadge status={hook.status} />
                            {hook.failureCount > 0 && (
                              <Badge variant="outline" className="text-orange-500 border-orange-500/30 gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                {hook.failureCount} failures
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-1 font-mono truncate">{hook.url}</p>
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            {events.slice(0, 4).map(e => (
                              <Badge key={e} variant="secondary" className="text-xs">{e}</Badge>
                            ))}
                            {events.length > 4 && (
                              <Badge variant="secondary" className="text-xs">+{events.length - 4} more</Badge>
                            )}
                          </div>
                          {/* Secret */}
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-xs text-muted-foreground">Secret:</span>
                            <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded">
                              {showSecret[hook.id] ? hook.secret : "whsec_••••••••••••••••"}
                            </code>
                            <button
                              onClick={() => setShowSecret(prev => ({ ...prev, [hook.id]: !prev[hook.id] }))}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              {showSecret[hook.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            </button>
                            <button
                              onClick={() => { navigator.clipboard.writeText(hook.secret); toast.success("Secret copied!"); }}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          </div>
                          {hook.lastTriggeredAt && (
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Last triggered: {new Date(hook.lastTriggeredAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => testMutation.mutate({ id: hook.id })}
                            disabled={testMutation.isPending}
                          >
                            <Zap className="h-3 w-3 mr-1" />
                            Test
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => updateMutation.mutate({
                              id: hook.id,
                              status: hook.status === "active" ? "paused" : "active",
                            })}
                          >
                            {hook.status === "active" ? (
                              <><Pause className="h-3 w-3 mr-1" />Pause</>
                            ) : (
                              <><Play className="h-3 w-3 mr-1" />Resume</>
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => deleteMutation.mutate({ id: hook.id })}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Create Dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Webhook className="h-5 w-5" />
                Create Webhook
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Webhook Name</Label>
                <Input
                  placeholder="e.g. Slack Notifications"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Endpoint URL</Label>
                <Input
                  placeholder="https://your-server.com/webhooks/healthpoint"
                  value={newUrl}
                  onChange={e => setNewUrl(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Events to Subscribe</Label>
                <div className="grid grid-cols-2 gap-2">
                  {AVAILABLE_EVENTS.map(event => (
                    <div key={event.id} className="flex items-center gap-2">
                      <Checkbox
                        id={event.id}
                        checked={selectedEvents.includes(event.id)}
                        onCheckedChange={() => toggleEvent(event.id)}
                      />
                      <label htmlFor={event.id} className="text-sm cursor-pointer">{event.label}</label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                onClick={() => createMutation.mutate({ name: newName, url: newUrl, events: selectedEvents })}
                disabled={!newName || !newUrl || selectedEvents.length === 0 || createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create Webhook"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
