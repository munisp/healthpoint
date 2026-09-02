import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { StickyNote, Search, Plus, Tag, Clock, User, Trash2, Pin, PinOff } from "lucide-react";

const TAG_OPTIONS = [
  { value: "legal", label: "Legal", color: "bg-purple-100 text-purple-700" },
  { value: "financial", label: "Financial", color: "bg-green-100 text-green-700" },
  { value: "evidence", label: "Evidence", color: "bg-blue-100 text-blue-700" },
  { value: "deadline", label: "Deadline", color: "bg-red-100 text-red-700" },
  { value: "strategy", label: "Strategy", color: "bg-orange-100 text-orange-700" },
  { value: "follow-up", label: "Follow-up", color: "bg-yellow-100 text-yellow-700" },
];

interface Annotation {
  id: string;
  disputeRef: string;
  disputeId: string;
  content: string;
  tags: string[];
  pinned: boolean;
  createdAt: string;
  author: string;
}

export default function DisputeAnnotations() {
  const [search, setSearch] = useState("");
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newDisputeSearch, setNewDisputeSearch] = useState("");
  const [newDisputeId, setNewDisputeId] = useState<string | null>(null);
  const [newTags, setNewTags] = useState<string[]>([]);
  // Local annotations state (in production, this would be stored in DB via tRPC)
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());

  const { user } = useAuth();
  const { data: allDisputes } = trpc.disputes.list.useQuery({ limit: 200 });
  const disputes = (allDisputes?.items ?? []) as any[];

  const filteredDisputes = disputes.filter((d) =>
    newDisputeSearch === "" ||
    d.referenceNumber.toLowerCase().includes(newDisputeSearch.toLowerCase()) ||
    d.initiatingPartyName.toLowerCase().includes(newDisputeSearch.toLowerCase())
  );

  const selectedDispute = disputes.find((d) => d.id === newDisputeId);

  function addAnnotation() {
    if (!newContent.trim()) { toast.error("Annotation cannot be empty"); return; }
    if (!newDisputeId) { toast.error("Please select a dispute"); return; }
    const dispute = disputes.find(d => d.id === newDisputeId);
    const ann: Annotation = {
      id: crypto.randomUUID(),
      disputeRef: dispute?.referenceNumber ?? "—",
      disputeId: newDisputeId,
      content: newContent.trim(),
      tags: newTags,
      pinned: false,
      createdAt: new Date().toISOString(),
      author: (user as any)?.name ?? "You",
    };
    setAnnotations(prev => [ann, ...prev]);
    setNewContent("");
    setNewTags([]);
    setNewDisputeId(null);
    setNewDisputeSearch("");
    setShowNew(false);
    toast.success("Annotation added");
  }

  function deleteAnnotation(id: string) {
    setAnnotations(prev => prev.filter(a => a.id !== id));
    toast.success("Annotation deleted");
  }

  function togglePin(id: string) {
    setPinnedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filtered = annotations
    .filter(a =>
      (search === "" || a.content.toLowerCase().includes(search.toLowerCase()) || a.disputeRef.toLowerCase().includes(search.toLowerCase())) &&
      (filterTag === null || a.tags.includes(filterTag))
    )
    .sort((a, b) => {
      const aPin = pinnedIds.has(a.id) ? 0 : 1;
      const bPin = pinnedIds.has(b.id) ? 0 : 1;
      if (aPin !== bPin) return aPin - bPin;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  return (
    <DashboardLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-yellow-100">
              <StickyNote size={20} className="text-yellow-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Dispute Annotations</h1>
              <p className="text-sm text-slate-500">Add and manage notes and annotations across disputes</p>
            </div>
          </div>
          <Button onClick={() => setShowNew(true)} size="sm">
            <Plus size={14} className="mr-2" />New Annotation
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <Input placeholder="Search annotations..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 text-sm" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setFilterTag(null)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterTag === null ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >All</button>
            {TAG_OPTIONS.map(t => (
              <button
                key={t.value}
                onClick={() => setFilterTag(filterTag === t.value ? null : t.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterTag === t.value ? t.color + " ring-2 ring-offset-1 ring-slate-400" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >{t.label}</button>
            ))}
          </div>
        </div>

        {/* New Annotation Form */}
        {showNew && (
          <Card className="border-yellow-200 bg-yellow-50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-700">New Annotation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Dispute selector */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-600">Link to Dispute</label>
                {selectedDispute ? (
                  <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200">
                    <span className="text-xs font-semibold text-slate-700">{selectedDispute.referenceNumber}</span>
                    <button onClick={() => { setNewDisputeId(null); setNewDisputeSearch(""); }} className="text-xs text-slate-400 hover:text-red-500">Clear</button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Input
                      placeholder="Search disputes..."
                      value={newDisputeSearch}
                      onChange={e => setNewDisputeSearch(e.target.value)}
                      className="text-xs"
                    />
                    {newDisputeSearch.length > 1 && (
                      <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg bg-white">
                        {filteredDisputes.slice(0, 8).map((d) => (
                          <button key={d.id} onClick={() => { setNewDisputeId(d.id); setNewDisputeSearch(d.referenceNumber); }} className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-xs border-b border-slate-50 last:border-0">
                            <span className="font-semibold text-slate-700">{d.referenceNumber}</span>
                            <span className="text-slate-400 ml-2">{d.initiatingPartyName}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Content */}
              <Textarea
                placeholder="Write your annotation..."
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                rows={3}
                className="text-sm"
              />

              {/* Tags */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600 flex items-center gap-1"><Tag size={12} />Tags</label>
                <div className="flex flex-wrap gap-2">
                  {TAG_OPTIONS.map(t => (
                    <button
                      key={t.value}
                      onClick={() => setNewTags(prev => prev.includes(t.value) ? prev.filter(x => x !== t.value) : [...prev, t.value])}
                      className={`px-2 py-1 rounded-full text-xs font-medium border transition-colors ${newTags.includes(t.value) ? t.color + " border-transparent" : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"}`}
                    >{t.label}</button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowNew(false)}>Cancel</Button>
                <Button size="sm" onClick={addAnnotation}>Save Annotation</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Annotations List */}
        {filtered.length === 0 ? (
          <Card className="border-slate-200">
            <CardContent className="py-12 text-center">
              <StickyNote size={24} className="text-slate-200 mx-auto mb-2" />
              <p className="text-sm text-slate-400">{annotations.length === 0 ? "No annotations yet. Add your first note." : "No annotations match your filters."}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map(ann => (
              <Card key={ann.id} className={`border-slate-200 ${pinnedIds.has(ann.id) ? "border-yellow-300 bg-yellow-50/30" : ""}`}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Badge className="text-xs bg-slate-100 text-slate-600">{ann.disputeRef}</Badge>
                        {ann.tags.map(tag => {
                          const t = TAG_OPTIONS.find(x => x.value === tag);
                          return t ? <Badge key={tag} className={`text-xs ${t.color}`}>{t.label}</Badge> : null;
                        })}
                        {pinnedIds.has(ann.id) && <Badge className="text-xs bg-yellow-100 text-yellow-700">Pinned</Badge>}
                      </div>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{ann.content}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                        <span className="flex items-center gap-1"><User size={10} />{ann.author}</span>
                        <span className="flex items-center gap-1"><Clock size={10} />{new Date(ann.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => togglePin(ann.id)} className="text-slate-300 hover:text-yellow-500 p-1" title={pinnedIds.has(ann.id) ? "Unpin" : "Pin"}>
                        {pinnedIds.has(ann.id) ? <PinOff size={14} /> : <Pin size={14} />}
                      </button>
                      <button onClick={() => deleteAnnotation(ann.id)} className="text-slate-300 hover:text-red-500 p-1" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
