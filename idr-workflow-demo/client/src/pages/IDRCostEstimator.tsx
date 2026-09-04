import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Calculator, TrendingUp, TrendingDown, Info, DollarSign } from "lucide-react";

// NSA IDR fee schedule (CMS published rates as of 2024)
const IDR_ADMIN_FEES = {
  single_claim: { batched: false, fee: 350, label: "Single Claim" },
  batched_same_payer: { batched: true, fee: 350, label: "Batched (Same Payer, Same Code)" },
};

// Estimated attorney/consultant fees per hour
const COMPLEXITY_COSTS = {
  simple: { hours: 2, rate: 350, label: "Simple (clear QPA, standard service)" },
  moderate: { hours: 5, rate: 350, label: "Moderate (QPA dispute, documentation needed)" },
  complex: { hours: 12, rate: 350, label: "Complex (novel issue, expert testimony)" },
  highly_complex: { hours: 25, rate: 350, label: "Highly Complex (multi-service, appeals)" },
};

// Historical win rates by service type (based on CMS IDR data)
const WIN_RATES: Record<string, number> = {
  emergency_medicine: 0.72,
  anesthesiology: 0.68,
  radiology: 0.61,
  pathology: 0.58,
  neonatology: 0.75,
  air_ambulance: 0.82,
  ground_ambulance: 0.71,
  hospitalist: 0.64,
  intensivist: 0.69,
  other: 0.60,
};

const SERVICE_LABELS: Record<string, string> = {
  emergency_medicine: "Emergency Medicine",
  anesthesiology: "Anesthesiology",
  radiology: "Radiology",
  pathology: "Pathology",
  neonatology: "Neonatology",
  air_ambulance: "Air Ambulance",
  ground_ambulance: "Ground Ambulance",
  hospitalist: "Hospitalist",
  intensivist: "Intensivist",
  other: "Other",
};

export default function IDRCostEstimator() {
  const [billedAmount, setBilledAmount] = useState("");
  const [payerOffer, setPayerOffer] = useState("");
  const [serviceType, setServiceType] = useState("emergency_medicine");
  const [complexity, setComplexity] = useState("moderate");
  const [isBatched, setIsBatched] = useState(false);
  const [claimCount, setClaimCount] = useState("1");

  const calc = useMemo(() => {
    const billed = parseFloat(billedAmount) || 0;
    const offer = parseFloat(payerOffer) || 0;
    const count = parseInt(claimCount) || 1;
    if (!billed || !offer) return null;

    const adminFee = isBatched ? IDR_ADMIN_FEES.batched_same_payer.fee : IDR_ADMIN_FEES.single_claim.fee * count;
    const complexityData = COMPLEXITY_COSTS[complexity as keyof typeof COMPLEXITY_COSTS];
    const legalCost = complexityData.hours * complexityData.rate * (isBatched ? 1 : Math.min(count, 3));
    const totalCost = adminFee + legalCost;

    const winRate = WIN_RATES[serviceType] ?? 0.65;
    const potentialGain = (billed - offer) * count;
    const expectedValue = potentialGain * winRate - totalCost;
    const breakEvenGain = totalCost / winRate;
    const roi = totalCost > 0 ? ((expectedValue / totalCost) * 100) : 0;

    return { adminFee, legalCost, totalCost, winRate, potentialGain, expectedValue, breakEvenGain, roi, count };
  }, [billedAmount, payerOffer, serviceType, complexity, isBatched, claimCount]);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Calculator className="h-6 w-6 text-blue-600" />
          IDR Cost Estimator
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Estimate the cost-benefit of pursuing IDR arbitration before filing</p>
      </div>

      <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
        <Info className="h-4 w-4 shrink-0" />
        <span>Estimates use CMS published IDR administrative fees and industry-average attorney rates. Actual costs vary. Historical win rates are based on CMS IDR data reports.</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Inputs */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Dispute Parameters</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Billed Amount ($)</label>
                <Input type="number" placeholder="e.g. 15000" value={billedAmount} onChange={e => setBilledAmount(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Payer Offer ($)</label>
                <Input type="number" placeholder="e.g. 8000" value={payerOffer} onChange={e => setPayerOffer(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Service Type</label>
              <Select value={serviceType} onValueChange={setServiceType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SERVICE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Case Complexity</label>
              <Select value={complexity} onValueChange={setComplexity}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(COMPLEXITY_COSTS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Number of Claims</label>
                <Input type="number" min="1" max="100" value={claimCount} onChange={e => setClaimCount(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Filing Type</label>
                <Select value={isBatched ? "batched" : "single"} onValueChange={v => setIsBatched(v === "batched")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Individual Claims</SelectItem>
                    <SelectItem value="batched">Batched Filing</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <Card className={calc ? (calc.expectedValue > 0 ? "border-green-300" : "border-red-300") : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              {calc ? (calc.expectedValue > 0 ? <TrendingUp className="h-4 w-4 text-green-500" /> : <TrendingDown className="h-4 w-4 text-red-500" />) : <DollarSign className="h-4 w-4" />}
              Cost-Benefit Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!calc ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                Enter billed amount and payer offer to see the analysis
              </div>
            ) : (
              <div className="space-y-4">
                {/* Recommendation */}
                <div className={`p-3 rounded-lg text-sm font-medium ${calc.expectedValue > 0 ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                  {calc.expectedValue > 0
                    ? `✓ IDR is likely worthwhile — expected net gain of ${formatCurrency(calc.expectedValue)}`
                    : `✗ IDR may not be cost-effective — expected net loss of ${formatCurrency(Math.abs(calc.expectedValue))}`
                  }
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">IDR Admin Fee</span>
                    <span className="font-medium">{formatCurrency(calc.adminFee)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Est. Legal/Prep Cost</span>
                    <span className="font-medium">{formatCurrency(calc.legalCost)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-semibold">
                    <span>Total Estimated Cost</span>
                    <span className="text-red-600">{formatCurrency(calc.totalCost)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Potential Gain (if won)</span>
                    <span className="font-medium text-green-600">{formatCurrency(calc.potentialGain)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Historical Win Rate ({SERVICE_LABELS[serviceType]})</span>
                    <Badge className={`text-xs ${calc.winRate >= 0.7 ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                      {(calc.winRate * 100).toFixed(0)}%
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expected Value</span>
                    <span className={`font-bold ${calc.expectedValue > 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatCurrency(calc.expectedValue)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Break-even Gain Needed</span>
                    <span className="font-medium">{formatCurrency(calc.breakEvenGain)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expected ROI</span>
                    <span className={`font-bold ${calc.roi > 0 ? "text-green-600" : "text-red-600"}`}>
                      {calc.roi > 0 ? "+" : ""}{calc.roi.toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
