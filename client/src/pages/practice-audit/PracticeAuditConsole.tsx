/**
 * /practice-audit — Phase 17-FE practice audit console.
 * Tabs: Ingest (connect EHR / bulk export / 837 & ndjson upload), Claims
 * (scored claims with verdict badges, rules+CFR citations, completeness),
 * Report (three-lane retrospective classification + scorecard header).
 *
 * Backend: trpc.practiceAudit (server/routers/practice-audit.ts). Verdicts
 * are deterministic RULE VERDICTS with CFR citations — never guarantees of
 * IDR outcome. Any probability shown is labeled "statistical estimate".
 * Lane assignment is CLIENT-COMPUTED (see shared.ts).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PersonaTour from "@/components/PersonaTour";
import IngestTab from "./IngestTab";
import ClaimsTab from "./ClaimsTab";
import ReportTab from "./ReportTab";

const TOUR_STEPS = [
  { title: "Pick your organization", body: "Every audit action is scoped to one of your organizations; the server re-checks membership on each call." },
  { title: "Ingest", body: "Connect an EHR (vendor profile templates are STATIC-ONLY until a live test succeeds) or upload X12 837 / FHIR bulk $export ndjson to stage claims." },
  { title: "Claims", body: "Score staged claims with the deterministic eligibility engine: QUALIFIES / BLOCKED / NEEDS_REVIEW with CFR citations and missing-field checklists." },
  { title: "Report", body: "Three-lane retrospective classification (actionable / time-barred-for-IDR / intelligence). Lanes are client-computed from dates and labeled as such; recovery figures are statistical estimates, not promises." },
];

export default function PracticeAuditConsole() {
  const { data: myOrgs, isLoading: orgsLoading } = trpc.orgs.listMine.useQuery();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [tab, setTab] = useState("ingest");
  const selectedOrgId = orgId ?? myOrgs?.[0]?.orgId ?? null;

  return (
    <DashboardLayout>
      <PersonaTour tourId="practice-audit-console" steps={TOUR_STEPS} />
      <div className="p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Practice Audit Console</h1>
          <Badge variant="outline">retrospective NSA eligibility audit</Badge>
          <Badge variant="outline" className="text-amber-700 border-amber-300">
            verdicts are rule-based — never outcome guarantees
          </Badge>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Auditing organization</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            {orgsLoading && <p className="text-sm text-muted-foreground">Loading your organizations…</p>}
            {!orgsLoading && !myOrgs?.length && (
              <p className="text-sm text-muted-foreground">
                You do not belong to any organization yet. Create one on the Organizations page first.
              </p>
            )}
            {!!myOrgs?.length && (
              <>
                <label htmlFor="practice-audit-org" className="text-sm text-muted-foreground">Organization</label>
                <select
                  id="practice-audit-org"
                  className="border rounded px-2 py-1 text-sm bg-background"
                  value={selectedOrgId ?? ""}
                  onChange={e => setOrgId(e.target.value)}
                >
                  {myOrgs.map(o => (
                    <option key={o.orgId} value={o.orgId}>{o.name} ({o.type}, {o.role})</option>
                  ))}
                </select>
              </>
            )}
          </CardContent>
        </Card>

        {selectedOrgId && (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="ingest">Ingest</TabsTrigger>
              <TabsTrigger value="claims">Claims</TabsTrigger>
              <TabsTrigger value="report">Report</TabsTrigger>
            </TabsList>
            <TabsContent value="ingest"><IngestTab orgId={selectedOrgId} /></TabsContent>
            <TabsContent value="claims"><ClaimsTab orgId={selectedOrgId} /></TabsContent>
            <TabsContent value="report"><ReportTab orgId={selectedOrgId} /></TabsContent>
          </Tabs>
        )}
      </div>
    </DashboardLayout>
  );
}
