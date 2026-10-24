/**
 * AttestationsTab — Phase16-FE. Issue / verify / revoke delegation
 * attestations. There is no server-side LIST procedure (by design), so this
 * tab works from attestation ids it has seen (issued here or looked up by
 * id), remembered per client link in localStorage and re-verified through
 * submitter.verifyAttestation. Nothing about attestation state is
 * fabricated — every badge comes from the verify endpoint.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { forgetAttestation, knownAttestationIds, rememberAttestation } from "./knownAttestations";
import type { SubmitterClient } from "./SubmitterConsole";

type Scope = "claims" | "idr" | "both";

const DEFAULT_AUTHORITY_TEXT =
  "The undersigned attests that the third-party submitter identified herein is authorized to act on behalf of the " +
  "disputing party for purposes of the Federal IDR process under the No Surprises Act, including initiation of IDR, " +
  "submission of offers and supporting information, and receipt of determinations, as required by " +
  "45 CFR 149.510(b)(2)(ii)(A)(3).";

function VerifyResult({ attestationId }: { attestationId: string }) {
  const q = trpc.submitter.verifyAttestation.useQuery({ attestationId }, { retry: 1 });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Verifying…</p>;
  if (q.isError) return <p role="alert" className="text-sm text-destructive">{q.error.message}</p>;
  const d = q.data!;
  return (
    <div className="text-sm space-y-1">
      <div className="flex flex-wrap gap-2 items-center">
        <Badge variant={d.artifactValid ? "secondary" : "destructive"}>artifact {d.artifactValid ? "intact" : "MISMATCH"}</Badge>
        <Badge variant={d.chainValid ? "secondary" : "destructive"}>chain {d.chainValid ? "continuous" : "BROKEN"}</Badge>
        <Badge variant={d.currentlyValid ? "secondary" : "outline"}>{d.currentlyValid ? "currently valid" : "not currently valid"}</Badge>
        <Badge variant="outline">status: {d.status}</Badge>
        <Badge variant="outline">scope: {d.scope}</Badge>
      </div>
      <p className="text-muted-foreground">
        Expires: {d.expiresAt ? new Date(d.expiresAt).toLocaleString() : "never"}
      </p>
    </div>
  );
}

function KnownAttestationRow({ client, attestationId, onForget }: {
  client: SubmitterClient;
  attestationId: string;
  onForget: () => void;
}) {
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [reason, setReason] = useState("");
  const utils = trpc.useUtils();
  const verifyQ = trpc.submitter.verifyAttestation.useQuery({ attestationId }, { retry: 1 });
  const revoke = trpc.submitter.revokeAttestation.useMutation({
    onSuccess: () => {
      toast.success("Attestation revoked");
      setRevokeOpen(false); setReason("");
      utils.submitter.verifyAttestation.invalidate({ attestationId });
    },
    onError: e => toast.error(e.message),
  });

  return (
    <div className="border rounded p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <code className="break-all">{attestationId}</code>
        {verifyQ.data && (
          <Badge variant={verifyQ.data.currentlyValid ? "secondary" : verifyQ.data.status === "revoked" ? "destructive" : "outline"}>
            {verifyQ.data.status === "revoked" ? "revoked" : verifyQ.data.currentlyValid ? "active" : "not currently valid"}
          </Badge>
        )}
      </div>
      <VerifyResult attestationId={attestationId} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => verifyQ.refetch()}>Re-verify</Button>
        <Button size="sm" variant="outline" className="text-red-700 border-red-300"
          disabled={verifyQ.data?.status === "revoked"}
          onClick={() => { setRevokeOpen(true); setReason(""); }}>
          Revoke…
        </Button>
        <Button size="sm" variant="ghost" onClick={onForget}>Forget id</Button>
      </div>

      <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Revoke attestation for {client.label}?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Revocation is immediate and recorded in the audit trail. Delegated dispute creation under this
            attestation will be blocked (45 CFR 149.510(b)(2)(ii)(A)(3) authority requirement).
          </p>
          <Label htmlFor={`revoke-reason-${attestationId}`}>Reason (required)</Label>
          <Textarea id={`revoke-reason-${attestationId}`} value={reason} onChange={e => setReason(e.target.value)} />
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => setRevokeOpen(false)}>Cancel</Button>
            <Button size="sm" variant="destructive" disabled={revoke.isPending || !reason.trim()}
              onClick={() => revoke.mutate({ attestationId, reason: reason.trim() })}>
              Confirm revocation
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AttestationsTab({ clients }: { clients: SubmitterClient[] }) {
  const activeClients = clients.filter(c => c.status === "active");
  const [clientId, setClientId] = useState<string>("");
  const [scope, setScope] = useState<Scope>("both");
  const [authorityText, setAuthorityText] = useState(DEFAULT_AUTHORITY_TEXT);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [feeAccepted, setFeeAccepted] = useState(false);
  const [issued, setIssued] = useState<{ attestationId: string; artifactSha256: string; prevHash: string } | null>(null);
  const [lookupId, setLookupId] = useState("");
  const [, forceRefresh] = useState(0);

  const selectedClient = activeClients.find(c => c.id === clientId) ?? activeClients[0];
  const knownIds = selectedClient ? knownAttestationIds(selectedClient.id) : [];

  const issue = trpc.submitter.issueAttestation.useMutation({
    onSuccess: r => {
      if (selectedClient) rememberAttestation(selectedClient.id, r.attestationId);
      setIssued({ attestationId: r.attestationId, artifactSha256: r.artifactSha256, prevHash: r.prevHash });
      toast.success("Attestation issued (hash-chained)");
      forceRefresh(n => n + 1);
    },
    onError: e => toast.error(e.message),
  });

  return (
    <div className="space-y-4 pt-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Issue delegation attestation</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!activeClients.length && (
            <p className="text-sm text-muted-foreground">
              Attestations require an active delegation link — invite and activate a client first.
            </p>
          )}
          {!!activeClients.length && (
            <>
              <div className="flex flex-wrap gap-2 items-center">
                <Label htmlFor="att-client">Client</Label>
                <select id="att-client" className="border rounded px-2 py-1 text-sm bg-background"
                  value={selectedClient?.id ?? ""} onChange={e => setClientId(e.target.value)}>
                  {activeClients.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <Label htmlFor="att-scope">Scope</Label>
                <select id="att-scope" className="border rounded px-2 py-1 text-sm bg-background"
                  value={scope} onChange={e => setScope(e.target.value as Scope)}>
                  <option value="claims">claims</option>
                  <option value="idr">idr</option>
                  <option value="both">both (claims + idr)</option>
                </select>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <Label htmlFor="att-eff">Effective from</Label>
                <Input id="att-eff" type="datetime-local" className="w-60" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} />
                <Label htmlFor="att-exp">Expires at (optional)</Label>
                <Input id="att-exp" type="datetime-local" className="w-60" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="att-authority">Authority text</Label>
                <Textarea id="att-authority" rows={5} value={authorityText} onChange={e => setAuthorityText(e.target.value)} />
                <p className="text-xs text-muted-foreground">Minimum 10 characters; hashed verbatim into the tamper-evident artifact.</p>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox id="att-fee" checked={feeAccepted} onCheckedChange={v => setFeeAccepted(v === true)} />
                <div>
                  <Label htmlFor="att-fee">Administrative-fee debt accepted</Label>
                  <p className="text-xs text-muted-foreground max-w-2xl">
                    Under CMS-9897-F (disputes initiated on or after 2026-06-11), the administrative fee is per party,
                    per dispute, and becomes non-refundable once a certified IDRE is selected. An attestation may
                    allocate this fee debt between the disputing party and the third-party submitter. Checking this
                    box records that the submitter accepts responsibility for the administrative-fee debt for disputes
                    initiated under this delegation; leaving it unchecked leaves the fee obligation with the
                    disputing party.
                  </p>
                </div>
              </div>
              <Button size="sm" disabled={issue.isPending || !selectedClient || authorityText.trim().length < 10}
                onClick={() => selectedClient && issue.mutate({
                  submitterClientId: selectedClient.id,
                  scope,
                  authorityText: authorityText.trim(),
                  effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
                  expiresAt: expiresAt ? new Date(expiresAt) : undefined,
                  adminFeeDebtAccepted: feeAccepted,
                })}>
                Issue attestation
              </Button>
            </>
          )}
          {issued && (
            <div className="border rounded p-3 text-sm space-y-1" role="status">
              <p className="font-medium">Attestation issued — save the id; there is no list endpoint.</p>
              <p>Attestation id: <code className="break-all">{issued.attestationId}</code></p>
              <p>Artifact SHA-256: <code className="break-all">{issued.artifactSha256}</code></p>
              <p>Previous-chain hash: <code className="break-all">{issued.prevHash}</code></p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Verify an attestation by id</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <Input className="w-96" aria-label="Attestation id to verify" placeholder="Attestation id"
              value={lookupId} onChange={e => setLookupId(e.target.value)} />
            <Button size="sm" variant="secondary" disabled={!lookupId.trim()}
              onClick={() => {
                if (selectedClient && lookupId.trim()) {
                  rememberAttestation(selectedClient.id, lookupId.trim());
                  forceRefresh(n => n + 1);
                  setLookupId("");
                }
              }}>
              Verify &amp; track
            </Button>
          </div>
          {lookupId.trim() && <VerifyResult attestationId={lookupId.trim()} />}
        </CardContent>
      </Card>

      {selectedClient && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">Tracked attestations for {selectedClient.label}</h2>
          {!knownIds.length && (
            <p className="text-sm text-muted-foreground">
              None tracked in this browser. Issued attestations appear here automatically; others can be added by id above.
            </p>
          )}
          {knownIds.map(id => (
            <KnownAttestationRow key={`${id}-${knownIds.join(",").length}`} client={selectedClient} attestationId={id}
              onForget={() => { forgetAttestation(selectedClient.id, id); forceRefresh(n => n + 1); }} />
          ))}
        </div>
      )}
    </div>
  );
}
