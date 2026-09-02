import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Eye, EyeOff, Bell, BellOff, Trash2, ExternalLink, Search, Star } from "lucide-react";
import { useLocation } from "wouter";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-blue-100 text-blue-700",
  open: "bg-cyan-100 text-cyan-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  offer_made: "bg-purple-100 text-purple-700",
  determination_issued: "bg-green-100 text-green-700",
  closed: "bg-gray-100 text-gray-500",
  withdrawn: "bg-red-100 text-red-700",
};

export default function DisputeWatchlist() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const utils = trpc.useUtils();

  const { data: entries = [], isLoading } = trpc.watchlist.list.useQuery();

  const removeMutation = trpc.watchlist.remove.useMutation({
    onSuccess: () => { utils.watchlist.list.invalidate(); toast.success("Removed from watchlist"); },
    onError: (e) => toast.error(e.message),
  });

  const filtered = entries.filter(e =>
    !search || e.dispute?.referenceNumber?.toLowerCase().includes(search.toLowerCase()) ||
    e.dispute?.respondingPartyName?.toLowerCase().includes(search.toLowerCase()) ||
    e.note?.toLowerCase().includes(search.toLowerCase())
  );

  const formatCurrency = (v: number | string | null | undefined) => {
    if (!v) return "—";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Star className="h-6 w-6 text-amber-500" />
            Dispute Watchlist
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Track disputes you want to monitor closely</p>
        </div>
        <Badge variant="outline" className="text-sm">{entries.length} watched</Badge>
      </div>

      {entries.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search watchlist..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading watchlist...</div>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Star className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="font-semibold text-lg mb-2">No disputes watched yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Add disputes to your watchlist from the dispute detail page to monitor their progress.</p>
            <Button onClick={() => navigate("/disputes")}>Browse Disputes</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(entry => (
            <Card key={entry.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <button
                        onClick={() => navigate(`/disputes/${entry.disputeId}`)}
                        className="font-semibold text-primary hover:underline text-sm"
                      >
                        {entry.dispute?.referenceNumber ?? entry.disputeId}
                      </button>
                      {entry.dispute?.status && (
                        <Badge className={`text-xs ${STATUS_COLORS[entry.dispute.status] ?? "bg-gray-100 text-gray-700"}`}>
                          {entry.dispute.status.replace(/_/g, " ")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{entry.dispute?.respondingPartyName ?? "—"}</p>
                    {entry.note && <p className="text-xs text-muted-foreground mt-1 italic">"{entry.note}"</p>}
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      <span>{formatCurrency(entry.dispute?.billedAmount)}</span>
                      <span>Added {new Date(entry.createdAt).toLocaleDateString()}</span>
                      <span className="flex items-center gap-1">
                        {entry.alertOnStatusChange ? <Bell className="h-3 w-3 text-green-500" /> : <BellOff className="h-3 w-3" />}
                        Status alerts
                      </span>
                      <span className="flex items-center gap-1">
                        {entry.alertOnDeadline ? <Bell className="h-3 w-3 text-amber-500" /> : <BellOff className="h-3 w-3" />}
                        Deadline alerts
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => navigate(`/disputes/${entry.disputeId}`)}>
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => removeMutation.mutate({ disputeId: entry.disputeId })}
                      disabled={removeMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
