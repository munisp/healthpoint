import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Mail, Bell, Clock, Calendar, Save, RefreshCw } from "lucide-react";

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Prefs {
  digestFrequency: "daily" | "weekly" | "never";
  notifyOnNewDispute: boolean;
  notifyOnStatusChange: boolean;
  notifyOnDeadlineApproach: boolean;
  notifyOnDetermination: boolean;
  notifyOnSLABreach: boolean;
  digestTime: string;
  digestDayOfWeek: number;
}

const DEFAULT_PREFS: Prefs = {
  digestFrequency: "daily",
  notifyOnNewDispute: true,
  notifyOnStatusChange: true,
  notifyOnDeadlineApproach: true,
  notifyOnDetermination: true,
  notifyOnSLABreach: true,
  digestTime: "08:00",
  digestDayOfWeek: 1,
};

export default function EmailDigestPreferences() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [isDirty, setIsDirty] = useState(false);

  const { data: existing, isLoading } = trpc.emailPrefs.get.useQuery();
  const upsertMutation = trpc.emailPrefs.upsert.useMutation({
    onSuccess: () => { toast.success("Email preferences saved"); setIsDirty(false); },
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if (existing) {
      setPrefs({
        digestFrequency: existing.digestFrequency,
        notifyOnNewDispute: existing.notifyOnNewDispute,
        notifyOnStatusChange: existing.notifyOnStatusChange,
        notifyOnDeadlineApproach: existing.notifyOnDeadlineApproach,
        notifyOnDetermination: existing.notifyOnDetermination,
        notifyOnSLABreach: existing.notifyOnSLABreach,
        digestTime: existing.digestTime,
        digestDayOfWeek: existing.digestDayOfWeek,
      });
    }
  }, [existing]);

  const update = <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  const handleSave = () => upsertMutation.mutate(prefs);

  const NOTIFICATION_ITEMS = [
    { key: "notifyOnNewDispute" as const, label: "New Dispute Filed", description: "When a new IDR dispute is initiated in the system" },
    { key: "notifyOnStatusChange" as const, label: "Status Changes", description: "When a dispute moves to a new workflow step" },
    { key: "notifyOnDeadlineApproach" as const, label: "Deadline Approaching", description: "When a statutory deadline is within 3 business days" },
    { key: "notifyOnDetermination" as const, label: "Determination Issued", description: "When an IDR entity issues a final determination" },
    { key: "notifyOnSLABreach" as const, label: "SLA Breach Detected", description: "When a dispute exceeds its statutory time limit" },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="h-6 w-6 text-blue-600" />
            Email Digest Preferences
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Configure how and when you receive email notifications</p>
        </div>
        <Button onClick={handleSave} disabled={!isDirty || upsertMutation.isPending}>
          <Save className="h-4 w-4 mr-2" />
          {upsertMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {/* Digest frequency */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" />Digest Frequency
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">How often should we send you a digest email?</Label>
            <Select value={prefs.digestFrequency} onValueChange={(v: any) => update("digestFrequency", v)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="never">Never (disable digest)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {prefs.digestFrequency !== "never" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />Delivery Time
                </Label>
                <Input
                  type="time"
                  value={prefs.digestTime}
                  onChange={e => update("digestTime", e.target.value)}
                  className="w-32"
                />
              </div>
              {prefs.digestFrequency === "weekly" && (
                <div className="space-y-2">
                  <Label className="text-sm flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />Day of Week
                  </Label>
                  <Select value={String(prefs.digestDayOfWeek)} onValueChange={v => update("digestDayOfWeek", Number(v))}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DAYS_OF_WEEK.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {prefs.digestFrequency !== "never" && (
            <p className="text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg">
              {prefs.digestFrequency === "daily"
                ? `You'll receive a daily summary at ${prefs.digestTime} with all dispute activity from the past 24 hours.`
                : `You'll receive a weekly summary every ${DAYS_OF_WEEK[prefs.digestDayOfWeek]} at ${prefs.digestTime}.`}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Notification types */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Bell className="h-4 w-4" />Notification Events
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">Choose which events trigger immediate email notifications (separate from digest):</p>
          {NOTIFICATION_ITEMS.map(item => (
            <div key={item.key} className="flex items-start justify-between gap-4 py-2 border-b last:border-0">
              <div className="flex-1">
                <Label className="text-sm font-medium cursor-pointer" htmlFor={item.key}>{item.label}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
              </div>
              <Switch
                id={item.key}
                checked={prefs[item.key]}
                onCheckedChange={v => update(item.key, v)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Summary */}
      <Card className="bg-muted/30">
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">
            <strong>Current settings:</strong>{" "}
            {prefs.digestFrequency === "never" ? "Digest emails disabled." : `${prefs.digestFrequency === "daily" ? "Daily" : "Weekly"} digest at ${prefs.digestTime}${prefs.digestFrequency === "weekly" ? ` on ${DAYS_OF_WEEK[prefs.digestDayOfWeek]}` : ""}.`}
            {" "}
            Immediate notifications enabled for:{" "}
            {NOTIFICATION_ITEMS.filter(i => prefs[i.key]).map(i => i.label).join(", ") || "none"}.
          </p>
        </CardContent>
      </Card>

      {isDirty && (
        <p className="text-xs text-amber-600 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
          You have unsaved changes
        </p>
      )}
    </div>
  );
}
