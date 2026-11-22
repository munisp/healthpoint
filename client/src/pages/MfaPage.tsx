/**
 * MfaPage.tsx — Phase 25 (design §6.2, §6.5)
 *
 * The /mfa route that server/_core/keycloak.ts redirects to after primary
 * (Keycloak) sign-in when getMfaRequirement() is "verify" or "enroll".
 * Until this wave the route did not exist and mfa-pending logins landed on
 * the catch-all 404 — this page closes that gap.
 *
 *  - mode=verify: passkey-primary UI ("Use your passkey") with "Use
 *    authenticator app instead" and "Email me a code" fallbacks wired to the
 *    existing auth.verifyLoginTotp / auth.requestLoginEmailOtp /
 *    auth.verifyLoginEmailOtp procedures.
 *  - mode=enroll: forced-enrollment wizard — passkey offer first when
 *    WEBAUTHN_ENABLED (and the browser supports WebAuthn), TOTP setup via
 *    the existing totp.* flow otherwise.
 *
 * Low-end Android error states (§6.5): no WebAuthn support → passkey UI
 * hidden entirely (never a dead button); NotAllowedError → non-destructive
 * retry copy (+ screen-lock hint); SecurityError → "open the exact site
 * address"; network failure mid-ceremony → restart from options (ceremonies
 * are single-use); InvalidStateError at registration → success-with-info.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Loader2, KeyRound, ShieldCheck, Smartphone, Mail, AlertCircle } from "lucide-react";

type Factor = "choose" | "totp" | "email";
type EnrollStep = "choose" | "totp-scan" | "totp-verify" | "totp-done" | "email-confirm";

/** §6.5 — map WebAuthn DOMExceptions to low-literacy, retry-safe copy. */
function webauthnErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name ?? "";
  if (name === "NotAllowedError") {
    return "The passkey prompt was closed or timed out. Nothing was saved — try again. If this device has no screen lock, set a PIN in Android Settings first (passkeys need it).";
  }
  if (name === "SecurityError") {
    console.warn("[webauthn.clientError] SecurityError (origin/RP mismatch) — user likely on a non-allowlisted host");
    return "Passkeys only work on the exact site address. Please open the web address your clinic gave you and try again.";
  }
  if (name === "InvalidStateError") {
    return "already-registered"; // handled as success-with-info by the caller
  }
  return "Could not use the passkey. Check your connection and try again.";
}

export default function MfaPage() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") === "enroll" ? "enroll" : "verify";
  const redirectTo = "/dashboard";

  const supportsWebAuthn = browserSupportsWebAuthn();
  const [factor, setFactor] = useState<Factor>("choose");
  const [enrollStep, setEnrollStep] = useState<EnrollStep>("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [serverSecret, setServerSecret] = useState<string | null>(null);
  const [serverQr, setServerQr] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  // status is mfa-pending-allowed and answers { enabled:false } when the
  // feature is off, so the passkey UI hides cleanly (§6.5.1).
  const { data: waStatus } = trpc.webauthn.status.useQuery(undefined, { retry: false });
  const passkeyAvailable = supportsWebAuthn && waStatus?.enabled === true;

  const verifyTotp = trpc.auth.verifyLoginTotp.useMutation({
    onSuccess: () => window.location.assign(redirectTo),
    onError: e => { setBusy(false); setError("That code did not work. Check the code and try again."); console.warn("[mfa] totp verify failed:", e.message); },
  });
  const requestEmailOtp = trpc.auth.requestLoginEmailOtp.useMutation({
    onSuccess: () => { setBusy(false); setEmailSent(true); setInfo("We emailed you a 6-digit sign-in code."); },
    onError: e => { setBusy(false); setError(e.message); },
  });
  const verifyEmailOtp = trpc.auth.verifyLoginEmailOtp.useMutation({
    onSuccess: () => window.location.assign(redirectTo),
    onError: () => { setBusy(false); setError("That code did not work. Check the code and try again."); },
  });
  const authOptions = trpc.webauthn.authenticationOptions.useMutation();
  const verifyAuthn = trpc.webauthn.verifyAuthentication.useMutation();
  const regOptions = trpc.webauthn.registrationOptions.useMutation();
  const verifyReg = trpc.webauthn.verifyRegistration.useMutation();
  const genSecret = trpc.totp.generateSecret.useMutation();
  const totpSetup = trpc.totp.setup.useMutation();
  const totpVerifyEnroll = trpc.totp.verify.useMutation();
  // Wave P26 (O6): first-factor enrollments require an out-of-band email
  // confirmation before the factor activates.
  const finalizeTotp = trpc.mfaConfirm.finalizeTotp.useMutation();
  const resendConfirm = trpc.mfaConfirm.resend.useMutation();
  const [pendingFactor, setPendingFactor] = useState<"totp" | "passkey" | null>(null);

  useEffect(() => { setError(null); setInfo(null); }, [factor, enrollStep]);

  /** §6.5.4 — ceremonies are single-use: ALWAYS restart from options. */
  async function runPasskeyCeremony(): Promise<boolean> {
    try {
      const opts = await authOptions.mutateAsync({ ceremony: "mfa" });
      const assertion = await startAuthentication({ optionsJSON: opts.options as never });
      const res = await verifyAuthn.mutateAsync({ ceremonyId: opts.ceremonyId, response: assertion as unknown as Record<string, unknown> });
      return res.success;
    } catch (err) {
      const msg = webauthnErrorMessage(err);
      if (msg === "already-registered") { setInfo("This device is already registered."); return true; }
      // tRPC errors (ceremony_expired, rate limits) land here too — the copy
      // stays non-destructive and the next click restarts from options.
      setError(msg);
      return false;
    }
  }

  async function onUsePasskey() {
    setBusy(true); setError(null);
    const ok = await runPasskeyCeremony();
    if (ok) window.location.assign(redirectTo);
    else setBusy(false);
  }

  async function onEnrollPasskey() {
    setBusy(true); setError(null);
    try {
      const opts = await regOptions.mutateAsync({});
      const attestation = await startRegistration({ optionsJSON: opts.options as never });
      const reg = await verifyReg.mutateAsync({
        ceremonyId: opts.ceremonyId,
        name: "This device",
        response: attestation as unknown as Record<string, unknown>,
      });
      // Wave P26 (O6): a first-factor passkey stays inert until the emailed
      // confirmation link is clicked.
      if (reg.requiresConfirmation) {
        setPendingFactor("passkey");
        setEnrollStep("email-confirm");
        setInfo(reg.emailSent
          ? "Passkey saved. We emailed you a confirmation link — open it to activate your passkey."
          : "Passkey saved, but we couldn't send the confirmation email. Use the resend button below.");
        setBusy(false);
        return;
      }
      setInfo("Passkey saved. Now unlock it once to finish signing in.");
      const ok = await runPasskeyCeremony(); // upgrade the mfa-pending session
      if (ok) window.location.assign(redirectTo);
      else setBusy(false);
    } catch (err) {
      const msg = webauthnErrorMessage(err);
      if (msg === "already-registered") {
        setInfo("This device is already registered. Unlock it to finish signing in.");
        const ok = await runPasskeyCeremony();
        if (ok) window.location.assign(redirectTo);
        else setBusy(false);
        return;
      }
      setError(msg);
      setBusy(false);
    }
  }

  async function onTotpEnrollStart() {
    setBusy(true);
    try {
      const data = await genSecret.mutateAsync({});
      setServerSecret(data.secret);
      setServerQr(data.qrDataUrl);
      setEnrollStep("totp-scan");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start authenticator setup.");
    } finally {
      setBusy(false);
    }
  }

  async function onTotpEnrollConfirm() {
    if (!serverSecret) return;
    setBusy(true);
    try {
      const data = await totpSetup.mutateAsync({ secret: serverSecret });
      setBackupCodes(data.backupCodes);
      setEnrollStep("totp-verify");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the setup.");
    } finally {
      setBusy(false);
    }
  }

  async function onTotpEnrollVerify() {
    setBusy(true);
    try {
      await totpVerifyEnroll.mutateAsync({ code: totpCode });
      // Wave P26 (O6): a first-factor TOTP stays inert until the emailed
      // confirmation link is clicked; a subsequent one activates immediately.
      const fin = await finalizeTotp.mutateAsync();
      if (fin.status === "confirmation_required") {
        setPendingFactor("totp");
        setEnrollStep("email-confirm");
        setInfo(fin.emailSent
          ? "Authenticator app connected. We emailed you a confirmation link — open it to activate sign-in with your app."
          : "Authenticator app connected, but we couldn't send the confirmation email. Use the resend button below.");
        setTotpCode("");
        setBusy(false);
        return;
      }
      setEnrollStep("totp-done");
      setInfo("Authenticator app connected. Enter a fresh code to finish signing in.");
      setFactor("totp");
      setTotpCode("");
    } catch {
      setError("That code did not work. Check the code and try again.");
    } finally {
      setBusy(false);
    }
  }

  const passkeyBlock = passkeyAvailable ? (
    <Button className="w-full" size="lg" disabled={busy}
      onClick={mode === "verify" ? onUsePasskey : onEnrollPasskey}>
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
      {mode === "verify" ? "Use your passkey" : "Set up a passkey on this device"}
    </Button>
  ) : (
    <Alert>
      <Smartphone className="h-4 w-4" />
      <AlertDescription>
        This device cannot use passkeys. Use the authenticator app option below instead.
      </AlertDescription>
    </Alert>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>{mode === "verify" ? "Two-step verification" : "Set up two-step verification"}</CardTitle>
          <CardDescription>
            {mode === "verify"
              ? "Finish signing in with a second step."
              : "Your account requires a second sign-in step. Choose one below."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {info && (
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertDescription>{info}</AlertDescription>
            </Alert>
          )}

          {mode === "verify" && factor === "choose" && (
            <>
              {passkeyBlock}
              <Separator />
              <div className="space-y-2">
                <Button variant="outline" className="w-full" disabled={busy} onClick={() => setFactor("totp")}>
                  <Smartphone className="mr-2 h-4 w-4" /> Use authenticator app instead
                </Button>
                <Button variant="ghost" className="w-full" disabled={busy}
                  onClick={() => { setFactor("email"); setBusy(true); requestEmailOtp.mutate(); }}>
                  <Mail className="mr-2 h-4 w-4" /> Email me a code
                </Button>
              </div>
            </>
          )}

          {mode === "verify" && factor === "totp" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app (or a backup code).</p>
              <Input inputMode="numeric" autoComplete="one-time-code" placeholder="123456"
                value={totpCode} onChange={e => setTotpCode(e.target.value)} maxLength={16} />
              <Button className="w-full" disabled={busy || totpCode.length < 6}
                onClick={() => { setBusy(true); verifyTotp.mutate({ code: totpCode }); }}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Verify
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setFactor("choose")}>Back</Button>
            </div>
          )}

          {mode === "verify" && factor === "email" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {emailSent ? "Enter the 6-digit code we emailed you." : "Sending your code…"}
              </p>
              <Input inputMode="numeric" autoComplete="one-time-code" placeholder="123456"
                value={emailCode} onChange={e => setEmailCode(e.target.value)} maxLength={6} />
              <Button className="w-full" disabled={busy || emailCode.length !== 6}
                onClick={() => { setBusy(true); verifyEmailOtp.mutate({ code: emailCode }); }}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Verify
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setFactor("choose")}>Back</Button>
            </div>
          )}

          {mode === "enroll" && enrollStep === "choose" && factor !== "totp" && (
            <div className="space-y-2">
              {passkeyBlock}
              <Separator />
              <Button variant="outline" className="w-full" disabled={busy} onClick={onTotpEnrollStart}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Smartphone className="mr-2 h-4 w-4" />}
                Set up an authenticator app instead
              </Button>
            </div>
          )}

          {mode === "enroll" && enrollStep === "totp-scan" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Scan this code with your authenticator app (or type the letters below it).
              </p>
              {serverQr && <img src={serverQr} alt="Authenticator QR code" className="mx-auto h-40 w-40" />}
              <code className="block break-all rounded bg-muted p-2 text-center text-xs">{serverSecret}</code>
              <Button className="w-full" disabled={busy} onClick={onTotpEnrollConfirm}>I saved it — continue</Button>
            </div>
          )}

          {mode === "enroll" && enrollStep === "totp-verify" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Enter the 6-digit code from your app to confirm.</p>
              <Input inputMode="numeric" placeholder="123456" value={totpCode}
                onChange={e => setTotpCode(e.target.value)} maxLength={6} />
              <Button className="w-full" disabled={busy || totpCode.length !== 6} onClick={onTotpEnrollVerify}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Confirm
              </Button>
              {backupCodes.length > 0 && (
                <Alert>
                  <AlertDescription className="text-xs">
                    Backup codes (save these somewhere safe): {backupCodes.join("  ")}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {mode === "enroll" && enrollStep === "email-confirm" && (
            <div className="space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Mail className="h-6 w-6 text-primary" />
              </div>
              <p className="text-center text-sm text-muted-foreground">
                Check your email for a confirmation link. Once you open it, come back here and
                {pendingFactor === "passkey" ? " sign in with your passkey." : " enter a code from your app."}
              </p>
              <Button variant="outline" className="w-full" disabled={busy || !pendingFactor}
                onClick={async () => {
                  if (!pendingFactor) return;
                  setBusy(true); setError(null);
                  try {
                    const r = await resendConfirm.mutateAsync({ factorType: pendingFactor });
                    if (r.status === "no_pending") {
                      setInfo("This sign-in method is already confirmed — continue below.");
                      if (pendingFactor === "totp") { setEnrollStep("totp-done"); setFactor("totp"); }
                      else setEnrollStep("choose");
                    } else {
                      setInfo(r.emailSent ? "Confirmation email resent." : "We still couldn't send the email — try again later.");
                    }
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Could not resend the email.");
                  } finally {
                    setBusy(false);
                  }
                }}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                Resend confirmation email
              </Button>
              <Button variant="ghost" className="w-full" disabled={busy}
                onClick={async () => {
                  // After confirming via email the user continues here.
                  if (pendingFactor === "totp") {
                    setEnrollStep("totp-done"); setFactor("totp");
                    setInfo("Enter a code from your app to finish signing in.");
                  } else {
                    // Passkey: go straight to the unlock ceremony.
                    setInfo(null);
                    await onUsePasskey();
                  }
                }}>
                I confirmed it — continue
              </Button>
            </div>
          )}

          {mode === "enroll" && factor === "totp" && enrollStep === "totp-done" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Enter a fresh code from your app to finish signing in.</p>
              <Input inputMode="numeric" placeholder="123456" value={totpCode}
                onChange={e => setTotpCode(e.target.value)} maxLength={16} />
              <Button className="w-full" disabled={busy || totpCode.length < 6}
                onClick={() => { setBusy(true); verifyTotp.mutate({ code: totpCode }); }}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Finish sign-in
              </Button>
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Having trouble? <a className="underline" href="/login">Start sign-in again</a>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
