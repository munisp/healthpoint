/**
 * /audit-share/:token — auditfix-b public read-only shared audit report.
 *
 * The token arrives in share links created on the practice-audit Report tab
 * (practiceAudit.createAuditShareToken). No login needed — the unguessable
 * token is the credential. Data comes from practiceAudit.resolveAuditShareToken
 * (publicProcedure): an aggregate verdict scorecard only. The server's note
 * (deterministic eligibility verdicts, not outcome assurances) is shown
 * verbatim. Invalid/expired/revoked tokens surface the server error.
 */
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { APP_TITLE, APP_LOGO } from "@/const";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, AlertCircle } from "lucide-react";

const VERDICT_LABELS: Record<string, string> = {
  QUALIFIES: "Qualifies for federal IDR",
  BLOCKED: "Blocked (ineligible)",
  NEEDS_REVIEW: "Needs review (missing fields)",
  UNSCORED: "Not yet scored",
};

export default function AuditShareLanding() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";

  const q = trpc.practiceAudit.resolveAuditShareToken.useQuery(
    { token },
    { enabled: token.length > 0, retry: false },
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="w-full border-b bg-background/80 backdrop-blur px-6 flex items-center h-14">
        <div className="flex items-center gap-2">
          <img src={APP_LOGO} alt={APP_TITLE} className="h-8 w-8 rounded-lg border border-border object-cover" />
          <span className="text-xl font-bold tracking-tight">{APP_TITLE}</span>
        </div>
        <Badge variant="outline" className="ml-auto">Read-only shared report</Badge>
      </header>

      <main id="main-content" className="flex-1 flex items-start justify-center p-6">
        <Card className="w-full max-w-2xl shadow-lg border-border/60">
          <CardHeader className="pb-4">
            <div className="flex justify-center mb-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                {q.isError ? (
                  <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="h-6 w-6 text-primary" aria-hidden="true" />
                )}
              </div>
            </div>
            <CardTitle className="text-xl text-center">
              Shared practice audit report{q.data?.label ? ` — ${q.data.label}` : ""}
            </CardTitle>
            <CardDescription className="text-sm text-center">
              {q.data?.organizationName
                ? `Organization: ${q.data.organizationName}`
                : "Aggregate eligibility scorecard shared by the practice."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {q.isLoading && (
              <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading shared report…
              </p>
            )}
            {q.isError && (
              <p role="alert" className="text-sm text-destructive text-center">
                {q.error.message}. The link may have expired or been revoked — ask the sender for a new one.
              </p>
            )}
            {q.data && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  {(Object.keys(VERDICT_LABELS) as Array<keyof typeof q.data.report.verdicts>).map(k => (
                    <div key={k} className="border rounded p-3 text-center">
                      <p className="text-2xl font-semibold">{q.data.report.verdicts[k]}</p>
                      <p className="text-xs text-muted-foreground">{VERDICT_LABELS[k]}</p>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-center">
                  Total claims audited: <b>{q.data.report.totalClaims}</b> · qualifying:{" "}
                  <b>{q.data.report.qualifyingClaims}</b>
                </p>
                <p className="text-xs text-muted-foreground">
                  Report generated {new Date(q.data.report.generatedAt).toLocaleString()}.
                </p>
                <p className="text-xs text-muted-foreground border rounded p-2">{q.data.note}</p>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
