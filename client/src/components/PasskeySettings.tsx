/**
 * PasskeySettings.tsx — Phase 25 (design §6.3, §6.5)
 *
 * "Passkeys" card rendered above the TOTP section in TwoFactorAuth.tsx:
 * list (webauthn.listCredentials), register (registrationOptions →
 * startRegistration → verifyRegistration), inline rename, and delete with
 * the §3.6 step-up dialog — a TOTP code when the user has TOTP, otherwise a
 * fresh passkey touch (x-webauthn-stepup ceremony header).
 *
 * The whole card hides when status.enabled === false (feature gate) or the
 * browser lacks WebAuthn (§6.5.1: never show a dead button).
 */
import { useState } from "react";
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { KeyRound, Loader2, Pencil, Trash2, Check, X } from "lucide-react";

export default function PasskeySettings() {
  const utils = trpc.useUtils();
  const { data: status, isLoading } = trpc.webauthn.status.useQuery(undefined, { retry: false });
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTotpCode, setDeleteTotpCode] = useState("");

  const regOptions = trpc.webauthn.registrationOptions.useMutation();
  const verifyReg = trpc.webauthn.verifyRegistration.useMutation();
  const authOptions = trpc.webauthn.authenticationOptions.useMutation();
  const verifyAuthn = trpc.webauthn.verifyAuthentication.useMutation();
  // Wave P26 (O6): resend the first-factor confirmation email.
  const resendConfirm = trpc.mfaConfirm.resend.useMutation({
    onSuccess: r => {
      if (r.status === "sent") toast.success(r.emailSent ? "Confirmation email resent" : "Could not send the email — try again later");
      else { toast.success("Passkey already confirmed"); utils.webauthn.status.invalidate(); utils.webauthn.listCredentials.invalidate(); }
    },
    onError: e => toast.error(e.message),
  });
  const rename = trpc.webauthn.renameCredential.useMutation({
    onSuccess: () => {
      utils.webauthn.status.invalidate();
      utils.webauthn.listCredentials.invalidate();
      setEditingId(null);
      toast.success("Passkey renamed");
    },
    onError: e => toast.error(e.message),
  });
  const del = trpc.webauthn.deleteCredential.useMutation({
    onSuccess: () => {
      utils.webauthn.status.invalidate();
      utils.webauthn.listCredentials.invalidate();
      setDeletingId(null);
      setDeleteTotpCode("");
      toast.success("Passkey removed");
    },
    onError: e => {
      setBusy(false);
      if (e.message.includes("cannot_remove_last_mfa_method")) {
        toast.error("This is your only second sign-in step and your organization requires one. Add another passkey or an authenticator app first.");
      } else if (e.message.includes("stepup_required")) {
        toast.error("Use one of your other passkeys first to confirm it is really you.");
      } else {
        toast.error(e.message);
      }
    },
  });

  async function onRegister() {
    setBusy(true);
    try {
      const opts = await regOptions.mutateAsync({});
      const attestation = await startRegistration({ optionsJSON: opts.options as never });
      const reg = await verifyReg.mutateAsync({
        ceremonyId: opts.ceremonyId,
        response: attestation as unknown as Record<string, unknown>,
      });
      utils.webauthn.status.invalidate();
      utils.webauthn.listCredentials.invalidate();
      // Wave P26 (O6): first-factor passkeys activate only after the emailed
      // confirmation link is clicked.
      if (reg.requiresConfirmation) {
        toast.success(reg.emailSent
          ? "Passkey saved — check your email to confirm it before it works"
          : "Passkey saved, but the confirmation email failed — use Resend below");
      } else {
        toast.success("Passkey added to this device");
      }
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "";
      if (name === "InvalidStateError") toast.info("This device is already registered");
      else if (name === "NotAllowedError") toast.error("The passkey prompt was closed or timed out — nothing was saved. Try again.");
      else if (name === "SecurityError") {
        console.warn("[webauthn.clientError] SecurityError at registration (non-allowlisted host)");
        toast.error("Passkeys only work on the exact site address your clinic gave you.");
      } else toast.error(err instanceof Error ? err.message : "Could not add the passkey");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteConfirm(id: string, hasTotp: boolean) {
    setBusy(true);
    try {
      if (hasTotp) {
        await del.mutateAsync({ credentialId: id, totpCode: deleteTotpCode });
      } else {
        // Passkey-only step-up (§3.6): prove possession of any remaining
        // passkey via a fresh mfa-mode ceremony, carried as
        // stepupCeremonyId (the tRPC hooks cannot set per-call headers; the
        // server also accepts the canonical x-webauthn-stepup header).
        const opts = await authOptions.mutateAsync({ ceremony: "mfa" });
        const assertion = await startAuthentication({ optionsJSON: opts.options as never });
        await verifyAuthn.mutateAsync({ ceremonyId: opts.ceremonyId, response: assertion as unknown as Record<string, unknown> });
        await del.mutateAsync({ credentialId: id, stepupCeremonyId: opts.ceremonyId });
      }
    } catch (err) {
      // del.mutateAsync's onError already toasted for server errors.
      if (!(err instanceof Error && "data" in err)) {
        const name = (err as { name?: string })?.name ?? "";
        if (name === "NotAllowedError") toast.error("The passkey prompt was closed — nothing was deleted.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return null;
  if (!status?.enabled) return null;               // feature gate off → hide
  if (!browserSupportsWebAuthn()) return null;     // §6.5.1 — no dead buttons

  const creds = status.credentials;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" /> Passkeys
        </CardTitle>
        <CardDescription>
          Sign in with this device's fingerprint, face or screen lock. Passkeys cannot be phished.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {creds.length === 0 && (
          <p className="text-sm text-muted-foreground">No passkeys yet. Add one to sign in faster and more safely.</p>
        )}
        {creds.map(c => (
          <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
            {editingId === c.id ? (
              <div className="flex flex-1 items-center gap-2">
                <Input value={editingName} onChange={e => setEditingName(e.target.value)} maxLength={128} />
                <Button size="icon" variant="ghost" disabled={rename.isPending || !editingName.trim()}
                  onClick={() => rename.mutate({ credentialId: c.id, name: editingName.trim() })}>
                  <Check className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}><X className="h-4 w-4" /></Button>
              </div>
            ) : (
              <>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.deviceType === "multiDevice" ? "Synced passkey" : "This device"}
                    {c.lastUsedAt ? ` · last used ${new Date(c.lastUsedAt).toLocaleDateString()}` : " · never used"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {c.backedUp && <Badge variant="secondary">backed up</Badge>}
                  {/* Wave P26 (O6): pending first-factor confirmation */}
                  {!c.confirmed && (
                    <>
                      <Badge variant="outline" className="border-amber-300 text-amber-700">pending email confirmation</Badge>
                      <Button size="sm" variant="ghost" className="text-xs"
                        disabled={resendConfirm.isPending}
                        onClick={() => resendConfirm.mutate({ factorType: "passkey" })}>
                        Resend
                      </Button>
                    </>
                  )}
                  <Button size="icon" variant="ghost"
                    onClick={() => { setEditingId(c.id); setEditingName(c.name); }}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost"
                    onClick={() => { setDeletingId(deletingId === c.id ? null : c.id); setDeleteTotpCode(""); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </div>
        ))}

        {deletingId && (
          <div className="space-y-2 rounded-md border border-destructive/40 p-3">
            <p className="text-sm font-medium">Remove this passkey?</p>
            {status.hasTotp ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Confirm with a code from your authenticator app.
                </p>
                <Input inputMode="numeric" placeholder="123456" value={deleteTotpCode}
                  onChange={e => setDeleteTotpCode(e.target.value)} maxLength={16} />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                You will be asked to unlock one of your passkeys to confirm it is really you.
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="destructive" size="sm"
                disabled={busy || (status.hasTotp && deleteTotpCode.length < 6)}
                onClick={() => onDeleteConfirm(deletingId, status.hasTotp)}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Remove
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDeletingId(null)}>Cancel</Button>
            </div>
          </div>
        )}

        <Button onClick={onRegister} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
          Add a passkey on this device
        </Button>
      </CardContent>
    </Card>
  );
}
