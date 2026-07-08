import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import DashboardLayout from "@/components/DashboardLayout";
import { Scale, Search, AlertTriangle, CheckCircle2, Info, ExternalLink } from "lucide-react";

// Comprehensive state balance billing law database
const STATE_LAWS: Record<string, {
  state: string;
  code: string;
  hasLaw: boolean;
  lawName?: string;
  effectiveDate?: string;
  scope: string;
  idrProcess: string;
  nsaInteraction: string;
  keyProvisions: string[];
  referenceUrl?: string;
  protectionLevel: "strong" | "moderate" | "limited" | "none";
}> = {
  CA: {
    state: "California", code: "CA", hasLaw: true,
    lawName: "AB 72 (2017) / SB 1021 (2022)",
    effectiveDate: "July 1, 2017",
    scope: "All commercial plans regulated by DMHC or CDI, including HMOs and PPOs",
    idrProcess: "Independent Dispute Resolution (IDR) via DMHC or CDI — binding arbitration for disputed amounts",
    nsaInteraction: "California law applies to state-regulated plans; NSA applies to self-funded ERISA plans. Dual-track compliance required.",
    keyProvisions: [
      "Patients pay only in-network cost-sharing for emergency and involuntary out-of-network services",
      "Providers must accept payment + patient cost-sharing as payment in full",
      "IDR available for disputes between $750 and $750,000",
      "Hold harmless protections for patients"
    ],
    referenceUrl: "https://www.dmhc.ca.gov/HealthCareinCalifornia/HealthPlanInformation/BalanceBilling.aspx",
    protectionLevel: "strong",
  },
  NY: {
    state: "New York", code: "NY", hasLaw: true,
    lawName: "NY Financial Services Law § 603-a (2015)",
    effectiveDate: "March 31, 2015",
    scope: "State-regulated commercial health insurance plans",
    idrProcess: "Independent Dispute Resolution Organization (IDRO) — binding arbitration",
    nsaInteraction: "NY law predates NSA. For state-regulated plans, NY IDR applies. For ERISA self-funded plans, NSA applies.",
    keyProvisions: [
      "Surprise billing protections for emergency and non-emergency out-of-network services",
      "Patient cost-sharing capped at in-network amounts",
      "30-day open negotiation period before IDR",
      "Baseball-style arbitration for disputed amounts"
    ],
    referenceUrl: "https://www.dfs.ny.gov/consumers/health_insurance/balance_billing",
    protectionLevel: "strong",
  },
  TX: {
    state: "Texas", code: "TX", hasLaw: true,
    lawName: "HB 1941 (2019) / SB 1264 (2021)",
    effectiveDate: "January 1, 2020",
    scope: "State-regulated fully-insured health benefit plans",
    idrProcess: "Texas Department of Insurance (TDI) IDR — independent arbitration",
    nsaInteraction: "Texas state law covers state-regulated plans. NSA covers ERISA self-funded plans. Providers must track which framework applies per claim.",
    keyProvisions: [
      "Surprise billing ban for emergency services and certain non-emergency out-of-network services",
      "Patient cost-sharing at in-network rates",
      "Mediation available for claims $500+",
      "Arbitration for claims $5,000+ (physicians) or $75,000+ (facilities)"
    ],
    referenceUrl: "https://www.tdi.texas.gov/medical-billing/",
    protectionLevel: "strong",
  },
  FL: {
    state: "Florida", code: "FL", hasLaw: true,
    lawName: "Florida Balance Billing Protection Act (2016)",
    effectiveDate: "July 1, 2016",
    scope: "Fully-insured HMO and PPO plans regulated by Florida OIR",
    idrProcess: "Mediation through Florida Department of Financial Services",
    nsaInteraction: "Florida law applies to state-regulated plans. NSA governs ERISA self-funded plans.",
    keyProvisions: [
      "Prohibits balance billing for emergency services",
      "Requires notice and consent for non-emergency out-of-network services",
      "Mediation available for disputed amounts",
      "Penalties for non-compliant providers"
    ],
    referenceUrl: "https://www.myfloridacfo.com/division/consumers/balance-billing",
    protectionLevel: "moderate",
  },
  IL: {
    state: "Illinois", code: "IL", hasLaw: true,
    lawName: "Surprise Billing Protection Act (2021)",
    effectiveDate: "January 1, 2022",
    scope: "State-regulated commercial health insurance plans",
    idrProcess: "Illinois Department of Insurance IDR process",
    nsaInteraction: "Illinois law aligns closely with NSA. For state-regulated plans, Illinois IDR applies.",
    keyProvisions: [
      "Comprehensive surprise billing protections mirroring NSA",
      "Patient cost-sharing at in-network rates",
      "30-day open negotiation period",
      "Independent dispute resolution for unresolved claims"
    ],
    referenceUrl: "https://insurance.illinois.gov/Consumers/SurpriseBilling.aspx",
    protectionLevel: "strong",
  },
  WA: {
    state: "Washington", code: "WA", hasLaw: true,
    lawName: "SB 5526 (2019)",
    effectiveDate: "January 1, 2020",
    scope: "State-regulated health plans",
    idrProcess: "Office of the Insurance Commissioner (OIC) arbitration",
    nsaInteraction: "Washington state law applies to state-regulated plans. NSA applies to self-funded ERISA plans.",
    keyProvisions: [
      "Surprise billing protections for emergency and non-emergency services",
      "Patient cost-sharing capped at in-network amounts",
      "Arbitration for disputes between providers and payers"
    ],
    referenceUrl: "https://www.insurance.wa.gov/surprise-billing",
    protectionLevel: "strong",
  },
  CO: {
    state: "Colorado", code: "CO", hasLaw: true,
    lawName: "HB 19-1174 (2019)",
    effectiveDate: "January 1, 2020",
    scope: "State-regulated health benefit plans",
    idrProcess: "Colorado Division of Insurance IDR",
    nsaInteraction: "Colorado law covers state-regulated plans. NSA covers ERISA self-funded plans.",
    keyProvisions: [
      "Surprise billing ban for emergency services",
      "Patient hold-harmless protections",
      "Dispute resolution process for provider-payer disputes"
    ],
    referenceUrl: "https://doi.colorado.gov/consumers/surprise-billing",
    protectionLevel: "moderate",
  },
  GA: { state: "Georgia", code: "GA", hasLaw: false, scope: "No state surprise billing law — NSA is primary protection", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is the sole protection for all plan types in Georgia.", keyProvisions: ["NSA applies to all self-funded ERISA plans", "State-regulated plans have limited state-level protections"], protectionLevel: "none" },
  OH: { state: "Ohio", code: "OH", hasLaw: false, scope: "No comprehensive state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA governs. Ohio has limited state-level provisions.", keyProvisions: ["NSA applies to ERISA self-funded plans", "Limited state protections for fully-insured plans"], protectionLevel: "limited" },
  PA: { state: "Pennsylvania", code: "PA", hasLaw: false, scope: "No state surprise billing law", idrProcess: "Federal NSA IDR process applies", nsaInteraction: "NSA is primary protection in Pennsylvania.", keyProvisions: ["NSA applies to all applicable plan types"], protectionLevel: "none" },
};

const PROTECTION_COLORS: Record<string, string> = {
  strong: "bg-green-100 text-green-700 border-green-200",
  moderate: "bg-amber-100 text-amber-700 border-amber-200",
  limited: "bg-orange-100 text-orange-700 border-orange-200",
  none: "bg-slate-100 text-slate-600 border-slate-200",
};

export default function StateBalanceBilling() {
  const { isAuthenticated } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [aiAnalysis, setAIAnalysis] = useState<string | null>(null);
  const [aiLoading, setAILoading] = useState(false);
  const utils = trpc.useUtils();

  const askAssistant = trpc.ai.askAssistant.useMutation({
    onSuccess: (result: any) => {
      setAIAnalysis(result?.answer ?? "");
      setAILoading(false);
    },
    onError: () => setAILoading(false),
  });

  const filteredStates = Object.values(STATE_LAWS).filter(s =>
    s.state.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selected = selectedState ? STATE_LAWS[selectedState] : null;

  const handleAIAnalysis = (stateCode: string) => {
    const law = STATE_LAWS[stateCode];
    if (!law) return;
    setAILoading(true);
    setAIAnalysis(null);
    askAssistant.mutate({
      question: `Provide a concise compliance analysis for a healthcare provider operating in ${law.state}: How does ${law.hasLaw ? law.lawName : "the NSA"} interact with the federal No Surprises Act? What are the key compliance obligations, and what are the most common pitfalls providers face in this state?`,
      conversationHistory: [],
    });
  };

  if (!isAuthenticated) return null;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <Scale size={24} className="text-blue-600" />
              State Balance Billing Laws
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              State-level surprise billing protections and their interaction with the federal No Surprises Act
            </p>
          </div>
          <Badge variant="secondary" className="text-xs">
            {Object.values(STATE_LAWS).filter(s => s.hasLaw).length} states with laws
          </Badge>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search by state name or code…"
            className="pl-9 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* State List */}
          <div className="lg:col-span-1 space-y-2">
            {filteredStates.map(law => (
              <button
                key={law.code}
                onClick={() => { setSelectedState(law.code); setAIAnalysis(null); }}
                className={`w-full text-left p-3 rounded-lg border transition-all ${
                  selectedState === law.code
                    ? "border-blue-400 bg-blue-50 shadow-sm"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800 text-sm w-8">{law.code}</span>
                    <span className="text-sm text-slate-600">{law.state}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${PROTECTION_COLORS[law.protectionLevel]}`}>
                    {law.protectionLevel}
                  </span>
                </div>
                {law.hasLaw && (
                  <p className="text-xs text-slate-400 mt-1 truncate">{law.lawName}</p>
                )}
              </button>
            ))}
            {filteredStates.length === 0 && (
              <div className="text-center py-8 text-slate-400 text-sm">No states match your search</div>
            )}
          </div>

          {/* State Detail */}
          <div className="lg:col-span-2">
            {!selected ? (
              <Card className="border-slate-200">
                <CardContent className="flex flex-col items-center justify-center py-20 text-slate-400">
                  <Scale size={40} className="mb-3 opacity-30" />
                  <p className="text-sm">Select a state to view its balance billing law details</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <Card className="border-slate-200">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg font-bold text-slate-800">{selected.state}</CardTitle>
                        {selected.hasLaw ? (
                          <p className="text-sm text-blue-600 font-medium mt-0.5">{selected.lawName}</p>
                        ) : (
                          <p className="text-sm text-slate-500 mt-0.5">No state-specific surprise billing law</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${PROTECTION_COLORS[selected.protectionLevel]}`}>
                          {selected.protectionLevel.toUpperCase()} PROTECTION
                        </span>
                        {selected.hasLaw && (
                          <Badge variant="default" className="bg-green-600 text-xs">Law Active</Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selected.effectiveDate && (
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                        <span>Effective: <strong>{selected.effectiveDate}</strong></span>
                      </div>
                    )}

                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Scope</h4>
                      <p className="text-sm text-slate-700">{selected.scope}</p>
                    </div>

                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">IDR Process</h4>
                      <p className="text-sm text-slate-700">{selected.idrProcess}</p>
                    </div>

                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
                        <div>
                          <h4 className="text-xs font-semibold text-amber-800 mb-1">NSA Interaction</h4>
                          <p className="text-sm text-amber-700">{selected.nsaInteraction}</p>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Key Provisions</h4>
                      <ul className="space-y-1.5">
                        {selected.keyProvisions.map((p, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                            <CheckCircle2 size={13} className="text-blue-500 mt-0.5 shrink-0" />
                            {p}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {selected.referenceUrl && (
                      <a
                        href={selected.referenceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
                      >
                        <ExternalLink size={13} />
                        Official State Reference
                      </a>
                    )}

                    <div className="pt-2 border-t border-slate-100">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAIAnalysis(selected.code)}
                        disabled={aiLoading}
                        className="text-purple-600 border-purple-200 hover:bg-purple-50"
                      >
                        {aiLoading ? (
                          <><span className="animate-spin mr-1.5">⧗</span>Analysing…</>
                        ) : (
                          <>✦ AI Compliance Analysis</>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* AI Analysis Card */}
                {aiAnalysis && (
                  <Card className="border-purple-200 bg-purple-50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold text-purple-800 flex items-center gap-2">
                        <Info size={14} />
                        AI Compliance Analysis — {selected.state}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-purple-900 whitespace-pre-wrap leading-relaxed">{aiAnalysis}</p>
                      <p className="text-xs text-purple-500 mt-3">
                        This analysis is generated by the IDRAssistantAgent and is for informational purposes only. Consult qualified legal counsel for compliance decisions.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
