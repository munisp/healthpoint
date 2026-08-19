import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FileCheck2, LockKeyhole, ShieldAlert, Upload } from "lucide-react";
import { toast } from "sonner";

const evidenceStates = ["pending", "submitted", "verified_by_provider", "rejected"];

export default function ProviderSandboxAcceptance() {
  const records = trpc.providerAcceptance.list.useQuery();
  const utils = trpc.useUtils();
  const [providerName, setProviderName] = useState("");
  const [sandboxBaseUrl, setSandboxBaseUrl] = useState("");
  const [providerReference, setProviderReference] = useState("");
  const [mtls, setMtls] = useState("pending");
  const [reconciliation, setReconciliation] = useState("pending");
  const [attestation, setAttestation] = useState("");
  const [notes, setNotes] = useState("");
  const submit = trpc.providerAcceptance.submitEvidence.useMutation({
    onSuccess: () => { toast.success("Acceptance evidence saved. Independent provider review is still required."); setProviderName(""); setSandboxBaseUrl(""); setProviderReference(""); setMtls("pending"); setReconciliation("pending"); setAttestation(""); setNotes(""); void utils.providerAcceptance.list.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const save = () => {
    if (providerName.trim().length < 2) return toast.error("Provider or FSP name is required.");
    submit.mutate({ providerName, sandboxBaseUrl: sandboxBaseUrl || undefined, providerReference: providerReference || undefined, mtlsEvidenceState: mtls as any, reconciliationEvidenceState: reconciliation as any, bilateralAttestationReference: attestation || undefined, evidenceNotes: notes || undefined });
  };

  return <div className="space-y-6"><div><div className="flex items-center gap-2 text-sm text-muted-foreground"><LockKeyhole className="h-4 w-4 text-amber-600" /> Settlement gate control</div><h1 className="mt-1 text-3xl font-bold tracking-tight">Provider/FSP Sandbox Acceptance</h1><p className="mt-1 max-w-3xl text-muted-foreground">Record bilateral sandbox evidence for review. This workspace cannot enable payment execution or self-certify a provider relationship.</p></div>
    <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20"><CardContent className="flex gap-3 p-4 text-sm"><ShieldAlert className="h-5 w-5 shrink-0 text-amber-700" /><div><strong>Fail-closed settlement posture.</strong> Payment execution remains disabled. Provider-issued mTLS material belongs in protected secrets; use this page only for non-secret references and evidence status.</div></CardContent></Card>
    <div className="grid gap-6 lg:grid-cols-[1.05fr_.95fr]"><Card><CardHeader><CardTitle>Submit acceptance evidence</CardTitle><CardDescription>Capture the sandbox endpoint, provider references, and bilateral acceptance references without storing private keys or tokens.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Provider / FSP name"><Input value={providerName} onChange={e => setProviderName(e.target.value)} placeholder="Example FSP Sandbox" /></Field><Field label="Sandbox URL"><Input value={sandboxBaseUrl} onChange={e => setSandboxBaseUrl(e.target.value)} placeholder="https://sandbox.provider.example" /></Field><Field label="Provider test reference"><Input value={providerReference} onChange={e => setProviderReference(e.target.value)} placeholder="Provider-issued reference" /></Field><Field label="Bilateral attestation reference"><Input value={attestation} onChange={e => setAttestation(e.target.value)} placeholder="Acceptance report ID" /></Field><Field label="mTLS evidence"><Select value={mtls} onValueChange={setMtls}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{evidenceStates.map(s => <SelectItem key={s} value={s}>{s.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></Field><Field label="Reconciliation evidence"><Select value={reconciliation} onValueChange={setReconciliation}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{evidenceStates.map(s => <SelectItem key={s} value={s}>{s.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></Field></div><Field label="Evidence notes"><Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Describe the provider-issued report schema, callback test, and independent reviewer." /></Field><Button onClick={save} disabled={submit.isPending}><Upload className="mr-2 h-4 w-4" />Save evidence record</Button></CardContent></Card>
      <Card><CardHeader><CardTitle>Recorded evidence</CardTitle><CardDescription>Evidence may be collected, but never marked production-ready from this application.</CardDescription></CardHeader><CardContent className="space-y-3">{records.isLoading && <p className="text-sm text-muted-foreground">Loading acceptance evidence…</p>}{!records.isLoading && !(records.data ?? []).length && <p className="text-sm text-muted-foreground">No provider evidence has been recorded.</p>}{(records.data ?? []).map(record => <div key={record.id} className="rounded-lg border p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{record.providerName}</p><p className="mt-1 text-xs text-muted-foreground">{record.providerReference || "No provider test reference"}</p></div><Badge variant={record.status === "evidence_collected" ? "secondary" : "outline"}>{record.status.replaceAll("_", " ")}</Badge></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><span>mTLS: <strong>{record.mtlsEvidenceState.replaceAll("_", " ")}</strong></span><span>Reports: <strong>{record.reconciliationEvidenceState.replaceAll("_", " ")}</strong></span></div>{record.bilateralAttestationReference && <p className="mt-2 text-xs text-muted-foreground"><FileCheck2 className="mr-1 inline h-3.5 w-3.5" />{record.bilateralAttestationReference}</p>}</div>)}</CardContent></Card></div>
  </div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>; }
