import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  CheckCircle2, Circle, ArrowRight, ArrowLeft, Loader2,
  Database, Key, Map, Zap, Power, AlertCircle, Info,
  Activity, Shield, RefreshCw, ExternalLink,
} from "lucide-react";

// ── EMR System catalogue ──────────────────────────────────────────────────────

const EMR_SYSTEMS = [
  {
    id: "epic",
    name: "Epic",
    logo: "🏥",
    description: "Epic Systems — FHIR R4 via MyChart / Interconnect API",
    authType: "oauth2",
    fhirVersion: "R4",
    popular: true,
    fields: ["baseUrl", "clientId", "clientSecret", "scope"],
  },
  {
    id: "cerner",
    name: "Cerner (Oracle Health)",
    logo: "🔵",
    description: "Cerner Millennium — FHIR R4 via Ignite APIs",
    authType: "oauth2",
    fhirVersion: "R4",
    popular: true,
    fields: ["baseUrl", "clientId", "clientSecret", "tenantId"],
  },
  {
    id: "meditech",
    name: "MEDITECH",
    logo: "🟢",
    description: "MEDITECH Expanse — FHIR R4 / HL7 v2.x",
    authType: "apikey",
    fhirVersion: "R4",
    popular: true,
    fields: ["baseUrl", "apiKey", "facilityId"],
  },
  {
    id: "allscripts",
    name: "Allscripts / Veradigm",
    logo: "🟠",
    description: "Allscripts TouchWorks / Professional — HL7 FHIR R4",
    authType: "oauth2",
    fhirVersion: "R4",
    popular: false,
    fields: ["baseUrl", "clientId", "clientSecret"],
  },
  {
    id: "athenahealth",
    name: "athenahealth",
    logo: "🔷",
    description: "athenaOne — FHIR R4 via athenahealth API",
    authType: "oauth2",
    fhirVersion: "R4",
    popular: true,
    fields: ["baseUrl", "clientId", "clientSecret", "practiceId"],
  },
  {
    id: "nextgen",
    name: "NextGen Healthcare",
    logo: "🟣",
    description: "NextGen Enterprise — FHIR R4 / HL7 v2",
    authType: "apikey",
    fhirVersion: "R4",
    popular: false,
    fields: ["baseUrl", "apiKey", "practiceId"],
  },
  {
    id: "eclinicalworks",
    name: "eClinicalWorks",
    logo: "🔶",
    description: "eClinicalWorks — FHIR R4 / HL7 CCDA",
    authType: "oauth2",
    fhirVersion: "R4",
    popular: false,
    fields: ["baseUrl", "clientId", "clientSecret"],
  },
  {
    id: "custom_fhir",
    name: "Custom FHIR Server",
    logo: "⚙️",
    description: "Any FHIR R4-compliant server (Medplum, HAPI FHIR, Azure FHIR, etc.)",
    authType: "bearer",
    fhirVersion: "R4",
    popular: false,
    fields: ["baseUrl", "bearerToken"],
  },
];

// IDR-relevant FHIR resource mappings
const FIELD_MAPPINGS = [
  { fhirResource: "Claim", fhirField: "total.value", idrField: "billedAmount", label: "Billed Amount", required: true },
  { fhirResource: "Coverage", fhirField: "payor[0].display", idrField: "respondingPartyName", label: "Payer Name", required: true },
  { fhirResource: "Claim", fhirField: "type.coding[0].code", idrField: "serviceType", label: "Service Type", required: true },
  { fhirResource: "Claim", fhirField: "billablePeriod.start", idrField: "serviceDate", label: "Service Date", required: true },
  { fhirResource: "Organization", fhirField: "address[0].state", idrField: "facilityState", label: "Facility State", required: true },
  { fhirResource: "Patient", fhirField: "address[0].state", idrField: "patientState", label: "Patient State", required: true },
  { fhirResource: "Practitioner", fhirField: "identifier[0].value", idrField: "initiatingPartyNpi", label: "Provider NPI", required: false },
  { fhirResource: "ExplanationOfBenefit", fhirField: "payment.amount.value", idrField: "qpaAmount", label: "QPA / Allowed Amount", required: false },
];

// ── Step definitions ──────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, title: "Select EMR System", icon: Database, description: "Choose your EMR platform" },
  { id: 2, title: "Credentials", icon: Key, description: "Configure API access" },
  { id: 3, title: "Field Mapping", icon: Map, description: "Map FHIR fields to IDR" },
  { id: 4, title: "AI Test Connection", icon: Zap, description: "Validate with AI agent" },
  { id: 5, title: "Activate", icon: Power, description: "Enable the integration" },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function EMROnboarding() {
  const [, navigate] = useLocation();
  const { user } = useAuth();

  const [step, setStep] = useState(1);
  const [selectedEMR, setSelectedEMR] = useState<typeof EMR_SYSTEMS[0] | null>(null);
  const [connectionName, setConnectionName] = useState("");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>(
    Object.fromEntries(FIELD_MAPPINGS.map(m => [m.idrField, m.fhirField]))
  );
  const [testResult, setTestResult] = useState<null | {
    success: boolean;
    message: string;
    resourcesFound: string[];
    mappingValidation: { field: string; status: string; sample?: string }[];
    aiAnalysis: string;
    confidence: number;
  }>(null);
  const [isTesting, setIsTesting] = useState(false);

  // tRPC mutations
  const createEMRConnection = trpc.emr.create.useMutation({
    onSuccess: () => {
      toast.success("EMR connection activated successfully!");
      navigate("/emr-connections");
    },
    onError: (err) => toast.error(`Failed to create connection: ${err.message}`),
  });

  const testEMRConnection = trpc.emr.test.useMutation({
    onSuccess: (data) => {
      setTestResult(data);
      setIsTesting(false);
    },
    onError: (err) => {
      setTestResult({
        success: false,
        message: err.message,
        resourcesFound: [],
        mappingValidation: [],
        aiAnalysis: "Connection test failed. Please verify your credentials and base URL.",
        confidence: 0,
      });
      setIsTesting(false);
    },
  });

  const progress = ((step - 1) / (STEPS.length - 1)) * 100;

  const handleCredentialChange = (field: string, value: string) => {
    setCredentials(prev => ({ ...prev, [field]: value }));
  };

  const handleMappingChange = (idrField: string, value: string) => {
    setFieldMappings(prev => ({ ...prev, [idrField]: value }));
  };

  const canProceed = () => {
    if (step === 1) return selectedEMR !== null && connectionName.trim().length > 0;
    if (step === 2) {
      if (!selectedEMR) return false;
      return selectedEMR.fields.every(f => credentials[f]?.trim());
    }
    if (step === 3) return true;
    if (step === 4) return testResult?.success === true;
    return true;
  };

  const handleRunTest = () => {
    if (!selectedEMR) return;
    setIsTesting(true);
    setTestResult(null);
    testEMRConnection.mutate({
      emrSystem: selectedEMR.id,
      baseUrl: credentials.baseUrl || "",
      credentials: credentials,
      fieldMappings,
    });
  };

  const handleActivate = () => {
    if (!selectedEMR || !testResult?.success) return;
    createEMRConnection.mutate({
      name: connectionName,
      emrSystem: selectedEMR.id,
      authType: selectedEMR.authType,
      baseUrl: credentials.baseUrl || "",
      credentials,
      fieldMappings,
      fhirVersion: selectedEMR.fhirVersion,
    });
  };

  // ── Render steps ────────────────────────────────────────────────────────────

  const renderStep1 = () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="conn-name">Connection Name</Label>
        <Input
          id="conn-name"
          placeholder="e.g., Main Campus Epic — Production"
          value={connectionName}
          onChange={e => setConnectionName(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">A descriptive name to identify this EMR connection in the platform.</p>
      </div>
      <Separator />
      <div>
        <p className="text-sm font-medium mb-3">Select your EMR system</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {EMR_SYSTEMS.map(emr => (
            <button
              key={emr.id}
              onClick={() => setSelectedEMR(emr)}
              className={`text-left p-4 rounded-lg border-2 transition-all hover:border-primary/60 ${
                selectedEMR?.id === emr.id
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{emr.logo}</span>
                  <div>
                    <div className="font-semibold text-sm flex items-center gap-2">
                      {emr.name}
                      {emr.popular && <Badge variant="secondary" className="text-xs">Popular</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{emr.description}</div>
                  </div>
                </div>
                {selectedEMR?.id === emr.id && (
                  <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                )}
              </div>
              <div className="mt-2 flex gap-2">
                <Badge variant="outline" className="text-xs">FHIR {emr.fhirVersion}</Badge>
                <Badge variant="outline" className="text-xs capitalize">{emr.authType}</Badge>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderStep2 = () => {
    if (!selectedEMR) return null;
    const fieldLabels: Record<string, { label: string; type: string; placeholder: string; help: string }> = {
      baseUrl: { label: "FHIR Base URL", type: "url", placeholder: "https://fhir.example.org/R4", help: "The root URL of the FHIR R4 server (no trailing slash)" },
      clientId: { label: "Client ID", type: "text", placeholder: "your-client-id", help: "OAuth 2.0 client ID from your EMR's developer portal" },
      clientSecret: { label: "Client Secret", type: "password", placeholder: "••••••••••••", help: "OAuth 2.0 client secret — stored encrypted" },
      scope: { label: "OAuth Scope", type: "text", placeholder: "launch/patient patient/*.read", help: "Space-separated SMART on FHIR scopes" },
      tenantId: { label: "Tenant ID", type: "text", placeholder: "your-tenant-id", help: "Cerner tenant / organization identifier" },
      apiKey: { label: "API Key", type: "password", placeholder: "••••••••••••", help: "API key from your EMR vendor — stored encrypted" },
      facilityId: { label: "Facility ID", type: "text", placeholder: "FAC001", help: "Your facility identifier in the EMR system" },
      practiceId: { label: "Practice ID", type: "text", placeholder: "123456", help: "Your practice identifier in the EMR system" },
      bearerToken: { label: "Bearer Token", type: "password", placeholder: "••••••••••••", help: "Static bearer token for FHIR server authentication" },
    };

    return (
      <div className="space-y-5">
        <Alert>
          <Shield className="h-4 w-4" />
          <AlertDescription>
            All credentials are encrypted at rest using AES-256 and never logged. Only the connection test agent can access them during validation.
          </AlertDescription>
        </Alert>
        {selectedEMR.fields.map(field => {
          const meta = fieldLabels[field] || { label: field, type: "text", placeholder: "", help: "" };
          return (
            <div key={field} className="space-y-1.5">
              <Label htmlFor={field}>{meta.label} <span className="text-destructive">*</span></Label>
              <Input
                id={field}
                type={meta.type}
                placeholder={meta.placeholder}
                value={credentials[field] || ""}
                onChange={e => handleCredentialChange(field, e.target.value)}
                autoComplete="off"
              />
              {meta.help && <p className="text-xs text-muted-foreground">{meta.help}</p>}
            </div>
          );
        })}
        {selectedEMR.authType === "oauth2" && (
          <Alert variant="default" className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-800 dark:text-blue-200">
              For OAuth 2.0 systems, register <strong>https://your-domain.manus.space/api/oauth/emr/callback</strong> as the redirect URI in your EMR developer portal before testing.
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  };

  const renderStep3 = () => (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          These mappings tell the AI agent which FHIR resource fields to read when auto-populating IDR dispute forms. The defaults follow standard FHIR R4 paths — adjust only if your EMR uses custom extensions.
        </AlertDescription>
      </Alert>
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">IDR Field</th>
              <th className="text-left p-3 font-medium">FHIR Resource</th>
              <th className="text-left p-3 font-medium">FHIR Path</th>
              <th className="text-left p-3 font-medium w-8">Req.</th>
            </tr>
          </thead>
          <tbody>
            {FIELD_MAPPINGS.map((mapping, idx) => (
              <tr key={mapping.idrField} className={idx % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                <td className="p-3">
                  <div className="font-medium">{mapping.label}</div>
                  <div className="text-xs text-muted-foreground font-mono">{mapping.idrField}</div>
                </td>
                <td className="p-3">
                  <Badge variant="outline" className="font-mono text-xs">{mapping.fhirResource}</Badge>
                </td>
                <td className="p-3">
                  <Input
                    className="h-7 text-xs font-mono"
                    value={fieldMappings[mapping.idrField] || mapping.fhirField}
                    onChange={e => handleMappingChange(mapping.idrField, e.target.value)}
                  />
                </td>
                <td className="p-3 text-center">
                  {mapping.required
                    ? <span className="text-destructive font-bold">✓</span>
                    : <span className="text-muted-foreground">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-5">
      <div className="text-sm text-muted-foreground">
        The AI agent will attempt a live connection to your EMR, retrieve a sample FHIR Bundle, validate each field mapping, and return a confidence score. No PHI is stored — only structural metadata is used.
      </div>

      {!testResult && !isTesting && (
        <Button onClick={handleRunTest} className="w-full" size="lg">
          <Zap className="mr-2 h-4 w-4" />
          Run AI Connection Test
        </Button>
      )}

      {isTesting && (
        <div className="flex flex-col items-center gap-4 py-8">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <div className="text-sm text-muted-foreground text-center">
            AI agent is connecting to your EMR, validating FHIR endpoints, and checking field mappings…
          </div>
          <div className="flex gap-2 text-xs text-muted-foreground">
            {["Authenticating", "Fetching FHIR metadata", "Validating mappings", "Scoring confidence"].map((s, i) => (
              <span key={s} className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                {s}
                {i < 3 && <span className="ml-1">→</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {testResult && (
        <div className="space-y-4">
          <Alert variant={testResult.success ? "default" : "destructive"} className={testResult.success ? "border-green-300 bg-green-50 dark:bg-green-950/20" : ""}>
            {testResult.success
              ? <CheckCircle2 className="h-4 w-4 text-green-600" />
              : <AlertCircle className="h-4 w-4" />}
            <AlertDescription className={testResult.success ? "text-green-800 dark:text-green-200" : ""}>
              <strong>{testResult.success ? "Connection Successful" : "Connection Failed"}</strong> — {testResult.message}
            </AlertDescription>
          </Alert>

          {testResult.success && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Card>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm">AI Confidence</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="text-3xl font-bold text-green-600">{Math.round(testResult.confidence * 100)}%</div>
                    <Progress value={testResult.confidence * 100} className="mt-2 h-2" />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm">FHIR Resources Found</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="flex flex-wrap gap-1">
                      {testResult.resourcesFound.map(r => (
                        <Badge key={r} variant="secondary" className="text-xs">{r}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm">Field Mapping Validation</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="space-y-2">
                    {testResult.mappingValidation.map(mv => (
                      <div key={mv.field} className="flex items-center justify-between text-sm">
                        <span className="font-mono text-xs">{mv.field}</span>
                        <div className="flex items-center gap-2">
                          {mv.sample && <span className="text-xs text-muted-foreground italic">{mv.sample}</span>}
                          <Badge
                            variant={mv.status === "ok" ? "default" : mv.status === "warning" ? "secondary" : "destructive"}
                            className="text-xs"
                          >
                            {mv.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm text-blue-800 dark:text-blue-200">AI Analysis</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className="text-sm text-blue-700 dark:text-blue-300">{testResult.aiAnalysis}</p>
                </CardContent>
              </Card>
            </>
          )}

          <Button variant="outline" onClick={handleRunTest} className="w-full">
            <RefreshCw className="mr-2 h-4 w-4" />
            Re-run Test
          </Button>
        </div>
      )}
    </div>
  );

  const renderStep5 = () => (
    <div className="space-y-5">
      <Alert className="border-green-300 bg-green-50 dark:bg-green-950/20">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <AlertDescription className="text-green-800 dark:text-green-200">
          All checks passed. Your EMR connection is ready to activate.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Connection Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="text-muted-foreground">Connection Name</div>
            <div className="font-medium">{connectionName}</div>
            <div className="text-muted-foreground">EMR System</div>
            <div className="font-medium">{selectedEMR?.name}</div>
            <div className="text-muted-foreground">FHIR Version</div>
            <div className="font-medium">{selectedEMR?.fhirVersion}</div>
            <div className="text-muted-foreground">Auth Type</div>
            <div className="font-medium capitalize">{selectedEMR?.authType}</div>
            <div className="text-muted-foreground">Base URL</div>
            <div className="font-medium font-mono text-xs break-all">{credentials.baseUrl}</div>
            <div className="text-muted-foreground">Field Mappings</div>
            <div className="font-medium">{Object.keys(fieldMappings).length} configured</div>
            <div className="text-muted-foreground">AI Confidence</div>
            <div className="font-medium text-green-600">{testResult ? `${Math.round(testResult.confidence * 100)}%` : "—"}</div>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-lg border p-4 bg-muted/30 space-y-2">
        <p className="text-sm font-medium">What happens after activation:</p>
        <ul className="text-sm text-muted-foreground space-y-1.5">
          <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> The AI agent will auto-populate dispute forms using live FHIR data from your EMR</li>
          <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Document uploads will be cross-referenced against EMR records for validation</li>
          <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> CMS submission drafts will include EMR-sourced clinical context</li>
          <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> Connection health is monitored daily by the deadline-check heartbeat</li>
        </ul>
      </div>

      <Button
        className="w-full"
        size="lg"
        onClick={handleActivate}
        disabled={createEMRConnection.isPending}
      >
        {createEMRConnection.isPending
          ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Activating…</>
          : <><Power className="mr-2 h-4 w-4" /> Activate EMR Connection</>}
      </Button>
    </div>
  );

  const stepContent = [renderStep1, renderStep2, renderStep3, renderStep4, renderStep5];

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">EMR Integration Onboarding</h1>
        <p className="text-muted-foreground mt-1">
          Connect your Electronic Medical Records system to enable AI-assisted dispute pre-population and document validation.
        </p>
      </div>

      {/* Progress bar */}
      <div className="space-y-3">
        <Progress value={progress} className="h-2" />
        <div className="flex justify-between">
          {STEPS.map(s => {
            const Icon = s.icon;
            const isComplete = step > s.id;
            const isCurrent = step === s.id;
            return (
              <div key={s.id} className={`flex flex-col items-center gap-1 text-center flex-1 ${isCurrent ? "text-primary" : isComplete ? "text-green-600" : "text-muted-foreground"}`}>
                <div className={`rounded-full p-1.5 ${isCurrent ? "bg-primary/10" : isComplete ? "bg-green-100 dark:bg-green-900/30" : "bg-muted"}`}>
                  {isComplete ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </div>
                <span className="text-xs font-medium hidden sm:block">{s.title}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Step card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {(() => { const Icon = STEPS[step - 1].icon; return <Icon className="h-5 w-5 text-primary" />; })()}
            Step {step}: {STEPS[step - 1].title}
          </CardTitle>
          <CardDescription>{STEPS[step - 1].description}</CardDescription>
        </CardHeader>
        <CardContent>
          {stepContent[step - 1]()}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => step > 1 ? setStep(s => s - 1) : navigate("/emr-connections")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {step === 1 ? "Cancel" : "Back"}
        </Button>
        {step < 5 ? (
          <Button onClick={() => setStep(s => s + 1)} disabled={!canProceed()}>
            Continue
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
