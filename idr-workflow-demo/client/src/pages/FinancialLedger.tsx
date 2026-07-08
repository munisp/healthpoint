import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  DollarSign, TrendingUp, TrendingDown, BookOpen, ArrowRightLeft,
  Plus, RefreshCw, AlertCircle, Loader2, CalendarDays, X, Download, Layers, List
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid, Legend, ReferenceLine
} from "recharts";

const ACCOUNT_COLORS: Record<string, string> = {
  billed: "#6366f1",
  allowed: "#f59e0b",
  paid: "#10b981",
  determination: "#3b82f6",
  adjustment: "#8b5cf6",
  patient_responsibility: "#ef4444",
};

const ACCOUNT_LABELS: Record<string, string> = {
  billed: "Billed Amount",
  allowed: "Payer Allowed",
  paid: "Amount Paid",
  determination: "IDR Determination",
  adjustment: "Adjustments",
  patient_responsibility: "Patient Responsibility",
};

const QUICK_RANGES = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last year", days: 365 },
];

function fmt(dollars: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(dollars);
}

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Build synthetic trend data from journal entries bucketed by week
function buildTrendData(
  history: Array<{ entry: { createdAt: Date | null; amountCents: number; entryType: string }; debitAccountType: string; creditAccountType: string }>,
  dateFrom: string,
  dateTo: string
) {
  if (history.length === 0) return [];

  const filtered = history.filter(h => {
    if (!h.entry.createdAt) return false;
    const d = new Date(h.entry.createdAt);
    if (dateFrom && d < new Date(dateFrom)) return false;
    if (dateTo && d > new Date(dateTo + "T23:59:59")) return false;
    return true;
  });

  if (filtered.length === 0) return [];

  // Sort by date
  const sorted = [...filtered].sort((a, b) =>
    new Date(a.entry.createdAt!).getTime() - new Date(b.entry.createdAt!).getTime()
  );

  // Bucket by week (ISO week label)
  const buckets: Map<string, Record<string, number>> = new Map();

  for (const { entry, debitAccountType, creditAccountType } of sorted) {
    const d = new Date(entry.createdAt!);
    // Week label: "Jan 1"
    const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (!buckets.has(label)) {
      buckets.set(label, {
        billed: 0, allowed: 0, paid: 0, determination: 0, adjustment: 0, patient_responsibility: 0,
      });
    }
    const bucket = buckets.get(label)!;
    const amountDollars = entry.amountCents / 100;
    // Credit side increases the account balance
    if (creditAccountType in bucket) bucket[creditAccountType] += amountDollars;
    if (debitAccountType in bucket) bucket[debitAccountType] -= amountDollars;
  }

  // Convert to cumulative running totals
  const result: Array<Record<string, number | string>> = [];
  const running: Record<string, number> = {
    billed: 0, allowed: 0, paid: 0, determination: 0, adjustment: 0, patient_responsibility: 0,
  };

  for (const [label, delta] of Array.from(buckets.entries())) {
    for (const key of Object.keys(running)) {
      running[key] = Math.max(0, running[key] + (delta[key] ?? 0));
    }
    result.push({ date: label, ...running });
  }

  return result;
}

export default function FinancialLedger() {
  const [selectedDisputeId, setSelectedDisputeId] = useState("");
  const [disputeInput, setDisputeInput] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  // Date range filter
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);

  // Which accounts to show on trend chart
  const [visibleAccounts, setVisibleAccounts] = useState<Set<string>>(
    () => new Set(["billed", "paid", "determination"])
  );

  // Group by account toggle
  const [groupByAccount, setGroupByAccount] = useState(false);

  const disputesQuery = trpc.disputes.list.useQuery({ limit: 50 });
  const balancesQuery = trpc.ledger.balances.useQuery(
    { disputeId: selectedDisputeId }, { enabled: !!selectedDisputeId }
  );
  const summaryQuery = trpc.ledger.summary.useQuery(
    { disputeId: selectedDisputeId }, { enabled: !!selectedDisputeId }
  );
  const historyQuery = trpc.ledger.history.useQuery(
    { disputeId: selectedDisputeId }, { enabled: !!selectedDisputeId }
  );

  const recordPaymentMutation = trpc.ledger.recordPayment.useMutation({
    onSuccess: () => {
      toast.success("Payment recorded in ledger");
      setPaymentDialogOpen(false);
      setPaymentAmount("");
      balancesQuery.refetch();
      summaryQuery.refetch();
      historyQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const disputes = disputesQuery.data?.items ?? [];
  const balances = balancesQuery.data ?? [];
  const summary = summaryQuery.data;
  const history = historyQuery.data ?? [];

  // Date-filtered journal entries
  const filteredHistory = useMemo(() => {
    if (!dateFrom && !dateTo) return history;
    return history.filter(({ entry }) => {
      if (!entry.createdAt) return true;
      const d = new Date(entry.createdAt);
      if (dateFrom && d < new Date(dateFrom)) return false;
      if (dateTo && d > new Date(dateTo + "T23:59:59")) return false;
      return true;
    });
  }, [history, dateFrom, dateTo]);

  const trendData = useMemo(
    () => buildTrendData(history, dateFrom, dateTo),
    [history, dateFrom, dateTo]
  );

  const chartData = balances.map(b => ({
    name: ACCOUNT_LABELS[b.accountType] ?? b.accountType,
    amount: b.balanceDollars,
    color: ACCOUNT_COLORS[b.accountType] ?? "#94a3b8",
  }));

  const hasDateFilter = !!(dateFrom || dateTo);
  const dateRangeLabel = dateFrom && dateTo
    ? `${new Date(dateFrom).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(dateTo).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : dateFrom ? `From ${new Date(dateFrom).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : dateTo ? `Until ${new Date(dateTo).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : "Date Range";

  function applyQuickRange(days: number) {
    const to = new Date();
    const from = new Date(Date.now() - days * 86400000);
    setDateFrom(toDateStr(from));
    setDateTo(toDateStr(to));
    setDatePopoverOpen(false);
  }

  function exportCSV() {
    if (filteredHistory.length === 0) return;
    const headers = ["Date", "Description", "Debit Account", "Credit Account", "Amount (USD)", "Type"];
    const rows = filteredHistory.map(({ entry, debitAccountType, creditAccountType }) => [
      entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : "",
      `"${(entry.description ?? "").replace(/"/g, '""')}"`,
      ACCOUNT_LABELS[debitAccountType] ?? debitAccountType,
      ACCOUNT_LABELS[creditAccountType] ?? creditAccountType,
      (entry.amountCents / 100).toFixed(2),
      entry.entryType,
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const rangeLabel = dateFrom && dateTo ? `_${dateFrom}_to_${dateTo}` : dateFrom ? `_from_${dateFrom}` : dateTo ? `_until_${dateTo}` : "";
    a.download = `ledger_${selectedDisputeId}${rangeLabel}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredHistory.length} journal entr${filteredHistory.length !== 1 ? "ies" : "y"} to CSV`);
  }

  function toggleAccount(key: string) {
    setVisibleAccounts(prev => {
      const next = new Set(prev);
      if (next.has(key)) { if (next.size > 1) next.delete(key); }
      else next.add(key);
      return next;
    });
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BookOpen className="h-6 w-6 text-primary" />
              Financial Ledger
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Double-entry accounting ledger for IDR dispute financials (TigerBeetle-style)
            </p>
          </div>
          <div className="flex gap-2">
            {selectedDisputeId && (
              <>
                {/* Date range filter */}
                <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant={hasDateFilter ? "default" : "outline"} size="sm" className="gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {dateRangeLabel}
                      {hasDateFilter && (
                        <span className="ml-1" onClick={e => { e.stopPropagation(); setDateFrom(""); setDateTo(""); }}>
                          <X className="h-3 w-3" />
                        </span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-68 p-4" align="end">
                    <p className="text-sm font-semibold mb-3">Filter by Date</p>
                    <div className="grid grid-cols-2 gap-1.5 mb-3">
                      {QUICK_RANGES.map(r => (
                        <Button key={r.label} variant="outline" size="sm" className="text-xs h-7"
                          onClick={() => applyQuickRange(r.days)}>
                          {r.label}
                        </Button>
                      ))}
                    </div>
                    <Separator className="mb-3" />
                    <div className="space-y-2">
                      <div>
                        <Label className="text-xs text-muted-foreground">From</Label>
                        <Input type="date" value={dateFrom} max={dateTo || undefined}
                          onChange={e => setDateFrom(e.target.value)} className="mt-1 h-8 text-xs" />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">To</Label>
                        <Input type="date" value={dateTo} min={dateFrom || undefined}
                          onChange={e => setDateTo(e.target.value)} className="mt-1 h-8 text-xs" />
                      </div>
                    </div>
                    {hasDateFilter && (
                      <Button variant="ghost" size="sm" className="w-full mt-2 text-xs text-muted-foreground"
                        onClick={() => { setDateFrom(""); setDateTo(""); }}>
                        <X className="h-3 w-3 mr-1" /> Clear
                      </Button>
                    )}
                  </PopoverContent>
                </Popover>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportCSV}
                  disabled={filteredHistory.length === 0}
                  title={filteredHistory.length === 0 ? "No entries to export" : `Export ${filteredHistory.length} entr${filteredHistory.length !== 1 ? "ies" : "y"} to CSV`}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Export CSV{filteredHistory.length > 0 ? ` (${filteredHistory.length})` : ""}
                </Button>
                <Button variant="outline" size="sm" onClick={() => { balancesQuery.refetch(); historyQuery.refetch(); }}>
                  <RefreshCw className="h-4 w-4 mr-1" /> Refresh
                </Button>
                <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Record Payment</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
                    <div className="space-y-4 pt-2">
                      <div>
                        <Label>Payment Amount (USD)</Label>
                        <Input type="number" min="0.01" step="0.01" placeholder="0.00"
                          value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} className="mt-1" />
                      </div>
                      <Button className="w-full"
                        disabled={!paymentAmount || parseFloat(paymentAmount) <= 0 || recordPaymentMutation.isPending}
                        onClick={() => recordPaymentMutation.mutate({ disputeId: selectedDisputeId, amountDollars: parseFloat(paymentAmount) })}>
                        {recordPaymentMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                        Record Payment
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </>
            )}
          </div>
        </div>

        {/* Dispute selector */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <Label className="text-sm font-medium">Select Dispute</Label>
                <Select value={selectedDisputeId} onValueChange={setSelectedDisputeId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Choose a dispute to view its ledger..." />
                  </SelectTrigger>
                  <SelectContent>
                    {disputes.map(d => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.referenceNumber} — {d.respondingPartyName ?? "Unknown Payer"} ({fmt(parseFloat(d.billedAmount ?? "0"))})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Or enter Dispute ID</Label>
                <div className="flex gap-2 mt-1">
                  <Input placeholder="dispute-id" value={disputeInput}
                    onChange={e => setDisputeInput(e.target.value)} className="w-48" />
                  <Button variant="outline" onClick={() => setSelectedDisputeId(disputeInput)}>Load</Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {!selectedDisputeId && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <BookOpen className="h-12 w-12 mb-3 opacity-30" />
            <p className="font-medium">Select a dispute to view its financial ledger</p>
            <p className="text-sm mt-1">All financial movements are tracked as double-entry journal entries</p>
          </div>
        )}

        {selectedDisputeId && (
          <>
            {/* Summary KPIs */}
            {summaryQuery.isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : summary ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                      <DollarSign className="h-3 w-3" /> Billed Amount
                    </div>
                    <div className="text-xl font-bold">{fmt(summary.billedDollars)}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                      <TrendingDown className="h-3 w-3 text-amber-500" /> IDR Determination
                    </div>
                    <div className="text-xl font-bold text-amber-600">{fmt(summary.determinationDollars)}</div>
                    {summary.billedDollars > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {(summary.determinationVsBilled * 100).toFixed(1)}% of billed
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                      <TrendingUp className="h-3 w-3 text-green-500" /> Amount Paid
                    </div>
                    <div className="text-xl font-bold text-green-600">{fmt(summary.paidDollars)}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                      <ArrowRightLeft className="h-3 w-3 text-blue-500" /> Recovery Rate
                    </div>
                    <div className="text-xl font-bold text-blue-600">
                      {(summary.recoveryRate * 100).toFixed(1)}%
                    </div>
                    <div className="text-xs text-muted-foreground">paid / billed</div>
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {/* ── Trend Line Chart ── */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    Account Balance Trend
                    {hasDateFilter && (
                      <Badge variant="secondary" className="text-xs">{dateRangeLabel}</Badge>
                    )}
                  </CardTitle>
                  {/* Account toggles */}
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(ACCOUNT_LABELS).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => toggleAccount(key)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs border transition-all ${
                          visibleAccounts.has(key)
                            ? "border-transparent text-white"
                            : "bg-background text-muted-foreground border-border opacity-50"
                        }`}
                        style={visibleAccounts.has(key) ? { backgroundColor: ACCOUNT_COLORS[key] } : {}}
                      >
                        {label.split(" ")[0]}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {historyQuery.isLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : trendData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                    <TrendingUp className="h-8 w-8 mb-2 opacity-20" />
                    <p className="text-sm">No journal entries in the selected period</p>
                    {hasDateFilter && (
                      <button className="text-xs underline mt-1" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                        Clear date filter
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                        <Tooltip
                          formatter={(v: number, name: string) => [fmt(v), ACCOUNT_LABELS[name] ?? name]}
                          contentStyle={{ fontSize: 12 }}
                        />
                        <Legend
                          formatter={(value) => ACCOUNT_LABELS[value] ?? value}
                          wrapperStyle={{ fontSize: 11 }}
                        />
                        {Object.entries(ACCOUNT_COLORS).map(([key, color]) =>
                          visibleAccounts.has(key) ? (
                            <Line
                              key={key}
                              type="monotone"
                              dataKey={key}
                              stroke={color}
                              strokeWidth={2}
                              dot={false}
                              activeDot={{ r: 4 }}
                            />
                          ) : null
                        )}
                        {summary && summary.billedDollars > 0 && (
                          <ReferenceLine
                            y={summary.billedDollars}
                            stroke={ACCOUNT_COLORS.billed}
                            strokeDasharray="4 4"
                            label={{ value: "Billed", position: "insideTopRight", fontSize: 10 }}
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Account balances bar chart + table */}
            {balancesQuery.isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : balances.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Current Account Balances</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div style={{ height: 260 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ left: 10, right: 10 }}>
                          <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={50} />
                          <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                          <Tooltip formatter={(v: number) => fmt(v)} />
                          <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                            {chartData.map((entry, i) => (
                              <Cell key={i} fill={entry.color} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Account Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {balances.map(b => (
                        <div key={b.accountId} className="flex items-center justify-between py-2 border-b last:border-0">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: ACCOUNT_COLORS[b.accountType] ?? "#94a3b8" }} />
                            <span className="text-sm font-medium">
                              {ACCOUNT_LABELS[b.accountType] ?? b.accountType}
                            </span>
                          </div>
                          <span className="font-mono font-semibold text-sm">{fmt(b.balanceDollars)}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p>No ledger accounts found for this dispute.</p>
                </CardContent>
              </Card>
            )}

            {/* Journal entry history — date filtered */}
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                    <ArrowRightLeft className="h-4 w-4" />
                    Journal Entry History
                    <Badge variant="secondary">
                      {filteredHistory.length}{hasDateFilter && filteredHistory.length !== history.length ? ` of ${history.length}` : ""}
                    </Badge>
                    {hasDateFilter && (
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        {dateRangeLabel}
                      </Badge>
                    )}
                  </CardTitle>
                  {/* Group by Account toggle */}
                  <button
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border transition-colors shrink-0 ${
                      groupByAccount
                        ? "bg-primary text-primary-foreground border-primary"
                        : "text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                    }`}
                    onClick={() => setGroupByAccount(g => !g)}
                    title={groupByAccount ? "Switch to flat list" : "Group by account"}
                  >
                    {groupByAccount ? <List className="h-3.5 w-3.5" /> : <Layers className="h-3.5 w-3.5" />}
                    {groupByAccount ? "Flat list" : "Group by account"}
                  </button>
                </div>
              </CardHeader>
              <CardContent>
                {historyQuery.isLoading ? (
                  <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : filteredHistory.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    {hasDateFilter
                      ? <>No entries in the selected period. <button className="underline" onClick={() => { setDateFrom(""); setDateTo(""); }}>Clear filter</button></>
                      : "No journal entries yet. Record a payment to create the first entry."}
                  </div>
                ) : groupByAccount ? (
                  /* ── Grouped by account view ── */
                  <div className="space-y-4">
                    {(() => {
                      // Build groups keyed by debitAccountType (primary account)
                      const groups = new Map<string, typeof filteredHistory>();
                      filteredHistory.forEach(row => {
                        const key = row.debitAccountType;
                        if (!groups.has(key)) groups.set(key, []);
                        groups.get(key)!.push(row);
                      });
                      return Array.from(groups.entries()).map(([accountKey, rows]) => {
                        const groupDebits = rows.filter(r => r.entry.entryType === "debit").reduce((s, r) => s + r.entry.amountCents, 0);
                        const groupCredits = rows.filter(r => r.entry.entryType === "credit").reduce((s, r) => s + r.entry.amountCents, 0);
                        const groupNet = groupCredits - groupDebits;
                        const color = ACCOUNT_COLORS[accountKey] ?? "#94a3b8";
                        return (
                          <div key={accountKey} className="border rounded-lg overflow-hidden">
                            {/* Group header */}
                            <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b">
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                                <span className="text-sm font-semibold">{ACCOUNT_LABELS[accountKey] ?? accountKey}</span>
                                <Badge variant="secondary" className="text-[10px]">{rows.length} entr{rows.length !== 1 ? "ies" : "y"}</Badge>
                              </div>
                              <div className="flex items-center gap-4 text-xs">
                                {groupDebits > 0 && (
                                  <span className="text-muted-foreground">Debits: <span className="font-mono text-red-600 dark:text-red-400">{fmt(groupDebits / 100)}</span></span>
                                )}
                                {groupCredits > 0 && (
                                  <span className="text-muted-foreground">Credits: <span className="font-mono text-green-600 dark:text-green-400">{fmt(groupCredits / 100)}</span></span>
                                )}
                                <span className="text-muted-foreground">Net: <span className={`font-mono font-semibold ${groupNet >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{groupNet >= 0 ? "+" : ""}{fmt(groupNet / 100)}</span></span>
                              </div>
                            </div>
                            {/* Group rows */}
                            <table className="w-full text-sm">
                              <tbody>
                                {rows.map(({ entry, debitAccountType, creditAccountType }) => (
                                  <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/20">
                                    <td className="py-2 px-3 text-muted-foreground whitespace-nowrap w-28">
                                      {entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : "—"}
                                    </td>
                                    <td className="py-2 pr-3 max-w-xs truncate">{entry.description}</td>
                                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                                      <span className="inline-flex items-center gap-1">
                                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ACCOUNT_COLORS[creditAccountType] ?? "#94a3b8" }} />
                                        → {ACCOUNT_LABELS[creditAccountType] ?? creditAccountType}
                                      </span>
                                    </td>
                                    <td className="py-2 text-right font-mono font-medium pr-3">{fmt(entry.amountCents / 100)}</td>
                                    <td className="py-2 pl-2 pr-3">
                                      <Badge variant={entry.entryType === "credit" ? "default" : "secondary"} className="text-xs">
                                        {entry.entryType}
                                      </Badge>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        );
                      });
                    })()}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground text-xs">
                          <th className="text-left py-2 pr-4">Date</th>
                          <th className="text-left py-2 pr-4">Description</th>
                          <th className="text-left py-2 pr-4">Debit Account</th>
                          <th className="text-left py-2 pr-4">Credit Account</th>
                          <th className="text-right py-2">Amount</th>
                          <th className="text-left py-2 pl-4">Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredHistory.map(({ entry, debitAccountType, creditAccountType }) => (
                          <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap">
                              {entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : "—"}
                            </td>
                            <td className="py-2 pr-4 max-w-xs truncate">{entry.description}</td>
                            <td className="py-2 pr-4">
                              <span className="inline-flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full"
                                  style={{ backgroundColor: ACCOUNT_COLORS[debitAccountType] ?? "#94a3b8" }} />
                                {ACCOUNT_LABELS[debitAccountType] ?? debitAccountType}
                              </span>
                            </td>
                            <td className="py-2 pr-4">
                              <span className="inline-flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full"
                                  style={{ backgroundColor: ACCOUNT_COLORS[creditAccountType] ?? "#94a3b8" }} />
                                {ACCOUNT_LABELS[creditAccountType] ?? creditAccountType}
                              </span>
                            </td>
                            <td className="py-2 text-right font-mono font-medium">
                              {fmt(entry.amountCents / 100)}
                            </td>
                            <td className="py-2 pl-4">
                              <Badge variant={entry.entryType === "credit" ? "default" : "secondary"} className="text-xs">
                                {entry.entryType}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {/* Summary totals row */}
                      {(() => {
                        const totalDebits = filteredHistory
                          .filter(({ entry }) => entry.entryType === "debit")
                          .reduce((sum, { entry }) => sum + entry.amountCents, 0);
                        const totalCredits = filteredHistory
                          .filter(({ entry }) => entry.entryType === "credit")
                          .reduce((sum, { entry }) => sum + entry.amountCents, 0);
                        const net = totalCredits - totalDebits;
                        return (
                          <tfoot>
                            <tr className="border-t-2 border-border bg-muted/30 font-semibold text-sm">
                              <td className="py-2.5 pr-4 text-muted-foreground text-xs" colSpan={2}>
                                {filteredHistory.length} entr{filteredHistory.length !== 1 ? "ies" : "y"}
                                {hasDateFilter && ` · ${dateRangeLabel}`}
                              </td>
                              <td className="py-2.5 pr-4" colSpan={2}>
                                <div className="flex items-center gap-4 text-xs">
                                  <span className="text-muted-foreground">Debits:</span>
                                  <span className="font-mono text-red-600 dark:text-red-400">{fmt(totalDebits / 100)}</span>
                                  <span className="text-muted-foreground">Credits:</span>
                                  <span className="font-mono text-green-600 dark:text-green-400">{fmt(totalCredits / 100)}</span>
                                </div>
                              </td>
                              <td className="py-2.5 text-right font-mono">
                                <span className={net >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                                  {net >= 0 ? "+" : ""}{fmt(net / 100)}
                                </span>
                              </td>
                              <td className="py-2.5 pl-4">
                                <span className="text-[10px] text-muted-foreground">Net</span>
                              </td>
                            </tr>
                          </tfoot>
                        );
                      })()}
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
