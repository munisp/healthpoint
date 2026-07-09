import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Users, Search, Shield, UserCheck, UserX, RefreshCw, Crown } from "lucide-react";
import EmptyState from "@/components/EmptyState";

export default function AdminUserManagement() {
  const { user: currentUser } = useAuth();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "user">("all");
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [showRoleDialog, setShowRoleDialog] = useState(false);
  const [newRole, setNewRole] = useState<"admin" | "user">("user");

  const { data: usersData, isLoading, refetch } = trpc.admin.listUsers.useQuery({
    search: search || undefined,
    role: roleFilter === "all" ? undefined : roleFilter,
  }, { enabled: currentUser?.role === "admin" });

  const updateRoleMutation = trpc.admin.updateUserRole.useMutation({
    onSuccess: () => {
      toast.success("User role updated successfully");
      setShowRoleDialog(false);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  if (currentUser?.role !== "admin") {
    return (
      <div className="p-6">
        <EmptyState
          variant="disputes"
          title="Access Denied"
          description="You must be an administrator to access this page."
        />
      </div>
    );
  }

  const users = usersData ?? [];

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
          { label: "Admins", value: users.filter(u => u.role === "admin").length, icon: Crown, color: "text-purple-600" },
          { label: "Active (30d)", value: users.filter(u => u.lastSignedIn && new Date(u.lastSignedIn) > new Date(Date.now() - 30 * 86400000)).length, icon: UserCheck, color: "text-green-600" },
          { label: "Inactive", value: users.filter(u => !u.lastSignedIn || new Date(u.lastSignedIn) < new Date(Date.now() - 30 * 86400000)).length, icon: UserX, color: "text-slate-400" },
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
                    {["User", "Email", "Role", "Login Method", "Last Sign In", "Joined", "Actions"].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {users.map((u: any) => (
                    <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                            {u.name?.charAt(0)?.toUpperCase() ?? "?"}
                          </div>
                          <span className="font-medium text-sm">{u.name ?? "—"}</span>
                          {u.id === currentUser?.id && (
                            <Badge variant="outline" className="text-xs">You</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{u.email ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Badge variant={u.role === "admin" ? "default" : "secondary"} className="gap-1">
                          {u.role === "admin" && <Crown className="h-3 w-3" />}
                          {u.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground capitalize">{u.loginMethod ?? "—"}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleDateString() : "Never"}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {u.id !== currentUser?.id && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedUser(u);
                              setNewRole(u.role === "admin" ? "user" : "admin");
                              setShowRoleDialog(true);
                            }}
                          >
                            <Shield className="h-3 w-3 mr-1" />
                            {u.role === "admin" ? "Demote" : "Promote"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Role change dialog */}
      <Dialog open={showRoleDialog} onOpenChange={setShowRoleDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change User Role</DialogTitle>
          </DialogHeader>
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
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowRoleDialog(false)}>Cancel</Button>
            <Button
              className="flex-1"
              onClick={() => updateRoleMutation.mutate({ userId: selectedUser?.id, role: newRole })}
              disabled={updateRoleMutation.isPending}
            >
              {updateRoleMutation.isPending ? "Updating..." : "Confirm"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
