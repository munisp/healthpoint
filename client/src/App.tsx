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
