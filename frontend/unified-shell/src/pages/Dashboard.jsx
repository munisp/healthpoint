import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch, getUser } from '../auth/keycloak.js';
import {
  Scale, DollarSign, FileText, AlertTriangle, CheckCircle,
  Clock, TrendingUp, TrendingDown, ArrowRight, RefreshCw,
  ShieldAlert, ShieldCheck, ThumbsDown, X, ChevronRight,
  Brain, Zap, Eye, BarChart3
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.healthpoint.gov';

function ConfidenceBadge({ score }) {
  const pct = Math.round((score ?? 0) * 100);
  const color =
    pct >= 90 ? 'bg-red-100 text-red-700 border-red-200' :
    pct >= 75 ? 'bg-orange-100 text-orange-700 border-orange-200' :
    pct >= 60 ? 'bg-amber-100 text-amber-700 border-amber-200' :
    'bg-slate-100 text-slate-600 border-slate-200';
  const label = pct >= 90 ? 'Critical' : pct >= 75 ? 'High' : pct >= 60 ? 'Medium' : 'Low';
  return (
    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${color}`}>
      <Brain size={10} />{pct}% · {label}
    </div>
  );
}

function FraudAlertRow({ alert, onFlagFalsePositive, onView, flagging }) {
  const [expanded, setExpanded] = useState(false);
  const typeColors = {
    upcoding: 'bg-red-500', unbundling: 'bg-orange-500',
    phantom_billing: 'bg-purple-500', duplicate_claim: 'bg-amber-500',
    kickback_pattern: 'bg-rose-500', identity_theft: 'bg-pink-500', default: 'bg-slate-400',
  };
  const dotColor = typeColors[alert.fraud_type] ?? typeColors.default;
  return (
    <div className={`border rounded-lg transition-all ${alert.is_false_positive ? 'border-slate-200 bg-slate-50 opacity-60' : 'border-red-100 bg-white hover:border-red-200'}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-800 truncate">
              {alert.claim_id ? `Claim ${alert.claim_id}` : alert.entity_name ?? 'Unknown entity'}
            </span>
            <span className="text-xs text-slate-500 capitalize">{alert.fraud_type?.replace(/_/g, ' ')}</span>
            {alert.is_false_positive && (
              <span className="px-1.5 py-0.5 bg-slate-200 text-slate-500 text-xs rounded-full font-medium">Marked false positive</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="text-xs text-slate-500">{alert.provider_name ?? '—'} · {alert.amount ? `$${Number(alert.amount).toLocaleString()}` : '—'}</span>
            {alert.detected_at && <span className="text-xs text-slate-400">{new Date(alert.detected_at).toLocaleString()}</span>}
          </div>
        </div>
        <ConfidenceBadge score={alert.confidence_score} />
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setExpanded(e => !e)} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="View details">
            <Eye size={14} />
          </button>
          {!alert.is_false_positive && (
            <button onClick={() => onFlagFalsePositive(alert.id)} disabled={flagging === alert.id}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-slate-500 hover:text-amber-700 hover:bg-amber-50 border border-transparent hover:border-amber-200 transition-colors disabled:opacity-50"
              title="Flag as false positive">
              {flagging === alert.id ? <RefreshCw size={11} className="animate-spin" /> : <ThumbsDown size={11} />}
              <span className="hidden sm:inline">False Positive</span>
            </button>
          )}
          <button onClick={() => onView(alert)} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="Investigate">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-3 pt-0 border-t border-slate-100">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            {[
              { label: 'Model', value: alert.model_version ?? 'fraud-gnn-v2' },
              { label: 'Pattern', value: alert.pattern_description ?? alert.fraud_type?.replace(/_/g, ' ') },
              { label: 'Risk Score', value: alert.risk_score ? `${Math.round(alert.risk_score * 100)}/100` : '—' },
              { label: 'Related Claims', value: alert.related_claim_count ?? '—' },
            ].map(item => (
              <div key={item.label} className="bg-slate-50 rounded-lg px-3 py-2">
                <div className="text-xs text-slate-400 mb-0.5">{item.label}</div>
                <div className="text-xs font-semibold text-slate-700 capitalize">{item.value}</div>
              </div>
            ))}
          </div>
          {alert.explanation && (
            <div className="mt-2 text-xs text-slate-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              <span className="font-semibold text-amber-700">AI Explanation: </span>{alert.explanation}
            </div>
          )}
          {alert.supporting_features && (
            <div className="mt-2">
              <div className="text-xs text-slate-400 mb-1">Contributing features</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(alert.supporting_features).map(([k, v]) => (
                  <span key={k} className="px-2 py-0.5 bg-red-50 border border-red-100 text-red-700 text-xs rounded-full">
                    {k.replace(/_/g, ' ')}: {typeof v === 'number' ? v.toFixed(3) : String(v)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, change, icon: Icon, color, onClick }) {
  const isPositive = change >= 0;
  return (
    <button onClick={onClick} className="bg-white rounded-xl p-5 border border-slate-200 hover:shadow-md transition-shadow text-left w-full">
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
  const statusColors = { open: 'bg-yellow-100 text-yellow-700', in_progress: 'bg-blue-100 text-blue-700', resolved: 'bg-green-100 text-green-700', closed: 'bg-slate-100 text-slate-600' };
  return (
    <tr onClick={onClick} className="hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0">
      <td className="px-4 py-3 text-sm font-medium text-slate-800">{dispute.id?.slice(0, 8)}...</td>
      <td className="px-4 py-3 text-sm text-slate-600">{dispute.provider_name || '—'}</td>
      <td className="px-4 py-3 text-sm text-slate-600">${(dispute.disputed_amount || 0).toLocaleString()}</td>
      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[dispute.status] || statusColors.open}`}>{dispute.status?.replace('_', ' ')}</span></td>
      <td className="px-4 py-3 text-sm text-slate-500">{dispute.created_at ? new Date(dispute.created_at).toLocaleDateString() : '—'}</td>
    </tr>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const user = getUser();
  const [stats, setStats] = useState(null);
  const [recentDisputes, setRecentDisputes] = useState([]);
  const [fraudAlerts, setFraudAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fraudLoading, setFraudLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [flagging, setFlagging] = useState(null);
  const [fraudFilter, setFraudFilter] = useState('active');
  const [selectedAlert, setSelectedAlert] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [statsRes, disputesRes] = await Promise.all([
        authFetch(`${API_BASE}/api/v1/dashboard/stats`),
        authFetch(`${API_BASE}/api/v1/disputes?limit=10&sort=created_at:desc`),
      ]);
      if (statsRes?.ok) setStats(await statsRes.json());
      if (disputesRes?.ok) { const d = await disputesRes.json(); setRecentDisputes(d.disputes || d.items || []); }
    } catch { setError('Failed to load dashboard data. Please try again.'); }
    finally { setLoading(false); setLastRefresh(new Date()); }
  }, []);

  const fetchFraudAlerts = useCallback(async () => {
    setFraudLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/api/v1/fraud/alerts?limit=20&include_false_positives=${fraudFilter === 'all'}&sort=confidence_score:desc`);
      if (res?.ok) { const d = await res.json(); setFraudAlerts(d.alerts || d.items || []); }
    } catch {} finally { setFraudLoading(false); }
  }, [fraudFilter]);

  useEffect(() => { fetchData(); const t = setInterval(fetchData, 5*60*1000); return () => clearInterval(t); }, [fetchData]);
  useEffect(() => { fetchFraudAlerts(); const t = setInterval(fetchFraudAlerts, 2*60*1000); return () => clearInterval(t); }, [fetchFraudAlerts]);

  const handleFlagFalsePositive = async (alertId) => {
    setFlagging(alertId);
    try {
      const res = await authFetch(`${API_BASE}/api/v1/fraud/alerts/${alertId}/false-positive`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagged_by: user?.id, reason: 'Manually flagged from dashboard' }),
      });
      if (res?.ok) setFraudAlerts(prev => prev.map(a => a.id === alertId ? { ...a, is_false_positive: true } : a));
    } catch {} finally { setFlagging(null); }
  };

  const activeAlerts = fraudAlerts.filter(a => !a.is_false_positive);
  const criticalAlerts = activeAlerts.filter(a => (a.confidence_score ?? 0) >= 0.90);
  const highAlerts = activeAlerts.filter(a => (a.confidence_score ?? 0) >= 0.75 && (a.confidence_score ?? 0) < 0.90);
  const displayAlerts = fraudFilter === 'active' ? activeAlerts : fraudAlerts;

  if (loading && !stats) return (
    <div className="space-y-4">{[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-slate-200 rounded-xl animate-pulse" />)}</div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Welcome back, {user?.name?.split(' ')[0] || 'User'}</h2>
          <p className="text-sm text-slate-500">Last updated: {lastRefresh.toLocaleTimeString()}</p>
        </div>
        <button onClick={() => { fetchData(); fetchFraudAlerts(); }} disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh
        </button>
      </div>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Open Disputes" value={stats?.open_disputes ?? '—'} change={stats?.open_disputes_change} icon={Scale} color="bg-blue-500" onClick={() => navigate('/disputes?status=open')} />
        <StatCard title="Pending Payments" value={stats?.pending_payments ? `$${(stats.pending_payments/1000).toFixed(0)}K` : '—'} change={stats?.pending_payments_change} icon={DollarSign} color="bg-green-500" onClick={() => navigate('/payments?status=pending')} />
        <StatCard title="GFEs Issued (30d)" value={stats?.gfe_issued_30d ?? '—'} change={stats?.gfe_change} icon={FileText} color="bg-purple-500" onClick={() => navigate('/gfe')} />
        <StatCard title="Overdue Items" value={stats?.overdue_items ?? '—'} icon={AlertTriangle} color="bg-red-500" onClick={() => navigate('/disputes?filter=overdue')} />
      </div>
      {stats?.deadline_alerts?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3"><Clock size={16} className="text-amber-600" /><span className="font-semibold text-amber-800 text-sm">Upcoming Deadlines</span></div>
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

      {/* AI Fraud Alert Feed */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
                <ShieldAlert size={16} className="text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800 text-sm">AI Fraud Alert Feed</h3>
                <p className="text-xs text-slate-400">Powered by fraud-gnn-v2 · Real-time scoring</p>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-2">
              {criticalAlerts.length > 0 && (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 text-xs font-semibold rounded-full border border-red-200">
                  <Zap size={10} />{criticalAlerts.length} Critical
                </span>
              )}
              {highAlerts.length > 0 && (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-semibold rounded-full border border-orange-200">
                  {highAlerts.length} High
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5 text-xs">
              {['active', 'all'].map(f => (
                <button key={f} onClick={() => setFraudFilter(f)}
                  className={`px-2.5 py-1 rounded-md font-medium capitalize transition-colors ${fraudFilter === f ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  {f}
                </button>
              ))}
            </div>
            <button onClick={() => navigate('/fraud')} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
              <BarChart3 size={12} />Full report
            </button>
          </div>
        </div>
        <div className="p-4 space-y-2 max-h-[420px] overflow-y-auto">
          {fraudLoading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />)}</div>
          ) : displayAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400">
              <ShieldCheck size={32} className="mb-2 text-green-400" />
              <p className="font-medium text-slate-600 text-sm">No active fraud alerts</p>
              <p className="text-xs mt-0.5">The AI model has not flagged any suspicious activity</p>
            </div>
          ) : (
            displayAlerts.map(alert => (
              <FraudAlertRow key={alert.id} alert={alert} onFlagFalsePositive={handleFlagFalsePositive} onView={setSelectedAlert} flagging={flagging} />
            ))
          )}
        </div>
        {!fraudLoading && displayAlerts.length > 0 && (
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>{activeAlerts.length} active · {fraudAlerts.filter(a => a.is_false_positive).length} false positives removed</span>
            <span>Avg confidence: {activeAlerts.length > 0 ? `${Math.round(activeAlerts.reduce((s, a) => s + (a.confidence_score ?? 0), 0) / activeAlerts.length * 100)}%` : '—'}</span>
          </div>
        )}
      </div>

      {/* Recent disputes */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Recent Disputes</h3>
          <button onClick={() => navigate('/disputes')} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">View all <ArrowRight size={14} /></button>
        </div>
        {recentDisputes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <CheckCircle size={40} className="mb-3 text-green-400" />
            <p className="font-medium">No active disputes</p><p className="text-sm">All disputes have been resolved</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-slate-100">
                {['ID','Provider','Amount','Status','Date'].map(h => <th key={h} className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">{h}</th>)}
              </tr></thead>
              <tbody>{recentDisputes.map(d => <RecentDisputeRow key={d.id} dispute={d} onClick={() => navigate(`/disputes/${d.id}`)} />)}</tbody>
            </table>
          </div>
        )}
      </div>

      {/* Alert detail modal */}
      {selectedAlert && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedAlert(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2"><ShieldAlert size={20} className="text-red-500" /><h3 className="text-lg font-semibold text-slate-800">Fraud Alert Detail</h3></div>
              <button onClick={() => setSelectedAlert(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <ConfidenceBadge score={selectedAlert.confidence_score} />
                <span className="text-sm text-slate-500 capitalize">{selectedAlert.fraud_type?.replace(/_/g, ' ')}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: 'Claim ID', value: selectedAlert.claim_id ?? '—' },
                  { label: 'Provider', value: selectedAlert.provider_name ?? '—' },
                  { label: 'Amount', value: selectedAlert.amount ? `$${Number(selectedAlert.amount).toLocaleString()}` : '—' },
                  { label: 'Detected', value: selectedAlert.detected_at ? new Date(selectedAlert.detected_at).toLocaleString() : '—' },
                  { label: 'Model', value: selectedAlert.model_version ?? 'fraud-gnn-v2' },
                  { label: 'Risk Score', value: selectedAlert.risk_score ? `${Math.round(selectedAlert.risk_score * 100)}/100` : '—' },
                ].map(item => (
                  <div key={item.label} className="bg-slate-50 rounded-lg px-3 py-2">
                    <div className="text-xs text-slate-400 mb-0.5">{item.label}</div>
                    <div className="text-sm font-semibold text-slate-700">{item.value}</div>
                  </div>
                ))}
              </div>
              {selectedAlert.explanation && (
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-sm text-amber-800">
                  <span className="font-semibold">AI Explanation: </span>{selectedAlert.explanation}
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button onClick={() => { handleFlagFalsePositive(selectedAlert.id); setSelectedAlert(null); }}
                  disabled={selectedAlert.is_false_positive || flagging === selectedAlert.id}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-amber-200 text-amber-700 rounded-lg text-sm font-medium hover:bg-amber-50 disabled:opacity-50">
                  <ThumbsDown size={14} />Flag False Positive
                </button>
                <button onClick={() => { navigate(`/fraud/${selectedAlert.id}`); setSelectedAlert(null); }}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">
                  Investigate <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
