import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Activity, Search, Download, User, FileText, Scale, Shield,
  ChevronRight, Clock, Filter, Calendar, X, CalendarDays,
} from "lucide-react";

const ACTION_ICONS: Record<string, React.ElementType> = {
  dispute: Scale,
  document: FileText,
  user: User,
  auth: Shield,
  default: Activity,
};

const ACTION_COLORS: Record<string, string> = {
  advance: "bg-blue-500",
  create: "bg-green-500",
  update: "bg-yellow-500",
  delete: "bg-red-500",
  upload: "bg-purple-500",
  login: "bg-gray-500",
  default: "bg-primary",
};

const QUICK_RANGES = [
  { label: "Today", days: 0 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

function getActionColor(action: string): string {
  for (const [key, color] of Object.entries(ACTION_COLORS)) {
    if (action.toLowerCase().includes(key)) return color;
  }
  return ACTION_COLORS.default;
}

function getEntityIcon(entityType: string): React.ElementType {
  return ACTION_ICONS[entityType] ?? ACTION_ICONS.default;
}

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDateDisplay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function AuditTrail() {
  const [entityId, setEntityId] = useState("");
  const [entityType, setEntityType] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const { data: entries, isLoading } = trpc.audit.list.useQuery({
    entityId: entityId || undefined,
    entityType: entityType === "all" ? undefined : entityType,
    limit: 500,
    offset: 0,
  });

  // Client-side filtering: search text + date range
  const filtered = useMemo(() => {
    if (!entries) return [];
    return entries.filter(e => {
      // Text search across action, entityType, entityId, userId
      if (search) {
        const q = search.toLowerCase();
        const match =
          e.action.toLowerCase().includes(q) ||
          e.entityType.toLowerCase().includes(q) ||
          (e.entityId ?? "").toLowerCase().includes(q) ||
          e.userId.toLowerCase().includes(q) ||
          (e.oldValue ?? "").toLowerCase().includes(q) ||
          (e.newValue ?? "").toLowerCase().includes(q);
        if (!match) return false;
      }
      // Date range
      if (dateFrom || dateTo) {
        const ts = e.createdAt ? new Date(e.createdAt).getTime() : 0;
        if (dateFrom && ts < new Date(dateFrom).getTime()) return false;
        if (dateTo) {
          // include full day of dateTo
          const endOfDay = new Date(dateTo);
          endOfDay.setHours(23, 59, 59, 999);
          if (ts > endOfDay.getTime()) return false;
        }
      }
      return true;
    });
  }, [entries, search, dateFrom, dateTo]);

  const applyQuickRange = (days: number) => {
    const now = new Date();
    if (days === 0) {
      setDateFrom(toDateInputValue(now));
      setDateTo(toDateInputValue(now));
    } else {
      const from = new Date(now);
      from.setDate(from.getDate() - days);
      setDateFrom(toDateInputValue(from));
      setDateTo(toDateInputValue(now));
    }
    setDatePickerOpen(false);
  };

  const clearDateRange = () => {
    setDateFrom("");
    setDateTo("");
  };

  const hasDateFilter = dateFrom || dateTo;
  const hasFilters = search || entityType !== "all" || entityId || hasDateFilter;

  const clearAllFilters = () => {
    setSearch("");
    setEntityType("all");
    setEntityId("");
    clearDateRange();
  };

  const exportCSV = () => {
    const rows = [
      ["Timestamp", "User ID", "Action", "Entity Type", "Entity ID", "IP Address", "Old Value", "New Value"],
      ...filtered.map(e => [
        e.createdAt ? new Date(e.createdAt).toISOString() : "",
        e.userId,
        e.action,
        e.entityType,
        e.entityId ?? "",
        e.ipAddress ?? "",
        e.oldValue ?? "",
        e.newValue ?? "",
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-trail-${Date.now()}.csv`;
    a.click();
  };

  const dateRangeLabel = hasDateFilter
    ? `${dateFrom ? formatDateDisplay(dateFrom) : "Start"} – ${dateTo ? formatDateDisplay(dateTo) : "End"}`
    : "Date Range";

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6 text-primary" />
              Audit Trail
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Complete audit log of all user actions, dispute changes, and system events
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV ({filtered.length})
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="py-4 space-y-3">
            {/* Row 1: Search + Entity Type + Entity ID */}
            <div className="flex flex-wrap gap-3">
              {/* Text search */}
              <div className="relative flex-1 min-w-56">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search actions, entity IDs, users, values..."
                  className="pl-9"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setSearch("")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Entity type */}
              <Select value={entityType} onValueChange={setEntityType}>
                <SelectTrigger className="w-44">
                  <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="Entity type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="dispute">Dispute</SelectItem>
                  <SelectItem value="document">Document</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="auth">Auth</SelectItem>
                </SelectContent>
              </Select>

              {/* Entity ID */}
              <Input
                placeholder="Filter by entity ID..."
                className="w-52"
                value={entityId}
                onChange={e => setEntityId(e.target.value)}
              />
            </div>

            {/* Row 2: Date range picker */}
            <div className="flex flex-wrap items-center gap-3">
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant={hasDateFilter ? "default" : "outline"}
                    size="sm"
                    className="gap-2 h-9"
                  >
                    <CalendarDays className="h-4 w-4" />
                    {dateRangeLabel}
                    {hasDateFilter && (
                      <span
                        className="ml-1 rounded-full hover:bg-white/20 p-0.5"
                        onClick={e => { e.stopPropagation(); clearDateRange(); }}
                      >
                        <X className="h-3 w-3" />
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-4" align="start">
                  <div className="space-y-4">
                    <p className="text-sm font-semibold flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      Filter by Date Range
                    </p>

                    {/* Quick ranges */}
                    <div className="grid grid-cols-2 gap-2">
                      {QUICK_RANGES.map(r => (
                        <Button
                          key={r.label}
                          variant="outline"
                          size="sm"
                          className="text-xs h-8"
                          onClick={() => applyQuickRange(r.days)}
                        >
                          {r.label}
                        </Button>
                      ))}
                    </div>

                    <Separator />

                    {/* Custom range */}
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Custom Range</p>
                      <div className="space-y-2">
                        <div>
                          <Label className="text-xs mb-1 block">From</Label>
                          <Input
                            type="date"
                            value={dateFrom}
                            onChange={e => setDateFrom(e.target.value)}
                            max={dateTo || undefined}
                            className="h-8 text-sm"
                          />
                        </div>
                        <div>
                          <Label className="text-xs mb-1 block">To</Label>
                          <Input
                            type="date"
                            value={dateTo}
                            onChange={e => setDateTo(e.target.value)}
                            min={dateFrom || undefined}
                            className="h-8 text-sm"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1 h-8 text-xs"
                          disabled={!dateFrom && !dateTo}
                          onClick={() => setDatePickerOpen(false)}
                        >
                          Apply
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => { clearDateRange(); setDatePickerOpen(false); }}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Active filter chips */}
              {search && (
                <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => setSearch("")}>
                  <Search className="h-3 w-3" />
                  "{search.length > 20 ? search.slice(0, 20) + "…" : search}"
                  <X className="h-3 w-3 ml-0.5" />
                </Badge>
              )}
              {entityType !== "all" && (
                <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => setEntityType("all")}>
                  <Filter className="h-3 w-3" />
                  {entityType}
                  <X className="h-3 w-3 ml-0.5" />
                </Badge>
              )}
              {entityId && (
                <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => setEntityId("")}>
                  ID: {entityId.length > 12 ? entityId.slice(0, 12) + "…" : entityId}
                  <X className="h-3 w-3 ml-0.5" />
                </Badge>
              )}
              {hasDateFilter && (
                <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={clearDateRange}>
                  <CalendarDays className="h-3 w-3" />
                  {dateRangeLabel}
                  <X className="h-3 w-3 ml-0.5" />
                </Badge>
              )}
              {hasFilters && (
                <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={clearAllFilters}>
                  Clear all
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Matching Events", value: filtered.length, total: entries?.length },
            { label: "Dispute Actions", value: filtered.filter(e => e.entityType === "dispute").length },
            { label: "Document Events", value: filtered.filter(e => e.entityType === "document").length },
            { label: "Auth / User", value: filtered.filter(e => e.entityType === "user" || e.entityType === "auth").length },
          ].map(stat => (
            <Card key={stat.label}>
              <CardContent className="py-4 text-center">
                <p className="text-2xl font-bold">{stat.value}</p>
                {stat.total !== undefined && stat.total !== stat.value && (
                  <p className="text-xs text-muted-foreground">of {stat.total} total</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Timeline */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Event Timeline
              {hasFilters && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Filter className="h-3 w-3" />
                  Filtered
                </Badge>
              )}
              <Badge variant="secondary" className="ml-auto">{filtered.length} events</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Activity className="h-8 w-8 animate-pulse mr-3" />
                Loading audit entries...
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Activity className="h-12 w-12 mb-3 opacity-30" />
                <p className="font-medium">No matching events</p>
                <p className="text-sm mt-1">
                  {hasFilters ? "Try adjusting your search or date range" : "Actions will appear here as they occur"}
                </p>
                {hasFilters && (
                  <Button variant="outline" size="sm" className="mt-3" onClick={clearAllFilters}>
                    Clear all filters
                  </Button>
                )}
              </div>
            ) : (
              <ScrollArea className="h-[520px]">
                <div className="relative pl-8">
                  {/* Vertical line */}
                  <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />

                  {filtered.map(entry => {
                    const Icon = getEntityIcon(entry.entityType);
                    const dotColor = getActionColor(entry.action);

                    // Highlight search matches
                    const highlightText = (text: string) => {
                      if (!search || !text) return text;
                      const idx = text.toLowerCase().indexOf(search.toLowerCase());
                      if (idx === -1) return text;
                      return (
                        <>
                          {text.slice(0, idx)}
                          <mark className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">
                            {text.slice(idx, idx + search.length)}
                          </mark>
                          {text.slice(idx + search.length)}
                        </>
                      );
                    };

                    return (
                      <div key={entry.id} className="relative mb-4 last:mb-0">
                        {/* Timeline dot */}
                        <div className={`absolute -left-5 top-1.5 h-2.5 w-2.5 rounded-full ${dotColor} ring-2 ring-background`} />

                        <div className="bg-muted/30 rounded-lg p-3 hover:bg-muted/50 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="font-medium text-sm truncate">
                                {highlightText(entry.action)}
                              </span>
                              <Badge variant="outline" className="text-xs shrink-0">{entry.entityType}</Badge>
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {entry.createdAt
                                ? new Date(entry.createdAt).toLocaleString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : ""}
                            </span>
                          </div>
                          <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {highlightText(entry.userId.slice(0, 12))}...
                            </span>
                            {entry.entityId && (
                              <span className="flex items-center gap-1">
                                <ChevronRight className="h-3 w-3" />
                                {highlightText(entry.entityId)}
                              </span>
                            )}
                            {entry.ipAddress && (
                              <span>{entry.ipAddress}</span>
                            )}
                          </div>
                          {(entry.oldValue || entry.newValue) && (
                            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                              {entry.oldValue && (
                                <div className="bg-red-500/10 rounded p-1.5 font-mono truncate">
                                  <span className="text-red-500 font-medium">- </span>
                                  {highlightText(entry.oldValue.slice(0, 60))}
                                </div>
                              )}
                              {entry.newValue && (
                                <div className="bg-green-500/10 rounded p-1.5 font-mono truncate">
                                  <span className="text-green-500 font-medium">+ </span>
                                  {highlightText(entry.newValue.slice(0, 60))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
