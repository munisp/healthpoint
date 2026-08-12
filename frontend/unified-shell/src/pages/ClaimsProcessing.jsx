import React, { useState, useEffect, useCallback } from 'react';
import { ArrowRight, Search, Plus, Loader2, AlertCircle, CheckCircle, XCircle, Clock, Info } from 'lucide-react';
import { authFetch } from '../auth/keycloak.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.healthpoint.gov';

const ClaimsProcessing = () => {
  const [claims, setClaims] = useState([]);
  const [stats, setStats] = useState({
    totalClaims: 0,
    approvedCount: 0,
    deniedCount: 0,
    pendingReview: 0,
    averageProcessingTime: '0 days',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showNewClaimForm, setShowNewClaimForm] = useState(false);
  const [newClaimData, setNewClaimData] = useState({
    patientName: '',
    providerNPI: '',
    serviceDate: '',
    cptCodes: '',
    billedAmount: '',
  });
  const [submittingNewClaim, setSubmittingNewClaim] = useState(false);
  const [newClaimError, setNewClaimError] = useState(null);

  const fetchClaims = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let url = `${API_BASE}/api/v1/claims?page=${currentPage}&limit=10`;
      if (activeTab !== 'All') {
        url += `&status=${activeTab.replace(' ', '%20')}`;
      }
      if (searchTerm) {
        url += `&search=${searchTerm}`;
      }
      const response = await authFetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setClaims(data.claims);
      setTotalPages(data.totalPages);
    } catch (err) {
      console.error('Failed to fetch claims:', err);
      setError('Failed to load claims. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, searchTerm, currentPage]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await authFetch(`${API_BASE}/claims/stats`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
      // Optionally set a separate error for stats if needed
    }
  }, []);

  useEffect(() => {
    fetchClaims();
    fetchStats();
  }, [fetchClaims, fetchStats]);

  const handleNewClaimChange = (e) => {
    const { name, value } = e.target;
    setNewClaimData((prev) => ({ ...prev, [name]: value }));
  };

  const handleNewClaimSubmit = async (e) => {
    e.preventDefault();
    setSubmittingNewClaim(true);
    setNewClaimError(null);
    try {
      const response = await authFetch(`${API_BASE}/api/v1/claims`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newClaimData),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }
      // Optionally refresh claims or add the new claim to the list
      fetchClaims();
      setShowNewClaimForm(false);
      setNewClaimData({
        patientName: '',
        providerNPI: '',
        serviceDate: '',
        cptCodes: '',
        billedAmount: '',
      });
    } catch (err) {
      console.error('Failed to submit new claim:', err);
      setNewClaimError(err.message || 'Failed to submit new claim.');
    } finally {
      setSubmittingNewClaim(false);
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'Approved':
        return 'bg-green-100 text-green-800';
      case 'Denied':
        return 'bg-red-100 text-red-800';
      case 'Pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'Under Review':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const navigateToClaimDetails = (claimId) => {
    // In a real application, you'd use a router like react-router-dom
    // For this example, we'll just log it or simulate navigation
    console.log(`Navigating to /claims/${claimId}`);
    window.location.href = `/claims/${claimId}`;
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Claims Management</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <div className="bg-white p-5 rounded-lg shadow flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Total Claims</p>
            <p className="text-2xl font-semibold text-gray-900">{stats.totalClaims}</p>
          </div>
          <Info className="text-blue-500" size={24} />
        </div>
        <div className="bg-white p-5 rounded-lg shadow flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Approved</p>
            <p className="text-2xl font-semibold text-gray-900">{stats.approvedCount}</p>
          </div>
          <CheckCircle className="text-green-500" size={24} />
        </div>
        <div className="bg-white p-5 rounded-lg shadow flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Denied</p>
            <p className="text-2xl font-semibold text-gray-900">{stats.deniedCount}</p>
          </div>
          <XCircle className="text-red-500" size={24} />
        </div>
        <div className="bg-white p-5 rounded-lg shadow flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Pending Review</p>
            <p className="text-2xl font-semibold text-gray-900">{stats.pendingReview}</p>
          </div>
          <Clock className="text-yellow-500" size={24} />
        </div>
        <div className="bg-white p-5 rounded-lg shadow flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Avg. Processing Time</p>
            <p className="text-2xl font-semibold text-gray-900">{stats.averageProcessingTime}</p>
          </div>
          <Loader2 className="text-purple-500" size={24} />
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg shadow mb-8">
        {/* Header with Search and New Claim Button */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-6 space-y-4 md:space-y-0">
          <div className="flex items-center w-full md:w-1/3 relative">
            <Search className="absolute left-3 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Search by Claim ID or Patient Name..."
              className="pl-10 p-2 border border-gray-300 rounded-lg w-full focus:ring-blue-500 focus:border-blue-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            onClick={() => setShowNewClaimForm(!showNewClaimForm)}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <Plus size={20} className="mr-2" />
            New Claim
          </button>
        </div>

        {/* New Claim Inline Form */}
        {showNewClaimForm && (
          <div className="mb-6 p-4 border border-blue-200 bg-blue-50 rounded-lg">
            <h3 className="text-xl font-semibold text-blue-800 mb-4">Submit New Claim</h3>
            <form onSubmit={handleNewClaimSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="patientName" className="block text-sm font-medium text-gray-700">Patient Name</label>
                <input
                  type="text"
                  name="patientName"
                  id="patientName"
                  value={newClaimData.patientName}
                  onChange={handleNewClaimChange}
                  className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label htmlFor="providerNPI" className="block text-sm font-medium text-gray-700">Provider NPI</label>
                <input
                  type="text"
                  name="providerNPI"
                  id="providerNPI"
                  value={newClaimData.providerNPI}
                  onChange={handleNewClaimChange}
                  className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label htmlFor="serviceDate" className="block text-sm font-medium text-gray-700">Service Date</label>
                <input
                  type="date"
                  name="serviceDate"
                  id="serviceDate"
                  value={newClaimData.serviceDate}
                  onChange={handleNewClaimChange}
                  className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label htmlFor="cptCodes" className="block text-sm font-medium text-gray-700">CPT Codes (comma-separated)</label>
                <input
                  type="text"
                  name="cptCodes"
                  id="cptCodes"
                  value={newClaimData.cptCodes}
                  onChange={handleNewClaimChange}
                  className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label htmlFor="billedAmount" className="block text-sm font-medium text-gray-700">Billed Amount</label>
                <input
                  type="number"
                  name="billedAmount"
                  id="billedAmount"
                  value={newClaimData.billedAmount}
                  onChange={handleNewClaimChange}
                  className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  step="0.01"
                  required
                />
              </div>
              <div className="md:col-span-2 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowNewClaimForm(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  disabled={submittingNewClaim}
                >
                  {submittingNewClaim ? <Loader2 className="animate-spin mr-2" size={20} /> : null} Submit Claim
                </button>
              </div>
            </form>
            {newClaimError && (
              <div className="mt-4 text-red-600 text-sm flex items-center">
                <AlertCircle size={16} className="mr-2" /> {newClaimError}
              </div>
            )}
          </div>
        )}

        {/* Status Filter Tabs */}
        <div className="flex border-b border-gray-200 mb-6">
          {['All', 'Pending', 'Approved', 'Denied', 'Under Review'].map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                setCurrentPage(1);
              }}
              className={`py-2 px-4 text-sm font-medium ${activeTab === tab
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Loading, Error, Empty States */}
        {loading && (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="animate-spin text-blue-500" size={48} />
            <p className="ml-3 text-gray-600">Loading claims...</p>
          </div>
        )}

        {error && (
          <div className="flex justify-center items-center h-64 text-red-600">
            <AlertCircle className="mr-2" size={24} />
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && claims.length === 0 && (
          <div className="flex flex-col justify-center items-center h-64 text-gray-500">
            <Info className="mb-4" size={48} />
            <p className="text-lg">No claims found for the current filter.</p>
            <p className="text-sm">Try adjusting your search or filters.</p>
          </div>
        )}

        {/* Claims Table */}
        {!loading && !error && claims.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Claim ID</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Patient Name</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider NPI</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Service Date</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">CPT Codes</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Billed Amount</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Allowed Amount</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {claims.map((claim) => (
                  <tr key={claim.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigateToClaimDetails(claim.id)}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{claim.id}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{claim.patientName}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{claim.providerNPI}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(claim.serviceDate).toLocaleDateString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{claim.cptCodes}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${claim.billedAmount?.toFixed(2)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${claim.allowedAmount?.toFixed(2) || 'N/A'}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadgeClass(claim.status)}`}>
                        {claim.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <button
                        onClick={(e) => {
                          e.stopPropagation(); // Prevent row click from triggering
                          navigateToClaimDetails(claim.id);
                        }}
                        className="text-blue-600 hover:text-blue-900 flex items-center"
                      >
                        View <ArrowRight size={16} className="ml-1" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && !error && claims.length > 0 && totalPages > 1 && (
          <nav
            className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6"
            aria-label="Pagination"
          >
            <div className="flex-1 flex justify-between sm:justify-end">
              <button
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Next
              </button>
            </div>
            <div className="hidden sm:block">
              <p className="text-sm text-gray-700">
                Page <span className="font-medium">{currentPage}</span> of <span className="font-medium">{totalPages}</span>
              </p>
            </div>
          </nav>
        )}
      </div>
    </div>
  );
};

export default ClaimsProcessing;
