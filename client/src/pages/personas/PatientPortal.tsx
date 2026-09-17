/**
 * /patient/:token — public patient portal (no login). Redacted dispute view,
 * document upload, and PPDR self-service intake wizard. Token-guarded via
 * patientPortal public procedures.
 */
import { useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { APP_TITLE } from "@/const";

export default function PatientPortal() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";
  const view = trpc.patientPortal.viewCase.useQuery({ token }, {
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });
  const [fileName, setFileName] = useState("");
  const [docType, setDocType] = useState("patient_statement");
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const upload = trpc.patientPortal.uploadDocument.useMutation({
    onSuccess: r => setUploadMsg(`Uploaded (document ${r.documentId})`),
    onError: e => setUploadMsg(`Upload failed: ${e.message}`),
  });

  // PPDR intake wizard state
  const [gfe, setGfe] = useState("");
  const [billed, setBilled] = useState("");
  const [billedAt, setBilledAt] = useState("");
  const [insured, setInsured] = useState(false);
  const [ppdrMsg, setPpdrMsg] = useState<string | null>(null);
  const intake = trpc.patientPortal.ppdrIntake.useMutation({
    onSuccess: r => setPpdrMsg(`PPDR dispute ${r.ppdrDisputeId} initiated (state ${r.state}, excess $${r.excessUsd.toFixed(2)})`),
    onError: e => setPpdrMsg(`PPDR intake failed: ${e.message}`),
  });

  return (
    <div className="min-h-screen bg-background p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">{APP_TITLE} — Patient Portal</h1>

      {view.error && (
        <Card><CardContent className="p-4 text-sm text-destructive">{view.error.message}</CardContent></Card>
      )}
      {view.data && (
        <Card>
          <CardHeader><CardTitle className="text-base">
            Case {view.data.dispute.referenceNumber}
            <Badge className="ml-2" variant="outline">{view.data.dispute.status}</Badge>
          </CardTitle></CardHeader>
          <CardContent className="text-sm grid grid-cols-2 gap-2">
            <div>Provider: <b>{view.data.dispute.initiatingPartyName}</b></div>
            <div>Health plan: <b>{view.data.dispute.respondingPartyName ?? "—"}</b></div>
            <div>Billed: <b>${view.data.dispute.billedAmount}</b></div>
            <div>Determination: <b>{view.data.dispute.determinationAmount ? `$${view.data.dispute.determinationAmount}` : "pending"}</b></div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Upload a document</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Input placeholder="document type" value={docType} onChange={e => setDocType(e.target.value)} className="w-48" />
            <Input placeholder="file name (e.g. bill.pdf)" value={fileName} onChange={e => setFileName(e.target.value)} />
            <Button
              disabled={upload.isPending || !fileName.trim()}
              onClick={() => upload.mutate({ token, documentType: docType, fileName })}
            >Upload</Button>
          </div>
          {uploadMsg && <p className="text-sm text-muted-foreground">{uploadMsg}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Patient-Provider Dispute Resolution (PPDR) intake</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Uninsured/self-pay? If your bill is at least $400 above your good faith estimate, you can open a PPDR dispute here.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <Input className="w-32" placeholder="GFE total $" value={gfe} onChange={e => setGfe(e.target.value)} />
            <Input className="w-32" placeholder="Billed total $" value={billed} onChange={e => setBilled(e.target.value)} />
            <Input className="w-44" type="date" value={billedAt} onChange={e => setBilledAt(e.target.value)} />
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={insured} onChange={e => setInsured(e.target.checked)} />
              Insurance was billed
            </label>
            <Button
              variant="secondary"
              disabled={intake.isPending || !gfe || !billed || !billedAt}
              onClick={() => intake.mutate({
                token,
                gfeTotalUsd: Number(gfe),
                billedTotalUsd: Number(billed),
                billedAt: new Date(billedAt).toISOString(),
                insuranceBilled: insured,
              })}
            >Submit PPDR dispute</Button>
          </div>
          {ppdrMsg && <p className="text-muted-foreground">{ppdrMsg}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
