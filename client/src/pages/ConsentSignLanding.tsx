/**
 * /consent-sign/:token — auditfix-b public patient consent-signature page.
 *
 * The token arrives in the patient signature link (noticeConsent signature
 * flow; single-use, hashed server-side). No login needed — the token is the
 * credential. Signing calls the public noticeConsent.patientSignConsent
 * mutation, which records a tamper-evident signature artifact and returns
 * its hash. The artifact hash is shown to the signer as their receipt.
 * Invalid/expired/used tokens surface the server error verbatim.
 */
import { useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { APP_TITLE, APP_LOGO } from "@/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, PenLine, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function ConsentSignLanding() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";

  const [signerName, setSignerName] = useState("");
  const [signatureText, setSignatureText] = useState("");
  const [attested, setAttested] = useState(false);
  const [receipt, setReceipt] = useState<{ artifactHash: string; signedAt: string } | null>(null);

  const sign = trpc.noticeConsent.patientSignConsent.useMutation({
    onSuccess: r => {
      setReceipt({ artifactHash: r.artifactHash, signedAt: r.signedAt });
      toast.success("Consent signed");
    },
    onError: e => toast.error(e.message),
  });

  const valid = signerName.trim().length > 0 && signatureText.trim().length > 0 && attested;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="w-full border-b bg-background/80 backdrop-blur px-6 flex items-center h-14">
        <div className="flex items-center gap-2">
          <img src={APP_LOGO} alt={APP_TITLE} className="h-8 w-8 rounded-lg border border-border object-cover" />
          <span className="text-xl font-bold tracking-tight">{APP_TITLE}</span>
        </div>
      </header>

      <main id="main-content" className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-md shadow-lg border-border/60">
          <CardHeader className="text-center pb-4">
            <div className="flex justify-center mb-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                {receipt ? (
                  <CheckCircle2 className="h-6 w-6 text-primary" aria-hidden="true" />
                ) : (
                  <PenLine className="h-6 w-6 text-primary" aria-hidden="true" />
                )}
              </div>
            </div>
            <CardTitle className="text-xl">
              {receipt ? "Consent signed" : "Sign notice & consent"}
            </CardTitle>
            <CardDescription className="text-sm">
              {receipt
                ? "Your signature has been recorded. Keep the receipt hash below."
                : "Sign the surprise-billing notice & consent document your provider sent you."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {receipt ? (
              <div className="space-y-2 text-sm" role="status">
                <p>Signed at: {new Date(receipt.signedAt).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Tamper-evident signature receipt (hash):</p>
                <p className="font-mono text-xs break-all border rounded p-2 select-all">{receipt.artifactHash}</p>
              </div>
            ) : (
              <>
                {!token && (
                  <p role="alert" className="text-sm text-destructive">
                    This link is missing its signing token. Use the exact link from your provider's message.
                  </p>
                )}
                <div className="space-y-1">
                  <Label htmlFor="signer-name">Your full name</Label>
                  <Input id="signer-name" value={signerName} onChange={e => setSignerName(e.target.value)} autoComplete="name" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="signature-text">Type your signature</Label>
                  <Input id="signature-text" value={signatureText} onChange={e => setSignatureText(e.target.value)} placeholder="Type your name as your signature" />
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox id="sign-attest" checked={attested} onCheckedChange={v => setAttested(v === true)} />
                  <Label htmlFor="sign-attest" className="text-xs leading-snug">
                    I have read the notice & consent document and I agree. I understand this typed
                    signature is legally binding.
                  </Label>
                </div>
                {sign.isError && (
                  <p role="alert" className="text-sm text-destructive">
                    {sign.error.message}. The link may have expired or already been used — ask your
                    provider for a new one.
                  </p>
                )}
                <Button
                  className="w-full"
                  disabled={!valid || !token || sign.isPending}
                  onClick={() => sign.mutate({ token, signerName: signerName.trim(), signatureText: signatureText.trim(), attestation: true })}
                >
                  {sign.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                  Sign consent
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
