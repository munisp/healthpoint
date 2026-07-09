import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Key, Plus, Trash2, Copy, Eye, EyeOff, Shield, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

export default function APIKeyManagement() {
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["read"]);
  const [newKeyExpiry, setNewKeyExpiry] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [showCreatedKey, setShowCreatedKey] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<any>(null);

  const { data: keys, isLoading, refetch } = trpc.apiKeys.list.useQuery();

  const createMutation = trpc.apiKeys.create.useMutation({
    onSuccess: (data) => {
      setCreatedKey(data.key);
      setShowCreate(false);
      setNewKeyName("");
      setNewKeyScopes(["read"]);
      setNewKeyExpiry("");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeMutation = trpc.apiKeys.revoke.useMutation({
    onSuccess: () => { toast.success("API key revoked"); setRevokeTarget(null); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const toggleScope = (scope: string) => {
    setNewKeyScopes(prev => prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]);
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast.success("API key copied to clipboard");
  };

  const activeKeys = (keys ?? []).filter((k: any) => !k.revokedAt);
  const revokedKeys = (keys ?? []).filter((k: any) => k.revokedAt);

  const getScopeColor = (scope: string) => {
    if (scope.includes("admin")) return "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400";
    if (scope.includes("write")) return "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400";
    return "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400";
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Key className="h-6 w-6 text-blue-600" />
            API Key Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create and manage personal API keys for programmatic access to HealthPoint
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />New API Key
          </Button>
        </div>
      </div>

      {/* Security notice */}
      <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="text-sm text-amber-800 dark:text-amber-300">
          <strong>Security notice:</strong> API keys grant programmatic access to your account. Keep them secret, rotate them regularly, and revoke any keys you no longer need.
        </div>
      </div>

      {/* Active keys */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            Active Keys ({activeKeys.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : activeKeys.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No active API keys. Create one to get started.
            </div>
          ) : (
            <div className="divide-y">
              {activeKeys.map((k: any) => (
                <div key={k.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30">
                  <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{k.name}</span>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{k.keyPrefix}••••••••</code>
                      {k.scopes.split(",").map((s: string) => (
                        <span key={s} className={`text-xs px-1.5 py-0.5 rounded font-medium ${getScopeColor(s)}`}>{s}</span>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex gap-3">
                      <span>Created {new Date(k.createdAt).toLocaleDateString()}</span>
                      {k.lastUsedAt && <span>Last used {new Date(k.lastUsedAt).toLocaleDateString()}</span>}
                      {k.expiresAt && <span className={new Date(k.expiresAt) < new Date() ? "text-red-500" : ""}>Expires {new Date(k.expiresAt).toLocaleDateString()}</span>}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-600 border-red-200 hover:bg-red-50 text-xs"
                    onClick={() => setRevokeTarget(k)}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />Revoke
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revoked keys */}
      {revokedKeys.length > 0 && (
        <Card className="opacity-60">
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">Revoked Keys ({revokedKeys.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {revokedKeys.map((k: any) => (
                <div key={k.id} className="flex items-center gap-4 px-4 py-3">
                  <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm line-through text-muted-foreground">{k.name}</span>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground">{k.keyPrefix}••••••••</code>
                      <Badge variant="destructive" className="text-xs">Revoked</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Revoked {new Date(k.revokedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Key className="h-4 w-4" />Create API Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Key Name *</Label>
              <Input value={newKeyName} onChange={e => setNewKeyName(e.target.value)} placeholder="My integration, CI/CD pipeline, etc." />
            </div>
            <div className="space-y-2">
              <Label>Scopes</Label>
              {["read", "write", "admin"].map(scope => (
                <div key={scope} className="flex items-center gap-2">
                  <Checkbox
                    id={`scope-${scope}`}
                    checked={newKeyScopes.includes(scope)}
                    onCheckedChange={() => toggleScope(scope)}
                  />
                  <label htmlFor={`scope-${scope}`} className="text-sm cursor-pointer capitalize flex items-center gap-2">
                    {scope}
                    <span className={`text-xs px-1.5 py-0.5 rounded ${getScopeColor(scope)}`}>
                      {scope === "read" ? "View data" : scope === "write" ? "Create & update" : "Full admin access"}
                    </span>
                  </label>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <Label>Expiry Date (optional)</Label>
              <Input type="date" value={newKeyExpiry} onChange={e => setNewKeyExpiry(e.target.value)} min={new Date().toISOString().split("T")[0]} />
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button className="flex-1" onClick={() => createMutation.mutate({ name: newKeyName, scopes: newKeyScopes as any, expiresAt: newKeyExpiry ? new Date(newKeyExpiry).toISOString() : undefined })} disabled={createMutation.isPending || !newKeyName.trim() || newKeyScopes.length === 0}>
                {createMutation.isPending ? "Creating..." : "Create Key"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Created key reveal dialog */}
      <Dialog open={!!createdKey} onOpenChange={() => setCreatedKey(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600"><CheckCircle2 className="h-4 w-4" />API Key Created</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 text-sm text-amber-800 dark:text-amber-300">
              <strong>Copy this key now.</strong> It will not be shown again for security reasons.
            </div>
            <div className="flex items-center gap-2">
              <code className={`flex-1 text-xs bg-muted p-3 rounded font-mono break-all ${showCreatedKey ? "" : "blur-sm select-none"}`}>
                {createdKey}
              </code>
              <div className="flex flex-col gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setShowCreatedKey(!showCreatedKey)}>
                  {showCreatedKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => copyKey(createdKey!)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <Button className="w-full" onClick={() => setCreatedKey(null)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation */}
      <Dialog open={!!revokeTarget} onOpenChange={() => setRevokeTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600"><AlertTriangle className="h-4 w-4" />Revoke API Key</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Revoke <strong>{revokeTarget?.name}</strong>? Any integrations using this key will stop working immediately.
          </p>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setRevokeTarget(null)}>Cancel</Button>
            <Button variant="destructive" className="flex-1" onClick={() => revokeMutation.mutate({ id: revokeTarget?.id })} disabled={revokeMutation.isPending}>
              {revokeMutation.isPending ? "Revoking..." : "Revoke Key"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
