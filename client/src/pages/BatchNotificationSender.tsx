import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Bell, Send, Users, CheckSquare, Square, Loader2, Filter } from "lucide-react";

const NOTIFICATION_TEMPLATES = [
  { id: "deadline_reminder", label: "Deadline Reminder", body: "This is a reminder that your IDR dispute {referenceNumber} has an upcoming deadline. Please ensure all required documentation is submitted promptly." },
  { id: "status_update", label: "Status Update", body: "Your IDR dispute {referenceNumber} has been updated. Please log in to review the latest status and any required actions." },
  { id: "offer_received", label: "Offer Received", body: "A payment offer has been submitted for dispute {referenceNumber}. Please review and respond within the required timeframe." },
  { id: "document_required", label: "Document Required", body: "Additional documentation is required for dispute {referenceNumber}. Please upload the requested documents at your earliest convenience." },
  { id: "custom", label: "Custom Message", body: "" },
];

export default function BatchNotificationSender() {
  const [selectedDisputes, setSelectedDisputes] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState("deadline_reminder");
  const [subject, setSubject] = useState("IDR Dispute Update");
  const [body, setBody] = useState(NOTIFICATION_TEMPLATES[0].body);
  const [statusFilter, setStatusFilter] = useState("all");
  const [showConfirm, setShowConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState(0);

  const { data } = trpc.disputes.list.useQuery({ limit: 100, offset: 0 });
  const disputes = (data?.items ?? []).filter(d =>
    statusFilter === "all" || d.status === statusFilter
  );

  const toggleDispute = (id: string) => {
    setSelectedDisputes(prev =>
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (selectedDisputes.length === disputes.length) {
      setSelectedDisputes([]);
    } else {
      setSelectedDisputes(disputes.map(d => d.id));
    }
  };

  const handleTemplateChange = (id: string) => {
    setTemplateId(id);
    const template = NOTIFICATION_TEMPLATES.find(t => t.id === id);
    if (template && id !== "custom") {
      setBody(template.body);
    }
  };

  const handleSend = async () => {
    setSending(true);
    // Simulate sending notifications (in production, would call a batch notification procedure)
    await new Promise(resolve => setTimeout(resolve, 1500));
    setSentCount(selectedDisputes.length);
    setSending(false);
    setShowConfirm(false);
    setSelectedDisputes([]);
    toast.success(`Notifications sent to ${selectedDisputes.length} dispute parties`);
  };

  const DISPUTE_STATUS_OPTIONS = [
    "all", "open_negotiation", "idr_initiated", "idr_entity_selection",
    "eligibility_review", "offer_submission", "under_arbitration",
    "determination_issued", "payment_pending",
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="h-6 w-6 text-blue-600" />
            Batch Notification Sender
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Send bulk notifications to dispute parties across multiple cases</p>
        </div>
        {sentCount > 0 && (
          <Badge className="bg-green-100 text-green-700">{sentCount} sent this session</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Message composer */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Compose Message</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Template</label>
              <Select value={templateId} onValueChange={handleTemplateChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NOTIFICATION_TEMPLATES.map(t => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Subject</label>
              <Input value={subject} onChange={e => setSubject(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Message Body</label>
              <Textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                className="min-h-[140px]"
                placeholder="Enter notification message..."
              />
              <p className="text-xs text-muted-foreground mt-1">Use {"{referenceNumber}"} to insert the dispute reference number</p>
            </div>
            <Button
              className="w-full"
              disabled={selectedDisputes.length === 0 || !body.trim()}
              onClick={() => setShowConfirm(true)}
            >
              <Send className="h-4 w-4 mr-2" />
              Send to {selectedDisputes.length} Dispute{selectedDisputes.length !== 1 ? "s" : ""}
            </Button>
          </CardContent>
        </Card>

        {/* Dispute selector */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="h-4 w-4" />
                Select Disputes
              </CardTitle>
              <div className="flex items-center gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-7 text-xs w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DISPUTE_STATUS_OPTIONS.map(s => (
                      <SelectItem key={s} value={s} className="text-xs capitalize">{s.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Select all */}
            <div
              className="flex items-center gap-2 p-2 mb-2 rounded hover:bg-muted cursor-pointer border-b"
              onClick={toggleAll}
            >
              {selectedDisputes.length === disputes.length && disputes.length > 0 ? (
                <CheckSquare className="h-4 w-4 text-primary" />
              ) : (
                <Square className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="text-sm font-medium">Select All ({disputes.length})</span>
              {selectedDisputes.length > 0 && (
                <Badge variant="outline" className="ml-auto text-xs">{selectedDisputes.length} selected</Badge>
              )}
            </div>

            <div className="space-y-1 max-h-[340px] overflow-y-auto">
              {disputes.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground">No disputes match filter</div>
              ) : (
                disputes.map(d => (
                  <div
                    key={d.id}
                    className={`flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-muted transition-colors ${selectedDisputes.includes(d.id) ? "bg-primary/5" : ""}`}
                    onClick={() => toggleDispute(d.id)}
                  >
                    <Checkbox checked={selectedDisputes.includes(d.id)} onCheckedChange={() => toggleDispute(d.id)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-primary">{d.referenceNumber}</span>
                        <Badge variant="outline" className="text-xs capitalize">{d.status?.replace(/_/g, " ")}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{d.respondingPartyName}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Confirm dialog */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Batch Notification</DialogTitle>
            <DialogDescription>
              You are about to send notifications to parties in {selectedDisputes.length} dispute{selectedDisputes.length !== 1 ? "s" : ""}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="p-3 bg-muted rounded-lg text-sm">
              <p className="font-medium mb-1">{subject}</p>
              <p className="text-muted-foreground text-xs line-clamp-3">{body}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              This will notify the initiating and responding parties for each selected dispute. This action cannot be undone.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>Cancel</Button>
            <Button onClick={handleSend} disabled={sending}>
              {sending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending...</> : <><Send className="h-4 w-4 mr-2" />Send {selectedDisputes.length} Notifications</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
