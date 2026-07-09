import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Clock, AlertTriangle, TrendingUp, ExternalLink } from "lucide-react";

const AGING_BUCKETS = [
  { label: "0-7 days", min: 0, max: 7, color: "#22c55e" },
  { label: "8-14 days", min: 8, max: 14, color: "#84cc16" },
  { label: "15-30 days", min: 15, max: 30, color: "#eab308" },
  { label: "31-60 days", min: 31, max: 60, color: "#f97316" },
  { label: "61-90 days", min: 61, max: 90, color: "#ef4444" },
  { label: "90+ days", min: 91, max: Infinity, color: "#dc2626" },
];

function getAgeDays(createdAt: Date | string | null | undefined): number {
  if (!createdAt) return 0;
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
}

function getBucket(days: number) {
  return AGING_BUCKETS.find(b => days >= b.min && days <= b.max) ?? AGING_BUCKETS[AGING_BUCKETS.length - 1];
}

export default function ClaimAgingReport() {
  const [, navigate] = useLocation();
  const { data, isLoading } = trpc.disputes.list.useQuery({ limit: 100, offset: 0 });
  const disputes = (data?.items ?? []).filter(d => d.status !== "closed" && d.status !== "ineligible");

  const agingData = useMemo(() => {
    return AGING_BUCKETS.map(bucket => ({
      ...bucket,
      count: disputes.filter(d => {
        const age = getAgeDays(d.createdAt);
        return age >= bucket.min && age <= bucket.max;
      }).length,
      amount: disputes
        .filter(d => {
          const age = getAgeDays(d.createdAt);
          return age >= bucket.min && age <= bucket.max;
        })
        .reduce((sum, d) => sum + (Number(d.billedAmount) || 0), 0),
    }));
  }, [disputes]);

  const totalAmount = disputes.reduce((sum, d) => sum + (Number(d.billedAmount) || 0), 0);
  const avgAge = disputes.length > 0
    ? Math.round(disputes.reduce((sum, d) => sum + getAgeDays(d.createdAt), 0) / disputes.length)
    : 0;
  const overdueCount = disputes.filter(d => getAgeDays(d.createdAt) > 30).length;

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(v);

  const sortedByAge = [...disputes].sort((a, b) => getAgeDays(b.createdAt) - getAgeDays(a.createdAt));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Clock className="h-6 w-6 text-orange-500" />
          Claim Aging Report
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Analyze how long open disputes have been in the system</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold">{disputes.length}</div>
            <div className="text-xs text-muted-foreground mt-1">Open Disputes</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold">{avgAge}d</div>
            <div className="text-xs text-muted-foreground mt-1">Average Age</div>
          </CardContent>
        </Card>
        <Card className={overdueCount > 0 ? "border-orange-200" : ""}>
          <CardContent className="p-4 text-center">
            <div className={`text-3xl font-bold ${overdueCount > 0 ? "text-orange-600" : ""}`}>{overdueCount}</div>
            <div className="text-xs text-muted-foreground mt-1">Over 30 Days</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold">{formatCurrency(totalAmount)}</div>
            <div className="text-xs text-muted-foreground mt-1">Total at Stake</div>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Dispute Count by Age Bucket</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground">Loading...</div>
          ) : (
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agingData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    formatter={(value: number, name: string) => [value, "Disputes"]}
                    labelFormatter={(label) => `Age: ${label}`}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {agingData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Aging table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            Oldest Open Disputes
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Reference</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Payer</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Billed</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Age</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sortedByAge.slice(0, 20).map(d => {
                  const age = getAgeDays(d.createdAt);
                  const bucket = getBucket(age);
                  return (
                    <tr key={d.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono text-xs text-primary">{d.referenceNumber}</td>
                      <td className="px-4 py-3 text-sm truncate max-w-[180px]">{d.respondingPartyName}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs capitalize">{d.status?.replace(/_/g, " ")}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right text-sm">{d.billedAmount ? formatCurrency(Number(d.billedAmount)) : "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <Badge style={{ backgroundColor: bucket.color + "20", color: bucket.color, border: `1px solid ${bucket.color}40` }} className="text-xs">
                          {age}d
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/disputes/${d.id}`)}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
