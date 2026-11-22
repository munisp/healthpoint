import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle, BookOpen, Calculator, Database, GitCompareArrows, ShieldAlert,
} from "lucide-react";

type Scenario = {
  label: string;
  serviceCode: string;
  market: string;
  region: string;
  asOfDate: string; // YYYY-MM-DD
  enabled: boolean;
};

const EMPTY_SCENARIO = (n: number): Scenario => ({
  label: `Scenario ${n}`,
  serviceCode: "",
  market: "",
  region: "",
  asOfDate: "",
  enabled: n === 1,
});

const scenarioValid = (s: Scenario) =>
  !!s.serviceCode.trim() && !!s.market && !!s.region.trim() && !!s.asOfDate;

const scenarioInput = (s: Scenario) => ({
  serviceCode: s.serviceCode.trim(),
  market: s.market as never,
  region: s.region.trim(),
  asOfDate: new Date(s.asOfDate + "T00:00:00Z").toISOString(),
});

function fmtCents(cents: number | null | undefined): string {
  if (cents == null) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function ResultBody({ result }: { result: any }) {
  if (!result.computable) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-1.5">
        <p className="text-sm font-medium text-destructive flex items-center gap-1.5">
          <ShieldAlert size={14} /> Insufficient data - QPA not computable (fail-closed)
        </p>
        <p className="text-xs text-muted-foreground">{result.reason ?? "No reason supplied."}</p>
        {result.fallback && (
          <Badge variant="outline" className="text-xs">Fallback marker: {String(result.fallback)}</Badge>
        )}
        <p className="text-xs text-muted-foreground">
          The engine never substitutes benchmarks or defaults; fewer than the statutory minimum of
          eligible contracted rates means the 149.140(c)(3) eligible-database path applies.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-2xl font-bold text-foreground">{fmtCents(result.qpaCents)}</span>
        <Badge variant="secondary">Computable</Badge>
        <Badge variant="outline">{result.ratesUsed} rates used</Badge>
        {result.cpiFactor != null && <Badge variant="outline">CPI factor {Number(result.cpiFactor).toFixed(4)}</Badge>}
        {result.serviceYear != null && <Badge variant="outline">Service year {result.serviceYear}</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">
        Median contracted rate: {fmtCents(result.medianContractedRateCents)} - {result.methodology}
      </p>
      {(result.citations ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {(result.citations as string[]).map((c, i) => (
            <Badge key={i} variant="outline" className="text-xs font-normal">{c}</Badge>
          ))}
        </div>
      )}
      {result.provenanceSummary && (
        <p className="text-xs text-muted-foreground">
          Provenance: {result.provenanceSummary.batchCount} batch(es)
          {result.provenanceSummary.sourceTypes?.length ? ` - sources: ${result.provenanceSummary.sourceTypes.join(", ")}` : ""}
        </p>
      )}
    </div>
  );
}

function ScenarioResultCard({ input, enabled }: { input: ReturnType<typeof scenarioInput> | null; enabled: boolean }) {
  const query = trpc.qpaEngine.compute.useQuery(input as any, { enabled: enabled && !!input, retry: false });
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Calculator size={14} className="text-primary" />
          {input ? `${input.serviceCode} - ${String(input.market)} - ${input.region}` : "Not configured"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!enabled || !input ? (
          <p className="text-sm text-muted-foreground">Enable and complete this scenario to compute a QPA.</p>
        ) : query.isLoading ? (
          <div className="space-y-2"><Skeleton className="h-6 w-40" /><Skeleton className="h-4 w-72" /></div>
        ) : query.isError ? (
          <p className="text-sm text-destructive">{query.error.message}</p>
        ) : query.data ? (
          <ResultBody result={query.data as any} />
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function QpaExplorer() {
  const [scenarios, setScenarios] = useState<Scenario[]>([EMPTY_SCENARIO(1), EMPTY_SCENARIO(2), EMPTY_SCENARIO(3)]);
  const [submitted, setSubmitted] = useState<(Scenario | null)[]>([null, null, null]);
  const [cpiYears, setCpiYears] = useState<{ a: string; b: string }>({ a: "", b: "" });

  const methodologyQuery = trpc.qpaEngine.methodology.useQuery(undefined, { retry: false });
  const ingestionQuery = trpc.qpaEngine.ingestionStatus.useQuery(undefined, { retry: false });
  const methodology = methodologyQuery.data as any;
  const markets: string[] = methodology?.markets ?? [];

  const setScenario = (i: number, patch: Partial<Scenario>) =>
    setScenarios(prev => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const activeInputs = useMemo(
    () => submitted.map(s => (s && s.enabled && scenarioValid(s) ? scenarioInput(s) : null)),
    [submitted]
  );

  // CPI-adjusted comparison across years for scenario 1 dimensions.
  const cpiBase = submitted[0] && scenarioValid(submitted[0]) ? submitted[0] : null;
  const cpiInputA = cpiBase && cpiYears.a
    ? scenarioInput({ ...cpiBase, asOfDate: `${cpiYears.a}-06-01` })
    : null;
  const cpiInputB = cpiBase && cpiYears.b
    ? scenarioInput({ ...cpiBase, asOfDate: `${cpiYears.b}-06-01` })
    : null;
  const cpiQueryA = trpc.qpaEngine.compute.useQuery(cpiInputA as any, { enabled: !!cpiInputA, retry: false });
  const cpiQueryB = trpc.qpaEngine.compute.useQuery(cpiInputB as any, { enabled: !!cpiInputB, retry: false });

  const compareRows = activeInputs.filter(Boolean).length >= 2;

  const yearOptions = useMemo(() => {
    const now = new Date().getUTCFullYear();
    return Array.from({ length: 8 }, (_, i) => String(now - i));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">QPA Explorer</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Statutory qualifying payment amount scenarios over the 45 CFR 149.140 median-of-contracted-rates engine.
          Fail-closed: insufficient rate data yields no number, never an estimate.
        </p>
      </div>

      {/* Methodology + ingestion status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen size={16} className="text-primary" /> Methodology
            </CardTitle>
          </CardHeader>
          <CardContent>
            {methodologyQuery.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-4 w-56" /><Skeleton className="h-4 w-80" /></div>
            ) : methodologyQuery.isError ? (
              <p className="text-sm text-destructive">{methodologyQuery.error.message}</p>
            ) : methodology ? (
              <div className="space-y-2 text-xs text-muted-foreground">
                <p className="text-sm text-foreground font-medium">{methodology.standard}</p>
                <p>{methodology.summary}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">Baseline {methodology.baselineDate}</Badge>
                  <Badge variant="outline">Min {methodology.minContractedRates} contracted rates</Badge>
                  <Badge variant={methodology.failClosed ? "secondary" : "destructive"}>
                    {methodology.failClosed ? "Fail-closed" : "Not fail-closed"}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(methodology.citations ?? []).map((c: string, i: number) => (
                    <Badge key={i} variant="outline" className="font-normal">{c}</Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Database size={16} className="text-primary" /> Ingestion Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ingestionQuery.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-5 w-56" /></div>
            ) : ingestionQuery.isError ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <ShieldAlert size={14} className="text-destructive" />
                Ingestion status is admin-only: {ingestionQuery.error.message}
              </p>
            ) : ingestionQuery.data ? (
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{(ingestionQuery.data as any).batches} batches</Badge>
                <Badge variant="secondary">{(ingestionQuery.data as any).rates} contracted rates</Badge>
                <Badge variant="secondary">{(ingestionQuery.data as any).cpiYears} CPI factor years</Badge>
                {(ingestionQuery.data as any).rates === 0 && (
                  <p className="text-xs text-muted-foreground w-full">
                    No contracted rates ingested yet - every computation will fail closed until data is loaded.
                  </p>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Scenario builder */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <GitCompareArrows size={16} className="text-primary" /> Scenario Comparison (2-3 scenarios)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {scenarios.map((s, i) => (
              <div key={i} className="rounded-md border border-border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">{s.label}</p>
                  {i > 0 && (
                    <Button size="sm" variant={s.enabled ? "secondary" : "outline"} className="text-xs"
                      onClick={() => setScenario(i, { enabled: !s.enabled })}>
                      {s.enabled ? "Enabled" : "Disabled"}
                    </Button>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Service code (CPT/HCPCS)</Label>
                  <Input value={s.serviceCode} disabled={!s.enabled} placeholder="e.g. 99285"
                    onChange={e => setScenario(i, { serviceCode: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Insurance market</Label>
                  {markets.length > 0 ? (
                    <Select value={s.market} disabled={!s.enabled} onValueChange={v => setScenario(i, { market: v })}>
                      <SelectTrigger><SelectValue placeholder="Select market" /></SelectTrigger>
                      <SelectContent>
                        {markets.map(m => <SelectItem key={m} value={m}>{m.replace(/_/g, " ")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={s.market} disabled={!s.enabled} placeholder="market (methodology feed unavailable)"
                      onChange={e => setScenario(i, { market: e.target.value })} />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Geographic region</Label>
                  <Input value={s.region} disabled={!s.enabled} placeholder="e.g. TX-DALLAS or MSA code"
                    onChange={e => setScenario(i, { region: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">As-of date (service date determines CPI year)</Label>
                  <Input type="date" value={s.asOfDate} disabled={!s.enabled}
                    onChange={e => setScenario(i, { asOfDate: e.target.value })} />
                </div>
              </div>
            ))}
          </div>
          <Button
            disabled={!scenarios.some((s, i) => (i === 0 || s.enabled) && scenarioValid(s))}
            onClick={() => setSubmitted(scenarios.map((s, i) => (i === 0 || s.enabled) && scenarioValid(s) ? { ...s, enabled: true } : null))}>
            <Calculator size={14} className="mr-1.5" /> Compute Scenarios
          </Button>
        </CardContent>
      </Card>

      {/* Scenario results */}
      {submitted.some(Boolean) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map(i => (
            <ScenarioResultCard key={i} input={activeInputs[i]} enabled={!!activeInputs[i]} />
          ))}
        </div>
      )}

      {/* Side-by-side comparison table */}
      {compareRows && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Side-by-Side Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dimension</TableHead>
                  {activeInputs.map((inp, i) => inp && (
                    <TableHead key={i}>{scenarios[i].label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(["serviceCode", "market", "region", "asOfDate"] as const).map(k => (
                  <TableRow key={k}>
                    <TableCell className="text-muted-foreground capitalize">{k.replace(/([A-Z])/g, " $1")}</TableCell>
                    {activeInputs.map((inp, i) => inp && (
                      <TableCell key={i}>
                        {k === "asOfDate" ? new Date(inp[k]).toLocaleDateString() : String(inp[k])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground mt-3">
              Results (QPA, CPI factor, rates used, fail-closed reason) are shown on the scenario cards above.
            </p>
          </CardContent>
        </Card>
      )}

      {/* CPI-adjusted comparison across years */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle size={16} className="text-primary" /> CPI-Adjusted Comparison Across Years
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!cpiBase ? (
            <p className="text-sm text-muted-foreground">
              Compute Scenario 1 first; the CPI comparison reuses its service code, market, and region across two service years.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Year A</Label>
                  <Select value={cpiYears.a} onValueChange={v => setCpiYears({ ...cpiYears, a: v })}>
                    <SelectTrigger className="w-32"><SelectValue placeholder="Year" /></SelectTrigger>
                    <SelectContent>{yearOptions.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Year B</Label>
                  <Select value={cpiYears.b} onValueChange={v => setCpiYears({ ...cpiYears, b: v })}>
                    <SelectTrigger className="w-32"><SelectValue placeholder="Year" /></SelectTrigger>
                    <SelectContent>{yearOptions.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground pb-1.5">
                  Uses June 1 of each selected year as the as-of date (drives the CPI-U indexing year).
                </p>
              </div>
              {cpiYears.a && cpiYears.b && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { label: `Year A (${cpiYears.a})`, q: cpiQueryA },
                    { label: `Year B (${cpiYears.b})`, q: cpiQueryB },
                  ].map(({ label, q }) => (
                    <div key={label} className="rounded-md border border-border p-3 space-y-2">
                      <p className="text-sm font-medium text-foreground">{label}</p>
                      {q.isLoading ? (
                        <div className="space-y-2"><Skeleton className="h-5 w-36" /><Skeleton className="h-4 w-56" /></div>
                      ) : q.isError ? (
                        <p className="text-sm text-destructive">{q.error.message}</p>
                      ) : q.data ? (
                        (q.data as any).computable ? (
                          <div className="space-y-1">
                            <p className="text-xl font-bold text-foreground">{fmtCents((q.data as any).qpaCents)}</p>
                            <p className="text-xs text-muted-foreground">
                              CPI factor {Number((q.data as any).cpiFactor).toFixed(4)} - {(q.data as any).ratesUsed} rates
                            </p>
                          </div>
                        ) : (
                          <p className="text-sm text-destructive flex items-center gap-1.5">
                            <ShieldAlert size={13} /> Fail-closed: {(q.data as any).reason}
                          </p>
                        )
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
              {cpiQueryA.data && cpiQueryB.data && (cpiQueryA.data as any).computable && (cpiQueryB.data as any).computable && (
                <p className="text-sm text-foreground">
                  Delta: {fmtCents((cpiQueryB.data as any).qpaCents - (cpiQueryA.data as any).qpaCents)}
                  {" "}({((((cpiQueryB.data as any).qpaCents / (cpiQueryA.data as any).qpaCents) - 1) * 100).toFixed(1)}% CPI-indexed change from {cpiYears.a} to {cpiYears.b})
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
