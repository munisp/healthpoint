import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  Plus, Database, CheckCircle2, XCircle, AlertCircle,
  Clock, Zap, Trash2, Power, ExternalLink, Activity,
} from "lucide-react";

const STATUS_CONFIG = {
  active: { label: "Active", icon: CheckCircle2, color: "text-green-600", badge: "default" as const },
  inactive: { label: "Inactive", icon: Power, color: "text-muted-foreground", badge: "secondary" as const },
  error: { label: "Error", icon: XCircle, color: "text-destructive", badge: "destructive" as const },
  testing: { label: "Testing", icon: Activity, color: "text-blue-600", badge: "secondary" as const },
};

const EMR_LOGOS: Record<string, string> = {
  epic: "🏥", cerner: "🔵", meditech: "🟢", allscripts: "🟠",
  athenahealth: "🔷", nextgen: "🟣", eclinicalworks: "🔶", custom_fhir: "⚙️",
};

export default function EMRConnections() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data: connections, isLoading } = trpc.emr.list.useQuery();

  const deactivate = trpc.emr.deactivate.useMutation({
    onSuccess: () => {
      toast.success("EMR connection deactivated");
      utils.emr.list.invalidate();
    },
    onError: (err: { message: string }) => toast.error(`Failed: ${err.message}`),
  });

  const deleteConn = trpc.emr.delete.useMutation({
    onSuccess: () => {
      toast.success("EMR connection deleted");
      utils.emr.list.invalidate();
    },
    onError: (err: { message: string }) => toast.error(`Failed: ${err.message}`),
  });

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">EMR Connections</h1>
          <p className="text-muted-foreground mt-1">
            Manage FHIR-based EMR integrations for AI-assisted dispute pre-population.
          </p>
        </div>
        <Button onClick={() => navigate("/emr-onboarding")}>
          <Plus className="mr-2 h-4 w-4" />
          Add EMR Connection
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Activity className="h-5 w-5 animate-pulse mr-2" />
          Loading connections…
        </div>
      )}

      {!isLoading && (!connections || connections.length === 0) && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <Database className="h-12 w-12 text-muted-foreground/40" />
            <div className="text-center">
              <p className="font-medium">No EMR connections yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Connect your EMR system to enable AI-assisted dispute pre-population and document validation.
              </p>
            </div>
            <Button onClick={() => navigate("/emr-onboarding")}>
              <Plus className="mr-2 h-4 w-4" />
              Add Your First EMR Connection
            </Button>
          </CardContent>
        </Card>
      )}

      {connections && connections.length > 0 && (
        <div className="space-y-4">
          {connections.map(conn => {
            const statusCfg = STATUS_CONFIG[conn.status] ?? STATUS_CONFIG.inactive;
            const StatusIcon = statusCfg.icon;
            const logo = EMR_LOGOS[conn.emrSystem] ?? "🔌";
            const confidence = conn.aiConfidenceScore ? Math.round(Number(conn.aiConfidenceScore) * 100) : null;

            return (
              <Card key={conn.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{logo}</span>
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          {conn.name}
                          <Badge variant={statusCfg.badge} className="text-xs">
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {statusCfg.label}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="mt-0.5">
                          {conn.emrSystem.charAt(0).toUpperCase() + conn.emrSystem.slice(1)} · FHIR {conn.fhirVersion} · {conn.authType.toUpperCase()}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {conn.status === "active" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deactivate.mutate({ id: conn.id })}
                          disabled={deactivate.isPending}
                        >
                          <Power className="h-3.5 w-3.5 mr-1" />
                          Deactivate
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm("Delete this EMR connection? This cannot be undone.")) {
                            deleteConn.mutate({ id: conn.id });
                          }
                        }}
                        disabled={deleteConn.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">Base URL</p>
                      <p className="font-mono text-xs truncate">{conn.baseUrl}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Field Mappings</p>
                      <p className="font-medium">{conn.fieldMappings ? Object.keys(conn.fieldMappings).length : 0} configured</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">AI Confidence</p>
                      <p className={`font-medium ${confidence && confidence >= 80 ? "text-green-600" : "text-amber-600"}`}>
                        {confidence !== null ? `${confidence}%` : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Last Tested</p>
                      <p className="font-medium">
                        {conn.lastTestAt
                          ? new Date(conn.lastTestAt).toLocaleDateString()
                          : "Never"}
                      </p>
                    </div>
                  </div>

                  {conn.lastTestMessage && (
                    <Alert
                      variant={conn.lastTestSuccess ? "default" : "destructive"}
                      className={`mt-3 py-2 ${conn.lastTestSuccess ? "border-green-200 bg-green-50 dark:bg-green-950/20" : ""}`}
                    >
                      {conn.lastTestSuccess
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                        : <AlertCircle className="h-3.5 w-3.5" />}
                      <AlertDescription className={`text-xs ${conn.lastTestSuccess ? "text-green-800 dark:text-green-200" : ""}`}>
                        {conn.lastTestMessage}
                      </AlertDescription>
                    </Alert>
                  )}

                  {conn.resourcesFound && (conn.resourcesFound as string[]).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {(conn.resourcesFound as string[]).map(r => (
                        <Badge key={r} variant="outline" className="text-xs">{r}</Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <strong>How EMR integration works:</strong> Once connected, the AI agent reads FHIR resources from your EMR in real time to auto-populate dispute forms, cross-validate uploaded documents, and enrich CMS submission drafts with clinical context — reducing manual data entry by up to 88%.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
