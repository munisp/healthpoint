/**
 * SubmitTab — Phase16-FE. Delegated dispute creation wizard (client →
 * attestation-covered NPI → dispute fields → explicit eligibility
 * attestation) and X12 835 remittance ingestion with IDR-eligibility
 * filtering and dispute mapping results.
 */
import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import type { SubmitterClient } from "./SubmitterConsole";

const SERVICE_TYPES = [
  "emergency_medicine", "anesthesiology", "pathology", "radiology", "neonatology",
  "assistant_surgeon", "hospitalist", "intensivist", "air_ambulance", "ground_ambulance", "other",
] as const;

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"] as const;

type RemittanceLine = {
  id: string;
  claimId: string;
  payerId: string | null;
  npi: string | null;
  cptCode: string | null;
  billedCents: number | null;
  allowedCents: number | null;
  carcCodes: string[] | null;
  rarcCodes: string[] | null;
  idrEligibleFlag: boolean;
  mappedDisputeId: string | null;
};

const usd = (cents: number | null) => (cents == null ? "—" : `$${(cents / 100).toFixed(2)}`);

function DisputeWizard({ clients }: { clients: SubmitterClient[] }) {
  const activeClients = clients.filter(c => c.status === "active");
  const [clientId, setClientId] = useState("");
  const client = activeClients.find(c => c.id === clientId) ?? activeClients[0];

  const [partyType, setPartyType] = useState<"provider" | "facility" | "oqp">("provider");
  const [partyName, setPartyName] = useState("");
  const [npi, setNpi] = useState("");
  const [npiFree, setNpiFree] = useState("");
  const [payerName, setPayerName] = useState("");
  const [serviceType, setServiceType] = useState<(typeof SERVICE_TYPES)[number]>("emergency_medicine");
  const [serviceDate, setServiceDate] = useState("");
  const [patientState, setPatientState] = useState<string>("TX");
  const [facilityState, setFacilityState] = useState<string>("TX");
  const [cptCodes, setCptCodes] = useState("");
  const [billedAmount, setBilledAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [eligibilityAttested, setEligibilityAttested] = useState(false);
  const [created, setCreated] = useState<{ id: string; referenceNumber: string; delegationAttestationId: string } | null>(null);

  const effectiveNpi = npi || npiFree.trim() || undefined;
  const create = trpc.submitter.createDelegatedDispute.useMutation({
    onSuccess: r => {
      setCreated({ id: r.id, referenceNumber: r.referenceNumber, delegationAttestationId: r.delegationAttestationId });
      toast.success(`Delegated dispute ${r.referenceNumber} created`);
    },
    onError: e => toast.error(e.message),
  });

  const valid =
    !!client && partyName.trim().length > 0 && serviceDate.length > 0 &&
    cptCodes.split(/[\s,]+/).filter(Boolean).length > 0 &&
    /^\d+(\.\d{1,2})?$/.test(billedAmount) && eligibilityAttested;

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Create delegated dispute</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {!activeClients.length && (
          <p className="text-sm text-muted-foreground">
            Requires an active client link with a valid IDR-scope attestation (server-enforced,
            45 CFR 149.510(b)(2)(ii)(A)(3)). Invite a client and issue an attestation first.
          </p>
        )}
        {!!activeClients.length && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="dd-client">1. Client</Label>
                <select id="dd-client" className="border rounded px-2 py-1 text-sm bg-background w-full"
                  value={client?.id ?? ""} onChange={e => { setClientId(e.target.value); setNpi(""); }}>
                  {activeClients.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="dd-npi">2. Attestation-covered NPI (from client roster)</Label>
                {client && client.npis.length > 0 ? (
                  <select id="dd-npi" className="border rounded px-2 py-1 text-sm bg-background w-full"
                    value={npi} onChange={e => setNpi(e.target.value)}>
                    <option value="">— select roster NPI (optional) —</option>
                    {client.npis.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                ) : (
                  <Input id="dd-npi" aria-label="Initiating party NPI (free entry, roster is empty)"
                    placeholder="NPI (optional — roster empty)" value={npiFree} onChange={e => setNpiFree(e.target.value)} />
                )}
              </div>
            </div>

            <fieldset className="grid grid-cols-1 md:grid-cols-2 gap-3 border rounded p-3">
              <legend className="text-sm font-medium px-1">3. Dispute fields</legend>
              <div>
                <Label htmlFor="dd-ptype">Initiating party type</Label>
                <select id="dd-ptype" className="border rounded px-2 py-1 text-sm bg-background w-full"
                  value={partyType} onChange={e => setPartyType(e.target.value as typeof partyType)}>
                  <option value="provider">provider</option>
                  <option value="facility">facility</option>
                  <option value="oqp">oqp</option>
                </select>
              </div>
              <div>
                <Label htmlFor="dd-pname">Initiating party name</Label>
                <Input id="dd-pname" value={partyName} onChange={e => setPartyName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="dd-payer">Responding payer name (optional)</Label>
                <Input id="dd-payer" value={payerName} onChange={e => setPayerName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="dd-stype">Service type</Label>
                <select id="dd-stype" className="border rounded px-2 py-1 text-sm bg-background w-full"
                  value={serviceType} onChange={e => setServiceType(e.target.value as typeof serviceType)}>
                  {SERVICE_TYPES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="dd-sdate">Service date</Label>
                <Input id="dd-sdate" type="datetime-local" value={serviceDate} onChange={e => setServiceDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="dd-billed">Billed amount (USD)</Label>
                <Input id="dd-billed" inputMode="decimal" placeholder="2100.00" value={billedAmount} onChange={e => setBilledAmount(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="dd-pstate">Patient state</Label>
                <select id="dd-pstate" className="border rounded px-2 py-1 text-sm bg-background w-full"
                  value={patientState} onChange={e => setPatientState(e.target.value)}>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="dd-fstate">Facility state</Label>
                <select id="dd-fstate" className="border rounded px-2 py-1 text-sm bg-background w-full"
                  value={facilityState} onChange={e => setFacilityState(e.target.value)}>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="dd-cpt">CPT codes (comma-separated)</Label>
                <Input id="dd-cpt" placeholder="99285, 99291" value={cptCodes} onChange={e => setCptCodes(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="dd-notes">Notes (optional)</Label>
                <Textarea id="dd-notes" value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </fieldset>

            <div className="flex items-start gap-2">
              <Checkbox id="dd-elig" checked={eligibilityAttested} onCheckedChange={v => setEligibilityAttested(v === true)} />
              <div>
                <Label htmlFor="dd-elig">Eligibility attestation (required)</Label>
                <p className="text-xs text-muted-foreground max-w-2xl">
                  I attest that these items and services were screened and are eligible for the Federal IDR process
                  under the No Surprises Act. The server records this attestation timestamp on the dispute
                  (anti-mass-filing control) and rejects submission without it.
                </p>
              </div>
            </div>

            <Button size="sm" disabled={create.isPending || !valid}
              onClick={() => client && create.mutate({
                submitterClientId: client.id,
                initiatingPartyType: partyType,
                initiatingPartyName: partyName.trim(),
                initiatingPartyNpi: effectiveNpi,
                respondingPartyType: payerName.trim() ? "payer" : undefined,
                respondingPartyName: payerName.trim() || undefined,
                serviceType,
                serviceDate: new Date(serviceDate).toISOString(),
                patientState,
                facilityState,
                cptCodes: cptCodes.split(/[\s,]+/).map(s => s.trim()).filter(Boolean),
                billedAmount,
                notes: notes.trim() || undefined,
                eligibilityAttested: true,
              })}>
              Create delegated dispute
            </Button>
            {created && (
              <div className="border rounded p-3 text-sm space-y-1" role="status">
                <p className="font-medium">Created {created.referenceNumber}</p>
                <p>Dispute id: <code className="break-all">{created.id}</code></p>
                <p>Delegation attestation used: <code className="break-all">{created.delegationAttestationId}</code></p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Remittance835({ submitterOrgId }: { submitterOrgId: string }) {
  const [fileName, setFileName] = useState("");
  const [content, setContent] = useState("");
  const [fileId, setFileId] = useState<string | null>(null);
  const [onlyEligible, setOnlyEligible] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const ingest = trpc.submitter.ingest835.useMutation({
    onSuccess: r => {
      setFileId(r.fileId);
      if (r.duplicate) toast.info(`Duplicate content — reusing existing file (${r.lineCount} lines)`);
      else toast.success(`Parsed ${r.lineCount} remittance lines, ${r.mapped} mapped to disputes`);
    },
    onError: e => toast.error(e.message),
  });
  const linesQ = trpc.submitter.listRemittanceLines.useQuery({ fileId: fileId! }, { enabled: !!fileId });
  const lines = ((linesQ.data ?? []) as RemittanceLine[]).filter(l => !onlyEligible || l.idrEligibleFlag);
  const eligibleCount = (linesQ.data ?? []).filter((l: RemittanceLine) => l.idrEligibleFlag).length;

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Ingest 835 remittance (ERA)</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground max-w-3xl">
          Upload or paste an X12 835. Lines carrying RARC N830 (or NSA-eligible CARC combinations) are flagged
          IDR-eligible; lines whose CLP01 claim id matches a dispute reference number are mapped automatically.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <Input className="w-64" aria-label="Remittance file name" placeholder="remit-2026-09.835"
            value={fileName} onChange={e => setFileName(e.target.value)} />
          <input ref={fileInput} type="file" accept=".835,.txt,.edi" className="text-sm"
            aria-label="Upload .835 file"
            onChange={e => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (!fileName) setFileName(f.name);
              f.text().then(setContent).catch(() => toast.error("Could not read file"));
            }} />
        </div>
        <Textarea aria-label="Paste 835 content" rows={6} placeholder="ISA*00*…" value={content} onChange={e => setContent(e.target.value)} />
        <Button size="sm" disabled={ingest.isPending || !fileName.trim() || !content.trim()}
          onClick={() => ingest.mutate({ orgId: submitterOrgId, fileName: fileName.trim(), content })}>
          Ingest 835
        </Button>

        {fileId && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>File id: <code className="break-all">{fileId}</code></span>
              {linesQ.data && (
                <span className="text-muted-foreground">
                  {linesQ.data.length} lines · {eligibleCount} IDR-eligible · {(linesQ.data as RemittanceLine[]).filter(l => l.mappedDisputeId).length} mapped to disputes
                </span>
              )}
              <span className="flex items-center gap-1">
                <Checkbox id="only-eligible" checked={onlyEligible} onCheckedChange={v => setOnlyEligible(v === true)} />
                <Label htmlFor="only-eligible">Only IDR-eligible</Label>
              </span>
            </div>
            {linesQ.isLoading && <p className="text-sm text-muted-foreground">Loading parsed lines…</p>}
            {linesQ.isError && <p role="alert" className="text-sm text-destructive">{linesQ.error.message}</p>}
            {!!lines.length && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Claim (CLP01)</TableHead>
                    <TableHead>NPI</TableHead>
                    <TableHead>CPT</TableHead>
                    <TableHead>Billed</TableHead>
                    <TableHead>Allowed</TableHead>
                    <TableHead>CARC</TableHead>
                    <TableHead>RARC</TableHead>
                    <TableHead>IDR eligible</TableHead>
                    <TableHead>Mapped dispute</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map(l => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs">{l.claimId}</TableCell>
                      <TableCell className="font-mono text-xs">{l.npi ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{l.cptCode ?? "—"}</TableCell>
                      <TableCell>{usd(l.billedCents)}</TableCell>
                      <TableCell>{usd(l.allowedCents)}</TableCell>
                      <TableCell className="text-xs">{(l.carcCodes ?? []).join(", ") || "—"}</TableCell>
                      <TableCell className="text-xs">{(l.rarcCodes ?? []).join(", ") || "—"}</TableCell>
                      <TableCell>
                        {l.idrEligibleFlag
                          ? <Badge variant="secondary">IDR-eligible</Badge>
                          : <Badge variant="outline">not flagged</Badge>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {l.mappedDisputeId ?? <span className="text-muted-foreground">unmapped</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {linesQ.data && !lines.length && (
              <p className="text-sm text-muted-foreground">
                {onlyEligible ? "No IDR-eligible lines in this file." : "No lines parsed from this file."}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SubmitTab({ submitterOrgId, clients }: { submitterOrgId: string; clients: SubmitterClient[] }) {
  return (
    <div className="space-y-4 pt-4">
      <DisputeWizard clients={clients} />
      <Remittance835 submitterOrgId={submitterOrgId} />
    </div>
  );
}
