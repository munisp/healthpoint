import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch, getUser } from '../auth/keycloak.js';
import {
  Scale, DollarSign, FileText, AlertTriangle, CheckCircle,
  Clock, TrendingUp, TrendingDown, ArrowRight, RefreshCw
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.healthpoint.gov';

function StatCard({ title, value, change, icon: Icon, color, onClick }) {
  const isPositive = change >= 0;
  return (
    <button
      onClick={onClick}
      className="bg-white rounded-xl p-5 border border-slate-200 hover:shadow-md transition-shadow text-left w-full"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-slate-500">{title}</span>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={18} className="text-white" />
        </div>
      </div>
      <div className="text-2xl font-bold text-slate-800 mb-1">{value}</div>
      {change !== undefined && (
        <div className={`flex items-center gap-1 text-xs ${isPositive ? 'text-green-600' : 'text-red-500'}`}>
          {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {Math.abs(change)}% vs last month
        </div>
      )}
    </button>
  );
}

function RecentDisputeRow({ dispute, onClick }) {
  const statusColors = {
    open: 'bg-yellow-100 text-yellow-700',
    in_progress: 'bg-blue-100 text-blue-700',
    resolved: 'bg-green-100 text-green-700',
    closed: 'bg-slate-100 text-slate-600',
  };
  return (
    <tr
      onClick={onClick}
      className="hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0"
    >
      <td className="px-4 py-3 text-sm font-medium text-slate-800">{dispute.id?.slice(0, 8)}...</td>
      <td className="px-4 py-3 text-sm text-slate-600">{dispute.provider_name || '—'}</td>
      <td className="px-4 py-3 text-sm text-slate-600">${(dispute.disputed_amount || 0).toLocaleString()}</td>
      <td className="px-4 py-3">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[dispute.status] || statusColors.open}`}>
          {dispute.status?.replace('_', ' ')}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-slate-500">
        {dispute.created_at ? new Date(dispute.created_at).toLocaleDateString() : '—'}
      </td>
    </tr>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const user = getUser();
  const [stats, setStats] = useState(null);
  const [recentDisputes, setRecentDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, disputesRes] = await Promise.all([
        authFetch(`${API_BASE}/api/v1/dashboard/stats`),
        authFetch(`${API_BASE}/api/v1/disputes?limit=10&sort=created_at:desc`),
      ]);

      if (statsRes?.ok) {
        const data = await statsRes.json();
        setStats(data);
      }
      if (disputesRes?.ok) {
        const data = await disputesRes.json();
        setRecentDisputes(data.disputes || data.items || []);
      }
    } catch (err) {
      setError('Failed to load dashboard data. Please try again.');
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  };

  useEffect(() => {
    fetchData();
    // Auto-refresh every 5 minutes
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !stats) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 bg-slate-200 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome banner */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">
            Welcome back, {user?.name?.split(' ')[0] || 'User'}
          </h2>
          <p className="text-sm text-slate-500">
            Last updated: {lastRefresh.toLocaleTimeString()}
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Open Disputes"
          value={stats?.open_disputes ?? '—'}
          change={stats?.open_disputes_change}
          icon={Scale}
          color="bg-blue-500"
          onClick={() => navigate('/disputes?status=open')}
        />
        <StatCard
          title="Pending Payments"
          value={stats?.pending_payments ? `$${(stats.pending_payments / 1000).toFixed(0)}K` : '—'}
          change={stats?.pending_payments_change}
          icon={DollarSign}
          color="bg-green-500"
          onClick={() => navigate('/payments?status=pending')}
        />
        <StatCard
          title="GFEs Issued (30d)"
          value={stats?.gfe_issued_30d ?? '—'}
          change={stats?.gfe_change}
          icon={FileText}
          color="bg-purple-500"
          onClick={() => navigate('/gfe')}
        />
        <StatCard
          title="Overdue Items"
          value={stats?.overdue_items ?? '—'}
          icon={AlertTriangle}
          color="bg-red-500"
          onClick={() => navigate('/disputes?filter=overdue')}
        />
      </div>

      {/* Deadline alerts */}
      {stats?.deadline_alerts?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={16} className="text-amber-600" />
            <span className="font-semibold text-amber-800 text-sm">Upcoming Deadlines</span>
          </div>
          <div className="space-y-2">
            {stats.deadline_alerts.slice(0, 3).map((alert, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-amber-700">{alert.description}</span>
                <span className="font-medium text-amber-800">{alert.due_in}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent disputes table */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Recent Disputes</h3>
          <button
            onClick={() => navigate('/disputes')}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
          >
            View all <ArrowRight size={14} />
          </button>
        </div>

        {recentDisputes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <CheckCircle size={40} className="mb-3 text-green-400" />
            <p className="font-medium">No active disputes</p>
            <p className="text-sm">All disputes have been resolved</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">ID</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Provider</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Amount</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentDisputes.map((d) => (
                  <RecentDisputeRow
                    key={d.id}
                    dispute={d}
                    onClick={() => navigate(`/disputes/${d.id}`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
