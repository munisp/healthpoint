#!/usr/bin/env python3
"""Generate all remaining page components for the unified shell."""
import os

PAGES_DIR = "/home/ubuntu/healthpoint-repo/frontend/unified-shell/src/pages"
API_BASE = "import.meta.env.VITE_API_BASE_URL || 'https://api.healthpoint.gov'"

PAGES = {
    "DisputeResolution": {
        "title": "IDR Dispute Resolution",
        "api": "/api/v1/disputes",
        "description": "Manage NSA/IDR dispute cases through the full 19-step workflow.",
        "icon": "Scale",
        "columns": ["id", "provider_name", "disputed_amount", "status", "deadline", "created_at"],
        "create_label": "New Dispute",
        "create_path": "/disputes/new",
    },
    "PaymentProcessing": {
        "title": "Payment Processing",
        "api": "/api/v1/payments",
        "description": "Process IDR determination payments via ACH, wire, check, EFT, or virtual card.",
        "icon": "DollarSign",
        "columns": ["id", "payment_method", "amount", "status", "provider_name", "created_at"],
        "create_label": "New Payment",
        "create_path": "/payments/new",
    },
    "GoodFaithEstimates": {
        "title": "Good Faith Estimates",
        "api": "/api/v1/gfe",
        "description": "Issue and manage Good Faith Estimates per 45 CFR §149.610.",
        "icon": "FileText",
        "columns": ["id", "patient_name", "service_description", "estimated_amount", "status", "issued_at"],
        "create_label": "Issue GFE",
        "create_path": "/gfe/new",
    },
    "ClaimsProcessing": {
        "title": "Claims Processing",
        "api": "/api/v1/claims",
        "description": "Process and adjudicate health insurance claims.",
        "icon": "Stethoscope",
        "columns": ["id", "patient_name", "service_code", "billed_amount", "allowed_amount", "status"],
        "create_label": "Submit Claim",
        "create_path": "/claims/new",
    },
    "ProviderManagement": {
        "title": "Provider Management",
        "api": "/api/v1/providers",
        "description": "Manage healthcare provider profiles, credentials, and network status.",
        "icon": "Building2",
        "columns": ["id", "name", "npi", "specialty", "network_status", "state"],
        "create_label": "Add Provider",
        "create_path": "/providers/new",
    },
    "AdminFeeManagement": {
        "title": "Admin Fee Management",
        "api": "/api/v1/admin-fees",
        "description": "Manage IDR administrative fees per 45 CFR §149.510(e).",
        "icon": "CreditCard",
        "columns": ["id", "dispute_id", "fee_type", "amount", "status", "due_date"],
        "create_label": "Record Fee",
        "create_path": "/admin-fees/new",
    },
    "Compliance": {
        "title": "NSA Compliance",
        "api": "/api/v1/compliance/reports",
        "description": "Monitor NSA regulatory compliance, deadlines, and reporting requirements.",
        "icon": "Shield",
        "columns": ["id", "report_type", "period", "status", "submitted_at", "score"],
        "create_label": "Generate Report",
        "create_path": "/compliance/new",
    },
    "Analytics": {
        "title": "Analytics & Reporting",
        "api": "/api/v1/analytics/reports",
        "description": "View platform-wide analytics, dispute trends, and financial summaries.",
        "icon": "BarChart3",
        "columns": ["id", "report_name", "type", "period", "status", "created_at"],
        "create_label": "New Report",
        "create_path": "/analytics/new",
    },
    "MemberPortal": {
        "title": "Member Portal",
        "api": "/api/v1/members",
        "description": "Manage member accounts, EOBs, and dispute initiation.",
        "icon": "Users",
        "columns": ["id", "name", "member_id", "plan_name", "status", "enrolled_at"],
        "create_label": "Add Member",
        "create_path": "/members/new",
    },
    "EmergencyServices": {
        "title": "Emergency Services",
        "api": "/api/v1/emergency-services",
        "description": "Manage emergency and air ambulance service disputes per NSA §2799B-1.",
        "icon": "AlertTriangle",
        "columns": ["id", "patient_name", "service_type", "transport_type", "amount", "status"],
        "create_label": "New Case",
        "create_path": "/emergency/new",
    },
    "UserManagement": {
        "title": "User Management",
        "api": "/api/v1/users",
        "description": "Manage platform users, roles, and permissions.",
        "icon": "User",
        "columns": ["id", "name", "email", "role", "status", "last_login"],
        "create_label": "Add User",
        "create_path": "/users/new",
    },
    "AuditLog": {
        "title": "Audit Log",
        "api": "/api/v1/audit",
        "description": "View immutable audit trail of all platform actions.",
        "icon": "Activity",
        "columns": ["id", "user_name", "action", "resource", "ip_address", "timestamp"],
        "create_label": None,
    },
    "SystemSettings": {
        "title": "System Settings",
        "api": "/api/v1/settings",
        "description": "Configure platform-wide settings, integrations, and notifications.",
        "icon": "Settings",
        "columns": ["key", "value", "category", "updated_at"],
        "create_label": None,
    },
}

PAGE_TEMPLATE = '''import React, {{ useState, useEffect, useCallback }} from 'react';
import {{ useNavigate, useSearchParams }} from 'react-router-dom';
import {{ authFetch }} from '../auth/keycloak.js';
import {{ {icon}, Plus, Search, RefreshCw, ChevronLeft, ChevronRight, AlertCircle }} from 'lucide-react';

const API_BASE = {api_base};

export default function {name}() {{
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const PAGE_SIZE = 20;

  const fetchItems = useCallback(async () => {{
    setLoading(true);
    setError(null);
    try {{
      const params = new URLSearchParams({{
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        ...(search && {{ search }}),
        ...Object.fromEntries(searchParams.entries()),
      }});
      const res = await authFetch(`${{API_BASE}}{api_path}?${{params}}`);
      if (!res?.ok) throw new Error(`HTTP ${{res?.status}}`);
      const data = await res.json();
      setItems(data.items || data.{resource_name} || data.data || []);
      setTotal(data.total || data.count || 0);
    }} catch (err) {{
      setError(err.message || 'Failed to load data');
    }} finally {{
      setLoading(false);
    }}
  }}, [page, search, searchParams]);

  useEffect(() => {{ fetchItems(); }}, [fetchItems]);

  const handleSearch = (e) => {{
    e.preventDefault();
    setPage(1);
    setSearchParams(search ? {{ q: search }} : {{}});
  }};

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      {{/* Page header */}}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={{fetchItems}}
            disabled={{loading}}
            className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={{14}} className={{loading ? 'animate-spin' : ''}} />
          </button>
          {create_button}
        </div>
      </div>

      {{/* Search bar */}}
      <form onSubmit={{handleSearch}} className="flex gap-2">
        <div className="relative flex-1">
          <Search size={{16}} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Search..."
            value={{search}}
            onChange={{(e) => setSearch(e.target.value)}}
            className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
          Search
        </button>
      </form>

      {{/* Error state */}}
      {{error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          <AlertCircle size={{16}} />
          {{error}}
        </div>
      )}}

      {{/* Table */}}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {{loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <{icon} size={{40}} className="mb-3 opacity-30" />
            <p className="font-medium">No records found</p>
            <p className="text-sm">{{search ? 'Try a different search term' : 'No data available yet'}}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {column_headers}
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {{items.map((item, idx) => (
                  <tr key={{item.id || idx}} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    {column_cells}
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={{() => navigate(`{base_path}/${{item.id}}`)}}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                      >
                        View →
                      </button>
                    </td>
                  </tr>
                ))}}
              </tbody>
            </table>
          </div>
        )}}
      </div>

      {{/* Pagination */}}
      {{totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Showing {{(page - 1) * PAGE_SIZE + 1}}–{{Math.min(page * PAGE_SIZE, total)}} of {{total}}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={{() => setPage((p) => Math.max(1, p - 1))}}
              disabled={{page === 1}}
              className="p-1.5 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft size={{16}} />
            </button>
            <span>Page {{page}} of {{totalPages}}</span>
            <button
              onClick={{() => setPage((p) => Math.min(totalPages, p + 1))}}
              disabled={{page === totalPages}}
              className="p-1.5 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronRight size={{16}} />
            </button>
          </div>
        </div>
      )}}
    </div>
  );
}}
'''

def col_to_label(col):
    return col.replace('_', ' ').title()

def generate_page(name, config):
    columns = config['columns']
    
    column_headers = '\n                  '.join(
        f'<th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">{col_to_label(col)}</th>'
        for col in columns
    )
    
    column_cells = '\n                    '.join(
        f'<td className="px-4 py-3 text-sm text-slate-700">{{String(item.{col} ?? \'—\')}}</td>'
        for col in columns
    )
    
    create_button = ''
    if config.get('create_label'):
        create_button = f'''<button
            onClick={{() => navigate('{config["create_path"]}')}}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
          >
            <Plus size={{14}} />
            {config['create_label']}
          </button>'''
    
    resource_name = config['api'].split('/')[-1].replace('-', '_')
    base_path = '/' + config['api'].split('/api/v1/')[-1]
    
    content = PAGE_TEMPLATE.format(
        name=name,
        icon=config['icon'],
        api_base=f"import.meta.env.VITE_API_BASE_URL || 'https://api.healthpoint.gov'",
        api_path=config['api'],
        resource_name=resource_name,
        description=config['description'],
        create_button=create_button,
        column_headers=column_headers,
        column_cells=column_cells,
        base_path=base_path,
    )
    
    return content

os.makedirs(PAGES_DIR, exist_ok=True)

for name, config in PAGES.items():
    filepath = os.path.join(PAGES_DIR, f"{name}.jsx")
    # Skip Dashboard.jsx — already written manually
    if name == "Dashboard":
        continue
    content = generate_page(name, config)
    with open(filepath, 'w') as f:
        f.write(content)
    print(f"  Generated: {name}.jsx")

print(f"\nTotal pages generated: {len(PAGES) - 1}")
