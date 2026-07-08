import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity, Search, Download, User, FileText, Scale, Shield,
  ChevronRight, Clock, Filter,
} from "lucide-react";

const ACTION_ICONS: Record<string, React.ElementType> = {
  "dispute": Scale,
  "document": FileText,
  "user": User,
  "auth": Shield,
  "default": Activity,
};

const ACTION_COLORS: Record<string, string> = {
  "advance": "bg-blue-500",
  "create": "bg-green-500",
  "update": "bg-yellow-500",
  "delete": "bg-red-500",
  "upload": "bg-purple-500",
  "login": "bg-gray-500",
  "default": "bg-primary",
};

function getActionColor(action: string): string {
  for (const [key, color] of Object.entries(ACTION_COLORS)) {
    if (action.toLowerCase().includes(key)) return color;
  }
  return ACTION_COLORS.default;
}

function getEntityIcon(entityType: string): React.ElementType {
  return ACTION_ICONS[entityType] ?? ACTION_ICONS.default;
}

export default function AuditTrail() {
  const [entityId, setEntityId] = useState("");
  const [entityType, setEntityType] = useState("all");
  const [search, setSearch] = useState("");

  const { data: entries, isLoading } = trpc.audit.list.useQuery({
    entityId: entityId || undefined,
    entityType: entityType === "all" ? undefined : entityType,
    limit: 200,
    offset: 0,
  });

  const filtered = entries?.filter(e => {
    if (!search) return true;
    return (
      e.action.toLowerCase().includes(search.toLowerCase()) ||
      e.entityType.toLowerCase().includes(search.toLowerCase()) ||
      (e.entityId ?? "").toLowerCase().includes(search.toLowerCase())
    );
  }) ?? [];

  const exportCSV = () => {
    const rows = [
      ["Timestamp", "User ID", "Action", "Entity Type", "Entity ID", "IP Address"],
      ...filtered.map(e => [
        e.createdAt ? new Date(e.createdAt).toISOString() : "",
        e.userId,
        e.action,
        e.entityType,
        e.entityId ?? "",
        e.ipAddress ?? "",
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-trail-${Date.now()}.csv`;
    a.click();
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
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
            Export CSV
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search actions..."
                  className="pl-9"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
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
              <Input
                placeholder="Filter by entity ID..."
                className="w-56"
                value={entityId}
                onChange={e => setEntityId(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Events", value: filtered.length },
            { label: "Dispute Actions", value: filtered.filter(e => e.entityType === "dispute").length },
            { label: "Document Events", value: filtered.filter(e => e.entityType === "document").length },
            { label: "User Actions", value: filtered.filter(e => e.entityType === "user").length },
          ].map(stat => (
            <Card key={stat.label}>
              <CardContent className="py-4 text-center">
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Event Timeline
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
                <p className="font-medium">No audit entries found</p>
                <p className="text-sm mt-1">Actions will appear here as they occur</p>
              </div>
            ) : (
              <ScrollArea className="h-[500px]">
                <div className="relative pl-8">
                  {/* Vertical line */}
                  <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />

                  {filtered.map((entry, i) => {
                    const Icon = getEntityIcon(entry.entityType);
                    const dotColor = getActionColor(entry.action);
                    return (
                      <div key={entry.id} className="relative mb-4 last:mb-0">
                        {/* Dot */}
                        <div className={`absolute -left-5 top-1.5 h-2.5 w-2.5 rounded-full ${dotColor} ring-2 ring-background`} />

                        <div className="bg-muted/30 rounded-lg p-3 hover:bg-muted/50 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="font-medium text-sm truncate">{entry.action}</span>
                              <Badge variant="outline" className="text-xs shrink-0">{entry.entityType}</Badge>
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {entry.createdAt ? new Date(entry.createdAt).toLocaleString('en-US', {
                                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                              }) : ''}
                            </span>
                          </div>
                          <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {entry.userId.slice(0, 12)}...
                            </span>
                            {entry.entityId && (
                              <span className="flex items-center gap-1">
                                <ChevronRight className="h-3 w-3" />
                                {entry.entityId}
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
                                  <span className="text-red-500 font-medium">- </span>{entry.oldValue.slice(0, 60)}
                                </div>
                              )}
                              {entry.newValue && (
                                <div className="bg-green-500/10 rounded p-1.5 font-mono truncate">
                                  <span className="text-green-500 font-medium">+ </span>{entry.newValue.slice(0, 60)}
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
