import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Workflow,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  ChevronRight,
  Search,
  Activity,
  Timer,
  Layers,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const IDR_STEPS = [
  { id: "initiation", label: "Initiation", order: 1 },
  { id: "eligibility_check", label: "Eligibility Check", order: 2 },
  { id: "open_negotiation", label: "Open Negotiation", order: 3 },
  { id: "negotiation_failed", label: "Negotiation Failed", order: 4 },
  { id: "idr_initiation", label: "IDR Initiation", order: 5 },
  { id: "entity_selection", label: "Entity Selection", order: 6 },
  { id: "offer_submission", label: "Offer Submission", order: 7 },
  { id: "offer_review", label: "Offer Review", order: 8 },
  { id: "additional_info", label: "Additional Info", order: 9 },
  { id: "determination", label: "Determination", order: 10 },
  { id: "payment_processing", label: "Payment Processing", order: 11 },
  { id: "compliance_check", label: "Compliance Check", order: 12 },
  { id: "appeal_period", label: "Appeal Period", order: 13 },
  { id: "appeal_review", label: "Appeal Review", order: 14 },
  { id: "final_determination", label: "Final Determination", order: 15 },
  { id: "cms_reporting", label: "CMS Reporting", order: 16 },
  { id: "payment_confirmation", label: "Payment Confirmation", order: 17 },
  { id: "record_retention", label: "Record Retention", order: 18 },
  { id: "closed", label: "Closed", order: 19 },
];

type WorkflowRun = {
  workflowId: string;
  runId: string;
  status: string;
  startTime: string;
  closeTime?: string;
  currentStep?: string;
};

function statusColor(status: string): string {
  const s = status?.toUpperCase();
  if (s === "RUNNING" || s === "open") return "bg-blue-500";
  if (s === "COMPLETED" || s === "closed") return "bg-green-500";
  if (s === "FAILED") return "bg-red-500";
  if (s === "CANCELED" || s === "TERMINATED") return "bg-orange-500";
  return "bg-gray-400";
}

function statusBadge(status: string) {
  const s = status?.toUpperCase();
  if (s === "RUNNING" || s === "open")
    return <Badge className="bg-blue-100 text-blue-700 border-blue-200"><Activity className="h-3 w-3 mr-1" />Running</Badge>;
  if (s === "COMPLETED" || s === "closed")
    return <Badge className="bg-green-100 text-green-700 border-green-200"><CheckCircle2 className="h-3 w-3 mr-1" />Completed</Badge>;
  if (s === "FAILED")
    return <Badge className="bg-red-100 text-red-700 border-red-200"><XCircle className="h-3 w-3 mr-1" />Failed</Badge>;
  if (s === "CANCELED")
    return <Badge className="bg-orange-100 text-orange-700 border-orange-200"><AlertCircle className="h-3 w-3 mr-1" />Canceled</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function stepProgress(currentStep?: string): number {
  if (!currentStep) return 0;
  const step = IDR_STEPS.find(s => s.id === currentStep);
  if (!step) return 0;
  return Math.round((step.order / IDR_STEPS.length) * 100);
}

function WorkflowStepTrail({ currentStep }: { currentStep?: string }) {
  const currentOrder = IDR_STEPS.find(s => s.id === currentStep)?.order ?? 0;
  return (
    <div className="flex items-center gap-0.5 flex-wrap mt-2">
      {IDR_STEPS.map((step, idx) => {
        const done = step.order < currentOrder;
        const active = step.id === currentStep;
        return (
          <div key={step.id} className="flex items-center">
            <div
              className={`h-2 w-2 rounded-full transition-colors ${
                active ? "bg-blue-500 ring-2 ring-blue-200 scale-125" :
                done ? "bg-green-500" : "bg-gray-200"
              }`}
              title={step.label}
            />
            {idx < IDR_STEPS.length - 1 && (
              <div className={`h-0.5 w-3 ${done ? "bg-green-400" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function WorkflowCard({ run }: { run: WorkflowRun }) {
  const disputeId = run.workflowId.replace("idr-", "");
  const progress = stepProgress(run.currentStep);
  const currentStepLabel = IDR_STEPS.find(s => s.id === run.currentStep)?.label ?? run.currentStep ?? "—";
  const elapsed = run.startTime ? formatDistanceToNow(new Date(run.startTime), { addSuffix: true }) : "—";

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <div className={`h-2 w-2 rounded-full ${statusColor(run.status)}`} />
              <span className="font-mono text-xs text-muted-foreground truncate">{run.workflowId}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {statusBadge(run.status)}
              {run.currentStep && (
                <Badge variant="outline" className="text-xs">
                  <Layers className="h-3 w-3 mr-1" />
                  {currentStepLabel}
                </Badge>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Timer className="h-3 w-3" />
              {elapsed}
            </div>
            {run.closeTime && (
              <div className="text-xs text-muted-foreground mt-0.5">
                Closed {formatDistanceToNow(new Date(run.closeTime), { addSuffix: true })}
              </div>
            )}
          </div>
        </div>

        {run.currentStep && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Progress</span>
              <span className="text-xs font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-1.5" />
            <WorkflowStepTrail currentStep={run.currentStep} />
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => window.location.href = `/disputes/${disputeId}`}
          >
            View Dispute <ChevronRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WorkflowMonitor() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const { data: workflows, isLoading, refetch } = trpc.temporal.allWorkflows.useQuery(
    {
      status: statusFilter === "all" ? undefined : statusFilter as "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED" | "TERMINATED",
      limit: 50,
    },
    { refetchInterval: autoRefresh ? 10_000 : false }
  );

  const { data: steps } = trpc.workflow.steps.useQuery();

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(() => setLastRefresh(new Date()), 10_000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const runs = (workflows ?? []) as WorkflowRun[];
  const filtered = runs.filter(r => {
    if (!search) return true;
    return r.workflowId.toLowerCase().includes(search.toLowerCase()) ||
      r.status.toLowerCase().includes(search.toLowerCase()) ||
      (r.currentStep ?? "").toLowerCase().includes(search.toLowerCase());
  });

  const runningCount = runs.filter(r => ["RUNNING", "open"].includes(r.status?.toUpperCase() ?? r.status)).length;
  const completedCount = runs.filter(r => ["COMPLETED", "closed"].includes(r.status?.toUpperCase() ?? r.status)).length;
  const failedCount = runs.filter(r => r.status?.toUpperCase() === "FAILED").length;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Workflow className="h-6 w-6 text-primary" />
              Temporal Workflow Monitor
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Real-time 19-step IDR workflow execution status across all disputes
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { refetch(); setLastRefresh(new Date()); }}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            <Button
              variant={autoRefresh ? "default" : "outline"}
              size="sm"
              onClick={() => setAutoRefresh(v => !v)}
            >
              <Activity className="h-4 w-4 mr-1" />
              {autoRefresh ? "Live" : "Paused"}
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-blue-600">{runningCount}</div>
              <div className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                <Activity className="h-3 w-3" /> Running
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-green-600">{completedCount}</div>
              <div className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                <CheckCircle2 className="h-3 w-3" /> Completed
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-red-600">{failedCount}</div>
              <div className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                <XCircle className="h-3 w-3" /> Failed
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{runs.length}</div>
              <div className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                <Layers className="h-3 w-3" /> Total
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 19-Step Reference */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">19-Step IDR Workflow Reference</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex flex-wrap gap-1">
              {IDR_STEPS.map(step => (
                <Badge key={step.id} variant="outline" className="text-xs">
                  <span className="text-muted-foreground mr-1">{step.order}.</span>
                  {step.label}
                </Badge>
              ))}
            </div>
            {steps && (
              <p className="text-xs text-muted-foreground mt-2">
                {steps.length} steps defined · Temporal namespace: <code className="bg-muted px-1 rounded">idr</code>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by workflow ID, status, or step..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="RUNNING">Running</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
              <SelectItem value="FAILED">Failed</SelectItem>
              <SelectItem value="CANCELED">Canceled</SelectItem>
              <SelectItem value="TERMINATED">Terminated</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Updated {formatDistanceToNow(lastRefresh, { addSuffix: true })}
          </div>
        </div>

        <Separator />

        {/* Workflow Cards */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-4 h-32 bg-muted/30 rounded" />
              </Card>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Workflow className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No workflow runs found</p>
            <p className="text-sm mt-1">
              {statusFilter !== "all" ? "Try changing the status filter" : "Disputes will appear here once workflow execution begins"}
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[600px]">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pr-4">
              {filtered.map(run => (
                <WorkflowCard key={`${run.workflowId}-${run.runId}`} run={run} />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </DashboardLayout>
  );
}
