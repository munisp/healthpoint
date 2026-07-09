import { Toaster } from "@/components/ui/sonner";
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

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/onboarding"} component={Onboarding} />
      <Route path={"/dashboard"} component={Dashboard} />
      <Route path={"/disputes"} component={DisputesList} />
      <Route path={"/disputes/new"} component={NewDispute} />
      <Route path={"/disputes/:id"} component={DisputeDetail} />
      <Route path="/idr-entities" component={IDREntityDashboard} />
      <Route path="/notifications" component={Notifications} />
      <Route path="/admin" component={Admin} />
      <Route path="/admin/leads" component={LeadsManager} />
      <Route path="/ai-assistant" component={AIAssistant} />
      <Route path="/stakeholder-upload" component={StakeholderUpload} />
      <Route path="/cms-tracker" component={CMSSubmissionTracker} />
      <Route path="/emr-connections" component={EMRConnections} />
      <Route path="/emr-onboarding" component={EMROnboarding} />
      <Route path="/state-laws" component={StateBalanceBilling} />
      <Route path="/expert-review" component={ExpertReview} />
      <Route path="/reports" component={Reports} />
      <Route path="/doc-analyzer" component={DocumentAnalyzer} />
      <Route path="/audit-trail" component={AuditTrail} />
      <Route path="/payer-intelligence" component={PayerIntelligence} />
      <Route path={"/webhooks"} component={WebhookManager} />
      <Route path={"/ledger"} component={FinancialLedger} />
      <Route path={"/search"} component={GlobalSearch} />
      <Route path={"/lakehouse"} component={LakehouseExport} />
      <Route path={"/admin/users"} component={AdminUserManagement} />
      <Route path={"/system-health"} component={SystemHealthMonitor} />
      <Route path={"/settings"} component={GlobalSettings} />
      <Route path={"/changelog"} component={Changelog} />
      <Route path={"/help"} component={HelpCenter} />
      <Route path={"/disputes/:id/negotiate"} component={OfferNegotiationThread} />
      <Route path="/templates" component={() => {
        const DashboardLayout = require("./components/DashboardLayout").default;
        return <DashboardLayout><DisputeTemplates /></DashboardLayout>;
      }} />
      <Route path="/payer-contacts" component={PayerContactBook} />
      <Route path="/api-keys" component={APIKeyManagement} />
      <Route path="/sla-breaches" component={SLABreachMonitor} />
      <Route path="/nsa-checklist" component={NSAComplianceChecklist} />
      <Route path="/reconciliation" component={PaymentReconciliation} />
      <Route path="/report-builder" component={CustomReportBuilder} />
      <Route path="/bulk-actions" component={BulkStatusChange} />
      <Route path="/csv-import" component={CSVImport} />
      <Route path="/webhook-replay" component={WebhookEventReplay} />
      <Route path="/email-prefs" component={EmailDigestPreferences} />
      <Route path="/disputes/merge" component={DisputeMerge} />
      <Route path="/arbitrator-scorecard" component={ArbitratorScorecard} />
      <Route path="/split-bill" component={SplitBillAnalysis} />
      <Route path="/two-factor-auth" component={TwoFactorAuth} />
      <Route path="/disputes/wizard" component={MobileDisputeWizard} />
      <Route path="/disputes/clone" component={DisputeClone} />
      <Route path="/payer-response-times" component={PayerResponseTimeAnalytics} />
      <Route path="/annotations" component={DisputeAnnotations} />
      <Route path="/batch-evidence" component={BatchEvidenceUpload} />
      <Route path="/activity-feed" component={DisputeActivityFeed} />
      <Route path="/print-summary" component={PrintableDisputeSummary} />
      <Route path="/arbitrator-history" component={ArbitratorAssignmentHistory} />
      <Route path="/watchlist" component={DisputeWatchlist} />
      <Route path="/escalations" component={EscalationManager} />
      <Route path="/appeals" component={AppealTracker} />
      <Route path="/narrative-generator" component={NarrativeGenerator} />
      <Route path="/doc-expiry" component={DocumentExpiryTracker} />
      <Route path="/kanban" component={DisputeKanban} />
      <Route path="/qpa-benchmark" component={QPABenchmarkLookup} />
      <Route path="/idr-cost-estimator" component={IDRCostEstimator} />
      <Route path="/nsa-calendar" component={NSADeadlineCalendar} />
      <Route path="/claim-aging" component={ClaimAgingReport} />
      <Route path="/contract-rates" component={ContractRateComparison} />
      <Route path="/risk-heatmap" component={DisputeRiskHeatmap} />
      <Route path="/batch-notify" component={BatchNotificationSender} />
      <Route path="/outcome-simulator" component={DisputeOutcomeSimulator} />
      <Route path="/regulatory-feed" component={RegulatoryChangeFeed} />
      <Route path="/counter-offer" component={OfferCounterWizard} />
      <Route path="/multi-party" component={MultiPartyCoordinator} />
      <Route path="/network-gaps" component={ProviderNetworkGapAnalyzer} />
      <Route path="/deadline-calculator" component={SmartDeadlineCalculator} />
      <Route path="/payer-scorecard" component={PayerScorecard} />
      <Route path="/status-timeline" component={DisputeStatusTimeline} />
      <Route path="/audit-viewer" component={AuditTrailViewer} />
      <Route path="/advanced-search" component={DisputeSearchAdvanced} />
      <Route path="/bookmarks" component={DisputeFavorites} />
      <Route path="/compare" component={DisputeCompareView} />
      <Route path="/tags" component={DisputeTagManager} />
      <Route path="/benchmarks" component={PerformanceBenchmarks} />
      <Route path="/reminders" component={DisputeReminders} />
      <Route path="/export" component={DisputeExportCenter} />
      <Route path="/role-matrix" component={UserRoleMatrix} />
      <Route path="/system-health-dashboard" component={SystemHealthDashboard} />
      <Route path="/last-ehr" component={LastEHRIntegration} />
      <Route path="/fhir-capability" component={FHIRCapabilityExplorer} />
      <Route path="/bulk-fhir-export" component={BulkFHIRExport} />
      <Route path="/cds-hooks" component={CDSHooksManager} />
      <Route path="/uscdi-completeness" component={USCDICompleteness} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
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
