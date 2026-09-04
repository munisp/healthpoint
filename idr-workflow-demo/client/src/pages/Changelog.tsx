import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, Search, Zap, Shield, Bug, Sparkles, Star } from "lucide-react";
import { trpc } from "@/lib/trpc";

const TYPE_CONFIG = {
  feature: { label: "Feature", icon: Sparkles, color: "bg-blue-100 text-blue-700" },
  improvement: { label: "Improvement", icon: Zap, color: "bg-purple-100 text-purple-700" },
  bugfix: { label: "Fix", icon: Bug, color: "bg-amber-100 text-amber-700" },
  security: { label: "Security", icon: Shield, color: "bg-red-100 text-red-700" },
};

export default function Changelog() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const { data: entries, isLoading } = trpc.changelog.list.useQuery({ limit: 100 });

  // Group entries by version
  const grouped = (entries ?? []).reduce<Record<string, typeof entries>>((acc, entry) => {
    if (!acc[entry.version]) acc[entry.version] = [];
    acc[entry.version]!.push(entry);
    return acc;
  }, {});

  const filtered = Object.entries(grouped)
    .map(([version, changes]) => ({
      version,
      releasedAt: changes![0]!.releasedAt,
      changes: (changes ?? []).filter(c => {
        const matchSearch = !search || c.title.toLowerCase().includes(search.toLowerCase()) || (c.description ?? "").toLowerCase().includes(search.toLowerCase());
        const matchType = typeFilter === "all" || c.category === typeFilter;
        return matchSearch && matchType;
      }),
    }))
    .filter(r => r.changes.length > 0);

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-blue-600" />
          Changelog
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Release notes and version history for the HealthPoint IDR Platform
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search changes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          {["all", "feature", "improvement", "bugfix", "security"].map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                typeFilter === t
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted border-border text-muted-foreground"
              }`}
            >
              {t === "all" ? "All" : TYPE_CONFIG[t as keyof typeof TYPE_CONFIG]?.label ?? t}
            </button>
          ))}
        </div>
      </div>

      {/* Releases */}
      <div className="space-y-6">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-3"><Skeleton className="h-6 w-40" /></CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ))
        ) : filtered.length === 0 ? (
          <p className="text-center text-muted-foreground py-12 text-sm">
            {entries?.length === 0
              ? "No changelog entries yet — seed via the Admin panel."
              : "No changes match your current filters."}
          </p>
        ) : (
          filtered.map(release => (
            <Card key={release.version}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-lg font-mono">v{release.version}</CardTitle>
                  <span className="text-sm text-muted-foreground ml-auto">
                    {release.releasedAt ? new Date(release.releasedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="space-y-2">
                  {release.changes.map(change => {
                    const cfg = TYPE_CONFIG[change.category as keyof typeof TYPE_CONFIG] ?? TYPE_CONFIG.feature;
                    return (
                      <li key={change.id} className="flex items-start gap-2.5">
                        <span className={`mt-0.5 px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${cfg.color}`}>
                          {cfg.label}
                        </span>
                        <div>
                          <span className="text-sm font-medium">{change.title}</span>
                          {change.isHighlight && <Star className="inline h-3 w-3 ml-1 text-amber-500 fill-amber-500" />}
                          {change.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{change.description}</p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
