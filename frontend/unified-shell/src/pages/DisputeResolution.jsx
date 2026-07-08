import React, { useState, useEffect } from 'react';
import { ShieldAlert, Scale, CheckCircle, Clock, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { authFetch } from '../auth/keycloak.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.healthpoint.gov';

const DisputeResolution = () => {
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalDisputes, setTotalDisputes] = useState(0);
  const [filterStatus, setFilterStatus] = useState('All');
  const [kpiData, setKpiData] = useState({
    openDisputes: 0,
    inIdrArbitration: 0,
    resolvedThisMonth: 0,
    avgResolutionDays: 0,
  });

  const disputesPerPage = 10;

  const fetchDisputes = async (page, status) => {
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch(`${API_BASE}/disputes?page=${page}&limit=${disputesPerPage}${status !== 'All' ? `&status=${status}` : ''}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setDisputes(data.disputes);
      setTotalPages(data.totalPages);
      setTotalDisputes(data.totalDisputes);

      // Calculate KPI data from fetched disputes (or fetch from a dedicated KPI endpoint if available)
      const open = data.disputes.filter(d => d.status === 'Open' || d.status === 'Negotiating').length;
      const idr = data.disputes.filter(d => d.status === 'IDR').length;
      const resolved = data.disputes.filter(d => d.status === 'Resolved' && new Date(d.resolvedDate).getMonth() === new Date().getMonth()).length; // Simplified for example
      const avgDays = data.disputes.length > 0 ? data.disputes.reduce((sum, d) => sum + (d.resolutionDays || 0), 0) / data.disputes.length : 0;

      setKpiData({
        openDisputes: open,
        inIdrArbitration: idr,
        resolvedThisMonth: resolved,
        avgResolutionDays: avgDays.toFixed(1),
      });

    } catch (e) {
      setError('Failed to fetch disputes: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDisputes(currentPage, filterStatus);
  }, [currentPage, filterStatus]);

  const handlePageChange = (newPage) => {
    if (newPage > 0 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleStatusFilterChange = (status) => {
    setFilterStatus(status);
    setCurrentPage(1); // Reset to first page on filter change
  };

  const initiateNegotiation = (disputeId) => {
    console.log(`Initiate negotiation for dispute ${disputeId}`);
    // Implement API call POST /disputes/{id}/negotiate
  };

  const initiateIDR = (disputeId) => {
    console.log(`Initiate IDR for dispute ${disputeId}`);
    // Implement API call POST /disputes/{id}/initiate-idr
  };

  const viewDetails = (disputeId) => {
    console.log(`View details for dispute ${disputeId}`);
    // Navigate to dispute details page or open a modal
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Open': return 'bg-blue-100 text-blue-800';
      case 'Negotiating': return 'bg-yellow-100 text-yellow-800';
      case 'IDR': return 'bg-purple-100 text-purple-800';
      case 'Resolved': return 'bg-green-100 text-green-800';
      case 'Closed': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const NSATimeline = ({ currentStep }) => {
    const totalSteps = 19;
    const steps = Array.from({ length: totalSteps }, (_, i) => i + 1);

    return (
      <div className="flex items-center justify-between w-full mt-4 mb-6">
        {steps.map((step) => (
          <div key={step} className="flex flex-col items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold
                ${step <= currentStep ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-600'}`}
            >
              {step}
            </div>
            {step < totalSteps && (
              <div
                className={`h-1 w-12 -mt-4 -mb-4
                  ${step < currentStep ? 'bg-indigo-600' : 'bg-gray-300'}`}
              ></div>
            )}
          </div>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="p-6 animate-pulse">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Dispute Resolution</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-4 rounded-lg shadow-md h-32"></div>
          <div className="bg-white p-4 rounded-lg shadow-md h-32"></div>
          <div className="bg-white p-4 rounded-lg shadow-md h-32"></div>
          <div className="bg-white p-4 rounded-lg shadow-md h-32"></div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-md">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-10 bg-gray-200 rounded mb-4"></div>
          <div className="h-10 bg-gray-200 rounded mb-4"></div>
          <div className="h-10 bg-gray-200 rounded mb-4"></div>
          <div className="h-10 bg-gray-200 rounded mb-4"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-red-600 bg-red-50 rounded-lg shadow-md">
        <h1 className="text-3xl font-bold mb-4">Error</h1>
        <p>{error}</p>
        <button
          onClick={() => fetchDisputes(currentPage, filterStatus)}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Dispute Resolution</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-md flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Open Disputes</p>
            <p className="text-3xl font-semibold text-gray-900">{kpiData.openDisputes}</p>
          </div>
          <ShieldAlert className="text-indigo-500 w-8 h-8" />
        </div>
        <div className="bg-white p-6 rounded-lg shadow-md flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">In IDR Arbitration</p>
            <p className="text-3xl font-semibold text-gray-900">{kpiData.inIdrArbitration}</p>
          </div>
          <Scale className="text-green-500 w-8 h-8" />
        </div>
        <div className="bg-white p-6 rounded-lg shadow-md flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Resolved This Month</p>
            <p className="text-3xl font-semibold text-gray-900">{kpiData.resolvedThisMonth}</p>
          </div>
          <CheckCircle className="text-teal-500 w-8 h-8" />
        </div>
        <div className="bg-white p-6 rounded-lg shadow-md flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Avg. Resolution Days</p>
            <p className="text-3xl font-semibold text-gray-900">{kpiData.avgResolutionDays}</p>
          </div>
          <Clock className="text-orange-500 w-8 h-8" />
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-md">
        {/* Status Filter Tabs */}
        <div className="mb-6 flex space-x-2 border-b border-gray-200 pb-4">
          {['All', 'Open', 'Negotiating', 'IDR', 'Resolved', 'Closed'].map((status) => (
            <button
              key={status}
              onClick={() => handleStatusFilterChange(status)}
              className={`px-4 py-2 text-sm font-medium rounded-md
                ${filterStatus === status
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-700 hover:bg-gray-100'}`}
            >
              {status}
            </button>
          ))}
        </div>

        {/* Dispute Table */}
        {disputes.length === 0 ? (
          <div className="text-center py-10 text-gray-500">
            <p className="text-lg font-medium">No disputes found for the selected criteria.</p>
            <p className="text-sm">Try adjusting your filters or adding a new dispute.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dispute ID</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Payer</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">QPA Amount</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Billed Amount</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Deadline</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {disputes.map((dispute) => {
                  const deadline = new Date(dispute.deadline);
                  const isOverdue = deadline < new Date();
                  return (
                    <tr key={dispute.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{dispute.id}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{dispute.provider}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{dispute.payer}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${dispute.qpaAmount?.toFixed(2)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${dispute.billedAmount?.toFixed(2)}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(dispute.status)}`}>
                          {dispute.status}
                        </span>
                      </td>
                      <td className={`px-6 py-4 whitespace-nowrap text-sm ${isOverdue ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                        {deadline.toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => initiateNegotiation(dispute.id)}
                            className="text-indigo-600 hover:text-indigo-900 text-sm"
                          >
                            Negotiate
                          </button>
                          <button
                            onClick={() => initiateIDR(dispute.id)}
                            className="text-blue-600 hover:text-blue-900 text-sm"
                          >
                            Initiate IDR
                          </button>
                          <button
                            onClick={() => viewDetails(dispute.id)}
                            className="text-gray-600 hover:text-gray-900 text-sm"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {disputes.length > 0 && (
          <div className="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3 sm:px-6 mt-4">
            <div className="flex flex-1 justify-between sm:hidden">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="relative inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Previous
              </button>
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="relative ml-3 inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
            <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  Showing <span className="font-medium">{(currentPage - 1) * disputesPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * disputesPerPage, totalDisputes)}</span> of{' '}
                  <span className="font-medium">{totalDisputes}</span> results
                </p>
              </div>
              <div>
                <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0"
                  >
                    <span className="sr-only">Previous</span>
                    <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      onClick={() => handlePageChange(page)}
                      aria-current={currentPage === page ? 'page' : undefined}
                      className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold
                        ${currentPage === page
                          ? 'z-10 bg-indigo-600 text-white focus:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600'
                          : 'text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0'}`}
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0"
                  >
                    <span className="sr-only">Next</span>
                    <ChevronRight className="h-5 w-5" aria-hidden="true" />
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}

        {/* NSA Timeline Indicator - Example, assuming dispute.currentNSAStep exists */}
        {disputes.length > 0 && (
          <div className="mt-8 pt-6 border-t border-gray-200">
            <h3 className="text-lg font-medium text-gray-900 mb-4">NSA Dispute Process Timeline (Current Dispute Example)</h3>
            {/* This timeline assumes we are showing the timeline for the first dispute in the list as an example. 
                In a real application, this would likely be for a selected dispute or on a detail page. */}
            <NSATimeline currentStep={disputes[0]?.currentNSAStep || 1} />
            <p className="text-sm text-gray-500 mt-2">Showing timeline for Dispute ID: {disputes[0]?.id || 'N/A'}.</p>
          </div>
        )}

      </div>
    </div>
  );
};

export default DisputeResolution;
