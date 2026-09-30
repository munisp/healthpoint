/**
 * ClientsTab — Phase16-FE. Submitter client links: invite flow, accept flow
 * (provider side), link status management, roster edit, and delegation
 * status derived honestly from verifyAttestation for known attestation ids
 * (no attestation LIST endpoint exists server-side — see knownAttestations.ts).
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { knownAttestationIds } from "./knownAttestations";
import type { SubmitterClient } from "./SubmitterConsole";

function statusVariant(status: string): "secondary" | "outline" | "destructive" {
  if (status === "active") return "secondary";
  if (status === "suspended" || status === "terminated") return "destructive";
  return "outline";
}

/** Split a comma/whitespace-separated roster string into tokens. */
function parseRoster(s: string): string[] {
  return s.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
}

/** Delegation status badge for one known attestation id (verify-driven). */
function AttestationStatusBadge({ attestationId }: { attestationId: string }) {
  const q = trpc.submitter.verifyAttestation.useQuery({ attestationId }, { retry: 1 });
  if (q.isLoading) return <Badge variant="outline">attestation …</Badge>;
  if (q.isError || !q.data) return <Badge variant="outline">attestation not verifiable</Badge>;
  const d = q.data;
  if (d.status === "revoked") return <Badge variant="destructive">attestation revoked</Badge>;
  if (d.currentlyValid) {
    const exp = d.expiresAt ? new Date(d.expiresAt) : null;
    const soon = exp && exp.getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;
    return <Badge variant="secondary">{soon ? "attestation expiring soon" : "attestation active"}</Badge>;
  }
  return <Badge variant="outline">attestation not currently valid</Badge>;
}

function ClientCard({ client, submitterOrgId }: { client: SubmitterClient; submitterOrgId: string }) {
  const utils = trpc.useUtils();
  const [npis, setNpis] = useState(client.npis.join(", "));
  const [tins, setTins] = useState(client.tins.join(", "));
  const [editing, setEditing] = useState(false);
  const knownIds = useMemo(() => knownAttestationIds(client.id), [client.id]);

  const invalidate = () => utils.submitter.listClients.invalidate({ submitterOrgId });
  const setStatus = trpc.submitter.updateClientStatus.useMutation({
    onSuccess: r => { toast.success(`Delegation ${r.status}`); invalidate(); },
    onError: e => toast.error(e.message),
  });
  const saveRoster = trpc.submitter.updateClientRoster.useMutation({
    onSuccess: () => { toast.success("Roster updated"); setEditing(false); invalidate(); },
    onError: e => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {client.label}
          <Badge variant={statusVariant(client.status)}>{client.status}</Badge>
          {knownIds.length > 0
            ? knownIds.map(id => <AttestationStatusBadge key={id} attestationId={id} />)
            : <Badge variant="outline">no attestation recorded in this browser</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div>Client org: <b>{client.clientOrgId ?? "unbound (awaiting acceptance)"}</b></div>
          <div>NPIs on roster: <b>{client.npis.length}</b></div>
          <div>TINs on roster: <b>{client.tins.length}</b></div>
        </div>

        {editing ? (
          <div className="space-y-2 border rounded p-3">
            <label className="block text-sm font-medium" htmlFor={`npis-${client.id}`}>NPI roster (comma-separated)</label>
            <Textarea id={`npis-${client.id}`} value={npis} onChange={e => setNpis(e.target.value)} />
            <label className="block text-sm font-medium" htmlFor={`tins-${client.id}`}>TIN roster (comma-separated)</label>
            <Textarea id={`tins-${client.id}`} value={tins} onChange={e => setTins(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" disabled={saveRoster.isPending}
                onClick={() => saveRoster.mutate({ submitterClientId: client.id, npis: parseRoster(npis), tins: parseRoster(tins) })}>
                Save roster
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit roster</Button>
            {client.status === "active" && (
              <Button size="sm" variant="outline" className="text-red-700 border-red-300"
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({ submitterClientId: client.id, status: "suspended" })}>
                Suspend delegation
              </Button>
            )}
            {client.status === "suspended" && (
              <>
                <Button size="sm" variant="secondary" disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ submitterClientId: client.id, status: "active" })}>
                  Reactivate
                </Button>
                <Button size="sm" variant="outline" className="text-red-700 border-red-300" disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ submitterClientId: client.id, status: "terminated" })}>
                  Terminate
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ClientsTab({ submitterOrgId, clients }: { submitterOrgId: string; clients: SubmitterClient[] }) {
  const utils = trpc.useUtils();
  const [label, setLabel] = useState("");
  const [clientOrgId, setClientOrgId] = useState("");
  const [npis, setNpis] = useState("");
  const [tins, setTins] = useState("");
  const [inviteResult, setInviteResult] = useState<{ submitterClientId: string; inviteToken: string; expiresInDays: number } | null>(null);

  const invite = trpc.submitter.inviteClient.useMutation({
    onSuccess: r => {
      setInviteResult({ submitterClientId: r.submitterClientId, inviteToken: r.inviteToken, expiresInDays: r.expiresInDays });
      toast.success("Delegation invite created — copy the one-time token now");
      setLabel(""); setClientOrgId(""); setNpis(""); setTins("");
      utils.submitter.listClients.invalidate({ submitterOrgId });
    },
    onError: e => toast.error(e.message),
  });

  const [acceptToken, setAcceptToken] = useState("");
  const accept = trpc.submitter.acceptDelegation.useMutation({
    onSuccess: () => {
      toast.success("Delegation accepted and activated");
      setAcceptToken("");
      utils.submitter.listClients.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  return (
    <div className="space-y-4 pt-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Invite a provider client</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <Input className="w-64" aria-label="Client label" placeholder="Client label (e.g. Riverside EM Group)"
              value={label} onChange={e => setLabel(e.target.value)} />
            <Input className="w-64" aria-label="Client organization id (optional)" placeholder="Client org id (optional)"
              value={clientOrgId} onChange={e => setClientOrgId(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2 items-start">
            <Textarea className="w-64" aria-label="NPI roster for invite" placeholder="NPIs (comma-separated, optional)"
              value={npis} onChange={e => setNpis(e.target.value)} />
            <Textarea className="w-64" aria-label="TIN roster for invite" placeholder="TINs (comma-separated, optional)"
              value={tins} onChange={e => setTins(e.target.value)} />
            <Button size="sm" disabled={invite.isPending || !label.trim()}
              onClick={() => invite.mutate({
                submitterOrgId,
                label: label.trim(),
                clientOrgId: clientOrgId.trim() || undefined,
                npis: parseRoster(npis),
                tins: parseRoster(tins),
              })}>
              Create invite
            </Button>
          </div>
          {inviteResult && (
            <div className="border rounded p-3 text-sm space-y-1" role="status">
              <p className="font-medium">Invite created — the token is shown once and only its hash is stored.</p>
              <p>Submitter client id: <code>{inviteResult.submitterClientId}</code></p>
              <p>One-time invite token (expires in {inviteResult.expiresInDays} days):</p>
              <p><code className="break-all select-all">{inviteResult.inviteToken}</code></p>
              <Button size="sm" variant="outline"
                onClick={() => { navigator.clipboard?.writeText(inviteResult.inviteToken).then(() => toast.success("Token copied")); }}>
                Copy token
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Accept a delegation invite (provider side)</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2 items-center">
          <Input className="w-96" aria-label="Delegation invite token" placeholder="Paste invite token"
            value={acceptToken} onChange={e => setAcceptToken(e.target.value)} />
          <Button size="sm" variant="secondary" disabled={accept.isPending || !acceptToken.trim()}
            onClick={() => accept.mutate({ token: acceptToken.trim() })}>
            Accept delegation
          </Button>
        </CardContent>
      </Card>

      {!clients.length && (
        <p className="text-sm text-muted-foreground">No submitter client links for this organization yet.</p>
      )}
      {clients.map(c => <ClientCard key={c.id} client={c} submitterOrgId={submitterOrgId} />)}
    </div>
  );
}
