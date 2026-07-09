import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Activity, Search, RefreshCw, ArrowRight, Clock, User, FileText, DollarSign, Scale, AlertTriangle } from "lucide-react";

const EVENT_ICONS: Record<string, React.ElementType> = {
  step_advanced: Scale,
  offer_submitted: DollarSign,
  offer_accepted: DollarSign,
  offer_rejected: DollarSign,
  document_uploaded: FileText,
  comment_added: User,
  deadline_warning: AlertTriangle,
  determination_issued: Scale,
  dispute_created: Activity,
};

const EVENT_COLORS: Record<string, string> = {
  step_advanced: "bg-blue-100 text-blue-600",
  offer_submitted: "bg-green-100 text-green-600",
  offer_accepted: "bg-green-100 text-green-600",
  offer_rejected: "bg-red-100 text-red-600",
  document_uploaded: "bg-purple-100 text-purple-600",
  comment_added: "bg-slate-100 text-slate-600",
  deadline_warning: "bg-amber-100 text-amber-600",
  determination_issued: "bg-indigo-100 text-indigo-600",
  dispute_created: "bg-teal-100 text-teal-600",
};

function timeAgo(date: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function DisputeActivityFeed() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string | null>(null);
  const [refetchKey, setRefetchKey] = useState(0);

  const { data: events, isLoading, refetch } = trpc.audit.list.useQuery(
    { limit: 100 },
    { refetchInterval: 30_000, staleTime: 25_000 }
  );

  const allEvents = (events ?? []) as any[];

  const filtered = allEvents.filter(e =>
    (search === "" ||
      e.description?.toLowerCase().includes(search.toLowerCase()) ||
      e.disputeId?.toLowerCase().includes(search.toLowerCase()) ||
      e.actorName?.toLowerCase().includes(search.toLowerCase())) &&
    (filterType === null || e.eventType === filterType)
  );

  const eventTypes = Array.from(new Set(allEvents.map((e: any) => e.eventType).filter(Boolean)));

  function handleRefresh() {
    refetch();
    setRefetchKey(k => k + 1);
  }

  return (
    <DashboardLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100">
              <Activity size={20} className="text-blue-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Dispute Activity Feed</h1>
              <p className="text-sm text-slate-500">Real-time activity across all disputes — refreshes every 30s</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw size={14} className={`mr-2 ${isLoading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <Input
              placeholder="Search events..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 text-sm"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setFilterType(null)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterType === null ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >All</button>
            {eventTypes.slice(0, 6).map(type => (
              <button
                key={type}
                onClick={() => setFilterType(filterType === type ? null : type)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterType === type ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {type.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="border-slate-200">
            <CardContent className="pt-4">
              <div className="text-xs text-slate-500 mb-1">Total Events</div>
              <div className="text-2xl font-bold text-slate-800">{allEvents.length}</div>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardContent className="pt-4">
              <div className="text-xs text-slate-500 mb-1">Last 24h</div>
              <div className="text-2xl font-bold text-slate-800">
                {allEvents.filter(e => e.createdAt && (Date.now() - new Date(e.createdAt).getTime()) < 86400000).length}
              </div>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardContent className="pt-4">
              <div className="text-xs text-slate-500 mb-1">Event Types</div>
              <div className="text-2xl font-bold text-slate-800">{eventTypes.length}</div>
            </CardContent>
          </Card>
        </div>

        {/* Feed */}
        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-700">
              Recent Activity ({filtered.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-12 text-center text-sm text-slate-400">Loading activity...</div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center">
                <Activity size={24} className="text-slate-200 mx-auto mb-2" />
                <p className="text-sm text-slate-400">No activity found</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {filtered.map((event: any) => {
                  const IconComponent = EVENT_ICONS[event.eventType] ?? Activity;
                  const colorClass = EVENT_COLORS[event.eventType] ?? "bg-slate-100 text-slate-500";
                  return (
                    <div key={event.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                      <div className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${colorClass}`}>
                        <IconComponent size={12} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xs font-medium text-slate-700">{event.description ?? event.eventType?.replace(/_/g, " ")}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              {event.actorName && (
                                <span className="text-xs text-slate-400 flex items-center gap-1">
                                  <User size={10} />{event.actorName}
                                </span>
                              )}
                              <span className="text-xs text-slate-400 flex items-center gap-1">
                                <Clock size={10} />{timeAgo(event.createdAt)}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {event.eventType && (
                              <Badge className={`text-xs ${colorClass}`}>
                                {event.eventType.replace(/_/g, " ")}
                              </Badge>
                            )}
                            {event.disputeId && (
                              <button
                                onClick={() => navigate(`/disputes/${event.disputeId}`)}
                                className="text-slate-300 hover:text-blue-500"
                                title="View dispute"
                              >
                                <ArrowRight size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
