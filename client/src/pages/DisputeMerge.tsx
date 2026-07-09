import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { GitMerge, Search, AlertTriangle, CheckCircle2, ArrowRight, X } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  open_negotiation: "bg-blue-100 text-blue-700",
  idr_initiated: "bg-purple-100 text-purple-700",
  determination_issued: "bg-green-100 text-green-700",
  closed: "bg-slate-100 text-slate-600",
  ineligible: "bg-red-100 text-red-700",
};

export default function DisputeMerge() {
  const [, navigate] = useLocation();
  const [primarySearch, setPrimarySearch] = useState("");
  const [secondarySearch, setSecondarySearch] = useState("");
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [secondaryId, setSecondaryId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  const { data: allDisputes } = trpc.disputes.list.useQuery({ limit: 200 });
  const disputes = allDisputes?.items ?? [];

  const mergeMutation = trpc.disputes.merge.useMutation({
    onSuccess: (data) => {
      toast.success("Disputes merged successfully");
      navigate(`/disputes/${data.primaryDisputeId}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const filteredPrimary = disputes.filter((d: any) =>
    d.id !== secondaryId &&
    (primarySearch === "" ||
      d.referenceNumber.toLowerCase().includes(primarySearch.toLowerCase()) ||
      d.initiatingPartyName.toLowerCase().includes(primarySearch.toLowerCase()))
  );

  const filteredSecondary = disputes.filter((d: any) =>
    d.id !== primaryId &&
    (secondarySearch === "" ||
      d.referenceNumber.toLowerCase().includes(secondarySearch.toLowerCase()) ||
      d.initiatingPartyName.toLowerCase().includes(secondarySearch.toLowerCase()))
  );

  const primaryDispute = disputes.find((d: any) => d.id === primaryId);
  const secondaryDispute = disputes.find((d: any) => d.id === secondaryId);

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-orange-100">
            <GitMerge size={20} className="text-orange-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Merge Disputes</h1>
            <p className="text-sm text-slate-500">Combine two duplicate disputes into one canonical record</p>
          </div>
        </div>

        {/* Warning Banner */}
        <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200">
          <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm text-amber-800">
            <strong>Irreversible Action:</strong> Merging will close the secondary dispute and transfer its history to the primary dispute. This action cannot be undone.
          </div>
        </div>

        {/* Selection Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Primary Dispute */}
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <CheckCircle2 size={14} className="text-green-500" />
                Primary Dispute (kept)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                <Input
                  placeholder="Search by reference or party..."
                  value={primarySearch}
                  onChange={e => setPrimarySearch(e.target.value)}
                  className="pl-8 text-sm"
                />
              </div>
              {primaryDispute ? (
                <div className="p-3 rounded-lg bg-green-50 border border-green-200">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-sm text-slate-800">{primaryDispute.referenceNumber}</div>
                      <div className="text-xs text-slate-500">{primaryDispute.initiatingPartyName}</div>
                      <Badge className={`mt-1 text-xs ${STATUS_COLORS[primaryDispute.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {primaryDispute.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <button onClick={() => setPrimaryId(null)} className="text-slate-400 hover:text-red-500">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {filteredPrimary.slice(0, 20).map((d: any) => (
                    <button
                      key={d.id}
                      onClick={() => setPrimaryId(d.id)}
                      className="w-full text-left p-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors"
                    >
                      <div className="text-xs font-semibold text-slate-700">{d.referenceNumber}</div>
                      <div className="text-xs text-slate-400 truncate">{d.initiatingPartyName}</div>
                    </button>
                  ))}
                  {filteredPrimary.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-4">No disputes found</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Secondary Dispute */}
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <X size={14} className="text-red-500" />
                Secondary Dispute (closed)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                <Input
                  placeholder="Search by reference or party..."
                  value={secondarySearch}
                  onChange={e => setSecondarySearch(e.target.value)}
                  className="pl-8 text-sm"
                />
              </div>
              {secondaryDispute ? (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-sm text-slate-800">{secondaryDispute.referenceNumber}</div>
                      <div className="text-xs text-slate-500">{secondaryDispute.initiatingPartyName}</div>
                      <Badge className={`mt-1 text-xs ${STATUS_COLORS[secondaryDispute.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {secondaryDispute.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <button onClick={() => setSecondaryId(null)} className="text-slate-400 hover:text-red-500">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {filteredSecondary.slice(0, 20).map((d: any) => (
                    <button
                      key={d.id}
                      onClick={() => setSecondaryId(d.id)}
                      className="w-full text-left p-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors"
                    >
                      <div className="text-xs font-semibold text-slate-700">{d.referenceNumber}</div>
                      <div className="text-xs text-slate-400 truncate">{d.initiatingPartyName}</div>
                    </button>
                  ))}
                  {filteredSecondary.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-4">No disputes found</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Merge Preview */}
        {primaryDispute && secondaryDispute && (
          <Card className="border-orange-200 bg-orange-50">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3 justify-center text-sm font-medium text-slate-700">
                <span className="px-3 py-1 rounded-full bg-green-100 text-green-700">{primaryDispute.referenceNumber}</span>
                <ArrowRight size={16} className="text-slate-400" />
                <span className="px-3 py-1 rounded-full bg-red-100 text-red-700 line-through opacity-60">{secondaryDispute.referenceNumber}</span>
              </div>
              <p className="text-xs text-center text-slate-500 mt-2">
                {secondaryDispute.referenceNumber} will be closed and its events recorded on {primaryDispute.referenceNumber}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Reason */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Merge Reason (optional)</label>
          <Textarea
            placeholder="Explain why these disputes are being merged..."
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            className="text-sm"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => navigate("/disputes")}>Cancel</Button>
          <Button
            disabled={!primaryId || !secondaryId || mergeMutation.isPending}
            onClick={() => setShowConfirm(true)}
            className="bg-orange-600 hover:bg-orange-700 text-white"
          >
            <GitMerge size={14} className="mr-2" />
            {mergeMutation.isPending ? "Merging..." : "Merge Disputes"}
          </Button>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && primaryDispute && secondaryDispute && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-orange-100">
                <AlertTriangle size={18} className="text-orange-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-800">Confirm Merge</h3>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              You are about to merge <strong>{secondaryDispute.referenceNumber}</strong> into <strong>{primaryDispute.referenceNumber}</strong>.
              The secondary dispute will be permanently closed.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowConfirm(false)}>Cancel</Button>
              <Button
                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white"
                disabled={mergeMutation.isPending}
                onClick={() => {
                  setShowConfirm(false);
                  mergeMutation.mutate({ primaryDisputeId: primaryId!, secondaryDisputeId: secondaryId!, reason: reason || undefined });
                }}
              >
                {mergeMutation.isPending ? "Merging..." : "Confirm Merge"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
