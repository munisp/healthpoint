import React, { useState, useEffect, Suspense } from 'react';
import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth, logout } from './auth/keycloak.js';
import {
  LayoutDashboard, FileText, DollarSign, Users, Shield, AlertTriangle,
  BarChart3, Settings, Bell, ChevronDown, ChevronRight, Menu, X,
  Building2, CreditCard, Stethoscope, Scale, Upload, Activity,
  LogOut, User, HelpCircle, Search
} from 'lucide-react';

// ─── Lazy-loaded page modules ────────────────────────────────────────────────
// Each page embeds the corresponding sub-app or its key views inline.
// This avoids iframe cross-origin issues while keeping the bundle split.
const Dashboard = React.lazy(() => import('./pages/Dashboard.jsx'));
const DisputeResolution = React.lazy(() => import('./pages/DisputeResolution.jsx'));
const PaymentProcessing = React.lazy(() => import('./pages/PaymentProcessing.jsx'));
const GoodFaithEstimates = React.lazy(() => import('./pages/GoodFaithEstimates.jsx'));
const ClaimsProcessing = React.lazy(() => import('./pages/ClaimsProcessing.jsx'));
const ProviderManagement = React.lazy(() => import('./pages/ProviderManagement.jsx'));
const AdminFeeManagement = React.lazy(() => import('./pages/AdminFeeManagement.jsx'));
const Compliance = React.lazy(() => import('./pages/Compliance.jsx'));
const Analytics = React.lazy(() => import('./pages/Analytics.jsx'));
const MemberPortal = React.lazy(() => import('./pages/MemberPortal.jsx'));
const EmergencyServices = React.lazy(() => import('./pages/EmergencyServices.jsx'));
const UserManagement = React.lazy(() => import('./pages/UserManagement.jsx'));
const AuditLog = React.lazy(() => import('./pages/AuditLog.jsx'));
const SystemSettings = React.lazy(() => import('./pages/SystemSettings.jsx'));

// ─── Navigation structure ─────────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    label: 'Core Workflows',
    items: [
      { path: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
      { path: '/disputes', label: 'IDR Dispute Resolution', icon: Scale, roles: ['provider', 'insurer', 'idr_entity', 'admin'] },
      { path: '/gfe', label: 'Good Faith Estimates', icon: FileText, roles: ['provider', 'admin'] },
      { path: '/claims', label: 'Claims Processing', icon: Stethoscope, roles: ['provider', 'insurer', 'admin'] },
    ],
  },
  {
    label: 'Financial',
    items: [
      { path: '/payments', label: 'Payment Processing', icon: DollarSign, roles: ['provider', 'insurer', 'admin'] },
      { path: '/admin-fees', label: 'Admin Fee Management', icon: CreditCard, roles: ['admin', 'idr_entity'] },
    ],
  },
  {
    label: 'Stakeholders',
    items: [
      { path: '/providers', label: 'Provider Management', icon: Building2, roles: ['admin', 'insurer'] },
      { path: '/members', label: 'Member Portal', icon: Users, roles: ['member', 'admin'] },
      { path: '/emergency', label: 'Emergency Services', icon: AlertTriangle, roles: ['provider', 'admin'] },
    ],
  },
  {
    label: 'Compliance & Analytics',
    items: [
      { path: '/compliance', label: 'NSA Compliance', icon: Shield, roles: ['admin', 'compliance_officer'] },
      { path: '/analytics', label: 'Analytics & Reporting', icon: BarChart3, roles: ['admin', 'compliance_officer'] },
      { path: '/audit', label: 'Audit Log', icon: Activity, roles: ['admin'] },
    ],
  },
  {
    label: 'Administration',
    items: [
      { path: '/users', label: 'User Management', icon: User, roles: ['admin'] },
      { path: '/settings', label: 'System Settings', icon: Settings, roles: ['admin'] },
    ],
  },
];

// ─── Sidebar Component ────────────────────────────────────────────────────────
function Sidebar({ isOpen, onClose, user }) {
  const location = useLocation();
  const [expandedGroups, setExpandedGroups] = useState(
    NAV_GROUPS.map((g) => g.label)
  );

  const toggleGroup = (label) => {
    setExpandedGroups((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  };

  const hasAccess = (item) => {
    if (!item.roles) return true;
    const userRoles = user?.roles || [];
    return item.roles.some((r) => userRoles.includes(r)) || userRoles.includes('admin');
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full w-64 bg-slate-900 text-white z-30 transform transition-transform duration-200
          ${isOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static lg:z-auto`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center font-bold text-sm">HP</div>
            <div>
              <div className="font-bold text-sm leading-tight">HealthPoint</div>
              <div className="text-xs text-slate-400 leading-tight">NSA/IDR Platform</div>
            </div>
          </div>
          <button onClick={onClose} className="lg:hidden text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-2">
          {NAV_GROUPS.map((group) => {
            const visibleItems = group.items.filter(hasAccess);
            if (visibleItems.length === 0) return null;

            return (
              <div key={group.label} className="mb-2">
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider hover:text-slate-200"
                >
                  {group.label}
                  {expandedGroups.includes(group.label)
                    ? <ChevronDown size={12} />
                    : <ChevronRight size={12} />}
                </button>

                {expandedGroups.includes(group.label) && (
                  <div className="mt-1 space-y-0.5">
                    {visibleItems.map((item) => (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        end={item.exact}
                        onClick={() => window.innerWidth < 1024 && onClose()}
                        className={({ isActive }) =>
                          `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors
                          ${isActive
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`
                        }
                      >
                        <item.icon size={16} className="shrink-0" />
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* User info at bottom */}
        <div className="border-t border-slate-700 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-sm font-bold">
              {user?.name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{user?.name || 'User'}</div>
              <div className="text-xs text-slate-400 truncate">{user?.email || ''}</div>
            </div>
            <button
              onClick={logout}
              className="text-slate-400 hover:text-white"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ─── Header Component ─────────────────────────────────────────────────────────
function Header({ onMenuToggle, user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  // Get current page title from nav
  const currentItem = NAV_GROUPS.flatMap((g) => g.items).find(
    (item) => item.path === location.pathname
  );

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-4 sticky top-0 z-10">
      <button
        onClick={onMenuToggle}
        className="lg:hidden text-slate-500 hover:text-slate-700"
      >
        <Menu size={20} />
      </button>

      <div className="flex-1">
        <h1 className="text-lg font-semibold text-slate-800">
          {currentItem?.label || 'HealthPoint'}
        </h1>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="hidden md:flex items-center">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Search disputes, claims, providers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-4 py-1.5 text-sm border border-slate-200 rounded-lg w-72 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </form>

      {/* Notifications */}
      <button className="relative text-slate-500 hover:text-slate-700">
        <Bell size={20} />
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">3</span>
      </button>

      {/* Help */}
      <button className="text-slate-500 hover:text-slate-700">
        <HelpCircle size={20} />
      </button>
    </header>
  );
}

// ─── Loading Fallback ─────────────────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>
  );
}

// ─── Not Found ────────────────────────────────────────────────────────────────
function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="text-6xl font-bold text-slate-200">404</div>
      <div className="text-slate-500">Page not found</div>
      <button
        onClick={() => navigate('/')}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
      >
        Go to Dashboard
      </button>
    </div>
  );
}

// ─── Unauthenticated Screen ───────────────────────────────────────────────────
function UnauthenticatedScreen() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white font-bold text-2xl">HP</div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">HealthPoint</h1>
        <p className="text-slate-500 mb-6">NSA/IDR Dispute Resolution Platform</p>
        <div className="flex items-center justify-center gap-2 text-slate-400">
          <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
          <span className="text-sm">Authenticating with Keycloak...</span>
        </div>
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { user, loading, authenticated } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!authenticated) {
    return <UnauthenticatedScreen />;
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        user={user}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header
          onMenuToggle={() => setSidebarOpen((v) => !v)}
          user={user}
        />

        <main className="flex-1 overflow-y-auto p-6">
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/disputes/*" element={<DisputeResolution />} />
              <Route path="/payments/*" element={<PaymentProcessing />} />
              <Route path="/gfe/*" element={<GoodFaithEstimates />} />
              <Route path="/claims/*" element={<ClaimsProcessing />} />
              <Route path="/providers/*" element={<ProviderManagement />} />
              <Route path="/admin-fees/*" element={<AdminFeeManagement />} />
              <Route path="/compliance/*" element={<Compliance />} />
              <Route path="/analytics/*" element={<Analytics />} />
              <Route path="/members/*" element={<MemberPortal />} />
              <Route path="/emergency/*" element={<EmergencyServices />} />
              <Route path="/users/*" element={<UserManagement />} />
              <Route path="/audit/*" element={<AuditLog />} />
              <Route path="/settings/*" element={<SystemSettings />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
