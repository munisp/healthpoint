import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { Columns3, Search, ExternalLink, DollarSign, Building2 } from "lucide-react";

const KANBAN_COLUMNS = [
  { key: "draft", label: "Draft", color: "bg-gray-100 border-gray-300", headerColor: "bg-gray-200 text-gray-700" },
  { key: "submitted", label: "Submitted", color: "bg-blue-50 border-blue-200", headerColor: "bg-blue-100 text-blue-700" },
  { key: "open", label: "Open", color: "bg-cyan-50 border-cyan-200", headerColor: "bg-cyan-100 text-cyan-700" },
  { key: "in_progress", label: "In Progress", color: "bg-yellow-50 border-yellow-200", headerColor: "bg-yellow-100 text-yellow-700" },
  { key: "offer_made", label: "Offer Made", color: "bg-purple-50 border-purple-200", headerColor: "bg-purple-100 text-purple-700" },
  { key: "determination_issued", label: "Determined", color: "bg-green-50 border-green-200", headerColor: "bg-green-100 text-green-700" },
  { key: "closed", label: "Closed", color: "bg-gray-50 border-gray-200", headerColor: "bg-gray-100 text-gray-500" },
];

export default function DisputeKanban() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");

  const { data, isLoading } = trpc.disputes.list.useQuery({ limit: 100, offset: 0 });
  const disputes = data?.items ?? [];

  const formatCurrency = (v: number | string | null | undefined) => {
    if (!v) return null;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v));
  };

  const filtered = search
    ? disputes.filter(d =>
        d.referenceNumber?.toLowerCase().includes(search.toLowerCase()) ||
        d.respondingPartyName?.toLowerCase().includes(search.toLowerCase()) ||
        d.initiatingPartyName?.toLowerCase().includes(search.toLowerCase())
      )
    : disputes;

  const byStatus = Object.fromEntries(
    KANBAN_COLUMNS.map(col => [col.key, filtered.filter(d => d.status === col.key)])
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Columns3 className="h-6 w-6 text-cyan-600" />
            Dispute Kanban Board
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Visual overview of all disputes by status</p>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search disputes..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading disputes...</div>
      ) : (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-3 min-w-max">
            {KANBAN_COLUMNS.map(col => {
              const cards = byStatus[col.key] ?? [];
              return (
                <div key={col.key} className={`w-64 rounded-lg border ${col.color} flex flex-col`}>
                  {/* Column header */}
                  <div className={`px-3 py-2 rounded-t-lg flex items-center justify-between ${col.headerColor}`}>
                    <span className="font-semibold text-sm">{col.label}</span>
                    <Badge variant="outline" className="text-xs bg-white/70">{cards.length}</Badge>
                  </div>
                  {/* Cards */}
                  <div className="flex-1 p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-280px)] overflow-y-auto">
                    {cards.length === 0 ? (
                      <div className="text-xs text-muted-foreground text-center py-6 opacity-60">No disputes</div>
                    ) : (
                      cards.map(d => (
                        <Card
                          key={d.id}
                          className="cursor-pointer hover:shadow-md transition-shadow bg-white dark:bg-background"
                          onClick={() => navigate(`/disputes/${d.id}`)}
                        >
                          <CardContent className="p-2.5">
                            <div className="flex items-start justify-between gap-1">
                              <span className="text-xs font-mono text-primary font-semibold truncate">{d.referenceNumber}</span>
                              <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                            </div>
                            <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                              <Building2 className="h-3 w-3 shrink-0" />
                              <span className="truncate">{d.respondingPartyName}</span>
                            </div>
                            {d.billedAmount && (
                              <div className="flex items-center gap-1 mt-1 text-xs font-medium">
                                <DollarSign className="h-3 w-3 text-green-600" />
                                <span>{formatCurrency(d.billedAmount)}</span>
                              </div>
                            )}
                            {d.serviceType && (
                              <Badge variant="outline" className="text-xs mt-1.5 capitalize">{d.serviceType.replace(/_/g, " ")}</Badge>
                            )}
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
