/**
 * MfaConfirmPage.tsx — Wave P26 (O6)
 *
 * Public landing page for the first-factor enrollment confirmation email
 * (/confirm-enrollment#token=…). Token-only by design: the visitor does NOT
 * need a session — the token itself is the proof of mailbox ownership, so an
 * attacker's mfa-pending session cannot self-confirm. On success the new
 * factor is active; the user is sent back to /mfa to finish signing in.
 */
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ShieldCheck, AlertCircle } from "lucide-react";

export default function MfaConfirmPage() {
  const [state, setState] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState<string>("");
  const confirm = trpc.mfaConfirm.confirm.useMutation();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // React 18 StrictMode double-effect guard
    started.current = true;
    // The token travels in the URL FRAGMENT (#token=…), never the query
    // string, so it stays out of server access logs and browser history.
    // Legacy fallback: links emailed before this change carried the token in
    // the query (?token=); those expire within the token TTL (≤1h), so we
    // still honor them during the deploy rollover window.
    const fragmentToken = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
    const queryToken = new URLSearchParams(window.location.search).get("token");
    const token = fragmentToken ?? queryToken ?? "";
    if (token.length < 32) {
      setState("error");
      setMessage("This confirmation link is invalid or has expired.");
      return;
    }
    confirm
      .mutateAsync({ token })
      .then(() => setState("ok"))
      .catch(e => {
        setState("error");
        setMessage(e instanceof Error ? e.message : "This confirmation link is invalid or has expired.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            {state === "working" ? <Loader2 className="h-6 w-6 animate-spin text-primary" />
              : state === "ok" ? <ShieldCheck className="h-6 w-6 text-primary" />
              : <AlertCircle className="h-6 w-6 text-destructive" />}
          </div>
          <CardTitle>
            {state === "working" ? "Confirming…" : state === "ok" ? "Sign-in method confirmed" : "Confirmation failed"}
          </CardTitle>
          <CardDescription>HealthPoint two-step verification</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {state === "ok" && (
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertDescription>
                Your new sign-in method is now active. Return to the sign-in tab to finish
                signing in.
              </AlertDescription>
            </Alert>
          )}
          {state === "error" && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
          <Button className="w-full" variant={state === "ok" ? "default" : "outline"}
            onClick={() => window.location.assign("/mfa")}>
            Back to sign-in
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
