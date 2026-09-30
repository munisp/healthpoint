/**
 * Ingest tab — connect-EHR wizard + file staging.
 *
 * Vendor profiles come from trpc.practiceAudit.vendorProfiles
 * (server/emr/vendors.ts): configuration templates assembled from PUBLIC
 * vendor documentation. Per-vendor verification is STATIC-ONLY until a live
 * test (trpc.emr.test) succeeds — the UI never implies otherwise.
 *
 * Staging paths EXECUTED-VERIFIED server-side: X12 837P (ingest837) and
 * FHIR bulk $export ndjson (ingestBulkNdjson). A server-side CSV staging
 * endpoint for practice claims is NOT exposed yet (phase17-ce scope) — the
 * CSV box is honest about that and links to the existing /csv-import flow.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plug, Upload, FileText } from "lucide-react";

type VendorProfile = {
  key: string;
  displayName: string;
  fhirBaseUrlPattern: string | null;
  authType: string;
  bulkSupport: string;
  knownQuirks: string[];
  docsUrl: string;
  verification: "static-only";
};

export default function IngestTab({ orgId }: { orgId: string }) {
  const utils = trpc.useUtils();
  const { data: vendorData } = trpc.practiceAudit.vendorProfiles.useQuery();
  const vendors = useMemo(() => (vendorData?.profiles ?? []) as VendorProfile[], [vendorData]);

  // ── Connect-EHR wizard state ────────────────────────────────────────────
  const [vendorKey, setVendorKey] = useState<string>("");
  const vendor = vendors.find(v => v.key === vendorKey) ?? null;
  const [connName, setConnName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [jwksUrl, setJwksUrl] = useState("");
  const [tokenEndpoint, setTokenEndpoint] = useState("");
  const [groupId, setGroupId] = useState("");

  const testMutation = trpc.emr.test.useMutation({
    onSuccess: (r) => {
      if (r.success) toast.success(`Connection test succeeded: ${r.message}`);
      else toast.warning(`Connection test failed (honest result): ${r.message}`);
    },
    onError: (e) => toast.error(`Connection test failed: ${e.message}`),
  });

  const createConn = trpc.emr.create.useMutation({
    onSuccess: () => {
      toast.success("EMR connection saved (credentials encrypted server-side).");
      utils.emr.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // ── File staging state ──────────────────────────────────────────────────
  const [file837, setFile837] = useState<{ name: string; content: string } | null>(null);
  const [ndjson, setNdjson] = useState("");
  const [ndjsonRef, setNdjsonRef] = useState("");

  const ingest837 = trpc.practiceAudit.ingest837.useMutation({
    onSuccess: (r) => {
      toast.success(`837 staged: ${r.parsedClaims} parsed, ${r.inserted} new, ${r.skippedDuplicates} duplicates (idempotent).`);
      setFile837(null);
      utils.practiceAudit.listClaims.invalidate({ orgId });
    },
    onError: (e) => toast.error(e.message),
  });
  const ingestNdjson = trpc.practiceAudit.ingestBulkNdjson.useMutation({
    onSuccess: (r) => {
      toast.success(`Bulk export staged: ${r.inserted} new, ${r.skippedDuplicates} duplicates.`);
      setNdjson("");
      utils.practiceAudit.listClaims.invalidate({ orgId });
    },
    onError: (e) => toast.error(e.message),
  });

  const readFile = (f: File, cb: (content: string) => void) => {
    const reader = new FileReader();
    reader.onload = () => cb(String(reader.result ?? ""));
    reader.onerror = () => toast.error("Could not read file");
    reader.readAsText(f);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2 mt-4">
      {/* ── Connect-EHR wizard ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plug className="h-4 w-4" /> Connect EHR
            <Badge variant="outline" className="text-amber-700 border-amber-300">vendor profiles: static-only</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="pa-vendor">EHR vendor</Label>
            <select
              id="pa-vendor"
              className="border rounded px-2 py-1.5 text-sm bg-background w-full"
              value={vendorKey}
              onChange={e => {
                setVendorKey(e.target.value);
                const v = vendors.find(x => x.key === e.target.value);
                if (v?.fhirBaseUrlPattern) setBaseUrl(v.fhirBaseUrlPattern);
              }}
            >
              <option value="">Select a vendor profile…</option>
              {vendors.map(v => <option key={v.key} value={v.key}>{v.displayName}</option>)}
              <option value="manual">Other / manual FHIR R4 endpoint</option>
            </select>
            {vendorData?.meta && (
              <p className="text-xs text-muted-foreground mt-1">{(vendorData.meta as { verificationNote?: string }).verificationNote}</p>
            )}
          </div>

          {vendor && (
            <div className="rounded border p-2 text-xs space-y-1 bg-muted/40">
              <p><span className="font-medium">Auth pattern (from public docs):</span> {vendor.authType}</p>
              <p><span className="font-medium">Bulk $export support:</span> {vendor.bulkSupport}</p>
              <p><span className="font-medium">Docs:</span> <a className="underline" href={vendor.docsUrl} target="_blank" rel="noreferrer">{vendor.docsUrl}</a></p>
              <p className="text-amber-700">Verification: {vendor.verification} — no live vendor sandbox has been tested from this stack.</p>
              {vendor.knownQuirks.length > 0 && (
                <ul className="list-disc pl-4 space-y-0.5">
                  {vendor.knownQuirks.map((q, i) => <li key={i}>{q}</li>)}
                </ul>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="pa-conn-name">Connection name</Label>
            <Input id="pa-conn-name" value={connName} onChange={e => setConnName(e.target.value)} placeholder="e.g. Production Epic — Springfield clinic" />
          </div>
          <div>
            <Label htmlFor="pa-base-url">FHIR R4 base URL</Label>
            <Input id="pa-base-url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://…/api/FHIR/R4" />
          </div>

          {(vendor?.authType === "smart-backend-services" || vendorKey === "manual") && (
            <div className="rounded border p-3 space-y-2">
              <p className="text-sm font-medium">SMART Backend Services configuration</p>
              <p className="text-xs text-muted-foreground">
                Client secret / private key are never displayed after saving; they are encrypted server-side (SMART_BACKEND_SERVICES_ENABLED).
              </p>
              <div>
                <Label htmlFor="pa-client-id">Client ID</Label>
                <Input id="pa-client-id" value={clientId} onChange={e => setClientId(e.target.value)} autoComplete="off" />
              </div>
              <div>
                <Label htmlFor="pa-jwks">JWKS URL (public keys registered with vendor)</Label>
                <Input id="pa-jwks" value={jwksUrl} onChange={e => setJwksUrl(e.target.value)} autoComplete="off" />
              </div>
              <div>
                <Label htmlFor="pa-token">Token endpoint (optional override)</Label>
                <Input id="pa-token" value={tokenEndpoint} onChange={e => setTokenEndpoint(e.target.value)} autoComplete="off" />
              </div>
              <div>
                <Label htmlFor="pa-group">Bulk export Group id (if group-scoped)</Label>
                <Input id="pa-group" value={groupId} onChange={e => setGroupId(e.target.value)} />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!vendorKey || !baseUrl || testMutation.isPending}
              onClick={() => testMutation.mutate({
                emrSystem: vendorKey === "manual" ? "generic-fhir" : vendorKey,
                baseUrl,
                credentials: {
                  ...(clientId ? { clientId } : {}),
                  ...(jwksUrl ? { jwksUrl } : {}),
                  ...(tokenEndpoint ? { tokenEndpoint } : {}),
                },
                fieldMappings: {},
              })}
            >
              {testMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Test connection
            </Button>
            <Button
              disabled={!connName || !vendorKey || !baseUrl || createConn.isPending}
              onClick={() => createConn.mutate({
                name: connName,
                emrSystem: vendorKey === "manual" ? "generic-fhir" : vendorKey,
                authType: vendor?.authType ?? "smart-backend-services",
                baseUrl,
                credentials: {
                  ...(clientId ? { clientId } : {}),
                  ...(jwksUrl ? { jwksUrl } : {}),
                  ...(tokenEndpoint ? { tokenEndpoint } : {}),
                },
                fieldMappings: groupId ? { bulkGroupId: groupId } : {},
              })}
            >
              Save connection
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Test results are honest: the server never fabricates a success — a failed or unreachable test is reported as failed.
          </p>
        </CardContent>
      </Card>

      {/* ── File staging ───────────────────────────────────────────────── */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4" /> X12 837P upload
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              type="file"
              accept=".edi,.x12,.txt,.837"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) readFile(f, content => setFile837({ name: f.name, content }));
              }}
            />
            {file837 && <p className="text-xs text-muted-foreground">{file837.name} — {(file837.content.length / 1024).toFixed(1)} KB ready</p>}
            <Button
              disabled={!file837 || ingest837.isPending}
              onClick={() => file837 && ingest837.mutate({ orgId, fileName: file837.name, content: file837.content })}
            >
              {ingest837.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Parse &amp; stage 837
            </Button>
            <p className="text-xs text-muted-foreground">
              837P (professional) only; 837I is rejected with an explicit error. 837 is pre-adjudication: payment
              dates, allowed amounts, network status and plan type are NOT carried and will drive NEEDS_REVIEW.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" /> FHIR bulk $export (ndjson)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="pa-ndjson-ref">Source reference (optional)</Label>
            <Input id="pa-ndjson-ref" value={ndjsonRef} onChange={e => setNdjsonRef(e.target.value)} placeholder="bulk export job id / file name" />
            <Textarea
              value={ndjson}
              onChange={e => setNdjson(e.target.value)}
              rows={6}
              placeholder='Paste ndjson lines: {"resourceType":"Claim",…} — or pick a file below'
            />
            <Input
              type="file"
              accept=".ndjson,.json,.txt"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) readFile(f, content => setNdjson(content));
              }}
            />
            <Button
              disabled={ndjson.trim().length < 2 || ingestNdjson.isPending}
              onClick={() => ingestNdjson.mutate({ orgId, ndjson, sourceRef: ndjsonRef || undefined })}
            >
              {ingestNdjson.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Import bulk export
            </Button>
            <p className="text-xs text-muted-foreground">
              Accepts Claim / ExplanationOfBenefit / Coverage / Patient / Procedure / Practitioner / Organization
              resources. Staging is idempotent by content hash — re-imports are no-ops.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4" /> CSV / 835 remittance
              <Badge variant="outline" className="text-amber-700 border-amber-300">endpoint pending</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              A server-side CSV/835 staging endpoint for practice claims is not exposed yet (phase 17-CE scope).
              In the meantime, the existing dispute-level import flows remain available:
            </p>
            <div className="flex gap-2">
              <Button variant="outline" asChild><a href="/csv-import">CSV import (disputes)</a></Button>
              <Button variant="outline" asChild><a href="/emr-connections">EMR connections</a></Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
