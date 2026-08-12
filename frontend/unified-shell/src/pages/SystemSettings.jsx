import React, { useState, useEffect } from 'react';
import { Gauge, TrendingUp, AlertTriangle, Settings, Server, CheckCircle, XCircle, Save, Edit } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.healthpoint.gov';
import { authFetch } from '../auth/keycloak.js';

const SystemSettings = () => {
  const [gatewayStats, setGatewayStats] = useState(null);
  const [adminSettings, setAdminSettings] = useState([]);
  const [serviceHealth, setServiceHealth] = useState([]);
  const [rateLimitConfig, setRateLimitConfig] = useState(null);

  const [loadingGatewayStats, setLoadingGatewayStats] = useState(true);
  const [errorGatewayStats, setErrorGatewayStats] = useState(null);

  const [loadingAdminSettings, setLoadingAdminSettings] = useState(true);
  const [errorAdminSettings, setErrorAdminSettings] = useState(null);
  const [editingSetting, setEditingSetting] = useState(null);
  const [editedValue, setEditedValue] = useState('');

  // Fetch Gateway Stats
  useEffect(() => {
    const fetchGatewayStats = async () => {
      try {
        setLoadingGatewayStats(true);
        const response = await authFetch(`${API_BASE}/gateway/stats`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setGatewayStats(data);

        // Infer service health from gateway stats if available, otherwise mock for now
        // In a real scenario, there would likely be a dedicated /health or /microservices API
        if (data && data.microservices) {
          setServiceHealth(Object.entries(data.microservices).map(([name, status]) => ({
            name,
            status: status.healthy ? 'healthy' : 'unhealthy',
          })));
        } else {
          // Placeholder if gateway stats don't provide microservice health directly
          setServiceHealth([
            { name: 'Claims Service', status: 'healthy' },
            { name: 'Payments Service', status: 'unhealthy' },
            { name: 'Users Service', status: 'healthy' },
          ]);
        }

      } catch (error) {
        console.error("Failed to fetch gateway stats:", error);
        setErrorGatewayStats(error);
      } finally {
        setLoadingGatewayStats(false);
      }
    };
    fetchGatewayStats();
  }, []);

  // Fetch Admin Settings
  useEffect(() => {
    const fetchAdminSettings = async () => {
      try {
        setLoadingAdminSettings(true);
        const response = await authFetch(`${API_BASE}/admin/settings`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setAdminSettings(data);

        // Infer rate limit configuration from admin settings if available
        const rateLimitSetting = data.find(s => s.key === 'RATE_LIMIT_CONFIG');
        if (rateLimitSetting) {
          try {
            setRateLimitConfig(JSON.parse(rateLimitSetting.value));
          } catch (parseError) {
            console.warn("Failed to parse RATE_LIMIT_CONFIG from admin settings:", parseError);
            setRateLimitConfig({ error: 'Invalid JSON format' });
          }
        }

      } catch (error) {
        console.error("Failed to fetch admin settings:", error);
        setErrorAdminSettings(error);
      } finally {
        setLoadingAdminSettings(false);
      }
    };
    fetchAdminSettings();
  }, []);

  const handleSaveSetting = async (key) => {
    try {
      const response = await authFetch(`${API_BASE}/admin/settings/${key}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: editedValue }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      // Update the local state with the new value
      setAdminSettings(prevSettings =>
        prevSettings.map(setting =>
          setting.key === key ? { ...setting, value: editedValue, lastUpdated: new Date().toISOString() } : setting
        )
      );
      setEditingSetting(null);
      setEditedValue('');
    } catch (error) {
      console.error(`Failed to update setting ${key}:`, error);
      alert(`Failed to update setting ${key}: ${error.message}`);
    }
  };

  const renderLoading = () => (
    <div className="flex items-center justify-center p-4 text-gray-500">
      <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      Loading...
    </div>
  );

  const renderError = (error) => (
    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
      <strong className="font-bold">Error!</strong>
      <span className="block sm:inline"> {error?.message || 'An unknown error occurred.'}</span>
    </div>
  );

  const renderEmptyState = (message) => (
    <div className="text-center text-gray-500 p-4">
      <p>{message}</p>
    </div>
  );

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">System Settings</h1>

      {/* Gateway Stats Card */}
      <div className="bg-white shadow-md rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4 flex items-center">
          <Gauge className="mr-2 text-blue-600" /> Gateway Statistics
        </h2>
        {loadingGatewayStats && renderLoading()}
        {errorGatewayStats && renderError(errorGatewayStats)}
        {!loadingGatewayStats && !errorGatewayStats && !gatewayStats && renderEmptyState("No gateway statistics available.")}
        {!loadingGatewayStats && !errorGatewayStats && gatewayStats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-blue-50 p-4 rounded-md flex items-center justify-between">
              <div>
                <p className="text-sm text-blue-700">Request Volume</p>
                <p className="text-2xl font-bold text-blue-900">{gatewayStats.requestVolume?.toLocaleString() || 'N/A'}</p>
              </div>
              <TrendingUp className="text-blue-600" size={36} />
            </div>
            <div className="bg-red-50 p-4 rounded-md flex items-center justify-between">
              <div>
                <p className="text-sm text-red-700">Error Rate</p>
                <p className="text-2xl font-bold text-red-900">{gatewayStats.errorRate !== undefined ? `${(gatewayStats.errorRate * 100).toFixed(2)}%` : 'N/A'}</p>
              </div>
              <AlertTriangle className="text-red-600" size={36} />
            </div>
            <div className="bg-green-50 p-4 rounded-md flex items-center justify-between">
              <div>
                <p className="text-sm text-green-700">Avg Latency</p>
                <p className="text-2xl font-bold text-green-900">{gatewayStats.avgLatency !== undefined ? `${gatewayStats.avgLatency.toFixed(2)}ms` : 'N/A'}</p>
              </div>
              <Gauge className="text-green-600" size={36} />
            </div>
          </div>
        )}
      </div>

      {/* Admin Settings Table */}
      <div className="bg-white shadow-md rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4 flex items-center">
          <Settings className="mr-2 text-purple-600" /> Admin Settings
        </h2>
        {loadingAdminSettings && renderLoading()}
        {errorAdminSettings && renderError(errorAdminSettings)}
        {!loadingAdminSettings && !errorAdminSettings && adminSettings.length === 0 && renderEmptyState("No admin settings available.")}
        {!loadingAdminSettings && !errorAdminSettings && adminSettings.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Setting Key</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Updated</th>
                  <th scope="col" className="relative px-6 py-3"><span className="sr-only">Edit</span></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {adminSettings.map((setting) => (
                  <tr key={setting.key}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{setting.key}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {editingSetting === setting.key ? (
                        <input
                          type="text"
                          value={editedValue}
                          onChange={(e) => setEditedValue(e.target.value)}
                          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
                        />
                      ) : (
                        setting.value
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{setting.description}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{setting.lastUpdated ? new Date(setting.lastUpdated).toLocaleString() : 'N/A'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      {editingSetting === setting.key ? (
                        <button
                          onClick={() => handleSaveSetting(setting.key)}
                          className="text-indigo-600 hover:text-indigo-900 mr-2 flex items-center"
                        >
                          <Save className="h-4 w-4 mr-1" /> Save
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingSetting(setting.key);
                            setEditedValue(setting.value);
                          }}
                          className="text-blue-600 hover:text-blue-900 flex items-center"
                        >
                          <Edit className="h-4 w-4 mr-1" /> Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Service Health Grid */}
      <div className="bg-white shadow-md rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4 flex items-center">
          <Server className="mr-2 text-teal-600" /> Service Health
        </h2>
        {loadingGatewayStats && renderLoading()} {/* Re-using gateway stats loading for service health */}
        {errorGatewayStats && renderError(errorGatewayStats)} {/* Re-using gateway stats error for service health */}
        {!loadingGatewayStats && !errorGatewayStats && serviceHealth.length === 0 && renderEmptyState("No service health data available.")}
        {!loadingGatewayStats && !errorGatewayStats && serviceHealth.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {serviceHealth.map((service) => (
              <div key={service.name} className="bg-gray-50 p-4 rounded-md flex items-center justify-between">
                <p className="text-lg font-medium text-gray-800">{service.name}</p>
                {service.status === 'healthy' ? (
                  <span className="flex items-center text-green-600">
                    <CheckCircle className="h-5 w-5 mr-1" /> Healthy
                  </span>
                ) : (
                  <span className="flex items-center text-red-600">
                    <XCircle className="h-5 w-5 mr-1" /> Unhealthy
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rate Limit Configuration */}
      <div className="bg-white shadow-md rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4 flex items-center">
          <AlertTriangle className="mr-2 text-orange-600" /> Rate Limit Configuration
        </h2>
        {loadingAdminSettings && renderLoading()} {/* Re-using admin settings loading for rate limits */}
        {errorAdminSettings && renderError(errorAdminSettings)} {/* Re-using admin settings error for rate limits */}
        {!loadingAdminSettings && !errorAdminSettings && !rateLimitConfig && renderEmptyState("No rate limit configuration available.")}
        {!loadingAdminSettings && !errorAdminSettings && rateLimitConfig && (
          <div className="bg-orange-50 p-4 rounded-md">
            <pre className="text-sm text-orange-900 overflow-auto">{JSON.stringify(rateLimitConfig, null, 2)}</pre>
            {rateLimitConfig.error && <p className="text-red-600 mt-2">Error: {rateLimitConfig.error}</p>}
          </div>
        )}
      </div>
    </div>
  );
};

export default SystemSettings;
