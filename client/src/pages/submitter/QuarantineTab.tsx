/**
 * QuarantineTab — Phase 19-FE. Review queue for rows that failed
 * parse/validation during a bulk upload (bulkUpload.listQuarantinedRows).
 *
 * Actions:
 *  - Repair inline: edit the claim fields the server flagged missing
 *    (manualClaimFieldsSchema, same shape as practiceAudit manual repair)
 *    and re-submit via bulkUpload.repairQuarantinedRows. The server
 *    re-scores the claim; if it still fails eligibility gates the row
 *    STAYS quarantined with refreshed missingFields (fail-closed), and the
 *    UI says so.
 *  - Discard: bulkUpload.discardQuarantinedRows (explicit human action;
 *    discarded rows remain visible under the "discarded" filter).
 */
import { useState, type ChangeEvent } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type QuarantineRow = {
  id: string;
  sessionId: string;
  rowNumber: number;
  rawPayload: string;
  errorReason: string;
  missingFields: unknown;
  status: string;
  repairedClaimId: string | null;
  createdAt: string | Date;
};

type RepairDraft = {
  claimId: string;
  payerName: string;
  payerId: string;
  planType: string;
  serviceCategory: string;
  serviceDate: string;
  facilityState: string;
  patientState: string;
  networkStatus: string;
  noticeConsentStatus: string;
  cptCodes: string;
  billedUsd: string;
  allowedUsd: string;
  paidUsd: string;
  renderingNpi: string;
  billingNpi: string;
  tin: string;
};

const EMPTY_DRAFT: RepairDraft = {
  claimId: "", payerName: "", payerId: "", planType: "", serviceCategory: "",
  serviceDate: "", facilityState: "", patientState: "", networkStatus: "",
  noticeConsentStatus: "", cptCodes: "", billedUsd: "", allowedUsd: "",
  paidUsd: "", renderingNpi: "", billingNpi: "", tin: "",
};

const usdToCents = (s: string): number | undefined => {
  if (!s.trim()) return undefined;
  if (!/^\d+(\.\d{1,2})?$/.test(s.trim())) return undefined;
  return Math.round(Number(s) * 100);
};

/** Build a manualClaimFieldsSchema-shaped payload, omitting empty fields. */
function draftToFields(d: RepairDraft): Record<string, unknown> | null {
  const fields: Record<string, unknown> = {};
  if (d.claimId.trim()) fields.claimId = d.claimId.trim();
  if (d.payerName.trim()) fields.payerName = d.payerName.trim();
  if (d.payerId.trim()) fields.payerId = d.payerId.trim();
  if (d.planType) fields.planType = d.planType;
  if (d.serviceCategory) fields.serviceCategory = d.serviceCategory;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d.serviceDate)) fields.serviceDate = d.serviceDate;
  if (/^[A-Z]{2}$/i.test(d.facilityState)) fields.facilityState = d.facilityState.toUpperCase();
  if (/^[A-Z]{2}$/i.test(d.patientState)) fields.patientState = d.patientState.toUpperCase();
  if (d.networkStatus) fields.networkStatus = d.networkStatus;
  if (d.noticeConsentStatus) fields.noticeConsentStatus = d.noticeConsentStatus;
  const cpts = d.cptCodes.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  if (cpts.length) fields.cptCodes = cpts;
  const billed = usdToCents(d.billedUsd);
  if (billed !== undefined) fields.billedCents = billed;
  const allowed = usdToCents(d.allowedUsd);
  if (allowed !== undefined) fields.allowedCents = allowed;
  const paid = usdToCents(d.paidUsd);
  if (paid !== undefined) fields.paidCents = paid;
  if (/^\d{10}$/.test(d.renderingNpi)) fields.renderingNpi = d.renderingNpi;
  if (/^\d{10}$/.test(d.billingNpi)) fields.billingNpi = d.billingNpi;
  if (/^\d{9}$/.test(d.tin)) fields.tin = d.tin;
  return Object.keys(fields).length ? fields : null;
}

function RepairEditor({ orgId, row, onDone }: { orgId: string; row: QuarantineRow; onDone: () => void }) {
  const [draft, setDraft] = useState<RepairDraft>(EMPTY_DRAFT);
  const repair = trpc.bulkUpload.repairQuarantinedRows.useMutation({
    onSuccess: r => {
      const res = r.results[0];
      if (res?.repaired) {
        toast.success(`Row ${row.rowNumber} repaired and re-submitted (verdict: ${res.verdict})`);
        onDone();
      } else {
        toast.warning(
          `Row ${row.rowNumber} still fails eligibility gates and remains quarantined. Missing: ${(res?.missingFields as Array<{ field?: string }> ?? []).map(m => m?.field ?? String(m)).join(", ") || "see row detail"}`,
        );
        onDone();
      }
    },
    onError: e => toast.error(e.message),
  });

  const set = (k: keyof RepairDraft) => (e: ChangeEvent<HTMLInputElement>) =>
    setDraft(prev => ({ ...prev, [k]: e.target.value }));
  const setSel = (k: keyof RepairDraft) => (e: ChangeEvent<HTMLSelectElement>) =>
    setDraft(prev => ({ ...prev, [k]: e.target.value }));

  const missing = Array.isArray(row.missingFields)
    ? (row.missingFields as Array<{ field?: string }>).map(m => m?.field ?? String(m)).filter(Boolean)
    : [];

  return (
    <div className="border rounded-md p-3 space-y-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Repair row {row.rowNumber}</p>
        {missing.length > 0 && (
          <p className="text-xs text-muted-foreground">Server-flagged missing: {missing.join(", ")}</p>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div><Label className="text-xs">Claim ID</Label><Input value={draft.claimId} onChange={set("claimId")} aria-label="Claim ID" /></div>
        <div><Label className="text-xs">Payer name</Label><Input value={draft.payerName} onChange={set("payerName")} aria-label="Payer name" /></div>
        <div><Label className="text-xs">Payer ID</Label><Input value={draft.payerId} onChange={set("payerId")} aria-label="Payer ID" /></div>
        <div>
          <Label className="text-xs">Plan type</Label>
          <select className="border rounded px-2 py-1 text-sm bg-background w-full" value={draft.planType} onChange={setSel("planType")} aria-label="Plan type">
            <option value="">—</option>
            <option value="FULLY_INSURED">Fully insured</option>
            <option value="SELF_FUNDED">Self-funded</option>
            <option value="FEHB">FEHB</option>
          </select>
        </div>
        <div>
          <Label className="text-xs">Service category</Label>
          <select className="border rounded px-2 py-1 text-sm bg-background w-full" value={draft.serviceCategory} onChange={setSel("serviceCategory")} aria-label="Service category">
            <option value="">—</option>
            <option value="EMERGENCY">Emergency</option>
            <option value="NON_EMERGENCY">Non-emergency</option>
            <option value="POST_STABILIZATION">Post-stabilization</option>
            <option value="AIR_AMBULANCE">Air ambulance</option>
          </select>
        </div>
        <div><Label className="text-xs">Service date</Label><Input type="date" value={draft.serviceDate} onChange={set("serviceDate")} aria-label="Service date" /></div>
        <div><Label className="text-xs">Facility state (2-letter)</Label><Input maxLength={2} value={draft.facilityState} onChange={set("facilityState")} aria-label="Facility state" /></div>
        <div><Label className="text-xs">Patient state (2-letter)</Label><Input maxLength={2} value={draft.patientState} onChange={set("patientState")} aria-label="Patient state" /></div>
        <div>
          <Label className="text-xs">Network status</Label>
          <select className="border rounded px-2 py-1 text-sm bg-background w-full" value={draft.networkStatus} onChange={setSel("networkStatus")} aria-label="Network status">
            <option value="">—</option>
            <option value="out_of_network">Out of network</option>
            <option value="in_network">In network</option>
          </select>
        </div>
        <div>
          <Label className="text-xs">Notice &amp; consent</Label>
          <select className="border rounded px-2 py-1 text-sm bg-background w-full" value={draft.noticeConsentStatus} onChange={setSel("noticeConsentStatus")} aria-label="Notice and consent status">
            <option value="">—</option>
            <option value="none">None</option>
            <option value="signed">Signed</option>
            <option value="waived_exception">Waived (exception)</option>
          </select>
        </div>
        <div><Label className="text-xs">CPT codes (comma-separated)</Label><Input value={draft.cptCodes} onChange={set("cptCodes")} aria-label="CPT codes" placeholder="99285, 99291" /></div>
        <div><Label className="text-xs">Billed (USD)</Label><Input inputMode="decimal" value={draft.billedUsd} onChange={set("billedUsd")} aria-label="Billed amount USD" placeholder="2100.00" /></div>
        <div><Label className="text-xs">Allowed (USD)</Label><Input inputMode="decimal" value={draft.allowedUsd} onChange={set("allowedUsd")} aria-label="Allowed amount USD" /></div>
        <div><Label className="text-xs">Paid (USD)</Label><Input inputMode="decimal" value={draft.paidUsd} onChange={set("paidUsd")} aria-label="Paid amount USD" /></div>
        <div><Label className="text-xs">Rendering NPI (10 digits)</Label><Input value={draft.renderingNpi} onChange={set("renderingNpi")} aria-label="Rendering NPI" /></div>
        <div><Label className="text-xs">Billing NPI (10 digits)</Label><Input value={draft.billingNpi} onChange={set("billingNpi")} aria-label="Billing NPI" /></div>
        <div><Label className="text-xs">TIN (9 digits)</Label><Input value={draft.tin} onChange={set("tin")} aria-label="TIN" /></div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={repair.isPending}
          onClick={() => {
            const fields = draftToFields(draft);
            if (!fields) {
              toast.error("Fill at least one valid field before re-submitting");
              return;
            }
            repair.mutate({ orgId, updates: [{ quarantineId: row.id, fields: fields as never }] });
          }}
        >
          {repair.isPending ? "Re-submitting…" : "Re-submit repaired row"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Close</Button>
      </div>
    </div>
  );
}

export default function QuarantineTab({ orgId }: { orgId: string }) {
  const [statusFilter, setStatusFilter] = useState<"quarantined" | "repaired" | "discarded">("quarantined");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);

  const rowsQ = trpc.bulkUpload.listQuarantinedRows.useQuery({ orgId, status: statusFilter, limit: 100 });
  const rows = (rowsQ.data?.rows ?? []) as QuarantineRow[];

  const discard = trpc.bulkUpload.discardQuarantinedRows.useMutation({
    onSuccess: r => {
      toast.success(`${r.discarded} row${r.discarded === 1 ? "" : "s"} discarded`);
      setSelected(new Set());
      rowsQ.refetch();
    },
    onError: e => toast.error(e.message),
  });

  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4 pt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
            <span>Quarantine review</span>
            <div className="flex items-center gap-2">
              <Label htmlFor="q-status" className="text-sm font-normal text-muted-foreground">Show</Label>
              <select
                id="q-status"
                className="border rounded px-2 py-1 text-sm bg-background"
                value={statusFilter}
                onChange={e => { setStatusFilter(e.target.value as typeof statusFilter); setSelected(new Set()); setEditingId(null); }}
              >
                <option value="quarantined">Quarantined (needs action)</option>
                <option value="repaired">Repaired</option>
                <option value="discarded">Discarded</option>
              </select>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground max-w-3xl">
            Rows that failed validation during a bulk upload are held here — never silently dropped. Repair a row
            by filling the flagged fields and re-submitting it; the claim is re-scored server-side and only leaves
            quarantine when it passes the eligibility gates. Discarding is explicit and audited.
          </p>

          {statusFilter === "quarantined" && selected.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={discard.isPending}
              onClick={() => discard.mutate({ orgId, ids: [...selected] })}
            >
              Discard {selected.size} selected row{selected.size === 1 ? "" : "s"}
            </Button>
          )}

          {rowsQ.isLoading && <p className="text-sm text-muted-foreground">Loading quarantined rows…</p>}
          {rowsQ.isError && <p role="alert" className="text-sm text-destructive">{rowsQ.error.message}</p>}
          {rowsQ.data && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {statusFilter === "quarantined"
                ? "Nothing quarantined — all parsed rows passed validation."
                : `No ${statusFilter} rows.`}
            </p>
          )}

          {rows.map(row => (
            <div key={row.id} className="border rounded-md p-3 space-y-2">
              <div className="flex flex-wrap items-start gap-3">
                {statusFilter === "quarantined" && (
                  <Checkbox
                    aria-label={`Select row ${row.rowNumber}`}
                    checked={selected.has(row.id)}
                    onCheckedChange={() => toggle(row.id)}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">Row {row.rowNumber}</span>
                    <Badge variant={row.status === "quarantined" ? "destructive" : row.status === "repaired" ? "default" : "outline"}>
                      {row.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-destructive mt-1">{row.errorReason}</p>
                  <details className="mt-1">
                    <summary className="text-xs text-muted-foreground cursor-pointer">Raw row content</summary>
                    <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto max-h-40 whitespace-pre-wrap break-all">{row.rawPayload}</pre>
                  </details>
                  {row.repairedClaimId && (
                    <p className="text-xs text-muted-foreground mt-1">Repaired into claim <code>{row.repairedClaimId}</code></p>
                  )}
                </div>
                {statusFilter === "quarantined" && (
                  <Button size="sm" variant="outline" onClick={() => setEditingId(editingId === row.id ? null : row.id)}>
                    {editingId === row.id ? "Close editor" : "Repair"}
                  </Button>
                )}
              </div>
              {editingId === row.id && (
                <RepairEditor orgId={orgId} row={row} onDone={() => { setEditingId(null); rowsQ.refetch(); }} />
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
