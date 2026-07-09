import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip } from "recharts";
import { Star, TrendingUp, TrendingDown, Minus, Award } from "lucide-react";

function scoreGrade(score: number): { grade: string; color: string } {
  if (score >= 85) return { grade: "A", color: "text-green-600" };
  if (score >= 70) return { grade: "B", color: "text-lime-600" };
  if (score >= 55) return { grade: "C", color: "text-yellow-600" };
  if (score >= 40) return { grade: "D", color: "text-orange-600" };
  return { grade: "F", color: "text-red-600" };
}

export default function PayerScorecard() {
  const { data, isLoading } = trpc.disputes.list.useQuery({ limit: 200, offset: 0 });
  const disputes = data?.items ?? [];

  const scorecards = useMemo(() => {
    const payerMap: Record<string, {
      total: number;
      closed: number;
      determination: number;
      payment_pending: number;
      appealed: number;
      ineligible: number;
      totalBilled: number;
      ages: number[];
    }> = {};

    disputes.forEach(d => {
      const payer = d.respondingPartyName ?? "Unknown";
      if (!payerMap[payer]) payerMap[payer] = { total: 0, closed: 0, determination: 0, payment_pending: 0, appealed: 0, ineligible: 0, totalBilled: 0, ages: [] };
      const p = payerMap[payer];
      p.total++;
      if (d.status === "closed") p.closed++;
      if (d.status === "determination_issued") p.determination++;
      if (d.status === "payment_pending") p.payment_pending++;
      if (d.status === "appealed") p.appealed++;
      if (d.status === "ineligible") p.ineligible++;
      p.totalBilled += Number(d.billedAmount) || 0;
      if (d.createdAt) p.ages.push(Math.floor((Date.now() - new Date(d.createdAt).getTime()) / 86400000));
    });

    return Object.entries(payerMap)
      .filter(([, p]) => p.total >= 1)
      .map(([payer, p]) => {
        const avgAge = p.ages.length > 0 ? p.ages.reduce((a, b) => a + b, 0) / p.ages.length : 0;
        const resolutionRate = p.total > 0 ? ((p.closed + p.determination) / p.total) * 100 : 0;
        const appealRate = p.total > 0 ? (p.appealed / p.total) * 100 : 0;
        const ineligibleRate = p.total > 0 ? (p.ineligible / p.total) * 100 : 0;

        // Score components (0-100 each)
        const resolutionScore = Math.min(resolutionRate * 1.2, 100);
        const speedScore = Math.max(0, 100 - (avgAge / 60) * 100);
        const appealScore = Math.max(0, 100 - appealRate * 5);
        const eligibilityScore = Math.max(0, 100 - ineligibleRate * 3);
        const volumeScore = Math.min(p.total * 5, 100);

        const overallScore = Math.round(
          resolutionScore * 0.30 + speedScore * 0.25 + appealScore * 0.20 + eligibilityScore * 0.15 + volumeScore * 0.10
        );

        const radarData = [
          { metric: "Resolution", value: Math.round(resolutionScore) },
          { metric: "Speed", value: Math.round(speedScore) },
          { metric: "Low Appeals", value: Math.round(appealScore) },
          { metric: "Eligibility", value: Math.round(eligibilityScore) },
          { metric: "Volume", value: Math.round(volumeScore) },
        ];

        return {
          payer, overallScore, resolutionScore, speedScore, appealScore, eligibilityScore, volumeScore,
          resolutionRate, avgAge, appealRate, ineligibleRate, totalDisputes: p.total, totalBilled: p.totalBilled,
          radarData, grade: scoreGrade(overallScore),
        };
      })
      .sort((a, b) => b.overallScore - a.overallScore);
  }, [disputes]);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(v);

  const topPayer = scorecards[0];
  const bottomPayer = scorecards[scorecards.length - 1];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Star className="h-6 w-6 text-yellow-500" />
          Payer Scorecard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Rate payers on resolution speed, appeal rates, and compliance behavior</p>
      </div>

      {/* Top/Bottom performers */}
      {scorecards.length >= 2 && (
        <div className="grid grid-cols-2 gap-4">
          <Card className="border-green-200">
            <CardContent className="p-4 flex items-center gap-3">
              <Award className="h-8 w-8 text-green-500 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Top Performer</p>
                <p className="font-semibold text-sm">{topPayer?.payer}</p>
                <p className={`text-2xl font-bold ${topPayer?.grade.color}`}>{topPayer?.grade.grade} ({topPayer?.overallScore})</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-red-200">
            <CardContent className="p-4 flex items-center gap-3">
              <TrendingDown className="h-8 w-8 text-red-400 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Needs Improvement</p>
                <p className="font-semibold text-sm">{bottomPayer?.payer}</p>
                <p className={`text-2xl font-bold ${bottomPayer?.grade.color}`}>{bottomPayer?.grade.grade} ({bottomPayer?.overallScore})</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Scorecard grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-3 text-center py-12 text-muted-foreground">Loading...</div>
        ) : scorecards.length === 0 ? (
          <div className="col-span-3 text-center py-12 text-muted-foreground">No payer data available</div>
        ) : (
          scorecards.map(sc => (
            <Card key={sc.payer}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm truncate">{sc.payer}</CardTitle>
                  <span className={`text-3xl font-bold ${sc.grade.color}`}>{sc.grade.grade}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${sc.overallScore}%`,
                        backgroundColor: sc.overallScore >= 70 ? "#22c55e" : sc.overallScore >= 50 ? "#f59e0b" : "#ef4444",
                      }}
                    />
                  </div>
                  <span className="text-sm font-semibold">{sc.overallScore}/100</span>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {/* Mini radar */}
                <div style={{ height: 140 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={sc.radarData} margin={{ top: 10, right: 20, left: 20, bottom: 10 }}>
                      <PolarGrid />
                      <PolarAngleAxis dataKey="metric" tick={{ fontSize: 9 }} />
                      <Radar dataKey="value" fill="#6366f1" fillOpacity={0.3} stroke="#6366f1" />
                      <Tooltip formatter={(v: number) => `${v}/100`} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                {/* Stats */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mt-2">
                  <div className="flex justify-between"><span className="text-muted-foreground">Disputes</span><span className="font-medium">{sc.totalDisputes}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Resolved</span><span className="font-medium">{sc.resolutionRate.toFixed(0)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Avg Age</span><span className="font-medium">{sc.avgAge.toFixed(0)}d</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Appeals</span><span className="font-medium">{sc.appealRate.toFixed(0)}%</span></div>
                  <div className="flex justify-between col-span-2"><span className="text-muted-foreground">Total Billed</span><span className="font-medium">{formatCurrency(sc.totalBilled)}</span></div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
