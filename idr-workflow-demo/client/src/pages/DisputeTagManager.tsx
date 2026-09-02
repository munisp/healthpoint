import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { Tag, Plus, X, ExternalLink, Search } from "lucide-react";
import { toast } from "sonner";

const PRESET_TAGS = [
  { label: "High Priority", color: "bg-red-100 text-red-700 border-red-200" },
  { label: "Legal Review", color: "bg-purple-100 text-purple-700 border-purple-200" },
  { label: "Pending Info", color: "bg-amber-100 text-amber-700 border-amber-200" },
  { label: "Complex Claim", color: "bg-blue-100 text-blue-700 border-blue-200" },
  { label: "Air Ambulance", color: "bg-sky-100 text-sky-700 border-sky-200" },
  { label: "Follow Up", color: "bg-green-100 text-green-700 border-green-200" },
  { label: "Duplicate", color: "bg-gray-100 text-gray-700 border-gray-200" },
  { label: "Escalated", color: "bg-orange-100 text-orange-700 border-orange-200" },
];

function useDisputeTags() {
  const [tags, setTags] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem("dispute_tags") ?? "{}"); }
    catch { return {}; }
  });

  const addTag = (disputeId: string, tag: string) => {
    setTags(prev => {
      const current = prev[disputeId] ?? [];
      if (current.includes(tag)) return prev;
      const next = { ...prev, [disputeId]: [...current, tag] };
      localStorage.setItem("dispute_tags", JSON.stringify(next));
      return next;
    });
  };

  const removeTag = (disputeId: string, tag: string) => {
    setTags(prev => {
      const next = { ...prev, [disputeId]: (prev[disputeId] ?? []).filter(t => t !== tag) };
      localStorage.setItem("dispute_tags", JSON.stringify(next));
      return next;
    });
  };

  return { tags, addTag, removeTag };
}

export default function DisputeTagManager() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [customTag, setCustomTag] = useState("");
  const [activeDisputeId, setActiveDisputeId] = useState<string | null>(null);
  const { tags, addTag, removeTag } = useDisputeTags();

  const { data, isLoading } = trpc.disputes.list.useQuery({ limit: 200, offset: 0 });
  const disputes = data?.items ?? [];

  const filtered = useMemo(() => {
    return disputes.filter(d => {
      const q = search.toLowerCase();
      const matchesSearch = !q || d.referenceNumber?.toLowerCase().includes(q) || d.respondingPartyName?.toLowerCase().includes(q);
      const disputeTags = tags[d.id] ?? [];
      const matchesTag = !filterTag || disputeTags.includes(filterTag);
      return matchesSearch && matchesTag;
    });
  }, [disputes, search, filterTag, tags]);

  const allUsedTags = useMemo(() => {
    const set = new Set<string>();
    Object.values(tags).forEach(ts => ts.forEach(t => set.add(t)));
    return Array.from(set);
  }, [tags]);

  const handleAddCustomTag = (disputeId: string) => {
    if (!customTag.trim()) return;
    addTag(disputeId, customTag.trim());
    setCustomTag("");
    toast.success(`Tag "${customTag.trim()}" added`);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Tag className="h-6 w-6 text-indigo-600" />
          Dispute Tag Manager
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Organize disputes with custom labels for filtering and prioritization</p>
      </div>

      {/* Filter by tag */}
      {allUsedTags.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-muted-foreground font-medium">Filter by tag:</span>
          <button
            className={`text-xs px-2 py-1 rounded-full border ${!filterTag ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
            onClick={() => setFilterTag("")}
          >All</button>
          {allUsedTags.map(t => (
            <button
              key={t}
              className={`text-xs px-2 py-1 rounded-full border ${filterTag === t ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
              onClick={() => setFilterTag(t === filterTag ? "" : t)}
            >{t}</button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search disputes..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Dispute list */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No disputes found</div>
        ) : (
          filtered.map(d => {
            const disputeTags = tags[d.id] ?? [];
            const isActive = activeDisputeId === d.id;
            return (
              <Card key={d.id} className="overflow-visible">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs text-primary font-semibold">{d.referenceNumber}</span>
                        <Badge variant="outline" className="text-xs capitalize">{(d.status ?? "—").replace(/_/g, " ")}</Badge>
                        <button onClick={() => navigate(`/disputes/${d.id}`)}>
                          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                        </button>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{d.respondingPartyName}</p>

                      {/* Tags */}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {disputeTags.map(t => {
                          const preset = PRESET_TAGS.find(p => p.label === t);
                          return (
                            <span key={t} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${preset?.color ?? "bg-muted text-muted-foreground border-border"}`}>
                              {t}
                              <button onClick={() => removeTag(d.id, t)}>
                                <X className="h-3 w-3 hover:opacity-70" />
                              </button>
                            </span>
                          );
                        })}
                        <button
                          className="text-xs px-2 py-0.5 rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary"
                          onClick={() => setActiveDisputeId(isActive ? null : d.id)}
                        >
                          <Plus className="h-3 w-3 inline" /> Add tag
                        </button>
                      </div>

                      {/* Tag picker */}
                      {isActive && (
                        <div className="mt-3 p-3 bg-muted/50 rounded-lg space-y-2">
                          <div className="flex flex-wrap gap-1.5">
                            {PRESET_TAGS.filter(p => !disputeTags.includes(p.label)).map(p => (
                              <button
                                key={p.label}
                                className={`text-xs px-2 py-0.5 rounded-full border ${p.color} hover:opacity-80`}
                                onClick={() => { addTag(d.id, p.label); toast.success(`Tag "${p.label}" added`); }}
                              >{p.label}</button>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <Input
                              className="h-7 text-xs"
                              placeholder="Custom tag..."
                              value={customTag}
                              onChange={e => setCustomTag(e.target.value)}
                              onKeyDown={e => e.key === "Enter" && handleAddCustomTag(d.id)}
                            />
                            <Button size="sm" className="h-7 text-xs" onClick={() => handleAddCustomTag(d.id)}>Add</Button>
                          </div>
                        </div>
                      )}
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
