/**
 * /orgs — organization switcher + membership management (v1).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import PersonaTour from "@/components/PersonaTour";

/** W7-3 first-run hints (dismissal persisted in localStorage). */
const TOUR_STEPS = [
  { title: "Organizations", body: "Create an organization to collaborate on disputes as a provider group, biller, payer, or IDRE." },
  { title: "Members & context", body: "Open Manage to add teammates by user id, and use Switch context to scope your work to that org." },
  { title: "White-label branding", body: "Owners can set a brand name, logo URL, and primary color — applied to the app header and the /login?org=<id> page." },
];

export default function Orgs() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
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

  // Phase15-FA (A2): invite by email + admin org suspension, previously
  // journey/test-only procedures with no UI.
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"staff" | "viewer">("staff");
  const [inviteResult, setInviteResult] = useState<{ emailStatus: string; existingUser: boolean } | null>(null);
  const inviteMember = trpc.orgs.inviteMember.useMutation({
    onSuccess: r => {
      setInviteResult({ emailStatus: r.inviteEmailStatus, existingUser: r.existingUser });
      if (r.inviteEmailStatus === "delivered") {
        toast.success("Invite email sent — the recipient accepts via the emailed link");
      } else {
        toast.warning(`Invite recorded, but the email was not delivered (status: ${r.inviteEmailStatus}). Ask the recipient to sign in and accept from their notifications.`);
      }
      setInviteEmail("");
    },
    onError: e => toast.error(e.message),
  });

  const [suspendDialog, setSuspendDialog] = useState<{ orgId: string; orgName: string; action: "suspend" | "unsuspend" } | null>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const suspendOrg = trpc.orgs.suspendOrg.useMutation({
    onSuccess: r => {
      toast.success(r.alreadySuspended ? "Organization was already suspended" : "Organization suspended — member mutations are now blocked");
      setSuspendDialog(null); setSuspendReason(""); invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const unsuspendOrg = trpc.orgs.unsuspendOrg.useMutation({
    onSuccess: r => {
      toast.success(r.alreadyActive ? "Organization was already active" : "Organization reinstated");
      setSuspendDialog(null); setSuspendReason(""); invalidate();
    },
    onError: e => toast.error(e.message),
  });

  // W7-4 white-label branding editor state (per selected org)
  const branding = trpc.orgs.getBranding.useQuery({ orgId: selectedOrg! }, { enabled: !!selectedOrg });
  const [brandName, setBrandName] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState<string | null>(null);
  const updateBranding = trpc.orgs.updateBranding.useMutation({
    onSuccess: () => { toast.success("Branding saved — applied to header and login page"); branding.refetch(); utils.orgs.myBranding.invalidate(); },
    onError: e => toast.error(e.message),
  });

  return (
    <DashboardLayout>
      <PersonaTour tourId="orgs" steps={TOUR_STEPS} />
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Organizations</h1>

        <Card>
          <CardHeader><CardTitle className="text-base">Create organization</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2 items-center">
            <Input className="w-64" aria-label="Organization name" placeholder="Organization name" value={name} onChange={e => setName(e.target.value)} />
            <select aria-label="Organization type" className="border rounded px-2 py-1 text-sm bg-background" value={type} onChange={e => setType(e.target.value as typeof type)}>
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
                {o.status === "suspended" && <Badge variant="destructive">suspended</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setSelectedOrg(o.orgId)}>Manage</Button>
                <Button size="sm" variant="secondary" onClick={() => switchCtx.mutate({ orgId: o.orgId })}>Switch context</Button>
                {isAdmin && (o.status === "suspended" ? (
                  <Button size="sm" variant="outline" className="text-green-700 border-green-300"
                    onClick={() => { setSuspendDialog({ orgId: o.orgId, orgName: o.name, action: "unsuspend" }); setSuspendReason(""); }}>
                    Reinstate org
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="text-red-700 border-red-300"
                    onClick={() => { setSuspendDialog({ orgId: o.orgId, orgName: o.name, action: "suspend" }); setSuspendReason(""); }}>
                    Suspend org
                  </Button>
                ))}
              </div>
              {selectedOrg === o.orgId && (
                <div className="space-y-3 border rounded p-3">
                  <div>
                    <p className="text-sm font-medium mb-1">Members</p>
                    <ul className="text-sm space-y-1">
                      {members.data?.map(m => <li key={m.id}>{m.userId} — <Badge variant="outline">{m.role}</Badge></li>)}
                    </ul>
                    <div className="flex gap-2 mt-2">
                      <Input className="w-64" aria-label="User id to add as member" placeholder="user id to add" value={memberUserId} onChange={e => setMemberUserId(e.target.value)} />
                      <Button size="sm" disabled={addMember.isPending || !memberUserId.trim()}
                        onClick={() => addMember.mutate({ orgId: o.orgId, userId: memberUserId, role: "staff" })}>Add member</Button>
                    </div>
                    {/* Phase15-FA (A2): invite by email (owners only, enforced server-side) */}
                    <div className="flex flex-wrap gap-2 mt-2 items-center">
                      <Input className="w-64" type="email" aria-label="Email address to invite" placeholder="invite by email" value={inviteEmail} onChange={e => { setInviteEmail(e.target.value); setInviteResult(null); }} />
                      <select aria-label="Invite role" className="border rounded px-2 py-1 text-sm bg-background" value={inviteRole} onChange={e => setInviteRole(e.target.value as typeof inviteRole)}>
                        <option value="staff">staff</option>
                        <option value="viewer">viewer</option>
                      </select>
                      <Button size="sm" variant="secondary" disabled={inviteMember.isPending || !inviteEmail.trim()}
                        onClick={() => inviteMember.mutate({ orgId: o.orgId, email: inviteEmail.trim(), role: inviteRole })}>Send invite</Button>
                    </div>
                    {inviteResult && (
                      <p className="text-xs text-muted-foreground">
                        Invite recorded — email delivery: <Badge variant={inviteResult.emailStatus === "delivered" ? "secondary" : "destructive"}>{inviteResult.emailStatus}</Badge>
                        {inviteResult.existingUser ? " Recipient already has a platform account." : " Recipient will need to register with this email address, then open the accept link."}
                      </p>
                    )}
                  </div>
                  {/* W7-4: white-label branding (owners/admins; server enforces) */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium mb-1">Branding (white-label)</p>
                    <div className="flex flex-wrap gap-2 items-center">
                      <label className="text-xs text-muted-foreground w-full sm:w-auto">
                        Brand name
                        <Input
                          className="w-56 mt-1"
                          aria-label="Brand name"
                          placeholder={branding.data?.orgName ?? "Brand name"}
                          value={brandName ?? branding.data?.brandName ?? ""}
                          onChange={e => setBrandName(e.target.value)}
                        />
                      </label>
                      <label className="text-xs text-muted-foreground w-full sm:w-auto">
                        Logo URL
                        <Input
                          className="w-64 mt-1"
                          aria-label="Logo URL"
                          placeholder="https://example.com/logo.png"
                          value={logoUrl ?? branding.data?.logoUrl ?? ""}
                          onChange={e => setLogoUrl(e.target.value)}
                        />
                      </label>
                      <label className="text-xs text-muted-foreground">
                        Primary color
                        <Input
                          className="w-28 mt-1"
                          aria-label="Primary color as hex, for example #0e6e5d"
                          placeholder="#0e6e5d"
                          value={primaryColor ?? branding.data?.primaryColor ?? ""}
                          onChange={e => setPrimaryColor(e.target.value)}
                        />
                      </label>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="self-end"
                        disabled={updateBranding.isPending}
                        onClick={() => updateBranding.mutate({
                          orgId: o.orgId,
                          brandName: (brandName ?? branding.data?.brandName ?? "") || null,
                          logoUrl: (logoUrl ?? branding.data?.logoUrl ?? "") || null,
                          primaryColor: (primaryColor ?? branding.data?.primaryColor ?? "") || null,
                        })}
                      >Save branding</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Applied to the app header and to <code>/login?org={o.orgId}</code>. Leave a field empty to use the platform default.
                    </p>
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

        {/* Phase15-FA (A2): admin suspend/reinstate dialog — reason >= 10 chars, audit-logged server-side */}
        <Dialog open={!!suspendDialog} onOpenChange={() => setSuspendDialog(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{suspendDialog?.action === "suspend" ? "Suspend organization" : "Reinstate organization"}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {suspendDialog?.action === "suspend"
                ? <>Suspending <strong>{suspendDialog?.orgName}</strong> blocks all org-scoped member mutations (invites, member adds, branding changes). Reads stay available. This is recorded in the audit log.</>
                : <>Reinstating <strong>{suspendDialog?.orgName}</strong> restores org-scoped member mutations. This is recorded in the audit log.</>}
            </p>
            <div className="space-y-1 mt-2">
              <Label>Reason (min 10 characters, recorded in the audit log)</Label>
              <Textarea value={suspendReason} onChange={e => setSuspendReason(e.target.value)} rows={3} maxLength={1000} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setSuspendDialog(null)}>Cancel</Button>
              <Button
                className={`flex-1 ${suspendDialog?.action === "suspend" ? "bg-red-600 hover:bg-red-700 text-white" : ""}`}
                disabled={suspendReason.trim().length < 10 || suspendOrg.isPending || unsuspendOrg.isPending}
                onClick={() => suspendDialog && (suspendDialog.action === "suspend"
                  ? suspendOrg.mutate({ orgId: suspendDialog.orgId, reason: suspendReason.trim() })
                  : unsuspendOrg.mutate({ orgId: suspendDialog.orgId, reason: suspendReason.trim() }))}
              >
                {suspendOrg.isPending || unsuspendOrg.isPending ? "Processing…" : suspendDialog?.action === "suspend" ? "Suspend" : "Reinstate"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
