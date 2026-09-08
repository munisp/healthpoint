import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertTriangle, BookOpen, CheckCircle2, Layers, Play, XCircle } from "lucide-react";

interface LineItem {
  lineItemId: string;
  serviceCode: string;
  providerNpi?: string;
  providerTin?: string;
  payerId: string;
  qualifiedIdrItem: boolean;
  dateOfService?: string; // ISO string; server coerces to Date
}

const SAMPLE = `LI-1,99283,1234567893,,PAYER-A,1,2026-09-01
LI-2,99283,1234567893,,PAYER-A,1,2026-09-05
LI-3,99283,1234567893,,PAYER-A,1,2026-09-12`;

/** CSV: lineItemId,serviceCode,providerNpi,providerTin,payerId,qualified(1/0),dateOfService(YYYY-MM-DD) */
function parseCsv(text: string): { items: LineItem[]; errors: string[] } {
  const items: LineItem[] = [];
  const errors: string[] = [];
  text.split("\n").forEach((line, idx) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const parts = t.split(",").map(s => s.trim());
    if (parts.length < 6) {
      errors.push(`Line ${idx + 1}: expected at least 6 comma-separated fields.`);
      return;
    }
    const [lineItemId, serviceCode, providerNpi, providerTin, payerId, qualified, dateOfService] = parts;
    if (!lineItemId || !serviceCode || !payerId) {
      errors.push(`Line ${idx + 1}: lineItemId, serviceCode and payerId are required.`);
      return;
    }
    items.push({
      lineItemId,
      serviceCode,
      providerNpi: providerNpi || undefined,
      providerTin: providerTin || undefined,
      payerId,
      qualifiedIdrItem: ["1", "true", "yes", "y"].includes(qualified.toLowerCase()),
      dateOfService: dateOfService ? new Date(dateOfService + "T00:00:00Z").toISOString() : undefined,
    });
  });
  return { items, errors };
}

export default function BatchBuilder() {
  const [csv, setCsv] = useState(SAMPLE);
  const [onpDate, setOnpDate] = useState("");
  const [submitted, setSubmitted] = useState<{ items: LineItem[]; openNegotiationNoticeDate?: string } | null>(null);

  const evalQuery = trpc.batchedDisputes.evaluateEligibility.useQuery(
    submitted ?? { items: [] },
    { enabled: !!submitted, retry: false }
  );
  const result = evalQuery.data as any;
  // Cap preview mirrors the server rule: ONP on/after 2026-11-01 \u2192 50, else 25.
  const capPreview = !onpDate ? 25 : onpDate >= "2026-11-01" ? 50 : 25;

  const runEvaluation = () => {
    const { items, errors } = parseCsv(csv);
    errors.forEach(e => toast.error(e));
    if (items.length === 0) {
      toast.error("No valid line items to evaluate.");
      return;
    }
    setSubmitted({
      items,
      openNegotiationNoticeDate: onpDate ? new Date(onpDate + "T00:00:00Z").toISOString() : undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Batched Dispute Builder</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Evaluate 45 CFR 149.510(c)(4)(i)(A)\u2013(D) batching eligibility and the effective-dated line-item cap.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers size={16} className="text-primary" /> Line Items
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Line items CSV \u2014 lineItemId, serviceCode, providerNpi, providerTin, payerId, qualified (1/0), dateOfService</Label>
            <Textarea
              className="font-mono text-xs min-h-40"
              value={csv}
              onChange={e => setCsv(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              One item per line. Leave providerTin empty when using an NPI (or vice versa). Date format YYYY-MM-DD.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label>Open negotiation period (ONP) start date</Label>
              <Input type="date" value={onpDate} onChange={e => setOnpDate(e.target.value)} />
            </div>
            <Badge variant={capPreview === 50 ? "secondary" : "outline"}>
              Applicable cap: {capPreview} line items
            </Badge>
            <p className="text-xs text-muted-foreground max-w-md">
              25-item legacy cap; 50 items for ONPs beginning on/after 2026-11-01 (CMS-9897-F). Omitting the ONP date fails closed to 25.
            </p>
            <Button onClick={runEvaluation} disabled={evalQuery.isFetching}>
              <Play size={14} className="mr-1.5" /> Evaluate Eligibility
            </Button>
          </div>
        </CardContent>
      </Card>

      {submitted && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Eligibility Result</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {evalQuery.isFetching ? (
              <p className="text-sm text-muted-foreground">Evaluating\u2026</p>
            ) : evalQuery.isError ? (
              <p className="text-sm text-destructive">{evalQuery.error.message}</p>
            ) : result ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {result.eligible ? (
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <CheckCircle2 size={12} /> Eligible to batch
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="flex items-center gap-1">
                      <XCircle size={12} /> Not eligible
                    </Badge>
                  )}
                  <Badge variant="outline">{submitted.items.length} items</Badge>
                  <Badge variant="outline">Cap applied: {result.capApplied}</Badge>
                </div>

                {(result.failures ?? []).length > 0 && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 space-y-1.5">
                    <p className="text-xs font-semibold text-foreground">Failures</p>
                    {result.failures.map((f: string, i: number) => (
                      <p key={i} className="text-xs text-foreground flex gap-1.5">
                        <AlertTriangle size={12} className="text-destructive mt-0.5 shrink-0" /> {f}
                      </p>
                    ))}
                  </div>
                )}

                <div>
                  <p className="text-xs font-semibold text-foreground mb-1.5">Criteria evaluated</p>
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Criterion applied</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {(result.appliedCriteria ?? []).map((c: string, i: number) => (
                        <TableRow key={i}><TableCell className="text-xs">{c}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="rounded-md border border-border bg-accent/50 p-3">
                  <p className="text-xs font-semibold text-foreground flex items-center gap-1.5 mb-1.5">
                    <BookOpen size={12} /> Citations
                  </p>
                  {(result.citations ?? []).map((c: string, i: number) => (
                    <p key={i} className="text-xs text-muted-foreground break-all">{c}</p>
                  ))}
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
