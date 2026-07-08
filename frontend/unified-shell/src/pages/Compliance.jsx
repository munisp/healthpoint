import React, { useEffect, useState } from 'react';
import { ShieldCheck, AlertTriangle, ListChecks, Percent, ChevronDown, Search, ToggleLeft, ToggleRight, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { authFetch } from '../auth/keycloak.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.healthpoint.gov';

const Compliance = () => {
  const [complianceRules, setComplianceRules] = useState([]);
  const [violations, setViolations] = useState([]);
  const [stateRequirements, setStateRequirements] = useState([]);
  const [kpiData, setKpiData] = useState({
    activeRules: 0,
    openViolations: 0,
    resolvedThisMonth: 0,
    complianceScore: 0,
  });
  const [loading, setLoading] = useState({
    rules: true,
    violations: true,
    requirements: false,
    kpis: true,
  });
  const [error, setError] = useState({
    rules: null,
    violations: null,
    requirements: null,
    kpis: null,
  });
  const [selectedState, setSelectedState] = useState('');

  // Fetch Compliance Rules and KPI data
  useEffect(() => {
    const fetchComplianceData = async () => {
      try {
        const rulesResponse = await authFetch(`${API_BASE}/compliance-rules`);
        if (!rulesResponse.ok) throw new Error(`HTTP error! status: ${rulesResponse.status}`);
        const rulesData = await rulesResponse.json();
        setComplianceRules(rulesData);

        const activeRulesCount = rulesData.filter(rule => rule.status === 'active').length;
        setKpiData(prev => ({ ...prev, activeRules: activeRulesCount }));

      } catch (e) {
        setError(prev => ({ ...prev, rules: e.message, kpis: e.message }));
      } finally {
        setLoading(prev => ({ ...prev, rules: false, kpis: false }));
      }
    };

    const fetchViolationsData = async () => {
      try {
        const violationsResponse = await authFetch(`${API_BASE}/compliance-violations`);
        if (!violationsResponse.ok) throw new Error(`HTTP error! status: ${violationsResponse.status}`);
        const violationsData = await violationsResponse.json();
        setViolations(violationsData);

        const openViolationsCount = violationsData.filter(v => v.resolutionStatus === 'open').length;
        const resolvedThisMonthCount = violationsData.filter(v => {
          const detectedDate = new Date(v.detectedDate);
          const now = new Date();
          return v.resolutionStatus === 'resolved' &&
                 detectedDate.getMonth() === now.getMonth() &&
                 detectedDate.getFullYear() === now.getFullYear();
        }).length;

        // Simple compliance score calculation (example)
        const totalRules = complianceRules.length;
        const compliantRules = complianceRules.filter(rule => rule.status === 'active' && !violations.some(v => v.rule === rule.ruleName && v.resolutionStatus === 'open')).length;
        const complianceScore = totalRules > 0 ? (compliantRules / totalRules * 100).toFixed(1) : 100;

        setKpiData(prev => ({
          ...prev,
          openViolations: openViolationsCount,
          resolvedThisMonth: resolvedThisMonthCount,
          complianceScore: parseFloat(complianceScore),
        }));

      } catch (e) {
        setError(prev => ({ ...prev, violations: e.message }));
      } finally {
        setLoading(prev => ({ ...prev, violations: false }));
      }
    };

    fetchComplianceData();
    fetchViolationsData();
  }, [complianceRules.length, violations.length]); // Re-run if rules/violations count changes for KPI calculation

  // Fetch State Requirements
  useEffect(() => {
    const fetchStateRequirements = async () => {
      if (!selectedState) {
        setStateRequirements([]);
        return;
      }
      setLoading(prev => ({ ...prev, requirements: true }));
      setError(prev => ({ ...prev, requirements: null }));
      try {
        const response = await authFetch(`${API_BASE}/compliance-requirements/${selectedState}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        setStateRequirements(data);
      } catch (e) {
        setError(prev => ({ ...prev, requirements: e.message }));
      } finally {
        setLoading(prev => ({ ...prev, requirements: false }));
      }
    };

    fetchStateRequirements();
  }, [selectedState]);

  const handleToggleRule = async (ruleId, currentStatus) => {
    // This would typically be a PUT or POST call to update the rule status
    // For now, we'll simulate a state update
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    setComplianceRules(prevRules =>
      prevRules.map(rule =>
        rule.id === ruleId ? { ...rule, status: newStatus } : rule
      )
    );
    // In a real app, you'd make an API call here:
    // try {
    //   await authFetch(`${API_BASE}/compliance-rules/${ruleId}/status`, {
    //     method: 'PUT',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ status: newStatus }),
    //   });
    // } catch (e) {
    //   console.error('Failed to update rule status:', e);
    //   // Revert UI state if API call fails
    //   setComplianceRules(prevRules =>
    //     prevRules.map(rule =>
    //       rule.id === ruleId ? { ...rule, status: currentStatus } : rule
    //     )
    //   );
    // }
  };

  const handleResolveViolation = async (violationId) => {
    // This would typically be a PUT or POST call to update the violation status
    // For now, we'll simulate a state update
    setViolations(prevViolations =>
      prevViolations.map(violation =>
        violation.id === violationId ? { ...violation, resolutionStatus: 'resolved' } : violation
      )
    );
    // In a real app, you'd make an API call here:
    // try {
    //   await authFetch(`${API_BASE}/compliance-violations/${violationId}/resolve`, {
    //     method: 'PUT',
    //   });
    // } catch (e) {
    //   console.error('Failed to resolve violation:', e);
    //   // Revert UI state if API call fails
    //   setViolations(prevViolations =>
    //     prevViolations.map(violation =>
    //       violation.id === violationId ? { ...violation, resolutionStatus: 'open' } : violation
    //     )
    //   );
    // }
  };

  const states = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
  ];

  const getSeverityBadge = (severity) => {
    let colorClass = '';
    switch (severity.toLowerCase()) {
      case 'critical':
        colorClass = 'bg-red-100 text-red-800';
        break;
      case 'high':
        colorClass = 'bg-orange-100 text-orange-800';
        break;
      case 'medium':
        colorClass = 'bg-yellow-100 text-yellow-800';
        break;
      case 'low':
        colorClass = 'bg-blue-100 text-blue-800';
        break;
      default:
        colorClass = 'bg-gray-100 text-gray-800';
    }
    return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>{severity}</span>;
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Compliance Monitoring</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white shadow rounded-lg p-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Active Rules</p>
            {loading.kpis ? (
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            ) : error.kpis ? (
              <p className="text-red-500 text-lg">Error</p>
            ) : (
              <p className="mt-1 text-3xl font-semibold text-gray-900">{kpiData.activeRules}</p>
            )}
          </div>
          <ShieldCheck className="h-10 w-10 text-indigo-400 opacity-75" />
        </div>

        <div className="bg-white shadow rounded-lg p-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Open Violations</p>
            {loading.kpis ? (
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            ) : error.kpis ? (
              <p className="text-red-500 text-lg">Error</p>
            ) : (
              <p className="mt-1 text-3xl font-semibold text-gray-900">{kpiData.openViolations}</p>
            )}
          </div>
          <AlertTriangle className="h-10 w-10 text-red-400 opacity-75" />
        </div>

        <div className="bg-white shadow rounded-lg p-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Resolved This Month</p>
            {loading.kpis ? (
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            ) : error.kpis ? (
              <p className="text-red-500 text-lg">Error</p>
            ) : (
              <p className="mt-1 text-3xl font-semibold text-gray-900">{kpiData.resolvedThisMonth}</p>
            )}
          </div>
          <ListChecks className="h-10 w-10 text-green-400 opacity-75" />
        </div>

        <div className="bg-white shadow rounded-lg p-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Compliance Score</p>
            {loading.kpis ? (
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            ) : error.kpis ? (
              <p className="text-red-500 text-lg">Error</p>
            ) : (
              <p className="mt-1 text-3xl font-semibold text-gray-900">{kpiData.complianceScore}%</p>
            )}
          </div>
          <Percent className="h-10 w-10 text-blue-400 opacity-75" />
        </div>
      </div>

      {/* Compliance Rules Table */}
      <div className="bg-white shadow rounded-lg mb-8">
        <div className="px-4 py-5 sm:p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Compliance Rules</h2>
          {loading.rules ? (
            <div className="flex justify-center items-center h-48">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
              <p className="ml-3 text-gray-600">Loading rules...</p>
            </div>
          ) : error.rules ? (
            <div className="text-center py-10 text-red-600">
              <p>Error loading compliance rules: {error.rules}</p>
            </div>
          ) : complianceRules.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              <p>No compliance rules found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rule Name</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Regulation</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Severity</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Checked</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Enable/Disable</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {complianceRules.map((rule) => (
                    <tr key={rule.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{rule.ruleName}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{rule.regulation}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{rule.category}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{getSeverityBadge(rule.severity)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${rule.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                          {rule.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(rule.lastChecked).toLocaleDateString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button
                          onClick={() => handleToggleRule(rule.id, rule.status)}
                          className={`relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ${rule.status === 'active' ? 'bg-indigo-600' : 'bg-gray-200'}`}
                          role="switch"
                          aria-checked={rule.status === 'active'}
                        >
                          <span
                            aria-hidden="true"
                            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200 ${rule.status === 'active' ? 'translate-x-5' : 'translate-x-0'}`}
                          ></span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Active Violations Table */}
      <div className="bg-white shadow rounded-lg mb-8">
        <div className="px-4 py-5 sm:p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Active Violations</h2>
          {loading.violations ? (
            <div className="flex justify-center items-center h-48">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
              <p className="ml-3 text-gray-600">Loading violations...</p>
            </div>
          ) : error.violations ? (
            <div className="text-center py-10 text-red-600">
              <p>Error loading active violations: {error.violations}</p>
            </div>
          ) : violations.filter(v => v.resolutionStatus === 'open').length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              <p>No active violations found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Violation ID</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rule</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Entity</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Severity</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Detected Date</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Resolution Status</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {violations.filter(v => v.resolutionStatus === 'open').map((violation) => (
                    <tr key={violation.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{violation.id}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{violation.rule}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{violation.entity}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{getSeverityBadge(violation.severity)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(violation.detectedDate).toLocaleDateString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${violation.resolutionStatus === 'open' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                          {violation.resolutionStatus}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        {violation.resolutionStatus === 'open' && (
                          <button
                            onClick={() => handleResolveViolation(violation.id)}
                            className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                          >
                            Resolve
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
      </div>

      {/* State Requirements Lookup */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">State Requirements Lookup</h2>
          <div className="mb-4">
            <label htmlFor="state-select" className="block text-sm font-medium text-gray-700">Select State</label>
            <select
              id="state-select"
              name="state-select"
              className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value)}
            >
              <option value="">-- Select a State --</option>
              {states.map(state => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>
          </div>

          {loading.requirements ? (
            <div className="flex justify-center items-center h-32">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
              <p className="ml-3 text-gray-600">Loading requirements...</p>
            </div>
          ) : error.requirements ? (
            <div className="text-center py-10 text-red-600">
              <p>Error loading state requirements: {error.requirements}</p>
            </div>
          ) : selectedState && stateRequirements.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              <p>No requirements found for {selectedState}.</p>
            </div>
          ) : selectedState && stateRequirements.length > 0 ? (
            <div className="border border-gray-200 rounded-md p-4 mt-4">
              <h3 className="text-lg font-medium text-gray-900 mb-2">Requirements for {selectedState}</h3>
              <ul className="list-disc pl-5 space-y-1 text-gray-700">
                {stateRequirements.map((req, index) => (
                  <li key={index}>{req.description}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="text-center py-10 text-gray-500">
              <p>Select a state to view its compliance requirements.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Compliance;
