import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation } from "wouter";
import { Shield, Search, ExternalLink, User, FileText, DollarSign, Settings, AlertTriangle, RefreshCw } from "lucide-react";

const ACTION_ICONS: Record<string, React.ReactNode> = {
  dispute_created: <FileText className="h-3.5 w-3.5" />,
  dispute_updated: <FileText className="h-3.5 w-3.5" />,
  status_changed: <RefreshCw className="h-3.5 w-3.5" />,
  offer_submitted: <DollarSign className="h-3.5 w-3.5" />,
  offer_accepted: <DollarSign className="h-3.5 w-3.5" />,
  offer_rejected: <DollarSign className="h-3.5 w-3.5" />,
  document_uploaded: <FileText className="h-3.5 w-3.5" />,
  user_login: <User className="h-3.5 w-3.5" />,
  user_logout: <User className="h-3.5 w-3.5" />,
  settings_changed: <Settings className="h-3.5 w-3.5" />,
  user_suspended: <AlertTriangle className="h-3.5 w-3.5" />,
};

const ACTION_COLORS: Record<string, string> = {
  dispute_created: "bg-blue-100 text-blue-700",
  dispute_updated: "bg-indigo-100 text-indigo-700",
  status_changed: "bg-purple-100 text-purple-700",
  offer_submitted: "bg-green-100 text-green-700",
  offer_accepted: "bg-emerald-100 text-emerald-700",
  offer_rejected: "bg-red-100 text-red-700",
  document_uploaded: "bg-cyan-100 text-cyan-700",
  user_login: "bg-gray-100 text-gray-700",
  user_logout: "bg-gray-100 text-gray-700",
  settings_changed: "bg-amber-100 text-amber-700",
  user_suspended: "bg-red-100 text-red-700",
};

export default function AuditTrailViewer() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const { data, isLoading, refetch } = trpc.audit.list.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const events = data ?? [];
  const total = events.length;

  const filtered = search
    ? events.filter(e =>
        e.action?.toLowerCase().includes(search.toLowerCase()) ||
        e.entityId?.toLowerCase().includes(search.toLowerCase()) ||
        JSON.stringify({ old: e.oldValue, new: e.newValue }).toLowerCase().includes(search.toLowerCase())
      )
    : events;

  const formatTime = (d: Date | string | null | undefined) => {
    if (!d) return "—";
    return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-slate-600" />
            Audit Trail Viewer
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Complete immutable log of all system actions and user activity</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search events..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={actionFilter} onValueChange={v => { setActionFilter(v); setPage(0); }}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All Actions" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            {Object.keys(ACTION_ICONS).map(a => <SelectItem key={a} value={a} className="capitalize">{a.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Badge variant="outline">{total} total events</Badge>
      </div>

      {/* Event log */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Timestamp</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Action</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Entity</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">User</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Details</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y font-mono">
                {isLoading ? (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground font-sans">Loading audit events...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground font-sans">No events found</td></tr>
                ) : (
                  filtered.map((e: typeof events[number], i: number) => {
                    const actionColor = ACTION_COLORS[e.action ?? ""] ?? "bg-gray-100 text-gray-700";
                    const icon = ACTION_ICONS[e.action ?? ""] ?? <Shield className="h-3.5 w-3.5" />;
                    return (
                      <tr key={e.id ?? i} className="hover:bg-muted/30">
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatTime(e.createdAt)}</td>
                        <td className="px-4 py-2.5">
                          <Badge className={`text-xs flex items-center gap-1 w-fit ${actionColor}`}>
                            {icon}{(e.action ?? "unknown").replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          <span className="text-primary">{e.entityType ?? "—"}</span>
                          {e.entityId && <span className="text-muted-foreground ml-1">#{e.entityId.slice(0, 8)}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{e.userId?.slice(0, 8) ?? "system"}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[200px] truncate">
                          {e.newValue ? String(e.newValue).slice(0, 80) : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          {e.entityType === "dispute" && e.entityId && (
                            <Button variant="ghost" size="sm" onClick={() => navigate(`/disputes/${e.entityId}`)}>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-xs text-muted-foreground">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
