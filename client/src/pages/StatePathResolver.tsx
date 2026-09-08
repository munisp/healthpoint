import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, CheckCircle2, Landmark, MapPinned, Scale, ShieldAlert, Split,
} from "lucide-react";

const REGIME_META: Record<string, { label: string; variant: "secondary" | "outline" | "destructive" | "default"; icon: typeof Scale }> = {
  FEDERAL: { label: "FEDERAL (NSA / 45 CFR 149)", variant: "secondary", icon: Landmark },
  STATE: { label: "STATE program governs", variant: "default", icon: Scale },
  BIFURCATED_SPLIT: { label: "BIFURCATED SPLIT (state + federal)", variant: "outline", icon: Split },
};

type FormState = {
  planType: "FULLY_INSURED" | "SELF_FUNDED";
  stateCode: string;
  serviceCategory: string;
  dateOfService: string;
  optedIn: boolean;
};

export default function StatePathResolver() {
  const [form, setForm] = useState<FormState>({
    planType: "FULLY_INSURED",
    stateCode: "",
    serviceCategory: "EMERGENCY",
    dateOfService: "",
    optedIn: false,
  });
  const [submitted, setSubmitted] = useState<FormState | null>(null);
  const [selectedState, setSelectedState] = useState("");

  const metadataQuery = trpc.statePrograms.registryMetadata.useQuery(undefined, { retry: false });
  const statesQuery = trpc.statePrograms.listStates.useQuery(undefined, { retry: false });
  const programQuery = trpc.statePrograms.getStateProgram.useQuery(
    { stateCode: selectedState }, { enabled: /^[A-Z]{2}$/.test(selectedState), retry: false }
  );

  const resolveQuery = trpc.statePrograms.resolveJurisdiction.useQuery(
    submitted
      ? {
          planType: submitted.planType,
          stateCode: submitted.stateCode,
          serviceCategory: submitted.serviceCategory as never,
          dateOfService: submitted.dateOfService,
          optedIn: submitted.planType === "SELF_FUNDED" ? submitted.optedIn : undefined,
        }
      : { planType: "FULLY_INSURED", stateCode: "CA", serviceCategory: "EMERGENCY" as never, dateOfService: "2026-01-01" },
    { enabled: !!submitted, retry: false }
  );

  const result = resolveQuery.data as any;
  const metadata = metadataQuery.data as any;
  const states = (statesQuery.data ?? []) as string[];
  const program = programQuery.data as any;

  const submit = () => {
    if (!/^[A-Z]{2}$/.test(form.stateCode)) {
      toast.error("State code must be a 2-letter uppercase USPS code (e.g. TX).");
      return;
    }
    if (!form.dateOfService) {
      toast.error("Date of service is required.");
      return;
    }
    setSubmitted({ ...form });
  };

  const regime = result?.regime ? REGIME_META[result.regime as string] : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">State Path Resolver</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Resolve which IDR regime governs a dispute: federal NSA process, a specified state law, or the
          bifurcated split. Fail-closed: unknown or unverified scope resolves to FEDERAL with a warning.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Resolution form */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPinned size={16} className="text-primary" /> Jurisdiction Resolution
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Plan type</Label>
                <Select value={form.planType} onValueChange={v => setForm({ ...form, planType: v as FormState["planType"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FULLY_INSURED">Fully insured</SelectItem>
                    <SelectItem value="SELF_FUNDED">Self-funded (ERISA)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">State code</Label>
                <Input value={form.stateCode} maxLength={2} placeholder="e.g. TX"
                  onChange={e => setForm({ ...form, stateCode: e.target.value.toUpperCase() })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Service category</Label>
                <Select value={form.serviceCategory} onValueChange={v => setForm({ ...form, serviceCategory: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["EMERGENCY", "NON_EMERGENCY", "AIR_AMBULANCE", "POST_STABILIZATION"].map(c => (
                      <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Date of service</Label>
                <Input type="date" value={form.dateOfService}
                  onChange={e => setForm({ ...form, dateOfService: e.target.value })} />
              </div>
            </div>
            {form.planType === "SELF_FUNDED" && (
              <label className="flex items-center gap-2 text-xs text-foreground">
                <Checkbox checked={form.optedIn} onCheckedChange={v => setForm({ ...form, optedIn: !!v })} />
                Plan has opted into the state process (self-funded opt-in)
              </label>
            )}
            <Button size="sm" onClick={submit} disabled={resolveQuery.isFetching}>
              Resolve Jurisdiction
            </Button>
          </CardContent>
        </Card>

        {/* Result card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Resolution Result</CardTitle>
          </CardHeader>
          <CardContent>
            {!submitted ? (
              <p className="text-sm text-muted-foreground">Complete the form and resolve to see the governing regime.</p>
            ) : resolveQuery.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-80" /><Skeleton className="h-4 w-64" /></div>
            ) : resolveQuery.isError ? (
              <p className="text-sm text-destructive">{resolveQuery.error.message}</p>
            ) : result ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {regime && (
                    <Badge variant={regime.variant} className="flex items-center gap-1.5">
                      <regime.icon size={12} /> {regime.label}
                    </Badge>
                  )}
                  <Badge variant={result.verificationStatus === "VERIFIED" ? "secondary" : "destructive"}
                    className="flex items-center gap-1">
                    {result.verificationStatus === "VERIFIED"
                      ? <><CheckCircle2 size={11} /> verified</>
                      : <><AlertTriangle size={11} /> unverified</>}
                  </Badge>
                  {result.stateProgramId && <Badge variant="outline">State program: {result.stateProgramId}</Badge>}
                </div>
                <p className="text-sm text-foreground">{result.rationale}</p>
                {(result.warnings ?? []).length > 0 && (
                  <div className="rounded-md border border-border p-3 space-y-1.5">
                    <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                      <AlertTriangle size={12} className="text-destructive" /> Warnings
                    </p>
                    {(result.warnings as string[]).map((w, i) => (
                      <p key={i} className="text-xs text-muted-foreground flex gap-1.5">
                        <AlertTriangle size={11} className="text-destructive mt-0.5 shrink-0" /> {w}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Registry metadata */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Landmark size={16} className="text-primary" /> Registry Metadata
          </CardTitle>
        </CardHeader>
        <CardContent>
          {metadataQuery.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-5 w-56" /><Skeleton className="h-5 w-72" /></div>
          ) : metadataQuery.isError ? (
            <p className="text-sm text-destructive">{metadataQuery.error.message}</p>
          ) : metadata ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">{metadata.statesWithSomeProtections} states with some protections</Badge>
              <Badge variant="secondary">{metadata.bifurcatedOfThose} of those bifurcated (partial scope)</Badge>
              <Badge variant="outline">Source: {metadata.source}</Badge>
              <Badge variant="outline">As of {metadata.asOf}</Badge>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Registered states */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Registered State Programs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {statesQuery.isLoading ? (
            <div className="flex gap-1.5"><Skeleton className="h-7 w-12" /><Skeleton className="h-7 w-12" /><Skeleton className="h-7 w-12" /></div>
          ) : statesQuery.isError ? (
            <p className="text-sm text-destructive">{statesQuery.error.message}</p>
          ) : states.length === 0 ? (
            <div className="py-8 flex flex-col items-center text-muted-foreground">
              <ShieldAlert size={28} className="mb-2 opacity-30" />
              <p className="text-sm">
                No state programs registered yet. The registry ships zero hardcoded per-state entries;
                entries are added by admins with verified citations. Unregistered states resolve to FEDERAL.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {states.map(code => (
                <Button key={code} size="sm" variant={selectedState === code ? "default" : "outline"} className="text-xs"
                  onClick={() => setSelectedState(code)}>
                  {code}
                </Button>
              ))}
            </div>
          )}

          {selectedState && programQuery.isLoading && (
            <div className="space-y-2"><Skeleton className="h-5 w-48" /><Skeleton className="h-4 w-72" /></div>
          )}
          {selectedState && programQuery.isError && (
            <p className="text-sm text-destructive">{programQuery.error.message}</p>
          )}
          {selectedState && program && (
            <div className="rounded-md border border-border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-foreground">{program.programName} ({program.stateCode})</p>
                <Badge variant={program.verificationStatus === "VERIFIED" ? "secondary" : "destructive"}>
                  {program.verificationStatus}
                </Badge>
                <Badge variant="outline">Scope vs federal: {program.scopeVsFederal}</Badge>
                <Badge variant="outline">{String(program.paymentDeterminationMethod).replace(/_/g, " ")}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Fully-insured applies: {String(program.appliesToFullyInsured)} - self-funded opt-in: {String(program.selfFundedOptIn)}
                {program.arbitrationStyle ? ` - style: ${program.arbitrationStyle}` : ""}
              </p>
              {(program.keyDeadlines ?? []).length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">Key deadlines</p>
                  {(program.keyDeadlines as any[]).map((d, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      {d.name}: {d.businessDays != null ? `${d.businessDays} business days` : `${d.calendarDays} calendar days`} ({d.citation})
                    </p>
                  ))}
                </div>
              )}
              {program.authorityUrl && (
                <a className="text-xs text-primary underline" href={program.authorityUrl} target="_blank" rel="noreferrer">
                  Statutory authority
                </a>
              )}
              {program.notes && <p className="text-xs text-muted-foreground">{program.notes}</p>}
            </div>
          )}
          {selectedState && programQuery.data === null && (
            <p className="text-sm text-muted-foreground">No program registered for {selectedState}.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
