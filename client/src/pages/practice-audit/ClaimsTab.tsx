/**
 * Claims tab — scored claims table with expandable verdict detail.
 *
 * Data: trpc.practiceAudit.listClaims + scoreClaims (both EXECUTED-VERIFIED
 * server-side). Verdicts are deterministic rule outputs with CFR citations.
 *
 * Bulk-complete drawer (NEEDS_REVIEW): the phase17-ce bulk-complete /
 * listIncompleteClaims endpoints are NOT yet on the server as of branch
 * a7428296 — this tab codes defensively: it derives the incomplete set from
 * listClaims + score.missingFields, and on save it attempts the bulk-complete
 * mutation via the vanilla client; if the procedure is absent the error is
 * surfaced honestly and the user is offered rescore-only (scoreClaims), which
 * DOES exist. No client-side persistence is faked.
 */
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChevronDown, ChevronRight, Loader2, Play, ListChecks } from "lucide-react";
import { centsToUsd, VERDICT_STYLES, type PracticeClaim } from "./shared";

const EDITABLE_FIELDS = [
  { key: "planType", label: "Plan type", hint: "SELF_FUNDED | FULLY_INSURED | FEHB" },
  { key: "networkStatus", label: "Network status", hint: "out_of_network | in_network" },
  { key: "noticeConsentStatus", label: "Notice & consent status", hint: "none | signed | waived_exception" },
  { key: "serviceCategory", label: "Service category", hint: "EMERGENCY | NON_EMERGENCY | POST_STABILIZATION | AIR_AMBULANCE" },
  { key: "initialPaymentDate", label: "Initial payment / denial date", hint: "YYYY-MM-DD" },
  { key: "allowedCents", label: "Allowed amount (cents)", hint: "integer cents" },
] as const;

export default function ClaimsTab({ orgId }: { orgId: string }) {
  const utils = trpc.useUtils();
  const claimsQuery = trpc.practiceAudit.listClaims.useQuery({ orgId, limit: 500 });
  const claims = useMemo(() => (claimsQuery.data ?? []) as unknown as PracticeClaim[], [claimsQuery.data]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [verdictFilter, setVerdictFilter] = useState<string>("");
  const [codeFilter, setCodeFilter] = useState("");
  const [payerFilter, setPayerFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [bulkSaving, setBulkSaving] = useState(false);

  const scoreClaims = trpc.practiceAudit.scoreClaims.useMutation({
    onSuccess: (r) => {
      toast.success(`Scored ${r.scored} claim(s). ${r.engineNote ?? ""}`);
      utils.practiceAudit.listClaims.invalidate({ orgId });
      utils.practiceAudit.scoreAndSummarize.invalidate({ orgId });
    },
    onError: (e) => toast.error(e.message),
  });

  const filtered = claims.filter(c => {
    if (verdictFilter && (c.score?.verdict ?? "UNSCORED") !== verdictFilter) return false;
    if (codeFilter && !c.cptCodes.some(code => code.toLowerCase().includes(codeFilter.toLowerCase()))) return false;
    if (payerFilter && !(`${c.payerName ?? ""} ${c.payerId ?? ""}`.toLowerCase().includes(payerFilter.toLowerCase()))) return false;
    if (dateFrom && (!c.serviceDate || c.serviceDate < dateFrom)) return false;
    if (dateTo && (!c.serviceDate || c.serviceDate > dateTo)) return false;
    return true;
  });

  const needsReview = claims.filter(c => c.score?.verdict === "NEEDS_REVIEW");

  /**
   * Defensive bulk-complete: attempts the phase17-ce endpoint via the vanilla
   * client. If the procedure does not exist yet, surface the real server
   * error — never pretend the edits were saved.
   */
  const saveBulkComplete = async () => {
    setBulkSaving(true);
    const payload = Object.entries(edits)
      .map(([claimId, fields]) => ({ claimId, fields }))
      .filter(e => Object.values(e.fields).some(v => v.trim() !== ""));
    if (payload.length === 0) {
      toast.info("No edits to save.");
      setBulkSaving(false);
      return;
    }
    try {
      const client = utils.client.practiceAudit as unknown as Record<string, { mutate: (input: unknown) => Promise<unknown> }>;
      if (typeof client.bulkComplete?.mutate !== "function" && typeof client.updateClaimFields?.mutate !== "function") {
        throw new Error("bulk-complete procedure not present on the server (phase17-ce pending)");
      }
      const fn = client.bulkComplete ?? client.updateClaimFields;
      await fn.mutate({ orgId, updates: payload });
      toast.success("Bulk field updates saved (server endpoint). Rescoring…");
      scoreClaims.mutate({ orgId, claimIds: payload.map(p => p.claimId) });
      setEdits({});
      setDrawerOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.warning(
        `Bulk-complete endpoint unavailable — edits were NOT saved (${msg}). ` +
        `This endpoint lands with phase17-ce. Re-ingest corrected source files or rescore after backend lands.`,
      );
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Scored claims ({filtered.length} of {claims.length})</CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={needsReview.length === 0}
              onClick={() => setDrawerOpen(true)}
            >
              <ListChecks className="h-4 w-4 mr-1" /> Complete NEEDS_REVIEW ({needsReview.length})
            </Button>
            <Button
              disabled={claims.length === 0 || scoreClaims.isPending}
              onClick={() => scoreClaims.mutate({ orgId })}
            >
              {scoreClaims.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
              Score all claims
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <Label className="text-xs">Verdict</Label>
              <select className="border rounded px-2 py-1.5 text-sm bg-background" value={verdictFilter} onChange={e => setVerdictFilter(e.target.value)}>
                <option value="">All</option>
                <option value="QUALIFIES">QUALIFIES</option>
                <option value="BLOCKED">BLOCKED</option>
                <option value="NEEDS_REVIEW">NEEDS_REVIEW</option>
                <option value="UNSCORED">UNSCORED</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">CPT/HCPCS code</Label>
              <Input value={codeFilter} onChange={e => setCodeFilter(e.target.value)} className="w-32" placeholder="e.g. 99285" />
            </div>
            <div>
              <Label className="text-xs">Payer</Label>
              <Input value={payerFilter} onChange={e => setPayerFilter(e.target.value)} className="w-40" />
            </div>
            <div>
              <Label className="text-xs">Service date from</Label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">to</Label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
          </div>

          {claimsQuery.isLoading && <p className="text-sm text-muted-foreground">Loading staged claims…</p>}
          {!claimsQuery.isLoading && claims.length === 0 && (
            <p className="text-sm text-muted-foreground">No staged claims yet — ingest an 837 or bulk $export from the Ingest tab.</p>
          )}

          {filtered.length > 0 && (
            <div className="border rounded overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-2 w-6"></th>
                    <th className="p-2">Claim</th>
                    <th className="p-2">Verdict</th>
                    <th className="p-2">Codes</th>
                    <th className="p-2">Payer</th>
                    <th className="p-2">Service date</th>
                    <th className="p-2">Billed</th>
                    <th className="p-2">Completeness</th>
                    <th className="p-2">Jurisdiction</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => {
                    const v = c.score?.verdict ?? "UNSCORED";
                    const style = VERDICT_STYLES[v];
                    const open = !!expanded[c.id];
                    return (
                      <Fragment key={c.id}>
                        <tr className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setExpanded(e => ({ ...e, [c.id]: !e[c.id] }))}>
                          <td className="p-2">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                          <td className="p-2 font-mono text-xs">{c.claimId ?? c.id.slice(0, 8)}</td>
                          <td className="p-2"><Badge variant="outline" className={style.className}>{style.label}</Badge></td>
                          <td className="p-2">{c.cptCodes.join(", ") || "—"}</td>
                          <td className="p-2">{c.payerName ?? c.payerId ?? "—"}</td>
                          <td className="p-2">{c.serviceDate ?? "—"}</td>
                          <td className="p-2">{centsToUsd(c.billedCents)}</td>
                          <td className="p-2 w-36">
                            {c.score ? (
                              <div className="flex items-center gap-2">
                                <Progress value={c.score.completenessPct} className="h-2 w-20" />
                                <span className="text-xs">{c.score.completenessPct}%</span>
                              </div>
                            ) : "—"}
                          </td>
                          <td className="p-2 text-xs">{c.score?.jurisdiction ?? "—"}</td>
                        </tr>
                        {open && (
                          <tr className="border-t bg-muted/20">
                            <td colSpan={9} className="p-3 space-y-3">
                              {!c.score && <p className="text-xs text-muted-foreground">Not scored yet — run “Score all claims”.</p>}
                              {c.score && (
                                <div className="grid gap-3 md:grid-cols-3">
                                  <div>
                                    <p className="text-xs font-semibold mb-1">Rules fired (with CFR citations)</p>
                                    <ul className="space-y-1">
                                      {c.score.rulesFired.map((r, i) => (
                                        <li key={i} className="text-xs border-l-2 pl-2" style={{
                                          borderColor: r.effect === "block" ? "#dc2626" : r.effect === "review" ? "#d97706" : "#16a34a",
                                        }}>
                                          <span className="font-medium">{r.rule}</span> — {r.detail}
                                          <span className="block text-muted-foreground">{r.citation}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                  <div>
                                    <p className="text-xs font-semibold mb-1">Missing fields checklist</p>
                                    {c.score.missingFields.length === 0 ? (
                                      <p className="text-xs text-green-700">None — all eligibility-critical fields present.</p>
                                    ) : (
                                      <ul className="list-disc pl-4 space-y-0.5">
                                        {c.score.missingFields.map(f => <li key={f} className="text-xs text-amber-800">{f}</li>)}
                                      </ul>
                                    )}
                                  </div>
                                  <div>
                                    <p className="text-xs font-semibold mb-1">Evidence checklist ({c.score.completenessPct}% complete)</p>
                                    <ul className="space-y-0.5">
                                      {c.score.evidenceChecklist.map(item => (
                                        <li key={item.key} className={`text-xs flex items-start gap-1 ${item.present ? "text-green-700" : "text-amber-800"}`}>
                                          <span>{item.present ? "✓" : "✗"}</span>
                                          <span>{item.label}
                                            <span className="block text-muted-foreground">{item.citation}</span>
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk-complete drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Complete NEEDS_REVIEW claims ({needsReview.length})</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-4">
            <p className="text-xs text-muted-foreground">
              Fill the fields the eligibility engine flagged as missing, then save &amp; rescore.
              The server-side bulk-complete endpoint is a phase17-ce deliverable: if it is not yet deployed,
              saving fails loudly and nothing is persisted. Rescoring itself (deterministic engine) is available today.
            </p>
            {needsReview.map(c => (
              <Card key={c.id}>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm font-mono">{c.claimId ?? c.id}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-amber-800">Missing: {c.score?.missingFields.join(", ") || "—"}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {EDITABLE_FIELDS.map(f => (
                      <div key={f.key}>
                        <Label className="text-xs">{f.label}</Label>
                        <Input
                          placeholder={f.hint}
                          value={edits[c.id]?.[f.key] ?? ""}
                          onChange={e => setEdits(prev => ({
                            ...prev,
                            [c.id]: { ...(prev[c.id] ?? {}), [f.key]: e.target.value },
                          }))}
                        />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
            <div className="flex gap-2">
              <Button disabled={bulkSaving} onClick={saveBulkComplete}>
                {bulkSaving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Save edits &amp; rescore
              </Button>
              <Button
                variant="outline"
                disabled={scoreClaims.isPending}
                onClick={() => scoreClaims.mutate({ orgId, claimIds: needsReview.map(c => c.id) })}
              >
                Rescore without edits
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
