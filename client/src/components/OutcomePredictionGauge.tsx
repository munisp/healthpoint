import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, RefreshCw, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Props {
  disputeId: string;
  billedAmount?: string | null;
  qpaAmount?: string | null;
  serviceType?: string | null;
  patientState?: string | null;
  currentStep?: string | null;
  cptCodes?: string[] | null;
  payerName?: string | null;
}

function GaugeArc({ value, color }: { value: number; color: string }) {
  // value: 0-100
  const radius = 60;
  const cx = 80;
  const cy = 80;
  const startAngle = 180;
  const endAngle = 180 + (value / 100) * 180;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const x1 = cx + radius * Math.cos(toRad(startAngle));
  const y1 = cy + radius * Math.sin(toRad(startAngle));
  const x2 = cx + radius * Math.cos(toRad(endAngle));
  const y2 = cy + radius * Math.sin(toRad(endAngle));
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return (
    <svg viewBox="0 0 160 90" className="w-full max-w-[200px]">
      {/* Background arc */}
      <path
        d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="12"
        className="text-muted/30"
        strokeLinecap="round"
      />
      {/* Value arc */}
      {value > 0 && (
        <path
          d={`M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
        />
      )}
      {/* Center text */}
      <text x={cx} y={cy - 4} textAnchor="middle" className="text-2xl font-bold" fontSize="22" fill="currentColor" fontWeight="bold">
        {value}%
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.6">
        win probability
      </text>
    </svg>
  );
}

export default function OutcomePredictionGauge({ disputeId, billedAmount, qpaAmount, serviceType, patientState, currentStep, cptCodes, payerName }: Props) {
  const [generated, setGenerated] = useState(false);

  const { data: prediction, isLoading, refetch } = trpc.predictions.get.useQuery(
    { disputeId },
    { enabled: !!disputeId }
  );

  const generateMutation = trpc.predictions.generate.useMutation({
    onSuccess: () => { refetch(); setGenerated(true); },
  });

  const prob = prediction?.winProbability ?? null;
  const confidence = prediction?.confidenceScore ?? null;

  const color = prob === null ? "#94a3b8"
    : prob >= 70 ? "#22c55e"
    : prob >= 50 ? "#f59e0b"
    : "#ef4444";

  const label = prob === null ? "Not yet predicted"
    : prob >= 70 ? "Favorable"
    : prob >= 50 ? "Moderate"
    : "Unfavorable";

  const Icon = prob === null ? Sparkles
    : prob >= 70 ? CheckCircle2
    : prob >= 50 ? TrendingUp
    : AlertTriangle;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-500" />
          Outcome Prediction
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : prob !== null ? (
          <>
            <div className="flex justify-center">
              <GaugeArc value={Math.round(prob)} color={color} />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Icon className="h-4 w-4" style={{ color }} />
                <span className="text-sm font-medium" style={{ color }}>{label}</span>
              </div>
              {confidence !== null && (
                <Badge variant="outline" className="text-xs">
                  {Math.round(confidence * 100)}% confidence
                </Badge>
              )}
            </div>
            {prediction?.keyFactors && (
              <p className="text-xs text-muted-foreground leading-relaxed border-t pt-2">
                {prediction.keyFactors}
              </p>
            )}
            {prediction?.recommendation && (
              <div className="bg-blue-50 rounded p-2 text-xs">
                <span className="font-medium text-blue-700">Recommendation: </span>
                <span className="text-blue-800">{prediction.recommendation}</span>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
    onClick={() => generateMutation.mutate({
              disputeId,
              billedAmount: parseFloat(billedAmount ?? "0") || 0,
              qpaAmount: parseFloat(qpaAmount ?? "0") || 0,
              serviceType: serviceType ?? "unknown",
              patientState: patientState ?? "XX",
              currentStep: currentStep ?? "open_negotiation",
              cptCodes: cptCodes ?? undefined,
              payerName: payerName ?? undefined,
            })}
            disabled={generateMutation.isPending}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${generateMutation.isPending ? "animate-spin" : ""}`} />
              Refresh Prediction
            </Button>
          </>
        ) : (
          <div className="text-center space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              AI-powered win probability analysis using QPA ratio, service type, and historical outcomes.
            </p>
            <Button
              size="sm"
              className="w-full"
              onClick={() => generateMutation.mutate({
                disputeId,
                billedAmount: parseFloat(billedAmount ?? "0") || 0,
                qpaAmount: parseFloat(qpaAmount ?? "0") || 0,
                serviceType: serviceType ?? "unknown",
                patientState: patientState ?? "XX",
                currentStep: currentStep ?? "open_negotiation",
                cptCodes: cptCodes ?? undefined,
                payerName: payerName ?? undefined,
              })}
              disabled={generateMutation.isPending}
            >
              <Sparkles className={`h-3.5 w-3.5 mr-1.5 ${generateMutation.isPending ? "animate-spin" : ""}`} />
              {generateMutation.isPending ? "Analyzing..." : "Generate Prediction"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
