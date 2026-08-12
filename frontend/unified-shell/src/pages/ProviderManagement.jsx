import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../auth/keycloak.js';
import { Building2, Plus, RefreshCw, Search, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.healthpoint.gov';
const PAGE_SIZE = 20;

function NetworkBadge({ status }) {
  if (!status) return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">—</span>;
  const isIn = status.toLowerCase().includes('in');
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${isIn ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{status}</span>;
}

function VerificationBadge({ status }) {
  const map = { verified: 'bg-green-100 text-green-700', pending: 'bg-amber-100 text-amber-700', rejected: 'bg-red-100 text-red-700', active: 'bg-green-100 text-green-700', inactive: 'bg-slate-100 text-slate-600' };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status?.toLowerCase()] || 'bg-slate-100 text-slate-600'}`}>{status ?? '—'}</span>;
}

function KpiCard({ title, value, icon: Icon, color }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className={`p-2.5 rounded-lg ${color} w-fit mb-3`}><Icon size={18} className="text-white" /></div>
      <div className="text-2xl font-bold text-slate-800 mb-0.5">{value ?? '—'}</div>
      <div className="text-sm font-medium text-slate-600">{title}</div>
    </div>
  );
}

export default function ProviderManagement() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [networkFilter, setNetworkFilter] = useState('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProvider, setNewProvider] = useState({ npi: '', name: '', specialty: '', state: '', phone: '', email: '', network_status: 'out_of_network' });
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
      if (search) params.set('search', search);
      if (networkFilter !== 'all') params.set('network_status', networkFilter);
      const res = await authFetch(`${API_BASE}/providers?${params}`);
      if (res?.ok) { const d = await res.json(); setItems(d.items || d.providers || d.data || []); setTotal(d.total || d.count || 0); }
      else throw new Error(`HTTP ${res?.status}`);
    } catch (err) { setError(err.message || 'Failed to load providers'); }
    finally { setLoading(false); }
  }, [page, search, networkFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAddProvider = async (e) => {
    e.preventDefault(); setSubmitting(true);
    try {
      const res = await authFetch(`${API_BASE}/providers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProvider),
      });
      if (res?.ok) { setShowAddForm(false); setNewProvider({ npi: '', name: '', specialty: '', state: '', phone: '', email: '', network_status: 'out_of_network' }); await fetchData(); }
    } catch (err) { console.error('Add provider failed:', err); }
    finally { setSubmitting(false); }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const inNetwork = items.filter(i => i.network_status?.toLowerCase().includes('in')).length;
  const outNetwork = items.filter(i => !i.network_status?.toLowerCase().includes('in')).length;
  const pending = items.filter(i => i.verification_status?.toLowerCase() === 'pending').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Manage provider NPI registrations, network status, and verification</p>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} disabled={loading} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setShowAddForm(v => !v)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            <Plus size={14} />Add Provider
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Total Providers" value={total.toLocaleString()} icon={Building2} color="bg-blue-500" />
        <KpiCard title="In-Network" value={inNetwork.toLocaleString()} icon={CheckCircle} color="bg-green-500" />
        <KpiCard title="Out-of-Network" value={outNetwork.toLocaleString()} icon={XCircle} color="bg-orange-500" />
        <KpiCard title="Pending Verification" value={pending.toLocaleString()} icon={AlertTriangle} color="bg-amber-500" />
      </div>

      {showAddForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-800 mb-4">Add New Provider</h3>
          <form onSubmit={handleAddProvider} className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {[{ key: 'npi', label: 'NPI Number', required: true }, { key: 'name', label: 'Provider Name', required: true }, { key: 'specialty', label: 'Specialty' }, { key: 'state', label: 'State' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }].map(f => (
              <div key={f.key}>
                <label className="block text-xs font-medium text-slate-600 mb-1">{f.label}{f.required && ' *'}</label>
                <input type="text" required={f.required} value={newProvider[f.key]} onChange={e => setNewProvider(p => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            ))}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Network Status</label>
              <select value={newProvider.network_status} onChange={e => setNewProvider(p => ({ ...p, network_status: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="in_network">In-Network</option>
                <option value="out_of_network">Out-of-Network</option>
              </select>
            </div>
            <div className="col-span-full flex gap-2 justify-end">
              <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={submitting} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {submitting ? 'Adding...' : 'Add Provider'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {['all', 'in_network', 'out_of_network'].map(s => (
          <button key={s} onClick={() => { setNetworkFilter(s); setPage(1); }}
            className={`px-3 py-1.5 text-sm rounded-lg ${networkFilter === s ? 'bg-blue-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            {s === 'all' ? 'All Providers' : s === 'in_network' ? 'In-Network' : 'Out-of-Network'}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="search" placeholder="Search NPI or name..." value={search}
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
            <Building2 size={40} className="mb-3 opacity-30" />
            <p className="font-medium">No providers found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['NPI', 'Provider Name', 'Specialty', 'Network Status', 'Verification', 'State', 'Phone', 'Email', 'Registered', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item.id || item.npi || idx} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-mono text-slate-600">{item.npi || '—'}</td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-800">{item.name || item.provider_name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{item.specialty || '—'}</td>
                    <td className="px-4 py-3"><NetworkBadge status={item.network_status} /></td>
                    <td className="px-4 py-3"><VerificationBadge status={item.verification_status || item.status} /></td>
                    <td className="px-4 py-3 text-sm text-slate-600">{item.state || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{item.phone || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 truncate max-w-[150px]">{item.email || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{item.created_at ? new Date(item.created_at).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => navigate(`/providers/${item.id || item.npi}`)} className="text-sm text-blue-600 hover:text-blue-700 font-medium">View →</button>
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
