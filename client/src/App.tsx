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
import Onboarding from "./pages/Onboarding";
import IDREntityDashboard from "@/pages/IDREntityDashboard";
import Notifications from "@/pages/Notifications";
import Admin from "@/pages/Admin";
import Dashboard from "./pages/Dashboard";
import DisputesList from "./pages/DisputesList";
import DisputeDetail from "./pages/DisputeDetail";
import NewDispute from "./pages/NewDispute";
import AIAssistant from "./pages/AIAssistant";
import StakeholderUpload from "./pages/StakeholderUpload";
import CMSSubmissionTracker from "./pages/CMSSubmissionTracker";
import EMRConnections from "./pages/EMRConnections";
import EMROnboarding from "./pages/EMROnboarding";
import StateBalanceBilling from "./pages/StateBalanceBilling";
import ExpertReview from "./pages/ExpertReview";
import Reports from "./pages/Reports";
import DisputeTemplates from "./pages/DisputeTemplates";
import LeadsManager from "./pages/LeadsManager";
import DocumentAnalyzer from "./pages/DocumentAnalyzer";
import AuditTrail from "./pages/AuditTrail";
import PayerIntelligence from "./pages/PayerIntelligence";
import WebhookManager from "@/pages/WebhookManager";
import FinancialLedger from "@/pages/FinancialLedger";
import GlobalSearch from "@/pages/GlobalSearch";
import LakehouseExport from "@/pages/LakehouseExport";
import AdminUserManagement from "@/pages/AdminUserManagement";
import SystemHealthMonitor from "@/pages/SystemHealthMonitor";
import GlobalSettings from "@/pages/GlobalSettings";
import Changelog from "@/pages/Changelog";
import HelpCenter from "@/pages/HelpCenter";
import OfferNegotiationThread from "@/pages/OfferNegotiationThread";
import PayerContactBook from "@/pages/PayerContactBook";
import APIKeyManagement from "@/pages/APIKeyManagement";
import SLABreachMonitor from "@/pages/SLABreachMonitor";
import NSAComplianceChecklist from "@/pages/NSAComplianceChecklist";
import PaymentReconciliation from "@/pages/PaymentReconciliation";
import CustomReportBuilder from "@/pages/CustomReportBuilder";
import BulkStatusChange from "@/pages/BulkStatusChange";
import CSVImport from "@/pages/CSVImport";
import WebhookEventReplay from "@/pages/WebhookEventReplay";
import EmailDigestPreferences from "@/pages/EmailDigestPreferences";
import DisputeMerge from "@/pages/DisputeMerge";
import ArbitratorScorecard from "@/pages/ArbitratorScorecard";
import SplitBillAnalysis from "@/pages/SplitBillAnalysis";
import TwoFactorAuth from "@/pages/TwoFactorAuth";
import MobileDisputeWizard from "@/pages/MobileDisputeWizard";
import DisputeClone from "@/pages/DisputeClone";
import PayerResponseTimeAnalytics from "@/pages/PayerResponseTimeAnalytics";
import DisputeAnnotations from "@/pages/DisputeAnnotations";
import BatchEvidenceUpload from "@/pages/BatchEvidenceUpload";
import DisputeActivityFeed from "@/pages/DisputeActivityFeed";
import PrintableDisputeSummary from "@/pages/PrintableDisputeSummary";
import ArbitratorAssignmentHistory from "@/pages/ArbitratorAssignmentHistory";
import DisputeWatchlist from "@/pages/DisputeWatchlist";
import EscalationManager from "@/pages/EscalationManager";
import AppealTracker from "@/pages/AppealTracker";
import NarrativeGenerator from "@/pages/NarrativeGenerator";
import DocumentExpiryTracker from "@/pages/DocumentExpiryTracker";
import DisputeKanban from "@/pages/DisputeKanban";
import QPABenchmarkLookup from "@/pages/QPABenchmarkLookup";
import IDRCostEstimator from "@/pages/IDRCostEstimator";
import NSADeadlineCalendar from "@/pages/NSADeadlineCalendar";
import ClaimAgingReport from "@/pages/ClaimAgingReport";
import ContractRateComparison from "@/pages/ContractRateComparison";
import DisputeRiskHeatmap from "@/pages/DisputeRiskHeatmap";
import BatchNotificationSender from "@/pages/BatchNotificationSender";
import DisputeOutcomeSimulator from "@/pages/DisputeOutcomeSimulator";
import RegulatoryChangeFeed from "@/pages/RegulatoryChangeFeed";
import OfferCounterWizard from "@/pages/OfferCounterWizard";
import MultiPartyCoordinator from "@/pages/MultiPartyCoordinator";
import ProviderNetworkGapAnalyzer from "@/pages/ProviderNetworkGapAnalyzer";
import SmartDeadlineCalculator from "@/pages/SmartDeadlineCalculator";
import PayerScorecard from "@/pages/PayerScorecard";
import DisputeStatusTimeline from "@/pages/DisputeStatusTimeline";
import AuditTrailViewer from "@/pages/AuditTrailViewer";
import DisputeSearchAdvanced from "@/pages/DisputeSearchAdvanced";
import DisputeFavorites from "@/pages/DisputeFavorites";
import DisputeCompareView from "@/pages/DisputeCompareView";
import DisputeTagManager from "@/pages/DisputeTagManager";
import PerformanceBenchmarks from "@/pages/PerformanceBenchmarks";
import DisputeReminders from "@/pages/DisputeReminders";
import DisputeExportCenter from "@/pages/DisputeExportCenter";
import UserRoleMatrix from "@/pages/UserRoleMatrix";
import SystemHealthDashboard from "@/pages/SystemHealthDashboard";
import LastEHRIntegration from "@/pages/LastEHRIntegration";
import FHIRCapabilityExplorer from "@/pages/FHIRCapabilityExplorer";
import BulkFHIRExport from "@/pages/BulkFHIRExport";
import CDSHooksManager from "@/pages/CDSHooksManager";
import USCDICompleteness from "@/pages/USCDICompleteness";
import OllamaManager from "@/pages/OllamaManager";
import DaVinciTransactions from "@/pages/DaVinciTransactions";
import FHIRCacheViewer from "@/pages/FHIRCacheViewer";
import SMARTTokenManager from "@/pages/SMARTTokenManager";
import DisputeAccessControl from "@/pages/DisputeAccessControl";
import HermesAssistant from "@/pages/HermesAssistant";
import SmartFormVisualization from "@/pages/SmartFormVisualization";
import ProtectedRoute from "./components/ProtectedRoute";
import DashboardLayout from "./components/DashboardLayout";

/** Helper: wraps a component in ProtectedRoute */
function P({ component: C, admin }: { component: React.ComponentType; admin?: boolean }) {
  return (
    <ProtectedRoute adminOnly={admin}>
      <C />
    </ProtectedRoute>
  );
}

/** Helper: wraps a component in ProtectedRoute + DashboardLayout (left sidebar) */
function PL({ component: C, admin }: { component: React.ComponentType; admin?: boolean }) {
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
      <Route path={"/disputes"} component={() => <PL component={DisputesList} />} />
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
      <Route path="/outcome-simulator" component={() => <PL component={DisputeOutcomeSimulator} />} />
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

      {/* Admin-only routes */}
      <Route path="/admin/leads" component={() => <PL component={LeadsManager} admin />} />
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
      <Router />
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
