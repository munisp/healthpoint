import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Printer, Search, FileText, Download, Building2, Calendar, DollarSign, Scale } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  open_negotiation: "Open Negotiation",
  idr_initiated: "IDR Initiated",
  determination_issued: "Determination Issued",
  closed: "Closed",
  ineligible: "Ineligible",
};

const STATUS_COLORS: Record<string, string> = {
  open_negotiation: "bg-blue-100 text-blue-700",
  idr_initiated: "bg-purple-100 text-purple-700",
  determination_issued: "bg-green-100 text-green-700",
  closed: "bg-slate-100 text-slate-600",
  ineligible: "bg-red-100 text-red-700",
};

export default function PrintableDisputeSummary() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: allDisputes } = trpc.disputes.list.useQuery({ limit: 200 });
  const disputes = (allDisputes?.items ?? []) as any[];

  const { data: dispute } = trpc.disputes.getById.useQuery(
    { id: selectedId! },
    { enabled: !!selectedId }
  ) as { data: any };

  const filtered = disputes.filter((d) =>
    search === "" ||
    d.referenceNumber.toLowerCase().includes(search.toLowerCase()) ||
    d.initiatingPartyName.toLowerCase().includes(search.toLowerCase())
  );

  function handlePrint() {
    window.print();
    toast.success("Print dialog opened");
  }

  return (
    <DashboardLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6 no-print">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-slate-100">
              <Printer size={20} className="text-slate-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Printable Dispute Summary</h1>
              <p className="text-sm text-slate-500">Generate a print-ready summary for any dispute</p>
            </div>
          </div>
          {dispute && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer size={14} className="mr-2" />Print
              </Button>
              <Button size="sm" onClick={handlePrint}>
                <Download size={14} className="mr-2" />Save as PDF
              </Button>
            </div>
          )}
        </div>

        {/* Dispute Selector */}
        {!selectedId && (
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-700">Select a Dispute</CardTitle>
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
              <div className="max-h-64 overflow-y-auto space-y-1">
                {filtered.slice(0, 30).map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    className="w-full text-left p-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-semibold text-slate-700">{d.referenceNumber}</span>
                        <span className="text-xs text-slate-400 ml-2">{d.initiatingPartyName}</span>
                      </div>
                      <Badge className={`text-xs ${STATUS_COLORS[d.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {STATUS_LABELS[d.status] ?? d.status}
                      </Badge>
                    </div>
                  </button>
                ))}
                {filtered.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No disputes found</p>}
              </div>
            </CardContent>
          </Card>
        )}

        {selectedId && !dispute && (
          <div className="text-center text-sm text-slate-400 py-8">Loading dispute...</div>
        )}
      </div>

      {/* Printable Content */}
      {dispute && (
        <div className="print-area max-w-4xl mx-auto p-6 space-y-6">
          {/* Change dispute button (no-print) */}
          <div className="no-print">
            <button onClick={() => setSelectedId(null)} className="text-xs text-blue-600 hover:underline">← Select different dispute</button>
          </div>

          {/* Header */}
          <div className="border-b-2 border-slate-800 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">IDR Dispute Summary</h1>
                <p className="text-sm text-slate-500 mt-1">Generated {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-slate-800">{dispute.referenceNumber}</div>
                <Badge className={`text-sm ${STATUS_COLORS[dispute.status] ?? "bg-slate-100 text-slate-600"}`}>
                  {STATUS_LABELS[dispute.status] ?? dispute.status}
                </Badge>
              </div>
            </div>
          </div>

          {/* Party Information */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                <Building2 size={14} />Initiating Party
              </h2>
              <div className="space-y-1 text-sm">
                <div><span className="text-slate-500">Name:</span> <span className="font-medium text-slate-800">{dispute.initiatingPartyName}</span></div>
                <div><span className="text-slate-500">Type:</span> <span className="font-medium text-slate-800">{dispute.initiatingPartyType}</span></div>
                {dispute.initiatingPartyNpi && <div><span className="text-slate-500">NPI:</span> <span className="font-medium text-slate-800">{dispute.initiatingPartyNpi}</span></div>}
              </div>
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                <Building2 size={14} />Responding Party
              </h2>
              <div className="space-y-1 text-sm">
                <div><span className="text-slate-500">Name:</span> <span className="font-medium text-slate-800">{dispute.respondingPartyName ?? "—"}</span></div>
                <div><span className="text-slate-500">Type:</span> <span className="font-medium text-slate-800">{dispute.respondingPartyType ?? "—"}</span></div>
                {dispute.respondingPartyNpi && <div><span className="text-slate-500">NPI:</span> <span className="font-medium text-slate-800">{dispute.respondingPartyNpi}</span></div>}
              </div>
            </div>
          </div>

          {/* Service Details */}
          <div>
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Scale size={14} />Service Details
            </h2>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="text-slate-500">Service Type:</span><br /><span className="font-medium text-slate-800">{dispute.serviceType?.replace(/_/g, " ")}</span></div>
              <div><span className="text-slate-500">Service Date:</span><br /><span className="font-medium text-slate-800">{dispute.serviceDate ? new Date(dispute.serviceDate).toLocaleDateString() : "—"}</span></div>
              <div><span className="text-slate-500">Current Step:</span><br /><span className="font-medium text-slate-800">{dispute.currentStep?.replace(/_/g, " ") ?? "—"}</span></div>
              <div><span className="text-slate-500">Patient State:</span><br /><span className="font-medium text-slate-800">{dispute.patientState ?? "—"}</span></div>
              <div><span className="text-slate-500">Facility State:</span><br /><span className="font-medium text-slate-800">{dispute.facilityState ?? "—"}</span></div>
              <div><span className="text-slate-500">CPT Codes:</span><br /><span className="font-medium text-slate-800">{dispute.cptCodes?.join(", ") ?? "—"}</span></div>
            </div>
          </div>

          {/* Financial Summary */}
          <div>
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
              <DollarSign size={14} />Financial Summary
            </h2>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Billed Amount", value: dispute.billedAmount ? `$${parseFloat(dispute.billedAmount).toLocaleString()}` : "—" },
                { label: "QPA Amount", value: dispute.qpaAmount ? `$${parseFloat(dispute.qpaAmount).toLocaleString()}` : "—" },
                { label: "Determination Amount", value: dispute.determinationAmount ? `$${parseFloat(dispute.determinationAmount).toLocaleString()}` : "Pending" },
              ].map(item => (
                <div key={item.label} className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-xs text-slate-500 mb-1">{item.label}</div>
                  <div className="text-lg font-bold text-slate-800">{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Key Dates */}
          <div>
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Calendar size={14} />Key Dates
            </h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[
                { label: "Dispute Created", value: dispute.createdAt },
                { label: "Open Negotiation Deadline", value: dispute.openNegotiationDeadline },
                { label: "IDR Initiation Deadline", value: dispute.idrInitiationDeadline },
                { label: "Closed At", value: dispute.closedAt },
              ].map(item => (
                <div key={item.label}>
                  <span className="text-slate-500">{item.label}:</span>{" "}
                  <span className="font-medium text-slate-800">
                    {item.value ? new Date(item.value).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          {dispute.notes && (
            <div>
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                <FileText size={14} />Notes
              </h2>
              <p className="text-sm text-slate-700 whitespace-pre-wrap p-3 rounded-lg bg-slate-50 border border-slate-200">{dispute.notes}</p>
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-slate-200 pt-4 text-xs text-slate-400 text-center">
            HealthPoint IDR Platform · Confidential · Generated {new Date().toLocaleString()}
          </div>
        </div>
      )}

      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-area { padding: 0 !important; }
        }
      `}</style>
    </DashboardLayout>
  );
}
