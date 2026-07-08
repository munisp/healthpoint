import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../auth/keycloak.js';
import {
  TrendingUp, TrendingDown, DollarSign, Scale, FileText,
  AlertTriangle, RefreshCw, Download, Calendar, ChevronDown,
  Activity, CheckCircle, XCircle, Clock
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.healthpoint.gov';
const PERIODS = [
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Last 90 days', value: '90d' },
  { label: 'Last 12 months', value: '12m' },
];

function MetricCard({ title, value, change, icon: Icon, color, subtitle }) {
  const isPositive = change > 0;
  const isNeutral = change === 0 || change == null;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2.5 rounded-lg ${color}`}><Icon size={18} className="text-white" /></div>
        {!isNeutral && (
          <span className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${isPositive ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {isPositive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {Math.abs(change)}%
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-slate-800 mb-0.5">{value ?? '—'}</div>
      <div className="text-sm font-medium text-slate-600">{title}</div>
      {subtitle && <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>}
    </div>
  );
}

function SimpleBarChart({ data }) {
  if (!data || data.length === 0) return <div className="flex items-center justify-center h-32 text-slate-400 text-sm">No data available</div>;
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="flex items-end gap-1 h-32">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div className="w-full rounded-t bg-blue-500 transition-all" style={{ height: `${(d.value / max) * 100}%`, minHeight: '2px' }} title={`${d.label}: ${d.value}`} />
          <span className="text-[9px] text-slate-400 truncate w-full text-center">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = { resolved: 'bg-green-100 text-green-700', open: 'bg-blue-100 text-blue-700', pending: 'bg-amber-100 text-amber-700', failed: 'bg-red-100 text-red-700', closed: 'bg-slate-100 text-slate-600' };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status?.toLowerCase()] || 'bg-slate-100 text-slate-600'}`}>{status ?? '—'}</span>;
}

export default function Analytics() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState('30d');
  const [showPeriodMenu, setShowPeriodMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [disputeMetrics, setDisputeMetrics] = useState(null);
  const [claimsMetrics, setClaimsMetrics] = useState(null);
  const [paymentMetrics, setPaymentMetrics] = useState(null);
  const [fraudMetrics, setFraudMetrics] = useState(null);
  const [timeseries, setTimeseries] = useState([]);
  const [recentEvents, setRecentEvents] = useState([]);

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [kpiRes, disputeRes, claimsRes, paymentRes, fraudRes, tsRes, eventsRes] = await Promise.all([
        authFetch(`${API_BASE}/api/v1/analytics/kpis?period=${period}`),
        authFetch(`${API_BASE}/api/v1/analytics/metrics/disputes?period=${period}`),
        authFetch(`${API_BASE}/api/v1/analytics/metrics/claims?period=${period}`),
        authFetch(`${API_BASE}/api/v1/analytics/metrics/payments?period=${period}`),
        authFetch(`${API_BASE}/api/v1/analytics/metrics/fraud?period=${period}`),
        authFetch(`${API_BASE}/api/v1/analytics/timeseries/disputes?period=${period}`),
        authFetch(`${API_BASE}/api/v1/analytics/events/recent?limit=10`),
      ]);
      if (kpiRes?.ok) setKpis(await kpiRes.json());
      if (disputeRes?.ok) setDisputeMetrics(await disputeRes.json());
      if (claimsRes?.ok) setClaimsMetrics(await claimsRes.json());
      if (paymentRes?.ok) setPaymentMetrics(await paymentRes.json());
      if (fraudRes?.ok) setFraudMetrics(await fraudRes.json());
      if (tsRes?.ok) { const d = await tsRes.json(); setTimeseries(d.data || d.points || []); }
      if (eventsRes?.ok) { const d = await eventsRes.json(); setRecentEvents(d.events || d.items || d.data || []); }
    } catch (err) { setError(err.message || 'Failed to load analytics'); }
    finally { setLoading(false); }
  }, [period]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleExport = async () => {
    try {
      const res = await authFetch(`${API_BASE}/api/v1/analytics/reports`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, format: 'csv', report_type: 'summary' }),
      });
      if (res?.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `healthpoint-analytics-${period}.csv`; a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) { console.error('Export failed:', err); }
  };

  const periodLabel = PERIODS.find(p => p.value === period)?.label || period;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Platform-wide analytics, dispute trends, and financial summaries</p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button onClick={() => setShowPeriodMenu(v => !v)} className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50">
              <Calendar size={14} />{periodLabel}<ChevronDown size={14} />
            </button>
            {showPeriodMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 min-w-[160px]">
                {PERIODS.map(p => (
                  <button key={p.value} onClick={() => { setPeriod(p.value); setShowPeriodMenu(false); }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 ${period === p.value ? 'text-blue-600 font-medium' : 'text-slate-700'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={handleExport} className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50"><Download size={14} />Export</button>
          <button onClick={fetchAll} disabled={loading} className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh
          </button>
        </div>
      </div>
      {error && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm"><AlertTriangle size={16} />{error}</div>}
      {loading ? (
        <div className="flex items-center justify-center py-24"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard title="Total Disputes" value={kpis?.total_disputes?.toLocaleString() ?? disputeMetrics?.total?.toLocaleString()} change={kpis?.disputes_change ?? disputeMetrics?.change_pct} icon={Scale} color="bg-blue-500" subtitle={`${kpis?.open_disputes ?? disputeMetrics?.open ?? '—'} open`} />
            <MetricCard title="Claims Processed" value={kpis?.claims_processed?.toLocaleString() ?? claimsMetrics?.total?.toLocaleString()} change={kpis?.claims_change ?? claimsMetrics?.change_pct} icon={FileText} color="bg-purple-500" subtitle={`${kpis?.claims_approved ?? claimsMetrics?.approved ?? '—'} approved`} />
            <MetricCard title="Payments Settled" value={kpis?.payments_settled ? `$${(kpis.payments_settled/1e6).toFixed(1)}M` : paymentMetrics?.total_amount ? `$${(paymentMetrics.total_amount/1e6).toFixed(1)}M` : '—'} change={kpis?.payments_change ?? paymentMetrics?.change_pct} icon={DollarSign} color="bg-green-500" subtitle={`${kpis?.payments_count ?? paymentMetrics?.count ?? '—'} transactions`} />
            <MetricCard title="Fraud Alerts" value={kpis?.fraud_alerts?.toLocaleString() ?? fraudMetrics?.total_alerts?.toLocaleString()} change={kpis?.fraud_change ?? fraudMetrics?.change_pct} icon={AlertTriangle} color="bg-red-500" subtitle={`${kpis?.fraud_confirmed ?? fraudMetrics?.confirmed ?? '—'} confirmed`} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-4"><h3 className="font-semibold text-slate-800">Dispute Volume Trend</h3><span className="text-xs text-slate-400">{periodLabel}</span></div>
              <SimpleBarChart data={timeseries.map(t => ({ label: t.period || t.date || t.label, value: t.count || t.value || 0 }))} />
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-4"><h3 className="font-semibold text-slate-800">Claims by Status</h3><span className="text-xs text-slate-400">{periodLabel}</span></div>
              {claimsMetrics ? (
                <div className="space-y-3">
                  {[{ label: 'Approved', value: claimsMetrics.approved||0, color: 'bg-green-500' }, { label: 'Pending', value: claimsMetrics.pending||0, color: 'bg-amber-400' }, { label: 'Denied', value: claimsMetrics.denied||0, color: 'bg-red-400' }, { label: 'Under Review', value: claimsMetrics.under_review||0, color: 'bg-blue-400' }].map(item => {
                    const total = (claimsMetrics.approved||0)+(claimsMetrics.pending||0)+(claimsMetrics.denied||0)+(claimsMetrics.under_review||0);
                    const pct = total > 0 ? Math.round((item.value/total)*100) : 0;
                    return (
                      <div key={item.label}>
                        <div className="flex justify-between text-sm mb-1"><span className="text-slate-600">{item.label}</span><span className="font-medium text-slate-800">{item.value.toLocaleString()} <span className="text-slate-400 font-normal">({pct}%)</span></span></div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full ${item.color} rounded-full`} style={{ width: `${pct}%` }} /></div>
                      </div>
                    );
                  })}
                </div>
              ) : <div className="flex items-center justify-center h-32 text-slate-400 text-sm">No claims data</div>}
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-800 mb-4">Payment Summary</h3>
              {paymentMetrics ? (
                <div className="space-y-3">
                  {[{ label: 'ACH Transfers', value: paymentMetrics.ach_count, amount: paymentMetrics.ach_amount }, { label: 'Wire Transfers', value: paymentMetrics.wire_count, amount: paymentMetrics.wire_amount }, { label: 'Check Payments', value: paymentMetrics.check_count, amount: paymentMetrics.check_amount }, { label: 'Refunds Issued', value: paymentMetrics.refund_count, amount: paymentMetrics.refund_amount }].map(item => (
                    <div key={item.label} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                      <span className="text-sm text-slate-600">{item.label}</span>
                      <div className="text-right"><div className="text-sm font-semibold text-slate-800">{item.amount != null ? `$${Number(item.amount).toLocaleString()}` : '—'}</div><div className="text-xs text-slate-400">{item.value != null ? `${item.value} transactions` : ''}</div></div>
                    </div>
                  ))}
                </div>
              ) : <div className="flex items-center justify-center h-32 text-slate-400 text-sm">No payment data</div>}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-800 mb-4">Fraud Detection</h3>
              {fraudMetrics ? (
                <div className="space-y-3">
                  {[{ label: 'High Risk Alerts', value: fraudMetrics.high_risk, icon: XCircle, color: 'text-red-500' }, { label: 'Medium Risk Alerts', value: fraudMetrics.medium_risk, icon: AlertTriangle, color: 'text-amber-500' }, { label: 'Confirmed Fraud', value: fraudMetrics.confirmed, icon: XCircle, color: 'text-red-700' }, { label: 'False Positives', value: fraudMetrics.false_positives, icon: CheckCircle, color: 'text-green-500' }, { label: 'Avg. Risk Score', value: fraudMetrics.avg_risk_score ? `${(fraudMetrics.avg_risk_score*100).toFixed(1)}%` : '—', icon: Activity, color: 'text-blue-500' }].map(item => (
                    <div key={item.label} className="flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2"><item.icon size={14} className={item.color} /><span className="text-sm text-slate-600">{item.label}</span></div>
                      <span className="text-sm font-semibold text-slate-800">{item.value ?? '—'}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="flex items-center justify-center h-32 text-slate-400 text-sm">No fraud data</div>}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">Recent Platform Events</h3>
              <button onClick={() => navigate('/audit')} className="text-sm text-blue-600 hover:text-blue-700 font-medium">View audit log →</button>
            </div>
            {recentEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Activity size={36} className="mb-3 opacity-30" /><p className="text-sm">No recent events</p></div>
            ) : (
              <div className="divide-y divide-slate-50">
                {recentEvents.map((event, i) => (
                  <div key={event.id || i} className="flex items-start gap-3 px-5 py-3">
                    <Clock size={14} className="text-slate-400 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-medium text-slate-700">{event.event_type || event.type || 'Event'}</span>{event.status && <StatusBadge status={event.status} />}</div>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{event.description || event.message || event.entity_id || ''}</p>
                    </div>
                    <span className="text-xs text-slate-400 whitespace-nowrap">{event.created_at ? new Date(event.created_at).toLocaleString() : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
