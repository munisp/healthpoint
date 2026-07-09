import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Copy, Search, ArrowRight, CheckCircle2, AlertTriangle } from "lucide-react";

export default function DisputeClone() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const { data: allDisputes } = trpc.disputes.list.useQuery({ limit: 200 });
  const disputes = (allDisputes?.items ?? []) as any[];

  const cloneMutation = trpc.disputes.clone.useMutation({
    onSuccess: (data: any) => {
      toast.success(`Cloned as ${data.referenceNumber}`);
      navigate(`/disputes/${data.id}`);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const filtered = disputes.filter((d) =>
    search === "" ||
    d.referenceNumber.toLowerCase().includes(search.toLowerCase()) ||
    d.initiatingPartyName.toLowerCase().includes(search.toLowerCase())
  );

  const selected = disputes.find((d) => d.id === selectedId);

  return (
    <DashboardLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-100">
            <Copy size={20} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Clone Dispute</h1>
            <p className="text-sm text-slate-500">Create a new draft dispute from an existing one</p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-50 border border-blue-200">
          <AlertTriangle size={16} className="text-blue-600 mt-0.5 shrink-0" />
          <p className="text-sm text-blue-800">
            Cloning copies party details, service type, and CPT codes into a new dispute at step 1 (Open Negotiation). Evidence and offers are not copied.
          </p>
        </div>

        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-700">Select Dispute to Clone</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <Input
                placeholder="Search by reference or party name..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 text-sm"
              />
            </div>

            {selected ? (
              <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 flex items-start justify-between">
                <div>
                  <div className="font-semibold text-sm text-slate-800">{selected.referenceNumber}</div>
                  <div className="text-xs text-slate-500">{selected.initiatingPartyName} → {selected.respondingPartyName}</div>
                  <Badge className="mt-1 text-xs bg-blue-100 text-blue-700">{selected.serviceType?.replace(/_/g, " ")}</Badge>
                </div>
                <button onClick={() => setSelectedId(null)} className="text-slate-400 hover:text-red-500 text-xs">Clear</button>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-1">
                {filtered.slice(0, 30).map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    className="w-full text-left p-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-slate-700">{d.referenceNumber}</div>
                        <div className="text-xs text-slate-400 truncate">{d.initiatingPartyName}</div>
                      </div>
                      <ArrowRight size={12} className="text-slate-300" />
                    </div>
                  </button>
                ))}
                {filtered.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No disputes found</p>}
              </div>
            )}
          </CardContent>
        </Card>

        {selected && (
          <Card className="border-green-200 bg-green-50">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={16} className="text-green-600" />
                <div className="text-sm text-green-800">
                  Ready to clone <strong>{selected.referenceNumber}</strong> — a new dispute will be created at step 1 with the same party and service details.
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => navigate("/disputes")}>Cancel</Button>
          <Button
            disabled={!selectedId || cloneMutation.isPending}
            onClick={() => setShowConfirm(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Copy size={14} className="mr-2" />
            {cloneMutation.isPending ? "Cloning..." : "Clone Dispute"}
          </Button>
        </div>
      </div>

      {showConfirm && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Confirm Clone</h3>
            <p className="text-sm text-slate-600 mb-4">
              Clone <strong>{selected.referenceNumber}</strong> into a new draft dispute?
            </p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowConfirm(false)}>Cancel</Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                disabled={cloneMutation.isPending}
                onClick={() => { setShowConfirm(false); cloneMutation.mutate({ disputeId: selectedId! }); }}
              >
                Confirm Clone
              </Button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
