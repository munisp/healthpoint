import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  Search, FileText, Scale, Activity, Clock, ChevronRight,
  Loader2, AlertCircle, Zap, CalendarDays, X, SlidersHorizontal,
  LayoutGrid, List, Bookmark, BookmarkCheck, Trash2, FolderOpen,
  History, RotateCcw
} from "lucide-react";
import { toast } from "sonner";

type EntityType = "dispute" | "document" | "audit";

interface SavedSearch {
  id: string;
  name: string;
  query: string;
  categories: EntityType[];
  dateFrom: string;
  dateTo: string;
  savedAt: string;
}

const SAVED_SEARCHES_KEY = "healthpoint:saved-searches";
const RECENT_SEARCHES_KEY = "healthpoint:recent-searches";
const MAX_RECENT = 5;

interface RecentSearch {
  query: string;
  categories: EntityType[];
  dateFrom: string;
  dateTo: string;
  searchedAt: string;
}

function loadRecentSearches(): RecentSearch[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistRecentSearches(searches: RecentSearch[]) {
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches));
}

function loadSavedSearches(): SavedSearch[] {
  try {
    const raw = localStorage.getItem(SAVED_SEARCHES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistSavedSearches(searches: SavedSearch[]) {
  localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(searches));
}

const ENTITY_META: Record<EntityType, { label: string; icon: React.ReactNode; color: string; bgColor: string }> = {
  dispute: {
    label: "Disputes",
    icon: <Scale className="h-4 w-4" />,
    color: "text-blue-700 dark:text-blue-300",
    bgColor: "bg-blue-100 dark:bg-blue-900/40",
  },
  document: {
    label: "Documents",
    icon: <FileText className="h-4 w-4" />,
    color: "text-purple-700 dark:text-purple-300",
    bgColor: "bg-purple-100 dark:bg-purple-900/40",
  },
  audit: {
    label: "Audit Events",
    icon: <Activity className="h-4 w-4" />,
    color: "text-amber-700 dark:text-amber-300",
    bgColor: "bg-amber-100 dark:bg-amber-900/40",
  },
};

const QUICK_RANGES = [
  { label: "Today", days: 0 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">{part}</mark>
      : part
  );
}

function describeSearch(s: SavedSearch): string {
  const parts: string[] = [];
  if (s.query) parts.push(`"${s.query}"`);
  if (s.categories.length < 3) parts.push(s.categories.map(c => ENTITY_META[c].label).join(", "));
  if (s.dateFrom || s.dateTo) {
    const from = s.dateFrom ? new Date(s.dateFrom).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
    const to = s.dateTo ? new Date(s.dateTo).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
    if (from && to) parts.push(`${from}–${to}`);
    else if (from) parts.push(`from ${from}`);
    else if (to) parts.push(`until ${to}`);
  }
  return parts.join(" · ") || "All results";
}

export default function GlobalSearch() {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Category filter — all on by default
  const [activeCategories, setActiveCategories] = useState<Set<EntityType>>(
    () => new Set<EntityType>(["dispute", "document", "audit"])
  );

  // Date range filter
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);

  // View mode
  const [groupByCategory, setGroupByCategory] = useState(false);

  // Recent searches — auto-tracked (last 5)
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>(() => loadRecentSearches());
  const lastTrackedRef = useRef("");

  // Save search state
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(() => loadSavedSearches());
  const [savePopoverOpen, setSavePopoverOpen] = useState(false);
  const [savedSearchesOpen, setSavedSearchesOpen] = useState(false);
  const [saveName, setSaveName] = useState("");

  const handleQueryChange = useCallback((val: string) => {
    setQuery(val);
    if (debounceTimer) clearTimeout(debounceTimer);
    const t = setTimeout(() => setDebouncedQuery(val), 350);
    setDebounceTimer(t);
  }, [debounceTimer]);

  function toggleCategory(cat: EntityType) {
    setActiveCategories(prev => {
      const next = new Set<EntityType>(prev);
      if (next.has(cat)) {
        if (next.size === 1) return prev;
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }

  function applyQuickRange(days: number) {
    const to = new Date();
    const from = days === 0 ? new Date() : new Date(Date.now() - days * 86400000);
    setDateFrom(toDateStr(from));
    setDateTo(toDateStr(to));
    setDatePopoverOpen(false);
  }

  function clearDateRange() {
    setDateFrom("");
    setDateTo("");
  }

  // ── Save Search ──────────────────────────────────────────────────────────

  const currentSearchKey = JSON.stringify({
    query: debouncedQuery,
    categories: Array.from(activeCategories).sort(),
    dateFrom,
    dateTo,
  });

  const isCurrentSearchSaved = savedSearches.some(s =>
    JSON.stringify({
      query: s.query,
      categories: [...s.categories].sort(),
      dateFrom: s.dateFrom,
      dateTo: s.dateTo,
    }) === currentSearchKey
  );

  function saveSearch() {
    const name = saveName.trim() || `Search ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
    const newSearch: SavedSearch = {
      id: Date.now().toString(),
      name,
      query: debouncedQuery,
      categories: Array.from(activeCategories),
      dateFrom,
      dateTo,
      savedAt: new Date().toISOString(),
    };
    const updated = [newSearch, ...savedSearches].slice(0, 20); // cap at 20
    setSavedSearches(updated);
    persistSavedSearches(updated);
    setSavePopoverOpen(false);
    setSaveName("");
    toast.success(`Search saved as "${name}"`);
  }

  function loadSearch(s: SavedSearch) {
    setQuery(s.query);
    setDebouncedQuery(s.query);
    setActiveCategories(new Set<EntityType>(s.categories));
    setDateFrom(s.dateFrom);
    setDateTo(s.dateTo);
    setSavedSearchesOpen(false);
    toast.info(`Loaded "${s.name}"`);
  }

  function deleteSearch(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const updated = savedSearches.filter(s => s.id !== id);
    setSavedSearches(updated);
    persistSavedSearches(updated);
    toast.success("Saved search removed");
  }

  // ── Recent search auto-tracking ───────────────────────────────────────────

  const entityTypes = useMemo(() => Array.from(activeCategories), [activeCategories]);

  // Track searches automatically when results arrive
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!searchQuery.data || debouncedQuery.trim().length < 2) return;
    const key = JSON.stringify({ q: debouncedQuery, cats: Array.from(activeCategories).sort(), df: dateFrom, dt: dateTo });
    if (lastTrackedRef.current === key) return;
    lastTrackedRef.current = key;
    const entry: RecentSearch = {
      query: debouncedQuery,
      categories: Array.from(activeCategories),
      dateFrom,
      dateTo,
      searchedAt: new Date().toISOString(),
    };
    setRecentSearches(prev => {
      const deduped = prev.filter(r =>
        !(r.query === entry.query &&
          JSON.stringify([...r.categories].sort()) === JSON.stringify([...entry.categories].sort()) &&
          r.dateFrom === entry.dateFrom && r.dateTo === entry.dateTo)
      );
      const updated = [entry, ...deduped].slice(0, MAX_RECENT);
      persistRecentSearches(updated);
      return updated;
    });
  });

  function loadRecentSearch(r: RecentSearch) {
    setQuery(r.query);
    setDebouncedQuery(r.query);
    setActiveCategories(new Set<EntityType>(r.categories));
    setDateFrom(r.dateFrom);
    setDateTo(r.dateTo);
  }

  function clearRecentSearches() {
    setRecentSearches([]);
    persistRecentSearches([]);
    toast.success("Recent searches cleared");
  }

  function deleteRecentSearch(index: number, e: React.MouseEvent) {
    e.stopPropagation(); // prevent triggering loadRecentSearch
    setRecentSearches(prev => {
      const updated = prev.filter((_, i) => i !== index);
      persistRecentSearches(updated);
      return updated;
    });
  }

  const searchQuery = trpc.search.query.useQuery(
    { q: debouncedQuery, entityTypes, limit: 50 },
    { enabled: debouncedQuery.trim().length >= 2 }
  );

  const allHits = searchQuery.data?.hits ?? [];
  const total = searchQuery.data?.total ?? 0;
  const took = searchQuery.data?.took ?? 0;

  // Client-side date filtering
  const hits = useMemo(() => {
    if (!dateFrom && !dateTo) return allHits;
    return allHits.filter(hit => {
      const item = hit.item as Record<string, unknown>;
      const rawDate =
        (item.createdAt as string) ??
        (item.serviceDate as string) ??
        (item.uploadedAt as string) ??
        null;
      if (!rawDate) return true;
      const d = new Date(rawDate);
      if (dateFrom && d < new Date(dateFrom)) return false;
      if (dateTo && d > new Date(dateTo + "T23:59:59")) return false;
      return true;
    });
  }, [allHits, dateFrom, dateTo]);

  const grouped = useMemo(() => {
    const map: Partial<Record<EntityType, typeof hits>> = {};
    for (const hit of hits) {
      if (!map[hit.entityType]) map[hit.entityType] = [];
      map[hit.entityType]!.push(hit);
    }
    return map;
  }, [hits]);

  const hasDateFilter = !!(dateFrom || dateTo);
  const hasActiveFilters = hasDateFilter || debouncedQuery.trim().length >= 2;
  const filteredCount = hits.length;
  const totalBeforeDate = allHits.length;

  function navigateToHit(hit: typeof hits[0]) {
    if (hit.entityType === "dispute") navigate(`/disputes/${hit.id}`);
    else if (hit.entityType === "document") navigate(`/doc-analyzer`);
    else if (hit.entityType === "audit") navigate(`/audit-trail`);
  }

  function renderHitTitle(hit: typeof hits[0]): string {
    const item = hit.item as Record<string, unknown>;
    if (hit.entityType === "dispute") return (item.referenceNumber as string) ?? hit.id;
    if (hit.entityType === "document") return (item.fileName as string) ?? hit.id;
    if (hit.entityType === "audit") return (item.action as string) ?? hit.id;
    return hit.id;
  }

  function renderHitSubtitle(hit: typeof hits[0]): string {
    const item = hit.item as Record<string, unknown>;
    if (hit.entityType === "dispute")
      return `${item.payerName ?? item.respondingPartyName ?? "Unknown payer"} · ${item.status ?? ""} · ${item.serviceType ?? ""}`;
    if (hit.entityType === "document")
      return `Dispute: ${item.disputeId ?? "—"} · ${item.documentType ?? ""}`;
    if (hit.entityType === "audit")
      return `${item.entityType ?? ""} ${item.entityId ?? ""} · User: ${item.userId ?? "—"}`;
    return "";
  }

  function renderHitDate(hit: typeof hits[0]): string | null {
    const item = hit.item as Record<string, unknown>;
    const raw = (item.createdAt as string) ?? (item.serviceDate as string) ?? null;
    if (!raw) return null;
    return new Date(raw).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  const dateRangeLabel = dateFrom && dateTo
    ? `${new Date(dateFrom).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(dateTo).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : dateFrom ? `From ${new Date(dateFrom).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : dateTo ? `Until ${new Date(dateTo).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : "Date Range";

  function HitCard({ hit }: { hit: typeof hits[0] }) {
    const meta = ENTITY_META[hit.entityType];
    const dateStr = renderHitDate(hit);
    return (
      <Card
        className="cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => navigateToHit(hit)}
      >
        <CardContent className="py-3 px-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium shrink-0 ${meta.bgColor} ${meta.color}`}>
                {meta.icon}
                {meta.label.replace(/s$/, "")}
              </div>
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">
                  {highlightText(renderHitTitle(hit), debouncedQuery)}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">
                  {highlightText(renderHitSubtitle(hit), debouncedQuery)}
                </div>
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
            <div className="flex flex-col items-end gap-1 shrink-0">
              <div className="flex items-center gap-1">
                <Badge variant="outline" className="text-xs">{(hit.score * 100).toFixed(0)}%</Badge>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
              {dateStr && (
                <span className="text-[10px] text-muted-foreground">{dateStr}</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-5 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Search className="h-6 w-6 text-primary" />
              Global Search
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Full-text search across disputes, documents, and audit log
            </p>
          </div>

          {/* Saved Searches panel button */}
          <Popover open={savedSearchesOpen} onOpenChange={setSavedSearchesOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
                <FolderOpen className="h-4 w-4" />
                Saved Searches
                {savedSearches.length > 0 && (
                  <Badge variant="secondary" className="text-xs ml-0.5">{savedSearches.length}</Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <p className="text-sm font-semibold">Saved Searches</p>
                <span className="text-xs text-muted-foreground">{savedSearches.length} / 20</span>
              </div>
              {savedSearches.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm px-4">
                  <Bookmark className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  No saved searches yet. Run a search and click "Save Search" to bookmark it.
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  {savedSearches.map(s => (
                    <div
                      key={s.id}
                      className="flex items-start gap-2 px-4 py-3 hover:bg-muted/50 cursor-pointer border-b last:border-0 group"
                      onClick={() => loadSearch(s)}
                    >
                      <BookmarkCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{s.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">{describeSearch(s)}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {new Date(s.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </div>
                      </div>
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0 mt-0.5"
                        onClick={e => deleteSearch(s.id, e)}
                        title="Remove saved search"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9 pr-10 h-11 text-base"
            placeholder="Search by reference number, patient name, payer, CPT code..."
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            autoFocus
          />
          {query && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => { setQuery(""); setDebouncedQuery(""); }}
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {searchQuery.isFetching && (
            <Loader2 className="absolute right-9 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-3">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground shrink-0" />

          {/* Category toggles */}
          <div className="flex items-center gap-1">
            {(Object.entries(ENTITY_META) as [EntityType, typeof ENTITY_META[EntityType]][]).map(([cat, meta]) => {
              const active = activeCategories.has(cat);
              const count = grouped[cat]?.length ?? 0;
              return (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    active
                      ? `${meta.bgColor} ${meta.color} border-transparent`
                      : "bg-background text-muted-foreground border-border hover:border-primary/40"
                  }`}
                >
                  {meta.icon}
                  {meta.label}
                  {debouncedQuery.length >= 2 && count > 0 && (
                    <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-white/30" : "bg-muted"}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <Separator orientation="vertical" className="h-5" />

          {/* Date range picker */}
          <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant={hasDateFilter ? "default" : "outline"}
                size="sm"
                className="gap-1.5 h-8 text-xs"
              >
                <CalendarDays className="h-3.5 w-3.5" />
                {dateRangeLabel}
                {hasDateFilter && (
                  <span
                    className="ml-1 hover:opacity-70"
                    onClick={e => { e.stopPropagation(); clearDateRange(); }}
                  >
                    <X className="h-3 w-3" />
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-4" align="start">
              <p className="text-sm font-semibold mb-3">Filter by Date</p>
              <div className="grid grid-cols-2 gap-1.5 mb-4">
                {QUICK_RANGES.map(r => (
                  <Button key={r.label} variant="outline" size="sm" className="text-xs h-7" onClick={() => applyQuickRange(r.days)}>
                    {r.label}
                  </Button>
                ))}
              </div>
              <Separator className="mb-3" />
              <div className="space-y-2">
                <div>
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input type="date" value={dateFrom} max={dateTo || undefined} onChange={e => setDateFrom(e.target.value)} className="mt-1 h-8 text-xs" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input type="date" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)} className="mt-1 h-8 text-xs" />
                </div>
              </div>
              {hasDateFilter && (
                <Button variant="ghost" className="w-full mt-3 text-xs text-muted-foreground" onClick={clearDateRange}>
                  <X className="h-3 w-3 mr-1" /> Clear date filter
                </Button>
              )}
            </PopoverContent>
          </Popover>

          {/* Save Search button */}
          {hasActiveFilters && (
            <Popover open={savePopoverOpen} onOpenChange={setSavePopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant={isCurrentSearchSaved ? "secondary" : "outline"}
                  size="sm"
                  className="gap-1.5 h-8 text-xs"
                  title={isCurrentSearchSaved ? "This search is already saved" : "Save this search"}
                >
                  {isCurrentSearchSaved
                    ? <BookmarkCheck className="h-3.5 w-3.5 text-primary" />
                    : <Bookmark className="h-3.5 w-3.5" />}
                  {isCurrentSearchSaved ? "Saved" : "Save Search"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-4" align="start">
                <p className="text-sm font-semibold mb-1">Save this search</p>
                <p className="text-xs text-muted-foreground mb-3">{describeSearch({
                  id: "", name: "", query: debouncedQuery,
                  categories: Array.from(activeCategories),
                  dateFrom, dateTo, savedAt: "",
                })}</p>
                <Label className="text-xs text-muted-foreground">Name (optional)</Label>
                <Input
                  className="mt-1 h-8 text-xs"
                  placeholder={`Search ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveSearch(); }}
                  autoFocus
                />
                <div className="flex gap-2 mt-3">
                  <Button size="sm" className="flex-1 text-xs" onClick={saveSearch}>
                    <Bookmark className="h-3 w-3 mr-1" /> Save
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs" onClick={() => setSavePopoverOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* View toggle */}
          <div className="ml-auto flex items-center gap-1 border rounded-md p-0.5">
            <Button variant={groupByCategory ? "ghost" : "secondary"} size="sm" className="h-6 w-6 p-0" onClick={() => setGroupByCategory(false)} title="Flat list">
              <List className="h-3 w-3" />
            </Button>
            <Button variant={groupByCategory ? "secondary" : "ghost"} size="sm" className="h-6 w-6 p-0" onClick={() => setGroupByCategory(true)} title="Group by category">
              <LayoutGrid className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Active filter chips */}
        {hasDateFilter && (
          <div className="flex flex-wrap gap-2">
            <span className="flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
              <CalendarDays className="h-3 w-3" />
              {dateRangeLabel}
              <button onClick={clearDateRange} className="ml-0.5 hover:opacity-70">
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}

        {/* Results */}
        {debouncedQuery.trim().length < 2 ? (
          <div className="flex flex-col items-center py-10 text-muted-foreground">
            <Zap className="h-12 w-12 mb-3 opacity-20" />
            <p className="font-medium">Type at least 2 characters to search</p>
            <p className="text-sm mt-1">Searches across reference numbers, patient names, payers, CPT codes, and more</p>

            {/* Recent Searches */}
            {recentSearches.length > 0 && (
              <div className="mt-8 w-full max-w-md">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                    <History className="h-3.5 w-3.5" />
                    Recent Searches
                    <span className="text-[10px] font-normal text-muted-foreground">({recentSearches.length})</span>
                  </p>
                  <button
                    className="text-[10px] text-muted-foreground hover:text-destructive flex items-center gap-1 px-2 py-1 rounded border border-transparent hover:border-destructive/30 hover:bg-destructive/5 transition-colors"
                    onClick={clearRecentSearches}
                    title="Clear all recent searches"
                  >
                    <Trash2 className="h-3 w-3" /> Clear all
                  </button>
                </div>
                <div className="space-y-1.5">
                  {recentSearches.map((r, i) => (
                    <div key={i} className="relative group/chip">
                      <button
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border hover:border-primary/50 hover:bg-muted/50 transition-colors text-left group pr-8"
                        onClick={() => loadRecentSearch(r)}
                      >
                        <History className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-hover:text-primary" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{r.query}</div>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {r.categories.length < 3 && r.categories.map(c => (
                              <span key={c} className={`text-[10px] px-1.5 py-0.5 rounded-full ${ENTITY_META[c].bgColor} ${ENTITY_META[c].color}`}>
                                {ENTITY_META[c].label}
                              </span>
                            ))}
                            {(r.dateFrom || r.dateTo) && (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                <CalendarDays className="h-2.5 w-2.5" />
                                {r.dateFrom && new Date(r.dateFrom).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                {r.dateFrom && r.dateTo && " – "}
                                {r.dateTo && new Date(r.dateTo).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {new Date(r.searchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                        </span>
                      </button>
                      {/* Per-chip delete button */}
                      <button
                        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/chip:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground"
                        onClick={(e) => deleteRecentSearch(i, e)}
                        title="Remove this search"
                        aria-label={`Remove "${r.query}" from recent searches`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Saved Searches quick chips */}
            {savedSearches.length > 0 && (
              <div className="mt-6 w-full max-w-md">
                <p className="text-xs font-semibold flex items-center gap-1.5 mb-2 text-foreground">
                  <BookmarkCheck className="h-3.5 w-3.5 text-primary" />
                  Saved Searches
                </p>
                <div className="flex flex-wrap gap-2">
                  {savedSearches.slice(0, 6).map(s => (
                    <button
                      key={s.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs hover:border-primary/50 hover:bg-muted/50 transition-colors"
                      onClick={() => loadSearch(s)}
                    >
                      <Bookmark className="h-3 w-3 text-primary" />
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
            {hasDateFilter && totalBeforeDate > 0 && (
              <p className="text-sm mt-1 text-amber-600">
                {totalBeforeDate} result{totalBeforeDate !== 1 ? "s" : ""} found before date filter —{" "}
                <button className="underline" onClick={clearDateRange}>clear date range</button>
              </p>
            )}
            {!hasDateFilter && (
              <p className="text-sm mt-1">Try a different query or expand the category filter</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Result meta */}
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Clock className="h-3 w-3" />
                <span>
                  {filteredCount}{hasDateFilter && filteredCount !== totalBeforeDate ? ` of ${totalBeforeDate}` : ""} result{filteredCount !== 1 ? "s" : ""}
                  {" "}in {took}ms
                </span>
              </div>
              <div className="flex items-center gap-2">
                {(Object.entries(grouped) as [EntityType, typeof hits][]).map(([cat, catHits]) => (
                  <span key={cat} className={`text-xs px-2 py-0.5 rounded-full ${ENTITY_META[cat].bgColor} ${ENTITY_META[cat].color}`}>
                    {catHits.length} {ENTITY_META[cat].label.toLowerCase()}
                  </span>
                ))}
              </div>
            </div>

            {/* Flat list */}
            {!groupByCategory && (
              <div className="space-y-2">
                {hits.map(hit => <HitCard key={`${hit.entityType}-${hit.id}`} hit={hit} />)}
              </div>
            )}

            {/* Grouped by category */}
            {groupByCategory && (
              <div className="space-y-5">
                {(["dispute", "document", "audit"] as EntityType[]).map(cat => {
                  const catHits = grouped[cat];
                  if (!catHits || catHits.length === 0) return null;
                  const meta = ENTITY_META[cat];
                  return (
                    <div key={cat}>
                      <CardHeader className="px-0 pt-0 pb-2">
                        <CardTitle className={`text-sm flex items-center gap-2 ${meta.color}`}>
                          {meta.icon}
                          {meta.label}
                          <Badge variant="secondary" className="text-xs">{catHits.length}</Badge>
                        </CardTitle>
                      </CardHeader>
                      <div className="space-y-2">
                        {catHits.map(hit => <HitCard key={`${hit.entityType}-${hit.id}`} hit={hit} />)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
