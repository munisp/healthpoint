import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { BookOpen, Search, Zap, Shield, Bug, Sparkles } from "lucide-react";

interface Release {
  version: string;
  date: string;
  tag: "major" | "minor" | "patch";
  changes: { type: "feature" | "improvement" | "fix" | "security"; text: string }[];
}

const RELEASES: Release[] = [
  {
    version: "1.9.0",
    date: "Jul 8, 2026",
    tag: "minor",
    changes: [
      { type: "feature", text: "Image preview modal for workflow timeline note attachments" },
      { type: "feature", text: "Expand All / Collapse All for Financial Ledger grouped view" },
      { type: "improvement", text: "Clear All button redesigned with Trash2 icon and count badge in Recent Searches" },
      { type: "feature", text: "Group by Account toggle with per-group debit/credit subtotals in Financial Ledger" },
      { type: "feature", text: "File and image attachment support on workflow timeline notes (S3-backed)" },
      { type: "feature", text: "Per-chip delete button on Recent Searches history" },
    ],
  },
  {
    version: "1.8.0",
    date: "Jul 7, 2026",
    tag: "minor",
    changes: [
      { type: "feature", text: "Recent Searches auto-tracking (last 5 queries) with localStorage persistence" },
      { type: "feature", text: "Financial Ledger summary row with total debits, credits, and net balance" },
      { type: "feature", text: "Inline note editing on workflow timeline (own notes only, Cmd+Enter to save)" },
      { type: "improvement", text: "workflow.updateNote tRPC procedure with ownership enforcement" },
    ],
  },
  {
    version: "1.7.0",
    date: "Jul 6, 2026",
    tag: "minor",
    changes: [
      { type: "feature", text: "Save Search button — persist query, category filters, and date range to localStorage" },
      { type: "feature", text: "Financial Ledger date range filter and account balance trend line chart" },
      { type: "feature", text: "Add Note button on active workflow timeline step with DB-backed storage" },
      { type: "feature", text: "step_notes PostgreSQL table with workflow.addNote / getNotes / deleteNote procedures" },
    ],
  },
  {
    version: "1.6.0",
    date: "Jul 5, 2026",
    tag: "minor",
    changes: [
      { type: "feature", text: "Global Search category filters (Disputes, Documents, Audit) and date range picker" },
      { type: "feature", text: "Financial Ledger date range filter and trend line chart (account balances over time)" },
      { type: "feature", text: "WorkflowTimeline visual component — phase grouping, deadline countdowns, event history" },
      { type: "improvement", text: "DisputeDetail: WorkflowTimeline replaces simple step list" },
    ],
  },
  {
    version: "1.5.0",
    date: "Jul 4, 2026",
    tag: "major",
    changes: [
      { type: "feature", text: "Full middleware integration: Redis/Redlock, Permify ReBAC, Kafka event bus, Temporal workflow, TigerBeetle ledger, OpenSearch, Lakehouse export" },
      { type: "feature", text: "Financial Ledger page — double-entry accounts, journal history, bar chart" },
      { type: "feature", text: "Global Search page — full-text search across disputes, documents, and audit log" },
      { type: "feature", text: "Lakehouse Export page — NDJSON/CSV export to S3 with presigned download" },
      { type: "feature", text: "dispute_access, event_log, ledger_accounts, ledger_entries tables added" },
      { type: "security", text: "JWKS-compatible JWT verification via jose; Permify-style assertDisputeAccess" },
    ],
  },
  {
    version: "1.4.0",
    date: "Jul 3, 2026",
    tag: "minor",
    changes: [
      { type: "feature", text: "Document Analyzer side-by-side view with synchronized field group highlighting" },
      { type: "feature", text: "Inline editable fields in Document Analyzer right panel with save/reset" },
      { type: "feature", text: "Payer Intelligence multi-select comparison mode on trend line chart" },
      { type: "feature", text: "Audit Trail filtered CSV export (respects active date range and text search)" },
    ],
  },
  {
    version: "1.3.0",
    date: "Jul 2, 2026",
    tag: "minor",
    changes: [
      { type: "feature", text: "Payer Intelligence win rate and recovery rate trend line chart with time window selector" },
      { type: "feature", text: "Audit Trail date range picker and text search bar with active filter chips" },
      { type: "feature", text: "Global Search category filters and date range picker" },
    ],
  },
  {
    version: "1.2.0",
    date: "Jul 1, 2026",
    tag: "minor",
    changes: [
      { type: "feature", text: "Document Intelligence pipeline — VLM OCR, 25-field extraction, auto-fill dispute form" },
      { type: "feature", text: "Audit Trail page with timeline view and CSV export" },
      { type: "feature", text: "Webhook Manager — full CRUD, HMAC signing, test ping" },
      { type: "feature", text: "Payer Intelligence page — per-payer analytics, win rates, recovery rates" },
      { type: "feature", text: "Command palette (Cmd+K) and dark mode toggle" },
    ],
  },
  {
    version: "1.0.0",
    date: "Jun 28, 2026",
    tag: "major",
    changes: [
      { type: "feature", text: "Initial release — 19-step NSA IDR workflow with full dispute lifecycle management" },
      { type: "feature", text: "Dispute creation, detail view, document upload, offer management" },
      { type: "feature", text: "Dashboard with KPI cards, status distribution, and recent activity" },
      { type: "feature", text: "Manus OAuth authentication with role-based access control" },
      { type: "security", text: "JWT session management with httpOnly cookies" },
    ],
  },
];

const TYPE_CONFIG = {
  feature: { label: "Feature", icon: Sparkles, color: "bg-blue-100 text-blue-700" },
  improvement: { label: "Improvement", icon: Zap, color: "bg-purple-100 text-purple-700" },
  fix: { label: "Fix", icon: Bug, color: "bg-amber-100 text-amber-700" },
  security: { label: "Security", icon: Shield, color: "bg-red-100 text-red-700" },
};

const TAG_CONFIG = {
  major: "bg-red-100 text-red-700 border-red-200",
  minor: "bg-blue-100 text-blue-700 border-blue-200",
  patch: "bg-slate-100 text-slate-600 border-slate-200",
};

export default function Changelog() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const filtered = RELEASES.map(r => ({
    ...r,
    changes: r.changes.filter(c => {
      const matchSearch = !search || c.text.toLowerCase().includes(search.toLowerCase());
      const matchType = typeFilter === "all" || c.type === typeFilter;
      return matchSearch && matchType;
    }),
  })).filter(r => r.changes.length > 0);

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-blue-600" />
          Changelog
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Release notes and version history for the HealthPoint IDR Platform
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search changes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          {["all", "feature", "improvement", "fix", "security"].map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                typeFilter === t
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted border-border text-muted-foreground"
              }`}
            >
              {t === "all" ? "All" : TYPE_CONFIG[t as keyof typeof TYPE_CONFIG]?.label ?? t}
            </button>
          ))}
        </div>
      </div>

      {/* Releases */}
      <div className="space-y-6">
        {filtered.map(release => (
          <Card key={release.version}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <CardTitle className="text-lg font-mono">v{release.version}</CardTitle>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${TAG_CONFIG[release.tag]}`}>
                  {release.tag}
                </span>
                <span className="text-sm text-muted-foreground ml-auto">{release.date}</span>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="space-y-2">
                {release.changes.map((change, i) => {
                  const cfg = TYPE_CONFIG[change.type];
                  return (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className={`mt-0.5 px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${cfg.color}`}>
                        {cfg.label}
                      </span>
                      <span className="text-sm">{change.text}</span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <p className="text-center text-muted-foreground py-12 text-sm">
            No changes match your current filters.
          </p>
        )}
      </div>
    </div>
  );
}
