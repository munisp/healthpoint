import React, { useState, useEffect, useCallback } from 'react';
import { Search, Calendar, ChevronDown, FileText, Download, AlertCircle, Loader, User, Filter, ArrowRight } from 'lucide-react';
import { authFetch } from '../auth/keycloak.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.healthpoint.gov';

const AuditLog = () => {
  const [auditLogs, setAuditLogs] = useState([]);
  const [complianceReports, setComplianceReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalEventsToday, setTotalEventsToday] = useState(0);
  const [failedAuthAttempts, setFailedAuthAttempts] = useState(0);
  const [adminActions, setAdminActions] = useState(0);
  const [dataExports, setDataExports] = useState(0);
  const [filters, setFilters] = useState({
    event_type: '',
    user_id: '',
    start_date: '',
    end_date: '',
  });
  const [expandedRow, setExpandedRow] = useState(null);
  const [eventTypes, setEventTypes] = useState([]); // To populate event_type dropdown

  const ITEMS_PER_PAGE = 10;

  const fetchAuditLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: ITEMS_PER_PAGE,
        offset: (currentPage - 1) * ITEMS_PER_PAGE,
        ...(filters.event_type && { event_type: filters.event_type }),
        ...(filters.user_id && { user_id: filters.user_id }),
        ...(filters.start_date && { start_date: filters.start_date }),
        ...(filters.end_date && { end_date: filters.end_date }),
      });
      const response = await authFetch(`${API_BASE}/api/v1/audit-logs?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setAuditLogs(data.logs);
      setTotalPages(Math.ceil(data.total / ITEMS_PER_PAGE));

      // Assuming KPI data comes from a separate endpoint or is aggregated from audit logs
      // If not, a separate API call would be needed for KPIs.
      setTotalEventsToday(data.kpis?.totalEventsToday || 0);
      setFailedAuthAttempts(data.kpis?.failedAuthAttempts || 0);
      setAdminActions(data.kpis?.adminActions || 0);
      setDataExports(data.kpis?.dataExports || 0);

    } catch (e) {
      setError('Failed to fetch audit logs: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [currentPage, filters]);

  const fetchComplianceReports = useCallback(async () => {
    try {
      const response = await authFetch(`${API_BASE}/audit-reports`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setComplianceReports(data.reports);
    } catch (e) {
      console.error('Failed to fetch compliance reports:', e);
    }
  }, []);

  // Fetch initial data and when filters/page change
  useEffect(() => {
    fetchAuditLogs();
    fetchComplianceReports();
  }, [fetchAuditLogs, fetchComplianceReports]);

  const fetchEventTypes = useCallback(async () => {
    try {
      // Assuming an endpoint to get distinct event types for the filter dropdown
      const response = await authFetch(`${API_BASE}/audit-events`); // Using /audit-events as a placeholder
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setEventTypes(data.eventTypes || []);
    } catch (e) {
      console.error("Failed to fetch event types:", e);
    }
  }, []);

  useEffect(() => {
    fetchEventTypes();
  }, [fetchEventTypes]);

  // Handle filter changes
  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
    setCurrentPage(1); // Reset to first page on filter change
  };

  const handleDateChange = (type, date) => {
    setFilters(prev => ({ ...prev, [type]: date }));
    setCurrentPage(1);
  };

  const handlePageChange = (newPage) => {
    if (newPage > 0 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleRowClick = (logId) => {
    setExpandedRow(expandedRow === logId ? null : logId);
  };

  const handleExportCSV = async () => {
    try {
      const params = new URLSearchParams({
        ...(filters.event_type && { event_type: filters.event_type }),
        ...(filters.user_id && { user_id: filters.user_id }),
        ...(filters.start_date && { start_date: filters.start_date }),
        ...(filters.end_date && { end_date: filters.end_date }),
        limit: 10000, // A large limit for export
      });
      const response = await authFetch(`${API_BASE}/api/v1/audit-logs/export?${params.toString()}`); // Assuming an export endpoint
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `audit_logs_${new Date().toISOString()}.csv`);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
    } catch (e) {
      alert('Failed to export audit logs: ' + e.message);
    }
  };

  if (loading && auditLogs.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader className="animate-spin text-blue-500" size={48} />
        <p className="ml-4 text-lg text-gray-700">Loading audit logs...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen text-red-600">
        <AlertCircle className="mr-2" size={24} />
        <p className="text-lg">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Audit Log Viewer</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg shadow flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">Total Events Today</p>
            <p className="text-2xl font-semibold text-gray-900">{totalEventsToday}</p>
          </div>
          <FileText className="text-blue-500" size={24} />
        </div>
        <div className="bg-white p-4 rounded-lg shadow flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">Failed Auth Attempts</p>
            <p className="text-2xl font-semibold text-gray-900">{failedAuthAttempts}</p>
          </div>
          <AlertCircle className="text-red-500" size={24} />
        </div>
        <div className="bg-white p-4 rounded-lg shadow flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">Admin Actions</p>
            <p className="text-2xl font-semibold text-gray-900">{adminActions}</p>
          </div>
          <User className="text-green-500" size={24} />
        </div>
        <div className="bg-white p-4 rounded-lg shadow flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">Data Exports</p>
            <p className="text-2xl font-semibold text-gray-900">{dataExports}</p>
          </div>
          <Download className="text-purple-500" size={24} />
        </div>
      </div>

      {/* Filters and Export */}
      <div className="bg-white p-4 rounded-lg shadow mb-6 flex flex-wrap items-end gap-4">
        <div className="flex-grow">
          <label htmlFor="event_type" className="block text-sm font-medium text-gray-700">Event Type</label>
          <select
            id="event_type"
            name="event_type"
            value={filters.event_type}
            onChange={handleFilterChange}
            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
          >
            <option value="">All Event Types</option>
            {eventTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
        <div className="flex-grow">
          <label htmlFor="user_id" className="block text-sm font-medium text-gray-700">User ID</label>
          <div className="mt-1 relative rounded-md shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" aria-hidden="true" />
            </div>
            <input
              type="text"
              name="user_id"
              id="user_id"
              value={filters.user_id}
              onChange={handleFilterChange}
              className="focus:ring-blue-500 focus:border-blue-500 block w-full pl-10 sm:text-sm border-gray-300 rounded-md"
              placeholder="Search by User ID"
            />
          </div>
        </div>
        <div className="flex-grow">
          <label htmlFor="start_date" className="block text-sm font-medium text-gray-700">Start Date</label>
          <input
            type="date"
            name="start_date"
            id="start_date"
            value={filters.start_date}
            onChange={handleDateChange.bind(null, 'start_date')}
            className="mt-1 focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md"
          />
        </div>
        <div className="flex-grow">
          <label htmlFor="end_date" className="block text-sm font-medium text-gray-700">End Date</label>
          <input
            type="date"
            name="end_date"
            id="end_date"
            value={filters.end_date}
            onChange={handleDateChange.bind(null, 'end_date')}
            className="mt-1 focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md"
          />
        </div>
        <button
          onClick={handleExportCSV}
          className="ml-auto px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 flex items-center"
        >
          <Download className="mr-2 h-4 w-4" />
          Export to CSV
        </button>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg mb-6">
        {auditLogs.length === 0 && !loading ? (
          <div className="p-6 text-center text-gray-500">
            <FileText className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No audit logs found</h3>
            <p className="mt-1 text-sm text-gray-500">Adjust your filters or try again later.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Event Type</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Entity Type</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Entity ID</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User ID</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP Address</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created At</th>
                  <th scope="col" className="relative px-6 py-3"><span className="sr-only">Expand</span></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {auditLogs.map((log) => (
                  <React.Fragment key={log.id}>
                    <tr
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => handleRowClick(log.id)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{log.event_type}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{log.entity_type}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{log.entity_id}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{log.user_id}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${log.action === 'CREATE' ? 'bg-green-100 text-green-800' : log.action === 'UPDATE' ? 'bg-blue-100 text-blue-800' : log.action === 'DELETE' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{log.ip_address}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(log.created_at).toLocaleString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <ChevronDown
                          className={`h-5 w-5 text-gray-500 transform ${expandedRow === log.id ? 'rotate-180' : ''}`}
                        />
                      </td>
                    </tr>
                    {expandedRow === log.id && (
                      <tr>
                        <td colSpan="8" className="px-6 py-4 bg-gray-50 text-sm text-gray-700">
                          <pre className="whitespace-pre-wrap text-xs bg-gray-100 p-4 rounded-md">{JSON.stringify(log.payload, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <nav
            className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6"
            aria-label="Pagination"
          >
            <div className="flex-1 flex justify-between sm:justify-end">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  Showing <span className="font-medium">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> to <span className="font-medium">{Math.min(currentPage * ITEMS_PER_PAGE, totalPages * ITEMS_PER_PAGE)}</span> of{' '}
                  <span className="font-medium">{totalPages * ITEMS_PER_PAGE}</span> results
                </p>
              </div>
            </div>
          </nav>
        )}
      </div>

      {/* Compliance Reports Section */}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Compliance Audit Reports</h2>
        {complianceReports.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
            <FileText className="mx-auto h-10 w-10 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No compliance reports available</h3>
            <p className="mt-1 text-sm text-gray-500">Check back later for new reports.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {complianceReports.map(report => (
              <li key={report.id} className="py-4 flex items-center justify-between">
                <div>
                  <p className="text-lg font-medium text-gray-900">{report.title}</p>
                  <p className="text-sm text-gray-500">Generated on: {new Date(report.generated_at).toLocaleDateString()}</p>
                </div>
                <a
                  href={report.url} // Assuming report object has a URL for download/view
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  View Report
                  <ArrowRight className="ml-2 -mr-0.5 h-4 w-4" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default AuditLog;
