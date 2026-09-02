import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Users, Search, Shield, UserCheck, UserX, RefreshCw, Crown, Ban, CheckCircle2, AlertTriangle } from "lucide-react";
import EmptyState from "@/components/EmptyState";

type ActionType = "role" | "suspend" | "unsuspend";

export default function AdminUserManagement() {
  const { user: currentUser } = useAuth();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "user">("all");
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [actionType, setActionType] = useState<ActionType>("role");
  const [showDialog, setShowDialog] = useState(false);
  const [newRole, setNewRole] = useState<"admin" | "user">("user");
  const [suspendReason, setSuspendReason] = useState("");
  const [suspendUntil, setSuspendUntil] = useState("");

  const { data: usersData, isLoading, refetch } = trpc.admin.listUsers.useQuery({
    search: search || undefined,
    role: roleFilter === "all" ? undefined : roleFilter,
  }, { enabled: currentUser?.role === "admin" });

  const utils = trpc.useUtils();

  const updateRoleMutation = trpc.admin.updateUserRole.useMutation({
    onSuccess: () => {
      toast.success("User role updated successfully");
      setShowDialog(false);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const suspendMutation = trpc.admin.suspendUser.useMutation({
    onSuccess: () => {
      toast.success(`User suspended successfully`);
      setShowDialog(false);
      setSuspendReason("");
      setSuspendUntil("");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const unsuspendMutation = trpc.admin.unsuspendUser.useMutation({
    onSuccess: () => {
      toast.success("User access restored");
      setShowDialog(false);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const openAction = (u: any, type: ActionType) => {
    setSelectedUser(u);
    setActionType(type);
    if (type === "role") setNewRole(u.role === "admin" ? "user" : "admin");
    setSuspendReason("");
    setSuspendUntil("");
    setShowDialog(true);
  };

  const handleConfirm = () => {
    if (!selectedUser) return;
    if (actionType === "role") {
      updateRoleMutation.mutate({ userId: selectedUser.id, role: newRole });
    } else if (actionType === "suspend") {
      suspendMutation.mutate({
        userId: selectedUser.id,
        reason: suspendReason || undefined,
        suspendUntil: suspendUntil ? new Date(suspendUntil).toISOString() : undefined,
      });
    } else {
      unsuspendMutation.mutate({ userId: selectedUser.id });
    }
  };

  const isPending = updateRoleMutation.isPending || suspendMutation.isPending || unsuspendMutation.isPending;

  if (currentUser?.role !== "admin") {
    return (
      <div className="p-6">
        <EmptyState variant="disputes" title="Access Denied" description="You must be an administrator to access this page." />
      </div>
    );
  }

  const users = usersData ?? [];
  const suspendedCount = users.filter((u: any) => u.suspendedAt).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-blue-600" />
            User Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage platform users, roles, and access permissions
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Users", value: users.length, icon: Users, color: "text-blue-600" },
          { label: "Admins", value: users.filter((u: any) => u.role === "admin").length, icon: Crown, color: "text-purple-600" },
          { label: "Active (30d)", value: users.filter((u: any) => u.lastSignedIn && new Date(u.lastSignedIn) > new Date(Date.now() - 30 * 86400000)).length, icon: UserCheck, color: "text-green-600" },
          { label: "Suspended", value: suspendedCount, icon: Ban, color: suspendedCount > 0 ? "text-red-500" : "text-slate-400" },
        ].map(stat => (
          <Card key={stat.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <stat.icon className={`h-8 w-8 ${stat.color}`} />
              <div>
                <div className="text-2xl font-bold">{stat.value}</div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={roleFilter} onValueChange={(v: any) => setRoleFilter(v)}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="user">User</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <EmptyState variant="disputes" title="No users found" description="No users match your current filters." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    {["User", "Email", "Role", "Status", "Last Sign In", "Joined", "Actions"].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {users.map((u: any) => {
                    const isSuspended = !!u.suspendedAt;
                    const suspendedUntilDate = u.suspendedUntil ? new Date(u.suspendedUntil) : null;
                    const isTemporary = suspendedUntilDate && suspendedUntilDate > new Date();
                    return (
                      <tr key={u.id} className={`hover:bg-muted/30 transition-colors ${isSuspended ? "bg-red-50/40 dark:bg-red-950/10" : ""}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold ${isSuspended ? "bg-red-100 text-red-600" : "bg-primary/10 text-primary"}`}>
                              {isSuspended ? <Ban className="h-4 w-4" /> : (u.name?.charAt(0)?.toUpperCase() ?? "?")}
                            </div>
                            <div>
                              <div className="font-medium text-sm flex items-center gap-1">
                                {u.name ?? "—"}
                                {u.id === currentUser?.id && <Badge variant="outline" className="text-xs">You</Badge>}
                              </div>
                              {isSuspended && u.suspendReason && (
                                <div className="text-xs text-red-500 truncate max-w-[160px]" title={u.suspendReason}>
                                  {u.suspendReason}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">{u.email ?? "—"}</td>
                        <td className="px-4 py-3">
                          <Badge variant={u.role === "admin" ? "default" : "secondary"} className="gap-1">
                            {u.role === "admin" && <Crown className="h-3 w-3" />}
                            {u.role}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          {isSuspended ? (
                            <div className="flex flex-col gap-0.5">
                              <Badge variant="destructive" className="gap-1 w-fit text-xs">
                                <Ban className="h-3 w-3" />Suspended
                              </Badge>
                              {isTemporary && (
                                <span className="text-xs text-muted-foreground">
                                  Until {suspendedUntilDate!.toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          ) : (
                            <Badge variant="outline" className="gap-1 text-green-600 border-green-200 bg-green-50 dark:bg-green-950/20 text-xs">
                              <CheckCircle2 className="h-3 w-3" />Active
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleDateString() : "Never"}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {u.id !== currentUser?.id && (
                            <div className="flex items-center gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openAction(u, "role")}
                                className="text-xs"
                              >
                                <Shield className="h-3 w-3 mr-1" />
                                {u.role === "admin" ? "Demote" : "Promote"}
                              </Button>
                              {isSuspended ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openAction(u, "unsuspend")}
                                  className="text-xs text-green-600 border-green-200 hover:bg-green-50"
                                >
                                  <CheckCircle2 className="h-3 w-3 mr-1" />Restore
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openAction(u, "suspend")}
                                  className="text-xs text-red-600 border-red-200 hover:bg-red-50"
                                >
                                  <Ban className="h-3 w-3 mr-1" />Suspend
                                </Button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {actionType === "role" && <><Shield className="h-4 w-4" />Change User Role</>}
              {actionType === "suspend" && <><Ban className="h-4 w-4 text-red-500" />Suspend User</>}
              {actionType === "unsuspend" && <><CheckCircle2 className="h-4 w-4 text-green-500" />Restore User Access</>}
            </DialogTitle>
          </DialogHeader>

          {actionType === "role" && (
            <>
              <p className="text-sm text-muted-foreground">
                Change <strong>{selectedUser?.name}</strong>'s role from{" "}
                <Badge variant="secondary">{selectedUser?.role}</Badge> to{" "}
                <Badge variant={newRole === "admin" ? "default" : "secondary"}>{newRole}</Badge>?
              </p>
              {newRole === "admin" && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded p-2">
                  Admins have full access to all disputes, user management, and system settings.
                </p>
              )}
            </>
          )}

          {actionType === "suspend" && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/20 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-400">
                  <strong>{selectedUser?.name}</strong> will be unable to log in until their access is restored.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="suspend-reason">Reason (optional)</Label>
                <Textarea
                  id="suspend-reason"
                  placeholder="Policy violation, account review, etc."
                  value={suspendReason}
                  onChange={e => setSuspendReason(e.target.value)}
                  rows={2}
                  maxLength={500}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="suspend-until">Suspend Until (optional — leave blank for indefinite)</Label>
                <Input
                  id="suspend-until"
                  type="date"
                  value={suspendUntil}
                  onChange={e => setSuspendUntil(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                />
              </div>
            </div>
          )}

          {actionType === "unsuspend" && (
            <p className="text-sm text-muted-foreground">
              Restore full platform access for <strong>{selectedUser?.name}</strong>? They will be able to log in immediately.
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button
              className={`flex-1 ${actionType === "suspend" ? "bg-red-600 hover:bg-red-700 text-white" : ""}`}
              variant={actionType === "unsuspend" ? "default" : "default"}
              onClick={handleConfirm}
              disabled={isPending}
            >
              {isPending ? "Processing..." : actionType === "role" ? "Confirm" : actionType === "suspend" ? "Suspend User" : "Restore Access"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
