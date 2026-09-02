import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Clock, AlertTriangle, CheckCircle2, Copy, Info } from "lucide-react";
import { toast } from "sonner";

// NSA/IDR timeline rules (business days)
const TIMELINE_RULES = {
  standard: [
    { id: "eob_received", label: "EOB / Claim Denial Received", offset: 0, type: "start", description: "The date the provider receives the Explanation of Benefits or claim denial." },
    { id: "open_neg_start", label: "Open Negotiation Period Begins", offset: 0, type: "milestone", description: "Provider may initiate open negotiation immediately upon receiving EOB." },
    { id: "open_neg_end", label: "Open Negotiation Deadline", offset: 30, type: "deadline", description: "Open negotiation must be initiated within 30 business days of receiving EOB." },
    { id: "idr_initiation", label: "IDR Initiation Deadline", offset: 34, type: "deadline", description: "IDR must be initiated within 4 business days after open negotiation period ends." },
    { id: "entity_selection", label: "IDR Entity Selection Deadline", offset: 38, type: "deadline", description: "Parties must jointly select an IDR entity within 3 business days of IDR initiation." },
    { id: "offer_submission", label: "Offer Submission Deadline", offset: 48, type: "deadline", description: "Both parties must submit their payment offers within 10 business days of entity selection." },
    { id: "determination", label: "IDR Entity Determination Deadline", offset: 78, type: "deadline", description: "IDR entity must issue determination within 30 business days of receiving offers." },
    { id: "payment_due", label: "Payment Due Date", offset: 88, type: "deadline", description: "Payment must be made within 30 calendar days of determination." },
  ],
  air_ambulance: [
    { id: "eob_received", label: "EOB / Claim Denial Received", offset: 0, type: "start", description: "The date the air ambulance provider receives the EOB." },
    { id: "open_neg_start", label: "Open Negotiation Period Begins", offset: 0, type: "milestone", description: "Provider may initiate open negotiation immediately." },
    { id: "open_neg_end", label: "Open Negotiation Deadline", offset: 30, type: "deadline", description: "Open negotiation must be initiated within 30 business days." },
    { id: "idr_initiation", label: "IDR Initiation Deadline", offset: 34, type: "deadline", description: "IDR must be initiated within 4 business days after open negotiation ends." },
    { id: "entity_selection", label: "IDR Entity Selection Deadline", offset: 37, type: "deadline", description: "Parties have 3 business days to select a certified air ambulance IDR entity." },
    { id: "offer_submission", label: "Offer Submission Deadline", offset: 47, type: "deadline", description: "Both parties submit offers within 10 business days of entity selection." },
    { id: "determination", label: "IDR Entity Determination Deadline", offset: 77, type: "deadline", description: "IDR entity issues determination within 30 business days." },
    { id: "payment_due", label: "Payment Due Date", offset: 107, type: "deadline", description: "Payment due within 30 calendar days of determination." },
  ],
};

function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

function getDaysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

export default function SmartDeadlineCalculator() {
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [disputeType, setDisputeType] = useState("standard");
  const [referenceNumber, setReferenceNumber] = useState("");

  const rules = TIMELINE_RULES[disputeType as keyof typeof TIMELINE_RULES] ?? TIMELINE_RULES.standard;

  const deadlines = useMemo(() => {
    const base = new Date(startDate + "T00:00:00");
    return rules.map(rule => {
      const date = rule.offset === 0 ? base : addBusinessDays(base, rule.offset);
      const daysUntil = getDaysUntil(date);
      return { ...rule, date, daysUntil };
    });
  }, [startDate, rules]);

  const copyToClipboard = () => {
    const text = deadlines.map(d => `${d.label}: ${formatDate(d.date)}`).join("\n");
    navigator.clipboard.writeText(text);
    toast.success("Deadlines copied to clipboard");
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Calendar className="h-6 w-6 text-blue-600" />
          Smart Deadline Calculator
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Compute all NSA/IDR statutory deadlines from the EOB receipt date</p>
      </div>

      <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
        <Info className="h-4 w-4 shrink-0" />
        <span>Deadlines are calculated in business days (Monday–Friday, excluding federal holidays) per NSA regulations. Always verify with legal counsel for compliance purposes.</span>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">EOB Receipt Date *</label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Dispute Type</label>
              <Select value={disputeType} onValueChange={setDisputeType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard IDR</SelectItem>
                  <SelectItem value="air_ambulance">Air Ambulance IDR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Reference Number (optional)</label>
              <Input placeholder="e.g. IDR-2024-001" value={referenceNumber} onChange={e => setReferenceNumber(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">
          Deadline Timeline{referenceNumber ? ` — ${referenceNumber}` : ""}
        </h2>
        <Button variant="outline" size="sm" onClick={copyToClipboard}>
          <Copy className="h-3.5 w-3.5 mr-1" />Copy All
        </Button>
      </div>

      <div className="space-y-3">
        {deadlines.map((d, i) => {
          const isOverdue = d.daysUntil < 0;
          const isUrgent = d.daysUntil >= 0 && d.daysUntil <= 5;
          const isPast = d.type === "start" || d.daysUntil < 0;

          return (
            <div
              key={d.id}
              className={`flex items-start gap-4 p-4 rounded-lg border ${isOverdue && d.type !== "start" ? "border-red-200 bg-red-50" : isUrgent ? "border-amber-200 bg-amber-50" : "border-border bg-card"}`}
            >
              {/* Timeline connector */}
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${d.type === "start" ? "bg-blue-600 text-white" : isOverdue ? "bg-red-100 text-red-600 border-2 border-red-300" : isUrgent ? "bg-amber-100 text-amber-600 border-2 border-amber-300" : "bg-muted text-muted-foreground border-2 border-border"}`}>
                  {i + 1}
                </div>
                {i < deadlines.length - 1 && <div className="w-0.5 h-4 bg-border mt-1" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-sm">{d.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{d.description}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold text-sm">{formatDate(d.date)}</p>
                    {d.type !== "start" && (
                      <div className="mt-1">
                        {isOverdue ? (
                          <Badge className="bg-red-100 text-red-700 text-xs">
                            <AlertTriangle className="h-3 w-3 mr-1" />{Math.abs(d.daysUntil)}d overdue
                          </Badge>
                        ) : isUrgent ? (
                          <Badge className="bg-amber-100 text-amber-700 text-xs">
                            <Clock className="h-3 w-3 mr-1" />{d.daysUntil}d left
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            {d.daysUntil}d away
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {d.offset > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">+{d.offset} business days from EOB date</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
