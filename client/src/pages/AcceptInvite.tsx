/**
 * /accept-invite?token=... — Phase15-FA (A2): landing page for org/payer
 * email invites issued by orgs.inviteMember / payer.invite.
 *
 * The invite email (server/routers/personas.ts#issueInviteToken) links here.
 * Unlike /unsubscribe/:token, accepting an invite REQUIRES a signed-in
 * session whose account email matches the invite recipient (enforced
 * server-side by orgs.acceptInvite) — so unauthenticated visitors are sent
 * to /login with the token preserved in the redirect target.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { APP_TITLE, APP_LOGO } from "@/const";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, Loader2, Mail, AlertCircle } from "lucide-react";

export default function AcceptInvite() {
  const [, navigate] = useLocation();
  const { user, loading } = useAuth();
  const [token] = useState(() => new URLSearchParams(window.location.search).get("token") ?? "");

  const accept = trpc.orgs.acceptInvite.useMutation({
    onError: () => { /* message rendered below from accept.error */ },
  });

  useEffect(() => {
    // Only attempt acceptance once we know the user is signed in.
    if (!loading && user && token && !accept.isSuccess && !accept.isPending && !accept.isError) {
      accept.mutate({ token });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, token]);

  const loginUrl = `/login?redirectTo=${encodeURIComponent(`/accept-invite?token=${token}`)}`;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="w-full border-b bg-background/80 backdrop-blur px-6 flex items-center h-14">
        <div className="flex items-center gap-2">
          <img src={APP_LOGO} alt={APP_TITLE} className="h-8 w-8 rounded-lg border border-border object-cover" />
          <span className="text-xl font-bold tracking-tight">{APP_TITLE}</span>
        </div>
      </header>

      <main id="main-content" className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" /> Organization invitation
            </CardTitle>
            <CardDescription>
              Accepting binds your signed-in account to the invited organization or payer case.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!token && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>This invite link is missing its token. Please use the exact link from your invitation email.</AlertDescription>
              </Alert>
            )}

            {token && loading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking your session…</p>
            )}

            {token && !loading && !user && (
              <>
                <p className="text-sm text-muted-foreground">
                  Sign in (or register) with the email address the invitation was sent to, then this link will be accepted automatically.
                </p>
                <Button className="w-full" onClick={() => navigate(loginUrl)}>Sign in to accept</Button>
              </>
            )}

            {token && !loading && user && accept.isPending && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Accepting invitation…</p>
            )}

            {accept.isSuccess && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  Invitation accepted{accept.data?.membershipId ? " — you are now a member of the organization" : ""}.
                </AlertDescription>
              </Alert>
            )}

            {accept.isError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{accept.error.message}</AlertDescription>
              </Alert>
            )}

            {(accept.isSuccess || accept.isError) && (
              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => navigate("/orgs")}>Go to Organizations</Button>
                {accept.isError && (
                  <Button variant="outline" onClick={() => accept.reset()}>Try again</Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
