import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Database, RefreshCw, Trash2, Eye } from "lucide-react";

const RESOURCE_TYPES = ["Patient", "Claim", "Coverage", "ExplanationOfBenefit", "Observation", "Condition", "MedicationRequest", "Encounter", "Practitioner", "Organization"];

export default function FHIRCacheViewer() {
  const [disputeFilter, setDisputeFilter] = useState("");
  const [resourceTypeFilter, setResourceTypeFilter] = useState("all");
  const [viewEntry, setViewEntry] = useState<{ id: string; resourceType: string; data: unknown } | null>(null);

  const { data: entries = [], refetch, isLoading } = trpc.fhirCache.list.useQuery({
    disputeId: disputeFilter || undefined,
    resourceType: resourceTypeFilter !== "all" ? resourceTypeFilter : undefined,
  });

  const purgeMutation = trpc.fhirCache.purge.useMutation({
    onSuccess: () => {
      toast.success("FHIR cache entry purged.");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Database className="h-6 w-6 text-violet-600" />
              FHIR Resource Cache
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Cached FHIR R4 resources fetched from connected EMR systems
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-3 items-end">
          <div className="flex-1 max-w-xs">
            <Label className="text-xs">Filter by Dispute ID</Label>
            <Input
              placeholder="Dispute ID..."
              value={disputeFilter}
              onChange={e => setDisputeFilter(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Resource Type</Label>
            <Select value={resourceTypeFilter} onValueChange={setResourceTypeFilter}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {RESOURCE_TYPES.map(rt => <SelectItem key={rt} value={rt}>{rt}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {RESOURCE_TYPES.slice(0, 4).map(rt => {
            const count = entries.filter(e => e.resourceType === rt).length;
            return (
              <Card key={rt} className="p-3">
                <div className="text-xs text-muted-foreground">{rt}</div>
                <div className="text-xl font-bold">{count}</div>
              </Card>
            );
          })}
        </div>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cached Resources</CardTitle>
            <CardDescription>{entries.length} entr{entries.length !== 1 ? "ies" : "y"} in cache</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading cache...</div>
            ) : entries.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Database className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No cached FHIR resources</p>
                <p className="text-sm">Resources are cached automatically when EMR data is pulled into disputes.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-left py-2 pr-4">Resource Type</th>
                      <th className="text-left py-2 pr-4">FHIR ID</th>
                      <th className="text-left py-2 pr-4">Dispute</th>
                      <th className="text-left py-2 pr-4">Fetched At</th>
                      <th className="text-left py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(entry => (
                      <tr key={entry.id} className="border-b hover:bg-muted/30">
                        <td className="py-2 pr-4">
                          <Badge variant="outline">{entry.resourceType}</Badge>
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                          {entry.resourceId ?? "—"}
                        </td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground">
                          {entry.disputeId ?? "—"}
                        </td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground">
                          {entry.fetchedAt ? new Date(entry.fetchedAt).toLocaleString() : "—"}
                        </td>
                        <td className="py-2">
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setViewEntry({ id: entry.id, resourceType: entry.resourceType, data: entry.resourceData })}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-500 hover:text-red-700"
                              onClick={() => purgeMutation.mutate({ emrConnectionId: entry.emrConnectionId })}
                              disabled={purgeMutation.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* View Resource Dialog */}
      <Dialog open={!!viewEntry} onOpenChange={() => setViewEntry(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewEntry?.resourceType} Resource</DialogTitle>
          </DialogHeader>
          <pre className="bg-muted p-4 rounded text-xs font-mono overflow-x-auto whitespace-pre-wrap">
            {viewEntry ? JSON.stringify(viewEntry.data, null, 2) : ""}
          </pre>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
