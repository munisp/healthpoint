import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Zap, Info, DollarSign, Bot, Loader2, Sparkles, CheckCircle2, AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// Base win rates by service type (CMS IDR data)
const BASE_WIN_RATES: Record<string, number> = {
  emergency_medicine: 0.72, anesthesiology: 0.68, radiology: 0.61, pathology: 0.58,
  neonatology: 0.75, air_ambulance: 0.82, ground_ambulance: 0.71, hospitalist: 0.64,
  intensivist: 0.69, other: 0.60,
};

// QPA position multipliers
const QPA_MULTIPLIERS: Record<string, number> = {
  well_above: 1.25, above: 1.10, at: 1.0, below: 0.85, well_below: 0.65,
};

// Documentation quality multipliers
const DOC_MULTIPLIERS: Record<string, number> = {
  excellent: 1.20, good: 1.05, adequate: 1.0, poor: 0.80, minimal: 0.60,
};

// Entity experience multipliers
const ENTITY_MULTIPLIERS: Record<string, number> = {
  experienced: 1.10, moderate: 1.0, new: 0.90,
};

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

export default function DisputeOutcomeSimulator() {
  const [serviceType, setServiceType] = useState("emergency_medicine");
  const [billedAmount, setBilledAmount] = useState("15000");
  const [payerOffer, setPayerOffer] = useState("8000");
  const [qpaPosition, setQpaPosition] = useState("above");
  const [docQuality, setDocQuality] = useState("good");
  const [entityExp, setEntityExp] = useState("moderate");
  const [priorOutcomes, setPriorOutcomes] = useState(50); // % of prior wins with same payer

  const simulation = useMemo(() => {
    const billed = parseFloat(billedAmount) || 0;
    const offer = parseFloat(payerOffer) || 0;
    if (!billed || !offer) return null;

    const baseRate = BASE_WIN_RATES[serviceType] ?? 0.65;
    const qpaMult = QPA_MULTIPLIERS[qpaPosition] ?? 1.0;
    const docMult = DOC_MULTIPLIERS[docQuality] ?? 1.0;
    const entityMult = ENTITY_MULTIPLIERS[entityExp] ?? 1.0;
    const priorMult = 0.7 + (priorOutcomes / 100) * 0.6; // 0.7 to 1.3 range

    const rawWinRate = baseRate * qpaMult * docMult * entityMult * priorMult;
    const winRate = clamp(rawWinRate, 0.05, 0.95);
    const loseRate = 1 - winRate;

    // Outcome scenarios
    const fullWin = billed;
    const partialWin = (billed + offer) / 2;
    const lose = offer;

    // Expected values weighted by scenario probability
    const fullWinProb = winRate * 0.6;
    const partialWinProb = winRate * 0.4;
    const loseProb = loseRate;

    const expectedValue = fullWinProb * fullWin + partialWinProb * partialWin + loseProb * lose;
    const gain = expectedValue - offer;

    const scenarios = [
      { name: "Full Award", probability: fullWinProb, amount: fullWin, color: "#22c55e" },
      { name: "Partial Award", probability: partialWinProb, amount: partialWin, color: "#84cc16" },
      { name: "Payer Wins", probability: loseProb, amount: lose, color: "#ef4444" },
    ];

    return { winRate, loseRate, expectedValue, gain, scenarios, fullWin, partialWin, lose, offer };
  }, [serviceType, billedAmount, payerOffer, qpaPosition, docQuality, entityExp, priorOutcomes]);

  const [disputeIdForHermes, setDisputeIdForHermes] = useState("");
  const [hermesResult, setHermesResult] = useState<{
    providerWinPct: number; payerWinPct: number; splitPct: number; withdrawnPct: number;
    basis: string; keyFactors: string[]; recommendedAction: string; latencyMs: number;
  } | null>(null);

  const hermesMutation = trpc.hermes.simulateOutcome.useMutation({
    onSuccess: (data) => {
      setHermesResult(data);
      toast.success("Hermes simulation complete", { description: `${(data.latencyMs / 1000).toFixed(1)}s` });
    },
    onError: (err) => toast.error("Hermes error", { description: err.message }),
  });

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);

  const formatPct = (v: number) => `${(v * 100).toFixed(1)}%`;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Zap className="h-6 w-6 text-yellow-500" />
          Dispute Outcome Simulator
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Model IDR outcome probabilities based on case characteristics</p>
      </div>

      <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
        <Info className="h-4 w-4 shrink-0" />
        <span>This simulator uses statistical models based on CMS IDR outcome data. Results are probabilistic estimates for planning purposes only, not legal predictions.</span>
      </div>

      {/* Hermes AI Simulation Card */}
      <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-blue-800">Hermes AI Simulation</p>
              <p className="text-xs text-blue-600 mt-0.5">Get an LLM-powered outcome prediction for a specific dispute using real case data</p>
              <div className="flex gap-2 mt-3">
                <Input
                  placeholder="Dispute ID (e.g. disp_abc123)"
                  value={disputeIdForHermes}
                  onChange={e => setDisputeIdForHermes(e.target.value)}
                  className="text-sm bg-white"
                />
                <Button
                  onClick={() => hermesMutation.mutate({ disputeId: disputeIdForHermes })}
                  disabled={!disputeIdForHermes.trim() || hermesMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700 flex-shrink-0"
                >
                  {hermesMutation.isPending
                    ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Running...</>
                    : <><Sparkles className="w-4 h-4 mr-1" />Analyze</>}
                </Button>
              </div>
              {hermesResult && (
                <div className="mt-3 space-y-2">
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: "Provider", pct: hermesResult.providerWinPct, color: "bg-emerald-500" },
                      { label: "Payer", pct: hermesResult.payerWinPct, color: "bg-red-500" },
                      { label: "Split", pct: hermesResult.splitPct, color: "bg-amber-500" },
                      { label: "Withdrawn", pct: hermesResult.withdrawnPct, color: "bg-slate-400" },
                    ].map(item => (
                      <div key={item.label} className="bg-white rounded-lg p-2 text-center border">
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                        <p className="text-lg font-bold">{item.pct}%</p>
                        <div className="h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                          <div className={`h-full ${item.color} rounded-full`} style={{ width: `${item.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="bg-white rounded-lg p-2 border text-xs">
                    <p className="font-medium text-muted-foreground mb-0.5">AI Basis</p>
                    <p>{hermesResult.basis}</p>
                  </div>
                  {hermesResult.keyFactors.length > 0 && (
                    <div className="bg-white rounded-lg p-2 border text-xs">
                      <p className="font-medium text-muted-foreground mb-1">Key Factors</p>
                      <ul className="space-y-0.5">
                        {hermesResult.keyFactors.map((f, i) => (
                          <li key={i} className="flex gap-1.5">
                            <AlertTriangle className="w-3 h-3 text-amber-500 mt-0.5 flex-shrink-0" />{f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="bg-blue-600 text-white rounded-lg p-2 text-xs">
                    <p className="font-medium flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Recommended Action</p>
                    <p className="mt-0.5 text-blue-100">{hermesResult.recommendedAction}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Parameters */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Case Parameters</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Billed Amount ($)</label>
                <Input type="number" value={billedAmount} onChange={e => setBilledAmount(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Payer Offer ($)</label>
                <Input type="number" value={payerOffer} onChange={e => setPayerOffer(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Service Type</label>
              <Select value={serviceType} onValueChange={setServiceType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(BASE_WIN_RATES).map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Billed Rate vs QPA</label>
              <Select value={qpaPosition} onValueChange={setQpaPosition}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="well_above">Well Above QPA (&gt;50% over)</SelectItem>
                  <SelectItem value="above">Above QPA (10-50% over)</SelectItem>
                  <SelectItem value="at">At QPA (±10%)</SelectItem>
                  <SelectItem value="below">Below QPA (10-30% under)</SelectItem>
                  <SelectItem value="well_below">Well Below QPA (&gt;30% under)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Documentation Quality</label>
              <Select value={docQuality} onValueChange={setDocQuality}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="excellent">Excellent — Complete, well-organized</SelectItem>
                  <SelectItem value="good">Good — Most documents present</SelectItem>
                  <SelectItem value="adequate">Adequate — Required docs only</SelectItem>
                  <SelectItem value="poor">Poor — Missing key documents</SelectItem>
                  <SelectItem value="minimal">Minimal — Significant gaps</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">IDR Entity Experience</label>
              <Select value={entityExp} onValueChange={setEntityExp}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="experienced">Experienced (100+ cases)</SelectItem>
                  <SelectItem value="moderate">Moderate (20-100 cases)</SelectItem>
                  <SelectItem value="new">New (&lt;20 cases)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Prior Win Rate with this Payer: <span className="text-primary font-semibold">{priorOutcomes}%</span>
              </label>
              <Slider
                value={[priorOutcomes]}
                onValueChange={([v]) => setPriorOutcomes(v)}
                min={0} max={100} step={5}
                className="mt-2"
              />
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <div className="space-y-4">
          {!simulation ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                Enter billed amount and payer offer to run simulation
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Win probability */}
              <Card className={simulation.winRate >= 0.6 ? "border-green-300" : simulation.winRate >= 0.4 ? "border-amber-300" : "border-red-300"}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium">Estimated Win Probability</span>
                    <Badge className={`text-sm px-3 py-1 ${simulation.winRate >= 0.6 ? "bg-green-100 text-green-700" : simulation.winRate >= 0.4 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                      {formatPct(simulation.winRate)}
                    </Badge>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${simulation.winRate >= 0.6 ? "bg-green-500" : simulation.winRate >= 0.4 ? "bg-amber-500" : "bg-red-500"}`}
                      style={{ width: `${simulation.winRate * 100}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>0%</span><span>50%</span><span>100%</span>
                  </div>
                </CardContent>
              </Card>

              {/* Pie chart */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Outcome Probability Distribution</CardTitle></CardHeader>
                <CardContent>
                  <div style={{ height: 180 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={simulation.scenarios} dataKey="probability" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, probability }) => `${name}: ${(probability * 100).toFixed(0)}%`} labelLine={false}>
                          {simulation.scenarios.map((s, i) => <Cell key={i} fill={s.color} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Financial summary */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4" />Financial Projections</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">If Full Award</span>
                    <span className="font-medium text-green-600">{formatCurrency(simulation.fullWin)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">If Partial Award</span>
                    <span className="font-medium text-lime-600">{formatCurrency(simulation.partialWin)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">If Payer Wins</span>
                    <span className="font-medium text-red-600">{formatCurrency(simulation.lose)}</span>
                  </div>
                  <div className="border-t pt-2 flex justify-between font-semibold">
                    <span>Expected Value</span>
                    <span className={simulation.gain > 0 ? "text-green-600" : "text-red-600"}>
                      {formatCurrency(simulation.expectedValue)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>vs. accepting payer offer</span>
                    <span className={simulation.gain > 0 ? "text-green-600" : "text-red-600"}>
                      {simulation.gain > 0 ? "+" : ""}{formatCurrency(simulation.gain)} expected gain
                    </span>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
