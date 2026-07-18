import { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Settings, Bell, Shield, Database, Globe, Save, RotateCcw, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

const SETTING_SECTIONS = [
  { id: "general", label: "General", icon: Settings },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security", icon: Shield },
  { id: "data", label: "Data & Export", icon: Database },
  { id: "integrations", label: "Integrations", icon: Globe },
];

export default function GlobalSettings() {
  const { isAuthenticated } = useAuth();
  const [activeSection, setActiveSection] = useState("general");
  const [dirty, setDirty] = useState(false);

  // General settings state
  const [orgName, setOrgName] = useState("HealthPoint IDR Platform");
  const [timezone, setTimezone] = useState("America/New_York");
  const [dateFormat, setDateFormat] = useState("MM/DD/YYYY");
  const [defaultPageSize, setDefaultPageSize] = useState("25");

  // Notification settings
  const [emailDeadlineWarning, setEmailDeadlineWarning] = useState(true);
  const [emailStepAdvanced, setEmailStepAdvanced] = useState(true);
  const [emailDetermination, setEmailDetermination] = useState(true);
  const [inAppNotifications, setInAppNotifications] = useState(true);
  const [deadlineWarningDays, setDeadlineWarningDays] = useState("3");

  // Security settings
  const [sessionTimeout, setSessionTimeout] = useState("30");
  const [requireMFA, setRequireMFA] = useState(false);
  const [auditAllActions, setAuditAllActions] = useState(true);
  const [ipAllowlist, setIpAllowlist] = useState("");

  // Data settings
  const [retentionDays, setRetentionDays] = useState("2555");
  const [autoExportEnabled, setAutoExportEnabled] = useState(false);
  const [exportFormat, setExportFormat] = useState("csv");

  const { data: saved, isLoading } = trpc.orgSettings.get.useQuery(undefined, { enabled: isAuthenticated });
  const utils = trpc.useUtils();
  const upsertMutation = trpc.orgSettings.upsert.useMutation({
    onSuccess: () => {
      toast.success("Settings saved successfully");
      setDirty(false);
      utils.orgSettings.get.invalidate();
    },
    onError: (e) => toast.error(`Failed to save: ${e.message}`),
  });

  // Populate form from DB on first load
  useEffect(() => {
    if (!saved) return;
    if (saved.orgName) setOrgName(saved.orgName);
    if (saved.timezone) setTimezone(saved.timezone);
    if (saved.dateFormat) setDateFormat(saved.dateFormat);
    if (saved.defaultPageSize) setDefaultPageSize(String(saved.defaultPageSize));
    if (saved.emailDeadlineWarning !== null && saved.emailDeadlineWarning !== undefined) setEmailDeadlineWarning(saved.emailDeadlineWarning);
    if (saved.emailStepAdvanced !== null && saved.emailStepAdvanced !== undefined) setEmailStepAdvanced(saved.emailStepAdvanced);
    if (saved.emailDetermination !== null && saved.emailDetermination !== undefined) setEmailDetermination(saved.emailDetermination);
    if (saved.inAppNotifications !== null && saved.inAppNotifications !== undefined) setInAppNotifications(saved.inAppNotifications);
    if (saved.deadlineWarningDays) setDeadlineWarningDays(String(saved.deadlineWarningDays));
    if (saved.sessionTimeoutMinutes) setSessionTimeout(String(saved.sessionTimeoutMinutes));
    if (saved.requireMFA !== null && saved.requireMFA !== undefined) setRequireMFA(saved.requireMFA);
    if (saved.auditAllActions !== null && saved.auditAllActions !== undefined) setAuditAllActions(saved.auditAllActions);
    if (saved.ipAllowlist) setIpAllowlist(saved.ipAllowlist);
    if (saved.retentionDays) setRetentionDays(String(saved.retentionDays));
    if (saved.autoExportEnabled !== null && saved.autoExportEnabled !== undefined) setAutoExportEnabled(saved.autoExportEnabled);
    if (saved.exportFormat) setExportFormat(saved.exportFormat);
  }, [saved]);

  const mark = () => setDirty(true);

  function handleSave() {
    upsertMutation.mutate({
      orgName,
      timezone,
      dateFormat,
      defaultPageSize: parseInt(defaultPageSize),
      emailDeadlineWarning,
      emailStepAdvanced,
      emailDetermination,
      inAppNotifications,
      deadlineWarningDays: parseInt(deadlineWarningDays),
      sessionTimeoutMinutes: parseInt(sessionTimeout),
      requireMFA,
      auditAllActions,
      ipAllowlist,
      retentionDays: parseInt(retentionDays),
      autoExportEnabled,
      exportFormat: exportFormat as "csv" | "xlsx" | "json",
    });
  }

  function handleReset() {
    if (saved) {
      if (saved.orgName) setOrgName(saved.orgName);
      if (saved.timezone) setTimezone(saved.timezone);
    }
    setDirty(false);
    toast.info("Settings reset to last saved values");
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="h-6 w-6 text-blue-600" />
            Platform Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure platform-wide defaults, notifications, and security policies
          </p>
        </div>
        {dirty && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleReset} disabled={upsertMutation.isPending}>
              <RotateCcw className="h-4 w-4 mr-2" />Reset
            </Button>
            <Button size="sm" onClick={handleSave} disabled={upsertMutation.isPending}>
              {upsertMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Changes
            </Button>
          </div>
        )}
      </div>

      <div className="flex gap-6">
        {/* Sidebar nav */}
        <div className="w-48 shrink-0 space-y-1">
          {SETTING_SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                activeSection === s.id
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <s.icon className="h-4 w-4" />
              {s.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4">
          {activeSection === "general" && (
            <Card>
              <CardHeader><CardTitle className="text-base">General Settings</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Organization Name</label>
                  <Input value={orgName} onChange={e => { setOrgName(e.target.value); mark(); }} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Default Timezone</label>
                  <Select value={timezone} onValueChange={v => { setTimezone(v); mark(); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="America/New_York">Eastern (ET)</SelectItem>
                      <SelectItem value="America/Chicago">Central (CT)</SelectItem>
                      <SelectItem value="America/Denver">Mountain (MT)</SelectItem>
                      <SelectItem value="America/Los_Angeles">Pacific (PT)</SelectItem>
                      <SelectItem value="UTC">UTC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Date Format</label>
                  <Select value={dateFormat} onValueChange={v => { setDateFormat(v); mark(); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                      <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                      <SelectItem value="YYYY-MM-DD">YYYY-MM-DD (ISO)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Default Page Size</label>
                  <Select value={defaultPageSize} onValueChange={v => { setDefaultPageSize(v); mark(); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["10","25","50","100"].map(v => <SelectItem key={v} value={v}>{v} rows</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          )}

          {activeSection === "notifications" && (
            <Card>
              <CardHeader><CardTitle className="text-base">Notification Preferences</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: "Email: Deadline warnings", desc: "Send email when a dispute deadline is approaching", value: emailDeadlineWarning, set: setEmailDeadlineWarning },
                  { label: "Email: Step advanced", desc: "Notify when a dispute moves to the next IDR step", value: emailStepAdvanced, set: setEmailStepAdvanced },
                  { label: "Email: Determination issued", desc: "Notify when an IDR determination is issued", value: emailDetermination, set: setEmailDetermination },
                  { label: "In-app notifications", desc: "Show notification bell and in-app alerts", value: inAppNotifications, set: setInAppNotifications },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                    <Switch checked={item.value} onCheckedChange={v => { item.set(v); mark(); }} />
                  </div>
                ))}
                <Separator />
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Deadline warning threshold (business days)</label>
                  <Input type="number" min="1" max="10" value={deadlineWarningDays}
                    onChange={e => { setDeadlineWarningDays(e.target.value); mark(); }} className="w-24" />
                </div>
              </CardContent>
            </Card>
          )}

          {activeSection === "security" && (
            <Card>
              <CardHeader><CardTitle className="text-base">Security Policies</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Session timeout (minutes)</label>
                  <Input type="number" min="5" max="480" value={sessionTimeout}
                    onChange={e => { setSessionTimeout(e.target.value); mark(); }} className="w-32" />
                  <p className="text-xs text-muted-foreground">Users will be warned 5 minutes before expiry</p>
                </div>
                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium">Require MFA for all users</p>
                    <p className="text-xs text-muted-foreground">Force multi-factor authentication on next login</p>
                  </div>
                  <Switch checked={requireMFA} onCheckedChange={v => { setRequireMFA(v); mark(); }} />
                </div>
                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium">Audit all user actions</p>
                    <p className="text-xs text-muted-foreground">Log every dispute read, write, and export to the audit trail</p>
                  </div>
                  <Switch checked={auditAllActions} onCheckedChange={v => { setAuditAllActions(v); mark(); }} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">IP Allowlist (comma-separated CIDR)</label>
                  <Input placeholder="e.g. 192.168.1.0/24, 10.0.0.0/8" value={ipAllowlist}
                    onChange={e => { setIpAllowlist(e.target.value); mark(); }} />
                  <p className="text-xs text-muted-foreground">Leave blank to allow all IPs</p>
                </div>
              </CardContent>
            </Card>
          )}

          {activeSection === "data" && (
            <Card>
              <CardHeader><CardTitle className="text-base">Data Retention & Export</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Data retention period (days)</label>
                  <Input type="number" min="365" max="3650" value={retentionDays}
                    onChange={e => { setRetentionDays(e.target.value); mark(); }} className="w-32" />
                  <p className="text-xs text-muted-foreground">
                    Default: 2,555 days (7 years) — NSA requires 6-year minimum retention
                  </p>
                </div>
                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium">Automated nightly export</p>
                    <p className="text-xs text-muted-foreground">Export all closed disputes to S3 Lakehouse nightly</p>
                  </div>
                  <Switch checked={autoExportEnabled} onCheckedChange={v => { setAutoExportEnabled(v); mark(); }} />
                </div>
                {autoExportEnabled && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Export format</label>
                    <Select value={exportFormat} onValueChange={v => { setExportFormat(v); mark(); }}>
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="csv">CSV</SelectItem>
                        <SelectItem value="json">JSON</SelectItem>
                        <SelectItem value="xlsx">XLSX</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {activeSection === "integrations" && (
            <Card>
              <CardHeader><CardTitle className="text-base">Integrations</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {[
                  { name: "Keycloak / OIDC", status: "configured", desc: "JWKS-compatible JWT verification via jose" },
                  { name: "Redis / Redlock", status: "active", desc: "Distributed session cache and locking" },
                  { name: "S3 Object Storage", status: "active", desc: "Document and attachment storage" },
                  { name: "PostgreSQL", status: "active", desc: "Primary database via Drizzle ORM" },
                  { name: "OpenSearch", status: "simulated", desc: "Full-text search via Fuse.js (swap for OpenSearch in production)" },
                  { name: "Kafka / Event Bus", status: "simulated", desc: "In-process EventEmitter with Kafka-compatible interface" },
                  { name: "Temporal Workflow", status: "simulated", desc: "19-step IDR state machine (swap for Temporal in production)" },
                  { name: "TigerBeetle Ledger", status: "simulated", desc: "Double-entry ledger (swap for TigerBeetle in production)" },
                ].map(item => (
                  <div key={item.name} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      item.status === "active" ? "bg-green-100 text-green-700" :
                      item.status === "configured" ? "bg-blue-100 text-blue-700" :
                      "bg-slate-100 text-slate-600"
                    }`}>
                      {item.status}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
