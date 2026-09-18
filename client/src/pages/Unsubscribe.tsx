/**
 * /unsubscribe/:token — W7-5 public one-click unsubscribe page.
 *
 * The token arrives in digest emails (server/scheduled/emailDigest.ts) and
 * identifies the recipient's email_digest_preferences row. No login needed —
 * the unguessable token is the credential. Confirming calls
 * unsubscribe.confirm, which sets digestFrequency='never'; the digest
 * scheduler already honors 'never'. The page never displays the recipient's
 * email address (the server deliberately does not return it).
 */
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { APP_TITLE, APP_LOGO } from "@/const";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, Loader2, MailX, AlertCircle } from "lucide-react";

export default function Unsubscribe() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";

  const info = trpc.unsubscribe.getInfo.useQuery(
    { token },
    { enabled: token.length >= 16, retry: false }
  );
  const confirm = trpc.unsubscribe.confirm.useMutation();

  const done = confirm.isSuccess || info.data?.alreadyUnsubscribed;

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
                {done ? (
                  <CheckCircle2 className="h-6 w-6 text-primary" aria-hidden="true" />
                ) : (
                  <MailX className="h-6 w-6 text-primary" aria-hidden="true" />
                )}
              </div>
            </div>
            <CardTitle className="text-xl">
              {done ? "You're unsubscribed" : "Unsubscribe from digest emails"}
            </CardTitle>
            <CardDescription className="text-sm">
              {done
                ? "You will no longer receive daily or weekly IDR digest emails. Transactional notifications (determinations, deadline alerts) are unaffected."
                : "This stops all daily/weekly IDR digest emails for this recipient."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {token.length < 16 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>This unsubscribe link is malformed.</AlertDescription>
              </Alert>
            )}
            {info.isLoading && (
              <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking your link…
              </p>
            )}
            {info.isError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  This unsubscribe link is invalid or has expired. You can also manage email
                  preferences from your account settings.
                </AlertDescription>
              </Alert>
            )}
            {confirm.isError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{confirm.error.message}</AlertDescription>
              </Alert>
            )}
            {info.isSuccess && !done && (
              <Button
                className="w-full"
                size="lg"
                disabled={confirm.isPending}
                onClick={() => confirm.mutate({ token })}
              >
                {confirm.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Unsubscribing…
                  </>
                ) : (
                  "Confirm unsubscribe"
                )}
              </Button>
            )}
            <p className="text-center text-xs text-muted-foreground">
              Changed your mind? Sign in and re-enable digests under Settings → Email preferences.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
