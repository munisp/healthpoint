import { Toaster } from "@/components/ui/sonner";
import { useNetworkStatus } from "./hooks/useNetworkStatus";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
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
import ProtectedRoute from "./components/ProtectedRoute";

/** Helper: wraps a component in ProtectedRoute */
function P({ component: C, admin }: { component: React.ComponentType; admin?: boolean }) {
  return (
    <ProtectedRoute adminOnly={admin}>
      <C />
    </ProtectedRoute>
  );
}

function Router() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path={"/"} component={Home} />
      <Route path={"/404"} component={NotFound} />
      <Route path={"/changelog"} component={Changelog} />
      <Route path={"/help"} component={HelpCenter} />
      <Route path="/state-laws" component={StateBalanceBilling} />

      {/* Auth-required routes */}
      <Route path={"/onboarding"} component={() => <P component={Onboarding} />} />
      <Route path={"/dashboard"} component={() => <P component={Dashboard} />} />
      <Route path={"/disputes/new"} component={() => <P component={NewDispute} />} />
      <Route path={"/disputes/merge"} component={() => <P component={DisputeMerge} />} />
      <Route path={"/disputes/wizard"} component={() => <P component={MobileDisputeWizard} />} />
      <Route path={"/disputes/clone"} component={() => <P component={DisputeClone} />} />
      <Route path={"/disputes/:id/negotiate"} component={() => <P component={OfferNegotiationThread} />} />
      <Route path={"/disputes/:id"} component={() => <P component={DisputeDetail} />} />
      <Route path={"/disputes"} component={() => <P component={DisputesList} />} />
      <Route path="/idr-entities" component={() => <P component={IDREntityDashboard} />} />
      <Route path="/notifications" component={() => <P component={Notifications} />} />
      <Route path="/ai-assistant" component={() => <P component={AIAssistant} />} />
      <Route path="/stakeholder-upload" component={() => <P component={StakeholderUpload} />} />
      <Route path="/cms-tracker" component={() => <P component={CMSSubmissionTracker} />} />
      <Route path="/emr-connections" component={() => <P component={EMRConnections} />} />
      <Route path="/emr-onboarding" component={() => <P component={EMROnboarding} />} />
      <Route path="/expert-review" component={() => <P component={ExpertReview} />} />
      <Route path="/reports" component={() => <P component={Reports} />} />
      <Route path="/doc-analyzer" component={() => <P component={DocumentAnalyzer} />} />
      <Route path="/audit-trail" component={() => <P component={AuditTrail} />} />
      <Route path="/payer-intelligence" component={() => <P component={PayerIntelligence} />} />
      <Route path={"/webhooks"} component={() => <P component={WebhookManager} />} />
      <Route path={"/ledger"} component={() => <P component={FinancialLedger} />} />
      <Route path={"/search"} component={() => <P component={GlobalSearch} />} />
      <Route path={"/lakehouse"} component={() => <P component={LakehouseExport} />} />
      <Route path={"/system-health"} component={() => <P component={SystemHealthMonitor} />} />
      <Route path={"/settings"} component={() => <P component={GlobalSettings} />} />
      <Route path={"/disputes/:id/negotiate"} component={() => <P component={OfferNegotiationThread} />} />
      <Route path="/templates" component={() => {
        const DashboardLayout = require("./components/DashboardLayout").default;
        return <ProtectedRoute><DashboardLayout><DisputeTemplates /></DashboardLayout></ProtectedRoute>;
      }} />
      <Route path="/payer-contacts" component={() => <P component={PayerContactBook} />} />
      <Route path="/api-keys" component={() => <P component={APIKeyManagement} />} />
      <Route path="/sla-breaches" component={() => <P component={SLABreachMonitor} />} />
      <Route path="/nsa-checklist" component={() => <P component={NSAComplianceChecklist} />} />
      <Route path="/reconciliation" component={() => <P component={PaymentReconciliation} />} />
      <Route path="/report-builder" component={() => <P component={CustomReportBuilder} />} />
      <Route path="/bulk-actions" component={() => <P component={BulkStatusChange} />} />
      <Route path="/csv-import" component={() => <P component={CSVImport} />} />
      <Route path="/webhook-replay" component={() => <P component={WebhookEventReplay} />} />
      <Route path="/email-prefs" component={() => <P component={EmailDigestPreferences} />} />
      <Route path="/arbitrator-scorecard" component={() => <P component={ArbitratorScorecard} />} />
      <Route path="/split-bill" component={() => <P component={SplitBillAnalysis} />} />
      <Route path="/two-factor-auth" component={() => <P component={TwoFactorAuth} />} />
      <Route path="/payer-response-times" component={() => <P component={PayerResponseTimeAnalytics} />} />
      <Route path="/annotations" component={() => <P component={DisputeAnnotations} />} />
      <Route path="/batch-evidence" component={() => <P component={BatchEvidenceUpload} />} />
      <Route path="/activity-feed" component={() => <P component={DisputeActivityFeed} />} />
      <Route path="/print-summary" component={() => <P component={PrintableDisputeSummary} />} />
      <Route path="/arbitrator-history" component={() => <P component={ArbitratorAssignmentHistory} />} />
      <Route path="/watchlist" component={() => <P component={DisputeWatchlist} />} />
      <Route path="/escalations" component={() => <P component={EscalationManager} />} />
      <Route path="/appeals" component={() => <P component={AppealTracker} />} />
      <Route path="/narrative-generator" component={() => <P component={NarrativeGenerator} />} />
      <Route path="/doc-expiry" component={() => <P component={DocumentExpiryTracker} />} />
      <Route path="/kanban" component={() => <P component={DisputeKanban} />} />
      <Route path="/qpa-benchmark" component={() => <P component={QPABenchmarkLookup} />} />
      <Route path="/idr-cost-estimator" component={() => <P component={IDRCostEstimator} />} />
      <Route path="/nsa-calendar" component={() => <P component={NSADeadlineCalendar} />} />
      <Route path="/claim-aging" component={() => <P component={ClaimAgingReport} />} />
      <Route path="/contract-rates" component={() => <P component={ContractRateComparison} />} />
      <Route path="/risk-heatmap" component={() => <P component={DisputeRiskHeatmap} />} />
      <Route path="/batch-notify" component={() => <P component={BatchNotificationSender} />} />
      <Route path="/outcome-simulator" component={() => <P component={DisputeOutcomeSimulator} />} />
      <Route path="/regulatory-feed" component={() => <P component={RegulatoryChangeFeed} />} />
      <Route path="/counter-offer" component={() => <P component={OfferCounterWizard} />} />
      <Route path="/multi-party" component={() => <P component={MultiPartyCoordinator} />} />
      <Route path="/network-gaps" component={() => <P component={ProviderNetworkGapAnalyzer} />} />
      <Route path="/deadline-calculator" component={() => <P component={SmartDeadlineCalculator} />} />
      <Route path="/payer-scorecard" component={() => <P component={PayerScorecard} />} />
      <Route path="/status-timeline" component={() => <P component={DisputeStatusTimeline} />} />
      <Route path="/audit-viewer" component={() => <P component={AuditTrailViewer} />} />
      <Route path="/advanced-search" component={() => <P component={DisputeSearchAdvanced} />} />
      <Route path="/bookmarks" component={() => <P component={DisputeFavorites} />} />
      <Route path="/compare" component={() => <P component={DisputeCompareView} />} />
      <Route path="/tags" component={() => <P component={DisputeTagManager} />} />
      <Route path="/benchmarks" component={() => <P component={PerformanceBenchmarks} />} />
      <Route path="/reminders" component={() => <P component={DisputeReminders} />} />
      <Route path="/export" component={() => <P component={DisputeExportCenter} />} />
      <Route path="/role-matrix" component={() => <P component={UserRoleMatrix} />} />
      <Route path="/system-health-dashboard" component={() => <P component={SystemHealthDashboard} />} />
      <Route path="/last-ehr" component={() => <P component={LastEHRIntegration} />} />
      <Route path="/fhir-capability" component={() => <P component={FHIRCapabilityExplorer} />} />
      <Route path="/bulk-fhir-export" component={() => <P component={BulkFHIRExport} />} />
      <Route path="/cds-hooks" component={() => <P component={CDSHooksManager} />} />
      <Route path="/uscdi-completeness" component={() => <P component={USCDICompleteness} />} />
      <Route path="/ollama" component={() => <P component={OllamaManager} />} />
      <Route path="/davinci" component={() => <P component={DaVinciTransactions} />} />
      <Route path="/fhir-cache" component={() => <P component={FHIRCacheViewer} />} />
      <Route path="/smart-tokens" component={() => <P component={SMARTTokenManager} />} />
      <Route path="/access-control" component={() => <P component={DisputeAccessControl} />} />
      <Route path="/hermes" component={() => <P component={HermesAssistant} />} />

      {/* Admin-only routes */}
      <Route path="/admin/leads" component={() => <P component={LeadsManager} admin />} />
      <Route path={"/admin/users"} component={() => <P component={AdminUserManagement} admin />} />
      <Route path="/admin" component={() => <P component={Admin} admin />} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useNetworkStatus();
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
