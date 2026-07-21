import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { APP_LOGO, APP_TITLE } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  AlertOctagon,
  ArrowDownToLine,
  Award,
  BarChart,
  BarChart2,
  BarChart3,
  Bell,
  BellRing,
  BookMarked,
  BookOpen,
  BookTemplate,
  BookUser,
  BookmarkCheck,
  Bot,
  Brain,
  Building2,
  Calculator,
  CalendarDays,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Command,
  Copy,
  Cpu,
  CreditCard,
  Database,
  DollarSign,
  Download,
  Eye,
  FileDown,
  FileUp,
  FileWarning,
  GitBranch,
  GitCompare,
  GitMerge,
  Group,
  HelpCircle,
  History,
  Kanban,
  KeyRound,
  Layers,
  LayoutDashboard,
  Lock,
  LogOut,
  Mail,
  Megaphone,
  Moon,
  Network,
  PanelLeft,
  PlusCircle,
  Printer,
  Receipt,
  RotateCcw,
  Scale,
  ScanLine,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Shuffle,
  Siren,
  Smartphone,
  Sparkles,
  Star,
  Stethoscope,
  StickyNote,
  Sun,
  Tag,
  Target,
  TrendingDown,
  TrendingUp,
  Upload,
  UserCheck,
  UserRoundSearch,
  Users,
  Webhook,
  Workflow,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { useLocation } from "wouter";
import KeyboardShortcutsModal from "./KeyboardShortcutsModal";
import OnboardingTour from "./OnboardingTour";
import { useRecentDisputes } from "../hooks/useRecentDisputes";

// ─── Navigation structure ────────────────────────────────────────────────────
// Each group has a label, icon, default-open state, and list of items.
// Items with `adminOnly: true` are hidden for non-admin users.

type NavItem = {
  icon: React.ElementType;
  label: string;
  path: string;
  adminOnly?: boolean;
};

type NavGroup = {
  id: string;
  label: string;
  icon: React.ElementType;
  defaultOpen: boolean;
  items: NavItem[];
  adminOnly?: boolean;
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "core",
    label: "Core Workflow",
    icon: LayoutDashboard,
    defaultOpen: true,
    items: [
      { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
      { icon: Scale, label: "Disputes", path: "/disputes" },
      { icon: PlusCircle, label: "New Dispute", path: "/disputes/new" },
      { icon: Smartphone, label: "Dispute Wizard", path: "/disputes/wizard" },
      { icon: Kanban, label: "Kanban Board", path: "/kanban" },
      { icon: Workflow, label: "Workflow Monitor", path: "/workflow-monitor" },
    ],
  },
  {
    id: "idr",
    label: "IDR Process",
    icon: ClipboardList,
    defaultOpen: false,
    items: [
      { icon: Building2, label: "IDR Entities", path: "/idr-entities" },
      { icon: ClipboardList, label: "CMS Tracker", path: "/cms-tracker" },
      { icon: ClipboardCheck, label: "NSA Checklist", path: "/nsa-checklist" },
      { icon: CalendarDays, label: "NSA Calendar", path: "/nsa-calendar" },
      { icon: Calculator, label: "IDR Cost Estimator", path: "/idr-cost-estimator" },
      { icon: Calculator, label: "Deadline Calculator", path: "/deadline-calculator" },
      { icon: GitBranch, label: "Status Timeline", path: "/status-timeline" },
    ],
  },
  {
    id: "analytics",
    label: "Analytics & Intelligence",
    icon: BarChart2,
    defaultOpen: false,
    items: [
      { icon: BarChart2, label: "Reports", path: "/reports" },
      { icon: BarChart3, label: "Report Builder", path: "/report-builder" },
      { icon: DollarSign, label: "QPA Benchmark", path: "/qpa-benchmark" },
      { icon: BarChart2, label: "Benchmarks", path: "/benchmarks" },
      { icon: Group, label: "Cohort Analysis", path: "/cohort-analysis" },
      { icon: Building2, label: "Payer Intel", path: "/payer-intelligence" },
      { icon: Target, label: "Risk Heatmap", path: "/risk-heatmap" },
      { icon: Shuffle, label: "Outcome Simulator", path: "/outcome-simulator" },
      { icon: TrendingDown, label: "Claim Aging", path: "/claim-aging" },
      { icon: Clock, label: "Payer Response Times", path: "/payer-response-times" },
      { icon: Star, label: "Payer Scorecard", path: "/payer-scorecard" },
      { icon: BarChart, label: "Contract Rates", path: "/contract-rates" },
      { icon: Network, label: "Network Gaps", path: "/network-gaps" },
    ],
  },
  {
    id: "documents",
    label: "Documents & Evidence",
    icon: ScanLine,
    defaultOpen: false,
    items: [
      { icon: ScanLine, label: "Doc Analyzer", path: "/doc-analyzer" },
      { icon: Upload, label: "Stakeholder Upload", path: "/stakeholder-upload" },
      { icon: Upload, label: "Batch Evidence", path: "/batch-evidence" },
      { icon: BookTemplate, label: "Templates", path: "/templates" },
      { icon: Sparkles, label: "SmartForm Guide", path: "/smartform-guide" },
      { icon: StickyNote, label: "Annotations", path: "/annotations" },
      { icon: FileWarning, label: "Doc Expiry", path: "/doc-expiry" },
      { icon: Printer, label: "Print Summary", path: "/print-summary" },
    ],
  },
  {
    id: "compliance",
    label: "Compliance & Legal",
    icon: Shield,
    defaultOpen: false,
    items: [
      { icon: Activity, label: "Audit Trail", path: "/audit-trail" },
      { icon: Shield, label: "Audit Viewer", path: "/audit-viewer" },
      { icon: BookOpen, label: "State Laws", path: "/state-laws" },
      { icon: BookOpen, label: "Regulatory Feed", path: "/regulatory-feed" },
      { icon: ClipboardCheck, label: "USCDI Completeness", path: "/uscdi-completeness" },
      { icon: Shield, label: "Role Matrix", path: "/role-matrix" },
      { icon: AlertOctagon, label: "SLA Breaches", path: "/sla-breaches" },
      { icon: CreditCard, label: "Reconciliation", path: "/reconciliation" },
    ],
  },
  {
    id: "integrations",
    label: "Integrations & Data",
    icon: Database,
    defaultOpen: false,
    items: [
      { icon: Database, label: "EMR Connections", path: "/emr-connections" },
      { icon: Cpu, label: "FHIR Explorer", path: "/fhir-capability" },
      { icon: FileDown, label: "Bulk FHIR Export", path: "/bulk-fhir-export" },
      { icon: Webhook, label: "CDS Hooks", path: "/cds-hooks" },
      { icon: ArrowDownToLine, label: "Lakehouse", path: "/lakehouse" },
      { icon: Webhook, label: "Webhooks", path: "/webhooks" },
      { icon: RotateCcw, label: "Webhook Replay", path: "/webhook-replay" },
      { icon: FileUp, label: "CSV Import", path: "/csv-import" },
      { icon: KeyRound, label: "API Keys", path: "/api-keys" },
      { icon: Stethoscope, label: "Last-EHR Integration", path: "/last-ehr" },
    ],
  },
  {
    id: "ai",
    label: "AI & Automation",
    icon: Brain,
    defaultOpen: false,
    items: [
      { icon: Brain, label: "AI Assistant", path: "/ai-assistant" },
      { icon: Bot, label: "Hermes AI Agent", path: "/hermes" },
      { icon: Bot, label: "Ollama LLM Manager", path: "/ollama" },
      { icon: UserCheck, label: "Expert Review", path: "/expert-review" },
      { icon: Brain, label: "Narrative Generator", path: "/narrative-generator" },
      { icon: Group, label: "Counter-Offer Wizard", path: "/counter-offer" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    icon: Users,
    defaultOpen: false,
    items: [
      { icon: BookUser, label: "Payer Contacts", path: "/payer-contacts" },
      { icon: UserRoundSearch, label: "Leads CRM", path: "/admin/leads" },
      { icon: Siren, label: "Escalations", path: "/escalations" },
      { icon: TrendingUp, label: "Appeals", path: "/appeals" },
      { icon: Eye, label: "Watchlist", path: "/watchlist" },
      { icon: Bell, label: "Notifications", path: "/notifications" },
      { icon: Bell, label: "Reminders", path: "/reminders" },
      { icon: Activity, label: "Activity Feed", path: "/activity-feed" },
      { icon: Megaphone, label: "Batch Notify", path: "/batch-notify" },
      { icon: Users, label: "Multi-Party", path: "/multi-party" },
      { icon: GitMerge, label: "Merge Disputes", path: "/disputes/merge" },
      { icon: Copy, label: "Clone Dispute", path: "/disputes/clone" },
      { icon: Layers, label: "Bulk Actions", path: "/bulk-actions" },
      { icon: Award, label: "Arbitrator Scorecard", path: "/arbitrator-scorecard" },
      { icon: History, label: "Arbitrator History", path: "/arbitrator-history" },
      { icon: Search, label: "Advanced Search", path: "/advanced-search" },
      { icon: BookmarkCheck, label: "Bookmarks", path: "/bookmarks" },
      { icon: GitCompare, label: "Compare Disputes", path: "/compare" },
      { icon: Tag, label: "Tag Manager", path: "/tags" },
      { icon: Download, label: "Export Center", path: "/export" },
    ],
  },
  {
    id: "admin",
    label: "Administration",
    icon: ShieldCheck,
    defaultOpen: false,
    adminOnly: true,
    items: [
      { icon: ShieldCheck, label: "Admin", path: "/admin", adminOnly: true },
      { icon: Users, label: "User Mgmt", path: "/admin/users", adminOnly: true },
      { icon: BookOpen, label: "Fin. Ledger", path: "/ledger" },
      { icon: Receipt, label: "Transaction History", path: "/transactions" },
      { icon: Activity, label: "System Health", path: "/system-health" },
      { icon: Activity, label: "System Health Dashboard", path: "/system-health-dashboard" },
      { icon: Settings, label: "Settings", path: "/settings" },
      { icon: Shield, label: "Two-Factor Auth", path: "/two-factor-auth" },
      { icon: Mail, label: "Email Prefs", path: "/email-prefs" },
      { icon: BookMarked, label: "Changelog", path: "/changelog" },
      { icon: HelpCircle, label: "Help Center", path: "/help" },
      { icon: Search, label: "Global Search", path: "/search" },
    ],
  },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const OPEN_GROUPS_KEY = "sidebar-open-groups";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [notifOpen, setNotifOpen] = useState(false);

  // Persist which groups are open
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(OPEN_GROUPS_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    // Default: only "core" open
    const defaults: Record<string, boolean> = {};
    NAV_GROUPS.forEach((g) => {
      defaults[g.id] = g.defaultOpen;
    });
    return defaults;
  });

  // Auto-expand the group that contains the current route
  useEffect(() => {
    const activeGroup = NAV_GROUPS.find((g) =>
      g.items.some((i) => i.path === location)
    );
    if (activeGroup && !openGroups[activeGroup.id]) {
      setOpenGroups((prev) => {
        const next = { ...prev, [activeGroup.id]: true };
        localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(next));
        return next;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Real-time notification bell — polls every 30 seconds
  const { data: notifData, refetch: refetchNotifs } =
    trpc.notifications.list.useQuery(
      { unreadOnly: false },
      { refetchInterval: 30_000, staleTime: 25_000 }
    );
  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => refetchNotifs(),
  });
  const unreadCount =
    notifData?.filter((n: { isRead: boolean | null }) => !n.isRead).length ?? 0;

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft =
        sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  const isAdmin = user?.role === "admin";
  const { recent: recentDisputes } = useRecentDisputes();

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r-0" disableTransition={isResizing}>
          <SidebarHeader className="border-b h-14 justify-center">
            <div className="flex items-center justify-between px-2 group-data-[collapsible=icon]:px-0">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={APP_LOGO}
                  className="h-9 w-9 rounded-lg object-cover ring-1 ring-border shrink-0 group-data-[collapsible=icon]:hidden"
                  alt="Logo"
                />
                <span className="font-semibold tracking-tight truncate group-data-[collapsible=icon]:hidden">
                  {APP_TITLE}
                </span>
              </div>
              <SidebarToggleButton />
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <ScrollArea className="flex-1">
              <div className="py-2 px-2 space-y-0.5">
                {/* ── Recent Disputes quick-access ── */}
                {!isCollapsed && recentDisputes.length > 0 && (
                  <div className="mb-1">
                    <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      <History className="h-3 w-3 shrink-0" />
                      <span>Recent</span>
                    </div>
                    <SidebarMenu className="gap-0">
                      {recentDisputes.map((d) => (
                        <SidebarMenuItem key={d.id}>
                          <SidebarMenuButton
                            isActive={location === `/disputes/${d.id}`}
                            onClick={() => setLocation(`/disputes/${d.id}`)}
                            className={`h-8 text-xs transition-all ${
                              location === `/disputes/${d.id}`
                                ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <FileWarning className="h-3.5 w-3.5 shrink-0 opacity-60" />
                            <span className="flex-1 truncate font-mono text-[11px]">{d.referenceNumber}</span>
                            <span
                              className={`text-[9px] px-1 rounded font-medium shrink-0 ${
                                d.status === "closed"
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                  : d.status === "ineligible"
                                  ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                                  : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
                              }`}
                            >
                              {d.status === "open_negotiation" ? "NEGO"
                                : d.status === "idr_active" ? "IDR"
                                : d.status === "closed" ? "DONE"
                                : d.status === "ineligible" ? "INELIG"
                                : d.status.toUpperCase().slice(0, 4)}
                            </span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                    <div className="mx-2 my-1 border-t border-border/50" />
                  </div>
                )}
                {NAV_GROUPS.map((group) => {
                  // Hide admin-only groups from non-admins
                  if (group.adminOnly && !isAdmin) return null;

                  const isOpen = openGroups[group.id] ?? group.defaultOpen;
                  const GroupIcon = group.icon;

                  // In icon-collapsed mode, show items directly without group headers
                  if (isCollapsed) {
                    return (
                      <SidebarMenu key={group.id} className="gap-0.5">
                        {group.items
                          .filter((item) => !item.adminOnly || isAdmin)
                          .map((item) => (
                            <SidebarMenuItem key={item.path}>
                              <SidebarMenuButton
                                isActive={location === item.path}
                                onClick={() => setLocation(item.path)}
                                tooltip={item.label}
                                className={`h-9 transition-all ${
                                  location === item.path
                                    ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground shadow-sm"
                                    : ""
                                }`}
                              >
                                <item.icon className="h-4 w-4" />
                                <span>{item.label}</span>
                              </SidebarMenuButton>
                            </SidebarMenuItem>
                          ))}
                      </SidebarMenu>
                    );
                  }

                  return (
                    <Collapsible
                      key={group.id}
                      open={isOpen}
                      onOpenChange={() => toggleGroup(group.id)}
                    >
                      {/* Group header */}
                      <CollapsibleTrigger asChild>
                        <button className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors select-none">
                          <GroupIcon className="h-3.5 w-3.5 shrink-0" />
                          <span className="flex-1 text-left">{group.label}</span>
                          {isOpen ? (
                            <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
                          )}
                        </button>
                      </CollapsibleTrigger>

                      <CollapsibleContent>
                        <SidebarMenu className="gap-0.5 pl-2 mt-0.5 mb-1">
                          {group.items
                            .filter((item) => !item.adminOnly || isAdmin)
                            .map((item) => (
                              <SidebarMenuItem key={item.path}>
                                <SidebarMenuButton
                                  isActive={location === item.path}
                                  onClick={() => setLocation(item.path)}
                                  tooltip={item.label}
                                  className={`h-8 text-sm transition-all ${
                                    location === item.path
                                      ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground shadow-sm"
                                      : "text-muted-foreground hover:text-foreground"
                                  }`}
                                >
                                  <item.icon className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">{item.label}</span>
                                </SidebarMenuButton>
                              </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>
            </ScrollArea>
          </SidebarContent>

          <SidebarFooter className="border-t p-3">
            <div className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors cursor-pointer group-data-[collapsible=icon]:justify-center">
              <Avatar className="h-9 w-9 border shrink-0">
                <AvatarFallback className="text-xs font-medium">
                  {user?.name?.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                <p className="text-sm font-medium truncate leading-none">
                  {user?.name || "User"}
                </p>
                <p className="text-xs text-muted-foreground truncate mt-1.5">
                  {user?.email || "Email"}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start hover:bg-accent/50 transition-colors group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2"
              onClick={logout}
            >
              <LogOut className="h-4 w-4 group-data-[collapsible=icon]:mr-0 mr-2" />
              <span className="group-data-[collapsible=icon]:hidden">Sign out</span>
            </Button>
          </SidebarFooter>
        </Sidebar>

        {/* Drag-to-resize handle */}
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${
            isCollapsed ? "hidden" : ""
          }`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <KeyboardShortcutsModal />
      <OnboardingTour />

      <SidebarInset>
        {/* Top bar */}
        <div className="h-14 border-b flex items-center justify-between px-4 gap-3 bg-background">
          <MobileMenuButton />
          <div className="flex items-center gap-3 ml-auto">
            <CommandPaletteButton />
            <DarkModeToggle />
            {/* Notification bell */}
            <Popover open={notifOpen} onOpenChange={setNotifOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="relative h-9 w-9">
                  {unreadCount > 0 ? (
                    <BellRing className="h-5 w-5 text-amber-500" />
                  ) : (
                    <Bell className="h-5 w-5" />
                  )}
                  {unreadCount > 0 && (
                    <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px] bg-red-500 text-white border-0">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-96 p-0" align="end">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4" />
                    <span className="font-semibold text-sm">Notifications</span>
                    {unreadCount > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {unreadCount} new
                      </Badge>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => markAllRead.mutate()}
                    >
                      <CheckCheck className="h-3 w-3 mr-1" />
                      Mark all read
                    </Button>
                  )}
                </div>
                <ScrollArea className="h-80">
                  {!notifData?.length ? (
                    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                      <Bell className="h-8 w-8 mb-2 opacity-30" />
                      <p className="text-sm">No notifications</p>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {notifData.map(
                        (n: {
                          id: string;
                          isRead: boolean | null;
                          title: string;
                          message: string;
                          notificationType: string;
                          createdAt: Date | null;
                        }) => (
                          <div
                            key={n.id}
                            className={`px-4 py-3 hover:bg-accent/50 transition-colors ${
                              !n.isRead ? "bg-blue-50/50 dark:bg-blue-950/20" : ""
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              {!n.isRead && (
                                <div className="mt-1.5 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                              )}
                              <div className={!n.isRead ? "" : "ml-4"}>
                                <p className="text-sm font-medium leading-tight">
                                  {n.title}
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                                  {n.message}
                                </p>
                                <p className="text-[10px] text-muted-foreground/70 mt-1">
                                  {n.createdAt
                                    ? new Date(n.createdAt).toLocaleDateString("en-US", {
                                        month: "short",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })
                                    : ""}
                                </p>
                              </div>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </ScrollArea>
                <Separator />
                <div className="p-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs text-muted-foreground"
                    onClick={() => {
                      setNotifOpen(false);
                      setLocation("/notifications");
                    }}
                  >
                    View all notifications
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
    </>
  );
}

function MobileMenuButton() {
  const { toggleSidebar, isMobile } = useSidebar();
  if (!isMobile) return null;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 md:hidden"
      onClick={toggleSidebar}
      aria-label="Open navigation menu"
    >
      <PanelLeft className="h-5 w-5" />
    </Button>
  );
}

function SidebarToggleButton() {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0"
      onClick={toggleSidebar}
    >
      <PanelLeft className="h-4 w-4" />
    </Button>
  );
}

function DarkModeToggle() {
  const { theme, toggleTheme, switchable } = useTheme();
  if (!switchable || !toggleTheme) return null;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9"
      onClick={toggleTheme}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </Button>
  );
}

function CommandPaletteButton() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Flatten all nav items for the command palette
  const ALL_COMMANDS = NAV_GROUPS.flatMap((g) =>
    g.items.map((item) => ({ ...item }))
  );

  const filtered = query
    ? ALL_COMMANDS.filter((c) =>
        c.label.toLowerCase().includes(query.toLowerCase())
      )
    : ALL_COMMANDS;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-2 text-muted-foreground text-xs hidden md:flex"
        onClick={() => setOpen(true)}
      >
        <Command className="h-3 w-3" />
        <span>Search</span>
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100">
          ⌘K
        </kbd>
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-24"
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-lg bg-background border rounded-xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b">
              <Command className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                autoFocus
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                placeholder="Search pages and actions…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd className="text-xs text-muted-foreground">ESC</kbd>
            </div>
            <div className="py-2 max-h-80 overflow-y-auto">
              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No results
                </p>
              )}
              {filtered.map((cmd) => {
                const Icon = cmd.icon;
                return (
                  <button
                    key={cmd.path}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/60 transition-colors text-left"
                    onClick={() => {
                      setLocation(cmd.path);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    {cmd.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
