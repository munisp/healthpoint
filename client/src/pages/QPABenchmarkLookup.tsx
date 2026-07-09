import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, TrendingUp, Info, BookOpen, ExternalLink } from "lucide-react";

// QPA reference data based on publicly available NSA guidance
const QPA_REFERENCE = [
  { cpt: "99283", description: "Emergency Dept Visit, Moderate Severity", specialty: "emergency_medicine", p50: 285, p75: 420, p90: 610 },
  { cpt: "99284", description: "Emergency Dept Visit, High Severity", specialty: "emergency_medicine", p50: 380, p75: 560, p90: 820 },
  { cpt: "99285", description: "Emergency Dept Visit, High Severity w/ Threat", specialty: "emergency_medicine", p50: 490, p75: 720, p90: 1050 },
  { cpt: "00100", description: "Anesthesia for Procedures on Head", specialty: "anesthesiology", p50: 650, p75: 920, p90: 1380 },
  { cpt: "00400", description: "Anesthesia for Integumentary Procedures", specialty: "anesthesiology", p50: 480, p75: 720, p90: 1100 },
  { cpt: "71046", description: "Chest X-Ray, 2 Views", specialty: "radiology", p50: 95, p75: 145, p90: 210 },
  { cpt: "74177", description: "CT Abdomen & Pelvis w/ Contrast", specialty: "radiology", p50: 680, p75: 980, p90: 1420 },
  { cpt: "70553", description: "MRI Brain w/ & w/o Contrast", specialty: "radiology", p50: 1250, p75: 1820, p90: 2640 },
  { cpt: "88305", description: "Surgical Pathology, Level IV", specialty: "pathology", p50: 185, p75: 280, p90: 420 },
  { cpt: "99232", description: "Subsequent Hospital Care, Moderate Complexity", specialty: "hospitalist", p50: 165, p75: 245, p90: 360 },
  { cpt: "99233", description: "Subsequent Hospital Care, High Complexity", specialty: "hospitalist", p50: 225, p75: 330, p90: 490 },
  { cpt: "99291", description: "Critical Care, First 30-74 Minutes", specialty: "intensivist", p50: 580, p75: 850, p90: 1240 },
  { cpt: "99292", description: "Critical Care, Each Additional 30 Min", specialty: "intensivist", p50: 280, p75: 410, p90: 600 },
  { cpt: "A0427", description: "ALS1 Emergency Ground Ambulance", specialty: "ground_ambulance", p50: 850, p75: 1240, p90: 1820 },
  { cpt: "A0431", description: "Air Ambulance, Fixed Wing", specialty: "air_ambulance", p50: 12500, p75: 18200, p90: 26400 },
  { cpt: "A0436", description: "Air Ambulance, Rotary Wing", specialty: "air_ambulance", p50: 18500, p75: 27000, p90: 39000 },
  { cpt: "99477", description: "Neonatal Critical Care, Initial", specialty: "neonatology", p50: 1850, p75: 2700, p90: 3950 },
  { cpt: "01961", description: "Anesthesia for Cesarean Delivery", specialty: "anesthesiology", p50: 890, p75: 1300, p90: 1900 },
];

const STATE_MODIFIERS: Record<string, number> = {
  CA: 1.35, NY: 1.42, MA: 1.28, CT: 1.22, NJ: 1.31,
  TX: 0.95, FL: 1.05, IL: 1.12, PA: 1.08, OH: 0.92,
  GA: 0.90, NC: 0.88, VA: 0.95, WA: 1.18, CO: 1.10,
};

const SPECIALTY_LABELS: Record<string, string> = {
  emergency_medicine: "Emergency Medicine",
  anesthesiology: "Anesthesiology",
  radiology: "Radiology",
  pathology: "Pathology",
  hospitalist: "Hospitalist",
  intensivist: "Intensivist",
  neonatology: "Neonatology",
  ground_ambulance: "Ground Ambulance",
  air_ambulance: "Air Ambulance",
};

export default function QPABenchmarkLookup() {
  const [cptSearch, setCptSearch] = useState("");
  const [specialtyFilter, setSpecialtyFilter] = useState("all");
  const [selectedState, setSelectedState] = useState("national");
  const [selectedRow, setSelectedRow] = useState<typeof QPA_REFERENCE[0] | null>(null);

  const modifier = selectedState !== "national" ? (STATE_MODIFIERS[selectedState] ?? 1.0) : 1.0;

  const filtered = QPA_REFERENCE.filter(r =>
    (specialtyFilter === "all" || r.specialty === specialtyFilter) &&
    (!cptSearch || r.cpt.includes(cptSearch) || r.description.toLowerCase().includes(cptSearch.toLowerCase()))
  );

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v * modifier);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-emerald-600" />
            QPA Benchmark Lookup
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Reference qualifying payment amount benchmarks by CPT code and state</p>
        </div>
        <a
          href="https://www.cms.gov/nosurprises/policies-and-resources/overview-of-the-qualifying-payment-amount"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:underline flex items-center gap-1"
        >
          <ExternalLink className="h-3 w-3" />CMS QPA Guidance
        </a>
      </div>

      <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
        <Info className="h-4 w-4 shrink-0" />
        <span>These benchmarks are illustrative reference ranges based on publicly available data. Actual QPAs are calculated by payers using their contracted rates. Always verify with the payer's QPA disclosure.</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search CPT code or description..." value={cptSearch} onChange={e => setCptSearch(e.target.value)} />
        </div>
        <Select value={specialtyFilter} onValueChange={setSpecialtyFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All Specialties" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Specialties</SelectItem>
            {Object.entries(SPECIALTY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={selectedState} onValueChange={setSelectedState}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="national">National Avg</SelectItem>
            {Object.keys(STATE_MODIFIERS).sort().map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {selectedState !== "national" && (
          <Badge className="bg-blue-100 text-blue-700 text-xs">
            {selectedState} modifier: {modifier > 1 ? "+" : ""}{((modifier - 1) * 100).toFixed(0)}%
          </Badge>
        )}
      </div>

      {/* Results table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">CPT Code</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Description</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Specialty</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">P50 (Median)</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">P75</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">P90</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No CPT codes match your search</td></tr>
                ) : (
                  filtered.map(row => (
                    <tr
                      key={row.cpt}
                      className="hover:bg-muted/30 cursor-pointer"
                      onClick={() => setSelectedRow(selectedRow?.cpt === row.cpt ? null : row)}
                    >
                      <td className="px-4 py-3 font-mono font-semibold text-primary">{row.cpt}</td>
                      <td className="px-4 py-3 text-sm">{row.description}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs">{SPECIALTY_LABELS[row.specialty] ?? row.specialty}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{formatCurrency(row.p50)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{formatCurrency(row.p75)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{formatCurrency(row.p90)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Selected row detail */}
      {selectedRow && (
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              CPT {selectedRow.cpt} — {selectedRow.description}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="p-3 bg-white dark:bg-background rounded-lg border">
                <div className="text-2xl font-bold text-emerald-600">{formatCurrency(selectedRow.p50)}</div>
                <div className="text-xs text-muted-foreground mt-1">50th Percentile (Median QPA)</div>
                <div className="text-xs text-muted-foreground">Most common IDR anchor</div>
              </div>
              <div className="p-3 bg-white dark:bg-background rounded-lg border">
                <div className="text-2xl font-bold text-blue-600">{formatCurrency(selectedRow.p75)}</div>
                <div className="text-xs text-muted-foreground mt-1">75th Percentile</div>
                <div className="text-xs text-muted-foreground">Strong provider position</div>
              </div>
              <div className="p-3 bg-white dark:bg-background rounded-lg border">
                <div className="text-2xl font-bold text-purple-600">{formatCurrency(selectedRow.p90)}</div>
                <div className="text-xs text-muted-foreground mt-1">90th Percentile</div>
                <div className="text-xs text-muted-foreground">High-cost market rate</div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              {selectedState !== "national" ? `Adjusted for ${selectedState} market (${modifier > 1 ? "+" : ""}${((modifier - 1) * 100).toFixed(0)}% modifier). ` : ""}
              Source: CMS NSA QPA reference data. For informational purposes only.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
