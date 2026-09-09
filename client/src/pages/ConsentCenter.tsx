import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlarmClock, CalendarClock, CheckCircle2, FileSignature, HeartHandshake, XCircle,
} from "lucide-react";

type ServiceCategory = "EMERGENCY" | "ANCILLARY" | "DIAGNOSTIC" | "UNFORESEEN_URGENT" | "NON_EMERGENCY";

const NOTICE_ELEMENTS = [
  "OON_PROVIDER_STATEMENT", "GFE_GOOD_FAITH_ESTIMATE", "PRIOR_AUTHORIZATION_STATEMENT",
  "IN_NETWORK_OPTION_STATEMENT", "CONSENT_OPTIONAL_STATEMENT", "ITEMS_SERVICES_LIST",
  "COST_SHARING_DISCLAIMER", "PLAN_CONTACT_INFO",
];
const GFE_ELEMENTS = [
  "PATIENT_IDENTIFYING_INFO", "ITEMIZED_SERVICES_WITH_CODES", "EXPECTED_CHARGES",
  "PROVIDER_FACILITY_INFO", "COPROVIDER_DISCLAIMER", "PPDR_DISCLAIMER", "NOT_A_CONTRACT_DISCLAIMER",
];
const NC_STATES = ["NOTICE_REQUIRED", "NOTICE_DELIVERED", "CONSENT_SIGNED", "SERVICE_RENDERED", "CONSENT_REVOKED", "NOTICE_EXPIRED", "WAIVED_IMPOSSIBLE"] as const;
const PPDR_STATES = ["DRAFT", "INITIATED", "DOCS_PENDING", "UNDER_REVIEW", "DETERMINED", "CLOSED", "INELIGIBLE"] as const;

const RECENT_KEY = "healthpoint:nc-recent-cases";

function loadRecent(): { caseId: string; tenantId: string }[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function ElementPicker({ elements, selected, onChange }: {
  elements: string[]; selected: Set<string>; onChange: (s: Set<string>) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
      {elements.map(el => (
        <label key={el} className="flex items-center gap-2 text-xs text-foreground">
          <Checkbox
            checked={selected.has(el)}
            onCheckedChange={(v) => {
              const next = new Set(selected);
              if (v) next.add(el); else next.delete(el);
              onChange(next);
            }}
          />
          {el.replace(/_/g, " ")}
        </label>
      ))}
    </div>
  );
}

export default function ConsentCenter() {
  const [tenantId, setTenantId] = useState("default");

  // Notice & Consent state
  const [category, setCategory] = useState<ServiceCategory>("NON_EMERGENCY");
  const [specialty, setSpecialty] = useState("");
  const [noInNetwork, setNoInNetwork] = useState(false);
  const [inNetwork, setInNetwork] = useState(false);
  const [waiverSubmitted, setWaiverSubmitted] = useState<any | null>(null);

  const [timing, setTiming] = useState({ scheduledAt: "", serviceAt: "", noticeDeliveredAt: "", consentSignedAt: "" });
  const [timingSubmitted, setTimingSubmitted] = useState<any | null>(null);

  const [noticeElements, setNoticeElements] = useState<Set<string>>(new Set());
  const [noticeContentSubmitted, setNoticeContentSubmitted] = useState<string[] | null>(null);
  const [signedAt, setSignedAt] = useState("");
  const [retentionSubmitted, setRetentionSubmitted] = useState<string | null>(null);

  const [caseId, setCaseId] = useState("");
  const [recent, setRecent] = useState(loadRecent);

  // GFE / PPDR state
  const [ppdr, setPpdr] = useState({ gfeTotalUsd: "", billedTotalUsd: "", billedAt: "", insuranceBilled: false });
  const [ppdrSubmitted, setPpdrSubmitted] = useState<any | null>(null);
  const [ppdrDisputeId, setPpdrDisputeId] = useState("");
  const [adminFeeUsd, setAdminFeeUsd] = useState("");
  const [gfeClock, setGfeClock] = useState({ scheduledAt: "", serviceAt: "", deliveredAt: "", requestedWithoutScheduling: false });
  const [gfeDeadlineSubmitted, setGfeDeadlineSubmitted] = useState<any | null>(null);
  const [gfeElements, setGfeElements] = useState<Set<string>>(new Set());
  const [gfeContentSubmitted, setGfeContentSubmitted] = useState<string[] | null>(null);
  const [recurring, setRecurring] = useState({ firstServiceAt: "", lastServiceAt: "" });
  const [recurringSubmitted, setRecurringSubmitted] = useState<any | null>(null);

  // Notice & Consent queries
  const waiverQuery = trpc.noticeConsent.evaluateWaiverEligibility.useQuery(
    waiverSubmitted ?? { serviceCategory: category },
    { enabled: !!waiverSubmitted, retry: false }
  );
  const timingQuery = trpc.noticeConsent.validateTiming.useQuery(
    timingSubmitted ?? { scheduledAt: new Date().toISOString(), serviceAt: new Date().toISOString(), noticeDeliveredAt: new Date().toISOString() },
    { enabled: !!timingSubmitted, retry: false }
  );
  const noticeContentQuery = trpc.noticeConsent.validateContent.useQuery(
    { elementsProvided: noticeContentSubmitted ?? [] },
    { enabled: !!noticeContentSubmitted }
  );
  const retentionQuery = trpc.noticeConsent.retentionUntil.useQuery(
    { signedAt: retentionSubmitted! },
    { enabled: !!retentionSubmitted, retry: false }
  );
  const createCaseMutation = trpc.noticeConsent.createCase.useMutation({
    onSuccess: (_r, vars) => {
      toast.success("Notice-consent case created (NOTICE_REQUIRED)");
      const next = [{ caseId: vars.caseId, tenantId: vars.tenantId ?? tenantId }, ...recent.filter(r => r.caseId !== vars.caseId)].slice(0, 10);
      setRecent(next);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    },
    onError: (e) => toast.error(e.message),
  });
  const ncTransitionMutation = trpc.noticeConsent.transition.useMutation({
    onSuccess: () => toast.success("Case transition applied"),
    onError: (e) => toast.error(e.message),
  });

  // GFE / PPDR queries
  const ppdrEligibilityQuery = trpc.gfePpdr.evaluateEligibility.useQuery(
    ppdrSubmitted ?? { gfeTotalUsd: 0, billedTotalUsd: 0, billedAt: new Date().toISOString(), insuranceBilled: false },
    { enabled: !!ppdrSubmitted, retry: false }
  );
  const gfeDeadlineQuery = trpc.gfePpdr.computeDeadline.useQuery(
    gfeDeadlineSubmitted ?? { scheduledAt: new Date().toISOString(), serviceAt: new Date().toISOString() },
    { enabled: !!gfeDeadlineSubmitted, retry: false }
  );
  const gfeLateQuery = trpc.gfePpdr.isLate.useQuery(
    gfeDeadlineSubmitted && gfeClock.deliveredAt
      ? { ...gfeDeadlineSubmitted, deliveredAt: new Date(gfeClock.deliveredAt).toISOString() }
      : { scheduledAt: new Date().toISOString(), serviceAt: new Date().toISOString(), deliveredAt: new Date().toISOString() },
    { enabled: !!gfeDeadlineSubmitted && !!gfeClock.deliveredAt, retry: false }
  );
  const gfeContentQuery = trpc.gfePpdr.validateContent.useQuery(
    { elementsProvided: gfeContentSubmitted ?? [] },
    { enabled: !!gfeContentSubmitted }
  );
  const recurringQuery = trpc.gfePpdr.validateRecurringWindow.useQuery(
    recurringSubmitted ?? { firstServiceAt: new Date().toISOString(), lastServiceAt: new Date().toISOString() },
    { enabled: !!recurringSubmitted, retry: false }
  );
  const createPpdrMutation = trpc.gfePpdr.createDispute.useMutation({
    onSuccess: () => toast.success("PPDR dispute created (DRAFT)"),
    onError: (e) => toast.error(e.message),
  });
  const ppdrTransitionMutation = trpc.gfePpdr.transition.useMutation({
    onSuccess: () => toast.success("PPDR transition applied"),
    onError: (e) => toast.error(e.message),
  });

  const waiver = waiverQuery.data as any;
  const timingResult = timingQuery.data as any;
  const ppdrResult = ppdrEligibilityQuery.data as any;
  const gfeDeadline = gfeDeadlineQuery.data as any;
  const gfeLate = gfeLateQuery.data as any;
  const recurringResult = recurringQuery.data as any;

  const iso = (v: string) => new Date(v).toISOString();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Consent &amp; GFE Center</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Notice-and-consent waivers (45 CFR 149.410-450) and GFE / patient-provider dispute resolution (45 CFR 149.610/149.620).
        </p>
      </div>

      <div className="space-y-1.5 max-w-xs">
        <Label>Tenant ID</Label>
        <Input value={tenantId} onChange={e => setTenantId(e.target.value)} />
      </div>

      <Tabs defaultValue="notice">
        <TabsList>
          <TabsTrigger value="notice">Notice &amp; Consent</TabsTrigger>
          <TabsTrigger value="gfe">GFE / PPDR</TabsTrigger>
        </TabsList>

        {/* Notice & Consent */}
        <TabsContent value="notice" className="space-y-6 mt-4">
          {/* Waiver eligibility */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <HeartHandshake size={16} className="text-primary" /> Waiver Eligibility (149.410(c)(4) / 149.420(b))
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Service category</Label>
                  <Select value={category} onValueChange={v => setCategory(v as ServiceCategory)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["EMERGENCY", "ANCILLARY", "DIAGNOSTIC", "UNFORESEEN_URGENT", "NON_EMERGENCY"].map(c => (
                        <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Provider specialty (optional)</Label>
                  <Input value={specialty} onChange={e => setSpecialty(e.target.value)} placeholder="e.g. ANESTHESIOLOGY" />
                </div>
                <div className="space-y-2 pt-5">
                  <label className="flex items-center gap-2 text-xs text-foreground">
                    <Checkbox checked={noInNetwork} onCheckedChange={v => setNoInNetwork(!!v)} />
                    No in-network provider available at facility
                  </label>
                  <label className="flex items-center gap-2 text-xs text-foreground">
                    <Checkbox checked={inNetwork} onCheckedChange={v => setInNetwork(!!v)} />
                    Rendering provider is in-network
                  </label>
                </div>
              </div>
              <Button size="sm" onClick={() => setWaiverSubmitted({
                serviceCategory: category,
                providerSpecialty: specialty || undefined,
                noInNetworkProviderAvailable: noInNetwork,
                providerInNetwork: inNetwork,
              })}>
                Evaluate
              </Button>
              {waiverSubmitted && waiver && (
                <div className="rounded-md border border-border p-3 space-y-1.5">
                  <Badge variant={waiver.waivable ? "secondary" : "destructive"}>
                    {String(waiver.eligibility).replace(/_/g, " ")}
                  </Badge>
                  <p className="text-xs text-muted-foreground">{waiver.reason}</p>
                  {!waiver.waivable && (
                    <p className="text-xs text-foreground flex items-center gap-1.5">
                      <XCircle size={12} className="text-destructive" />
                      Warning: balance billing is prohibited for this service category; a waiver cannot be used.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Timing validator */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlarmClock size={16} className="text-primary" /> Timing Validator (72h / day-of / 3h)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {(["scheduledAt", "serviceAt", "noticeDeliveredAt", "consentSignedAt"] as const).map(f => (
                  <div key={f} className="space-y-1.5">
                    <Label className="text-xs">{f.replace(/([A-Z])/g, " $1")}{f === "consentSignedAt" ? " (optional)" : ""}</Label>
                    <Input type="datetime-local" value={timing[f]} onChange={e => setTiming({ ...timing, [f]: e.target.value })} />
                  </div>
                ))}
              </div>
              <Button size="sm" disabled={!timing.scheduledAt || !timing.serviceAt || !timing.noticeDeliveredAt}
                onClick={() => setTimingSubmitted({
                  scheduledAt: iso(timing.scheduledAt),
                  serviceAt: iso(timing.serviceAt),
                  noticeDeliveredAt: iso(timing.noticeDeliveredAt),
                  consentSignedAt: timing.consentSignedAt ? iso(timing.consentSignedAt) : undefined,
                })}>
                Validate Timing
              </Button>
              {timingSubmitted && timingQuery.isError && (
                <p className="text-sm text-destructive">{timingQuery.error.message}</p>
              )}
              {timingSubmitted && timingResult && (
                <div className="rounded-md border border-border p-3 space-y-1.5">
                  <Badge variant={timingResult.compliant ? "secondary" : "destructive"}>
                    {timingResult.compliant ? "Timing compliant" : "Timing violations"}
                  </Badge>
                  <p className="text-xs text-muted-foreground">
                    Notice {timingResult.noticeHoursBeforeService?.toFixed(1)}h before service
                    {timingResult.consentHoursBeforeService != null && ` - consent ${timingResult.consentHoursBeforeService.toFixed(1)}h before service`}
                  </p>
                  {(timingResult.violations ?? []).map((v: string, i: number) => (
                    <p key={i} className="text-xs text-foreground flex gap-1.5">
                      <XCircle size={12} className="text-destructive mt-0.5 shrink-0" /> {v}
                    </p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Content + retention + case */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileSignature size={16} className="text-primary" /> Notice Content, Retention &amp; Case
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Notice elements provided</Label>
                <ElementPicker elements={NOTICE_ELEMENTS} selected={noticeElements} onChange={setNoticeElements} />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" variant="outline" onClick={() => setNoticeContentSubmitted(Array.from(noticeElements))}>
                  Validate Content
                </Button>
                {noticeContentQuery.data && (
                  <Badge variant={noticeContentQuery.data.complete ? "secondary" : "destructive"}>
                    {noticeContentQuery.data.complete
                      ? "All required elements present"
                      : `Missing: ${noticeContentQuery.data.missing.join(", ")}`}
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Consent signed at (retention calculator, 7 years)</Label>
                  <Input type="datetime-local" value={signedAt} onChange={e => setSignedAt(e.target.value)} />
                </div>
                <Button size="sm" variant="outline" disabled={!signedAt} onClick={() => setRetentionSubmitted(iso(signedAt))}>
                  Compute Retention End
                </Button>
                {retentionQuery.data && (
                  <Badge variant="outline" className="flex items-center gap-1">
                    <CalendarClock size={12} /> Retain until {new Date((retentionQuery.data as any).retentionUntil).toLocaleDateString()}
                  </Badge>
                )}
              </div>
              <div className="border-t border-border pt-4 space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Case ID</Label>
                    <Input value={caseId} onChange={e => setCaseId(e.target.value)} placeholder="e.g. NC-2026-0001" />
                  </div>
                  <Button size="sm" disabled={!caseId || createCaseMutation.isPending}
                    onClick={() => {
                      if (!timing.scheduledAt || !timing.serviceAt || !timing.noticeDeliveredAt) {
                        toast.error("Fill the timing validator fields before creating a case.");
                        return;
                      }
                      createCaseMutation.mutate({
                        tenantId,
                        caseId,
                        waiverInput: {
                          serviceCategory: category,
                          providerSpecialty: specialty || undefined,
                          noInNetworkProviderAvailable: noInNetwork,
                          providerInNetwork: inNetwork,
                        },
                        timing: {
                          scheduledAt: iso(timing.scheduledAt),
                          serviceAt: iso(timing.serviceAt),
                          noticeDeliveredAt: iso(timing.noticeDeliveredAt),
                          consentSignedAt: timing.consentSignedAt ? iso(timing.consentSignedAt) : undefined,
                        },
                        noticeElements: Array.from(noticeElements),
                      });
                    }}>
                    Create Case
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {NC_STATES.map(s => (
                    <Button key={s} size="sm" variant="outline" className="text-xs"
                      disabled={!caseId || ncTransitionMutation.isPending}
                      onClick={() => ncTransitionMutation.mutate({ tenantId, caseId, to: s })}>
                      {`-> ${s.replace(/_/g, " ")}`}
                    </Button>
                  ))}
                </div>
                {recent.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Recent on this device:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {recent.map(r => (
                        <Button key={r.caseId} size="sm" variant="ghost" className="text-xs"
                          onClick={() => { setTenantId(r.tenantId); setCaseId(r.caseId); }}>
                          {r.caseId}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* GFE / PPDR */}
        <TabsContent value="gfe" className="space-y-6 mt-4">
          {/* PPDR eligibility */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <HeartHandshake size={16} className="text-primary" /> PPDR Eligibility ($400 / 120-day / uninsured - 149.620(b))
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs">GFE total ($)</Label>
                  <Input type="number" value={ppdr.gfeTotalUsd} onChange={e => setPpdr({ ...ppdr, gfeTotalUsd: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Billed total ($)</Label>
                  <Input type="number" value={ppdr.billedTotalUsd} onChange={e => setPpdr({ ...ppdr, billedTotalUsd: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Initial bill date</Label>
                  <Input type="date" value={ppdr.billedAt} onChange={e => setPpdr({ ...ppdr, billedAt: e.target.value })} />
                </div>
                <label className="flex items-center gap-2 text-xs text-foreground pb-2">
                  <Checkbox checked={ppdr.insuranceBilled} onCheckedChange={v => setPpdr({ ...ppdr, insuranceBilled: !!v })} />
                  Insurance/plan was billed (disqualifying)
                </label>
              </div>
              <Button size="sm"
                disabled={!ppdr.gfeTotalUsd || !ppdr.billedTotalUsd || !ppdr.billedAt}
                onClick={() => setPpdrSubmitted({
                  gfeTotalUsd: Number(ppdr.gfeTotalUsd),
                  billedTotalUsd: Number(ppdr.billedTotalUsd),
                  billedAt: new Date(ppdr.billedAt + "T00:00:00Z").toISOString(),
                  insuranceBilled: ppdr.insuranceBilled,
                })}>
                Evaluate Eligibility
              </Button>
              {ppdrSubmitted && ppdrResult && (
                <div className="rounded-md border border-border p-3 space-y-1.5">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={ppdrResult.eligible ? "secondary" : "destructive"}>
                      {ppdrResult.eligible ? "Eligible" : "Not eligible"}
                    </Badge>
                    <Badge variant="outline">Excess over GFE: ${Number(ppdrResult.excessUsd).toFixed(2)}</Badge>
                    <Badge variant="outline">{ppdrResult.daysSinceBill} days since bill</Badge>
                  </div>
                  {(ppdrResult.reasons ?? []).map((r: string, i: number) => (
                    <p key={i} className="text-xs text-muted-foreground flex gap-1.5">
                      <XCircle size={12} className="text-destructive mt-0.5 shrink-0" /> {r}
                    </p>
                  ))}
                </div>
              )}
              <div className="border-t border-border pt-4 space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">PPDR dispute ID</Label>
                    <Input value={ppdrDisputeId} onChange={e => setPpdrDisputeId(e.target.value)} placeholder="e.g. PPDR-2026-0001" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Admin fee ($, per current HHS guidance - required to initiate)</Label>
                    <Input type="number" value={adminFeeUsd} onChange={e => setAdminFeeUsd(e.target.value)} />
                  </div>
                  <Button size="sm" disabled={!ppdrDisputeId || !ppdr.billedAt || createPpdrMutation.isPending}
                    onClick={() => createPpdrMutation.mutate({
                      tenantId,
                      disputeId: ppdrDisputeId,
                      gfeTotalUsd: Number(ppdr.gfeTotalUsd),
                      billedTotalUsd: Number(ppdr.billedTotalUsd),
                      billedAt: new Date(ppdr.billedAt + "T00:00:00Z").toISOString(),
                      insuranceBilled: ppdr.insuranceBilled,
                    })}>
                    Create PPDR Dispute
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PPDR_STATES.map(s => (
                    <Button key={s} size="sm" variant="outline" className="text-xs"
                      disabled={!ppdrDisputeId || ppdrTransitionMutation.isPending}
                      onClick={() => ppdrTransitionMutation.mutate({
                        tenantId,
                        disputeId: ppdrDisputeId,
                        to: s,
                        adminFeeUsd: s === "INITIATED" && adminFeeUsd ? Number(adminFeeUsd) : undefined,
                      })}>
                      {`-> ${s.replace(/_/g, " ")}`}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* GFE deadline calculator */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarClock size={16} className="text-primary" /> GFE Deadline Calculator (149.610(a)(2))
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs">Scheduled at</Label>
                  <Input type="datetime-local" value={gfeClock.scheduledAt} onChange={e => setGfeClock({ ...gfeClock, scheduledAt: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Service at</Label>
                  <Input type="datetime-local" value={gfeClock.serviceAt} onChange={e => setGfeClock({ ...gfeClock, serviceAt: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Delivered at (optional - late check)</Label>
                  <Input type="datetime-local" value={gfeClock.deliveredAt} onChange={e => setGfeClock({ ...gfeClock, deliveredAt: e.target.value })} />
                </div>
                <label className="flex items-center gap-2 text-xs text-foreground pb-2">
                  <Checkbox checked={gfeClock.requestedWithoutScheduling} onCheckedChange={v => setGfeClock({ ...gfeClock, requestedWithoutScheduling: !!v })} />
                  GFE requested without scheduling
                </label>
              </div>
              <Button size="sm" disabled={!gfeClock.scheduledAt || !gfeClock.serviceAt}
                onClick={() => setGfeDeadlineSubmitted({
                  scheduledAt: iso(gfeClock.scheduledAt),
                  serviceAt: iso(gfeClock.serviceAt),
                  requestedWithoutScheduling: gfeClock.requestedWithoutScheduling,
                })}>
                Compute Deadline
              </Button>
              {gfeDeadlineSubmitted && gfeDeadlineQuery.isError && (
                <p className="text-sm text-destructive">{gfeDeadlineQuery.error.message}</p>
              )}
              {gfeDeadlineSubmitted && gfeDeadline && (
                <div className="rounded-md border border-border p-3 space-y-1.5">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">Horizon: {gfeDeadline.horizon}</Badge>
                    <Badge variant="secondary">
                      Due {new Date(gfeDeadline.deadline).toLocaleString()}
                    </Badge>
                    {gfeLate && (
                      <Badge variant={gfeLate.late ? "destructive" : "secondary"}>
                        {gfeLate.late ? "Delivered LATE" : "Delivered on time"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{gfeDeadline.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* GFE content + recurring window */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 size={16} className="text-primary" /> GFE Content &amp; Recurring Window
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>GFE content elements provided (149.610(b))</Label>
                <ElementPicker elements={GFE_ELEMENTS} selected={gfeElements} onChange={setGfeElements} />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" variant="outline" onClick={() => setGfeContentSubmitted(Array.from(gfeElements))}>
                  Validate Content
                </Button>
                {gfeContentQuery.data && (
                  <Badge variant={gfeContentQuery.data.complete ? "secondary" : "destructive"}>
                    {gfeContentQuery.data.complete
                      ? "All required elements present"
                      : `Missing: ${gfeContentQuery.data.missing.join(", ")}`}
                  </Badge>
                )}
              </div>
              <div className="border-t border-border pt-4 flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Recurring GFE: first service</Label>
                  <Input type="date" value={recurring.firstServiceAt} onChange={e => setRecurring({ ...recurring, firstServiceAt: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Last service (within 12 months)</Label>
                  <Input type="date" value={recurring.lastServiceAt} onChange={e => setRecurring({ ...recurring, lastServiceAt: e.target.value })} />
                </div>
                <Button size="sm" variant="outline" disabled={!recurring.firstServiceAt || !recurring.lastServiceAt}
                  onClick={() => setRecurringSubmitted({
                    firstServiceAt: new Date(recurring.firstServiceAt + "T00:00:00Z").toISOString(),
                    lastServiceAt: new Date(recurring.lastServiceAt + "T00:00:00Z").toISOString(),
                  })}>
                  Validate Window
                </Button>
                {recurringSubmitted && recurringQuery.isError && (
                  <p className="text-sm text-destructive">{recurringQuery.error.message}</p>
                )}
                {recurringSubmitted && recurringResult && (
                  <Badge variant={recurringResult.valid ? "secondary" : "destructive"}>
                    {recurringResult.months} months - {recurringResult.valid ? "within 12-month window" : "exceeds 12-month window"}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
