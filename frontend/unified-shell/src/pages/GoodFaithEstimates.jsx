import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../auth/keycloak.js';
import { FileText, Plus, RefreshCw, Search, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle, Send, Shield } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.healthpoint.gov';
const PAGE_SIZE = 20;

function StatusBadge({ status }) {
  const map = {
    draft: 'bg-slate-100 text-slate-600',
    sent: 'bg-blue-100 text-blue-700',
    confirmed: 'bg-green-100 text-green-700',
    disputed: 'bg-red-100 text-red-700',
    expired: 'bg-amber-100 text-amber-700',
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status?.toLowerCase()] || 'bg-slate-100 text-slate-600'}`}>{status ?? '—'}</span>;
}

function KpiCard({ title, value, icon: Icon, color, subtitle }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className={`p-2.5 rounded-lg ${color} w-fit mb-3`}><Icon size={18} className="text-white" /></div>
      <div className="text-2xl font-bold text-slate-800 mb-0.5">{value ?? '—'}</div>
      <div className="text-sm font-medium text-slate-600">{title}</div>
      {subtitle && <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>}
    </div>
  );
}

export default function GoodFaithEstimates() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [validating, setValidating] = useState(null);
  const [sending, setSending] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
      if (search) params.set('search', search);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const [listRes, statsRes] = await Promise.all([
        authFetch(`${API_BASE}/api/v1/gfe?${params}`),
        authFetch(`${API_BASE}/api/v1/analytics/kpis?period=30d`),
      ]);
      if (listRes?.ok) { const d = await listRes.json(); setItems(d.items || d.gfes || d.data || []); setTotal(d.total || d.count || 0); }
      if (statsRes?.ok) setStats(await statsRes.json());
    } catch (err) { setError(err.message || 'Failed to load GFEs'); }
    finally { setLoading(false); }
  }, [page, search, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleValidate = async (gfeId) => {
    setValidating(gfeId);
    try {
      const res = await authFetch(`${API_BASE}/api/v1/validate/gfe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gfe_id: gfeId }),
      });
      if (res?.ok) { await fetchData(); }
    } catch (err) { console.error('Validate failed:', err); }
    finally { setValidating(null); }
  };

  const handleSend = async (gfeId) => {
    setSending(gfeId);
    try {
      const res = await authFetch(`${API_BASE}/api/v1/gfe/${gfeId}/send`, { method: 'POST' });
      if (res?.ok) { await fetchData(); }
    } catch (err) { console.error('Send failed:', err); }
    finally { setSending(null); }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const STATUS_TABS = ['all', 'draft', 'sent', 'confirmed', 'disputed'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Manage Good Faith Estimates per NSA §2799B-6 requirements</p>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} disabled={loading} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => navigate('/gfe/new')} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            <Plus size={14} />New GFE
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="GFEs Issued (30d)" value={stats?.gfe_issued_30d?.toLocaleString()} icon={FileText} color="bg-blue-500" />
        <KpiCard title="Awaiting Confirmation" value={stats?.gfe_pending_confirmation?.toLocaleString()} icon={Send} color="bg-amber-500" />
        <KpiCard title="Disputes Triggered" value={stats?.gfe_disputes?.toLocaleString()} icon={AlertTriangle} color="bg-red-500" />
        <KpiCard title="Avg. Estimate Accuracy" value={stats?.gfe_accuracy_pct ? `${stats.gfe_accuracy_pct}%` : null} icon={Shield} color="bg-green-500" subtitle="Within 10% of actual" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_TABS.map(s => (
          <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
            className={`px-3 py-1.5 text-sm rounded-lg capitalize ${statusFilter === s ? 'bg-blue-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            {s === 'all' ? 'All GFEs' : s}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="search" placeholder="Search patient or provider..." value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="pl-8 pr-4 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-64" />
        </div>
      </div>

      {error && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm"><AlertTriangle size={16} />{error}</div>}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <FileText size={40} className="mb-3 opacity-30" />
            <p className="font-medium">No GFEs found</p>
            <p className="text-sm">{search ? 'Try a different search term' : 'No good faith estimates yet'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['GFE ID', 'Patient Name', 'Provider', 'Service Description', 'Estimated Amount', 'Actual Amount', 'Status', 'Issue Date', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item.id || idx} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-mono text-slate-600">{item.id?.slice(0, 8) || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{item.patient_name || item.patient?.name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{item.provider_name || item.provider?.name || item.provider_npi || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-700 max-w-[200px] truncate">{item.service_description || item.description || '—'}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-800">{item.estimated_amount != null ? `$${Number(item.estimated_amount).toLocaleString()}` : '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{item.actual_amount != null ? `$${Number(item.actual_amount).toLocaleString()}` : <span className="text-slate-400">Pending</span>}</td>
                    <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                    <td className="px-4 py-3 text-sm text-slate-500">{item.issue_date ? new Date(item.issue_date).toLocaleDateString() : item.created_at ? new Date(item.created_at).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {item.status === 'draft' && (
                          <button onClick={() => handleValidate(item.id)} disabled={validating === item.id}
                            className="text-xs px-2 py-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1">
                            {validating === item.id ? <RefreshCw size={10} className="animate-spin" /> : <CheckCircle size={10} />}Validate
                          </button>
                        )}
                        {(item.status === 'draft' || item.status === 'validated') && (
                          <button onClick={() => handleSend(item.id)} disabled={sending === item.id}
                            className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
                            {sending === item.id ? <RefreshCw size={10} className="animate-spin" /> : <Send size={10} />}Send
                          </button>
                        )}
                        <button onClick={() => navigate(`/gfe/${item.id}`)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">View →</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40"><ChevronLeft size={16} /></button>
            <span>Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1.5 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
