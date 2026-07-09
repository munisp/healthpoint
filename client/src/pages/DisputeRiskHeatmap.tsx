import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { ShieldAlert, ExternalLink, TrendingUp } from "lucide-react";

// Risk scoring model
function computeRisk(d: {
  status?: string | null;
  billedAmount?: string | number | null;
  createdAt?: Date | string | null;
  serviceType?: string | null;
}): { score: number; level: "low" | "medium" | "high" | "critical"; factors: string[] } {
  let score = 0;
  const factors: string[] = [];

  // Age risk
  const age = d.createdAt ? Math.floor((Date.now() - new Date(d.createdAt).getTime()) / 86400000) : 0;
  if (age > 60) { score += 30; factors.push("Overdue (60+ days)"); }
  else if (age > 30) { score += 15; factors.push("Aging (30+ days)"); }

  // Amount risk
  const amount = Number(d.billedAmount) || 0;
  if (amount > 50000) { score += 25; factors.push("High value claim"); }
  else if (amount > 20000) { score += 12; factors.push("Significant claim value"); }

  // Status risk
  const statusRisk: Record<string, number> = {
    offer_submission: 20,
    under_arbitration: 25,
    appealed: 30,
    eligibility_review: 15,
    idr_entity_selection: 10,
  };
  const statusScore = statusRisk[d.status ?? ""] ?? 0;
  if (statusScore > 0) { score += statusScore; factors.push(`Status: ${(d.status ?? "").replace(/_/g, " ")}`); }

  // Service type risk
  const serviceRisk: Record<string, number> = {
    air_ambulance: 20, neonatology: 15, anesthesiology: 10, emergency_medicine: 8,
  };
  const svcScore = serviceRisk[d.serviceType ?? ""] ?? 0;
  if (svcScore > 0) { score += svcScore; factors.push(`High-risk service: ${(d.serviceType ?? "").replace(/_/g, " ")}`); }

  const level = score >= 70 ? "critical" : score >= 45 ? "high" : score >= 20 ? "medium" : "low";
  return { score: Math.min(score, 100), level, factors };
}

const LEVEL_CONFIG = {
  critical: { color: "bg-red-600", textColor: "text-red-700", bg: "bg-red-50", border: "border-red-300", label: "Critical" },
  high: { color: "bg-orange-500", textColor: "text-orange-700", bg: "bg-orange-50", border: "border-orange-300", label: "High" },
  medium: { color: "bg-yellow-400", textColor: "text-yellow-700", bg: "bg-yellow-50", border: "border-yellow-300", label: "Medium" },
  low: { color: "bg-green-400", textColor: "text-green-700", bg: "bg-green-50", border: "border-green-300", label: "Low" },
};

export default function DisputeRiskHeatmap() {
  const [, navigate] = useLocation();
  const { data, isLoading } = trpc.disputes.list.useQuery({ limit: 100, offset: 0 });
  const disputes = data?.items ?? [];

  const withRisk = useMemo(() =>
    disputes
      .filter(d => d.status !== "closed" && d.status !== "ineligible")
      .map(d => ({ ...d, risk: computeRisk(d) }))
      .sort((a, b) => b.risk.score - a.risk.score),
    [disputes]
  );

  const byLevel = useMemo(() => ({
    critical: withRisk.filter(d => d.risk.level === "critical"),
    high: withRisk.filter(d => d.risk.level === "high"),
    medium: withRisk.filter(d => d.risk.level === "medium"),
    low: withRisk.filter(d => d.risk.level === "low"),
  }), [withRisk]);

  const formatCurrency = (v: number | string | null | undefined) => {
    if (!v) return "—";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v));
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-red-500" />
          Dispute Risk Heatmap
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Prioritize disputes by composite risk score based on age, value, status, and service type</p>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-4 gap-3">
        {(["critical", "high", "medium", "low"] as const).map(level => {
          const cfg = LEVEL_CONFIG[level];
          return (
            <Card key={level} className={`border ${cfg.border} ${cfg.bg}`}>
              <CardContent className="p-3 text-center">
                <div className={`text-3xl font-bold ${cfg.textColor}`}>{byLevel[level].length}</div>
                <div className="text-xs text-muted-foreground mt-1">{cfg.label} Risk</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Heatmap grid */}
      {(["critical", "high", "medium", "low"] as const).map(level => {
        const items = byLevel[level];
        if (items.length === 0) return null;
        const cfg = LEVEL_CONFIG[level];
        return (
          <div key={level}>
            <h2 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${cfg.textColor}`}>
              <div className={`w-3 h-3 rounded-full ${cfg.color}`} />
              {cfg.label} Risk — {items.length} dispute{items.length !== 1 ? "s" : ""}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map(d => (
                <Card
                  key={d.id}
                  className={`border ${cfg.border} cursor-pointer hover:shadow-md transition-shadow`}
                  onClick={() => navigate(`/disputes/${d.id}`)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-xs text-primary font-semibold">{d.referenceNumber}</span>
                          <Badge className={`text-xs ${cfg.bg} ${cfg.textColor} border ${cfg.border}`}>
                            {d.risk.score}/100
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{d.respondingPartyName}</p>
                        <p className="text-xs font-medium mt-1">{formatCurrency(d.billedAmount)}</p>
                        {/* Risk bar */}
                        <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${cfg.color}`}
                            style={{ width: `${d.risk.score}%` }}
                          />
                        </div>
                        {/* Risk factors */}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {d.risk.factors.slice(0, 2).map((f, i) => (
                            <span key={i} className="text-[10px] bg-muted rounded px-1.5 py-0.5 text-muted-foreground">{f}</span>
                          ))}
                          {d.risk.factors.length > 2 && (
                            <span className="text-[10px] text-muted-foreground">+{d.risk.factors.length - 2} more</span>
                          )}
                        </div>
                      </div>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}

      {isLoading && <div className="text-center py-12 text-muted-foreground">Loading disputes...</div>}
      {!isLoading && withRisk.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <TrendingUp className="h-12 w-12 mx-auto text-green-400 mb-3" />
            <h3 className="font-semibold">No active disputes to analyze</h3>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
