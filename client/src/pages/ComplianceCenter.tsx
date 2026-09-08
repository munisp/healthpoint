import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  CalendarClock, CheckCircle2, Coins, Download, FileSignature, Landmark, ShieldAlert,
} from "lucide-react";

const fmtCents = (c: number | null | undefined) =>
  c == null ? "-" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function DisputePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const disputesQuery = trpc.disputes.list.useQuery({ limit: 50 }, { retry: false });
  const items: any[] = (disputesQuery.data as any)?.items ?? [];
  return (
    <div className="space-y-1.5 max-w-md">
      <Label>Dispute</Label>
      {disputesQuery.isLoading ? (
        <Skeleton className="h-9 w-full" />
      ) : (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger><SelectValue placeholder="Select a dispute" /></SelectTrigger>
          <SelectContent>
            {items.map((d: any) => (
              <SelectItem key={d.id} value={d.id}>
                {d.referenceNumber ?? d.id} - {String(d.status ?? "").replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

export default function ComplianceCenter() {
  const [disputeId, setDisputeId] = useState("");

  // Deadlines tab
  const deadlinesQuery = trpc.idrCompliance["deadlines.listForDispute"].useQuery(
    { disputeId }, { enabled: !!disputeId, retry: false }
  );
  const computeMutation = trpc.idrCompliance["deadlines.computeForDispute"].useMutation({
    onSuccess: () => { toast.success("Deadline ledger recomputed"); deadlinesQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const markMetMutation = trpc.idrCompliance["deadlines.markMet"].useMutation({
    onSuccess: () => { toast.success("Deadline marked met"); deadlinesQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  // Fees tab
  const schedulesQuery = trpc.idrCompliance["fees.listSchedules"].useQuery(undefined, { retry: false });
  const assessmentsQuery = trpc.idrCompliance["fees.listAssessments"].useQuery(
    { disputeId }, { enabled: !!disputeId, retry: false }
  );
  const assessAdminMutation = trpc.idrCompliance["fees.assessOnIdrInitiation"].useMutation({
    onSuccess: (r) => {
      toast.success(`Admin fee assessed (inserted ${r.inserted}, existing ${r.existing})`);
      assessmentsQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const [idreFee, setIdreFee] = useState({ amountCents: "", role: "responding_party" as "initiating_party" | "responding_party", batched: false });
  const assessIdreMutation = trpc.idrCompliance["fees.assessIdreFee"].useMutation({
    onSuccess: (r) => {
      if (r.warning) toast.warning(r.warning);
      else toast.success("IDRE fee assessed");
      assessmentsQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const [paymentStatusDraft, setPaymentStatusDraft] = useState<Record<string, string>>({});
  const updatePaymentMutation = trpc.idrCompliance["fees.updatePaymentStatus"].useMutation({
    onSuccess: (r) => { toast.success(`Fee status ${r.from} -> ${r.to}`); assessmentsQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  // Attestations tab
  const attestationsQuery = trpc.idrCompliance["attestations.listForDispute"].useQuery(
    { disputeId }, { enabled: !!disputeId, retry: false }
  );
  const [attestForm, setAttestForm] = useState({
    attestationType: "idr_initiation" as "idr_initiation" | "offer_submission",
    partyRole: "initiating_party" as "initiating_party" | "responding_party",
    informationComplete: false,
    informationAccurate: false,
    supersedeExisting: false,
  });
  const attestMutation = trpc.idrCompliance["attestations.attest"].useMutation({
    onSuccess: (r) => {
      toast.success(r.supersededPrior ? "Attestation recorded (prior superseded)" : "Attestation recorded");
      setAttestForm(f => ({ ...f, informationComplete: false, informationAccurate: false, supersedeExisting: false }));
      attestationsQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  // Federal reporting tab
  const [period, setPeriod] = useState({ from: "", to: "" });
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const reportQuery = trpc.idrCompliance["reporting.volumeSummaryCsv"].useQuery(
    { from: period.from, to: period.to },
    { enabled: reportSubmitted && !!period.from && !!period.to, retry: false }
  );
  const summaryRows = useMemo(() => {
    const s = (reportQuery.data as any)?.summary;
    if (!s || typeof s !== "object") return [];
    return Object.entries(s as Record<string, unknown>).filter(([, v]) => typeof v !== "object");
  }, [reportQuery.data]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">IDR Compliance Center</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Statutory deadline ledger (45 CFR 149.510), fee management (149.510(d)), party attestations,
          and federal reporting exports.
        </p>
      </div>

      <DisputePicker value={disputeId} onChange={setDisputeId} />

      <Tabs defaultValue="deadlines">
        <TabsList>
          <TabsTrigger value="deadlines">Deadlines</TabsTrigger>
          <TabsTrigger value="fees">Fees</TabsTrigger>
          <TabsTrigger value="attestations">Attestations</TabsTrigger>
          <TabsTrigger value="reporting">Federal Reporting</TabsTrigger>
        </TabsList>

        {/* Deadlines */}
        <TabsContent value="deadlines" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarClock size={16} className="text-primary" /> Statutory Deadline Timeline
              </CardTitle>
              <Button size="sm" disabled={!disputeId || computeMutation.isPending}
                onClick={() => computeMutation.mutate({ disputeId })}>
                Compute / Refresh Deadlines
              </Button>
            </CardHeader>
            <CardContent>
              {!disputeId ? (
                <p className="text-sm text-muted-foreground">Select a dispute to view its statutory deadline ledger.</p>
              ) : deadlinesQuery.isLoading ? (
                <div className="space-y-2"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
              ) : deadlinesQuery.isError ? (
                <p className="text-sm text-destructive">{deadlinesQuery.error.message}</p>
              ) : (deadlinesQuery.data ?? []).length === 0 ? (
                <div className="py-8 flex flex-col items-center text-muted-foreground">
                  <CalendarClock size={28} className="mb-2 opacity-30" />
                  <p className="text-sm">No deadlines computed yet. Run "Compute / Refresh Deadlines".</p>
                </div>
              ) : (
                <div className="divide-y divide-border rounded-md border border-border">
                  {(deadlinesQuery.data as any[]).map((r, i) => {
                    const remaining = r.computedDeadline
                      ? Math.ceil((new Date(r.computedDeadline).getTime() - Date.now()) / 86400000)
                      : null;
                    return (
                      <div key={r.id ?? i} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <div>
                          <p className="text-sm font-medium text-foreground">{String(r.deadlineType).replace(/_/g, " ")}</p>
                          <p className="text-xs text-muted-foreground">
                            Basis {r.basisDate ? new Date(r.basisDate).toLocaleDateString() : "-"}{" -> "}due{" "}
                            {r.computedDeadline ? new Date(r.computedDeadline).toLocaleDateString() : "-"}{" "}
                            ({r.dayCount} {r.dayKind} days, {r.cfrReference})
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {r.status === "met" ? (
                            <Badge variant="secondary" className="flex items-center gap-1">
                              <CheckCircle2 size={11} /> met {r.metAt ? new Date(r.metAt).toLocaleDateString() : ""}
                            </Badge>
                          ) : (
                            <>
                              <Badge variant={remaining != null && remaining < 0 ? "destructive" : remaining != null && remaining <= 3 ? "destructive" : "outline"}>
                                {remaining != null && remaining < 0 ? `${Math.abs(remaining)}d overdue` : `${remaining}d left`}
                              </Badge>
                              <Button size="sm" variant="outline" className="text-xs"
                                disabled={markMetMutation.isPending}
                                onClick={() => markMetMutation.mutate({ disputeId, deadlineType: r.deadlineType })}>
                                Mark met
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Fees */}
        <TabsContent value="fees" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Coins size={16} className="text-primary" /> Fee Schedules (effective-dated)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {schedulesQuery.isLoading ? (
                <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
              ) : schedulesQuery.isError ? (
                <p className="text-sm text-destructive">{schedulesQuery.error.message}</p>
              ) : (schedulesQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No fee schedules configured. Amounts come from current HHS guidance (45 CFR 149.510(d)) and are
                  never defaulted in code; an admin must create a schedule or seed from IDR_* environment variables.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Effective</TableHead>
                      <TableHead>Admin fee</TableHead>
                      <TableHead>IDRE single range</TableHead>
                      <TableHead>IDRE batched range</TableHead>
                      <TableHead>Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(schedulesQuery.data as any[]).map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          {new Date(s.effectiveFrom).toLocaleDateString()}
                          {s.effectiveTo ? ` - ${new Date(s.effectiveTo).toLocaleDateString()}` : " - open"}
                        </TableCell>
                        <TableCell>{fmtCents(s.adminFeeCents)}</TableCell>
                        <TableCell>
                          {s.idreFeeSingleMinCents != null ? `${fmtCents(s.idreFeeSingleMinCents)} - ${fmtCents(s.idreFeeSingleMaxCents)}` : "-"}
                        </TableCell>
                        <TableCell>
                          {s.idreFeeBatchedMinCents != null ? `${fmtCents(s.idreFeeBatchedMinCents)} - ${fmtCents(s.idreFeeBatchedMaxCents)}` : "-"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.source ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Fee Assessments for Selected Dispute</CardTitle>
              <Button size="sm" variant="outline" disabled={!disputeId || assessAdminMutation.isPending}
                onClick={() => assessAdminMutation.mutate({ disputeId })}>
                Assess Admin Fee (per party)
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {!disputeId ? (
                <p className="text-sm text-muted-foreground">Select a dispute above.</p>
              ) : assessmentsQuery.isLoading ? (
                <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
              ) : (assessmentsQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No fee assessments recorded for this dispute.</p>
              ) : (
                <div className="divide-y divide-border rounded-md border border-border">
                  {(assessmentsQuery.data as any[]).map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {String(a.feeType).replace(/_/g, " ")} - {fmtCents(a.amountCents)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {String(a.partyRole).replace(/_/g, " ")} - assessed {a.assessedAt ? new Date(a.assessedAt).toLocaleDateString() : "-"}
                          {a.paymentReference ? ` - ref ${a.paymentReference}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant={a.status === "paid" ? "secondary" : a.status === "void" || a.status === "refunded" ? "destructive" : "outline"}>
                          {a.status}
                        </Badge>
                        <Select
                          value={paymentStatusDraft[a.id] ?? ""}
                          onValueChange={v => setPaymentStatusDraft(d => ({ ...d, [a.id]: v }))}
                        >
                          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Set status" /></SelectTrigger>
                          <SelectContent>
                            {["invoiced", "paid", "waived", "refunded", "void"].map(s => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" variant="outline" className="text-xs"
                          disabled={!paymentStatusDraft[a.id] || updatePaymentMutation.isPending}
                          onClick={() => updatePaymentMutation.mutate({
                            assessmentId: a.id,
                            status: paymentStatusDraft[a.id] as "invoiced" | "paid" | "waived" | "refunded" | "void",
                          })}>
                          Apply
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="border-t border-border pt-4 space-y-3">
                <p className="text-xs font-medium text-foreground">Assess IDRE fee (non-prevailing party, after determination)</p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Amount (cents)</Label>
                    <Input type="number" className="w-36" value={idreFee.amountCents}
                      onChange={e => setIdreFee({ ...idreFee, amountCents: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Non-prevailing party</Label>
                    <Select value={idreFee.role} onValueChange={v => setIdreFee({ ...idreFee, role: v as typeof idreFee.role })}>
                      <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="initiating_party">Initiating party</SelectItem>
                        <SelectItem value="responding_party">Responding party</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-foreground pb-2">
                    <Checkbox checked={idreFee.batched} onCheckedChange={v => setIdreFee({ ...idreFee, batched: !!v })} />
                    Batched dispute
                  </label>
                  <Button size="sm"
                    disabled={!disputeId || !idreFee.amountCents || Number(idreFee.amountCents) <= 0 || assessIdreMutation.isPending}
                    onClick={() => assessIdreMutation.mutate({
                      disputeId,
                      batched: idreFee.batched,
                      amountCents: Math.round(Number(idreFee.amountCents)),
                      nonPrevailingPartyRole: idreFee.role,
                    })}>
                    Assess IDRE Fee
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Attestations */}
        <TabsContent value="attestations" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileSignature size={16} className="text-primary" /> Record Attestation (149.510(b)(2) / (c)(3))
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Attestation type</Label>
                  <Select value={attestForm.attestationType}
                    onValueChange={v => setAttestForm({ ...attestForm, attestationType: v as typeof attestForm.attestationType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="idr_initiation">IDR initiation</SelectItem>
                      <SelectItem value="offer_submission">Offer submission</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Party role</Label>
                  <Select value={attestForm.partyRole}
                    onValueChange={v => setAttestForm({ ...attestForm, partyRole: v as typeof attestForm.partyRole })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="initiating_party">Initiating party</SelectItem>
                      <SelectItem value="responding_party">Responding party</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <Checkbox checked={attestForm.informationComplete}
                    onCheckedChange={v => setAttestForm({ ...attestForm, informationComplete: !!v })} />
                  I attest the submitted information is complete (evidence of completeness reviewed)
                </label>
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <Checkbox checked={attestForm.informationAccurate}
                    onCheckedChange={v => setAttestForm({ ...attestForm, informationAccurate: !!v })} />
                  I attest the submitted information is accurate (evidence of accuracy reviewed)
                </label>
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <Checkbox checked={attestForm.supersedeExisting}
                    onCheckedChange={v => setAttestForm({ ...attestForm, supersedeExisting: !!v })} />
                  Supersede an existing active attestation (correction; prior row is preserved as superseded)
                </label>
              </div>
              <Button size="sm"
                disabled={!disputeId || !attestForm.informationComplete || !attestForm.informationAccurate || attestMutation.isPending}
                onClick={() => attestMutation.mutate({
                  disputeId,
                  attestationType: attestForm.attestationType,
                  partyRole: attestForm.partyRole,
                  informationComplete: attestForm.informationComplete,
                  informationAccurate: attestForm.informationAccurate,
                  supersedeExisting: attestForm.supersedeExisting,
                })}>
                Record Attestation
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Attestations on Record</CardTitle>
            </CardHeader>
            <CardContent>
              {!disputeId ? (
                <p className="text-sm text-muted-foreground">Select a dispute above.</p>
              ) : attestationsQuery.isLoading ? (
                <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
              ) : (attestationsQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No attestations recorded for this dispute.</p>
              ) : (
                <div className="divide-y divide-border rounded-md border border-border">
                  {(attestationsQuery.data as any[]).map((a) => (
                    <div key={a.id} className="px-3 py-2.5 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={a.status === "active" ? "secondary" : "outline"}>{a.status}</Badge>
                        <Badge variant="outline">{String(a.attestationType).replace(/_/g, " ")}</Badge>
                        <Badge variant="outline">{String(a.partyRole).replace(/_/g, " ")}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {a.attestedAt ? new Date(a.attestedAt).toLocaleString() : "-"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Attested by <span className="text-foreground font-medium">{a.attestedByName ?? a.attestedBy}</span>
                        {a.ipAddress ? ` from ${a.ipAddress}` : ""}
                        {a.userAgent ? ` (${a.userAgent})` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground italic">{a.attestationText}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Federal reporting */}
        <TabsContent value="reporting" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Landmark size={16} className="text-primary" /> Federal IDR Volume Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Period from</Label>
                  <Input type="date" value={period.from} onChange={e => { setPeriod({ ...period, from: e.target.value }); setReportSubmitted(false); }} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Period to</Label>
                  <Input type="date" value={period.to} onChange={e => { setPeriod({ ...period, to: e.target.value }); setReportSubmitted(false); }} />
                </div>
                <Button size="sm" disabled={!period.from || !period.to}
                  onClick={() => setReportSubmitted(true)}>
                  Generate Summary
                </Button>
                {reportQuery.data && (
                  <Button size="sm" variant="outline"
                    onClick={() => downloadCsv(`federal-idr-volume-${period.from}-${period.to}.csv`, (reportQuery.data as any).csv)}>
                    <Download size={14} className="mr-1.5" /> Download CSV
                  </Button>
                )}
              </div>
              {reportSubmitted && reportQuery.isLoading && (
                <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
              )}
              {reportSubmitted && reportQuery.isError && (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <ShieldAlert size={14} className="text-destructive" />
                  {reportQuery.error.message} (federal reporting export is admin-only)
                </p>
              )}
              {reportQuery.data && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {summaryRows.map(([k, v]) => (
                      <Badge key={k} variant="secondary" className="font-normal">
                        {k.replace(/([A-Z])/g, " $1")}: {String(v)}
                      </Badge>
                    ))}
                  </div>
                  <pre className="text-xs bg-muted rounded-md p-3 overflow-auto max-h-72">
                    {(reportQuery.data as any).csv}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
