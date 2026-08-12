import React, { useState, useEffect } from 'react';
import { authFetch } from '../auth/keycloak.js';
import { Ambulance, DollarSign, Scale, ShieldCheck, Filter, Eye, Edit, Trash2 } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.healthpoint.gov';

const EmergencyServices = () => {
  const [claims, setClaims] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nsaFilter, setNsaFilter] = useState('All'); // 'All', 'Protected', 'Exempt', 'Disputed'

  useEffect(() => {
    const fetchEmergencyData = async () => {
      setLoading(true);
      setError(null);
      try {
        const claimsResponse = await authFetch(`${API_BASE}/api/v1/claims?type=emergency`);
        if (!claimsResponse.ok) {
          throw new Error(`HTTP error! status: ${claimsResponse.status}`);
        }
        const claimsData = await claimsResponse.json();
        setClaims(claimsData);

        // Assuming /claims/stats can be filtered by type=emergency or we calculate from claimsData
        const statsResponse = await authFetch(`${API_BASE}/claims/stats?type=emergency`);
        if (!statsResponse.ok) {
          throw new Error(`HTTP error! status: ${statsResponse.status}`);
        }
        const statsData = await statsResponse.json();
        setStats(statsData);

      } catch (err) {
        console.error('Failed to fetch emergency services data:', err);
        setError('Failed to load emergency services data. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchEmergencyData();
  }, []);

  const filteredClaims = claims.filter(claim => {
    if (nsaFilter === 'All') return true;
    return claim.nsaProtectionStatus === nsaFilter;
  });

  // Calculate KPIs if stats API doesn't provide them directly or needs aggregation
  const emergencyClaimsThisMonth = stats.emergencyClaimsThisMonth || 0; // Assuming API provides this
  const balanceBillingDisputes = stats.balanceBillingDisputes || 0; // Assuming API provides this

  const totalBilledAmount = claims.reduce((sum, claim) => sum + (claim.billedAmount || 0), 0);
  const totalAllowedAmount = claims.reduce((sum, claim) => sum + (claim.allowedAmount || 0), 0);
  const avgEmergencyBilledAmount = claims.length > 0 ? (totalBilledAmount / claims.length).toFixed(2) : '0.00';
  const avgAllowedAmount = claims.length > 0 ? (totalAllowedAmount / claims.length).toFixed(2) : '0.00';

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-lg font-semibold text-gray-700">Loading emergency claims data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-red-600 text-lg font-semibold">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold text-gray-800 mb-8">Emergency Services Claims</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-md flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Claims This Month</p>
            <p className="text-2xl font-semibold text-gray-900">{emergencyClaimsThisMonth}</p>
          </div>
          <Ambulance className="text-blue-500" size={32} />
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Balance Billing Disputes</p>
            <p className="text-2xl font-semibold text-gray-900">{balanceBillingDisputes}</p>
          </div>
          <Scale className="text-yellow-500" size={32} />
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Avg Billed Amount</p>
            <p className="text-2xl font-semibold text-gray-900">${avgEmergencyBilledAmount}</p>
          </div>
          <DollarSign className="text-green-500" size={32} />
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Avg Allowed Amount</p>
            <p className="text-2xl font-semibold text-gray-900">${avgAllowedAmount}</p>
          </div>
          <ShieldCheck className="text-purple-500" size={32} />
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center space-x-4 mb-6">
        <Filter className="text-gray-600" size={20} />
        <label htmlFor="nsaFilter" className="text-gray-700 font-medium">NSA Protection Status:</label>
        <select
          id="nsaFilter"
          className="mt-1 block w-48 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
          value={nsaFilter}
          onChange={(e) => setNsaFilter(e.target.value)}
        >
          <option value="All">All</option>
          <option value="Protected">Protected</option>
          <option value="Exempt">Exempt</option>
          <option value="Disputed">Disputed</option>
        </select>
      </div>

      {/* Claims Table */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        {filteredClaims.length === 0 ? (
          <div className="p-6 text-center text-gray-600">
            No emergency claims found {nsaFilter !== 'All' && `for status '${nsaFilter}'`}.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Claim ID</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Patient</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Facility</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Emergency Type</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Billed Amount</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Allowed Amount</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Patient Responsibility</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Balance Billing Amount</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">NSA Protection Status</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredClaims.map((claim) => (
                <tr key={claim.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{claim.claimId}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{claim.patientName}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{claim.facility}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{claim.emergencyType}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${(claim.billedAmount || 0).toFixed(2)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${(claim.allowedAmount || 0).toFixed(2)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${(claim.patientResponsibility || 0).toFixed(2)}</td>
                  <td className={`px-6 py-4 whitespace-nowrap text-sm ${claim.balanceBillingAmount > 0 ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                    ${(claim.balanceBillingAmount || 0).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full
                      ${claim.nsaProtectionStatus === 'Protected' ? 'bg-green-100 text-green-800' :
                        claim.nsaProtectionStatus === 'Exempt' ? 'bg-blue-100 text-blue-800' :
                        'bg-yellow-100 text-yellow-800'}`}>
                      {claim.nsaProtectionStatus}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button className="text-blue-600 hover:text-blue-900 mr-3"><Eye size={18} /></button>
                    <button className="text-indigo-600 hover:text-indigo-900 mr-3"><Edit size={18} /></button>
                    <button className="text-red-600 hover:text-red-900"><Trash2 size={18} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default EmergencyServices;
