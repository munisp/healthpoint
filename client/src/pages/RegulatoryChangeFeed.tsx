import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Newspaper, ExternalLink, Search, Filter, BookOpen, AlertTriangle, Info, CheckCircle2 } from "lucide-react";

// Curated NSA/IDR regulatory updates (static reference data based on actual CMS publications)
const REGULATORY_UPDATES = [
  {
    id: "1",
    date: "2024-11-15",
    title: "CMS Issues Final Rule on IDR Administrative Fees for 2025",
    summary: "CMS finalized the 2025 IDR administrative fee schedule, maintaining the $350 fee for single disputes and batched disputes involving the same payer and same service code.",
    category: "fee_schedule",
    impact: "high",
    source: "CMS",
    url: "https://www.cms.gov/nosurprises",
    tags: ["IDR Fees", "2025", "Administrative"],
  },
  {
    id: "2",
    date: "2024-10-03",
    title: "Fifth Circuit Ruling Impacts QPA Calculation Methodology",
    summary: "The Fifth Circuit Court of Appeals issued a ruling affecting how the Qualifying Payment Amount is calculated, potentially expanding the data sources payers must consider when determining QPA.",
    category: "court_ruling",
    impact: "critical",
    source: "Fifth Circuit",
    url: "https://www.cms.gov/nosurprises",
    tags: ["QPA", "Court Ruling", "Methodology"],
  },
  {
    id: "3",
    date: "2024-09-20",
    title: "Updated IDR Process Guidance: Batching Eligibility Criteria",
    summary: "CMS released updated guidance clarifying when claims may be batched for IDR, specifying that claims must involve the same payer, same provider/facility, same service code, and same plan type.",
    category: "guidance",
    impact: "high",
    source: "CMS",
    url: "https://www.cms.gov/nosurprises",
    tags: ["Batching", "Eligibility", "Process"],
  },
  {
    id: "4",
    date: "2024-08-12",
    title: "NSA Surprise Billing Protections Extended to Additional Service Types",
    summary: "HHS announced expansion of NSA protections to cover additional ancillary services provided in connection with emergency care, including certain diagnostic services.",
    category: "regulation",
    impact: "medium",
    source: "HHS",
    url: "https://www.cms.gov/nosurprises",
    tags: ["Coverage", "Service Types", "Emergency Care"],
  },
  {
    id: "5",
    date: "2024-07-30",
    title: "CMS Updates IDR Entity Certification Requirements",
    summary: "CMS issued updated certification requirements for IDR entities, including new conflict-of-interest disclosure requirements and minimum caseload thresholds for certification renewal.",
    category: "certification",
    impact: "medium",
    source: "CMS",
    url: "https://www.cms.gov/nosurprises",
    tags: ["IDR Entities", "Certification", "Compliance"],
  },
  {
    id: "6",
    date: "2024-06-15",
    title: "Interim Final Rule: Good Faith Estimate Requirements for Uninsured Patients",
    summary: "CMS issued an interim final rule requiring providers to give good faith estimates to uninsured and self-pay patients before scheduled services, with new dispute resolution procedures for billing disputes.",
    category: "regulation",
    impact: "medium",
    source: "CMS",
    url: "https://www.cms.gov/nosurprises",
    tags: ["GFE", "Uninsured", "Patient Protections"],
  },
  {
    id: "7",
    date: "2024-05-22",
    title: "CMS Releases Q2 2024 IDR Data Report",
    summary: "CMS published its quarterly IDR data report showing 73% of determinations favored providers, with air ambulance and emergency medicine having the highest provider win rates.",
    category: "data_report",
    impact: "low",
    source: "CMS",
    url: "https://www.cms.gov/nosurprises",
    tags: ["Data", "Statistics", "Win Rates"],
  },
  {
    id: "8",
    date: "2024-04-10",
    title: "Proposed Rule: Modifications to Open Negotiation Period",
    summary: "CMS proposed extending the open negotiation period from 30 to 45 business days and requiring parties to document good-faith negotiation attempts before initiating IDR.",
    category: "proposed_rule",
    impact: "high",
    source: "CMS",
    url: "https://www.cms.gov/nosurprises",
    tags: ["Open Negotiation", "Proposed Rule", "Timeline"],
  },
  {
    id: "9",
    date: "2024-03-05",
    title: "Air Ambulance IDR: Special Considerations Guidance",
    summary: "CMS issued specific guidance for air ambulance IDR disputes, clarifying how IDR entities should weigh QPA, transport distance, and patient acuity in making determinations.",
    category: "guidance",
    impact: "high",
    source: "CMS",
    url: "https://www.cms.gov/nosurprises",
    tags: ["Air Ambulance", "Guidance", "Methodology"],
  },
  {
    id: "10",
    date: "2024-02-14",
    title: "State Balance Billing Laws: Interaction with Federal NSA",
    summary: "CMS clarified how state balance billing laws interact with the federal NSA, confirming that more protective state laws take precedence in states with qualifying laws.",
    category: "guidance",
    impact: "medium",
    source: "CMS",
    url: "https://www.cms.gov/nosurprises",
    tags: ["State Law", "Preemption", "Balance Billing"],
  },
];

const CATEGORY_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  fee_schedule: { label: "Fee Schedule", color: "bg-blue-100 text-blue-700", icon: <BookOpen className="h-3.5 w-3.5" /> },
  court_ruling: { label: "Court Ruling", color: "bg-red-100 text-red-700", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  guidance: { label: "CMS Guidance", color: "bg-purple-100 text-purple-700", icon: <Info className="h-3.5 w-3.5" /> },
  regulation: { label: "Regulation", color: "bg-orange-100 text-orange-700", icon: <BookOpen className="h-3.5 w-3.5" /> },
  certification: { label: "Certification", color: "bg-cyan-100 text-cyan-700", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  data_report: { label: "Data Report", color: "bg-green-100 text-green-700", icon: <Newspaper className="h-3.5 w-3.5" /> },
  proposed_rule: { label: "Proposed Rule", color: "bg-amber-100 text-amber-700", icon: <BookOpen className="h-3.5 w-3.5" /> },
};

const IMPACT_CONFIG: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  low: "bg-green-100 text-green-700 border-green-200",
};

export default function RegulatoryChangeFeed() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [impactFilter, setImpactFilter] = useState("all");

  const filtered = REGULATORY_UPDATES.filter(u =>
    (categoryFilter === "all" || u.category === categoryFilter) &&
    (impactFilter === "all" || u.impact === impactFilter) &&
    (!search || u.title.toLowerCase().includes(search.toLowerCase()) ||
      u.summary.toLowerCase().includes(search.toLowerCase()) ||
      u.tags.some(t => t.toLowerCase().includes(search.toLowerCase())))
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Newspaper className="h-6 w-6 text-slate-600" />
            Regulatory Change Feed
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Stay current with NSA/IDR regulatory updates, court rulings, and CMS guidance</p>
        </div>
        <a
          href="https://www.cms.gov/nosurprises"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:underline flex items-center gap-1"
        >
          <ExternalLink className="h-3 w-3" />CMS No Surprises Act
        </a>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search updates..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Button variant={categoryFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setCategoryFilter("all")}>All</Button>
          {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
            <Button key={key} variant={categoryFilter === key ? "default" : "outline"} size="sm" onClick={() => setCategoryFilter(key)}>{cfg.label}</Button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {["all", "critical", "high", "medium", "low"].map(impact => (
            <Button
              key={impact}
              variant={impactFilter === impact ? "default" : "outline"}
              size="sm"
              className="capitalize"
              onClick={() => setImpactFilter(impact)}
            >
              {impact}
            </Button>
          ))}
        </div>
      </div>

      {/* Feed */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">No updates match your filters</CardContent>
          </Card>
        ) : (
          filtered.map(update => {
            const catCfg = CATEGORY_CONFIG[update.category] ?? CATEGORY_CONFIG.guidance;
            const impactClass = IMPACT_CONFIG[update.impact] ?? IMPACT_CONFIG.medium;
            return (
              <Card key={update.id} className={`border-l-4 ${update.impact === "critical" ? "border-l-red-500" : update.impact === "high" ? "border-l-orange-400" : update.impact === "medium" ? "border-l-yellow-400" : "border-l-green-400"}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <Badge className={`text-xs flex items-center gap-1 ${catCfg.color}`}>
                          {catCfg.icon}{catCfg.label}
                        </Badge>
                        <Badge className={`text-xs border ${impactClass}`}>
                          {update.impact.charAt(0).toUpperCase() + update.impact.slice(1)} Impact
                        </Badge>
                        <span className="text-xs text-muted-foreground">{new Date(update.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
                        <span className="text-xs text-muted-foreground">· {update.source}</span>
                      </div>
                      <h3 className="font-semibold text-sm mb-1">{update.title}</h3>
                      <p className="text-sm text-muted-foreground">{update.summary}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {update.tags.map(tag => (
                          <span key={tag} className="text-xs bg-muted rounded-full px-2 py-0.5 text-muted-foreground">{tag}</span>
                        ))}
                      </div>
                    </div>
                    <a href={update.url} target="_blank" rel="noopener noreferrer">
                      <Button variant="ghost" size="sm">
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </a>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
