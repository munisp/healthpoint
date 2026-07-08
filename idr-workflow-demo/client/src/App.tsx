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
import WebhookManager from "./pages/WebhookManager";

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
      <Route path="/webhooks" component={WebhookManager} />
      <Route path="/templates" component={() => {
        const DashboardLayout = require("./components/DashboardLayout").default;
        return <DashboardLayout><DisputeTemplates /></DashboardLayout>;
      }} />
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
