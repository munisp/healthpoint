import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Shield, Info } from "lucide-react";

const ROLES = ["Admin", "Analyst", "Provider", "Viewer"];

const PERMISSIONS = [
  { category: "Disputes", permissions: [
    { action: "Create Dispute", admin: true, analyst: true, provider: true, viewer: false },
    { action: "View All Disputes", admin: true, analyst: true, provider: false, viewer: true },
    { action: "Edit Dispute", admin: true, analyst: true, provider: false, viewer: false },
    { action: "Delete Dispute", admin: true, analyst: false, provider: false, viewer: false },
    { action: "Change Status", admin: true, analyst: true, provider: false, viewer: false },
    { action: "Clone Dispute", admin: true, analyst: true, provider: true, viewer: false },
    { action: "Merge Disputes", admin: true, analyst: false, provider: false, viewer: false },
  ]},
  { category: "Offers & Negotiation", permissions: [
    { action: "Submit Offer", admin: true, analyst: true, provider: true, viewer: false },
    { action: "Accept Offer", admin: true, analyst: true, provider: true, viewer: false },
    { action: "Reject Offer", admin: true, analyst: true, provider: true, viewer: false },
    { action: "View Offer History", admin: true, analyst: true, provider: true, viewer: true },
  ]},
  { category: "Documents & Evidence", permissions: [
    { action: "Upload Documents", admin: true, analyst: true, provider: true, viewer: false },
    { action: "Delete Documents", admin: true, analyst: false, provider: false, viewer: false },
    { action: "View Documents", admin: true, analyst: true, provider: true, viewer: true },
    { action: "Batch Upload", admin: true, analyst: true, provider: false, viewer: false },
  ]},
  { category: "Reports & Analytics", permissions: [
    { action: "View Dashboard", admin: true, analyst: true, provider: false, viewer: true },
    { action: "Export Data", admin: true, analyst: true, provider: false, viewer: false },
    { action: "Custom Reports", admin: true, analyst: true, provider: false, viewer: false },
    { action: "Performance Benchmarks", admin: true, analyst: true, provider: false, viewer: false },
  ]},
  { category: "Administration", permissions: [
    { action: "Manage Users", admin: true, analyst: false, provider: false, viewer: false },
    { action: "Suspend Users", admin: true, analyst: false, provider: false, viewer: false },
    { action: "View Audit Trail", admin: true, analyst: false, provider: false, viewer: false },
    { action: "Manage Webhooks", admin: true, analyst: false, provider: false, viewer: false },
    { action: "System Settings", admin: true, analyst: false, provider: false, viewer: false },
    { action: "Bulk Actions", admin: true, analyst: true, provider: false, viewer: false },
  ]},
  { category: "AI Features", permissions: [
    { action: "AI Comment Summary", admin: true, analyst: true, provider: true, viewer: true },
    { action: "Narrative Generator", admin: true, analyst: true, provider: false, viewer: false },
    { action: "Outcome Simulator", admin: true, analyst: true, provider: false, viewer: false },
  ]},
];

const ROLE_COLORS: Record<string, string> = {
  Admin: "bg-red-100 text-red-700",
  Analyst: "bg-blue-100 text-blue-700",
  Provider: "bg-green-100 text-green-700",
  Viewer: "bg-gray-100 text-gray-700",
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  Admin: "Full platform access including user management, audit trail, and system configuration",
  Analyst: "Can manage disputes, run reports, and perform bulk operations — no user admin",
  Provider: "Can create and manage their own disputes and submit offers",
  Viewer: "Read-only access to disputes and dashboard — no write operations",
};

export default function UserRoleMatrix() {
  const roleKeys = ["admin", "analyst", "provider", "viewer"] as const;

  const totalPermissions = PERMISSIONS.reduce((sum, cat) => sum + cat.permissions.length, 0);
  const roleGrantCounts = roleKeys.map(r => ({
    role: r,
    count: PERMISSIONS.reduce((sum, cat) => sum + cat.permissions.filter(p => p[r]).length, 0),
  }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="h-6 w-6 text-indigo-600" />
          Role Permission Matrix
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Complete overview of role-based access control across all platform features</p>
      </div>

      <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
        <Info className="h-4 w-4 shrink-0" />
        <span>This matrix reflects the current platform permission model. To change a user's role, use the Admin User Management page. Role changes take effect immediately.</span>
      </div>

      {/* Role summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {ROLES.map((role, i) => {
          const key = roleKeys[i];
          const count = roleGrantCounts.find(r => r.role === key)?.count ?? 0;
          return (
            <Card key={role}>
              <CardContent className="p-4">
                <Badge className={`${ROLE_COLORS[role]} mb-2`}>{role}</Badge>
                <p className="text-2xl font-bold">{count}<span className="text-sm text-muted-foreground font-normal">/{totalPermissions}</span></p>
                <p className="text-xs text-muted-foreground mt-1">permissions granted</p>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{ROLE_DESCRIPTIONS[role]}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Permission matrix */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b sticky top-0">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Permission</th>
                  {ROLES.map(r => (
                    <th key={r} className="text-center px-4 py-3 font-medium">
                      <Badge className={ROLE_COLORS[r]}>{r}</Badge>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS.map(cat => (
                  <>
                    <tr key={cat.category} className="bg-muted/30">
                      <td colSpan={5} className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{cat.category}</td>
                    </tr>
                    {cat.permissions.map(p => (
                      <tr key={p.action} className="border-b hover:bg-muted/20">
                        <td className="px-4 py-2.5 text-sm">{p.action}</td>
                        {roleKeys.map(r => (
                          <td key={r} className="px-4 py-2.5 text-center">
                            {p[r] ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                            ) : (
                              <XCircle className="h-4 w-4 text-muted-foreground/30 mx-auto" />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
