/**
 * Onboarding.tsx
 *
 * Role-based onboarding flow shown after first Keycloak login.
 * URL: /onboarding?role=provider|facility|payer|idr_entity
 *
 * Steps:
 *  1. Welcome + role confirmation
 *  2. Organization details
 *  3. Quick tour of key features for their role
 *  4. Redirect to the appropriate dashboard
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  CheckCircle2,
  Building2,
  Stethoscope,
  DollarSign,
  Scale,
  ArrowRight,
  Loader2,
  Shield,
} from "lucide-react";

type StakeholderRole = "provider" | "facility" | "payer" | "idr_entity" | "";

interface RoleConfig {
  label: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  description: string;
  features: string[];
  redirectTo: string;
}

const ROLE_CONFIG: Record<string, RoleConfig> = {
  provider: {
    label: "Physician / Provider Group",
    icon: <Stethoscope className="w-6 h-6" />,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    description: "File disputes, track deadlines, and optimize offer amounts with AI recommendations.",
    features: [
      "AI-powered offer amount recommendations",
      "18-minute average filing time",
      "Real-time deadline alerts",
      "Batch filing for high-volume practices",
    ],
    redirectTo: "/disputes",
  },
  facility: {
    label: "Hospital / Facility",
    icon: <Building2 className="w-6 h-6" />,
    color: "text-purple-600",
    bgColor: "bg-purple-50",
    description: "Manage hundreds of concurrent disputes across departments with centralized tracking.",
    features: [
      "Multi-department dispute management",
      "EMR/EHR data integration",
      "Automated document generation",
      "Department-level analytics",
    ],
    redirectTo: "/disputes",
  },
  payer: {
    label: "Health Plan / Payer",
    icon: <DollarSign className="w-6 h-6" />,
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    description: "Defend QPA determinations with statutory criteria checklists and portfolio analytics.",
    features: [
      "QPA compliance validation",
      "Statutory criteria checklist (45 CFR § 149.510)",
      "Portfolio-level dispute analytics",
      "Offer strategy optimization",
    ],
    redirectTo: "/disputes",
  },
  idr_entity: {
    label: "Certified IDR Entity",
    icon: <Scale className="w-6 h-6" />,
    color: "text-green-600",
    bgColor: "bg-green-50",
    description: "Manage arbitration caseloads with structured case management and audit-ready records.",
    features: [
      "Caseload management dashboard",
      "Statutory timeline enforcement",
      "Audit-ready determination records",
      "5× arbitrator throughput",
    ],
    redirectTo: "/idr-entities",
  },
};

const STEPS = ["Welcome", "Organization", "Features", "Done"];

export default function Onboarding() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated, loading } = useAuth();
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<StakeholderRole>("");
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState("");
  const [saving, setSaving] = useState(false);

  // Read role from URL query param (passed from marketing site registration)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roleParam = params.get("role") as StakeholderRole;
    if (roleParam && ROLE_CONFIG[roleParam]) {
      setRole(roleParam);
    }
  }, []);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !isAuthenticated) {
      window.location.href = getLoginUrl(window.location.pathname + window.location.search);
    }
  }, [loading, isAuthenticated]);

  const saveProfileMutation = trpc.profiles.save.useMutation();
  const completeOnboardingMutation = trpc.profiles.completeOnboarding.useMutation();

  const handleSaveOrg = async () => {
    if (!orgName.trim()) {
      toast.error("Please enter your organization name.");
      return;
    }
    setSaving(true);
    try {
      await saveProfileMutation.mutateAsync({
        orgName: orgName.trim(),
        orgType: orgType || undefined,
        stakeholderRole: (role as "provider" | "facility" | "payer" | "idr_entity" | "other") || "provider",
      });
      setStep(2);
    } catch {
      toast.error("Failed to save profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleFinish = async () => {
    try {
      await completeOnboardingMutation.mutateAsync();
    } catch {
      // non-blocking — proceed even if the mutation fails
    }
    const config = ROLE_CONFIG[role];
    navigate(config?.redirectTo || "/");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
      </div>
    );
  }

  const config = role ? ROLE_CONFIG[role] : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-sky-50 flex flex-col items-center justify-center p-4">
      {/* Progress bar */}
      <div className="w-full max-w-lg mb-8">
        <div className="flex items-center justify-between mb-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                i < step ? "bg-sky-500 text-white" :
                i === step ? "bg-sky-500 text-white ring-4 ring-sky-100" :
                "bg-slate-200 text-slate-400"
              }`}>
                {i < step ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-1 w-16 rounded ${i < step ? "bg-sky-500" : "bg-slate-200"}`} />
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-between text-xs text-slate-400 mt-1">
          {STEPS.map(s => <span key={s}>{s}</span>)}
        </div>
      </div>

      <Card className="w-full max-w-lg shadow-xl">
        {/* Step 0: Welcome + role selection */}
        {step === 0 && (
          <>
            <CardHeader className="text-center pb-2">
              <div className="w-16 h-16 rounded-2xl bg-sky-100 flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8 text-sky-600" />
              </div>
              <CardTitle className="text-2xl">Welcome to HealthPoint{user?.name ? `, ${user.name.split(" ")[0]}` : ""}!</CardTitle>
              <CardDescription>Let's personalize your experience. What best describes your role?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              {Object.entries(ROLE_CONFIG).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => setRole(key as StakeholderRole)}
                  className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all ${
                    role === key
                      ? "border-sky-500 bg-sky-50"
                      : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg ${cfg.bgColor} ${cfg.color} flex items-center justify-center flex-shrink-0`}>
                    {cfg.icon}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 text-sm">{cfg.label}</div>
                    <div className="text-slate-400 text-xs mt-0.5">{cfg.description}</div>
                  </div>
                  {role === key && <CheckCircle2 className="w-5 h-5 text-sky-500 ml-auto flex-shrink-0" />}
                </button>
              ))}
              <Button
                className="w-full mt-2"
                disabled={!role}
                onClick={() => setStep(1)}
              >
                Continue <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </CardContent>
          </>
        )}

        {/* Step 1: Organization details */}
        {step === 1 && config && (
          <>
            <CardHeader className="pb-2">
              <div className={`w-12 h-12 rounded-xl ${config.bgColor} ${config.color} flex items-center justify-center mb-3`}>
                {config.icon}
              </div>
              <CardTitle>Tell us about your organization</CardTitle>
              <CardDescription>This helps us tailor your dashboard and compliance settings.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div>
                <Label htmlFor="orgName">Organization Name</Label>
                <Input
                  id="orgName"
                  placeholder="e.g., Regional Medical Center"
                  value={orgName}
                  onChange={e => setOrgName(e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="orgType">Organization Type</Label>
                <select
                  id="orgType"
                  value={orgType}
                  onChange={e => setOrgType(e.target.value)}
                  className="mt-1.5 w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select type...</option>
                  {role === "provider" && <>
                    <option>Solo Practice</option>
                    <option>Group Practice (2–10)</option>
                    <option>Large Group Practice (10+)</option>
                    <option>Physician Management Company</option>
                  </>}
                  {role === "facility" && <>
                    <option>Community Hospital</option>
                    <option>Academic Medical Center</option>
                    <option>Health System</option>
                    <option>Ambulatory Surgery Center</option>
                    <option>Specialty Facility</option>
                  </>}
                  {role === "payer" && <>
                    <option>Commercial Health Plan</option>
                    <option>Self-Funded Employer Plan</option>
                    <option>Third-Party Administrator</option>
                    <option>Government Plan</option>
                  </>}
                  {role === "idr_entity" && <>
                    <option>HRSA-Certified IDR Entity</option>
                    <option>Pending Certification</option>
                  </>}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setStep(0)} className="flex-1">Back</Button>
                <Button onClick={handleSaveOrg} disabled={saving} className="flex-1">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Continue <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </>
        )}

        {/* Step 2: Feature tour */}
        {step === 2 && config && (
          <>
            <CardHeader className="pb-2">
              <Badge className={`${config.bgColor} ${config.color} border-0 w-fit mb-2`}>{config.label}</Badge>
              <CardTitle>Your key features</CardTitle>
              <CardDescription>Here's what HealthPoint unlocks for {config.label.toLowerCase()}s.</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <ul className="space-y-3 mb-6">
                {config.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-sky-500 flex-shrink-0 mt-0.5" />
                    <span className="text-slate-700 text-sm">{f}</span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(1)} className="flex-1">Back</Button>
                <Button onClick={() => setStep(3)} className="flex-1">
                  Go to Dashboard <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </>
        )}

        {/* Step 3: Done */}
        {step === 3 && (
          <>
            <CardHeader className="text-center pb-2">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              </div>
              <CardTitle className="text-2xl">You're all set!</CardTitle>
              <CardDescription>Your HealthPoint account is ready. Let's start managing your NSA/IDR disputes.</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <Button onClick={handleFinish} className="w-full" size="lg">
                Open My Dashboard <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
