/**
 * BatchingTab — auditfix-b. Wires the previously-orphan Phase 18 procedures:
 *
 *   submitter.autoBatch       — preview-first auto-batching proposals.
 *   submitter.confirmBatches  — materialize selected proposed batches
 *                               (requires IDR-scope delegation attestation
 *                               server-side; eligibilityAttested here).
 *   submitter.recommendOffer  — offer-strategy engine output, LABELED
 *                               "statistical_estimate" by the server.
 *
 * Honesty contract: the server's "projection_not_guarantee" label on fee
 * savings and the "statistical_estimate" label / honestyNote on offer
 * recommendations are surfaced verbatim — never reworded into a promise.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { SubmitterClient } from "./SubmitterConsole";

const usd = (v: number | null | undefined) =>
  v == null ? "—" : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type ProposedBatch = {
  batchKey: string;
  items: Array<{ disputeId: string; referenceNumber: string | null; serviceCode: string }>;
  rationale: string[];
  capApplied: number;
  regimeBasis: string;
  economics: {
    lineItemCount: number;
    singleFilingsAdminFeesUsd: number;
    batchedAdminFeeUsd: number;
    adminFeeSavingsUsd: number;
    totalProjectedSavingsRangeUsd: { min: number; max: number };
    label: "projection_not_guarantee";
  };
};

function AutoBatchPreview({ client }: { client: SubmitterClient }) {
  const utils = trpc.useUtils();
  const [requested, setRequested] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [attested, setAttested] = useState(false);

  const preview = trpc.submitter.autoBatch.useQuery(
    { submitterClientId: client.id, useNowFallback: false },
    { enabled: requested, retry: 1 },
  );
  const confirm = trpc.submitter.confirmBatches.useMutation({
    onSuccess: r => {
      toast.success(`${r.confirmed} batched dispute${r.confirmed === 1 ? "" : "s"} created`);
      setRequested(false);
      setSelected({});
      setAttested(false);
      utils.submitter.listClientDisputes.invalidate({ submitterClientId: client.id });
    },
    onError: e => toast.error(e.message),
  });

  const batches = (preview.data?.batches ?? []) as ProposedBatch[];
  const chosen = batches.filter(b => selected[b.batchKey]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {client.label} — auto-batching preview
          <Badge variant="outline">preview only</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground max-w-3xl">
          Proposes batched disputes from this client's open, unbatched pool using the CMS-9897-F
          eligibility evaluator. Nothing is created or modified until you confirm below.
        </p>
        {!requested ? (
          <Button size="sm" onClick={() => setRequested(true)}>Run batching preview</Button>
        ) : (
          <>
            {preview.isFetching && <p className="text-muted-foreground">Evaluating open disputes…</p>}
            {preview.isError && <p role="alert" className="text-destructive">{preview.error.message}</p>}
            {preview.data && !preview.isFetching && (
              <>
                <p className="text-xs text-muted-foreground">{preview.data.previewNote}</p>
                {batches.length === 0 && (
                  <p className="text-muted-foreground">
                    No batchable groups found in a pool of {preview.data.poolSize} open dispute
                    {preview.data.poolSize === 1 ? "" : "s"}. Singletons stay as individual filings.
                  </p>
                )}
                {batches.map(b => (
                  <div key={b.batchKey} className="border rounded p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Checkbox
                        id={`sel-${b.batchKey}`}
                        checked={!!selected[b.batchKey]}
                        onCheckedChange={v => setSelected(s => ({ ...s, [b.batchKey]: v === true }))}
                      />
                      <Label htmlFor={`sel-${b.batchKey}`} className="font-medium">
                        {b.batchKey} — {b.economics.lineItemCount} line items
                      </Label>
                      <Badge variant="secondary">
                        projected savings {usd(b.economics.totalProjectedSavingsRangeUsd.min)} – {usd(b.economics.totalProjectedSavingsRangeUsd.max)}
                      </Badge>
                      <Badge variant="outline">{b.economics.label.replace(/_/g, " ")}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Admin fees: {usd(b.economics.singleFilingsAdminFeesUsd)} filed singly → {usd(b.economics.batchedAdminFeeUsd)} batched
                      (deterministic savings {usd(b.economics.adminFeeSavingsUsd)}). Regime basis: {b.regimeBasis}.
                    </p>
                    <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
                      {b.rationale.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                    <p className="text-xs">
                      Items: {b.items.map(i => i.referenceNumber ?? i.disputeId).join(", ")}
                    </p>
                  </div>
                ))}
                {(preview.data.unbatched?.length ?? 0) > 0 && (
                  <details className="text-xs text-muted-foreground">
                    <summary>{preview.data.unbatched.length} dispute(s) could not be batched</summary>
                    <ul className="list-disc pl-5 mt-1 space-y-0.5">
                      {preview.data.unbatched.map((u, i) => (
                        <li key={i}>{u.item.referenceNumber ?? u.item.disputeId}: {u.reason}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {batches.length > 0 && (
                  <div className="border-t pt-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox id={`attest-${client.id}`} checked={attested} onCheckedChange={v => setAttested(v === true)} />
                      <Label htmlFor={`attest-${client.id}`} className="text-xs max-w-2xl">
                        I attest the selected batches meet CMS-9897-F batching eligibility (45 CFR 149.510)
                        and a valid IDR-scope delegation attestation is on file.
                      </Label>
                    </div>
                    <Button
                      size="sm"
                      disabled={!attested || chosen.length === 0 || confirm.isPending}
                      onClick={() => confirm.mutate({
                        submitterClientId: client.id,
                        eligibilityAttested: true,
                        batches: chosen.map(b => ({ disputeIds: b.items.map(i => i.disputeId) })),
                      })}
                    >
                      {confirm.isPending ? "Creating…" : `Confirm ${chosen.length} batch${chosen.length === 1 ? "" : "es"}`}
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OfferStrategy({ client }: { client: SubmitterClient }) {
  const disputesQ = trpc.submitter.listClientDisputes.useQuery(
    { submitterClientId: client.id },
    { enabled: client.status === "active" },
  );
  const [disputeId, setDisputeId] = useState("");
  const offer = trpc.submitter.recommendOffer.useQuery(
    { disputeId },
    { enabled: !!disputeId, retry: 1 },
  );
  const disputes = (disputesQ.data ?? []) as Array<{ id: string; referenceNumber: string; status: string }>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {client.label} — offer strategy
          <Badge variant="outline">statistical estimate</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {disputesQ.isLoading && <p className="text-muted-foreground">Loading disputes…</p>}
        {disputesQ.isError && <p role="alert" className="text-destructive">{disputesQ.error.message}</p>}
        {disputesQ.data && disputes.length === 0 && (
          <p className="text-muted-foreground">No disputes filed for this client yet.</p>
        )}
        {disputes.length > 0 && (
          <select
            aria-label="Dispute for offer recommendation"
            className="border rounded px-2 py-1 text-sm bg-background"
            value={disputeId}
            onChange={e => setDisputeId(e.target.value)}
          >
            <option value="">Select a dispute…</option>
            {disputes.map(d => (
              <option key={d.id} value={d.id}>{d.referenceNumber} ({d.status})</option>
            ))}
          </select>
        )}
        {offer.isFetching && <p className="text-muted-foreground">Computing recommendation…</p>}
        {offer.isError && <p role="alert" className="text-destructive">{offer.error.message}</p>}
        {offer.data && !offer.isFetching && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <p className="text-muted-foreground">Recommended offer</p>
                <p className="text-lg font-semibold">{usd(offer.data.recommendedOfferUsdStatisticalEstimate)}</p>
                <p className="text-xs text-muted-foreground">{offer.data.label.replace(/_/g, " ")}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Win probability used</p>
                <p className="text-lg font-semibold">
                  {offer.data.features.winProbabilityUsed == null
                    ? "—"
                    : `${Math.round(offer.data.features.winProbabilityUsed * 1000) / 10}%`}
                </p>
                <p className="text-xs text-muted-foreground">
                  source: {offer.data.features.winProbabilitySource ?? "none available"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">QPA</p>
                <p className="text-lg font-semibold">{usd(offer.data.features.qpaUsd)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Expected net at recommendation</p>
                <p className="text-lg font-semibold">{usd(offer.data.features.expectedNetUsdAtRecommendation)}</p>
              </div>
            </div>
            {offer.data.recommendedOfferUsdStatisticalEstimate == null && (
              <p className="text-xs text-muted-foreground">
                No recommendation possible — no QPA or initial-payment anchor on record for this dispute.
              </p>
            )}
            <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
              {offer.data.rationale.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            {offer.data.modelCard && (
              <p className="text-xs text-muted-foreground border rounded p-2">
                Model card — {offer.data.modelCard.name} (trained on: {offer.data.modelCard.trainedOn}):{" "}
                {offer.data.modelCard.note}
              </p>
            )}
            <p className="text-xs text-muted-foreground border rounded p-2">{offer.data.honestyNote}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function BatchingTab({ clients }: { clients: SubmitterClient[] }) {
  const active = clients.filter(c => c.status === "active");
  return (
    <div className="space-y-4 pt-4">
      {!clients.length && (
        <p className="text-sm text-muted-foreground">
          No submitter clients yet — batching tools appear once a delegation link exists.
        </p>
      )}
      {clients.length > 0 && active.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No active delegations — batching and offer strategy require an active client link.
        </p>
      )}
      {active.map(c => <AutoBatchPreview key={`batch-${c.id}`} client={c} />)}
      {active.map(c => <OfferStrategy key={`offer-${c.id}`} client={c} />)}
    </div>
  );
}
