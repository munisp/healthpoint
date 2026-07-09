import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { Bookmark, BookmarkX, ExternalLink, Search, Star, Plus } from "lucide-react";
import { toast } from "sonner";

// Favorites stored in localStorage for persistence without extra DB table
function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("dispute_favorites") ?? "[]");
    } catch { return []; }
  });

  const toggle = (id: string) => {
    setFavorites(prev => {
      const next = prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id];
      localStorage.setItem("dispute_favorites", JSON.stringify(next));
      return next;
    });
  };

  const isFavorite = (id: string) => favorites.includes(id);

  return { favorites, toggle, isFavorite };
}

export default function DisputeFavorites() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"favorites" | "all">("favorites");
  const { favorites, toggle, isFavorite } = useFavorites();

  const { data, isLoading } = trpc.disputes.list.useQuery({ limit: 200, offset: 0 });
  const disputes = data?.items ?? [];

  const favoriteDisputes = disputes.filter(d => favorites.includes(d.id));
  const allDisputes = disputes.filter(d =>
    !search || d.referenceNumber?.toLowerCase().includes(search.toLowerCase()) ||
    d.respondingPartyName?.toLowerCase().includes(search.toLowerCase())
  );

  const displayDisputes = tab === "favorites" ? favoriteDisputes : allDisputes;

  const formatCurrency = (v: number | string | null | undefined) => {
    if (!v) return "—";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v));
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bookmark className="h-6 w-6 text-amber-500" />
          Dispute Bookmarks
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Bookmark high-priority disputes for quick access</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "favorites" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          onClick={() => setTab("favorites")}
        >
          <Star className="h-3.5 w-3.5 inline mr-1.5" />
          Bookmarked ({favoriteDisputes.length})
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "all" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          onClick={() => setTab("all")}
        >
          All Disputes ({disputes.length})
        </button>
      </div>

      {/* Search (only in all tab) */}
      {tab === "all" && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search disputes..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      )}

      {/* Dispute list */}
      {tab === "favorites" && favoriteDisputes.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Bookmark className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <h3 className="font-semibold text-muted-foreground">No bookmarks yet</h3>
            <p className="text-sm text-muted-foreground mt-1">Switch to "All Disputes" and click the bookmark icon to save disputes here</p>
            <Button variant="outline" className="mt-4" onClick={() => setTab("all")}>
              <Plus className="h-4 w-4 mr-1" />Browse Disputes
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {isLoading ? (
            <div className="col-span-3 text-center py-12 text-muted-foreground">Loading...</div>
          ) : displayDisputes.length === 0 ? (
            <div className="col-span-3 text-center py-12 text-muted-foreground">No disputes found</div>
          ) : (
            displayDisputes.map(d => {
              const fav = isFavorite(d.id);
              return (
                <Card key={d.id} className={`cursor-pointer hover:shadow-md transition-shadow ${fav ? "border-amber-200" : ""}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0" onClick={() => navigate(`/disputes/${d.id}`)}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-xs text-primary font-semibold">{d.referenceNumber}</span>
                          <Badge variant="outline" className="text-xs capitalize">{(d.status ?? "—").replace(/_/g, " ")}</Badge>
                        </div>
                        <p className="text-sm font-medium truncate">{d.respondingPartyName}</p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span className="capitalize">{(d.serviceType ?? "—").replace(/_/g, " ")}</span>
                          <span className="font-medium text-foreground">{formatCurrency(d.billedAmount)}</span>
                        </div>
                        {d.createdAt && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(d.createdAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => {
                            toggle(d.id);
                            toast.success(fav ? "Bookmark removed" : "Dispute bookmarked");
                          }}
                          className="p-1 rounded hover:bg-muted"
                        >
                          {fav ? (
                            <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                          ) : (
                            <Star className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                        <button
                          onClick={() => navigate(`/disputes/${d.id}`)}
                          className="p-1 rounded hover:bg-muted"
                        >
                          <ExternalLink className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
