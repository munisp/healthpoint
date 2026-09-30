/**
 * /submitter — Phase16-FE third-party-submitter (delegated representative)
 * console. Tabs: Clients, Attestations, Submit, Analytics.
 *
 * Statutory basis surfaced in the UI (matching server/routers/submitter.ts):
 * CMS-9897-F / 45 CFR 149.510(b)(2)(ii)(A)(3) — a third party representing a
 * disputing party must be identified and an attestation of authority must
 * accompany IDR initiation.
 *
 * Backend gating (server): every procedure asserts org_memberships of the
 * caller. Client-side there is no `submitter` org type (ORG_TYPE is
 * provider|biller|payer|idre), so the honest signal is membership: the user
 * picks one of their orgs (orgs.listMine) and the server enforces the rest.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PersonaTour from "@/components/PersonaTour";
import ClientsTab from "./ClientsTab";
import AttestationsTab from "./AttestationsTab";
import SubmitTab from "./SubmitTab";
import AnalyticsTab from "./AnalyticsTab";

/** W7-3 first-run hints (dismissal persisted in localStorage). */
const TOUR_STEPS = [
  { title: "Pick your submitter org", body: "The console scopes every action to one of your organizations; the server re-checks your membership on each call." },
  { title: "Clients", body: "Invite provider orgs to delegate submission authority, and track each delegation link's status." },
  { title: "Attestations", body: "Issue the authority attestation required by 45 CFR 149.510(b)(2)(ii)(A)(3), verify its tamper-evident hash, or revoke it." },
  { title: "Submit & Analytics", body: "Create delegated disputes, ingest 835 remittances to find IDR-eligible lines, and review per-client economics." },
];

export type SubmitterClient = {
  id: string;
  submitterOrgId: string;
  clientOrgId: string | null;
  label: string;
  npis: string[];
  tins: string[];
  status: string;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export default function SubmitterConsole() {
  const { data: myOrgs, isLoading: orgsLoading } = trpc.orgs.listMine.useQuery();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [tab, setTab] = useState("clients");

  // Default to the first org once loaded (controlled select).
  const selectedOrgId = orgId ?? myOrgs?.[0]?.orgId ?? null;
  const clientsQuery = trpc.submitter.listClients.useQuery(
    { submitterOrgId: selectedOrgId! },
    { enabled: !!selectedOrgId },
  );
  const clients = (clientsQuery.data ?? []) as SubmitterClient[];

  return (
    <DashboardLayout>
      <PersonaTour tourId="submitter-console" steps={TOUR_STEPS} />
      <div className="p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Submitter Console</h1>
          <Badge variant="outline">delegated representative</Badge>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Acting as organization</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            {orgsLoading && <p className="text-sm text-muted-foreground">Loading your organizations…</p>}
            {!orgsLoading && !myOrgs?.length && (
              <p className="text-sm text-muted-foreground">
                You do not belong to any organization yet. Create one on the Organizations page first.
              </p>
            )}
            {!!myOrgs?.length && (
              <>
                <label htmlFor="submitter-org" className="text-sm text-muted-foreground">Submitter org</label>
                <select
                  id="submitter-org"
                  aria-label="Submitter organization"
                  className="border rounded px-2 py-1 text-sm bg-background"
                  value={selectedOrgId ?? ""}
                  onChange={e => setOrgId(e.target.value)}
                >
                  {myOrgs.map(o => (
                    <option key={o.orgId} value={o.orgId}>
                      {o.name} ({o.type}, {o.role})
                    </option>
                  ))}
                </select>
                {clientsQuery.isLoading && <span className="text-sm text-muted-foreground">Loading clients…</span>}
                {clientsQuery.isError && (
                  <span role="alert" className="text-sm text-destructive">
                    {clientsQuery.error.message}
                  </span>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {selectedOrgId && (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="Submitter console sections">
              <TabsTrigger value="clients">Clients</TabsTrigger>
              <TabsTrigger value="attestations">Attestations</TabsTrigger>
              <TabsTrigger value="submit">Submit</TabsTrigger>
              <TabsTrigger value="analytics">Analytics</TabsTrigger>
            </TabsList>
            <TabsContent value="clients">
              <ClientsTab submitterOrgId={selectedOrgId} clients={clients} />
            </TabsContent>
            <TabsContent value="attestations">
              <AttestationsTab clients={clients} />
            </TabsContent>
            <TabsContent value="submit">
              <SubmitTab submitterOrgId={selectedOrgId} clients={clients} />
            </TabsContent>
            <TabsContent value="analytics">
              <AnalyticsTab clients={clients} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </DashboardLayout>
  );
}
