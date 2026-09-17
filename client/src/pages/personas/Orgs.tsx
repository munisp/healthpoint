/**
 * /orgs — organization switcher + membership management (v1).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function Orgs() {
  const utils = trpc.useUtils();
  const { data: mine, isLoading } = trpc.orgs.listMine.useQuery();
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<"provider" | "biller" | "payer" | "idre">("provider");
  const [memberUserId, setMemberUserId] = useState("");
  const members = trpc.orgs.listMembers.useQuery({ orgId: selectedOrg! }, { enabled: !!selectedOrg });
  const orgDisputes = trpc.orgs.listDisputes.useQuery({ orgId: selectedOrg! }, { enabled: !!selectedOrg });

  const invalidate = () => {
    utils.orgs.listMine.invalidate();
    if (selectedOrg) {
      utils.orgs.listMembers.invalidate({ orgId: selectedOrg });
      utils.orgs.listDisputes.invalidate({ orgId: selectedOrg });
    }
  };
  const create = trpc.orgs.create.useMutation({
    onSuccess: r => { toast.success("Organization created"); setSelectedOrg(r.orgId); invalidate(); },
    onError: e => toast.error(e.message),
  });
  const addMember = trpc.orgs.addMember.useMutation({
    onSuccess: () => { toast.success("Member added"); invalidate(); },
    onError: e => toast.error(e.message),
  });
  const switchCtx = trpc.orgs.switchContext.useMutation({
    onSuccess: r => toast.success(`Context switched to ${r.orgName} (${r.role})`),
    onError: e => toast.error(e.message),
  });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Organizations</h1>

        <Card>
          <CardHeader><CardTitle className="text-base">Create organization</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2 items-center">
            <Input className="w-64" placeholder="Organization name" value={name} onChange={e => setName(e.target.value)} />
            <select className="border rounded px-2 py-1 text-sm bg-background" value={type} onChange={e => setType(e.target.value as typeof type)}>
              {["provider", "biller", "payer", "idre"].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <Button size="sm" disabled={create.isPending || !name.trim()} onClick={() => create.mutate({ name, type })}>Create</Button>
          </CardContent>
        </Card>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {mine?.map(o => (
          <Card key={o.orgId} className={selectedOrg === o.orgId ? "border-primary" : ""}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {o.name}
                <Badge variant="outline">{o.type}</Badge>
                <Badge variant="secondary">{o.role}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setSelectedOrg(o.orgId)}>Manage</Button>
                <Button size="sm" variant="secondary" onClick={() => switchCtx.mutate({ orgId: o.orgId })}>Switch context</Button>
              </div>
              {selectedOrg === o.orgId && (
                <div className="space-y-3 border rounded p-3">
                  <div>
                    <p className="text-sm font-medium mb-1">Members</p>
                    <ul className="text-sm space-y-1">
                      {members.data?.map(m => <li key={m.id}>{m.userId} — <Badge variant="outline">{m.role}</Badge></li>)}
                    </ul>
                    <div className="flex gap-2 mt-2">
                      <Input className="w-64" placeholder="user id to add" value={memberUserId} onChange={e => setMemberUserId(e.target.value)} />
                      <Button size="sm" disabled={addMember.isPending || !memberUserId.trim()}
                        onClick={() => addMember.mutate({ orgId: o.orgId, userId: memberUserId, role: "staff" })}>Add member</Button>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-1">Org disputes</p>
                    <ul className="text-sm space-y-1">
                      {orgDisputes.data?.map(d => (
                        <li key={d.id}>{d.referenceNumber} — <Badge variant="outline">{d.status}</Badge> billed ${d.billedAmount}</li>
                      ))}
                      {orgDisputes.data?.length === 0 && <li className="text-muted-foreground">No disputes created by org members.</li>}
                    </ul>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </DashboardLayout>
  );
}
