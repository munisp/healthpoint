import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, ShieldAlert, Calendar, FileText, Info } from "lucide-react";
import { toast } from "sonner";

/**
 * Consent Center — waiver eligibility + timing validation + GFE deadline
 * calculator against the verified notice-consent and GFE-PPDR modules.
 * All business logic is server-side; this page is forms + results only.
 * Phase 13 FB (O1.31): wired gfePpdr.computeTotalExpectedCharges into the
 * GFE tab (Total Expected Charges card).
 */

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function ResultRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-green-600" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />}
      <span>{label}</span>
    </li>
  );
}

export default function ConsentCenter() {
  const [tab, setTab] = useState<"waiver" | "timing" | "gfe" | "ppdr">("waiver");

  // Waiver eligibility form
  const [waiver, setWaiver] = useState({
    serviceCategory: "NON_EMERGENCY",
    providerSpecialty: "",
    noInNetworkProviderAvailable: false,
    providerInNetwork: false,
    emergencyAirAmbulance: false,
    postStabilization: { patientStable: false, canTravelToParticipatingFacility: false, receivingFacilityReachable: false, informedConsentObtained: false },
  });
  const [waiverSubmitted, setWaiverSubmitted] = useState<any | null>(null);

  // Timing form
  const [timing, setTiming] = useState({ scheduledAt: "", serviceAt: "", noticeDeliveredAt: "", consentSignedAt: "" });
  const [timingSubmitted, setTimingSubmitted] = useState<any | null>(null);

  // GFE deadline form
  const [gfe, setGfe] = useState({ scheduledAt: "", serviceAt: "", requestedWithoutScheduling: false });
  const [gfeSubmitted, setGfeSubmitted] = useState<any | null>(null);

  // GFE content validation
  const [elements, setElements] = useState("");
  const [elementsSubmitted, setElementsSubmitted] = useState<string[] | null>(null);

  // PPDR eligibility
  const [ppdr, setPpdr] = useState({ gfeTotalUsd: "", billedTotalUsd: "", billedAt: "", insuranceBilled: false });
  const [ppdrSubmitted, setPpdrSubmitted] = useState<any | null>(null);

  // Recurring GFE window
  const [recurring, setRecurring] = useState({ firstServiceAt: "", lastServiceAt: "" });
  const [recurringSubmitted, setRecurringSubmitted] = useState<any | null>(null);
  const [gfeTotal, setGfeTotal] = useState({ convening: "", coProviders: "" });
  const [gfeTotalSubmitted, setGfeTotalSubmitted] = useState<any | null>(null);

  const waiverQuery = trpc.noticeConsent.evaluateWaiverEligibility.useQuery(
    waiverSubmitted ?? { serviceCategory: "NON_EMERGENCY" },
    { enabled: !!waiverSubmitted, retry: false }
  );
  const timingQuery = trpc.noticeConsent.validateTiming.useQuery(
    timingSubmitted ?? { scheduledAt: new Date().toISOString(), serviceAt: new Date().toISOString(), noticeDeliveredAt: new Date().toISOString() },
    { enabled: !!timingSubmitted, retry: false }
  );
  const gfeDeadlineQuery = trpc.gfePpdr.computeDeadline.useQuery(
    gfeSubmitted ?? { scheduledAt: new Date().toISOString(), serviceAt: new Date().toISOString() },
    { enabled: !!gfeSubmitted, retry: false }
  );
  const gfeContentQuery = trpc.gfePpdr.validateContent.useQuery(
    { elementsProvided: elementsSubmitted ?? [] },
    { enabled: !!elementsSubmitted, retry: false }
  );
  const ppdrQuery = trpc.gfePpdr.evaluateEligibility.useQuery(
    ppdrSubmitted ?? { gfeTotalUsd: 0, billedTotalUsd: 0, billedAt: new Date().toISOString(), insuranceBilled: false },
    { enabled: !!ppdrSubmitted, retry: false }
  );
  const recurringQuery = trpc.gfePpdr.validateRecurringWindow.useQuery(
    recurringSubmitted ?? { firstServiceAt: new Date().toISOString(), lastServiceAt: new Date().toISOString() },
    { enabled: !!recurringSubmitted, retry: false }
  );
  const gfeTotalQuery = trpc.gfePpdr.computeTotalExpectedCharges.useQuery(
    gfeTotalSubmitted ?? { conveningChargesUsd: 0, coProviders: [] },
    { enabled: !!gfeTotalSubmitted, retry: false }
  );

  const tabs = [
    { id: "waiver", label: "Waiver Eligibility" },
    { id: "timing", label: "Timing Validation" },
    { id: "gfe", label: "GFE Deadlines" },
    { id: "ppdr", label: "PPDR Eligibility" },
  ] as const;

  return (
    <div className="container py-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldAlert size={24} className="text-primary" /> Consent & GFE Center
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          45 CFR 149.410–450 waiver rules, 149.420 timing, 149.610 GFE deadlines, and 149.620 PPDR eligibility — validated against the server's compliance modules.
        </p>
      </div>

      <div className="flex gap-1 border-b">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Waiver Eligibility ─────────────────────────────────────────────── */}
      {tab === "waiver" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Waiver Availability (149.410(c)(4) / 149.420(b))</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Service Category</Label>
                <select
                  value={waiver.serviceCategory}
                  onChange={e => setWaiver({ ...waiver, serviceCategory: e.target.value })}
                  className="w-full h-9 px-3 text-sm rounded-md border border-input bg-background"
                >
                  {["EMERGENCY", "ANCILLARY", "DIAGNOSTIC", "UNFORESEEN_URGENT", "NON_EMERGENCY", "AIR_AMBULANCE", "POST_STABILIZATION"].map(c => (
                    <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Provider Specialty (optional)</Label>
                <Input value={waiver.providerSpecialty} onChange={e => setWaiver({ ...waiver, providerSpecialty: e.target.value })} placeholder="e.g. anesthesiology" />
              </div>
            </div>
            <div className="space-y-2">
              {[
                { key: "providerInNetwork", label: "Provider is in-network" },
                { key: "noInNetworkProviderAvailable", label: "No in-network provider available" },
                { key: "emergencyAirAmbulance", label: "Emergency air ambulance" },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={(waiver as any)[key]} onChange={e => setWaiver({ ...waiver, [key]: e.target.checked })} className="rounded" />
                  {label}
                </label>
              ))}
              {waiver.serviceCategory === "POST_STABILIZATION" && (
                <div className="ml-4 pl-3 border-l-2 border-muted space-y-2 mt-2">
                  <p className="text-xs text-muted-foreground font-medium">Post-stabilization conditions (149.410(d)):</p>
                  {[
                    { key: "patientStable", label: "Patient stable" },
                    { key: "canTravelToParticipatingFacility", label: "Can travel to participating facility" },
                    { key: "receivingFacilityReachable", label: "Receiving facility reachable" },
                    { key: "informedConsentObtained", label: "Informed consent obtained" },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={(waiver.postStabilization as any)[key]}
                        onChange={e => setWaiver({ ...waiver, postStabilization: { ...waiver.postStabilization, [key]: e.target.checked } })} className="rounded" />
                      {label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <Button size="sm" onClick={() => setWaiverSubmitted({ ...waiver, providerSpecialty: waiver.providerSpecialty || undefined })}>
              Evaluate Waiver
            </Button>
            {waiverSubmitted && waiverQuery.isError && (
              <p className="text-sm text-destructive">{waiverQuery.error.message}</p>
            )}
            {waiverSubmitted && waiverQuery.data && (
              <div className={`rounded-md border p-3 space-y-2 ${waiverQuery.data.eligible ? "border-green-200 bg-green-50 dark:bg-green-950/20" : "border-red-200 bg-red-50 dark:bg-red-950/20"}`}>
                <Badge variant={waiverQuery.data.eligible ? "secondary" : "destructive"}>
                  {waiverQuery.data.eligible ? "Waiver available — notice & consent permitted" : "Waiver NOT available — balance billing protections apply"}
                </Badge>
                <ul className="space-y-1">
                  {waiverQuery.data.reasons.map((r: string, i: number) => <ResultRow key={i} ok={waiverQuery.data.eligible} label={r} />)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Timing Validation ───────────────────────────────────────────────── */}
      {tab === "timing" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notice Timing (149.420(c)–(d))</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { key: "scheduledAt", label: "Scheduled at" },
                { key: "serviceAt", label: "Service date" },
                { key: "noticeDeliveredAt", label: "Notice delivered at" },
                { key: "consentSignedAt", label: "Consent signed at (optional)" },
              ].map(({ key, label }) => (
                <div key={key} className="space-y-1.5">
                  <Label className="text-xs">{label}</Label>
                  <Input type="datetime-local" value={(timing as any)[key]} onChange={e => setTiming({ ...timing, [key]: e.target.value })} />
                </div>
              ))}
            </div>
            <Button size="sm" disabled={!timing.scheduledAt || !timing.serviceAt || !timing.noticeDeliveredAt}
              onClick={() => setTimingSubmitted({
                scheduledAt: new Date(timing.scheduledAt).toISOString(),
                serviceAt: new Date(timing.serviceAt).toISOString(),
                noticeDeliveredAt: new Date(timing.noticeDeliveredAt).toISOString(),
                ...(timing.consentSignedAt ? { consentSignedAt: new Date(timing.consentSignedAt).toISOString() } : {}),
              })}>
              Validate Timing
            </Button>
            {timingSubmitted && timingQuery.isError && (
              <p className="text-sm text-destructive">{timingQuery.error.message}</p>
            )}
            {timingSubmitted && timingQuery.data && (
              <div className={`rounded-md border p-3 space-y-2 ${timingQuery.data.valid ? "border-green-200 bg-green-50 dark:bg-green-950/20" : "border-red-200 bg-red-50 dark:bg-red-950/20"}`}>
                <Badge variant={timingQuery.data.valid ? "secondary" : "destructive"}>
                  {timingQuery.data.valid ? "Timing valid" : "Timing violation"}
                </Badge>
                <ul className="space-y-1">
                  {timingQuery.data.errors.map((r: string, i: number) => <ResultRow key={i} ok={false} label={r} />)}
                  {timingQuery.data.warnings.map((r: string, i: number) => <ResultRow key={i} ok={false} label={r} />)}
                </ul>
                {timingQuery.data.requiredDeliveryHoursBeforeService != null && (
                  <p className="text-xs text-muted-foreground">Required delivery: {timingQuery.data.requiredDeliveryHoursBeforeService}h before service</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── GFE Deadlines ───────────────────────────────────────────────────── */}
      {tab === "gfe" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">GFE Deadline Calculator (149.610(a)(2))</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Scheduled at</Label>
                  <Input type="datetime-local" value={gfe.scheduledAt} onChange={e => setGfe({ ...gfe, scheduledAt: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Service date</Label>
                  <Input type="datetime-local" value={gfe.serviceAt} onChange={e => setGfe({ ...gfe, serviceAt: e.target.value })} />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={gfe.requestedWithoutScheduling} onChange={e => setGfe({ ...gfe, requestedWithoutScheduling: e.target.checked })} className="rounded" />
                    Patient requested without scheduling
                  </label>
                </div>
              </div>
              <Button size="sm" disabled={!gfe.scheduledAt || !gfe.serviceAt}
                onClick={() => setGfeSubmitted({
                  scheduledAt: new Date(gfe.scheduledAt).toISOString(),
                  serviceAt: new Date(gfe.serviceAt).toISOString(),
                  requestedWithoutScheduling: gfe.requestedWithoutScheduling || undefined,
                })}>
                Compute Deadline
              </Button>
              {gfeSubmitted && gfeDeadlineQuery.isError && (
                <p className="text-sm text-destructive">{gfeDeadlineQuery.error.message}</p>
              )}
              {gfeSubmitted && gfeDeadlineQuery.data && (
                <div className="rounded-md border border-border p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Calendar size={15} className="text-primary" />
                    <span className="text-sm font-medium">GFE due by {fmtDate(gfeDeadlineQuery.data.deadline)}</span>
                    <Badge variant="outline" className="text-xs">{gfeDeadlineQuery.data.horizon}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{gfeDeadlineQuery.data.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* GFE total expected charges (149.610(b)) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 size={16} className="text-primary" /> Total Expected Charges (149.610(b))
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs">Convening provider charges ($)</Label>
                  <Input type="number" value={gfeTotal.convening} onChange={e => setGfeTotal({ ...gfeTotal, convening: e.target.value })} />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs">Co-providers (name:amount, comma-separated)</Label>
                  <Input value={gfeTotal.coProviders} onChange={e => setGfeTotal({ ...gfeTotal, coProviders: e.target.value })} placeholder="Anesthesia Assoc:1200, Radiology Group:350" />
                </div>
              </div>
              <Button size="sm" disabled={!gfeTotal.convening}
                onClick={() => setGfeTotalSubmitted({
                  conveningChargesUsd: Number(gfeTotal.convening),
                  coProviders: gfeTotal.coProviders.split(",").map(s => s.trim()).filter(Boolean).map(pair => {
                    const idx = pair.lastIndexOf(":");
                    const name = idx === -1 ? pair : pair.slice(0, idx).trim();
                    const amt = idx === -1 ? NaN : Number(pair.slice(idx + 1).trim());
                    return { name, expectedChargesUsd: amt };
                  }).filter(c => c.name && Number.isFinite(c.expectedChargesUsd)),
                })}>
                Compute Total
              </Button>
              {gfeTotalSubmitted && gfeTotalQuery.isError && (
                <p className="text-sm text-destructive">{gfeTotalQuery.error.message}</p>
              )}
              {gfeTotalSubmitted && gfeTotalQuery.data && (
                <div className="rounded-md border border-border p-3 space-y-1.5">
                  <Badge variant="secondary">
                    Total expected charges: ${Number(gfeTotalQuery.data.totalExpectedChargesUsd).toFixed(2)}
                  </Badge>
                  <p className="text-xs text-muted-foreground">{gfeTotalQuery.data.rule}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">GFE Content Check (149.610(b))</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Elements provided (comma-separated)</Label>
                <Input value={elements} onChange={e => setElements(e.target.value)} placeholder="patient_name, service_date, itemized_charges, ..." />
              </div>
              <Button size="sm" disabled={!elements.trim()}
                onClick={() => setElementsSubmitted(elements.split(",").map(s => s.trim()).filter(Boolean))}>
                Validate Content
              </Button>
              {elementsSubmitted && gfeContentQuery.data && (
                <div className={`rounded-md border p-3 space-y-2 ${gfeContentQuery.data.valid ? "border-green-200 bg-green-50 dark:bg-green-950/20" : "border-red-200 bg-red-50 dark:bg-red-950/20"}`}>
                  <Badge variant={gfeContentQuery.data.valid ? "secondary" : "destructive"}>
                    {gfeContentQuery.data.valid ? "Content complete" : "Content incomplete"}
                  </Badge>
                  <ul className="space-y-1">
                    {gfeContentQuery.data.missing.map((r: string, i: number) => <ResultRow key={i} ok={false} label={`Missing: ${r}`} />)}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recurring GFE Window (149.610(a)(2)(iii))</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">First service date</Label>
                  <Input type="datetime-local" value={recurring.firstServiceAt} onChange={e => setRecurring({ ...recurring, firstServiceAt: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Last service date</Label>
                  <Input type="datetime-local" value={recurring.lastServiceAt} onChange={e => setRecurring({ ...recurring, lastServiceAt: e.target.value })} />
                </div>
              </div>
              <Button size="sm" disabled={!recurring.firstServiceAt || !recurring.lastServiceAt}
                onClick={() => setRecurringSubmitted({
                  firstServiceAt: new Date(recurring.firstServiceAt).toISOString(),
                  lastServiceAt: new Date(recurring.lastServiceAt).toISOString(),
                })}>
                Validate Window
              </Button>
              {recurringSubmitted && recurringQuery.isError && (
                <p className="text-sm text-destructive">{recurringQuery.error.message}</p>
              )}
              {recurringSubmitted && recurringQuery.data && (
                <div className={`rounded-md border p-3 ${recurringQuery.data.valid ? "border-green-200 bg-green-50 dark:bg-green-950/20" : "border-red-200 bg-red-50 dark:bg-red-950/20"}`}>
                  <Badge variant={recurringQuery.data.valid ? "secondary" : "destructive"}>
                    {recurringQuery.data.valid ? "Within 12-month window" : "Exceeds 12-month window"}
                  </Badge>
                  {recurringQuery.data.reason && <p className="text-xs text-muted-foreground mt-1.5">{recurringQuery.data.reason}</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── PPDR Eligibility ────────────────────────────────────────────────── */}
      {tab === "ppdr" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">PPDR Eligibility (149.620(b))</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">GFE total ($)</Label>
                <Input type="number" value={ppdr.gfeTotalUsd} onChange={e => setPpdr({ ...ppdr, gfeTotalUsd: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Billed total ($)</Label>
                <Input type="number" value={ppdr.billedTotalUsd} onChange={e => setPpdr({ ...ppdr, billedTotalUsd: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Billed at</Label>
                <Input type="datetime-local" value={ppdr.billedAt} onChange={e => setPpdr({ ...ppdr, billedAt: e.target.value })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={ppdr.insuranceBilled} onChange={e => setPpdr({ ...ppdr, insuranceBilled: e.target.checked })} className="rounded" />
              Insurance was billed (disqualifies PPDR)
            </label>
            <Button size="sm" disabled={!ppdr.gfeTotalUsd || !ppdr.billedTotalUsd || !ppdr.billedAt}
              onClick={() => setPpdrSubmitted({
                gfeTotalUsd: Number(ppdr.gfeTotalUsd),
                billedTotalUsd: Number(ppdr.billedTotalUsd),
                billedAt: new Date(ppdr.billedAt).toISOString(),
                insuranceBilled: ppdr.insuranceBilled,
              })}>
              Evaluate Eligibility
            </Button>
            {ppdrSubmitted && ppdrQuery.isError && (
              <p className="text-sm text-destructive">{ppdrQuery.error.message}</p>
            )}
            {ppdrSubmitted && ppdrQuery.data && (
              <div className={`rounded-md border p-3 space-y-2 ${ppdrQuery.data.eligible ? "border-green-200 bg-green-50 dark:bg-green-950/20" : "border-red-200 bg-red-50 dark:bg-red-950/20"}`}>
                <Badge variant={ppdrQuery.data.eligible ? "secondary" : "destructive"}>
                  {ppdrQuery.data.eligible ? "PPDR eligible" : "PPDR ineligible"}
                </Badge>
                {ppdrQuery.data.excessUsd != null && (
                  <p className="text-sm">Excess over GFE: ${Number(ppdrQuery.data.excessUsd).toFixed(2)} (threshold: $400)</p>
                )}
                <ul className="space-y-1">
                  {ppdrQuery.data.reasons.map((r: string, i: number) => <ResultRow key={i} ok={ppdrQuery.data.eligible} label={r} />)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="rounded-md border border-border bg-muted/30 p-4 flex items-start gap-3">
        <Info size={16} className="text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground">
          All validations run against the server's verified compliance modules (45 CFR 149.410–450, 149.610, 149.620).
          Results are advisory; consult counsel for determinations. Cases are persisted server-side via the notice-consent and GFE-PPDR FSM stores.
        </p>
      </div>
    </div>
  );
}
