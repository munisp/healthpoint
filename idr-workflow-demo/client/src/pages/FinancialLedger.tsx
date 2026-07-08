import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  DollarSign, TrendingUp, TrendingDown, BookOpen, ArrowRightLeft,
  Plus, RefreshCw, Download, AlertCircle, Loader2
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

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

function fmt(dollars: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(dollars);
}

export default function FinancialLedger() {
  const [selectedDisputeId, setSelectedDisputeId] = useState("");
  const [disputeInput, setDisputeInput] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  const disputesQuery = trpc.disputes.list.useQuery(
    { limit: 50 },
    { enabled: true }
  );

  const balancesQuery = trpc.ledger.balances.useQuery(
    { disputeId: selectedDisputeId },
    { enabled: !!selectedDisputeId }
  );

  const summaryQuery = trpc.ledger.summary.useQuery(
    { disputeId: selectedDisputeId },
    { enabled: !!selectedDisputeId }
  );

  const historyQuery = trpc.ledger.history.useQuery(
    { disputeId: selectedDisputeId },
    { enabled: !!selectedDisputeId }
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

  const chartData = balances.map(b => ({
    name: ACCOUNT_LABELS[b.accountType] ?? b.accountType,
    amount: b.balanceDollars,
    color: ACCOUNT_COLORS[b.accountType] ?? "#94a3b8",
  }));

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
                <Button variant="outline" size="sm" onClick={() => {
                  balancesQuery.refetch();
                  historyQuery.refetch();
                }}>
                  <RefreshCw className="h-4 w-4 mr-1" /> Refresh
                </Button>
                <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-1" /> Record Payment
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Record Payment</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                      <div>
                        <Label>Payment Amount (USD)</Label>
                        <Input
                          type="number"
                          min="0.01"
                          step="0.01"
                          placeholder="0.00"
                          value={paymentAmount}
                          onChange={e => setPaymentAmount(e.target.value)}
                          className="mt-1"
                        />
                      </div>
                      <Button
                        className="w-full"
                        disabled={!paymentAmount || parseFloat(paymentAmount) <= 0 || recordPaymentMutation.isPending}
                        onClick={() => {
                          recordPaymentMutation.mutate({
                            disputeId: selectedDisputeId,
                            amountDollars: parseFloat(paymentAmount),
                          });
                        }}
                      >
                        {recordPaymentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
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
                  <Input
                    placeholder="dispute-id"
                    value={disputeInput}
                    onChange={e => setDisputeInput(e.target.value)}
                    className="w-48"
                  />
                  <Button variant="outline" onClick={() => setSelectedDisputeId(disputeInput)}>
                    Load
                  </Button>
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

            {/* Account balances chart + table */}
            {balancesQuery.isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : balances.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Bar chart */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Account Balances</CardTitle>
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

                {/* Account table */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Account Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {balances.map(b => (
                        <div key={b.accountId} className="flex items-center justify-between py-2 border-b last:border-0">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: ACCOUNT_COLORS[b.accountType] ?? "#94a3b8" }}
                            />
                            <span className="text-sm font-medium">
                              {ACCOUNT_LABELS[b.accountType] ?? b.accountType}
                            </span>
                          </div>
                          <span className="font-mono font-semibold text-sm">
                            {fmt(b.balanceDollars)}
                          </span>
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
                  <p className="text-xs mt-1">Ledger accounts are initialized when a dispute is created.</p>
                </CardContent>
              </Card>
            )}

            {/* Journal entry history */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowRightLeft className="h-4 w-4" />
                  Journal Entry History
                  <Badge variant="secondary">{history.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {historyQuery.isLoading ? (
                  <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : history.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    No journal entries yet. Record a payment to create the first entry.
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
                        {history.map(({ entry, debitAccountType, creditAccountType }) => (
                          <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap">
                              {entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : "—"}
                            </td>
                            <td className="py-2 pr-4 max-w-xs truncate">{entry.description}</td>
                            <td className="py-2 pr-4">
                              <span className="inline-flex items-center gap-1">
                                <div
                                  className="w-2 h-2 rounded-full"
                                  style={{ backgroundColor: ACCOUNT_COLORS[debitAccountType] ?? "#94a3b8" }}
                                />
                                {ACCOUNT_LABELS[debitAccountType] ?? debitAccountType}
                              </span>
                            </td>
                            <td className="py-2 pr-4">
                              <span className="inline-flex items-center gap-1">
                                <div
                                  className="w-2 h-2 rounded-full"
                                  style={{ backgroundColor: ACCOUNT_COLORS[creditAccountType] ?? "#94a3b8" }}
                                />
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
