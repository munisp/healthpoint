import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  LayoutDashboard,
  LogOut,
  PanelLeft,
  Users,
  Scale,
  Bell,
  BellRing,
  CheckCheck,
  ShieldCheck,
  Building2,
  Brain,
  PlusCircle,
  Upload,
  ClipboardList,
  Database,
  BookOpen,
  UserCheck,
  BarChart2,
  BookTemplate,
  UserRoundSearch,
  ScanLine,
  Moon,
  Sun,
  Command,
  Activity,
  Webhook,
  Search,
  ArrowDownToLine,
  HeartPulse,
  Settings,
  BookMarked,
  HelpCircle,
  MessageSquare,
  Gauge,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { useLocation } from "wouter";
import KeyboardShortcutsModal from "./KeyboardShortcutsModal";
import OnboardingTour from "./OnboardingTour";
import SessionTimeoutWarning from "./SessionTimeoutWarning";

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: Scale, label: "Disputes", path: "/disputes" },
  { icon: PlusCircle, label: "New Dispute", path: "/disputes/new" },
  { icon: Building2, label: "IDR Entities", path: "/idr-entities" },
  { icon: Bell, label: "Notifications", path: "/notifications" },
  { icon: Brain, label: "AI Assistant", path: "/ai-assistant" },
  { icon: Upload, label: "Stakeholder Upload", path: "/stakeholder-upload" },
  { icon: ClipboardList, label: "CMS Tracker", path: "/cms-tracker" },
  { icon: Database, label: "EMR Connections", path: "/emr-connections" },
  { icon: BookOpen, label: "State Laws", path: "/state-laws" },
  { icon: UserCheck, label: "Expert Review", path: "/expert-review" },
  { icon: BarChart2, label: "Reports", path: "/reports" },
  { icon: BookTemplate, label: "Templates", path: "/templates" },
  { icon: ShieldCheck, label: "Admin", path: "/admin" },
  { icon: UserRoundSearch, label: "Leads CRM", path: "/admin/leads" },
  { icon: ScanLine, label: "Doc Analyzer", path: "/doc-analyzer" },
  { icon: Activity, label: "Audit Trail", path: "/audit-trail" },
  { icon: Building2, label: "Payer Intel", path: "/payer-intelligence" },
  { icon: Webhook, label: "Webhooks", path: "/webhooks" },
  { icon: BookOpen, label: "Fin. Ledger", path: "/ledger" },
  { icon: Search, label: "Global Search", path: "/search" },
  { icon: ArrowDownToLine, label: "Lakehouse", path: "/lakehouse" },
  { icon: Users, label: "User Mgmt", path: "/admin/users" },
  { icon: HeartPulse, label: "System Health", path: "/system-health" },
  { icon: Settings, label: "Settings", path: "/settings" },
  { icon: BookMarked, label: "Changelog", path: "/changelog" },
  { icon: HelpCircle, label: "Help Center", path: "/help" },
];

const SIDEBAR_WIDTH_KEY = 'sidebar-width';
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
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
      <DashboardLayoutContent
        setSidebarWidth={setSidebarWidth}
      >
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

  // Real-time notification bell — polls every 30 seconds
  const { data: notifData, refetch: refetchNotifs } = trpc.notifications.list.useQuery(
    { unreadOnly: false },
    { refetchInterval: 30_000, staleTime: 25_000 }
  );
  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => refetchNotifs(),
  });
  const unreadCount = notifData?.filter((n: { isRead: boolean | null }) => !n.isRead).length ?? 0;

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft =
        sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, setSidebarWidth]);

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
          <SidebarMenu className="gap-1 px-2 py-4">
            {menuItems.map(item => (
              <SidebarMenuItem key={item.path}>
                <SidebarMenuButton
                  isActive={location === item.path}
                  onClick={() => setLocation(item.path)}
                  tooltip={item.label}
                  className={`
                    h-10 transition-all
                    ${location === item.path
                      ? 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground shadow-sm'
                      : ''
                    }
                  `}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>

        <SidebarFooter className="border-t p-3">
          <div className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors cursor-pointer group-data-[collapsible=icon]:justify-center">
            <Avatar className="h-9 w-9 border shrink-0">
              <AvatarFallback className="text-xs font-medium">
                {user?.name?.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="text-sm font-medium truncate leading-none">{user?.name || 'User'}</p>
              <p className="text-xs text-muted-foreground truncate mt-1.5">
                {user?.email || 'Email'}
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
      <div
        className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
        onMouseDown={() => {
          if (isCollapsed) return;
          setIsResizing(true);
        }}
        style={{ zIndex: 50 }}
      />
      </div>

      <KeyboardShortcutsModal />
      <OnboardingTour />
      <SessionTimeoutWarning />
      <SidebarInset>
        {/* Top bar with notification bell + dark mode + command palette */}
        <div className="h-14 border-b flex items-center justify-end px-6 gap-3 bg-background">
          <CommandPaletteButton />
          <DarkModeToggle />
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
                    {unreadCount > 9 ? '9+' : unreadCount}
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
                    <Badge variant="secondary" className="text-xs">{unreadCount} new</Badge>
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
                    {notifData.map((n: { id: string; isRead: boolean | null; title: string; message: string; notificationType: string; createdAt: Date | null }) => (
                      <div
                        key={n.id}
                        className={`px-4 py-3 hover:bg-accent/50 transition-colors ${
                          !n.isRead ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          {!n.isRead && (
                            <div className="mt-1.5 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                          )}
                          <div className={!n.isRead ? '' : 'ml-4'}>
                            <p className="text-sm font-medium leading-tight">{n.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.message}</p>
                            <p className="text-[10px] text-muted-foreground/70 mt-1">
                              {n.createdAt ? new Date(n.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
              <Separator />
              <div className="p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-muted-foreground"
                  onClick={() => { setNotifOpen(false); setLocation('/notifications'); }}
                >
                  View all notifications
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
    </>
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
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

function CommandPaletteButton() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const COMMANDS = [
    { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { label: 'New Dispute', path: '/disputes/new', icon: PlusCircle },
    { label: 'Disputes List', path: '/disputes', icon: Scale },
    { label: 'AI Assistant', path: '/ai-assistant', icon: Brain },
    { label: 'Document Analyzer', path: '/doc-analyzer', icon: ScanLine },
    { label: 'Reports', path: '/reports', icon: BarChart2 },
    { label: 'Expert Review', path: '/expert-review', icon: UserCheck },
    { label: 'CMS Tracker', path: '/cms-tracker', icon: ClipboardList },
    { label: 'EMR Connections', path: '/emr-connections', icon: Database },
    { label: 'State Laws', path: '/state-laws', icon: BookOpen },
    { label: 'Templates', path: '/templates', icon: BookTemplate },
    { label: 'Admin', path: '/admin', icon: ShieldCheck },
    { label: 'Leads CRM', path: '/admin/leads', icon: UserRoundSearch },
    { label: 'Financial Ledger', path: '/ledger', icon: BookOpen },
    { label: 'Global Search', path: '/search', icon: Search },
    { label: 'Lakehouse Export', path: '/lakehouse', icon: ArrowDownToLine },
    { label: 'Audit Trail', path: '/audit-trail', icon: Activity },
    { label: 'Payer Intelligence', path: '/payer-intelligence', icon: Building2 },
    { label: 'Webhooks', path: '/webhooks', icon: Webhook },
  ];

  const filtered = query
    ? COMMANDS.filter(c => c.label.toLowerCase().includes(query.toLowerCase()))
    : COMMANDS;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
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
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-24" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-lg bg-background border rounded-xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b">
              <Command className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                autoFocus
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                placeholder="Search pages and actions…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
              <kbd className="text-xs text-muted-foreground">ESC</kbd>
            </div>
            <div className="py-2 max-h-80 overflow-y-auto">
              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No results</p>
              )}
              {filtered.map(cmd => {
                const Icon = cmd.icon;
                return (
                  <button
                    key={cmd.path}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/60 transition-colors text-left"
                    onClick={() => { setLocation(cmd.path); setOpen(false); setQuery(''); }}
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
