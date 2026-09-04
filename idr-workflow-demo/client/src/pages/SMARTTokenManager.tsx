import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Shield, RefreshCw, Trash2, AlertTriangle } from "lucide-react";

export default function SMARTTokenManager() {
  const [emrConnectionId, setEmrConnectionId] = useState("");
  const [inputValue, setInputValue] = useState("");

  // Confirmation dialog state
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; preview: string } | null>(null);

  const { data: tokens = [], refetch, isLoading } = trpc.smartAuth.listTokens.useQuery(
    { emrConnectionId },
    { enabled: !!emrConnectionId }
  );

  const revokeMutation = trpc.smartAuth.revokeToken.useMutation({
    onSuccess: () => {
      toast.success("SMART token revoked", {
        description: "The token has been invalidated. The EMR connection will need to re-authorize.",
      });
      setRevokeTarget(null);
      refetch();
    },
    onError: (err) => {
      toast.error("Revocation failed", { description: err.message });
      setRevokeTarget(null);
    },
  });

  const handleRevokeClick = (token: { id: string; accessToken: string | null }) => {
    const preview = token.accessToken ? token.accessToken.slice(0, 16) + "..." : token.id.slice(0, 16) + "...";
    setRevokeTarget({ id: token.id, preview });
  };

  const confirmRevoke = () => {
    if (revokeTarget) {
      revokeMutation.mutate({ tokenId: revokeTarget.id });
    }
  };

  const isExpired = (expiresAt: Date | null | string) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-emerald-600" />
            SMART on FHIR Token Manager
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage SMART authorization tokens for connected EMR systems
          </p>
        </div>

        {/* EMR Connection Selector */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Select EMR Connection</CardTitle>
            <CardDescription>Enter the EMR connection ID to view its SMART tokens</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 items-end">
              <div className="flex-1 max-w-md">
                <Label className="text-xs">EMR Connection ID</Label>
                <Input
                  placeholder="conn_..."
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && setEmrConnectionId(inputValue)}
                />
              </div>
              <Button onClick={() => { setEmrConnectionId(inputValue); refetch(); }}>
                <RefreshCw className="h-4 w-4 mr-1" /> Load Tokens
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Token List */}
        {emrConnectionId && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Active Tokens</CardTitle>
              <CardDescription>
                {isLoading ? "Loading..." : `${tokens.length} token${tokens.length !== 1 ? "s" : ""} for ${emrConnectionId}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading tokens...</div>
              ) : tokens.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Shield className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No SMART tokens found</p>
                  <p className="text-sm">Tokens are issued automatically during SMART on FHIR authorization flows.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {tokens.map(token => {
                    const expired = isExpired(token.expiresAt);
                    return (
                      <div
                        key={token.id}
                        className={`flex items-start justify-between p-3 rounded-lg border ${expired ? "border-red-200 bg-red-50/50" : "border-border bg-muted/20"}`}
                      >
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-medium truncate max-w-xs">
                              {token.accessToken ? token.accessToken.slice(0, 32) + "..." : "—"}
                            </span>
                            {expired ? (
                              <Badge variant="destructive" className="text-xs">Expired</Badge>
                            ) : (
                              <Badge className="text-xs bg-emerald-100 text-emerald-800 border-emerald-200">Active</Badge>
                            )}
                          </div>
                          <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
                            <span>Scope: {token.scope ?? "—"}</span>
                            <span>Issued: {token.createdAt ? new Date(token.createdAt).toLocaleString() : "—"}</span>
                            {token.expiresAt && (
                              <span className={expired ? "text-red-600" : ""}>
                                {expired ? "Expired" : "Expires"}: {new Date(token.expiresAt).toLocaleString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500 hover:text-red-700 shrink-0"
                          onClick={() => handleRevokeClick(token)}
                          disabled={revokeMutation.isPending}
                          title="Revoke token"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Info Card */}
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="pt-4">
            <div className="flex gap-2 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">SMART on FHIR Security Notice</p>
                <p className="text-xs mt-0.5">
                  Revoking a token will immediately invalidate all API calls using that token. Only revoke tokens
                  that are compromised or no longer needed. EMR connections will need to re-authorize after revocation.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Revoke Confirmation Dialog */}
      <AlertDialog open={!!revokeTarget} onOpenChange={open => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-500" />
              Revoke SMART Token?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  You are about to revoke the token{" "}
                  <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                    {revokeTarget?.preview}
                  </span>
                </p>
                <p className="text-destructive font-medium text-sm">
                  This action cannot be undone.
                </p>
                <p className="text-sm">
                  All API calls currently using this token will fail immediately. The associated EMR
                  connection will need to complete a new SMART on FHIR authorization flow before it
                  can access patient data again.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel — keep token</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={confirmRevoke}
              disabled={revokeMutation.isPending}
            >
              {revokeMutation.isPending ? "Revoking..." : "Yes, revoke token"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
