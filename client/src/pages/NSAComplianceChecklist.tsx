import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Shield, CheckCircle2, AlertTriangle, Info, Download, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  required: boolean;
  reference: string;
}

interface ChecklistSection {
  id: string;
  title: string;
  icon: string;
  items: ChecklistItem[];
}

// Static checklist content (labels/descriptions) — state is DB-backed
const CHECKLIST: ChecklistSection[] = [
  {
    id: "eligibility",
    title: "Eligibility & Qualifying Payment",
    icon: "📋",
    items: [
      { id: "e1", label: "Service is an emergency or out-of-network item/service", required: true, description: "Confirm the disputed service falls under NSA scope (emergency, non-emergency out-of-network, or air ambulance).", reference: "NSA §2799A-1" },
      { id: "e2", label: "Patient received surprise bill (no prior consent)", required: true, description: "Verify the patient did not sign a valid consent form for out-of-network care.", reference: "NSA §2799B-2" },
      { id: "e3", label: "Open negotiation period completed (30 business days)", required: true, description: "The 30-business-day open negotiation period must have elapsed before initiating IDR.", reference: "45 CFR §149.510(b)" },
      { id: "e4", label: "IDR initiated within 4 business days of open negotiation end", required: true, description: "The IDR request must be filed within 4 business days after the open negotiation period ends.", reference: "45 CFR §149.510(c)" },
      { id: "e5", label: "Qualifying payment amount (QPA) calculated correctly", required: true, description: "The QPA must reflect the median in-network rate for the item or service in the geographic area.", reference: "45 CFR §149.140" },
    ],
  },
  {
    id: "documentation",
    title: "Required Documentation",
    icon: "📄",
    items: [
      { id: "d1", label: "Explanation of Benefits (EOB) attached", required: true, description: "Attach the payer's EOB showing the QPA and initial payment or denial.", reference: "45 CFR §149.510(c)(1)" },
      { id: "d2", label: "Remittance Advice (RA) attached", required: false, description: "Include the RA if a partial payment was made.", reference: "45 CFR §149.510(c)(2)" },
      { id: "d3", label: "Open negotiation notice attached", required: true, description: "Include the original open negotiation notice sent to the payer.", reference: "45 CFR §149.510(b)(1)" },
      { id: "d4", label: "Itemized bill attached", required: false, description: "Attach the itemized bill for the disputed service.", reference: "CMS IDR Guidance" },
      { id: "d5", label: "Supporting clinical documentation attached", required: false, description: "Include any clinical records that support the provider's offer amount.", reference: "45 CFR §149.510(c)(3)" },
      { id: "d6", label: "Provider's offer amount documented", required: true, description: "The provider must submit a specific dollar offer for the disputed service.", reference: "45 CFR §149.510(c)(4)" },
    ],
  },
  {
    id: "entity",
    title: "Certified IDR Entity",
    icon: "🏛️",
    items: [
      { id: "en1", label: "Certified IDR entity selected within 3 business days", required: true, description: "Both parties must jointly select a certified IDR entity within 3 business days of IDR initiation.", reference: "45 CFR §149.510(c)(5)" },
      { id: "en2", label: "IDR entity conflict of interest check completed", required: true, description: "The selected entity must not have a conflict of interest with either party.", reference: "45 CFR §149.510(c)(6)" },
      { id: "en3", label: "IDR entity fee paid", required: true, description: "The administrative fee must be paid to the certified IDR entity.", reference: "45 CFR §149.510(c)(7)" },
    ],
  },
  {
    id: "arbitration",
    title: "Arbitration Process",
    icon: "⚖️",
    items: [
      { id: "a1", label: "Additional information submitted within 10 business days", required: false, description: "Either party may submit additional information within 10 business days of entity selection.", reference: "45 CFR §149.510(c)(8)" },
      { id: "a2", label: "Preliminary payment made (if applicable)", required: false, description: "If the payer made a preliminary payment, document the amount.", reference: "NSA §2799A-1(c)" },
      { id: "a3", label: "Offers submitted to IDR entity", required: true, description: "Both parties must submit their final offers to the IDR entity.", reference: "45 CFR §149.510(c)(9)" },
      { id: "a4", label: "Determination received within 30 business days", required: true, description: "The IDR entity must issue a written determination within 30 business days.", reference: "45 CFR §149.510(c)(10)" },
    ],
  },
  {
    id: "payment",
    title: "Post-Determination Payment",
    icon: "💰",
    items: [
      { id: "p1", label: "Payment made within 30 calendar days of determination", required: true, description: "The losing party must pay the determined amount within 30 calendar days.", reference: "NSA §2799A-1(c)(3)" },
      { id: "p2", label: "Payment confirmation documented", required: true, description: "Retain proof of payment for audit purposes.", reference: "CMS IDR Guidance" },
      { id: "p3", label: "Dispute outcome recorded in system", required: true, description: "Update the dispute status and record the final determined amount.", reference: "Internal Policy" },
    ],
  },
];

export default function NSAComplianceChecklist() {
  const { isAuthenticated } = useAuth();
  const [localChecked, setLocalChecked] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(CHECKLIST.map(s => [s.id, true]))
  );

  const utils = trpc.useUtils();

  // Load persisted state from DB
  const { data: dbState, isLoading } = trpc.compliance.list.useQuery({}, { enabled: isAuthenticated });

  // Sync DB state into local state once loaded
  // DB key = sectionKey + ":" + itemKey, status "compliant" = checked
  useEffect(() => {
    if (dbState) {
      const map: Record<string, boolean> = {};
      dbState.forEach(row => { map[`${row.sectionKey}:${row.itemKey}`] = row.status === "compliant"; });
      setLocalChecked(map);
    }
  }, [dbState]);

  const upsertMutation = trpc.compliance.upsert.useMutation({
    onError: (e) => toast.error(`Failed to save: ${e.message}`),
    onSuccess: () => utils.compliance.list.invalidate({}),
  });

  const resetMutation = trpc.compliance.reset.useMutation({
    onSuccess: () => {
      setLocalChecked({});
      utils.compliance.list.invalidate({});
      toast.success("Checklist reset");
    },
    onError: (e) => toast.error(e.message),
  });

  // id is the item's short id (e.g. "e1"). We need to find its section to build the DB key.
  const toggle = (id: string) => {
    const section = CHECKLIST.find(s => s.items.some(i => i.id === id));
    if (!section) return;
    const dbKey = `${section.id}:${id}`;
    const next = !localChecked[dbKey];
    setLocalChecked(prev => ({ ...prev, [dbKey]: next }));
    upsertMutation.mutate({ sectionKey: section.id, itemKey: id, status: next ? "compliant" : "pending_review" });
  };

  const toggleSection = (id: string) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  const allItems = CHECKLIST.flatMap(s => s.items);
  const requiredItems = allItems.filter(i => i.required);
  // Build DB key for each item to check completion
  const getDbKey = (item: ChecklistItem) => {
    const section = CHECKLIST.find(s => s.items.some(si => si.id === item.id));
    return section ? `${section.id}:${item.id}` : item.id;
  };
  const completedRequired = requiredItems.filter(i => localChecked[getDbKey(i)]).length;
  const completedAll = allItems.filter(i => localChecked[getDbKey(i)]).length;
  const progress = requiredItems.length > 0 ? Math.round((completedRequired / requiredItems.length) * 100) : 0;

  const exportCSV = () => {
    const rows = [["Section", "Item", "Required", "Status", "Reference"]];
    CHECKLIST.forEach(section => {
      section.items.forEach(item => {
        rows.push([section.title, item.label, item.required ? "Yes" : "No", localChecked[item.id] ? "Complete" : "Pending", item.reference]);
      });
    });
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `nsa-compliance-${new Date().toISOString().split("T")[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success("Compliance checklist exported");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-blue-600" />
            NSA Compliance Checklist
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track regulatory compliance for No Surprises Act IDR disputes — progress saved to your account
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={isLoading}>
            <Download className="h-4 w-4 mr-2" />Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => resetMutation.mutate({})} disabled={resetMutation.isPending}>
            <RefreshCw className="h-4 w-4 mr-2" />Reset
          </Button>
        </div>
      </div>

      {/* Progress summary */}
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {progress === 100 ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                  )}
                  <span className="font-semibold">
                    {progress === 100 ? "All required items complete" : `${completedRequired} of ${requiredItems.length} required items complete`}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span>{completedAll}/{allItems.length} total</span>
                  <Badge variant={progress === 100 ? "default" : "secondary"}>{progress}%</Badge>
                </div>
              </div>
              <Progress value={progress} className="h-2" />
            </>
          )}
        </CardContent>
      </Card>

      {/* Sections */}
      {CHECKLIST.map(section => {
        const sectionItems = section.items;
        const sectionCompleted = sectionItems.filter(i => localChecked[`${section.id}:${i.id}`]).length;
        const isExpanded = expanded[section.id];

        return (
          <Card key={section.id}>
            <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleSection(section.id)}>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <span>{section.icon}</span>
                  {section.title}
                  <Badge variant="outline" className="text-xs font-normal">
                    {sectionCompleted}/{sectionItems.length}
                  </Badge>
                </CardTitle>
                {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </div>
            </CardHeader>
            {isExpanded && (
              <CardContent className="space-y-3 pt-0">
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
                ) : (
                  sectionItems.map(item => (
                    <div key={item.id} className={`flex items-start gap-3 p-3 rounded-lg border ${localChecked[`${section.id}:${item.id}`] ? "bg-green-50 dark:bg-green-950/10 border-green-200 dark:border-green-800" : "bg-card"}`}>
                      <Checkbox
                        id={item.id}
                        checked={!!localChecked[`${section.id}:${item.id}`]}
                        onCheckedChange={() => toggle(item.id)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <label htmlFor={item.id} className="flex items-center gap-2 cursor-pointer font-medium text-sm">
                          {item.label}
                          {item.required && <Badge variant="destructive" className="text-xs">Required</Badge>}
                          {localChecked[`${section.id}:${item.id}`] && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                        </label>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                        <div className="flex items-center gap-1 mt-1">
                          <Info className="h-3 w-3 text-blue-400" />
                          <span className="text-xs text-blue-600 dark:text-blue-400">{item.reference}</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
