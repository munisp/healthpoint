import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Separator } from "@/components/ui/separator";
import {
  Search, FileText, Scale, Activity, Clock, ChevronRight,
  Loader2, AlertCircle, Zap
} from "lucide-react";

type EntityType = "dispute" | "document" | "audit";

const ENTITY_ICONS: Record<EntityType, React.ReactNode> = {
  dispute: <Scale className="h-4 w-4" />,
  document: <FileText className="h-4 w-4" />,
  audit: <Activity className="h-4 w-4" />,
};

const ENTITY_COLORS: Record<EntityType, string> = {
  dispute: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  document: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  audit: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

function highlightText(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">{part}</mark>
      : part
  );
}

export default function GlobalSearch() {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [entityTypes, setEntityTypes] = useState<EntityType[]>(["dispute", "document", "audit"]);
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleQueryChange = useCallback((val: string) => {
    setQuery(val);
    if (debounceTimer) clearTimeout(debounceTimer);
    const t = setTimeout(() => setDebouncedQuery(val), 350);
    setDebounceTimer(t);
  }, [debounceTimer]);

  const searchQuery = trpc.search.query.useQuery(
    { q: debouncedQuery, entityTypes, limit: 30 },
    { enabled: debouncedQuery.trim().length >= 2 }
  );

  const hits = searchQuery.data?.hits ?? [];
  const total = searchQuery.data?.total ?? 0;
  const took = searchQuery.data?.took ?? 0;

  function navigateToHit(hit: typeof hits[0]) {
    if (hit.entityType === "dispute") {
      navigate(`/disputes/${hit.id}`);
    } else if (hit.entityType === "document") {
      navigate(`/doc-analyzer`);
    } else if (hit.entityType === "audit") {
      navigate(`/audit-trail`);
    }
  }

  function renderHitTitle(hit: typeof hits[0]): string {
    const item = hit.item as Record<string, unknown>;
    if (hit.entityType === "dispute") {
      return (item.referenceNumber as string) ?? hit.id;
    }
    if (hit.entityType === "document") {
      return (item.fileName as string) ?? hit.id;
    }
    if (hit.entityType === "audit") {
      return (item.action as string) ?? hit.id;
    }
    return hit.id;
  }

  function renderHitSubtitle(hit: typeof hits[0]): string {
    const item = hit.item as Record<string, unknown>;
    if (hit.entityType === "dispute") {
      return `${item.payerName ?? "Unknown payer"} · ${item.status ?? ""} · ${item.serviceType ?? ""}`;
    }
    if (hit.entityType === "document") {
      return `Dispute: ${item.disputeId ?? "—"} · ${item.documentType ?? ""}`;
    }
    if (hit.entityType === "audit") {
      return `${item.entityType ?? ""} ${item.entityId ?? ""} · User: ${item.userId ?? "—"}`;
    }
    return "";
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Search className="h-6 w-6 text-primary" />
            Global Search
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Full-text search across disputes, documents, and audit log (Fuse.js / OpenSearch-ready)
          </p>
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9 pr-4 h-11 text-base"
            placeholder="Search disputes, documents, audit events..."
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            autoFocus
          />
          {searchQuery.isFetching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Entity type filter */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Filter:</span>
          <ToggleGroup
            type="multiple"
            value={entityTypes}
            onValueChange={(v) => setEntityTypes(v as EntityType[])}
            className="gap-1"
          >
            <ToggleGroupItem value="dispute" className="gap-1 text-xs h-8">
              <Scale className="h-3 w-3" /> Disputes
            </ToggleGroupItem>
            <ToggleGroupItem value="document" className="gap-1 text-xs h-8">
              <FileText className="h-3 w-3" /> Documents
            </ToggleGroupItem>
            <ToggleGroupItem value="audit" className="gap-1 text-xs h-8">
              <Activity className="h-3 w-3" /> Audit
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* Results */}
        {debouncedQuery.trim().length < 2 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Zap className="h-12 w-12 mb-3 opacity-20" />
            <p className="font-medium">Type at least 2 characters to search</p>
            <p className="text-sm mt-1">Searches across reference numbers, patient names, payers, CPT codes, and more</p>
          </div>
        ) : searchQuery.isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : searchQuery.isError ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 text-destructive opacity-60" />
              <p>Search failed. Please try again.</p>
            </CardContent>
          </Card>
        ) : hits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Search className="h-10 w-10 mb-3 opacity-20" />
            <p className="font-medium">No results for "{debouncedQuery}"</p>
            <p className="text-sm mt-1">Try a different query or expand the entity type filter</p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Result count */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground pb-1">
              <Clock className="h-3 w-3" />
              {total} result{total !== 1 ? "s" : ""} in {took}ms
            </div>

            {hits.map((hit) => (
              <Card
                key={`${hit.entityType}-${hit.id}`}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => navigateToHit(hit)}
              >
                <CardContent className="py-3 px-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      {/* Entity type badge */}
                      <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium shrink-0 ${ENTITY_COLORS[hit.entityType]}`}>
                        {ENTITY_ICONS[hit.entityType]}
                        {hit.entityType}
                      </div>

                      {/* Content */}
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">
                          {highlightText(renderHitTitle(hit), debouncedQuery)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          {highlightText(renderHitSubtitle(hit), debouncedQuery)}
                        </div>

                        {/* Highlights */}
                        {hit.highlights && Object.keys(hit.highlights).length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {Object.entries(hit.highlights).slice(0, 3).map(([field, values]) => (
                              <span key={field} className="text-xs bg-muted px-1.5 py-0.5 rounded">
                                <span className="text-muted-foreground">{field}:</span>{" "}
                                {highlightText((values[0] ?? "").slice(0, 60), debouncedQuery)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Score + navigate */}
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-xs">
                        {(hit.score * 100).toFixed(0)}%
                      </Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
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
