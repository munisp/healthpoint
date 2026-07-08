/**
 * EMR Onboarding Wizard
 * =====================
 * Step-by-step wizard for onboarding new EMR vendors to the HealthPoint platform.
 *
 * Steps:
 *  1. Vendor Selection   — choose from 9 known vendors or Generic FHIR R4
 *  2. Environment Setup  — sandbox vs production, FHIR base URL, contact info
 *  3. Capability Discovery — auto-discover FHIR capabilities (background task)
 *  4. Credential Entry   — client_id, client_secret / private key / API key
 *  5. Connection Test    — verify token exchange and FHIR metadata
 *  6. Scope Configuration — select FHIR scopes and sync resources
 *  7. Activation         — go live and get tenant ID
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth/keycloak';

const API_BASE = import.meta.env.VITE_EMR_ONBOARDING_API || '/api/emr';

// ── Utility ──────────────────────────────────────────────────────────────────

function useApi() {
  const { token } = useAuth();
  const call = useCallback(async (method, path, body) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }, [token]);
  return call;
}

// ── Step Indicator ────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: 'Select Vendor' },
  { id: 2, label: 'Environment' },
  { id: 3, label: 'Discovery' },
  { id: 4, label: 'Credentials' },
  { id: 5, label: 'Test' },
  { id: 6, label: 'Scopes' },
  { id: 7, label: 'Activate' },
];

function StepIndicator({ currentStep }) {
  return (
    <div className="flex items-center justify-between mb-8 px-2">
      {STEPS.map((step, idx) => (
        <div key={step.id} className="flex items-center flex-1">
          <div className="flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors
              ${currentStep === step.id ? 'bg-blue-600 border-blue-600 text-white' :
                currentStep > step.id ? 'bg-green-500 border-green-500 text-white' :
                'bg-white border-gray-300 text-gray-400'}`}>
              {currentStep > step.id ? '✓' : step.id}
            </div>
            <span className={`text-xs mt-1 text-center whitespace-nowrap
              ${currentStep === step.id ? 'text-blue-600 font-semibold' :
                currentStep > step.id ? 'text-green-600' : 'text-gray-400'}`}>
              {step.label}
            </span>
          </div>
          {idx < STEPS.length - 1 && (
            <div className={`flex-1 h-0.5 mx-2 mt-[-12px]
              ${currentStep > step.id ? 'bg-green-500' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Step 1: Vendor Selection ──────────────────────────────────────────────────

function VendorCard({ vendor, selected, onClick }) {
  return (
    <button
      onClick={() => onClick(vendor)}
      className={`p-4 rounded-xl border-2 text-left transition-all hover:shadow-md
        ${selected ? 'border-blue-600 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-300'}`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-lg font-bold text-gray-500 shrink-0">
          {vendor.display_name.charAt(0)}
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-gray-900 text-sm">{vendor.display_name}</div>
          <div className="text-xs text-gray-500 mt-0.5">FHIR {vendor.fhir_version}</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {vendor.auth_types.slice(0, 2).map(a => (
              <span key={a} className="px-1.5 py-0.5 bg-gray-100 rounded text-xs text-gray-600">
                {a.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
          {vendor.notes && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded p-1.5 mt-2 line-clamp-2">
              ℹ {vendor.notes}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

function StepVendorSelection({ onNext }) {
  const api = useApi();
  const [vendors, setVendors] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('GET', '/onboarding/vendors')
      .then(d => setVendors(d.vendors))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" /></div>;
  if (error) return <div className="text-red-600 bg-red-50 rounded-lg p-4">{error}</div>;

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Select Your EMR Vendor</h2>
      <p className="text-gray-500 text-sm mb-6">
        Choose the EMR system you want to connect. We support {vendors.length} vendors including a Generic FHIR R4 option for any compliant system.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[480px] overflow-y-auto pr-1">
        {vendors.map(v => (
          <VendorCard
            key={v.key}
            vendor={v}
            selected={selected?.key === v.key}
            onClick={setSelected}
          />
        ))}
      </div>
      {selected && (
        <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200 flex items-center justify-between">
          <span className="text-blue-800 font-medium text-sm">Selected: {selected.display_name}</span>
          {selected.registration_url && (
            <a href={selected.registration_url} target="_blank" rel="noopener noreferrer"
               className="text-xs text-blue-600 underline">
              Register App →
            </a>
          )}
        </div>
      )}
      <div className="flex justify-end mt-6">
        <button
          onClick={() => onNext({ vendor: selected })}
          disabled={!selected}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Environment Setup ─────────────────────────────────────────────────

function StepEnvironmentSetup({ data, onNext, onBack }) {
  const [form, setForm] = useState({
    tenant_name: '',
    environment: 'sandbox',
    tenant_fhir_base_url: '',
    contact_name: '',
    contact_email: '',
    auth_type: data.vendor?.auth_types?.[0] || 'smart_ehr_launch',
  });

  const isGeneric = data.vendor?.key === 'generic_fhir_r4';
  const valid = form.tenant_name && form.contact_name && form.contact_email &&
    (!isGeneric || form.tenant_fhir_base_url);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Environment Configuration</h2>
      <p className="text-gray-500 text-sm mb-6">
        Configure the environment and contact details for <strong>{data.vendor?.display_name}</strong>.
      </p>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Organization / Tenant Name *</label>
          <input
            type="text"
            value={form.tenant_name}
            onChange={e => set('tenant_name', e.target.value)}
            placeholder="e.g. Memorial Hospital System"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Environment *</label>
          <div className="flex gap-3">
            {['sandbox', 'production'].map(env => (
              <label key={env} className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 cursor-pointer transition-colors
                ${form.environment === env ? 'border-blue-600 bg-blue-50' : 'border-gray-200'}`}>
                <input type="radio" name="env" value={env} checked={form.environment === env}
                  onChange={() => set('environment', env)} className="sr-only" />
                <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center
                  ${form.environment === env ? 'border-blue-600' : 'border-gray-400'}`}>
                  {form.environment === env && <span className="w-2 h-2 bg-blue-600 rounded-full" />}
                </span>
                <span className="text-sm font-medium capitalize">{env}</span>
              </label>
            ))}
          </div>
          {form.environment === 'production' && (
            <p className="text-amber-700 text-xs mt-2 bg-amber-50 p-2 rounded">
              ⚠ Production credentials will be encrypted at rest. Ensure you have signed a HIPAA BAA with your hosting provider.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Authentication Type *</label>
          <select
            value={form.auth_type}
            onChange={e => set('auth_type', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {(data.vendor?.auth_types || []).map(a => (
              <option key={a} value={a}>{a.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
            ))}
          </select>
        </div>

        {(isGeneric || form.environment === 'production') && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              FHIR Base URL {isGeneric ? '*' : '(optional — overrides sandbox default)'}
            </label>
            <input
              type="url"
              value={form.tenant_fhir_base_url}
              onChange={e => set('tenant_fhir_base_url', e.target.value)}
              placeholder="https://fhir.yourhospital.org/api/FHIR/R4"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name *</label>
            <input
              type="text"
              value={form.contact_name}
              onChange={e => set('contact_name', e.target.value)}
              placeholder="Jane Smith"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email *</label>
            <input
              type="email"
              value={form.contact_email}
              onChange={e => set('contact_email', e.target.value)}
              placeholder="jane@hospital.org"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>
      <div className="flex justify-between mt-6">
        <button onClick={onBack} className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm">← Back</button>
        <button
          onClick={() => onNext({ ...data, envConfig: form })}
          disabled={!valid}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors"
        >
          Start Onboarding →
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Capability Discovery ──────────────────────────────────────────────

function StepCapabilityDiscovery({ data, onNext, onBack }) {
  const api = useApi();
  const [onboardingId, setOnboardingId] = useState(null);
  const [status, setStatus] = useState('starting');
  const [statusData, setStatusData] = useState(null);
  const [error, setError] = useState(null);

  // Start onboarding session on mount
  useEffect(() => {
    if (data.onboardingId) {
      setOnboardingId(data.onboardingId);
      setStatus('polling');
      return;
    }
    const { vendor, envConfig } = data;
    api('POST', '/onboarding/start', {
      vendor_key: vendor.key,
      tenant_name: envConfig.tenant_name,
      environment: envConfig.environment,
      auth_type: envConfig.auth_type,
      tenant_fhir_base_url: envConfig.tenant_fhir_base_url || undefined,
      contact_name: envConfig.contact_name,
      contact_email: envConfig.contact_email,
    })
      .then(res => {
        setOnboardingId(res.onboarding_id);
        setStatus('polling');
      })
      .catch(e => {
        setError(e.message);
        setStatus('error');
      });
  }, []);

  // Poll status
  useEffect(() => {
    if (status !== 'polling' || !onboardingId) return;
    const poll = async () => {
      try {
        const s = await api('GET', `/onboarding/${onboardingId}/status`);
        setStatusData(s);
        if (['credential_entry', 'connection_test', 'active', 'failed'].includes(s.status)) {
          setStatus('done');
        }
      } catch (e) {
        setError(e.message);
        setStatus('error');
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [status, onboardingId]);

  const isDone = status === 'done' && statusData?.status === 'credential_entry';
  const isFailed = statusData?.status === 'failed';

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Capability Discovery</h2>
      <p className="text-gray-500 text-sm mb-6">
        Automatically discovering FHIR capabilities from the {data.vendor?.display_name} endpoint.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-red-700 text-sm">{error}</div>
      )}

      <div className="space-y-3">
        <div className={`flex items-center gap-3 p-3 rounded-lg border ${onboardingId ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
          {onboardingId
            ? <span className="text-green-600 text-lg">✓</span>
            : <div className="animate-spin w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full" />}
          <div>
            <div className="font-medium text-sm">Onboarding session created</div>
            {onboardingId && <div className="text-xs text-gray-500 font-mono">{onboardingId}</div>}
          </div>
        </div>

        <div className={`flex items-center gap-3 p-3 rounded-lg border
          ${statusData?.status === 'credential_entry' ? 'border-green-200 bg-green-50' :
            statusData?.status === 'capability_discovery' ? 'border-blue-200 bg-blue-50' :
            isFailed ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
          {statusData?.status === 'credential_entry'
            ? <span className="text-green-600 text-lg">✓</span>
            : statusData?.status === 'capability_discovery' || status === 'polling'
            ? <div className="animate-spin w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full" />
            : isFailed ? <span className="text-red-600 text-lg">✗</span>
            : <span className="text-gray-300 text-lg">○</span>}
          <div>
            <div className="font-medium text-sm">FHIR CapabilityStatement discovery</div>
            {statusData?.discovered_resources?.length > 0 && (
              <div className="text-xs text-green-700 mt-0.5">
                {statusData.discovered_resources.length} resource types discovered
              </div>
            )}
            {isFailed && <div className="text-xs text-red-600">{statusData?.recent_events?.[0]?.details?.error}</div>}
          </div>
        </div>

        {statusData?.discovered_resources?.length > 0 && (
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
            <div className="text-xs font-semibold text-gray-700 mb-2">Discovered Resources</div>
            <div className="flex flex-wrap gap-1.5">
              {statusData.discovered_resources.slice(0, 20).map(r => (
                <span key={r.type || r} className="px-2 py-0.5 bg-white border border-gray-200 rounded text-xs text-gray-700">
                  {r.type || r}
                </span>
              ))}
              {statusData.discovered_resources.length > 20 && (
                <span className="px-2 py-0.5 text-xs text-gray-500">+{statusData.discovered_resources.length - 20} more</span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between mt-6">
        <button onClick={onBack} className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm">← Back</button>
        <button
          onClick={() => onNext({ ...data, onboardingId })}
          disabled={!isDone}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors"
        >
          Enter Credentials →
        </button>
      </div>
    </div>
  );
}

// ── Step 4: Credential Entry ──────────────────────────────────────────────────

function StepCredentialEntry({ data, onNext, onBack }) {
  const api = useApi();
  const [form, setForm] = useState({
    client_id: '',
    client_secret: '',
    private_key_pem: '',
    api_key: '',
    fhir_base_url: '',
    auth_url: '',
    token_url: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const authType = data.envConfig?.auth_type || 'smart_ehr_launch';
  const isPrivateKey = data.vendor?.key === 'epic' || authType === 'backend_services';
  const isApiKey = authType === 'api_key';
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api('POST', `/onboarding/${data.onboardingId}/credentials`, {
        onboarding_id: data.onboardingId,
        client_id: form.client_id || undefined,
        client_secret: form.client_secret || undefined,
        private_key_pem: form.private_key_pem || undefined,
        api_key: form.api_key || undefined,
        fhir_base_url: form.fhir_base_url || undefined,
        auth_url: form.auth_url || undefined,
        token_url: form.token_url || undefined,
      });
      onNext({ ...data });
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Enter Credentials</h2>
      <p className="text-gray-500 text-sm mb-2">
        Credentials are encrypted with AES-256 before storage. Never stored in plaintext.
      </p>
      {data.vendor?.registration_url && (
        <a href={data.vendor.registration_url} target="_blank" rel="noopener noreferrer"
           className="inline-flex items-center gap-1 text-xs text-blue-600 underline mb-4">
          Register your app at {data.vendor.display_name} →
        </a>
      )}

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-red-700 text-sm">{error}</div>}

      <div className="space-y-4">
        {!isApiKey && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client ID *</label>
            <input
              type="text"
              value={form.client_id}
              onChange={e => set('client_id', e.target.value)}
              placeholder="Your registered client/application ID"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {!isPrivateKey && !isApiKey && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret</label>
            <input
              type="password"
              value={form.client_secret}
              onChange={e => set('client_secret', e.target.value)}
              placeholder="Client secret from app registration"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {isPrivateKey && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Private Key (PEM) — required for {data.vendor?.display_name}
            </label>
            <textarea
              value={form.private_key_pem}
              onChange={e => set('private_key_pem', e.target.value)}
              placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
              rows={6}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Epic uses private_key_jwt — no client_secret needed. Upload the corresponding public key in App Orchard.
            </p>
          </div>
        )}

        {isApiKey && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key *</label>
            <input
              type="password"
              value={form.api_key}
              onChange={e => set('api_key', e.target.value)}
              placeholder="API key from the vendor portal"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        <details className="border border-gray-200 rounded-lg">
          <summary className="px-3 py-2 text-sm text-gray-600 cursor-pointer hover:bg-gray-50">
            Override discovered endpoints (optional)
          </summary>
          <div className="px-3 pb-3 space-y-3 pt-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">FHIR Base URL</label>
              <input type="url" value={form.fhir_base_url} onChange={e => set('fhir_base_url', e.target.value)}
                placeholder="https://fhir.hospital.org/api/FHIR/R4"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Authorization URL</label>
              <input type="url" value={form.auth_url} onChange={e => set('auth_url', e.target.value)}
                placeholder="https://fhir.hospital.org/oauth2/authorize"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Token URL</label>
              <input type="url" value={form.token_url} onChange={e => set('token_url', e.target.value)}
                placeholder="https://fhir.hospital.org/oauth2/token"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
          </div>
        </details>
      </div>

      <div className="flex justify-between mt-6">
        <button onClick={onBack} className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm">← Back</button>
        <button
          onClick={handleSubmit}
          disabled={submitting || (!form.client_id && !form.api_key)}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors flex items-center gap-2"
        >
          {submitting && <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />}
          Save & Test Connection →
        </button>
      </div>
    </div>
  );
}

// ── Step 5: Connection Test ───────────────────────────────────────────────────

function StepConnectionTest({ data, onNext, onBack }) {
  const api = useApi();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const runTest = async () => {
    setTesting(true);
    setError(null);
    setResult(null);
    try {
      const r = await api('POST', `/onboarding/${data.onboardingId}/test`);
      setResult(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => { runTest(); }, []);

  const Check = ({ ok, label, detail }) => (
    <div className={`flex items-start gap-3 p-3 rounded-lg border
      ${ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
      <span className={`text-lg mt-0.5 ${ok ? 'text-green-600' : 'text-red-500'}`}>{ok ? '✓' : '✗'}</span>
      <div>
        <div className={`font-medium text-sm ${ok ? 'text-green-800' : 'text-red-800'}`}>{label}</div>
        {detail && <div className="text-xs mt-0.5 text-gray-600">{detail}</div>}
      </div>
    </div>
  );

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Connection Test</h2>
      <p className="text-gray-500 text-sm mb-6">
        Verifying connectivity to {data.vendor?.display_name}.
      </p>

      {testing && (
        <div className="flex flex-col items-center py-8 gap-3">
          <div className="animate-spin w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full" />
          <p className="text-gray-500 text-sm">Running connection tests…</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-red-700 text-sm">{error}</div>
      )}

      {result && (
        <div className="space-y-3">
          <Check ok={result.token_exchange} label="Authentication endpoint reachable"
            detail={result.token_exchange ? 'Auth/token endpoint responded successfully' : 'Could not reach auth endpoint'} />
          <Check ok={result.fhir_metadata} label="FHIR metadata endpoint"
            detail={result.fhir_metadata ? `FHIR ${result.fhir_version || 'R4'} CapabilityStatement retrieved` : 'Could not fetch FHIR metadata'} />
          {result.patient_search !== undefined && (
            <Check ok={result.patient_search} label="Patient search"
              detail={result.patient_search ? `${result.patient_count?.toLocaleString() || 0} patients accessible` : 'Patient search failed'} />
          )}

          {result.errors?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="text-amber-800 font-medium text-sm mb-2">Issues detected:</div>
              {result.errors.map((e, i) => (
                <div key={i} className="text-xs text-amber-700 font-mono">{e}</div>
              ))}
            </div>
          )}

          {result.passed && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-800 text-sm font-medium">
              ✓ Connection test passed! Ready to configure scopes.
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between mt-6">
        <button onClick={onBack} className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm">← Back</button>
        <div className="flex gap-2">
          {result && !result.passed && (
            <button onClick={runTest} disabled={testing}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50">
              Retry Test
            </button>
          )}
          <button
            onClick={() => onNext({ ...data })}
            disabled={!result?.passed}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors"
          >
            Configure Scopes →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Step 6: Scope Configuration ───────────────────────────────────────────────

const COMMON_SCOPES = [
  { value: 'launch', label: 'launch', desc: 'EHR launch context', required: true },
  { value: 'openid', label: 'openid', desc: 'OpenID Connect identity', required: true },
  { value: 'fhirUser', label: 'fhirUser', desc: 'FHIR user identity', required: false },
  { value: 'patient/Patient.read', label: 'Patient.read', desc: 'Read patient demographics', required: true },
  { value: 'patient/Coverage.read', label: 'Coverage.read', desc: 'Read insurance coverage', required: true },
  { value: 'patient/Encounter.read', label: 'Encounter.read', desc: 'Read encounters', required: false },
  { value: 'patient/Condition.read', label: 'Condition.read', desc: 'Read diagnoses', required: false },
  { value: 'patient/Procedure.read', label: 'Procedure.read', desc: 'Read procedures', required: false },
  { value: 'patient/Observation.read', label: 'Observation.read', desc: 'Read observations/labs', required: false },
  { value: 'patient/MedicationRequest.read', label: 'MedicationRequest.read', desc: 'Read medications', required: false },
  { value: 'patient/DiagnosticReport.read', label: 'DiagnosticReport.read', desc: 'Read diagnostic reports', required: false },
  { value: 'patient/ExplanationOfBenefit.read', label: 'ExplanationOfBenefit.read', desc: 'Read EOBs (claims)', required: false },
];

const SYNC_RESOURCES = ['Patient', 'Coverage', 'Encounter', 'Condition', 'Procedure', 'Observation', 'MedicationRequest', 'DiagnosticReport', 'ExplanationOfBenefit'];

function StepScopeConfiguration({ data, onNext, onBack }) {
  const api = useApi();
  const [selectedScopes, setSelectedScopes] = useState(
    COMMON_SCOPES.filter(s => s.required).map(s => s.value)
  );
  const [selectedResources, setSelectedResources] = useState(['Patient', 'Coverage', 'Encounter']);
  const [syncFrequency, setSyncFrequency] = useState(24);
  const [lookbackDays, setLookbackDays] = useState(365);
  const [patientMatching, setPatientMatching] = useState(true);
  const [autoCreate, setAutoCreate] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const toggleScope = (v) => setSelectedScopes(s => s.includes(v) ? s.filter(x => x !== v) : [...s, v]);
  const toggleResource = (v) => setSelectedResources(r => r.includes(v) ? r.filter(x => x !== v) : [...r, v]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api('POST', `/onboarding/${data.onboardingId}/scopes`, {
        onboarding_id: data.onboardingId,
        scopes: selectedScopes,
        sync_resources: selectedResources,
        sync_frequency_hours: syncFrequency,
        sync_lookback_days: lookbackDays,
        patient_matching_enabled: patientMatching,
        auto_create_fhir_resources: autoCreate,
      });
      onNext({ ...data });
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Scope & Sync Configuration</h2>
      <p className="text-gray-500 text-sm mb-6">
        Select the FHIR scopes and resources to sync from {data.vendor?.display_name}.
      </p>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-red-700 text-sm">{error}</div>}

      <div className="space-y-5">
        <div>
          <div className="text-sm font-semibold text-gray-700 mb-2">FHIR Scopes</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {COMMON_SCOPES.map(scope => (
              <label key={scope.value} className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors
                ${selectedScopes.includes(scope.value) ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <input
                  type="checkbox"
                  checked={selectedScopes.includes(scope.value)}
                  onChange={() => !scope.required && toggleScope(scope.value)}
                  disabled={scope.required}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-xs font-mono font-medium text-gray-800">{scope.label}</div>
                  <div className="text-xs text-gray-500">{scope.desc}</div>
                  {scope.required && <span className="text-xs text-blue-600">required</span>}
                </div>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold text-gray-700 mb-2">Resources to Sync</div>
          <div className="flex flex-wrap gap-2">
            {SYNC_RESOURCES.map(r => (
              <button key={r} onClick={() => toggleResource(r)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
                  ${selectedResources.includes(r) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}>
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sync Frequency</label>
            <select value={syncFrequency} onChange={e => setSyncFrequency(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value={1}>Every hour</option>
              <option value={6}>Every 6 hours</option>
              <option value={12}>Every 12 hours</option>
              <option value={24}>Daily</option>
              <option value={168}>Weekly</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Historical Lookback</label>
            <select value={lookbackDays} onChange={e => setLookbackDays(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value={90}>90 days</option>
              <option value={180}>6 months</option>
              <option value={365}>1 year</option>
              <option value={730}>2 years</option>
              <option value={1825}>5 years</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={patientMatching} onChange={e => setPatientMatching(e.target.checked)} className="w-4 h-4" />
            <div>
              <div className="text-sm font-medium text-gray-700">Enable probabilistic patient matching</div>
              <div className="text-xs text-gray-500">Match incoming patients to existing HealthPoint records using MPI</div>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={autoCreate} onChange={e => setAutoCreate(e.target.checked)} className="w-4 h-4" />
            <div>
              <div className="text-sm font-medium text-gray-700">Auto-create FHIR resources in Medplum</div>
              <div className="text-xs text-gray-500">Automatically upsert synced resources to the HealthPoint FHIR server</div>
            </div>
          </label>
        </div>
      </div>

      <div className="flex justify-between mt-6">
        <button onClick={onBack} className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm">← Back</button>
        <button
          onClick={handleSubmit}
          disabled={submitting || selectedScopes.length === 0 || selectedResources.length === 0}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors flex items-center gap-2"
        >
          {submitting && <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />}
          Activate Tenant →
        </button>
      </div>
    </div>
  );
}

// ── Step 7: Activation ────────────────────────────────────────────────────────

function StepActivation({ data, onBack }) {
  const api = useApi();
  const [activating, setActivating] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setActivating(true);
    api('POST', `/onboarding/${data.onboardingId}/activate`)
      .then(r => { setResult(r); setActivating(false); })
      .catch(e => { setError(e.message); setActivating(false); });
  }, []);

  if (activating) return (
    <div className="flex flex-col items-center py-12 gap-4">
      <div className="animate-spin w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full" />
      <p className="text-gray-600">Activating EMR tenant…</p>
    </div>
  );

  if (error) return (
    <div>
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm mb-4">{error}</div>
      <button onClick={onBack} className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm">← Back</button>
    </div>
  );

  return (
    <div>
      <div className="text-center py-6">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl">✓</span>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">EMR Tenant Activated!</h2>
        <p className="text-gray-500 text-sm">
          <strong>{result?.tenant_name}</strong> is now connected to HealthPoint.
        </p>
      </div>

      <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3 mb-6">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Tenant ID</span>
          <span className="font-mono text-gray-900 text-xs">{result?.tenant_id}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Vendor</span>
          <span className="text-gray-900">{data.vendor?.display_name}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Environment</span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${result?.environment === 'production' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
            {result?.environment}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">FHIR Base URL</span>
          <span className="font-mono text-xs text-gray-700 truncate max-w-[200px]">{result?.fhir_base_url}</span>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
        <strong>Next steps:</strong>
        <ul className="mt-1 space-y-1 list-disc list-inside text-xs">
          <li>Patients can now connect via SMART on FHIR at <code className="bg-blue-100 px-1 rounded">/emr/launch/{data.vendor?.key}?tenant_id={result?.tenant_id}</code></li>
          <li>Background sync will run every {data.syncFrequency || 24} hours</li>
          <li>Monitor sync status in the EMR Tenants dashboard</li>
        </ul>
      </div>

      <div className="flex justify-center mt-6">
        <a href="/emr/tenants" className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors">
          View All Tenants →
        </a>
      </div>
    </div>
  );
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

export default function EMROnboarding() {
  const [step, setStep] = useState(1);
  const [wizardData, setWizardData] = useState({});

  const next = (data) => {
    setWizardData(data);
    setStep(s => s + 1);
  };
  const back = () => setStep(s => s - 1);

  const stepComponents = {
    1: <StepVendorSelection onNext={next} />,
    2: <StepEnvironmentSetup data={wizardData} onNext={next} onBack={back} />,
    3: <StepCapabilityDiscovery data={wizardData} onNext={next} onBack={back} />,
    4: <StepCredentialEntry data={wizardData} onNext={next} onBack={back} />,
    5: <StepConnectionTest data={wizardData} onNext={next} onBack={back} />,
    6: <StepScopeConfiguration data={wizardData} onNext={next} onBack={back} />,
    7: <StepActivation data={wizardData} onBack={back} />,
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">EMR Onboarding</h1>
          <p className="text-gray-500 text-sm mt-1">
            Connect a new Electronic Medical Records system to HealthPoint
          </p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <StepIndicator currentStep={step} />
          {stepComponents[step]}
        </div>
      </div>
    </div>
  );
}
