import { Toaster } from "@/components/ui/sonner";
import { useNetworkStatus } from "./hooks/useNetworkStatus";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import LoginPage from "./pages/LoginPage";
import { SessionExpiryWarning } from "./components/SessionExpiryWarning";
import { useSessionExpiry } from "./hooks/useSessionExpiry";
import { useAuth } from "./_core/hooks/useAuth";
import ProtectedRoute from "./components/ProtectedRoute";
import DashboardLayout from "./components/DashboardLayout";
import { lazy, Suspense, type ComponentType } from "react";

const Onboarding = lazy(() => import("./pages/Onboarding"));
const IDREntityDashboard = lazy(() => import("./pages/IDREntityDashboard"));
const Notifications = lazy(() => import("./pages/Notifications"));
const Admin = lazy(() => import("./pages/Admin"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const DisputesList = lazy(() => import("./pages/DisputesList"));
const DisputeDetail = lazy(() => import("./pages/DisputeDetail"));
const NewDispute = lazy(() => import("./pages/NewDispute"));
const AIAssistant = lazy(() => import("./pages/AIAssistant"));
const StakeholderUpload = lazy(() => import("./pages/StakeholderUpload"));
const CMSSubmissionTracker = lazy(() => import("./pages/CMSSubmissionTracker"));
const EMRConnections = lazy(() => import("./pages/EMRConnections"));
const EMROnboarding = lazy(() => import("./pages/EMROnboarding"));
const StateBalanceBilling = lazy(() => import("./pages/StateBalanceBilling"));
const ExpertReview = lazy(() => import("./pages/ExpertReview"));
const Reports = lazy(() => import("./pages/Reports"));
const DisputeTemplates = lazy(() => import("./pages/DisputeTemplates"));
const LeadsManager = lazy(() => import("./pages/LeadsManager"));
const DocumentAnalyzer = lazy(() => import("./pages/DocumentAnalyzer"));
const AuditTrail = lazy(() => import("./pages/AuditTrail"));
const PayerIntelligence = lazy(() => import("./pages/PayerIntelligence"));
const WebhookManager = lazy(() => import("./pages/WebhookManager"));
const FinancialLedger = lazy(() => import("./pages/FinancialLedger"));
const GlobalSearch = lazy(() => import("./pages/GlobalSearch"));
const LakehouseExport = lazy(() => import("./pages/LakehouseExport"));
const AdminUserManagement = lazy(() => import("./pages/AdminUserManagement"));
const SystemHealthMonitor = lazy(() => import("./pages/SystemHealthMonitor"));
const GlobalSettings = lazy(() => import("./pages/GlobalSettings"));
const Changelog = lazy(() => import("./pages/Changelog"));
const HelpCenter = lazy(() => import("./pages/HelpCenter"));
const OfferNegotiationThread = lazy(() => import("./pages/OfferNegotiationThread"));
const PayerContactBook = lazy(() => import("./pages/PayerContactBook"));
const APIKeyManagement = lazy(() => import("./pages/APIKeyManagement"));
const SLABreachMonitor = lazy(() => import("./pages/SLABreachMonitor"));
const NSAComplianceChecklist = lazy(() => import("./pages/NSAComplianceChecklist"));
const PaymentReconciliation = lazy(() => import("./pages/PaymentReconciliation"));
const CustomReportBuilder = lazy(() => import("./pages/CustomReportBuilder"));
const BulkStatusChange = lazy(() => import("./pages/BulkStatusChange"));
const CSVImport = lazy(() => import("./pages/CSVImport"));
const WebhookEventReplay = lazy(() => import("./pages/WebhookEventReplay"));
const EmailDigestPreferences = lazy(() => import("./pages/EmailDigestPreferences"));
const DisputeMerge = lazy(() => import("./pages/DisputeMerge"));
const ArbitratorScorecard = lazy(() => import("./pages/ArbitratorScorecard"));
const SplitBillAnalysis = lazy(() => import("./pages/SplitBillAnalysis"));
const TwoFactorAuth = lazy(() => import("./pages/TwoFactorAuth"));
const MobileDisputeWizard = lazy(() => import("./pages/MobileDisputeWizard"));
const DisputeClone = lazy(() => import("./pages/DisputeClone"));
const PayerResponseTimeAnalytics = lazy(() => import("./pages/PayerResponseTimeAnalytics"));
const DisputeAnnotations = lazy(() => import("./pages/DisputeAnnotations"));
const BatchEvidenceUpload = lazy(() => import("./pages/BatchEvidenceUpload"));
const DisputeActivityFeed = lazy(() => import("./pages/DisputeActivityFeed"));
const PrintableDisputeSummary = lazy(() => import("./pages/PrintableDisputeSummary"));
const ArbitratorAssignmentHistory = lazy(() => import("./pages/ArbitratorAssignmentHistory"));
const DisputeWatchlist = lazy(() => import("./pages/DisputeWatchlist"));
const EscalationManager = lazy(() => import("./pages/EscalationManager"));
const AppealTracker = lazy(() => import("./pages/AppealTracker"));
const NarrativeGenerator = lazy(() => import("./pages/NarrativeGenerator"));
const DocumentExpiryTracker = lazy(() => import("./pages/DocumentExpiryTracker"));
const DisputeKanban = lazy(() => import("./pages/DisputeKanban"));
const QPABenchmarkLookup = lazy(() => import("./pages/QPABenchmarkLookup"));
const IDRCostEstimator = lazy(() => import("./pages/IDRCostEstimator"));
const NSADeadlineCalendar = lazy(() => import("./pages/NSADeadlineCalendar"));
const ClaimAgingReport = lazy(() => import("./pages/ClaimAgingReport"));
const ContractRateComparison = lazy(() => import("./pages/ContractRateComparison"));
const DisputeRiskHeatmap = lazy(() => import("./pages/DisputeRiskHeatmap"));
const BatchNotificationSender = lazy(() => import("./pages/BatchNotificationSender"));
const RegulatoryChangeFeed = lazy(() => import("./pages/RegulatoryChangeFeed"));
const OfferCounterWizard = lazy(() => import("./pages/OfferCounterWizard"));
const MultiPartyCoordinator = lazy(() => import("./pages/MultiPartyCoordinator"));
const ProviderNetworkGapAnalyzer = lazy(() => import("./pages/ProviderNetworkGapAnalyzer"));
const SmartDeadlineCalculator = lazy(() => import("./pages/SmartDeadlineCalculator"));
const PayerScorecard = lazy(() => import("./pages/PayerScorecard"));
const DisputeStatusTimeline = lazy(() => import("./pages/DisputeStatusTimeline"));
const AuditTrailViewer = lazy(() => import("./pages/AuditTrailViewer"));
const DisputeSearchAdvanced = lazy(() => import("./pages/DisputeSearchAdvanced"));
const DisputeFavorites = lazy(() => import("./pages/DisputeFavorites"));
const DisputeCompareView = lazy(() => import("./pages/DisputeCompareView"));
const DisputeTagManager = lazy(() => import("./pages/DisputeTagManager"));
const PerformanceBenchmarks = lazy(() => import("./pages/PerformanceBenchmarks"));
const DisputeReminders = lazy(() => import("./pages/DisputeReminders"));
const DisputeExportCenter = lazy(() => import("./pages/DisputeExportCenter"));
const UserRoleMatrix = lazy(() => import("./pages/UserRoleMatrix"));
const SystemHealthDashboard = lazy(() => import("./pages/SystemHealthDashboard"));
const LastEHRIntegration = lazy(() => import("./pages/LastEHRIntegration"));
const FHIRCapabilityExplorer = lazy(() => import("./pages/FHIRCapabilityExplorer"));
const BulkFHIRExport = lazy(() => import("./pages/BulkFHIRExport"));
const CDSHooksManager = lazy(() => import("./pages/CDSHooksManager"));
const USCDICompleteness = lazy(() => import("./pages/USCDICompleteness"));
const OllamaManager = lazy(() => import("./pages/OllamaManager"));
const DaVinciTransactions = lazy(() => import("./pages/DaVinciTransactions"));
const FHIRCacheViewer = lazy(() => import("./pages/FHIRCacheViewer"));
const SMARTTokenManager = lazy(() => import("./pages/SMARTTokenManager"));
const DisputeAccessControl = lazy(() => import("./pages/DisputeAccessControl"));
const HermesAssistant = lazy(() => import("./pages/HermesAssistant"));
const SmartFormVisualization = lazy(() => import("./pages/SmartFormVisualization"));
const CohortAnalysis = lazy(() => import("./pages/CohortAnalysis"));
const HeartbeatOperations = lazy(() => import("./pages/HeartbeatOperations"));
const ProviderDisputeManagement = lazy(() => import("./pages/ProviderDisputeManagement"));
const ProviderSandboxAcceptance = lazy(() => import("./pages/ProviderSandboxAcceptance"));

/** Helper: wraps a component in ProtectedRoute */
function P({ component: C, admin }: { component: ComponentType; admin?: boolean }) {
  return (
    <ProtectedRoute adminOnly={admin}>
      <C />
    </ProtectedRoute>
  );
}

/** Helper: wraps a component in ProtectedRoute + DashboardLayout (left sidebar) */
function PL({ component: C, admin }: { component: ComponentType; admin?: boolean }) {
  return (
    <ProtectedRoute adminOnly={admin}>
      <DashboardLayout>
        <C />
      </DashboardLayout>
    </ProtectedRoute>
  );
}

function Router() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path={"/"} component={Home} />
      <Route path={"/login"} component={LoginPage} />
      <Route path={"/404"} component={NotFound} />
      <Route path={"/changelog"} component={Changelog} />
      <Route path={"/help"} component={HelpCenter} />
      <Route path="/state-laws" component={StateBalanceBilling} />

      {/* Auth-required routes */}
      <Route path={"/onboarding"} component={() => <P component={Onboarding} />} />
      <Route path={"/dashboard"} component={() => <PL component={Dashboard} />} />
      <Route path={"/disputes/new"} component={() => <PL component={NewDispute} />} />
      <Route path={"/disputes/merge"} component={() => <PL component={DisputeMerge} />} />
      <Route path={"/disputes/wizard"} component={() => <PL component={MobileDisputeWizard} />} />
      <Route path={"/disputes/clone"} component={() => <PL component={DisputeClone} />} />
      <Route path={"/disputes/:id/negotiate"} component={() => <PL component={OfferNegotiationThread} />} />
      <Route path={"/disputes/:id"} component={() => <PL component={DisputeDetail} />} />
      <Route path="/disputes" component={() => <PL component={DisputesList} />} />
      <Route path="/provider/disputes" component={() => <PL component={ProviderDisputeManagement} />} />
      <Route path="/idr-entities" component={() => <PL component={IDREntityDashboard} />} />
      <Route path="/notifications" component={() => <PL component={Notifications} />} />
      <Route path="/ai-assistant" component={() => <PL component={AIAssistant} />} />
      <Route path="/stakeholder-upload" component={() => <PL component={StakeholderUpload} />} />
      <Route path="/cms-tracker" component={() => <PL component={CMSSubmissionTracker} />} />
      <Route path="/emr-connections" component={() => <PL component={EMRConnections} />} />
      <Route path="/emr-onboarding" component={() => <P component={EMROnboarding} />} />
      <Route path="/expert-review" component={() => <PL component={ExpertReview} />} />
      <Route path="/reports" component={() => <PL component={Reports} />} />
      <Route path="/doc-analyzer" component={() => <PL component={DocumentAnalyzer} />} />
      <Route path="/audit-trail" component={() => <PL component={AuditTrail} />} />
      <Route path="/payer-intelligence" component={() => <PL component={PayerIntelligence} />} />
      <Route path={"/webhooks"} component={() => <PL component={WebhookManager} />} />
      <Route path={"/ledger"} component={() => <PL component={FinancialLedger} />} />
      <Route path={"/search"} component={() => <PL component={GlobalSearch} />} />
      <Route path={"/lakehouse"} component={() => <PL component={LakehouseExport} />} />
      <Route path={"/system-health"} component={() => <PL component={SystemHealthMonitor} />} />
      <Route path={"/settings"} component={() => <PL component={GlobalSettings} />} />
      <Route path={"/disputes/:id/negotiate"} component={() => <P component={OfferNegotiationThread} />} />
      <Route path="/templates" component={() => <PL component={DisputeTemplates} />} />
      <Route path="/payer-contacts" component={() => <PL component={PayerContactBook} />} />
      <Route path="/api-keys" component={() => <PL component={APIKeyManagement} />} />
      <Route path="/sla-breaches" component={() => <PL component={SLABreachMonitor} />} />
      <Route path="/nsa-checklist" component={() => <PL component={NSAComplianceChecklist} />} />
      <Route path="/reconciliation" component={() => <PL component={PaymentReconciliation} />} />
      <Route path="/report-builder" component={() => <PL component={CustomReportBuilder} />} />
      <Route path="/bulk-actions" component={() => <PL component={BulkStatusChange} />} />
      <Route path="/csv-import" component={() => <PL component={CSVImport} />} />
      <Route path="/webhook-replay" component={() => <PL component={WebhookEventReplay} />} />
      <Route path="/email-prefs" component={() => <PL component={EmailDigestPreferences} />} />
      <Route path="/arbitrator-scorecard" component={() => <PL component={ArbitratorScorecard} />} />
      <Route path="/split-bill" component={() => <PL component={SplitBillAnalysis} />} />
      <Route path="/two-factor-auth" component={() => <PL component={TwoFactorAuth} />} />
      <Route path="/payer-response-times" component={() => <PL component={PayerResponseTimeAnalytics} />} />
      <Route path="/annotations" component={() => <PL component={DisputeAnnotations} />} />
      <Route path="/batch-evidence" component={() => <PL component={BatchEvidenceUpload} />} />
      <Route path="/activity-feed" component={() => <PL component={DisputeActivityFeed} />} />
      <Route path="/print-summary" component={() => <PL component={PrintableDisputeSummary} />} />
      <Route path="/arbitrator-history" component={() => <PL component={ArbitratorAssignmentHistory} />} />
      <Route path="/watchlist" component={() => <PL component={DisputeWatchlist} />} />
      <Route path="/escalations" component={() => <PL component={EscalationManager} />} />
      <Route path="/appeals" component={() => <PL component={AppealTracker} />} />
      <Route path="/narrative-generator" component={() => <PL component={NarrativeGenerator} />} />
      <Route path="/doc-expiry" component={() => <PL component={DocumentExpiryTracker} />} />
      <Route path="/kanban" component={() => <PL component={DisputeKanban} />} />
      <Route path="/qpa-benchmark" component={() => <PL component={QPABenchmarkLookup} />} />
      <Route path="/idr-cost-estimator" component={() => <PL component={IDRCostEstimator} />} />
      <Route path="/nsa-calendar" component={() => <PL component={NSADeadlineCalendar} />} />
      <Route path="/claim-aging" component={() => <PL component={ClaimAgingReport} />} />
      <Route path="/contract-rates" component={() => <PL component={ContractRateComparison} />} />
      <Route path="/risk-heatmap" component={() => <PL component={DisputeRiskHeatmap} />} />
      <Route path="/batch-notify" component={() => <PL component={BatchNotificationSender} />} />
      <Route path="/regulatory-feed" component={() => <PL component={RegulatoryChangeFeed} />} />
      <Route path="/counter-offer" component={() => <PL component={OfferCounterWizard} />} />
      <Route path="/multi-party" component={() => <PL component={MultiPartyCoordinator} />} />
      <Route path="/network-gaps" component={() => <PL component={ProviderNetworkGapAnalyzer} />} />
      <Route path="/deadline-calculator" component={() => <PL component={SmartDeadlineCalculator} />} />
      <Route path="/payer-scorecard" component={() => <PL component={PayerScorecard} />} />
      <Route path="/status-timeline" component={() => <PL component={DisputeStatusTimeline} />} />
      <Route path="/audit-viewer" component={() => <PL component={AuditTrailViewer} />} />
      <Route path="/advanced-search" component={() => <PL component={DisputeSearchAdvanced} />} />
      <Route path="/bookmarks" component={() => <PL component={DisputeFavorites} />} />
      <Route path="/compare" component={() => <PL component={DisputeCompareView} />} />
      <Route path="/tags" component={() => <PL component={DisputeTagManager} />} />
      <Route path="/benchmarks" component={() => <PL component={PerformanceBenchmarks} />} />
      <Route path="/reminders" component={() => <PL component={DisputeReminders} />} />
      <Route path="/export" component={() => <PL component={DisputeExportCenter} />} />
      <Route path="/role-matrix" component={() => <PL component={UserRoleMatrix} />} />
      <Route path="/system-health-dashboard" component={() => <PL component={SystemHealthDashboard} />} />
      <Route path="/last-ehr" component={() => <PL component={LastEHRIntegration} />} />
      <Route path="/fhir-capability" component={() => <PL component={FHIRCapabilityExplorer} />} />
      <Route path="/bulk-fhir-export" component={() => <PL component={BulkFHIRExport} />} />
      <Route path="/cds-hooks" component={() => <PL component={CDSHooksManager} />} />
      <Route path="/uscdi-completeness" component={() => <PL component={USCDICompleteness} />} />
      <Route path="/ollama" component={() => <PL component={OllamaManager} />} />
      <Route path="/davinci" component={() => <PL component={DaVinciTransactions} />} />
      <Route path="/fhir-cache" component={() => <PL component={FHIRCacheViewer} />} />
      <Route path="/smart-tokens" component={() => <PL component={SMARTTokenManager} />} />
      <Route path="/access-control" component={() => <PL component={DisputeAccessControl} />} />
      <Route path="/hermes" component={() => <PL component={HermesAssistant} />} />
      <Route path="/smartform-guide" component={() => <PL component={SmartFormVisualization} />} />
      <Route path="/cohort-analysis" component={() => <PL component={CohortAnalysis} />} />

      {/* Admin-only routes */}
      <Route path="/admin/leads" component={() => <PL component={LeadsManager} admin />} />
      <Route path="/admin/heartbeat" component={() => <PL component={HeartbeatOperations} admin />} />
      <Route path="/admin/provider-acceptance" component={() => <PL component={ProviderSandboxAcceptance} admin />} />
      <Route path={"/admin/users"} component={() => <PL component={AdminUserManagement} admin />} />
      <Route path="/admin" component={() => <PL component={Admin} admin />} />

      <Route component={NotFound} />
    </Switch>
  );
}

function AppInner() {
  useNetworkStatus();
  const { isAuthenticated } = useAuth();
  const { showWarning, warningRemainingMs, onSessionExtended } = useSessionExpiry(isAuthenticated);

  return (
    <>
      <Suspense fallback={<RouteLoading />}> 
        <Router />
      </Suspense>
      <SessionExpiryWarning
        open={showWarning}
        remainingMs={warningRemainingMs}
        onExtended={onSessionExtended}
      />
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <TooltipProvider>
          <Toaster />
          <AppInner />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;

function RouteLoading() {
  return <div className="flex min-h-[14rem] items-center justify-center text-sm text-muted-foreground" role="status">Loading workspace…</div>;
}
