import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Scissors, Plus, Trash2, Calculator, FileText, DollarSign } from "lucide-react";

interface CPTLine {
  id: string;
  cptCode: string;
  description: string;
  billedAmount: string;
  qpaAmount: string;
  units: number;
}

const CPT_DESCRIPTIONS: Record<string, string> = {
  "99213": "Office/outpatient visit, established patient, low complexity",
  "99214": "Office/outpatient visit, established patient, moderate complexity",
  "99215": "Office/outpatient visit, established patient, high complexity",
  "99281": "Emergency department visit, self-limited",
  "99282": "Emergency department visit, low complexity",
  "99283": "Emergency department visit, moderate complexity",
  "99284": "Emergency department visit, high complexity",
  "99285": "Emergency department visit, high complexity with threat to life",
  "99291": "Critical care, first 30-74 minutes",
  "00100": "Anesthesia for procedures on salivary glands",
  "27447": "Total knee arthroplasty",
  "27130": "Total hip arthroplasty",
  "43239": "Upper GI endoscopy with biopsy",
  "70553": "MRI brain with contrast",
  "71046": "Chest X-ray, 2 views",
};

export default function SplitBillAnalysis() {
  const [disputeRef, setDisputeRef] = useState("");
  const [selectedDisputeId, setSelectedDisputeId] = useState<string | null>(null);
  const [lines, setLines] = useState<CPTLine[]>([
    { id: crypto.randomUUID(), cptCode: "", description: "", billedAmount: "", qpaAmount: "", units: 1 },
  ]);

  const { data: allDisputes } = trpc.disputes.list.useQuery({ limit: 200 });
  const disputes = allDisputes?.items ?? [];

  const filteredDisputes = disputes.filter((d: any) =>
    disputeRef === "" ||
    d.referenceNumber.toLowerCase().includes(disputeRef.toLowerCase()) ||
    d.initiatingPartyName.toLowerCase().includes(disputeRef.toLowerCase())
  );

  const selectedDispute = disputes.find((d: any) => d.id === selectedDisputeId) as any;

  function addLine() {
    setLines(prev => [...prev, { id: crypto.randomUUID(), cptCode: "", description: "", billedAmount: "", qpaAmount: "", units: 1 }]);
  }

  function removeLine(id: string) {
    setLines(prev => prev.filter(l => l.id !== id));
  }

  function updateLine(id: string, field: keyof CPTLine, value: string | number) {
    setLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      const updated = { ...l, [field]: value };
      if (field === "cptCode" && typeof value === "string") {
        updated.description = CPT_DESCRIPTIONS[value] ?? "";
      }
      return updated;
    }));
  }

  const totalBilled = lines.reduce((s, l) => s + (parseFloat(l.billedAmount) || 0) * l.units, 0);
  const totalQPA = lines.reduce((s, l) => s + (parseFloat(l.qpaAmount) || 0) * l.units, 0);
  const disputeGap = totalBilled - totalQPA;

  function exportAnalysis() {
    const rows = [
      ["CPT Code", "Description", "Units", "Billed Amount", "QPA Amount", "Dispute Gap"],
      ...lines.map(l => [
        l.cptCode,
        l.description,
        l.units,
        `$${(parseFloat(l.billedAmount) || 0) * l.units}`,
        `$${(parseFloat(l.qpaAmount) || 0) * l.units}`,
        `$${((parseFloat(l.billedAmount) || 0) - (parseFloat(l.qpaAmount) || 0)) * l.units}`,
      ]),
      ["TOTAL", "", "", `$${totalBilled.toFixed(2)}`, `$${totalQPA.toFixed(2)}`, `$${disputeGap.toFixed(2)}`],
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `split-bill-${selectedDispute?.referenceNumber ?? "analysis"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Split-bill analysis exported");
  }

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-100">
              <Scissors size={20} className="text-indigo-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Split-Bill Analysis</h1>
              <p className="text-sm text-slate-500">Break down a multi-service claim into per-CPT-code dispute lines</p>
            </div>
          </div>
          <Button onClick={exportAnalysis} variant="outline" size="sm" disabled={lines.every(l => !l.cptCode)}>
            <FileText size={14} className="mr-2" />Export CSV
          </Button>
        </div>

        {/* Dispute Selector */}
        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-700">Link to Dispute (optional)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Input
                placeholder="Search by reference number or party name..."
                value={disputeRef}
                onChange={e => setDisputeRef(e.target.value)}
                className="text-sm"
              />
            </div>
            {selectedDispute ? (
              <div className="flex items-center justify-between p-3 rounded-lg bg-blue-50 border border-blue-200">
                <div>
                  <span className="font-semibold text-sm text-slate-800">{selectedDispute.referenceNumber}</span>
                  <span className="text-xs text-slate-500 ml-2">{selectedDispute.initiatingPartyName}</span>
                  <Badge className="ml-2 text-xs bg-blue-100 text-blue-700">Linked</Badge>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setSelectedDisputeId(null); setDisputeRef(""); }}>
                  Unlink
                </Button>
              </div>
            ) : disputeRef.length > 1 && (
              <div className="max-h-40 overflow-y-auto space-y-1 border border-slate-200 rounded-lg p-2">
                {filteredDisputes.slice(0, 10).map((d: any) => (
                  <button
                    key={d.id}
                    onClick={() => { setSelectedDisputeId(d.id); setDisputeRef(d.referenceNumber); }}
                    className="w-full text-left p-2 rounded hover:bg-slate-50 text-xs"
                  >
                    <span className="font-semibold text-slate-700">{d.referenceNumber}</span>
                    <span className="text-slate-400 ml-2">{d.initiatingPartyName}</span>
                  </button>
                ))}
                {filteredDisputes.length === 0 && <p className="text-xs text-slate-400 text-center py-2">No disputes found</p>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* CPT Lines */}
        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Calculator size={14} className="text-indigo-500" />
                CPT Code Breakdown
              </CardTitle>
              <Button onClick={addLine} size="sm" variant="outline">
                <Plus size={14} className="mr-1" />Add Line
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Column Headers */}
            <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-slate-500 px-2">
              <div className="col-span-2">CPT Code</div>
              <div className="col-span-4">Description</div>
              <div className="col-span-1">Units</div>
              <div className="col-span-2">Billed ($)</div>
              <div className="col-span-2">QPA ($)</div>
              <div className="col-span-1"></div>
            </div>

            {lines.map(line => (
              <div key={line.id} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-2">
                  <Input
                    value={line.cptCode}
                    onChange={e => updateLine(line.id, "cptCode", e.target.value)}
                    placeholder="e.g. 99285"
                    className="text-xs h-8"
                  />
                </div>
                <div className="col-span-4">
                  <Input
                    value={line.description}
                    onChange={e => updateLine(line.id, "description", e.target.value)}
                    placeholder="Service description"
                    className="text-xs h-8"
                  />
                </div>
                <div className="col-span-1">
                  <Input
                    type="number"
                    min={1}
                    value={line.units}
                    onChange={e => updateLine(line.id, "units", parseInt(e.target.value) || 1)}
                    className="text-xs h-8"
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={line.billedAmount}
                    onChange={e => updateLine(line.id, "billedAmount", e.target.value)}
                    placeholder="0.00"
                    className="text-xs h-8"
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={line.qpaAmount}
                    onChange={e => updateLine(line.id, "qpaAmount", e.target.value)}
                    placeholder="0.00"
                    className="text-xs h-8"
                  />
                </div>
                <div className="col-span-1 flex justify-center">
                  <button
                    onClick={() => removeLine(line.id)}
                    disabled={lines.length === 1}
                    className="text-slate-300 hover:text-red-500 disabled:opacity-30"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}

            {/* Totals Row */}
            <div className="border-t border-slate-200 pt-3 mt-3">
              <div className="grid grid-cols-3 gap-4">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-xs text-slate-500 mb-1">Total Billed</div>
                  <div className="text-lg font-bold text-slate-800">${totalBilled.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                  <div className="text-xs text-slate-500 mb-1">Total QPA</div>
                  <div className="text-lg font-bold text-blue-700">${totalQPA.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
                <div className={`p-3 rounded-lg border ${disputeGap > 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
                  <div className="text-xs text-slate-500 mb-1">Dispute Gap</div>
                  <div className={`text-lg font-bold ${disputeGap > 0 ? "text-red-700" : "text-green-700"}`}>
                    <DollarSign size={14} className="inline" />{Math.abs(disputeGap).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Per-line breakdown */}
        {lines.some(l => l.cptCode && l.billedAmount) && (
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-700">Line-by-Line Dispute Gap</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {lines.filter(l => l.cptCode).map(line => {
                  const billed = (parseFloat(line.billedAmount) || 0) * line.units;
                  const qpa = (parseFloat(line.qpaAmount) || 0) * line.units;
                  const gap = billed - qpa;
                  const gapPct = billed > 0 ? (gap / billed) * 100 : 0;
                  return (
                    <div key={line.id} className="flex items-center gap-3">
                      <div className="w-20 shrink-0">
                        <Badge className="bg-indigo-100 text-indigo-700 text-xs">{line.cptCode}</Badge>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-slate-600 truncate">{line.description || "—"}</div>
                        <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${gap > 0 ? "bg-red-400" : "bg-green-400"}`}
                            style={{ width: `${Math.min(100, Math.abs(gapPct))}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-xs font-semibold ${gap > 0 ? "text-red-600" : "text-green-600"}`}>
                          {gap > 0 ? "+" : ""}{gap.toLocaleString(undefined, { style: "currency", currency: "USD" })}
                        </div>
                        <div className="text-xs text-slate-400">{gapPct.toFixed(1)}%</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
