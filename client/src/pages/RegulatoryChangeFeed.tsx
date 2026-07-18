import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Newspaper, ExternalLink, Search, Filter, BookOpen, AlertTriangle, Info, CheckCircle2, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

const CATEGORY_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  fee_schedule: { label: "Fee Schedule", color: "bg-blue-100 text-blue-700", icon: <BookOpen className="h-3.5 w-3.5" /> },
  court_ruling: { label: "Court Ruling", color: "bg-red-100 text-red-700", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  guidance: { label: "CMS Guidance", color: "bg-purple-100 text-purple-700", icon: <Info className="h-3.5 w-3.5" /> },
  regulation: { label: "Regulation", color: "bg-orange-100 text-orange-700", icon: <BookOpen className="h-3.5 w-3.5" /> },
  certification: { label: "Certification", color: "bg-cyan-100 text-cyan-700", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  data_report: { label: "Data Report", color: "bg-green-100 text-green-700", icon: <Newspaper className="h-3.5 w-3.5" /> },
  proposed_rule: { label: "Proposed Rule", color: "bg-amber-100 text-amber-700", icon: <BookOpen className="h-3.5 w-3.5" /> },
};

const IMPACT_CONFIG: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  low: "bg-green-100 text-green-700 border-green-200",
};

const BORDER_CONFIG: Record<string, string> = {
  critical: "border-l-red-500",
  high: "border-l-orange-400",
  medium: "border-l-yellow-400",
  low: "border-l-green-400",
};

export default function RegulatoryChangeFeed() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [impactFilter, setImpactFilter] = useState("all");

  const { data: updates, isLoading, refetch } = trpc.regulatoryFeed.list.useQuery({
    search: search || undefined,
    category: categoryFilter !== "all" ? categoryFilter : undefined,
    impact: impactFilter !== "all" ? impactFilter : undefined,
    limit: 100,
  });

  const seedMutation = trpc.regulatoryFeed.seed.useMutation({
    onSuccess: (data) => {
      toast.success(`Seeded ${data.seeded} regulatory updates`);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Newspaper className="h-6 w-6 text-slate-600" />
            Regulatory Change Feed
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Stay current with NSA/IDR regulatory updates, court rulings, and CMS guidance</p>
        </div>
        <div className="flex items-center gap-2">
          {user?.role === "admin" && (
            <Button variant="outline" size="sm" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
              <RefreshCw className="h-3 w-3 mr-1" />Seed Updates
            </Button>
          )}
          <a
            href="https://www.cms.gov/nosurprises"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />CMS No Surprises Act
          </a>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search updates..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Button variant={categoryFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setCategoryFilter("all")}>All</Button>
          {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
            <Button key={key} variant={categoryFilter === key ? "default" : "outline"} size="sm" onClick={() => setCategoryFilter(key)}>{cfg.label}</Button>
          ))}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {["all", "critical", "high", "medium", "low"].map(impact => (
            <Button
              key={impact}
              variant={impactFilter === impact ? "default" : "outline"}
              size="sm"
              className="capitalize"
              onClick={() => setImpactFilter(impact)}
            >
              {impact}
            </Button>
          ))}
        </div>
      </div>

      {/* Feed */}
      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
          ))
        ) : !updates?.length ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {search || categoryFilter !== "all" || impactFilter !== "all"
                ? "No updates match your filters"
                : "No regulatory updates in database — click \"Seed Updates\" (admin) to populate"}
            </CardContent>
          </Card>
        ) : (
          updates.map(update => {
            const catCfg = CATEGORY_CONFIG[update.category ?? "guidance"] ?? CATEGORY_CONFIG.guidance;
            const impactClass = IMPACT_CONFIG[update.impactLevel ?? "medium"] ?? IMPACT_CONFIG.medium;
            const borderClass = BORDER_CONFIG[update.impactLevel ?? "medium"] ?? BORDER_CONFIG.medium;
            const tags = update.tags as string[];
            return (
              <Card key={update.id} className={`border-l-4 ${borderClass}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <Badge className={`text-xs flex items-center gap-1 ${catCfg.color}`}>
                          {catCfg.icon}{catCfg.label}
                        </Badge>
                        <Badge className={`text-xs border ${impactClass}`}>
                          {(update.impactLevel ?? "medium").charAt(0).toUpperCase() + (update.impactLevel ?? "medium").slice(1)} Impact
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {update.publishedAt ? new Date(update.publishedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : ""}
                        </span>
                        <span className="text-xs font-medium text-slate-500">— {update.source}</span>
                      </div>
                      <h3 className="font-semibold text-sm text-slate-800 mb-1">{update.title}</h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">{update.summary}</p>
                      {tags?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {tags.map(tag => (
                            <span key={tag} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {update.sourceUrl && (
                      <a
                        href={update.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-blue-600 hover:text-blue-800"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
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
