import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation } from "wouter";
import { GitCompare, ExternalLink, TrendingUp, TrendingDown, Minus } from "lucide-react";

function CompareRow({ label, left, right, highlight = false }: {
  label: string;
  left: React.ReactNode;
  right: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <tr className={highlight ? "bg-amber-50" : "hover:bg-muted/20"}>
      <td className="px-4 py-2.5 text-xs font-medium text-muted-foreground w-40">{label}</td>
      <td className="px-4 py-2.5 text-sm border-l">{left}</td>
      <td className="px-4 py-2.5 text-sm border-l">{right}</td>
    </tr>
  );
}

export default function DisputeCompareView() {
  const [, navigate] = useLocation();
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");

  const { data } = trpc.disputes.list.useQuery({ limit: 200, offset: 0 });
  const disputes = data?.items ?? [];

  const leftDispute = disputes.find(d => d.id === leftId);
  const rightDispute = disputes.find(d => d.id === rightId);

  const formatCurrency = (v: number | string | null | undefined) => {
    if (!v) return "—";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v));
  };

  const getAgeDays = (d: typeof disputes[number]) =>
    d.createdAt ? Math.floor((Date.now() - new Date(d.createdAt).getTime()) / 86400000) : null;

  const amountDiff = leftDispute && rightDispute
    ? Number(leftDispute.billedAmount) - Number(rightDispute.billedAmount)
    : null;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GitCompare className="h-6 w-6 text-purple-600" />
          Dispute Compare View
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Side-by-side comparison of two disputes to identify patterns and differences</p>
      </div>

      {/* Selectors */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium mb-1.5 block">Dispute A</label>
          <Select value={leftId} onValueChange={setLeftId}>
            <SelectTrigger><SelectValue placeholder="Select first dispute..." /></SelectTrigger>
            <SelectContent>
              {disputes.map(d => (
                <SelectItem key={d.id} value={d.id}>
                  <span className="font-mono text-xs">{d.referenceNumber}</span>
                  <span className="text-muted-foreground text-xs ml-2">— {d.respondingPartyName}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium mb-1.5 block">Dispute B</label>
          <Select value={rightId} onValueChange={setRightId}>
            <SelectTrigger><SelectValue placeholder="Select second dispute..." /></SelectTrigger>
            <SelectContent>
              {disputes.filter(d => d.id !== leftId).map(d => (
                <SelectItem key={d.id} value={d.id}>
                  <span className="font-mono text-xs">{d.referenceNumber}</span>
                  <span className="text-muted-foreground text-xs ml-2">— {d.respondingPartyName}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Comparison table */}
      {leftDispute && rightDispute ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground w-40">Field</th>
                    <th className="text-left px-4 py-3 font-medium border-l">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-primary">{leftDispute.referenceNumber}</span>
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/disputes/${leftDispute.id}`)}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </th>
                    <th className="text-left px-4 py-3 font-medium border-l">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-primary">{rightDispute.referenceNumber}</span>
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/disputes/${rightDispute.id}`)}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <CompareRow label="Status"
                    left={<Badge variant="outline" className="text-xs capitalize">{leftDispute.status?.replace(/_/g, " ")}</Badge>}
                    right={<Badge variant="outline" className="text-xs capitalize">{rightDispute.status?.replace(/_/g, " ")}</Badge>}
                    highlight={leftDispute.status !== rightDispute.status}
                  />
                  <CompareRow label="Payer"
                    left={leftDispute.respondingPartyName ?? "—"}
                    right={rightDispute.respondingPartyName ?? "—"}
                    highlight={leftDispute.respondingPartyName !== rightDispute.respondingPartyName}
                  />
                  <CompareRow label="Provider"
                    left={leftDispute.initiatingPartyName ?? "—"}
                    right={rightDispute.initiatingPartyName ?? "—"}
                  />
                  <CompareRow label="Service Type"
                    left={<Badge variant="outline" className="text-xs capitalize">{(leftDispute.serviceType ?? "—").replace(/_/g, " ")}</Badge>}
                    right={<Badge variant="outline" className="text-xs capitalize">{(rightDispute.serviceType ?? "—").replace(/_/g, " ")}</Badge>}
                    highlight={leftDispute.serviceType !== rightDispute.serviceType}
                  />
                  <CompareRow label="Billed Amount"
                    left={<span className="font-semibold">{formatCurrency(leftDispute.billedAmount)}</span>}
                    right={<span className="font-semibold">{formatCurrency(rightDispute.billedAmount)}</span>}
                    highlight={leftDispute.billedAmount !== rightDispute.billedAmount}
                  />
                  <CompareRow label="Age (days)"
                    left={<span>{getAgeDays(leftDispute) ?? "—"}d</span>}
                    right={<span>{getAgeDays(rightDispute) ?? "—"}d</span>}
                  />
                  <CompareRow label="Created"
                    left={leftDispute.createdAt ? new Date(leftDispute.createdAt).toLocaleDateString() : "—"}
                    right={rightDispute.createdAt ? new Date(rightDispute.createdAt).toLocaleDateString() : "—"}
                  />
                  <CompareRow label="Service Date"
                    left={leftDispute.serviceDate ? new Date(leftDispute.serviceDate).toLocaleDateString() : "—"}
                    right={rightDispute.serviceDate ? new Date(rightDispute.serviceDate).toLocaleDateString() : "—"}
                  />
                </tbody>
              </table>
            </div>

            {/* Summary diff */}
            {amountDiff !== null && (
              <div className="p-4 border-t bg-muted/30">
                <p className="text-sm font-medium mb-2">Amount Difference</p>
                <div className="flex items-center gap-2">
                  {amountDiff > 0 ? (
                    <><TrendingUp className="h-4 w-4 text-green-600" /><span className="text-green-600 font-semibold">Dispute A is {formatCurrency(Math.abs(amountDiff))} higher</span></>
                  ) : amountDiff < 0 ? (
                    <><TrendingDown className="h-4 w-4 text-red-600" /><span className="text-red-600 font-semibold">Dispute B is {formatCurrency(Math.abs(amountDiff))} higher</span></>
                  ) : (
                    <><Minus className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Same billed amount</span></>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <GitCompare className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Select two disputes above to compare them side by side</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
