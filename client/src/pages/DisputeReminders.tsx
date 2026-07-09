import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation } from "wouter";
import { Bell, Plus, Trash2, ExternalLink, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface Reminder {
  id: string;
  disputeId: string;
  disputeRef: string;
  message: string;
  dueDate: string;
  priority: "low" | "medium" | "high";
  done: boolean;
  createdAt: string;
}

function useReminders() {
  const [reminders, setReminders] = useState<Reminder[]>(() => {
    try { return JSON.parse(localStorage.getItem("dispute_reminders") ?? "[]"); }
    catch { return []; }
  });

  const save = (next: Reminder[]) => {
    setReminders(next);
    localStorage.setItem("dispute_reminders", JSON.stringify(next));
  };

  const add = (r: Omit<Reminder, "id" | "createdAt">) => {
    const next = [...reminders, { ...r, id: crypto.randomUUID(), createdAt: new Date().toISOString() }];
    save(next);
  };

  const remove = (id: string) => save(reminders.filter(r => r.id !== id));
  const toggle = (id: string) => save(reminders.map(r => r.id === id ? { ...r, done: !r.done } : r));

  return { reminders, add, remove, toggle };
}

export default function DisputeReminders() {
  const [, navigate] = useLocation();
  const { reminders, add, remove, toggle } = useReminders();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ disputeId: "", message: "", dueDate: "", priority: "medium" as "low" | "medium" | "high" });
  const [filter, setFilter] = useState<"all" | "pending" | "done" | "overdue">("pending");

  const { data } = trpc.disputes.list.useQuery({ limit: 200, offset: 0 });
  const disputes = data?.items ?? [];

  const filtered = useMemo(() => {
    const now = new Date();
    return reminders
      .filter(r => {
        if (filter === "pending") return !r.done;
        if (filter === "done") return r.done;
        if (filter === "overdue") return !r.done && new Date(r.dueDate) < now;
        return true;
      })
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }, [reminders, filter]);

  const overdueCount = reminders.filter(r => !r.done && new Date(r.dueDate) < new Date()).length;

  const handleAdd = () => {
    if (!form.disputeId || !form.message || !form.dueDate) {
      toast.error("Please fill in all fields");
      return;
    }
    const dispute = disputes.find(d => d.id === form.disputeId);
    add({ ...form, disputeRef: dispute?.referenceNumber ?? "Unknown", done: false });
    setForm({ disputeId: "", message: "", dueDate: "", priority: "medium" });
    setShowForm(false);
    toast.success("Reminder added");
  };

  const priorityColors = { low: "bg-gray-100 text-gray-700", medium: "bg-amber-100 text-amber-700", high: "bg-red-100 text-red-700" };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="h-6 w-6 text-amber-500" />
            Dispute Reminders
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Set personal reminders and follow-up tasks for disputes</p>
        </div>
        <Button onClick={() => setShowForm(s => !s)}>
          <Plus className="h-4 w-4 mr-1" />New Reminder
        </Button>
      </div>

      {/* Add form */}
      {showForm && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h3 className="font-semibold text-sm">Add Reminder</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Dispute</label>
                <Select value={form.disputeId} onValueChange={v => setForm(f => ({ ...f, disputeId: v }))}>
                  <SelectTrigger className="text-xs"><SelectValue placeholder="Select dispute..." /></SelectTrigger>
                  <SelectContent>
                    {disputes.map(d => (
                      <SelectItem key={d.id} value={d.id} className="text-xs">
                        {d.referenceNumber} — {d.respondingPartyName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Due Date</label>
                <Input type="date" className="text-xs" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-medium mb-1 block">Reminder Message</label>
                <Input className="text-xs" placeholder="e.g. Follow up on offer submission..." value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Priority</label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as "low" | "medium" | "high" }))}>
                  <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd}>Add Reminder</Button>
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-2 border-b">
        {(["all", "pending", "overdue", "done"] as const).map(f => (
          <button
            key={f}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${filter === f ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => setFilter(f)}
          >
            {f}{f === "overdue" && overdueCount > 0 && <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full px-1.5">{overdueCount}</span>}
          </button>
        ))}
      </div>

      {/* Reminder list */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Bell className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p>No {filter === "all" ? "" : filter} reminders</p>
          </div>
        ) : (
          filtered.map(r => {
            const isOverdue = !r.done && new Date(r.dueDate) < new Date();
            const daysUntil = Math.ceil((new Date(r.dueDate).getTime() - Date.now()) / 86400000);
            return (
              <Card key={r.id} className={`${r.done ? "opacity-60" : ""} ${isOverdue ? "border-red-200" : ""}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <button onClick={() => toggle(r.id)} className="mt-0.5 shrink-0">
                      <CheckCircle2 className={`h-5 w-5 ${r.done ? "text-green-500 fill-green-100" : "text-muted-foreground"}`} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`font-medium text-sm ${r.done ? "line-through text-muted-foreground" : ""}`}>{r.message}</span>
                        <Badge className={`text-xs ${priorityColors[r.priority]}`}>{r.priority}</Badge>
                        {isOverdue && <Badge className="text-xs bg-red-100 text-red-700"><AlertTriangle className="h-3 w-3 mr-1" />Overdue</Badge>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="font-mono text-primary">{r.disputeRef}</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {r.done ? "Completed" : isOverdue ? `${Math.abs(daysUntil)}d overdue` : daysUntil === 0 ? "Due today" : `Due in ${daysUntil}d`}
                        </span>
                        <span>{new Date(r.dueDate).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/disputes/${r.disputeId}`)}>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => { remove(r.id); toast.success("Reminder removed"); }}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
