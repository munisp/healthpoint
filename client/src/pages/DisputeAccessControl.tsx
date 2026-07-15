import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Lock, UserPlus, Trash2, RefreshCw, Shield } from "lucide-react";

const PERMISSION_COLORS: Record<string, string> = {
  read: "bg-blue-100 text-blue-800 border-blue-200",
  write: "bg-amber-100 text-amber-800 border-amber-200",
  admin: "bg-red-100 text-red-800 border-red-200",
};

export default function DisputeAccessControl() {
  const [disputeId, setDisputeId] = useState("");
  const [inputId, setInputId] = useState("");
  const [grantUserId, setGrantUserId] = useState("");
  const [grantPermission, setGrantPermission] = useState<"read" | "write" | "admin">("read");

  const { data: accessList = [], refetch, isLoading } = trpc.authz.listAccess.useQuery(
    { disputeId },
    { enabled: !!disputeId }
  );

  const grantMutation = trpc.authz.grantAccess.useMutation({
    onSuccess: () => {
      toast.success(`Access granted: ${grantPermission} for user ${grantUserId}`);
      setGrantUserId("");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const revokeMutation = trpc.authz.revokeAccess.useMutation({
    onSuccess: () => {
      toast.success("Access revoked.");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Lock className="h-6 w-6 text-slate-700" />
            Dispute Access Control
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage per-dispute access grants — control who can read, write, or administer each dispute
          </p>
        </div>

        {/* Dispute Selector */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Select Dispute</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 items-end">
              <div className="flex-1 max-w-md">
                <Label className="text-xs">Dispute ID</Label>
                <Input
                  placeholder="disp_..."
                  value={inputId}
                  onChange={e => setInputId(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && setDisputeId(inputId)}
                />
              </div>
              <Button onClick={() => { setDisputeId(inputId); refetch(); }}>
                <RefreshCw className="h-4 w-4 mr-1" /> Load Access List
              </Button>
            </div>
          </CardContent>
        </Card>

        {disputeId && (
          <>
            {/* Grant Access */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <UserPlus className="h-4 w-4" /> Grant Access
                </CardTitle>
                <CardDescription>Add a user to this dispute with a specific permission level</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-3 items-end flex-wrap">
                  <div className="flex-1 min-w-48">
                    <Label className="text-xs">User ID</Label>
                    <Input
                      placeholder="user_..."
                      value={grantUserId}
                      onChange={e => setGrantUserId(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Permission</Label>
                    <Select value={grantPermission} onValueChange={v => setGrantPermission(v as "read" | "write" | "admin")}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="read">Read</SelectItem>
                        <SelectItem value="write">Write</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={() => grantMutation.mutate({ disputeId, userId: grantUserId, permission: grantPermission })}
                    disabled={!grantUserId || grantMutation.isPending}
                  >
                    <UserPlus className="h-4 w-4 mr-1" />
                    {grantMutation.isPending ? "Granting..." : "Grant Access"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Access List */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4" /> Current Access List
                </CardTitle>
                <CardDescription>
                  {isLoading ? "Loading..." : `${accessList.length} user${accessList.length !== 1 ? "s" : ""} with access to dispute ${disputeId}`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading access list...</div>
                ) : accessList.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">
                    <Lock className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p>No additional access grants for this dispute.</p>
                    <p className="text-xs">The dispute owner and admins always have full access.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {accessList.map((entry: { userId: string; permission: string; grantedAt?: Date | null; grantedBy?: string | null }) => (
                      <div key={entry.userId} className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm">{entry.userId}</span>
                            <Badge className={`text-xs border ${PERMISSION_COLORS[entry.permission] ?? "bg-slate-100 text-slate-700"}`}>
                              {entry.permission}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Granted {entry.grantedAt ? new Date(entry.grantedAt).toLocaleString() : "—"}
                            {entry.grantedBy && ` by ${entry.grantedBy}`}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500 hover:text-red-700"
                          onClick={() => revokeMutation.mutate({ disputeId, userId: entry.userId })}
                          disabled={revokeMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
